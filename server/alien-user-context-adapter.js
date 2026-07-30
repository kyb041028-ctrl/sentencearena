'use strict';

const modCore = require('../shared/alien-moderation-core');

/**
 * @param {{ getModerationState?: Function }} moderationRepo
 */
function createAlienUserContextAdapter(options) {
  const opts = options || {};
  const accessCore = require('../shared/alien-access-core');
  const repo = opts.moderationRepo || null;

  return {
    async getAlienUserContext(userId) {
      if (!userId) {
        return accessCore.getAlienUserContextFromStatus({
          userId: null,
          status: modCore.STATUS.UNAVAILABLE,
        });
      }
      if (!repo || typeof repo.getModerationState !== 'function') {
        return accessCore.getAlienUserContextFromStatus({
          userId,
          status: modCore.STATUS.EARTH,
        });
      }
      const state = await repo.getModerationState(userId);
      const status = (state && state.status) || modCore.STATUS.EARTH;
      return accessCore.getAlienUserContextFromStatus({
        userId,
        status,
        alienOriginTerritory: state && state.alienOriginTerritory,
      });
    },
  };
}

module.exports = {
  createAlienUserContextAdapter,
};
