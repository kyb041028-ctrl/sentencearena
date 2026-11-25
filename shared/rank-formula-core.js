'use strict';

/**
 * 같은 국가·영토 안 계급 점수.
 * 각 지표를 0~100 백분위로 환산한 뒤 가중한다. 같은 지표값은 같은 백분위다.
 * 명성은 누적값에서, 확인된 90일 평가 반응의 명성 증가분만 계산용으로 뺀다.
 * 저장된 회원 명성은 바꾸지 않는다. 중복량을 모르면 점수를 만들지 않는다.
 * 원천 배열이 없으면 0으로 채우지 않는다.
 */
var DAY_MS = 24 * 60 * 60 * 1000;
var WINDOW_MS = 90 * DAY_MS;
var WEIGHTS = Object.freeze({ fame: 0.45, uniqueEvaluators: 0.3, reactions: 0.15, followers: 0.1 });

function seoulParts(ms) {
  var fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  var parts = fmt.formatToParts(new Date(ms));
  var out = {};
  parts.forEach(function (part) {
    if (part.type !== 'literal') out[part.type] = part.value;
  });
  return out;
}

function isSeoulWednesdayMidnight(ms) {
  var parts = seoulParts(ms);
  return parts.weekday === 'Wed' && parts.hour === '00' && parts.minute === '00';
}

var ZONE_BY_COUNTRY = Object.freeze({ KR: 'Asia/Seoul', US: 'America/New_York' });
var WEEKDAY_NAME = Object.freeze({
  Sun: 'SUNDAY', Mon: 'MONDAY', Tue: 'TUESDAY', Wed: 'WEDNESDAY', Thu: 'THURSDAY', Fri: 'FRIDAY', Sat: 'SATURDAY',
});

function zoneFor(country) {
  return ZONE_BY_COUNTRY[String(country || '')] || '';
}

function civilParts(ms, timeZone) {
  var fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  var parts = fmt.formatToParts(new Date(ms));
  var out = {};
  parts.forEach(function (part) {
    if (part.type !== 'literal') out[part.type] = part.value;
  });
  return out;
}

function isLocalMidnight(ms, timeZone) {
  if (!timeZone) return false;
  var parts = civilParts(ms, timeZone);
  return parts.hour === '00' && parts.minute === '00';
}

function localDateKey(ms, timeZone) {
  var parts = civilParts(ms, timeZone);
  return parts.year + '-' + parts.month + '-' + parts.day;
}

function weekdayName(ms, timeZone) {
  return WEEKDAY_NAME[civilParts(ms, timeZone).weekday] || '';
}

function seoulDateKey(ms) {
  var parts = seoulParts(ms);
  return parts.year + '-' + parts.month + '-' + parts.day;
}

function inCohort(row, country, territory) {
  return String(row.country || country) === country && String(row.territory || territory) === territory;
}

function inWindow(atMs, asOfMs) {
  var at = Number(atMs);
  return isFinite(at) && at <= asOfMs && asOfMs - at <= WINDOW_MS && asOfMs - at >= 0;
}

function percentile(value, values) {
  var count = values.length;
  if (count <= 1) return 100;
  var greater = 0;
  values.forEach(function (item) {
    if (item > value) greater += 1;
  });
  return (100 * (count - 1 - greater)) / (count - 1);
}

function fameDeltaOf(row) {
  if (!row) return null;
  if (row.fame_delta != null && row.fame_delta !== '') return Number(row.fame_delta);
  if (row.fameDelta != null && row.fameDelta !== '') return Number(row.fameDelta);
  return null;
}

function followedAtEvaluation(row, asOfMs) {
  var at = Number(row.at_ms != null ? row.at_ms : row.atMs);
  if (!isFinite(at) || at > asOfMs) return false;
  var cancelled = row.cancelled_at_ms != null ? row.cancelled_at_ms : row.cancelledAtMs;
  if (cancelled == null || cancelled === '') return true;
  var ended = Number(cancelled);
  return isFinite(ended) && ended > asOfMs;
}

function storeFour(value) {
  return Number(value.toFixed(4));
}

