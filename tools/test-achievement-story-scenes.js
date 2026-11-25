'use strict';

/**
 * 02·03 스토리 연결. 지급 조건과 01 분기는 검사만 하고 바꾸지 않는다.
 * node tools/test-achievement-story-scenes.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let failed = 0;

function line(ok, name) {
  if (!ok) failed += 1;
  process.stdout.write((ok ? 'PASS ' : 'FAIL ') + name + '\n');
}

function load(rel, sandbox) {
  vm.runInNewContext(fs.readFileSync(path.join(root, rel), 'utf8'), sandbox, { filename: rel });
}

const assets = {};
load('public/achievement-approved-assets.js', assets);
const commentKr = assets.getAchievementStoryVideo('first-comment', 'KR');
const commentUs = assets.getAchievementStoryVideo('first-comment', 'US');
const empathyKr = assets.getAchievementStoryVideo('first-empathy-received', 'KR');
const empathyUs = assets.getAchievementStoryVideo('first-empathy-received', 'US');
line(commentKr.src.indexOf('first-comment-kr.mp4') !== -1 && commentKr.includesPresentation === true, '1-02-kr-file');
line(commentUs.src.indexOf('first-comment-us.mp4') !== -1 && commentUs.src !== commentKr.src, '2-02-us-file-not-shared');
line(empathyKr.src.indexOf('first-empathy-kr.mp4') !== -1, '3-03-kr-file');
line(empathyUs.src.indexOf('first-empathy-us.mp4') !== -1 && empathyUs.src !== empathyKr.src, '4-03-us-file-not-swapped');
line(assets.getAchievementStoryVideo('first-comment', '') == null, '5-missing-country-no-file');
line(assets.getAchievementStoryVideo('first-post', 'KR') == null, '5b-01-not-in-story-map');
line(
  assets.getFirstPostSceneVideo('KR') === '/assets/achievements/first-post/first-post-kr-hq.mp4' &&
  assets.getFirstPostSceneVideo('US') === '/assets/achievements/first-post/first-post-us-hq.mp4',
  '10-01-paths-unchanged'
);
line(assets.getApprovedAchievementAsset('first-comment').stars === 1, '9-02-star-count-unchanged');
line(assets.getApprovedAchievementAsset('first-empathy-received').stars === 1, '9-03-star-count-unchanged');

const alertSrc = fs.readFileSync(path.join(root, 'public/achievement-acquired-alert.js'), 'utf8');
const firstFn = alertSrc.slice(alertSrc.indexOf('function firstPostSceneSrc'), alertSrc.indexOf('function storySceneSrc'));
line(firstFn.indexOf('first-comment') === -1 && firstFn.indexOf('14000') === -1, '10-01-branch-untouched');
line(alertSrc.indexOf('function storySceneSrc') !== -1, '3-story-branch-separate');

function scene(pathname, record, explicit) {
  const made = [];
  function node() {
    const el = {
      style: { setProperty: function () {} },
      className: '',
      src: '',
      dataset: {},
      children: [],
      classList: { add: function () {}, remove: function () {} },
      setAttribute: function () {},
      addEventListener: function () {},
      appendChild: function (child) { el.children.push(child); },
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      remove: function () {},
      play: function () { return { catch: function () { return { catch: function () {} }; } }; },
    };
    made.push(el);
    return el;
  }
  const sandbox = {
    console: console,
    setTimeout: function () {},
    clearTimeout: function () {},
    document: {
      documentElement: { style: {} },
      body: node(),
      getElementById: function () { return null; },
      createElement: node,
      querySelectorAll: function () { return []; },
    },
    location: { pathname: pathname },
    ActivityRegionCore: {
      pathRegion: function (value) {
        if (value === '/kr' || String(value).indexOf('/kr/') === 0) return 'KR';
        if (value === '/us' || String(value).indexOf('/us/') === 0) return 'US';
        return null;
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  load('public/achievement-approved-assets.js', sandbox);
  load('public/achievement-acquired-alert.js', sandbox);
  sandbox.enqueueAchievementAcquiredAlert({ id: record.achievementId, name: 't' }, record, {
    contentRegion: explicit,
  });
  const video = made.filter(function (el) { return el.className === 'sc-achievement-scene-video'; })[0] || null;
  return video ? video.src : '';
}

const krRecord = {
  achievementId: 'first-comment',
  scenePlay: true,
  activityRegion: 'KR',
  contentRegion: 'KR',
  grantStore: 'user_achievements',
};
line(scene('/kr', krRecord, 'KR').indexOf('first-comment-kr.mp4') !== -1, '1-kr-plays-kr-story');
line(scene('/us', Object.assign({}, krRecord, {
  activityRegion: 'US', contentRegion: 'US', grantStore: 'user_activity_region_achievement',
}), 'US').indexOf('first-comment-us.mp4') !== -1, '5-us-plays-us-story');
const oldRecord = Object.assign({}, krRecord, { scenePlay: false });
line(scene('/kr', oldRecord, 'KR') === '', '7-old-record-does-not-play-story');
const usOnKr = Object.assign({}, krRecord, {
  activityRegion: 'US',
  contentRegion: 'US',
  grantStore: 'user_activity_region_achievement',
});
line(scene('/kr', usOnKr, 'US') === '', '6-kr-page-does-not-play-us-file');
line(scene('/us', krRecord, 'KR') === '', '8-us-page-does-not-replay-kr-grant');

const bytes = {
  'first-comment-kr.mp4': 6792520,
  'first-comment-us.mp4': 6838763,
  'first-empathy-kr.mp4': 6519580,
  'first-empathy-us.mp4': 6592143,
};
Object.keys(bytes).forEach(function (name) {
  const size = fs.statSync(path.join(root, 'public/assets/achievements/story', name)).size;
  line(size === bytes[name], 'bytes-' + name + ' ' + size);
});

process.stdout.write((failed ? 'FAIL ' : 'PASS ') + '\n');
process.exit(failed ? 1 : 0);
