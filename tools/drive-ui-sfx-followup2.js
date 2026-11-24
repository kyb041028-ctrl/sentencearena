'use strict';
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HOOK = fs.readFileSync(path.join(__dirname, 'drive-ui-sfx-followup.js'), 'utf8').match(/const HOOK = `([\s\S]*?)`;/)[1];
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
  const dir = path.join(process.env.TEMP || 'C:\\Temp', 'sa-sfx-fu2-' + process.pid);
  fs.mkdirSync(dir, { recursive: true });
  const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--mute-audio','--remote-debugging-port=9352','--remote-allow-origins=*','--user-data-dir=' + dir,'--window-size=1400,900','about:blank'], { stdio: 'ignore' });
  let ws;
  const errors = [];
  try {
    let tab = null;
    for (let i = 0; i < 20 && !tab; i += 1) {
      try { tab = await getJson('http://127.0.0.1:9352/json/new?about:blank', 'PUT'); }
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
        errors.push(String((d.exception && d.exception.description) || d.text || '').slice(0, 180));
      }
      if (msg.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
    });
    function send(method, params) {
      const id = ++seq;
      return new Promise(function (resolve) { pending[id] = resolve; ws.send(JSON.stringify({ id: id, method: method, params: params || {} })); });
    }
    async function evalJs(expression) {
      const msg = await send('Runtime.evaluate', { expression: expression, awaitPromise: true, returnByValue: true });
      if (msg.result && msg.result.exceptionDetails) throw new Error(JSON.stringify(msg.result.exceptionDetails).slice(0, 350));
      return msg.result && msg.result.result ? msg.result.result.value : null;
    }
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
    async function clickSel(sel) {
      const info = await evalJs(`(function(){
        var el = document.querySelector(${JSON.stringify(sel)});
        if (!el || el.disabled) return { missing: !el, disabled: !!(el && el.disabled) };
        el.scrollIntoView({ block: 'center', inline: 'center' });
        var r = el.getBoundingClientRect();
        var x = r.x + r.width / 2, y = r.y + r.height / 2;
        var hit = document.elementFromPoint(x, y);
        var ok = r.width > 8 && r.height > 8 && x > 2 && y > 2 && x < window.innerWidth - 2 && y < window.innerHeight - 2 && hit && (hit === el || el.contains(hit));
        return { ok: ok, x: x, y: y, hit: hit ? (hit.id || hit.className || hit.tagName) : null };
      })()`);
      if (!info || !info.ok) return { clicked: false, info: info };
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: info.x, y: info.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.x, y: info.y, button: 'left', clickCount: 1 });
      return { clicked: true, info: info };
    }
    const votes = {};
    for (const mode of ['duplicate', 'fail', 'slow', 'deny', 'deny2']) {
      await send('Page.navigate', { url: 'http://127.0.0.1:3010/kr?devLeaderElection=1&electionId=mock-el' });
      await sleep(1200);
      await evalJs('window.__sfxMock.vote = ' + JSON.stringify(mode === 'deny2' ? 'deny' : mode));
      const cand = await clickSel('[data-candidate]');
      await sleep(450);
      const mark = await evalJs('window.__sfxPlays.length');
      const started = Date.now();
      const confirm = await clickSel('[data-confirm="1"]');
      let during = null;
      if (mode === 'slow') {
        await sleep(250);
        during = await evalJs('window.__sfxPlays.slice(' + mark + ')');
        await sleep(700);
      } else await sleep(450);
      votes[mode] = {
        cand: cand, confirm: confirm, during: during,
        plays: await evalJs('window.__sfxPlays.slice(' + mark + ')'),
        waited: Date.now() - started
      };
    }

    await send('Page.navigate', { url: 'http://127.0.0.1:3010/kr' });
    await sleep(1300);
    const reaction = await evalJs(`(async function(){
      sessionStorage.setItem('sc_sb_guest_ok','1');
      if (typeof startSentenceArena === 'function') startSentenceArena();
      await new Promise(function (r) { setTimeout(r, 500); });
      window.__scAuthUserId = '11111111-1111-4111-8111-111111111111';
      window.__scPlayer = { userId: '11111111-1111-4111-8111-111111111111' };
      var listed = null;
      try {
        var data = await window.listMemberCanonicalBoardPosts({ status: 'ACTIVE' });
        listed = { n: data && data.posts ? data.posts.length : 0, id: data && data.posts && data.posts[0] && data.posts[0].id };
      } catch (e) { listed = { err: String(e && (e.code || e.message) || e), status: e && e.status }; }
      var hydrated = await new Promise(function (resolve) {
        if (typeof window.__scHydrateMemberCanonicalBoardFeed !== 'function') resolve('missing');
        else window.__scHydrateMemberCanonicalBoardFeed(function (ok) { resolve(!!ok); });
      });
      if (window.__scApp && window.__scApp.goBoard) window.__scApp.goBoard('COMMON');
      await new Promise(function (r) { setTimeout(r, 400); });
      var found = window.findPostByIdAnywhere ? window.findPostByIdAnywhere('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') : null;
      function buttons(sel) {
        return Array.prototype.slice.call(document.querySelectorAll(sel)).slice(0, 2).map(function (el) {
          return { disabled: !!el.disabled, w: el.getBoundingClientRect().width };
        });
      }
      return { listed: listed, hydrated: hydrated, found: found ? found.post.source : null, empathy: buttons('.sc-react-btn--empathy'), like: buttons('.sc-react-btn--like') };
    })()`);
    async function react(mode) {
      await evalJs('window.__sfxMock.empathy=' + JSON.stringify(mode) + ';window.__sfxMock.reaction=' + JSON.stringify(mode));
      const mark = await evalJs('window.__sfxPlays.length');
      let click = await clickSel('.sc-react-btn--like:not([disabled])');
      if (!click.clicked) click = await clickSel('.sc-react-btn--empathy:not([disabled])');
      await sleep(500);
      return { click: click, plays: await evalJs('window.__sfxPlays.slice(' + mark + ')') };
    }
    const reactOk = await react('success');
    const reactBad = await react('fail');
    const reactDeny = await react('deny');
    const reactDeny2 = await react('deny');

    await evalJs(`(function(){ if (window.__scApp && window.__scApp.goMain) window.__scApp.goMain(); })()`);
    await sleep(300);
    const probe = await evalJs(`(async function(){
      var ids = ['sc-map-tab-search','sc-map-tab-ranking','sc-tendency-mini','sc-map-tab-bookmarks'];
      var out = [];
      for (var i = 0; i < ids.length; i++) {
        var el = document.getElementById(ids[i]);
        if (!el) continue;
        var r = el.getBoundingClientRect();
        var x = r.x + r.width / 2, y = r.y + r.height / 2;
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
        var hit = document.elementFromPoint(x, y);
        out.push({ id: ids[i], still: !!(hit && (hit === el || el.contains(hit))), x: x, y: y });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
      return out;
    })()`);
    const stable = (probe || []).find(function (row) { return row.still; }) || null;
    async function burst(gap) {
      if (!stable) return { missing: true, probe: probe };
      const markDown = await evalJs('window.__sfxDown.length');
      const markPlay = await evalJs('window.__sfxPlays.length');
      for (let i = 0; i < 4; i += 1) {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: stable.x, y: stable.y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: stable.x, y: stable.y, button: 'left', clickCount: 1 });
        if (i < 3) await sleep(gap);
      }
      await sleep(300);
      return evalJs(`(function(){
        var downs = window.__sfxDown.slice(${markDown}).filter(function (d) { return d.trusted; });
        var gaps = [];
        for (var i = 1; i < downs.length; i++) gaps.push(downs[i].t - downs[i - 1].t);
        return {
          button: ${JSON.stringify(stable && stable.id)},
          requested: ${gap},
          ids: downs.map(function (d) { return d.id; }),
          gaps: gaps,
          plays: window.__sfxPlays.slice(${markPlay}).map(function (p) { return p.src; })
        };
      })()`);
    }
    const bursts = [];
    for (const gap of [30, 50, 100]) {
      bursts.push(await burst(gap));
      await sleep(700);
    }
    process.stdout.write(JSON.stringify({ votes: votes, reaction: reaction, reactOk: reactOk, reactBad: reactBad, reactDeny: reactDeny, reactDeny2: reactDeny2, probe: probe, bursts: bursts, errors: errors.slice(0, 4) }, null, 2) + '\n');
  } finally {
    if (ws) try { ws.close(); } catch (_) {}
    chrome.kill();
  }
}
main().catch(function (e) { process.stderr.write(String(e.stack || e) + '\n'); process.exit(1); });
