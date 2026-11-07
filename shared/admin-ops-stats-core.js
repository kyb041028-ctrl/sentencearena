'use strict';

/**
 * 관리자 운영 통계 집계.
 * 순방문자와 방문 횟수, 회원 활동과 게스트 방문을 나눈다.
 * 정치성향은 받지 않는다. 브라우저가 열린 시간은 체류로 쓰지 않는다.
 * 수집하지 않은 값은 0이 아니라 NOT_COLLECTED, 분모가 없으면 NO_DATA.
 */

const TIME_ZONE = 'Asia/Seoul';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const SESSION_GAP_MS = 30 * 60 * 1000;
const MAX_RANGE_DAYS = 90;
const CHANNELS = ['direct', 'google', 'naver', 'instagram', 'threads', 'youtube', 'other'];

function pad(n) {
  return String(n).padStart(2, '0');
}

function kstDateKeyFromUtcMs(ms) {
  const d = new Date(ms + KST_OFFSET_MS);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

function kstDateKey(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return kstDateKeyFromUtcMs(ms);
}

function dateKeyToUtcMs(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - KST_OFFSET_MS;
}

function addDays(dateKey, days) {
  const start = dateKeyToUtcMs(dateKey);
  if (start == null) return null;
  return kstDateKeyFromUtcMs(start + days * 86400000 + 12 * 3600000);
}

function daysInclusive(from, to) {
  const a = dateKeyToUtcMs(from);
  const b = dateKeyToUtcMs(to);
  if (a == null || b == null) return null;
  return Math.round((b - a) / 86400000) + 1;
}

function isoWeekKey(dateKey) {
  const dow = new Date(dateKeyToUtcMs(dateKey) + KST_OFFSET_MS).getUTCDay();
  const sinceMonday = (dow + 6) % 7;
  return addDays(dateKey, -sinceMonday);
}

function monthKey(dateKey) {
  return String(dateKey).slice(0, 7);
}

function inDayRange(dateKey, from, to) {
  return dateKey >= from && dateKey <= to;
}

function metric(status, value, extra) {
  const row = { status: status, value: status === 'OK' ? value : null };
  if (extra) Object.assign(row, extra);
  return row;
}

function notCollected(note) {
  return metric('NOT_COLLECTED', null, note ? { note: note } : null);
}

function noData(note) {
  return metric('NO_DATA', null, note ? { note: note } : null);
}

function okNum(value, extra) {
  return metric('OK', value, extra);
}

function resolveRange(input) {
  const src = input || {};
  const nowSource = src.now ? 'FIXED_FOR_TEST' : 'REAL_CLOCK';
  const nowKey = kstDateKey(src.now || new Date().toISOString());
  const preset = String(src.preset || 'today');
  let from = null;
  let to = null;
  if (preset === 'today') {
    from = nowKey;
    to = nowKey;
  } else if (preset === '7d') {
    from = addDays(nowKey, -6);
    to = nowKey;
  } else if (preset === '30d') {
    from = addDays(nowKey, -29);
    to = nowKey;
  } else if (preset === '90d') {
    from = addDays(nowKey, -89);
    to = nowKey;
  } else if (preset === 'custom') {
    from = String(src.from || '');
    to = String(src.to || '');
  } else {
    const err = new Error('RANGE_INVALID');
    err.code = 'RANGE_INVALID';
    throw err;
  }
  if (!dateKeyToUtcMs(from) || !dateKeyToUtcMs(to) || from > to) {
    const err = new Error('RANGE_INVALID');
    err.code = 'RANGE_INVALID';
    throw err;
  }
  const span = daysInclusive(from, to);
  if (span == null || span > MAX_RANGE_DAYS) {
    const err = new Error('RANGE_TOO_LONG');
    err.code = 'RANGE_TOO_LONG';
    throw err;
  }
  return {
    preset: preset,
    timeZone: TIME_ZONE,
    nowSource: nowSource,
    from: from,
    to: to,
    startIso: new Date(dateKeyToUtcMs(from)).toISOString(),
    endIso: new Date(dateKeyToUtcMs(addDays(to, 1))).toISOString(),
    today: nowKey,
    yesterday: addDays(nowKey, -1),
    days: span,
  };
}

function normalizeEvents(events) {
  const out = [];
  (events || []).forEach(function (raw) {
    const at = Date.parse(raw && raw.occurredAt);
    const key = String((raw && raw.visitorKey) || '').trim();
    if (!Number.isFinite(at) || !key) return;
    const actor = raw.actorType === 'guest' ? 'guest' : raw.actorType === 'member' ? 'member' : null;
    out.push({
      t: at,
      day: kstDateKeyFromUtcMs(at),
      visitorKey: key,
      actorType: actor,
      userId: raw.userId ? String(raw.userId) : null,
      kind: raw.kind === 'page_view' ? 'page_view' : raw.kind === 'activity' ? 'activity' : null,
      channel: CHANNELS.indexOf(raw.channel) >= 0 ? raw.channel : null,
      utmSource: raw.utmSource ? String(raw.utmSource).slice(0, 40) : null,
      deviceClass: raw.deviceClass === 'pc' || raw.deviceClass === 'mobile' ? raw.deviceClass : null,
    });
  });
  out.sort(function (a, b) {
    return a.t - b.t;
  });
  return out;
}

function buildSessions(events) {
  const groups = new Map();
  events.forEach(function (ev) {
    if (!groups.has(ev.visitorKey)) groups.set(ev.visitorKey, []);
    groups.get(ev.visitorKey).push(ev);
  });
  const sessions = [];
  groups.forEach(function (list, visitorKey) {
    let cur = null;
    list.forEach(function (ev) {
      if (!cur || ev.t - cur.lastT > SESSION_GAP_MS) {
        cur = {
          visitorKey: visitorKey,
          start: ev.t,
          lastT: ev.t,
          startDay: ev.day,
          events: [ev],
          actorType: ev.actorType,
          userId: ev.userId,
          channel: ev.channel,
          utmSource: ev.utmSource,
          deviceClass: ev.deviceClass,
        };
        sessions.push(cur);
      } else {
        cur.lastT = ev.t;
        cur.events.push(ev);
        if (!cur.userId && ev.userId) cur.userId = ev.userId;
        if (cur.actorType !== 'member' && ev.actorType === 'member') cur.actorType = 'member';
      }
    });
  });
  return sessions;
}

function median(nums) {
  if (!nums.length) return null;
  const s = nums.slice().sort(function (a, b) {
    return a - b;
  });
  const mid = Math.floor(s.length / 2);
  if (s.length % 2) return s[mid];
  return Math.round((s[mid - 1] + s[mid]) / 2);
}

function distinctKeysOn(events, pred) {
  const set = new Set();
  events.forEach(function (ev) {
    if (pred(ev)) set.add(ev.visitorKey);
  });
  return set;
}

function seriesBy(events, from, to, keyFn) {
  const map = new Map();
  events.forEach(function (ev) {
    if (!inDayRange(ev.day, from, to)) return;
    const key = keyFn(ev.day);
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(ev.visitorKey);
  });
  return Array.from(map.keys())
    .sort()
    .map(function (key) {
      return { key: key, uniqueVisitors: map.get(key).size };
    });
}

function buildVisitBlock(range, input) {
  if (!input || input.visitsCollected !== true) {
    return {
      status: 'NOT_COLLECTED',
      note: '방문 이벤트 수집은 개인정보 보관기간이 확정되기 전에는 켜지 않습니다.',
      todayUnique: notCollected(),
      yesterdayUnique: notCollected(),
      periodUnique: notCollected(),
      periodVisits: notCollected(),
      cumulativeUnique: notCollected('보관기간이 없어 전체 누적은 조회하지 않습니다.'),
      cumulativeVisits: notCollected('보관기간이 없어 전체 방문 횟수는 조회하지 않습니다.'),
      dailyUnique: notCollected(),
      weeklyUnique: notCollected(),
      monthlyUnique: notCollected(),
      memberUnique: notCollected(),
      guestUnique: notCollected(),
    };
  }
  if (input.visitsTruncated === true) {
    const blocked = notCollected('기간 방문 이벤트가 집계 상한을 넘었습니다.');
    blocked.status = 'NO_DATA';
    return {
      status: 'NO_DATA',
      note: '기간 방문 이벤트가 집계 상한을 넘었습니다.',
      todayUnique: blocked,
      yesterdayUnique: blocked,
      periodUnique: blocked,
      periodVisits: blocked,
      cumulativeUnique: notCollected('보관기간이 없어 전체 누적은 조회하지 않습니다.'),
      cumulativeVisits: notCollected('보관기간이 없어 전체 방문 횟수는 조회하지 않습니다.'),
      dailyUnique: blocked,
      weeklyUnique: blocked,
      monthlyUnique: blocked,
      memberUnique: blocked,
      guestUnique: blocked,
    };
  }
  const events = normalizeEvents(input.visitEvents);
  const sessions = buildSessions(events);
  const periodEvents = events.filter(function (ev) {
    return inDayRange(ev.day, range.from, range.to);
  });
  const periodSessions = sessions.filter(function (s) {
    return inDayRange(s.startDay, range.from, range.to);
  });
  const periodKeys = distinctKeysOn(periodEvents, function () {
    return true;
  });
  const memberKeys = new Set();
  const guestKeys = new Set();
  periodEvents.forEach(function (ev) {
    if (ev.actorType === 'member' || ev.userId) memberKeys.add(ev.visitorKey);
  });
  periodKeys.forEach(function (key) {
    if (!memberKeys.has(key)) guestKeys.add(key);
  });
  return {
    status: 'OK',
    note: '순방문자=기간 안 서로 다른 방문 키. 방문 횟수=활동이 30분을 넘기 전에 이어진 묶음. 회원 순방문자와 게스트 순방문자는 겹치지 않습니다.',
    sessionGapMinutes: 30,
    todayUnique: okNum(distinctKeysOn(events, function (ev) { return ev.day === range.today; }).size),
    yesterdayUnique: okNum(distinctKeysOn(events, function (ev) { return ev.day === range.yesterday; }).size),
    periodUnique: okNum(periodKeys.size),
    periodVisits: okNum(periodSessions.length),
    cumulativeUnique: notCollected('보관기간이 없어 선택 기간 밖의 전체 누적은 조회하지 않습니다.'),
    cumulativeVisits: notCollected('보관기간이 없어 선택 기간 밖의 전체 방문 횟수는 조회하지 않습니다.'),
    dailyUnique: okNum(seriesBy(events, range.from, range.to, function (day) { return day; })),
    weeklyUnique: okNum(seriesBy(events, range.from, range.to, isoWeekKey)),
    monthlyUnique: okNum(seriesBy(events, range.from, range.to, monthKey)),
    memberUnique: okNum(memberKeys.size),
    guestUnique: okNum(guestKeys.size),
    _events: periodEvents,
    _allEvents: events,
    _sessions: periodSessions,
    _periodKeys: periodKeys,
  };
}

function buildReturnBlock(range, visit) {
  if (!visit || visit.status !== 'OK') {
    return {
      status: 'NOT_COLLECTED',
      newVisitors: notCollected(),
      returningVisitors: notCollected(),
      returnRate7d: notCollected(),
      returnRate30d: notCollected(),
      retentionD1: notCollected(),
      retentionD7: notCollected(),
      retentionD30: notCollected(),
      weeklyAverageVisitDays: notCollected(),
    };
  }
  const events = visit._allEvents || [];
  const first = new Map();
  events.forEach(function (ev) {
    if (!first.has(ev.visitorKey) || ev.t < first.get(ev.visitorKey).t) first.set(ev.visitorKey, ev);
  });
  let fresh = 0;
  let returning = 0;
  visit._periodKeys.forEach(function (key) {
    const f = first.get(key);
    if (f && inDayRange(f.day, range.from, range.to)) fresh += 1;
    else returning += 1;
  });
  const denom = visit._periodKeys.size;
  function rate(windowDays) {
    if (range.days !== windowDays) {
      return noData('이 재방문율은 기간이 ' + windowDays + '일일 때만 계산합니다. 분모는 그 기간의 순방문자입니다.');
    }
    if (!denom) return noData('분모가 0입니다. 기간 순방문자가 없습니다.');
    if (inputHistoryIncomplete(events, range)) {
      return noData('기간 시작 이전 기록이 이 입력에 없어 재방문을 확정할 수 없습니다.');
    }
    return okNum(Math.round((returning / denom) * 1000) / 10, {
      numerator: returning,
      denominator: denom,
      denominatorNote: '최근 ' + windowDays + '일(오늘 포함, 한국 날짜) 순방문자',
      numeratorNote: '그중 첫 방문일이 그 기간보다 이전인 사람',
    });
  }
  return {
    status: 'OK',
    newVisitors: okNum(fresh, { note: '첫 방문일이 선택 기간 안인 순방문자. 기간 밖 기록이 없으면 모두 신규로 보일 수 있습니다.' }),
    returningVisitors: okNum(returning, { note: '첫 방문일이 선택 기간보다 이전이고, 이 기간에도 이벤트가 있는 순방문자' }),
    returnRate7d: rate(7),
    returnRate30d: rate(30),
    retentionD1: retention(events, first, range, 1),
    retentionD7: retention(events, first, range, 7),
    retentionD30: retention(events, first, range, 30),
    weeklyAverageVisitDays: weeklyDays(events, range),
  };
}

function inputHistoryIncomplete(events, range) {
  if (!events.length) return true;
  return events[0].day >= range.from;
}

function retention(events, first, range, n) {
  const byKeyDay = new Set();
  events.forEach(function (ev) {
    byKeyDay.add(ev.visitorKey + '|' + ev.day);
  });
  let denom = 0;
  let num = 0;
  first.forEach(function (ev, key) {
    if (!inDayRange(ev.day, range.from, range.to)) return;
    const observe = addDays(ev.day, n);
    if (!observe || observe >= range.today) return;
    denom += 1;
    if (byKeyDay.has(key + '|' + observe)) num += 1;
  });
  if (!denom) {
    return noData('D' + n + '는 첫 방문일+' + n + '일이 이미 지난 사람만 분모입니다. 해당 코호트가 없습니다.');
  }
  return okNum(Math.round((num / denom) * 1000) / 10, {
    numerator: num,
    denominator: denom,
    denominatorNote: '선택 기간에 첫 방문하고, 첫 방문+' + n + '일(한국 날짜)이 오늘보다 이전인 순방문자',
    numeratorNote: '그중 첫 방문+' + n + '일 당일에 활동 이벤트가 있는 사람',
  });
}

function weeklyDays(events, range) {
  const weeks = new Map();
  events.forEach(function (ev) {
    if (!inDayRange(ev.day, range.from, range.to)) return;
    const week = isoWeekKey(ev.day);
    if (!weeks.has(week)) weeks.set(week, new Map());
    const people = weeks.get(week);
    if (!people.has(ev.visitorKey)) people.set(ev.visitorKey, new Set());
    people.get(ev.visitorKey).add(ev.day);
  });
  const samples = [];
  weeks.forEach(function (people) {
    people.forEach(function (days) {
      samples.push(days.size);
    });
  });
  if (!samples.length) return noData('선택 기간에 방문 주가 없습니다.');
  const sum = samples.reduce(function (a, b) { return a + b; }, 0);
  return okNum(Math.round((sum / samples.length) * 10) / 10, {
    denominator: samples.length,
    denominatorNote: '선택 기간과 겹친 주마다, 그 주에 한 번이라도 방문한 사람 수(사람-주)',
    numeratorNote: '각 사람-주의 서로 다른 한국 날짜 수를 평균',
  });
}

function buildUsageBlock(visit) {
  if (!visit || visit.status !== 'OK') {
    return {
      status: 'NOT_COLLECTED',
      averageDwellSeconds: notCollected(),
      medianDwellSeconds: notCollected(),
      activeSeconds: notCollected(),
      pageViewsPerVisit: notCollected(),
      deviceMix: notCollected(),
    };
  }
  const dwells = [];
  visit._sessions.forEach(function (s) {
    if (s.events.length >= 2) dwells.push(Math.max(0, Math.round((s.lastT - s.start) / 1000)));
  });
  const pageViews = visit._events.filter(function (ev) { return ev.kind === 'page_view'; }).length;
  const pageKnown = visit._allEvents.some(function (ev) { return ev.kind === 'page_view'; });
  const deviceKnown = visit._allEvents.some(function (ev) { return ev.deviceClass; });
  let device = notCollected('기기 구분은 수집하지 않았습니다. 기기 지문은 저장하지 않습니다.');
  if (deviceKnown) {
    let pc = 0;
    let mobile = 0;
    let unknown = 0;
    visit._sessions.forEach(function (s) {
      if (s.deviceClass === 'pc') pc += 1;
      else if (s.deviceClass === 'mobile') mobile += 1;
      else unknown += 1;
    });
    const base = pc + mobile;
    device = base
      ? okNum({ pc: pc, mobile: mobile, unknown: unknown, pcPercent: Math.round((pc / base) * 1000) / 10, mobilePercent: Math.round((mobile / base) * 1000) / 10 }, {
        denominatorNote: '기기 구분이 있는 방문 묶음. 구분 없음은 비율 분모에서 뺍니다.',
      })
      : noData('PC·모바일로 구분된 방문이 없습니다.');
  }
  return {
    status: 'OK',
    note: '체류는 한 방문 묶음 안의 첫 활동과 마지막 활동 사이입니다. 이벤트가 하나뿐이면 체류를 0으로 두지 않고 평균에서 뺍니다.',
    averageDwellSeconds: dwells.length ? okNum(Math.round(dwells.reduce(function (a, b) { return a + b; }, 0) / dwells.length)) : noData('활동이 두 번 이상인 방문이 없습니다.'),
    medianDwellSeconds: dwells.length ? okNum(median(dwells)) : noData('활동이 두 번 이상인 방문이 없습니다.'),
    activeSeconds: dwells.length ? okNum(dwells.reduce(function (a, b) { return a + b; }, 0)) : noData('활동이 두 번 이상인 방문이 없습니다.'),
    pageViewsPerVisit: pageKnown
      ? (visit._sessions.length ? okNum(Math.round((pageViews / visit._sessions.length) * 10) / 10, { pageViews: pageViews, visits: visit._sessions.length }) : noData('분모인 방문 횟수가 0입니다.'))
      : notCollected('페이지 조회 이벤트는 수집하지 않았습니다.'),
    deviceMix: device,
  };
}

function buildMemberBlock(range, input) {
  const src = (input && input.members) || null;
  if (!src) {
    return {
      status: 'NOT_COLLECTED',
      currentMembers: notCollected(),
      signups: notCollected(),
      cumulativeSignups: notCollected('탈퇴하면 프로필이 지워져 누적 가입은 남은 회원 수로 대체하지 않습니다.'),
      withdrawals: notCollected(),
      dau: notCollected(),
      wau: notCollected(),
      mau: notCollected(),
      participation: notCollected(),
      firstActivityConversion: notCollected(),
    };
  }
  const acts = (src.activities || []).filter(function (row) {
    return row && row.userId && row.at && kstDateKey(row.at);
  }).map(function (row) {
    return { userId: String(row.userId), at: row.at, day: kstDateKey(row.at), kind: row.kind };
  });
  function activeBetween(fromDay, toDay) {
    const set = new Set();
    acts.forEach(function (row) {
      if (inDayRange(row.day, fromDay, toDay)) set.add(row.userId);
    });
    return set;
  }
  const dauDay = range.to;
  const wauFrom = addDays(range.to, -6);
  const mauFrom = addDays(range.to, -29);
  const periodActive = activeBetween(range.from, range.to);
  const posters = new Set();
  const commenters = new Set();
  const reactors = new Set();
  acts.forEach(function (row) {
    if (!inDayRange(row.day, range.from, range.to)) return;
    if (row.kind === 'post') posters.add(row.userId);
    else if (row.kind === 'comment') commenters.add(row.userId);
    else if (row.kind === 'reaction') reactors.add(row.userId);
  });
  const signups = src.signups || [];
  let converted = 0;
  signups.forEach(function (member) {
    const day = kstDateKey(member.createdAt);
    if (!day || !inDayRange(day, range.from, range.to)) return;
    const hit = acts.some(function (row) {
      return row.userId === String(member.id) && Date.parse(row.at) >= Date.parse(member.createdAt);
    });
    if (hit) converted += 1;
  });
  const signupDenom = signups.filter(function (member) {
    const day = kstDateKey(member.createdAt);
    return day && inDayRange(day, range.from, range.to);
  }).length;
  const conversion = src.withdrawalsInPeriod > 0
    ? noData('기간 중 탈퇴가 있어, 지워진 가입을 분모에 넣을 수 없습니다.')
    : signupDenom
      ? okNum(Math.round((converted / signupDenom) * 1000) / 10, {
        numerator: converted,
        denominator: signupDenom,
        denominatorNote: '기간 중 만들어져 아직 남아 있는 프로필',
        numeratorNote: '그중 가입 시각 이후에 글·댓글·반응이 있는 회원',
      })
      : noData('기간 중 남은 신규 프로필이 없습니다.');
  return {
    status: 'OK',
    note: 'DAU·WAU·MAU는 글·댓글·반응이 있는 회원만 셉니다. 게스트 방문자는 넣지 않습니다. 작성자가 비워진 탈퇴 글은 회원 활동에 넣지 않습니다.',
    currentMembers: src.currentMembers == null ? notCollected() : okNum(src.currentMembers, { note: '지금 남아 있는 프로필 수' }),
    signups: okNum(signupDenom, { note: '기간 중 가입했고 아직 프로필이 남은 회원. 탈퇴분은 빠집니다.' }),
    cumulativeSignups: notCollected('탈퇴 시 프로필이 삭제되어 누적 가입 수는 집계하지 않습니다.'),
    withdrawals: src.withdrawalsInPeriod == null ? notCollected() : okNum(src.withdrawalsInPeriod, { note: '개인 식별 없는 탈퇴 완료 기록 수' }),
    dau: okNum(activeBetween(dauDay, dauDay).size, { day: dauDay, note: '선택 기간의 마지막 날' }),
    wau: okNum(activeBetween(wauFrom, range.to).size, { from: wauFrom, to: range.to, note: '마지막 날 포함 7일' }),
    mau: okNum(activeBetween(mauFrom, range.to).size, { from: mauFrom, to: range.to, note: '마지막 날 포함 30일' }),
    participation: okNum({
      posts: posters.size,
      comments: commenters.size,
      reactions: reactors.size,
      any: periodActive.size,
    }, { note: '참여율 분모가 될 당시 회원 명단이 없어 인원만 표시합니다.', rate: noData('당시 회원 수를 알 수 없습니다.') }),
    firstActivityConversion: conversion,
  };
}

function buildInflowBlock(visit) {
  const empty = {
    status: 'NOT_COLLECTED',
    channels: notCollected(),
    utmVisits: notCollected(),
    utmSignups: notCollected('가입 경로 UTM은 저장하지 않습니다.'),
  };
  if (!visit || visit.status !== 'OK') return empty;
  const counts = {};
  CHANNELS.forEach(function (name) { counts[name] = 0; });
  let unknown = 0;
  const utm = new Map();
  visit._sessions.forEach(function (s) {
    if (s.channel) counts[s.channel] += 1;
    else unknown += 1;
    if (s.utmSource) utm.set(s.utmSource, (utm.get(s.utmSource) || 0) + 1);
  });
  return {
    status: 'OK',
    note: '유입은 방문 묶음의 첫 이벤트 기준입니다. 로그인 제공자와 유입을 섞지 않습니다.',
    channels: okNum(Object.assign({ unknown: unknown }, counts), { denominatorNote: '선택 기간에 시작한 방문 묶음' }),
    utmVisits: okNum(Array.from(utm.keys()).sort().map(function (key) {
      return { utmSource: key, visits: utm.get(key) };
    })),
    utmSignups: notCollected('가입 경로 UTM은 저장하지 않습니다.'),
  };
}

function buildOpsBlock(input) {
  const src = input && input.operations;
  if (!src) {
    return {
      status: 'NOT_COLLECTED',
      posts: notCollected(),
      comments: notCollected(),
      reactions: notCollected(),
      boards: notCollected(),
      reports: notCollected(),
      sanctions: notCollected(),
      pendingReports: notCollected(),
      dailyIssuesPublished: notCollected(),
      dailyPosts: notCollected(),
    };
  }
  function num(v) {
    return v == null ? notCollected() : okNum(v);
  }
  return {
    status: 'OK',
    posts: num(src.posts),
    comments: num(src.comments),
    reactions: num(src.reactions),
    boards: src.boards == null ? notCollected() : okNum(src.boards),
    reports: num(src.reports),
    sanctions: num(src.sanctions),
    pendingReports: src.pendingReports == null ? notCollected() : okNum(src.pendingReports, { note: '현재 상태. 선택 기간과 무관한 미처리 건수입니다.' }),
    dailyIssuesPublished: num(src.dailyIssuesPublished),
    dailyPosts: src.dailyPosts == null ? notCollected() : okNum(src.dailyPosts),
  };
}

function stripInternal(visit) {
  if (!visit) return visit;
  const copy = Object.assign({}, visit);
  delete copy._events;
  delete copy._allEvents;
  delete copy._sessions;
  delete copy._periodKeys;
  return copy;
}

function buildAdminOpsStats(input) {
  const range = resolveRange(input || {});
  const visit = buildVisitBlock(range, input || {});
  const body = {
    ok: true,
    range: {
      preset: range.preset,
      timeZone: range.timeZone,
      nowSource: range.nowSource,
      from: range.from,
      to: range.to,
      startIso: range.startIso,
      endIso: range.endIso,
      today: range.today,
      yesterday: range.yesterday,
      days: range.days,
    },
    visits: stripInternal(visit),
    returns: buildReturnBlock(range, visit),
    usage: buildUsageBlock(visit),
    members: buildMemberBlock(range, input || {}),
    inflow: buildInflowBlock(visit),
    operations: buildOpsBlock(input || {}),
  };
  const raw = JSON.stringify(body);
  if (/alignment|visitorKey|userId|fingerprint|\bip\b/i.test(raw)) {
    const err = new Error('STATS_LEAK');
    err.code = 'STATS_LEAK';
    throw err;
  }
  return body;
}

module.exports = {
  TIME_ZONE: TIME_ZONE,
  MAX_RANGE_DAYS: MAX_RANGE_DAYS,
  SESSION_GAP_MS: SESSION_GAP_MS,
  kstDateKey: kstDateKey,
  addDays: addDays,
  resolveRange: resolveRange,
  buildAdminOpsStats: buildAdminOpsStats,
};
