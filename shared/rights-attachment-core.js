/**
 * 권리침해 증빙 첨부 검증.
 * 공개 게시판 노출 금지. 실행파일 차단. 파일명만 믿지 않음.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RightsAttachmentCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function rightsAttachmentCoreFactory() {
  'use strict';

  var MAX_FILES = 5;
  var MAX_BYTES = 5 * 1024 * 1024;
  var STAGING_TTL_MS = 60 * 60 * 1000;

  var ALLOWED = Object.freeze({
    png: { mime: 'image/png', ext: ['png'] },
    jpeg: { mime: 'image/jpeg', ext: ['jpg', 'jpeg'] },
    gif: { mime: 'image/gif', ext: ['gif'] },
    webp: { mime: 'image/webp', ext: ['webp'] },
    pdf: { mime: 'application/pdf', ext: ['pdf'] },
  });

  var BLOCKED_EXT = Object.freeze([
    'exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'dll', 'js', 'mjs', 'sh', 'ps1',
    'vbs', 'jar', 'apk', 'html', 'htm', 'svg', 'xml', 'zip', 'rar', '7z', 'gz',
  ]);

  function toBuffer(src) {
    if (Buffer.isBuffer(src)) return src;
    if (src instanceof Uint8Array) return Buffer.from(src);
    if (typeof src === 'string') {
      var s = src.replace(/^data:[^;]+;base64,/, '');
      return Buffer.from(s, 'base64');
    }
    return null;
  }

  function extOf(filename) {
    var name = String(filename || '').split(/[/\\]/).pop() || '';
    var i = name.lastIndexOf('.');
    if (i <= 0) return '';
    return name.slice(i + 1).toLowerCase();
  }

  function safeFilename(filename) {
    var name = String(filename || '').split(/[/\\]/).pop() || 'evidence';
    name = name.replace(/[^\w.\u3131-\u318E\uAC00-\uD7A3-]+/g, '_').slice(0, 120);
    return name || 'evidence';
  }

  function detectKind(bytes) {
    var buf = toBuffer(bytes);
    if (!buf || buf.length < 8) return null;
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'png';
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpeg';
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';
    if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
      return 'webp';
    }
    if (buf.slice(0, 5).toString('ascii') === '%PDF-') return 'pdf';
    if (buf[0] === 0x4D && buf[1] === 0x5A) return 'exe';
    return null;
  }

  function validateOne(input) {
    var src = input || {};
    var filename = safeFilename(src.filename || src.originalFilename);
    var ext = extOf(src.filename || src.originalFilename || filename);
    if (BLOCKED_EXT.indexOf(ext) !== -1) {
      return { ok: false, error: 'ATTACHMENT_TYPE_BLOCKED' };
    }
    var buf = toBuffer(src.bytes || src.contentBase64 || src.fileBytes);
    if (!buf || !buf.length) return { ok: false, error: 'ATTACHMENT_EMPTY' };
    if (buf.length > MAX_BYTES) return { ok: false, error: 'ATTACHMENT_TOO_LARGE' };
    var kind = detectKind(buf);
    if (!kind || kind === 'exe' || !ALLOWED[kind]) {
      return { ok: false, error: 'ATTACHMENT_TYPE_BLOCKED' };
    }
    if (ext && ALLOWED[kind].ext.indexOf(ext) === -1) {
      return { ok: false, error: 'ATTACHMENT_TYPE_MISMATCH' };
    }
    var crypto;
    try { crypto = require('crypto'); } catch (_) { crypto = null; }
    return {
      ok: true,
      filename: filename,
      kind: kind,
      contentType: ALLOWED[kind].mime,
      byteSize: buf.length,
      bytes: buf,
      sha256: crypto ? crypto.createHash('sha256').update(buf).digest('hex') : null,
    };
  }

  function validateList(list) {
    var rows = Array.isArray(list) ? list : [];
    if (rows.length < 1) return { ok: false, error: 'EVIDENCE_FILE_REQUIRED', items: [] };
    if (rows.length > MAX_FILES) return { ok: false, error: 'ATTACHMENT_TOO_MANY', items: [] };
    var items = [];
    for (var i = 0; i < rows.length; i++) {
      var one = validateOne(rows[i]);
      if (!one.ok) return { ok: false, error: one.error, items: [] };
      items.push(one);
    }
    return { ok: true, items: items };
  }

  function mapPublicMeta(row) {
    var src = row || {};
    return {
      id: src.id || null,
      filename: src.filename || src.originalFilename || null,
      contentType: src.contentType || null,
      byteSize: src.byteSize != null ? src.byteSize : src.byte_size,
      kind: src.kind || null,
      createdAt: src.createdAt || src.created_at || null,
    };
  }

  return {
    MAX_FILES: MAX_FILES,
    MAX_BYTES: MAX_BYTES,
    STAGING_TTL_MS: STAGING_TTL_MS,
    ALLOWED: ALLOWED,
    BLOCKED_EXT: BLOCKED_EXT,
    toBuffer: toBuffer,
    extOf: extOf,
    safeFilename: safeFilename,
    detectKind: detectKind,
    validateOne: validateOne,
    validateList: validateList,
    mapPublicMeta: mapPublicMeta,
  };
});
