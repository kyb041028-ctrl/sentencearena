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
      let body = ''; res.on('data', function (c) { body += c; });
      res.on('end', function () { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.end();
  });
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function main() {
  const dir = path.join(process.env.TEMP || 'C:\\Temp', 'sa-sfx-rx-' + process.pid);
  fs.mkdirSync(dir, { recursive: true });
  const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--mute-audio','--remote-debugging-port=9355','--remote-allow-origins=*','--user-data-dir=' + dir,'--window-size=1400,900','about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let tab = null;
    for (let i = 0; i < 20 && !tab; i += 1) {
      try { tab = await getJson('http://127.0.0.1:9355/json/new?about:blank', 'PUT'); }
      catch (_) { await sleep(300); }
    }
    ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise(function (resolve, reject) { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
    let seq = 0; const pending = {};
    ws.addEventListener('message', function (ev) { const msg = JSON.parse(ev.data); if (msg.id && pending[msg.id]) pending[msg.id](msg); });
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
    await send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
    await send('Page.navigate', { url: 'http://127.0.0.1:3010/kr' });
    await sleep(1400);
    const prep = await evalJs(`(async function(){
      sessionStorage.setItem('sc_sb_guest_ok','1');
      if (typeof startSentenceArena === 'function') startSentenceArena();
      await new Promise(function (r) { setTimeout(r, 700); });
      window.__sfxInstallFetch();
      window.ScAuth = window.ScAuth || {};
      window.ScAuth.getAccessToken = function () { return Promise.resolve('local-mock'); };
      window.__scAuthUserId = '11111111-1111-4111-8111-111111111111';
      window.__scPlayer = { userId: '11111111-1111-4111-8111-111111111111' };
      var listed = null;
      try {
        var data = await window.listMemberCanonicalBoardPosts({ status: 'ACTIVE' });
        listed = { n: data.posts.length, id: data.posts[0].id };
      } catch (e) { listed = { err: String(e.code || e.message), status: e.status }; }
      var hydrated = await new Promise(function (resolve) {
        window.__scHydrateMemberCanonicalBoardFeed(function (ok) { resolve(!!ok); });
      });
      window.__scBoardNavigateToPost('COMMON', 1, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      await new Promise(function (r) { setTimeout(r, 800); });
      var found = window.findPostByIdAnywhere('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      var like = document.querySelector('#screen-post-detail .sc-react-btn--like') || document.querySelector('.sc-react-btn--like');
      var empathy = document.querySelector('#screen-post-detail .sc-react-btn--empathy') || document.querySelector('.sc-react-btn--empathy');
      return {
        listed: listed, hydrated: hydrated,
        source: found && found.post.source,
        like: like ? { disabled: like.disabled, w: like.getBoundingClientRect().width } : null,
        empathy: empathy ? { disabled: empathy.disabled, w: empathy.getBoundingClientRect().width } : null
      };
    })()`);
    async function clickSel(sel) {
      const info = await evalJs(`(function(){
        var el = document.querySelector(${JSON.stringify(sel)});
        if (!el || el.disabled) return { missing: !el, disabled: !!(el && el.disabled) };
        el.scrollIntoView({ block: 'center' });
        var r = el.getBoundingClientRect();
        var x = r.x + r.width / 2, y = r.y + r.height / 2;
        var hit = document.elementFromPoint(x, y);
        var ok = r.width > 8 && y > 2 && y < innerHeight - 2 && hit && (hit === el || el.contains(hit));
        return { ok: !!ok, x: x, y: y, hit: hit ? String(hit.className || hit.id) : null };
      })()`);
      if (!info || !info.ok) return { clicked: false, info: info };
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: info.x, y: info.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.x, y: info.y, button: 'left', clickCount: 1 });
      return { clicked: true, info: info };
    }
    async function react(mode) {
      await evalJs('window.__sfxInstallFetch(); window.__sfxMock.reaction=' + JSON.stringify(mode) + '; window.__sfxMock.empathy=' + JSON.stringify(mode));
      const mark = await evalJs('window.__sfxPlays.length');
      let click = await clickSel('#screen-post-detail .sc-react-btn--like');
      if (!click.clicked) click = await clickSel('#screen-post-detail .sc-react-btn--empathy');
      if (!click.clicked) click = await clickSel('.sc-react-btn--like');
      await sleep(700);
      return { mode: mode, click: click, plays: await evalJs('window.__sfxPlays.slice(' + mark + ')') };
    }
    const cases = [await react('success'), await react('fail'), await react('deny')];
    process.stdout.write(JSON.stringify({ prep: prep, cases: cases }, null, 2) + '\n');
  } finally { if (ws) ws.close(); chrome.kill(); }
}
main().catch(function (e) { process.stderr.write(String(e.stack || e) + '\n'); process.exit(1); });
