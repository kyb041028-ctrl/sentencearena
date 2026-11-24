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
    req.on('error', reject);
    req.end();
  });
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function main() {
  const dir = path.join(process.env.TEMP || 'C:\\Temp', 'sa-sfx-remain-' + process.pid);
  fs.mkdirSync(dir, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--mute-audio',
    '--remote-debugging-port=9348', '--remote-allow-origins=*',
    '--user-data-dir=' + dir, '--window-size=1920,1080', 'about:blank',
  ], { stdio: 'ignore' });
  let ws;
  const errors = [];
  const consoles = [];
  try {
    let tab = null;
    for (let i = 0; i < 20 && !tab; i += 1) {
      try { tab = await getJson('http://127.0.0.1:9348/json/new?about:blank', 'PUT'); }
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
        const ex = d.exception || {};
        errors.push({
          text: d.text || '',
          description: ex.description || ex.value || '',
          url: d.url || '',
          line: d.lineNumber,
          column: d.columnNumber,
        });
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const args = (msg.params.args || []).map(function (a) { return a.value || a.description || ''; }).join(' ');
        if (msg.params.type === 'error' || msg.params.type === 'warning') consoles.push(String(args).slice(0, 300));
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
        const d = msg.result.exceptionDetails;
        throw new Error(JSON.stringify({ text: d.text, description: d.exception && d.exception.description }).slice(0, 500));
      }
      return msg.result && msg.result.result ? msg.result.result.value : null;
    }
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: 'http://127.0.0.1:3010/us' });
    await sleep(1600);
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
        window.__sfxDown.push({
          t: Date.now(),
          id: el && el.id || '',
          cls: el && el.className || '',
          trusted: ev.isTrusted
        });
      }, true);
      sessionStorage.setItem('sc_sb_guest_ok','1');
      if (typeof startSentenceArena === 'function') startSentenceArena();
    })()`);
    await sleep(700);
    async function clickSel(sel) {
      const info = await evalJs(`(function(){
        var el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return { missing: true };
        el.scrollIntoView({ block: 'center', inline: 'center' });
        var r = el.getBoundingClientRect();
        var x = r.x + Math.min(r.width / 2, 24);
        var y = r.y + Math.min(Math.max(r.height / 2, 8), r.height - 4);
        var inside = x >= 2 && y >= 2 && x <= window.innerWidth - 2 && y <= window.innerHeight - 2;
        var hit = document.elementFromPoint(x, y);
        var ok = !!(hit && (hit === el || el.contains(hit) || (hit.closest && hit.closest(${JSON.stringify(sel)}) === el)));
        return {
          inside: inside, ok: ok, x: x, y: y,
          w: r.width, h: r.height, rectX: r.x, rectY: r.y,
          innerW: window.innerWidth, innerH: window.innerHeight,
          hit: hit ? ((hit.id ? '#' + hit.id : '') + '.' + (hit.className || hit.tagName)) : null
        };
      })()`);
      if (!info || !info.ok || !info.inside) return { clicked: false, info: info };
      const before = await evalJs('window.__sfxPlays.length');
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: info.x, y: info.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.x, y: info.y, button: 'left', clickCount: 1 });
      await sleep(250);
      const plays = await evalJs('window.__sfxPlays.slice(' + before + ')');
      return { clicked: true, info: info, plays: plays };
    }
    const territory = await clickSel('[data-sc-tcard="central"]');
    await sleep(300);
    const board = await clickSel('[data-sc-tdetail-enter]');
    await sleep(500);
    async function plazaFacts() {
      return evalJs(`(function(){
        var bars = Array.prototype.slice.call(document.querySelectorAll('.origin-mark__bar'));
        var posts = document.querySelectorAll('.board__post, .post-card, [data-post-id], .sc-post').length;
        var list = document.querySelector('#centrist-plaza-body, .board__feed, .board__list');
        return {
          barCount: bars.length,
          postCount: posts,
          listText: list ? (list.innerText || '').slice(0, 180) : '',
          bars: bars.slice(0, 8).map(function (bar) {
            var mark = bar.closest('.origin-mark');
            var cs = getComputedStyle(bar);
            return {
              territory: mark ? mark.getAttribute('data-territory') : '',
              w: cs.width, h: cs.height, bg: cs.backgroundColor,
              visible: bar.getClientRects().length > 0
            };
          })
        };
      })()`);
    }
    let plaza = await plazaFacts();
    if (!plaza || !plaza.barCount) {
      await clickSel('.territory-hit-zone--plaza .territory-hit-zone__hit');
      await sleep(600);
      plaza = await plazaFacts();
    }
    const member = await evalJs(`(function(){
      return {
        auth: typeof isAuthenticatedBoardMember === 'function' ? isAuthenticatedBoardMember() : null,
        region: window.SAActivityRegion && window.SAActivityRegion.get ? window.SAActivityRegion.get() : null
      };
    })()`);
    const spot = await evalJs(`(function(){
      var el = document.querySelector('#sc-map-tab-settings');
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      var r = el.getBoundingClientRect();
      var x = r.x + r.width / 2;
      var y = r.y + r.height / 2;
      var hit = document.elementFromPoint(x, y);
      return {
        x: x, y: y,
        inside: x >= 2 && y >= 2 && x <= window.innerWidth - 2 && y <= window.innerHeight - 2,
        hitId: hit && hit.id || '',
        match: !!(hit && (hit === el || hit.closest && hit.closest('#sc-map-tab-settings')))
      };
    })()`);
    const rapidBefore = await evalJs('window.__sfxPlays.length');
    const downBefore = await evalJs('window.__sfxDown.length');
    if (spot && spot.inside && spot.match) {
      for (let i = 0; i < 6; i += 1) {
        send('Input.dispatchMouseEvent', { type: 'mousePressed', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
        send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
        await sleep(70);
      }
      await sleep(400);
    }
    const rapid = await evalJs(`(function(){
      return {
        plays: window.__sfxPlays.slice(${rapidBefore}),
        downs: window.__sfxDown.slice(${downBefore})
      };
    })()`);
    let shot = 0;
    if (plaza && plaza.barCount) {
      const png = await send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, 'us-plaza-bars.png');
      fs.writeFileSync(file, Buffer.from(png.result.data, 'base64'));
      shot = fs.statSync(file).size;
    }
    process.stdout.write(JSON.stringify({
      territory: territory,
      board: board,
      plaza: plaza,
      plazaShot: shot,
      member: member,
      spot: spot,
      rapid: rapid,
      errors: errors,
      consoles: consoles.slice(0, 12),
    }, null, 2) + '\n');
  } finally {
    if (ws) try { ws.close(); } catch (_) {}
    chrome.kill();
  }
}
main().catch(function (err) {
  process.stderr.write(String(err.stack || err) + '\n');
  process.exit(1);
});
