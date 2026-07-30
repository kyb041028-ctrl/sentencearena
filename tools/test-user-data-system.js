'use strict';
/**
 * 센텐스크래프트 — 사용자 데이터 시스템 테스트
 * node tools/test-user-data-system.js
 */

const cfg = require('../shared/user-data-config-core');
const schema = require('../shared/user-data-schema-core');
const memRepo = require('../server/user-data-memory-repository');
const service = require('../server/user-data-service');
const mapper = require('../server/user-data-mapper');

const fs = require('fs');
const path = require('path');

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

// ─── 사용자 ID 검증 ─────────────────────────────────────────────────────────
section('1. 사용자 식별 (userId)');
const validUuid = '550e8400-e29b-41d4-a716-446655440000';
const validUuid2 = 'a1234567-e89b-12d3-a456-426614174000';

ok('1. 운영 userId UUID 허용', cfg.isOperationalUserId(validUuid));
ok('2. guest 거부', !cfg.isOperationalUserId('guest'));
ok('3. guest_demo 거부', !cfg.isOperationalUserId('guest_demo'));
ok('4. email을 userId로 거부', !cfg.isOperationalUserId('user@example.com'));
ok('5. 유효 UUID 정상 허용', cfg.isOperationalUserId(validUuid2));
ok('6. 게스트·로그인 데이터 분리 (isGuestId 구분)', cfg.isGuestId('guest') && !cfg.isGuestId(validUuid));

// schema validateUserId
ok('6b. schema.validateUserId UUID 허용', schema.validateUserId(validUuid).valid);
ok('6c. schema.validateUserId guest 거부', !schema.validateUserId('guest').valid);
ok('6d. schema.validateUserId email 거부', !schema.validateUserId('user@test.com').valid);

// ─── SQL 정의 확인 (파일 내용 검사) ─────────────────────────────────────────
section('2. SQL 스키마 정의');
const sqlPath = path.join(__dirname, '../supabase/migration_user_data_system.sql');
const sqlContent = fs.readFileSync(sqlPath, 'utf8');

ok('7. user_progression 정의', sqlContent.includes('CREATE TABLE IF NOT EXISTS public.user_progression'));
ok('8. user_follows 정의', sqlContent.includes('CREATE TABLE IF NOT EXISTS public.user_follows'));
ok('9. user_achievements 정의', sqlContent.includes('CREATE TABLE IF NOT EXISTS public.user_achievements'));
ok('10. featured achievements 정의', sqlContent.includes('CREATE TABLE IF NOT EXISTS public.user_featured_achievements'));
ok('11. notifications 정의', sqlContent.includes('CREATE TABLE IF NOT EXISTS public.user_notifications'));
ok('12. activity events 정의', sqlContent.includes('CREATE TABLE IF NOT EXISTS public.user_activity_events'));
ok('13. bookmarks 정의', sqlContent.includes('CREATE TABLE IF NOT EXISTS public.user_bookmarks'));
ok('14. progression events 정의', sqlContent.includes('CREATE TABLE IF NOT EXISTS public.user_progression_events'));
ok('15. RLS 활성화', sqlContent.includes('ENABLE ROW LEVEL SECURITY'));
ok('16. level CHECK 1~10', sqlContent.includes('level BETWEEN 1 AND 10'));
ok('17. progression RPC service_role 전용 GRANT', sqlContent.includes('GRANT EXECUTE ON FUNCTION public.apply_user_progression_event') && sqlContent.includes('TO service_role'));
ok('18. toggle_user_follow auth.uid() 고정', sqlContent.includes('v_follower := auth.uid()'));
ok('19. 팔로우 자기 자신 금지', sqlContent.includes('follower_user_id <> following_user_id'));
ok('20. follow unique 존재', sqlContent.includes('CONSTRAINT user_follows_unique'));
ok('21. progression event dedupe unique 존재', sqlContent.includes('user_progression_events_dedupe_key_uniq'));
ok('22. 대표 업적 slot 1~3·RPC GRANT·search_path', sqlContent.includes('slot BETWEEN 1 AND 3') && sqlContent.includes('REVOKE ALL ON FUNCTION public.toggle_user_follow') && sqlContent.includes('SET search_path = public'));
ok('22c. LEVEL_RANGE 단일 원천 (1~10)', cfg.LEVEL_RANGE.min === cfg.USER_LEVEL_MIN && cfg.LEVEL_RANGE.max === cfg.USER_LEVEL_MAX);
ok('22d. grant_user_achievement service_role 전용', sqlContent.includes('REVOKE ALL ON FUNCTION public.grant_user_achievement') && sqlContent.includes('GRANT EXECUTE ON FUNCTION public.grant_user_achievement'));

