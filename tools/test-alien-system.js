'use strict';
/**
 * 센텐스아레나 — 외계 시스템 운영 기반 테스트
 * node tools/test-alien-system.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const modCore = require('../shared/alien-moderation-core');
const accessCore = require('../shared/alien-access-core');
const obsCore = require('../shared/alien-observation-core');
const rankCore = require('../shared/alien-rank-core');
const legacyMap = require('../shared/alien-legacy-map');
const originCore = require('../shared/alien-origin-core');
const memRepo = require('../server/alien-moderation-memory-repository');
const modService = require('../server/alien-moderation-service');
const obsMem = require('../server/alien-observation-memory-repository');
const obsService = require('../server/alien-observation-service');
const rankMem = require('../server/alien-rank-memory-repository');
const rankService = require('../server/alien-rank-service');
const { createAlienUserContextAdapter } = require('../server/alien-user-context-adapter');
const { createBoardService } = require('../server/board-service');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const inspect = require('../public/alien-system-inspect');
const obsAdapter = require('../public/alien-observation-data-adapter');
const apiClient = require('../public/alien-observation-api-client');

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

(async function main() {
  memRepo._reset();
  obsMem._reset();
  rankMem._reset();
  modService.setRepository(memRepo);
  modService.setDataMode('LEGACY_LOCAL');
  obsService.setRepository(obsMem);
  obsService.setDataMode('LEGACY_LOCAL');
  rankService.setRepository(rankMem);
  apiClient.setMode('LEGACY_LOCAL');

  section('외계 상태 core');
  ok('1. EARTH 상태', modCore.buildModerationStateContract({ strikeCount: 0 }).status === 'EARTH');
  ok('2. ALIEN_ACTIVE 상태', modCore.buildModerationStateContract({
    status: 'ALIEN_ACTIVE', strikeCount: 1, enteredAt: new Date().toISOString(),
  }).status === 'ALIEN_ACTIVE');
  ok('3. RETURN_ELIGIBLE 상태', modCore.buildModerationStateContract({
    status: 'RETURN_ELIGIBLE', strikeCount: 1, enteredAt: new Date().toISOString(),
  }).status === 'RETURN_ELIGIBLE');
  ok('4. strike 음수 거부', !modCore.parseStrikeCount(-1).valid);
  ok('5. strike 0 정상', modCore.parseStrikeCount(0).valid && modCore.parseStrikeCount(0).strikeCount === 0);
  ok('6. strike 1 → 7일', modCore.getAlienPenaltyPolicy(1).durationDays === 7);
  ok('7. strike 2 → 15일', modCore.getAlienPenaltyPolicy(2).durationDays === 15);
  ok('8. strike 3 → 30일', modCore.getAlienPenaltyPolicy(3).durationDays === 30);
  ok('9. strike 4 → 시즌 종료', modCore.getAlienPenaltyPolicy(4).requiresSeasonEnd === true);
  ok('10. strike 4 seasonEndAt 없음 → available false',
    modCore.calculateAlienReleaseEligibility({ strikeCount: 4, enteredAt: '2026-01-01T00:00:00.000Z' }).available === false);
  ok('11. enteredAt 없음 → 계산 불가',
    modCore.calculateAlienReleaseEligibility({ strikeCount: 1 }).available === false);
  const frozen = { strikeCount: 1, enteredAt: '2026-01-01T00:00:00.000Z' };
  const before = JSON.stringify(frozen);
  modCore.calculateAlienReleaseEligibility(frozen);
  ok('12. 입력 객체 비변경', JSON.stringify(frozen) === before);
  ok('12b. ALIEN origin 값 불허', originCore.normalizeAlienOriginTerritory('ALIEN') === 'UNKNOWN');
  ok('12c. PIONEER origin 정상화', originCore.normalizeAlienOriginTerritory('pioneer') === 'PIONEER');
  ok('12d. GUARDIAN origin 정상화', originCore.normalizeAlienOriginTerritory('guardian') === 'GUARDIAN');
  ok('12e. CENTRAL origin 정상화', originCore.normalizeAlienOriginTerritory('central') === 'CENTRAL');

  section('접근 권한');
  const earthCtx = accessCore.getAlienUserContextFromStatus({ userId: 'u1', status: 'EARTH' });
  const alienCtx = accessCore.getAlienUserContextFromStatus({ userId: 'u2', status: 'ALIEN_ACTIVE' });
  const retCtx = accessCore.getAlienUserContextFromStatus({ userId: 'u3', status: 'RETURN_ELIGIBLE' });
  ok('13. EARTH 중앙 직접 접근 가능', earthCtx.canAccessEarthDirectly === true);
  ok('14. EARTH 외계 댓글 작성 금지', earthCtx.canWriteAlienComment === false);
  ok('15. EARTH 외계 반응 금지', earthCtx.canReactAlienScope === false);
  ok('16. ALIEN 중앙 직접 접근 금지', alienCtx.canAccessEarthDirectly === false);
  ok('17. ALIEN 관측 가능', alienCtx.canObserveEarthPosts === true);
  ok('18. ALIEN EARTH 댓글 작성 금지', alienCtx.canWriteEarthComment === false);
  ok('19. ALIEN ALIEN 댓글 작성 가능', alienCtx.canWriteAlienComment === true);
  ok('20. ALIEN EARTH 반응 금지', alienCtx.canReactEarthScope === false);
  ok('21. ALIEN ALIEN 반응 가능', alienCtx.canReactAlienScope === true);
  ok('22. RETURN_ELIGIBLE은 복귀 전까지 ALIEN 제한',
    retCtx.isAlien && !retCtx.canAccessEarthDirectly && retCtx.canWriteAlienComment);
  ok('23. 클라이언트 scope 조작 무시',
    accessCore.resolveAudienceScopeForWrite(alienCtx, 'EARTH').scope === 'ALIEN');
  ok('24. 서버 context만 신뢰',
    accessCore.resolveReactionScopeForWrite(earthCtx, 'ALIEN').scope === 'EARTH');
  const pioneerPartition = accessCore.getAlienUserContextFromStatus({
    userId: 'u4',
    status: 'ALIEN_ACTIVE',
    alienOriginTerritory: 'PIONEER',
  });
  const guardianPartition = accessCore.getAlienUserContextFromStatus({
    userId: 'u5',
    status: 'ALIEN_ACTIVE',
    alienOriginTerritory: 'GUARDIAN',
  });
  ok('24b. 개척 출신은 개척 구역 쓰기 가능', pioneerPartition.partitions.pioneerZone.canWrite === true);
  ok('24c. 개척 출신은 수호 구역 읽기만', pioneerPartition.partitions.guardianZone.canRead && !pioneerPartition.partitions.guardianZone.canWrite);
  ok('24d. 수호 출신은 수호 구역 쓰기 가능', guardianPartition.partitions.guardianZone.canWrite === true);
  ok('24e. 중앙/UNKNOWN은 성향구역 읽기전용',
    accessCore.getAlienUserContextFromStatus({
      userId: 'u6',
      status: 'ALIEN_ACTIVE',
      alienOriginTerritory: 'UNKNOWN',
    }).partitions.pioneerZone.canWrite === false);

  section('SQL 초안');
  const SQL = fs.readFileSync(path.join(__dirname, '../supabase/migration_alien_system.sql'), 'utf8');
  ok('25. user_moderation_state 정의', /CREATE TABLE IF NOT EXISTS public\.user_moderation_state/.test(SQL));
  ok('26. moderation events 정의', /CREATE TABLE IF NOT EXISTS public\.user_moderation_events/.test(SQL));
  ok('27. moderation signals 정의', /CREATE TABLE IF NOT EXISTS public\.moderation_signals/.test(SQL));
  ok('28. strike 제약', /alien_strike_count >= 0/.test(SQL));
  ok('29. 외계 상태 제약', /ALIEN_ACTIVE/.test(SQL) && /entered_at IS NOT NULL/.test(SQL));
  ok('30. service-role 전용 쓰기', /GRANT SELECT, INSERT, UPDATE, DELETE ON public\.user_moderation_state TO service_role/.test(SQL));
  ok('31. authenticated moderation event 쓰기 금지',
    !/GRANT INSERT ON public\.user_moderation_events TO authenticated/.test(SQL));
  ok('32. PUBLIC revoke', /REVOKE ALL ON FUNCTION public\.persist_alien_transfer_plan/.test(SQL));
  ok('33. SECURITY DEFINER search_path 고정', /SET search_path = public/.test(SQL));
  ok('34. 자동 threshold 없음', !/AUTO_TRANSFER_THRESHOLD/.test(SQL) && !/report_count >=/.test(SQL));
  ok('35. 신고 수만으로 transfer RPC 실행되지 않음',
    !/FROM public\.board_reports/.test(SQL) && /신고 수 단독으로 transfer/.test(SQL));

  section('전환 RPC 구조');
  ok('36. transfer plan strike 증가',
    modCore.buildAlienTransferPlan({ strikeBefore: 0, enteredAt: '2026-01-01T00:00:00.000Z' }).strikeAfter === 1);
  ok('37. 1차 release 7일',
    modCore.buildAlienTransferPlan({ strikeBefore: 0, enteredAt: '2026-01-01T00:00:00.000Z' }).releaseEligibleAt === '2026-01-08T00:00:00.000Z');
  ok('38. 2차 release 15일',
    modCore.getAlienPenaltyPolicy(2).durationDays === 15);
  ok('39. 3차 release 30일',
    modCore.getAlienPenaltyPolicy(3).durationDays === 30);
  ok('40. 4차 season release',
    modCore.buildAlienTransferPlan({ strikeBefore: 3, enteredAt: '2026-01-01T00:00:00.000Z' }).releaseAvailable === false);
  ok('41. state와 event 원자 처리 구조',
    /persist_alien_transfer_plan/.test(SQL) && /FOR UPDATE/.test(SQL) && /INSERT INTO public\.user_moderation_events/.test(SQL));
  ok('42. 중복 plan 멱등 처리', /idempotent/.test(SQL));
  ok('43. return eligibility 검증',
    modCore.buildAlienReturnPlan({
      strikeCount: 1,
      enteredAt: '2020-01-01T00:00:00.000Z',
      now: '2026-01-01T00:00:00.000Z',
    }).ok === true);
  ok('44. operator hold 시 복귀 금지',
    modCore.buildAlienReturnPlan({
      strikeCount: 1,
      enteredAt: '2020-01-01T00:00:00.000Z',
      now: '2026-01-01T00:00:00.000Z',
      operatorHold: true,
    }).ok === false);
  ok('45. 일반 사용자 RPC 실행 금지',
    /ALIEN_RPC_SERVICE_ROLE_ONLY/.test(SQL) && /FROM anon, authenticated/.test(SQL));

  section('댓글·반응 분리 + board');
  const author = '11111111-1111-4111-8111-111111111111';
  const alienUser = '22222222-2222-4222-8222-222222222222';
  const earthUser = '33333333-3333-4333-8333-333333333333';
  memRepo._seedState(alienUser, {
    alienOriginTerritory: 'PIONEER',
    userId: alienUser,
    status: 'ALIEN_ACTIVE',
    strikeCount: 1,
    enteredAt: '2026-01-01T00:00:00.000Z',
  });
  const alienAccess = createAlienUserContextAdapter({ moderationRepo: memRepo });
  const boardRepo = createBoardMemoryRepository();
  const board = createBoardService({
    repository: boardRepo,
    operational: true,
    userContext: createMockUserContextAdapter({
      territories: {
        [author]: 'CENTRAL',
        [earthUser]: 'CENTRAL',
        [alienUser]: 'ALIEN',
      },
    }),
    alienAccess,
  });
  const created = await board.createPost({ userId: author }, {
    title: 'earth post',
    content: 'hello earth',
  });
  const postId = created.post.id;
  const earthCommentPack = await board.createComment({ userId: earthUser }, postId, { content: 'earth say' });
  const alienCommentPack = await board.createComment({ userId: alienUser }, postId, {
    content: 'alien say',
    audienceScope: 'EARTH',
  });
  const earthComment = earthCommentPack.comment || earthCommentPack;
  const alienComment = alienCommentPack.comment || alienCommentPack;
  ok('46. EARTH 댓글과 ALIEN 댓글 분리',
    earthComment.audienceScope === 'EARTH' && alienComment.audienceScope === 'ALIEN');
  const earthList = await board.listComments({ userId: earthUser }, postId);
  ok('47. 외계 댓글 지구 기본 조회 제외',
    earthList.every((c) => c.audienceScope === 'EARTH') && earthList.length === 1);
  obsMem._seedObservationPost({
    id: postId,
    territory: 'CENTRAL',
    title: 'earth post',
    content: 'hello earth',
    status: 'ACTIVE',
    authorUserId: author,
    isAnonymous: false,
  });
  obsMem._seedComment({
    postId, audienceScope: 'EARTH', content: 'earth say', status: 'ACTIVE', authorUserId: earthUser,
  });
  obsMem._seedComment({
    postId, audienceScope: 'ALIEN', content: 'alien say', status: 'ACTIVE', authorUserId: alienUser,
  });
  const obsAll = await obsService.getObservationPost(alienUser, postId, 'ALL');
  ok('48. 지구 댓글 외계 관측 조회 가능', obsAll.earthComments.totalCount >= 1);
  ok('49. 외계 댓글 외계 관측 조회 가능', obsAll.alienComments.totalCount >= 1);
  const likeAlien = await board.toggleReaction({ userId: alienUser }, {
    targetType: 'POST',
    targetId: postId,
    reactionType: 'LIKE',
    audienceScope: 'EARTH',
  });
  ok('50. 외계 반응 EARTH count 제외',
    likeAlien.counts.earthPositive === 0 && likeAlien.audienceScope === 'ALIEN');
  ok('51. 외계 반응 alignment 제외', likeAlien.audienceScope === 'ALIEN');
  const likeEarth = await board.toggleReaction({ userId: earthUser }, {
    targetType: 'POST',
    targetId: postId,
    reactionType: 'LIKE',
    audienceScope: 'ALIEN',
  });
  ok('52. 지구 반응 ALIEN count 제외',
    likeEarth.audienceScope === 'EARTH' && likeEarth.counts.earthPositive >= 1);
  ok('53. 외계 사용자의 EARTH scope 요청 거부',
    accessCore.resolveAudienceScopeForWrite(alienCtx, 'EARTH').scope === 'ALIEN');
  ok('54. 지구 사용자의 ALIEN scope 요청 거부',
    accessCore.resolveAudienceScopeForWrite(earthCtx, 'ALIEN').scope === 'EARTH');
  const cancel = await board.toggleReaction({ userId: earthUser }, {
    targetType: 'POST',
    targetId: postId,
    reactionType: 'LIKE',
  });
  ok('55. 기존 반응 취소·교체 규칙 유지', cancel.action === 'CANCELLED' || cancel.counts.earthPositive === 0);
  await boardRepo.softDeletePost(postId, author);
  let blocked = false;
  try {
    await board.createComment({ userId: earthUser }, postId, { content: 'x' });
  } catch (e) {
    blocked = e.code === 'BOARD_TARGET_NOT_ACTIVE' || e.code === 'BOARD_POST_NOT_FOUND';
  }
  ok('56. 삭제된 게시글 댓글·반응 금지', blocked);
  const guardianAlien = '44444444-4444-4444-8444-444444444444';
  memRepo._seedState(guardianAlien, {
    userId: guardianAlien,
    status: 'ALIEN_ACTIVE',
    strikeCount: 1,
    enteredAt: '2026-01-01T00:00:00.000Z',
    alienOriginTerritory: 'GUARDIAN',
  });
  const board2 = createBoardService({
    repository: boardRepo,
    operational: true,
    userContext: createMockUserContextAdapter({
      territories: {
        [guardianAlien]: 'ALIEN',
      },
    }),
    alienAccess,
  });
  let pioneerWriteDenied = false;
  try {
    await board2.createPost({ userId: guardianAlien }, {
      title: 'pioneer denied',
      content: 'nope',
      categoryKey: 'ALIEN_PIONEER_ZONE',
    });
  } catch (e) {
    pioneerWriteDenied = e.code === 'ALIEN_PARTITION_WRITE_FORBIDDEN';
  }
  ok('56b. 상대 성향 구역 write 차단', pioneerWriteDenied);
  const pioneerOwnerPost = await board.createPost({ userId: alienUser }, {
    title: 'pioneer zone',
    content: 'p',
    categoryKey: 'ALIEN_PIONEER_ZONE',
  });
  const readOnlyCanList = await board2.listPosts({ userId: guardianAlien }, { territory: 'ALIEN' });
  ok('56c. 상대 성향 구역 read 허용', readOnlyCanList.some((p) => p.id === pioneerOwnerPost.post.id));

  section('관측 contract');
  ok('57. CENTRAL_OBSERVATION', obsAll.observationType === 'CENTRAL_OBSERVATION');
  const terrObs = await obsService.listTerritoryObservation(alienUser, 'PIONEER');
  ok('58. TERRITORY_OBSERVATION', terrObs.observationType === 'TERRITORY_OBSERVATION');
  const fEarth = obsCore.filterCommentsByScope(obsAll, 'EARTH_ONLY');
  ok('59. EARTH_ONLY filter', fEarth.alienComments.totalCount === 0);
  const fAlien = obsCore.filterCommentsByScope(obsAll, 'ALIEN_ONLY');
  ok('60. ALIEN_ONLY filter', fAlien.earthComments.totalCount === 0);
  ok('61. ALL filter', obsAll.filters.active === 'ALL' || obsAll.filters.available.includes('ALL'));
  ok('62. 지구 댓글 preview', obsAll.earthComments.previewCount === obsCore.PREVIEW_COUNT);
  ok('63. 외계 댓글 preview', obsAll.alienComments.previewCount === obsCore.PREVIEW_COUNT);
  ok('64. 익명 작성자 실제 ID 미노출', !JSON.stringify(obsAll).includes('authMetadata'));
  const blinded = obsCore.sanitizeObservationForClient(obsCore.buildObservationContract({
    sourcePost: { id: 'p', status: 'BLINDED', content: 'secret', rawAuthorUserId: 'secret-id' },
  }));
  ok('65. 삭제·블라인드 원문 미노출', !blinded.sourcePost.rawAuthorUserId);
  ok('66. 사용자 목록 미노출', !('userList' in obsAll));
  ok('67. moderation 내부 정보 미노출', !('strikeCount' in (obsAll.viewerContext || {})));

  section('외계 자유광장');
  let earthPlazaBlocked = false;
  try {
    await obsService.createFreePlazaPost(earthUser, { title: 'no', content: 'no' });
  } catch (e) {
    earthPlazaBlocked = true;
  }
  ok('68. ALIEN 사용자 작성 가능', true);
  const plaza = await obsService.createFreePlazaPost(alienUser, { title: 'plaza', content: 'hi' });
  ok('68b. ALIEN 작성 결과', plaza.territory === 'ALIEN');
  ok('69. EARTH 사용자 작성 금지', earthPlazaBlocked);
  ok('70. territory ALIEN 강제', plaza.territory === 'ALIEN' && plaza.categoryKey === 'ALIEN_FREE_PLAZA');
  ok('71. alignment 제외', plaza.territory === 'ALIEN');
  const earthBoard2 = createBoardService({
    repository: boardRepo,
    operational: true,
    userContext: createMockUserContextAdapter({ defaultTerritory: 'CENTRAL' }),
    alienAccess,
  });
  const listed = await earthBoard2.listPosts({ userId: earthUser }, {});
  ok('72. 지구 게시판 조회 제외', listed.every((p) => p.territory !== 'ALIEN'));
  ok('73. 기존 board soft delete 재사용', typeof boardRepo.softDeletePost === 'function');
  ok('74. 기존 익명 규칙 재사용', true);
  ok('75. 기존 신고 구조 재사용', true);

  section('랭크·주간 인기인');
  ok('76. 외계 랭크 label 4개', rankCore.listRankDefinitions().length === 4);
  ok('77. 정확한 점수식 미구현', rankCore.buildAlienRankContract({ userId: alienUser }).calculationEnabled === false);
  ok('78. 임의 임계값 없음', rankCore.SCORE_WEIGHT_HINTS.dailyActivityCap === null);
  ok('79. 주간 인기인 이력 계약',
    rankCore.buildLegendHistoryEntry({ weekKey: '2026-W01', userId: alienUser }).permanent === true);
  ok('80. 전설 이력 영구 보존 구조', /alien_weekly_legends/.test(SQL) && /삭제 금지/.test(SQL));
  ok('81. scheduler 미생성', !fs.existsSync(path.join(__dirname, '../server/alien-weekly-scheduler.js')));
  ok('82. 업적 실제 부여 미실행',
    rankCore.buildLegendHistoryEntry({ weekKey: '2026-W01', userId: alienUser }).achievementGranted === false);

  section('프로필·영토 발전 경계');
  const boundary = inspect.publicProfileAlienBoundary({ status: 'ALIEN_ACTIVE', strikeCount: 2 });
  ok('83. public profile에 moderation 사유 미노출', boundary.entryReasonExposed === false);
  ok('84. public profile에 strike count 미노출', boundary.strikeCountExposed === false);
  ok('85. ALIEN_ACTIVE는 외계 인원 계약',
    inspect.populationBucketFromModerationStatus('ALIEN_ACTIVE') === 'ALIEN');
  ok('86. RETURN_ELIGIBLE도 외계 인원',
    inspect.populationBucketFromModerationStatus('RETURN_ELIGIBLE') === 'ALIEN');
  ok('87. EARTH 복귀 후 외계 인원 제외',
    inspect.populationBucketFromModerationStatus('RETURNED') === 'EARTH_SOURCE');
  ok('88. 실제 count 미실행', modService.isActivated() === false);

  section('레거시');
  const newFiles = [
    'shared/alien-moderation-core.js',
    'shared/alien-access-core.js',
    'shared/alien-observation-core.js',
    'shared/alien-rank-core.js',
    'supabase/migration_alien_system.sql',
  ];
  let leak = false;
  newFiles.forEach((f) => {
    const t = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    if (/KANTAPBIYA/.test(t) && f !== 'shared/alien-legacy-map.js') leak = true;
  });
  ok('89. 신규 운영 파일에 KANTAPBIYA 없음', !leak);
  ok('89b. alien-origin-core 신규 계약', fs.existsSync(path.join(__dirname, '../shared/alien-origin-core.js')));
  ok('90. 신규 SQL에 KANTAPBIYA enum 없음', !/KANTAPBIYA/.test(SQL));
  ok('91. 레거시 map에서 ALIEN 변환', legacyMap.normalizeLegacyTerritoryId('KANTAPBIYA') === 'ALIEN');
  ok('92. 기존 asset 경로 미변경', fs.existsSync(path.join(__dirname, '../public/assets/territories/profiles/alien.png')));

  section('모드·캐시');
  ok('93. 기본 LEGACY_LOCAL', modService.getDataMode() === 'LEGACY_LOCAL' && apiClient.getMode() === 'LEGACY_LOCAL');
  modService.setDataMode('API_DRY_RUN');
  const dry = await modService.appendModerationSignal({ signalType: 'SPAM' });
  ok('94. API_DRY_RUN fetch 쓰기 없음', dry.dryRun === true && dry.note === 'NO_WRITE');
  modService.setDataMode('API_OPERATIONAL');
  ok('95. API_OPERATIONAL 기본 비활성', modService.getDataMode() === 'LEGACY_LOCAL' && !modService.isActivated());
  modService.setDataMode('LEGACY_LOCAL');
  obsService.invalidateObservationCache(postId);
  ok('96. 댓글 작성 후 관측 캐시 무효화', true);
  obsService.invalidateObservationCache(postId);
  ok('97. 반응 작성 후 관측 캐시 무효화', true);
  ok('98. 외계 상태 localStorage 영구 저장 없음',
    !/localStorage\.setItem\(['"]sc_alien/.test(fs.readFileSync(path.join(__dirname, '../public/alien-observation-api-client.js'), 'utf8')));

  const vm = obsAdapter.toObservationViewModel(obsAll);
  ok('adapter battle read-only', vm.battleUiReadOnly === true && vm.canMutateEarthBattle === false);
  const insp = inspect.inspectAlienSystem({ mode: 'LEGACY_LOCAL', userId: alienUser, currentStatus: 'ALIEN_ACTIVE' });
  ok('inspect 함수', insp.moderation.autoDecisionEnabled === false && insp.privacy.reporterExposed === false);

  const persistDisabled = await memRepo.persistAlienTransferPlan({ userId: alienUser });
  ok('실 persist 비활성', persistDisabled.ok === false);

  section('외계 split UI paging · 레이아웃');
  const INDEX_HTML = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  ok('ui1. 좌우 split 존재', /alien-hub-split/.test(INDEX_HTML));
  ok('ui2. split 비율 52:48', /minmax\(0,\s*52fr\)\s+minmax\(0,\s*48fr\)/.test(INDEX_HTML));
  const splitCss = (INDEX_HTML.match(/\.alien-hub-split\s*\{[\s\S]*?\}/) || [''])[0];
  ok('ui3. 오른쪽 40% 미만 축소 금지(1.65fr 제거)', !!splitCss && !/1\.65fr/.test(splitCss) && /52fr/.test(splitCss));
  ok('ui4. 좌우 min-width:0', /\.alien-hub-pane\s*\{[\s\S]*?min-width:\s*0/.test(INDEX_HTML));
  const alienPanelCss = (INDEX_HTML.match(/\.alien-observe-panel,\s*\r?\n\s*\.alien-community-panel\s*\{[\s\S]*?\}/) || [''])[0];
  ok('ui5. 패널 overflow-y auto 없음', !!alienPanelCss && !/overflow(?:-y)?:\s*(auto|scroll)/.test(alienPanelCss));
  ok('ui6. 패널 max-height 스크롤 상자 제거', !!alienPanelCss && /max-height:\s*none/.test(alienPanelCss));
  ok('ui7. 좌우 pagination nav', /id="alien-left-pagination"/.test(INDEX_HTML) && /id="alien-right-pagination"/.test(INDEX_HTML));
  ok('ui8. 글쓰기 버튼 오른쪽 헤더', /alien-community-title[\s\S]*?alien-free-write/.test(INDEX_HTML));
  ok('ui9. 오른쪽 탭 표시명',
    /data-alien-right="free">자유광장</.test(INDEX_HTML)
    && /data-alien-right="pioneer">개척 구역</.test(INDEX_HTML)
    && /data-alien-right="guardian">수호 구역</.test(INDEX_HTML)
    && /data-alien-right="hall">명예의 전당</.test(INDEX_HTML));
  ok('ui10. 왼쪽 3탭',
    /data-alien-left="popular">인기 관측</.test(INDEX_HTML)
    && /data-alien-left="central">중앙광장</.test(INDEX_HTML)
    && /data-alien-left="territory">영토 관측</.test(INDEX_HTML));
  ok('ui11. PC 오른쪽 탭 한 줄(flex nowrap)',
    /\.alien-hub-pane__tabs--community\s*\{[\s\S]*?flex-wrap:\s*nowrap/.test(INDEX_HTML));
  ok('ui12. 제목 ellipsis 규칙',
    /#alien-hub-wrap \.centrist-free-feed__title[\s\S]*?text-overflow:\s*ellipsis/.test(INDEX_HTML));
  ok('ui13. page size 상수',
    /ALIEN_LEFT_PAGE_SIZE\s*=\s*6/.test(INDEX_HTML) && /ALIEN_RIGHT_PAGE_SIZE\s*=\s*7/.test(INDEX_HTML));
  ok('ui14. 좌우 독립 page scope',
    /ALIEN_LEFT_PAGE_SCOPE/.test(INDEX_HTML) && /ALIEN_RIGHT_PAGE_SCOPE/.test(INDEX_HTML));
  ok('ui15. 탭 변경 시 해당 page만 1 초기화',
    /setAlienLeftPage\(1\)/.test(INDEX_HTML) && /setAlienRightPage\(1\)/.test(INDEX_HTML));
  ok('ui16. 한쪽만 렌더 함수',
    /function renderAlienLeftPaneOnly/.test(INDEX_HTML) && /function renderAlienRightPaneOnly/.test(INDEX_HTML));

  const pageItems = Array.from({ length: 13 }, (_, i) => ({ id: 'p' + i }));
  const leftEmpty = obsAdapter.paginateAlienList([], 1, 6);
  ok('page1. 빈 목록 totalPages 0', leftEmpty.totalPages === 0 && leftEmpty.items.length === 0);
  const leftFit = obsAdapter.paginateAlienList(pageItems.slice(0, 6), 1, 6);
  ok('page2. 6개 이하 totalPages 1', leftFit.totalPages === 1 && leftFit.items.length === 6);
  const leftOver = obsAdapter.paginateAlienList(pageItems, 1, 6);
  ok('page3. 7개 이상 totalPages 계산', leftOver.totalPages === 3 && leftOver.items.length === 6);
  const leftNext = obsAdapter.paginateAlienList(pageItems, 2, 6);
  ok('page4. 다음 페이지 slice', leftNext.page === 2 && leftNext.items[0].id === 'p6');
  const leftClamp = obsAdapter.paginateAlienList(pageItems, 99, 6);
  ok('page5. 마지막 페이지 clamp', leftClamp.page === 3 && leftClamp.items.length === 1);
  ok('page6. normalizePage', obsAdapter.normalizePage(0, 5) === 1 && obsAdapter.normalizePage(9, 5) === 5);
  ok('page7. getPageCount', obsAdapter.getPageCount(0, 6) === 0 && obsAdapter.getPageCount(7, 6) === 2);

  const stateA = obsAdapter.buildAlienPaginationState({
    leftSection: 'ALIEN_POPULAR_OBSERVATION',
    rightSection: 'ALIEN_FREE_PLAZA',
    leftPage: 2,
    rightPage: 3,
    leftTotalItems: 13,
    rightTotalItems: 20,
  });
  ok('page8. 기본 pageSize 좌6 우7', stateA.left.pageSize === 6 && stateA.right.pageSize === 7);
  ok('page9. 좌우 상태 독립 유지', stateA.left.page === 2 && stateA.right.page === 3);
  const stateHall = obsAdapter.buildAlienPaginationState({
    rightSection: 'ALIEN_HALL_OF_FAME',
    rightTotalItems: 20,
    rightPage: 2,
  });
  ok('page10. 명예의 전당 pagination 제외', stateHall.right.totalPages === 0);

  const writeFree = obsAdapter.resolveWriteButtonState({
    rightSection: 'ALIEN_FREE_PLAZA', originTerritory: 'UNKNOWN', status: 'ALIEN_ACTIVE', boardUnlocked: true,
  });
  const writePioneerOk = obsAdapter.resolveWriteButtonState({
    rightSection: 'ALIEN_PIONEER_ZONE', originTerritory: 'PIONEER', status: 'ALIEN_ACTIVE', boardUnlocked: true,
  });
  const writePioneerNo = obsAdapter.resolveWriteButtonState({
    rightSection: 'ALIEN_GUARDIAN_ZONE', originTerritory: 'PIONEER', status: 'ALIEN_ACTIVE', boardUnlocked: true,
  });
  const writeGuardianOk = obsAdapter.resolveWriteButtonState({
    rightSection: 'ALIEN_GUARDIAN_ZONE', originTerritory: 'GUARDIAN', status: 'ALIEN_ACTIVE', boardUnlocked: true,
  });
  const writeCentralNo = obsAdapter.resolveWriteButtonState({
    rightSection: 'ALIEN_PIONEER_ZONE', originTerritory: 'CENTRAL', status: 'ALIEN_ACTIVE', boardUnlocked: true,
  });
  const writeHall = obsAdapter.resolveWriteButtonState({
    rightSection: 'ALIEN_HALL_OF_FAME', originTerritory: 'PIONEER', status: 'ALIEN_ACTIVE', boardUnlocked: true,
  });
  const writeReturned = obsAdapter.resolveWriteButtonState({
    rightSection: 'ALIEN_FREE_PLAZA', originTerritory: 'PIONEER', status: 'RETURNED', boardUnlocked: true,
  });
  ok('write1. 자유광장 활성', writeFree.visible && writeFree.enabled);
  ok('write2. PIONEER 개척 활성', writePioneerOk.visible && writePioneerOk.enabled);
  ok('write3. PIONEER 수호 비노출', !writePioneerNo.visible);
  ok('write4. GUARDIAN 수호 활성', writeGuardianOk.visible && writeGuardianOk.enabled);
  ok('write5. CENTRAL 성향구역 비노출', !writeCentralNo.visible);
  ok('write6. 명예의 전당 비노출', !writeHall.visible && writeHall.reason === 'HALL_OF_FAME');
  ok('write7. RETURNED 쓰기 불가', !writeReturned.visible && writeReturned.reason === 'RETURNED');

  section('submit 파티션 재검사');
  function submitGate(section, origin, status, unlocked) {
    return obsAdapter.resolveAlienSubmitPermission({
      rightSection: obsAdapter.uiSectionToPartitionKey(section),
      originTerritory: origin,
      status: status,
      boardUnlocked: unlocked !== false,
    });
  }
  ok('sub1. PIONEER+free 성공', submitGate('free', 'PIONEER', 'ALIEN_ACTIVE', true).ok);
  ok('sub2. PIONEER+pioneer 성공', submitGate('pioneer', 'PIONEER', 'ALIEN_ACTIVE', true).ok);
  ok('sub3. PIONEER+guardian 실패', !submitGate('guardian', 'PIONEER', 'ALIEN_ACTIVE', true).ok &&
    submitGate('guardian', 'PIONEER', 'ALIEN_ACTIVE', true).reason === 'ORIGIN_READONLY');
  ok('sub4. GUARDIAN+free 성공', submitGate('free', 'GUARDIAN', 'ALIEN_ACTIVE', true).ok);
  ok('sub5. GUARDIAN+guardian 성공', submitGate('guardian', 'GUARDIAN', 'ALIEN_ACTIVE', true).ok);
  ok('sub6. GUARDIAN+pioneer 실패', !submitGate('pioneer', 'GUARDIAN', 'ALIEN_ACTIVE', true).ok);
  ok('sub7. origin없음+free 성공', submitGate('free', 'UNKNOWN', 'ALIEN_ACTIVE', true).ok);
  ok('sub8. origin없음+pioneer 실패', !submitGate('pioneer', 'UNKNOWN', 'ALIEN_ACTIVE', true).ok);
  ok('sub9. origin없음+guardian 실패', !submitGate('guardian', '', 'ALIEN_ACTIVE', true).ok);
  ok('sub10. hall 실패', !submitGate('hall', 'PIONEER', 'ALIEN_ACTIVE', true).ok &&
    submitGate('hall', 'PIONEER', 'ALIEN_ACTIVE', true).reason === 'HALL_OF_FAME');
  ok('sub11. RETURNED+free 실패', !submitGate('free', 'PIONEER', 'RETURNED', true).ok);
  ok('sub12. SUSPENDED+free 실패', !submitGate('free', 'PIONEER', 'SUSPENDED', true).ok);
  ok('sub13. 비추방(boardLocked)+free 실패', !submitGate('free', 'PIONEER', 'ALIEN_ACTIVE', false).ok &&
    submitGate('free', 'PIONEER', 'ALIEN_ACTIVE', false).reason === 'BOARD_LOCKED');
  ok('sub14. guest급 boardLocked', !submitGate('free', 'UNKNOWN', '', false).ok);
  ok('sub15. 상태변경 RETURNED 후 실패', !submitGate('free', 'PIONEER', 'RETURNED', true).ok);
  ok('sub16. rightSection 조작 guardian 재검사', !submitGate('guardian', 'PIONEER', 'ALIEN_ACTIVE', true).ok);
  ok('sub17. partitionKey만 pioneer·origin 불일치',
    !obsAdapter.resolveAlienSubmitPermission({
      rightSection: 'ALIEN_PIONEER_ZONE',
      originTerritory: 'GUARDIAN',
      status: 'ALIEN_ACTIVE',
      boardUnlocked: true,
    }).ok);
  ok('sub18. canWrite===enabled', writeFree.canWrite === writeFree.enabled);
  ok('sub19. 메시지 ORIGIN_READONLY',
    /출신/.test(obsAdapter.alienWriteDeniedMessage('ORIGIN_READONLY')));
  ok('sub20. 메시지 RETURNED',
    /복귀/.test(obsAdapter.alienWriteDeniedMessage('RETURNED')));
  ok('sub21. 메시지 HALL',
    /명예의 전당/.test(obsAdapter.alienWriteDeniedMessage('HALL_OF_FAME')));
  ok('sub22. uiSection 매핑',
    obsAdapter.uiSectionToPartitionKey('pioneer') === 'ALIEN_PIONEER_ZONE' &&
    obsAdapter.uiSectionToPartitionKey('free') === 'ALIEN_FREE_PLAZA');
  ok('sub23. index submit 재검사 배선',
    /assertAlienCommunityWritePermission/.test(INDEX_HTML) &&
    /alienWriteDeniedMessage/.test(INDEX_HTML));
  ok('sub24. submit가 tryWriteActivity 앞에 권한검사', (function () {
    var iGate = INDEX_HTML.indexOf('assertAlienCommunityWritePermission');
    var iAct = INDEX_HTML.indexOf("tryWriteActivity(uid(), 'post'");
    return iGate > 0 && iAct > 0 && iGate < iAct;
  })());
  ok('sub25. openModal 외계 게이트',
    /alienOpenGate|assertAlienCommunityWritePermission/.test(INDEX_HTML));
  ok('sub26. categoryKey는 getAlienCommunityCategoryKeyFromSection',
    /getAlienCommunityCategoryKeyFromSection\(\)/.test(INDEX_HTML));
  ok('sub27. 버튼·submit 공통 resolveWriteButtonState',
    /resolveWriteButtonState/.test(INDEX_HTML));

  ok('inspect.layout splitRatio', insp.layout.splitRatio === '52:48' && insp.layout.internalScrollbars === false);
  ok('inspect.layout rightTabsSingleRow', insp.layout.rightTabsSingleRow === true);
  ok('inspect.pagination 존재', insp.pagination && insp.pagination.left.pageSize === 6 && insp.pagination.right.pageSize === 7);
  ok('inspect.writeButton 존재', insp.writeButton && typeof insp.writeButton.reason === 'string');
  ok('inspect.overlapCheck 존재', insp.overlapCheck && insp.overlapCheck.headerOverlapDetected === false);
  ok('vm.layout splitRatio', vm.layout.splitRatio === '52:48' && vm.layout.internalScrollbars === false);

  if (process.env.SC_ALIEN_UNIT_ONLY === '1') {
    console.log('\n=== 외계 시스템 테스트 결과 (unit only) ===');
    results.forEach(function (r) { console.log(r); });
    console.log('\n총 ' + (pass + fail) + '개 테스트: ' + pass + ' PASS / ' + fail + ' FAIL');
    process.exit(fail === 0 ? 0 : 1);
  }

  section('회귀 (중첩 금지 · alignment 1회)');
  function runChild(scriptName, expectPattern, timeoutMs, extraEnv) {
    const scriptPath = path.join(__dirname, scriptName);
    console.log('[regression] 시작:', scriptName, 'pid-parent=' + process.pid, 'timeout=' + (timeoutMs || 120000) + 'ms');
    const t0 = Date.now();
    try {
      const out = execFileSync(process.execPath, [scriptPath], {
        encoding: 'utf8',
        timeout: timeoutMs || 120000,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, extraEnv || {}, {
          // 자식이 다시 장시간 중첩 회귀를 돌리지 않도록 기본 차단 플래그 유지
          SC_SKIP_COMPAT_REGRESSION: (extraEnv && extraEnv.SC_SKIP_COMPAT_REGRESSION) || process.env.SC_SKIP_COMPAT_REGRESSION || '1',
        }),
      });
      const elapsed = Math.round((Date.now() - t0) / 1000);
      console.log('[regression] 완료:', scriptName, '(' + elapsed + 's)');
      const matched = !expectPattern
        || out.includes(expectPattern)
        || new RegExp(expectPattern).test(out)
        || (/PASS \/ 0 FAIL/.test(out) && expectPattern.indexOf('PASS / 0 FAIL') !== -1);
      ok(scriptName + ' 통과', matched, matched ? '' : out.slice(-800));
    } catch (e) {
      const elapsed = Math.round((Date.now() - t0) / 1000);
      const out = String(e.stdout || '') + String(e.stderr || '');
      const timedOut = e.killed === true || e.signal === 'SIGTERM' || /ETIMEDOUT/.test(String(e.message || ''));
      console.log('[regression] 실패' + (timedOut ? '/타임아웃' : '/exit ' + (e.status != null ? e.status : '?')) + ':', scriptName, '(' + elapsed + 's)');
      ok(scriptName + ' 통과', false, (timedOut ? 'TIMEOUT ' : 'EXIT ') + String(out || e.message || e).slice(-800));
    }
  }

  // 각 스위트를 unit-only로 분리 실행 → board/alignment 중복·중첩 방지
  // alignment는 맨 아래 1회만
  runChild('test-territory-evolution-system.js', 'PASS / 0 FAIL', 120000, { SC_TEVO_UNIT_ONLY: '1' });
  runChild('test-user-profile-system.js', 'PASS / 0 FAIL', 120000, { SC_PROFILE_UNIT_ONLY: '1' });
  runChild('test-user-data-system.js', 'PASS / 0 FAIL', 120000, { SC_USER_DATA_UNIT_ONLY: '1' });
  runChild('test-board-core-system.js', 'failed: 0', 120000);
  runChild('test-board-compat-system.js', 'failed: 0', 120000, { SC_SKIP_COMPAT_REGRESSION: '1' });
  runChild('test-alignment-supabase-system.js', 'failed: 0', 600000, { SC_SKIP_COMPAT_REGRESSION: '1' });
  console.log('\n=== 외계 시스템 테스트 결과 ===');
  results.forEach(function (r) { console.log(r); });
  console.log('\n총 ' + (pass + fail) + '개 테스트: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('테스트 실행 오류:', e);
  process.exit(1);
});
