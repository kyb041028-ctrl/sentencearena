/**
 * 개발용 보궐 진행.
 * 저장된 해임 시각만 본다. 7일에 기존 접수 회차를 열고, 10일에 후보 수로 가른다.
 * 0명은 재접수 대기, 1명은 uncontested_recorded 와 officeGranted false, 2명 이상은 기존 48시간 투표만 연다.
 * 직위를 부여하지 않는다. 계급, 명성, 시즌, 공석 상태를 바꾸지 않는다.
 * 복수 투표가 끝나도 승자를 임명하지 않는다. 동률은 당선자 없이 같은 재접수 대기로 잇는다.
 * JSON 잠금은 단일 프로세스다. 이 프로세스 안의 줄 세우기이며 여러 프로세스에는 안전하지 않다. PostgreSQL에 접속하지 않는다.
 */
'use strict';

const fs = require('fs');
const vote = require('../shared/vote-engine-core');
const election = require('./leader-election-service');
const filing = require('./leader-filing-service');
const vacancy = require('./impeachment-vacancy-service');
const roster = require('./rep-impeach-vote-roster');

const DAY_MS = vote.DAY_MS;
const VACANT_MS = 7 * DAY_MS;
const FILING_MS = 3 * DAY_MS;
const REFILING_MS = 7 * DAY_MS;

const CLERK = {
  id: 'by-election-clerk',
  verified: true,
  authSource: 'test-fixture',
  office: 'dev-clerk',
};

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
  return { runs: [] };
}

function readStore(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return emptyStore();
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return { runs: Array.isArray(parsed.runs) ? parsed.runs : [] };
}

function writeStore(filePath, store) {
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2));
  return store;
}

function clockNow(input) {
  const src = input || {};
  if (src.clockSource === 'test-fixture' && isFinite(Number(src.nowMs))) return Number(src.nowMs);
  return Date.now();
}

function findRemoval(store, ballotId) {
  return (store.removals || []).filter(function (row) { return row.citizenBallotId === ballotId; })[0] || null;
}

function findOffice(store, country, territory) {
  return (store.offices || []).filter(function (row) { return row.country === country && row.territory === territory; })[0] || null;
}

function runsFor(store, ballotId) {
  return store.runs.filter(function (row) { return row.citizenBallotId === ballotId; })
    .sort(function (a, b) { return a.sequence - b.sequence; });
}

function latestRun(store, ballotId) {
  const rows = runsFor(store, ballotId);
  return rows.length ? rows[rows.length - 1] : null;
}

function officeView(office) {
  if (!office) return null;
  return {
    country: office.country,
    territory: office.territory,
    status: office.status,
    leaderId: office.leaderId == null ? null : office.leaderId,
    rank: office.rank == null ? null : office.rank,
    fame: office.fame == null ? null : office.fame,
    season: office.season == null ? null : office.season,
    seasonEnd: office.seasonEnd == null ? null : office.seasonEnd,
    removedAtMs: office.removedAtMs || null,
  };
}

function baseResult(office) {
  return {
    productionAuth: false,
    officeGranted: false,
    appointment: false,
    tieRule: false,
    lock: 'single-process',
    schedulerRan: false,
    office: officeView(office),
  };
}

function populationOf(input, country, territory) {
  const src = input || {};
  const pop = src.population;
  if (!pop || pop.source !== 'test-fixture' || !Array.isArray(pop.records)) return null;
  return {
    source: 'test-fixture',
    records: pop.records.filter(function (row) {
      return row && String(row.country || '') === country && String(row.territory || '') === territory;
    }),
  };
}

function mapRunStatus(electionRow) {
  if (!electionRow) return 'filing';
  if (electionRow.status === 'open') return 'vote_open';
  return electionRow.status;
}

function stampFromElection(run, electionRow, nowMs) {
  run.status = mapRunStatus(electionRow);
  run.electionId = electionRow.id;
  run.officeGranted = false;
  run.votesOpened = electionRow.votesOpened === true;
  run.appointment = false;
  run.tieRule = false;
  run.recordedCandidateId = electionRow.status === 'uncontested_recorded' ? (electionRow.winnerId || null) : null;
  electionRow.officeGranted = false;
  if (run.status === 'weekly_refiling_waiting') {
    const base = isFinite(Number(electionRow.nowMs)) ? Number(electionRow.nowMs) : nowMs;
    run.refilingBaseMs = base;
    run.nextRefilingAtMs = base + REFILING_MS;
    run.branchedAtMs = base;
  } else {
    run.branchedAtMs = nowMs;
  }
  return run;
}

