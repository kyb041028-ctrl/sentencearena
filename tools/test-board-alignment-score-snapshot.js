'use strict';
/**
 * Board reaction alignment score snapshots from canonical SSOT.
 * node tools/test-board-alignment-score-snapshot.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createBoardService } = require('../server/board-service');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const { getCanonicalUserAlignmentScore } = require('../server/canonical-user-territory-service');
const boardSchema = require('../shared/board-schema-core');
const beta = require('../shared/political-alignment-beta-v1-core');
const simCore = require('../shared/political-alignment-simulation-core');
const inputCore = require('../shared/political-reaction-input-core');
const persistCore = require('../shared/political-alignment-persist-core');
const teardown = require('./test-process-teardown');

let pass = 0;
let fail = 0;

function ok(label, cond, detail) {
  if (cond) {
    console.log('  PASS: ' + label);
    pass += 1;
  } else {
    console.log('  FAIL: ' + label + (detail ? ' — ' + detail : ''));
    fail += 1;
  }
}

function section(title) {
  console.log('\n[' + title + ']');
}

function uid(n) {
  return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function fakeScoreClient(impl) {
  return {
    from: function (table) {
      return {
        select: function (cols) {
          return {
            eq: function (col, val) {
              return {
                maybeSingle: async function () {
                  return impl({ table: table, cols: cols, col: col, val: val });
                },
              };
            },
          };
        },
      };
    },
  };
}

const AS_OF = new Date('2026-08-15T12:00:00.000Z');
function daysAgo(days) {
  return new Date(AS_OF.getTime() - days * 86400000).toISOString();
}
function simRow(partial) {
  var base = {
    id: uid(100),
    actor_user_id: uid(1),
    target_author_user_id: uid(2),
    reaction_type: 'LIKE',
    actor_territory_at_reaction: 'CENTRAL',
    target_author_territory_at_reaction: 'PIONEER',
    actor_alignment_score_at_reaction: 120,
    target_author_alignment_score_at_reaction: -80,
    created_at: daysAgo(5),
    cancelled_at: null,
    audience_scope: 'EARTH',
    target_type: 'POST',
    post_id: uid(3),
  };
  Object.keys(partial || {}).forEach(function (k) {
    base[k] = partial[k];
  });
  return base;
}
function sim(rows, extra) {
  return simCore.simulateAlignmentBatch(Object.assign({ asOf: AS_OF, rows: rows }, extra || {}));
}
function userById(result, id) {
  var list = result.users || [];
  var i;
  for (i = 0; i < list.length; i++) {
    if (list[i].userId === id) return list[i];
  }
  return null;
}

const author = uid(1);
const actor = uid(2);
const fresh = uid(3);
const scores = {};
scores[author] = -80;
scores[actor] = 120;

const repo = createBoardMemoryRepository();
const service = createBoardService({
  repository: repo,
  userContext: createMockUserContextAdapter({
    territories: { [author]: 'CENTRAL', [actor]: 'CENTRAL', [fresh]: 'CENTRAL' },
    alignmentScores: scores,
  }),
  operational: true,
});

const adapterSrc = read('server/board-user-context-adapter.js');
const svcSrc = read('server/canonical-user-territory-service.js');
const boardSvcSrc = read('server/board-service.js');
const rpcSrc = read('supabase/migration_political_alignment_beta_v1.sql');
const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
});

section('가드');
ok('canonical adapter has getUserAlignmentScore', /getUserAlignmentScore/.test(adapterSrc) && /getCanonicalUserAlignmentScore/.test(adapterSrc));
ok('SSOT user_alignment_state.score only', /from\('user_alignment_state'\)/.test(svcSrc) && /\.select\('score'\)/.test(svcSrc));
ok('DB 오류는 0으로 숨기지 않음', /ALIGNMENT_SCORE_READ_FAILED/.test(svcSrc) && /BOARD_ALIGNMENT_SCORE_UNAVAILABLE/.test(boardSvcSrc));
ok('live RPC도 user_alignment_state 조회', /user_alignment_state/.test(rpcSrc) && /actor_alignment_score_at_reaction/.test(rpcSrc));
ok(
  'auth 미수정',
  !/(^|\n)public\/auth\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/app-entry\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/auth-v2\//.test(authDiff)
);
ok(
  '공식 SSOT 70/100/130 + actor 25%',
  require('../shared/alignment-batch-core').getAlignmentBatchProcessorConfig().reactionWeights.sameTerritoryPositive === 70 &&
    require('../shared/political-alignment-beta-v1-core').POLICIES.ACTOR_SELF_RATIO === 0.25 &&
    require('../shared/political-alignment-beta-v1-core').POLICIES.AUTHOR_RECEIVED === 'ACTIVE'
);

section('SSOT read');
(async function () {
  const missing = await getCanonicalUserAlignmentScore(uid(9), {
    client: fakeScoreClient(function () {
      return { data: null, error: null };
    }),
  });
  ok('4. alignment row 없음 → 0', missing === 0);

  const live = await getCanonicalUserAlignmentScore(uid(8), {
    client: fakeScoreClient(function () {
      return { data: { score: 120 }, error: null };
    }),
  });
  ok('5. non-zero row → 120 not 0', live === 120);

  const swapped = await getCanonicalUserAlignmentScore(uid(7), {
    client: fakeScoreClient(function (args) {
      ok('score query table SSOT', args.table === 'user_alignment_state' && args.cols === 'score');
      return { data: { score: -80 }, error: null };
    }),
  });
  ok('author lookup returns that user score', swapped === -80);

  let readErr = null;
  try {
    await getCanonicalUserAlignmentScore(uid(6), {
      client: fakeScoreClient(function () {
        return { data: null, error: { message: 'boom' } };
      }),
    });
  } catch (e) {
    readErr = e;
  }
  ok('DB error not silent 0', readErr && readErr.code === 'ALIGNMENT_SCORE_READ_FAILED');

  const created = await service.createPost({ userId: author }, { title: 'snap', content: 'body' });
  const post = created.post;

  const r1 = await service.toggleReaction(
    { userId: actor },
    { targetType: 'POST', targetId: post.id, reactionType: 'LIKE' }
  );
  ok('10. LIKE CREATED', r1 && r1.action === 'CREATED' && r1.active === true);

  const active = (await repo.listActiveReactionsForActor(actor, 'POST', post.id))[0];
  ok('1. actor snapshot +120', active && Number(active.actorAlignmentScoreAtReaction) === 120);
  ok('2. author snapshot -80', active && Number(active.targetAuthorAlignmentScoreAtReaction) === -80);
  ok(
    '3. columns not swapped',
    active &&
      Number(active.actorAlignmentScoreAtReaction) === 120 &&
      Number(active.targetAuthorAlignmentScoreAtReaction) === -80
  );

  scores[actor] = 300;
  scores[author] = -250;
  const afterScoreChange = (await repo.listActiveReactionsForActor(actor, 'POST', post.id))[0];
  ok(
    '6. snapshot immutable after current score change',
    afterScoreChange &&
      Number(afterScoreChange.actorAlignmentScoreAtReaction) === 120 &&
      Number(afterScoreChange.targetAuthorAlignmentScoreAtReaction) === -80
  );

  const rCancel = await service.toggleReaction(
    { userId: actor },
    { targetType: 'POST', targetId: post.id, reactionType: 'LIKE' }
  );
  ok('9. cancel action', rCancel && rCancel.action === 'CANCELLED' && rCancel.active === false);
  const cancelledRows = (await repo.listReactionsForAlignment({})).filter(function (r) {
    return r.actorUserId === actor && r.reactionType === 'LIKE';
  });
  ok(
    '9b. cancelled row keeps original snapshot',
    cancelledRows.length === 1 &&
      cancelledRows[0].cancelledAt &&
      Number(cancelledRows[0].actorAlignmentScoreAtReaction) === 120
  );

  const rDislike = await service.toggleReaction(
    { userId: actor },
    { targetType: 'POST', targetId: post.id, reactionType: 'DISLIKE' }
  );
  ok('10b. DISLIKE CREATED (별 그룹, REPLACE 아님)', rDislike && rDislike.action === 'CREATED');
  const dislike = (await repo.listActiveReactionsForActor(actor, 'POST', post.id)).find(function (r) {
    return r.reactionType === 'DISLIKE';
  });
  ok(
    '전환 시점은 새 DISLIKE row의 현재 score',
    dislike &&
      Number(dislike.actorAlignmentScoreAtReaction) === 300 &&
      Number(dislike.targetAuthorAlignmentScoreAtReaction) === -250
  );

  const rFresh = await service.toggleReaction(
    { userId: fresh },
    { targetType: 'POST', targetId: post.id, reactionType: 'LIKE' }
  );
  const freshRow = (await repo.listActiveReactionsForActor(fresh, 'POST', post.id))[0];
  ok('4b. 신규 회원 missing map → 0', rFresh && rFresh.action === 'CREATED' && freshRow && Number(freshRow.actorAlignmentScoreAtReaction) === 0);

  let empErr = null;
  try {
    await service.toggleReaction(
      { userId: actor },
      { targetType: 'POST', targetId: post.id, reactionType: 'EMPATHY' }
    );
  } catch (e) {
    empErr = e;
  }
  ok(
    '8. EMPATHY는 board LIKE/DISLIKE toggle 대상 아님',
    empErr &&
      (empErr.code === 'BOARD_LEGACY_REACTION_NOT_SUPPORTED' || empErr.code === 'BOARD_REACTION_TYPE_INVALID')
  );

  const selfRx = await service.toggleReaction(
    { userId: author },
    { targetType: 'POST', targetId: post.id, reactionType: 'LIKE' }
  );
  ok('7. self LIKE persist는 기존 허용', selfRx && selfRx.action === 'CREATED');
  var selfSim = sim([
    simRow({
      actor_user_id: author,
      target_author_user_id: author,
      actor_alignment_score_at_reaction: -80,
      target_author_alignment_score_at_reaction: -80,
    }),
  ]);
  ok(
    '7b. self reaction alignment 계산 제외',
    selfSim.eligibleReactionCount === 0 && selfSim.excludeReasons.SELF_REACTION === 1
  );

  section('CENTRAL gradual / bidirectional / caps');
  ok('11. CENTRAL +120 strength 0.5', beta.gradualStrength(120) === 0.5);
  ok('11b. deadzone 0', beta.gradualStrength(0) === 0 && beta.gradualStrength(40) === 0);
  ok('11c. full 200', beta.gradualStrength(200) === 1);

  var actorSelf = beta.computeActorSelfSigned({
    reactionType: 'LIKE',
    actorTerritory: 'CENTRAL',
    targetTerritory: 'CENTRAL',
    actorAlignmentScoreAtReaction: 0,
    targetAlignmentScoreAtReaction: 120,
  });
  var authorRecv = beta.computeAuthorReceivedSigned({
    reactionType: 'LIKE',
    actorTerritory: 'CENTRAL',
    targetTerritory: 'PIONEER',
    actorAlignmentScoreAtReaction: 120,
    targetAlignmentScoreAtReaction: -80,
  });
  var actorZero = beta.computeAuthorReceivedSigned({
    reactionType: 'LIKE',
    actorTerritory: 'CENTRAL',
    targetTerritory: 'PIONEER',
    actorAlignmentScoreAtReaction: 0,
    targetAlignmentScoreAtReaction: -80,
  });
  var actorFull = beta.computeAuthorReceivedSigned({
    reactionType: 'LIKE',
    actorTerritory: 'CENTRAL',
    targetTerritory: 'PIONEER',
    actorAlignmentScoreAtReaction: 200,
    targetAlignmentScoreAtReaction: -80,
  });
  ok('13. ACTOR_SELF CENTRAL→CENTRAL ratio 0.25', actorSelf && actorSelf.strength === 0.25);
  ok('14. AUTHOR_RECEIVED CENTRAL actor +120 → 0.5', authorRecv && authorRecv.strength === 0.5 && authorRecv.reason === 'AUTHOR_RECEIVED_CENTRAL_ACTOR_GRADUAL');
  ok('A. CENTRAL actor 0 → AUTHOR_RECEIVED strength 0', actorZero && actorZero.strength === 0);
  ok('C. CENTRAL actor +200 → strength 1', actorFull && actorFull.strength === 1);

  var pioneerSelf = beta.computeActorSelfSigned({
    reactionType: 'LIKE',
    actorTerritory: 'PIONEER',
    targetTerritory: 'GUARDIAN',
    actorAlignmentScoreAtReaction: 120,
    targetAlignmentScoreAtReaction: -80,
  });
  ok('D. PIONEER/GUARDIAN actor-self ratio 0.25', pioneerSelf && pioneerSelf.strength === 0.25 && pioneerSelf.reason === 'ACTOR_SELF');

  ok('15. 70/130 유지', Math.abs(require('../shared/alignment-batch-core').computeSignedDelta({
    reactionType: 'LIKE',
    actorTerritoryAtReaction: 'PIONEER',
    targetTerritoryAtReaction: 'PIONEER',
  })) === 70);

  var pairRows = [];
  var i;
  for (i = 0; i < 3; i++) {
    pairRows.push(simRow({
      id: uid(500 + i),
      actor_user_id: uid(1),
      target_author_user_id: uid(2),
      actor_territory_at_reaction: 'PIONEER',
      target_author_territory_at_reaction: 'GUARDIAN',
      actor_alignment_score_at_reaction: 0,
      target_author_alignment_score_at_reaction: 0,
      created_at: daysAgo(1),
    }));
  }
  var pair = sim(pairRows);
  ok('16. pair7d 120 author / actor daily ±60', userById(pair, uid(2)).rawDelta === 120 && userById(pair, uid(1)).rawDelta === -60);

  var dailyRows = [];
  for (i = 0; i < 4; i++) {
    dailyRows.push(simRow({
      id: uid(520 + i),
      actor_user_id: uid(10 + i),
      target_author_user_id: uid(2),
      actor_territory_at_reaction: 'PIONEER',
      target_author_territory_at_reaction: 'GUARDIAN',
      actor_alignment_score_at_reaction: 0,
      target_author_alignment_score_at_reaction: 0,
      created_at: daysAgo(1),
    }));
  }
  ok('17. community ±240', userById(sim(dailyRows), uid(2)).rawDelta === 240);
  ok('18. Daily Issue ±180', beta.applySignedDailyCap(180, 60, 180).stored === 0 && beta.computeDailyIssueReactionSigned('PIONEER', 'LIKE') === 60);
  var winCfg = inputCore.getBatchConfig();
  ok(
    '19. 99/30 유지',
    simCore.POLICIES.WINDOW_COMBINATION_POLICY === 'CONFIRMED' &&
      winCfg.rollingWindowDays === 99 &&
      winCfg.recentWindowDays === 30 &&
      winCfg.rollingWindowRatio === 0.5 &&
      winCfg.recentWindowRatio === 0.5
  );
  ok('20. batch ±500', persistCore.getCap() === 500);

  var cancelledSim = sim([
    simRow({
      cancelled_at: daysAgo(1),
      actor_alignment_score_at_reaction: 120,
      target_author_alignment_score_at_reaction: -80,
    }),
  ]);
  ok('9c. cancelled excluded from input', cancelledSim.eligibleReactionCount === 0);

  var empSim = sim([simRow({ reaction_type: 'EMPATHY' })]);
  ok('8b. EMPATHY alignment 제외', empSim.eligibleReactionCount === 0);

  var currentOverride = {};
  currentOverride[actor] = 999;
  currentOverride[author] = 999;
  var a = sim([
    simRow({
      actor_user_id: actor,
      target_author_user_id: author,
      actor_territory_at_reaction: 'CENTRAL',
      target_author_territory_at_reaction: 'CENTRAL',
      actor_alignment_score_at_reaction: 120,
      target_author_alignment_score_at_reaction: -80,
    }),
  ]);
  var b = sim(
    [
      simRow({
        actor_user_id: actor,
        target_author_user_id: author,
        actor_territory_at_reaction: 'CENTRAL',
        target_author_territory_at_reaction: 'CENTRAL',
        actor_alignment_score_at_reaction: 120,
        target_author_alignment_score_at_reaction: -80,
      }),
    ],
    { currentScoreByUser: currentOverride }
  );
  ok(
    '6b. batch reads snapshot not current score',
    userById(a, actor) && userById(b, actor) && userById(a, actor).rawDelta === userById(b, actor).rawDelta
  );

  let missingFn = null;
  try {
    const broken = createBoardService({
      repository: createBoardMemoryRepository(),
      userContext: {
        getUserTerritory: async function () {
          return 'CENTRAL';
        },
        getAudienceScope: async function () {
          return 'EARTH';
        },
      },
      operational: true,
    });
    const p2 = await broken.createPost({ userId: author }, { title: 'x', content: 'yyyy' });
    await broken.toggleReaction(
      { userId: actor },
      { targetType: 'POST', targetId: p2.post.id, reactionType: 'LIKE' }
    );
  } catch (e) {
    missingFn = e;
  }
  ok('missing getUserAlignmentScore fails closed', missingFn && missingFn.code === 'BOARD_ALIGNMENT_SCORE_UNAVAILABLE');

  console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
  return teardown.finishTest(fail);
})().catch(function (e) {
  console.error(e);
  return teardown.finishTest(fail || 1);
});
