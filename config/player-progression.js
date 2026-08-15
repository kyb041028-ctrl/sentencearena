/**
 * =============================================================================
 * 유저 레벨(1~10) · 경험치 · 명성·등급(Lv4 이후, 받은 좋아요 절대 기준)
 * =============================================================================
 * XP SSOT: shared/progression-xp-core.js
 * - Lv1~5 탐색/튜토리얼 · Lv6~10 커뮤니티 성장
 * - 3레벨: 타 영토 1단계 눈팅(읽기)
 * - 4레벨: 랭크(명성 등급) 해금
 * =============================================================================
 */

'use strict';

const xpCore = require('../shared/progression-xp-core');

const MAX_LEVEL = xpCore.MAX_LEVEL;
const MAX_TOTAL_XP = xpCore.MAX_TOTAL_XP;
const LURK_UNLOCK_LEVEL = 3;
const MAX_RANK_TIER = 4;
const RANK_UNLOCK_LEVEL = 4;

const XP_REWARDS = Object.freeze({
  post_write: xpCore.XP_REWARDS.post_write,
  board_comment: xpCore.XP_REWARDS.board_comment,
  issue_comment: xpCore.XP_REWARDS.issue_comment,
});

const XP_PER_LEVEL = xpCore.XP_PER_LEVEL;
const LEVEL_CUMULATIVE_XP = xpCore.LEVEL_CUMULATIVE_XP;

const levelFromTotalXp = xpCore.calculateLevelFromXp;
const xpProgressInLevel = xpCore.xpProgressInLevel;

/** 절대평가 — 받은 좋아요·팔로워 (타인만 집계) */
const RANK_ABSOLUTE_THRESHOLDS = Object.freeze({
  2: Object.freeze({ postLikes: 3, commentLikes: 2, followers: 2, labelKo: '논객' }),
  3: Object.freeze({ postLikes: 15, commentLikes: 8, followers: 8, labelKo: '대표' }),
  4: Object.freeze({ postLikes: 40, commentLikes: 20, followers: 20, labelKo: '지도자' }),
});

/** 랭크 명성 점수: 팔로워 1명 가중치 */
const RANK_FOLLOWER_WEIGHT = 5;

/** 소속(영토) 인구 대비 상한 */
const RANK_POPULATION_CAPS = Object.freeze({
  politicianMaxRatio: 0.1,
  chiefsMaxCount: 5,
});

const RANK_TIERS = Object.freeze([
  { tier: 1, labelKo: '시민', shortKo: '시민', permissions: Object.freeze({}) },
  { tier: 2, labelKo: '논객', shortKo: '논객', permissions: Object.freeze({}) },
  { tier: 3, labelKo: '대표', shortKo: '대표', permissions: Object.freeze({}) },
  { tier: 4, labelKo: '지도자', shortKo: '지도자', permissions: Object.freeze({}) },
]);

function getRankTierRow(tier) {
  const t = Math.floor(Number(tier));
  if (!isFinite(t) || t < 1) return RANK_TIERS[0];
  if (t > RANK_TIERS.length) return RANK_TIERS[RANK_TIERS.length - 1];
  return RANK_TIERS[t - 1];
}

function normalizeLikeCount(n) {
  return Math.max(0, Math.floor(Number(n) || 0));
}

/** 랭크 정렬용 명성 점수 (받은 좋아요 + 팔로워) */
function rankReputationScore(state) {
  const post = normalizeLikeCount(state.receivedPostLikes);
  const comment = normalizeLikeCount(state.receivedCommentLikes);
  const followers = normalizeLikeCount(state.receivedFollowers);
  return post + comment * 2 + followers * RANK_FOLLOWER_WEIGHT;
}

/**
 * 절대 기준만으로 달성 가능한 최고 명성 등급 (0=미달, 2~4, 인구·하위50% 미적용)
 */
function meetsAbsoluteThreshold(tier, stats) {
  const th = RANK_ABSOLUTE_THRESHOLDS[tier];
  if (!th) return false;
  return (
    normalizeLikeCount(stats.postLikes) >= th.postLikes &&
    normalizeLikeCount(stats.commentLikes) >= th.commentLikes &&
    normalizeLikeCount(stats.followers) >= th.followers
  );
}

function absoluteRankTierFromStats(level, stats) {
  if (level < RANK_UNLOCK_LEVEL) return 0;
  if (meetsAbsoluteThreshold(4, stats)) return 4;
  if (meetsAbsoluteThreshold(3, stats)) return 3;
  if (meetsAbsoluteThreshold(2, stats)) return 2;
  return 1;
}

/** @deprecated */
function absoluteRankTierFromLikes(level, likes) {
  return absoluteRankTierFromStats(level, {
    postLikes: likes.postLikes,
    commentLikes: likes.commentLikes,
    followers: likes.followers || 0,
  });
}

/** @deprecated alias */
function qualifyingRankTierFromLikes(level, likes) {
  return absoluteRankTierFromLikes(level, likes);
}

/**
 * @param {string} territoryId
 * @param {Record<string, object>} map
 * @param {string} excludeUserId
 */
function countTerritoryMembers(territoryId, map, excludeUserId) {
  const tid = String(territoryId || 'COMMON').trim() || 'COMMON';
  let n = 0;
  Object.keys(map || {}).forEach((uid) => {
    if (excludeUserId && uid === excludeUserId) return;
    const row = map[uid];
    if (!row || String(row.territoryId || 'COMMON') !== tid) return;
    if (levelFromTotalXp(row.totalXp) >= RANK_UNLOCK_LEVEL) n += 1;
  });
  return Math.max(1, n);
}