function excludeUnqualified(electionStore, filingStore, round) {
  const names = roster.representatives({
    country: round.country,
    territory: round.territory,
    authKind: 'test-fixture',
  });
  const excluded = [];
  (electionStore.roundApplications || []).forEach(function (app) {
    if (app.filingRoundId !== round.id) return;
    const candidacy = (filingStore.candidacies || []).filter(function (row) { return row.id === app.candidacyId; })[0];
    const review = (electionStore.reviews || []).filter(function (row) {
      return row.candidacyId === app.candidacyId && row.filingRoundId === round.id && row.status === 'approved';
    })[0];
    if (!review) return;
    let reason = null;
    if (!candidacy || candidacy.status === 'withdrawn' || candidacy.withdrawn === true) reason = 'WITHDRAWN';
    else if (!names.ok || names.ids.indexOf(String(candidacy.actorId)) < 0) reason = 'NOT_REPRESENTATIVE';
    if (!reason) return;
    review.status = 'rejected';
    review.exclusion = reason;
    excluded.push({ candidacyId: app.candidacyId, reason: reason });
  });
  return excluded;
}

function makeRun(removal, round, nowMs, parent) {
  const removedAtMs = Number(removal.removedAtMs);
  const filingStartMs = parent ? nowMs : removedAtMs + VACANT_MS;
  const filingEndMs = parent ? nowMs + FILING_MS : removedAtMs + VACANT_MS + FILING_MS;
  return {
    id: 'byrun-' + removal.country + '-' + removal.territory + '-' + round.sequence + '-' + removal.citizenBallotId,
    citizenBallotId: removal.citizenBallotId,
    country: removal.country,
    territory: removal.territory,
    removedAtMs: removedAtMs,
    sequence: round.sequence,
    filingRoundId: round.id,
    parentFilingRoundId: parent ? parent.filingRoundId : null,
    status: 'filing',
    openedAtMs: nowMs,
    filingStartMs: filingStartMs,
    filingEndMs: filingEndMs,
    repetition: parent ? (Number(parent.repetition) || 1) + 1 : 1,
    refilingBaseMs: parent ? parent.refilingBaseMs : null,
    nextRefilingAtMs: null,
    electionId: null,
    officeGranted: false,
    votesOpened: false,
    appointment: false,
    tieRule: false,
    recordedCandidateId: null,
    branchedAtMs: null,
    productionAuth: false,
    lock: 'single-process',
  };
}

function openRound(electionStore, removal, ballotId) {
  const opened = election.openFilingRound(electionStore, {
    actor: CLERK,
    country: removal.country,
    territory: removal.territory,
    window: { provided: true, open: true },
  });
  if (opened.ok && opened.round) {
    opened.round.byElectionBallotId = ballotId;
    opened.round.electionUse = 'by_election';
  }
  return opened;
}

function adoptOpenedElection(run, electionStore, nowMs) {
  const view = election.roundView(electionStore, run.filingRoundId);
  if (!view || !view.round || view.round.status !== 'election_opened' || !view.election) return null;
  stampFromElection(run, view.election, nowMs);
  return view;
}

function branchRun(electionStore, filingStore, run, removal, nowMs, population) {
  const view = election.roundView(electionStore, run.filingRoundId);
  if (!view || !view.round) return { ok: false, reason: 'ROUND_NOT_FOUND', officeGranted: false, productionAuth: false };
  if (view.round.status === 'election_opened' && view.election) {
    stampFromElection(run, view.election, nowMs);
    return {
      ok: true,
      adopted: true,
      branched: true,
      run: run,
      election: view.election,
      excluded: [],
      officeGranted: false,
      productionAuth: false,
    };
  }
  const excluded = excludeUnqualified(electionStore, filingStore, view.round);
  if (view.round.status === 'filing') {
    const closed = election.closeRegistration(electionStore, {
      actor: CLERK,
      country: removal.country,
      territory: removal.territory,
      filingRoundId: run.filingRoundId,
      window: { provided: true, closing: true },
    });
    if (!closed.ok) return closed;
  }
  const opened = election.openElection(electionStore, {
    country: removal.country,
    territory: removal.territory,
    nowMs: nowMs,
    window: { provided: true },
    filingRoundId: run.filingRoundId,
    population: population,
  });
  if (!opened.ok) return opened;
  stampFromElection(run, opened.election, nowMs);
  return {
    ok: true,
    branched: true,
    adopted: false,
    run: run,
    election: opened.election,
    ballot: opened.ballot || null,
    excluded: excluded,
    officeGranted: false,
    votesOpened: opened.election.votesOpened === true,
    productionAuth: false,
  };
}

