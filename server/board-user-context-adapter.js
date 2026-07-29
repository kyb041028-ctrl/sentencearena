'use strict';

const schema = require('../shared/board-schema-core');

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

module.exports = {
  createMockUserContextAdapter,
  createUnavailableUserContextAdapter,
};
