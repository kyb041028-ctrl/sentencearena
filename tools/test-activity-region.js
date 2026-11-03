'use strict';

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const core = require('../shared/activity-region-core');
const storeMod = require('../server/activity-region-store');
const service = require('../server/activity-region-service');
const { createActivityRegionRouter } = require('../server/activity-region-routes');

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (err) {
    failed += 1;
    console.error('FAIL', name, err && err.message ? err.message : err);
  }
}

check('explicit beats IP', function () {
  const r = core.resolveActivityRegion({ explicit: 'US', ipCountry: 'KR', acceptLanguage: 'ko' });
  assert.strictEqual(r.region, 'US');
  assert.strictEqual(r.source, 'explicit');
});

check('Korean IP', function () {
  const r = core.resolveActivityRegion({ ipCountry: 'KR', acceptLanguage: 'en-US' });
  assert.strictEqual(r.region, 'KR');
  assert.strictEqual(r.source, 'ip');
});

check('US IP', function () {
  const r = core.resolveActivityRegion({ ipCountry: 'US', acceptLanguage: 'ko-KR' });
  assert.strictEqual(r.region, 'US');
});

check('other country uses language', function () {
  const r = core.resolveActivityRegion({ ipCountry: 'JP', acceptLanguage: 'en-US,en;q=0.8' });
  assert.strictEqual(r.region, 'US');
  assert.strictEqual(r.source, 'language');
});

check('other country Korean language stays KR', function () {
  const r = core.resolveActivityRegion({ ipCountry: 'DE', acceptLanguage: 'ko-KR' });
  assert.strictEqual(r.region, 'KR');
  assert.strictEqual(r.source, 'language');
});

check('IP failure still opens as language or KR', function () {
  const en = core.resolveActivityRegion({ ipLookupFailed: true, acceptLanguage: 'en' });
  assert.strictEqual(en.region, 'US');
  assert.strictEqual(en.ok, true);
  const none = core.resolveActivityRegion({ ipLookupFailed: true, acceptLanguage: '' });
  assert.strictEqual(none.region, 'KR');
  assert.strictEqual(none.ok, true);
});

check('empty legacy record is KR', function () {
  assert.strictEqual(core.legacyRegion(null), 'KR');
  assert.strictEqual(core.legacyRegion(''), 'KR');
  assert.strictEqual(core.legacyRegion('US'), 'US');
});

check('write parameter cannot target the other country', function () {
  const bad = core.assertWriteRegion('KR', 'US');
  assert.strictEqual(bad.ok, false);
  const ok = core.assertWriteRegion('US', '');
  assert.strictEqual(ok.region, 'US');
});

check('KR storage keys stay bare', function () {
  assert.strictEqual(core.storageKey('sc_player_progression_v1', 'KR'), 'sc_player_progression_v1');
  assert.strictEqual(core.storageKey('sc_sb_auth_session', 'US'), 'sc_sb_auth_session');
  assert.strictEqual(core.storageKey('sc_player_progression_v1', 'US'), 'sc_player_progression_v1::US');
});

check('same user KR and US profiles do not mix', function () {
  const store = storeMod.createActivityRegionStore();
  store.writeActivity({
    userId: 'A',
    activeRegion: 'KR',
    post: { title: '한국 글' },
    xp: 12,
    fame: 4,
    aura: 2,
    tendency: { progressive: 20, conservative: 10, centrist: 11 },
    achievement: 'kr-badge',
    territory: 'pioneer',
    evolution: 3,
    level: 2,
    day30: 30,
    day99: 99,
  });
  const us = store.readProfile('A', 'US');
  assert.strictEqual(us.posts.length, 0);
  assert.strictEqual(us.xp, 0);
  assert.strictEqual(us.fame, 0);
  assert.strictEqual(us.aura, 0);
  assert.strictEqual(us.tendency, null);
  assert.deepStrictEqual(us.achievements, []);
  assert.strictEqual(us.evolution, 0);
  assert.strictEqual(us.level, 1);
  store.writeActivity({
    userId: 'A',
    activeRegion: 'US',
    post: { title: 'US note' },
    xp: 5,
    fame: 1,
    tendency: { progressive: 8, conservative: 9, centrist: 12 },
    achievement: 'us-badge',
  });
  const kr = store.readProfile('A', 'KR');
  assert.strictEqual(kr.posts.length, 1);
  assert.strictEqual(kr.posts[0].title, '한국 글');
  assert.strictEqual(kr.xp, 12);
  assert.strictEqual(kr.fame, 4);
  assert.strictEqual(kr.achievements[0], 'kr-badge');
  assert.strictEqual(us.posts.length, 0);
  const usAfter = store.readProfile('A', 'US');
  assert.strictEqual(usAfter.posts[0].title, 'US note');
  assert.strictEqual(usAfter.xp, 5);
  assert.strictEqual(kr.xp, 12);
});

