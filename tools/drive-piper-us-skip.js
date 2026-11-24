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
  const dir = path.join(process.env.TEMP || 'C:\\Temp', 'sa-piper-us-' + process.pid);
  fs.mkdirSync(dir, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--mute-audio',
    '--remote-debugging-port=9343', '--remote-allow-origins=*',
    '--user-data-dir=' + dir, '--window-size=1400,900', 'about:blank',
  ], { stdio: 'ignore' });
  let ws;
  const notes = {};
  try {
    let tab = null;
    for (let i = 0; i < 20 && !tab; i += 1) {
      try { tab = await getJson('http://127.0.0.1:9343/json/new?' + encodeURIComponent('http://127.0.0.1:3010/us'), 'PUT'); }
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
    await send('Page.enable');
    await sleep(1500);
    notes.name = await evalJs(`(function(){
      var us = window.getAchievementLocalizedCopy && window.getAchievementLocalizedCopy('piper', 'US');
      var def = window.getAchievementDefinition && window.getAchievementDefinition('piper');
      var krDef = window.ACHIEVEMENT_DEFINITIONS && window.ACHIEVEMENT_DEFINITIONS.filter(function(d){ return d.id === 'piper'; })[0];
      return {
        path: location.pathname,
        usCopy: us && us.name,
        shown: def && def.name,
        id: def && def.id,
        korean: krDef && krDef.name
      };
    })()`);
    const started = await evalJs(`(function(){
      var def = window.getAchievementDefinition('piper');
      window.enqueueAchievementAcquiredAlert(def, {
        achievementId: 'piper', scenePlay: true, activityRegion: 'US', contentRegion: 'US',
        grantStore: 'user_activity_region_achievement', acquisitionSequence: 1, stage: 1,
        acquiredAt: new Date().toISOString()
      }, { contentRegion: 'US' });
      return true;
    })()`);
    notes.started = started;
    let video = null;
    for (let i = 0; i < 30; i += 1) {
      await sleep(400);
      video = await evalJs(`(function(){
        var node = document.querySelector('video.sc-achievement-scene-video');
        var btn = document.querySelector('.sc-achievement-scene-skip');
        if (!node) return null;
        return { src: node.currentSrc || node.src, time: node.currentTime, w: node.videoWidth, skip: btn ? btn.textContent : '' };
      })()`);
      if (video && video.time > 0.2 && video.w > 0) break;
    }
    notes.first = video;
    notes.firstShot = await shot('us-skip.png');
    notes.firstSkip = await evalJs(`(function(){
      var btn = document.querySelector('.sc-achievement-scene-skip');
      if (!btn || btn.textContent !== 'Skip') return 'NO_SKIP';
      btn.click();
      return 'CLICKED';
    })()`);
    await sleep(400);
    notes.afterFirst = await evalJs(`(function(){
      return {
        video: !!document.querySelector('video.sc-achievement-scene-video'),
        skip: !!document.querySelector('.sc-achievement-scene-skip')
      };
    })()`);
    notes.afterFirstShot = await shot('us-after-skip.png');
    notes.replayStart = await evalJs(`(function(){
      var grant = window.grantCurrentUserAchievement('piper', { acquiredAt: new Date().toISOString() });
      var replay = window.replayAchievementScene('piper');
      return { grant: grant && grant.granted, reason: grant && grant.reason, replay: replay };
    })()`);
    let replay = null;
    for (let i = 0; i < 30; i += 1) {
      await sleep(400);
      replay = await evalJs(`(function(){
        var node = document.querySelector('video.sc-achievement-scene-video');
        var btn = document.querySelector('.sc-achievement-scene-skip');
        if (!node) return null;
        return { src: node.currentSrc || node.src, time: node.currentTime, w: node.videoWidth, skip: btn ? btn.textContent : '' };
      })()`);
      if (replay && replay.time > 0.2 && replay.w > 0) break;
    }
    notes.replay = replay;
    notes.replayShot = await shot('us-replay.png');
    notes.replaySkip = await evalJs(`(function(){
      var btn = document.querySelector('.sc-achievement-scene-skip');
      if (!btn || btn.textContent !== 'Skip') return 'NO_SKIP';
      btn.click();
      return 'CLICKED';
    })()`);
    await sleep(400);
    notes.afterReplay = await evalJs(`(function(){
      return {
        video: !!document.querySelector('video.sc-achievement-scene-video'),
        skip: !!document.querySelector('.sc-achievement-scene-skip')
      };
    })()`);
    notes.afterReplayShot = await shot('us-replay-skip.png');
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
