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
ok('쿼리만으로는 자동 재생하지 않음', dev.indexOf("params.get('devSenaBeta')") < 0 && dev.indexOf('sa-sena-editor-preview') >= 0 && dev.indexOf('profile-layout-editor') >= 0);
ok('로컬이 아니면 열지 않음', dev.indexOf("host !== '127.0.0.1'") >= 0);
ok('미리보기 행은 지급이 아님', dev.indexOf('showPreviewRow') < 0 && dev.indexOf('sessionStorage.setItem') < 0 && dev.indexOf("innerHTML = ''") < 0);
ok('독립 큰 레이어', dev.indexOf('sa-sena-layer') >= 0 && dev.indexOf('68rem') >= 0 && dev.indexOf('34rem') < 0 && dev.indexOf("state === 'list'") >= 0);
ok('목록은 5초 신호에서만 연다', dev.indexOf('function openListOnce') >= 0 && dev.indexOf('openFeaturedAchievementPanel') >= 0 && dev.indexOf('function playPreview()') >= 0 && dev.slice(dev.indexOf('function playPreview()'), dev.indexOf('function mountButton()')).indexOf('openFeaturedAchievementPanel') < 0);
ok('기존 beta-citizen만', dev.indexOf('data-achievement-id="beta-citizen"') >= 0 && dev.indexOf("innerHTML = ''") < 0 && dev.indexOf('ACHIEVEMENT_DEFINITIONS') < 0 && dev.indexOf('createElement(\'label\')') < 0);
ok('운영 지급 호출 없음', dev.indexOf('grantBetaParticipation') < 0 && dev.indexOf('grantCurrentUserAchievement') < 0 && dev.indexOf('productionGrant: false') >= 0);
ok('6초 형식 유지', animation.indexOf('FORMAT.duration') >= 0 && animation.indexOf('t>=5') >= 0 && animation.indexOf("notify('list')") >= 0 && fs.readFileSync(path.join(root, 'public', 'sena-beta-citizen', 'achievement-format.js'), 'utf8').indexOf('duration:6') >= 0);
ok('완료 후 3초 유지', dev.indexOf('RESULT_HOLD_MS = 3000') >= 0 && dev.indexOf('function scheduleHold()') >= 0 && dev.indexOf('if (holdTimer !== null) return') >= 0 && dev.indexOf("data.state === 'complete') scheduleHold()") >= 0 && dev.indexOf("data.state === 'complete') finish()") < 0);
ok('취소된 타이머는 새 미리보기를 지우지 않음', dev.indexOf('function cancelHold()') >= 0 && dev.indexOf('playToken') >= 0 && dev.indexOf('token !== playToken') >= 0 && dev.slice(dev.indexOf('function clearPreview()'), dev.indexOf('function finish()')).indexOf('cancelHold()') >= 0);
ok('영상 재생 없음', kr.indexOf('.mp4') < 0 && en.indexOf('.mp4') < 0 && kr.indexOf('video-review') < 0 && en.indexOf('video-review') < 0 && kr.indexOf('<section class="showcase">') < 0 && en.indexOf('<section class="showcase">') < 0);
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