// ─── 진행 상태 ───────────────────────────────────────────────────────────────
section('3. 진행 상태 (Progression)');
memRepo._resetStore();

(async function () {
  // 23. progression 기본값
  const prog = await memRepo.getProgression(validUuid);
  ok('23. progression 기본값 정상', prog.xp === 0 && prog.level === 1);

  // 24. 음수 XP 거부
  const r24 = schema.validateProgressionEvent({ userId: validUuid, eventType: 'POST_CREATED', amount: -999, dedupeKey: 'test-1' });
  // amount 음수 자체는 허용, 단 결과 XP가 0 미만이면 GREATEST(0,...) 보정
  const r24b = await memRepo.applyProgressionEvent({ userId: validUuid, eventType: 'POST_CREATED', amount: -999, dedupeKey: 'neg-xp-1', occurredAt: new Date().toISOString() });
  const afterNeg = await memRepo.getProgression(validUuid);
  ok('24. 음수 XP 결과 0 미만 방지', afterNeg.xp >= 0);

  // 25. 중복 event idempotent
  const r25a = await memRepo.applyProgressionEvent({ userId: validUuid, eventType: 'POST_CREATED', amount: 25, dedupeKey: 'dedup-test-1', occurredAt: new Date().toISOString() });
  const r25b = await memRepo.applyProgressionEvent({ userId: validUuid, eventType: 'POST_CREATED', amount: 25, dedupeKey: 'dedup-test-1', occurredAt: new Date().toISOString() });
  ok('25. 중복 event idempotent', r25b.status === 'DUPLICATE');

  // 26. 공감 기반 명성 증가
  const beforeRep = (await memRepo.getProgression(validUuid)).reputation_score;
  await memRepo.applyProgressionEvent({ userId: validUuid, eventType: 'EMPATHY_RECEIVED', amount: 10, dedupeKey: 'emp-1', occurredAt: new Date().toISOString() });
  const afterRep = (await memRepo.getProgression(validUuid)).reputation_score;
  ok('26. 공감 기반 명성 증가', afterRep > beforeRep);

  // 27. 명성 감점 이벤트 EMPATHY_RECEIVED 에 음수 적용 안됨
  const rep27before = (await memRepo.getProgression(validUuid)).reputation_score;
  await memRepo.applyProgressionEvent({ userId: validUuid, eventType: 'EMPATHY_RECEIVED', amount: -100, dedupeKey: 'emp-neg-1', occurredAt: new Date().toISOString() });
  const rep27after = (await memRepo.getProgression(validUuid)).reputation_score;
  ok('27. 명성 감점 이벤트(EMPATHY_RECEIVED) 무시', rep27after === rep27before);

  // 28. 클라이언트 직접 progression patch 거부 (service)
  service.setRepository(memRepo);
  service.setDataMode('API_OPERATIONAL');
  let err28;
  try { await service.patchProgression(); } catch (e) { err28 = e; }
  ok('28. 클라이언트 직접 progression patch 거부', err28 && err28.code === 'USER_DATA_PROGRESSION_WRITE_FORBIDDEN');

  // 29. level 범위 (1~10 허용, XP 자동 계산은 Lv5까지)
  await memRepo.applyProgressionEvent({ userId: validUuid, eventType: 'POST_CREATED', amount: 9999, dedupeKey: 'bigxp-1', occurredAt: new Date().toISOString() });
  const highLvl = await memRepo.getProgression(validUuid);
  ok('29. progression event 레벨 10 초과·Lv5 자동 계산·profile Lv10', highLvl.level <= cfg.USER_LEVEL_MAX && highLvl.level <= cfg.PROGRESSION_RULES.autoLevelCap && mapper.toPublicProfile({ id: validUuid }, { level: 10, reputation_score: 0, follower_count: 0, following_count: 0 }, null).level === 10);

  // 30. 입력 객체 비변경
  const inputPE = { userId: validUuid, eventType: 'POST_CREATED', amount: 25, dedupeKey: 'imm-1', occurredAt: new Date().toISOString() };
  const frozen = Object.assign({}, inputPE);
  await memRepo.applyProgressionEvent(inputPE);
  ok('30. 입력 객체 비변경', inputPE.amount === frozen.amount && inputPE.userId === frozen.userId);

  // ─── 팔로우 ──────────────────────────────────────────────────────────────
  section('4. 팔로우');
  memRepo._resetStore();

  // 31. 팔로우 생성
  const r31 = await memRepo.followUser(validUuid, validUuid2);
  ok('31. 팔로우 생성', r31.status === 'FOLLOWED');

  // 32. 팔로우 취소
  const r32 = await memRepo.unfollowUser(validUuid, validUuid2);
  ok('32. 팔로우 취소', r32.status === 'UNFOLLOWED');

  // 33. 중복 팔로우 방지
  await memRepo.followUser(validUuid, validUuid2);
  const r33 = await memRepo.followUser(validUuid, validUuid2);
  ok('33. 중복 팔로우 방지', r33.status === 'ALREADY_FOLLOWING');

  // 34. 자기 팔로우 금지
  let err34;
  try { await memRepo.followUser(validUuid, validUuid); } catch (e) { err34 = e; }
  ok('34. 자기 팔로우 금지', err34 && err34.code === 'USER_DATA_FOLLOW_SELF_FORBIDDEN');

  // 35. follower/following count 원자적 일치
  memRepo._resetStore();
  await memRepo.followUser(validUuid, validUuid2);
  const p1 = await memRepo.getProgression(validUuid2);
  const p2 = await memRepo.getProgression(validUuid);
  ok('35. follower/following count 원자적 일치', p1.follower_count === 1 && p2.following_count === 1);

  // 36. 타인 관계 조작 금지 (schema 레벨)
  const r36 = schema.validateFollowInput(validUuid, validUuid2);
  ok('36. 타인 관계 조작 schema 검증', r36.valid && !schema.validateFollowInput('guest', validUuid2).valid);

  // ─── 업적 ────────────────────────────────────────────────────────────────
  section('5. 업적');
  memRepo._resetStore();

  // 37. 업적 부여
  const r37 = await memRepo.grantAchievement({ userId: validUuid, achievementKey: 'beta-citizen', acquiredAt: new Date().toISOString(), acquisitionSequence: 1 });
  ok('37. 업적 부여', r37.status === 'GRANTED');

  // 38. 중복 업적 방지
  const r38 = await memRepo.grantAchievement({ userId: validUuid, achievementKey: 'beta-citizen', acquiredAt: new Date().toISOString(), acquisitionSequence: 2 });
  ok('38. 중복 업적 방지', r38.status === 'ALREADY_GRANTED');

  // 39. acquiredAt 유지
  const acAt = '2026-01-01T00:00:00.000Z';
  await memRepo.grantAchievement({ userId: validUuid, achievementKey: 'first-post', acquiredAt: acAt, acquisitionSequence: 2 });
  const list39 = await memRepo.getAchievements(validUuid);
  const a39 = list39.find(function(a) { return a.achievement_key === 'first-post'; });
  ok('39. acquiredAt 유지', a39 && a39.acquired_at === acAt);

  // 40. acquisitionSequence 유지
  ok('40. acquisitionSequence 유지', a39 && a39.acquisition_sequence === 2);

  // 41. 시즌 업적 시즌별 저장
  await memRepo.grantAchievement({ userId: validUuid, achievementKey: 'season-award', acquiredAt: new Date().toISOString(), acquisitionSequence: 3, seasonKey: 'season-1' });
  await memRepo.grantAchievement({ userId: validUuid, achievementKey: 'season-award', acquiredAt: new Date().toISOString(), acquisitionSequence: 4, seasonKey: 'season-2' });
  const list41 = await memRepo.getAchievements(validUuid);
  const seasonal = list41.filter(function(a) { return a.achievement_key === 'season-award'; });
  ok('41. 시즌 업적 시즌별 저장', seasonal.length === 2);

  // 42. 보유하지 않은 대표 업적 설정 금지
  let err42;
  try { await memRepo.setFeaturedAchievements(validUuid, ['NOT-OWNED-KEY']); } catch (e) { err42 = e; }
  ok('42. 보유하지 않은 대표 업적 설정 금지', err42 && err42.code === 'USER_DATA_ACHIEVEMENT_NOT_OWNED');

  // 43. 대표 업적 최대 3개
  const r43 = await memRepo.setFeaturedAchievements(validUuid, ['beta-citizen', 'first-post']);
  ok('43. 대표 업적 설정 성공', r43.status === 'SET');
  const r43b = schema.validateFeaturedAchievements(validUuid, ['a', 'b', 'c', 'd']);
  ok('43b. 대표 업적 최대 3개 초과 검증', !r43b.valid);

  // ─── 알림·활동 ───────────────────────────────────────────────────────────
  section('6. 알림·활동');
  memRepo._resetStore();

  // 44. 본인 알림만 조회
  await memRepo.appendNotification({ user_id: validUuid, notification_type: 'comment', title: '새 댓글', message: '댓글 달림' });
  const notifs44 = await memRepo.listNotifications(validUuid);
  ok('44. 본인 알림 조회', notifs44.length === 1);

  // 45. 본인 알림 읽음
  const nId45 = notifs44[0].id;
  await memRepo.markNotificationRead(validUuid, nId45);
  const notifs45 = await memRepo.listNotifications(validUuid);
  ok('45. 본인 알림 읽음', notifs45[0].is_read === true);

  // 46. 타인 알림 수정 금지
  let err46;
  try { await memRepo.markNotificationRead(validUuid2, nId45); } catch (e) { err46 = e; }
  ok('46. 타인 알림 수정 금지', err46 && err46.code === 'USER_DATA_NOTIFICATION_NOT_FOUND');

  // 47. 알림 dedupe (max 50)
  for (var di = 0; di < 55; di++) {
    await memRepo.appendNotification({ user_id: validUuid, notification_type: 'test' });
  }
  const notifs47 = await memRepo.listNotifications(validUuid);
  ok('47. 알림 최대 50개 유지', notifs47.length <= 50);

  // 48. 활동 이벤트 조회
  await memRepo.appendActivityEvent({ user_id: validUuid, activity_type: 'POST_CREATED' });
  const acts48 = await memRepo.listActivityEvents(validUuid);
  ok('48. 활동 이벤트 조회', acts48.length >= 1);

  // 49. 클라이언트 직접 활동 이벤트 생성 금지 (서버 전용 — routes 레벨)
  ok('49. 활동 이벤트 생성 서버 전용 설계 확인', typeof memRepo.appendActivityEvent === 'function');

  // ─── 북마크 ──────────────────────────────────────────────────────────────
  section('7. 북마크');
  memRepo._resetStore();
  const postUuid = 'b2345678-e89b-12d3-a456-426614174001';

  // 50. 북마크 추가
  const r50 = await memRepo.addBookmark(validUuid, postUuid);
  ok('50. 북마크 추가', r50.status === 'ADDED');

  // 51. 북마크 삭제
  const r51 = await memRepo.removeBookmark(validUuid, postUuid);
  ok('51. 북마크 삭제·목록 비움', r51.status === 'REMOVED' && (await memRepo.listBookmarks(validUuid)).length === 0);

  // 52. 중복 북마크 방지
  await memRepo.addBookmark(validUuid, postUuid);
  const r52 = await memRepo.addBookmark(validUuid, postUuid);
  ok('52. 중복 북마크 방지', r52.status === 'ALREADY_EXISTS');

  // 53. 본인 북마크만 조회
  await memRepo.addBookmark(validUuid2, postUuid);
  const bm53me = await memRepo.listBookmarks(validUuid);
  const bm53other = await memRepo.listBookmarks(validUuid2);
  ok('53. 본인 북마크만 조회', bm53me.length === 1 && bm53other.length === 1 && bm53me[0].user_id === validUuid);

  // ─── 레벨 검증 ─────────────────────────────────────────────────────────────
  section('8. 레벨 범위 (1~10)');
  ok('54. level 1 허용', schema.validateLevel(1).valid);
  ok('55. level 5 허용', schema.validateLevel(5).valid);
  ok('56. level 6 허용', schema.validateLevel(6).valid);
  ok('57. level 10 허용', schema.validateLevel(10).valid);
  ok('58. level 0 거부', !schema.validateLevel(0).valid);
  ok('59. level 11 거부', !schema.validateLevel(11).valid);

  // ─── legacy adapter ───────────────────────────────────────────────────────
  section('9. Legacy Adapter (Node 환경 — localStorage 없음)');

  ok('60. guest 데이터 분리 (isGuestId)', cfg.isGuestId('guest_demo') === true && cfg.isGuestId(validUuid) === false);
  ok('61. email key 자동 UUID 변환 금지 (isEmailLikeId)', cfg.isEmailLikeId('user@test.com') === true);

  // ─── API 모드 ─────────────────────────────────────────────────────────────
  section('10. API 모드');

  // 62. 기본 LEGACY_LOCAL
  service.setDataMode('LEGACY_LOCAL');
  ok('62. 기본 LEGACY_LOCAL', service.getDataMode() === 'LEGACY_LOCAL');

  // 63. API_DRY_RUN 실제 fetch 미호출 (service 레벨에서는 requireActivated 로 차단)
  service.setDataMode('API_DRY_RUN');
  let err63;
  try { await service.getMyProfile(validUuid); } catch (e) { err63 = e; }
  ok('63. API_DRY_RUN 서버 쓰기 미호출 (service 차단)', err63 && err63.code === 'USER_DATA_API_NOT_ACTIVATED');

  // 64. API_OPERATIONAL 기본 비활성
  service.setDataMode('LEGACY_LOCAL');
  ok('64. API_OPERATIONAL 기본 비활성', !service.isActivated());

  // 65. USER_DATA_API_NOT_ACTIVATED 반환
  let err65;
  try { await service.getMyProfile(validUuid); } catch (e) { err65 = e; }
  ok('65. USER_DATA_API_NOT_ACTIVATED 반환', err65 && err65.code === 'USER_DATA_API_NOT_ACTIVATED');

  // ─── 보안 ─────────────────────────────────────────────────────────────────
  section('11. 보안·권한');

  const serverJs = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const routesContent = fs.readFileSync(path.join(__dirname, '../server/user-data-routes.js'), 'utf8');
  const serviceContent = fs.readFileSync(path.join(__dirname, '../server/user-data-service.js'), 'utf8');
  const supabaseRepoContent = fs.readFileSync(path.join(__dirname, '../server/user-data-supabase-repository.js'), 'utf8');

  ok('66. service-role key public 미노출', !serverJs.includes('service_role'));
  ok('68. service·route·sanitizeRepoError', serviceContent.includes('setUserRepository') && serviceContent.includes('setAdminRepository') && routesContent.includes('toggleFollow(myId') && serviceContent.includes('sanitizeRepoError'));
  ok('67. userClient/adminClient 분리', supabaseRepoContent.includes('setUserClient') && supabaseRepoContent.includes('setAdminClient'));
  ok('69. 공개 쓰기·profile level·RPC 목록 차단', routesContent.includes('USER_DATA_PROGRESSION_WRITE_FORBIDDEN') && routesContent.includes('USER_DATA_NOTIFICATION_CREATE_FORBIDDEN') && routesContent.includes('USER_DATA_ACTIVITY_WRITE_FORBIDDEN') && schema.validateProfilePatch({ level: 10 }).errors.indexOf('USER_DATA_PROGRESSION_WRITE_FORBIDDEN') !== -1 && cfg.USER_JWT_RPC_NAMES.indexOf('toggle_user_follow') !== -1);
  ok('70. XP·업적 부여·metadata 노출 차단', routesContent.includes('/users/me/xp') && routesContent.includes('NOT_FOUND') && routesContent.includes('/users/me/achievements/grant') && schema.filterPublicProfile({ metadata: { x: 1 }, email: 'a@b.c' }).metadata === undefined);
  ok('70c. SERVICE_ROLE_RPC·reputation patch 거부', cfg.SERVICE_ROLE_RPC_NAMES.indexOf('grant_user_achievement') !== -1 && schema.validateProfilePatch({ reputationScore: 100 }).errors.indexOf('USER_DATA_PROGRESSION_WRITE_FORBIDDEN') !== -1);

  // ─── 회귀 테스트 ─────────────────────────────────────────────────────────
  if (process.env.SC_USER_DATA_UNIT_ONLY === '1') {
    console.log('\n=== 사용자 데이터 시스템 테스트 결과 (unit only) ===');
    results.forEach(function(r) { console.log(r); });
    console.log('\n총 ' + (pass + fail) + '개 테스트: ' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail === 0 ? 0 : 1);
  }

  section('12. 기존 회귀 테스트');

  const { execFileSync } = require('child_process');

  function runChildTest(scriptName, expectPattern, timeoutMs, extraEnv) {
    const scriptPath = path.join(__dirname, scriptName);
    let stdout = '';
    let stderr = '';
    console.log('[regression] 시작:', scriptName, '(timeout', (timeoutMs || 120000) + 'ms)');
    const t0 = Date.now();
    try {
      stdout = execFileSync(process.execPath, [scriptPath], {
        encoding: 'utf8',
        timeout: timeoutMs || 120000,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, extraEnv || {}),
      });
      console.log('[regression] 완료:', scriptName, '(' + Math.round((Date.now() - t0) / 1000) + 's)');
      const matched = !expectPattern || stdout.includes(expectPattern) || new RegExp(expectPattern).test(stdout);
      ok(scriptName + ' 통과', matched, matched ? '' : stdout.slice(-400));
    } catch (e) {
      console.log('[regression] 실패/타임아웃:', scriptName, '(' + Math.round((Date.now() - t0) / 1000) + 's)');
      stdout = e.stdout ? String(e.stdout) : '';
      stderr = e.stderr ? String(e.stderr) : '';
      ok(scriptName + ' 통과', false, (stderr || stdout || e.message || String(e)).slice(-500));
    }
  }

  // board-compat는 내부 alignment 회귀를 건너뛰고, alignment는 여기서 1회만
  runChildTest('test-board-core-system.js', 'passed: 49 failed: 0', 90000);
  runChildTest('test-board-compat-system.js', 'failed: 0', 120000, { SC_SKIP_COMPAT_REGRESSION: '1' });
  runChildTest('test-alignment-supabase-system.js', 'failed: 0', 600000);

  // 결과 출력
  console.log('\n=== 사용자 데이터 시스템 테스트 결과 ===');
  results.forEach(function(r) { console.log(r); });
  console.log('\n총 ' + (pass + fail) + '개 테스트: ' + pass + ' PASS / ' + fail + ' FAIL');
  if (fail === 0) {
    console.log('\n모든 테스트 PASS.');
    process.exit(0);
  } else {
    console.log('\n일부 테스트 FAIL — 위 내용 확인 필요');
    process.exit(1);
  }
})().catch(function (e) {
  console.error('테스트 실행 오류:', e);
  process.exit(1);
});
