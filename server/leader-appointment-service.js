/**
 * 개발용 단독 당선 임명과 탄핵 뒤 계급.
 * 접수 종료, 유효 후보 1명, 현재 대표, 공석, 같은 회차 임명 기록 없음일 때만 직위를 저장한다.
 * 복수 후보의 leader_election_48h 가 정상 종료되고, 저장된 최다 득표자가 정확히 한 명일 때도 같은 저장을 쓴다.
 * 동률과 0표는 당선자를 만들지 않는다. 동률 해소와 시즌 종료 자동화는 하지 않는다.
 * officeGranted 는 그 저장이 성공한 뒤에만 true 다.
 * 수요일 00:00 의 시간대는 정하지 않는다. 비교 점수는 만들지 않는다.
 * 임명 시각은 그 보궐 회차에 저장된 filingStartMs, filingEndMs 만 본다.
 * 여러 JSON 파일은 프로세스가 중간에 죽으면 하나의 트랜잭션이 아니다.
 * 다음 호출이 어긋난 직위·계급·당선 기록을 찾아 되돌린다.
 * 직위·계급·선거가 이미 같은 당선자를 기록했는데 보궐 실행 파일만 늦으면, 그 실행 기록만 맞춘다.
 * 그 경우 이미 저장된 지도자를 다시 임명하거나 다른 사람으로 바꾸지 않는다.
 * JSON 잠금은 단일 프로세스다. 운영 DB의 고유 제약은 적용하지 않는다.
 */
'use strict';

const fs = require('fs');
const election = require('./leader-election-service');
const filing = require('./leader-filing-service');
const vacancy = require('./impeachment-vacancy-service');
const roster = require('./rep-impeach-vote-roster');
const rank = require('../shared/dec023-rank-evaluation-core');

const tails = new Map();

function withLock(key, fn) {
  const prev = tails.get(key) || Promise.resolve();
  let release;
  const gate = new Promise(function (resolve) { release = resolve; });
  tails.set(key, gate);
  return prev.then(function () {
    return Promise.resolve().then(fn).then(function (value) {
      release();
      return value;
    }, function (err) {
      release();
      throw err;
    });
  });
}

function emptyRankStore() {
  return { members: [], appointments: [], relinquishments: [], refreshes: [] };
}

function readRankStore(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return emptyRankStore();
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return {
    members: Array.isArray(parsed.members) ? parsed.members : [],
    appointments: Array.isArray(parsed.appointments) ? parsed.appointments : [],
    relinquishments: Array.isArray(parsed.relinquishments) ? parsed.relinquishments : [],
    refreshes: Array.isArray(parsed.refreshes) ? parsed.refreshes : [],
  };
}

function writeRankStore(filePath, store) {
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2));
  return store;
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function clockNow(input) {
  const src = input || {};
  if (src.clockSource === 'test-fixture' && isFinite(Number(src.nowMs))) return Number(src.nowMs);
  return Date.now();
}

function findOffice(store, country, territory) {
  return (store.offices || []).filter(function (row) {
    return row.country === country && row.territory === territory;
  })[0] || null;
}

function membersIn(store, country, territory) {
  return store.members.filter(function (row) {
    return row.country === country && row.territory === territory;
  });
}

function findMember(store, id, country, territory) {
  return store.members.filter(function (row) {
    return row.id === id && row.country === country && row.territory === territory;
  })[0] || null;
}

function representativeIds(store, country, territory) {
  return membersIn(store, country, territory).filter(function (row) {
    return row.rank === 'representative';
  }).map(function (row) { return row.id; });
}

function leaderIds(store, country, territory) {
  return membersIn(store, country, territory).filter(function (row) {
    return row.rank === 'leader';
  }).map(function (row) { return row.id; });
}

function preservedStats(member) {
  if (!member) return null;
  return {
    xp: member.xp,
    fame: member.fame,
    activity: member.activity,
    achievements: member.achievements,
  };
}

function sameStats(member, prior) {
  if (!member || !prior) return false;
  return member.xp === prior.xp && member.fame === prior.fame && member.activity === prior.activity
    && JSON.stringify(member.achievements) === JSON.stringify(prior.achievements);
}

function scopePack(rankStore, office) {
  const country = office ? office.country : null;
  const territory = office ? office.territory : null;
  return {
    office: office,
    representativeIds: country ? representativeIds(rankStore, country, territory) : [],
    leaderIds: country ? leaderIds(rankStore, country, territory) : [],
    representativeQuota: 10,
    leaderQuota: 1,
    leaderInsideRepresentativeQuota: false,
    productionAuth: false,
    lock: 'single-process',
    multiFileTransaction: false,
    timezone: 'UNCONFIRMED',
    formulaStatus: rank.FORMULA_STATUS,
  };
}

function validCandidates(electionStore, filingStore, country, territory, filingRoundId) {
  const names = roster.representatives({ country: country, territory: territory, authKind: 'test-fixture' });
  if (!names.ok) return { ok: false, reason: names.reason, ids: [] };
  const ids = [];
  (electionStore.reviews || []).forEach(function (review) {
    if (review.filingRoundId !== filingRoundId) return;
    if (review.status !== 'approved' || review.registrationClosed !== true) return;
    const candidacy = (filingStore.candidacies || []).filter(function (row) { return row.id === review.candidacyId; })[0];
    if (!candidacy || candidacy.status === 'withdrawn' || candidacy.withdrawn === true) return;
    if (names.ids.indexOf(String(candidacy.actorId)) < 0) return;
    ids.push(String(candidacy.actorId));
  });
  return { ok: true, ids: ids };
}

