'use strict';

const schema = require('../shared/board-schema-core');

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
    async getUserAlignmentScore(userId) {
      const scores = opts.alignmentScores || {};
      if (Object.prototype.hasOwnProperty.call(scores, userId)) {
        const n = Number(scores[userId]);
        return typeof n === 'number' && isFinite(n) ? n : 0;
      }
      return 0;
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
 * 실회원 Earth membership = profiles.territory.
 * 게시판 위치(board_posts.territory)와 혼동하지 않는다.
 * ALIEN moderation 은 별도. 클라이언트 전달 영토는 사용하지 않는다.
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
        const { getCanonicalUserTerritory } = require('./canonical-user-territory-service');
        const got = await getCanonicalUserTerritory(uid);
        if (got && got.territory) return got.territory;
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
