'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.RANK_PAGE_PORT || 3097);

const server = http.createServer(function (req, res) {
  const url = String(req.url || '/').split('?')[0];
  const rel = url === '/' ? '/public/rank-election-integration.html' : url;
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end('blocked');
    return;
  }
  fs.readFile(file, function (err, body) {
    if (err) {
      res.writeHead(404);
      res.end('missing');
      return;
    }
    res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' });
    res.end(body);
  });
});

server.listen(port, '127.0.0.1', function () {
  console.log('pid=' + process.pid + ' port=' + port);
});
