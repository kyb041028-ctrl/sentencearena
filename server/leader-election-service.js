/**
 * 개발용 지도자 선거.
 * 3차 A에 저장된 후보만 심사한다. 모집 기간 상수는 없다.
 * 당선 기록은 직위를 부여하지 않는다. devAuth와 개발 헤더는 운영 인증이 아니다.
 * JSON 잠금은 이 프로세스 안의 줄 세우기다. PostgreSQL 트랜잭션이 아니다.
 */
'use strict';

const fs = require('fs');
const legal = require('../shared/legal-gate-core');
const rank = require('../shared/dec023-rank-evaluation-core');
const roster = require('./rep-impeach-vote-roster');
const vote = require('../shared/vote-engine-core');

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

function emptyStore() {
  return { reviews: [], registrationCloses: [], elections: [], ballots: [], votes: [], blocks: [], rounds: [], roundApplications: [] };
}

function readStore(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return emptyStore();
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return {
    reviews: Array.isArray(parsed.reviews) ? parsed.reviews : [],
    registrationCloses: Array.isArray(parsed.registrationCloses) ? parsed.registrationCloses : [],
    elections: Array.isArray(parsed.elections) ? parsed.elections : [],
    ballots: Array.isArray(parsed.ballots) ? parsed.ballots : [],
    votes: Array.isArray(parsed.votes) ? parsed.votes : [],
    blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
    rounds: Array.isArray(parsed.rounds) ? parsed.rounds : [],
    roundApplications: Array.isArray(parsed.roundApplications) ? parsed.roundApplications : [],
  };
}

function writeStore(filePath, store) {
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2));
  return store;
}

function windowError(windowSpec, needsClosing) {
  if (!windowSpec || windowSpec.provided !== true) return 'FILING_WINDOW_UNCONFIRMED';
  if (needsClosing && windowSpec.closing !== true) return 'FILING_WINDOW_UNCONFIRMED';
  return null;
}

function usEligibilityError(country, eligibility) {
  if (country !== 'US') return null;
  const record = eligibility && typeof eligibility === 'object' ? eligibility : null;
  if (!record || record.source !== 'test-fixture') return 'US_AGE_UNVERIFIED';
  if (record.age != null || record.dob != null || record.birthDate != null) return 'US_AGE_UNVERIFIED';
  const row = record.legalRow;
  if (!row || typeof row !== 'object') return 'US_AGE_UNVERIFIED';
  if (row.age != null || row.dob != null || row.year != null) return 'US_AGE_UNVERIFIED';
  if (legal.isUsAgeConfirmed(row)) return null;
  if (row.activity_region === 'KR' && row.age_policy_version === legal.AGE_POLICY_VERSION && row.usParticipation === 'read-only') {
    return 'US_PARTICIPATION_READ_ONLY';
  }
  return 'US_AGE_UNVERIFIED';
}

function clerkError(actor) {
  if (!actor || actor.verified !== true || actor.authSource !== 'test-fixture') {
    if (actor && actor.devAuth === true) return 'DEV_AUTH_NOT_PRODUCTION';
    return 'AUTH_UNVERIFIED';
  }
  if (actor.office !== 'dev-clerk') return 'REVIEW_ACTOR_REQUIRED';
  return null;
}

function findReview(store, candidacyId) {
  return store.reviews.filter(function (row) { return row.candidacyId === candidacyId; })[0] || null;
}

function roundById(store, filingRoundId) {
  return (store.rounds || []).filter(function (row) { return row.id === filingRoundId; })[0] || null;
}

function scopeError(country, territory) {
  if (country !== 'KR' && country !== 'US') return 'COUNTRY_REQUIRED';
  if (territory !== 'pioneer' && territory !== 'guardian') return 'TERRITORY_NOT_ELIGIBLE';
  return null;
}

