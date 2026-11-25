(function () {
  'use strict';

  var preset = 'today';
  var tab = 'overview';
  var payload = null;

  function authHeaders() {
    var headers = { Accept: 'application/json' };
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

  function textOf(metric) {
    if (!metric || metric.status === 'NOT_COLLECTED') return '미수집';
    if (metric.status === 'NO_DATA') return '데이터 없음';
    if (metric.status !== 'OK') return '데이터 없음';
    if (typeof metric.value === 'number') return String(metric.value);
    return '있음';
  }

  function card(label, metric, hint) {
    var box = document.createElement('article');
    box.className = 'sc-ops-card';
    var name = document.createElement('div');
    name.textContent = label;
    var value = document.createElement('strong');
    value.textContent = textOf(metric);
    box.appendChild(name);
    box.appendChild(value);
    if (hint || (metric && metric.note)) {
      var p = document.createElement('p');
      p.className = 'sc-ops-note';
      p.textContent = hint || metric.note;
      box.appendChild(p);
    }
    if (metric && metric.denominatorNote) {
      var d = document.createElement('p');
      d.className = 'sc-ops-note';
      d.textContent = '분모: ' + metric.denominatorNote;
      box.appendChild(d);
    }
    return box;
  }

  function grid(nodes) {
    var wrap = document.createElement('div');
    wrap.className = 'sc-ops-grid';
    nodes.forEach(function (node) { wrap.appendChild(node); });
    return wrap;
  }

  function table(headers, rows) {
    var t = document.createElement('table');
    t.className = 'sc-ops-table';
    var head = document.createElement('tr');
    headers.forEach(function (h) {
      var th = document.createElement('th');
      th.textContent = h;
      head.appendChild(th);
    });
    t.appendChild(head);
    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      row.forEach(function (cell) {
        var td = document.createElement('td');
        td.textContent = cell;
        tr.appendChild(td);
      });
      t.appendChild(tr);
    });
    return t;
  }

  function chart(points, labelKey, valueKey) {
    var box = document.createElement('div');
    box.className = 'sc-ops-chart';
    if (!points || !points.length) {
      box.textContent = '그래프 데이터 없음';
      return box;
    }
    var max = 1;
    points.forEach(function (p) { if (Number(p[valueKey]) > max) max = Number(p[valueKey]); });
    points.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'sc-ops-bar';
      var label = document.createElement('span');
      label.textContent = String(p[labelKey]);
      var bar = document.createElement('i');
      bar.style.width = Math.max(2, Math.round((Number(p[valueKey]) / max) * 240)) + 'px';
      var n = document.createElement('b');
      n.textContent = String(p[valueKey]);
      row.appendChild(label);
      row.appendChild(bar);
      row.appendChild(n);
      box.appendChild(row);
    });
    return box;
  }

  function seriesRows(metric) {
    if (!metric || metric.status !== 'OK' || !Array.isArray(metric.value)) return null;
    return metric.value;
  }

  function render() {
    var panel = document.getElementById('sc-ops-panel');
    panel.textContent = '';
    if (!payload || payload.ok !== true) {
      panel.textContent = '통계를 표시할 수 없습니다.';
      return;
    }
    var v = payload.visits || {};
    var r = payload.returns || {};
    var u = payload.usage || {};
    var m = payload.members || {};
    var f = payload.inflow || {};
    var o = payload.operations || {};
    if (tab === 'overview') {
      panel.appendChild(grid([
        card('오늘 순방문자', v.todayUnique),
        card('선택 기간 순방문자', v.periodUnique),
        card('선택 기간 방문 횟수', v.periodVisits),
        card('회원 DAU(글·댓글·반응 활성)', m.dau),
        card('현재 회원', m.currentMembers),
        card('발행된 Daily Issue', o.dailyIssuesPublished),
      ]));
      if (o.dailyPosts && o.dailyPosts.status === 'OK') panel.appendChild(chart(o.dailyPosts.value, 'date', 'count'));
      else panel.appendChild(chart(null));
    } else if (tab === 'visits') {
      panel.appendChild(grid([
        card('오늘 순방문자', v.todayUnique),
        card('어제 순방문자', v.yesterdayUnique),
        card('기간 순방문자', v.periodUnique),
        card('기간 방문 횟수', v.periodVisits, '같은 키의 활동이 30분 안에 이어지면 방문 1회로 셉니다.'),
        card('누적 순방문자', v.cumulativeUnique),
        card('전체 방문 횟수', v.cumulativeVisits),
        card('회원 순방문자', v.memberUnique),
        card('게스트 순방문자', v.guestUnique),
        card('신규', r.newVisitors),
        card('재방문', r.returningVisitors),
        card('7일 재방문자 비중 %', r.returnRate7d, '기간 순방문자 중 첫 방문이 그 기간 이전인 사람의 비중입니다. 기간 안에서 두 번 이상 온 사람의 비율(기간 내 재방문율)이 아닙니다.'),
        card('30일 재방문자 비중 %', r.returnRate30d, '기간 순방문자 중 첫 방문이 그 기간 이전인 사람의 비중입니다. 기간 내 재방문율은 계산하지 않습니다.'),
        card('D1 유지율 %', r.retentionD1),
        card('D7 유지율 %', r.retentionD7),
        card('D30 유지율 %', r.retentionD30),
        card('주간 평균 방문일수', r.weeklyAverageVisitDays),
        card('평균 체류 추정 초', u.averageDwellSeconds, '방문 안 첫 활동과 마지막 활동 사이 간격으로 추정한 값입니다. 브라우저가 열려 있던 시간이 아닙니다.'),
        card('중앙 체류 추정 초', u.medianDwellSeconds, '첫·마지막 활동 간격 추정치의 중앙값입니다.'),
        card('활성 이용 추정 초', u.activeSeconds, '첫·마지막 활동 간격 추정치의 합입니다.'),
        card('방문당 페이지 조회', u.pageViewsPerVisit),
      ]));
      var days = seriesRows(v.dailyUnique);
      var weeks = seriesRows(v.weeklyUnique);
      var months = seriesRows(v.monthlyUnique);
      if (days) panel.appendChild(table(['날짜', '순방문자'], days.map(function (row) { return [row.key, String(row.uniqueVisitors)]; })));
      else panel.appendChild(card('일 순방문자', v.dailyUnique));
      if (weeks) panel.appendChild(table(['주 시작', '순방문자'], weeks.map(function (row) { return [row.key, String(row.uniqueVisitors)]; })));
      if (months) panel.appendChild(table(['월', '순방문자'], months.map(function (row) { return [row.key, String(row.uniqueVisitors)]; })));
      if (u.deviceMix && u.deviceMix.status === 'OK') {
        panel.appendChild(table(
          ['구분', '방문'],
          [
            ['PC', String(u.deviceMix.value.pc)],
            ['모바일', String(u.deviceMix.value.mobile)],
            ['구분 없음', String(u.deviceMix.value.unknown)],
          ],
        ));
      } else {
        panel.appendChild(card('PC·모바일', u.deviceMix));
      }
      if (days) panel.appendChild(chart(days, 'key', 'uniqueVisitors'));
    } else if (tab === 'members') {
      var part = m.participation && m.participation.status === 'OK' ? m.participation.value : null;
      panel.appendChild(grid([
        card('현재 회원', m.currentMembers),
        card('기간 신규 가입', m.signups),
        card('누적 가입', m.cumulativeSignups),
        card('탈퇴', m.withdrawals),
        card('DAU(글·댓글·반응 활성 회원)', m.dau),
        card('WAU(글·댓글·반응 활성 회원)', m.wau),
        card('MAU(글·댓글·반응 활성 회원)', m.mau),
        card('첫 활동 전환 %', m.firstActivityConversion),
      ]));
      panel.appendChild(table(
        ['참여', '인원'],
        [
          ['글', part ? String(part.posts) : textOf(m.participation)],
          ['댓글', part ? String(part.comments) : textOf(m.participation)],
          ['반응', part ? String(part.reactions) : textOf(m.participation)],
          ['하나라도', part ? String(part.any) : textOf(m.participation)],
        ],
      ));
    } else if (tab === 'inflow') {
      if (!f.channels || f.channels.status !== 'OK') {
        panel.appendChild(card('유입', f.channels || { status: 'NOT_COLLECTED' }));
      } else {
        var ch = f.channels.value;
        panel.appendChild(table(
          ['유입', '방문 횟수'],
          ['direct', 'google', 'naver', 'instagram', 'threads', 'youtube', 'other', 'unknown'].map(function (key) {
            var label = { direct: '직접', google: '구글', naver: '네이버', instagram: '인스타', threads: '스레드', youtube: '유튜브', other: '기타', unknown: '출처 없음' }[key];
            return [label, String(ch[key] || 0)];
          }),
        ));
      }
      var utm = seriesRows(f.utmVisits);
      if (utm) panel.appendChild(table(['UTM', '방문'], utm.map(function (row) { return [row.utmSource, String(row.visits)]; })));
      else panel.appendChild(card('UTM 방문', f.utmVisits));
      panel.appendChild(card('UTM 가입', f.utmSignups));
    } else {
      panel.appendChild(grid([
        card('글', o.posts),
        card('댓글', o.comments),
        card('반응', o.reactions),
        card('신고', o.reports),
        card('제재', o.sanctions),
        card('미처리 신고', o.pendingReports),
        card('Daily Issue 발행', o.dailyIssuesPublished),
      ]));
      var boards = seriesRows(o.boards);
      if (boards) {
        panel.appendChild(table(['게시판', '글'], boards.map(function (row) { return [String(row.key), String(row.posts)]; })));
        panel.appendChild(chart(boards, 'key', 'posts'));
      } else panel.appendChild(card('인기 게시판', o.boards));
      if (o.dailyPosts && o.dailyPosts.status === 'OK') panel.appendChild(chart(o.dailyPosts.value, 'date', 'count'));
    }
  }

  function setStatus(text) {
    var el = document.getElementById('sc-ops-status');
    if (el) el.textContent = text || '';
  }

  function load() {
    var url = '/api/admin/ops-stats?preset=' + encodeURIComponent(preset);
    if (preset === 'custom') {
      var from = document.getElementById('sc-ops-from').value;
      var to = document.getElementById('sc-ops-to').value;
      url = '/api/admin/ops-stats?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
    }
    setStatus('불러오는 중');
    return fetch(url, { headers: authHeaders(), credentials: 'same-origin' }).then(function (res) {
      return res.json().then(function (body) {
        return { status: res.status, body: body };
      });
    }).then(function (pack) {
      payload = pack.body;
      if (pack.status === 401 || pack.status === 403) {
        setStatus('관리자만 볼 수 있습니다.');
        document.getElementById('sc-ops-panel').textContent = '';
        return;
      }
      if (!payload || payload.ok !== true) {
        setStatus((payload && payload.error && payload.error.message) || '집계를 불러오지 못했습니다.');
        render();
        return;
      }
      var range = payload.range || {};
      var clock = range.nowSource === 'FIXED_FOR_TEST' ? ' · 시험용 고정 시각 기준(실제 오늘 아님)' : ' · 실제 한국 시각 기준';
      document.getElementById('sc-ops-range').textContent = (range.from || '') + ' ~ ' + (range.to || '') + ' · ' + (range.timeZone || '') + clock;
      setStatus('');
      render();
    }).catch(function () {
      setStatus('집계를 불러오지 못했습니다.');
    });
  }

  document.querySelectorAll('.sc-ops-period').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (btn.id === 'sc-ops-custom') preset = 'custom';
      else preset = btn.getAttribute('data-preset');
      document.querySelectorAll('.sc-ops-period').forEach(function (el) { el.classList.remove('is-active'); });
      btn.classList.add('is-active');
      load();
    });
  });
  document.querySelectorAll('.sc-ops-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      tab = btn.getAttribute('data-tab');
      document.querySelectorAll('.sc-ops-tab').forEach(function (el) { el.classList.remove('is-active'); });
      btn.classList.add('is-active');
      render();
    });
  });
  var todayBtn = document.querySelector('[data-preset="today"]');
  if (todayBtn) todayBtn.classList.add('is-active');
  load();
})();
