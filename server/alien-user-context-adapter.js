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
      const citizenship = String((state && state.citizenshipStatus) || '').toUpperCase();
      let status = (state && state.status) || modCore.STATUS.EARTH;
      // Official server citizenship is the security source of truth (not localStorage / UI).
      if (citizenship === 'KANTAPBIYA_RESIDENT') {
        if (!modCore.isAlienRestrictedStatus(status)) {
          status = modCore.STATUS.ALIEN_ACTIVE;
        }
      }
      return accessCore.getAlienUserContextFromStatus({
        userId,
        status,
        alienOriginTerritory: state && (state.alienOriginTerritory || state.earthTerritory),
      });
    },
  };
}

module.exports = {
  createAlienUserContextAdapter,
};
