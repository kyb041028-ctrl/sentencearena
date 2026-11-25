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
  const dir = path.join(process.env.TEMP || 'C:\\Temp', 'sa-piper-mobile-' + process.pid);
  fs.mkdirSync(dir, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--mute-audio',
    '--remote-debugging-port=9342', '--remote-allow-origins=*',
    '--user-data-dir=' + dir, '--window-size=390,844', 'about:blank',
  ], { stdio: 'ignore' });
  let ws;
  try {
    let tab = null;
    for (let i = 0; i < 20 && !tab; i += 1) {
      try { tab = await getJson('http://127.0.0.1:9342/json/new?' + encodeURIComponent('http://127.0.0.1:3010/kr'), 'PUT'); }
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
      if (msg.result && msg.result.exceptionDetails) throw new Error(JSON.stringify(msg.result.exceptionDetails).slice(0, 500));
      return msg.result && msg.result.result ? msg.result.result.value : null;
    }
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(1500);
    const entered = await evalJs(`(function(){
      sessionStorage.setItem('sc_sb_guest_ok','1');
      if (typeof startSentenceArena === 'function') startSentenceArena();
      return document.body.className;
    })()`);
    await sleep(800);
    const opened = await evalJs(`(function(){
      var tab = document.getElementById('avatar-dock-tab');
      if (tab) tab.click();
      var dock = document.getElementById('avatar-dock');
      return { clicked: !!tab, hidden: dock ? dock.hidden : null, collapsed: dock ? dock.classList.contains('is-collapsed') : null, app: document.body.classList.contains('sc-app-mode') };
    })()`);
    await sleep(400);
    const painted = await evalJs(`(function(){
      window.renderProfileAchievements({ achievements: [
        { id: 'piper', stage: 3, title: '피리 부는 사나이' },
        { id: 'first-post', title: '첫 글' },
        { id: 'first-comment', title: '첫 댓글' }
      ]});
      var layer = document.getElementById('achievementLayer');
      if (layer) layer.scrollIntoView({ block: 'center', inline: 'center' });
      var rect = layer ? layer.getBoundingClientRect() : null;
      var imgs = Array.prototype.map.call(document.querySelectorAll('#achievementLayer .profile-achievement-img'), function(img){ return img.getAttribute('src'); });
      return { entered: ${JSON.stringify(entered)}, opened: ${JSON.stringify(opened)}, imgs: imgs, rect: rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null };
    })()`);
    await sleep(500);
    const rect = painted && painted.rect;
    const clip = rect && rect.w > 10 && rect.h > 10
      ? { x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: Math.min(390, rect.w), height: Math.min(844, rect.h), scale: 1 }
      : null;
    const shot = await send('Page.captureScreenshot', clip ? { format: 'png', clip: clip } : { format: 'png' });
    fs.writeFileSync(path.join(OUT, 'mobile-profile.png'), Buffer.from(shot.result.data, 'base64'));
    const full = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, 'mobile-profile-page.png'), Buffer.from(full.result.data, 'base64'));
    process.stdout.write(JSON.stringify({ painted: painted, clip: !!clip, bytes: fs.statSync(path.join(OUT, 'mobile-profile.png')).size }) + '\n');
  } finally {
    if (ws) try { ws.close(); } catch (_) {}
    chrome.kill();
  }
}
main().catch(function (err) { process.stderr.write(String(err && err.stack || err) + '\n'); process.exit(1); });
