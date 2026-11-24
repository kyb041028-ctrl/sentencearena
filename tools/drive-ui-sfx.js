'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'C:\\Users\\user\\AppData\\Local\\Cursor\\AgentStores\\cursor_agent_stores\\bc-c953b949-98fb-4f5d-8b49-80c8cb69e605\\files\\media\\ui-sfx';
const FILES = ['01_ui_click','02_board_navigate','03_territory_select','04_profile_open','05_tab_switch','06_reaction','07_vote_confirm','08_achievement_unlocked','09_soft_error'];

function getRaw(url) {
  return new Promise(function (resolve, reject) {
    http.get(url, function (res) {
      res.resume();
      resolve(res.statusCode);
    }).on('error', reject);
  });
}
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
  const notes = { http: {} };
  for (const name of FILES) {
    notes.http[name + '.ogg'] = await getRaw('http://127.0.0.1:3010/assets/ui-sfx/ogg/' + name + '.ogg');
    notes.http[name + '.wav'] = await getRaw('http://127.0.0.1:3010/assets/ui-sfx/wav/' + name + '.wav');
  }
  const dir = path.join(process.env.TEMP || 'C:\\Temp', 'sa-sfx-' + process.pid);
  fs.mkdirSync(dir, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--mute-audio',
    '--remote-debugging-port=9344', '--remote-allow-origins=*',
    '--user-data-dir=' + dir, '--window-size=1400,900', 'about:blank',
  ], { stdio: 'ignore' });
  let ws;
  const errors = [];
  try {
    let tab = null;
    for (let i = 0; i < 20 && !tab; i += 1) {
      try { tab = await getJson('http://127.0.0.1:9344/json/new?' + encodeURIComponent('about:blank'), 'PUT'); }
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
      if (msg.method === 'Runtime.exceptionThrown') {
        errors.push(String(msg.params.exceptionDetails && msg.params.exceptionDetails.text || 'exception').slice(0, 180));
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push('console');
      }
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
      fs.writeFileSync(path.join(OUT, name), Buffer.from(msg.result.data, 'base64'));
      return fs.statSync(path.join(OUT, name)).size;
    }
    async function go(url) {
      await send('Page.navigate', { url: url });
      await sleep(1400);
    }
    async function clickSelector(sel) {
      const box = await evalJs(`(function(){
        var el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        var r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
      })()`);
      if (!box || box.w < 2) return null;
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await sleep(180);
      return box;
    }
    await send('Page.enable');
    await send('Runtime.enable');
    const hook = `(function(){
      if (window.__sfxHook) return 'already';
      window.__sfxPlays = [];
      var orig = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        window.__sfxPlays.push({ tag: this.tagName, src: this.currentSrc || this.src });
        return orig.apply(this, arguments);
      };
      window.__sfxHook = true;
      return 'hooked';
    })()`;

    async function regionPass(region) {
      await go('http://127.0.0.1:3010/' + region);
      await evalJs(hook);
      const entered = await evalJs(`(function(){
        sessionStorage.setItem('sc_sb_guest_ok','1');
        if (typeof startSentenceArena === 'function') startSentenceArena();
        return document.body.className;
      })()`);
      await sleep(700);
      const beforeMove = (await evalJs('window.__sfxPlays.length'));
      await evalJs(`(function(){
        var el = document.querySelector('[data-sc-tcard="pioneer"]');
        if (!el) return;
        el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 4, clientY: 4 }));
      })()`);
      const afterMove = await evalJs('window.__sfxPlays.length');
      const out = { entered: entered, hoverAdded: afterMove - beforeMove };
      out.click = await clickSelector('#sc-map-tab-settings');
      out.territory = await clickSelector('[data-sc-tcard="central"]');
      out.board = await clickSelector('[data-sc-tdetail-enter]');
      out.profile = await clickSelector('#avatar-dock-tab');
      out.tab = await clickSelector('#app-tab-guide');
      out.plays = await evalJs('window.__sfxPlays.map(function(p){return p.src;})');
      out.labels = await evalJs(`(function(){
        var t = document.getElementById('sc-sfx-title');
        return { title: t ? t.textContent : null, on: document.getElementById('sc-sfx-enabled') && document.getElementById('sc-sfx-enabled').checked, volume: document.getElementById('sc-sfx-volume') && document.getElementById('sc-sfx-volume').value };
      })()`);
      if (region === 'kr') {
        await evalJs(`(function(){ window.ScUiSfx.setVolume(40); window.ScUiSfx.setEnabled(true); })()`);
        out.settingsShot = await shot('kr-settings.png');
      } else {
        out.settingsShot = await shot('us-settings.png');
      }
      const mark = await evalJs('window.__sfxPlays.length');
      await evalJs(`(function(){
        var def = window.getAchievementDefinition('beta-citizen');
        window.ScUiSfx.unlock();
        window.enqueueAchievementAcquiredAlert(def, { achievementId: 'beta-citizen', acquiredAt: new Date().toISOString(), acquisitionSequence: 1 });
      })()`);
      await sleep(400);
      out.achievement = await evalJs('window.__sfxPlays.slice(' + mark + ').map(function(p){return p.src;})');
      const mark2 = await evalJs('window.__sfxPlays.length');
      await evalJs(`(function(){
        var def = window.getAchievementDefinition('piper');
        window.enqueueAchievementAcquiredAlert(def, {
          achievementId: 'piper', scenePlay: true, activityRegion: '${region === 'us' ? 'US' : 'KR'}', contentRegion: '${region === 'us' ? 'US' : 'KR'}',
          grantStore: 'user_activity_region_achievement', acquisitionSequence: 2, stage: 1, acquiredAt: new Date().toISOString()
        }, { contentRegion: '${region === 'us' ? 'US' : 'KR'}' });
      })()`);
      await sleep(700);
      out.withVideo = await evalJs('window.__sfxPlays.slice(' + mark2 + ').map(function(p){return p.tag + " " + p.src;})');
      await evalJs(`(function(){ var b = document.querySelector('.sc-achievement-scene-skip'); if (b) b.click(); })()`);
      await sleep(200);
      if (region === 'us') {
        const mark3 = await evalJs('window.__sfxPlays.length');
        out.replay = await evalJs(`(function(){
          window.grantCurrentUserAchievement('piper', { acquiredAt: new Date().toISOString() });
          return window.replayAchievementScene('piper');
        })()`);
        await sleep(500);
        out.replayPlays = await evalJs('window.__sfxPlays.slice(' + mark3 + ').map(function(p){return p.tag + " " + p.src;})');
        await evalJs(`(function(){ var b = document.querySelector('.sc-achievement-scene-skip'); if (b) b.click(); })()`);
      }
      return out;
    }

    notes.kr = await regionPass('kr');
    await go('http://127.0.0.1:3010/kr');
    await evalJs(hook);
    notes.afterReload = await evalJs(`(function(){
      var s = window.ScUiSfx.settings();
      return { on: s.on, volume: s.volume, title: document.getElementById('sc-sfx-title') && document.getElementById('sc-sfx-title').textContent };
    })()`);
    notes.us = await regionPass('us');
    notes.afterUs = await evalJs('window.ScUiSfx.settings()');
    const offMark = await evalJs('window.__sfxPlays.length');
    await evalJs('window.ScUiSfx.setEnabled(false)');
    await clickSelector('#sc-settings-close');
    notes.offPlays = await evalJs('window.__sfxPlays.slice(' + offMark + ')');
    await evalJs('window.ScUiSfx.setEnabled(true); window.ScUiSfx.setVolume(25);');
    const rapidMark = await evalJs('window.__sfxPlays.length');
    await evalJs(`(function(){
      var el = document.querySelector('#sc-settings-close') || document.querySelector('#app-tab-history');
      var i;
      for (i = 0; i < 8; i++) {
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, isTrusted: true }));
      }
      return true;
    })()`);
    notes.rapidSyntheticTrusted = await evalJs('window.__sfxPlays.length - ' + rapidMark);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await go('http://127.0.0.1:3010/kr');
    await evalJs(hook);
    await evalJs(`(function(){ sessionStorage.setItem('sc_sb_guest_ok','1'); if (typeof startSentenceArena==='function') startSentenceArena(); })()`);
    await sleep(600);
    notes.mobileClick = await clickSelector('#app-tab-history');
    notes.mobilePlays = await evalJs('window.__sfxPlays.map(function(p){return p.src;})');
    notes.mobileShot = await shot('mobile-settings.png');
    notes.direct = await evalJs(`(async function(){
      window.ScUiSfx.unlock();
      window.ScUiSfx.setEnabled(true);
      window.ScUiSfx.setVolume(25);
      var before = window.__sfxPlays.length;
      window.ScUiSfx.play('reaction');
      await new Promise(function(r){ setTimeout(r, 120); });
      window.ScUiSfx.play('vote');
      await new Promise(function(r){ setTimeout(r, 120); });
      window.ScUiSfx.play('error');
      await new Promise(function(r){ setTimeout(r, 200); });
      return window.__sfxPlays.slice(before).map(function(p){return p.src;});
    })()`);
    notes.errors = errors;
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