function deny(reason, ignored) {
  return {
    ok: false,
    reason: reason,
    dirty: false,
    officeGranted: false,
    clientWinnerIgnored: ignored,
    multiFileTransaction: false,
    lock: 'single-process',
  };
}

function runsOf(runStore) {
  return runStore && Array.isArray(runStore.runs) ? runStore.runs : [];
}

function uncheckedRead(reason) {
  return {
    checked: false,
    readOnly: true,
    appointedByThisRead: false,
    officeGranted: false,
    appointmentComplete: false,
    recoveryNeeded: false,
    multiFileTransaction: false,
    appointmentCheck: reason || 'STORES_NOT_CHECKED',
  };
}

function loadAppointmentRead(electionStore, paths, filingRoundId) {
  if (!paths || !paths.vacancy || !paths.rank || !paths.run) return uncheckedRead('STORES_NOT_CHECKED');
  if (!filingRoundId) return uncheckedRead('STORES_NOT_CHECKED');
  try {
    if (!fs.existsSync(paths.vacancy) || !fs.existsSync(paths.rank) || !fs.existsSync(paths.run)) {
      return uncheckedRead('STORE_READ_ERROR');
    }
    const vacancyStore = vacancy.readStore(paths.vacancy);
    const rankStore = readRankStore(paths.rank);
    const runStore = JSON.parse(fs.readFileSync(paths.run, 'utf8'));
    if (!runStore || !Array.isArray(runStore.runs)) return uncheckedRead('STORE_READ_ERROR');
    return describeAppointmentRead(vacancyStore, electionStore, rankStore, runStore, filingRoundId);
  } catch (err) {
    return uncheckedRead('STORE_READ_ERROR');
  }
}

function describeAppointmentRead(vacancyStore, electionStore, rankStore, runStore, filingRoundId) {
  const row = (electionStore.elections || []).filter(function (item) { return item.filingRoundId === filingRoundId; })[0];
  const base = {
    checked: true,
    readOnly: true,
    appointedByThisRead: false,
    officeGranted: false,
    appointmentComplete: false,
    recoveryNeeded: false,
    multiFileTransaction: false,
  };
  if (!row) return Object.assign(base, { appointmentCheck: 'ELECTION_NOT_STORED' });
  const appointment = (rankStore.appointments || []).filter(function (item) { return item.filingRoundId === filingRoundId; })[0];
  const office = findOffice(vacancyStore, row.country, row.territory);
  const run = runsOf(runStore).filter(function (item) { return item.filingRoundId === filingRoundId; })[0];
  const storedWinner = appointment ? String(appointment.winnerId) : '';
  const member = storedWinner ? findMember(rankStore, storedWinner, row.country, row.territory) : null;
  const parts = {
    electionOfficeGranted: row.officeGranted === true,
    winnerId: row.winnerId || null,
    officeStatus: office ? office.status : null,
    officeLeaderId: office ? office.leaderId || null : null,
    rank: member ? member.rank : null,
    appointmentOfficeGranted: !!(appointment && appointment.officeGranted === true),
    appointmentWinnerId: appointment ? appointment.winnerId : null,
    runOfficeGranted: !!(run && run.officeGranted === true),
    runAppointment: !!(run && run.appointment === true),
  };
  const voteClosed = row.status === 'closed';
  const complete = parts.electionOfficeGranted && appointment && parts.appointmentOfficeGranted
    && office && office.status === 'sitting' && String(office.leaderId || '') === storedWinner
    && String(row.winnerId || '') === storedWinner
    && member && member.id === storedWinner && member.rank === 'leader'
    && parts.runOfficeGranted && parts.runAppointment;
  if (complete) {
    return Object.assign(base, {
      appointmentCheck: 'APPOINTMENT_COMPLETE',
      appointmentComplete: true,
      officeGranted: true,
      winnerId: storedWinner,
      voteClosed: voteClosed,
      parts: parts,
    });
  }
  const lag = parts.electionOfficeGranted && appointment && parts.appointmentOfficeGranted
    && office && office.status === 'sitting' && String(office.leaderId || '') === storedWinner
    && String(row.winnerId || '') === storedWinner
    && member && member.rank === 'leader'
    && run && (!parts.runOfficeGranted || !parts.runAppointment);
  if (lag) {
    return Object.assign(base, {
      appointmentCheck: 'RUN_LAG',
      recoveryNeeded: true,
      voteClosed: voteClosed,
      winnerId: storedWinner,
      parts: parts,
    });
  }
  const cleared = (parts.electionOfficeGranted || parts.appointmentOfficeGranted)
    && (!office || office.status !== 'sitting' || !office.leaderId || !member || member.rank !== 'leader');
  if (cleared) {
    return Object.assign(base, {
      appointmentCheck: 'OFFICE_CLEARED',
      recoveryNeeded: false,
      voteClosed: voteClosed,
      winnerId: row.winnerId || null,
      parts: parts,
    });
  }
  const partial = (office && office.pendingFilingRoundId === filingRoundId && office.status === 'sitting' && row.officeGranted !== true)
    || (member && member.rank === 'leader' && row.officeGranted !== true)
    || (!!appointment && row.officeGranted !== true);
  if (partial) {
    return Object.assign(base, {
      appointmentCheck: 'PARTIAL_STATE',
      recoveryNeeded: true,
      voteClosed: voteClosed,
      winnerId: row.winnerId || storedWinner || null,
      parts: parts,
    });
  }
  if (row.status === 'open' || (row.votesOpened === true && row.status !== 'closed' && row.status !== 'uncontested_recorded')) {
    return Object.assign(base, { appointmentCheck: 'VOTE_OPEN', voteClosed: false, winnerId: null, parts: parts });
  }
  if (!row.winnerId) {
    return Object.assign(base, { appointmentCheck: 'NO_WINNER', voteClosed: voteClosed, winnerId: null, parts: parts });
  }
  return Object.assign(base, {
    appointmentCheck: 'WINNER_NOT_APPOINTED',
    voteClosed: voteClosed,
    winnerId: row.winnerId,
    parts: parts,
  });
}