function recountCandidates(electionStore, ballot) {
  const counts = Object.create(null);
  (ballot.candidates || []).forEach(function (candidate) { counts[String(candidate.id)] = 0; });
  (electionStore.votes || []).forEach(function (voteRow) {
    if (voteRow.ballotId === ballot.id && counts[String(voteRow.choice)] != null) counts[String(voteRow.choice)] += 1;
  });
  const ids = Object.keys(counts);
  let top = 0;
  ids.forEach(function (id) { if (counts[id] > top) top = counts[id]; });
  return { top: top, leaders: ids.filter(function (id) { return counts[id] === top; }) };
}

function closedVoteState(electionStore, run) {
  const row = (electionStore.elections || []).filter(function (item) { return item.filingRoundId === run.filingRoundId; })[0] || null;
  if (!row || !row.ballotId) return { kind: 'none', row: row };
  const ballot = (electionStore.ballots || []).filter(function (item) { return item.id === row.ballotId; })[0] || null;
  if (!ballot || ballot.voteKind !== 'leader_election_48h') return { kind: 'none', row: row };
  if (Number(ballot.endsAtMs) - Number(ballot.startsAtMs) !== 48 * 60 * 60 * 1000) return { kind: 'none', row: row };
  if (ballot.status !== 'closed' || ballot.closedOnce !== true || !isFinite(Number(ballot.closedAtMs)) || Number(ballot.closedAtMs) < Number(ballot.endsAtMs)) {
    return { kind: 'open', row: row, endsAtMs: Number(ballot.endsAtMs) };
  }
  const ranked = recountCandidates(electionStore, ballot);
  if (ranked.top === 0 || ballot.failReason === 'ZERO_VOTES') return { kind: 'zero', row: row, ballot: ballot };
  if (ranked.leaders.length !== 1 && ballot.failReason === 'TIE' && !ballot.winnerId && !row.winnerId) {
    return { kind: 'tie', row: row, ballot: ballot, closedAtMs: Number(ballot.closedAtMs) };
  }
  return { kind: 'winner', row: row, ballot: ballot };
}

function markTieWaiting(run, row, closedAtMs) {
  run.status = 'weekly_refiling_waiting';
  run.refilingBaseMs = closedAtMs;
  run.nextRefilingAtMs = closedAtMs + REFILING_MS;
  run.tieClosedAtMs = closedAtMs;
  run.officeGranted = false;
  run.appointment = false;
  run.tieRule = false;
  run.votesOpened = false;
  run.recordedCandidateId = null;
  row.officeGranted = false;
  row.winnerId = null;
  row.failReason = 'TIE';
  row.refilingBaseMs = closedAtMs;
  row.nextRefilingAtMs = run.nextRefilingAtMs;
  row.tieClosedAtMs = closedAtMs;
}

