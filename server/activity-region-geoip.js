'use strict';

/**
 * 무료 국가 조회. API 키도, 추가 요금도 없다.
 * 브라우저가 보낸 국가 헤더는 받지 않는다. 서버가 고른 접속 주소만 조회한다.
 * 사설·루프백 주소는 외부로 보내지 않는다.
 * 국가 코드만 프로세스 메모리에 짧게 둔다. 디스크, DB, 응답, 로그에는 주소를 쓰지 않는다.
 */

function normalizeIp(ip) {
  var raw = String(ip || '').trim().toLowerCase();
  if (raw.indexOf('::ffff:') === 0) raw = raw.slice(7);
  var zone = raw.indexOf('%');
  if (zone >= 0) raw = raw.slice(0, zone);
  return raw;
}

function isPrivateAddress(ip) {
  var raw = normalizeIp(ip);
  if (!raw) return true;
  if (raw === '::1' || raw === '0.0.0.0' || raw === 'localhost') return true;
  if (raw.indexOf('127.') === 0) return true;
  if (raw.indexOf('10.') === 0) return true;
  if (raw.indexOf('192.168.') === 0) return true;
  if (raw.indexOf('169.254.') === 0) return true;
  if (raw.indexOf('fc') === 0 || raw.indexOf('fd') === 0 || raw.indexOf('fe80') === 0) return true;
  var parts = raw.split('.');
  if (parts.length === 4 && parts[0] === '172') {
    var second = Number(parts[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function createGeoIpLookup(options) {
  var opts = options || {};
  var fetchImpl = opts.fetch || globalThis.fetch;
  var timeoutMs = opts.timeoutMs || 1200;
  var ttlMs = opts.ttlMs || 10 * 60 * 1000;
  var maxEntries = opts.maxEntries || 200;
  var cache = new Map();

  async function lookup(ip) {
    var key = normalizeIp(ip);
    if (!key || isPrivateAddress(key)) return null;
    var now = Date.now();
    var hit = cache.get(key);
    if (hit && hit.expires > now) return hit.code;
    if (typeof fetchImpl !== 'function') {
      var missing = new Error('GEOIP_LOOKUP_FAILED');
      missing.code = 'GEOIP_LOOKUP_FAILED';
      throw missing;
    }
    var res = await fetchImpl('https://ipwho.is/' + encodeURIComponent(key), {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res || res.ok !== true) {
      var failed = new Error('GEOIP_LOOKUP_FAILED');
      failed.code = 'GEOIP_LOOKUP_FAILED';
      throw failed;
    }
    var body = await res.json();
    if (!body || body.success !== true || !body.country_code) {
      var empty = new Error('GEOIP_LOOKUP_FAILED');
      empty.code = 'GEOIP_LOOKUP_FAILED';
      throw empty;
    }
    var code = String(body.country_code).trim().toUpperCase();
    if (cache.size >= maxEntries) {
      var oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
    cache.set(key, { code: code, expires: now + ttlMs });
    return code;
  }

  return lookup;
}

module.exports = {
  createGeoIpLookup: createGeoIpLookup,
  isPrivateAddress: isPrivateAddress,
};
