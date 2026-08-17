/**
 * BETA DAILY ISSUE ALIGNMENT SEED V1
 *
 * alignment_direction is classification metadata only.
 * It is not a selection, quota, or rewrite signal.
 * Live contribution is LIKE/DISLIKE × issue direction snapshot.
 * No keyword classifier. No 4-choice stance. No AUTHOR_RECEIVED.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DailyIssueAlignmentSeedCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var POLICIES = Object.freeze({
    VERSION: 'DAILY_ISSUE_ALIGNMENT_SEED_V1',
    DAILY_ISSUE: 'ACTIVE_SEED',
    CLASSIFICATION: 'ADMIN_ENUM',
    KEYWORD_CLASSIFIER: false,
    BALANCE_TARGET: false,
    SYNTHETIC_OPPOSITE_ISSUE: false,
    PUBLIC_DIRECTION_EXPOSED: false,
    ACTOR_SELF: 'ACTIVE',
    AUTHOR_RECEIVED: false,
    MAGNITUDE: 60,
    DAILY_CAP: 180,
    EMPATHY: 0,
    VIEW: 0,
    DWELL: 0,
    SOURCE_CLICK: 0,
    COMMENT_WRITE: 0,
  });

  var DIRECTION = Object.freeze({
    PIONEER: 'PIONEER',
    GUARDIAN: 'GUARDIAN',
    NEUTRAL: 'NEUTRAL',
  });

  var REACTION_TYPE = Object.freeze({
    LIKE: 'LIKE',
    DISLIKE: 'DISLIKE',
  });

  function isFiniteNumber(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function normalizeDirection(value) {
    var d = String(value == null ? '' : value).toUpperCase();
    if (d === DIRECTION.PIONEER) return DIRECTION.PIONEER;
    if (d === DIRECTION.GUARDIAN) return DIRECTION.GUARDIAN;
    return DIRECTION.NEUTRAL;
  }

  function parseDirectionStrict(value) {
    var d = String(value == null ? '' : value).toUpperCase();
    if (d === DIRECTION.PIONEER || d === DIRECTION.GUARDIAN || d === DIRECTION.NEUTRAL) {
      return { ok: true, value: d };
    }
    return { ok: false, error: 'ALIGNMENT_DIRECTION_INVALID', value: DIRECTION.NEUTRAL };
  }

  function normalizeReactionType(value) {
    var t = String(value == null ? '' : value).toUpperCase();
    if (t === REACTION_TYPE.LIKE) return REACTION_TYPE.LIKE;
    if (t === REACTION_TYPE.DISLIKE) return REACTION_TYPE.DISLIKE;
    return null;
  }

  /**
   * Client may send alignment_direction or ±60. Server ignores those fields.
   */
  function trustedReactionTypeFromBody(body) {
    var src = body && typeof body === 'object' ? body : {};
    return normalizeReactionType(src.reactionType || src.reaction_type);
  }

  function computeReactionSigned(direction, reactionType) {
    var dir = normalizeDirection(direction);
    var type = normalizeReactionType(reactionType);
    if (!type) return 0;
    if (dir === DIRECTION.NEUTRAL) return 0;
    var mag = POLICIES.MAGNITUDE;
    if (dir === DIRECTION.PIONEER) return type === REACTION_TYPE.LIKE ? mag : -mag;
    if (dir === DIRECTION.GUARDIAN) return type === REACTION_TYPE.LIKE ? -mag : mag;
    return 0;
  }

  /**
   * none→LIKE, LIKE→cancel, none→DISLIKE, DISLIKE→cancel, LIKE↔DISLIKE replace.
   */
  function nextToggleState(activeType, requestedType) {
    var current = normalizeReactionType(activeType);
    var requested = normalizeReactionType(requestedType);
    if (!requested) {
      return { ok: false, error: 'REACTION_TYPE_INVALID', action: null, nextType: current, active: !!current };
    }
    if (!current) {
      return { ok: true, action: 'CREATED', nextType: requested, active: true };
    }
    if (current === requested) {
      return { ok: true, action: 'CANCELLED', nextType: null, active: false };
    }
    return { ok: true, action: 'REPLACED', nextType: requested, active: true };
  }

  function viewSigned() {
    return POLICIES.VIEW;
  }

  function dwellSigned() {
    return POLICIES.DWELL;
  }

  function sourceClickSigned() {
    return POLICIES.SOURCE_CLICK;
  }

  function commentWriteSigned() {
    return POLICIES.COMMENT_WRITE;
  }

  function empathySigned() {
    return POLICIES.EMPATHY;
  }

  function publicPayloadHasAlignmentLeak(obj) {
    var raw = JSON.stringify(obj || {});
    return /"alignmentDirection"|"alignment_direction"|"alignmentScore"|"signedDelta"/.test(raw);
  }

  return {
    POLICIES: POLICIES,
    DIRECTION: DIRECTION,
    REACTION_TYPE: REACTION_TYPE,
    normalizeDirection: normalizeDirection,
    parseDirectionStrict: parseDirectionStrict,
    normalizeReactionType: normalizeReactionType,
    trustedReactionTypeFromBody: trustedReactionTypeFromBody,
    computeReactionSigned: computeReactionSigned,
    nextToggleState: nextToggleState,
    viewSigned: viewSigned,
    dwellSigned: dwellSigned,
    sourceClickSigned: sourceClickSigned,
    commentWriteSigned: commentWriteSigned,
    empathySigned: empathySigned,
    publicPayloadHasAlignmentLeak: publicPayloadHasAlignmentLeak,
    isFiniteNumber: isFiniteNumber,
  };
});
