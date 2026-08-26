'use strict';

const obsCore = require('../shared/alien-observation-core');

const store = {
  posts: new Map(),
  comments: [],
};

function _reset() {
  store.posts.clear();
  store.comments = [];
}

function _seedObservationPost(post) {
  store.posts.set(post.id, post);
}

function _seedComment(comment) {
  store.comments.push(comment);
}

async function getSourcePost(postId) {
  return store.posts.get(postId) || null;
}

async function listEarthComments(postId) {
  return store.comments.filter((c) => c.postId === postId && c.audienceScope === 'EARTH' && c.status !== 'DELETED');
}

async function listAlienComments(postId) {
  return store.comments.filter((c) => c.postId === postId && c.audienceScope === 'ALIEN' && c.status !== 'DELETED');
}

async function createAlienComment(input) {
  const row = Object.assign({}, input, {
    id: input.id || ('ac_' + (store.comments.length + 1)),
    audienceScope: 'ALIEN',
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
  });
  store.comments.push(row);
  return row;
}

async function listTerritoryObservationCandidates(territory) {
  const t = String(territory || '').toUpperCase();
  const items = Array.from(store.posts.values()).filter(function (p) {
    if (!p || p.status === 'DELETED' || p.status === 'BLINDED') return false;
    if (String(p.territory || '').toUpperCase() !== t) return false;
    if (t === 'CENTRAL') return true;
    if (t === 'PIONEER' || t === 'GUARDIAN') {
      return Math.max(1, Math.floor(Number(p.boardStage) || 1)) === 1;
    }
    return false;
  }).map(function (p) {
    return {
      id: p.id,
      territory: p.territory,
      boardStage: Math.max(1, Math.floor(Number(p.boardStage) || 1)),
      title: p.title,
      status: p.status || 'ACTIVE',
      isAnonymous: !!p.isAnonymous,
      authorUserId: p.isAnonymous ? null : p.authorUserId,
      createdAt: p.createdAt || null,
    };
  });
  return { items: items, note: null, dataStatus: 'READY' };
}

async function listObservedPosts(filter) {
  const src = filter || {};
  return listTerritoryObservationCandidates(src.territory);
}

async function listFreePlazaPosts() {
  return Array.from(store.posts.values()).filter((p) => p.territory === 'ALIEN' && p.categoryKey === obsCore.FREE_PLAZA_CATEGORY);
}

async function createFreePlazaPost(input) {
  const row = Object.assign({}, input, {
    id: input.id || ('fp_' + store.posts.size + 1),
    territory: 'ALIEN',
    categoryKey: obsCore.FREE_PLAZA_CATEGORY,
    status: 'ACTIVE',
  });
  store.posts.set(row.id, row);
  return row;
}

async function healthCheck() {
  return { ok: true, backend: 'memory', persistEnabled: false };
}

module.exports = {
  getSourcePost,
  listEarthComments,
  listAlienComments,
  createAlienComment,
  listTerritoryObservationCandidates,
  listObservedPosts,
  listFreePlazaPosts,
  createFreePlazaPost,
  healthCheck,
  _reset,
  _seedObservationPost,
  _seedComment,
};