function reviewCandidacy(store, filingStore, input) {
  const src = input || {};
  const gate = windowError(src.window, src.action === 'close_registration');
  if (gate) return { ok: false, reason: gate, stored: false };
  const clerk = clerkError(src.actor);
  if (clerk) return { ok: false, reason: clerk, stored: false };
  const candidacyId = String(src.candidacyId || '');
  const candidacy = (filingStore && filingStore.candidacies || []).filter(function (row) { return row.id === candidacyId; })[0];
  if (!candidacy) return { ok: false, reason: 'CANDIDACY_NOT_STORED', stored: false };
  const roundId = src.filingRoundId ? String(src.filingRoundId) : '';
  if (roundId) {
    const round = roundById(store, roundId);
    if (!round) return { ok: false, reason: 'ROUND_NOT_FOUND', stored: false };
    if (round.country !== candidacy.country || round.territory !== candidacy.territory) {
      return { ok: false, reason: 'CROSS_SCOPE', stored: false };
    }
    if (round.status !== 'filing') return { ok: false, reason: 'REGISTRATION_CLOSED', stored: false };
    const linked = (store.roundApplications || []).some(function (row) {
      return row.candidacyId === candidacyId && row.filingRoundId === roundId;
    });
    if (!linked) return { ok: false, reason: 'CANDIDACY_NOT_IN_ROUND', stored: false };
  }
  const names = roster.representatives({ country: candidacy.country, territory: candidacy.territory, authKind: 'test-fixture' });
  if (!names.ok) return { ok: false, reason: names.reason, stored: false, productionAuth: false };
  if (names.ids.indexOf(String(candidacy.actorId)) < 0) return { ok: false, reason: 'NOT_REPRESENTATIVE', stored: false };
  let review = findReview(store, candidacyId);
  if (review && review.filingRoundId && review.filingRoundId !== roundId) {
    return { ok: false, reason: 'CANDIDACY_ROUND_LOCKED', stored: false };
  }
  if (review && review.filingRoundId && !roundId) {
    return { ok: false, reason: 'ROUND_ID_REQUIRED', stored: false };
  }
  if (review && !review.filingRoundId && roundId) {
    return { ok: false, reason: 'UNSCOPED_RECORD', stored: false };
  }
  if (!review) {
    review = {
      candidacyId: candidacyId,
      actorId: String(candidacy.actorId),
      actorName: String(candidacy.actorName || candidacy.actorId),
      country: candidacy.country,
      territory: candidacy.territory,
      status: 'received',
      registrationClosed: false,
    };
    if (roundId) review.filingRoundId = roundId;
    store.reviews.push(review);
  }
  if (src.action === 'start_review') {
    if (review.status !== 'received') return { ok: false, reason: 'STATUS_CONFLICT', stored: false, review: review };
    review.status = 'in_review';
    return { ok: true, stored: true, review: review };
  }
  if (src.action === 'approve') {
    if (review.status !== 'in_review') return { ok: false, reason: 'STATUS_CONFLICT', stored: false, review: review };
    review.status = 'approved';
    return { ok: true, stored: true, review: review };
  }
  if (src.action === 'reject') {
    if (review.status !== 'in_review') return { ok: false, reason: 'STATUS_CONFLICT', stored: false, review: review };
    review.status = 'rejected';
    return { ok: true, stored: true, review: review };
  }
  if (src.action === 'close_registration') {
    if (review.filingRoundId) return { ok: false, reason: 'USE_ROUND_CLOSE', stored: false };
    markRegistrationClosed(store, candidacy.country, candidacy.territory);
    return { ok: true, stored: true, review: review };
  }
  return { ok: false, reason: 'ACTION_UNKNOWN', stored: false };
}

function approvedCandidates(store, country, territory, filingRoundId) {
  return store.reviews.filter(function (row) {
    if (row.country !== country || row.territory !== territory) return false;
    if (row.status !== 'approved' || row.registrationClosed !== true) return false;
    if (filingRoundId) return row.filingRoundId === filingRoundId;
    return !row.filingRoundId;
  });
}

function markRegistrationClosed(store, country, territory) {
  if (!Array.isArray(store.registrationCloses)) store.registrationCloses = [];
  store.reviews.forEach(function (row) {
    if (row.country === country && row.territory === territory && !row.filingRoundId) row.registrationClosed = true;
  });
  const found = store.registrationCloses.filter(function (row) {
    return row.country === country && row.territory === territory && !row.filingRoundId;
  })[0];
  if (found) {
    found.closed = true;
    return found;
  }
  const row = { country: country, territory: territory, closed: true };
  store.registrationCloses.push(row);
  return row;
}

