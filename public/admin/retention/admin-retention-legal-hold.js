(function () {
  'use strict';

  function authHeaders(json) {
    var headers = { Accept: 'application/json' };
    if (json) headers['Content-Type'] = 'application/json';
    try {
      var raw = sessionStorage.getItem('sc_sb_auth_session');
      if (raw) {
        var auth = JSON.parse(raw);
        var token = auth && auth.session && auth.session.access_token;
        if (token) headers.Authorization = 'Bearer ' + token;
      }
    } catch (_) {}
    return headers;
  }

  function readRole() {
    try {
      var raw = sessionStorage.getItem('sc_sb_auth_session');
      if (!raw) return '';
      var auth = JSON.parse(raw);
      return String((auth && auth.user && auth.user.role) || '').trim().toUpperCase();
    } catch (_) {
      return '';
    }
  }

  function setMsg(text) {
    var el = document.getElementById('lh-msg');
    if (el) el.textContent = text || '';
  }

  function setStatus(text) {
    var el = document.getElementById('lh-status');
    if (el) el.textContent = text || '';
  }

  function val(id) {
    var el = document.getElementById(id);
    return el && el.value ? String(el.value).trim() : '';
  }

  function applyOwnerUi() {
    var role = readRole();
    var roleEl = document.getElementById('lh-role');
    var isOwner = role === 'OWNER';
    if (roleEl) {
      roleEl.textContent = isOwner
        ? '역할: OWNER — 설정/해제 가능'
        : (role === 'ADMIN'
          ? '역할: ADMIN — 상태 확인만 가능. 설정/해제는 OWNER 전용입니다.'
          : '역할 확인 필요. 관리자 로그인 후 이용하세요.');
    }
    var setBtn = document.getElementById('lh-set');
    var relBtn = document.getElementById('lh-release');
    if (setBtn) {
      setBtn.disabled = !isOwner;
      setBtn.style.display = isOwner ? '' : 'none';
    }
    if (relBtn) {
      relBtn.disabled = !isOwner;
      relBtn.style.display = isOwner ? '' : 'none';
    }
  }

  function checkStatus() {
    var type = val('lh-type');
    var id = val('lh-id');
    if (!id) {
      setMsg('대상 ID가 필요합니다.');
      return;
    }
    setMsg('조회 중…');
    fetch(
      '/api/admin/retention/legal-hold?targetType=' + encodeURIComponent(type) +
        '&targetId=' + encodeURIComponent(id),
      { headers: authHeaders(false), credentials: 'same-origin' },
    )
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (pack) {
        if (!pack.body || !pack.body.ok) {
          setMsg('조회 실패: ' + ((pack.body && pack.body.error) || pack.status));
          setStatus('');
          return;
        }
        setMsg('조회 완료');
        setStatus(
          '대상: ' + pack.body.targetType + ' / ' + pack.body.targetId + '\n' +
          'Hold: ' + (pack.body.legalHold ? 'ON' : 'OFF') + '\n' +
          '사유: ' + (pack.body.legalHoldReason || '(없음)') + '\n' +
          'retentionUntil: ' + (pack.body.retentionUntil || '(없음)') +
          (pack.body.releasedAt ? '\nreleasedAt: ' + pack.body.releasedAt : ''),
        );
      })
      .catch(function () {
        setMsg('조회 요청 실패');
      });
  }

  function postHold(hold) {
    var type = val('lh-type');
    var id = val('lh-id');
    var reason = val('lh-reason');
    if (!id) {
      setMsg('대상 ID가 필요합니다.');
      return;
    }
    if (!reason) {
      setMsg('사유가 필요합니다.');
      return;
    }
    setMsg(hold ? '설정 중…' : '해제 중…');
    fetch('/api/admin/retention/legal-hold', {
      method: 'POST',
      headers: authHeaders(true),
      credentials: 'same-origin',
      body: JSON.stringify({
        targetType: type,
        targetId: id,
        hold: !!hold,
        reason: reason,
      }),
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (pack) {
        if (!pack.body || !pack.body.ok) {
          setMsg('실패: ' + ((pack.body && pack.body.error) || pack.status));
          return;
        }
        setMsg((hold ? '설정' : '해제') + ' 완료' + (pack.body.idempotent ? ' (이미 동일 상태)' : ''));
        checkStatus();
      })
      .catch(function () {
        setMsg('요청 실패');
      });
  }

  applyOwnerUi();
  var checkBtn = document.getElementById('lh-check');
  var setBtn = document.getElementById('lh-set');
  var relBtn = document.getElementById('lh-release');
  if (checkBtn) checkBtn.addEventListener('click', checkStatus);
  if (setBtn) setBtn.addEventListener('click', function () { postHold(true); });
  if (relBtn) relBtn.addEventListener('click', function () { postHold(false); });
})();
