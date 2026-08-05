/**
 * 데일리 이슈 — RSS/Atom 파싱 · URL 정규화 · HTML 정리 (네트워크 비의존)
 * Node(CommonJS) · 브라우저(UMD)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DailyIssueFeedCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function dailyIssueFeedCoreFactory() {
  'use strict';

  var TRACKING_PARAMS = Object.freeze({
    utm_source: 1,
    utm_medium: 1,
    utm_campaign: 1,
    utm_term: 1,
    utm_content: 1,
    utm_id: 1,
    fbclid: 1,
    gclid: 1,
    gclsrc: 1,
    dclid: 1,
    msclkid: 1,
    mc_cid: 1,
    mc_eid: 1,
    _ga: 1,
    _gl: 1,
  });

  function trimStr(v) {
    return String(v == null ? '' : v).trim();
  }

  function decodeHtmlEntities(input) {
    var s = String(input == null ? '' : input);
    s = s.replace(/&#x([0-9a-fA-F]+);/g, function (_, h) {
      return String.fromCodePoint(parseInt(h, 16));
    });
    s = s.replace(/&#(\d+);/g, function (_, d) {
      return String.fromCodePoint(parseInt(d, 10));
    });
    var named = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
      nbsp: ' ',
    };
    s = s.replace(/&([a-zA-Z]+);/g, function (m, name) {
      return named[name] != null ? named[name] : m;
    });
    return s;
  }

  function stripHtmlToText(html) {
    var s = String(html == null ? '' : html);
    s = s.replace(/<(script|style|iframe|object|embed|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
    s = s.replace(/<(script|style|iframe|object|embed|noscript)[^>]*\/>/gi, ' ');
    s = s.replace(/<!--[\s\S]*?-->/g, ' ');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n');
    s = s.replace(/<[^>]+>/g, ' ');
    s = decodeHtmlEntities(s);
    s = s.replace(/\u00a0/g, ' ');
    s = s.replace(/[ \t]+\n/g, '\n');
    s = s.replace(/\n{3,}/g, '\n\n');
    s = s.replace(/[ \t]{2,}/g, ' ');
    return trimStr(s);
  }

  function normalizeArticleUrl(rawUrl) {
    var input = trimStr(rawUrl);
    if (!input) return { ok: false, url: '', reason: 'URL_EMPTY' };
    var u;
    try {
      u = new URL(input);
    } catch (_) {
      return { ok: false, url: '', reason: 'URL_INVALID' };
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { ok: false, url: '', reason: 'URL_PROTOCOL' };
    }
    u.hash = '';
    var keys = [];
    u.searchParams.forEach(function (_v, k) {
      keys.push(k);
    });
    keys.forEach(function (k) {
      if (TRACKING_PARAMS[String(k).toLowerCase()]) u.searchParams.delete(k);
    });
    // normalize trailing slash lightly: keep path as-is except empty path
    var out = u.toString();
    return { ok: true, url: out, originDomain: String(u.hostname || '').toLowerCase() };
  }

  function parseFeedDate(raw) {
    var s = trimStr(raw);
    if (!s) return { ok: false, iso: '', reason: 'DATE_EMPTY' };
    var t = Date.parse(s);
    if (!isFinite(t)) return { ok: false, iso: '', reason: 'DATE_PARSE_FAILED' };
    return { ok: true, iso: new Date(t).toISOString() };
  }

  function extractTag(block, tagNames) {
    var names = Array.isArray(tagNames) ? tagNames : [tagNames];
    var i;
    for (i = 0; i < names.length; i++) {
      var tag = names[i];
      var reCdata = new RegExp(
        '<' + tag + '(?:\\s[^>]*)?>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</' + tag + '>',
        'i',
      );
      var m = block.match(reCdata);
      if (m) return decodeHtmlEntities(m[1]);
      var re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i');
      m = block.match(re);
      if (m) return decodeHtmlEntities(stripInnerXmlNoise(m[1]));
      var selfHref = new RegExp('<' + tag + '[^>]*href=["\']([^"\']+)["\'][^>]*/?>', 'i');
      m = block.match(selfHref);
      if (m) return trimStr(m[1]);
    }
    return '';
  }

  function stripInnerXmlNoise(s) {
    var t = String(s || '');
    // nested simple tags (e.g. <link> wrapped) — if still has tags, strip to text lightly
    if (/</.test(t) && !/<!\[CDATA\[/.test(t)) {
      t = t.replace(/<[^>]+>/g, '');
    }
    return trimStr(t);
  }

  function extractAtomLink(block) {
    var relAlt = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i);
    if (relAlt) return trimStr(relAlt[1]);
    var hrefRel = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["'][^>]*\/?>/i);
    if (hrefRel) return trimStr(hrefRel[1]);
    var plain = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
    if (plain) return trimStr(plain[1]);
    return extractTag(block, ['link']);
  }

  function splitItems(xml, itemTag) {
    var re = new RegExp('<' + itemTag + '(?:\\s[^>]*)?>[\\s\\S]*?<\\/' + itemTag + '>', 'gi');
    var out = [];
    var m;
    while ((m = re.exec(xml))) out.push(m[0]);
    return out;
  }

  function parseRssItem(block, meta) {
    var title = trimStr(extractTag(block, ['title']));
    var link = trimStr(extractTag(block, ['link']));
    if (!link) {
      var enc = block.match(/<enclosure[^>]*url=["']([^"']+)["']/i);
      if (enc) link = trimStr(enc[1]);
    }
    var guid = trimStr(extractTag(block, ['guid']));
    var pub = extractTag(block, ['pubDate', 'dc:date', 'published']);
    var updated = extractTag(block, ['updated', 'dc:date']);
    var author = extractTag(block, ['author', 'dc:creator']);
    var description = extractTag(block, ['description', 'summary']);
    var content = extractTag(block, ['content:encoded', 'content']);
    var cats = [];
    var catRe = /<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi;
    var cm;
    while ((cm = catRe.exec(block))) cats.push(trimStr(decodeHtmlEntities(cm[1].replace(/<[^>]+>/g, ''))));

    var dateParsed = parseFeedDate(pub || updated);
    var urlNorm = normalizeArticleUrl(link);

    return {
      externalId: guid || urlNorm.url || title,
      publisher: meta.publisher || '',
      title: title,
      url: urlNorm.ok ? urlNorm.url : '',
      urlOk: urlNorm.ok,
      publishedAt: dateParsed.ok ? dateParsed.iso : '',
      publishedAtOk: dateParsed.ok,
      updatedAt: parseFeedDate(updated).ok ? parseFeedDate(updated).iso : '',
      author: author,
      rawSummary: description,
      rawContent: content,
      categories: cats,
      sourceRegistryId: meta.sourceRegistryId || '',
      retrievedAt: meta.retrievedAt || '',
      feedKind: 'RSS',
      parseErrors: [].concat(
        !title ? ['TITLE_MISSING'] : [],
        !urlNorm.ok ? ['URL_INVALID'] : [],
        !dateParsed.ok ? ['DATE_PARSE_FAILED'] : [],
      ),
    };
  }

  function parseAtomEntry(block, meta) {
    var title = trimStr(extractTag(block, ['title']));
    var link = extractAtomLink(block);
    var id = trimStr(extractTag(block, ['id']));
    var published = extractTag(block, ['published', 'updated']);
    var updated = extractTag(block, ['updated', 'published']);
    var authorBlock = block.match(/<author[\s\S]*?<\/author>/i);
    var author = authorBlock ? extractTag(authorBlock[0], ['name']) : extractTag(block, ['author']);
    var summary = extractTag(block, ['summary']);
    var content = extractTag(block, ['content']);
    var dateParsed = parseFeedDate(published || updated);
    var urlNorm = normalizeArticleUrl(link);
    return {
      externalId: id || urlNorm.url || title,
      publisher: meta.publisher || '',
      title: title,
      url: urlNorm.ok ? urlNorm.url : '',
      urlOk: urlNorm.ok,
      publishedAt: dateParsed.ok ? dateParsed.iso : '',
      publishedAtOk: dateParsed.ok,
      updatedAt: parseFeedDate(updated).ok ? parseFeedDate(updated).iso : '',
      author: author,
      rawSummary: summary,
      rawContent: content,
      categories: [],
      sourceRegistryId: meta.sourceRegistryId || '',
      retrievedAt: meta.retrievedAt || '',
      feedKind: 'ATOM',
      parseErrors: [].concat(
        !title ? ['TITLE_MISSING'] : [],
        !urlNorm.ok ? ['URL_INVALID'] : [],
        !dateParsed.ok ? ['DATE_PARSE_FAILED'] : [],
      ),
    };
  }

  /**
   * @param {string} xml
   * @param {{ publisher?: string, sourceRegistryId?: string, retrievedAt?: string }} meta
   */
  function parseRssOrAtom(xml, meta) {
    var body = String(xml || '');
    var m = meta || {};
    var retrievedAt = trimStr(m.retrievedAt) || new Date().toISOString();
    var base = {
      publisher: trimStr(m.publisher),
      sourceRegistryId: trimStr(m.sourceRegistryId),
      retrievedAt: retrievedAt,
    };
    var items = [];
    var kind = 'UNKNOWN';
    if (/<rss[\s>]/i.test(body) || /<channel[\s>]/i.test(body)) {
      kind = 'RSS';
      splitItems(body, 'item').forEach(function (block) {
        items.push(parseRssItem(block, base));
      });
    } else if (/<feed[\s>]/i.test(body) || /xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom["']/i.test(body)) {
      kind = 'ATOM';
      splitItems(body, 'entry').forEach(function (block) {
        items.push(parseAtomEntry(block, base));
      });
    } else {
      return { ok: false, feedKind: kind, items: [], reason: 'FEED_FORMAT_UNKNOWN' };
    }
    return { ok: true, feedKind: kind, items: items, reason: '' };
  }

  function isValidFeedItem(item) {
    return !!(item && item.title && item.url && item.publishedAt && (!item.parseErrors || !item.parseErrors.length));
  }

  function pickRawTextFromFeedItem(item, opts) {
    var o = opts || {};
    var full = stripHtmlToText(item && item.rawContent);
    if (full && full.length >= 40) return { text: full, from: 'content' };
    if (o.allowFeedDescriptionEvidence !== false) {
      var sum = stripHtmlToText(item && item.rawSummary);
      if (sum && sum.length >= 40) return { text: sum, from: 'summary' };
    }
    return { text: '', from: 'empty' };
  }

  return {
    TRACKING_PARAMS: TRACKING_PARAMS,
    decodeHtmlEntities: decodeHtmlEntities,
    stripHtmlToText: stripHtmlToText,
    normalizeArticleUrl: normalizeArticleUrl,
    parseFeedDate: parseFeedDate,
    parseRssOrAtom: parseRssOrAtom,
    isValidFeedItem: isValidFeedItem,
    pickRawTextFromFeedItem: pickRawTextFromFeedItem,
  };
});