function recoverPartial(vacancyStore, electionStore, rankStore, runStore, filingRoundId) {
  const row = (electionStore.elections || []).filter(function (item) { return item.filingRoundId === filingRoundId; })[0];
  if (!row) return null;
  const appointment = rankStore.appointments.filter(function (item) { return item.filingRoundId === filingRoundId; })[0];
  const office = findOffice(vacancyStore, row.country, row.territory);
  const winnerId = appointment ? appointment.winnerId : (office && office.pendingFilingRoundId === filingRoundId ? office.leaderId : null);
  const member = winnerId ? findMember(rankStore, winnerId, row.country, row.territory) : null;
  const run = runsOf(runStore).filter(function (item) { return item.filingRoundId === filingRoundId; })[0];
  const round = (electionStore.rounds || []).filter(function (item) { return item.id === filingRoundId; })[0];
  const storedWinner = appointment ? String(appointment.winnerId) : '';
  const threeComplete = row.officeGranted === true && appointment && appointment.officeGranted === true
    && office && office.status === 'sitting' && String(office.leaderId || '') === storedWinner
    && String(row.winnerId || '') === storedWinner
    && member && member.id === storedWinner && member.rank === 'leader';
  const runComplete = !!(run && run.officeGranted === true && run.appointment === true);
  if (threeComplete && runComplete) return null;
  if (threeComplete && run && (run.officeGranted !== true || run.appointment !== true)) {
    const sameWinner = (!run.recordedCandidateId || String(run.recordedCandidateId) === storedWinner)
      && run.country === row.country && run.territory === row.territory
      && round && round.id === filingRoundId
      && (!round.byElectionBallotId || round.byElectionBallotId === run.citizenBallotId)
      && String(office.leaderId || '') === storedWinner;
    if (!sameWinner) {
      return {
        ok: false,
        dirty: false,
        recovered: false,
        reason: 'RUN_RECORD_MISMATCH',
        officeGranted: false,
        grant: false,
        multiFileTransaction: false,
        lock: 'single-process',
      };
    }
    run.officeGranted = true;
    run.appointment = true;
    return {
      ok: true,
      recovered: true,
      runLagRecovered: true,
      dirty: true,
      vacancyDirty: false,
      rankDirty: false,
      electionDirty: false,
      runDirty: true,
      reason: 'RUN_LAG_RECOVERED',
      officeGranted: true,
      grant: false,
      appointment: appointment,
      winnerId: storedWinner,
      replacedLeader: false,
      multiFileTransaction: false,
      lock: 'single-process',
    };
  }
  const pendingOffice = office && office.pendingFilingRoundId === filingRoundId && office.status === 'sitting' && row.officeGranted !== true;
  const pendingMember = member && member.rank === 'leader' && row.officeGranted !== true;
  const pendingRecord = !!appointment && row.officeGranted !== true;
  if (!pendingOffice && !pendingMember && !pendingRecord) return null;
  if (office && (office.pendingFilingRoundId === filingRoundId || (appointment && office.leaderId === appointment.winnerId))) {
    office.status = 'vacant';
    office.leaderId = null;
    office.leaderName = '';
    office.leaderOffice = false;
    delete office.appointedAtMs;
    delete office.vacancyEndedAtMs;
    delete office.pendingFilingRoundId;
  }
  if (member && member.rank === 'leader') {
    member.rank = 'representative';
    member.electedLeader = false;
    member.leaderOffice = false;
    member.excludedFromRepresentativeQuota = false;
  }
  rankStore.appointments = rankStore.appointments.filter(function (item) { return item.filingRoundId !== filingRoundId; });
  row.officeGranted = false;
  runsOf(runStore).forEach(function (run) {
    if (run.filingRoundId === filingRoundId) {
      run.officeGranted = false;
      run.appointment = false;
    }
  });
  return {
    ok: false,
    recovered: true,
    dirty: true,
    vacancyDirty: true,
    rankDirty: true,
    electionDirty: true,
    runDirty: runsOf(runStore).length > 0,
    reason: 'PARTIAL_STATE_RECOVERED',
    officeGranted: false,
    grant: false,
    multiFileTransaction: false,
    lock: 'single-process',
  };
}

