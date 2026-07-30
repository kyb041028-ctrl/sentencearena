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
  void territory;
  return { items: [], note: 'TERRITORY_SELECTOR_NOT_IMPLEMENTED' };
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
  listFreePlazaPosts,
  createFreePlazaPost,
  healthCheck,
  _reset,
  _seedObservationPost,
  _seedComment,
};