function countRankHoldersInTerritory(territoryId, map, minTier, excludeUserId, tierByUser) {
  const tid = String(territoryId || 'COMMON').trim() || 'COMMON';
  let n = 0;
  Object.keys(map || {}).forEach((uid) => {
    if (excludeUserId && uid === excludeUserId) return;
    const row = map[uid];
    if (!row || String(row.territoryId || 'COMMON') !== tid) return;
    const rt = Math.floor(
      Number(tierByUser && tierByUser[uid] !== undefined ? tierByUser[uid] : row.rankTier) || 0,
    );
    if (rt >= minTier) n += 1;
  });
  return n;
}

function applyPopulationCaps(userId, territoryId, tier, map, tierByUser) {
  let t = tier;
  const tid = String(territoryId || 'COMMON').trim() || 'COMMON';
  if (t >= 4) {
    const chiefs = countRankHoldersInTerritory(tid, map, 4, userId, tierByUser);
    if (chiefs >= RANK_POPULATION_CAPS.chiefsMaxCount) t = Math.min(t, 3);
  }
  if (t >= 3) {
    const pop = countTerritoryMembers(tid, map, userId);
    const maxPoliticians = Math.max(1, Math.floor(pop * RANK_POPULATION_CAPS.politicianMaxRatio));
    const politicians = countRankHoldersInTerritory(tid, map, 3, userId, tierByUser);
    if (politicians >= maxPoliticians) t = Math.min(t, 2);
  }
  return t;
}

/**
 * 절대 기준 + 인구 캡만 적용 (상대평가 하위 컷 없음)
 */
function recomputeAllRanks(map) {
  const absolute = {};

  Object.keys(map || {}).forEach((uid) => {
    const row = map[uid];
    if (!row) return;
    const level = levelFromTotalXp(row.totalXp);
    if (level < RANK_UNLOCK_LEVEL) {
      absolute[uid] = 0;
      return;
    }
    absolute[uid] = absoluteRankTierFromStats(level, {
      postLikes: row.receivedPostLikes,
      commentLikes: row.receivedCommentLikes,
      followers: row.receivedFollowers,
    });
  });

  const provisional = {};
  Object.keys(map || {}).forEach((uid) => {
    const row = map[uid];
    if (!row) return;
    const level = levelFromTotalXp(row.totalXp);
    if (level < RANK_UNLOCK_LEVEL) {
      provisional[uid] = 0;
      return;
    }
    provisional[uid] = absolute[uid] || 0;
  });

  Object.keys(map || {}).forEach((uid) => {
    const row = map[uid];
    if (!row) return;
    row.rankTier = applyPopulationCaps(uid, row.territoryId, provisional[uid] || 0, map, provisional);
  });
}

function resolveEffectiveRankTier(userId, state, map) {
  const draft = Object.assign({}, state);
  const m = Object.assign({}, map || {});
  m[userId] = draft;
  recomputeAllRanks(m);
  return m[userId] ? m[userId].rankTier : 0;
}

function normalizeState(raw, userId, map) {
  const totalXp = Math.max(0, Math.floor(Number(raw && raw.totalXp) || 0));
  const territoryId = String((raw && raw.territoryId) || 'COMMON').trim() || 'COMMON';
  const receivedPostLikes = normalizeLikeCount(raw && raw.receivedPostLikes);
  const receivedCommentLikes = normalizeLikeCount(raw && raw.receivedCommentLikes);
  const receivedFollowers = normalizeLikeCount(raw && raw.receivedFollowers);
  const draft = {
    totalXp,
    territoryId,
    receivedPostLikes,
    receivedCommentLikes,
    receivedFollowers,
    rankTier: 0,
  };
  const m = Object.assign({}, map || {});
  m[userId] = draft;
  recomputeAllRanks(m);
  return Object.freeze(m[userId] || draft);
}

function getPublicPlayerProgressionConfig() {
  return Object.freeze({
    maxLevel: MAX_LEVEL,
    lurkUnlockLevel: LURK_UNLOCK_LEVEL,
    rankUnlockLevel: RANK_UNLOCK_LEVEL,
    maxRankTier: MAX_RANK_TIER,
    xpRewards: XP_REWARDS,
    xpPerLevel: XP_PER_LEVEL,
    levelCumulativeXp: LEVEL_CUMULATIVE_XP,
    rankTiers: RANK_TIERS.map((r) =>
      Object.freeze({
        tier: r.tier,
        labelKo: r.labelKo,
        shortKo: r.shortKo,
        permissions: r.permissions,
      }),
    ),
    rankAbsoluteThresholds: RANK_ABSOLUTE_THRESHOLDS,
    rankPopulationCaps: RANK_POPULATION_CAPS,
    notesKo: [
      '레벨 3: 타 영토 1단계 눈팅(읽기). 레벨 4: 명성 등급·집계 해금.',
      '명성 등급은 받은 좋아요·팔로워 절대 기준 + 영토 인구 캡만 적용합니다.',
      '대표: 소속 인구 10% 이내, 지도자: 소속당 5명 이내.',
    ],
  });
}

module.exports = Object.freeze({
  MAX_LEVEL,
  LURK_UNLOCK_LEVEL,
  RANK_UNLOCK_LEVEL,
  MAX_RANK_TIER,
  XP_REWARDS,
  XP_PER_LEVEL,
  LEVEL_CUMULATIVE_XP,
  RANK_TIERS,
  RANK_ABSOLUTE_THRESHOLDS,
  RANK_FOLLOWER_WEIGHT,
  RANK_POPULATION_CAPS,
  levelFromTotalXp,
  xpProgressInLevel,
  getRankTierRow,
  rankReputationScore,
  absoluteRankTierFromStats,
  absoluteRankTierFromLikes,
  qualifyingRankTierFromLikes,
  recomputeAllRanks,
  resolveEffectiveRankTier,
  normalizeState,
  getPublicPlayerProgressionConfig,
});
