/**
 * 선거 자격은 서버가 가진 회원 명단만 본다.
 * 클라이언트의 대표 깃발과 인구수는 쓰지 않는다.
 * profiles.territory 인원수, 가짜 영토 인원, 운영 인증, 운영 데이터베이스는 여기서 열지 않는다.
 * user_progression.citizen_rank 는 확정 계급이 아니므로 읽거나 쓰지 않는다.
 */
'use strict';

const rank = require('../shared/dec023-rank-evaluation-core');
const territory = require('../shared/canonical-user-territory-core');

const TERRITORY_FROM_PROFILE = Object.freeze({
  PIONEER: 'pioneer',
  GUARDIAN: 'guardian',
  CENTRAL: 'central',
  ALIEN: 'alien',
});

function normalizeTerritory(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (TERRITORY_FROM_PROFILE[raw.toUpperCase()]) return TERRITORY_FROM_PROFILE[raw.toUpperCase()];
  return raw.toLowerCase();
}

function directoryError(directory) {
  if (!directory) return 'MEMBER_DIRECTORY_MISSING';
  const source = String(directory.source || '');
  if (source === 'production' || source === 'supabase' || source === 'profiles.territory' || source === 'legacy-mock') {
    return 'MEMBER_SOURCE_NOT_CONNECTED';
  }
  if (source === 'client' || directory.clientIsRepresentative != null || directory.populationCount != null) {
    return 'CLIENT_MEMBER_DATA_IGNORED';
  }
  if (source !== 'rank-store' && source !== 'server-profile-read') return 'MEMBER_SOURCE_NOT_CONNECTED';
  if (!Array.isArray(directory.members)) return 'MEMBER_DIRECTORY_MISSING';
  return null;
}

function membersIn(directory, country, territory) {
  return directory.members.filter(function (member) {
    return member && String(member.country || '') === country && normalizeTerritory(member.territory) === territory;
  });
}

function representativeStatus(directory, input) {
  const src = input || {};
  const broken = directoryError(directory);
  if (broken) return { ok: false, reason: broken, productionAuth: false };
  const personId = String(src.personId || '').trim();
  const country = String(src.country || '');
  const territory = normalizeTerritory(src.territory);
  const member = membersIn(directory, country, territory).filter(function (row) {
    return String(row.id) === personId;
  })[0];
  if (!member) return { ok: false, reason: 'REPRESENTATIVE_STATUS_MISSING', productionAuth: false };
  if (directory.source === 'server-profile-read' && member.rankSource !== 'rank-store') {
    return { ok: false, reason: 'CITIZEN_RANK_POLICY_NOT_FINALIZED', productionAuth: false };
  }
  if (member.rank === 'leader') return { ok: false, reason: 'LEADER_OUTSIDE_CAP', productionAuth: false };
  if (member.rank !== 'representative') return { ok: false, reason: 'NOT_REPRESENTATIVE', productionAuth: false };
  return { ok: true, personId: personId, country: country, territory: territory, productionAuth: false };
}

function project(directory, country, territory) {
  const broken = directoryError(directory);
  if (broken) return { ok: false, reason: broken, productionAuth: false };
  const scoped = membersIn(directory, country, territory);
  const representatives = scoped.filter(function (member) {
    if (member.rank !== 'representative') return false;
    if (directory.source === 'server-profile-read' && member.rankSource !== 'rank-store') return false;
    return true;
  });
  if (representatives.length > 10) {
    return { ok: false, reason: 'REPRESENTATIVE_CAP', productionAuth: false };
  }
  const leader = scoped.filter(function (member) {
    if (member.rank !== 'leader') return false;
    if (directory.source === 'server-profile-read' && member.rankSource !== 'rank-store') return false;
    return true;
  });
  if (leader.length > 1) return { ok: false, reason: 'LEADER_EXISTS', productionAuth: false };
  const leaderId = leader.length === 1 ? String(leader[0].id) : null;
  if (leaderId && representatives.some(function (member) { return String(member.id) === leaderId; })) {
    return { ok: false, reason: 'LEADER_OUTSIDE_CAP', productionAuth: false };
  }
  return {
    ok: true,
    representativeIds: representatives.map(function (member) { return String(member.id); }),
    leaderId: leaderId,
    populationRecords: scoped.map(function (member) {
      return {
        id: String(member.id),
        country: country,
        territory: territory,
        valid: member.valid === true,
        lastPostAtMs: member.lastPostAtMs != null ? Number(member.lastPostAtMs) : null,
        lastCommentAtMs: member.lastCommentAtMs != null ? Number(member.lastCommentAtMs) : null,
      };
    }),
    productionAuth: false,
    canonicalTerritorySource: territory.CURRENT_TERRITORY_CANONICAL_SOURCE,
    usedProfileTerritoryCount: false,
    usedCitizenRankColumn: false,
  };
}

function validPopulationCount(directory, country, territory, nowMs) {
  const projected = project(directory, country, territory);
  if (!projected.ok) return projected;
  if (!projected.populationRecords.length) return { ok: false, reason: 'POPULATION_NOT_STORED', count: null, productionAuth: false };
  const counted = rank.countValidPopulation({
    country: country,
    territory: territory,
    asOfMs: nowMs,
    records: projected.populationRecords,
  });
  if (!counted.ok) return { ok: false, reason: counted.reason, count: null, productionAuth: false };
  if (!counted.count) return { ok: false, reason: 'POPULATION_NOT_STORED', count: 0, productionAuth: false };
  return { ok: true, count: counted.count, productionAuth: false };
}