function storedPlurality(electionStore, row, run, nowMs) {
  if (!row || !row.ballotId) return { ok: false, reason: 'VOTE_NOT_CLOSED' };
  const ballot = (electionStore.ballots || []).filter(function (item) { return item.id === row.ballotId; })[0];
  if (!ballot) return { ok: false, reason: 'VOTE_NOT_CLOSED' };
  if (ballot.voteKind !== 'leader_election_48h') return { ok: false, reason: 'VOTE_KIND_MISMATCH' };
  if (Number(ballot.endsAtMs) - Number(ballot.startsAtMs) !== 48 * 60 * 60 * 1000) return { ok: false, reason: 'VOTE_KIND_MISMATCH' };
  if (ballot.country !== row.country || ballot.territory !== row.territory) return { ok: false, reason: 'VACANCY_MISMATCH' };
  if (run.country !== row.country || run.territory !== row.territory) return { ok: false, reason: 'VACANCY_MISMATCH' };
  if (ballot.status === 'halted') return { ok: false, reason: 'HALTED' };
  if (ballot.status === 'error') return { ok: false, reason: 'VOTE_ERROR' };
  if (ballot.status !== 'closed' || ballot.closedOnce !== true) {
    return { ok: false, reason: nowMs < Number(ballot.endsAtMs) ? 'VOTE_NOT_ENDED' : 'VOTE_NOT_CLOSED' };
  }
  if (!isFinite(Number(ballot.closedAtMs)) || Number(ballot.closedAtMs) < Number(ballot.endsAtMs) || nowMs < Number(ballot.endsAtMs)) {
    return { ok: false, reason: 'VOTE_NOT_ENDED' };
  }
  const counts = Object.create(null);
  (ballot.candidates || []).forEach(function (candidate) { counts[String(candidate.id)] = 0; });
  (electionStore.votes || []).forEach(function (voteRow) {
    if (voteRow.ballotId === ballot.id && counts[String(voteRow.choice)] != null) counts[String(voteRow.choice)] += 1;
  });
  const ids = Object.keys(counts);
  let top = 0;
  ids.forEach(function (id) { if (counts[id] > top) top = counts[id]; });
  const leaders = ids.filter(function (id) { return counts[id] === top; });
  if (top === 0) {
    return { ok: false, reason: row.winnerId || ballot.winnerId ? 'STORED_RESULT_MISMATCH' : 'ZERO_VOTES' };
  }
  if (leaders.length !== 1) {
    return { ok: false, reason: row.winnerId || ballot.winnerId ? 'STORED_RESULT_MISMATCH' : 'TIE' };
  }
  const winnerId = leaders[0];
  if (ballot.result !== 'plurality' || String(ballot.winnerId || '') !== winnerId || ballot.failReason) {
    return { ok: false, reason: 'STORED_RESULT_MISMATCH' };
  }
  if (row.status !== 'closed' || row.result !== 'plurality' || String(row.winnerId || '') !== winnerId) {
    return { ok: false, reason: 'STORED_RESULT_MISMATCH' };
  }
  return { ok: true, winnerId: winnerId };
}

