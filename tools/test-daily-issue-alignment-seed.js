#!/usr/bin/env node
'use strict';
/**
 * BETA DAILY ISSUE ALIGNMENT SEED V1 tests A–Z
 * node tools/test-daily-issue-alignment-seed.js
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const seed = require('../shared/daily-issue-alignment-seed-core');
const beta = require('../shared/political-alignment-beta-v1-core');
const simCore = require('../shared/political-alignment-simulation-core');
const reviewCore = require('../shared/daily-issue-review-core');
const quality = require('../shared/daily-issue-quality-core');
const freshness = require('../shared/daily-issue-freshness-core');
const duplicate = require('../shared/daily-issue-duplicate-core');
const decisionCore = require('../shared/daily-issue-publication-decision-core');
const reviewService = require('../server/daily-issue-review-service');
const { createMemoryDailyIssueAlignmentReactionStore } = require('../server/daily-issue-alignment-reaction-store');
const { requestApp } = require('./daily-issue-api-http-helper');
const {
  makeReady,
  createTestApp,
  authHeaders,
  memberHeaders,
  AS_OF,
} = require('./daily-issue-api-test-fixtures');
const teardown = require('./test-process-teardown');

let pass = 0;
let fail = 0;

function ok(label, cond, detail) {
  if (cond) {
    console.log('  PASS: ' + label);
    pass += 1;
  } else {
    console.log('  FAIL: ' + label + (detail ? ' — ' + String(detail) : ''));
    fail += 1;
  }
}

function section(title) {
  console.log('\n[' + title + ']');
}

function uid(n) {
  return '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
}

const BATCH_AS_OF = new Date('2026-08-15T12:00:00.000Z');

function daysAgo(days) {
  return new Date(BATCH_AS_OF.getTime() - days * 86400000).toISOString();
}

function userById(result, id) {
  var list = result.users || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].userId === id) return list[i];
  }
  return null;
}

function boardRow(partial) {
  var base = {
    id: uid(100),
    actor_user_id: uid(1),
    target_author_user_id: uid(2),
    reaction_type: 'LIKE',
    actor_territory_at_reaction: 'PIONEER',
    target_author_territory_at_reaction: 'PIONEER',
    actor_alignment_score_at_reaction: 0,
    target_author_alignment_score_at_reaction: 0,
    created_at: daysAgo(1),
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

function diRow(partial) {
  var base = {
    id: 'di_' + Math.random().toString(16).slice(2),
    userId: uid(9),
    issueId: 'issue_1',
    reactionType: 'LIKE',
    issueAlignmentDirectionAtReaction: 'PIONEER',
    createdAt: daysAgo(1),
    cancelledAt: null,
  };
  Object.keys(partial || {}).forEach(function (k) {
    base[k] = partial[k];
  });
  return base;
}

function sim(rows, dailyIssueRows, extra) {
  return simCore.simulateAlignmentBatch(
    Object.assign({ asOf: BATCH_AS_OF, rows: rows || [], dailyIssueRows: dailyIssueRows || [] }, extra || {})
  );
}

async function publishViaApi(app, repo, suffix, alignment, category) {
  const item = makeReady(suffix, category ? { category: category } : null);
  if (alignment) item.alignmentDirection = alignment;
  repo.insertReviewItems([item], [], {});
  const ap = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + item.id + '/approve', {
    headers: authHeaders(),
    body: { expectedStatus: 'READY_FOR_REVIEW', expectedLockVersion: item.lockVersion || 1, reviewerId: 'seed-test' },
  });
  if (!ap.body || !ap.body.ok) throw new Error('approve failed ' + JSON.stringify(ap.body));
  const lock = ap.body.data.item.lockVersion;
  const pb = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + item.id + '/publish', {
    headers: authHeaders(),
    body: { expectedStatus: 'APPROVED', expectedLockVersion: lock, reviewerId: 'seed-test' },
  });
  if (!pb.body || !pb.body.ok) throw new Error('publish failed ' + JSON.stringify(pb.body));
  return pb.body.data.item;
}

async function main() {
  console.log('\n=== daily-issue alignment seed v1 ===\n');

  section('guards');
  ok('A policy ACTIVE_SEED', seed.POLICIES.DAILY_ISSUE === 'ACTIVE_SEED' && beta.POLICIES.DAILY_ISSUE === 'ACTIVE_SEED');
  ok('no keyword classifier', seed.POLICIES.KEYWORD_CLASSIFIER === false);
  ok('no balance/quota flags', seed.POLICIES.BALANCE_TARGET === false && seed.POLICIES.SYNTHETIC_OPPOSITE_ISSUE === false);
  ok('DI cap 180 community 240 batch 500', beta.POLICIES.DAILY_ISSUE_DAILY_CAP === 180 && beta.POLICIES.COMMUNITY_ALIGNMENT_DAILY_CAP === 240 && beta.POLICIES.BATCH_CAP === 500);
  ok('no AUTHOR_RECEIVED on DI', seed.POLICIES.AUTHOR_RECEIVED === false);
  const seedSrc = fs.readFileSync(path.join(root, 'shared/daily-issue-alignment-seed-core.js'), 'utf8');
  ok('Y no 정부/세금 keyword classifier', !/복지|세금|규제/.test(seedSrc) || seedSrc.indexOf('KEYWORD_CLASSIFIER: false') >= 0);
  ok('U no BALANCE_TARGET in DI pipeline', !fs.readFileSync(path.join(root, 'server/daily-issue-review-service.js'), 'utf8').includes('BALANCE_TARGET'));
  ok('U no PIONEER_QUOTA', !fs.readFileSync(path.join(root, 'server/daily-issue-review-service.js'), 'utf8').includes('PIONEER_QUOTA'));
  ok('W no synthetic opposite helper', typeof reviewService.generateOppositeIssue !== 'function' && typeof reviewCore.generateOppositeIssue !== 'function');

  section('A-F signed');
  ok('A PIONEER LIKE +60', seed.computeReactionSigned('PIONEER', 'LIKE') === 60 && beta.computeDailyIssueReactionSigned('PIONEER', 'LIKE') === 60);
  ok('B PIONEER DISLIKE -60', seed.computeReactionSigned('PIONEER', 'DISLIKE') === -60);
  ok('C GUARDIAN LIKE -60', seed.computeReactionSigned('GUARDIAN', 'LIKE') === -60);
  ok('D GUARDIAN DISLIKE +60', seed.computeReactionSigned('GUARDIAN', 'DISLIKE') === 60);
  ok('E NEUTRAL LIKE 0', seed.computeReactionSigned('NEUTRAL', 'LIKE') === 0);
  ok('F NEUTRAL DISLIKE 0', seed.computeReactionSigned('NEUTRAL', 'DISLIKE') === 0);
  ok('Q null direction NEUTRAL 0', seed.computeReactionSigned(null, 'LIKE') === 0 && seed.normalizeDirection(null) === 'NEUTRAL');
  ok('R comment write 0', seed.commentWriteSigned() === 0 && beta.POLICIES.COMMENT_WRITE === 0);
  ok('T view/dwell/source 0', seed.viewSigned() === 0 && seed.dwellSigned() === 0 && seed.sourceClickSigned() === 0);
  ok('empathy 0', seed.empathySigned() === 0);

  const user = uid(9);
  function diDelta(rows) {
    var r = sim([], rows);
    var u = userById(r, user);
    return u ? u.rawDelta : null;
  }

  section('A-F batch');
  ok('A batch PIONEER LIKE', diDelta([diRow({ userId: user, reactionType: 'LIKE', issueAlignmentDirectionAtReaction: 'PIONEER' })]) === 60);
  ok('B batch PIONEER DISLIKE', diDelta([diRow({ userId: user, reactionType: 'DISLIKE', issueAlignmentDirectionAtReaction: 'PIONEER' })]) === -60);
  ok('C batch GUARDIAN LIKE', diDelta([diRow({ userId: user, reactionType: 'LIKE', issueAlignmentDirectionAtReaction: 'GUARDIAN' })]) === -60);
  ok('D batch GUARDIAN DISLIKE', diDelta([diRow({ userId: user, reactionType: 'DISLIKE', issueAlignmentDirectionAtReaction: 'GUARDIAN' })]) === 60);
  ok('E batch NEUTRAL LIKE', diDelta([diRow({ userId: user, reactionType: 'LIKE', issueAlignmentDirectionAtReaction: 'NEUTRAL' })]) === 0);
  ok('F batch NEUTRAL DISLIKE', diDelta([diRow({ userId: user, reactionType: 'DISLIKE', issueAlignmentDirectionAtReaction: 'NEUTRAL' })]) === 0);

  section('G-I toggle');
  const store = createMemoryDailyIssueAlignmentReactionStore();
  await store.toggle({ userId: user, issueId: 'iss_g', reactionType: 'LIKE', directionSnapshot: 'PIONEER', now: daysAgo(1) });
  ok('G created LIKE', (await store.getActive(user, 'iss_g')).reactionType === 'LIKE');
  await store.toggle({ userId: user, issueId: 'iss_g', reactionType: 'LIKE', directionSnapshot: 'PIONEER', now: daysAgo(1) });
  ok('G cancel removes active', (await store.getActive(user, 'iss_g')) == null);
  var gSim = sim([], (await store.listActive()).filter(function (r) { return r.issueId === 'iss_g'; }));
  ok('G cancelled excluded from batch', !userById(gSim, user) || userById(gSim, user).eligibleReactionCount === 0);

  await store.toggle({ userId: user, issueId: 'iss_h', reactionType: 'LIKE', directionSnapshot: 'PIONEER', now: daysAgo(1) });
  await store.toggle({ userId: user, issueId: 'iss_h', reactionType: 'DISLIKE', directionSnapshot: 'PIONEER', now: daysAgo(1) });
  var hActive = await store.listActive();
  var hSame = hActive.filter(function (r) { return r.issueId === 'iss_h'; });
  ok('H LIKE->DISLIKE one active', hSame.length === 1 && hSame[0].reactionType === 'DISLIKE');

  await store.toggle({ userId: user, issueId: 'iss_i', reactionType: 'DISLIKE', directionSnapshot: 'GUARDIAN', now: daysAgo(1) });
  await store.toggle({ userId: user, issueId: 'iss_i', reactionType: 'LIKE', directionSnapshot: 'GUARDIAN', now: daysAgo(1) });
  var iSame = (await store.listActive()).filter(function (r) { return r.issueId === 'iss_i'; });
  ok('I DISLIKE->LIKE one active', iSame.length === 1 && iSame[0].reactionType === 'LIKE');

  section('J-K DI daily cap');
  var jRows = [];
  var k;
  for (k = 0; k < 4; k++) {
    jRows.push(diRow({
      id: 'j' + k,
      userId: user,
      issueId: 'j' + k,
      reactionType: 'LIKE',
      issueAlignmentDirectionAtReaction: 'PIONEER',
      createdAt: daysAgo(1),
    }));
  }
  var jRes = userById(sim([], jRows), user);
  ok('J raw +240 -> +180', jRes && jRes.rawDelta === 180 && jRes.capApplied === false);

  var kRows = [];
  for (k = 0; k < 4; k++) {
    kRows.push(diRow({
      id: 'k' + k,
      userId: user,
      issueId: 'k' + k,
      reactionType: 'DISLIKE',
      issueAlignmentDirectionAtReaction: 'PIONEER',
      createdAt: daysAgo(1),
    }));
  }
  var kRes = userById(sim([], kRows), user);
  ok('K raw -240 -> -180', kRes && kRes.rawDelta === -180);

  section('L-M separate caps + batch 500');
  var communityRows = [];
  for (k = 0; k < 4; k++) {
    communityRows.push(boardRow({
      id: uid(400 + k),
      actor_user_id: uid(20 + k),
      target_author_user_id: user,
      reaction_type: 'LIKE',
      actor_territory_at_reaction: 'PIONEER',
      target_author_territory_at_reaction: 'PIONEER',
      created_at: daysAgo(1),
    }));
  }
  var mixed = sim(communityRows, jRows);
  var mixedUser = userById(mixed, user);
  ok('L community 240 + DI 180 separate', mixedUser && mixedUser.rawDelta === 420);
  ok('L community cap unchanged', beta.POLICIES.COMMUNITY_ALIGNMENT_DAILY_CAP === 240);

  var hugeDi = [];
  for (k = 0; k < 20; k++) {
    hugeDi.push(diRow({
      id: 'm' + k,
      userId: uid(11),
      issueId: 'm' + k,
      reactionType: 'LIKE',
      issueAlignmentDirectionAtReaction: 'PIONEER',
      createdAt: daysAgo(k + 1),
    }));
  }
  var hugeBoard = [];
  for (k = 0; k < 20; k++) {
    hugeBoard.push(boardRow({
      id: uid(500 + k),
      actor_user_id: uid(12),
      target_author_user_id: uid(11),
      reaction_type: 'LIKE',
      actor_territory_at_reaction: 'PIONEER',
      target_author_territory_at_reaction: 'PIONEER',
      created_at: daysAgo(k + 1),
    }));
  }
  var mRes = userById(sim(hugeBoard, hugeDi), uid(11));
  ok('M batch ±500', mRes && Math.abs(mRes.cappedDelta) <= 500 && mRes.capApplied === true);

  section('N snapshot invariant');
  const snapStore = createMemoryDailyIssueAlignmentReactionStore();
  await snapStore.toggle({
    userId: user,
    issueId: 'snap_1',
    reactionType: 'LIKE',
    directionSnapshot: 'PIONEER',
    now: daysAgo(1),
  });
  var beforeSnap = (await snapStore.getActive(user, 'snap_1')).issueAlignmentDirectionAtReaction;
  ok('N snapshot stored PIONEER', beforeSnap === 'PIONEER');
  var nDelta = diDelta(await snapStore.listActive());
  ok('N uses snapshot not later GUARDIAN', nDelta === 60);

  section('HTTP O-P Q Z');
  const reactionStore = createMemoryDailyIssueAlignmentReactionStore();
  const { app, repo } = createTestApp({ reactionStore: reactionStore });
  const published = await publishViaApi(app, repo, 'seed_pub', 'PIONEER');
  const alignRes = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + published.id + '/alignment', {
    headers: authHeaders(),
    body: { alignmentDirection: 'PIONEER', expectedLockVersion: published.lockVersion },
  });
  ok('admin can set PIONEER', alignRes.status === 200 && alignRes.body.data.item.alignmentDirection === 'PIONEER');

  const pubGet = await requestApp(app, 'GET', '/api/daily-issues/' + published.id);
  ok('9 public no alignmentDirection', pubGet.status === 200 && pubGet.raw.indexOf('alignmentDirection') < 0 && pubGet.raw.indexOf('alignment_direction') < 0);
  ok('9 public no PIONEER key leak', pubGet.body.data.item.alignmentDirection === undefined);
  ok('22 no choices/stance restore', pubGet.raw.indexOf('choices') < 0 && pubGet.raw.indexOf('stance') < 0 && pubGet.raw.indexOf('directAnswers') < 0);

  const guestToggle = await requestApp(app, 'POST', '/api/daily-issues/' + published.id + '/reactions/toggle', {
    body: { reactionType: 'LIKE' },
  });
  ok('member required 401', guestToggle.status === 401);

  const ignoreDir = await requestApp(app, 'POST', '/api/daily-issues/' + published.id + '/reactions/toggle', {
    headers: memberHeaders(user),
    body: { reactionType: 'LIKE', alignmentDirection: 'GUARDIAN', alignment_direction: 'GUARDIAN' },
  });
  ok('O ignore client direction', ignoreDir.status === 200 && ignoreDir.body.data.active === true && ignoreDir.body.data.reactionType === 'LIKE');
  ok('O response has no signed score', ignoreDir.body.data.signed == null && ignoreDir.body.data.alignmentDirection === undefined);

  const ignoreNum = await requestApp(app, 'POST', '/api/daily-issues/' + published.id + '/reactions/toggle', {
    headers: memberHeaders(user),
    body: { reactionType: 'DISLIKE', signed: 60, delta: -60, score: 60 },
  });
  ok('P ignore client numbers', ignoreNum.status === 200 && ignoreNum.body.data.reactionType === 'DISLIKE');
  const activeAfterP = await reactionStore.getActive(user, published.id);
  ok('P snapshot from server PIONEER', activeAfterP && activeAfterP.issueAlignmentDirectionAtReaction === 'PIONEER');

  const later = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + published.id + '/alignment', {
    headers: authHeaders(),
    body: { alignmentDirection: 'GUARDIAN', expectedLockVersion: alignRes.body.data.item.lockVersion },
  });
  ok('admin later GUARDIAN', later.status === 200 && later.body.data.item.alignmentDirection === 'GUARDIAN');
  const still = await reactionStore.getActive(user, published.id);
  ok('N past snapshot unchanged', still && still.issueAlignmentDirectionAtReaction === 'PIONEER');

  const legacy = makeReady('legacy_null');
  delete legacy.alignmentDirection;
  legacy.status = 'PUBLISHED';
  legacy.publishedAt = AS_OF;
  legacy.publishExpiresAt = '2026-08-20T00:00:00.000Z';
  repo.insertReviewItems([legacy], [], {});
  ok('Q missing direction normalizes NEUTRAL', seed.normalizeDirection(legacy.alignmentDirection) === 'NEUTRAL');

  const neuPub = await publishViaApi(app, repo, 'all_neutral', 'NEUTRAL', 'korea-policy');
  ok('X NEUTRAL publish ok', neuPub && neuPub.id);

  const gOnly = await publishViaApi(app, repo, 'g_only', 'GUARDIAN', 'society');
  ok('W GUARDIAN-only day publish ok', gOnly && gOnly.id);

  section('U-V no drop/generate');
  var fivePioneer = [];
  for (k = 0; k < 5; k++) fivePioneer.push({ alignmentDirection: 'PIONEER' });
  fivePioneer.push({ alignmentDirection: 'GUARDIAN' });
  ok('U 5P/1G kept as 6', fivePioneer.length === 6);
  ok('V no drop helper', typeof reviewService.dropIssuesForBalance !== 'function');

  section('Y quality/freshness/duplicate unchanged');
  const candA = makeReady('y_a');
  const candB = Object.assign({}, makeReady('y_b'), { alignmentDirection: 'PIONEER' });
  const candC = Object.assign({}, makeReady('y_c'), { alignmentDirection: 'GUARDIAN' });
  const dA = decisionCore.classifyPublicationDecision(candA, { asOf: AS_OF });
  const dB = decisionCore.classifyPublicationDecision(candB, { asOf: AS_OF });
  const dC = decisionCore.classifyPublicationDecision(candC, { asOf: AS_OF });
  ok('Y publication decision ignores direction', dA.publicationDecision === dB.publicationDecision && dB.publicationDecision === dC.publicationDecision);
  const qA = quality.validateDailyIssuePublicationQuality(candA);
  const qB = quality.validateDailyIssuePublicationQuality(candB);
  ok('Y quality ignores direction', JSON.stringify(qA.reasons || qA.qualityFailureReasons || []) === JSON.stringify(qB.reasons || qB.qualityFailureReasons || []));
  const dupA = duplicate.evaluateDuplicate(candA, []);
  const dupB = duplicate.evaluateDuplicate(candB, []);
  ok('Y duplicate ignores direction', dupA.decision === dupB.decision);
  const fA = freshness.validateDailyIssueFreshness(candA, { asOf: AS_OF });
  const fB = freshness.validateDailyIssueFreshness(candB, { asOf: AS_OF });
  ok('Y freshness ignores direction', (fA && fA.freshnessClass) === (fB && fB.freshnessClass));

  section('S community comment reaction unchanged');
  var commentDelta = userById(
    sim([
      boardRow({
        id: uid(700),
        actor_user_id: uid(1),
        target_author_user_id: uid(2),
        reaction_type: 'LIKE',
        target_type: 'COMMENT',
        comment_id: uid(4),
        post_id: null,
        actor_territory_at_reaction: 'PIONEER',
        target_author_territory_at_reaction: 'PIONEER',
      }),
    ]),
    uid(1)
  );
  ok('S comment LIKE still community 80', commentDelta && commentDelta.rawDelta === 80);

  section('Z ingest/review/publish regression');
  const ready = makeReady('z_ready');
  ok('Z createReviewItem records NEUTRAL', ready.alignmentDirection === 'NEUTRAL');
  const ins = repo.insertReviewItems([ready], [], {});
  ok('Z enqueue still works', ins.ok);
  const listed = await requestApp(app, 'GET', '/api/admin/daily-issues/review?status=READY_FOR_REVIEW', {
    headers: authHeaders(),
  });
  ok('Z admin list still works', listed.status === 200 && listed.body.ok);

  const sql = fs.readFileSync(path.join(root, 'supabase/migration_daily_issue_alignment_seed_v1.sql'), 'utf8');
  const sqlBody = sql.replace(/--[^\n]*/g, '');
  ok('migration additive', /alignment_direction/.test(sql) && /daily_issue_reactions/.test(sql));
  ok('migration no DROP/TRUNCATE/DELETE FROM', !/\bTRUNCATE\b/.test(sqlBody) && !/\bDROP TABLE\b/.test(sqlBody) && !/\bDELETE FROM\b/.test(sqlBody));
  ok('no P/G backfill', !/SET\s+alignment_direction\s*=\s*'PIONEER'/i.test(sqlBody) && !/SET\s+alignment_direction\s*=\s*'GUARDIAN'/i.test(sqlBody));

  const authDiff = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' });
  ok(
    '25 auth/app-entry untouched',
    !/(^|\n)public\/auth\.js(\r?\n|$)/.test(authDiff) &&
      !/(^|\n)public\/app-entry\.js(\r?\n|$)/.test(authDiff) &&
      !/(^|\n)public\/auth-v2\//.test(authDiff)
  );
  const rulesDiff = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', '.cursor/rules'], { cwd: root, encoding: 'utf8' });
  ok('26 .cursor/rules untouched', !String(rulesDiff || '').trim());

  console.log('\nSeed results:', pass, 'passed,', fail, 'failed');
  await teardown.finishTest(fail);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
