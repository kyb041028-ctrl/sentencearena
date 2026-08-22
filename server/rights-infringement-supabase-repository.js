'use strict';

const core = require('../shared/rights-infringement-core');

function wrap(error, code) {
  const err = new Error(code);
  err.code = code;
  err.cause = error;
  return err;
}

function fromDb(row) {
  if (!row) return null;
  const extra = row.extra && typeof row.extra === 'object' ? row.extra : {};
  return Object.assign({}, extra, {
    id: row.id,
    caseNumber: row.case_number,
    status: row.status,
    isFormal: !!row.is_formal,
    claimType: row.claim_type,
    claimantKind: row.claimant_kind,
    claimantName: row.claimant_name,
    claimantEmail: row.claimant_email,
    claimantUserId: row.claimant_user_id,
    representativeOf: row.representative_of,
    representativeRelation: row.representative_relation,
    representativeAuthority: row.representative_authority,
    targetKind: row.target_kind,
    postId: row.post_id,
    commentId: row.comment_id,
    targetUrl: row.target_url,
    targetAuthorUserId: row.target_author_user_id,
    problemExcerpt: row.problem_excerpt,
    claimedRight: row.claimed_right,
    infringementReason: row.infringement_reason,
    caseNarrative: row.case_narrative,
    requestedAction: row.requested_action,
    requestedActionDetail: row.requested_action_detail,
    evidenceDescription: row.evidence_description,
    evidenceUrl: row.evidence_url,
    truthConfirmed: !!row.truth_confirmed,
    abuseNoticeConfirmed: !!row.abuse_notice_confirmed,
    highRiskPrivacy: !!row.high_risk_privacy,
    deletedEvidenceId: row.deleted_evidence_id,
    targetSnapshot: row.target_snapshot,
    supplementNote: row.supplement_note,
    rejectionReason: row.rejection_reason,
    operatorNotes: row.operator_notes,
    tempTakedownAt: row.temp_takedown_at,
    tempTakedownUntil: row.temp_takedown_until,
    authorNotifiedAt: row.author_notified_at,
    authorObjectionDeadline: row.author_objection_deadline,
    authorObjectedAt: row.author_objected_at,
    formalizedAt: row.formalized_at,
    finalizedAt: row.finalized_at,
    retentionUntil: row.retention_until,
    legalHold: !!row.legal_hold,
    legalHoldReason: row.legal_hold_reason,
    lastAbuseAction: row.last_abuse_action,
    lastAbuseAt: row.last_abuse_at,
    reviewedBy: row.reviewed_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function extraFrom(row) {
  return {
    defamationStatement: row.defamationStatement || '',
    defamationRefersTo: row.defamationRefersTo || '',
    defamationNature: row.defamationNature || '',
    defamationFalsehood: row.defamationFalsehood || '',
    defamationHonorHarm: row.defamationHonorHarm || '',
    privacyInfoType: row.privacyInfoType || '',
    privacyWhose: row.privacyWhose || '',
    privacyLocation: row.privacyLocation || '',
    privacyBasis: row.privacyBasis || '',
    privacyConsent: row.privacyConsent || '',
    privacyHarm: row.privacyHarm || '',
    likenessWho: row.likenessWho || '',
    likenessRelation: row.likenessRelation || '',
    likenessSelfOrAgent: row.likenessSelfOrAgent || '',
    likenessPermitted: row.likenessPermitted || '',
    likenessInfringement: row.likenessInfringement || '',
    copyrightWork: row.copyrightWork || '',
    copyrightBasis: row.copyrightBasis || '',
    copyrightSource: row.copyrightSource || '',
    copyrightPortion: row.copyrightPortion || '',
    copyrightLicensed: row.copyrightLicensed || '',
    deletedPeriodApprox: row.deletedPeriodApprox || '',
    rememberedTitle: row.rememberedTitle || '',
    rememberedAuthor: row.rememberedAuthor || '',
    rememberedBody: row.rememberedBody || '',
    rememberedPhrase: row.rememberedPhrase || '',
    discoveredAt: row.discoveredAt || '',
  };
}

function toDb(row) {
  const src = row || {};
  return {
    case_number: src.caseNumber,
    status: src.status,
    is_formal: !!src.isFormal,
    claim_type: src.claimType,
    claimant_kind: src.claimantKind,
    claimant_name: src.claimantName,
    claimant_email: src.claimantEmail,
    claimant_user_id: src.claimantUserId || null,
    representative_of: src.representativeOf || null,
    representative_relation: src.representativeRelation || null,
    representative_authority: src.representativeAuthority || null,
    target_kind: src.targetKind,
    post_id: src.postId || null,
    comment_id: src.commentId || null,
    target_url: src.targetUrl || null,
    target_author_user_id: src.targetAuthorUserId || null,
    problem_excerpt: src.problemExcerpt,
    claimed_right: src.claimedRight,
    infringement_reason: src.infringementReason,
    case_narrative: src.caseNarrative,
    requested_action: src.requestedAction,
    requested_action_detail: src.requestedActionDetail || null,
    evidence_description: src.evidenceDescription || null,
    evidence_url: src.evidenceUrl || null,
    truth_confirmed: !!src.truthConfirmed,
    abuse_notice_confirmed: !!src.abuseNoticeConfirmed,
    extra: extraFrom(src),
    high_risk_privacy: !!src.highRiskPrivacy,
    deleted_evidence_id: src.deletedEvidenceId || null,
    target_snapshot: src.targetSnapshot || null,
    supplement_note: src.supplementNote || null,
    rejection_reason: src.rejectionReason || null,
    operator_notes: src.operatorNotes || null,
    temp_takedown_at: src.tempTakedownAt || null,
    temp_takedown_until: src.tempTakedownUntil || null,
    author_notified_at: src.authorNotifiedAt || null,
    author_objection_deadline: src.authorObjectionDeadline || null,
    author_objected_at: src.authorObjectedAt || null,
    formalized_at: src.formalizedAt || null,
    finalized_at: src.finalizedAt || null,
    retention_until: src.retentionUntil || null,
    legal_hold: !!src.legalHold,
    legal_hold_reason: src.legalHoldReason || null,
    last_abuse_action: src.lastAbuseAction || null,
    last_abuse_at: src.lastAbuseAt || null,
    reviewed_by: src.reviewedBy || null,
    updated_at: src.updatedAt || new Date().toISOString(),
  };
}

function createRightsInfringementSupabaseRepository(options) {
  const client = options && options.client;
  if (!client) throw new Error('SUPABASE_CLIENT_REQUIRED');

  async function insertRequest(row) {
    const payload = toDb(row);
    if (row.id) payload.id = row.id;
    payload.created_at = row.createdAt || new Date().toISOString();
    const { data, error } = await client
      .from('rights_infringement_requests')
      .insert(payload)
      .select('*')
      .single();
    if (error) throw wrap(error, 'RIGHTS_INSERT_FAILED');
    return fromDb(data);
  }

  async function updateRequest(id, patch) {
    const payload = toDb(patch);
    delete payload.created_at;
    const { data, error } = await client
      .from('rights_infringement_requests')
      .update(payload)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw wrap(error, 'RIGHTS_UPDATE_FAILED');
    return fromDb(data);
  }

  async function getRequest(id) {
    const { data, error } = await client
      .from('rights_infringement_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw wrap(error, 'RIGHTS_GET_FAILED');
    return fromDb(data);
  }

  async function getByCaseNumber(caseNumber) {
    const { data, error } = await client
      .from('rights_infringement_requests')
      .select('*')
      .eq('case_number', caseNumber)
      .maybeSingle();
    if (error) throw wrap(error, 'RIGHTS_GET_FAILED');
    return fromDb(data);
  }

  async function listRequests() {
    const { data, error } = await client
      .from('rights_infringement_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) throw wrap(error, 'RIGHTS_LIST_FAILED');
    return (data || []).map(fromDb);
  }

  async function findOpenDuplicate(input) {
    const src = input || {};
    let q = client.from('rights_infringement_requests').select('*').eq('claim_type', src.claimType);
    if (src.claimantUserId) q = q.eq('claimant_user_id', src.claimantUserId);
    else q = q.eq('claimant_email', src.claimantEmail);
    if (src.postId) q = q.eq('post_id', src.postId);
    if (src.commentId) q = q.eq('comment_id', src.commentId);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(20);
    if (error) throw wrap(error, 'RIGHTS_DUP_LOOKUP_FAILED');
    const key = core.duplicateKey(src);
    const rows = (data || []).map(fromDb);
    for (let i = 0; i < rows.length; i++) {
      if (!core.isOpenStatus(rows[i].status)) continue;
      if (core.duplicateKey(rows[i]) === key) return rows[i];
    }
    return null;
  }

  async function findLatestSame(input) {
    const src = input || {};
    let q = client.from('rights_infringement_requests').select('*').eq('claim_type', src.claimType);
    if (src.claimantUserId) q = q.eq('claimant_user_id', src.claimantUserId);
    else q = q.eq('claimant_email', src.claimantEmail);
    if (src.postId) q = q.eq('post_id', src.postId);
    if (src.commentId) q = q.eq('comment_id', src.commentId);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(20);
    if (error) throw wrap(error, 'RIGHTS_DUP_LOOKUP_FAILED');
    const key = core.duplicateKey(src);
    const rows = (data || []).map(fromDb);
    for (let i = 0; i < rows.length; i++) {
      if (core.duplicateKey(rows[i]) === key) return rows[i];
    }
    return null;
  }

  async function listAuthorNotices(authorUserId) {
    const { data, error } = await client
      .from('rights_infringement_requests')
      .select('*')
      .eq('target_author_user_id', authorUserId)
      .not('temp_takedown_at', 'is', null)
      .order('temp_takedown_at', { ascending: false });
    if (error) throw wrap(error, 'RIGHTS_NOTICE_LIST_FAILED');
    return (data || []).map(fromDb);
  }

  async function insertEvent(row) {
    const { data, error } = await client
      .from('rights_infringement_events')
      .insert({
        request_id: row.requestId,
        actor_kind: row.actorKind,
        actor_user_id: row.actorUserId || null,
        action: row.action,
        note: row.note || null,
      })
      .select('*')
      .single();
    if (error) throw wrap(error, 'RIGHTS_EVENT_INSERT_FAILED');
    return {
      id: data.id,
      requestId: data.request_id,
      actorKind: data.actor_kind,
      actorUserId: data.actor_user_id,
      action: data.action,
      note: data.note,
      createdAt: data.created_at,
    };
  }

  async function listEvents(requestId) {
    const { data, error } = await client
      .from('rights_infringement_events')
      .select('*')
      .eq('request_id', requestId)
      .order('created_at', { ascending: true });
    if (error) throw wrap(error, 'RIGHTS_EVENT_LIST_FAILED');
    return (data || []).map(function (row) {
      return {
        id: row.id,
        requestId: row.request_id,
        actorKind: row.actor_kind,
        actorUserId: row.actor_user_id,
        action: row.action,
        note: row.note,
        createdAt: row.created_at,
      };
    });
  }

  async function insertObjection(row) {
    const { data, error } = await client
      .from('rights_infringement_objections')
      .insert({
        request_id: row.requestId,
        author_user_id: row.authorUserId || null,
        ground: row.ground,
        explanation: row.explanation,
      })
      .select('*')
      .single();
    if (error) throw wrap(error, 'RIGHTS_OBJECTION_INSERT_FAILED');
    return {
      id: data.id,
      requestId: data.request_id,
      authorUserId: data.author_user_id,
      ground: data.ground,
      explanation: data.explanation,
      createdAt: data.created_at,
    };
  }

  async function listObjections(requestId) {
    const { data, error } = await client
      .from('rights_infringement_objections')
      .select('*')
      .eq('request_id', requestId)
      .order('created_at', { ascending: true });
    if (error) throw wrap(error, 'RIGHTS_OBJECTION_LIST_FAILED');
    return (data || []).map(function (row) {
      return {
        id: row.id,
        requestId: row.request_id,
        authorUserId: row.author_user_id,
        ground: row.ground,
        explanation: row.explanation,
        createdAt: row.created_at,
      };
    });
  }

  async function getAbuseState(userId) {
    const { data, error } = await client
      .from('rights_infringement_abuse_state')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw wrap(error, 'RIGHTS_ABUSE_GET_FAILED');
    if (!data) {
      return {
        userId: userId,
        warningCount: 0,
        restrictionKind: core.ABUSE_RESTRICTION.NONE,
        restrictedUntil: null,
        lastAbuseAt: null,
      };
    }
    return {
      userId: data.user_id,
      warningCount: data.warning_count,
      restrictionKind: data.restriction_kind,
      restrictedUntil: data.restricted_until,
      lastAbuseAt: data.last_abuse_at,
    };
  }

  async function upsertAbuseState(row) {
    const { data, error } = await client
      .from('rights_infringement_abuse_state')
      .upsert({
        user_id: row.userId,
        warning_count: row.warningCount || 0,
        restriction_kind: row.restrictionKind || core.ABUSE_RESTRICTION.NONE,
        restricted_until: row.restrictedUntil || null,
        last_abuse_at: row.lastAbuseAt || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      .select('*')
      .single();
    if (error) throw wrap(error, 'RIGHTS_ABUSE_UPSERT_FAILED');
    return {
      userId: data.user_id,
      warningCount: data.warning_count,
      restrictionKind: data.restriction_kind,
      restrictedUntil: data.restricted_until,
      lastAbuseAt: data.last_abuse_at,
    };
  }

  async function deleteExpired(nowIso) {
    const { data, error } = await client
      .from('rights_infringement_requests')
      .select('id, status, retention_until, legal_hold, is_formal');
    if (error) throw wrap(error, 'RIGHTS_PURGE_LIST_FAILED');
    let n = 0;
    const rows = data || [];
    for (let i = 0; i < rows.length; i++) {
      const mapped = fromDb(rows[i]);
      if (!core.shouldPurge(mapped, nowIso)) continue;
      const del = await client.from('rights_infringement_requests').delete().eq('id', mapped.id);
      if (!del.error) n += 1;
    }
    return n;
  }

  return {
    insertRequest: insertRequest,
    updateRequest: updateRequest,
    getRequest: getRequest,
    getByCaseNumber: getByCaseNumber,
    listRequests: listRequests,
    findOpenDuplicate: findOpenDuplicate,
    findLatestSame: findLatestSame,
    listAuthorNotices: listAuthorNotices,
    insertEvent: insertEvent,
    listEvents: listEvents,
    insertObjection: insertObjection,
    listObjections: listObjections,
    getAbuseState: getAbuseState,
    upsertAbuseState: upsertAbuseState,
    deleteExpired: deleteExpired,
  };
}

module.exports = {
  createRightsInfringementSupabaseRepository: createRightsInfringementSupabaseRepository,
};
