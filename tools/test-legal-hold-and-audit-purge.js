#!/usr/bin/env node
'use strict';

/**
 * DEC-021 legal_hold + DEC-020 admin audit 1y purge unit tests.
 * No Production writes. No political alignment simulation files.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

const core = require('../shared/retention-policy-core');
const retention = require('../server/retention-service');
const { createRetentionMemoryRepository } = require('../server/retention-memory-repository');
const { mountRetentionAdminRoutes } = require('../server/retention-admin-routes');
const auditService = require('../server/admin-moderation-audit-service');
const { createAdminModerationAuditMemoryRepository } = require('../server/admin-moderation-audit-memory-repository');
const rightsService = require('../server/rights-infringement-service');
const { createRightsInfringementMemoryRepository } = require('../server/rights-infringement-memory-repository');
const { requestApp } = require('./daily-issue-api-http-helper');
const { createAdminAccessGuard } = require('../server/daily-issue-admin-auth');

const root = path.join(__dirname, '..');
let passed = 0;

function ok(name, cond, detail) {
  assert.ok(cond, name + (detail ? ' — ' + detail : ''));
  passed += 1;
  console.log('PASS', name);
}

function uid(n) {
  const hex = String(n).padStart(8, '0');
  return hex + '-0000-4000-8000-000000000000';
}

function makeApp(roleMap) {
  const app = express();
  app.use(express.json());
  const users = roleMap || {};
  app.use(
    '/api/admin/retention',
    mountRetentionAdminRoutes({
      adminAuth: {
        supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'anon-test',
        getUserFromAccessToken: async function (token) {
          const u = users[token];
          if (!u) return null;
          return {
            id: u.id,
            email: u.email || 'x@example.com',
            app_metadata: { role: u.role },
          };
        },
      },
    }),
  );
  return app;
}

async function main() {
  const store = createRetentionMemoryRepository();
  retention.setRepository(store);
  retention.setNow(function () { return new Date('2026-09-06T00:00:00.000Z'); });

  const auditRepo = createAdminModerationAuditMemoryRepository();
  auditService.setRepository(auditRepo);
  retention.setAdminAuditHoldAdapter({
    setLegalHold: function (input) { return auditService.setLegalHold(input); },
    getLegalHold: function (id) { return auditService.getLegalHold(id); },
  });
  retention.setAdminAuditPurger(function (nowIso) {
    return auditService.purgeExpired(nowIso);
  });

  const rightsRepo = createRightsInfringementMemoryRepository();
  rightsService.setRepository(rightsRepo);
  retention.setRightsHoldAdapter({
    setLegalHold: function (input) { return rightsService.setLegalHold(input); },
    getLegalHold: function (id) { return rightsService.getLegalHold(id); },
  });

  ok('DEC-021 constants', core.LEGAL_HOLD_RELEASE_GRACE_DAYS === 7 && core.ADMIN_AUDIT_RETENTION_YEARS === 1);
  ok('reason required', core.normalizeLegalHoldReason('').ok === false);

  // A. Auth matrix
  const ownerTok = 'owner-token';
  const adminTok = 'admin-token';
  const memberTok = 'member-token';
  const app = makeApp({
    [ownerTok]: { id: uid(1), role: 'OWNER' },
    [adminTok]: { id: uid(2), role: 'ADMIN' },
    [memberTok]: { id: uid(3), role: 'MEMBER' },
  });

  const ev = await store.upsertDeletedEvidence({
    contentKind: 'POST',
    sourceContentId: uid(10),
    body: 'held body',
    deletedAt: '2026-01-01T00:00:00.000Z',
    retentionUntil: '2026-07-01T00:00:00.000Z',
    legalHold: false,
  });

  const guest = await requestApp(app, 'POST', '/api/admin/retention/legal-hold', {
    body: { targetType: 'EVIDENCE', targetId: ev.row.id, hold: true, reason: 'case' },
  });
  ok('A. Guest → 401', guest.status === 401);

  const member = await requestApp(app, 'POST', '/api/admin/retention/legal-hold', {
    headers: { Authorization: 'Bearer ' + memberTok },
    body: { targetType: 'EVIDENCE', targetId: ev.row.id, hold: true, reason: 'case' },
  });
  ok('A. MEMBER → 403', member.status === 403);

  const adminSet = await requestApp(app, 'POST', '/api/admin/retention/legal-hold', {
    headers: { Authorization: 'Bearer ' + adminTok },
    body: { targetType: 'EVIDENCE', targetId: ev.row.id, hold: true, reason: 'case' },
  });
  ok('A. ADMIN set → 403', adminSet.status === 403);

  const noReason = await requestApp(app, 'POST', '/api/admin/retention/legal-hold', {
    headers: { Authorization: 'Bearer ' + ownerTok },
    body: { targetType: 'EVIDENCE', targetId: ev.row.id, hold: true, reason: '' },
  });
  ok('A. reason 없음 → reject', noReason.status === 400 && noReason.body && noReason.body.error === 'LEGAL_HOLD_REASON_REQUIRED');

  const ownerSet = await requestApp(app, 'POST', '/api/admin/retention/legal-hold', {
    headers: { Authorization: 'Bearer ' + ownerTok },
    body: { targetType: 'EVIDENCE', targetId: ev.row.id, hold: true, reason: '소송 보전' },
  });
  ok('A. OWNER set → PASS', ownerSet.status === 200 && ownerSet.body && ownerSet.body.ok && ownerSet.body.legalHold === true);

  const ownerSetAgain = await requestApp(app, 'POST', '/api/admin/retention/legal-hold', {
    headers: { Authorization: 'Bearer ' + ownerTok },
    body: { targetType: 'EVIDENCE', targetId: ev.row.id, hold: true, reason: '소송 보전 재요청' },
  });
  ok('A. 중복 HOLD_SET 멱등', ownerSetAgain.status === 200 && ownerSetAgain.body && ownerSetAgain.body.idempotent === true);

  const adminRelease = await requestApp(app, 'POST', '/api/admin/retention/legal-hold', {
    headers: { Authorization: 'Bearer ' + adminTok },
    body: { targetType: 'EVIDENCE', targetId: ev.row.id, hold: false, reason: '해제시도' },
  });
  ok('A. ADMIN release → 403', adminRelease.status === 403);

  const ownerRelease = await requestApp(app, 'POST', '/api/admin/retention/legal-hold', {
    headers: { Authorization: 'Bearer ' + ownerTok },
    body: { targetType: 'EVIDENCE', targetId: ev.row.id, hold: false, reason: '보전 종료' },
  });
  ok('A. OWNER release → PASS', ownerRelease.status === 200 && ownerRelease.body && ownerRelease.body.ok);

  const ownerReleaseAgain = await requestApp(app, 'POST', '/api/admin/retention/legal-hold', {
    headers: { Authorization: 'Bearer ' + ownerTok },
    body: { targetType: 'EVIDENCE', targetId: ev.row.id, hold: false, reason: '보전 종료 재호출' },
  });
  ok('A. 중복 HOLD_RELEASE 멱등', ownerReleaseAgain.status === 200 && ownerReleaseAgain.body && ownerReleaseAgain.body.idempotent === true);

  // B/C Hold / Release grace for evidence
  const futureEv = await store.upsertDeletedEvidence({
    contentKind: 'POST',
    sourceContentId: uid(11),
    body: 'future',
    deletedAt: '2026-01-01T00:00:00.000Z',
    retentionUntil: '2027-05-01T00:00:00.000Z',
    legalHold: false,
  });
  await retention.setLegalHold({ targetType: 'EVIDENCE', targetId: futureEv.row.id }, true, 'hold-future');
  let purged = await retention.purgeExpired('2027-06-01T00:00:00.000Z');
  ok('B. hold 대상은 만료돼도 purge 안 됨', !!(await store.getEvidenceById(futureEv.row.id)));

  const expiredNoHold = await store.upsertDeletedEvidence({
    contentKind: 'POST',
    sourceContentId: uid(12),
    body: 'expired',
    deletedAt: '2025-01-01T00:00:00.000Z',
    retentionUntil: '2025-07-01T00:00:00.000Z',
    legalHold: false,
  });
  purged = await retention.purgeExpired('2026-09-06T00:00:00.000Z');
  ok('B. hold 없는 만료 대상은 purge', !(await store.getEvidenceById(expiredNoHold.row.id)));

  const notYet = await store.upsertDeletedEvidence({
    contentKind: 'POST',
    sourceContentId: uid(13),
    body: 'not-yet',
    deletedAt: '2026-08-01T00:00:00.000Z',
    retentionUntil: '2027-02-01T00:00:00.000Z',
    legalHold: false,
  });
  purged = await retention.purgeExpired('2026-09-06T00:00:00.000Z');
  ok('B. 아직 안 만료된 대상은 purge 안 됨', !!(await store.getEvidenceById(notYet.row.id)));

  // Case A: original future kept
  retention.setNow(function () { return new Date('2027-01-01T00:00:00.000Z'); });
  await retention.setLegalHold({ targetType: 'EVIDENCE', targetId: futureEv.row.id }, false, 'release-future');
  const afterA = await store.getEvidenceById(futureEv.row.id);
  ok('C. 원래 기한 미래 → 원래 기한 유지', afterA && afterA.retentionUntil === '2027-05-01T00:00:00.000Z');

  // Case B: original past → release+7d
  const pastEv = await store.upsertDeletedEvidence({
    contentKind: 'POST',
    sourceContentId: uid(14),
    body: 'past',
    deletedAt: '2025-01-01T00:00:00.000Z',
    retentionUntil: '2027-01-01T00:00:00.000Z',
    legalHold: false,
  });
  await retention.setLegalHold({ targetType: 'EVIDENCE', targetId: pastEv.row.id }, true, 'hold-past');
  retention.setNow(function () { return new Date('2027-03-01T00:00:00.000Z'); });
  await retention.setLegalHold({ targetType: 'EVIDENCE', targetId: pastEv.row.id }, false, 'release-past');
  const afterB = await store.getEvidenceById(pastEv.row.id);
  ok('C. 원래 기한 지남 → release+7일', afterB && afterB.retentionUntil === core.addUtcDays('2027-03-01T00:00:00.000Z', 7));
  purged = await retention.purgeExpired('2027-03-05T00:00:00.000Z');
  ok('C. 7일 전 purge 안 됨', !!(await store.getEvidenceById(pastEv.row.id)));
  purged = await retention.purgeExpired('2027-03-09T00:00:00.000Z');
  ok('C. 7일 후 purge 됨', !(await store.getEvidenceById(pastEv.row.id)));

  // D. Admin audit
  const young = await auditRepo.insertEvent({
    actorUserId: uid(1),
    actionType: 'POST_SOFT_DELETE',
    targetType: 'POST',
    targetId: uid(20),
    reasonCode: 'abuse',
    operatorNote: 'young',
  });
  auditRepo._debug.events.filter(function (e) { return e.id === young.id; })[0].createdAt = '2026-06-01T00:00:00.000Z';

  const old = await auditRepo.insertEvent({
    actorUserId: uid(1),
    actionType: 'POST_SOFT_DELETE',
    targetType: 'POST',
    targetId: uid(21),
    reasonCode: 'spam',
    operatorNote: 'old',
  });
  auditRepo._debug.events.filter(function (e) { return e.id === old.id; })[0].createdAt = '2025-01-01T00:00:00.000Z';

  const heldAudit = await auditRepo.insertEvent({
    actorUserId: uid(1),
    actionType: 'POST_RESTORE',
    targetType: 'POST',
    targetId: uid(22),
    reasonCode: 'OPERATOR_CORRECTION',
    operatorNote: 'held',
  });
  auditRepo._debug.events.filter(function (e) { return e.id === heldAudit.id; })[0].createdAt = '2024-01-01T00:00:00.000Z';
  await auditService.setLegalHold({
    auditEventId: heldAudit.id,
    hold: true,
    reason: '수사 요청',
    actorUserId: uid(1),
    nowIso: '2026-09-06T00:00:00.000Z',
  });

  const graceAudit = await auditRepo.insertEvent({
    actorUserId: uid(1),
    actionType: 'SANCTION_APPLIED',
    targetType: 'POST',
    targetId: uid(23),
    reasonCode: 'abuse',
    operatorNote: 'grace',
  });
  auditRepo._debug.events.filter(function (e) { return e.id === graceAudit.id; })[0].createdAt = '2024-06-01T00:00:00.000Z';
  await auditService.setLegalHold({
    auditEventId: graceAudit.id,
    hold: true,
    reason: 'hold then release',
    actorUserId: uid(1),
    nowIso: '2026-08-01T00:00:00.000Z',
  });
  await auditService.setLegalHold({
    auditEventId: graceAudit.id,
    hold: false,
    reason: 'release for grace',
    actorUserId: uid(1),
    nowIso: '2026-09-03T00:00:00.000Z',
  });

  purged = await retention.purgeExpired('2026-09-06T00:00:00.000Z');
  const ids = auditRepo._debug.events.map(function (e) { return e.id; });
  ok('D. created_at 1년 미만 → 유지', ids.indexOf(young.id) !== -1);
  ok('D. 1년 초과 + hold 없음 → purge', ids.indexOf(old.id) === -1 && purged.counts.audit >= 1);
  ok('D. 1년 초과 + active hold → 유지', ids.indexOf(heldAudit.id) !== -1);
  ok('D. 1년 초과 + release 7일 미만 → 유지', ids.indexOf(graceAudit.id) !== -1);

  purged = await retention.purgeExpired('2026-09-11T00:00:00.000Z');
  const ids2 = auditRepo._debug.events.map(function (e) { return e.id; });
  ok('D. 1년 초과 + release 7일 초과 → purge', ids2.indexOf(graceAudit.id) === -1 && purged.counts.audit >= 1);

  // E. append-only
  let updateBlocked = false;
  try {
    await auditRepo.updateEvent();
  } catch (e) {
    updateBlocked = e && e.code === 'ADMIN_AUDIT_APPEND_ONLY';
  }
  ok('E. 직접 UPDATE 실패', updateBlocked);
  let deleteBlocked = false;
  try {
    await auditRepo.deleteEvent();
  } catch (e) {
    deleteBlocked = e && e.code === 'ADMIN_AUDIT_APPEND_ONLY';
  }
  ok('E. 직접 DELETE 실패', deleteBlocked);
  ok('E. controlled purge만 삭제 가능', typeof auditRepo.purgeExpired === 'function');

  // Sanction persistence path
  const san = await store.insertSanctionRecord({
    userId: uid(30),
    sanctionType: 'WRITE_RESTRICT_24H',
    endsAt: '2025-01-01T00:00:00.000Z',
    retentionUntil: '2026-01-01T00:00:00.000Z',
    permanent: false,
    legalHold: false,
  });
  await retention.setLegalHold({ targetType: 'SANCTION', targetId: san.row.id }, true, 'sanction hold');
  purged = await retention.purgeExpired('2026-09-06T00:00:00.000Z');
  ok('제재 hold 중 purge 제외', !!(await store.getSanctionRecord(san.row.id)) && purged.counts.sanctions === 0);

  // Rights case hold
  const rightsRow = await rightsRepo.insertRequest({
    id: uid(40),
    caseNumber: 'RI-TEST-1',
    status: 'INTAKE_REJECTED',
    retentionUntil: '2020-01-01T00:00:00.000Z',
    legalHold: false,
    isFormal: false,
    claimType: 'DEFAMATION',
    claimantKind: 'SELF',
    claimantName: 'x',
    claimantEmail: 'x@example.com',
    targetKind: 'POST',
    problemExcerpt: 'excerpt',
    claimedRight: 'honor',
    infringementReason: 'reason',
    caseNarrative: 'narrative long enough',
    requestedAction: 'DELETE',
    truthConfirmed: true,
    abuseNoticeConfirmed: true,
    createdAt: '2019-01-01T00:00:00.000Z',
    updatedAt: '2019-01-01T00:00:00.000Z',
  });
  await retention.setLegalHold({ targetType: 'RIGHTS_CASE', targetId: rightsRow.id }, true, 'rights hold');
  const rightsPurge = await rightsService.purgeExpired('2026-09-06T00:00:00.000Z');
  ok('권리침해 hold 중 purge 제외', !!(await rightsRepo.getRequest(rightsRow.id)) && (rightsPurge.deleted || 0) === 0);

  // Report hold keeps retentionUntil
  await store.upsertReportRetention(uid(50), {
    status: 'RESOLVED',
    finalizedAt: '2025-01-01T00:00:00.000Z',
    retentionUntil: '2026-01-01T00:00:00.000Z',
    legalHold: false,
  });
  await retention.setLegalHold({ targetType: 'REPORT', targetId: uid(50) }, true, 'report hold');
  const reportHeld = await store.getReportRetention(uid(50));
  ok('신고 hold 시 retentionUntil 유지', reportHeld.legalHold === true && reportHeld.retentionUntil === '2026-01-01T00:00:00.000Z');
  purged = await retention.purgeExpired('2026-09-06T00:00:00.000Z');
  ok('신고 hold 중 purge 제외', !!(await store.getReportRetention(uid(50))));

  // Migration / SQL safety
  const sql = fs.readFileSync(path.join(root, 'supabase/migration_legal_hold_and_audit_purge_v1.sql'), 'utf8');
  ok('migration additive purge RPC', /purge_expired_admin_moderation_audit_events/.test(sql));
  ok('migration no DROP TABLE stmt', !/\bDROP\s+TABLE\b/i.test(sql.replace(/--[^\n]*/g, '')));
  ok('migration hold state table', /admin_moderation_audit_legal_holds/.test(sql));
  ok('migration operator events', /legal_hold_operator_events/.test(sql));
  ok('UI exists', fs.existsSync(path.join(root, 'public/admin/retention/index.html')));

  // Guard helper still exports OWNER allow
  const roles = require('../server/daily-issue-admin-auth').readAllowedRoles({ allowedRoles: ['OWNER'] });
  ok('OWNER-only allow list', roles.length === 1 && roles[0] === 'OWNER');
  ok('createAdminAccessGuard exists', typeof createAdminAccessGuard === 'function');

  console.log('PASS COUNT', passed);
}

main().catch(function (e) {
  console.error('FAIL', e && e.stack ? e.stack : e);
  process.exit(1);
});
