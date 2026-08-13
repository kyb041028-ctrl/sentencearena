'use strict';

/**
 * RETROACTIVE 업적 server-side backfill — canonical DB stats만 사용.
 * browser localStorage count / client grant 금지.
 */

const defCore = require('../shared/achievement-definitions-core');
const achCore = require('../shared/achievement-evaluation-core');
const persist = require('./achievement-persist-service');
const statsService = require('./achievement-stats-service');
const evaluator = require('./achievement-evaluator-service');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizePolicy(value) {
  const key = String(value == null ? '' : value).trim().toUpperCase();
  if (key === 'RETROACTIVE' || key === 'FORWARD_ONLY') return key;
  return 'UNSET';
}

function resolveDefinitionPolicy(def) {
  if (!def) return 'UNSET';
  return normalizePolicy(def.conditionHistoryPolicy);
}

async function listAuthorsWithActivePostCountAtLeast(minCount) {
  const min = Math.max(1, Number(minCount) || 1);
  const sb = persist.getAdminClient();
  const { data, error } = await sb
    .from('board_posts')
    .select('author_user_id')
    .eq('status', 'ACTIVE');
  if (error) {
    const err = new Error(error.code || 'BACKFILL_POSTS_QUERY_FAILED');
    err.code = error.code || 'BACKFILL_POSTS_QUERY_FAILED';
    err.status = 500;
    throw err;
  }
  const counts = Object.create(null);
  (data || []).forEach(function (row) {
    const uid = String((row && row.author_user_id) || '').trim();
    if (!uid || !UUID_RE.test(uid)) return;
    counts[uid] = (counts[uid] || 0) + 1;
  });
  return Object.keys(counts).filter(function (uid) {
    return counts[uid] >= min;
  });
}

async function evaluateUserForBackfill(userId, def) {
  const owned = await persist.listAchievementsForUser(userId);
  const already = owned.some(function (r) {
    return r && r.achievementId === def.achievementKey;
  });
  if (already) {
    return { userId: userId, status: 'ALREADY_OWNED' };
  }
  const stats = await statsService.loadAchievementStats(userId);
  const context = evaluator.buildEvalContext(stats, owned);
  const verdict = achCore.evaluateAchievementCondition(def, context);
  if (!verdict.eligible) {
    return {
      userId: userId,
      status: 'NOT_ELIGIBLE',
      reason: verdict.reason || 'NOT_ELIGIBLE',
      validPostCount: stats.validPostCount,
    };
  }
  return { userId: userId, status: 'ELIGIBLE', validPostCount: stats.validPostCount };
}

/**
 * @param {{ achievementId: string, dryRun?: boolean, userIds?: string[] }} options
 */
async function runAchievementBackfill(options) {
  const opts = options || {};
  const achievementId = String(opts.achievementId || '').trim();
  if (!achievementId) {
    return { ok: false, error: 'ACHIEVEMENT_ID_REQUIRED' };
  }

  const def = defCore.getAchievementDefinition(achievementId);
  if (!def) {
    return { ok: false, error: 'UNKNOWN_ACHIEVEMENT', achievementId: achievementId };
  }
  if (def.implementationStatus !== 'CONFIRMED' || !def.enabled) {
    return { ok: false, error: 'NOT_CONFIRMED', achievementId: achievementId };
  }

  const policy = resolveDefinitionPolicy(def);
  if (policy === 'FORWARD_ONLY') {
    return {
      ok: false,
      skipped: true,
      reason: 'FORWARD_ONLY',
      achievementId: achievementId,
      policy: policy,
    };
  }
  if (policy !== 'RETROACTIVE') {
    return {
      ok: false,
      skipped: true,
      reason: 'POLICY_UNSET',
      achievementId: achievementId,
      policy: policy,
    };
  }

  if (def.conditionType !== 'VALID_POST_COUNT') {
    return {
      ok: false,
      skipped: true,
      reason: 'UNSUPPORTED_CONDITION_TYPE',
      achievementId: achievementId,
      conditionType: def.conditionType,
    };
  }

  const minCount = Number(def.conditionConfig) || 1;
  let candidateIds = Array.isArray(opts.userIds)
    ? opts.userIds.map(function (id) {
        return String(id || '').trim();
      }).filter(function (id) {
        return id && UUID_RE.test(id);
      })
    : await listAuthorsWithActivePostCountAtLeast(minCount);

  const dryRun = opts.dryRun !== false;
  const results = [];
  let grantedCount = 0;
  let eligibleCount = 0;

  for (let i = 0; i < candidateIds.length; i++) {
    const userId = candidateIds[i];
    let evalResult;
    try {
      evalResult = await evaluateUserForBackfill(userId, def);
    } catch (e) {
      results.push({
        userId: userId,
        status: 'ERROR',
        error: (e && e.code) || String(e && e.message ? e.message : e),
      });
      continue;
    }

    if (evalResult.status === 'ELIGIBLE') {
      eligibleCount += 1;
      if (dryRun) {
        results.push({ userId: userId, status: 'WOULD_GRANT', validPostCount: evalResult.validPostCount });
        continue;
      }
      try {
        const grant = await persist.grantAchievementForUser(userId, {
          achievementId: def.achievementKey,
        });
        if (grant.granted) grantedCount += 1;
        results.push({
          userId: userId,
          status: grant.granted ? 'GRANTED' : 'ALREADY_GRANTED',
          record: grant.record || null,
          validPostCount: evalResult.validPostCount,
        });
      } catch (e) {
        results.push({
          userId: userId,
          status: 'GRANT_FAILED',
          error: (e && e.code) || String(e && e.message ? e.message : e),
        });
      }
      continue;
    }

    results.push(evalResult);
  }

  return {
    ok: true,
    achievementId: achievementId,
    policy: policy,
    conditionType: def.conditionType,
    minCount: minCount,
    dryRun: dryRun,
    candidateCount: candidateIds.length,
    eligibleCount: eligibleCount,
    grantedCount: grantedCount,
    results: results,
  };
}

async function inspectBackfillEligibility(achievementId) {
  const def = defCore.getAchievementDefinition(achievementId);
  if (!def) return { ok: false, error: 'UNKNOWN_ACHIEVEMENT' };
  const policy = resolveDefinitionPolicy(def);
  const minCount = def.conditionType === 'VALID_POST_COUNT' ? Number(def.conditionConfig) || 1 : null;
  const authors =
    minCount != null ? await listAuthorsWithActivePostCountAtLeast(minCount) : [];
  const summary = {
    wouldGrant: 0,
    alreadyOwned: 0,
    notEligible: 0,
  };
  const samples = [];
  for (let i = 0; i < authors.length; i++) {
    const r = await evaluateUserForBackfill(authors[i], def);
    if (r.status === 'ELIGIBLE') summary.wouldGrant += 1;
    else if (r.status === 'ALREADY_OWNED') summary.alreadyOwned += 1;
    else summary.notEligible += 1;
    if (samples.length < 5) {
      samples.push({
        userPrefix: authors[i].slice(0, 8),
        status: r.status,
        reason: r.reason || null,
        validPostCount: r.validPostCount != null ? r.validPostCount : undefined,
      });
    }
  }
  return {
    ok: true,
    achievementId: achievementId,
    policy: policy,
    minCount: minCount,
    authorsWithPosts: authors.length,
    summary: summary,
    samples: samples,
  };
}

module.exports = {
  runAchievementBackfill,
  inspectBackfillEligibility,
  listAuthorsWithActivePostCountAtLeast,
  resolveDefinitionPolicy,
  UUID_RE,
};