function advanceUnlocked(vacancyStore, electionStore, filingStore, runStore, input) {
  const src = input || {};
  const ballotId = String(src.ballotId || '');
  const removal = findRemoval(vacancyStore, ballotId);
  if (!removal) {
    return { ok: false, reason: 'REMOVAL_NOT_STORED', dirty: false, productionAuth: false, officeGranted: false, lock: 'single-process' };
  }
  const office = findOffice(vacancyStore, removal.country, removal.territory);
  const pack = baseResult(office);
  pack.clientWinnerIgnored = src.winnerId != null || src.officeGranted != null || src.passed != null || src.confirmed != null;
  if (removal.territory !== 'pioneer' && removal.territory !== 'guardian') {
    return Object.assign(pack, { ok: false, reason: 'TERRITORY_NOT_ELIGIBLE', dirty: false, opened: false });
  }
  if (removal.country !== 'KR' && removal.country !== 'US') {
    return Object.assign(pack, { ok: false, reason: 'COUNTRY_REQUIRED', dirty: false, opened: false });
  }
  const removedAtMs = Number(removal.removedAtMs);
  if (!isFinite(removedAtMs)) {
    return Object.assign(pack, { ok: false, reason: 'REMOVAL_CLOCK_MISSING', dirty: false });
  }
  const nowMs = clockNow(src);
  const filingStartMs = removedAtMs + VACANT_MS;
  const filingEndMs = filingStartMs + FILING_MS;
  let run = latestRun(runStore, ballotId);
  if (run && run.status === 'filing') {
    const adopted = adoptOpenedElection(run, electionStore, nowMs);
    if (adopted) {
      return Object.assign(pack, {
        ok: true,
        adopted: true,
        alreadyBranched: true,
        branched: true,
        dirty: true,
        runDirty: true,
        electionDirty: false,
        filingDirty: false,
        run: run,
        election: adopted.election,
        officeGranted: false,
      });
    }
  }
  if (run && run.status === 'vote_open') {
    const state = closedVoteState(electionStore, run);
    if (state.kind === 'tie') {
      markTieWaiting(run, state.row, state.closedAtMs);
      if (nowMs < Number(run.nextRefilingAtMs)) {
        return Object.assign(pack, {
          ok: true,
          alreadyWaiting: true,
          reason: 'REFILING_TOO_EARLY',
          dirty: true,
          runDirty: true,
          electionDirty: true,
          filingDirty: false,
          opened: false,
          branched: false,
          tie: true,
          run: run,
          refilingBaseMs: run.refilingBaseMs,
          nextRefilingAtMs: run.nextRefilingAtMs,
          officeGranted: false,
        });
      }
    } else if (state.kind === 'zero') {
      return Object.assign(pack, {
        ok: true,
        alreadyBranched: true,
        branched: false,
        reason: 'ZERO_VOTES',
        zeroVotes: true,
        tie: false,
        dirty: false,
        opened: false,
        run: run,
        officeGranted: false,
      });
    } else if (state.kind === 'open' && nowMs < Number(state.endsAtMs)) {
      return Object.assign(pack, {
        ok: true,
        alreadyBranched: true,
        branched: false,
        reason: 'VOTE_NOT_ENDED',
        dirty: false,
        opened: false,
        run: run,
        officeGranted: false,
      });
    } else {
      const view = run.electionId ? election.roundView(electionStore, run.filingRoundId) : null;
      return Object.assign(pack, {
        ok: true,
        alreadyBranched: true,
        branched: true,
        dirty: false,
        run: run,
        election: view && view.election ? view.election : null,
        officeGranted: false,
        appointment: false,
      });
    }
  }
  if (run && run.status === 'uncontested_recorded') {
    const view = run.electionId ? election.roundView(electionStore, run.filingRoundId) : null;
    return Object.assign(pack, {
      ok: true,
      alreadyBranched: true,
      branched: true,
      dirty: false,
      run: run,
      election: view && view.election ? view.election : null,
      officeGranted: false,
      appointment: false,
    });
  }
  if (!run && nowMs < filingStartMs) {
    return Object.assign(pack, {
      ok: false,
      reason: 'FILING_TOO_EARLY',
      dirty: false,
      opened: false,
      nowMs: nowMs,
      filingStartMs: filingStartMs,
    });
  }
  if (run && run.status === 'weekly_refiling_waiting' && nowMs < Number(run.nextRefilingAtMs)) {
    return Object.assign(pack, {
      ok: true,
      alreadyWaiting: true,
      reason: 'REFILING_TOO_EARLY',
      dirty: false,
      opened: false,
      branched: false,
      run: run,
    });
  }
  if (!run) {
    const tagged = (electionStore.rounds || []).filter(function (row) { return row.byElectionBallotId === ballotId; }).slice(-1)[0] || null;
    if (tagged && tagged.status === 'election_opened') {
      const linked = makeRun(removal, tagged, nowMs, null);
      const adopted = adoptOpenedElection(linked, electionStore, nowMs);
      if (adopted) {
        runStore.runs.push(linked);
        return Object.assign(pack, {
          ok: true,
          adopted: true,
          alreadyBranched: true,
          branched: true,
          dirty: true,
          runDirty: true,
          electionDirty: false,
          filingDirty: false,
          run: linked,
          election: adopted.election,
          officeGranted: false,
        });
      }
    }
  }
  if (!run || run.status === 'weekly_refiling_waiting') {
    const parent = run && run.status === 'weekly_refiling_waiting' ? run : null;
    const opened = openRound(electionStore, removal, ballotId);
    if (!opened.ok) {
      if (opened.reason === 'FILING_ROUND_OPEN' && opened.round && opened.round.byElectionBallotId === ballotId) {
        const existing = runsFor(runStore, ballotId).filter(function (row) { return row.filingRoundId === opened.round.id; })[0];
        if (existing) {
          return Object.assign(pack, { ok: true, alreadyOpen: true, dirty: false, opened: false, branched: false, run: existing });
        }
        const linked = makeRun(removal, opened.round, nowMs, parent);
        runStore.runs.push(linked);
        return Object.assign(pack, {
          ok: true,
          adopted: true,
          alreadyOpen: true,
          dirty: true,
          runDirty: true,
          electionDirty: false,
          filingDirty: false,
          opened: false,
          branched: false,
          run: linked,
        });
      }
      return Object.assign(pack, opened, { dirty: false, officeGranted: false, productionAuth: false });
    }
    const created = makeRun(removal, opened.round, nowMs, parent);
    let releasedFiling = false;
    if (parent && isFinite(Number(parent.tieClosedAtMs))) {
      const oldRound = (electionStore.rounds || []).filter(function (row) { return row.id === parent.filingRoundId; })[0];
      if (oldRound) {
        oldRound.reuseBlocked = true;
        const linkedIds = (electionStore.roundApplications || []).filter(function (row) { return row.filingRoundId === oldRound.id; }).map(function (row) { return row.candidacyId; });
        (filingStore.candidacies || []).forEach(function (row) {
          if (linkedIds.indexOf(row.id) < 0) return;
          if (row.status !== 'submitted' && row.status !== 'in_review') return;
          row.status = 'round_closed';
          releasedFiling = true;
        });
      }
      created.scheduledFilingStartMs = parent.nextRefilingAtMs;
    }
    runStore.runs.push(created);
    if (nowMs < created.filingEndMs) {
      return Object.assign(pack, {
        ok: true,
        opened: true,
        branched: false,
        refiling: !!parent,
        dirty: true,
        runDirty: true,
        electionDirty: true,
        filingDirty: releasedFiling,
        run: created,
        filingStartMs: created.filingStartMs,
        filingEndMs: created.filingEndMs,
      });
    }
    run = created;
  }
  if (run.status === 'filing' && nowMs < run.filingEndMs) {
    return Object.assign(pack, {
      ok: true,
      alreadyOpen: true,
      opened: false,
      branched: false,
      dirty: false,
      run: run,
      filingStartMs: filingStartMs,
      filingEndMs: filingEndMs,
    });
  }
  const population = populationOf(src, removal.country, removal.territory);
  const branched = branchRun(electionStore, filingStore, run, removal, nowMs, population);
  if (!branched.ok) {
    return Object.assign(pack, branched, { dirty: false, officeGranted: false, productionAuth: false, run: run });
  }
  const fresh = election.roundView(electionStore, run.filingRoundId);
  return Object.assign(pack, {
    ok: true,
    opened: run.openedAtMs === nowMs,
    branched: true,
    adopted: branched.adopted === true,
    dirty: true,
    runDirty: true,
    electionDirty: branched.adopted !== true,
    filingDirty: false,
    run: run,
    election: branched.election,
    ballot: branched.ballot || null,
    excluded: branched.excluded || [],
    publicView: fresh && fresh.election && fresh.election.ballotId
      ? election.publicElection(electionStore, fresh.election.id, nowMs)
      : election.publicElection(electionStore, branched.election.id, nowMs),
    officeGranted: false,
    votesOpened: run.votesOpened === true,
  });
}

