(function () {
  'use strict';

  var H = window.ScAdminHub;

  function box(title) {
    var b = H.el('section', null, 'sc-hub-box');
    b.appendChild(H.el('h2', title));
    return b;
  }

  function row(kv, label, valueNode) {
    kv.appendChild(H.el('span', label));
    var cell = H.el('span');
    if (typeof valueNode === 'string') cell.textContent = valueNode;
    else cell.appendChild(valueNode);
    kv.appendChild(cell);
  }

  function yesNo(v) { return v === true ? '예' : v === false ? '아니오' : '미확인'; }

  function runStatus(run) {
    if (!run) return '기록 없음';
    var parts = [run.status || '상태 미확인'];
    var when = H.fmtTime(run.finishedAt || run.startedAt);
    if (when) parts.push(when);
    if (run.errorCode) parts.push('사유 ' + run.errorCode);
    return parts.join(' · ');
  }

  function render(sys, daily) {
    var host = document.getElementById('sc-s-body');
    host.textContent = '';

    var a = box('서버·DB');
    var kv = H.el('div', null, 'sc-hub-kv');
    row(kv, '서버', H.stateBadge(sys.server.status));
    row(kv, '가동 시간', Math.floor(sys.server.uptimeSeconds / 60) + '분 (이 서버 프로세스 기준)');
    row(kv, '실행 환경', sys.server.nodeEnv || '미확인');
    row(kv, 'DB 연결', H.stateBadge(sys.database.status));
    if (sys.database.note) row(kv, 'DB 메모', sys.database.note);
    a.appendChild(kv);
    host.appendChild(a);

    var b = box('최근 API 오류 (5xx)');
    b.appendChild(H.el('p', '서버를 켠 뒤 메모리에만 남는 기록입니다. 재시작하면 사라지고, 요청 내용과 사용자 정보는 저장하지 않습니다. 기록 시작: ' + (H.fmtTime(sys.apiErrors.since) || '미확인'), 'sc-hub-note'));
    if (!sys.apiErrors.items.length) {
      b.appendChild(H.el('p', '이 기간에 기록된 오류가 없습니다.'));
    } else {
      var t = H.el('table');
      var hr = H.el('tr');
      ['시각', '요청', '상태'].forEach(function (x) { hr.appendChild(H.el('th', x)); });
      t.appendChild(hr);
      sys.apiErrors.items.forEach(function (e) {
        var tr = H.el('tr');
        tr.appendChild(H.el('td', H.fmtTime(e.at)));
        tr.appendChild(H.el('td', e.method + ' ' + e.path));
        tr.appendChild(H.el('td', String(e.status)));
        t.appendChild(tr);
      });
      b.appendChild(t);
    }
    host.appendChild(b);

    var pe = box('저장된 API 오류 집계 (재시작 후에도 유지)');
    var pr = sys.apiErrorsPersisted || { status: 'NOT_COLLECTED', items: [] };
    if (pr.status !== 'OK') {
      pe.appendChild(H.stateBadge(pr.status));
      pe.appendChild(H.el('p', pr.status === 'NOT_COLLECTED' ? '저장 보관기간이 정해지기 전이라 저장 기능이 꺼져 있습니다. 위 메모리 기록만 제공됩니다.' : '저장소를 확인하지 못했습니다.', 'sc-hub-note'));
    } else {
      pe.appendChild(H.el('p', '하루·요청 경로·상태별 횟수만 저장합니다. 요청 내용, 토큰, IP, 사용자 정보는 저장하지 않습니다. 저장 한도 ' + pr.cap + '건.', 'sc-hub-note'));
      if (!pr.items.length) {
        pe.appendChild(H.el('p', '저장된 오류가 없습니다.'));
      } else {
        var pt = H.el('table');
        var ph = H.el('tr');
        ['날짜', '요청', '상태', '횟수', '마지막', '처리'].forEach(function (x) { ph.appendChild(H.el('th', x)); });
        pt.appendChild(ph);
        pr.items.forEach(function (it) {
          var tr = H.el('tr');
          tr.appendChild(H.el('td', it.day));
          tr.appendChild(H.el('td', it.method + ' ' + it.path));
          tr.appendChild(H.el('td', String(it.status)));
          tr.appendChild(H.el('td', String(it.count)));
          tr.appendChild(H.el('td', H.fmtTime(it.lastAt)));
          var td = H.el('td');
          var sel = H.el('select');
          [['NEW', '새 오류'], ['CHECKED', '확인함'], ['IGNORED', '무시']].forEach(function (o) {
            var opt = H.el('option', o[1]);
            opt.value = o[0];
            if (o[0] === it.handling) opt.selected = true;
            sel.appendChild(opt);
          });
          sel.addEventListener('change', function () {
            H.api('PATCH', '/api/admin/system/errors/' + encodeURIComponent(it.id), { handling: sel.value });
          });
          td.appendChild(sel);
          tr.appendChild(td);
          pt.appendChild(tr);
        });
        pe.appendChild(pt);
      }
    }
    host.appendChild(pe);

    var c = box('로그인 설정 상태');
    var kv2 = H.el('div', null, 'sc-hub-kv');
    row(kv2, '서버 인증 설정', yesNo(sys.login.serverAuthConfigured));
    row(kv2, '서버 서비스 연결', yesNo(sys.login.serviceClientConfigured));
    row(kv2, 'Google·Kakao·Naver', H.stateBadge(sys.login.providers.status));
    row(kv2, '메모', sys.login.providers.note);
    c.appendChild(kv2);
    c.appendChild(H.el('p', '비밀키 원문은 표시하지 않습니다.', 'sc-hub-note'));
    host.appendChild(c);

    var d = box('성향 배치 (한국 시간 05:00 / 17:00)');
    var al = sys.schedulers.alignment;
    var kv3 = H.el('div', null, 'sc-hub-kv');
    row(kv3, '정책 설정', al.policyEnabled ? '켜짐' : '꺼짐');
    row(kv3, '이 프로세스에서 실행 중', yesNo(al.runningInThisProcess));
    row(kv3, '다음 예정', H.fmtTime(al.nextSlotAt) || '미확인');
    var last = al.lastBatch;
    if (last.status === 'OK') {
      row(kv3, '마지막 배치', last.value.batchId + ' · ' + last.value.batchStatus + ' · ' + (H.fmtTime(last.value.completedAt || last.value.processedAt) || '-'));
    } else {
      row(kv3, '마지막 배치', H.stateBadge(last.status));
    }
    d.appendChild(kv3);
    host.appendChild(d);

    var e = box('Daily Issue 수집·검토·발행');
    var dm = sys.schedulers.dailyIssueMorning;
    var kv4 = H.el('div', null, 'sc-hub-kv');
    row(kv4, '아침 수집 정책', dm.policyEnabled ? '켜짐' : '꺼짐');
    row(kv4, '자동 발행 정책', dm.autoPublishEnabled ? '켜짐' : '꺼짐');
    row(kv4, '이 프로세스에서 실행 중', yesNo(dm.runningInThisProcess));
    if (daily && daily.ok && daily.data) {
      row(kv4, '마지막 수집', runStatus(daily.data.lastCollect));
      row(kv4, '마지막 발행', runStatus(daily.data.lastPublish));
      row(kv4, '다음 수집 예정', H.fmtTime(daily.data.nextCollectAt) || '미확인');
      row(kv4, '다음 발행 예정', H.fmtTime(daily.data.nextPublishAt) || '미확인');
    } else {
      row(kv4, '마지막 수집·발행', H.stateBadge('NOT_CONFIRMED'));
    }
    e.appendChild(kv4);
    e.appendChild(H.el('p', '검수·승인 작업은 Daily Issue 화면에서 합니다. 기록은 그 화면과 같은 곳에서 읽어 옵니다.', 'sc-hub-note'));
    host.appendChild(e);
  }

  function load() {
    var status = document.getElementById('sc-s-status');
    status.textContent = '불러오는 중...';
    Promise.all([
      H.api('GET', '/api/admin/system/status'),
      H.api('GET', '/api/admin/daily-issues/morning/status').catch(function () { return null; }),
    ]).then(function (packs) {
      var res = packs[0];
      var msg = H.authMessage(res.status);
      if (msg) { status.textContent = msg; return; }
      if (!res.body || !res.body.ok) { status.textContent = '시스템 상태를 불러오지 못했습니다.'; return; }
      status.textContent = '';
      render(res.body, packs[1] && packs[1].status === 200 ? packs[1].body : null);
    }).catch(function () { status.textContent = '시스템 상태를 불러오지 못했습니다.'; });
  }

  document.getElementById('sc-s-refresh').addEventListener('click', load);
  load();
})();
