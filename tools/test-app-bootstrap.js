#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function request(urlPath) {
  return new Promise(function (resolve, reject) {
    const req = http.request(
      { hostname: 'localhost', port: Number(process.env.PORT) || 3000, path: urlPath, method: 'GET' },
      function (res) {
        let d = '';
        res.on('data', function (c) {
          d += c;
        });
        res.on('end', function () {
          resolve({ status: res.statusCode, body: d });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const root = path.join(__dirname, '..');
const bootstrapSrc = fs.readFileSync(path.join(root, 'public/app-bootstrap.js'), 'utf8');
const entrySrc = fs.readFileSync(path.join(root, 'public/app-entry.js'), 'utf8');

assert(bootstrapSrc.includes('startSentenceArena'), 'bootstrap delegates to startSentenceArena');
assert(entrySrc.includes('showLogin'), 'app-entry has showLogin');
assert(entrySrc.includes('showTerritorySelection'), 'app-entry has territory entry');

(async function () {
  const bs = await request('/app-bootstrap.js');
  assert(bs.status === 200 && bs.body.includes('startSentenceArena'), 'bootstrap served');
  const entry = await request('/app-entry.js');
  assert(entry.status === 200 && entry.body.includes('loadCurrentProfile'), 'app-entry served');
  console.log('PASS app-bootstrap → app-entry');
})().catch(function (e) {
  console.error('FAIL', e.message || e);
  process.exit(1);
});
