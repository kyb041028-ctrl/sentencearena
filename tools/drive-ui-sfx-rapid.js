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
      res.on('end', function () { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.end();
  });
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function main() {
  const dir = path.join(process.env.TEMP || 'C:\\Temp', 'sa-sfx-rapid-' + process.pid);
  fs.mkdirSync(dir, { recursive: true });
  const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--mute-audio','--remote-debugging-port=9350','--remote-allow-origins=*','--user-data-dir=' + dir,'--window-size=1400,900','about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let tab = null;
    for (let i = 0; i < 20 && !tab; i += 1) {
      try { tab = await getJson('http://127.0.0.1:9350/json/new?' + encodeURIComponent('http://127.0.0.1:3010/us'), 'PUT'); }
      catch (_) { await sleep(300); }
    }
    ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise(function (resolve, reject) { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
    let seq = 0; const pending = {};
    ws.addEventListener('message', function (event) {
      const msg = JSON.parse(event.data);
      if (msg.id && pending[msg.id]) pending[msg.id](msg);
    });
    function send(method, params) {
      const id = ++seq;
      return new Promise(function (resolve) { pending[id] = resolve; ws.send(JSON.stringify({ id: id, method: method, params: params || {} })); });
    }
    async function evalJs(expression) {
      const msg = await send('Runtime.evaluate', { expression: expression, awaitPromise: true, returnByValue: true });
      return msg.result && msg.result.result ? msg.result.result.value : null;
    }
    await sleep(1400);
    await evalJs(`(function(){
      window.__sfxPlays = [];
      window.__sfxDown = [];
      var orig = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        window.__sfxPlays.push(this.currentSrc || this.src || '');
        return orig.apply(this, arguments);
      };
      document.addEventListener('pointerdown', function (ev) {
        var el = ev.target;
        var btn = el && el.closest ? el.closest('#sc-map-tab-settings') : null;
        window.__sfxDown.push({ t: Date.now(), id: btn ? btn.id : (el && el.id || el && el.className || ''), trusted: ev.isTrusted });
      }, true);
      sessionStorage.setItem('sc_sb_guest_ok','1');
      if (typeof startSentenceArena === 'function') startSentenceArena();
    })()`);
    await sleep(500);
    const spot = await evalJs(`(function(){
      var el = document.querySelector('#sc-map-tab-settings');
      var r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
    })()`);
    for (let i = 0; i < 6; i += 1) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
      await sleep(30);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
      await sleep(20);
    }
    await sleep(300);
    const out = await evalJs(`(function(){
      var downs = window.__sfxDown;
      var gaps = [];
      for (var i = 1; i < downs.length; i++) gaps.push(downs[i].t - downs[i - 1].t);
      var onButton = downs.filter(function (d) { return d.id === 'sc-map-tab-settings' && d.trusted; }).length;
      return { downs: downs, gaps: gaps, onButton: onButton, plays: window.__sfxPlays, recent: window.ScUiSfx.recent() };
    })()`);
    process.stdout.write(JSON.stringify({ spot: spot, out: out }, null, 2) + '\n');
  } finally {
    if (ws) try { ws.close(); } catch (_) {}
    chrome.kill();
  }
}
main().catch(function (e) { process.stderr.write(String(e.stack || e) + '\n'); process.exit(1); });