function populationGate(projected, nowMs) {
  if (!projected || projected.ok !== true) return projected || { ok: false, reason: 'MEMBER_DIRECTORY_MISSING' };
  if (!projected.populationRecords.length) return { ok: false, reason: 'POPULATION_NOT_STORED', productionAuth: false };
  const counted = rank.countValidPopulation({
    country: projected.populationRecords[0].country,
    territory: projected.populationRecords[0].territory,
    asOfMs: nowMs,
    records: projected.populationRecords,
  });
  if (!counted.ok) return { ok: false, reason: counted.reason, productionAuth: false };
  const gate = rank.leaderElectionOpen(counted.count);
  if (!gate.ok) return { ok: false, reason: gate.reason, productionAuth: false };
  if (!gate.open) return { ok: false, reason: 'POPULATION_BELOW_1000', count: counted.count, productionAuth: false };
  return { ok: true, count: counted.count, productionAuth: false };
}

function voterStatus(directory, input) {
  const src = input || {};
  const broken = directoryError(directory);
  if (broken) return { ok: false, reason: broken, productionAuth: false };
  const personId = String(src.personId || '').trim();
  const country = String(src.country || '');
  const territory = normalizeTerritory(src.territory);
  const member = membersIn(directory, country, territory).filter(function (row) {
    return String(row.id) === personId;
  })[0];
  if (!member || member.valid !== true) {
    return { ok: false, reason: 'VOTER_NOT_ELIGIBLE', productionAuth: false };
  }
  const counted = rank.countValidPopulation({
    country: country,
    territory: territory,
    asOfMs: src.nowMs,
    records: [{
      id: personId,
      country: country,
      territory: territory,
      valid: true,
      lastPostAtMs: member.lastPostAtMs,
      lastCommentAtMs: member.lastCommentAtMs,
    }],
  });
  if (!counted.ok || counted.count !== 1) return { ok: false, reason: 'VOTER_NOT_ELIGIBLE', productionAuth: false };
  return { ok: true, personId: personId, productionAuth: false };
}

function sessionVoter(input) {
  const src = input || {};
  const requested = String(src.voterId || src.actor || '').trim();
  if (src.sessionRequired !== true) {
    return { ok: true, voterId: requested, productionAuth: false, liveAuth: false };
  }
  const sessionUserId = String(src.sessionUserId || '').trim();
  if (!sessionUserId) {
    return { ok: false, reason: 'AUTH_NOT_CONNECTED', stored: false, productionAuth: false, usedBodyId: false };
  }
  if (requested && requested !== sessionUserId) {
    return { ok: false, reason: 'PROXY_VOTE_FORBIDDEN', stored: false, productionAuth: false, usedBodyId: false };
  }
  return { ok: true, voterId: sessionUserId, productionAuth: false, liveAuth: false };
}

function syncRankMember(member, action) {
  if (!member) return { ok: false, reason: 'MEMBER_DIRECTORY_MISSING' };
  const stats = {
    xp: member.xp,
    fame: member.fame,
    achievements: member.achievements,
  };
  if (action === 'appoint') {
    if (member.rank !== 'representative') return { ok: false, reason: 'NOT_REPRESENTATIVE', member: member };
    member.rank = 'leader';
    member.electedLeader = true;
    member.excludedFromRepresentativeQuota = true;
    member.leaderOffice = true;
  } else if (action === 'remove') {
    member.rank = 'citizen';
    member.electedLeader = false;
    member.excludedFromRepresentativeQuota = false;
    member.leaderOffice = false;
    member.autoReturnRepresentative = false;
  } else {
    return { ok: false, reason: 'RANK_ACTION_UNKNOWN', member: member };
  }
  member.xp = stats.xp;
  member.fame = stats.fame;
  member.achievements = stats.achievements;
  member.citizenRankColumnWritten = false;
  return { ok: true, member: member, statsKept: true };
}

function connectionReport() {
  return {
    profilesTerritory: 'NOT_CONNECTED',
    profileTerritoryCount: 'NOT_CONNECTED',
    userProgressionCitizenRank: 'NOT_CONNECTED',
    supabaseAuth: 'NOT_CONNECTED',
    productionDatabase: 'NOT_CONNECTED',
    rankStoreDirectory: 'DEV_CONNECTED_WHEN_PROVIDED',
    auxiliarySeatTable: 'TEST_ONLY_NOT_MEMBER_SOURCE',
    auxiliaryPopulationTable: 'TEST_ONLY_NOT_MEMBER_SOURCE',
    jsonPath: 'REGRESSION_DEFAULT',
    postgresSwitch: 'EXPLICIT_ISOLATED_FLAG_ONLY',
  };
}

module.exports = {
  representativeStatus: representativeStatus,
  project: project,
  validPopulationCount: validPopulationCount,
  populationGate: populationGate,
  voterStatus: voterStatus,
  sessionVoter: sessionVoter,
  syncRankMember: syncRankMember,
  connectionReport: connectionReport,
  normalizeTerritory: normalizeTerritory,
};
