'use strict';
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'C:\\Users\\user\\AppData\\Local\\Cursor\\AgentStores\\cursor_agent_stores\\bc-c953b949-98fb-4f5d-8b49-80c8cb69e605\\files\\media\\ui-sfx';
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
  const dir = path.join(process.env.TEMP || 'C:\\Temp', 'sa-sfx-remain2-' + process.pid);
  fs.mkdirSync(dir, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--mute-audio',
    '--remote-debugging-port=9349', '--remote-allow-origins=*',
    '--user-data-dir=' + dir, '--window-size=1400,900', 'about:blank',
  ], { stdio: 'ignore' });
  let ws;
  const errors = [];
  try {
    let tab = null;
    for (let i = 0; i < 20 && !tab; i += 1) {
      try { tab = await getJson('http://127.0.0.1:9349/json/new?about:blank', 'PUT'); }
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
        errors.push(String((d.exception && d.exception.description) || d.text || '').slice(0, 220));
      }
    });
    function send(method, params) {
      const id = ++seq;
      return new Promise(function (resolve) {
        pending[id] = resolve;
        ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
      });
    }
    function sendRaw(method, params) {
      const id = ++seq;
      ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    }
    async function evalJs(expression) {
      const msg = await send('Runtime.evaluate', { expression: expression, awaitPromise: true, returnByValue: true });
      if (msg.result && msg.result.exceptionDetails) throw new Error(JSON.stringify(msg.result.exceptionDetails).slice(0, 300));
      return msg.result && msg.result.result ? msg.result.result.value : null;
    }
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: 'http://127.0.0.1:3010/us' });
    await sleep(1500);
    await evalJs(`(function(){
      window.__sfxPlays = [];
      window.__sfxDown = [];
      var orig = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        window.__sfxPlays.push({ src: this.currentSrc || this.src || '', t: Date.now() });
        return orig.apply(this, arguments);
      };
      document.addEventListener('pointerdown', function (ev) {
        var el = ev.target && ev.target.closest ? (ev.target.closest('#sc-map-tab-settings') || ev.target) : ev.target;
        window.__sfxDown.push({ t: Date.now(), id: el && el.id || '', trusted: ev.isTrusted });
      }, true);
      sessionStorage.setItem('sc_sb_guest_ok','1');
      if (typeof startSentenceArena === 'function') startSentenceArena();
    })()`);
    await sleep(600);
    const spot = await evalJs(`(function(){
      var el = document.querySelector('#sc-map-tab-settings');
      if (!el) return { missing: true };
      var r = el.getBoundingClientRect();
      var x = r.x + r.width / 2;
      var y = r.y + r.height / 2;
      var hit = document.elementFromPoint(x, y);
      return {
        x: x, y: y, w: r.width, h: r.height,
        inside: r.width > 8 && r.height > 8 && x >= 2 && y >= 2 && x <= window.innerWidth - 2 && y <= window.innerHeight - 2,
        hitId: hit && (hit.id || (hit.closest && hit.closest('#sc-map-tab-settings') && hit.closest('#sc-map-tab-settings').id) || ''),
        match: !!(hit && hit.closest && hit.closest('#sc-map-tab-settings'))
      };
    })()`);
    if (spot && spot.inside && spot.match) {
      for (let i = 0; i < 6; i += 1) {
        sendRaw('Input.dispatchMouseEvent', { type: 'mousePressed', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
        sendRaw('Input.dispatchMouseEvent', { type: 'mouseReleased', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
        await sleep(70);
      }
      await sleep(500);
    }
    const rapid = await evalJs(`(function(){
      var downs = window.__sfxDown.filter(function (d) { return d.id === 'sc-map-tab-settings'; });
      var gaps = [];
      for (var i = 1; i < downs.length; i++) gaps.push(downs[i].t - downs[i - 1].t);
      return { spotPlays: window.__sfxPlays, downs: downs, gaps: gaps };
    })()`);
    await evalJs(`(function(){
      var card = document.querySelector('[data-sc-tcard="central"]');
      if (card) card.click();
    })()`);
    await sleep(300);
    await evalJs(`(function(){
      var enter = document.querySelector('[data-sc-tdetail-enter]');
      if (enter) enter.click();
    })()`);
    await sleep(700);
    const bars = await evalJs(`(function(){
      var nodes = Array.prototype.slice.call(document.querySelectorAll('.origin-mark'));
      var seen = {};
      var visible = null;
      nodes.forEach(function (mark) {
        var bar = mark.querySelector('.origin-mark__bar');
        if (!bar) return;
        var key = mark.getAttribute('data-territory') + ' ' + getComputedStyle(bar).backgroundColor + ' ' + getComputedStyle(bar).width + 'x' + getComputedStyle(bar).height;
        seen[key] = (seen[key] || 0) + 1;
        var r = bar.getBoundingClientRect();
        if (!visible && r.width > 0 && r.height > 0) {
          mark.scrollIntoView({ block: 'center' });
        }
      });
      var first = document.querySelector('.origin-mark__bar');
      if (first) first.scrollIntoView({ block: 'center', inline: 'center' });
      var shown = Array.prototype.slice.call(document.querySelectorAll('.origin-mark__bar')).filter(function (bar) {
        var r = bar.getBoundingClientRect();
        return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
      }).slice(0, 6).map(function (bar) {
        var mark = bar.closest('.origin-mark');
        var r = bar.getBoundingClientRect();
        var cs = getComputedStyle(bar);
        return { territory: mark.getAttribute('data-territory'), w: cs.width, h: cs.height, bg: cs.backgroundColor, x: Math.round(r.x), y: Math.round(r.y), rw: Math.round(r.width), rh: Math.round(r.height) };
      });
      return { kinds: seen, shown: shown, total: nodes.length };
    })()`);
    const png = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT, 'us-plaza-bars.png');
    fs.writeFileSync(file, Buffer.from(png.result.data, 'base64'));
    process.stdout.write(JSON.stringify({ spot: spot, rapid: rapid, bars: bars, shot: fs.statSync(file).size, errors: errors }, null, 2) + '\n');
  } finally {
    if (ws) try { ws.close(); } catch (_) {}
    chrome.kill();
  }
}
main().catch(function (e) { process.stderr.write(String(e.stack || e) + '\n'); process.exit(1); });