function activeFilingRun(runStore, ballotId, nowMs) {
  const run = latestRun(runStore, ballotId);
  if (!run || run.status !== 'filing') return { ok: false, reason: 'FILING_NOT_OPEN', run: run };
  if (nowMs < run.filingStartMs || nowMs >= run.filingEndMs) return { ok: false, reason: 'OUTSIDE_WINDOW', run: run };
  return { ok: true, run: run };
}

function fileApplication(vacancyStore, electionStore, filingStore, runStore, input) {
  const src = input || {};
  const ballotId = String(src.ballotId || '');
  const removal = findRemoval(vacancyStore, ballotId);
  if (!removal) return { ok: false, reason: 'REMOVAL_NOT_STORED', dirty: false, productionAuth: false, officeGranted: false };
  const nowMs = clockNow(src);
  const active = activeFilingRun(runStore, ballotId, nowMs);
  if (!active.ok) return Object.assign(active, { dirty: false, productionAuth: false, officeGranted: false });
  const filed = filing.fileCandidacy(filingStore, {
    actor: {
      id: String(src.actorId || ''),
      name: String(src.actorName || src.actorId || ''),
      country: removal.country,
      territory: removal.territory,
      office: 'representative',
      devAuth: true,
    },
    country: removal.country,
    territory: removal.territory,
    window: { provided: true, open: true },
    nowMs: nowMs,
    intentConfirmed: true,
    eligibility: src.eligibility,
  });
  if (!filed.ok) return Object.assign(filed, { dirty: false, productionAuth: false, officeGranted: false });
  const linked = election.applyToRound(electionStore, filingStore, {
    actor: CLERK,
    filingRoundId: active.run.filingRoundId,
    candidacyId: filed.candidacy.id,
    window: { provided: true },
  });
  if (!linked.ok) return Object.assign(linked, { dirty: false, productionAuth: false, officeGranted: false });
  return {
    ok: true,
    dirty: true,
    filingDirty: true,
    electionDirty: true,
    runDirty: false,
    candidacy: filed.candidacy,
    application: linked.application,
    filingRoundId: active.run.filingRoundId,
    productionAuth: false,
    officeGranted: false,
    lock: 'single-process',
  };
}

