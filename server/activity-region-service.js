'use strict';

/**
 * IP는 요청을 처리하는 동안만 읽고, 저장하거나 응답에 넣지 않는다.
 * 저장한 선택 > 신뢰된 프록시의 국가 헤더 > 서버 GeoIP > 브라우저 언어 > KR.
 * 브라우저가 붙인 국가 헤더와 X-Forwarded-For는 신뢰 프록시가 아니면 무시한다.
 * GeoIP가 실패하면 언어로 연다. 응답 JSON에는 주소를 넣지 않는다.
 */

const core = require('../shared/activity-region-core');

function parseCookies(header) {
  var out = {};
  String(header || '')
    .split(';')
    .forEach(function (part) {
      var i = part.indexOf('=');
      if (i < 1) return;
      var k = part.slice(0, i).trim();
      var v = part.slice(i + 1).trim();
      try {
        out[k] = decodeURIComponent(v);
      } catch (_) {
        out[k] = v;
      }
    });
  return out;
}

function readClientIp(req) {
  if (!req) return '';
  var trust = req.app && typeof req.app.get === 'function' && req.app.get('trust proxy');
  if (trust && req.ip) return String(req.ip);
  var sock = req.socket && req.socket.remoteAddress;
  return sock ? String(sock) : '';
}

function trustedProxy(req) {
  return !!(req && req.app && typeof req.app.get === 'function' && req.app.get('trust proxy'));
}

function readEdgeCountry(req) {
  // 브라우저가 붙인 국가 헤더는 받지 않는다.
  // TRUST_PROXY=1 이고 SA_TRUST_EDGE_COUNTRY=1 일 때만 x-sa-edge-country 를 읽는다.
  // 그 헤더가 없으면 GeoIP로 넘어간다. 헤더만 기다리지 않는다.
  if (!trustedProxy(req)) return null;
  if (String(process.env.SA_TRUST_EDGE_COUNTRY || '').trim() !== '1') return null;
  var raw = req && req.headers ? req.headers['x-sa-edge-country'] : '';
  return core.normalizeRegion(raw);
}

function finishResolution(explicit, ipCountry, ipLookupFailed, req) {
  var resolved = core.resolveActivityRegion({
    explicit: explicit,
    ipCountry: ipCountry,
    ipLookupFailed: ipLookupFailed,
    acceptLanguage: req && req.headers ? req.headers['accept-language'] : '',
  });
  return {
    region: resolved.region,
    source: resolved.source,
    explicit: !!explicit,
  };
}

function readExplicit(req) {
  var cookies = parseCookies(req && req.headers ? req.headers.cookie : '');
  return cookies.sa_ar_x === '1' ? core.normalizeRegion(cookies.sa_ar) : null;
}

function resolveFromRequest(req, lookup) {
  var explicit = readExplicit(req);
  var ipCountry = null;
  var ipLookupFailed = false;
  if (!explicit) {
    var edge = readEdgeCountry(req);
    if (edge) {
      ipCountry = edge;
    } else if (typeof lookup === 'function') {
      try {
        var found = lookup(readClientIp(req));
        if (found && typeof found.then === 'function') ipLookupFailed = true;
        else if (found == null || found === '') ipCountry = null;
        else ipCountry = found;
      } catch (_) {
        ipLookupFailed = true;
      }
    }
  }
  return finishResolution(explicit, ipCountry, ipLookupFailed, req);
}

async function resolveFromRequestAsync(req, lookup) {
  var explicit = readExplicit(req);
  var ipCountry = null;
  var ipLookupFailed = false;
  if (!explicit) {
    var edge = readEdgeCountry(req);
    if (edge) {
      ipCountry = edge;
    } else if (typeof lookup === 'function') {
      try {
        var found = lookup(readClientIp(req));
        if (found && typeof found.then === 'function') found = await found;
        if (found == null || found === '') ipCountry = null;
        else ipCountry = found;
      } catch (_) {
        ipLookupFailed = true;
      }
    }
  }
  return finishResolution(explicit, ipCountry, ipLookupFailed, req);
}

function cookieHeader(region, explicit) {
  var value = core.normalizeRegion(region) || 'KR';
  var parts = ['sa_ar=' + value, 'Path=/', 'SameSite=Lax'];
  if (explicit) {
    parts.push('Max-Age=15552000');
    return [parts.join('; '), 'sa_ar_x=1; Path=/; SameSite=Lax; Max-Age=15552000'];
  }
  return [parts.join('; '), 'sa_ar_x=; Path=/; SameSite=Lax; Max-Age=0'];
}

module.exports = {
  parseCookies: parseCookies,
  readClientIp: readClientIp,
  resolveFromRequest: resolveFromRequest,
  resolveFromRequestAsync: resolveFromRequestAsync,
  cookieHeader: cookieHeader,
};
