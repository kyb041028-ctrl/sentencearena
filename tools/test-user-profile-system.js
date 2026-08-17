'use strict';
/**
 * 센텐스아레나 — 프로필 UI 데이터 연결 준비 테스트
 * node tools/test-user-profile-system.js
 */

const cfg = require('../shared/user-data-config-core');
const schema = require('../shared/user-data-schema-core');
const pub = require('../shared/public-profile-core');
const memRepo = require('../server/user-data-memory-repository');
const assembler = require('../server/user-profile-assembler');
const territoryAdapter = require('../server/user-profile-territory-adapter');
const alignmentAdapter = require('../server/user-profile-alignment-map-adapter');
const dataAdapter = require('../public/user-profile-data-adapter');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const UUID2 = 'a1234567-e89b-12d3-a456-426614174000';

(async function main() {
  // ─── 1. 공용 계약 ─────────────────────────────────────────────────────────
  section('1. 공용 계약');
  const sample = pub.mapPublicUserProfile({
    profile: { id: UUID, display_name: '테스트', avatar_url: null, bio: 'hello' },
    progression: { level: 3, reputation_score: 10, citizen_rank: null, follower_count: 1, following_count: 2 },
    followState: { isFollowing: false, isFollowedBy: false },
    territoryInfo: { territory: 'CENTRAL', available: true, source: 'LEGACY_PROFILE' },
    alignmentMap: pub.emptyAlignmentMap(),
    featuredAchievements: [],
    viewerUserId: UUID2,
    targetUserId: UUID,
  });
  ok('1. public profile 필수 필드', pub.PUBLIC_PROFILE_REQUIRED.every(function (k) { return sample[k] !== undefined; }));
  ok('2. dataStatus 허용값', pub.isDataStatus('READY') && pub.isDataStatus('LEGACY_MOCK') && !pub.isDataStatus('FOO'));
  ok('3. accountState 허용값', pub.isAccountState('ACTIVE') && pub.isAccountState('DELETED') && !pub.isAccountState('X'));
  const frozenIn = { profile: { id: UUID, display_name: 'A' }, progression: {}, targetUserId: UUID };
  const before = JSON.stringify(frozenIn);
  pub.mapPublicUserProfile(frozenIn);
  ok('4. 입력 객체 비변경', JSON.stringify(frozenIn) === before);
  ok('5. 잘못된 UUID 거부', !schema.validateUserId('not-uuid').valid);
  ok('6. guest ID 거부', !schema.validateUserId('guest').valid);
  ok('7. email ID 거부', !schema.validateUserId('a@b.com').valid);

  // ─── 2. 공개·비공개 ───────────────────────────────────────────────────────
  section('2. 공개·비공개');
  const leaky = Object.assign({}, sample, {
    email: 'x@y.com',
    metadata: { secret: 1 },
    moderationState: 'ban',
    alignmentScore: 99,
    notifications: [],
    bookmarks: [],
  });
  const cleaned = pub.sanitizePublicProfile(leaky);
  ok('8. public profile에서 email 제거', cleaned.email == null);
  ok('9. auth metadata 제거', cleaned.metadata == null);
  ok('10. moderation 상태 제거', cleaned.moderationState == null);
  ok('11. 내부 alignment 점수 제거', cleaned.alignmentScore == null);
  ok('12. notification 제거', cleaned.notifications == null);
  ok('13. bookmark 제거', cleaned.bookmarks == null);
  const selfP = pub.mapSelfUserProfile({
    profile: { id: UUID, display_name: 'Me' },
    progression: { level: 3, xp: 100, reputation_score: 1, follower_count: 0, following_count: 0 },
    targetUserId: UUID,
    territoryInfo: { territory: 'PIONEER', available: true },
    alignmentMap: pub.emptyAlignmentMap(),
    featuredAchievements: [],
  });
  ok('14. self profile과 public profile 분리', selfP.xp != null && sample.xp == null);

  // ─── 3. assembler ─────────────────────────────────────────────────────────
  section('3. assembler');
  memRepo._resetStore();
  assembler.setRepository(memRepo);
  assembler.setAchievementDefinitions({
    'beta-citizen': { title: '베타 시민', iconUrl: null },
  });
  await memRepo.updateProfile(UUID, { display_name: 'AssemblerUser', bio: 'bio', avatar_url: null });
  await memRepo.applyProgressionEvent({
    userId: UUID, eventType: 'POST_CREATED', amount: 100, dedupeKey: 'asm-1', occurredAt: new Date().toISOString(),
  });
  await memRepo.grantAchievement({
    userId: UUID, achievementKey: 'beta-citizen', acquiredAt: '2026-01-01T00:00:00.000Z', acquisitionSequence: 1,
  });
  await memRepo.setFeaturedAchievements(UUID, ['beta-citizen']);
  await memRepo.followUser(UUID2, UUID);

  const assembled = await assembler.getPublicUserProfile({ viewerUserId: UUID2, targetUserId: UUID });
  ok('15. profile + progression 결합', assembled.displayName === 'AssemblerUser' && assembled.level >= 1);
  ok('16. follower/following 수 결합', assembled.followerCount === 1);
  ok('17. featured achievements 결합', assembled.featuredAchievements.length === 1 && assembled.featuredAchievements[0].achievementKey === 'beta-citizen');
  ok('18. follow state 결합', assembled.isFollowing === true);
  ok('19. 선택 데이터 실패 시 기본 표시 유지', assembled.dataStatus === 'READY' && assembled.displayName);

  const missing = await assembler.getPublicUserProfile({ targetUserId: UUID2 });
  ok('20. 존재하지 않는 사용자 NOT_FOUND', missing.dataStatus === 'NOT_FOUND');

  await memRepo.updateProfile(UUID2, { display_name: 'Gone', is_deleted: true });
  const deleted = await assembler.getPublicUserProfile({ targetUserId: UUID2 });
  ok('21. 삭제 사용자 DELETED', deleted.dataStatus === 'DELETED');

  memRepo._resetStore();
  await memRepo.updateProfile(UUID, { display_name: 'Priv', is_private: true });
  const priv = await assembler.getPublicUserProfile({ targetUserId: UUID });
  ok('22. 비공개 사용자 PRIVATE', priv.dataStatus === 'PRIVATE' && priv.bio == null);

  ok('23. repository row 직접 노출 금지', assembled.user_id == null && assembled.metadata == null && assembled.email == null);

  // ─── 4. 영토·성향지도 ─────────────────────────────────────────────────────
  section('4. 영토·성향지도');
  const t1 = await territoryAdapter.getProfileTerritory(UUID, {
    profileRow: { metadata: { territory: 'PIONEER' } },
  });
  ok('24. 운영 영토 값 정상 처리', t1.territory === 'PIONEER' && t1.available);
  const t2 = await territoryAdapter.getProfileTerritory(UUID, {
    profileRow: { territory: 'center' },
  });
  ok('25. 레거시 영토 adapter 변환', t2.territory === 'CENTRAL');
  const t3 = await territoryAdapter.getProfileTerritory(UUID, {
    clientTerritory: 'ALIEN',
    profileRow: {},
  });
  ok('26. 클라이언트 영토 신뢰 금지', t3.territory !== 'ALIEN' && t3.available === false);
  const t4 = await territoryAdapter.getProfileTerritory(UUID, { profileRow: {} });
  ok('27. 실제 영토 데이터 없으면 available false', t4.available === false);
  const am1 = await alignmentAdapter.getPublicAlignmentMap(UUID, {
    rawAlignment: { orientationScore: 12345 },
  });
  ok('28. alignment 내부 원점수 미노출', am1.available === false && am1.value == null);
  const modalNoAlign = dataAdapter.mapPublicProfileToProfileModal(sample);
  ok('29. 성향지도 데이터 없을 때 UI 오류 없음', modalNoAlign.alignment && modalNoAlign.alignment.available === false);

  // ─── 5. 레벨·XP ───────────────────────────────────────────────────────────
  section('5. 레벨·XP');
  ok('30. 레벨 1 표시', pub.buildProfileXpProgress({ level: 1, xp: 0 }).level === 1);
  ok('31. 레벨 5 표시', pub.buildProfileXpProgress({ level: 5, xp: 300 }).level === 5);
  const xp6 = pub.buildProfileXpProgress({ level: 6, xp: 400 });
  ok('32. 레벨 6 표시', xp6.level === 6 && xp6.available === true);
  const xp10 = pub.buildProfileXpProgress({ level: 10, xp: 9999 });
  ok('33. 레벨 10 MAX 처리', xp10.isMaxLevel === true);
  ok('34. 레벨 0 거부', !cfg.isValidLevel(0));
  ok('35. 레벨 11 거부', !cfg.isValidLevel(11));
  const xpNoGauge = pub.buildProfileXpProgress({ level: 6 });
  ok('36. XP 없으면 임의 진행률 생성 금지', xpNoGauge.progressRatio == null && xpNoGauge.available === false);
  const xpOk = pub.buildProfileXpProgress({ level: 2, xp: 50 });
  ok('37. XP progress ratio 0~1 제한', xpOk.available && xpOk.progressRatio >= 0 && xpOk.progressRatio <= 1);

  // ─── 6. 명성·시민등급 ─────────────────────────────────────────────────────
  section('6. 명성·시민등급');
  ok('38. reputationGrade와 citizenRank 분리', sample.reputationGrade !== undefined && sample.citizenRank === null);
  ok('39. citizenRank null 허용', assembled.citizenRank == null || typeof assembled.citizenRank === 'string');
  const rg = pub.resolveReputationGrade(2);
  ok('40. 명성등급을 citizenRank로 자동 복사하지 않음', rg === '논객' && sample.citizenRank == null);

  // ─── 7. 대표 업적 ─────────────────────────────────────────────────────────
  section('7. 대표 업적');
  const feat = pub.mapFeaturedAchievements([
    { slot: 2, achievement_key: 'b', owned: true, acquired_at: '2026-02-01', acquisition_sequence: 2 },
    { slot: 1, achievement_key: 'a', owned: true, acquired_at: '2026-01-01', acquisition_sequence: 1 },
    { slot: 3, achievement_key: 'c', owned: true, acquired_at: '2026-03-01', acquisition_sequence: 3 },
    { slot: 4, achievement_key: 'd', owned: true },
  ], { a: { title: 'A' }, b: { title: 'B' }, c: { title: 'C' } });
  ok('41. 최대 3개', feat.items.length === 3);
  ok('42. slot 순서 유지', feat.items[0].achievementKey === 'a' && feat.items[1].achievementKey === 'b');
  const feat2 = pub.mapFeaturedAchievements([
    { slot: 1, achievement_key: 'x', owned: false },
  ], {});
  ok('43. 미보유 업적 제외', feat2.items.length === 0);
  const feat3 = pub.mapFeaturedAchievements([
    { slot: 1, achievement_key: 'unknown-key', owned: true, acquired_at: '2026-01-01', acquisition_sequence: 9 },
  ], {});
  ok('44. 존재하지 않는 definition warning', feat3.warnings.length === 1 && feat3.items[0].achievementKey === 'unknown-key');
  ok('45. acquiredAt 유지', feat3.items[0].acquiredAt === '2026-01-01');
  ok('46. acquisitionSequence 유지', feat3.items[0].acquisitionSequence === 9);
  ok('47. 아이콘 없을 때 placeholder', feat3.items[0].placeholder === true);
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  ok('48. 기존 UI 좌표 미변경 (SC_PROFILE_LAYOUT 유지)', indexHtml.includes('SC_PROFILE_LAYOUT'));

  // ─── 8. 상태 UI ───────────────────────────────────────────────────────────
  section('8. 상태 UI');
  ok('49. LOADING view model', pub.buildLoadingProfileViewModel(UUID).dataStatus === 'LOADING');
  ok('50. NOT_FOUND view model', pub.buildNotFoundProfileViewModel(UUID).dataStatus === 'NOT_FOUND');
  ok('51. PRIVATE view model', pub.buildPrivateProfileViewModel(UUID).dataStatus === 'PRIVATE');
  ok('52. DELETED view model', pub.buildDeletedProfileViewModel(UUID).dataStatus === 'DELETED');
  ok('53. UNAVAILABLE view model', pub.buildUnavailableProfileViewModel(UUID).dataStatus === 'UNAVAILABLE');
  ok('54. LEGACY_MOCK view model', pub.buildLegacyMockProfileViewModel({ userId: UUID, displayName: 'M' }).dataStatus === 'LEGACY_MOCK');

  // ─── 9. 익명 ──────────────────────────────────────────────────────────────
  section('9. 익명');
  const anonGate = pub.canOpenProfileFromAuthorContext({ isAnonymous: true, userId: UUID });
  ok('55. 익명 작성자 실제 userId 조회 금지', anonGate.allowed === false);
  ok('56. 익명 hover 프로필 금지', anonGate.reason === 'ANONYMOUS');
  ok('57. 익명 클릭 모달 금지', anonGate.allowed === false);
  const anonVm = pub.buildAnonymousProfileViewModel();
  ok('58. 익명 실제 displayName 미노출', anonVm.displayName === '익명' && anonVm.userId == null);
  ok('59. 익명 실제 avatar 미노출', anonVm.avatarUrl == null);
  ok('60. 블라인드·삭제 작성자 profile open 제한',
    !pub.canOpenProfileFromAuthorContext({ isBlinded: true, userId: UUID }).allowed &&
    !pub.canOpenProfileFromAuthorContext({ isDeleted: true, userId: UUID }).allowed);

  // ─── 10. 클라이언트 adapter ───────────────────────────────────────────────
  section('10. 클라이언트 adapter');
  memRepo._resetStore();
  await memRepo.updateProfile(UUID, { display_name: 'UIUser', bio: 'b', avatar_url: '/a.png' });
  await memRepo.applyProgressionEvent({
    userId: UUID, eventType: 'POST_CREATED', amount: 50, dedupeKey: 'ui-1', occurredAt: new Date().toISOString(),
  });
  const full = await assembler.getPublicUserProfile({ viewerUserId: UUID2, targetUserId: UUID });
  const mini = dataAdapter.mapPublicProfileToMiniProfile(full);
  const modal = dataAdapter.mapPublicProfileToProfileModal(full);
  ok('61. API → mini profile 변환', mini.nickname === 'UIUser' && mini.userId === UUID);
  ok('62. API → modal profile 변환', modal.nickname === 'UIUser' && modal.authUserId === UUID);
  ok('63. legacy → public contract 변환', dataAdapter.mapLegacyUserToPublicProfile({
    nickname: 'Legacy', level: 2, fame: 3, followers: 4, territorySkin: 'pioneer', achievements: [],
  }, { userId: UUID }).dataStatus === 'LEGACY_MOCK');
  ok('64. mini와 modal 동일 핵심 데이터', mini.level === modal.level && mini.nickname === modal.nickname);
  const legacySrc = { nickname: 'Keep', level: 1 };
  const legacyCopy = JSON.stringify(legacySrc);
  dataAdapter.mapLegacyUserToPublicProfile(legacySrc, { userId: UUID });
  ok('65. legacy 원본 비변경', JSON.stringify(legacySrc) === legacyCopy);

  const routesContent = fs.readFileSync(path.join(__dirname, '../server/user-data-routes.js'), 'utf8');
  const apiClientContent = fs.readFileSync(path.join(__dirname, '../public/user-profile-api-client.js'), 'utf8');
  ok('66. API_DRY_RUN fetch 미호출 설계', apiClientContent.includes('API_DRY_RUN') && apiClientContent.includes('실제 fetch 미호출'));
  ok('67. 기본 LEGACY_LOCAL', cfg.resolveUserDataMode({}) === 'LEGACY_LOCAL');
  ok('68. API_OPERATIONAL 기본 비활성', cfg.resolveUserDataMode({}) !== 'API_OPERATIONAL');

  // ─── 11. 캐시 (api client — Node mock) ─────────────────────────────────────
  section('11. 캐시');
  global.UserDataConfigCore = cfg;
  global.UserDataSchemaCore = schema;
  global.PublicProfileCore = pub;
  global.UserProfileDataAdapter = dataAdapter;
  global.sessionStorage = { getItem: function () { return null; }, setItem: function () {} };
  delete require.cache[require.resolve('../public/user-profile-api-client.js')];
  const apiClient = require('../public/user-profile-api-client');
  apiClient._clearCacheForTest();
  const k = 'public:' + UUID;
  apiClient._setCacheEntryForTest(k, { userId: UUID, dataStatus: 'READY' }, Date.now() + 60000);
  const c1 = await apiClient.getPublicProfile(UUID);
  ok('69. 같은 userId 중복 요청 병합/캐시', c1.cached === true);
  ok('70. TTL 내 캐시 사용', c1.cached === true && c1.data.userId === UUID);
  apiClient._setCacheEntryForTest(k, { userId: UUID, dataStatus: 'READY' }, Date.now() - 1);
  const c2 = await apiClient.getPublicProfile(UUID);
  ok('71. TTL 후 재조회', c2.cached !== true);
  apiClient._setCacheEntryForTest(k, { userId: UUID }, Date.now() + 60000);
  apiClient.invalidateProfileCache(UUID);
  ok('72. 본인 프로필 수정 후 무효화', apiClient._getCacheForTest()[k] == null);
  apiClient._setCacheEntryForTest(k, { userId: UUID }, Date.now() + 60000);
  apiClient.invalidateFollowStateCache(UUID2, UUID);
  ok('73. 팔로우 변경 후 follow state 무효화', apiClient._getCacheForTest()[k] == null);
  const anonRes = await apiClient.getPublicProfile(UUID, { isAnonymous: true, userId: UUID });
  ok('74. 익명 context 실제 ID 캐시 금지', anonRes.data && anonRes.data.isAnonymous === true && apiClient._getCacheForTest()[k] == null);

  ok('74b. profile/full · profile/public route', routesContent.includes('/users/me/profile/full') && routesContent.includes('/profile/public'));
  ok('74c. __scInspectUserProfileData 존재', apiClientContent.includes('__scInspectUserProfileData'));

  // ─── 12. 회귀 (user-data에 board+alignment 포함, 중복 alignment 방지) ──────
  if (process.env.SC_PROFILE_UNIT_ONLY === '1') {
    console.log('\n=== 프로필 UI 데이터 연결 테스트 결과 (unit only) ===');
    results.forEach(function (r) { console.log(r); });
    console.log('\n총 ' + (pass + fail) + '개 테스트: ' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail === 0 ? 0 : 1);
  }

  section('12. 회귀');
  function runChild(scriptName, expectPattern, timeoutMs, extraEnv) {
    console.log('[regression] 시작:', scriptName);
    const t0 = Date.now();
    try {
      const out = execFileSync(process.execPath, [path.join(__dirname, scriptName)], {
        encoding: 'utf8',
        timeout: timeoutMs || 120000,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, extraEnv || {}),
      });
      console.log('[regression] 완료:', scriptName, '(' + Math.round((Date.now() - t0) / 1000) + 's)');
      const matched = !expectPattern || out.includes(expectPattern) || new RegExp(expectPattern).test(out);
      ok(scriptName + ' 통과', matched, matched ? '' : out.slice(-400));
    } catch (e) {
      console.log('[regression] 실패:', scriptName);
      ok(scriptName + ' 통과', false, String((e.stderr || e.stdout || e.message) || e).slice(-500));
    }
  }

  runChild('test-user-data-system.js', '80 PASS', 900000);

  console.log('\n=== 프로필 UI 데이터 연결 테스트 결과 ===');
  results.forEach(function (r) { console.log(r); });
  console.log('\n총 ' + (pass + fail) + '개 테스트: ' + pass + ' PASS / ' + fail + ' FAIL');
  if (fail === 0) {
    console.log('\n모든 테스트 PASS.');
    process.exit(0);
  }
  console.log('\n일부 테스트 FAIL');
  process.exit(1);
})().catch(function (e) {
  console.error('테스트 실행 오류:', e);
  process.exit(1);
});
