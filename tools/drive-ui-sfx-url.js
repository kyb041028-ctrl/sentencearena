'use strict';
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
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
  const dir = path.join(process.env.TEMP || 'C:\\Temp', 'sa-sfx-url-' + process.pid);
  fs.mkdirSync(dir, { recursive: true });
  const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--mute-audio','--remote-debugging-port=9354','--remote-allow-origins=*','--user-data-dir=' + dir,'about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let tab = null;
    for (let i = 0; i < 20 && !tab; i += 1) {
      try { tab = await getJson('http://127.0.0.1:9354/json/new?' + encodeURIComponent('http://127.0.0.1:3010/kr'), 'PUT'); }
      catch (_) { await sleep(300); }
    }
    ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise(function (resolve, reject) { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
    let seq = 0; const pending = {};
    ws.addEventListener('message', function (ev) {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending[msg.id]) pending[msg.id](msg);
    });
    function send(method, params) {
      const id = ++seq;
      return new Promise(function (resolve) { pending[id] = resolve; ws.send(JSON.stringify({ id: id, method: method, params: params || {} })); });
    }
    await sleep(1200);
    const msg = await send('Runtime.evaluate', { expression: `(async function(){
      var seen = [];
      var orig = window.fetch;
      window.fetch = function (u, o) { seen.push(String(u)); return orig.call(this, u, o); };
      var out = {};
      try { await window.listMemberCanonicalBoardPosts({ status: 'ACTIVE' }); out.ok = true; }
      catch (e) { out.err = e && (e.code || e.message); out.status = e && e.status; }
      out.seen = seen;
      out.hasInstall = typeof window.__sfxInstallFetch;
      return out;
    })()`, awaitPromise: true, returnByValue: true });
    process.stdout.write(JSON.stringify(msg.result && msg.result.result && msg.result.result.value) + '\n');
  } finally { if (ws) ws.close(); chrome.kill(); }
}
main().catch(function (e) { process.stderr.write(String(e.stack || e) + '\n'); process.exit(1); });
