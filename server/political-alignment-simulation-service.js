'use strict';
/**
 * 정치성향 배치 read-only simulation.
 * SELECT only. user_alignment_state / board_reactions UPDATE·INSERT 없음.
 * 배치 persist 호출 · scheduler · 영토 이동 없음.
 */

const inputCore = require('../shared/political-reaction-input-core');
const simCore = require('../shared/political-alignment-simulation-core');

function getAdminClient() {
  const persist = require('./achievement-persist-service');
  return persist.getAdminClient();
}

function redactUsers(users) {
  const list = Array.isArray(users) ? users : [];
  const out = [];
  let i;
  for (i = 0; i < list.length; i++) {
    const u = list[i];
    out.push({
      userAlias: 'U' + (i + 1),
      eligibleReactionCount: u.eligibleReactionCount,
      reactionCount99: u.reactionCount99,
      reactionCount30: u.reactionCount30,
      positiveCount: u.positiveCount,
      negativeCount: u.negativeCount,
      sameTerritoryCount: u.sameTerritoryCount,
      otherTerritoryCount: u.otherTerritoryCount,
      pioneerActorCount: u.pioneerActorCount,
      guardianActorCount: u.guardianActorCount,
      centralActorCount: u.centralActorCount,
      unsignedMagnitude99: u.unsignedMagnitude99,
      unsignedMagnitude30: u.unsignedMagnitude30,
      weighted99: u.weighted99,
      weighted30: u.weighted30,
      combinedSignal: u.combinedSignal,
      previousSignal: u.previousSignal,
      rawDelta: u.rawDelta,
      cappedDelta: u.cappedDelta,
      capApplied: u.capApplied,
      currentScore: u.currentScore,
      simulatedNextScore: u.simulatedNextScore,
      signedStatus: u.signedStatus,
      excludedFromSignedCount: u.excludedFromSignedCount,
    });
  }
  return out;
}

async function loadAlignmentReadonly(client, userIds) {
  const currentScoreByUser = {};
  const previousByUser = {};
  if (!client || !userIds || !userIds.length) {
    return { currentScoreByUser: currentScoreByUser, previousByUser: previousByUser, alignmentStateRead: false };
  }
  const st = await client
    .from('user_alignment_state')
    .select('user_id, score, previous_signal')
    .in('user_id', userIds);
  if (st.error) {
    return { currentScoreByUser: currentScoreByUser, previousByUser: previousByUser, alignmentStateRead: false, alignmentStateError: st.error.message };
  }
  const rows = st.data || [];
  let i;
  for (i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.user_id) continue;
    const score = row.score == null ? null : Number(row.score);
    const prev = row.previous_signal == null ? null : Number(row.previous_signal);
    if (typeof score === 'number' && isFinite(score)) currentScoreByUser[row.user_id] = score;
    if (typeof prev === 'number' && isFinite(prev)) previousByUser[row.user_id] = prev;
  }
  return { currentScoreByUser: currentScoreByUser, previousByUser: previousByUser, alignmentStateRead: true };
}

/**
 * @param {{ asOf?: Date|string, userIds?: string[], client?: any, rows?: object[] }} options
 */
async function simulateAlignmentBatch(options) {
  const opts = options || {};
  const asOf = opts.asOf ? new Date(opts.asOf) : new Date();
  let rows = opts.rows;
  let sb = opts.client;

  if (!rows) {
    sb = sb || getAdminClient();
    const rx = await sb
      .from('board_reactions')
      .select(
        'id, actor_user_id, target_author_user_id, reaction_type, reaction_group, audience_scope, target_type, post_id, comment_id, actor_territory_at_reaction, target_author_territory_at_reaction, actor_alignment_score_at_reaction, target_author_alignment_score_at_reaction, created_at, cancelled_at'
      );
    if (rx.error) {
      const err = new Error('POLITICAL_SIMULATION_LOAD_FAILED');
      err.code = 'POLITICAL_SIMULATION_LOAD_FAILED';
      err.detail = rx.error.message;
      throw err;
    }
    rows = rx.data || [];
  }

  const normalized = inputCore.normalizeBoardReactionRows(rows, asOf);
  let currentScoreByUser = opts.currentScoreByUser || {};
  let previousByUser = opts.previousByUser || {};
  let alignmentMeta = { alignmentStateRead: false };

  if (!opts.rows && sb) {
    const targets = {};
    let i;
    for (i = 0; i < normalized.calculable.length; i++) {
      const row = normalized.calculable[i];
      if (row.targetAuthorUserId) targets[row.targetAuthorUserId] = true;
      if (row.actorUserId) targets[row.actorUserId] = true;
    }
    if (Array.isArray(opts.userIds)) {
      for (i = 0; i < opts.userIds.length; i++) targets[String(opts.userIds[i])] = true;
    }
    alignmentMeta = await loadAlignmentReadonly(sb, Object.keys(targets));
    currentScoreByUser = alignmentMeta.currentScoreByUser;
    previousByUser = alignmentMeta.previousByUser;
  }

  const result = simCore.simulateFromNormalized(normalized, {
    asOf: asOf,
    userIds: opts.userIds,
    previousByUser: previousByUser,
    currentScoreByUser: currentScoreByUser,
  });

  return {
    status: 'POLITICAL_SIMULATION',
    scoreWrite: false,
    schedulerConnected: false,
    territoryMoveEvaluated: false,
    alignmentStateRead: !!alignmentMeta.alignmentStateRead,
    alignmentStateError: alignmentMeta.alignmentStateError || null,
    asOf: result.asOf,
    policies: result.policies,
    windowFormula: result.windowFormula,
    userCount: result.userCount,
    eligibleReactionCount: result.eligibleReactionCount,
    excludedReactionCount: result.excludedReactionCount,
    excludeReasons: result.excludeReasons,
    polarityCount: result.polarityCount,
    usersRedacted: redactUsers(result.users),
    users: opts.includeUserIds ? result.users : undefined,
  };
}

module.exports = {
  simulateAlignmentBatch,
  redactUsers,
  POLITICAL_REACTION_INPUT: 'ACTIVE_CANONICAL',
  POLITICAL_SIMULATION: simCore.POLITICAL_SIMULATION,
  POLITICAL_SCORE_WRITE: 'NOT_CONNECTED',
  POLITICAL_BATCH_SCHEDULER: 'READY_DISABLED',
  POLITICAL_BATCH: 'NOT_CONNECTED',
  TERRITORY_MOVE: 'NOT_CONNECTED',
  CENTRAL_SIGN_POLICY: simCore.CENTRAL_SIGN_POLICY,
  WINDOW_COMBINATION_POLICY: simCore.WINDOW_COMBINATION_POLICY,
};