function appointUnlocked(vacancyStore, electionStore, filingStore, rankStore, runStore, input) {
  const src = input || {};
  const filingRoundId = String(src.filingRoundId || '');
  const nowMs = clockNow(src);
  const ignored = src.winnerId != null || src.officeGranted != null || src.passed != null || src.candidateCount != null || (src.clockSource !== 'test-fixture' && src.nowMs != null);
  const recovered = recoverPartial(vacancyStore, electionStore, rankStore, runStore, filingRoundId);
  if (recovered) {
    recovered.clientWinnerIgnored = ignored;
    return recovered;
  }
  const row = (electionStore.elections || []).filter(function (item) { return item.filingRoundId === filingRoundId; })[0];
  const run = runsOf(runStore).filter(function (item) { return item.filingRoundId === filingRoundId; })[0];
  if (!run) return deny('BY_ELECTION_ROUND_REQUIRED', ignored);
  const removal = (vacancyStore.removals || []).filter(function (item) { return item.citizenBallotId === run.citizenBallotId; })[0];
  if (!removal) return deny('REMOVAL_NOT_STORED', ignored);
  const schedule = (vacancyStore.schedules || []).filter(function (item) { return item.citizenBallotId === run.citizenBallotId; })[0];
  if (!schedule) return deny('SCHEDULE_NOT_STORED', ignored);
  const round = (electionStore.rounds || []).filter(function (item) { return item.id === filingRoundId; })[0];
  if (!round || round.byElectionBallotId !== run.citizenBallotId) return deny('VACANCY_MISMATCH', ignored);
  if (run.country !== removal.country || run.territory !== removal.territory) return deny('VACANCY_MISMATCH', ignored);
  if (schedule.country !== removal.country || schedule.territory !== removal.territory) return deny('VACANCY_MISMATCH', ignored);
  if (schedule.citizenBallotId !== removal.citizenBallotId) return deny('VACANCY_MISMATCH', ignored);
  const office = findOffice(vacancyStore, removal.country, removal.territory);
  if (!office) return deny('OFFICE_NOT_FOUND', ignored);
  if (removal.territory !== 'pioneer' && removal.territory !== 'guardian') return deny('TERRITORY_NOT_ELIGIBLE', ignored);
  const sameScope = (vacancyStore.removals || []).filter(function (item) {
    return item.country === removal.country && item.territory === removal.territory;
  });
  const latest = sameScope.slice().sort(function (a, b) { return Number(a.removedAtMs) - Number(b.removedAtMs); }).pop();
  if (!latest || latest.citizenBallotId !== removal.citizenBallotId) return deny('VACANCY_MISMATCH', ignored);
  if (Number(office.removedAtMs) !== Number(removal.removedAtMs) || Number(office.vacancyStartMs) !== Number(removal.vacancyStartMs)) {
    return deny('VACANCY_MISMATCH', ignored);
  }
  if (!isFinite(Number(run.filingStartMs)) || !isFinite(Number(run.filingEndMs))) return deny('ROUND_WINDOW_REQUIRED', ignored);
  if (nowMs < Number(run.filingStartMs)) return deny('VACANCY_WINDOW', ignored);
  if (nowMs < Number(run.filingEndMs)) return deny('FILING_STILL_OPEN', ignored);
  const superseded = runsOf(runStore).some(function (item) {
    return item.citizenBallotId === run.citizenBallotId && item.parentFilingRoundId === filingRoundId;
  });
  if (superseded) return deny('SUPERSEDED_ROUND', ignored);
  if (run.status === 'weekly_refiling_waiting' || (row && row.status === 'weekly_refiling_waiting')) return deny('NOT_SOLE_ROUND', ignored);
  let pluralityWinner = null;
  const voteRound = run.status === 'vote_open' || run.votesOpened === true || !!(row && (row.ballotId || row.status === 'open' || row.votesOpened === true));
  if (voteRound) {
    const decision = storedPlurality(electionStore, row, run, nowMs);
    if (!decision.ok) return deny(decision.reason, ignored);
    pluralityWinner = decision.winnerId;
  } else if (!row || run.status !== 'uncontested_recorded' || row.status !== 'uncontested_recorded' || row.votesOpened === true || row.ballotId) {
    return deny('UNCONTESTED_REQUIRED', ignored);
  }
  if (row.country !== removal.country || row.territory !== removal.territory) return deny('VACANCY_MISMATCH', ignored);
  const country = row.country;
  const territory = row.territory;
  if (territory !== 'pioneer' && territory !== 'guardian') return deny('TERRITORY_NOT_ELIGIBLE', ignored);
  if (round.status !== 'election_opened' && round.status !== 'registration_closed') return deny('REGISTRATION_NOT_CLOSED', ignored);
  const priorAppointment = rankStore.appointments.filter(function (item) { return item.filingRoundId === filingRoundId; })[0];
  if (priorAppointment) {
    return {
      ok: false,
      reason: 'APPOINTMENT_EXISTS',
      dirty: false,
      officeGranted: row.officeGranted === true,
      appointment: priorAppointment,
      clientWinnerIgnored: ignored,
      multiFileTransaction: false,
      lock: 'single-process',
    };
  }
  if (office.status !== 'vacant' || office.leaderId) {
    return { ok: false, reason: 'OFFICE_NOT_VACANT', dirty: false, officeGranted: false, clientWinnerIgnored: ignored };
  }
  if (leaderIds(rankStore, country, territory).length > 0) {
    return { ok: false, reason: 'LEADER_EXISTS', dirty: false, officeGranted: false, clientWinnerIgnored: ignored };
  }
  const candidates = validCandidates(electionStore, filingStore, country, territory, filingRoundId);
  if (!candidates.ok) return Object.assign(candidates, { dirty: false, officeGranted: false, clientWinnerIgnored: ignored });
  const winnerId = pluralityWinner || String(row.winnerId || '');
  if (pluralityWinner) {
    if (candidates.ids.indexOf(pluralityWinner) < 0) return deny('NOT_REPRESENTATIVE', ignored);
  } else if (candidates.ids.length !== 1 || candidates.ids[0] !== winnerId) {
    return { ok: false, reason: 'NOT_EXACTLY_ONE', dirty: false, officeGranted: false, clientWinnerIgnored: ignored };
  }
  const member = findMember(rankStore, winnerId, country, territory);
  if (!member || member.rank !== 'representative') {
    return { ok: false, reason: 'NOT_REPRESENTATIVE', dirty: false, officeGranted: false, clientWinnerIgnored: ignored };
  }
  const stats = preservedStats(member);
  member.rank = 'leader';
  member.electedLeader = true;
  member.excludedFromRepresentativeQuota = true;
  member.leaderOffice = true;
  member.xp = stats.xp;
  member.fame = stats.fame;
  member.activity = stats.activity;
  member.achievements = stats.achievements;
  const appointment = {
    id: 'appt-' + filingRoundId,
    winnerId: member.id,
    country: country,
    territory: territory,
    filingRoundId: filingRoundId,
    citizenBallotId: removal.citizenBallotId,
    office: 'leader',
    rank: 'leader',
    excludedFromRepresentativeQuota: true,
    appointedAtMs: nowMs,
    vacancyEndedAtMs: nowMs,
    officeGranted: false,
  };
  rankStore.appointments.push(appointment);
  office.status = 'sitting';
  office.leaderId = member.id;
  office.leaderName = row.winnerName || member.id;
  office.appointedAtMs = nowMs;
  office.vacancyEndedAtMs = nowMs;
  office.leaderOffice = true;
  office.pendingFilingRoundId = filingRoundId;
  row.officeGranted = false;
  if (runStore && Array.isArray(runStore.runs)) {
    runStore.runs.forEach(function (run) {
      if (run.filingRoundId === filingRoundId) run.officeGranted = false;
    });
  }
  return {
    ok: true,
    dirty: true,
    vacancyDirty: true,
    rankDirty: true,
    electionDirty: true,
    runDirty: !!(runStore && Array.isArray(runStore.runs)),
    appointment: appointment,
    member: member,
    office: office,
    election: row,
    clientWinnerIgnored: ignored,
    officeGranted: false,
    grant: true,
    immediateFill: false,
    multiFileTransaction: false,
    lock: 'single-process',
  };
}