function closeRegistration(store, input) {
  const src = input || {};
  const gate = windowError(src.window, true);
  if (gate) return { ok: false, reason: gate, stored: false };
  const clerk = clerkError(src.actor);
  if (clerk) return { ok: false, reason: clerk, stored: false };
  const country = String(src.country || '');
  const territory = String(src.territory || '');
  const scope = scopeError(country, territory);
  if (scope) return { ok: false, reason: scope, stored: false };
  const roundId = src.filingRoundId ? String(src.filingRoundId) : '';
  if (!roundId) {
    const row = markRegistrationClosed(store, country, territory);
    return { ok: true, stored: true, registration: row };
  }
  const round = roundById(store, roundId);
  if (!round) return { ok: false, reason: 'ROUND_NOT_FOUND', stored: false };
  if (round.country !== country || round.territory !== territory) return { ok: false, reason: 'CROSS_SCOPE', stored: false };
  if (round.status !== 'filing') return { ok: false, reason: 'REGISTRATION_ALREADY_CLOSED', stored: false };
  round.status = 'registration_closed';
  store.reviews.forEach(function (row) {
    if (row.filingRoundId === roundId) row.registrationClosed = true;
  });
  const registration = { country: country, territory: territory, filingRoundId: roundId, closed: true };
  store.registrationCloses.push(registration);
  return { ok: true, stored: true, registration: registration, round: round };
}

function openFilingRound(store, input) {
  const src = input || {};
  const gate = windowError(src.window, false);
  if (gate) return { ok: false, reason: gate, stored: false };
  const clerk = clerkError(src.actor);
  if (clerk) return { ok: false, reason: clerk, stored: false };
  const country = String(src.country || '');
  const territory = String(src.territory || '');
  const scope = scopeError(country, territory);
  if (scope) return { ok: false, reason: scope, stored: false };
  if (!Array.isArray(store.rounds)) store.rounds = [];
  const filing = store.rounds.filter(function (row) {
    return row.country === country && row.territory === territory && row.status === 'filing';
  })[0];
  if (filing) return { ok: false, reason: 'FILING_ROUND_OPEN', stored: false, round: filing };
  const sequence = store.rounds.filter(function (row) {
    return row.country === country && row.territory === territory;
  }).length + 1;
  const round = {
    id: 'fr-' + country + '-' + territory + '-' + sequence,
    country: country,
    territory: territory,
    sequence: sequence,
    status: 'filing',
  };
  store.rounds.push(round);
  return { ok: true, stored: true, round: round };
}

function applyToRound(store, filingStore, input) {
  const src = input || {};
  const gate = windowError(src.window, false);
  if (gate) return { ok: false, reason: gate, stored: false };
  const clerk = clerkError(src.actor);
  if (clerk) return { ok: false, reason: clerk, stored: false };
  const roundId = String(src.filingRoundId || '');
  const round = roundById(store, roundId);
  if (!round) return { ok: false, reason: 'ROUND_NOT_FOUND', stored: false };
  if (round.reuseBlocked === true) return { ok: false, reason: 'OLD_ROUND', stored: false };
  if (round.status !== 'filing') return { ok: false, reason: 'REGISTRATION_CLOSED', stored: false };
  const candidacyId = String(src.candidacyId || '');
  const candidacy = (filingStore && filingStore.candidacies || []).filter(function (row) { return row.id === candidacyId; })[0];
  if (!candidacy) return { ok: false, reason: 'CANDIDACY_NOT_STORED', stored: false };
  if (candidacy.country !== round.country || candidacy.territory !== round.territory) {
    return { ok: false, reason: 'CROSS_SCOPE', stored: false };
  }
  const names = roster.representatives({ country: candidacy.country, territory: candidacy.territory, authKind: 'test-fixture' });
  if (!names.ok) return { ok: false, reason: names.reason, stored: false, productionAuth: false };
  if (names.ids.indexOf(String(candidacy.actorId)) < 0) return { ok: false, reason: 'NOT_REPRESENTATIVE', stored: false };
  if (!Array.isArray(store.roundApplications)) store.roundApplications = [];
  const used = store.roundApplications.some(function (row) { return row.candidacyId === candidacyId; });
  if (used) return { ok: false, reason: 'CANDIDACY_ROUND_LOCKED', stored: false };
  const review = findReview(store, candidacyId);
  if (review && review.filingRoundId) return { ok: false, reason: 'CANDIDACY_ROUND_LOCKED', stored: false };
  if (review && !review.filingRoundId) return { ok: false, reason: 'UNSCOPED_RECORD', stored: false };
  const application = {
    filingRoundId: roundId,
    candidacyId: candidacyId,
    actorId: String(candidacy.actorId),
    actorName: String(candidacy.actorName || candidacy.actorId),
    country: round.country,
    territory: round.territory,
  };
  store.roundApplications.push(application);
  return { ok: true, stored: true, application: application };
}

