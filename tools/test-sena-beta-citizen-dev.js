'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
let pass = 0;
let fail = 0;
function ok(label, cond) {
  if (cond) { console.log('PASS: ' + label); pass += 1; }
  else { console.log('FAIL: ' + label); fail += 1; }
}
const dev = fs.readFileSync(path.join(root, 'public', 'sena-beta-citizen-dev.js'), 'utf8');
const animation = fs.readFileSync(path.join(root, 'public', 'sena-beta-citizen', 'animation.js'), 'utf8');
const kr = fs.readFileSync(path.join(root, 'public', 'sena-beta-citizen', 'play-kr.html'), 'utf8');
const en = fs.readFileSync(path.join(root, 'public', 'sena-beta-citizen', 'play-en.html'), 'utf8');
ok('쿼리 없으면 열지 않음', dev.indexOf("params.get('devSenaBeta')") >= 0 && dev.indexOf('return;') >= 0);
ok('로컬이 아니면 열지 않음', dev.indexOf("host !== '127.0.0.1'") >= 0);
ok('기존 업적 패널 안에서 연다', dev.indexOf('openFeaturedAchievementPanel') >= 0 && dev.indexOf('sc-achievement-history-list') >= 0 && dev.indexOf('sa-sena-beta') < 0);
ok('기존 beta-citizen만', dev.indexOf('data-achievement-id="beta-citizen"') >= 0 && dev.indexOf("innerHTML = ''") < 0 && dev.indexOf('ACHIEVEMENT_DEFINITIONS') < 0 && dev.indexOf('createElement(\'label\')') < 0);
ok('운영 지급 호출 없음', dev.indexOf('grantBetaParticipation') < 0 && dev.indexOf('grantCurrentUserAchievement') < 0 && dev.indexOf('productionGrant: false') >= 0);
ok('6초 형식 유지', animation.indexOf('FORMAT.duration') >= 0 && fs.readFileSync(path.join(root, 'public', 'sena-beta-citizen', 'achievement-format.js'), 'utf8').indexOf('duration:6') >= 0);
ok('영상 재생 없음', kr.indexOf('.mp4') < 0 && en.indexOf('.mp4') < 0 && kr.indexOf('video-review') < 0 && en.indexOf('video-review') < 0 && kr.indexOf('<section class="showcase">') < 0 && en.indexOf('<section class="showcase">') < 0);
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
