/**
 * DEC-023 계급 평가 — 저장·API와 분리된 순수 계산.
 * 정규화와 명성 중복 보정은 미확정이다. 이 모듈은 그 산식을 만들지 않는다.
 * 비교 점수는 호출자가 넣은 값만 쓰고, 공식 점수로 확정하지 않는다.
 * 시각의 시간대는 받지 않는다. 호출자가 이미 고른 요일·시·분만 본다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Dec023RankEvaluationCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function dec023RankEvaluationCoreFactory() {
  'use strict';

  var FORMULA_STATUS = 'FORMULA_UNCONFIRMED';
  var WEIGHTS = Object.freeze({
    fame: 0.45,
    uniquePositiveEvaluators: 0.3,
    evaluationReactions: 0.15,
    followers: 0.1,
  });
  var RANK_ORDER = {
    citizen: 1,
    debater: 2,
    elder: 3,
    representative: 4,
    leader: 5,
  };
  var LABELS_KO = Object.freeze({
    citizen: '시민',
    debater: '논객',
    elder: '원로',
    representative: '대표',
    leader: '지도자',
  });
  var LABELS_EN_TEMPORARY = Object.freeze({
    citizen: 'Citizen',
    debater: 'Debater',
    elder: 'Elder',
    representative: 'Representative',
    leader: 'Leader',
  });
  var DAY_MS = 24 * 60 * 60 * 1000;
  var VALID_WINDOW_MS = 30 * DAY_MS;
  var REMAINDER_DEFINITION = 'MEMBERS_OUTSIDE_LEADER_REPRESENTATIVE_ELDER_SEATS';

  function describeScore(input) {
    var src = input || {};
    return {
      formulaStatus: FORMULA_STATUS,
      reasons: ['FAME_OVERLAP_CORRECTION_UNCONFIRMED', 'NORMALIZATION_FORMULA_UNCONFIRMED'],
      weights: {
        fame: WEIGHTS.fame,
        uniquePositiveEvaluators: WEIGHTS.uniquePositiveEvaluators,
        evaluationReactions: WEIGHTS.evaluationReactions,
        followers: WEIGHTS.followers,
      },
      inputs: {
        fame: src.fame != null ? src.fame : null,
        cumulativeFame: src.cumulativeFame != null ? src.cumulativeFame : null,
        recent90DayEvaluation: src.recent90DayEvaluation != null ? src.recent90DayEvaluation : null,
        uniquePositiveEvaluators:
          src.uniquePositiveEvaluators != null ? src.uniquePositiveEvaluators : null,
        evaluationReactions: src.evaluationReactions != null ? src.evaluationReactions : null,
        followers: src.followers != null ? src.followers : null,
      },
      combinedScore: null,
    };
  }

  function firstQualificationThreshold(rankKey, territoryPopulation) {
    var floors = { debater: 10, elder: 50, representative: 100 };
    var ratios = { debater: 0.02, elder: 0.05, representative: 0.1 };
    if (!floors[rankKey]) {
      return { ok: false, reason: 'RANK_HAS_NO_FIRST_QUALIFICATION', threshold: null };
    }
    if (territoryPopulation == null || territoryPopulation === '') {
      return { ok: false, reason: 'TERRITORY_POPULATION_REQUIRED', threshold: null };
    }
    var pop = Number(territoryPopulation);
    if (!isFinite(pop) || pop < 0) {
      return { ok: false, reason: 'TERRITORY_POPULATION_REQUIRED', threshold: null };
    }
    return {
      ok: true,
      rankKey: rankKey,
      threshold: Math.max(floors[rankKey], Math.ceil(pop * ratios[rankKey])),
    };
  }

  function countValidPopulation(input) {
    var src = input || {};
    var asOf = Number(src.asOfMs);
    if (src.asOfMs == null || !isFinite(asOf)) {
      return { ok: false, reason: 'CLOCK_REQUIRED', count: null };
    }
    var country = String(src.country || '');
    var territory = String(src.territory || '');
    if (country !== 'KR' && country !== 'US') {
      return { ok: false, reason: 'COUNTRY_REQUIRED', count: null };
    }
    if (!territory) return { ok: false, reason: 'TERRITORY_REQUIRED', count: null };
    var seen = Object.create(null);
    var records = Array.isArray(src.records) ? src.records : [];
    var i;
    for (i = 0; i < records.length; i++) {
      var rec = records[i] || {};
      if (String(rec.country || '') !== country) continue;
      if (String(rec.territory || '') !== territory) continue;
      if (rec.valid !== true) continue;
      var id = String(rec.id || '').trim();
      if (!id || seen[id]) continue;
      var recent = false;
      var post = rec.lastPostAtMs != null ? Number(rec.lastPostAtMs) : null;
      var comment = rec.lastCommentAtMs != null ? Number(rec.lastCommentAtMs) : null;
      if (post != null && isFinite(post) && post <= asOf && asOf - post <= VALID_WINDOW_MS) recent = true;
      if (comment != null && isFinite(comment) && comment <= asOf && asOf - comment <= VALID_WINDOW_MS) {
        recent = true;
      }
      if (recent) seen[id] = true;
    }
    return { ok: true, count: Object.keys(seen).length, country: country, territory: territory };
  }

  function leaderElectionOpen(validPopulation) {
    var n = Number(validPopulation);
    if (!isFinite(n) || n < 0) return { ok: false, open: false, reason: 'VALID_POPULATION_REQUIRED' };
    return { ok: true, open: n >= 1000, minimum: 1000 };
  }

  function isRefreshClock(clock) {
    var c = clock || {};
    return c.weekday === 'WEDNESDAY' && Number(c.hour) === 0 && Number(c.minute) === 0;
  }

  function meetsFirst(member, rankKey, territoryPopulation) {
    var used = member.firstQualificationUsed || {};
    if (used[rankKey] === true) return true;
    var current = RANK_ORDER[member.currentRank] || 0;
    if (current >= RANK_ORDER[rankKey]) return true;
    var th = firstQualificationThreshold(rankKey, territoryPopulation);
    if (!th.ok) return false;
    var got = Number(member.uniquePositiveEvaluators);
    return isFinite(got) && got >= th.threshold;
  }

  function byScore(a, b) {
    if (a.comparisonScore !== b.comparisonScore) return b.comparisonScore - a.comparisonScore;
    return String(a.id).localeCompare(String(b.id));
  }

  function fillSeats(sorted, cap, rankKey) {
    var chosen = [];
    var i = 0;
    while (i < sorted.length && chosen.length < cap) {
      var score = sorted[i].comparisonScore;
      var j = i + 1;
      while (j < sorted.length && sorted[j].comparisonScore === score) j += 1;
      var group = sorted.slice(i, j);
      var seatsLeft = cap - chosen.length;
      if (group.length <= seatsLeft) {
        chosen = chosen.concat(group);
      } else {
        var incumbents = group.filter(function (p) {
          return p.currentRank === rankKey;
        });
        incumbents.sort(function (a, b) {
          return String(a.id).localeCompare(String(b.id));
        });
        var keep = incumbents.slice(0, seatsLeft);
        chosen = chosen.concat(keep);
      }
      i = j;
    }
    return chosen;
  }

  function idSet(list) {
    var set = Object.create(null);
    list.forEach(function (p) {
      set[p.id] = true;
    });
    return set;
  }

  function applyWeeklyRanks(input) {
    var src = input || {};
    var country = String(src.country || '');
    var territory = String(src.territory || '');
    if (country !== 'KR' && country !== 'US') {
      return { ok: false, applied: false, reason: 'COUNTRY_REQUIRED', formulaStatus: FORMULA_STATUS };
    }
    if (!territory) {
      return { ok: false, applied: false, reason: 'TERRITORY_REQUIRED', formulaStatus: FORMULA_STATUS };
    }
    var raw = Array.isArray(src.members) ? src.members : [];
    var members = [];
    var seen = Object.create(null);
    var i;
    for (i = 0; i < raw.length; i++) {
      var row = raw[i] || {};
      var id = String(row.id || '').trim();
      if (!id || seen[id]) {
        return { ok: false, applied: false, reason: 'MEMBER_ID_INVALID', formulaStatus: FORMULA_STATUS };
      }
      if (String(row.country || country) !== country || String(row.territory || territory) !== territory) {
        return { ok: false, applied: false, reason: 'COUNTRY_OR_TERRITORY_MIXED', formulaStatus: FORMULA_STATUS };
      }
      seen[id] = true;
      members.push({
        id: id,
        country: country,
        territory: territory,
        currentRank: RANK_ORDER[row.currentRank] ? row.currentRank : null,
        uniquePositiveEvaluators: row.uniquePositiveEvaluators,
        firstQualificationUsed: row.firstQualificationUsed || {},
        electedLeader: row.electedLeader === true,
        comparisonScore:
          row.comparisonScore != null && isFinite(Number(row.comparisonScore))
            ? Number(row.comparisonScore)
            : null,
      });
    }

    if (!isRefreshClock(src.clock) || src.refreshComplete !== true) {
      return {
        ok: true,
        applied: false,
        reason: 'NOT_REFRESH_MOMENT',
        formulaStatus: FORMULA_STATUS,
        country: country,
        territory: territory,
        assignments: members.map(function (m) {
          return { id: m.id, rank: m.currentRank, previousRank: m.currentRank, changed: false };
        }),
      };
    }

    var leaderSeat = territory === 'pioneer' || territory === 'guardian';
    var leaderId = null;
    var leaderWarning = null;
    if (leaderSeat) {
      var elected = members.filter(function (m) {
        return m.electedLeader;
      });
      if (elected.length === 1) leaderId = elected[0].id;
      else if (elected.length > 1) {
        var sitting = elected.filter(function (m) {
          return m.currentRank === 'leader';
        });
        if (sitting.length === 1) leaderId = sitting[0].id;
        else leaderWarning = 'MULTIPLE_ELECTED_UNRESOLVED';
      }
    }

    var pop = src.territoryPopulation;
    function pool(excluded, rankKey) {
      return members
        .filter(function (m) {
          return !excluded[m.id] && m.comparisonScore != null && meetsFirst(m, rankKey, pop);
        })
        .sort(byScore);
    }

    var leaderSet = Object.create(null);
    if (leaderId) leaderSet[leaderId] = true;
    var representatives = fillSeats(pool(leaderSet, 'representative'), 10, 'representative');
    var repSet = idSet(representatives);
    var blockedElder = Object.create(null);
    if (leaderId) blockedElder[leaderId] = true;
    Object.keys(repSet).forEach(function (id) {
      blockedElder[id] = true;
    });
    var elders = fillSeats(pool(blockedElder, 'elder'), 50, 'elder');
    var elderSet = idSet(elders);
    var remainder = members.filter(function (m) {
      return m.id !== leaderId && !repSet[m.id] && !elderSet[m.id];
    });
    var debaterCap = Math.floor(remainder.length * 0.3);
    var debaters = fillSeats(
      remainder
        .filter(function (m) {
          return m.comparisonScore != null && meetsFirst(m, 'debater', pop);
        })
        .sort(byScore),
      debaterCap,
      'debater',
    );
    var debaterSet = idSet(debaters);

    function rankOf(id) {
      if (id === leaderId) return 'leader';
      if (repSet[id]) return 'representative';
      if (elderSet[id]) return 'elder';
      if (debaterSet[id]) return 'debater';
      return 'citizen';
    }

    var counts = { citizen: 0, debater: 0, elder: 0, representative: 0, leader: 0 };
    var assignments = members.map(function (m) {
      var rank = rankOf(m.id);
      counts[rank] += 1;
      return {
        id: m.id,
        rank: rank,
        previousRank: m.currentRank,
        changed: m.currentRank !== rank,
      };
    });

    return {
      ok: true,
      applied: true,
      reason: leaderWarning,
      formulaStatus: FORMULA_STATUS,
      remainderDefinition: REMAINDER_DEFINITION,
      country: country,
      territory: territory,
      assignments: assignments,
      counts: counts,
      unfilled: {
        leader: leaderSeat && !leaderId ? 1 : 0,
        representative: Math.max(0, 10 - representatives.length),
        elder: Math.max(0, 50 - elders.length),
        debater: Math.max(0, debaterCap - debaters.length),
      },
    };
  }

  return {
    FORMULA_STATUS: FORMULA_STATUS,
    WEIGHTS: WEIGHTS,
    LABELS_KO: LABELS_KO,
    LABELS_EN_TEMPORARY: LABELS_EN_TEMPORARY,
    EN_OFFICIAL_LABELS: null,
    REMAINDER_DEFINITION: REMAINDER_DEFINITION,
    describeScore: describeScore,
    firstQualificationThreshold: firstQualificationThreshold,
    countValidPopulation: countValidPopulation,
    leaderElectionOpen: leaderElectionOpen,
    applyWeeklyRanks: applyWeeklyRanks,
  };
});
