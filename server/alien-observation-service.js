'use strict';

const obsCore = require('../shared/alien-observation-core');
const accessCore = require('../shared/alien-access-core');
const modService = require('./alien-moderation-service');
const memoryRepo = require('./alien-observation-memory-repository');

let _repo = memoryRepo;
let _mode = 'LEGACY_LOCAL';
const _obsCache = new Map();
const OBS_TTL_MS = 15 * 1000;
const _pending = new Map();

function setRepository(repo) {
  _repo = repo || memoryRepo;
}

function setDataMode(mode) {
  const m = String(mode || 'LEGACY_LOCAL').toUpperCase();
  if (m === 'API_OPERATIONAL') {
    _mode = 'LEGACY_LOCAL';
    return;
  }
  _mode = m === 'API_DRY_RUN' ? 'API_DRY_RUN' : 'LEGACY_LOCAL';
}

function getDataMode() {
  return _mode;
}

function isActivated() {
  return !!modService.isActivated();
}

/**
 * Official board_stage on board_posts (not territory-evolution population stage).
 * CENTRAL: all stages readable via observation.
 * PIONEER/GUARDIAN: board_stage === 1 only.
 */
function assertObservationReadablePost(post) {
  if (!post) {
    const err = new Error('BOARD_POST_NOT_FOUND');
    err.code = 'BOARD_POST_NOT_FOUND';
    err.status = 404;
    throw err;
  }
  const territory = String(post.territory || '').toUpperCase();
  const stage = Math.max(1, Math.floor(Number(post.boardStage != null ? post.boardStage : post.board_stage) || 1));
  if (territory === 'CENTRAL') return { ok: true, territory: territory, boardStage: stage };
  if (territory === 'PIONEER' || territory === 'GUARDIAN') {
    if (stage === 1) return { ok: true, territory: territory, boardStage: stage };
    const err = new Error('ALIEN_OBSERVATION_STAGE_FORBIDDEN');
    err.code = 'ALIEN_OBSERVATION_STAGE_FORBIDDEN';
    err.status = 403;
    throw err;
  }
  if (territory === 'ALIEN') {
    const err = new Error('ALIEN_OBSERVATION_SOURCE_INVALID');
    err.code = 'ALIEN_OBSERVATION_SOURCE_INVALID';
    err.status = 400;
    throw err;
  }
  const err = new Error('ALIEN_OBSERVATION_TERRITORY_FORBIDDEN');
  err.code = 'ALIEN_OBSERVATION_TERRITORY_FORBIDDEN';
  err.status = 403;
  throw err;
}

function cacheKey(postId, filter) {
  return String(postId) + '::' + String(filter || 'ALL');
}

function invalidateObservationCache(postId) {
  if (!postId) {
    _obsCache.clear();
    return;
  }
  for (const k of _obsCache.keys()) {
    if (k.indexOf(String(postId) + '::') === 0) _obsCache.delete(k);
  }
}

function invalidateAllObservationCache() {
  _obsCache.clear();
  _pending.clear();
}

async function requireAlienViewer(userId) {
  const ctx = await modService.getAccessContext(userId);
  const gate = accessCore.assertAlienObservationAccess(ctx);
  if (!gate.allowed) {
    const err = new Error(gate.reason || 'OBSERVATION_FORBIDDEN');
    err.code = gate.reason || 'OBSERVATION_FORBIDDEN';
    err.status = 403;
    throw err;
  }
  return ctx;
}

function mapCommentSafe(c) {
  if (!c) return null;
  if (c.status === 'DELETED' || c.status === 'BLINDED') {
    return { id: c.id, status: c.status, content: null, isAnonymous: true, authorUserId: null };
  }
  return {
    id: c.id,
    content: c.content,
    status: c.status || 'ACTIVE',
    isAnonymous: !!c.isAnonymous,
    authorUserId: c.isAnonymous ? null : (c.authorUserId || null),
    audienceScope: c.audienceScope,
    createdAt: c.createdAt,
  };
}

async function buildObservation(postId, viewerContext, filter) {
  const post = await _repo.getSourcePost(postId);
  if (!post) {
    const err = new Error('BOARD_POST_NOT_FOUND');
    err.code = 'BOARD_POST_NOT_FOUND';
    err.status = 404;
    throw err;
  }
  if (post.status === 'DELETED' || post.status === 'BLINDED') {
    return obsCore.buildObservationContract({
      observationType: post.territory === 'CENTRAL'
        ? obsCore.OBSERVATION_TYPE.CENTRAL_OBSERVATION
        : obsCore.OBSERVATION_TYPE.TERRITORY_OBSERVATION,
      sourceTerritory: post.territory,
      sourcePost: { id: post.id, status: post.status, title: null, content: null },
      dataStatus: obsCore.DATA_STATUS.UNAVAILABLE,
      viewerContext,
      activeFilter: filter,
    });
  }

  const earthRaw = await _repo.listEarthComments(postId);
  const alienRaw = await _repo.listAlienComments(postId);
  let contract = obsCore.buildObservationContract({
    observationType: post.territory === 'CENTRAL'
      ? obsCore.OBSERVATION_TYPE.CENTRAL_OBSERVATION
      : obsCore.OBSERVATION_TYPE.TERRITORY_OBSERVATION,
    sourceTerritory: post.territory,
    sourcePost: {
      id: post.id,
      territory: post.territory,
      title: post.title,
      content: post.content,
      status: post.status,
      isAnonymous: !!post.isAnonymous,
      authorUserId: post.isAnonymous ? null : post.authorUserId,
    },
    earthComments: {
      items: earthRaw.map(mapCommentSafe),
      totalCount: earthRaw.length,
    },
    alienComments: {
      items: alienRaw.map(mapCommentSafe),
      totalCount: alienRaw.length,
    },
    earthReactions: post.earthReactions || obsCore.emptyReactions(),
    alienReactions: Object.assign(obsCore.emptyReactions(), post.alienReactions || {}, { exposedToEarthUi: false }),
    viewerContext,
    activeFilter: filter || obsCore.FILTER.ALL,
    dataStatus: obsCore.DATA_STATUS.READY,
    updatedAt: new Date().toISOString(),
  });
  contract = obsCore.filterCommentsByScope(contract, filter || obsCore.FILTER.ALL);
  return obsCore.sanitizeObservationForClient(contract);
}

