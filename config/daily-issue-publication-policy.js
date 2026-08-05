'use strict';

/**
 * 데일리 이슈 게시 기간·슬롯 정책 (품질/최신성 정책과 분리)
 */

const PUBLICATION_POLICY = Object.freeze({
  defaultDisplayHours: 24,
  officialPolicyDisplayHours: 72,
  statisticsDisplayHours: 72,
  breakingDisplayHours: 24,
  ongoingUpdateDisplayHours: 48,
  maxPublishedPerCategory: 3,
  maxTotalPublished: 8,
  recentDuplicateLookbackDays: 30,
  autoRetireEnabled: true,
  maxReasonTextLength: 500,
  maxJsonFileBytes: 8_000_000,
});

function resolveDisplayHours(meta) {
  const m = meta || {};
  const freshnessClass = String(m.freshnessClass || '');
  const sourceType = String(m.sourceType || m.primarySourceType || '').toUpperCase();
  const documentType = String(m.documentType || '').toUpperCase();
  if (freshnessClass === 'BREAKING') return PUBLICATION_POLICY.breakingDisplayHours;
  if (freshnessClass === 'ONGOING_WITH_NEW_DEVELOPMENT') {
    return PUBLICATION_POLICY.ongoingUpdateDisplayHours;
  }
  if (sourceType === 'OFFICIAL' || documentType === 'PRESS_RELEASE' || documentType === 'LAW') {
    return PUBLICATION_POLICY.officialPolicyDisplayHours;
  }
  if (sourceType === 'STATISTICS' || documentType === 'STATISTICAL_RELEASE') {
    return PUBLICATION_POLICY.statisticsDisplayHours;
  }
  return PUBLICATION_POLICY.defaultDisplayHours;
}

module.exports = {
  PUBLICATION_POLICY: PUBLICATION_POLICY,
  resolveDisplayHours: resolveDisplayHours,
};
