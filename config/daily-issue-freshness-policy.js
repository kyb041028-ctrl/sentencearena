'use strict';

/**
 * 데일리 이슈 최신성(freshness) 정책 상수
 * — 숫자는 이 파일에만 둔다. 품질/독립출처 기준과 분리.
 */

const FRESHNESS_CLASSES = Object.freeze({
  BREAKING: 'BREAKING',
  RECENT_UPDATE: 'RECENT_UPDATE',
  ONGOING_WITH_NEW_DEVELOPMENT: 'ONGOING_WITH_NEW_DEVELOPMENT',
  BACKGROUND_CONTEXT: 'BACKGROUND_CONTEXT',
  RECIRCULATED_OLD_EVENT: 'RECIRCULATED_OLD_EVENT',
  STALE: 'STALE',
  UNKNOWN: 'UNKNOWN',
});

const ELIGIBLE_FRESHNESS_CLASSES = Object.freeze([
  FRESHNESS_CLASSES.BREAKING,
  FRESHNESS_CLASSES.RECENT_UPDATE,
  FRESHNESS_CLASSES.ONGOING_WITH_NEW_DEVELOPMENT,
]);

/** hours / days — 중앙 정책 */
const POLICY = Object.freeze({
  futureSkewMinutes: 30,
  defaultMaxPublishedAgeHours: 72,
  maxUpdateAgeHours: 72,
  maxEventAgeHours: 72,
  longRunningEventUpdateHours: 72,
  recirculationLookbackDays: 30,
  staleArticleDays: 14,
  officialMaxPublishedAgeHours: 168, // 7일
  statisticsMaxPublishedAgeHours: 168,
  breakingMaxPublishedAgeHours: 48,
  backgroundTitleMarkers: Object.freeze([
    '다시 보는',
    '과거',
    '역사',
    '기념',
    '회고',
    '몇 년 전',
    '그때',
    '아카이브',
    '배경',
    '무엇이 있었나',
    '되짚어',
    'explainer',
    'looking back',
    'anniversary',
    'years ago',
  ]),
  longRunningMarkers: Object.freeze([
    'ukraine',
    '우크라이나',
    'gaza',
    '가자',
    'hormuz',
    '호르무즈',
    'ceuta',
    '세우타',
    'war',
    '전쟁',
    'conflict',
    '분쟁',
    '난민',
    'migrant',
  ]),
  noveltyPhraseMap: Object.freeze({
    NEW_OFFICIAL_DECISION: Object.freeze(['의결', '결정했다', '발표했다', 'decided', 'approved', 'announced']),
    NEW_STATISTICAL_RELEASE: Object.freeze(['통계', '지표', 'index', 'statistics', 'released figures']),
    NEW_COURT_DECISION: Object.freeze(['판결', '기각', '인용', 'court ruled', 'verdict']),
    NEW_CASUALTY_UPDATE: Object.freeze(['사망', 'killed', 'casualties', 'injuries', '부상']),
    NEW_POLICY_ANNOUNCEMENT: Object.freeze(['개정안', '정책', 'policy', 'bill', 'sanctions']),
    NEW_EVENT_OCCURRED: Object.freeze(['발생', '충돌', '공격', 'strike', 'attack', 'crossing', 'crisis']),
    NEW_NEGOTIATION_RESULT: Object.freeze(['합의', '결렬', '협상', 'ceasefire', 'talks']),
    NEW_REPORT_RELEASED: Object.freeze(['보고서', 'report released', 'issued a report']),
  }),
  categoryOverrides: Object.freeze({
    economy: Object.freeze({ maxPublishedAgeHours: 168 }),
    world: Object.freeze({ maxPublishedAgeHours: 72 }),
    politics: Object.freeze({ maxPublishedAgeHours: 72 }),
  }),
});

function getPolicyForContext(ctx) {
  const base = Object.assign({}, POLICY);
  const category = ctx && ctx.category;
  if (category && POLICY.categoryOverrides[category]) {
    Object.assign(base, POLICY.categoryOverrides[category]);
  }
  if (ctx && ctx.sourceType === 'OFFICIAL') {
    base.defaultMaxPublishedAgeHours = POLICY.officialMaxPublishedAgeHours;
  }
  if (ctx && (ctx.documentType === 'STATISTICAL_RELEASE' || ctx.sourceType === 'STATISTICS')) {
    base.defaultMaxPublishedAgeHours = POLICY.statisticsMaxPublishedAgeHours;
  }
  if (ctx && Number.isFinite(Number(ctx.maxAgeHoursOverride))) {
    base.defaultMaxPublishedAgeHours = Number(ctx.maxAgeHoursOverride);
  }
  return base;
}

module.exports = {
  FRESHNESS_CLASSES: FRESHNESS_CLASSES,
  ELIGIBLE_FRESHNESS_CLASSES: ELIGIBLE_FRESHNESS_CLASSES,
  POLICY: POLICY,
  getPolicyForContext: getPolicyForContext,
};