function roundView(store, filingRoundId) {
  const round = roundById(store, filingRoundId);
  if (!round) return null;
  const election = store.elections.filter(function (row) { return row.filingRoundId === filingRoundId; })[0] || null;
  return {
    round: round,
    applications: (store.roundApplications || []).filter(function (row) { return row.filingRoundId === filingRoundId; }),
    reviews: store.reviews.filter(function (row) { return row.filingRoundId === filingRoundId; }),
    election: election,
    productionAuth: false,
  };
}

function registrationClosed(store, country, territory) {
  return (store.registrationCloses || []).some(function (row) {
    return row.country === country && row.territory === territory && row.closed === true && !row.filingRoundId;
  });
}

function populationCount(input) {
  const src = input || {};
  if (!src.population || src.population.source !== 'test-fixture') {
    return { ok: false, reason: 'REAL_POPULATION_FORBIDDEN' };
  }
  const counted = rank.countValidPopulation({
    country: src.country,
    territory: src.territory,
    asOfMs: src.nowMs,
    records: src.population.records,
  });
  if (!counted.ok) return { ok: false, reason: counted.reason };
  const gate = rank.leaderElectionOpen(counted.count);
  if (!gate.ok) return { ok: false, reason: gate.reason };
  const ids = [];
  const seen = Object.create(null);
  (src.population.records || []).forEach(function (rec) {
    if (!rec || rec.valid !== true) return;
    if (String(rec.country || '') !== src.country || String(rec.territory || '') !== src.territory) return;
    const id = String(rec.id || '').trim();
    if (!id || seen[id]) return;
    const post = rec.lastPostAtMs != null ? Number(rec.lastPostAtMs) : null;
    const comment = rec.lastCommentAtMs != null ? Number(rec.lastCommentAtMs) : null;
    const asOf = Number(src.nowMs);
    const recentPost = post != null && isFinite(post) && post <= asOf && asOf - post <= 30 * vote.DAY_MS;
    const recentComment = comment != null && isFinite(comment) && comment <= asOf && asOf - comment <= 30 * vote.DAY_MS;
    if (!recentPost && !recentComment) return;
    seen[id] = true;
    ids.push(id);
  });
  return { ok: true, count: counted.count, open: gate.open, voterIds: ids };
}

function sharedCandidatePath(candidateCount, electionUse) {
  const use = electionUse == null || electionUse === '' ? 'general' : String(electionUse);
  if (use !== 'general' && use !== 'by_election') {
    return { ok: false, reason: 'ELECTION_USE_UNKNOWN', stored: false, electionOpened: false, schedulerRan: false };
  }
  const count = Number(candidateCount);
  if (!isFinite(count) || count < 0 || Math.floor(count) !== count) {
    return { ok: false, reason: 'CANDIDATE_COUNT_REQUIRED', stored: false, electionOpened: false, schedulerRan: false };
  }
  const shared = {
    ok: true,
    electionUse: use,
    officeGranted: false,
    stored: false,
    electionOpened: false,
    schedulerRan: false,
    productionAuth: false,
  };
  if (count === 0) {
    return Object.assign(shared, { status: 'weekly_refiling_waiting', votesOpened: false, voteKind: null, voteDurationMs: null });
  }
  if (count === 1) {
    return Object.assign(shared, { status: 'uncontested_recorded', votesOpened: false, voteKind: null, voteDurationMs: null });
  }
  return Object.assign(shared, {
    status: 'open',
    votesOpened: true,
    voteKind: vote.KINDS.leader_election_48h.id,
    voteDurationMs: vote.KINDS.leader_election_48h.durationMs,
  });
}

