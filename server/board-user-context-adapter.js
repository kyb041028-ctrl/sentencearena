'use strict';

const schema = require('../shared/board-schema-core');

// Membership HOME source (profiles.territory). Not wired into getUserTerritory yet.
// Selection UI + write land in a later step. Do not use localStorage here.
const MEMBERSHIP_TERRITORY_CANONICAL_SOURCE = 'profiles.territory';

function createMockUserContextAdapter(options) {
  const opts = options || {};
  const territories = Object.assign({}, opts.territories || {});

  return {
    async getUserTerritory(userId) {
      if (!userId) {
        const err = new Error('BOARD_USER_CONTEXT_REQUIRED');
        err.code = 'BOARD_USER_CONTEXT_REQUIRED';
        throw err;
      }
      if (Object.prototype.hasOwnProperty.call(territories, userId)) {
        return schema.normalizeTerritory(territories[userId]) || schema.TERRITORY.CENTRAL;
      }
      if (opts.defaultTerritory) {
        return schema.normalizeTerritory(opts.defaultTerritory) || schema.TERRITORY.CENTRAL;
      }
      const err = new Error('BOARD_USER_TERRITORY_UNAVAILABLE');
      err.code = 'BOARD_USER_TERRITORY_UNAVAILABLE';
      throw err;
    },
    async getAudienceScope(userId) {
      const territory = await this.getUserTerritory(userId);
      return schema.audienceScopeFromTerritory(territory);
    },
  };
}

function createUnavailableUserContextAdapter() {
  return {
    async getUserTerritory() {
      const err = new Error('BOARD_USER_TERRITORY_UNAVAILABLE');
      err.code = 'BOARD_USER_TERRITORY_UNAVAILABLE';
      throw err;
    },
    async getAudienceScope() {
      const err = new Error('BOARD_USER_TERRITORY_UNAVAILABLE');
      err.code = 'BOARD_USER_TERRITORY_UNAVAILABLE';
      throw err;
    },
  };
}

/**
 * 실회원 canonical 게시글 INSERT용.
 * 클라이언트 전달 영토는 사용하지 않는다.
 * alignment 테이블이 없으면 CENTRAL fallback (first-post 카운트만 필요).
 *
 * NEXT (not this step): prefer getCanonicalUserTerritory → profiles.territory.
 * Existing members are territory NULL; keep this fallback chain until selection write exists.
 */
function createCanonicalUserContextAdapter() {
  return {
    async getUserTerritory(userId) {
      const uid = String(userId || '').trim();
      if (!uid) {
        const err = new Error('BOARD_USER_CONTEXT_REQUIRED');
        err.code = 'BOARD_USER_CONTEXT_REQUIRED';
        throw err;
      }
      try {
        const persist = require('./achievement-persist-service');
        const sb = persist.getAdminClient();
        const align = await sb
          .from('user_alignment_state')
          .select('current_territory')
          .eq('user_id', uid)
          .maybeSingle();
        if (!align.error && align.data && align.data.current_territory) {
          const t = schema.normalizeTerritory(align.data.current_territory);
          if (t) return t;
        }
        const profile = await sb.from('profiles').select('metadata').eq('id', uid).maybeSingle();
        const meta = profile && profile.data && profile.data.metadata ? profile.data.metadata : {};
        const fromMeta = schema.normalizeTerritory(meta.territory || meta.territoryId || meta.currentTerritory);
        if (fromMeta) return fromMeta;
      } catch (_) {}
      return schema.TERRITORY.CENTRAL;
    },
    async getAudienceScope(userId) {
      const territory = await this.getUserTerritory(userId);
      return schema.audienceScopeFromTerritory(territory);
    },
  };
}

module.exports = {
  MEMBERSHIP_TERRITORY_CANONICAL_SOURCE,
  createMockUserContextAdapter,
  createUnavailableUserContextAdapter,
  createCanonicalUserContextAdapter,
};
