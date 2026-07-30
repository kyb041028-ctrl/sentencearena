'use strict';

const orchestrator = require('./user-event-orchestrator');
const memoryRepo = require('./user-event-memory-repository');

let _repo = memoryRepo;

function setRepository(repo) {
  _repo = repo || memoryRepo;
  orchestrator.setRepository(_repo);
}

function setDataMode(mode) {
  orchestrator.setDataMode(mode);
}

function getDataMode() {
  return orchestrator.getDataMode();
}

function isActivated() {
  return orchestrator.isActivated();
}

async function processDomainEvent(event, options) {
  if (isActivated()) {
    const err = new Error('USER_EVENT_API_NOT_ACTIVATED');
    err.code = 'USER_EVENT_API_NOT_ACTIVATED';
    throw err;
  }
  return orchestrator.processUserDomainEvent(event, options);
}

async function healthCheck() {
  return orchestrator.healthCheck();
}

module.exports = {
  setRepository,
  setDataMode,
  getDataMode,
  isActivated,
  processDomainEvent,
  healthCheck,
};
