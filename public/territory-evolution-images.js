/**
 * =============================================================================
 * 센텐스아레나 — 영토 발전단계 이미지 경로 목록
 * =============================================================================
 * 목적: 이미지 파일 경로의 Single Source of Truth (등록만).
 * 아직 패널 UI · 소속 인원 계산 · 발전단계 판정 · hover 연동 없음.
 *
 * 경로: public/assets/territory-evolution/
 * 원시(1단계): 개척·수호·중앙광장은 common-primitive 공유.
 * Hover 패널: territory-evolution-hover.js (Mock 단계·인원 · 지도 좌표 무변경)
 * =============================================================================
 */
(function (global) {
  'use strict';

  var BASE = '/assets/territory-evolution';

  var TERRITORY_EVOLUTION_STAGE_LABELS = Object.freeze({
    1: '원시',
    2: '고대',
    3: '중세',
    4: '근대',
    5: '현대',
    6: '미래',
  });

  /** 외계행성 Hover/UI 전용 단계 표시명 (이미지 파일명·명패와 별개) */
  var ALIEN_EVOLUTION_STAGE_LABELS = Object.freeze({
    1: '문명탄생',
    2: '문명형성',
    3: '문명발전',
    4: '문명확장',
    5: '문명번영',
    6: '문명포화',
  });

  var TERRITORY_EVOLUTION_STAGE_KEYS = Object.freeze({
    1: 'primitive',
    2: 'ancient',
    3: 'medieval',
    4: 'early-modern',
    5: 'modern',
    6: 'future',
  });

  var COMMON_PRIMITIVE = BASE + '/territory-evolution-common-primitive.png';

  var TERRITORY_EVOLUTION_IMAGES = Object.freeze({
    pioneer: Object.freeze({
      1: COMMON_PRIMITIVE,
      2: BASE + '/territory-evolution-pioneer-ancient.png',
      3: BASE + '/territory-evolution-pioneer-medieval.png',
      4: BASE + '/territory-evolution-pioneer-early-modern.png',
      5: BASE + '/territory-evolution-pioneer-modern.png',
      6: BASE + '/territory-evolution-pioneer-future.png',
    }),
    guardian: Object.freeze({
      1: COMMON_PRIMITIVE,
      2: BASE + '/territory-evolution-guardian-ancient.png',
      3: BASE + '/territory-evolution-guardian-medieval.png',
      4: BASE + '/territory-evolution-guardian-early-modern.png',
      5: BASE + '/territory-evolution-guardian-modern.png',
      6: BASE + '/territory-evolution-guardian-future.png',
    }),
    central: Object.freeze({
      1: COMMON_PRIMITIVE,
      2: BASE + '/territory-evolution-central-ancient.png',
      3: BASE + '/territory-evolution-central-medieval.png',
      4: BASE + '/territory-evolution-central-early-modern.png',
      5: BASE + '/territory-evolution-central-modern.png',
      6: BASE + '/territory-evolution-central-future.png',
    }),
    alien: Object.freeze({
      1: BASE + '/territory-evolution-alien-primitive.png',
      2: BASE + '/territory-evolution-alien-ancient.png',
      3: BASE + '/territory-evolution-alien-medieval.png',
      4: BASE + '/territory-evolution-alien-early-modern.png',
      5: BASE + '/territory-evolution-alien-modern.png',
      6: BASE + '/territory-evolution-alien-future.png',
    }),
  });

  /** 외계 명패 표기 (단계 키 → 이미지 하단 텍스트) — 원본 명패 문구 유지 */
  var TERRITORY_EVOLUTION_ALIEN_NAMEPLATES = Object.freeze({
    primitive: '문명 탄생',
    ancient: '문명 형성',
    medieval: '문명 발전',
    'early-modern': '문명 확장',
    modern: '문명 번영',
    future: '문명 포화',
  });

  function clampEvolutionStage(stage) {
    var v = Math.round(Number(stage));
    if (!isFinite(v)) return 1;
    return Math.max(1, Math.min(6, v));
  }

  /**
   * 영토별 발전 단계 표시명.
   * alien → ALIEN_EVOLUTION_STAGE_LABELS, 그 외 → TERRITORY_EVOLUTION_STAGE_LABELS
   */
  function getTerritoryEvolutionStageLabel(territoryKey, stage) {
    var safeStage = clampEvolutionStage(stage);
    if (territoryKey === 'alien') {
      return ALIEN_EVOLUTION_STAGE_LABELS[safeStage] || TERRITORY_EVOLUTION_STAGE_LABELS[safeStage] || String(safeStage);
    }
    return TERRITORY_EVOLUTION_STAGE_LABELS[safeStage] || String(safeStage);
  }

  global.TERRITORY_EVOLUTION_STAGE_LABELS = TERRITORY_EVOLUTION_STAGE_LABELS;
  global.ALIEN_EVOLUTION_STAGE_LABELS = ALIEN_EVOLUTION_STAGE_LABELS;
  global.TERRITORY_EVOLUTION_STAGE_KEYS = TERRITORY_EVOLUTION_STAGE_KEYS;
  global.TERRITORY_EVOLUTION_IMAGES = TERRITORY_EVOLUTION_IMAGES;
  global.TERRITORY_EVOLUTION_ALIEN_NAMEPLATES = TERRITORY_EVOLUTION_ALIEN_NAMEPLATES;
  global.getTerritoryEvolutionStageLabel = getTerritoryEvolutionStageLabel;
})(typeof window !== 'undefined' ? window : globalThis);