function markGranted(electionStore, rankStore, runStore, filingRoundId) {
  const row = (electionStore.elections || []).filter(function (item) { return item.filingRoundId === filingRoundId; })[0];
  const appointment = rankStore.appointments.filter(function (item) { return item.filingRoundId === filingRoundId; })[0];
  if (row) row.officeGranted = true;
  if (appointment) appointment.officeGranted = true;
  if (runStore && Array.isArray(runStore.runs)) {
    runStore.runs.forEach(function (run) {
      if (run.filingRoundId === filingRoundId) {
        run.officeGranted = true;
        run.appointment = true;
      }
    });
  }
}

function linkRelinquishment(rankStore, leaderId, country, territory, ballotId, nowMs) {
  const member = findMember(rankStore, leaderId, country, territory);
  const stats = preservedStats(member);
  const others = membersIn(rankStore, country, territory).filter(function (row) { return row.id !== leaderId; })
    .map(function (row) { return { id: row.id, rank: row.rank, xp: row.xp, fame: row.fame, activity: row.activity, achievements: row.achievements }; });
  if (member) {
    member.rank = 'citizen';
    member.electedLeader = false;
    member.leaderOffice = false;
    member.excludedFromRepresentativeQuota = false;
    member.temporaryCitizen = true;
    member.returnedToRepresentative = false;
    member.xp = stats.xp;
    member.fame = stats.fame;
    member.activity = stats.activity;
    member.achievements = stats.achievements;
  }
  rankStore.relinquishments.push({
    citizenBallotId: ballotId,
    memberId: leaderId,
    country: country,
    territory: territory,
    rank: 'citizen',
    appliedAtMs: nowMs,
    autoReturnRepresentative: false,
  });
  return { member: member, others: others, stats: stats };
}

function relinquishUnlocked(vacancyStore, citizenStore, rankStore, input) {
  const src = input || {};
  const ballotId = String(src.ballotId || '');
  const nowMs = clockNow(src);
  const applied = vacancy.applyRemoval(vacancyStore, citizenStore, { ballotId: ballotId, nowMs: nowMs });
  if (!applied.ok) {
    if (applied.reason !== 'REMOVAL_EXISTS') {
      return Object.assign(applied, { dirty: false, officeGranted: false });
    }
    const prior = rankStore.relinquishments.filter(function (row) { return row.citizenBallotId === ballotId; })[0];
    const removal = (vacancyStore.removals || []).filter(function (row) { return row.citizenBallotId === ballotId; })[0];
    if (!prior || !removal) return Object.assign(applied, { dirty: false, officeGranted: false });
    return {
      ok: true,
      alreadyApplied: true,
      dirty: false,
      officeGranted: false,
      member: findMember(rankStore, removal.leaderId, removal.country, removal.territory),
      office: findOffice(vacancyStore, removal.country, removal.territory),
      schedule: (vacancyStore.schedules || []).filter(function (row) { return row.citizenBallotId === ballotId; })[0] || null,
      removal: removal,
    };
  }
  const linked = linkRelinquishment(rankStore, applied.removal.leaderId, applied.removal.country, applied.removal.territory, ballotId, nowMs);
  return {
    ok: true,
    dirty: true,
    vacancyDirty: true,
    rankDirty: true,
    electionDirty: false,
    runDirty: false,
    alreadyApplied: false,
    officeGranted: false,
    member: linked.member,
    othersBefore: linked.others,
    statsBefore: linked.stats,
    office: applied.office,
    removal: applied.removal,
    schedule: applied.schedule,
    autoReturnRepresentative: false,
  };
}

