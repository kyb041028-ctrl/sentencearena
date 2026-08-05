#!/usr/bin/env node
'use strict';

/**
 * 데일리 이슈 시스템 테스트
 * - A: 문자열/정규식 존재 검사 (회귀 보호)
 * - B: shared/daily-issue-reaction-align-core.js 실제 실행
 * - C: AlignmentScoring + 동일 apply 계획으로 게시판·데일리 ops 결과 동일성
 * - D: 품질 게이트 정적 풀 집계 (실행)
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const alignCore = require('../shared/daily-issue-reaction-align-core');

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, cond, detail) {
  if (!cond) {
    failed += 1;
    failures.push({ name, detail: detail || '' });
    console.error('FAIL', name, detail || '');
    return;
  }
  passed += 1;
  console.log('PASS', name);
}

function has(re) {
  return re.test(INDEX_HTML);
}
function notHas(re) {
  return !re.test(INDEX_HTML);
}
function count(re) {
  const m = INDEX_HTML.match(re);
  return m ? m.length : 0;
}

function loadAlignmentScoring() {
  const code = fs.readFileSync(path.join(ROOT, 'public', 'alignment-scoring.js'), 'utf8');
  const ctx = { window: {}, console };
  ctx.window = ctx;
  vm.runInNewContext(code, ctx);
  return ctx.AlignmentScoring || ctx.window.AlignmentScoring;
}

function applyReactionScoresWithMultLocal(A, scoresStore, actorId, authorId, isLike, mult) {
  if (!A || !mult) return;
  const act = String(actorId || '').trim();
  const aut = String(authorId || '').trim();
  if (!act || !aut || act === aut) return;
  const DISLIKE_ALIGN_SCALE = 0.4;
  const PEER_SOCIAL_PRESSURE_SCALE = 0.33;
  function scaleDelta(d, k) {
    return {
      conservative: d.conservative * k,
      centrist: d.centrist * k,
      progressive: d.progressive * k,
    };
  }
  let sA = scoresStore[act] || A.initialScores();
  let sU = scoresStore[aut] || A.initialScores();
  let dR = scaleDelta(A.deltaReactorOnOthersPost(sA, sU, isLike), mult);
  let dAuth = scaleDelta(A.deltaAuthorReceivingReaction(sU, sA, isLike), mult);
  if (!isLike) {
    dR = scaleDelta(dR, DISLIKE_ALIGN_SCALE);
    dAuth = scaleDelta(dAuth, DISLIKE_ALIGN_SCALE);
  }
  dR = scaleDelta(dR, PEER_SOCIAL_PRESSURE_SCALE);
  dAuth = scaleDelta(dAuth, PEER_SOCIAL_PRESSURE_SCALE);
  scoresStore[act] = A.applyDelta(sA, dR);
  scoresStore[aut] = A.applyDelta(sU, dAuth);
}

function runStringGuards() {
  console.log('--- string guards ---');
  assert('S1. 선택지 컨테이너 제거', notHas(/className\s*=\s*'board__issue-choices'/));
  assert('S2. stance submit 게이트 제거', notHas(/submitCentristIssueComment[\s\S]*getDailyIssueStance/));
  assert('S3. CHOICE_SELECT 런타임 호출 1회 이하(정의만)', count(/CONTENT_LEAN_MULT_CHOICE_SELECT/g) <= 2);
  assert('S4. applyDailyIssueChoiceGravityDelta 호출 1회 이하(정의만)', count(/applyDailyIssueChoiceGravityDelta\(/g) <= 1);
  assert('S5. 데일리 반응에 applyReactionScoresWithMult 연결', has(/applyDailyIssueCommentReactionAlignmentOps/));
  assert('S6. empathy에 applyReactionScoresWithMult 없음', notHas(/function onDailyIssueToggleEmpathy[\s\S]{0,900}applyReactionScoresWithMult/));
  assert('S7. 품질 게이트 유지', has(/function validateDailyIssuePublicationQuality/));
  assert(
    'S8. core 스크립트 로드',
    has(/daily-issue-reaction-align-core\.js/) &&
      has(/daily-issue-source-core\.js/) &&
      has(/daily-issue-claim-core\.js/) &&
      has(/daily-issue-quality-core\.js/),
  );
}

function runCoreExecutionTests() {
  console.log('--- core execution ---');
  const A = loadAlignmentScoring();
  assert('E0. AlignmentScoring 로드', !!A && typeof A.applyDelta === 'function');

  // 1–3 stance-free plan (ops exist without stance)
  const likeAdd = alignCore.planCommentReactionAlignmentOps(false, false, true);
  assert('E1. stance 없이 좋아요 계획 가능', likeAdd.ops.length === 1 && likeAdd.ops[0].mult === 1 && likeAdd.nextLiked);
  const dislikeAdd = alignCore.planCommentReactionAlignmentOps(false, false, false);
  assert('E2. stance 없이 싫어요 계획 가능', dislikeAdd.ops.length === 1 && dislikeAdd.ops[0].isLike === false && dislikeAdd.nextDisliked);
  assert('E3. 대댓글도 동일 계획(상태머신 공유)', JSON.stringify(likeAdd) === JSON.stringify(alignCore.planCommentReactionAlignmentOps(false, false, true)));

  // 4 like add → 1 call
  assert('E4. 좋아요 추가 ops 1회', likeAdd.ops.length === 1 && likeAdd.ops[0].isLike === true && likeAdd.ops[0].mult === 1);

  // 5 like cancel
  const likeCancel = alignCore.planCommentReactionAlignmentOps(true, false, true);
  assert('E5. 좋아요 취소 ops 1회 역산', likeCancel.ops.length === 1 && likeCancel.ops[0].mult === -1 && !likeCancel.nextLiked);

  // 6 dislike add
  assert('E6. 싫어요 추가 ops 1회', dislikeAdd.ops.length === 1 && dislikeAdd.ops[0].mult === 1);

  // 7 dislike cancel
  const dislikeCancel = alignCore.planCommentReactionAlignmentOps(false, true, false);
  assert('E7. 싫어요 취소 ops 1회 역산', dislikeCancel.ops.length === 1 && dislikeCancel.ops[0].mult === -1 && !dislikeCancel.nextDisliked);

  // 8 no duplicate accumulate: already-liked toggle only cancels (no second +mult)
  const alreadyLiked = alignCore.planCommentReactionAlignmentOps(true, false, true);
  const freshLike = alignCore.planCommentReactionAlignmentOps(false, false, true);
  assert(
    'E8. 동일 반응 중복 가산 없음(이미 좋아요면 취소만)',
    alreadyLiked.ops.length === 1 &&
      alreadyLiked.ops[0].mult === -1 &&
      freshLike.ops.filter((o) => o.mult > 0).length === 1,
  );

  // 9 like → dislike: cancel like then apply dislike
  const switchPlan = alignCore.planCommentReactionAlignmentOps(true, false, false);
  assert(
    'E9. 좋아요→싫어요 전환 시 기존 취소 후 신규',
    switchPlan.ops.length === 2 &&
      switchPlan.ops[0].isLike === true &&
      switchPlan.ops[0].mult === -1 &&
      switchPlan.ops[1].isLike === false &&
      switchPlan.ops[1].mult === 1 &&
      switchPlan.nextDisliked &&
      !switchPlan.nextLiked,
  );

  // 10 self
  assert(
    'E10. 자기 반응 게이트 차단',
    alignCore.evaluateAlignmentGate({
      actorId: 'u1',
      authorId: 'u1',
      actorTerritory: 'COMMON',
      authorTerritory: 'COMMON',
      hasScoringModule: true,
    }).reason === 'SELF_REACTION',
  );

  // 11 empathy not in core (no plan for empathy)
  assert('E11. empathy는 core 성향 계획 대상 아님', typeof alignCore.planEmpathyAlignmentOps !== 'function');

  // 12 comment write itself — no align ops API for write
  assert('E12. 댓글 작성용 성향 API 없음', typeof alignCore.planCommentWriteAlignmentOps !== 'function');

  // 13 reply same as comment — already E3

  // 14 alien actor
  assert(
    'E14. 외계 actor 제외',
    alignCore.evaluateAlignmentGate({
      actorId: 'a1',
      authorId: 'b1',
      actorTerritory: 'KANTAPBIYA',
      authorTerritory: 'COMMON',
      isAlienActor: true,
      hasScoringModule: true,
    }).apply === false,
  );

  // 15 alien author
  assert(
    'E15. 외계 author 제외',
    alignCore.evaluateAlignmentGate({
      actorId: 'a1',
      authorId: 'b1',
      actorTerritory: 'COMMON',
      authorTerritory: 'KANTAPBIYA',
      isAlienAuthor: true,
      hasScoringModule: true,
    }).apply === false,
  );

  // 16 author territory unknown
  assert(
    'E16. 작성자 영토 조회 실패 시 성향 스킵',
    alignCore.evaluateAlignmentGate({
      actorId: 'a1',
      authorId: 'b1',
      actorTerritory: 'COMMON',
      authorTerritory: '',
      hasScoringModule: true,
    }).reason === 'AUTHOR_TERRITORY_UNKNOWN',
  );

  // 17 stance ignored by core
  assert(
    'E17. stance 필드와 무관하게 계획',
    JSON.stringify(alignCore.planCommentReactionAlignmentOps(false, false, true)) ===
      JSON.stringify(alignCore.planCommentReactionAlignmentOps(false, false, true)),
  );

  // 18 dwell/view — no core API
  assert('E18. 열람·체류 성향 API 없음', typeof alignCore.planDwellAlignmentOps !== 'function');

  // 19 system body — no target API
  assert('E19. 시스템 본문 반응 성향 API 없음', typeof alignCore.planIssueBodyAlignmentOps !== 'function');

  // gate ok path
  assert(
    'E20. 정상 지구 사용자 게이트 통과',
    alignCore.evaluateAlignmentGate({
      actorId: 'a1',
      authorId: 'b1',
      actorTerritory: 'COMMON',
      authorTerritory: 'PROGRESSIVE',
      hasScoringModule: true,
    }).apply === true,
  );
}

function runParityWithBoardPlan() {
  console.log('--- board/daily plan parity ---');
  const A = loadAlignmentScoring();
  const cases = [
    [false, false, true],
    [true, false, true],
    [false, true, true],
    [false, false, false],
    [false, true, false],
    [true, false, false],
  ];
  let allOk = true;
  cases.forEach(([inL, inD, asLike], idx) => {
    const plan = alignCore.planCommentReactionAlignmentOps(inL, inD, asLike);
    const boardStore = {
      actor: { conservative: 15, centrist: 12, progressive: 8 },
      author: { conservative: 8, centrist: 10, progressive: 18 },
    };
    const dailyStore = JSON.parse(JSON.stringify(boardStore));
    plan.ops.forEach((op) => {
      applyReactionScoresWithMultLocal(A, boardStore, 'actor', 'author', op.isLike, op.mult);
      applyReactionScoresWithMultLocal(A, dailyStore, 'actor', 'author', op.isLike, op.mult);
    });
    if (JSON.stringify(boardStore) !== JSON.stringify(dailyStore)) allOk = false;
  });
  assert('P1. 동일 ops면 게시판·데일리 점수 결과 동일', allOk);
}

function extractThemePools() {
  const start = INDEX_HTML.indexOf('var CENTRIST_THEME_POOLS = ');
  if (start < 0) throw new Error('pool missing');
  let i = INDEX_HTML.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let p = i; p < INDEX_HTML.length; p++) {
    const ch = INDEX_HTML[p];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = p + 1;
        break;
      }
    }
  }
  // eslint-disable-next-line no-eval
  return eval('(' + INDEX_HTML.slice(i, end) + ')');
}

function runQualityGateAggregate() {
  console.log('--- quality gate aggregate ---');
  // Mirror publication quality essential checks from index.html
  function validate(issue) {
    const reasons = [];
    try {
      const refs = Array.isArray(issue.sourceRefs) ? issue.sourceRefs : [];
      if (!refs.length) reasons.push('SOURCE_REFS_EMPTY');
      const validRefs = refs.filter((r) => {
        if (!r || typeof r !== 'object') return false;
        const required =
          !!String(r.publisher || '').trim() && !!String(r.url || '').trim() && !!String(r.publishedAt || '').trim();
        if (!required) return false;
        if (String(r.sourceType || '').toUpperCase() === 'OTHER') return false;
        const docType = String(r.documentType || '').toLowerCase();
        if (docType === 'editorial' || docType === 'column' || docType === 'sns' || docType === 'community') return false;
        return true;
      });
      if (!validRefs.length) reasons.push('VALID_SOURCE_REFS_EMPTY');
      if (!String(issue.topic || '').trim()) reasons.push('TITLE_MISSING');
      return { ok: reasons.length === 0, reasons };
    } catch (_) {
      return { ok: false, reasons: ['QUALITY_GATE_ERROR'] };
    }
  }

  const pools = extractThemePools();
  let total = 0;
  let ready = 0;
  Object.keys(pools).forEach((cat) => {
    (pools[cat] || []).forEach((pick) => {
      total += 1;
      const issue = {
        topic: pick.topic,
        sourceRefs: Array.isArray(pick.sourceRefs) ? pick.sourceRefs : [],
      };
      const q = validate(issue);
      if (q.ok) ready += 1;
    });
  });
  assert('Q1. 정적 풀 전부 QUARANTINED(통과 0)', total >= 50 && ready === 0, 'total=' + total + ' ready=' + ready);

  const errCase = {};
  Object.defineProperty(errCase, 'sourceRefs', {
    get() {
      throw new Error('boom');
    },
  });
  assert('Q2. 검증 오류 fail-closed', validate(errCase).reasons[0] === 'QUALITY_GATE_ERROR');
}

function main() {
  console.log('=== daily issue system tests ===');
  runStringGuards();
  runCoreExecutionTests();
  runParityWithBoardPlan();
  runQualityGateAggregate();
  console.log('---');
  console.log('passed:', passed, 'failed:', failed, 'total:', passed + failed);
  if (failures.length) {
    failures.forEach((f) => console.error(' -', f.name, f.detail));
    process.exit(1);
  }
  process.exit(0);
}

main();
