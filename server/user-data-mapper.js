'use strict';
/**
 * 사용자 데이터 매퍼 — DB row ↔ API 응답 변환
 */

const cfg = require('../shared/user-data-config-core');
const userDataSchema = require('../shared/user-data-schema-core');

function normalizeLevelValue(level) {
  return userDataSchema.normalizeLevel(level);
}

function toPublicProfile(profileRow, progressionRow, featuredAchievements) {
  if (!profileRow) return null;
  const pub = userDataSchema.filterPublicProfile(profileRow);
  if (progressionRow) {
    pub.level = normalizeLevelValue(progressionRow.level);
    pub.reputationScore = progressionRow.reputation_score;
    pub.citizenRank = progressionRow.citizen_rank;
    pub.followerCount = progressionRow.follower_count;
    pub.followingCount = progressionRow.following_count;
  }
  if (featuredAchievements) {
    pub.featuredAchievements = featuredAchievements;
  }
  return pub;
}

function toProgressionResponse(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    xp: row.xp,
    level: normalizeLevelValue(row.level),
    reputationScore: row.reputation_score,
    citizenRank: row.citizen_rank,
    receivedEmpathyCount: row.received_empathy_count,
    followerCount: row.follower_count,
    followingCount: row.following_count,
    receivedPostLikes: row.received_post_likes,
    receivedCommentLikes: row.received_comment_likes,
    updatedAt: row.updated_at,
  };
}

function toPublicProgressionResponse(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    level: normalizeLevelValue(row.level),
    reputationScore: row.reputation_score,
    citizenRank: row.citizen_rank,
    followerCount: row.follower_count,
    followingCount: row.following_count,
  };
}

function toNotificationResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.notification_type,
    title: row.title,
    message: row.message,
    payload: row.payload,
    isRead: row.is_read,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

function toActivityEventResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    activityType: row.activity_type,
    payload: row.payload,
    occurredAt: row.occurred_at,
  };
}

function toBookmarkResponse(row) {
  if (!row) return null;
  return { postId: row.post_id, createdAt: row.created_at };
}

function toAchievementResponse(row) {
  if (!row) return null;
  return {
    achievementKey: row.achievement_key,
    acquiredAt: row.acquired_at,
    acquisitionSequence: row.acquisition_sequence,
    seasonKey: row.season_key,
    metadata: row.metadata,
  };
}

module.exports = {
  toPublicProfile,
  toProgressionResponse,
  toPublicProgressionResponse,
  toNotificationResponse,
  toActivityEventResponse,
  toBookmarkResponse,
  toAchievementResponse,
};
