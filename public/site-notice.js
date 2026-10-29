(function () {
  'use strict';

  var TYPE = { GENERAL: '공지', MAINTENANCE: '점검', INCIDENT: '장애', UPDATE: '업데이트' };

  function render(items) {
    if (!items || !items.length || document.getElementById('sc-site-notice')) return;
    var style = document.createElement('style');
    style.textContent =
      '#sc-site-notice{font:14px/1.5 system-ui,"Malgun Gothic",sans-serif;background:var(--sc-surface,#1b2030);color:var(--sc-text,#e8eaf0);border-bottom:1px solid var(--sc-border,#343a48);padding:8px 12px}' +
      '#sc-site-notice details{margin:2px 0}' +
      '#sc-site-notice summary{cursor:pointer;min-height:24px}' +
      '#sc-site-notice .sc-site-notice__type{display:inline-block;margin-right:8px;padding:0 8px;border-radius:10px;background:#3d6bff;color:#fff;font-size:12px}' +
      '#sc-site-notice .sc-site-notice__type--INCIDENT{background:#c0392b}' +
      '#sc-site-notice .sc-site-notice__type--MAINTENANCE{background:#b9770e}' +
      '#sc-site-notice p{margin:6px 0 4px;white-space:pre-wrap}';
    document.head.appendChild(style);
    var box = document.createElement('section');
    box.id = 'sc-site-notice';
    box.setAttribute('aria-label', '운영 공지');
    items.forEach(function (n) {
      var d = document.createElement('details');
      var s = document.createElement('summary');
      var badge = document.createElement('span');
      badge.className = 'sc-site-notice__type sc-site-notice__type--' + String(n.type || 'GENERAL');
      badge.textContent = TYPE[n.type] || TYPE.GENERAL;
      s.appendChild(badge);
      s.appendChild(document.createTextNode(String(n.title || '')));
      d.appendChild(s);
      if (n.body) {
        var p = document.createElement('p');
        p.textContent = String(n.body);
        d.appendChild(p);
      }
      box.appendChild(d);
    });
    document.body.insertBefore(box, document.body.firstChild);
  }

  function load() {
    fetch('/api/notices/current', { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || data.ok !== true || data.enabled !== true || data.available === false) return;
        render(data.items);
      })
      .catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