function openElection(store, input) {
  const src = input || {};
  const country = String(src.country || '');
  const territory = String(src.territory || '');
  if (country !== 'KR' && country !== 'US') return { ok: false, reason: 'COUNTRY_REQUIRED' };
  if (territory !== 'pioneer' && territory !== 'guardian') return { ok: false, reason: 'TERRITORY_NOT_ELIGIBLE' };
  const gate = windowError(src.window, false);
  if (gate) return { ok: false, reason: gate };
  const nowMs = Number(src.nowMs);
  if (!isFinite(nowMs)) return { ok: false, reason: 'CLOCK_REQUIRED' };
  const people = populationCount(src);
  if (!people.ok) return people;
  if (!people.open) return { ok: false, reason: 'POPULATION_BELOW_1000', population: people.count };
  const roundId = src.filingRoundId ? String(src.filingRoundId) : '';
  const round = roundId ? roundById(store, roundId) : null;
  if (roundId) {
    if (!round || round.country !== country || round.territory !== territory) return { ok: false, reason: 'ROUND_NOT_FOUND' };
    if (round.reuseBlocked === true) return { ok: false, reason: 'OLD_ROUND' };
    if (round.status === 'election_opened') return { ok: false, reason: 'ELECTION_ALREADY_OPEN' };
    if (round.status !== 'registration_closed') return { ok: false, reason: 'REGISTRATION_NOT_CLOSED' };
  } else if (!registrationClosed(store, country, territory)) {
    return { ok: false, reason: 'REGISTRATION_NOT_CLOSED' };
  }
  if (!roundId) {
    const existing = store.elections.filter(function (row) { return row.country === country && row.territory === territory && !row.filingRoundId && row.openKey === String(src.openKey || 'current'); })[0];
    if (existing) return { ok: true, alreadyOpen: true, election: existing };
  }
  const approved = approvedCandidates(store, country, territory, roundId);
  const pathPlan = sharedCandidatePath(approved.length, 'general');
  const openKey = roundId || String(src.openKey || 'current');
  function stamp(row) {
    if (roundId) {
      row.filingRoundId = roundId;
      row.candidateIds = approved.map(function (item) { return item.actorId; });
      round.status = 'election_opened';
    }
    return row;
  }
  if (pathPlan.status === 'weekly_refiling_waiting') {
    const row = stamp({
      id: 'el-' + country + '-' + territory + '-' + store.elections.length,
      country: country,
      territory: territory,
      openKey: openKey,
      status: pathPlan.status,
      officeGranted: false,
      votesOpened: false,
      population: people.count,
      nowMs: nowMs,
    });
    store.elections.push(row);
    return { ok: true, election: row };
  }
  if (pathPlan.status === 'uncontested_recorded') {
    const row = stamp({
      id: 'el-' + country + '-' + territory + '-' + store.elections.length,
      country: country,
      territory: territory,
      openKey: openKey,
      status: pathPlan.status,
      winnerId: approved[0].actorId,
      winnerName: approved[0].actorName,
      officeGranted: false,
      votesOpened: false,
      population: people.count,
      nowMs: nowMs,
    });
    store.elections.push(row);
    return { ok: true, election: row };
  }
  if (pathPlan.status !== 'open' || pathPlan.votesOpened !== true) {
    return { ok: false, reason: pathPlan.reason || 'ELECTION_PATH_UNKNOWN', stored: false };
  }
  const opened = vote.openBallot(store, {
    voteKind: pathPlan.voteKind,
    country: country,
    territory: territory,
    subjectId: openKey,
    startsAtMs: nowMs,
    eligibleRepresentativeIds: people.voterIds,
    candidates: approved.map(function (row) { return { id: row.actorId, name: row.actorName }; }),
  });
  if (!opened.ok) return opened;
  const row = stamp({
    id: 'el-' + country + '-' + territory + '-' + store.elections.length,
    country: country,
    territory: territory,
    openKey: openKey,
    status: 'open',
    ballotId: opened.ballot.id,
    officeGranted: false,
    votesOpened: true,
    population: people.count,
    nowMs: nowMs,
  });
  store.elections.push(row);
  return { ok: true, election: row, ballot: opened.ballot };
}

function castVoteUnlocked(store, input) {
  const src = input || {};
  const ballot = store.ballots.filter(function (row) { return row.id === src.ballotId; })[0];
  if (!ballot) return { ok: false, reason: 'BALLOT_NOT_FOUND', productionAuth: false };
  const age = usEligibilityError(ballot.country, src.eligibility);
  if (age) return { ok: false, reason: age, productionAuth: false };
  const cast = vote.castVote(store, src);
  if (cast && cast.publicView) cast.publicView.productionAuth = false;
  if (cast) cast.productionAuth = false;
  return cast;
}

function castVote(store, input) {
  const src = input || {};
  return withLock(String(src.ballotId || ''), function () {
    return castVoteUnlocked(store, src);
  });
}