function scoreCohort(input) {
  var src = input || {};
  var country = String(src.country || '');
  var territory = String(src.territory || '');
  var asOfMs = Number(src.asOfMs);
  if (country !== 'KR' && country !== 'US') return { ok: false, applied: false, reason: 'COUNTRY_REQUIRED' };
  if (!territory) return { ok: false, applied: false, reason: 'TERRITORY_REQUIRED' };
  if (!isFinite(asOfMs)) return { ok: false, applied: false, reason: 'SERVER_CLOCK_REQUIRED' };
  if (!Array.isArray(src.reactions)) return { ok: false, applied: false, reason: 'REACTION_SOURCE_MISSING' };
  if (!Array.isArray(src.follows)) return { ok: false, applied: false, reason: 'FOLLOW_SOURCE_MISSING' };
  var members = Array.isArray(src.members) ? src.members : [];
  var i;
  for (i = 0; i < members.length; i += 1) {
    if (members[i].fame == null || members[i].fame === '') {
      return { ok: false, applied: false, reason: 'FAME_SOURCE_MISSING' };
    }
  }

  var overlapKnown = true;
  var overlapByTarget = Object.create(null);
  var reactionEvents = [];
  src.reactions.forEach(function (row) {
    if (!inCohort(row, country, territory)) return;
    var actor = String(row.actor_id || row.actorId || '');
    var target = String(row.target_id || row.targetId || '');
    if (!actor || !target) return;
    var at = Number(row.at_ms != null ? row.at_ms : row.atMs);
    if (!inWindow(at, asOfMs)) return;
    var delta = fameDeltaOf(row);
    if (delta == null || !isFinite(delta)) {
      overlapKnown = false;
      return;
    }
    if (delta > 0) overlapByTarget[target] = (overlapByTarget[target] || 0) + delta;
    var cancelled = row.cancelled_at_ms != null ? row.cancelled_at_ms : row.cancelledAtMs;
    if (row.invalid === true || cancelled != null) return;
    if (actor === target) return;
    reactionEvents.push({ actor: actor, target: target, polarity: Number(row.polarity) > 0 ? 1 : -1 });
  });
  if (!overlapKnown) {
    return { ok: false, applied: false, reason: 'FAME_OVERLAP_UNCONFIRMED' };
  }

  var validFollows = [];
  var followSeen = Object.create(null);
  src.follows.forEach(function (row) {
    if (!inCohort(row, country, territory)) return;
    var follower = String(row.follower_id || row.followerId || '');
    var target = String(row.target_id || row.targetId || '');
    if (!follower || !target || follower === target) return;
    if (!followedAtEvaluation(row, asOfMs)) return;
    var key = follower + '\n' + target;
    if (followSeen[key]) return;
    followSeen[key] = true;
    validFollows.push({ follower: follower, target: target });
  });

  var raw = members.filter(function (member) {
    return inCohort(member, country, territory);
  }).map(function (member) {
    var id = String(member.id);
    var evaluators = Object.create(null);
    var net = 0;
    reactionEvents.forEach(function (item) {
      if (item.target !== id) return;
      net += item.polarity;
      if (item.polarity > 0) evaluators[item.actor] = true;
    });
    var followers = Object.create(null);
    validFollows.forEach(function (item) {
      if (item.target !== id) return;
      followers[item.follower] = true;
    });
    var storedFame = Number(member.fame);
    var duplicated = overlapByTarget[id] || 0;
    return {
      id: id,
      storedFame: storedFame,
      r: Math.max(0, storedFame - duplicated),
      d: Object.keys(evaluators).length,
      e: net,
      f: Object.keys(followers).length,
    };
  });

  var fameValues = raw.map(function (row) { return row.r; });
  var evaluatorValues = raw.map(function (row) { return row.d; });
  var reactionValues = raw.map(function (row) { return row.e; });
  var followerValues = raw.map(function (row) { return row.f; });
  var scored = raw.map(function (row) {
    var nr = percentile(row.r, fameValues);
    var nd = percentile(row.d, evaluatorValues);
    var ne = percentile(row.e, reactionValues);
    var nf = percentile(row.f, followerValues);
    var combined = nr * WEIGHTS.fame + nd * WEIGHTS.uniqueEvaluators + ne * WEIGHTS.reactions + nf * WEIGHTS.followers;
    return {
      id: row.id,
      storedFame: row.storedFame,
      r: row.r,
      d: row.d,
      e: row.e,
      f: row.f,
      nr: nr,
      nd: nd,
      ne: ne,
      nf: nf,
      combined: combined,
      storedScore: storeFour(combined),
    };
  });
  return {
    ok: true,
    formulaStatus: 'FORMULA_CONFIRMED',
    weights: WEIGHTS,
    members: scored,
    correlation: '계산용 명성은 저장된 누적 명성에서, 최근 90일 평가 반응이 실제로 올린 명성만 뺀다. 저장된 회원 명성은 바꾸지 않는다. 그 반응은 고유 긍정 평가자와 평가 반응에도 들어간다.',
  };
}

module.exports = {
  DAY_MS: DAY_MS,
  WINDOW_MS: WINDOW_MS,
  WEIGHTS: WEIGHTS,
  isSeoulWednesdayMidnight: isSeoulWednesdayMidnight,
  zoneFor: zoneFor,
  isLocalMidnight: isLocalMidnight,
  localDateKey: localDateKey,
  weekdayName: weekdayName,
  seoulDateKey: seoulDateKey,
  percentile: percentile,
  scoreCohort: scoreCohort,
};
