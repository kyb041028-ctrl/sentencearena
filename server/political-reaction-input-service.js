'use strict';
/**
 * 정치성향 canonical 반응 입력층 — SELECT 전용.
 * user_alignment_state / 점수 UPDATE / scheduler 호출 없음.
 * 정본 = board_reactions (auth.users.id). localStorage 미사용.
 */

const core = require('../shared/political-reaction-input-core');

function getAdminClient() {
  const persist = require('./achievement-persist-service');
  return persist.getAdminClient();
}

function emptyQuality(asOf) {
  return {
    asOf: asOf,
    activeLikeDislikeCount: 0,
    positiveCount: 0,
    negativeCount: 0,
    targetResolveOk: 0,
    actorTerritoryOk: 0,
    targetTerritoryOk: 0,
    calculableCount: 0,
    incalculableCount: 0,
    excludeReasons: {},
    scoreWrite: false,
  };
}

async function inspectCanonicalPoliticalReactions(options) {
  const opts = options || {};
  const asOf = opts.asOf ? new Date(opts.asOf) : new Date();
  const sb = opts.client || getAdminClient();
  const rx = await sb
    .from('board_reactions')
    .select(
      'id, actor_user_id, target_author_user_id, reaction_type, reaction_group, audience_scope, target_type, post_id, comment_id, actor_territory_at_reaction, target_author_territory_at_reaction, actor_alignment_score_at_reaction, target_author_alignment_score_at_reaction, created_at, cancelled_at'
    );
  if (rx.error) {
    const err = new Error('POLITICAL_REACTION_LOAD_FAILED');
    err.code = 'POLITICAL_REACTION_LOAD_FAILED';
    err.detail = rx.error.message;
    throw err;
  }
  const rows = rx.data || [];
  const active = [];
  let i;
  for (i = 0; i < rows.length; i++) {
    if (rows[i] && rows[i].cancelled_at == null) active.push(rows[i]);
  }

  const normalized = core.normalizeBoardReactionRows(active, asOf);
  const quality = emptyQuality(asOf.toISOString());
  quality.activeLikeDislikeCount = active.length;
  quality.positiveCount = normalized.polarityCount.POSITIVE;
  quality.negativeCount = normalized.polarityCount.NEGATIVE;
  quality.calculableCount = normalized.calculable.length;
  quality.incalculableCount = normalized.excludedCount;
  quality.excludeReasons = normalized.excludeReasons;

  for (i = 0; i < active.length; i++) {
    const row = active[i];
    if (row.target_author_user_id) quality.targetResolveOk += 1;
    if (row.actor_territory_at_reaction) quality.actorTerritoryOk += 1;
    if (row.target_author_territory_at_reaction) quality.targetTerritoryOk += 1;
  }

  return {
    status: 'POLITICAL_REACTION_INPUT',
    scoreWrite: false,
    windows: normalized.windows,
    calculable: normalized.calculable,
    quality: quality,
  };
}

module.exports = {
  inspectCanonicalPoliticalReactions,
  POLITICAL_REACTION_INPUT: 'ACTIVE_CANONICAL',
  POLITICAL_SCORE_WRITE: 'NOT_CONNECTED',
  POLITICAL_BATCH: 'NOT_CONNECTED',
  TERRITORY_MOVE: 'NOT_CONNECTED',
};