async function getObservationPost(userId, postId, filter) {
  const ctx = await requireAlienViewer(userId);
  const key = cacheKey(postId, filter);
  const hit = _obsCache.get(key);
  if (hit && Date.now() - hit.at < OBS_TTL_MS) return hit.value;
  if (_pending.has(key)) return _pending.get(key);

  const p = (async function () {
    const post = await _repo.getSourcePost(postId);
    assertObservationReadablePost(post);
    return buildObservation(postId, ctx, filter);
  })().then((value) => {
    _obsCache.set(key, { at: Date.now(), value });
    _pending.delete(key);
    return value;
  }).catch((err) => {
    _pending.delete(key);
    throw err;
  });
  _pending.set(key, p);
  return p;
}

async function listCentralObservation(userId) {
  await requireAlienViewer(userId);
  if (typeof _repo.listObservedPosts === 'function') {
    const pack = await _repo.listObservedPosts({ territory: 'CENTRAL' });
    return {
      observationType: obsCore.OBSERVATION_TYPE.CENTRAL_OBSERVATION,
      items: pack.items || [],
      note: pack.note || null,
      dataStatus: pack.dataStatus || obsCore.DATA_STATUS.READY,
      readOnly: true,
    };
  }
  return {
    observationType: obsCore.OBSERVATION_TYPE.CENTRAL_OBSERVATION,
    items: [],
    note: 'CENTRAL_FEED_SELECTOR_NOT_WIRED',
    dataStatus: obsCore.DATA_STATUS.UNAVAILABLE,
    readOnly: true,
  };
}

async function listTerritoryObservation(userId, territory) {
  await requireAlienViewer(userId);
  const t = String(territory || '').toUpperCase();
  if (t !== 'PIONEER' && t !== 'GUARDIAN' && t !== 'CENTRAL') {
    const err = new Error('ALIEN_OBSERVATION_TERRITORY_FORBIDDEN');
    err.code = 'ALIEN_OBSERVATION_TERRITORY_FORBIDDEN';
    err.status = 403;
    throw err;
  }
  const candidates = await _repo.listTerritoryObservationCandidates(t);
  return {
    observationType: obsCore.OBSERVATION_TYPE.TERRITORY_OBSERVATION,
    sourceTerritory: t,
    boardStageFilter: t === 'CENTRAL' ? null : 1,
    items: candidates.items || [],
    note: candidates.note || null,
    dataStatus: candidates.dataStatus || obsCore.DATA_STATUS.READY,
    readOnly: true,
  };
}

async function createObservationComment() {
  const err = new Error('OBSERVATION_READ_ONLY');
  err.code = 'OBSERVATION_READ_ONLY';
  err.status = 403;
  throw err;
}

async function toggleObservationReaction() {
  const err = new Error('OBSERVATION_READ_ONLY');
  err.code = 'OBSERVATION_READ_ONLY';
  err.status = 403;
  throw err;
}

async function listFreePlaza(userId) {
  const ctx = await requireAlienViewer(userId);
  if (!ctx.canWriteAlienFreePlaza && !ctx.isAlien) {
    const err = new Error('ALIEN_FREE_PLAZA_FORBIDDEN');
    err.code = 'ALIEN_FREE_PLAZA_FORBIDDEN';
    err.status = 403;
    throw err;
  }
  const items = await _repo.listFreePlazaPosts();
  return { territory: 'ALIEN', categoryKey: obsCore.FREE_PLAZA_CATEGORY, items };
}

async function createFreePlazaPost(userId, input) {
  const ctx = await requireAlienViewer(userId);
  if (!ctx.canWriteAlienFreePlaza) {
    const err = new Error('ALIEN_FREE_PLAZA_FORBIDDEN');
    err.code = 'ALIEN_FREE_PLAZA_FORBIDDEN';
    err.status = 403;
    throw err;
  }
  if (_mode === 'API_DRY_RUN') {
    return { ok: true, dryRun: true, territory: 'ALIEN', categoryKey: obsCore.FREE_PLAZA_CATEGORY };
  }
  return _repo.createFreePlazaPost({
    authorUserId: userId,
    title: input && input.title,
    content: input && input.content,
    isAnonymous: !!(input && input.isAnonymous),
  });
}

async function healthCheck() {
  return {
    mode: _mode,
    activated: isActivated(),
    repository: await _repo.healthCheck(),
    cacheSize: _obsCache.size,
  };
}

module.exports = {
  setRepository,
  setDataMode,
  getDataMode,
  isActivated,
  getObservationPost,
  listCentralObservation,
  listTerritoryObservation,
  createObservationComment,
  toggleObservationReaction,
  listFreePlaza,
  createFreePlazaPost,
  invalidateObservationCache,
  invalidateAllObservationCache,
  healthCheck,
  OBS_TTL_MS,
};
