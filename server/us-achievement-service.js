'use strict';

const persist = require('./achievement-persist-service');
let query;
function storeOptions() {
  if (query === undefined) query = require('./activity-region-http-storage').regionQueryFromEnv();
  if (query) return { query };
  if (String(process.env.ACTIVITY_REGION_SUPABASE_SCHEMA || '').trim() === '1') return { client: persist.getAdminClient() };
  throw Object.assign(new Error('REGION_SCHEMA_UNAVAILABLE'), { code: 'REGION_SCHEMA_UNAVAILABLE', status: 503 });
}

function createUsAchievementService(options) {
  const opts = options || storeOptions();
  async function bundle(userId) {
    let rows;
    if (opts.query) {
      const out = await opts.query("SELECT achievement_key, acquired_at, acquisition_sequence, acquisition_notified_at, featured_slot FROM public.user_activity_region_achievement WHERE user_id = $1 AND activity_region = 'US' ORDER BY acquisition_sequence", [userId]);
      rows = out.rows;
    } else {
      const out = await opts.client.from('user_activity_region_achievement')
        .select('achievement_key, acquired_at, acquisition_sequence, acquisition_notified_at, featured_slot')
        .eq('user_id', userId).eq('activity_region', 'US').order('acquisition_sequence');
      if (out.error) throw Object.assign(new Error('REGION_SCHEMA_UNAVAILABLE'), { code: 'REGION_SCHEMA_UNAVAILABLE', status: 503 });
      rows = out.data || [];
    }
    return {
      userId, currentAchievements: rows.map(persist.mapAchievementRow), seasonHistory: [],
      featuredAchievementIds: rows.filter(r => r.featured_slot != null).sort((a,b) => a.featured_slot-b.featured_slot).map(r => r.achievement_key),
    };
  }
  async function rpc(name, args) {
    if (opts.query) {
      const out = await opts.query('SELECT public.' + name + '(' + Object.keys(args).map((_,i) => '$'+(i+1)).join(',') + ') AS result', Object.values(args));
      return out.rows[0].result;
    }
    const out = await opts.client.rpc(name,args);
    if (out.error) throw Object.assign(new Error('US_ACHIEVEMENT_UPDATE_FAILED'), {code:'US_ACHIEVEMENT_UPDATE_FAILED',status:400});
    return out.data;
  }
  async function featured(userId, keys) {
    const defs = require('../shared/achievement-definitions-core');
    if (!Array.isArray(keys) || keys.length > 3 || new Set(keys).size !== keys.length || keys.some(k => !defs.getAchievementDefinition(k) || !defs.getAchievementDefinition(k).canFeature)) {
      throw Object.assign(new Error('FEATURED_KEYS_INVALID'), {code:'FEATURED_KEYS_INVALID',status:400});
    }
    await rpc('set_us_featured_achievements', {p_user_id:userId,p_keys:keys});
    const data = await bundle(userId);
    return { status:'SAVED', featuredAchievementIds:data.featuredAchievementIds, bundle:data };
  }
  async function notified(userId, input) {
    const result = await rpc('mark_us_achievement_notified', {
      p_user_id:userId, p_key:input.achievementId, p_sequence:input.acquisitionSequence,
    });
    return {
      status:result.status, achievementId:result.achievement_key,
      acquisitionSequence:Number(result.acquisition_sequence), acquiredAt:result.acquired_at,
      acquisitionNotifiedAt:result.acquisition_notified_at,
    };
  }
  return { bundle, featured, notified };
}
module.exports = { storeOptions, createUsAchievementService };
