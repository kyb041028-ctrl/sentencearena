'use strict';
/**
 * profiles.citizenship_status / exile_strike_count writer.
 * Never writes profiles.territory.
 */

const reportCore = require('../shared/alien-report-moderation-core');

function createAlienCitizenshipWriter(client) {
  if (!client) {
    const err = new Error('ALIEN_CITIZENSHIP_CLIENT_REQUIRED');
    err.code = 'ALIEN_CITIZENSHIP_CLIENT_REQUIRED';
    throw err;
  }

  async function setCitizenship(input) {
    const src = input || {};
    const userId = src.userId;
    if (!userId) return { ok: false, error: 'USER_ID_REQUIRED' };
    const patch = {
      citizenship_status: src.citizenshipStatus || reportCore.CITIZENSHIP.EARTH,
    };
    if (src.exileStrikeCount != null) {
      patch.exile_strike_count = Math.max(0, Math.floor(Number(src.exileStrikeCount) || 0));
    }
    const { data, error } = await client
      .from('profiles')
      .update(patch)
      .eq('id', userId)
      .select('id, citizenship_status, exile_strike_count, territory')
      .maybeSingle();
    if (error) {
      const err = new Error(error.message || 'CITIZENSHIP_WRITE_FAILED');
      err.code = 'CITIZENSHIP_WRITE_FAILED';
      throw err;
    }
    return {
      ok: true,
      userId: userId,
      citizenshipStatus: data && data.citizenship_status,
      exileStrikeCount: data && data.exile_strike_count,
      territory: data && data.territory,
      preserveTerritory: src.preserveTerritory !== false,
    };
  }

  return { setCitizenship };
}

module.exports = {
  createAlienCitizenshipWriter,
};
