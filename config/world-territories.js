/**
 * =============================================================================
 * 센텐스아레나 — “영토(진영) 맵” 규칙만 모아 둔 파일
 * =============================================================================
 * 숫자·이름을 바꾸고 싶을 때는 주로 이 파일만 열면 됩니다.
 * (게시판 단계, 인구 구간별 비주얼 단계 등)
 * =============================================================================
 */

'use strict';

/** 메인 벨트(질서·개혁) + 중앙광장(COMMON). 중도(CENTRIST) 전용 게시판은 없음. */
const MAIN_BELT = Object.freeze({
  CONSERVATIVE: {
    id: 'CONSERVATIVE',
    labelKo: '수호영토',
    /** 게시판 단계 수 (1~4) */
    forumTierCount: 4,
  },
  COMMON: {
    id: 'COMMON',
    labelKo: '중앙광장',
    /** 중앙광장 — 데일리 이슈·자유게시판. 영토 소속·4단계와 별도 */
    forumTierCount: 0,
  },
  PROGRESSIVE: {
    id: 'PROGRESSIVE',
    labelKo: '개척영토',
    forumTierCount: 4,
  },
});

/**
 * 게시판 단계 공통 규칙(설명용 — 나중에 서버·DB와 맞출 때 기준)
 * - tier 1: 모두 읽기 가능, 쓰기/댓글은 “정치색(점수) 해금” 후
 * - 상위 티어: 더 강한 조건(숫자는 alignment-system.js 와 맞춰 조정)
 */
const FORUM_TIER_RULES = Object.freeze([
  {
    tier: 1,
    read: { everyone: true },
    write: { needsAlignmentUnlock: true },
    comment: { needsAlignmentUnlock: true },
  },
  { tier: 2, read: { everyone: false }, write: { needsStrongerUnlock: true }, comment: { needsStrongerUnlock: true } },
  { tier: 3, read: { everyone: false }, write: { needsStrongerUnlock: true }, comment: { needsStrongerUnlock: true } },
  { tier: 4, read: { everyone: false }, write: { needsStrongerUnlock: true }, comment: { needsStrongerUnlock: true } },
]);

/**
 * 영토 인원 구간 → 화면에 보여줄 “발전 단계” (예시, 숫자는 기획에 맞게 바꾸기)
 */
const POPULATION_VISUAL_TIERS = Object.freeze([
  { min: 1, max: 500, stageKey: 'TRIBAL', labelKo: '원시 부족(모닥불·사냥)' },
  { min: 501, max: 2000, stageKey: 'HAMLET', labelKo: '초소형 촌락' },
  { min: 2001, max: 4999, stageKey: 'TOWN', labelKo: '마을·길 정비' },
  { min: 5000, max: 999999999, stageKey: 'AGRARIAN', labelKo: '농경·도시 기반 확대' },
]);

function getStageForPopulation(n) {
  const x = Math.max(0, Number(n) || 0);
  const hit = POPULATION_VISUAL_TIERS.find((t) => x >= t.min && x <= t.max);
  return hit || POPULATION_VISUAL_TIERS[POPULATION_VISUAL_TIERS.length - 1];
}

function getPublicWorldConfig() {
  return Object.freeze({
    mainBelt: MAIN_BELT,
    forumTierRules: FORUM_TIER_RULES,
    populationVisualTiers: POPULATION_VISUAL_TIERS,
  });
}

module.exports = Object.freeze({
  MAIN_BELT,
  FORUM_TIER_RULES,
  POPULATION_VISUAL_TIERS,
  getStageForPopulation,
  getPublicWorldConfig,
});