function reviewApplication(vacancyStore, electionStore, filingStore, runStore, input) {
  const src = input || {};
  const action = String(src.action || '');
  if (action !== 'start_review' && action !== 'approve' && action !== 'reject') {
    return { ok: false, reason: 'ACTION_UNKNOWN', dirty: false, productionAuth: false, officeGranted: false };
  }
  const ballotId = String(src.ballotId || '');
  const removal = findRemoval(vacancyStore, ballotId);
  if (!removal) return { ok: false, reason: 'REMOVAL_NOT_STORED', dirty: false, productionAuth: false, officeGranted: false };
  const nowMs = clockNow(src);
  const active = activeFilingRun(runStore, ballotId, nowMs);
  if (!active.ok) return Object.assign(active, { dirty: false, productionAuth: false, officeGranted: false });
  const reviewed = election.reviewCandidacy(electionStore, filingStore, {
    actor: CLERK,
    candidacyId: String(src.candidacyId || ''),
    filingRoundId: active.run.filingRoundId,
    action: action,
    window: { provided: true },
  });
  if (!reviewed.ok) return Object.assign(reviewed, { dirty: false, productionAuth: false, officeGranted: false });
  return {
    ok: true,
    dirty: true,
    electionDirty: true,
    filingDirty: false,
    runDirty: false,
    review: reviewed.review,
    productionAuth: false,
    officeGranted: false,
    lock: 'single-process',
  };
}

function castUnlocked(electionStore, input) {
  const src = input || {};
  const nowMs = clockNow(src);
  const cast = election.castVoteUnlocked(electionStore, {
    ballotId: String(src.voteBallotId || ''),
    choice: src.choice,
    nowMs: nowMs,
    eligibility: src.eligibility,
    actor: {
      id: String(src.actorId || ''),
      country: String(src.country || ''),
      territory: String(src.territory || ''),
      verified: true,
      authSource: 'test-fixture',
    },
  });
  if (!cast) {
    return { ok: false, reason: 'VOTE_FAILED', dirty: false, productionAuth: false, officeGranted: false, lock: 'single-process' };
  }
  cast.dirty = cast.ok === true;
  cast.electionDirty = cast.ok === true;
  cast.runDirty = false;
  cast.filingDirty = false;
  cast.productionAuth = false;
  cast.officeGranted = false;
  cast.appointment = false;
  cast.lock = 'single-process';
  return cast;
}

