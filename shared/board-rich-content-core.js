/**
 * 게시글 제한형 리치 본문 — sanitize / excerpt / empty 판정
 * 브라우저(UMD) · Node(CommonJS)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BoardRichContentCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function boardRichContentCoreFactory() {
  'use strict';

  var BLOCK_TAGS = {
    P: true,
    H3: true,
    BLOCKQUOTE: true,
    UL: true,
    OL: true,
    LI: true,
    HR: true,
  };

  var INLINE_TAGS = {
    STRONG: true,
    EM: true,
    U: true,
    S: true,
    A: true,
    BR: true,
  };

  var TAG_ALIASES = {
    B: 'STRONG',
    I: 'EM',
    STRIKE: 'S',
    DEL: 'S',
  };

  function escapeText(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function unescapeEntities(s) {
    return String(s || '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  function normalizeBodyFormat(v) {
    return String(v || '').toLowerCase() === 'rich' ? 'rich' : 'plain';
  }

  function isSafeHttpUrl(url) {
    var raw = String(url || '').trim();
    if (!/^https?:\/\//i.test(raw)) return false;
    try {
      var u = new URL(raw);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  function sanitizeHref(href) {
    var raw = String(href || '').trim();
    if (!isSafeHttpUrl(raw)) return null;
    return raw;
  }

  function canonicalTag(name) {
    var upper = String(name || '').toUpperCase();
    if (TAG_ALIASES[upper]) return TAG_ALIASES[upper];
    return upper;
  }

  function isAllowedTag(tag) {
    return !!(BLOCK_TAGS[tag] || INLINE_TAGS[tag]);
  }

  function stripDangerousBlocks(html) {
    return String(html || '')
      .replace(/<\s*(script|style|iframe|object|embed|form|input|button|video|audio|svg)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
      .replace(/<\s*(script|style|iframe|object|embed|form|input|button|video|audio|svg)[^>]*\/?\s*>/gi, '');
  }

  /** Node/브라우저 공통 문자열 기반 whitelist sanitize */
  function sanitizeHtmlString(html) {
    var input = stripDangerousBlocks(html);
    var out = '';
    var i = 0;
    var len = input.length;
    var openStack = [];

    function readUntil(ch) {
      var start = i;
      while (i < len && input.charAt(i) !== ch) i++;
      return input.slice(start, i);
    }

    while (i < len) {
      var c = input.charAt(i);
      if (c !== '<') {
        var textStart = i;
        while (i < len && input.charAt(i) !== '<') i++;
        out += escapeText(unescapeEntities(input.slice(textStart, i)));
        continue;
      }

      i++; // skip <
      if (i >= len) break;

      if (input.charAt(i) === '!') {
        // comment / doctype
        var endBang = input.indexOf('>', i);
        if (endBang < 0) break;
        i = endBang + 1;
        continue;
      }

      var isClose = false;
      if (input.charAt(i) === '/') {
        isClose = true;
        i++;
      }

      var tagName = '';
      while (i < len && /[A-Za-z0-9]/.test(input.charAt(i))) {
        tagName += input.charAt(i);
        i++;
      }
      var tag = canonicalTag(tagName);

      // attrs until >
      var attrsRaw = '';
      var selfClosing = false;
      while (i < len) {
        var ch = input.charAt(i);
        if (ch === '>') {
          i++;
          break;
        }
        if (ch === '/' && input.charAt(i + 1) === '>') {
          selfClosing = true;
          i += 2;
          break;
        }
        attrsRaw += ch;
        i++;
      }

      if (!isAllowedTag(tag) && tag !== 'DIV' && tag !== 'SPAN') {
        continue;
      }

      if (tag === 'DIV') tag = 'P';
      if (tag === 'SPAN') {
        // unwrap: ignore open/close
        continue;
      }

      if (isClose) {
        // close nearest matching
        var found = -1;
        var si;
        for (si = openStack.length - 1; si >= 0; si--) {
          if (openStack[si] === tag) {
            found = si;
            break;
          }
        }
        if (found >= 0) {
          while (openStack.length > found) {
            out += '</' + openStack.pop().toLowerCase() + '>';
          }
        }
        continue;
      }

      if (tag === 'BR' || tag === 'HR') {
        out += '<' + tag.toLowerCase() + '>';
        continue;
      }

      if (tag === 'A') {
        var hrefMatch = attrsRaw.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
        var hrefVal = hrefMatch ? hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || '' : '';
        var safe = sanitizeHref(unescapeEntities(hrefVal));
        if (!safe) {
          // treat as unwrap — push marker? just skip open tag, text still flows
          continue;
        }
        out +=
          '<a href="' +
          escapeText(safe) +
          '" target="_blank" rel="noopener noreferrer">';
        openStack.push('A');
        continue;
      }

      out += '<' + tag.toLowerCase() + '>';
      openStack.push(tag);
      if (selfClosing) {
        out += '</' + tag.toLowerCase() + '>';
        openStack.pop();
      }
    }

    while (openStack.length) {
      out += '</' + openStack.pop().toLowerCase() + '>';
    }

    return out
      .replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>')
      .replace(/(<p>\s*<\/p>\s*)+/gi, '')
      .trim();
  }

  function sanitizeHtml(html) {
    var input = String(html || '');
    if (!input.trim()) return '';

    if (typeof DOMParser !== 'undefined') {
      try {
        var doc = new DOMParser().parseFromString(
          '<div id="brc-root">' + stripDangerousBlocks(input) + '</div>',
          'text/html',
        );
        var root = doc.getElementById('brc-root') || doc.body;
        cleanDomTree(root);
        return String(root.innerHTML || '')
          .replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>')
          .replace(/(<p>\s*<\/p>\s*)+/gi, '')
          .trim();
      } catch (_) {
        return sanitizeHtmlString(input);
      }
    }
    return sanitizeHtmlString(input);
  }

  function unwrapNode(node) {
    var parent = node.parentNode;
    if (!parent) return;
    while (node.firstChild) parent.insertBefore(node.firstChild, node);
    parent.removeChild(node);
  }

  function renameNode(node, tagName) {
    var parent = node.parentNode;
    if (!parent) return node;
    var doc = node.ownerDocument;
    if (!doc || !doc.createElement) return node;
    var next = doc.createElement(tagName);
    while (node.firstChild) next.appendChild(node.firstChild);
    parent.replaceChild(next, node);
    return next;
  }

  function cleanDomTree(root) {
    var children = Array.prototype.slice.call(root.childNodes || []);
    var ci;
    for (ci = 0; ci < children.length; ci++) cleanDomNode(children[ci]);
  }

  function cleanDomNode(node) {
    if (!node) return;
    if (node.nodeType === 3) return;
    if (node.nodeType !== 1) {
      if (node.parentNode) node.parentNode.removeChild(node);
      return;
    }

    var tag = canonicalTag(node.tagName);
    var savedHref = tag === 'A' ? node.getAttribute('href') : null;

    if (
      tag === 'SCRIPT' ||
      tag === 'STYLE' ||
      tag === 'IFRAME' ||
      tag === 'OBJECT' ||
      tag === 'EMBED' ||
      tag === 'FORM' ||
      tag === 'INPUT' ||
      tag === 'BUTTON' ||
      tag === 'VIDEO' ||
      tag === 'AUDIO' ||
      tag === 'SVG'
    ) {
      if (node.parentNode) node.parentNode.removeChild(node);
      return;
    }

    if (tag === 'DIV') {
      node = renameNode(node, 'P');
      tag = 'P';
      savedHref = null;
    }

    if (tag === 'SPAN') {
      var spanKids = Array.prototype.slice.call(node.childNodes || []);
      var ski;
      for (ski = 0; ski < spanKids.length; ski++) cleanDomNode(spanKids[ski]);
      unwrapNode(node);
      return;
    }

    if (TAG_ALIASES[String(node.tagName || '').toUpperCase()]) {
      node = renameNode(node, tag);
    }

    if (!isAllowedTag(tag)) {
      var badKids = Array.prototype.slice.call(node.childNodes || []);
      var bki;
      for (bki = 0; bki < badKids.length; bki++) cleanDomNode(badKids[bki]);
      unwrapNode(node);
      return;
    }

    var attrs = Array.prototype.slice.call(node.attributes || []);
    var ai;
    for (ai = 0; ai < attrs.length; ai++) {
      node.removeAttribute(attrs[ai].name);
    }

    if (tag === 'A') {
      var safe = sanitizeHref(savedHref);
      if (!safe) {
        var aKids = Array.prototype.slice.call(node.childNodes || []);
        var aki;
        for (aki = 0; aki < aKids.length; aki++) cleanDomNode(aKids[aki]);
        unwrapNode(node);
        return;
      }
      node.setAttribute('href', safe);
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }

    var kids = Array.prototype.slice.call(node.childNodes || []);
    var ki;
    for (ki = 0; ki < kids.length; ki++) cleanDomNode(kids[ki]);
  }

  function htmlToPlainText(html) {
    var s = String(html || '');
    if (typeof document !== 'undefined' && document.createElement) {
      try {
        var d = document.createElement('div');
        d.innerHTML = sanitizeHtml(s);
        return String(d.textContent || d.innerText || '')
          .replace(/\u00a0/g, ' ')
          .replace(/[ \t]+\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      } catch (_) {
        /* fall through */
      }
    }
    return unescapeEntities(
      s
        .replace(/<\s*br\s*\/?>/gi, '\n')
        .replace(/<\/\s*(p|h3|li|blockquote)\s*>/gi, '\n')
        .replace(/<\s*hr\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ''),
    )
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function plainToHtml(text) {
    var t = String(text || '').replace(/\r\n/g, '\n');
    if (!t.trim()) return '';
    return t
      .split(/\n{2,}/)
      .map(function (block) {
        return '<p>' + escapeText(block).replace(/\n/g, '<br>') + '</p>';
      })
      .join('');
  }

  function isEffectivelyEmpty(htmlOrText, format) {
    var fmt = normalizeBodyFormat(format);
    if (fmt === 'rich') {
      return !htmlToPlainText(htmlOrText);
    }
    return !String(htmlOrText || '').trim();
  }

  function hasRichMarkup(html) {
    return /<(h3|strong|em|u|s|blockquote|ul|ol|li|a|hr)\b/i.test(String(html || ''));
  }

  function excerptFromBody(body, format, maxLen) {
    var limit = Math.max(20, Number(maxLen) || 120);
    var plain =
      normalizeBodyFormat(format) === 'rich' ? htmlToPlainText(body) : String(body || '').replace(/\s+/g, ' ').trim();
    if (normalizeBodyFormat(format) !== 'rich') {
      plain = String(body || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    } else {
      plain = htmlToPlainText(body).replace(/\s+/g, ' ').trim();
    }
    if (plain.length <= limit) return plain;
    return plain.slice(0, limit - 1) + '…';
  }

  function prepareForSave(htmlFromEditor) {
    var cleaned = sanitizeHtml(htmlFromEditor);
    var plain = htmlToPlainText(cleaned);
    if (!plain) {
      return { body: '', bodyFormat: 'plain', empty: true };
    }
    if (!hasRichMarkup(cleaned)) {
      return { body: plain, bodyFormat: 'plain', empty: false };
    }
    return { body: cleaned, bodyFormat: 'rich', empty: false };
  }

  function prepareForEditor(body, format) {
    var fmt = normalizeBodyFormat(format);
    var raw = body == null ? '' : String(body);
    if (fmt === 'rich') return sanitizeHtml(raw);
    return plainToHtml(raw);
  }

  function renderBodyHtml(body, format) {
    var fmt = normalizeBodyFormat(format);
    if (fmt === 'rich') return sanitizeHtml(body);
    return plainToHtml(body);
  }

  return {
    normalizeBodyFormat: normalizeBodyFormat,
    isSafeHttpUrl: isSafeHttpUrl,
    sanitizeHref: sanitizeHref,
    sanitizeHtml: sanitizeHtml,
    htmlToPlainText: htmlToPlainText,
    plainToHtml: plainToHtml,
    isEffectivelyEmpty: isEffectivelyEmpty,
    hasRichMarkup: hasRichMarkup,
    excerptFromBody: excerptFromBody,
    prepareForSave: prepareForSave,
    prepareForEditor: prepareForEditor,
    renderBodyHtml: renderBodyHtml,
    escapeText: escapeText,
  };
});
