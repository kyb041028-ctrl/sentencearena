(function () {
  'use strict';

  var H = window.ScAdminHub;

  function set(id, text) { document.getElementById(id).textContent = text; }

  H.api('GET', '/api/admin/system/status').then(function (res) {
    var msg = H.authMessage(res.status);
    if (msg) { set('sc-t-status', msg); return; }
    var s = res.body;
    if (!s || !s.ok) { set('sc-t-status', '설정 상태를 불러오지 못했습니다.'); return; }
    set('sc-t-role', s.viewer.role || '미확인');
    set('sc-t-visit', s.visitCollection.enabled ? '켜짐' : '꺼짐 (켜는 기능 없음)');
    set('sc-t-align', s.schedulers.alignment.policyEnabled ? '켜짐' : '꺼짐');
    set('sc-t-daily', s.schedulers.dailyIssueMorning.policyEnabled ? '켜짐' : '꺼짐');
  }).catch(function () { set('sc-t-status', '설정 상태를 불러오지 못했습니다.'); });
})();
