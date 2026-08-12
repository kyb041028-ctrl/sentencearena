'use strict';

/**
 * app-bootstrap — thin entry to ScSessionController
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function request(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(
      { hostname: 'localhost', port: Number(process.env.PORT) || 3000, path: urlPath },
      (res) => {
        let d = '';
        res.on('data', (c) => {
          d += c;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: d }));
      },
    ).on('error', reject);
  });
}

const root = path.join(__dirname, '..');
const indexSrc = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const bootstrapSrc = fs.readFileSync(path.join(root, 'public', 'app-bootstrap.js'), 'utf8');
const controllerSrc = fs.readFileSync(path.join(root, 'public', 'session-controller.js'), 'utf8');

assert(/app-bootstrap\.js/.test(indexSrc), 'index loads app-bootstrap.js');
assert(/session-controller\.js/.test(indexSrc), 'index loads session-controller');
assert(bootstrapSrc.includes('ScSessionController'), 'bootstrap delegates');
assert(controllerSrc.includes('/api/session/bootstrap'), 'controller bootstrap API');
assert(!controllerSrc.includes("goBoard('COMMON')"), 'no auto COMMON');
assert(!controllerSrc.includes('setInterval'), 'no polling');
assert(!controllerSrc.includes('MutationObserver'), 'no mutation observer');

(async () => {
  const idx = await request('/');
  assert(idx.status === 200 && idx.body.includes('session-controller.js'), 'live index');
  assert(idx.body.includes('id="screen-main"'), 'territory DOM');
  assert(/id="view-login"[^>]*hidden/.test(idx.body), 'login hidden until state');
  const bs = await request('/app-bootstrap.js');
  assert(bs.status === 200 && bs.body.includes('ScSessionController'), 'bootstrap served');
  const sc = await request('/session-controller.js');
  assert(sc.status === 200 && sc.body.includes('/api/session/bootstrap'), 'controller served');
  console.log('PASS app-bootstrap → session-controller entry');
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