check('user B is separate and guest cannot write', function () {
  const store = storeMod.createActivityRegionStore();
  store.writeActivity({ userId: 'B', activeRegion: 'US', post: { title: 'B only' }, xp: 7 });
  assert.strictEqual(store.readProfile('A', 'US').xp, 0);
  assert.strictEqual(store.readProfile('B', 'KR').posts.length, 0);
  assert.throws(function () {
    store.writeActivity({ guest: true, userId: '', activeRegion: 'US', post: { title: 'nope' } });
  }, function (err) {
    return err.code === 'GUEST_READ_ONLY';
  });
});

check('mismatched region is not written', function () {
  const store = storeMod.createActivityRegionStore();
  assert.throws(function () {
    store.writeActivity({
      userId: 'A',
      activeRegion: 'KR',
      requestedRegion: 'US',
      post: { title: 'smuggle' },
      xp: 99,
    });
  }, function (err) {
    return err.code === 'REGION_MISMATCH';
  });
  assert.strictEqual(store.readProfile('A', 'US').posts.length, 0);
  assert.strictEqual(store.readProfile('A', 'KR').xp, 0);
});

check('legacy null region is visible only as KR', function () {
  const store = storeMod.createActivityRegionStore();
  store.importLegacy({ userId: 'A', region: null, post: { title: '예전 글' } });
  assert.strictEqual(store.readProfile('A', 'KR').posts[0].title, '예전 글');
  assert.strictEqual(store.listPosts('US').length, 0);
  assert.strictEqual(store.listPosts('KR').length, 1);
});

check('resolver response has no IP', function () {
  const req = {
    app: { get: function () { return false; } },
    socket: { remoteAddress: '203.0.113.8' },
    headers: { 'accept-language': 'en-US', cookie: '' },
  };
  const resolved = service.resolveFromRequest(req, function () { return 'US'; });
  assert.strictEqual(resolved.region, 'US');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(resolved, 'ip'), false);
  const again = service.resolveFromRequest(
    Object.assign({}, req, { headers: { cookie: 'sa_ar=KR; sa_ar_x=1', 'accept-language': 'en' } }),
    function () { return 'US'; },
  );
  assert.strictEqual(again.region, 'KR');
  assert.strictEqual(again.source, 'explicit');
});

check('Korean tendency weights were not edited', function () {
  const text = fs.readFileSync(path.join(__dirname, '..', 'public', 'alignment-scoring.js'), 'utf8');
  assert.ok(text.indexOf('var W_REACTOR_LIKE = 2.0;') >= 0);
  assert.ok(text.indexOf('var W_REACTOR_DISLIKE = -0.6;') >= 0);
  assert.ok(text.indexOf('var W_AUTHOR_LIKE = 1.0;') >= 0);
  assert.ok(text.indexOf('conservative: 12, centrist: 12, progressive: 12') >= 0);
});

function listen(app) {
  return new Promise(function (resolve) {
    const server = app.listen(0, '127.0.0.1', function () {
      resolve(server);
    });
  });
}

