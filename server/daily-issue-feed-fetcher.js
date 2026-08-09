'use strict';

/**
 * 데일리 이슈 피드 HTTP 수집기 — SSRF 차단 · timeout · 크기 제한 · redirect 제한
 */

const dns = require('dns').promises;
const { URL } = require('url');
const net = require('net');

const DEFAULT_UA = 'SentenceArenaDailyIssueBot/1.0 (+https://localhost; daily-issue ingest; contact: local-dev)';
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAX_BYTES = 1_500_000;
const DEFAULT_MAX_REDIRECTS = 3;
const ALLOWED_PROTOCOLS = { 'http:': 1, 'https:': 1 };
const ALLOWED_CONTENT_HINT =
  /^(application\/(rss\+xml|atom\+xml|xml|xhtml\+xml|json)|text\/(xml|plain|html)|application\/octet-stream)/i;

function isPrivateIpv4(ip) {
  const parts = String(ip)
    .split('.')
    .map(function (x) {
      return Number(x);
    });
  if (parts.length !== 4 || parts.some(function (n) {
    return !Number.isFinite(n);
  }))
    return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && parts[2] === 0) return true;
  return false;
}

function isBlockedHostname(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === 'metadata.google.internal') return true;
  if (h === 'metadata' || h === 'instance-data') return true;
  return false;
}

function isBlockedIp(ip) {
  const s = String(ip || '');
  if (!s) return true;
  if (net.isIPv4(s)) return isPrivateIpv4(s);
  if (net.isIPv6(s)) {
    const lower = s.toLowerCase();
    if (lower === '::1') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb'))
      return true; // fe80::/10
    if (lower === '::' || lower.startsWith('::ffff:')) {
      const v4 = lower.replace(/^::ffff:/, '');
      if (net.isIPv4(v4)) return isPrivateIpv4(v4);
    }
    return false;
  }
  return true;
}

