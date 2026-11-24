(function (global) {
  'use strict';
  // Display difficulty only. Award conditions and canonical rarity are independent.
  var entries = {
    'first-post': ['01', 1],
    'first-comment': ['02', 1],
    'first-empathy-received': ['03', 1],
    'territory-citizen': ['04', 2],
    'steady-footsteps': ['05', 2],
    'record-builder': ['06', 2],
    'conversation-bridge': ['07', 2],
    'empathy-from-many': ['08', 3],
    'beta-citizen': ['11', 2],
    'bug-busters': ['12', 4],
  };
  global.getApprovedAchievementAsset = function (id) {
    if (!Object.prototype.hasOwnProperty.call(entries, id)) return null;
    var entry = entries[id];
    var base = '/assets/achievements/v1/' + entry[0] + '/achievement_';
    return { profile: base + '93x71.png', full: base + '930x710.png', stars: entry[1] };
  };
  var firstPostScene = {
    KR: '/assets/achievements/first-post/first-post-kr-hq.mp4',
    US: '/assets/achievements/first-post/first-post-us-hq.mp4',
  };
  global.getFirstPostSceneVideo = function (region) {
    if (region !== 'KR' && region !== 'US') return null;
    return firstPostScene[region];
  };
  var storyScenes = {
    'first-comment': {
      includesPresentation: true,
      KR: '/assets/achievements/story/first-comment-kr.mp4',
      US: '/assets/achievements/story/first-comment-us.mp4',
    },
    'first-empathy-received': {
      includesPresentation: true,
      KR: '/assets/achievements/story/first-empathy-kr.mp4',
      US: '/assets/achievements/story/first-empathy-us.mp4',
    },
    'territory-citizen': {
      includesPresentation: true,
      holdMs: 12000,
      KR: '/assets/achievements/story/territory-citizen-kr.mp4',
      US: '/assets/achievements/story/territory-citizen-us.mp4',
    },
    'invite-show-up': {
      includesPresentation: true,
      holdMs: 16000,
      KR: '/assets/achievements/story/invite-show-up-kr.mp4',
      US: '/assets/achievements/story/invite-show-up-us.mp4',
    },
    'invite-pulled-in': {
      includesPresentation: true,
      holdMs: 16000,
      KR: '/assets/achievements/story/invite-pulled-in-kr.mp4',
      US: '/assets/achievements/story/invite-pulled-in-us.mp4',
    },
    piper: {
      includesPresentation: true,
      holdMs: 120000,
      KR: '/assets/achievements/pied-piper/pied-piper-kr-v5.mp4',
      US: '/assets/achievements/pied-piper/pied-piper-us-v5.mp4',
    },
  };
  var piperStageFile = { 1: 'bronze', 2: 'silver', 3: 'gold', 4: 'crystal' };
  global.getPiperStageImage = function (stage) {
    var key = piperStageFile[Number(stage)];
    if (!key) return null;
    var base = '/assets/achievements/pied-piper/pied_piper_' + key + '_';
    return { profile: base + '93x71.png', full: base + '930x710.png' };
  };
  var inviteProfileMinis = {
    'invite-show-up': {
      profile: '/assets/achievements/invite/01_one_more_thief_mask_93x71.png',
      stars: 5,
    },
    'invite-pulled-in': {
      profile: '/assets/achievements/invite/02_you_were_dragged_bossam_bundle_93x71.png',
      stars: 3,
    },
  };
  global.getInviteProfileMini = function (id) {
    if (!Object.prototype.hasOwnProperty.call(inviteProfileMinis, id)) return null;
    return inviteProfileMinis[id];
  };
  global.getAchievementStoryVideo = function (id, region) {
    if (region !== 'KR' && region !== 'US') return null;
    var row = storyScenes[id];
    if (!row || !row[region]) return null;
    return {
      src: row[region],
      includesPresentation: row.includesPresentation === true,
      holdMs: row.holdMs > 0 ? row.holdMs : 0,
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
