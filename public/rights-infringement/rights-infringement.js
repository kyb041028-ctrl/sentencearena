(function () {
  'use strict';

  function val(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }
  function checked(id) {
    var el = document.getElementById(id);
    return !!(el && el.checked);
  }
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
    var el = document.getElementById('ri-status');
    if (el) el.textContent = text || '';
  }
  function extraFields() {
    var type = val('claimType');
    var box = document.getElementById('type-extra');
    if (!box) return;
    var html = '';
    if (type === 'DEFAMATION') {
      html =
        '<div class="ri-field"><label>문제가 되는 정확한 문장 또는 표현</label><textarea id="defamationStatement" rows="3"></textarea></div>' +
        '<div class="ri-field"><label>그 표현이 누구를 지칭하는지</label><input id="defamationRefersTo"></div>' +
        '<div class="ri-field"><label>사실 주장인지 의견/평가인지</label><select id="defamationNature"><option value="">선택</option><option value="FACT">사실 주장</option><option value="OPINION">의견/평가</option></select></div>' +
        '<div class="ri-field"><label>무엇이 사실과 다르다고 주장하는지 (구체적으로)</label><textarea id="defamationFalsehood" rows="4"></textarea></div>' +
        '<div class="ri-field"><label>왜 자신의 명예가 침해됐다고 보는지</label><textarea id="defamationHonorHarm" rows="4"></textarea></div>';
    } else if (type === 'PRIVACY') {
      html =
        '<div class="ri-field"><label>어떤 개인정보가 공개됐는지</label><input id="privacyInfoType"></div>' +
        '<div class="ri-field"><label>누구의 정보인지</label><input id="privacyWhose"></div>' +
        '<div class="ri-field"><label>게시물의 정확한 위치</label><input id="privacyLocation"></div>' +
        '<div class="ri-field"><label>본인의 정보라는 근거 또는 관계</label><textarea id="privacyBasis" rows="3"></textarea></div>' +
        '<div class="ri-field"><label>공개에 동의한 사실이 있는지</label><select id="privacyConsent"><option value="">선택</option><option value="NO">없음</option><option value="YES">있음</option><option value="UNKNOWN">모름</option></select></div>' +
        '<div class="ri-field"><label>현재 어떤 피해가 발생하거나 우려되는지</label><textarea id="privacyHarm" rows="3"></textarea></div>';
    } else if (type === 'LIKENESS') {
      html =
        '<div class="ri-field"><label>사진/영상 속 사람이 누구인지</label><input id="likenessWho"></div>' +
        '<div class="ri-field"><label>신청자와 해당 인물의 관계</label><input id="likenessRelation"></div>' +
        '<div class="ri-field"><label>본인 또는 정당한 대리인인지</label><select id="likenessSelfOrAgent"><option value="">선택</option><option value="SELF">본인</option><option value="AGENT">정당한 대리인</option></select></div>' +
        '<div class="ri-field"><label>게시를 허락한 적이 있는지</label><select id="likenessPermitted"><option value="">선택</option><option value="NO">없음</option><option value="YES">있음</option><option value="UNKNOWN">모름</option></select></div>' +
        '<div class="ri-field"><label>어떤 부분이 권리를 침해한다고 보는지</label><textarea id="likenessInfringement" rows="3"></textarea></div>';
    } else if (type === 'COPYRIGHT') {
      html =
        '<div class="ri-field"><label>원저작물 설명</label><textarea id="copyrightWork" rows="3"></textarea></div>' +
        '<div class="ri-field"><label>본인이 저작권자 또는 정당한 대리인인 근거</label><textarea id="copyrightBasis" rows="3"></textarea></div>' +
        '<div class="ri-field"><label>원본을 확인할 수 있는 자료 또는 출처</label><input id="copyrightSource"></div>' +
        '<div class="ri-field"><label>SentenceArena에서 침해됐다고 주장하는 부분</label><textarea id="copyrightPortion" rows="3"></textarea></div>' +
        '<div class="ri-field"><label>사용을 허락한 사실이 있는지</label><select id="copyrightLicensed"><option value="">선택</option><option value="NO">없음</option><option value="YES">있음</option><option value="UNKNOWN">모름</option></select></div>';
    }
    box.innerHTML = html;
  }
  function syncKind() {
    var kind = val('claimantKind');
    var box = document.getElementById('rep-box');
    if (box) box.classList.toggle('ri-hidden', kind !== 'ORGANIZATION' && kind !== 'AGENT');
  }
  function syncTarget() {
    var kind = val('targetKind');
    var live = document.getElementById('live-target');
    var del = document.getElementById('deleted-box');
    if (live) live.classList.toggle('ri-hidden', kind === 'DELETED_UNKNOWN');
    if (del) del.classList.toggle('ri-hidden', kind !== 'DELETED_UNKNOWN');
  }
  function syncSubmit() {
    var btn = document.getElementById('ri-submit');
    if (btn) btn.disabled = !checked('abuseNoticeConfirmed');
  }
  function uuidFrom(text) {
    var m = String(text || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    return m ? m[0] : '';
  }
  function readQuery() {
    var q = new URLSearchParams(location.search);
    var type = String(q.get('targetType') || '').toUpperCase();
    var id = String(q.get('targetId') || q.get('postId') || q.get('commentId') || '');
    if (type === 'COMMENT') {
      var tk = document.getElementById('targetKind');
      if (tk) tk.value = 'COMMENT';
      var cid = document.getElementById('commentId');
      if (cid) cid.value = id;
    } else if (id) {
      var url = document.getElementById('targetUrl');
      if (url) url.value = id;
    }
    syncTarget();
  }
  function payload() {
    var targetKind = val('targetKind');
    var urlOrId = val('targetUrl');
    var postId = targetKind === 'POST' ? uuidFrom(urlOrId) : '';
    var body = {
      claimType: val('claimType'),
      claimantKind: val('claimantKind'),
      claimantName: val('claimantName'),
      claimantEmail: val('claimantEmail'),
      representativeOf: val('representativeOf'),
      representativeRelation: val('representativeRelation'),
      representativeAuthority: val('representativeAuthority'),
      targetKind: targetKind,
      postId: postId || null,
      commentId: uuidFrom(val('commentId')) || null,
      targetUrl: urlOrId,
      problemExcerpt: val('problemExcerpt'),
      claimedRight: val('claimedRight'),
      infringementReason: val('infringementReason'),
      caseNarrative: val('caseNarrative'),
      requestedAction: val('requestedAction'),
      requestedActionDetail: val('requestedActionDetail'),
      evidenceDescription: val('evidenceDescription'),
      evidenceUrl: val('evidenceUrl'),
      truthConfirmed: true,
      truthDeclaration: true,
      abuseNoticeConfirmed: checked('abuseNoticeConfirmed'),
      deletedPeriodApprox: val('deletedPeriodApprox'),
      rememberedTitle: val('rememberedTitle'),
      rememberedAuthor: val('rememberedAuthor'),
      rememberedBody: val('rememberedBody'),
      rememberedPhrase: val('rememberedPhrase'),
      discoveredAt: val('discoveredAt'),
      defamationStatement: val('defamationStatement'),
      defamationRefersTo: val('defamationRefersTo'),
      defamationNature: val('defamationNature'),
      defamationFalsehood: val('defamationFalsehood'),
      defamationHonorHarm: val('defamationHonorHarm'),
      privacyInfoType: val('privacyInfoType'),
      privacyWhose: val('privacyWhose'),
      privacyLocation: val('privacyLocation'),
      privacyBasis: val('privacyBasis'),
      privacyConsent: val('privacyConsent'),
      privacyHarm: val('privacyHarm'),
      likenessWho: val('likenessWho'),
      likenessRelation: val('likenessRelation'),
      likenessSelfOrAgent: val('likenessSelfOrAgent'),
      likenessPermitted: val('likenessPermitted'),
      likenessInfringement: val('likenessInfringement'),
      copyrightWork: val('copyrightWork'),
      copyrightBasis: val('copyrightBasis'),
      copyrightSource: val('copyrightSource'),
      copyrightPortion: val('copyrightPortion'),
      copyrightLicensed: val('copyrightLicensed'),
    };
    return body;
  }
  document.getElementById('claimType').addEventListener('change', extraFields);
  document.getElementById('claimantKind').addEventListener('change', syncKind);
  document.getElementById('targetKind').addEventListener('change', syncTarget);
  document.getElementById('abuseNoticeConfirmed').addEventListener('change', syncSubmit);
  document.getElementById('ri-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!checked('abuseNoticeConfirmed')) return;
    setStatus('제출 중...');
    fetch('/api/rights-infringement/requests', {
      method: 'POST',
      headers: authHeaders(),
      credentials: 'same-origin',
      body: JSON.stringify(payload()),
    })
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (pack) {
        if (pack.data && pack.data.ok) {
          setStatus('접수되었습니다. 사건번호 ' + pack.data.request.caseNumber + ' · 상태 ' + (pack.data.request.statusLabel || pack.data.request.status) + '. 접수만으로 게시물이 삭제되거나 계정이 제재되지 않습니다.');
          return;
        }
        setStatus('제출 불가: ' + ((pack.data && pack.data.error) || pack.res.status));
      })
      .catch(function () { setStatus('요청 실패'); });
  });

  extraFields();
  syncKind();
  syncTarget();
  syncSubmit();
  readQuery();
  fetch('/api/rights-infringement/me/notices', { headers: authHeaders(), credentials: 'same-origin' })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (!data || !data.ok) return;
      window.__riNoticeIds = {};
      (data.notices || []).forEach(function (n) {
        window.__riNoticeIds[n.caseNumber] = n.caseNumber;
      });
      var box = document.getElementById('ri-author-box');
      if (!box) return;
      box.textContent = '';
      (data.notices || []).forEach(function (n) {
        var card = document.createElement('article');
        card.className = 'sc-card';
        var title = document.createElement('h2');
        title.className = 'sc-section-title';
        title.textContent = '임시 게시중단 안내';
        var p1 = document.createElement('p');
        p1.textContent = n.notice || '';
        var p2 = document.createElement('p');
        p2.textContent = '종류: ' + (n.claimTypeLabel || '') + ' · 대상: ' + (n.targetLabel || '');
        var p3 = document.createElement('p');
        p3.textContent = '임시 게시중단 시각: ' + (n.tempTakedownAt || '') + ' · 이의제기 기한: ' + (n.objectionDeadline || '');
        var p4 = document.createElement('p');
        p4.textContent = n.objectionMethod || '';
        var sel = document.createElement('select');
        [
          ['FACT_BASED', '사실에 근거한 내용'],
          ['PUBLIC_INTEREST', '공익적 비판'],
          ['POLITICAL_OPINION', '정치적 의견/평가'],
          ['LICENSE', '저작물 사용 권한 보유'],
          ['CLAIM_FALSE', '신청 내용이 사실과 다름'],
          ['OTHER', '기타 복원 사유'],
        ].forEach(function (opt) {
          var o = document.createElement('option');
          o.value = opt[0];
          o.textContent = opt[1];
          sel.appendChild(o);
        });
        var ta = document.createElement('textarea');
        ta.rows = 4;
        ta.placeholder = '구체적인 설명을 작성하세요.';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sc-btn';
        btn.textContent = '이의제기 제출';
        btn.addEventListener('click', function () {
          fetch('/api/rights-infringement/me/requests/' + encodeURIComponent(n.id) + '/objection', {
            method: 'POST',
            headers: authHeaders(),
            credentials: 'same-origin',
            body: JSON.stringify({ ground: sel.value, explanation: ta.value }),
          })
            .then(function (res) { return res.json(); })
            .then(function (out) {
              setStatus(out && out.ok ? '이의제기가 접수되었습니다.' : '이의제기 실패: ' + ((out && out.error) || ''));
            })
            .catch(function () { setStatus('이의제기 요청 실패'); });
        });
        card.appendChild(title);
        card.appendChild(p1);
        card.appendChild(p2);
        card.appendChild(p3);
        card.appendChild(p4);
        card.appendChild(sel);
        card.appendChild(ta);
        card.appendChild(btn);
        box.appendChild(card);
      });
    })
    .catch(function () {});
})();
