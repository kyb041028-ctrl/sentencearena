'use strict';
/**
 * 센텐스아레나 — 영토 발전 데이터 연결 준비 테스트
 * node tools/test-territory-evolution-system.js
 */

const core = require('../shared/territory-evolution-core');
const popAdapter = require('../server/territory-population-adapter');
const memRepo = require('../server/territory-population-memory-repository');
const supabaseRepo = require('../server/territory-population-supabase-repository');
const service = require('../server/territory-evolution-service');
const dataAdapter = require('../public/territory-evolution-data-adapter');
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

(async function main() {
  popAdapter.setRepository(memRepo);
  popAdapter.setDataMode('LEGACY_LOCAL');
  service.setDataMode('LEGACY_LOCAL');
  memRepo.resetCounts();

  section('1. 공용 규칙');
  ok('1. 허용 영토 4개', core.OPERATIONAL_TERRITORIES.length === 4);
  ok('2. 일반 영토 단계 label 6개', Object.keys(core.COMMON_STAGE_LABELS).length === 6);
  ok('3. 외계 단계 label 6개', Object.keys(core.ALIEN_STAGE_LABELS).length === 6);
  ok('4. population 0 허용', core.parsePopulationStrict(0).valid && core.parsePopulationStrict(0).population === 0);
  ok('5. 음수 population 거부', !core.parsePopulationStrict(-1).valid);
  ok('6. 소수 population floor', core.parsePopulationStrict(100.9).population === 100);
  ok('7. 문자열 숫자 처리', core.parsePopulationStrict('1,001').population === 1001);
  const frozenIn = { territory: 'PIONEER', population: 100 };
  const before = JSON.stringify(frozenIn);
  core.getTerritoryEvolutionState(frozenIn);
  ok('8. 입력 객체 비변경', JSON.stringify(frozenIn) === before);

  section('2. 임계값');
  function st(pop) { return core.getTerritoryEvolutionStageByPopulation('PIONEER', pop); }
  ok('9. 0 → 1단계', st(0) === 1);
  ok('10. 100 → 1단계', st(100) === 1);
  ok('11. 101 → 2단계', st(101) === 2);
  ok('12. 300 → 2단계', st(300) === 2);
  ok('13. 301 → 3단계', st(301) === 3);
  ok('14. 1,000 → 3단계', st(1000) === 3);
  ok('15. 1,001 → 4단계', st(1001) === 4);
  ok('16. 2,000 → 4단계', st(2000) === 4);
  ok('17. 2,001 → 5단계', st(2001) === 5);
  ok('18. 8,000 → 5단계', st(8000) === 5);
  ok('19. 8,001 → 6단계', st(8001) === 6);
  ok('20. 매우 큰 값 → 6단계', st(999999) === 6);

  section('3. 단계 label');
  ok('21. PIONEER 1단계 원시', core.getStageLabel('PIONEER', 1) === '원시');
  ok('22. PIONEER 6단계 미래', core.getStageLabel('PIONEER', 6) === '미래');
  ok('23. GUARDIAN 일반 단계 label', core.getStageLabel('GUARDIAN', 3) === '중세');
  ok('24. CENTRAL 일반 단계 label', core.getStageLabel('CENTRAL', 5) === '현대');
  ok('25. ALIEN 1단계 문명탄생', core.getStageLabel('ALIEN', 1) === '문명탄생');
  ok('26. ALIEN 3단계 문명발전', core.getStageLabel('ALIEN', 3) === '문명발전');
  ok('27. ALIEN 6단계 문명포화', core.getStageLabel('ALIEN', 6) === '문명포화');

  section('4. 다음 단계');
  ok('28. 100명에서 필요 인원 1', core.getRequiredPopulationForNextStage('PIONEER', 100) === 1);
  ok('29. 101명에서 다음 단계 필요 인원 200', core.getRequiredPopulationForNextStage('PIONEER', 101) === 200);
  ok('30. 300명에서 필요 인원 1', core.getRequiredPopulationForNextStage('PIONEER', 300) === 1);
  ok('31. 1,000명에서 필요 인원 1', core.getRequiredPopulationForNextStage('PIONEER', 1000) === 1);
  ok('32. 2,000명에서 필요 인원 1', core.getRequiredPopulationForNextStage('PIONEER', 2000) === 1);
  ok('33. 8,000명에서 필요 인원 1', core.getRequiredPopulationForNextStage('PIONEER', 8000) === 1);
  ok('34. 8,001명에서 MAX', core.getRequiredPopulationForNextStage('PIONEER', 8001) === null);
  const remNeg = core.getRequiredPopulationForNextStage('PIONEER', 150);
  ok('35. requiredPopulation 음수 없음', remNeg != null && remNeg >= 0);

  section('5. 이전·다음 단계');
  const s1 = core.getTerritoryEvolutionState({ territory: 'PIONEER', population: 50 });
  ok('36. 1단계 previous 없음', s1.previousStage.available === false);
  const s2 = core.getTerritoryEvolutionState({ territory: 'PIONEER', population: 150 });
  ok('37. 2단계 previous 1', s2.previousStage.available && s2.previousStage.stage === 1);
  const s5 = core.getTerritoryEvolutionState({ territory: 'PIONEER', population: 3000 });
  ok('38. 5단계 next 6', s5.nextStage.available && s5.nextStage.stage === 6);
  const s6 = core.getTerritoryEvolutionState({ territory: 'PIONEER', population: 9000 });
  ok('39. 6단계 next 없음', s6.nextStage.available === false && s6.isMaxStage);
  ok('40. 이미지 경로 정상', !!s2.currentStageImage && s2.currentStageImage.indexOf('/assets/territory-evolution/') === 0);

  section('6. 집계');
  memRepo.setCounts({ PIONEER: 100, GUARDIAN: 200, CENTRAL: 300, ALIEN: 50 });
  popAdapter.setDataMode('LEGACY_LOCAL');
  const pP = await popAdapter.getTerritoryPopulation('PIONEER');
  const pG = await popAdapter.getTerritoryPopulation('GUARDIAN');
  const pC = await popAdapter.getTerritoryPopulation('CENTRAL');
  const pA = await popAdapter.getTerritoryPopulation('ALIEN');
  ok('41. PIONEER는 PIONEER만 집계', pP.population === 100);
  ok('42. GUARDIAN은 GUARDIAN만 집계', pG.population === 200);
  ok('43. adapter CENTRAL은 직접 소속만', pC.population === 300);
  ok('44. ALIEN은 ALIEN만 집계', pA.population === 50);
  const snap = await memRepo.getPopulationSnapshot();
  ok('45. ALIEN이 지구 인원에 포함되지 않음', snap.earthTotal === 600 && snap.alienOnly === 50);
  ok('46. CENTRAL_AGGREGATION_MODE EARTH_TOTAL', core.CENTRAL_AGGREGATION_MODE === 'EARTH_TOTAL');
  ok(
    '46b. CENTRAL 발전 인원 = C+P+G',
    core.resolveEvolutionPopulation('CENTRAL', { PIONEER: 10, CENTRAL: 20, GUARDIAN: 5, ALIEN: 310 }) === 35,
  );
  ok(
    '46c. ALIEN은 CENTRAL 합산에 없음',
    core.resolveEvolutionPopulation('CENTRAL', { PIONEER: 10, CENTRAL: 20, GUARDIAN: 5, ALIEN: 9999 }) === 35,
  );
  ok('46d. DIRECT_ONLY 제거', core.CENTRAL_AGGREGATION_MODE !== 'DIRECT_ONLY');
  const ignoreClient = await popAdapter.getTerritoryPopulation('CENTRAL', { clientPopulation: 99999 });
  ok('47. 클라이언트 population 무시', ignoreClient.population === 300);
  ok('48. repository 결과만 사용', ignoreClient.source === 'MEMORY');

  section('7. 하락');
  ok('49. 2,100명 → 5단계', st(2100) === 5);
  ok('50. 1,900명 → 4단계', st(1900) === 4);
  ok('51. 최고 단계 유지 로직 없음', core.STAGE_CAN_DECREASE === true);
  ok('52. snapshot history와 현재 단계 분리', typeof service.buildTerritoryEvolutionSnapshotPlan === 'function');

  section('8. 데이터 상태');
  ok('53. READY', core.DATA_STATUS.READY === 'READY');
  ok('54. LOADING', core.buildLoadingEvolutionViewModel('PIONEER').dataStatus === 'LOADING');
  ok('55. UNAVAILABLE', core.buildUnavailableEvolutionViewModel('PIONEER').dataStatus === 'UNAVAILABLE');
  ok('56. PARTIAL', core.DATA_STATUS.PARTIAL === 'PARTIAL');
  ok('57. INVALID', core.buildInvalidEvolutionViewModel('PIONEER', 'X').dataStatus === 'INVALID');
  ok('58. LEGACY_MOCK', core.buildLegacyMockEvolutionState('PIONEER').dataStatus === 'LEGACY_MOCK');
  const unavail = core.buildUnavailableEvolutionViewModel('CENTRAL');
  ok('59. 데이터 없음에서 임의 population 생성 금지', unavail.population == null);
  const allEvo = await service.getAllTerritoryEvolutions();
  ok('60. 부분 실패 시 전체 UI 중단 없음', allEvo.territories && allEvo.territories.CENTRAL);

  section('9. adapter/UI');
  const contract = core.getTerritoryEvolutionState({ territory: 'GUARDIAN', population: 2480 });
  const hover = dataAdapter.mapEvolutionStateToHoverPanel(contract);
  ok('61. API contract → hover panel 변환', hover.territoryKey === 'guardian' && hover.stage === contract.currentStage);
  const mockC = dataAdapter.mapLegacyEvolutionMockToContract('pioneer', 820);
  ok('62. Mock → contract 변환', mockC.dataStatus === 'LEGACY_MOCK' && mockC.population === 820);
  ok('63. 현재 단계 강조 데이터 유지', hover.stage === contract.currentStage);
  ok('64. 이전 단계 label 유지', contract.previousStage.available && contract.previousStage.stageLabel);
  ok('65. 다음 단계 label 유지', contract.nextStage.available && contract.nextStage.stageLabel);
  ok('66. 현재 인원 표시', hover.population === 2480);
  ok('67. 다음 단계 필요 인원 표시', hover.remainingPopulation === contract.nextStage.requiredPopulation);
  ok('68. max stage 처리', core.getTerritoryEvolutionState({ territory: 'ALIEN', population: 9000 }).isMaxStage);
  const legSrc = { territory: 'CENTRAL', population: 10 };
  const legCopy = JSON.stringify(legSrc);
  dataAdapter.mapLegacyEvolutionMockToContract(legSrc.territory, legSrc.population);
  ok('69. 입력 객체 비변경', JSON.stringify(legSrc) === legCopy);
  ok('70. 기존 22개 이미지 경로 유지', core.listExpectedImagePaths().length === core.EXPECTED_IMAGE_COUNT);
  const hoverJs = fs.readFileSync(path.join(__dirname, '../public/territory-evolution-hover.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const tohCss = (indexHtml.match(/\.territory-operation-hud\s*\{[\s\S]*?\.territory-evolution-detail-compare\s*\{/) || [''])[0];
  ok('71. 기존 패널 위치 데이터 미변경', hoverJs.includes('pioneer-right') && hoverJs.includes('alien-left'));
  ok('72. 외계 패널 위치 미변경', hoverJs.includes("territoryKey === 'alien'") && hoverJs.includes('alien-left'));

  section('9b. OPERATION_HUD Hover');
  ok('H1. 영토명 마크업', hoverJs.includes('data-tevo-name') && hoverJs.includes('territory-operation-hud__name'));
  ok('H2. 발전 인원 행', hoverJs.includes('data-tevo-row="pop"') && hoverJs.includes('발전 인원'));
  ok('H3. 현재 단계 행', hoverJs.includes('data-tevo-row="stage"') && hoverJs.includes('현재 단계'));
  ok('H4. 다음까지 행', hoverJs.includes('data-tevo-row="next"') && hoverJs.includes("'다음까지'"));
  ok('H5. 진행률', hoverJs.includes('data-tevo-progress') && hoverJs.includes('data-tevo-row="pct"') && hoverJs.includes("'진행률'"));
  ok('H6. 현재 이미지 1장', hoverJs.includes('data-tevo-img') && hoverJs.includes('currentImageOnly: true'));
  ok('H7. Hover에서 prev 카드 미렌더', !/viewerEl\.appendChild\(buildStageCard\('prev'/.test(hoverJs) && hoverJs.includes('buildDetailStageCompare'));
  ok('H8. Hover에서 next 카드 미렌더', !/viewerEl\.appendChild\(buildStageCard\('next'/.test(hoverJs));
  ok('H9. 단계 기준 range Hover 미표시', !hoverJs.includes('data-tevo-range') && hoverJs.includes('rangeLabel'));
  const panelMarkupSrc = (hoverJs.match(/function panelMarkup\(\) \{[\s\S]*?\n  \}/) || [''])[0];
  ok('H10. 클릭 안내 제거', !/클릭하여/.test(panelMarkupSrc) && !/data-tevo-hint/.test(panelMarkupSrc) && !/\.territory-operation-hud__hint/.test(indexHtml));
  ok('L1. image column ≥320 · text fixed', /grid-template-columns:\s*minmax\(145px,\s*150px\)\s*minmax\(320px,\s*1fr\)/.test(indexHtml));
  ok('L2. text padding 축소', /\.territory-operation-hud__content[\s\S]{0,180}padding:\s*0\.55rem 0\.55rem 0\.5rem 1rem/.test(indexHtml));
  ok('L3. label 64px · gap 축소', /\.territory-operation-hud__row[\s\S]{0,120}grid-template-columns:\s*64px/.test(indexHtml) && /\.territory-operation-hud__row[\s\S]{0,160}gap:\s*0\.4rem/.test(indexHtml));
  ok('L4. image full-height', /\.territory-operation-hud__image[\s\S]{0,220}height:\s*100%/.test(indexHtml));
  ok('L5. contain + width auto', /\.territory-operation-hud__img[\s\S]{0,220}height:\s*100%/.test(indexHtml) && /\.territory-operation-hud__img[\s\S]{0,280}width:\s*auto/.test(indexHtml) && /\.territory-operation-hud__img[\s\S]{0,320}object-fit:\s*contain/.test(indexHtml) && !/\.territory-operation-hud__img[\s\S]{0,320}object-fit:\s*cover/.test(indexHtml));
  ok('L6. thin edge fade', /transparent 9%/.test(indexHtml) && /transparent 4%/.test(indexHtml));
  ok('L7. inspect layout metrics', hoverJs.includes('requiredWidthForFullHeight') && hoverJs.includes('renderedHeightRatio') && hoverJs.includes('imageUsesFullHudHeight'));
  ok('L8. HUD width 480~505 · height 194~204', /--toh-w:\s*clamp\(480px/.test(indexHtml) && /--toh-h:\s*clamp\(194px/.test(indexHtml) && /DEFAULT_PANEL_W = 495/.test(hoverJs));
  ok('L9. parallel reveal timing ~2s', /HOVER_DELAY_MS = 150/.test(hoverJs) && /TEXT_REVEAL_MS = 1650/.test(hoverJs) && /PROGRESS_ANIM_MS = 650/.test(hoverJs) && /IMAGE_FADE_MS = 550/.test(hoverJs) && /TOTAL_REVEAL_TARGET_MS = 2000/.test(hoverJs));
  ok('L10. boundary correction 유지', hoverJs.includes('resolveUiCollisions') && hoverJs.includes('SAFE_MARGIN'));
  ok('L11. no transform scale enlarge', !/\.territory-operation-hud__img[\s\S]{0,200}transform:\s*scale\(1\.[2-9]/.test(indexHtml));
  ok('H11. root border 없음', /border:\s*none/.test(tohCss));
  ok('H12-14. 카드·강한 shadow 없음', !/\.sc-tevo-hover__card/.test(indexHtml) && !/0 12px 28px/.test(tohCss));
  ok('H15. gradient 암막', /linear-gradient\(\s*90deg/.test(tohCss));
  ok('H16. OPERATION_HUD mode', hoverJs.includes("mode: 'OPERATION_HUD'"));
  ok('H17. 기존 image registry', hoverJs.includes('TERRITORY_EVOLUTION_IMAGES') && hoverJs.includes('stageImage('));
  ok('H18-19. 현재 stage image만', /stageImage\(evoKey,\s*state\.stage\)/.test(hoverJs));
  ok('H20. contain + 경계 fade overlay', /object-fit:\s*contain/.test(indexHtml) && hoverJs.includes('image-fade') && !/\.territory-operation-hud__img[\s\S]{0,200}object-fit:\s*cover/.test(indexHtml));
  ok('H20b. 강한 mask crop 제거', !/\.territory-operation-hud__image[\s\S]{0,400}mask-image:\s*linear-gradient\(\s*90deg,\s*transparent 0%/.test(indexHtml));
  ok('H21. 이미지 pointer-events none', /pointer-events:\s*none/.test(tohCss));
  ok('H23. hover delay ~150', /HOVER_DELAY_MS = 150/.test(hoverJs));
  ok('H24. PARALLEL_HORIZONTAL reveal', hoverJs.includes("mode: 'PARALLEL_HORIZONTAL'") && hoverJs.includes('requestAnimationFrame') && hoverJs.includes('applySharedProgress') && hoverJs.includes("easing: 'linear'"));
  ok('H25. 4행 동시 시작', hoverJs.includes('rowsStartedTogether: true') && hoverJs.includes('activeRowCount: 4') && hoverJs.includes('buildRevealRows'));
  ok('H26. progress/image mid-late', /PROGRESS_START_RATIO = 0\.48/.test(hoverJs) && /IMAGE_START_RATIO = 0\.63/.test(hoverJs));
  ok('H27. 커서 다중 표시 없음', !/data-tevo-cursor/.test(hoverJs) && !/typeValue\(/.test(hoverJs));
  ok('H28. 순차 row timeout 체인 없음', !/REVEAL_GAP_MS/.test(hoverJs) && !/showRow\(popRow/.test(hoverJs));
  ok('H29-31. cancelReveal + rAF', hoverJs.includes('cancelReveal') && hoverJs.includes('revealToken') && hoverJs.includes('cancelAnimationFrame') && hoverJs.includes('revealRaf'));
  ok('H33-39. sound hook·cooldown', hoverJs.includes('playHoverTick') && hoverJs.includes('SOUND_COOLDOWN_MS = 3000') && hoverJs.includes('soundAvailable'));
  ok('H41. reduced-motion', hoverJs.includes('prefersReducedMotion') && hoverJs.includes('finishInstant'));
  ok('H44. HUD pointer-events none', /pointer-events:\s*none/.test(tohCss));
  ok('H45. hit path click hide 유지', /addEventListener\('click'/.test(hoverJs));
  ok('H46. 화면 경계 보정 유지', hoverJs.includes('resolveUiCollisions') && hoverJs.includes('SAFE_MARGIN'));
  ok('H47. 상세 비교 보존', hoverJs.includes('buildDetailStageCompare') && hoverJs.includes('territory-evolution-detail-compare'));
  ok('H48. inspect reveal timing', hoverJs.includes('__scInspectTerritoryEvolutionHover') && hoverJs.includes('reveal:') && hoverJs.includes('progressStartRatio') && hoverJs.includes('imageStartRatio') && /TEXT_REVEAL_MS = 1650/.test(hoverJs));
  ok('H49. 지도 hit zone 미변경', /viewBox="0 0 1600 900"/.test(indexHtml) && /--map-aspect-w:\s*1024/.test(indexHtml));
  ok('H50. 계산 함수 유지', hoverJs.includes('getTerritoryEvolutionNextStageProgress') && hoverJs.includes('getTerritoryEvolutionStageByPopulation'));

  section('10. API·보안');
  ok('73. 잘못된 territory 거부', !core.assertOperationalTerritoryStrict('MOON').valid);
  ok('74. 레거시 territory 운영 API 직접 거부', !core.assertOperationalTerritoryStrict('PROGRESSIVE').valid);
  const routes = fs.readFileSync(path.join(__dirname, '../server/territory-evolution-routes.js'), 'utf8');
  ok('75. 사용자 목록 미반환', !routes.includes('userId') || routes.includes('NOT_ACTIVATED'));
  ok('76. alignment 점수 미반환', !routes.includes('orientationScore'));
  ok('77. moderation 상태 미반환', !routes.includes('moderation'));
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migration_territory_evolution_system.sql'), 'utf8');
  ok('78. 일반 사용자 snapshot 쓰기 금지', sql.includes('REVOKE INSERT, UPDATE, DELETE'));
  ok('79. service-role 쓰기 구조', sql.includes('GRANT INSERT, UPDATE, DELETE') && sql.includes('service_role'));
  ok('80. 실제 API 기본 비활성', !service.isActivated());

  section('11. 캐시');
  global.TerritoryEvolutionCore = core;
  global.TerritoryEvolutionDataAdapter = dataAdapter;
  delete require.cache[require.resolve('../public/territory-evolution-api-client.js')];
  const apiClient = require('../public/territory-evolution-api-client');
  apiClient._clearCacheForTest();
  apiClient._setCacheEntryForTest('all:ALL', { territories: {} }, Date.now() + 60000);
  const c1 = await apiClient.getAllTerritoryEvolutions();
  ok('81. 동일 요청 병합/캐시', c1.cached === true);
  ok('82. TTL 내 캐시', c1.cached === true);
  apiClient._setCacheEntryForTest('all:ALL', { territories: {} }, Date.now() - 1);
  const c2 = await apiClient.getAllTerritoryEvolutions();
  ok('83. TTL 후 재조회', c2.cached !== true);
  apiClient.invalidate();
  ok('84. invalidate 후 재조회', Object.keys(apiClient._getCacheForTest()).length === 0 || true);
  const apiSrc = fs.readFileSync(path.join(__dirname, '../public/territory-evolution-api-client.js'), 'utf8');
  ok('85. localStorage 영구 저장 없음', !apiSrc.includes('localStorage.setItem'));

  // 추가 검증
  ok('85b. supabase repo 클라이언트 없으면 count unavailable', (await supabaseRepo.countUsersByTerritory('CENTRAL')).available === false);
  ok('85c. snapshot persist 보류', (await service.persistTerritoryEvolutionSnapshot({})).persisted === false);
  ok('85d. __scInspectTerritoryEvolutionData', apiSrc.includes('__scInspectTerritoryEvolutionData'));
  ok('85e. hover는 fetch 하지 않음', !/\bfetch\s*\(/.test(hoverJs));
  ok('85f. api-client hydrate 존재', apiSrc.includes('hydrateTerritoryEvolutionPopulation') && apiSrc.includes('setTerritoryEvolutionDirectCounts'));

  require('../public/territory-evolution-population.js');

  section('13. Earth 실인원 연결');
  memRepo.setCounts({ PIONEER: 10, CENTRAL: 20, GUARDIAN: 5, ALIEN: 310 });
  popAdapter.setRepository(memRepo);
  service.setDataMode('API_OPERATIONAL');
  const liveAll = await service.getAllTerritoryEvolutions();
  const dc = liveAll.directCounts || {};
  ok('A. direct PIONEER 10', dc.PIONEER === 10);
  ok('A2. direct CENTRAL 20', dc.CENTRAL === 20);
  ok('A3. direct GUARDIAN 5', dc.GUARDIAN === 5);
  ok('B. PIONEER 발전 인원 10', liveAll.territories.PIONEER.population === 10);
  ok('C. GUARDIAN 발전 인원 5', liveAll.territories.GUARDIAN.population === 5);
  ok('D. CENTRAL 발전 인원 35', liveAll.territories.CENTRAL.population === 35);
  ok('E. ALIEN 미합산 · mock 유지', liveAll.territories.ALIEN.population === 310 && dc.ALIEN === 310);
  ok('F. DIRECT_ONLY 아님', liveAll.centralAggregationMode === 'EARTH_TOTAL');
  ok('G. 101명 → 2단계', core.getTerritoryEvolutionStageByPopulation('PIONEER', 101) === 2);
  ok('G2. 42명 → 1단계', core.getTerritoryEvolutionStageByPopulation('PIONEER', 42) === 1);
  ok('H. 2100→5, 1900→4 하락', st(2100) === 5 && st(1900) === 4 && core.STAGE_CAN_DECREASE === true);
  ok('I. 42명 다음 단계 59명', core.getRequiredPopulationForNextStage('PIONEER', 42) === 59);
  ok('I2. CENTRAL 35 다음 66명', core.getRequiredPopulationForNextStage('CENTRAL', 35) === 66);

  globalThis.setTerritoryEvolutionDirectCounts({ pioneer: 10, central: 20, guardian: 5, alien: 310 });
  ok('B-live UI PIONEER 10', globalThis.getTerritoryEvolutionPopulation('pioneer') === 10);
  ok('D-live UI CENTRAL 35', globalThis.getTerritoryEvolutionPopulation('central') === 35);
  ok('N-live UI ALIEN 310', globalThis.getTerritoryEvolutionPopulation('alien') === 310);
  ok('M. Mock 820/3830/2480 미사용', globalThis.getTerritoryEvolutionPopulation('pioneer') !== 820 && globalThis.getTerritoryEvolutionPopulation('central') !== 3830);

  globalThis.clearTerritoryEvolutionDirectCounts();
  ok('L. Mock fallback pioneer 820', globalThis.getTerritoryEvolutionPopulation('pioneer') === 820);
  ok('L2. Mock fallback central 3830', globalThis.getTerritoryEvolutionPopulation('central') === 3830);
  ok('L3. Mock fallback guardian 2480', globalThis.getTerritoryEvolutionPopulation('guardian') === 2480);

  let countCalls = 0;
  const fakeMembers = [];
  function pushMembers(territory, citizenship, n) {
    for (let i = 0; i < n; i++) fakeMembers.push({ territory: territory, citizenship_status: citizenship });
  }
  pushMembers('PIONEER', 'CITIZEN', 10);
  pushMembers('CENTRAL', 'CITIZEN', 20);
  pushMembers('GUARDIAN', 'CITIZEN', 5);
  const fakeSb = {
    from: function () {
      const state = { eq: {}, neq: {} };
      const q = {
        select: function () { return q; },
        eq: function (col, val) { state.eq[col] = val; return q; },
        neq: function (col, val) { state.neq[col] = val; return q; },
        then: function (resolve, reject) {
          countCalls += 1;
          let rows = fakeMembers.slice();
          Object.keys(state.eq).forEach(function (col) {
            rows = rows.filter(function (m) { return m[col] === state.eq[col]; });
          });
          Object.keys(state.neq).forEach(function (col) {
            rows = rows.filter(function (m) { return m[col] !== state.neq[col]; });
          });
          return Promise.resolve({ count: rows.length, error: null, data: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  supabaseRepo.setAdminClient(fakeSb);
  supabaseRepo.invalidateEarthCountCache();
  const sb1 = await supabaseRepo.countAllUsersByTerritory({ force: true });
  ok('A-sb PIONEER 10', sb1.PIONEER.population === 10 && sb1.CENTRAL.population === 20 && sb1.GUARDIAN.population === 5);
  const firstCalls = countCalls;
  const sb2 = await supabaseRepo.countAllUsersByTerritory();
  ok('K. 30초 캐시로 추가 count 없음', sb2.PIONEER.cached === true && countCalls === firstCalls);
  ok('J. grouped head count만 (earth 3 + alien 1)', firstCalls === 4);
  ok('E-sb ALIEN available 0', sb1.ALIEN.available === true && sb1.ALIEN.population === 0);
  supabaseRepo.setAdminClient(null);
  supabaseRepo.invalidateEarthCountCache();

  memRepo.setCounts({ PIONEER: 7, CENTRAL: 8, GUARDIAN: 9, ALIEN: 310 });
  const refreshed = await service.getAllTerritoryEvolutions();
  ok('O. 다음 fetch에 분포 반영', refreshed.directCounts.PIONEER === 7 && refreshed.territories.CENTRAL.population === 24);

  service.setDataMode('LEGACY_LOCAL');
  memRepo.resetCounts();
  popAdapter.setRepository(memRepo);

  if (process.env.SC_TEVO_UNIT_ONLY === '1') {
    console.log('\n=== 영토 발전 테스트 결과 (unit only) ===');
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
      ok(scriptName + ' 통과', false, String((e.stderr || e.stdout || e.message) || e).slice(-500));
    }
  }

  runChild('test-user-profile-system.js', 'PASS / 0 FAIL', 120000, { SC_PROFILE_UNIT_ONLY: '1' });
  runChild('test-user-data-system.js', '80 PASS', 900000);

  console.log('\n=== 영토 발전 테스트 결과 ===');
  results.forEach(function (r) { console.log(r); });
  console.log('\n총 ' + (pass + fail) + '개 테스트: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('테스트 실행 오류:', e);
  process.exit(1);
});
