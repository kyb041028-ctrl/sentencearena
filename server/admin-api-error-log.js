'use strict';

/**
 * 서버가 켜진 뒤 /api 5xx 응답만 메모리에 최근 N건 남긴다.
 * 요청 본문, 쿼리 문자열, 토큰, 사용자 식별자는 저장하지 않는다. 재시작하면 사라진다.
 */
function createApiErrorLog(options) {
  const max = Math.max(1, Number((options && options.max) || 50));
  const store = options && options.store ? options.store : null;
  const startedAt = new Date().toISOString();
  const items = [];

  function middleware(req, res, next) {
    res.on('finish', function () {
      if (res.statusCode < 500) return;
      const url = String(req.originalUrl || req.url || '');
      if (url.indexOf('/api/') !== 0) return;
      const path = url.split('?')[0]
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
        .replace(/\/\d{3,}(?=\/|$)/g, '/:n')
        .replace(/\/[A-Za-z0-9_-]{24,}(?=\/|$)/g, '/:t')
        .slice(0, 160);
      items.unshift({ at: new Date().toISOString(), method: String(req.method || ''), path: path, status: res.statusCode });
      if (items.length > max) items.length = max;
      if (store) {
        try {
          store.record({ method: String(req.method || ''), path: path, status: res.statusCode });
        } catch (_) {}
      }
    });
    next();
  }

  function snapshot(limit) {
    return { since: startedAt, scope: 'MEMORY_SINCE_RESTART', items: items.slice(0, limit || 20) };
  }

  return { middleware: middleware, snapshot: snapshot };
}

module.exports = { createApiErrorLog: createApiErrorLog };