function refreshUnlocked(rankStore, input) {
  const src = input || {};
  const country = String(src.country || '');
  const territory = String(src.territory || '');
  const clock = src.clock || {};
  if (clock.weekday == null || clock.hour == null || clock.minute == null) {
    return { ok: false, reason: 'TIMEZONE_UNCONFIRMED', dirty: false, applied: false, timezone: 'UNCONFIRMED', formulaStatus: rank.FORMULA_STATUS };
  }
  const scoped = membersIn(rankStore, country, territory);
  const evaluated = rank.applyWeeklyRanks({
    country: country,
    territory: territory,
    clock: { weekday: clock.weekday, hour: Number(clock.hour), minute: Number(clock.minute) },
    refreshComplete: src.refreshComplete === true,
    territoryPopulation: src.territoryPopulation,
    members: scoped.map(function (row) {
      return {
        id: row.id,
        country: row.country,
        territory: row.territory,
        currentRank: row.rank,
        uniquePositiveEvaluators: row.uniquePositiveEvaluators,
        firstQualificationUsed: row.firstQualificationUsed || {},
        electedLeader: row.electedLeader === true,
        comparisonScore: row.comparisonScore != null && isFinite(Number(row.comparisonScore)) ? Number(row.comparisonScore) : null,
      };
    }),
  });
  if (!evaluated.ok) return Object.assign(evaluated, { dirty: false, timezone: 'UNCONFIRMED' });
  if (evaluated.applied !== true) {
    return {
      ok: true,
      applied: false,
      dirty: false,
      reason: evaluated.reason,
      timezone: 'UNCONFIRMED',
      formulaStatus: rank.FORMULA_STATUS,
      scoredByThisService: false,
    };
  }
  const byId = Object.create(null);
  evaluated.assignments.forEach(function (row) { byId[row.id] = row; });
  scoped.forEach(function (member) {
    const next = byId[member.id];
    if (!next) return;
    const stats = preservedStats(member);
    member.rank = next.rank;
    member.electedLeader = next.rank === 'leader';
    member.leaderOffice = next.rank === 'leader';
    member.excludedFromRepresentativeQuota = next.rank === 'leader';
    member.xp = stats.xp;
    member.fame = stats.fame;
    member.activity = stats.activity;
    member.achievements = stats.achievements;
  });
  rankStore.refreshes.push({
    country: country,
    territory: territory,
    weekday: clock.weekday,
    hour: Number(clock.hour),
    minute: Number(clock.minute),
    timezone: 'UNCONFIRMED',
    formulaStatus: rank.FORMULA_STATUS,
    scoredByThisService: false,
  });
  return {
    ok: true,
    applied: true,
    dirty: true,
    rankDirty: true,
    vacancyDirty: false,
    electionDirty: false,
    runDirty: false,
    assignments: evaluated.assignments,
    counts: evaluated.counts,
    unfilled: evaluated.unfilled,
    timezone: 'UNCONFIRMED',
    formulaStatus: rank.FORMULA_STATUS,
    scoredByThisService: false,
  };
}

function snapshot(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

function restore(filePath, raw) {
  if (!filePath) return;
  if (raw == null) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return;
  }
  fs.writeFileSync(filePath, raw);
}

function persist(paths, lockKey, options, mutate) {
  const opts = options || {};
  return withLock(lockKey, function () {
    const vacancyStore = vacancy.readStore(paths.vacancy);
    const electionStore = election.readStore(paths.election);
    const filingStore = filing.readStore(paths.filing);
    const rankStore = readRankStore(paths.rank);
    const runStore = paths.run ? readJson(paths.run) : null;
    const citizenStore = paths.citizen && fs.existsSync(paths.citizen) ? readJson(paths.citizen) : { ballots: [] };
    const before = {
      vacancy: snapshot(paths.vacancy),
      election: snapshot(paths.election),
      rank: snapshot(paths.rank),
      run: snapshot(paths.run),
    };
    const result = mutate(vacancyStore, electionStore, filingStore, rankStore, runStore, citizenStore);
    if (!result || result.dirty !== true) return result;
    const wrote = [];
    function undo() {
      wrote.slice().reverse().forEach(function (name) { restore(paths[name], before[name]); });
    }
    try {
      if (opts.failBeforeWrite === true) throw new Error('APPOINTMENT_STORE_WRITE_FAILED');
      if (result.filingRoundId) markGranted(electionStore, rankStore, runStore, result.filingRoundId);
      if (result.vacancyDirty === true) {
        vacancy.writeStore(paths.vacancy, vacancyStore);
        wrote.push('vacancy');
      }
      if (opts.failAfterOffice === true) throw new Error('APPOINTMENT_STORE_WRITE_FAILED');
      if (opts.crashAfterOffice === true) {
        return {
          ok: false,
          reason: 'PARTIAL_WRITE',
          partialWriteLeft: true,
          applied: false,
          officeGranted: false,
          multiFileTransaction: false,
          lock: 'single-process',
          productionAuth: false,
        };
      }
      if (result.rankDirty === true) {
        writeRankStore(paths.rank, rankStore);
        wrote.push('rank');
      }
      if (opts.failBeforeGrant === true) throw new Error('APPOINTMENT_STORE_WRITE_FAILED');
      if (opts.crashBeforeGrant === true) {
        return {
          ok: false,
          reason: 'PARTIAL_WRITE',
          partialWriteLeft: true,
          applied: false,
          officeGranted: false,
          multiFileTransaction: false,
          lock: 'single-process',
          productionAuth: false,
        };
      }
      if (result.electionDirty === true) {
        election.writeStore(paths.election, electionStore);
        wrote.push('election');
        if (result.rankDirty === true) writeRankStore(paths.rank, rankStore);
      }
      if (opts.crashBeforeRun === true) {
        return {
          ok: false,
          reason: 'PARTIAL_WRITE',
          partialWriteLeft: true,
          stoppedBeforeRun: true,
          applied: false,
          officeGranted: false,
          multiFileTransaction: false,
          lock: 'single-process',
          productionAuth: false,
        };
      }
      if (opts.failRecoveryWrite === true && result.recovered === true) throw new Error('APPOINTMENT_STORE_WRITE_FAILED');
      if (result.runDirty === true && paths.run && runStore) {
        fs.writeFileSync(paths.run, JSON.stringify(runStore, null, 2));
        wrote.push('run');
      }
    } catch (err) {
      undo();
      return {
        ok: false,
        reason: 'APPOINTMENT_STORE_WRITE_FAILED',
        applied: false,
        officeGranted: false,
        multiFileTransaction: false,
        productionAuth: false,
        lock: 'single-process',
      };
    }
    if (result.grant === true && result.appointment) result.appointment.officeGranted = true;
    result.officeGranted = result.grant === true || result.runLagRecovered === true;
    result.multiFileTransaction = false;
    result.productionAuth = false;
    result.lock = 'single-process';
    return result;
  });
}

