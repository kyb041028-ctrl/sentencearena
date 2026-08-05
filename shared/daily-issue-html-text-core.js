/**
 * 데일리 이슈 — HTML → 텍스트 제한 추출 (네트워크 비의존)
 * selector 실패 시 document.body 전체 fallback 금지
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DailyIssueHtmlTextCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function dailyIssueHtmlTextCoreFactory() {
  'use strict';

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
    var named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    s = s.replace(/&([a-zA-Z]+);/g, function (m, name) {
      return named[name] != null ? named[name] : m;
    });
    return s;
  }

  function removeTagsByName(html, tagNames) {
    var s = String(html || '');
    var i;
    for (i = 0; i < tagNames.length; i++) {
      var tag = tagNames[i];
      var re = new RegExp('<' + tag + '[^>]*>[\\s\\S]*?<\\/' + tag + '>', 'gi');
      s = s.replace(re, ' ');
      s = s.replace(new RegExp('<' + tag + '[^>]*\\/>', 'gi'), ' ');
    }
    return s;
  }

  function removeBySelectors(html, selectors) {
    var s = String(html || '');
    var i;
    for (i = 0; i < (selectors || []).length; i++) {
      var sel = String(selectors[i] || '').trim();
      if (!sel) continue;
      if (sel.charAt(0) === '#') {
        var id = sel.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        s = s.replace(
          new RegExp('<[^>]+\\sid=["\']' + id + '["\'][^>]*>[\\s\\S]*?<\\/(?:div|section|aside|nav|footer|header)>', 'i'),
          ' ',
        );
      } else if (sel.charAt(0) === '.') {
        var cls = sel.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        s = s.replace(
          new RegExp(
            '<[^>]+\\sclass=["\'][^"\']*\\b' + cls + '\\b[^"\']*["\'][^>]*>[\\s\\S]*?<\\/(?:div|section|aside|nav|footer|header)>',
            'i',
          ),
          ' ',
        );
      } else {
        s = removeTagsByName(s, [sel]);
      }
    }
    return s;
  }

  /**
   * Extract inner HTML of first element matching id or class selector.
   * Returns '' on failure — never falls back to full body.
   */
  function extractFragmentBySelector(html, selector) {
    var s = String(html || '');
    var sel = String(selector || '').trim();
    if (!sel) return '';
    var marker;
    if (sel.charAt(0) === '#') {
      marker = new RegExp('id=["\']' + sel.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\']', 'i');
    } else if (sel.charAt(0) === '.') {
      marker = new RegExp(
        'class=["\'][^"\']*\\b' + sel.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b[^"\']*["\']',
        'i',
      );
    } else {
      return '';
    }
    var m = marker.exec(s);
    if (!m) return '';
    var openStart = s.lastIndexOf('<', m.index);
    if (openStart < 0) return '';
    var openEnd = s.indexOf('>', m.index);
    if (openEnd < 0) return '';
    // Bounded window — official board pages keep body near top
    var windowEnd = Math.min(s.length, openEnd + 1 + 120000);
    return s.slice(openEnd + 1, windowEnd);
  }

  function htmlFragmentToText(fragment) {
    var s = String(fragment || '');
    s = removeTagsByName(s, ['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'svg']);
    s = s.replace(/<!--[\s\S]*?-->/g, ' ');
    s = s.replace(/<(nav|header|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n');
    s = s.replace(/<[^>]+>/g, ' ');
    s = decodeHtmlEntities(s);
    s = s.replace(/\u00a0/g, ' ');
    s = s.replace(/[ \t]+\n/g, '\n');
    s = s.replace(/\n{3,}/g, '\n\n');
    s = s.replace(/[ \t]{2,}/g, ' ');
    return trimStr(s);
  }

  /**
   * @param {string} html
   * @param {{ contentSelectors?: string[], removeSelectors?: string[], minChars?: number }} opts
   */
  function extractOfficialPageText(html, opts) {
    var o = opts || {};
    var selectors = Array.isArray(o.contentSelectors) ? o.contentSelectors : [];
    var minChars = isFinite(Number(o.minChars)) ? Number(o.minChars) : 80;
    if (!selectors.length) {
      return { ok: false, text: '', reason: 'SELECTOR_MISSING', matchedSelector: '' };
    }
    var i;
    for (i = 0; i < selectors.length; i++) {
      var frag = extractFragmentBySelector(html, selectors[i]);
      if (!frag) continue;
      frag = removeBySelectors(frag, o.removeSelectors || []);
      var text = htmlFragmentToText(frag);
      // drop attachment-only noise lines but keep dates/titles
      text = text
        .split(/\n+/)
        .filter(function (line) {
          var L = line.toLowerCase();
          if (/copyright|family site|개인정보|이메일주소|무단 수집|홈페이지 이용안내/.test(L)) return false;
          if (/^첨부파일$|^attachment$|^download$|^다운로드$/.test(trimStr(line))) return false;
          return true;
        })
        .join('\n');
      text = trimStr(text);
      if (text.length < minChars) {
        return { ok: false, text: '', reason: 'EXTRACTED_TOO_SHORT', matchedSelector: selectors[i] };
      }
      // reject pure nav leftovers
      if (/페이지 위로 이동|내가 본 콘텐츠/.test(text) && text.length < 200) {
        return { ok: false, text: '', reason: 'NAV_ONLY', matchedSelector: selectors[i] };
      }
      return { ok: true, text: text, reason: '', matchedSelector: selectors[i] };
    }
    return { ok: false, text: '', reason: 'SELECTOR_FAILED', matchedSelector: '' };
  }

  return {
    decodeHtmlEntities: decodeHtmlEntities,
    removeTagsByName: removeTagsByName,
    removeBySelectors: removeBySelectors,
    extractFragmentBySelector: extractFragmentBySelector,
    htmlFragmentToText: htmlFragmentToText,
    extractOfficialPageText: extractOfficialPageText,
  };
});