function closeBallotUnlocked(store, input) {
  const src = input || {};
  const closed = vote.closeBallot(store, src);
  if (closed && closed.ballot) closed.ballot.officeGranted = false;
  if (closed && closed.publicView) closed.publicView.productionAuth = false;
  if (closed) closed.productionAuth = false;
  const election = store.elections.filter(function (row) { return row.ballotId === src.ballotId; })[0];
  if (closed && closed.ok && election && closed.alreadyClosed !== true) {
    election.status = 'closed';
    election.result = closed.ballot.result;
    election.failReason = closed.ballot.failReason || null;
    election.winnerId = closed.ballot.winnerId || null;
    election.officeGranted = false;
  }
  return closed;
}

function closeBallot(store, input) {
  const src = input || {};
  return withLock(String(src.ballotId || ''), function () {
    return closeBallotUnlocked(store, src);
  });
}

const TIE_COPY = {
  kr: '투표 결과 동률로 당선자가 결정되지 않았습니다. 지도자 직위는 공석으로 유지되며, 다음 후보 접수 기간에 새로운 선거가 진행됩니다.',
  en: 'The election ended in a tie. The leadership position remains vacant. A new election cycle will begin with the next candidate registration period.',
};

function tieNotice(election) {
  if (!election || election.failReason !== 'TIE' || election.winnerId) return null;
  const start = Number(election.nextRefilingAtMs);
  const stored = isFinite(start);
  return {
    kr: TIE_COPY.kr,
    en: TIE_COPY.en,
    nextFilingStartMs: stored ? start : null,
    filingDateShown: stored,
  };
}

function applyAppointmentRead(view, election, appointmentRead) {
  view.readOnly = true;
  view.appointedByThisRead = false;
  view.multiFileTransaction = false;
  view.storedElectionOfficeGranted = election.officeGranted === true;
  view.voteClosed = election.status === 'closed';
  if (!appointmentRead || appointmentRead.checked !== true) {
    view.officeGranted = false;
    view.appointmentComplete = false;
    view.appointmentCheck = appointmentRead && appointmentRead.appointmentCheck ? appointmentRead.appointmentCheck : 'STORES_NOT_CHECKED';
    view.recoveryNeeded = false;
    return view;
  }
  view.officeGranted = appointmentRead.officeGranted === true;
  view.appointmentComplete = appointmentRead.appointmentComplete === true;
  view.appointmentCheck = appointmentRead.appointmentCheck;
  view.recoveryNeeded = appointmentRead.recoveryNeeded === true;
  view.appointmentParts = appointmentRead.parts || null;
  if (appointmentRead.winnerId) view.winnerId = appointmentRead.winnerId;
  else if (!election.winnerId) view.winnerId = null;
  return view;
}

function publicElection(store, electionId, nowMs, appointmentRead) {
  const election = store.elections.filter(function (row) { return row.id === electionId; })[0];
  if (!election) return null;
  if (election.ballotId) {
    const view = vote.publicView(store, election.ballotId, nowMs);
    if (view) {
      view.filingRoundId = election.filingRoundId || null;
      view.candidateIds = election.candidateIds || [];
      view.status = election.status;
      view.failReason = election.failReason || view.failReason || null;
      view.tieNotice = tieNotice(election);
      return applyAppointmentRead(view, election, appointmentRead);
    }
  }
  return applyAppointmentRead({
    id: election.id,
    country: election.country,
    territory: election.territory,
    status: election.status,
    filingRoundId: election.filingRoundId || null,
    candidateIds: election.candidateIds || [],
    votesOpened: election.votesOpened === true,
    winnerId: election.winnerId || null,
    winnerName: election.winnerName || null,
    failReason: election.failReason || null,
    tieNotice: tieNotice(election),
    simulation: true,
    productionAuth: false,
    authKind: 'test-fixture',
  }, election, appointmentRead);
}

module.exports = {
  emptyStore: emptyStore,
  readStore: readStore,
  writeStore: writeStore,
  reviewCandidacy: reviewCandidacy,
  openFilingRound: openFilingRound,
  applyToRound: applyToRound,
  closeRegistration: closeRegistration,
  roundView: roundView,
  sharedCandidatePath: sharedCandidatePath,
  openElection: openElection,
  castVote: castVote,
  castVoteUnlocked: castVoteUnlocked,
  closeBallot: closeBallot,
  closeBallotUnlocked: closeBallotUnlocked,
  publicElection: publicElection,
  withLock: withLock,
};
