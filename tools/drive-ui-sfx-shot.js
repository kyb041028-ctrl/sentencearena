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
  const dir = path.join(process.env.TEMP || 'C:\\Temp', 'sa-sfx4-' + process.pid);
  fs.mkdirSync(dir, { recursive: true });
  const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--mute-audio','--remote-debugging-port=9347','--remote-allow-origins=*','--user-data-dir=' + dir,'--window-size=1400,900','about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let tab = null;
    for (let i = 0; i < 20 && !tab; i += 1) {
      try { tab = await getJson('http://127.0.0.1:9347/json/new?' + encodeURIComponent('http://127.0.0.1:3010/kr'), 'PUT'); }
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
    await sleep(1200);
    await evalJs(`(function(){ sessionStorage.setItem('sc_sb_guest_ok','1'); if (typeof startSentenceArena==='function') startSentenceArena(); document.getElementById('sc-map-tab-settings').click(); var box = document.querySelector('[data-sc-sfx-settings]'); if (box) box.scrollIntoView({ block: 'center' }); })()`);
    await sleep(400);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT, 'kr-sound-controls.png');
    fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    const text = await evalJs(`(function(){ var t=document.getElementById('sc-sfx-title'); var c=document.getElementById('sc-sfx-enabled'); var v=document.getElementById('sc-sfx-volume'); return { title: t && t.textContent, on: c && c.checked, volume: v && v.value, visible: !!(t && t.getClientRects().length) }; })()`);
    process.stdout.write(JSON.stringify({ bytes: fs.statSync(file).size, text: text }) + '\n');
  } finally {
    if (ws) try { ws.close(); } catch (_) {}
    chrome.kill();
  }
}
main().catch(function (e) { process.stderr.write(String(e.stack || e) + '\n'); process.exit(1); });
