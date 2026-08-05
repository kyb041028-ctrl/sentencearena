'use strict';

/**
 * 공식기관 원문 HTML fetch allowlist
 * - NEWS 기본 적용 금지
 * - selector 실패 시 body 전체 fallback 금지
 */

const ALLOWLIST = Object.freeze([
  Object.freeze({
    sourceRegistryId: 'bok-mpc-decisions',
    allowedOrigins: Object.freeze(['www.bok.or.kr', 'bok.or.kr']),
    allowedPathPatterns: Object.freeze([/^\/portal\/bbs\/P0000093\/view\.do/i]),
    deniedPathPatterns: Object.freeze([/\.pdf($|\?)/i, /\.hwp($|\?)/i, /\/download/i, /\/fileDown/i]),
    maxBytes: 800000,
    timeoutMs: 15000,
    extractionMode: 'OFFICIAL_BOARD_VIEW',
    contentSelectors: Object.freeze(['#board', '#content', '#main-container']),
    removeSelectors: Object.freeze(['#myView', 'nav', 'header', 'footer']),
    minChars: 80,
  }),
  Object.freeze({
    sourceRegistryId: 'bok-economic-outlook',
    allowedOrigins: Object.freeze(['www.bok.or.kr', 'bok.or.kr']),
    allowedPathPatterns: Object.freeze([/^\/portal\/bbs\/P0002359\/view\.do/i]),
    deniedPathPatterns: Object.freeze([/\.pdf($|\?)/i, /\.hwp($|\?)/i, /\/download/i, /\/fileDown/i]),
    maxBytes: 800000,
    timeoutMs: 15000,
    extractionMode: 'OFFICIAL_BOARD_VIEW',
    contentSelectors: Object.freeze(['#board', '#content', '#main-container']),
    removeSelectors: Object.freeze(['#myView', 'nav', 'header', 'footer']),
    minChars: 80,
  }),
  Object.freeze({
    sourceRegistryId: 'bok-press-kr',
    allowedOrigins: Object.freeze(['www.bok.or.kr', 'bok.or.kr']),
    allowedPathPatterns: Object.freeze([/^\/portal\/bbs\/P0000559\/view\.do/i]),
    deniedPathPatterns: Object.freeze([/\.pdf($|\?)/i, /\.hwp($|\?)/i, /\/download/i, /\/fileDown/i]),
    maxBytes: 800000,
    timeoutMs: 15000,
    extractionMode: 'OFFICIAL_BOARD_VIEW',
    contentSelectors: Object.freeze(['#board', '#content', '#main-container']),
    removeSelectors: Object.freeze(['#myView', 'nav', 'header', 'footer']),
    minChars: 80,
  }),
  Object.freeze({
    sourceRegistryId: 'bok-eng-press',
    allowedOrigins: Object.freeze(['www.bok.or.kr', 'bok.or.kr']),
    allowedPathPatterns: Object.freeze([/^\/eng\/bbs\/E0000634\/view\.do/i]),
    deniedPathPatterns: Object.freeze([/\.pdf($|\?)/i, /\.hwp($|\?)/i, /\/download/i, /\/fileDown/i]),
    maxBytes: 800000,
    timeoutMs: 15000,
    extractionMode: 'OFFICIAL_BOARD_VIEW',
    contentSelectors: Object.freeze(['#board', '#content', '#main-container']),
    removeSelectors: Object.freeze(['#myView', 'nav', 'header', 'footer']),
    minChars: 80,
  }),
]);

function getAllowlistEntry(sourceRegistryId) {
  var id = String(sourceRegistryId || '').trim();
  for (var i = 0; i < ALLOWLIST.length; i++) {
    if (ALLOWLIST[i].sourceRegistryId === id) return ALLOWLIST[i];
  }
  return null;
}

function pathAllowed(entry, pathname) {
  var p = String(pathname || '');
  var i;
  for (i = 0; i < (entry.deniedPathPatterns || []).length; i++) {
    if (entry.deniedPathPatterns[i].test(p)) return false;
  }
  if (!(entry.allowedPathPatterns || []).length) return false;
  for (i = 0; i < entry.allowedPathPatterns.length; i++) {
    if (entry.allowedPathPatterns[i].test(p)) return true;
  }
  return false;
}

function originAllowed(entry, hostname) {
  var h = String(hostname || '')
    .toLowerCase()
    .replace(/^www\./, '');
  return (entry.allowedOrigins || []).some(function (o) {
    return String(o).toLowerCase().replace(/^www\./, '') === h || String(o).toLowerCase() === String(hostname || '').toLowerCase();
  });
}

/**
 * @returns {{ ok: boolean, reason?: string, entry?: object, urlObj?: URL }}
 */
function evaluateFullTextUrl(sourceRegistryId, url) {
  var entry = getAllowlistEntry(sourceRegistryId);
  if (!entry) return { ok: false, reason: 'ALLOWLIST_MISSING' };
  if (!entry.extractionMode) return { ok: false, reason: 'EXTRACTION_MODE_MISSING' };
  var u;
  try {
    u = new URL(String(url || ''));
  } catch (_) {
    return { ok: false, reason: 'URL_INVALID' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'URL_PROTOCOL' };
  if (!originAllowed(entry, u.hostname)) return { ok: false, reason: 'ORIGIN_DENIED' };
  if (!pathAllowed(entry, u.pathname)) return { ok: false, reason: 'PATH_DENIED' };
  return { ok: true, entry: entry, urlObj: u };
}

module.exports = {
  ALLOWLIST: ALLOWLIST,
  getAllowlistEntry: getAllowlistEntry,
  pathAllowed: pathAllowed,
  originAllowed: originAllowed,
  evaluateFullTextUrl: evaluateFullTextUrl,
};
