'use strict';

/**
 * Express app HTTP helper — ephemeral listen, no npm start
 */

const http = require('http');

function requestApp(app, method, urlPath, options) {
  const opt = options || {};
  return new Promise(function (resolve, reject) {
    const server = app.listen(0, '127.0.0.1', function () {
      const addr = server.address();
      const headers = Object.assign({}, opt.headers || {});
      let bodyBuf = null;
      if (opt.body !== undefined && opt.body !== null) {
        if (typeof opt.body === 'string' || Buffer.isBuffer(opt.body)) {
          bodyBuf = Buffer.from(opt.body);
        } else {
          bodyBuf = Buffer.from(JSON.stringify(opt.body));
          if (!headers['Content-Type'] && !headers['content-type']) {
            headers['Content-Type'] = 'application/json';
          }
        }
        headers['Content-Length'] = String(bodyBuf.length);
      }
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: addr.port,
          path: urlPath,
          method: method,
          headers: headers,
        },
        function (res) {
          const chunks = [];
          res.on('data', function (c) {
            chunks.push(c);
          });
          res.on('end', function () {
            const raw = Buffer.concat(chunks).toString('utf8');
            let body = null;
            try {
              body = raw ? JSON.parse(raw) : null;
            } catch (_) {
              body = null;
            }
            server.close(function () {
              resolve({
                status: res.statusCode,
                headers: res.headers,
                body: body,
                raw: raw,
              });
            });
          });
        },
      );
      req.on('error', function (err) {
        server.close(function () {
          reject(err);
        });
      });
      if (bodyBuf) req.write(bodyBuf);
      req.end();
    });
  });
}

module.exports = { requestApp: requestApp };
