/**
 * 센텐스아레나 — 게시판 스키마 공용 상수·검증
 * board-config-core 의 한도·영토·반응 분류를 사용한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./board-config-core'));
  } else {
    root.BoardSchemaCore = factory(root.BoardConfigCore);
  }
})(typeof self !== 'undefined' ? self : this, function boardSchemaCoreFactory(boardConfig) {
  'use strict';

  if (!boardConfig) {
    throw new Error('BoardConfigCore is required before board-schema-core.js');
  }

  var TERRITORY = Object.freeze({
    CENTRAL: 'CENTRAL',
    PIONEER: 'PIONEER',
    GUARDIAN: 'GUARDIAN',
    ALIEN: 'ALIEN',
  });

  var STATUS = Object.freeze({
    ACTIVE: 'ACTIVE',
    DELETED: 'DELETED',
    BLINDED: 'BLINDED',
    HIDDEN_BY_OPERATOR: 'HIDDEN_BY_OPERATOR',
  });

  var REACTION_TYPE = Object.freeze({
    LIKE: 'LIKE',
    RECOMMEND: 'RECOMMEND',
    DISLIKE: 'DISLIKE',
    DOWNVOTE: 'DOWNVOTE',
  });

  var REACTION_GROUP = Object.freeze({
    POSITIVE: 'POSITIVE',
    NEGATIVE: 'NEGATIVE',
  });

  var AUDIENCE_SCOPE = Object.freeze({
    EARTH: 'EARTH',
    ALIEN: 'ALIEN',
  });

  var TARGET_TYPE = Object.freeze({
    POST: 'POST',
    COMMENT: 'COMMENT',
  });

  var LIMITS = Object.freeze({
    titleMax: boardConfig.LIMITS.postTitleMaxLength,
    contentMax: boardConfig.LIMITS.postContentMaxLength,
    commentMax: boardConfig.LIMITS.commentMaxLength,
    reasonDetailMax: boardConfig.LIMITS.reportDetailMaxLength,
  });

  var REPORT_REASONS = Object.freeze(['abuse', 'spam', 'baiting', 'misinfo', 'privacy', 'other']);

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function isUuid(v) {
    return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
  }

  function normalizeTerritory(value, options) {
    return boardConfig.normalizeBoardTerritory(value, options || { allowLegacy: true });
  }

  function reactionGroupOf(type) {
    if (!boardConfig.isAlignmentReactionType(type)) return null;
    var t = String(type).toUpperCase();
    if (t === REACTION_TYPE.LIKE || t === REACTION_TYPE.RECOMMEND) return REACTION_GROUP.POSITIVE;
    if (t === REACTION_TYPE.DISLIKE || t === REACTION_TYPE.DOWNVOTE) return REACTION_GROUP.NEGATIVE;
    return null;
  }

  function audienceScopeFromTerritory(territory) {
    var op = boardConfig.normalizeBoardTerritory(territory, { allowLegacy: false });
    return op === TERRITORY.ALIEN ? AUDIENCE_SCOPE.ALIEN : AUDIENCE_SCOPE.EARTH;
  }

  function validatePostInput(input) {
    var errors = [];
    var src = input || {};
    var title = src.title == null ? '' : String(src.title);
    var content = src.content == null ? '' : String(src.content);
    if (!title.trim()) errors.push('BOARD_TITLE_REQUIRED');
    if (title.length > LIMITS.titleMax) errors.push('BOARD_TITLE_TOO_LONG');
    if (!content.trim()) errors.push('BOARD_CONTENT_REQUIRED');
    if (content.length > LIMITS.contentMax) errors.push('BOARD_CONTENT_TOO_LONG');
    if (src.territory != null) {
      try {
        boardConfig.assertOperationalBoardTerritory(src.territory);
      } catch (e) {
        errors.push('BOARD_TERRITORY_INVALID');
      }
    }
    return { valid: errors.length === 0, errors: errors };
  }

  function validateCommentInput(input) {
    var errors = [];
    var src = input || {};
    var content = src.content == null ? '' : String(src.content);
    if (!content.trim()) errors.push('BOARD_CONTENT_REQUIRED');
    if (content.length > LIMITS.commentMax) errors.push('BOARD_COMMENT_TOO_LONG');
    if (src.parentCommentId != null && !isUuid(src.parentCommentId)) errors.push('BOARD_PARENT_ID_INVALID');
    return { valid: errors.length === 0, errors: errors };
  }

  function validateReactionInput(input) {
    var errors = [];
    var src = input || {};
    if (src.targetType !== TARGET_TYPE.POST && src.targetType !== TARGET_TYPE.COMMENT) {
      errors.push('BOARD_TARGET_TYPE_INVALID');
    }
    if (!isUuid(src.targetId)) errors.push('BOARD_TARGET_ID_INVALID');
    var rt = src.reactionType;
    if (boardConfig.isSocialReactionType(rt) || boardConfig.isDeferredLegacyReactionType(rt)) {
      errors.push('BOARD_LEGACY_REACTION_NOT_SUPPORTED');
    } else if (!boardConfig.isAlignmentReactionType(rt)) {
      errors.push('BOARD_REACTION_TYPE_INVALID');
    }
    return { valid: errors.length === 0, errors: errors };
  }

  function validateReportInput(input) {
    var errors = [];
    var src = input || {};
    if (src.targetType !== TARGET_TYPE.POST && src.targetType !== TARGET_TYPE.COMMENT) {
      errors.push('BOARD_TARGET_TYPE_INVALID');
    }
    if (!isUuid(src.targetId)) errors.push('BOARD_TARGET_ID_INVALID');
    if (REPORT_REASONS.indexOf(src.reasonCode) === -1) errors.push('BOARD_REPORT_REASON_INVALID');
    if (src.reasonCode === 'other' && !(src.reasonDetail && String(src.reasonDetail).trim())) {
      errors.push('BOARD_REPORT_DETAIL_REQUIRED');
    }
    if (src.reasonCode === 'misinfo') {
      var misinfoCore = null;
      try {
        if (typeof require === 'function') misinfoCore = require('./misinfo-report-core');
        else if (typeof self !== 'undefined' && self.MisinfoReportCore) misinfoCore = self.MisinfoReportCore;
      } catch (_) {}
      if (misinfoCore && typeof misinfoCore.validatePayload === 'function') {
        var mis = misinfoCore.validatePayload(src);
        if (!mis.ok && mis.errors && mis.errors.length) {
          for (var mi = 0; mi < mis.errors.length; mi++) errors.push(mis.errors[mi]);
        }
      } else {
        errors.push('MISINFO_EXCERPT_REQUIRED');
      }
    } else if (src.reasonDetail != null && String(src.reasonDetail).length > LIMITS.reasonDetailMax) {
      errors.push('BOARD_REPORT_DETAIL_TOO_LONG');
    }
    return { valid: errors.length === 0, errors: errors };
  }

  /**
   * Member-facing report payload. Never includes reporter/target/reviewer user ids.
   * Admin list/get keep the full repository row.
   */
  function mapReportForMember(report) {
    var src = report || {};
    return {
      id: src.id || null,
      status: src.status || null,
      createdAt: src.createdAt || src.created_at || null,
      reasonCode: src.reasonCode || src.reason_code || null,
    };
  }

  function parseOptionalScore(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return typeof n === 'number' && isFinite(n) ? n : null;
  }

  function toAlignmentReactionInput(row) {
    var src = row || {};
    var type = src.reaction_type || src.reactionType || null;
    if (!boardConfig.isAlignmentReactionType(type)) {
      return null;
    }
    var actorTerr = boardConfig.normalizeBoardTerritory(
      src.actor_territory_at_reaction || src.actorTerritoryAtReaction,
      { allowLegacy: false }
    );
    var targetTerr = boardConfig.normalizeBoardTerritory(
      src.target_author_territory_at_reaction || src.targetAuthorTerritoryAtReaction,
      { allowLegacy: false }
    );
    if (!actorTerr || !targetTerr) return null;
    return {
      reactionId: src.id || src.reactionId || null,
      actorUserId: src.actor_user_id || src.actorUserId || null,
      targetUserId: src.target_author_user_id || src.targetAuthorUserId || null,
      actorTerritoryAtReaction: actorTerr,
      targetTerritoryAtReaction: targetTerr,
      actorAlignmentScoreAtReaction: parseOptionalScore(
        src.actor_alignment_score_at_reaction != null ? src.actor_alignment_score_at_reaction : src.actorAlignmentScoreAtReaction
      ),
      targetAlignmentScoreAtReaction: parseOptionalScore(
        src.target_author_alignment_score_at_reaction != null
          ? src.target_author_alignment_score_at_reaction
          : src.targetAuthorAlignmentScoreAtReaction
      ),
      reactionType: String(type).toUpperCase(),
      createdAt: src.created_at || src.createdAt || null,
      cancelledAt: src.cancelled_at != null ? src.cancelled_at : src.cancelledAt != null ? src.cancelledAt : null,
      audienceScope: src.audience_scope || src.audienceScope || null,
      targetType: src.target_type || src.targetType || null,
      targetId: src.targetId || src.post_id || src.comment_id || src.postId || src.commentId || null,
    };
  }

  return {
    TERRITORY: TERRITORY,
    STATUS: STATUS,
    REACTION_TYPE: REACTION_TYPE,
    REACTION_GROUP: REACTION_GROUP,
    AUDIENCE_SCOPE: AUDIENCE_SCOPE,
    TARGET_TYPE: TARGET_TYPE,
    LIMITS: LIMITS,
    REPORT_REASONS: REPORT_REASONS,
    clone: clone,
    isUuid: isUuid,
    normalizeTerritory: normalizeTerritory,
    reactionGroupOf: reactionGroupOf,
    audienceScopeFromTerritory: audienceScopeFromTerritory,
    validatePostInput: validatePostInput,
    validateCommentInput: validateCommentInput,
    validateReactionInput: validateReactionInput,
    validateReportInput: validateReportInput,
    mapReportForMember: mapReportForMember,
    toAlignmentReactionInput: toAlignmentReactionInput,
    isAlignmentReactionType: boardConfig.isAlignmentReactionType,
    isSocialReactionType: boardConfig.isSocialReactionType,
    isDeferredLegacyReactionType: boardConfig.isDeferredLegacyReactionType,
  };
});