function persist(paths, input, options, mutate) {
  const src = input || {};
  const opts = options || {};
  const ballotId = String(src.ballotId || src.lockId || '');
  return withLock(ballotId, function () {
    const vacancyStore = vacancy.readStore(paths.vacancy);
    const electionStore = election.readStore(paths.election);
    const filingStore = filing.readStore(paths.filing);
    const runStore = readStore(paths.run);
    const result = mutate(vacancyStore, electionStore, filingStore, runStore, src);
    if (!result || result.dirty !== true) return result;
    try {
      if (opts.failElectionWrite === true && (result.electionDirty === true || result.filingDirty === true)) {
        throw new Error('ELECTION_STORE_WRITE_FAILED');
      }
      if (result.electionDirty === true) election.writeStore(paths.election, electionStore);
      if (result.filingDirty === true) filing.writeStore(paths.filing, filingStore);
    } catch (err) {
      return {
        ok: false,
        reason: 'ELECTION_STORE_WRITE_FAILED',
        applied: false,
        officeGranted: false,
        appointment: false,
        productionAuth: false,
        lock: 'single-process',
      };
    }
    try {
      if (opts.failRunWrite === true && result.runDirty === true) throw new Error('RUN_STORE_WRITE_FAILED');
      if (result.runDirty === true) writeStore(paths.run, runStore);
    } catch (err) {
      return {
        ok: false,
        reason: 'RUN_STORE_WRITE_FAILED',
        electionApplied: result.electionDirty === true,
        appliedRun: false,
        officeGranted: false,
        appointment: false,
        productionAuth: false,
        lock: 'single-process',
      };
    }
    return result;
  });
}

function advanceAndPersist(paths, input, options) {
  const src = input || {};
  const opts = options || {};
  return persist(paths, src, {
    failElectionWrite: opts.failElectionWrite === true && src.clockSource === 'test-fixture',
    failRunWrite: opts.failRunWrite === true && src.clockSource === 'test-fixture',
  }, advanceUnlocked);
}

function fileAndPersist(paths, input) {
  return persist(paths, input, {}, fileApplication);
}

function reviewAndPersist(paths, input) {
  return persist(paths, input, {}, reviewApplication);
}

function voteAndPersist(paths, input) {
  return persist(paths, input, {}, function (vacancyStore, electionStore, filingStore, runStore, src) {
    void vacancyStore;
    void filingStore;
    void runStore;
    return castUnlocked(electionStore, src);
  });
}

function publicRun(paths, ballotId, nowMs) {
  const vacancyStore = vacancy.readStore(paths.vacancy);
  const electionStore = election.readStore(paths.election);
  const runStore = readStore(paths.run);
  const removal = findRemoval(vacancyStore, ballotId);
  if (!removal) return null;
  const run = latestRun(runStore, ballotId);
  const office = findOffice(vacancyStore, removal.country, removal.territory);
  const view = run ? election.roundView(electionStore, run.filingRoundId) : null;
  const electionView = view && view.election ? election.publicElection(electionStore, view.election.id, nowMs) : null;
  return {
    ok: true,
    run: run,
    runs: runsFor(runStore, ballotId),
    applications: view ? view.applications : [],
    office: officeView(office),
    election: electionView,
    officeGranted: false,
    appointment: false,
    tieRule: false,
    productionAuth: false,
    lock: 'single-process',
  };
}

module.exports = {
  DAY_MS: DAY_MS,
  VACANT_MS: VACANT_MS,
  FILING_MS: FILING_MS,
  REFILING_MS: REFILING_MS,
  emptyStore: emptyStore,
  readStore: readStore,
  writeStore: writeStore,
  advanceAndPersist: advanceAndPersist,
  fileAndPersist: fileAndPersist,
  reviewAndPersist: reviewAndPersist,
  voteAndPersist: voteAndPersist,
  publicRun: publicRun,
  clockNow: clockNow,
};
