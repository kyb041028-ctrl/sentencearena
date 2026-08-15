'use strict';
/**
 * 정치성향 canonical 입력층 (점수 미기록)
 * node tools/test-political-reaction-input.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const core = require('../shared/political-reaction-input-core');
const batchCore = require('../shared/alignment-batch-core');

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

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function uid(n) {
  return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
}

function row(partial) {
  var now = new Date('2026-08-15T00:00:00.000Z');
  var created = new Date(now.getTime() - 5 * 86400000).toISOString();
  var base = {
    id: uid(10),
    actor_user_id: uid(1),
    target_author_user_id: uid(2),
    reaction_type: 'LIKE',
    actor_territory_at_reaction: 'PIONEER',
    target_author_territory_at_reaction: 'GUARDIAN',
    created_at: created,
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

const asOf = new Date('2026-08-15T00:00:00.000Z');
const svcSrc = read('server/political-reaction-input-service.js');
const coreSrc = read('shared/political-reaction-input-core.js');
const indexHtml = read('public/index.html');
const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
});

section('정책 가드');
ok('LIKE → POSITIVE', core.mapPolarity('LIKE') === 'POSITIVE');
ok('RECOMMEND → POSITIVE', core.mapPolarity('RECOMMEND') === 'POSITIVE');
ok('DISLIKE → NEGATIVE', core.mapPolarity('DISLIKE') === 'NEGATIVE');
ok('DOWNVOTE → NEGATIVE', core.mapPolarity('DOWNVOTE') === 'NEGATIVE');

(function () {
  var r = core.normalizeBoardReactionRows([row({ reaction_type: 'EMPATHY', id: uid(20) })], asOf);
  ok('EMPATHY 제외', r.calculable.length === 0 && r.excludeReasons.TYPE_EXCLUDED === 1);
})();
(function () {
  var r = core.normalizeBoardReactionRows([row({ reaction_type: 'REPORT', id: uid(21) })], asOf);
  ok('REPORT 제외', r.calculable.length === 0 && r.excludeReasons.TYPE_EXCLUDED === 1);
})();
(function () {
  var r = core.normalizeBoardReactionRows(
    [row({ id: uid(22), cancelled_at: '2026-08-14T00:00:00.000Z' })],
    asOf,
  );
  ok('inactive 제외', r.calculable.length === 0 && r.excludeReasons.INACTIVE === 1);
})();
(function () {
  var old = new Date(asOf.getTime() - 100 * 86400000).toISOString();
  var r = core.normalizeBoardReactionRows([row({ id: uid(23), created_at: old })], asOf);
  ok('99일 밖 제외', r.calculable.length === 0 && r.excludeReasons.OUTSIDE_99D === 1);
})();
(function () {
  var mid = new Date(asOf.getTime() - 50 * 86400000).toISOString();
  var r = core.normalizeBoardReactionRows([row({ id: uid(24), created_at: mid })], asOf);
  ok('99일 안 포함', r.calculable.length === 1 && r.windows.last99Days.length === 1 && r.windows.last30Days.length === 0);
})();
(function () {
  var recent = new Date(asOf.getTime() - 10 * 86400000).toISOString();
  var r = core.normalizeBoardReactionRows([row({ id: uid(25), created_at: recent })], asOf);
  ok(
    '30일 안 recent 포함 (99일에도 포함)',
    r.calculable.length === 1 && r.windows.last99Days.length === 1 && r.windows.last30Days.length === 1,
  );
})();

const w = core.getReactionWeights();
const batchW = batchCore.getAlignmentBatchProcessorConfig().reactionWeights;
ok(
  '가중치 SSOT = alignment-batch-core',
  w.sameTerritoryPositive === 80 &&
    w.otherTerritoryPositive === 120 &&
    w.sameTerritoryNegative === 120 &&
    w.otherTerritoryNegative === 80 &&
    w.sameTerritoryPositive === batchW.sameTerritoryPositive &&
    w.otherTerritoryPositive === batchW.otherTerritoryPositive,
);
ok('same + positive = 80', core.weightMagnitude(true, 'POSITIVE') === 80);
ok('other + positive = 120', core.weightMagnitude(false, 'POSITIVE') === 120);
ok('same + negative = 120', core.weightMagnitude(true, 'NEGATIVE') === 120);
ok('other + negative = 80', core.weightMagnitude(false, 'NEGATIVE') === 80);

(function () {
  var dupId = uid(30);
  var a = row({ id: dupId, reaction_type: 'LIKE' });
  var b = row({ id: dupId, reaction_type: 'LIKE', actor_user_id: uid(9) });
  var r = core.normalizeBoardReactionRows([a, b], asOf);
  ok('duplicate reactionId 중복 계산 없음', r.calculable.length === 1 && r.excludeReasons.DUPLICATE_ID === 1);
})();

(function () {
  var r = core.normalizeBoardReactionRows(
    [row({ id: uid(31), actor_user_id: 'not-a-uuid', target_author_user_id: uid(2) })],
    asOf,
  );
  ok('actor/target identity = auth UUID', r.calculable.length === 0 && r.excludeReasons.MISSING_IDENTITY === 1);
})();

ok(
  'service 정본 = board_reactions · bundle/scores 키 없음',
  /from\('board_reactions'\)/.test(svcSrc) &&
    /scoreWrite: false/.test(svcSrc) &&
    !/sc_political_scores/.test(svcSrc) &&
    !/sc_board_bundle/.test(svcSrc),
);
ok(
  '점수 UPDATE/배치/영토이동 없음',
  /POLITICAL_SCORE_WRITE: 'NOT_CONNECTED'/.test(svcSrc) &&
    core.POLITICAL_SCORE_WRITE === 'NOT_CONNECTED' &&
    core.POLITICAL_BATCH === 'NOT_CONNECTED' &&
    core.TERRITORY_MOVE === 'NOT_CONNECTED' &&
    !/\.from\(['"]user_alignment_state['"]\)/.test(svcSrc),
);
ok(
  'local applyReactionScoresWithMult 유지 · 정본 아님 표시',
  /function applyReactionScoresWithMult/.test(indexHtml) &&
    /LEGACY_LOCAL: Guest\/demo/.test(indexHtml),
);
ok(
  'auth/app-entry 미수정',
  !/(^|\n)public\/auth\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/app-entry\.js(\r?\n|$)/.test(authDiff) &&
    !/(^|\n)public\/auth-v2\/auth-client\.js(\r?\n|$)/.test(authDiff),
);
ok('신규 migration SQL 없음', !/CREATE TABLE/.test(coreSrc) && !/UPDATE public\.user_alignment/.test(svcSrc));

(function () {
  var alien = core.normalizeBoardReactionRows(
    [
      row({
        id: uid(40),
        actor_territory_at_reaction: 'ALIEN',
        target_author_territory_at_reaction: 'CENTRAL',
      }),
    ],
    asOf,
  );
  ok('ALIEN territory 계산 제외', alien.calculable.length === 0 && alien.excludeReasons.ALIEN_TERRITORY === 1);
})();

(function () {
  var central = core.normalizeBoardReactionRows(
    [
      row({
        id: uid(41),
        actor_territory_at_reaction: 'CENTRAL',
        target_author_territory_at_reaction: 'CENTRAL',
        reaction_type: 'LIKE',
      }),
    ],
    asOf,
  );
  ok(
    'CENTRAL vs CENTRAL = same +80 (부호 적용은 배치 NOT_CONNECTED)',
    central.calculable.length === 1 &&
      central.calculable[0].sameTerritory === true &&
      central.calculable[0].weight === 80,
  );
})();

section('live dry-run (read-only · 절대 count 고정 없음)');
(async function () {
  try {
    const persist = require('../server/achievement-persist-service');
    persist.getAdminClient();
    const svc = require('../server/political-reaction-input-service');
    const report = await svc.inspectCanonicalPoliticalReactions();
    const q = report.quality;
    ok('live board_reactions 읽기', q && typeof q.activeLikeDislikeCount === 'number' && q.activeLikeDislikeCount >= 0);
    ok(
      'calculable + incalculable = active (inactive 선행 필터)',
      q.calculableCount + q.incalculableCount === q.activeLikeDislikeCount,
    );
    ok('scoreWrite false', report.scoreWrite === false);
    ok('positive/negative 는 음수 아님', q.positiveCount >= 0 && q.negativeCount >= 0);
    const ratio =
      q.activeLikeDislikeCount === 0 ? null : q.calculableCount / q.activeLikeDislikeCount;
    console.log(
      JSON.stringify({
        dryRunQuality: {
          activeLikeDislikeCount: q.activeLikeDislikeCount,
          positiveCount: q.positiveCount,
          negativeCount: q.negativeCount,
          targetResolveOk: q.targetResolveOk,
          actorTerritoryOk: q.actorTerritoryOk,
          targetTerritoryOk: q.targetTerritoryOk,
          calculableCount: q.calculableCount,
          incalculableCount: q.incalculableCount,
          calculableRatio: ratio,
          excludeReasons: q.excludeReasons,
        },
      }),
    );
  } catch (e) {
    const code = e && e.code;
    ok(
      'live skip or readable',
      code === 'ACHIEVEMENT_PERSIST_NOT_CONFIGURED',
      String(e && e.message),
    );
  }

  console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  ok('async', false, String(e && e.message));
  console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====');
  process.exit(1);
});
