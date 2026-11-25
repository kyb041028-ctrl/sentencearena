'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'C:\\Users\\user\\AppData\\Local\\Cursor\\AgentStores\\cursor_agent_stores\\bc-c953b949-98fb-4f5d-8b49-80c8cb69e605\\files\\media\\pied-piper';

function getJson(url, method) {
  return new Promise(function (resolve, reject) {
    const req = http.request(url, { method: method || 'GET' }, function (res) {
      let body = '';
      res.on('data', function (c) { body += c; });
      res.on('end', function () { try { resolve(JSON.parse(body)); } catch (e) { reject(new Error(body.slice(0, 200))); } });
    });
    req.on('error', reject);
    req.end();
  });
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const dir = path.join(process.env.TEMP || 'C:\\Temp', 'sa-piper-' + process.pid);
  fs.mkdirSync(dir, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--mute-audio',
    '--remote-debugging-port=9341', '--remote-allow-origins=*',
    '--user-data-dir=' + dir, '--window-size=1400,900', 'about:blank',
  ], { stdio: 'ignore' });
  let ws;
  const notes = {};
  try {
    let tab = null;
    for (let i = 0; i < 20 && !tab; i += 1) {
      try { tab = await getJson('http://127.0.0.1:9341/json/new?' + encodeURIComponent('about:blank'), 'PUT'); }
      catch (_) { await sleep(300); }
    }
    if (!tab) throw new Error('chrome tab missing');
    ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise(function (resolve, reject) {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    let seq = 0;
    const pending = {};
    ws.addEventListener('message', function (event) {
      const msg = JSON.parse(event.data);
      if (msg.id && pending[msg.id]) pending[msg.id](msg);
    });
    function send(method, params) {
      const id = ++seq;
      return new Promise(function (resolve) {
        pending[id] = resolve;
        ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
      });
    }
    async function evalJs(expression) {
      const msg = await send('Runtime.evaluate', { expression: expression, awaitPromise: true, returnByValue: true });
      if (msg.result && msg.result.exceptionDetails) {
        throw new Error(JSON.stringify(msg.result.exceptionDetails).slice(0, 500));
      }
      return msg.result && msg.result.result ? msg.result.result.value : null;
    }
    async function shot(name) {
      const msg = await send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, name);
      fs.writeFileSync(file, Buffer.from(msg.result.data, 'base64'));
      return fs.statSync(file).size;
    }
    async function go(url) {
      await send('Page.navigate', { url: url });
      await sleep(1200);
    }
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await go('http://127.0.0.1:3010/kr');
    const compare = await evalJs(`(function(){
      document.body.innerHTML = '<main style="display:flex;gap:12px;background:#111;padding:16px;align-items:flex-start"></main>';
      var labels = ['10 bronze','100 silver','1000 gold','10000 crystal'];
      var files = ['bronze','silver','gold','crystal'];
      files.forEach(function(name, i){
        var box = document.createElement('figure');
        box.style.margin = '0'; box.style.color = '#fff'; box.style.font = '14px sans-serif';
        var img = document.createElement('img');
        img.src = '/assets/achievements/pied-piper/pied_piper_' + name + '_930x710.png';
        img.style.width = '320px'; img.style.height = 'auto'; img.alt = labels[i];
        var cap = document.createElement('figcaption');
        cap.textContent = labels[i];
        box.appendChild(img); box.appendChild(cap);
        document.body.firstChild.appendChild(box);
      });
      return files.length;
    })()`);
    await sleep(800);
    notes.compareBytes = await shot('stages-compare.png');
    notes.compare = compare;

    async function play(region) {
      await go('http://127.0.0.1:3010/' + region.toLowerCase());
      await sleep(500);
      const started = await evalJs(`(function(){
        var def = window.getAchievementDefinition && window.getAchievementDefinition('piper');
        var other = window.getAchievementStoryVideo && window.getAchievementStoryVideo('first-comment', '${region}');
        var mine = window.getAchievementStoryVideo && window.getAchievementStoryVideo('piper', '${region}');
        window.enqueueAchievementAcquiredAlert(def, {
          achievementId: 'piper', scenePlay: true, activityRegion: '${region}', contentRegion: '${region}',
          grantStore: 'user_activity_region_achievement', acquisitionSequence: 1, stage: 4, acquiredAt: new Date().toISOString()
        }, { contentRegion: '${region}' });
        return { other: other && other.src, mine: mine && mine.src, hasDef: !!def };
      })()`);
      let video = null;
      for (let i = 0; i < 30; i += 1) {
        await sleep(400);
        video = await evalJs(`(function(){
          var node = document.querySelector('video.sc-achievement-scene-video');
          if (!node) return null;
          return { src: node.currentSrc || node.src, time: node.currentTime, ready: node.readyState, w: node.videoWidth, h: node.videoHeight, skip: !!document.querySelector('.sc-achievement-scene-skip') };
        })()`);
        if (video && video.time > 0.2 && video.w > 0) break;
      }
      return { started: started, video: video };
    }

    notes.kr = await play('KR');
    notes.krShot = await shot('kr-play.png');
    notes.krSkip = await evalJs(`(function(){
      var btn = document.querySelector('.sc-achievement-scene-skip');
      if (!btn) return 'NO_SKIP';
      btn.click();
      return 'CLICKED';
    })()`);
    await sleep(400);
    notes.krAfterSkip = await evalJs(`(function(){
      return { video: !!document.querySelector('video.sc-achievement-scene-video'), skip: !!document.querySelector('.sc-achievement-scene-skip') };
    })()`);
    notes.krAfterShot = await shot('kr-after-skip.png');

    notes.us = await play('US');
    notes.usShot = await shot('us-play.png');
    await evalJs(`(function(){ var btn = document.querySelector('.sc-achievement-scene-skip'); if (btn) btn.click(); })()`);
    await sleep(300);

    await go('http://127.0.0.1:3010/kr');
    notes.replayStart = await evalJs(`(function(){
      var grant = window.grantCurrentUserAchievement('piper', { acquiredAt: new Date().toISOString() });
      var replay = window.replayAchievementScene('piper');
      return { grant: grant && grant.granted, reason: grant && grant.reason, replay: replay };
    })()`);
    let replayVideo = null;
    for (let i = 0; i < 30; i += 1) {
      await sleep(400);
      replayVideo = await evalJs(`(function(){
        var node = document.querySelector('video.sc-achievement-scene-video');
        if (!node) return null;
        return { src: node.currentSrc || node.src, time: node.currentTime, w: node.videoWidth, skip: !!document.querySelector('.sc-achievement-scene-skip') };
      })()`);
      if (replayVideo && replayVideo.time > 0.2 && replayVideo.w > 0) break;
    }
    notes.replayVideo = replayVideo;
    notes.replayShot = await shot('kr-replay.png');
    notes.replaySkip = await evalJs(`(function(){
      var btn = document.querySelector('.sc-achievement-scene-skip');
      if (!btn) return 'NO_SKIP';
      btn.click();
      return 'CLICKED';
    })()`);
    await sleep(300);
    notes.replayAfter = await evalJs(`!!document.querySelector('video.sc-achievement-scene-video')`);

    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await go('http://127.0.0.1:3010/kr');
    notes.mobile = await evalJs(`(function(){
      var dock = document.getElementById('avatar-dock');
      if (dock) { dock.hidden = false; dock.classList.remove('is-collapsed'); }
      window.renderProfileAchievements({ achievements: [
        { id: 'piper', stage: 3, title: '피리 부는 사나이' },
        { id: 'first-post', title: '첫 글' },
        { id: 'first-comment', title: '첫 댓글' },
        { id: 'territory-citizen', title: 'extra' }
      ]});
      var imgs = Array.prototype.map.call(document.querySelectorAll('#achievementLayer .profile-achievement-img'), function(img){ return img.getAttribute('src'); });
      var frames = document.querySelectorAll('#achievementLayer .profile-achievement-rarity-frame, #achievementLayer .sc-profile-achievement__rarity-frame').length;
      var layer = document.getElementById('achievementLayer');
      if (layer) layer.scrollIntoView({ block: 'center' });
      return { imgs: imgs, extraFrames: frames, slots: document.querySelectorAll('#achievementLayer .profile-achievement-slot').length };
    })()`);
    await sleep(600);
    notes.mobileShot = await shot('mobile-profile.png');
    process.stdout.write(JSON.stringify(notes, null, 2) + '\n');
  } finally {
    if (ws) try { ws.close(); } catch (_) {}
    chrome.kill();
  }
}

main().catch(function (err) {
  process.stderr.write(String(err && err.stack || err) + '\n');
  process.exit(1);
});