function appointAndPersist(paths, input, options) {
  const src = input || {};
  const opts = options || {};
  const allowFail = src.clockSource === 'test-fixture';
  return persist(paths, 'leader-office', {
    failBeforeWrite: allowFail && opts.failBeforeWrite === true,
    failAfterOffice: allowFail && opts.failAfterOffice === true,
    failBeforeGrant: allowFail && opts.failBeforeGrant === true,
    crashAfterOffice: allowFail && opts.crashAfterOffice === true,
    crashBeforeGrant: allowFail && opts.crashBeforeGrant === true,
    crashBeforeRun: allowFail && opts.crashBeforeRun === true,
    failRecoveryWrite: allowFail && opts.failRecoveryWrite === true,
  }, function (vacancyStore, electionStore, filingStore, rankStore, runStore) {
    const result = appointUnlocked(vacancyStore, electionStore, filingStore, rankStore, runStore, src);
    if (result && result.grant === true) result.filingRoundId = String(src.filingRoundId || '');
    return result;
  });
}

function relinquishAndPersist(paths, input, options) {
  const src = input || {};
  const opts = options || {};
  const allowFail = src.clockSource === 'test-fixture';
  return persist(paths, 'leader-office', {
    failBeforeWrite: allowFail && opts.failBeforeWrite === true,
    failAfterOffice: allowFail && opts.failAfterOffice === true,
  }, function (vacancyStore, electionStore, filingStore, rankStore, runStore, citizenStore) {
    void electionStore;
    void filingStore;
    void runStore;
    return relinquishUnlocked(vacancyStore, citizenStore, rankStore, src);
  });
}

function refreshAndPersist(paths, input) {
  const src = input || {};
  return persist(paths, 'leader-office', {}, function (vacancyStore, electionStore, filingStore, rankStore) {
    void vacancyStore;
    void electionStore;
    void filingStore;
    return refreshUnlocked(rankStore, src);
  });
}

function publicScope(paths, country, territory) {
  const vacancyStore = vacancy.readStore(paths.vacancy);
  const rankStore = readRankStore(paths.rank);
  const office = findOffice(vacancyStore, country, territory);
  const view = scopePack(rankStore, office);
  view.ok = !!office;
  view.members = membersIn(rankStore, country, territory).map(function (row) {
    return {
      id: row.id,
      rank: row.rank,
      xp: row.xp,
      fame: row.fame,
      activity: row.activity,
      achievements: row.achievements,
      electedLeader: row.electedLeader === true,
      excludedFromRepresentativeQuota: row.excludedFromRepresentativeQuota === true,
    };
  });
  view.appointments = rankStore.appointments.filter(function (row) {
    return row.country === country && row.territory === territory;
  });
  view.relinquishments = rankStore.relinquishments.filter(function (row) {
    return row.country === country && row.territory === territory;
  });
  const electionStore = election.readStore(paths.election);
  view.elections = (electionStore.elections || []).filter(function (row) {
    return row.country === country && row.territory === territory;
  }).map(function (row) {
    return { id: row.id, filingRoundId: row.filingRoundId, status: row.status, winnerId: row.winnerId || null, officeGranted: row.officeGranted === true };
  });
  view.schedules = (vacancyStore.schedules || []).filter(function (row) {
    return row.country === country && row.territory === territory;
  });
  return view;
}

module.exports = {
  emptyRankStore: emptyRankStore,
  readRankStore: readRankStore,
  writeRankStore: writeRankStore,
  describeAppointmentRead: describeAppointmentRead,
  loadAppointmentRead: loadAppointmentRead,
  appointAndPersist: appointAndPersist,
  relinquishAndPersist: relinquishAndPersist,
  refreshAndPersist: refreshAndPersist,
  publicScope: publicScope,
  representativeIds: representativeIds,
  sameStats: sameStats,
};
