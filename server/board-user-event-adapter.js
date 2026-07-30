'use strict';

const eventCore = require('../shared/user-domain-event-core');

function buildPostCreatedPlan(input) {
  const src = input || {};
  return eventCore.buildDomainEvent({
    eventType: eventCore.EVENT_TYPE.POST_CREATED,
    userId: src.authorUserId,
    actorUserId: src.authorUserId,
    sourceType: 'BOARD_POST',
    sourceId: src.postId,
    dedupeKey: 'board:post:' + src.postId,
    payload: { territory: src.territory, isAnonymous: !!src.isAnonymous },
    sourceSystem: 'BOARD',
  });
}

function buildCommentCreatedPlan(input) {
  const src = input || {};
  return eventCore.buildDomainEvent({
    eventType: eventCore.EVENT_TYPE.COMMENT_CREATED,
    userId: src.authorUserId,
    actorUserId: src.authorUserId,
    sourceType: 'BOARD_COMMENT',
    sourceId: src.commentId,
    targetType: 'POST',
    targetId: src.postId,
    dedupeKey: 'board:comment:' + src.commentId,
    payload: { audienceScope: src.audienceScope || 'EARTH', isAnonymous: !!src.isAnonymous },
    sourceSystem: 'BOARD',
  });
}

function buildEmpathyReceivedPlan(input) {
  const src = input || {};
  return eventCore.buildDomainEvent({
    eventType: eventCore.EVENT_TYPE.EMPATHY_RECEIVED,
    userId: src.targetUserId,
    actorUserId: src.actorUserId,
    sourceType: src.targetType || 'BOARD',
    sourceId: src.targetId,
    dedupeKey: 'board:empathy:' + src.targetId + ':' + (src.actorUserId || 'anon'),
    payload: { reputationAmount: src.reputationAmount },
    sourceSystem: 'BOARD',
  });
}

function buildFollowerGainedPlan(input) {
  const src = input || {};
  return eventCore.buildDomainEvent({
    eventType: eventCore.EVENT_TYPE.FOLLOWER_GAINED,
    userId: src.targetUserId,
    actorUserId: src.followerUserId,
    sourceType: 'FOLLOW',
    sourceId: src.followerUserId + ':' + src.targetUserId,
    dedupeKey: 'follow:gained:' + src.followerUserId + ':' + src.targetUserId,
    sourceSystem: 'FOLLOW',
  });
}

/** LIKE는 명성 이벤트로 자동 변환하지 않음 */
function buildLikeReceivedPlan() {
  return { ok: false, error: 'LIKE_NOT_MAPPED_TO_REPUTATION' };
}

module.exports = {
  buildPostCreatedPlan,
  buildCommentCreatedPlan,
  buildEmpathyReceivedPlan,
  buildFollowerGainedPlan,
  buildLikeReceivedPlan,
  note: 'PLAN_ONLY_BOARD_API_NOT_WIRED',
};
