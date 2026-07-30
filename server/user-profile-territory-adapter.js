'use strict';
/**
 * 프로필 영토 조회 adapter
 * 실제 alignment DB 연결 전 — 소스별 안전한 fallback만 제공.
 * 클라이언트가 전달한 영토를 신뢰하지 않음.
 */

const VALID_TERRITORIES = Object.freeze(['CENTRAL', 'PIONEER', 'GUARDIAN', 'ALIEN']);

function normalizeTerritory(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim().toUpperCase();
  const map = {
    CENTRAL: 'CENTRAL',
    CENTER: 'CENTRAL',
    PIONEER: 'PIONEER',
    GUARDIAN: 'GUARDIAN',
    ALIEN: 'ALIEN',
    KANTAPBIYA: 'ALIEN',
    PROGRESSIVE: 'PIONEER',
    CONSERVATIVE: 'GUARDIAN',
  };
  return map[s] || (VALID_TERRITORIES.indexOf(s) !== -1 ? s : null);
}

/**
 * @param {string} userId
 * @param {object} [opts]
 * @param {object} [opts.profileRow] — profiles.metadata / legacy territory (서버 조회값만)
 * @param {object} [opts.alignmentRow] — 운영 alignment 저장소 (있으면)
 * @param {string} [opts.mode] — LEGACY_LOCAL | API_DRY_RUN | API_OPERATIONAL
 * @param {string} [opts.clientTerritory] — 무시됨 (신뢰 금지)
 */
async function getProfileTerritory(userId, opts) {
  const options = opts || {};
  // 클라이언트 전달 영토는 절대 사용하지 않음
  void options.clientTerritory;
  void userId;

  if (options.alignmentRow && options.alignmentRow.territory != null) {
    const t = normalizeTerritory(options.alignmentRow.territory);
    if (t) {
      return { territory: t, source: 'OPERATIONAL_ALIGNMENT', available: true };
    }
  }

  const profile = options.profileRow || {};
  const fromProfile =
    profile.territory ||
    (profile.metadata && (profile.metadata.territory || profile.metadata.territoryId)) ||
    null;
  const legacy = normalizeTerritory(fromProfile);
  if (legacy) {
    return { territory: legacy, source: 'LEGACY_PROFILE', available: true };
  }

  if (options.mode === 'LEGACY_LOCAL' && options.mockTerritory) {
    const mock = normalizeTerritory(options.mockTerritory);
    if (mock) {
      return { territory: mock, source: 'MOCK', available: true };
    }
  }

  return { territory: null, source: 'UNAVAILABLE', available: false };
}

module.exports = {
  VALID_TERRITORIES,
  normalizeTerritory,
  getProfileTerritory,
};
