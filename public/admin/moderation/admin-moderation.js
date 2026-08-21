(function () {
  'use strict';

  var listEl = document.getElementById('mod-report-list');
  var statusEl = document.getElementById('mod-status');
  var sanctionListEl = document.getElementById('mod-sanction-list');
  var appealListEl = document.getElementById('mod-appeal-list');

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

  function reasonSummary(counts) {
    var src = counts || {};
    return Object.keys(src).map(function (k) {
      return k + ' ' + src[k] + '건';
    }).join(', ') || '없음';
  }

  function renderBehaviors(behaviors, alienV1Enabled) {
    if (!listEl) return;
    listEl.textContent = '';
    (behaviors || []).forEach(function (row) {
      var card = document.createElement('article');
      card.className = 'sc-card mod-card';
      card.setAttribute('data-behavior-key', row.behaviorKey || '');
      var title = document.createElement('h2');
      title.className = 'sc-section-title';
      title.textContent = (row.targetType || '') + ' · 신고 ' + (row.reportCount || 0) + '건 · ' + (row.sanctionClass || '');
      var meta = document.createElement('p');
      meta.textContent = '상태 ' + (row.status || '') + ' · 주사유 ' + (row.primaryReasonCode || '') + ' · 사유분포 ' + reasonSummary(row.reasonCounts);
      var sanctionMeta = document.createElement('p');
      var cur = row.currentSanction || {};
      sanctionMeta.textContent = '현재 제재 ' + (cur.sanctionType || 'NONE')
        + ' · 사유 ' + (cur.reasonCode || '-')
        + ' · 행동 ' + (cur.behaviorKind || '-')
        + ' · 시작 ' + (cur.startsAt || '-')
        + ' · 종료 ' + (cur.endsAt || (cur.permanent ? '영구' : '-'))
        + ' · 상태 ' + (cur.status || '-')
        + ' · 이의신청 ' + (cur.appealAvailable ? '가능' : '없음');
      var details = document.createElement('ul');
      details.className = 'mod-details';
      (row.reports || []).forEach(function (rep) {
        var li = document.createElement('li');
        li.textContent = (rep.reasonCode || '') + ' · ' + (rep.status || '') + ' · ' + (rep.reasonDetail || '');
        details.appendChild(li);
      });
      var note = document.createElement('textarea');
      note.className = 'mod-note';
      note.setAttribute('placeholder', '운영 메모');
      var actions = document.createElement('div');
      actions.className = 'mod-actions';
      [
        { id: 'REVIEWING', label: '검토 중' },
        { id: 'ACCEPTED', label: '위반 인정' },
        { id: 'REJECTED', label: '위반 아님' },
        { id: 'RESOLVED', label: '처리 완료' },
      ].forEach(function (action) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sc-btn';
        btn.textContent = action.label;
        btn.addEventListener('click', function () {
          postReview(row.behaviorKey, action.id, note.value, 'AUTO');
        });
        actions.appendChild(btn);
      });
      var sanctionActions = [
        { id: 'NONE', label: '제재 없음' },
        { id: 'WARNING', label: '경고' },
        { id: 'FINAL_WARNING', label: '최종 경고' },
        { id: 'ALIEN_TRANSFER', label: '외계행성 이동' },
        { id: 'WRITE_RESTRICT_24H', label: '24시간 작성 제한' },
        { id: 'ACCOUNT_RESTRICT_7D', label: '7일 계정 제한' },
        { id: 'ACCOUNT_RESTRICT_30D', label: '30일 계정 제한' },
        { id: 'TEMP_SUSPEND', label: '임시 활동중지' },
        { id: 'PERMANENT_BAN', label: '영구정지' },
      ];
      var allowed = row.allowedSanctions || [];
      sanctionActions.forEach(function (action) {
        if (allowed.length && allowed.indexOf(action.id) === -1) return;
        if (action.id === 'ALIEN_TRANSFER' && row.sanctionClass === 'SERVICE_HARM') return;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sc-btn';
        btn.textContent = action.label;
        btn.addEventListener('click', function () {
          postReview(row.behaviorKey, 'ACCEPTED', note.value, action.id);
        });
        actions.appendChild(btn);
      });
      if (alienV1Enabled) {
        var alienBtn = document.createElement('button');
        alienBtn.type = 'button';
        alienBtn.className = 'sc-btn';
        alienBtn.textContent = '즉시 외계행';
        alienBtn.addEventListener('click', function () {
          var first = row.reports && row.reports[0];
          if (!first || !first.id) return;
          postAlien(first.id);
        });
        actions.appendChild(alienBtn);
      }
      if (row.targetAuthorUserId && cur.sanctionType === 'TEMP_SUSPEND') {
        [
          { id: 'RELEASE', label: '제한 해제' },
          { id: 'ACCOUNT_RESTRICT_7D', label: '7일 제한으로 전환' },
          { id: 'ACCOUNT_RESTRICT_30D', label: '30일 제한으로 전환' },
          { id: 'PERMANENT_BAN', label: '영구정지로 전환' },
        ].forEach(function (action) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'sc-btn';
          btn.textContent = action.label;
          btn.addEventListener('click', function () {
            postUserSanction(row.targetAuthorUserId, action.id);
          });
          actions.appendChild(btn);
        });
      }
      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(sanctionMeta);
      card.appendChild(details);
      card.appendChild(note);
      card.appendChild(actions);
      listEl.appendChild(card);
    });
  }

  function postReview(behaviorKey, status, resolutionNote, operatorSanction) {
    fetch('/api/admin/moderation/behaviors/review', {
      method: 'POST',
      headers: authHeaders(),
      credentials: 'same-origin',
      body: JSON.stringify({
        behaviorKey: behaviorKey,
        status: status,
        resolutionNote: resolutionNote || null,
        operatorSanction: operatorSanction || 'AUTO',
      }),
    })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (pack) {
        setStatus(pack.data && pack.data.ok ? '처리 완료: ' + status : '실패: ' + ((pack.data && pack.data.error) || pack.res.status));
        loadReports();
      })
      .catch(function () { setStatus('요청 실패'); });
  }

  function postAlien(id) {
    fetch('/api/admin/moderation/reports/' + encodeURIComponent(id) + '/action', {
      method: 'POST',
      headers: authHeaders(),
      credentials: 'same-origin',
      body: JSON.stringify({ action: 'IMMEDIATE_ALIEN' }),
    })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (pack) {
        setStatus(pack.data && pack.data.ok ? '즉시 외계행 처리' : '실패: ' + ((pack.data && pack.data.error) || pack.res.status));
        loadReports();
      })
      .catch(function () { setStatus('요청 실패'); });
  }

  function postUserSanction(userId, action) {
    fetch('/api/admin/moderation/users/' + encodeURIComponent(userId) + '/sanction', {
      method: 'POST',
      headers: authHeaders(),
      credentials: 'same-origin',
      body: JSON.stringify({ action: action }),
    })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (pack) {
        setStatus(pack.data && pack.data.ok ? '제재 처리: ' + action : '실패: ' + ((pack.data && pack.data.error) || pack.res.status));
        loadReports();
      })
      .catch(function () { setStatus('요청 실패'); });
  }

  function postAppealDecision(id, decision, operatorReply) {
    fetch('/api/admin/moderation/appeals/' + encodeURIComponent(id), {
      method: 'POST',
      headers: authHeaders(),
      credentials: 'same-origin',
      body: JSON.stringify({ decision: decision, operatorReply: operatorReply || null }),
    })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (pack) {
        setStatus(pack.data && pack.data.ok ? '이의신청 처리: ' + decision : '실패: ' + ((pack.data && pack.data.error) || pack.res.status));
        loadReports();
      })
      .catch(function () { setStatus('요청 실패'); });
  }

  function renderActiveSanctions(rows) {
    if (!sanctionListEl) return;
    sanctionListEl.textContent = '';
    (rows || []).forEach(function (row) {
      var card = document.createElement('article');
      card.className = 'sc-card mod-card';
      var title = document.createElement('h3');
      title.className = 'sc-section-title';
      title.textContent = (row.sanctionType || 'NONE') + ' · ' + (row.userId || '');
      var meta = document.createElement('p');
      meta.textContent = '사유 ' + (row.reasonCode || '-')
        + ' · 행동 ' + (row.behaviorKind || '-')
        + ' · 시작 ' + (row.startsAt || '-')
        + ' · 종료 ' + (row.endsAt || (row.permanent ? '영구' : '-'))
        + ' · 상태 ' + (row.status || '-')
        + ' · 이의신청 ' + (row.appealAvailable ? '가능' : '없음');
      card.appendChild(title);
      card.appendChild(meta);
      if (row.sanctionType === 'TEMP_SUSPEND' && row.userId) {
        var actions = document.createElement('div');
        actions.className = 'mod-actions';
        [
          { id: 'RELEASE', label: '제한 해제' },
          { id: 'ACCOUNT_RESTRICT_7D', label: '7일 제한으로 전환' },
          { id: 'ACCOUNT_RESTRICT_30D', label: '30일 제한으로 전환' },
          { id: 'PERMANENT_BAN', label: '영구정지로 전환' },
        ].forEach(function (action) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'sc-btn';
          btn.textContent = action.label;
          btn.addEventListener('click', function () {
            postUserSanction(row.userId, action.id);
          });
          actions.appendChild(btn);
        });
        card.appendChild(actions);
      }
      sanctionListEl.appendChild(card);
    });
    if (!rows || !rows.length) {
      sanctionListEl.textContent = '현재 적용 중인 제재가 없습니다.';
    }
  }

  function renderAppeals(rows) {
    if (!appealListEl) return;
    appealListEl.textContent = '';
    (rows || []).forEach(function (row) {
      var card = document.createElement('article');
      card.className = 'sc-card mod-card';
      var title = document.createElement('h3');
      title.className = 'sc-section-title';
      title.textContent = (row.sanctionType || '') + ' · ' + (row.status || '') + ' · ' + (row.userId || '');
      var body = document.createElement('p');
      body.textContent = '사용자 설명: ' + (row.body || '');
      var meta = document.createElement('p');
      meta.textContent = '제출 ' + (row.createdAt || '-') + ' · 답변 ' + (row.operatorReply || '없음');
      var reply = document.createElement('textarea');
      reply.className = 'mod-note';
      reply.setAttribute('placeholder', '관리자 답변');
      var actions = document.createElement('div');
      actions.className = 'mod-actions';
      [
        { id: 'UPHELD', label: '유지' },
        { id: 'SHORTENED', label: '기간 단축' },
        { id: 'RELEASED', label: '해제' },
      ].forEach(function (action) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sc-btn';
        btn.textContent = action.label;
        btn.addEventListener('click', function () {
          postAppealDecision(row.id, action.id, reply.value);
        });
        actions.appendChild(btn);
      });
      card.appendChild(title);
      card.appendChild(body);
      card.appendChild(meta);
      card.appendChild(reply);
      card.appendChild(actions);
      appealListEl.appendChild(card);
    });
    if (!rows || !rows.length) {
      appealListEl.textContent = '이의신청이 없습니다.';
    }
  }

  function loadReports() {
    fetch('/api/admin/moderation/reports', {
      headers: authHeaders(),
      credentials: 'same-origin',
    })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (pack) {
        if (!pack.res.ok || !pack.data || pack.data.ok === false) {
          setStatus((pack.data && pack.data.error) || '목록을 불러오지 못했습니다.');
          return;
        }
        var behaviors = pack.data.behaviors || [];
        setStatus('문제 행동 ' + behaviors.length + '건' + (pack.data.alienV1Enabled ? '' : ' · 외계행성 기능 OFF'));
        renderBehaviors(behaviors, !!pack.data.alienV1Enabled);
        renderActiveSanctions(pack.data.activeSanctions || []);
        renderAppeals(pack.data.appeals || []);
      })
      .catch(function () { setStatus('목록 요청 실패'); });
  }

  loadReports();
})();
