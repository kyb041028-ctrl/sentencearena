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
  const dir = path.join(process.env.TEMP || 'C:\\Temp', 'sa-sfx-fu3-' + process.pid);
  fs.mkdirSync(dir, { recursive: true });
  const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--mute-audio','--remote-debugging-port=9353','--remote-allow-origins=*','--user-data-dir=' + dir,'--window-size=1400,900','about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let tab = null;
    for (let i = 0; i < 20 && !tab; i += 1) {
      try { tab = await getJson('http://127.0.0.1:9353/json/new?about:blank', 'PUT'); }
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
      if (msg.result && msg.result.exceptionDetails) throw new Error(JSON.stringify(msg.result.exceptionDetails).slice(0, 400));
      return msg.result && msg.result.result ? msg.result.result.value : null;
    }
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
    await send('Page.navigate', { url: 'http://127.0.0.1:3010/kr' });
    await sleep(1400);
    const prep = await evalJs(`(async function(){
      sessionStorage.setItem('sc_sb_guest_ok','1');
      if (typeof startSentenceArena === 'function') startSentenceArena();
      await new Promise(function (r) { setTimeout(r, 600); });
      if (window.__sfxInstallFetch) window.__sfxInstallFetch();
      window.__scAuthUserId = '11111111-1111-4111-8111-111111111111';
      window.__scPlayer = { userId: '11111111-1111-4111-8111-111111111111' };
      window.__sfxMock.empathy = 'success';
      window.__sfxMock.reaction = 'success';
      var listed = null;
      try {
        var data = await window.listMemberCanonicalBoardPosts({ status: 'ACTIVE' });
        listed = { n: data && data.posts ? data.posts.length : 0 };
      } catch (e) { listed = { err: String(e && (e.code || e.message) || e) }; }
      var hydrated = await new Promise(function (resolve) {
        window.__scHydrateMemberCanonicalBoardFeed(function (ok) { resolve(!!ok); });
      });
      if (window.__scApp) window.__scApp.goBoard('COMMON');
      await new Promise(function (r) { setTimeout(r, 500); });
      var found = window.findPostByIdAnywhere('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      return {
        listed: listed,
        hydrated: hydrated,
        source: found && found.post && found.post.source,
        like: document.querySelectorAll('.sc-react-btn--like').length,
        empathy: document.querySelectorAll('.sc-react-btn--empathy').length,
        likeDisabled: document.querySelector('.sc-react-btn--like') ? document.querySelector('.sc-react-btn--like').disabled : null
      };
    })()`);
    async function clickSel(sel) {
      const info = await evalJs(`(function(){
        var el = document.querySelector(${JSON.stringify(sel)});
        if (!el || el.disabled) return { missing: !el, disabled: !!(el && el.disabled) };
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        var r = el.getBoundingClientRect();
        var x = r.x + r.width / 2, y = r.y + r.height / 2;
        var hit = document.elementFromPoint(x, y);
        var ok = r.width > 8 && x > 2 && y > 2 && x < innerWidth - 2 && y < innerHeight - 2 && hit && (hit === el || el.contains(hit));
        return { ok: !!ok, x: x, y: y, hit: hit ? (hit.className || hit.id) : null };
      })()`);
      if (!info || !info.ok) return { clicked: false, info: info };
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: info.x, y: info.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.x, y: info.y, button: 'left', clickCount: 1 });
      return { clicked: true, info: info };
    }
    async function react(mode) {
      await evalJs('window.__sfxInstallFetch(); window.__sfxMock.empathy=' + JSON.stringify(mode) + '; window.__sfxMock.reaction=' + JSON.stringify(mode));
      const mark = await evalJs('window.__sfxPlays.length');
      let click = await clickSel('.sc-react-btn--like');
      if (!click.clicked) click = await clickSel('.sc-react-btn--empathy');
      await sleep(600);
      return { click: click, plays: await evalJs('window.__sfxPlays.slice(' + mark + ')') };
    }
    const reactOk = await react('success');
    const reactBad = await react('fail');
    const reactDeny = await react('deny');

    await send('Page.navigate', { url: 'http://127.0.0.1:3010/kr?devLeaderElection=1&electionId=mock-el' });
    await sleep(1200);
    const spot = await evalJs(`(function(){
      var el = document.querySelector('[data-candidate]');
      var r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, id: 'candidate' };
    })()`);
    async function burst(gap) {
      const markDown = await evalJs('window.__sfxDown.length');
      const markPlay = await evalJs('window.__sfxPlays.length');
      for (let i = 0; i < 4; i += 1) {
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
        if (i < 3) await sleep(gap);
      }
      await sleep(250);
      return evalJs(`(function(){
        var downs = window.__sfxDown.slice(${markDown}).filter(function (d) { return d.trusted; });
        var gaps = [];
        for (var i = 1; i < downs.length; i++) gaps.push(downs[i].t - downs[i - 1].t);
        var same = downs.every(function (d) { return String(d.cls).indexOf('sa-le__choice') !== -1; });
        return { requested: ${gap}, same: same, ids: downs.map(function (d) { return d.cls; }), gaps: gaps, plays: window.__sfxPlays.slice(${markPlay}).map(function (p) { return p.src; }) };
      })()`);
    }
    const bursts = [];
    for (const gap of [30, 50, 100]) {
      bursts.push(await burst(gap));
      await sleep(800);
    }
    process.stdout.write(JSON.stringify({ prep: prep, reactOk: reactOk, reactBad: reactBad, reactDeny: reactDeny, bursts: bursts }, null, 2) + '\n');
  } finally {
    if (ws) try { ws.close(); } catch (_) {}
    chrome.kill();
  }
}
main().catch(function (e) { process.stderr.write(String(e.stack || e) + '\n'); process.exit(1); });
