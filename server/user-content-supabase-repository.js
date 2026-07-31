'use strict';
/**
 * 사용자 콘텐츠 Supabase repository stub — migration/운영 미적용
 */

function createUserContentSupabaseRepository() {
  function notReady(method) {
    return {
      ok: false,
      method: method,
      error: 'USER_CONTENT_SUPABASE_NOT_READY',
      note: 'migration_not_applied',
    };
  }

  return {
    listPostsByAuthor: async function () {
      return Object.assign({ items: [], total: 0 }, notReady('listPostsByAuthor'));
    },
    countPostsByAuthor: async function () {
      return Object.assign({ total: 0 }, notReady('countPostsByAuthor'));
    },
    listCommentsByAuthor: async function () {
      return Object.assign({ items: [], total: 0 }, notReady('listCommentsByAuthor'));
    },
    countCommentsByAuthor: async function () {
      return Object.assign({ total: 0 }, notReady('countCommentsByAuthor'));
    },
    getPostNavigationTarget: async function () {
      return notReady('getPostNavigationTarget');
    },
    getCommentNavigationTarget: async function () {
      return notReady('getCommentNavigationTarget');
    },
    healthCheck: async function () {
      return { ok: false, mode: 'SUPABASE_STUB', writeEnabled: false, migrationApplied: false };
    },
  };
}

module.exports = {
  createUserContentSupabaseRepository: createUserContentSupabaseRepository,
};