function request(port, method, urlPath, body, headers) {
  return new Promise(function (resolve, reject) {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: port,
        method: method,
        path: urlPath,
        headers: headers || {},
      },
      function (res) {
        let data = '';
        res.on('data', function (c) { data += c; });
        res.on('end', function () {
          resolve({ status: res.statusCode, json: JSON.parse(data), headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function httpChecks() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api', createActivityRegionRouter({
    devSamples: true,
    lookup: function (ip) {
      if (ip === '198.51.100.10') return 'KR';
      if (ip === '198.51.100.20') return 'US';
      if (ip === '198.51.100.30') return 'JP';
      if (ip === '198.51.100.40') throw new Error('lookup down');
      return null;
    },
    resolveUser: function (req) {
      return req.headers['x-test-user'] || '';
    },
  }));
  const server = await listen(app);
  const port = server.address().port;
  try {
    const kr = await request(port, 'GET', '/api/activity-region', null, {
      'x-forwarded-for': '198.51.100.10',
      'accept-language': 'en-US',
    });
    assert.strictEqual(kr.json.region, 'KR');
    assert.strictEqual(kr.json.source, 'ip');
    const usIp = await request(port, 'GET', '/api/activity-region', null, {
      'x-forwarded-for': '198.51.100.20',
      'accept-language': 'ko-KR',
    });
    assert.strictEqual(usIp.json.region, 'US');
    assert.strictEqual(usIp.json.source, 'ip');
    const otherIp = await request(port, 'GET', '/api/activity-region', null, {
      'x-forwarded-for': '198.51.100.30',
      'accept-language': 'en-US',
    });
    assert.strictEqual(otherIp.json.region, 'US');
    assert.strictEqual(otherIp.json.source, 'language');
    const down = await request(port, 'GET', '/api/activity-region', null, {
      'x-forwarded-for': '198.51.100.40',
      'accept-language': 'ja',
    });
    assert.strictEqual(down.json.ok, true);
    assert.strictEqual(down.json.region, 'KR');
    const us = await request(port, 'GET', '/api/activity-region', null, {
      'accept-language': 'ko-KR',
    });
    const forced = await request(port, 'GET', '/api/activity-region', null, {
      'accept-language': 'en-US',
    });
    assert.strictEqual(forced.json.region, 'US');
    assert.ok(!JSON.stringify(forced.json).includes('198.51'));
    const other = await request(port, 'GET', '/api/activity-region', null, {
      'accept-language': 'fr-FR',
    });
    assert.strictEqual(other.json.region, 'KR');
    const choose = await request(port, 'POST', '/api/activity-region', JSON.stringify({ region: 'US' }), {
      'content-type': 'application/json',
      'accept-language': 'ko',
    });
    assert.strictEqual(choose.json.explicit, true);
    const cookie = [].concat(choose.headers['set-cookie'] || []).join(';');
    assert.ok(cookie.indexOf('sa_ar=US') >= 0);
    assert.ok(cookie.indexOf('198.51') < 0);
    const revisit = await request(port, 'GET', '/api/activity-region', null, {
      cookie: 'sa_ar=US; sa_ar_x=1',
      'accept-language': 'ko-KR',
    });
    assert.strictEqual(revisit.json.region, 'US');
    assert.strictEqual(revisit.json.source, 'explicit');
    const guest = await request(port, 'POST', '/api/activity-region/posts', JSON.stringify({
      title: 'guest',
      region: 'US',
    }), { 'content-type': 'application/json', cookie: 'sa_ar=US; sa_ar_x=1' });
    assert.strictEqual(guest.status, 403);
    const mismatch = await request(port, 'POST', '/api/activity-region/posts', JSON.stringify({
      title: 'smuggle',
      region: 'KR',
      xp: 50,
    }), {
      'content-type': 'application/json',
      cookie: 'sa_ar=US; sa_ar_x=1',
      'x-test-user': 'A',
    });
    assert.strictEqual(mismatch.status, 403);
    const wrote = await request(port, 'POST', '/api/activity-region/posts', JSON.stringify({
      title: 'US note',
      xp: 5,
    }), {
      'content-type': 'application/json',
      cookie: 'sa_ar=US; sa_ar_x=1',
      'x-test-user': 'A',
    });
    assert.strictEqual(wrote.status, 201);
    const usPosts = await request(port, 'GET', '/api/activity-region/posts', null, {
      cookie: 'sa_ar=US; sa_ar_x=1',
    });
    assert.ok(usPosts.json.posts.some(function (p) { return p.title === 'US note'; }));
    const krPosts = await request(port, 'GET', '/api/activity-region/posts', null, {
      cookie: 'sa_ar=KR; sa_ar_x=1',
    });
    assert.ok(!krPosts.json.posts.some(function (p) { return p.title === 'US note'; }));
    assert.ok(!krPosts.json.posts.some(function (p) { return p.sample; }));
    const profile = await request(port, 'GET', '/api/activity-region/profile?region=KR', null, {
      cookie: 'sa_ar=US; sa_ar_x=1',
      'x-test-user': 'A',
    });
    assert.strictEqual(profile.status, 403);
    assert.strictEqual(us.status, 200);
    console.log('PASS http region routes');
  } finally {
    server.close();
  }
}

httpChecks().then(function () {
  if (failed) {
    console.error('failed', failed);
    process.exit(1);
  }
  console.log('activity-region tests ok');
}).catch(function (err) {
  console.error(err);
  process.exit(1);
});
