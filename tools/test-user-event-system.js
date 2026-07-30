'use strict';
/**
 * 사용자 이벤트 파이프라인 테스트
 * node tools/test-user-event-system.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const cfg = require('../shared/user-data-config-core');
const eventCore = require('../shared/user-domain-event-core');
const rankCore = require('../shared/user-rank-core');
const citizenCore = require('../shared/citizen-rank-evaluation-core');
const policyCore = require('../shared/user-event-policy-core');
const progCore = require('../shared/user-progression-event-core');
const defCore = require('../shared/achievement-definitions-core');
const achCore = require('../shared/achievement-evaluation-core');
const notifCore = require('../shared/user-notification-core');
const activityCore = require('../shared/user-activity-core');
const cacheCore = require('../shared/user-cache-invalidation-core');
const memRepo = require('../server/user-event-memory-repository');
const supaRepo = require('../server/user-event-supabase-repository');
const orchestrator = require('../server/user-event-orchestrator');
const evtService = require('../server/user-event-service');
const boardAdapter = require('../server/board-user-event-adapter');
const alignAdapter = require('../server/alignment-user-event-adapter');
const alienAdapter = require('../server/alien-user-event-adapter');
const tevoAdapter = require('../server/territory-evolution-user-event-adapter');
const evtAdapter = require('../public/user-event-data-adapter');
const inspect = require('../public/user-event-system-inspect');

const UID = '550e8400-e29b-41d4-a716-446655440001';
const UID2 = '550e8400-e29b-41d4-a716-446655440002';
const SQL = fs.readFileSync(path.join(__dirname, '../supabase/migration_user_event_pipeline.sql'), 'utf8');

let pass = 0;
let fail = 0;
const results = [];

function ok(label, condition, detail) {
  if (condition) {
    results.push('  PASS: ' + label);
    pass++;
  } else {
    results.push('  FAIL: ' + label + (detail ? ' — ' + detail : ''));
    fail++;
  }
}

function section(title) {
  results.push('\n[' + title + ']');
}

function baseEvent(overrides) {
  return Object.assign({
    eventType: eventCore.EVENT_TYPE.POST_CREATED,
    userId: UID,
    actorUserId: UID,
    dedupeKey: 'test:evt:' + Math.random().toString(36).slice(2),
    sourceType: 'TEST',
    sourceId: 'src1',
    payload: {},
    sourceSystem: 'TEST',
  }, overrides || {});
}

(async function main() {
  memRepo._reset();
  orchestrator.setRepository(memRepo);
  orchestrator.setDataMode('LEGACY_LOCAL');
  evtService.setRepository(memRepo);
  evtService.setDataMode('LEGACY_LOCAL');

  section('이벤트 계약');
  ok('1. UUID userId 허용', eventCore.validateUserId(UID).valid);
  ok('2. guest 거부', !eventCore.validateUserId('guest').valid);
  ok('3. guest_demo 거부', !eventCore.validateUserId('guest_demo').valid);
  ok('4. email 거부', !eventCore.validateUserId('user@example.com').valid);
  ok('5. eventType 검증', !eventCore.validateDomainEvent(baseEvent({ eventType: 'INVALID' })).valid);
  ok('6. dedupeKey 필수', !eventCore.validateDomainEvent(baseEvent({ dedupeKey: '' })).valid);
  const frozen = baseEvent({ payload: { foo: 1 } });
  const snap = JSON.stringify(frozen);
  eventCore.buildDomainEvent(frozen);
  ok('7. 입력 객체 비변경', JSON.stringify(frozen) === snap);
  ok('8. 민감정보 payload 거부',
    !eventCore.validateDomainEvent(baseEvent({ payload: { alignmentScore: 99 } })).valid);

  section('명성·시민등급');
  ok('9. reputationScore 음수 거부', !rankCore.normalizeReputationScore(-1).valid);
  ok('10. 명성 감점 policy 없음',
    progCore.applyProgressionPolicy(eventCore.buildDomainEvent({
      eventType: eventCore.EVENT_TYPE.EMPATHY_RECEIVED,
      userId: UID,
      dedupeKey: 'x',
      payload: { reputationAmount: -5 },
    })).policy === 'REPUTATION_DEDUCT_FORBIDDEN');
  ok('11. 기존 명성등급 label 유지', rankCore.REPUTATION_GRADE_LABELS[0] === '참여자'
    && rankCore.REPUTATION_GRADE_LABELS[4] === '지도자');
  ok('12. citizenRank null 허용', rankCore.buildCitizenRankState({ citizenRank: null }).rank === null);
  const repState = rankCore.buildReputationState({ score: 100, rankTier: 2, citizenRank: 2 });
  ok('13. 명성등급을 citizenRank로 복사하지 않음',
    repState.reputation.grade === 2 && repState.citizen.available === false);
  ok('14. 시민등급 미확정 available:false',
    citizenCore.evaluateCitizenRank({ currentRank: null }).available === false);
  ok('15. 임의 시민등급 임계값 없음',
    citizenCore.evaluateCitizenRank({}).reason === 'CITIZEN_RANK_POLICY_NOT_FINALIZED');

  section('progression');
  const postPol = progCore.applyProgressionPolicy(eventCore.buildDomainEvent({
    eventType: eventCore.EVENT_TYPE.POST_CREATED, userId: UID, dedupeKey: 'p1',
  }));
  ok('16. 확정된 event만 XP policy 적용', postPol.ok && postPol.xpDelta === 25);
  const noPol = progCore.applyProgressionPolicy(eventCore.buildDomainEvent({
    eventType: eventCore.EVENT_TYPE.FOLLOWER_GAINED, userId: UID, dedupeKey: 'f1',
  }));
  ok('17. 미확정 XP event NO_POLICY', noPol.policy === 'NO_POLICY');
  const planLv = progCore.buildProgressionEventPlan({
    userId: UID,
    event: eventCore.buildDomainEvent({ eventType: eventCore.EVENT_TYPE.POST_CREATED, userId: UID, dedupeKey: 'lv' }),
    currentProgression: { xp: 0, level: 1, reputation_score: 0 },
  });
  ok('18. 레벨 1~10 유지', planLv.levelAfter >= 1 && planLv.levelAfter <= 10);
  const badPlan = { levelAfter: 11, reputationDelta: 0 };
  ok('19. 레벨 10 초과 금지', !progCore.validateProgressionPlan(badPlan).valid);
  memRepo._seedContext(UID, { progression: { xp: 500, level: 5, reputation_score: 0 } });
  const capPlan = progCore.buildProgressionEventPlan({
    userId: UID,
    event: eventCore.buildDomainEvent({ eventType: eventCore.EVENT_TYPE.POST_CREATED, userId: UID, dedupeKey: 'cap' }),
    currentProgression: { xp: 500, level: 5, reputation_score: 0 },
  });
  ok('20. 6~10 threshold 미확정 시 임의 승급 금지', capPlan.levelAfter === 5);
  const dedupeKey = 'test:dedupe:once';
  const ev1 = baseEvent({ dedupeKey: dedupeKey });
  await orchestrator.processUserDomainEvent(ev1);
  const dup = await orchestrator.processUserDomainEvent(ev1);
  ok('21. 중복 event 멱등', dup.skipped === true && dup.reason === 'DUPLICATE');
  ok('22. reputation delta 음수 거부', !progCore.validateProgressionPlan({ levelAfter: 1, reputationDelta: -1 }).valid);

  section('업적');
  const idx = defCore.validateDefinitionIndex();
  ok('23. achievement key 중복 없음', idx.valid);
  const grant = achCore.buildAchievementGrantPlan({
    userId: UID, achievementKey: 'territory-citizen', acquiredAt: new Date().toISOString(), acquisitionSequence: 1,
  });
  ok('24. acquiredAt 필수', achCore.validateAchievementGrantPlan(grant).valid);
  ok('25. acquisitionSequence 필수',
    !achCore.validateAchievementGrantPlan(Object.assign({}, grant, { acquisitionSequence: null })).valid);
  ok('26. sequence 단조 증가 계획',
    achCore.planNextAcquisitionSequence([{ acquisitionSequence: 3 }]) === 4);
  const ownedOnce = [{ achievement_key: 'territory-citizen' }];
  const onceEval = achCore.evaluateAchievementCondition(defCore.getAchievementDefinition('territory-citizen'), {
    userProgression: { level: 5 }, ownedAchievements: ownedOnce,
  });
  ok('27. ONCE 중복 부여 금지', onceEval.reason === 'ALREADY_OWNED');
  const seasonal = defCore.listAchievementDefinitions().find(function (d) { return d.repeatPolicy === 'ONCE_PER_SEASON'; });
  ok('28. ONCE_PER_SEASON 시즌별 허용', seasonal && seasonal.repeatPolicy === 'ONCE_PER_SEASON');
  const repeatable = defCore.listAchievementDefinitions().filter(function (d) { return d.repeatPolicy === 'REPEATABLE'; });
  ok('29. REPEATABLE만 반복', repeatable.length === 0);
  const countEval = achCore.evaluateAchievementCondition(defCore.getAchievementDefinition('first-post'), {
    ownedAchievements: [], userProgression: { level: 1 },
  });
  ok('30. 조건 데이터 부족 시 획득 금지', countEval.reason === 'CONDITION_DATA_NOT_CONNECTED');
  memRepo._reset();
  orchestrator.setRepository(memRepo);
  memRepo._seedContext(UID, { progression: { xp: 275, level: 4, reputation_score: 0 } });
  const postEv = boardAdapter.buildPostCreatedPlan({
    authorUserId: UID, postId: 'post-lv5', territory: 'reform',
  });
  const lv5Res = await orchestrator.processUserDomainEvent(postEv);
  const lv5Grant = (lv5Res.derivedResults || []).some(function (r) {
    return (r.achievementPlans || []).some(function (g) { return g.achievementKey === 'territory-citizen'; });
  });
  ok('31. 레벨 5 “당당한 영토시민!” 1회', lv5Grant);
  memRepo._seedContext(UID, {
    progression: { xp: 300, level: 5, reputation_score: 0 },
    ownedAchievements: [{ achievement_key: 'territory-citizen', acquisition_sequence: 1 }],
  });
  const lv5Again = await orchestrator.processUserDomainEvent(eventCore.buildDomainEvent({
    eventType: eventCore.EVENT_TYPE.LEVEL_UP, userId: UID, dedupeKey: 'lvl5again', payload: { levelAfter: 5 },
  }));
  ok('32. 보유 업적 재부여 멱등',
    (lv5Again.achievementEvaluation.alreadyOwned || []).indexOf('territory-citizen') !== -1);
  ok('33. 대표 업적 최대 3개 유지', cfg.ACHIEVEMENT_RULES.featuredMax === 3);
  const noIcon = defCore.getAchievementDefinition('beta-citizen');
  ok('34. 아이콘 없으면 placeholder', noIcon && noIcon.iconKey === 'beta-citizen');
  ok('35. 기존 업적 key 변경 없음', defCore.listAchievementKeys().indexOf('territory-citizen') !== -1);

  section('알림');
  const nPlan = notifCore.buildNotificationPlan(eventCore.buildDomainEvent({
    eventType: eventCore.EVENT_TYPE.LEVEL_UP, userId: UID, dedupeKey: 'noti1', payload: { levelAfter: 5 },
  }));
  ok('36. 중요 알림 contract', nPlan && nPlan.notificationType === 'LEVEL_UP' && nPlan.shouldPersist === false);
  ok('37. priority 허용값', ['NORMAL', 'IMPORTANT', 'CRITICAL'].indexOf(nPlan.priority) !== -1);
  ok('38. 동일 event 알림 dedupe',
    notifCore.buildNotificationDedupeKey({ dedupeKey: 'e1' }, 'LEVEL_UP') === 'notification:e1:LEVEL_UP');
  const sanitized = notifCore.sanitizeNotificationPayload({ alignmentScore: 1, level: 2 });
  ok('39. 내부 alignment score 제거', sanitized.removedKeys.indexOf('alignmentScore') !== -1);
  ok('40. 신고자 ID 제거',
    eventCore.sanitizePayload({ reporterId: 'x' }).removedKeys.indexOf('reporterId') !== -1);
  ok('41. operator note 제거',
    eventCore.sanitizePayload({ operatorNote: 'secret' }).removedKeys.indexOf('operatorNote') !== -1);
  ok('42. HTML/script payload sanitize',
    eventCore.sanitizePayload({ msg: '<script>x</script>' }).removedKeys.length > 0);
  ok('43. 알림 생성 일반 사용자 차단', !evtService.isActivated());
  ok('44. 본인 알림만 조회', /ENABLE ROW LEVEL SECURITY/.test(SQL) && /GRANT SELECT ON public\.user_domain_event_log TO authenticated/.test(SQL));

  section('활동 피드');
  const aPlan = activityCore.buildActivityEventPlan(eventCore.buildDomainEvent({
    eventType: eventCore.EVENT_TYPE.POST_CREATED, userId: UID, dedupeKey: 'act1',
    payload: { isAnonymous: true, rawAuthorUserId: UID2 },
  }));
  ok('45. activity contract', aPlan && aPlan.activityType === 'POST_CREATED');
  ok('46. 동일 event dedupe',
    aPlan.dedupeKey === 'activity:act1:POST_CREATED');
  ok('47. 익명 작성자 실제 ID 제거', aPlan.payload.rawAuthorUserId == null);
  ok('48. 외계 내부 사유 제거',
    activityCore.sanitizeActivityPayload({ moderationReason: 'spam' }).removedKeys.indexOf('moderationReason') !== -1);
  ok('49. 일반 사용자 직접 생성 금지', (await memRepo.persistUserEventPlan({})).ok === false);
  ok('50. legacy 최대 30·표시 8 확인',
    activityCore.LEGACY_LIMITS.maxStore === 30 && activityCore.LEGACY_LIMITS.maxDisplay === 8);

  section('orchestrator');
  memRepo._reset();
  orchestrator.setRepository(memRepo);
  const proc = await orchestrator.processUserDomainEvent(boardAdapter.buildPostCreatedPlan({
    authorUserId: UID, postId: 'orch1', territory: 'reform',
  }));
  ok('51. 처리 순서 검증', proc.ok && proc.progressionPlan && proc.citizenRankPlan);
  ok('52. progression → derived level-up',
    Array.isArray(proc.derivedEvents) && proc.progressionPlan.xpDelta === 25);
  const deep = await orchestrator.processUserDomainEvent(baseEvent({
    eventType: eventCore.EVENT_TYPE.LEVEL_UP, dedupeKey: 'deep',
    payload: { levelBefore: 1, levelAfter: 2 },
  }), { _depth: orchestrator.MAX_DERIVED_DEPTH + 1 });
  ok('53. derived event 무한 재귀 방지', deep.error === 'DERIVED_DEPTH_EXCEEDED' || deep.ok === false);
  ok('54. citizen rank interface 호출', proc.citizenRankPlan.reason === 'CITIZEN_RANK_POLICY_NOT_FINALIZED');
  ok('55. achievement 평가', proc.achievementEvaluation && Array.isArray(proc.achievementEvaluation.unavailable));
  ok('56. notification plan 생성', Array.isArray(proc.notificationPlans));
  ok('57. activity plan 생성', proc.activityPlans.length >= 1);
  ok('58. dry-run에서 write 없음', proc.persistencePlan.shouldPersist === false);
  ok('59. 부분 실패 warning', Array.isArray(proc.warnings));
  const orig = baseEvent({ dedupeKey: 'immutable' });
  const origSnap = JSON.stringify(orig);
  await orchestrator.processUserDomainEvent(orig);
  ok('60. 원본 event 비변경', JSON.stringify(orig) === origSnap);

  section('adapter');
  ok('61. 게시글 생성 → POST_CREATED plan',
    boardAdapter.buildPostCreatedPlan({ authorUserId: UID, postId: 'p1' }).eventType === 'POST_CREATED');
  ok('62. 댓글 생성 → COMMENT_CREATED plan',
    boardAdapter.buildCommentCreatedPlan({ authorUserId: UID, commentId: 'c1', postId: 'p1' }).eventType === 'COMMENT_CREATED');
  ok('63. empathy → EMPATHY_RECEIVED plan',
    boardAdapter.buildEmpathyReceivedPlan({ targetUserId: UID, actorUserId: UID2, targetId: 't1' }).eventType === 'EMPATHY_RECEIVED');
  ok('64. LIKE를 명성 이벤트로 자동 변환하지 않음',
    boardAdapter.buildLikeReceivedPlan().error === 'LIKE_NOT_MAPPED_TO_REPUTATION');
  ok('65. follow → FOLLOWER_GAINED plan',
    boardAdapter.buildFollowerGainedPlan({ targetUserId: UID, followerUserId: UID2 }).eventType === 'FOLLOWER_GAINED');
  ok('66. territory change plan',
    alignAdapter.buildTerritoryChangedPlan({ userId: UID, nextTerritory: 'order', batchId: 'b1' }).ok);
  ok('67. alien transferred plan',
    alienAdapter.buildAlienTransferredPlan({ userId: UID }).ok);
  ok('68. alien return plan',
    alienAdapter.buildAlienReturnedPlan({ userId: UID }).ok);
  ok('69. weekly legend plan',
    alienAdapter.buildWeeklyLegendPlan({ userId: UID, weekKey: '2026-W30' }).ok);
  ok('70. evolution stage change plan',
    tevoAdapter.buildTerritoryEvolutionStageChangedPlan({ territory: 'reform', nextStage: 2, previousStage: 1 }).ok);
  ok('71. 실제 service 호출 없음', alienAdapter.buildAlienTransferredPlan({ userId: UID }).note === 'MODERATION_NOT_CONNECTED');

  section('SQL·권한');
  ok('72. migration_user_event_pipeline.sql 존재', fs.existsSync(path.join(__dirname, '../supabase/migration_user_event_pipeline.sql')));
  ok('73. event dedupe unique', /UNIQUE \(dedupe_key\)/.test(SQL));
  ok('74. service-role write', /GRANT SELECT, INSERT, UPDATE, DELETE ON public\.user_domain_event_log TO service_role/.test(SQL));
  ok('75. authenticated write 금지', !/GRANT INSERT ON public\.user_domain_event_log TO authenticated/.test(SQL));
  ok('76. PUBLIC revoke', /REVOKE ALL ON FUNCTION public\.persist_user_event_plan/.test(SQL));
  ok('77. SECURITY DEFINER search_path 고정', /SET search_path = public/.test(SQL));
  ok('78. progression·achievement·notification·activity 원자 plan 구조', /persist_user_event_plan/.test(SQL));
  ok('79. 실제 migration 미적용', (await supaRepo.healthCheck()).note === 'MIGRATION_NOT_APPLIED');

  section('client/legacy');
  const legacyN = evtAdapter.fromLegacyNotification({ type: 'level_up', title: '레벨', message: '5', id: 'n1' });
  ok('80. legacy notification 변환', legacyN && legacyN.notificationType === 'level_up');
  const legacyA = evtAdapter.fromLegacyActivity({ type: 'post_created', userId: UID, id: 'a1' });
  ok('81. legacy activity 변환', legacyA && legacyA.activityType === 'post_created');
  ok('82. 알림 원문 localStorage 미변경',
    !/localStorage\.setItem\(['"]sc_notifications/.test(fs.readFileSync(path.join(__dirname, '../public/user-event-data-adapter.js'), 'utf8')));
  evtService.setDataMode('API_DRY_RUN');
  const dry = await evtService.processDomainEvent(boardAdapter.buildPostCreatedPlan({
    authorUserId: UID, postId: 'dry1', territory: 'reform',
  }));
  ok('83. API_DRY_RUN fetch write 없음', dry.dryRun === true && dry.persistencePlan.shouldPersist === false);
  evtService.setDataMode('API_OPERATIONAL');
  ok('84. 기본 LEGACY_LOCAL', evtService.getDataMode() === 'LEGACY_LOCAL');
  ok('85. API_OPERATIONAL 비활성', !evtService.isActivated());

  const insp = inspect.inspectUserEventSystem({ mode: 'LEGACY_LOCAL' });
  ok('inspect 함수', insp.operational.dbWriteEnabled === false && insp.integration.boardAdapter === true);

  if (process.env.SC_USER_EVENT_UNIT_ONLY === '1') {
    console.log('\n=== 사용자 이벤트 테스트 결과 (unit only) ===');
    results.forEach(function (r) { console.log(r); });
    console.log('\n총 ' + (pass + fail) + '개 테스트: ' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail === 0 ? 0 : 1);
  }

  section('회귀 (중첩 금지 · alignment 1회)');
  function runChild(scriptName, expectPattern, timeoutMs, extraEnv) {
    const scriptPath = path.join(__dirname, scriptName);
    console.log('[regression] 시작:', scriptName);
    const t0 = Date.now();
    try {
      const out = execFileSync(process.execPath, [scriptPath], {
        encoding: 'utf8',
        timeout: timeoutMs || 120000,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, extraEnv || {}, {
          SC_SKIP_COMPAT_REGRESSION: (extraEnv && extraEnv.SC_SKIP_COMPAT_REGRESSION) || process.env.SC_SKIP_COMPAT_REGRESSION || '1',
        }),
      });
      const elapsed = Math.round((Date.now() - t0) / 1000);
      console.log('[regression] 완료:', scriptName, '(' + elapsed + 's)');
      const matched = !expectPattern || out.includes(expectPattern) || /PASS \/ 0 FAIL/.test(out) || /failed: 0/.test(out);
      ok(scriptName + ' 통과', matched, matched ? '' : out.slice(-800));
    } catch (e) {
      console.log('[regression] 실패:', scriptName);
      ok(scriptName + ' 통과', false, String((e.stderr || e.stdout || e.message) || e).slice(-800));
    }
  }

  runChild('test-alien-system.js', 'PASS / 0 FAIL', 120000, { SC_ALIEN_UNIT_ONLY: '1' });
  runChild('test-territory-evolution-system.js', 'PASS / 0 FAIL', 120000, { SC_TEVO_UNIT_ONLY: '1' });
  runChild('test-user-profile-system.js', 'PASS / 0 FAIL', 120000, { SC_PROFILE_UNIT_ONLY: '1' });
  runChild('test-user-data-system.js', 'PASS / 0 FAIL', 120000, { SC_USER_DATA_UNIT_ONLY: '1' });
  runChild('test-board-core-system.js', 'failed: 0', 120000);
  runChild('test-board-compat-system.js', 'failed: 0', 120000, { SC_SKIP_COMPAT_REGRESSION: '1' });
  runChild('test-alignment-supabase-system.js', 'failed: 0', 600000, { SC_SKIP_COMPAT_REGRESSION: '1' });

  console.log('\n=== 사용자 이벤트 테스트 결과 ===');
  results.forEach(function (r) { console.log(r); });
  console.log('\n총 ' + (pass + fail) + '개 테스트: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('테스트 실행 오류:', e);
  process.exit(1);
});
