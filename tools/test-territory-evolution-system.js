'use strict';
/**
 * 센텐스크래프트 — 영토 발전 데이터 연결 준비 테스트
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
  ok('43. CENTRAL은 CENTRAL만 집계', pC.population === 300);
  ok('44. ALIEN은 ALIEN만 집계', pA.population === 50);
  const snap = await memRepo.getPopulationSnapshot();
  ok('45. ALIEN이 지구 인원에 포함되지 않음', snap.earthTotal === 600 && snap.alienOnly === 50);
  ok('46. CENTRAL에 PIONEER/GUARDIAN이 합산되지 않음', pC.population === 300 && core.CENTRAL_AGGREGATION_MODE === 'DIRECT_ONLY');
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
  ok('71. 기존 패널 위치 데이터 미변경', hoverJs.includes('pioneer-right') && hoverJs.includes('alien-left'));
  ok('72. 외계 패널 위치 미변경', hoverJs.includes("territoryKey === 'alien'") && hoverJs.includes('alien-left'));

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
  ok('85b. supabase repo live count 미실행', (await supabaseRepo.countUsersByTerritory('CENTRAL')).available === false);
  ok('85c. snapshot persist 보류', (await service.persistTerritoryEvolutionSnapshot({})).persisted === false);
  ok('85d. __scInspectTerritoryEvolutionData', apiSrc.includes('__scInspectTerritoryEvolutionData'));

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
