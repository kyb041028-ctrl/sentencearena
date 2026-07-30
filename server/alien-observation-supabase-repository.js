'use strict';

async function getSourcePost() {
  return null;
}

async function listEarthComments() {
  return [];
}

async function listAlienComments() {
  return [];
}

async function createAlienComment() {
  return { ok: false, error: 'ALIEN_OBSERVATION_WRITE_DISABLED' };
}

async function listTerritoryObservationCandidates() {
  return { items: [], note: 'NOT_CONNECTED' };
}

async function listFreePlazaPosts() {
  return [];
}

async function createFreePlazaPost() {
  return { ok: false, error: 'ALIEN_FREE_PLAZA_WRITE_DISABLED' };
}

async function healthCheck() {
  return { ok: true, backend: 'supabase-stub', persistEnabled: false };
}

module.exports = {
  getSourcePost,
  listEarthComments,
  listAlienComments,
  createAlienComment,
  listTerritoryObservationCandidates,
  listFreePlazaPosts,
  createFreePlazaPost,
  healthCheck,
};
