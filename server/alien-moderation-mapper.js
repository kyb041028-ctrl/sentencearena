'use strict';

const modCore = require('../shared/alien-moderation-core');

function mapStateForSelf(state) {
  if (!state) return null;
  return {
    userId: state.userId,
    status: state.status,
    strikeCount: state.strikeCount,
    enteredAt: state.enteredAt,
    releaseEligibleAt: state.releaseEligibleAt,
    seasonReleaseKey: state.seasonReleaseKey,
    currentRestriction: state.currentRestriction,
    canReturn: state.canReturn,
    returnStatus: state.returnStatus,
    entryReasonCodes: Array.isArray(state.entryReasonCodes) ? state.entryReasonCodes.slice() : [],
    operatorAssigned: !!state.operatorAssigned,
    operatorNoteAvailable: false,
    dataStatus: state.dataStatus,
    updatedAt: state.updatedAt,
  };
}

function mapStateForPublic(state) {
  return modCore.sanitizePublicModerationView(state);
}

function mapStateForOperator(state) {
  if (!state) return null;
  const self = mapStateForSelf(state);
  return Object.assign({}, self, {
    operatorHoldVisible: true,
    note: 'OPERATOR_INTERNAL_FIELDS_MINIMAL',
  });
}

function mapEventForSelf(event) {
  if (!event) return null;
  return {
    eventType: event.eventType || event.event_type,
    previousStatus: event.previousStatus || event.previous_status,
    nextStatus: event.nextStatus || event.next_status,
    createdAt: event.createdAt || event.created_at,
    reasonCodesPublic: [],
  };
}

module.exports = {
  mapStateForSelf,
  mapStateForPublic,
  mapStateForOperator,
  mapEventForSelf,
};
