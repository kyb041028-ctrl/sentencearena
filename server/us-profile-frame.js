'use strict';

/**
 * 미국 프로필 프레임에 올릴 표시값.
 * 레벨·게이지는 progression-xp-core, 활동 수는 한국판 ACTIVE 집계와 같은 규칙이다.
 * 미국 행만 센다. 명성 점수를 받은 공감 수로 복사하지 않는다.
 * 아우라·이동·영향력·등급·성향·팔로워는 여기서 만들지 않는다.
 */

const xpCore = require('../shared/progression-xp-core');
const nameCore = require('../shared/activity-name-core');
const regionCore = require('../shared/activity-region-core');

const TERRITORY_KEYS = {
  pioneer: 'pioneer',
  progressive: 'pioneer',
  reform: 'pioneer',
  central: 'central',
  center: 'central',
  centrist: 'central',
  square: 'central',
  guardian: 'guardian',
  conservative: 'guardian',
  order: 'guardian',
  alien: 'alien',
  planet: 'alien',
};

function canonicalTerritoryKey(raw) {
  const text = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!text) return null;
  return TERRITORY_KEYS[text] || null;
}

function territoryLabel(raw) {
  const key = canonicalTerritoryKey(raw);
  if (!key) return null;
  return regionCore.US_TERRITORY_LABELS[key] || null;
}

function activityName(raw) {
  const name = String(raw == null ? '' : raw).trim();
  if (!name || !nameCore.isCompleteActivityName(name)) return null;
  return name;
}

function reactorFromEmpathyDedupe(dedupe) {
  const parts = String(dedupe || '').split(':');
  if (parts.length < 4) return '';
  if (parts[1] !== 'EMPATHY_RECEIVED') return '';
  return parts.slice(3).join(':');
}

/**
 * posts / comments / empathyEvents 는 이미 미국 ACTIVE(또는 미국 공감 이벤트)만 넘긴다.
 * 댓글 id 중복은 1회. 같은 글의 댓글 여러 번은 토론 1회.
 * 자기 공감 이벤트는 받은 공감에서 뺀다.
 */
function countActivity(posts, comments, empathyEvents, userId) {
  const owner = String(userId || '').trim();
  const postIds = {};
  (posts || []).forEach(function (row) {
    const id = String(row && (row.id != null ? row.id : '') || '').trim();
    if (id) postIds[id] = true;
  });
  const seenComments = {};
  let commentCount = 0;
  const discussion = Object.assign({}, postIds);
  (comments || []).forEach(function (row) {
    if (!row) return;
    const id = String(row.id != null ? row.id : '').trim();
    if (id) {
      if (seenComments[id]) return;
      seenComments[id] = true;
    }
    commentCount += 1;
    const postId = String(row.post_id != null ? row.post_id : row.postId || '').trim();
    if (postId) discussion[postId] = true;
  });
  const seenEmpathy = {};
  let likes = 0;
  (empathyEvents || []).forEach(function (row) {
    if (!row) return;
    const dedupe = String(row.dedupe_key || row.dedupeKey || '');
    if (dedupe.indexOf('KR:') === 0) return;
    const reactor = reactorFromEmpathyDedupe(dedupe);
    if (reactor && owner && reactor === owner) return;
    const key = dedupe || String(row.id || '');
    if (key) {
      if (seenEmpathy[key]) return;
      seenEmpathy[key] = true;
    }
    likes += 1;
  });
  return {
    posts: Object.keys(postIds).length,
    comments: commentCount,
    receivedLikes: likes,
    discussions: Object.keys(discussion).length,
    available: true,
  };
}

function featuredKeys(earned, selected) {
  const owned = {};
  (earned || []).forEach(function (key) {
    const id = String(key || '').trim();
    if (id) owned[id] = true;
  });
  const out = [];
  const source = Array.isArray(selected) && selected.length
    ? selected
    : (earned || []);
  source.forEach(function (key) {
    const id = String(key || '').trim();
    if (!id || !owned[id] || out.indexOf(id) !== -1) return;
    if (out.length < 3) out.push(id);
  });
  return out;
}

function displayFields(row) {
  const src = row || {};
  const stored = src.stored === true;
  const xp = stored ? xpCore.normalizeXp(src.xp) : null;
  const progression = stored ? xpCore.buildProgressionDisplay(null, xp) : null;
  const territory = stored ? canonicalTerritoryKey(src.territory) : null;
  return {
    displayName: activityName(src.displayName),
    expPercent: progression ? progression.expPercent : null,
    levelFromXp: progression ? progression.level : null,
    territory: territory,
    territoryLabel: territory ? territoryLabel(src.territory) : null,
    featuredAchievements: featuredKeys(src.achievements, src.featured),
  };
}

module.exports = {
  canonicalTerritoryKey: canonicalTerritoryKey,
  territoryLabel: territoryLabel,
  activityName: activityName,
  reactorFromEmpathyDedupe: reactorFromEmpathyDedupe,
  countActivity: countActivity,
  featuredKeys: featuredKeys,
  displayFields: displayFields,
};
