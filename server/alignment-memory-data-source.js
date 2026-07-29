'use strict';

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function createAlignmentMemoryDataSource(options) {
  const opts = options || {};
  const users = Array.isArray(opts.users) ? clone(opts.users) : [];
  const reactions = Array.isArray(opts.reactions) ? clone(opts.reactions) : [];
  const failUsers = !!opts.failUsers;
  const failReactions = !!opts.failReactions;

  return {
  listAlignmentUsers() {
      if (failUsers) {
        const err = new Error('ALIGNMENT_USER_LOAD_FAILED');
        err.code = 'ALIGNMENT_USER_LOAD_FAILED';
        throw err;
      }
      return clone(users);
    },
    listAlignmentReactions() {
      if (failReactions) {
        const err = new Error('ALIGNMENT_REACTION_LOAD_FAILED');
        err.code = 'ALIGNMENT_REACTION_LOAD_FAILED';
        throw err;
      }
      return clone(reactions);
    },
  };
}

module.exports = {
  createAlignmentMemoryDataSource,
};
