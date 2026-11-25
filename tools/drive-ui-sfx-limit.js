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
  const dir = path.join(process.env.TEMP || 'C:\\Temp', 'sa-sfx3-' + process.pid);
  fs.mkdirSync(dir, { recursive: true });
  const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--mute-audio','--remote-debugging-port=9346','--remote-allow-origins=*','--user-data-dir=' + dir,'--window-size=1400,900','about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let tab = null;
    for (let i = 0; i < 20 && !tab; i += 1) {
      try { tab = await getJson('http://127.0.0.1:9346/json/new?' + encodeURIComponent('http://127.0.0.1:3010/us'), 'PUT'); }
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
      if (msg.result && msg.result.exceptionDetails) throw new Error(JSON.stringify(msg.result.exceptionDetails).slice(0, 300));
      return msg.result && msg.result.result ? msg.result.result.value : null;
    }
    await sleep(1000);
    const out = await evalJs(`(async function(){
      window.__sfxPlays = [];
      var orig = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        window.__sfxPlays.push(this.currentSrc || this.src);
        return orig.apply(this, arguments);
      };
      window.ScUiSfx.unlock();
      window.ScUiSfx.setEnabled(true);
      window.ScUiSfx.setVolume(25);
      var i;
      for (i = 0; i < 8; i++) window.ScUiSfx.play('click');
      var burst = window.__sfxPlays.slice();
      window.ScUiSfx.setEnabled(false);
      window.ScUiSfx.play('click');
      window.ScUiSfx.play('error');
      var off = window.__sfxPlays.slice(burst.length);
      return { burst: burst, off: off, settings: window.ScUiSfx.settings(), title: document.getElementById('sc-sfx-title') && document.getElementById('sc-sfx-title').textContent };
    })()`);
    process.stdout.write(JSON.stringify(out) + '\n');
  } finally {
    if (ws) try { ws.close(); } catch (_) {}
    chrome.kill();
  }
}
main().catch(function (e) { process.stderr.write(String(e.stack || e) + '\n'); process.exit(1); });
