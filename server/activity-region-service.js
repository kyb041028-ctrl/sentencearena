'use strict';

/**
 * IP는 요청을 처리하는 동안만 읽고, 저장하거나 응답에 넣지 않는다.
 * 국가 코드 조회는 서버가 주입한 lookup만 사용한다. 기본 lookup은 없다.
 * GeoIP 데이터베이스가 없으면 null을 반환하고, 사이트는 언어 또는 KR로 연다.
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
  // GeoIP 데이터베이스는 없다. 헤더가 없으면 언어, 그다음 KR.
  if (!trustedProxy(req)) return null;
  if (String(process.env.SA_TRUST_EDGE_COUNTRY || '').trim() !== '1') return null;
  var raw = req && req.headers ? req.headers['x-sa-edge-country'] : '';
  return core.normalizeRegion(raw);
}

function resolveFromRequest(req, lookup) {
  var cookies = parseCookies(req && req.headers ? req.headers.cookie : '');
  var explicit = cookies.sa_ar_x === '1' ? core.normalizeRegion(cookies.sa_ar) : null;
  var ipCountry = null;
  var ipLookupFailed = false;
  if (!explicit) {
    var edge = readEdgeCountry(req);
    if (edge) {
      ipCountry = edge;
    } else if (typeof lookup === 'function') {
      try {
        var ip = readClientIp(req);
        var found = lookup(ip);
        if (found == null || found === '') ipCountry = null;
        else ipCountry = found;
      } catch (_) {
        ipLookupFailed = true;
      }
    }
  }
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
  cookieHeader: cookieHeader,
};
