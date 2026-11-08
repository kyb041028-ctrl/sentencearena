'use strict';

// Server-only entry points. Call participation only after a successful real write.
// There is deliberately no public self-grant route or caller-supplied event time.
async function rpc(name, args, options) {
  const opts = options || {};
  if (opts.query) {
    const names = Object.keys(args);
    const out = await opts.query('SELECT public.' + name + '(' + names.map((_, i) => '$' + (i + 1)).join(',') + ') AS result', Object.values(args));
    return out.rows[0].result;
  }
  const client = opts.client || require('./achievement-persist-service').getAdminClient();
  const out = await client.rpc(name, args);
  if (out.error) throw Object.assign(new Error('SPECIAL_ACHIEVEMENT_STORE_UNAVAILABLE'), { code: 'SPECIAL_ACHIEVEMENT_STORE_UNAVAILABLE' });
  return out.data;
}

async function grantBetaParticipation(userId, region, action, sourceId, options) {
  if (!userId || !['KR', 'US'].includes(region) || !['POST', 'BOARD_COMMENT', 'ISSUE_COMMENT'].includes(action) || !sourceId) {
    return { status: 'BETA_PARTICIPATION_INVALID' };
  }
  return rpc('grant_beta_participation', {
    p_user_id: userId, p_region: region, p_action: action, p_source_id: String(sourceId),
  }, options);
}

async function grantBetaParticipationSafe(userId, region, action, sourceId, options) {
  try { return await grantBetaParticipation(userId, region, action, sourceId, options); }
  catch (_) { return { status: 'SPECIAL_ACHIEVEMENT_STORE_UNAVAILABLE' }; }
}

async function acceptVerifiedBug(input, options) {
  const src = input || {};
  if (!src.inquiryId || !src.userId || !['KR','US'].includes(src.region) || !src.ownerId ||
    !/^[a-z0-9][a-z0-9._:-]{2,119}$/.test(src.bugKey || '') ||
    typeof src.evidence !== 'string' || src.evidence.trim().length < 10 || src.evidence.trim().length > 2000) {
    throw Object.assign(new Error('BUG_VERIFICATION_INVALID'), { code: 'BUG_VERIFICATION_INVALID', status: 400 });
  }
  return rpc('accept_verified_bug_achievement', {
    p_inquiry_id: src.inquiryId, p_user_id: src.userId, p_region: src.region,
    p_bug_key: src.bugKey, p_owner_id: src.ownerId, p_evidence: src.evidence.trim(),
  }, options);
}

function grantedRecords(result) {
  if (!result || result.status !== 'GRANTED' || !result.achievement_key) return [];
  return [{ achievementKey: result.achievement_key,
    record: require('./achievement-persist-service').mapAchievementRow(result) }];
}
module.exports = { grantBetaParticipation, grantBetaParticipationSafe, acceptVerifiedBug, grantedRecords };
