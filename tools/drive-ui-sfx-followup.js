'use strict';
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const HOOK = `
window.__sfxPlays = [];
window.__sfxDown = [];
window.__sfxMock = { vote: 'success', empathy: 'success', reaction: 'success' };
window.alert = function () {};
var origPlay = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function () {
  window.__sfxPlays.push({ src: this.currentSrc || this.src || '', t: Date.now() });
  return origPlay.apply(this, arguments);
};
document.addEventListener('pointerdown', function (ev) {
  var el = ev.target;
  window.__sfxDown.push({
    t: Date.now(),
    id: el && el.id || '',
    cls: el && String(el.className || ''),
    trusted: ev.isTrusted
  });
}, true);
var origFetch = window.fetch;
window.__sfxFetch = function (url, opts) {
  var u = String(url);
  var method = opts && opts.method ? String(opts.method).toUpperCase() : 'GET';
  function json(body, status) {
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' }
    }));
  }
  if (u.indexOf('127.0.0.1:3013') !== -1 || u.indexOf('/dev/leader-election/') !== -1) {
    if (method === 'POST' && u.indexOf('/votes') !== -1) {
      var mode = window.__sfxMock.vote;
      var wait = 0;
      var body = { ok: false, reason: 'NOT_ELIGIBLE' };
      if (mode === 'success' || mode === 'slow') body = { ok: true };
      if (mode === 'duplicate') body = { ok: false, reason: 'DUPLICATE_VOTE' };
      if (mode === 'fail') body = { ok: false, reason: 'NOT_ELIGIBLE' };
      if (mode === 'deny') body = { ok: false, status: 403, code: 'FORBIDDEN' };
      if (mode === 'slow') wait = 700;
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(json(body)); }, wait);
      }).then(function (r) { return r; });
    }
    return json({
      ok: true,
      publicView: {
        productionAuth: false,
        id: 'mock-ballot',
        territory: 'pioneer',
        status: 'open',
        candidates: [{ id: 'c1', name: 'Mock Candidate' }],
        countsHidden: true,
        remainingMs: 3600000,
        startsAtMs: Date.now() - 1000,
        endsAtMs: Date.now() + 3600000,
        turnoutText: '0%',
        turnoutRatio: '0/10'
      }
    });
  }
  if (u.indexOf('/api/board/posts') !== -1 && method === 'GET' && u.indexOf('/empathy') === -1 && u.indexOf('/comments') === -1) {
    return json({
      ok: true,
      posts: [{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        title: 'Mock canonical post',
        content: 'mock only',
        status: 'ACTIVE',
        territory: 'CENTRAL',
        boardStage: 1,
        createdAt: new Date().toISOString(),
        author: { userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', displayName: 'Other member' },
        counts: { earthPositive: 0, earthNegative: 0 },
        earthReaction: {},
        empathy: { reactorUserIds: [], viewerReacted: false }
      }]
    });
  }
  if (u.indexOf('/empathy') !== -1 && method === 'POST') {
    var em = window.__sfxMock.empathy;
    if (em === 'success') return json({ ok: true, granted: true });
    if (em === 'deny') return json({ ok: false, error: 'FORBIDDEN' }, 403);
    return json({ ok: false, error: 'VALIDATION' }, 400);
  }
  if (u.indexOf('/reactions/toggle') !== -1) {
    var rx = window.__sfxMock.reaction;
    if (rx === 'success') {
      return json({ ok: true, result: { active: true, reactionType: 'LIKE', counts: { earthPositive: 1, earthNegative: 0 } } });
    }
    if (rx === 'deny') return json({ ok: false, error: 'FORBIDDEN' }, 403);
    return json({ ok: false, error: 'VALIDATION' }, 400);
  }
  return origFetch.apply(this, arguments);
};
window.fetch = window.__sfxFetch;
window.__sfxInstallFetch = function () { window.fetch = window.__sfxFetch; };
`;
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
  const dir = path.join(process.env.TEMP || 'C:\\Temp', 'sa-sfx-fu-' + process.pid);
  fs.mkdirSync(dir, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--mute-audio',
    '--remote-debugging-port=9351', '--remote-allow-origins=*',
    '--user-data-dir=' + dir, '--window-size=1400,900', 'about:blank',
  ], { stdio: 'ignore' });
  let ws;
  const errors = [];
  try {
    let tab = null;
    for (let i = 0; i < 20 && !tab; i += 1) {
      try { tab = await getJson('http://127.0.0.1:9351/json/new?about:blank', 'PUT'); }
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
        errors.push(String((d.exception && d.exception.description) || d.text || '').slice(0, 240));
      }
      if (msg.method === 'Page.javascriptDialogOpening') {
        send('Page.handleJavaScriptDialog', { accept: true });
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
        throw new Error(JSON.stringify(msg.result.exceptionDetails).slice(0, 400));
      }
      return msg.result && msg.result.result ? msg.result.result.value : null;
    }
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
    async function clickSel(sel) {
      const info = await evalJs(`(function(){
        var el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return { missing: true };
        el.scrollIntoView({ block: 'center', inline: 'center' });
        var r = el.getBoundingClientRect();
        var x = r.x + Math.min(Math.max(r.width / 2, 8), Math.max(r.width - 4, 8));
        var y = r.y + Math.min(Math.max(r.height / 2, 8), Math.max(r.height - 4, 8));
        var inside = r.width > 4 && r.height > 4 && x >= 2 && y >= 2 && x <= window.innerWidth - 2 && y <= window.innerHeight - 2;
        var hit = document.elementFromPoint(x, y);
        var ok = !!(hit && (hit === el || el.contains(hit)));
        return { inside: inside, ok: ok, x: x, y: y, disabled: !!el.disabled, hit: hit ? ((hit.id ? '#' + hit.id : '') + '.' + (hit.className || '')) : null };
      })()`);
      if (!info || !info.ok || !info.inside) return { clicked: false, info: info };
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: info.x, y: info.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.x, y: info.y, button: 'left', clickCount: 1 });
      return { clicked: true, info: info };
    }
    async function openVote() {
      await send('Page.navigate', { url: 'http://127.0.0.1:3010/kr?devLeaderElection=1&electionId=mock-el' });
      await sleep(1400);
    }
    async function voteOnce(mode, waitMs) {
      await evalJs('window.__sfxMock.vote = ' + JSON.stringify(mode));
      const beforeSelect = await evalJs('window.__sfxPlays.length');
      const cand = await clickSel('[data-candidate]');
      await sleep(500);
      const mark = await evalJs('window.__sfxPlays.length');
      const confirm = await clickSel('[data-confirm="1"]');
      let during = null;
      if (mode === 'slow') {
        await sleep(250);
        during = await evalJs('window.__sfxPlays.slice(' + mark + ')');
      }
      await sleep(waitMs || 500);
      const plays = await evalJs('window.__sfxPlays.slice(' + mark + ')');
      const recent = await evalJs('window.ScUiSfx ? window.ScUiSfx.recent() : []');
      return { cand: cand, confirm: confirm, beforeSelect: beforeSelect, during: during, plays: plays, recent: recent };
    }
    await openVote();
    const success = await voteOnce('success', 600);
    const duplicate = await voteOnce('duplicate', 500);
    const fail = await voteOnce('fail', 500);
    const slow = await voteOnce('slow', 1000);
    const deny1 = await voteOnce('deny', 400);
    const denyMark = await evalJs('window.__sfxPlays.length');
    const deny2 = await voteOnce('deny', 400);
    const denyPlays = await evalJs('window.__sfxPlays.slice(' + denyMark + ')');

    await send('Page.navigate', { url: 'http://127.0.0.1:3010/kr' });
    await sleep(1400);
    await evalJs(`(function(){
      sessionStorage.setItem('sc_sb_guest_ok','1');
      if (typeof startSentenceArena === 'function') startSentenceArena();
    })()`);
    await sleep(700);
    const guestClick = await clickSel('.sc-react-btn--empathy');
    await sleep(300);
    const guestPlays = await evalJs('window.__sfxPlays.slice()');

    await evalJs(`(function(){
      window.__scAuthUserId = '11111111-1111-4111-8111-111111111111';
      window.__scPlayer = { userId: '11111111-1111-4111-8111-111111111111' };
      window.__sfxMock.empathy = 'success';
      window.__sfxMock.reaction = 'success';
    })()`);
    const hydrated = await evalJs(`(function(){
      if (typeof window.__scHydrateMemberCanonicalBoardFeed !== 'function') return { missing: true };
      return new Promise(function (resolve) {
        window.__scHydrateMemberCanonicalBoardFeed(function (ok) { resolve({ ok: !!ok }); });
      });
    })()`);
    await evalJs(`(function(){ if (window.__scApp && window.__scApp.goBoard) window.__scApp.goBoard('COMMON'); })()`);
    await sleep(800);
    const buttons = await evalJs(`(function(){
      function info(sel) {
        var list = Array.prototype.slice.call(document.querySelectorAll(sel));
        return list.slice(0, 3).map(function (el) {
          var r = el.getBoundingClientRect();
          return { disabled: !!el.disabled, w: r.width, h: r.height, text: (el.innerText || '').slice(0, 20) };
        });
      }
      var found = window.findPostByIdAnywhere ? window.findPostByIdAnywhere('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') : null;
      return {
        empathy: info('.sc-react-btn--empathy'),
        like: info('.sc-react-btn--like'),
        found: found ? { id: found.post && found.post.id, source: found.post && found.post.source, author: found.post && found.post.authorId } : null
      };
    })()`);
    async function reactCase(mode) {
      await evalJs('window.__sfxMock.empathy = ' + JSON.stringify(mode) + '; window.__sfxMock.reaction = ' + JSON.stringify(mode));
      const mark = await evalJs('window.__sfxPlays.length');
      let click = await clickSel('.sc-react-btn--empathy:not([disabled])');
      if (!click.clicked) click = await clickSel('.sc-react-btn--like:not([disabled])');
      await sleep(500);
      const plays = await evalJs('window.__sfxPlays.slice(' + mark + ')');
      return { click: click, plays: plays };
    }
    const reactOk = await reactCase('success');
    const reactBad = await reactCase('fail');
    const reactDeny = await reactCase('deny');

    await evalJs(`(function(){ if (window.__scApp && window.__scApp.goMain) window.__scApp.goMain(); })()`);
    await sleep(400);
    const spot = await evalJs(`(function(){
      var ids = ['#sc-map-tab-bookmarks','#sc-map-tab-ranking','#sc-tendency-mini','#sc-map-tab-search'];
      var i, el, r, hit;
      for (i = 0; i < ids.length; i++) {
        el = document.querySelector(ids[i]);
        if (!el) continue;
        r = el.getBoundingClientRect();
        hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        if (r.width > 8 && hit && (hit === el || el.contains(hit))) {
          return { id: el.id, x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
      return null;
    })()`);
    async function burst(label, gap) {
      if (!spot) return { label: label, missing: true };
      const mark = await evalJs('window.__sfxDown.length');
      const playMark = await evalJs('window.__sfxPlays.length');
      for (let i = 0; i < 4; i += 1) {
        send('Input.dispatchMouseEvent', { type: 'mousePressed', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
        send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
        if (i < 3) await sleep(gap);
      }
      await sleep(350);
      return evalJs(`(function(){
        var downs = window.__sfxDown.slice(${mark}).filter(function (d) { return d.trusted; });
        var gaps = [];
        var i;
        for (i = 1; i < downs.length; i++) gaps.push(downs[i].t - downs[i - 1].t);
        var onButton = downs.filter(function (d) { return d.id === ${JSON.stringify(spot && spot.id)}; }).length;
        return {
          label: ${JSON.stringify(label)},
          requested: ${gap},
          button: ${JSON.stringify(spot && spot.id)},
          downs: downs,
          gaps: gaps,
          onButton: onButton,
          plays: window.__sfxPlays.slice(${playMark})
        };
      })()`);
    }
    const b30 = await burst('30', 0);
    await sleep(600);
    const b50 = await burst('50', 15);
    await sleep(600);
    const b100 = await burst('100', 70);

    const offMark = await evalJs('window.__sfxPlays.length');
    await evalJs(`(function(){
      window.ScUiSfx.unlock();
      window.ScUiSfx.setEnabled(false);
      window.ScUiSfx.play('click');
      window.ScUiSfx.play('reaction');
      window.ScUiSfx.play('vote');
      window.ScUiSfx.play('error');
    })()`);
    if (spot) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: spot.x, y: spot.y, button: 'left', clickCount: 1 });
    }
    await sleep(250);
    const offPlays = await evalJs('window.__sfxPlays.slice(' + offMark + ')');
    const offSettings = await evalJs('window.ScUiSfx.settings()');

    process.stdout.write(JSON.stringify({
      success: success, duplicate: duplicate, fail: fail, slow: slow, deny1: deny1, deny2plays: denyPlays,
      guestClick: guestClick, guestPlays: guestPlays, hydrated: hydrated, buttons: buttons,
      reactOk: reactOk, reactBad: reactBad, reactDeny: reactDeny,
      b30: b30, b50: b50, b100: b100, offPlays: offPlays, offSettings: offSettings,
      errors: errors.slice(0, 6)
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
