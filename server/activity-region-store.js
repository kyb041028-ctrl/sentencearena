'use strict';

const core = require('../shared/activity-region-core');

function createActivityRegionStore() {
  var profiles = {};

  function bucket(userId, region) {
    var key = core.profileKey(userId, region);
    if (!profiles[key]) profiles[key] = core.blankProfile(userId, core.legacyRegion(region));
    return profiles[key];
  }

  function readProfile(userId, region) {
    var row = bucket(userId, region);
    return JSON.parse(JSON.stringify(row));
  }

  function writeActivity(input) {
    var src = input || {};
    if (src.guest) {
      var guestErr = new Error('GUEST_READ_ONLY');
      guestErr.code = 'GUEST_READ_ONLY';
      throw guestErr;
    }
    var gate = core.assertWriteRegion(src.activeRegion, src.requestedRegion);
    if (!gate.ok) {
      var mismatch = new Error(gate.error);
      mismatch.code = gate.error;
      throw mismatch;
    }
    var row = bucket(src.userId, gate.region);
    if (src.post) {
      row.posts.push({
        id: 'p-' + row.posts.length + '-' + gate.region,
        title: String(src.post.title || ''),
        body: String(src.post.body || ''),
        region: gate.region,
        userId: String(src.userId),
      });
      row.feed.push({ type: 'post', region: gate.region, title: String(src.post.title || '') });
    }
    if (src.comment) {
      row.comments.push({ body: String(src.comment.body || ''), region: gate.region });
    }
    if (src.reaction) {
      row.reactions.push({ kind: String(src.reaction.kind || 'like'), region: gate.region });
    }
    if (src.xp) row.xp += Number(src.xp) || 0;
    if (src.fame) row.fame += Number(src.fame) || 0;
    if (src.aura) row.aura += Number(src.aura) || 0;
    if (src.evolution) row.evolution += Number(src.evolution) || 0;
    if (src.day30) row.day30 = Number(src.day30) || 0;
    if (src.day99) row.day99 = Number(src.day99) || 0;
    if (src.tendency) row.tendency = JSON.parse(JSON.stringify(src.tendency));
    if (src.territory) row.territory = String(src.territory);
    if (src.achievement) row.achievements.push(String(src.achievement));
    if (src.notice) {
      row.notices.push({
        id: 'n-' + row.notices.length + '-' + gate.region,
        text: String(src.notice.text || ''),
        region: gate.region,
      });
    }
    if (src.bookmark) {
      row.bookmarks.push({ postId: String(src.bookmark.postId || ''), region: gate.region });
    }
    if (src.rank != null) row.rank = src.rank;
    if (src.level) row.level = Number(src.level) || row.level;
    return readProfile(src.userId, gate.region);
  }

  function listPosts(region) {
    var want = core.legacyRegion(region);
    var out = [];
    Object.keys(profiles).forEach(function (key) {
      var row = profiles[key];
      if (core.legacyRegion(row.region) !== want) return;
      (row.posts || []).forEach(function (post) {
        if (core.legacyRegion(post.region) === want) out.push(post);
      });
    });
    return JSON.parse(JSON.stringify(out));
  }

  function importLegacy(record) {
    var region = core.legacyRegion(record && record.region);
    var row = bucket(record.userId, region);
    if (record.post) {
      row.posts.push({
        title: String(record.post.title || ''),
        region: region,
        userId: String(record.userId),
        legacy: record.region == null || record.region === '',
      });
    }
    return readProfile(record.userId, region);
  }

  function searchPosts(region, query) {
    var q = String(query || '').trim().toLowerCase();
    return listPosts(region).filter(function (post) {
      if (!q) return true;
      return String(post.title || '').toLowerCase().indexOf(q) !== -1
        || String(post.body || '').toLowerCase().indexOf(q) !== -1;
    });
  }

  return {
    readProfile: readProfile,
    writeActivity: writeActivity,
    listPosts: listPosts,
    searchPosts: searchPosts,
    importLegacy: importLegacy,
  };
}

module.exports = {
  createActivityRegionStore: createActivityRegionStore,
};
