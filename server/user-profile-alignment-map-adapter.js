'use strict';
/**
 * 공개 성향지도 adapter
 * 내부 alignment 원점수 노출 금지.
 * 실제 alignment system 미연결 — available:false 또는 Mock 표시값만.
 */

/**
 * @param {string} userId
 * @param {object} [opts]
 * @param {object} [opts.mockDisplay] — LEGACY_LOCAL Mock 전용 { value, displayValue }
 * @param {string} [opts.mode]
 * @param {object} [opts.rawAlignment] — 있으면 원점수는 버리고 표시값만 허용
 */
async function getPublicAlignmentMap(userId, opts) {
  const options = opts || {};
  void userId;

  // 내부 원점수 절대 반환하지 않음
  if (options.rawAlignment && options.rawAlignment.orientationScore != null) {
    // 원점수가 있어도 공개 표시값으로만 변환 — 현재는 공개 정책 미확정이므로 unavailable
    return {
      available: false,
      value: null,
      displayValue: null,
    };
  }

  if (options.mode === 'LEGACY_LOCAL' && options.mockDisplay) {
    return {
      available: true,
      value: options.mockDisplay.value != null ? options.mockDisplay.value : null,
      displayValue: options.mockDisplay.displayValue != null
        ? options.mockDisplay.displayValue
        : null,
    };
  }

  return {
    available: false,
    value: null,
    displayValue: null,
  };
}

module.exports = {
  getPublicAlignmentMap,
};
