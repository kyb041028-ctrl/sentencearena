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
        var mis = rep.misinfo || {};
        var extra = '';
        if (rep.reasonCode === 'misinfo' && mis && mis.excerpt) {
          extra = ' · 표현: ' + mis.excerpt +
            ' · 이유: ' + (mis.falsehoodReason || '') +
            ' · 근거: ' + (mis.evidenceUrl || mis.evidenceNote || '') +
            ' · 기관확인: ' + (mis.externalCheck || '');
        }
        li.textContent = (rep.reasonCode || '') + ' · ' + (rep.status || '') + ' · ' + (rep.reasonDetail && String(rep.reasonDetail).indexOf('SC_MISINFO_V1:') === 0 ? '' : (rep.reasonDetail || '')) + extra;
        details.appendChild(li);
      });
      if (row.primaryReasonCode === 'misinfo') {
        var guide = document.createElement('div');
        guide.className = 'mod-misinfo-guide';
        var g1 = document.createElement('p');
        g1.textContent = '허위정보 판단은 자동 점수가 아니라 운영자 확인이다. 의견·가치판단·예측·풍자·사소한 오류·논쟁 중인 사실은 자동 확정하지 않는다.';
        var g2 = document.createElement('p');
        g2.textContent = '근거 우선순위: ' + ((row.misinfoGuide && row.misinfoGuide.evidencePriority) || []).join(' → ');
        var g3 = document.createElement('p');
        g3.textContent = (row.misinfoGuide && row.misinfoGuide.evidenceCaution) || '';
        var ctx = document.createElement('p');
        ctx.textContent = '대상 문맥: ' + (row.targetContent && (row.targetContent.title || '') + ' ' + (row.targetContent.body || '') || '없음');
        guide.appendChild(g1);
        guide.appendChild(g2);
        guide.appendChild(g3);
        guide.appendChild(ctx);
        card.appendChild(guide);
      }
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
      if (row.primaryReasonCode === 'misinfo') {
        var election = document.createElement('label');
        var electionBox = document.createElement('input');
        electionBox.type = 'checkbox';
        electionBox.id = 'mod-election-' + (row.behaviorKey || '');
        election.appendChild(electionBox);
        election.appendChild(document.createTextNode(' 선거와 직접 관련된 사안'));
        var agency = document.createElement('input');
        agency.type = 'text';
        agency.placeholder = '관계기관 확인 여부 기록(자동 신고 없음)';
        agency.className = 'mod-note';
        card.appendChild(election);
        card.appendChild(agency);
        [
          { id: 'INSUFFICIENT_EVIDENCE', label: '근거 부족' },
          { id: 'NOT_APPLICABLE', label: '허위정보 해당 없음' },
          { id: 'NEEDS_MORE_INFO', label: '추가 확인 필요' },
          { id: 'CONFIRMED', label: '허위조작정보 확인' },
        ].forEach(function (action) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'sc-btn';
          btn.textContent = action.label;
          btn.addEventListener('click', function () {
            postMisinfoDecision(row.behaviorKey, action.id, note.value, electionBox.checked, agency.value);
          });
          actions.appendChild(btn);
        });
        var reporters = {};
        (row.reports || []).forEach(function (rep) {
          if (rep.reporterUserId) reporters[rep.reporterUserId] = true;
        });
        Object.keys(reporters).forEach(function (rid) {
          [
            { id: 'WARNING', label: '신고 악용 경고' },
            { id: 'RESTRICT_30D', label: '허위정보 신고 30일 제한' },
            { id: 'RESTRICT_6M', label: '허위정보 신고 6개월 제한' },
            { id: 'SANCTION_REVIEW', label: '중대 악용 제재 검토' },
          ].forEach(function (action) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'sc-btn';
            btn.textContent = action.label;
            btn.addEventListener('click', function () {
              postMisinfoAbuse(rid, action.id, note.value);
            });
            actions.appendChild(btn);
          });
        });
      }
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
      if (row.targetAuthorUserId) {
        var histBtn = document.createElement('button');
        histBtn.type = 'button';
        histBtn.className = 'sc-btn';
        histBtn.textContent = '외계 이력';
        histBtn.addEventListener('click', function () {
          loadAlienDetail(row.targetAuthorUserId);
        });
        actions.appendChild(histBtn);
        if (cur.sanctionType === 'ALIEN_TRANSFER' || row.citizenshipStatus === 'KANTAPBIYA_RESIDENT') {
          var retBtn = document.createElement('button');
          retBtn.type = 'button';
          retBtn.className = 'sc-btn';
          retBtn.textContent = 'Earth 강제 복귀';
          retBtn.addEventListener('click', function () {
            forceAlienReturn(row.targetAuthorUserId);
          });
          actions.appendChild(retBtn);
        }
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

  function postMisinfoDecision(behaviorKey, decision, resolutionNote, electionRelated, agencyNote) {
    fetch('/api/admin/moderation/behaviors/review', {
      method: 'POST',
      headers: authHeaders(),
      credentials: 'same-origin',
      body: JSON.stringify({
        behaviorKey: behaviorKey,
        misinfoDecision: decision,
        resolutionNote: resolutionNote || null,
        electionRelated: !!electionRelated,
        agencyNote: agencyNote || null,
        operatorSanction: 'AUTO',
      }),
    })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (pack) {
        setStatus(pack.data && pack.data.ok ? '허위정보 판단: ' + decision : '실패: ' + ((pack.data && pack.data.error) || pack.res.status));
        loadReports();
      })
      .catch(function () { setStatus('요청 실패'); });
  }

  function postMisinfoAbuse(reporterUserId, action, note) {
    fetch('/api/admin/moderation/misinfo-abuse', {
      method: 'POST',
      headers: authHeaders(),
      credentials: 'same-origin',
      body: JSON.stringify({
        reporterUserId: reporterUserId,
        action: action,
        note: note || null,
      }),
    })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (pack) {
        setStatus(pack.data && pack.data.ok ? '신고 악용 처리: ' + action : '실패: ' + ((pack.data && pack.data.error) || pack.res.status));
        loadReports();
      })
      .catch(function () { setStatus('요청 실패'); });
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
      if (row.userId && (row.sanctionType === 'ALIEN_TRANSFER' || row.citizenshipStatus === 'KANTAPBIYA_RESIDENT')) {
        var alienActions = document.createElement('div');
        alienActions.className = 'mod-actions';
        var detailBtn = document.createElement('button');
        detailBtn.type = 'button';
        detailBtn.className = 'sc-btn';
        detailBtn.textContent = '외계 이력 보기';
        detailBtn.addEventListener('click', function () {
          loadAlienDetail(row.userId);
        });
        var returnBtn = document.createElement('button');
        returnBtn.type = 'button';
        returnBtn.className = 'sc-btn';
        returnBtn.textContent = 'Earth 강제 복귀';
        returnBtn.addEventListener('click', function () {
          forceAlienReturn(row.userId);
        });
        alienActions.appendChild(detailBtn);
        alienActions.appendChild(returnBtn);
        card.appendChild(alienActions);
      }
      sanctionListEl.appendChild(card);
    });
    if (!rows || !rows.length) {
      sanctionListEl.textContent = '현재 적용 중인 제재가 없습니다.';
    }
  }

  function forceAlienReturn(userId) {
    var reason = window.prompt('강제 복귀 사유 (이력에 남음)', 'OPERATOR_FORCE_RETURN');
    if (reason === null) return;
    fetch('/api/admin/moderation/users/' + encodeURIComponent(userId) + '/return', {
      method: 'POST',
      headers: authHeaders(),
      credentials: 'same-origin',
      body: JSON.stringify({ reason: reason || 'OPERATOR_FORCE_RETURN' }),
    })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (pack) {
        setStatus(pack.res.ok ? '강제 복귀 완료' : ('복귀 실패: ' + ((pack.data && pack.data.error) || pack.res.status)));
        loadReports();
      })
      .catch(function () { setStatus('강제 복귀 요청 실패'); });
  }

  function loadAlienDetail(userId) {
    fetch('/api/admin/moderation/users/' + encodeURIComponent(userId) + '/alien', {
      headers: authHeaders(),
      credentials: 'same-origin',
    })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (pack) {
        if (!pack.res.ok || !pack.data || !pack.data.ok) {
          setStatus('외계 이력 조회 실패');
          return;
        }
        var st = pack.data.state || {};
        var lines = [
          '시민권 ' + (st.citizenshipStatus || '-'),
          '상태 ' + (st.status || '-'),
          '외계행 횟수 ' + (st.strikeCount != null ? st.strikeCount : '-'),
          '진입 ' + (st.enteredAt || '-'),
          '복귀가능 ' + (st.releaseEligibleAt || '-'),
          '복귀정책 ' + (st.returnPolicy || '-'),
          '이전영토 ' + (st.alienOriginTerritory || st.earthTerritory || '-'),
        ];
        window.alert(lines.join('\n'));
      })
      .catch(function () { setStatus('외계 이력 요청 실패'); });
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