async function assertUrlSafe(rawUrl) {
  let u;
  try {
    u = new URL(String(rawUrl || ''));
  } catch (_) {
    const err = new Error('URL_INVALID');
    err.code = 'URL_INVALID';
    throw err;
  }
  if (!ALLOWED_PROTOCOLS[u.protocol]) {
    const err = new Error('URL_PROTOCOL_BLOCKED');
    err.code = 'URL_PROTOCOL_BLOCKED';
    throw err;
  }
  if (isBlockedHostname(u.hostname)) {
    const err = new Error('URL_HOST_BLOCKED');
    err.code = 'URL_HOST_BLOCKED';
    throw err;
  }
  // literal IP in hostname
  if (net.isIP(u.hostname)) {
    if (isBlockedIp(u.hostname)) {
      const err = new Error('URL_IP_BLOCKED');
      err.code = 'URL_IP_BLOCKED';
      throw err;
    }
    return u;
  }
  const looked = await dns.lookup(u.hostname, { all: true });
  if (!looked || !looked.length) {
    const err = new Error('DNS_LOOKUP_FAILED');
    err.code = 'DNS_LOOKUP_FAILED';
    throw err;
  }
  for (const row of looked) {
    if (isBlockedIp(row.address)) {
      const err = new Error('URL_IP_BLOCKED');
      err.code = 'URL_IP_BLOCKED';
      throw err;
    }
  }
  return u;
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * @param {string} url
 * @param {{ timeoutMs?: number, maxBytes?: number, maxRedirects?: number, headers?: object, etag?: string, lastModified?: string }} opts
 */
async function fetchTextSafe(url, opts) {
  const o = opts || {};
  const timeoutMs = Number(o.timeoutMs) > 0 ? Number(o.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const maxBytes = Number(o.maxBytes) > 0 ? Number(o.maxBytes) : DEFAULT_MAX_BYTES;
  const maxRedirects = Number.isFinite(Number(o.maxRedirects)) ? Number(o.maxRedirects) : DEFAULT_MAX_REDIRECTS;
  let current = String(url || '');
  let redirects = 0;
  const trail = [];

  while (redirects <= maxRedirects) {
    await assertUrlSafe(current);
    const controller = new AbortController();
    const timer = setTimeout(function () {
      controller.abort();
    }, timeoutMs);
    const headers = Object.assign(
      {
        'User-Agent': DEFAULT_UA,
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.8',
      },
      o.headers || {},
    );
    if (o.etag) headers['If-None-Match'] = o.etag;
    if (o.lastModified) headers['If-Modified-Since'] = o.lastModified;

    let res;
    try {
      res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: headers,
      });
    } catch (e) {
      clearTimeout(timer);
      const err = new Error(e && e.name === 'AbortError' ? 'FETCH_TIMEOUT' : 'FETCH_FAILED');
      err.code = err.message;
      err.cause = e;
      throw err;
    } finally {
      clearTimeout(timer);
    }

    trail.push({ url: current, status: res.status });

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) {
        const err = new Error('REDIRECT_MISSING_LOCATION');
        err.code = 'REDIRECT_MISSING_LOCATION';
        throw err;
      }
      redirects += 1;
      if (redirects > maxRedirects) {
        const err = new Error('REDIRECT_LIMIT');
        err.code = 'REDIRECT_LIMIT';
        throw err;
      }
      current = new URL(loc, current).toString();
      continue;
    }

    if (res.status === 304) {
      return {
        ok: true,
        notModified: true,
        status: 304,
        url: current,
        body: '',
        contentType: res.headers.get('content-type') || '',
        etag: res.headers.get('etag') || o.etag || '',
        lastModified: res.headers.get('last-modified') || o.lastModified || '',
        redirectTrail: trail,
      };
    }

    if (res.status === 429 || res.status === 503) {
      const err = new Error('FETCH_RATE_LIMITED');
      err.code = 'FETCH_RATE_LIMITED';
      err.status = res.status;
      throw err;
    }

    if (res.status < 200 || res.status >= 300) {
      const err = new Error('FETCH_HTTP_' + res.status);
      err.code = 'FETCH_HTTP_ERROR';
      err.status = res.status;
      throw err;
    }

    const ct = res.headers.get('content-type') || '';
    if (ct && !ALLOWED_CONTENT_HINT.test(ct.split(';')[0].trim()) && !/xml|rss|atom|text/i.test(ct)) {
      const err = new Error('CONTENT_TYPE_BLOCKED');
      err.code = 'CONTENT_TYPE_BLOCKED';
      err.contentType = ct;
      throw err;
    }

    const cl = Number(res.headers.get('content-length'));
    if (Number.isFinite(cl) && cl > maxBytes) {
      const err = new Error('RESPONSE_TOO_LARGE');
      err.code = 'RESPONSE_TOO_LARGE';
      throw err;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
      const err = new Error('RESPONSE_TOO_LARGE');
      err.code = 'RESPONSE_TOO_LARGE';
      throw err;
    }

    return {
      ok: true,
      notModified: false,
      status: res.status,
      url: current,
      body: buf.toString('utf8'),
      contentType: ct,
      etag: res.headers.get('etag') || '',
      lastModified: res.headers.get('last-modified') || '',
      redirectTrail: trail,
      byteLength: buf.length,
    };
  }

  const err = new Error('REDIRECT_LIMIT');
  err.code = 'REDIRECT_LIMIT';
  throw err;
}

/**
 * 출처별 직렬 요청 + 간격
 */
async function fetchFeedsSequential(sources, opts) {
  const o = opts || {};
  const gapMs = Number(o.gapMs) > 0 ? Number(o.gapMs) : 400;
  const results = [];
  for (let i = 0; i < (sources || []).length; i++) {
    const src = sources[i];
    if (!src || !src.feedUrl) continue;
    try {
      const fetched = await fetchTextSafe(src.feedUrl, o);
      results.push({ sourceId: src.id, ok: true, fetched: fetched, error: null });
    } catch (e) {
      results.push({
        sourceId: src.id,
        ok: false,
        fetched: null,
        error: { code: e.code || 'FETCH_FAILED', message: String(e.message || e) },
      });
    }
    if (i < sources.length - 1) await sleep(gapMs);
  }
  return results;
}

module.exports = {
  DEFAULT_UA: DEFAULT_UA,
  DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_BYTES: DEFAULT_MAX_BYTES,
  DEFAULT_MAX_REDIRECTS: DEFAULT_MAX_REDIRECTS,
  isPrivateIpv4: isPrivateIpv4,
  isBlockedHostname: isBlockedHostname,
  isBlockedIp: isBlockedIp,
  assertUrlSafe: assertUrlSafe,
  fetchTextSafe: fetchTextSafe,
  fetchFeedsSequential: fetchFeedsSequential,
};
