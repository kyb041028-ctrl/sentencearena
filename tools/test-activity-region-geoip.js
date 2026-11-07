#!/usr/bin/env node
'use strict';

/**
 * GeoIP는 주입한 fetch로 확인한다.
 * 8.8.8.8 조회는 공개 DNS 주소일 뿐이며 미국 방문자가 아니다.
 */

const assert = require('assert');
const express = require('express');
const http = require('http');
const { createGeoIpLookup } = require('../server/activity-region-geoip');
const service = require('../server/activity-region-service');
const { createActivityRegionRouter } = require('../server/activity-region-routes');

let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    console.log('CHECK_OK', name);
    return;
  }
  failed += 1;
  console.log('CHECK_FAIL', name, detail || '');
}

function listen(app) {
  return new Promise(function (resolve) {
    const server = app.listen(0, '127.0.0.1', function () {
      resolve(server);
    });
  });
}

function closeServer(server) {
  return new Promise(function (resolve) {
    server.close(function () { resolve(); });
  });
}

function request(server, headers) {
  const addr = server.address();
  return new Promise(function (resolve, reject) {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path: '/api/activity-region',
        method: 'GET',
        headers: headers || {},
      },
      function (res) {
        const chunks = [];
        res.on('data', function (chunk) { chunks.push(chunk); });
        res.on('end', function () {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch (_) { json = null; }
          resolve({ status: res.statusCode, json: json });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function fakeResponse(body, ok) {
  return {
    ok: ok !== false,
    json: async function () { return body; },
  };
}

async function main() {
  const calls = [];
  const lookup = createGeoIpLookup({
    fetch: async function (url) {
      calls.push(String(url));
      if (String(url).indexOf('203.0.113.10') >= 0) {
        return fakeResponse({ success: true, country_code: 'US' });
      }
      if (String(url).indexOf('203.0.113.20') >= 0) {
        return fakeResponse({ success: true, country_code: 'JP' });
      }
      if (String(url).indexOf('203.0.113.30') >= 0) {
        throw new Error('network down');
      }
      return fakeResponse({ success: false }, false);
    },
  });

  const privateResult = await lookup('127.0.0.1');
  check('사설 주소는 외부 조회를 하지 않는다', privateResult == null && calls.length === 0);

  const first = await lookup('203.0.113.10');
  const second = await lookup('203.0.113.10');
  check('공개 주소의 국가 코드만 잠시 기억한다', first === 'US' && second === 'US' && calls.length === 1);

  const app = express();
  app.use('/api', createActivityRegionRouter({ lookup: lookup, devSamples: false }));
  const server = await listen(app);

  const fromIp = await request(server, { 'x-forwarded-for': '203.0.113.10' });
  check(
    '신뢰 프록시가 아니면 전달 헤더를 쓰지 않는다',
    fromIp.json && fromIp.json.region === 'KR' && fromIp.json.source !== 'ip' && !Object.prototype.hasOwnProperty.call(fromIp.json, 'ip'),
    JSON.stringify(fromIp.json)
  );

  const browserHeader = await request(server, {
    'x-sa-edge-country': 'US',
    'accept-language': 'ko',
  });
  check(
    '브라우저 국가 헤더는 미국으로 인정하지 않는다',
    browserHeader.json && browserHeader.json.region === 'KR' && browserHeader.json.source === 'language',
    JSON.stringify(browserHeader.json)
  );
  await closeServer(server);

  const trusted = express();
  trusted.set('trust proxy', 1);
  trusted.use('/api', createActivityRegionRouter({ lookup: lookup, devSamples: false }));
  const trustedServer = await listen(trusted);
  const usIp = await request(trustedServer, { 'x-forwarded-for': '203.0.113.10' });
  check(
    '신뢰 프록시의 접속 주소는 GeoIP로 US가 된다',
    usIp.json && usIp.json.region === 'US' && usIp.json.source === 'ip' && !Object.prototype.hasOwnProperty.call(usIp.json, 'ip'),
    JSON.stringify(usIp.json)
  );
  const otherCountry = await request(trustedServer, {
    'x-forwarded-for': '203.0.113.20',
    'accept-language': 'ko-KR',
  });
  check(
    '한국·미국이 아닌 국가는 브라우저 언어를 따른다',
    otherCountry.json && otherCountry.json.region === 'KR' && otherCountry.json.source === 'language',
    JSON.stringify(otherCountry.json)
  );
  const failedLookup = await request(trustedServer, {
    'x-forwarded-for': '203.0.113.30',
    'accept-language': 'en-US',
  });
  check(
    '외부 조회 실패는 브라우저 언어로 연다',
    failedLookup.json && failedLookup.json.region === 'US' && failedLookup.json.source === 'language-after-ip-failure',
    JSON.stringify(failedLookup.json)
  );
  const chosen = await request(trustedServer, {
    'x-forwarded-for': '203.0.113.10',
    cookie: 'sa_ar=KR; sa_ar_x=1',
    'accept-language': 'en',
  });
  check(
    '저장한 선택은 GeoIP보다 우선한다',
    chosen.json && chosen.json.region === 'KR' && chosen.json.source === 'explicit'
  );
  await closeServer(trustedServer);

  const direct = await service.resolveFromRequestAsync(
    {
      app: { get: function () { return false; } },
      socket: { remoteAddress: '203.0.113.10' },
      headers: { 'accept-language': 'ko' },
    },
    lookup
  );
  check('동기 응답 객체에는 주소가 없다', direct.region === 'US' && direct.source === 'ip' && !Object.prototype.hasOwnProperty.call(direct, 'ip'));

  const previousEdge = process.env.SA_TRUST_EDGE_COUNTRY;
  process.env.SA_TRUST_EDGE_COUNTRY = '1';
  const edgeCallsBefore = calls.length;
  const edged = await service.resolveFromRequestAsync(
    {
      app: { get: function () { return 1; } },
      socket: { remoteAddress: '203.0.113.10' },
      headers: { 'x-sa-edge-country': 'KR', 'accept-language': 'en' },
    },
    lookup
  );
  if (previousEdge == null) delete process.env.SA_TRUST_EDGE_COUNTRY;
  else process.env.SA_TRUST_EDGE_COUNTRY = previousEdge;
  check(
    '프록시가 직접 준 국가 헤더는 GeoIP보다 먼저 쓴다',
    edged.region === 'KR' && edged.source === 'ip' && calls.length === edgeCallsBefore
  );

  try {
    const live = createGeoIpLookup({ timeoutMs: 2500 });
    const code = await live('8.8.8.8');
    console.log('PUBLIC_DNS_LOOKUP', code || 'EMPTY', 'NOT_A_VISITOR');
  } catch (_) {
    console.log('EXTERNAL_LOOKUP_FAILED');
  }
  console.log('REAL_VISITOR_IP', 'UNVERIFIED');
  if (failed) {
    console.log('GEOIP_CHECKS_FAIL', failed);
    process.exitCode = 1;
    return;
  }
  console.log('GEOIP_CHECKS_OK');
}

main().catch(function (err) {
  console.log('GEOIP_CHECKS_FAIL', err && err.message ? err.message : 'error');
  process.exitCode = 1;
});
