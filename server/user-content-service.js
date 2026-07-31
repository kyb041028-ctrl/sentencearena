'use strict';
/**
 * 사용자 작성글·댓글 목록 service
 * 기본 LEGACY_LOCAL · API_OPERATIONAL 비활성
 */

const core = require('../shared/user-content-list-core');
const { createUserContentMemoryRepository } = require('./user-content-memory-repository');
const { createUserContentSupabaseRepository } = require('./user-content-supabase-repository');

var MODE = {
  LEGACY_LOCAL: 'LEGACY_LOCAL',
  API_DRY_RUN: 'API_DRY_RUN',
  API_OPERATIONAL: 'API_OPERATIONAL',
};

var dataMode = MODE.LEGACY_LOCAL;
var memoryRepo = createUserContentMemoryRepository({ posts: [] });
var supabaseRepo = createUserContentSupabaseRepository();

function setRepository(repo) {
  if (repo) memoryRepo = repo;
}

function setDataMode(mode) {
  var m = String(mode || MODE.LEGACY_LOCAL).toUpperCase();
  if (m === MODE.API_OPERATIONAL) {
    dataMode = MODE.LEGACY_LOCAL;
    return dataMode;
  }
  if (m === MODE.API_DRY_RUN || m === MODE.LEGACY_LOCAL) dataMode = m;
  else dataMode = MODE.LEGACY_LOCAL;
  return dataMode;
}

function getDataMode() {
  return dataMode;
}

function isActivated() {
  return false;
}

function buildContext(query) {
  return {
    isSelf: !!(query && query.isSelf),
    viewerCanSeeAlien: !!(query && query.viewerCanSeeAlien),
    visibilityContext: (query && query.visibilityContext) || null,
    accessContext: (query && query.accessContext) || null,
  };
}

async function listUserContent(query) {
  var q = query || {};
  var contentType = core.normalizeUserContentType(q.contentType) || core.CONTENT_TYPE.POSTS;
  var page = Math.max(1, Math.floor(Number(q.page) || 1));
  var pageSize = Math.max(1, Math.floor(Number(q.pageSize) || core.DEFAULT_PAGE_SIZE));
  var profileUserId = q.profileUserId;
  var ctx = buildContext(q);

  if (q.visibilityContext === 'PRIVATE' && !ctx.isSelf) {
    return core.buildUserContentListViewModel({
      profileUserId: profileUserId,
      contentType: contentType,
      page: 1,
      pageSize: pageSize,
      items: [],
      totalItems: 0,
      dataStatus: core.DATA_STATUS.PRIVATE,
      source: dataMode,
      alreadyPaged: true,
      useFilteredTotal: true,
    });
  }

  if (dataMode === MODE.API_DRY_RUN) {
    return {
      dryRun: true,
      note: 'NO_WRITE',
      query: {
        profileUserId: profileUserId,
        contentType: contentType,
        page: page,
        pageSize: pageSize,
      },
      dataStatus: core.DATA_STATUS.UNAVAILABLE,
      source: MODE.API_DRY_RUN,
    };
  }

  var listed =
    contentType === core.CONTENT_TYPE.COMMENTS
      ? memoryRepo.listCommentsByAuthor(profileUserId, { page: 1, pageSize: 10000 }, ctx)
      : memoryRepo.listPostsByAuthor(profileUserId, { page: 1, pageSize: 10000 }, ctx);

  return core.buildUserContentListViewModel({
    profileUserId: profileUserId,
    contentType: contentType,
    page: page,
    pageSize: pageSize,
    items: listed.items || [],
    isSelf: ctx.isSelf,
    viewerCanSeeAlien: ctx.viewerCanSeeAlien,
    dataStatus: core.DATA_STATUS.LEGACY_MOCK,
    source: MODE.LEGACY_LOCAL,
    profileCount: q.profileCount,
    useFilteredTotal: true,
  });
}

async function getPostNavigationTarget(postId, context) {
  return memoryRepo.getPostNavigationTarget(postId, context);
}

async function getCommentNavigationTarget(commentId, context) {
  return memoryRepo.getCommentNavigationTarget(commentId, context);
}

function healthCheck() {
  return {
    ok: true,
    mode: dataMode,
    activated: isActivated(),
    writeEnabled: false,
    supabase: false,
  };
}

module.exports = {
  MODE: MODE,
  setRepository: setRepository,
  setDataMode: setDataMode,
  getDataMode: getDataMode,
  isActivated: isActivated,
  listUserContent: listUserContent,
  getPostNavigationTarget: getPostNavigationTarget,
  getCommentNavigationTarget: getCommentNavigationTarget,
  healthCheck: healthCheck,
  _memoryRepo: function () {
    return memoryRepo;
  },
  _supabaseRepo: function () {
    return supabaseRepo;
  },
};
