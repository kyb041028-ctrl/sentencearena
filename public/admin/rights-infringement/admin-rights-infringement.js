(function () {
  'use strict';

  var listEl = document.getElementById('ri-admin-list');
  var detailEl = document.getElementById('ri-admin-detail');
  var statusEl = document.getElementById('ri-admin-status');

  function authHeaders() {
    var headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
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
  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || '';
  }
  function postAction(id, action, extra) {
    return fetch('/api/admin/rights-infringement/requests/' + encodeURIComponent(id) + '/action', {
      method: 'POST',
      headers: authHeaders(),
      credentials: 'same-origin',
      body: JSON.stringify(Object.assign({ action: action }, extra || {})),
    }).then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); });
  }
  function renderList(rows) {
    if (!listEl) return;
    listEl.textContent = '';
    (rows || []).forEach(function (row) {
      var card = document.createElement('article');
      card.className = 'sc-card mod-card';
      var title = document.createElement('h2');
      title.className = 'sc-section-title';
      title.textContent = (row.caseNumber || '') + ' · ' + (row.claimTypeLabel || row.claimType || '');
      var meta = document.createElement('p');
      meta.textContent =
        '상태 ' + (row.statusLabel || row.status) +
        ' · 대상 ' + (row.targetKind || '') +
        ' · 신청자 ' + (row.claimantKind || '') +
        ' · 접수 ' + (row.createdAt || '') +
        ' · 보완 ' + (row.needsSupplement ? '예' : '아니오') +
        ' · 임시중단 ' + (row.tempTakedown ? '예' : '아니오') +
        ' · 이의제기 ' + (row.authorObjected ? '예' : '아니오');
      if (row.highRiskPrivacy) {
        var risk = document.createElement('p');
        risk.className = 'hi-risk';
        risk.textContent = '고위험 개인정보 표시 — 신속 확인';
        card.appendChild(title);
        card.appendChild(risk);
      } else {
        card.appendChild(title);
      }
      card.appendChild(meta);
      var open = document.createElement('button');
      open.type = 'button';
      open.className = 'sc-btn';
      open.textContent = '상세';
      open.addEventListener('click', function () { loadDetail(row.id); });
      card.appendChild(open);
      listEl.appendChild(card);
    });
  }
  function addBtn(parent, id, action, label, extraFn) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sc-btn';
    btn.textContent = label;
    btn.addEventListener('click', function () {
      var note = document.getElementById('ri-admin-note');
      var extra = { note: note ? note.value : '' };
      if (typeof extraFn === 'function') Object.assign(extra, extraFn());
      postAction(id, action, extra).then(function (pack) {
        setStatus(pack.data && pack.data.ok ? '처리: ' + action : '실패: ' + ((pack.data && pack.data.error) || pack.res.status));
        loadList();
        loadDetail(id);
      }).catch(function () { setStatus('요청 실패'); });
    });
    parent.appendChild(btn);
  }
  function renderDetail(detail) {
    if (!detailEl) return;
    detailEl.textContent = '';
    var src = detail || {};
    var list = src.list || {};
    var card = document.createElement('article');
    card.className = 'sc-card';
    var h = document.createElement('h2');
    h.className = 'sc-section-title';
    h.textContent = '상세 · ' + (list.caseNumber || '');
    var pre = document.createElement('pre');
    pre.textContent = JSON.stringify({
      정치적비판보호: src.politicalProtection,
      신청내용: {
        자격: src.claimantKind,
        이름: src.claimantName,
        이메일: src.claimantEmail,
        문제부분: src.problemExcerpt,
        권리주장: src.claimedRight,
        침해이유: src.infringementReason,
        사건설명: src.caseNarrative,
        증빙설명: src.evidenceDescription,
        증빙주소: src.evidenceUrl,
        종류별: src.extra,
      },
      대상스냅샷: src.targetSnapshot,
      삭제증거연결: src.deletedEvidenceId,
      연결된증거: src.linkedEvidence,
      운영메모: src.operatorNotes,
      이의제기: src.objections,
      기록: src.events,
    }, null, 2);
    var note = document.createElement('textarea');
    note.id = 'ri-admin-note';
    note.className = 'mod-note';
    note.placeholder = '운영 메모 / 보완 요청 / 반려 사유';
    var actions = document.createElement('div');
    actions.className = 'mod-actions';
    addBtn(actions, list.id, 'REQUEST_SUPPLEMENT', '보완 요청');
    addBtn(actions, list.id, 'REJECT_INTAKE', '접수 반려');
    addBtn(actions, list.id, 'CONVERT_FORMAL', '정식 사건 전환');
    addBtn(actions, list.id, 'TEMP_TAKEDOWN', '임시 게시중단');
    addBtn(actions, list.id, 'LIFT_TAKEDOWN', '게시중단 해제');
    addBtn(actions, list.id, 'COMPLETE', '처리 완료');
    addBtn(actions, list.id, 'ABUSE_WARNING', '악용 경고');
    addBtn(actions, list.id, 'RESTRICT_30D', '권리침해 요청 30일 제한');
    addBtn(actions, list.id, 'RESTRICT_6M', '권리침해 요청 6개월 제한');
    addBtn(actions, list.id, 'SANCTION_REVIEW', '기존 제재 검토', function () {
      return { sanctionAction: 'TEMP_SUSPEND' };
    });
    var evId = document.createElement('input');
    evId.id = 'ri-evidence-id';
    evId.placeholder = 'deleted_content_evidence id';
    addBtn(actions, list.id, 'LINK_EVIDENCE', '삭제 콘텐츠 증거 연결', function () {
      var inp = document.getElementById('ri-evidence-id');
      return { evidenceId: inp ? inp.value : '' };
    });
    card.appendChild(h);
    card.appendChild(pre);
    card.appendChild(evId);
    card.appendChild(note);
    card.appendChild(actions);
    detailEl.appendChild(card);
  }
  function loadDetail(id) {
    fetch('/api/admin/rights-infringement/requests/' + encodeURIComponent(id), {
      headers: authHeaders(),
      credentials: 'same-origin',
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data || !data.ok) {
          setStatus('상세 실패: ' + ((data && data.error) || ''));
          return;
        }
        renderDetail(data.request);
      })
      .catch(function () { setStatus('상세 요청 실패'); });
  }
  function loadList() {
    fetch('/api/admin/rights-infringement/requests', {
      headers: authHeaders(),
      credentials: 'same-origin',
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data || !data.ok) {
          setStatus('목록 실패: ' + ((data && data.error) || '관리자 로그인 필요'));
          return;
        }
        renderList(data.requests);
      })
      .catch(function () { setStatus('목록 요청 실패'); });
  }
  loadList();
})();
