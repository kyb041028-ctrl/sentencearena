'use strict';
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
function getJson(url, method) {
  return new Promise(function (resolve, reject) {
    const req = http.request(url, { method: method || 'GET' }, function (res) {
      let body = '';
      res.on('data', function (c) { body += c; });
      res.on('end', function () { try { resolve(JSON.parse(body)); } catch (e) { reject(new Error(body.slice(0, 180))); } });
    });
    req.on('error', reject);
    req.end();
  });
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function main() {
  const dir = path.join(process.env.TEMP || 'C:\\Temp', 'sa-sfx2-' + process.pid);
  fs.mkdirSync(dir, { recursive: true });
  const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--mute-audio','--remote-debugging-port=9345','--remote-allow-origins=*','--user-data-dir=' + dir,'--window-size=1600,1000','about:blank'], { stdio: 'ignore' });
  let ws;
  const errors = [];
  try {
    let tab = null;
    for (let i = 0; i < 20 && !tab; i += 1) {
      try { tab = await getJson('http://127.0.0.1:9345/json/new?' + encodeURIComponent('http://127.0.0.1:3010/kr'), 'PUT'); }
      catch (_) { await sleep(300); }
    }
    ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise(function (resolve, reject) { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
    let seq = 0; const pending = {};
    ws.addEventListener('message', function (event) {
      const msg = JSON.parse(event.data);
      if (msg.id && pending[msg.id]) pending[msg.id](msg);
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails || {};
        errors.push(String(d.exception && d.exception.description || d.text || 'exception').slice(0, 240));
      }
    });
    function send(method, params) {
      const id = ++seq;
      return new Promise(function (resolve) { pending[id] = resolve; ws.send(JSON.stringify({ id: id, method: method, params: params || {} })); });
    }
    async function evalJs(expression) {
      const msg = await send('Runtime.evaluate', { expression: expression, awaitPromise: true, returnByValue: true });
      if (msg.result && msg.result.exceptionDetails) throw new Error(JSON.stringify(msg.result.exceptionDetails).slice(0, 400));
      return msg.result && msg.result.result ? msg.result.result.value : null;
    }
    await send('Runtime.enable');
    await send('Page.enable');
    await sleep(1200);
    await evalJs(`(function(){
      window.__sfxPlays = [];
      var orig = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        window.__sfxPlays.push((this.currentSrc || this.src || ''));
        return orig.apply(this, arguments);
      };
      sessionStorage.setItem('sc_sb_guest_ok','1');
      if (typeof startSentenceArena === 'function') startSentenceArena();
    })()`);
    await sleep(600);
    async function press(sel, dy) {
      const box = await evalJs(`(function(){
        var el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return null;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        var r = el.getBoundingClientRect();
        return { x: Math.min(window.innerWidth - 4, Math.max(4, r.x + r.width / 2)), y: Math.min(window.innerHeight - 4, Math.max(4, r.y + ${dy || 8})), top: el.tagName + '.' + (el.className || '') };
      })()`);
      if (!box) return { missing: sel };
      const hit = await evalJs(`(function(){
        var el = document.elementFromPoint(${box.x}, ${box.y});
        return el ? (el.id || el.className || el.tagName) : null;
      })()`);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await sleep(200);
      return { box: box, hit: hit };
    }
    const territory = await press('[data-sc-tcard="pioneer"]', 12);
    const board = await press('[data-sc-tdetail-enter]', 8);
    const plays = await evalJs('window.__sfxPlays.slice()');
    const mark = await evalJs('window.__sfxPlays.length');
    const spot = await evalJs(`(function(){
      var el = document.querySelector('#sc-map-tab-settings');
      el.scrollIntoView({ block: 'center' });
      var r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    for (let i = 0; i < 6; i += 1) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
    }
    const rapid = await evalJs('window.__sfxPlays.slice(' + mark + ')');
    await evalJs(`(function(){
      window.ScUiSfx.unlock();
      var def = window.getAchievementDefinition('piper');
      window.enqueueAchievementAcquiredAlert(def, {
        achievementId: 'piper', scenePlay: true, activityRegion: 'KR', contentRegion: 'KR',
        grantStore: 'user_activity_region_achievement', acquisitionSequence: 3, stage: 1, acquiredAt: new Date().toISOString()
      }, { contentRegion: 'KR' });
    })()`);
    await sleep(800);
    const video = await evalJs('window.__sfxPlays.slice()');
    process.stdout.write(JSON.stringify({ territory: territory, board: board, plays: plays, rapid: rapid, video: video, errors: errors }, null, 2) + '\n');
  } finally {
    if (ws) try { ws.close(); } catch (_) {}
    chrome.kill();
  }
}
main().catch(function (err) { process.stderr.write(String(err.stack || err) + '\n'); process.exit(1); });
