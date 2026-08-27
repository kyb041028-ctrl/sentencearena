/**
 * 센텐스아레나 — 정치성향 canonical 반응 입력층 (read-only)
 * 점수 UPDATE / 배치 / 영토 이동 없음.
 * 가중치 SSOT = alignment-batch-core CONFIG.reactionWeights
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./alignment-batch-core'),
      require('./board-schema-core'),
      require('./board-config-core')
    );
  } else {
    root.PoliticalReactionInputCore = factory(
      root.AlignmentBatchCore,
      root.BoardSchemaCore,
      root.BoardConfigCore
    );
  }
})(typeof self !== 'undefined' ? self : this, function (batchCore, boardSchema, boardConfig) {
  'use strict';

  var POLARITY = Object.freeze({
    POSITIVE: 'POSITIVE',
    NEGATIVE: 'NEGATIVE',
  });

  var EXCLUDE = Object.freeze({
    TYPE_EXCLUDED: 'TYPE_EXCLUDED',
    INACTIVE: 'INACTIVE',
    OUTSIDE_99D: 'OUTSIDE_99D',
    ALIEN_TERRITORY: 'ALIEN_TERRITORY',
    NON_EARTH_SCOPE: 'NON_EARTH_SCOPE',
    MISSING_IDENTITY: 'MISSING_IDENTITY',
    MISSING_TERRITORY: 'MISSING_TERRITORY',
    INVALID_DATE: 'INVALID_DATE',
    DUPLICATE_ID: 'DUPLICATE_ID',
    NOT_ALIGNMENT_ROW: 'NOT_ALIGNMENT_ROW',
    SELF_REACTION: 'SELF_REACTION',
  });

  var EARTH_TERRITORIES = Object.freeze(['CENTRAL', 'PIONEER', 'GUARDIAN']);
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  var MS_DAY = 86400000;

  function getBatchConfig() {
    if (batchCore && typeof batchCore.getAlignmentBatchProcessorConfig === 'function') {
      return batchCore.getAlignmentBatchProcessorConfig();
    }
    return {
      rollingWindowDays: 99,
      recentWindowDays: 30,
      rollingWindowRatio: 0.5,
      recentWindowRatio: 0.5,
      reactionWeights: {
        sameTerritoryPositive: 70,
        otherTerritoryPositive: 130,
        sameTerritoryNegative: 130,
        otherTerritoryNegative: 70,
        centralRelation: 100,
      },
    };
  }

  function getReactionWeights() {
    var w = getBatchConfig().reactionWeights || {};
    return {
      sameTerritoryPositive: w.sameTerritoryPositive,
      otherTerritoryPositive: w.otherTerritoryPositive,
      sameTerritoryNegative: w.sameTerritoryNegative,
      otherTerritoryNegative: w.otherTerritoryNegative,
    };
  }

  function isUuid(v) {
    return UUID_RE.test(String(v || '').trim());
  }

  function mapPolarity(reactionType) {
    var t = String(reactionType || '').trim().toUpperCase();
    if (t === 'LIKE' || t === 'RECOMMEND') return POLARITY.POSITIVE;
    if (t === 'DISLIKE' || t === 'DOWNVOTE') return POLARITY.NEGATIVE;
    return null;
  }

  function isAlienTerritory(v) {
    var t = String(v || '').toUpperCase();
    return t === 'ALIEN' || t === 'KANTAPBIYA';
  }

  function isEarthTerritory(v) {
    return EARTH_TERRITORIES.indexOf(String(v || '').toUpperCase()) >= 0;
  }

  function sameTerritory(actorTerritory, targetTerritory) {
    return String(actorTerritory || '') === String(targetTerritory || '');
  }

  function weightMagnitude(isSameTerritory, polarity) {
    var w = getReactionWeights();
    var pos = polarity === POLARITY.POSITIVE;
    if (pos) return isSameTerritory ? w.sameTerritoryPositive : w.otherTerritoryPositive;
    return isSameTerritory ? w.sameTerritoryNegative : w.otherTerritoryNegative;
  }

  function ageDays(createdAt, asOf) {
    var a = new Date(createdAt).getTime();
    var b = new Date(asOf).getTime();
    if (!isFinite(a) || !isFinite(b)) return null;
    return (b - a) / MS_DAY;
  }

  function inWindowDays(createdAt, asOf, windowDays) {
    var days = ageDays(createdAt, asOf);
    if (days == null || days < 0) return false;
    return days <= windowDays;
  }

  function partitionWindows(inputs, asOf) {
    var cfg = getBatchConfig();
    var list = Array.isArray(inputs) ? inputs : [];
    var last99Days = [];
    var last30Days = [];
    var i;
    for (i = 0; i < list.length; i++) {
      var row = list[i];
      if (!row || !row.createdAt) continue;
      if (inWindowDays(row.createdAt, asOf, cfg.rollingWindowDays)) last99Days.push(row);
      if (inWindowDays(row.createdAt, asOf, cfg.recentWindowDays)) last30Days.push(row);
    }
    return {
      asOf: new Date(asOf).toISOString(),
      rollingWindowDays: cfg.rollingWindowDays,
      recentWindowDays: cfg.recentWindowDays,
      rollingWindowRatio: cfg.rollingWindowRatio,
      recentWindowRatio: cfg.recentWindowRatio,
      last99Days: last99Days,
      last30Days: last30Days,
    };
  }

  function classifyRawRow(row) {
    var src = row || {};
    var type = String(src.reaction_type || src.reactionType || '').toUpperCase();
    if (type === 'EMPATHY' || type === 'REPORT' || type === 'PLANET') {
      return { ok: false, reason: EXCLUDE.TYPE_EXCLUDED };
    }
    if (boardConfig && typeof boardConfig.isSocialReactionType === 'function' && boardConfig.isSocialReactionType(type)) {
      return { ok: false, reason: EXCLUDE.TYPE_EXCLUDED };
    }
    if (boardSchema && typeof boardSchema.toAlignmentReactionInput === 'function') {
      var mapped = boardSchema.toAlignmentReactionInput(src);
      if (!mapped) {
        if (type && boardConfig && boardConfig.isAlignmentReactionType && !boardConfig.isAlignmentReactionType(type)) {
          return { ok: false, reason: EXCLUDE.TYPE_EXCLUDED };
        }
        return { ok: false, reason: EXCLUDE.NOT_ALIGNMENT_ROW };
      }
      return { ok: true, mapped: mapped };
    }
    return { ok: false, reason: EXCLUDE.NOT_ALIGNMENT_ROW };
  }

  function toPoliticalInput(mapped, asOf) {
    var polarity = mapPolarity(mapped.reactionType);
    if (!polarity) return { ok: false, reason: EXCLUDE.TYPE_EXCLUDED };
    if (!isUuid(mapped.actorUserId) || !isUuid(mapped.targetUserId)) {
      return { ok: false, reason: EXCLUDE.MISSING_IDENTITY };
    }
    if (mapped.actorUserId === mapped.targetUserId) {
      return { ok: false, reason: EXCLUDE.SELF_REACTION };
    }
    if (!mapped.actorTerritoryAtReaction || !mapped.targetTerritoryAtReaction) {
      return { ok: false, reason: EXCLUDE.MISSING_TERRITORY };
    }
    if (isAlienTerritory(mapped.actorTerritoryAtReaction) || isAlienTerritory(mapped.targetTerritoryAtReaction)) {
      return { ok: false, reason: EXCLUDE.ALIEN_TERRITORY };
    }
    if (!isEarthTerritory(mapped.actorTerritoryAtReaction) || !isEarthTerritory(mapped.targetTerritoryAtReaction)) {
      return { ok: false, reason: EXCLUDE.MISSING_TERRITORY };
    }
    var scope = String(mapped.audienceScope || 'EARTH').toUpperCase();
    if (scope && scope !== 'EARTH') {
      return { ok: false, reason: EXCLUDE.NON_EARTH_SCOPE };
    }
    if (mapped.cancelledAt != null) {
      return { ok: false, reason: EXCLUDE.INACTIVE };
    }
    var created = mapped.createdAt;
    if (!created || !isFinite(new Date(created).getTime())) {
      return { ok: false, reason: EXCLUDE.INVALID_DATE };
    }
    var cfg = getBatchConfig();
    if (!inWindowDays(created, asOf, cfg.rollingWindowDays)) {
      return { ok: false, reason: EXCLUDE.OUTSIDE_99D };
    }
    var same = sameTerritory(mapped.actorTerritoryAtReaction, mapped.targetTerritoryAtReaction);
    return {
      ok: true,
      input: {
        reactionId: mapped.reactionId,
        actorUserId: mapped.actorUserId,
        targetAuthorUserId: mapped.targetUserId,
        polarity: polarity,
        reactionType: mapped.reactionType,
        actorTerritory: mapped.actorTerritoryAtReaction,
        targetTerritory: mapped.targetTerritoryAtReaction,
        actorAlignmentScoreAtReaction: mapped.actorAlignmentScoreAtReaction,
        targetAlignmentScoreAtReaction: mapped.targetAlignmentScoreAtReaction,
        sameTerritory: same,
        createdAt: created,
        ageDays: ageDays(created, asOf),
        weight: weightMagnitude(same, polarity),
        audienceScope: scope,
        targetType: mapped.targetType || null,
        targetId: mapped.targetId || null,
      },
    };
  }

  function normalizeBoardReactionRows(rows, asOfOpt) {
    var asOf = asOfOpt ? new Date(asOfOpt) : new Date();
    var list = Array.isArray(rows) ? rows : [];
    var calculable = [];
    var excluded = [];
    var seen = {};
    var polarityCount = { POSITIVE: 0, NEGATIVE: 0 };
    var i;
    for (i = 0; i < list.length; i++) {
      var raw = list[i];
      var classified = classifyRawRow(raw);
      if (!classified.ok) {
        excluded.push({ reason: classified.reason });
        continue;
      }
      var built = toPoliticalInput(classified.mapped, asOf);
      if (!built.ok) {
        excluded.push({ reason: built.reason, reactionId: classified.mapped && classified.mapped.reactionId });
        continue;
      }
      var id = built.input.reactionId;
      if (id && seen[id]) {
        excluded.push({ reason: EXCLUDE.DUPLICATE_ID, reactionId: id });
        continue;
      }
      if (id) seen[id] = true;
      calculable.push(built.input);
      polarityCount[built.input.polarity] += 1;
    }
    var windows = partitionWindows(calculable, asOf);
    var reasonCounts = {};
    for (i = 0; i < excluded.length; i++) {
      var r = excluded[i].reason;
      reasonCounts[r] = (reasonCounts[r] || 0) + 1;
    }
    return {
      asOf: asOf.toISOString(),
      calculable: calculable,
      excludedCount: excluded.length,
      excludeReasons: reasonCounts,
      polarityCount: polarityCount,
      windows: windows,
      scoreWrite: false,
    };
  }

  return {
    POLARITY: POLARITY,
    EXCLUDE: EXCLUDE,
    mapPolarity: mapPolarity,
    getReactionWeights: getReactionWeights,
    getBatchConfig: getBatchConfig,
    sameTerritory: sameTerritory,
    weightMagnitude: weightMagnitude,
    ageDays: ageDays,
    inWindowDays: inWindowDays,
    partitionWindows: partitionWindows,
    normalizeBoardReactionRows: normalizeBoardReactionRows,
    POLITICAL_SCORE_WRITE: 'NOT_CONNECTED',
    POLITICAL_BATCH: 'NOT_CONNECTED',
    TERRITORY_MOVE: 'NOT_CONNECTED',
  };
});
