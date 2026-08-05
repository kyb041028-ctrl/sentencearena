'use strict';

/**
 * 공식기관 공개 HTML 페이지 제한 추출기
 * allowlist + SSRF fetch + selector 기반 본문만
 */

const { URL } = require('url');
const fetcher = require('./daily-issue-feed-fetcher');
const allowlist = require('../config/daily-issue-fulltext-allowlist');
const htmlText = require('../shared/daily-issue-html-text-core');

/**
 * @param {{ sourceRegistryId: string, url: string, html?: string, skipNetwork?: boolean }} input
 */
async function extractOfficialPublicPage(input) {
  const src = input || {};
  const evalUrl = allowlist.evaluateFullTextUrl(src.sourceRegistryId, src.url);
  if (!evalUrl.ok) {
    return { ok: false, reason: evalUrl.reason, text: '', finalUrl: '', matchedSelector: '' };
  }
  const entry = evalUrl.entry;
  let html = src.html != null ? String(src.html) : '';
  let finalUrl = String(src.url);

  if (!html) {
    if (src.skipNetwork) {
      return { ok: false, reason: 'NETWORK_SKIPPED', text: '', finalUrl: finalUrl, matchedSelector: '' };
    }
    try {
      const fetched = await fetcher.fetchTextSafe(src.url, {
        timeoutMs: entry.timeoutMs || 15000,
        maxBytes: entry.maxBytes || 800000,
        maxRedirects: 3,
      });
      html = fetched.body || '';
      finalUrl = fetched.url || finalUrl;
    } catch (e) {
      return {
        ok: false,
        reason: e.code || 'FETCH_FAILED',
        text: '',
        finalUrl: finalUrl,
        matchedSelector: '',
      };
    }
  }

  // re-check final URL after redirects
  const recheck = allowlist.evaluateFullTextUrl(src.sourceRegistryId, finalUrl);
  if (!recheck.ok) {
    return { ok: false, reason: 'REDIRECT_' + recheck.reason, text: '', finalUrl: finalUrl, matchedSelector: '' };
  }

  const extracted = htmlText.extractOfficialPageText(html, {
    contentSelectors: entry.contentSelectors,
    removeSelectors: entry.removeSelectors,
    minChars: entry.minChars,
  });
  if (!extracted.ok) {
    return {
      ok: false,
      reason: extracted.reason || 'EXTRACT_FAILED',
      text: '',
      finalUrl: finalUrl,
      matchedSelector: extracted.matchedSelector || '',
    };
  }
  return {
    ok: true,
    reason: '',
    text: extracted.text,
    finalUrl: finalUrl,
    matchedSelector: extracted.matchedSelector,
    extractionMode: entry.extractionMode,
  };
}

module.exports = {
  extractOfficialPublicPage: extractOfficialPublicPage,
  evaluateFullTextUrl: allowlist.evaluateFullTextUrl,
};
