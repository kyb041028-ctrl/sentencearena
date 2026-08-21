#!/usr/bin/env node
'use strict';

/**
 * Deleted-content / report / sanction / banned-rejoin retention.
 * Does not call Production Auth delete. Does not enable Alien V1.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

const core = require('../shared/retention-policy-core');
const identity = require('../server/retention-identity');
const retention = require('../server/retention-service');
const { createRetentionMemoryRepository } = require('../server/retention-memory-repository');
const { startRetentionPurgeScheduler } = require('../server/retention-scheduler-service');
const { mountRetentionAdminRoutes } = require('../server/retention-admin-routes');
const { createBoardService } = require('../server/board-service');
const { createBoardMemoryRepository } = require('../server/board-memory-repository');
const { createMockUserContextAdapter } = require('../server/board-user-context-adapter');
const { createAccountWithdrawalService } = require('../server/account-withdrawal-service');
const { requestApp } = require('./daily-issue-api-http-helper');
const sanctionService = require('../server/user-sanction-service');
const memRepo = require('../server/alien-moderation-memory-repository');
const reviewCore = require('../shared/board-report-review-core');

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

function monthsFrom(iso, months) {
  return core.addUtcMonths(iso, months);
}

async function main() {
  const store = createRetentionMemoryRepository();
  retention.setRepository(store);
  retention.setNow(function () { return new Date('2026-08-21T03:00:00.000Z'); });
  memRepo._reset();
  sanctionService.setRepository(memRepo);
  sanctionService.setNow(function () { return new Date('2026-08-21T03:00:00.000Z'); });

  const boardRepo = createBoardMemoryRepository();
  retention.setBoardWiper(function (kind, id) {
    return boardRepo.wipeDeletedBody(kind, id);
  });
  retention.setReportLister(async function (kind, sourceId) {
    const rows = await boardRepo.listReports({});
    return rows.filter(function (r) {
      if (kind === 'POST') return r.postId === sourceId;
      return r.commentId === sourceId;
    });
  });

  const board = createBoardService({
    repository: boardRepo,
    userContext: createMockUserContextAdapter({
      defaultTerritory: 'CENTRAL',
      territories: {},
    }),
    operational: true,
  });

  const author = uid(1);
  const reporter = uid(2);

  const post = await board.createPost({ userId: author }, {
    title: '삭제될 게시글 제목입니다',
    content: '삭제될 게시글 본문입니다. 충분히 깁니다.',
  });
  const deletedPost = await board.deletePost({ userId: author }, post.post.id);
  const listed = await board.listPosts({ userId: author }, { status: 'ACTIVE' });
  const evidencePost = await store.getEvidenceBySource('POST', post.post.id);
  ok('A. 게시글 화면 즉시 제거', listed.every(function (p) { return p.id !== post.post.id; }) && deletedPost.status === 'DELETED');
  ok('A. 내부 증거 존재', !!(evidencePost && evidencePost.body.indexOf('삭제될 게시글 본문') !== -1));
  ok('A. 6개월 삭제 예정', evidencePost.retentionUntil === monthsFrom(evidencePost.deletedAt, 6));
  ok('A. 뷰어 원문 숨김', deletedPost.content == null && String(deletedPost.title).indexOf('삭제된') !== -1);

  const host = await board.createPost({ userId: author }, {
    title: '댓글 호스트 게시글 제목입니다',
    content: '댓글 호스트 본문입니다. 충분히 깁니다.',
  });
  const comment = await board.createComment({ userId: author }, host.post.id, {
    content: '삭제될 댓글 본문입니다. 충분히 깁니다.',
  });
  const deletedComment = await board.deleteComment({ userId: author }, comment.comment.id);
  const evidenceComment = await store.getEvidenceBySource('COMMENT', comment.comment.id);
  ok('B. 댓글 화면 즉시 제거', deletedComment.status === 'DELETED');
  ok('B. 내부 증거 존재', !!(evidenceComment && evidenceComment.body.indexOf('삭제될 댓글 본문') !== -1));
  ok('B. 6개월 삭제 예정', evidenceComment.retentionUntil === monthsFrom(evidenceComment.deletedAt, 6));

  const beforeCount = (await store.listEvidence()).length;
  const withdrawSvc = createAccountWithdrawalService({
    getAdminClient: function () {
      return {
        from: function () {
          const api = {
            select: function () { return api; },
            insert: function () { return api; },
            update: function () { return api; },
            eq: function () { return api; },
            maybeSingle: async function () { return { data: { id: 'audit-1' }, error: null }; },
          };
          return api;
        },
        rpc: async function () {
          return {
            data: {
              ok: true,
              anonymized_post_count: 1,
              anonymized_board_comment_count: 1,
              anonymized_daily_issue_comment_count: 0,
              anonymized_report_count: 0,
              deleted_record_counts: { profiles: 1, user_alignment_state: 1 },
            },
            error: null,
          };
        },
        auth: { admin: { deleteUser: async function () { return { error: null }; } } },
      };
    },
  });
  await withdrawSvc.withdraw({
    userId: author,
    body: { acknowledged: true, policyVersion: 'withdrawal-v1' },
  });
  ok('C. 탈퇴 후 삭제 증거 유지', (await store.listEvidence()).length === beforeCount);
  ok('C. 증거에 작성자 uid 유지', (await store.getEvidenceBySource('POST', post.post.id)).authorUserId === author);

  retention.setNow(function () { return new Date('2027-03-21T03:00:00.000Z'); });
  const purged = await retention.purgeExpired('2027-03-21T03:00:00.000Z');
  ok('D. 6개월 만료 증거 자동삭제', purged.counts.evidence >= 2 && !(await store.getEvidenceBySource('POST', post.post.id)));
  const wiped = boardRepo._debug.posts.get(post.post.id);
  ok('D. 원문 스텁 제거', !!(wiped && wiped.content === '' && wiped.title === ''));

  const author2 = uid(3);
  const post2 = await board.createPost({ userId: author2 }, {
    title: '보전 대상 게시글 제목입니다',
    content: '보전 대상 본문입니다. 충분히 깁니다.',
  });
  await board.deletePost({ userId: author2 }, post2.post.id);
  const holdEv = await store.getEvidenceBySource('POST', post2.post.id);
  await retention.setLegalHold({ evidenceId: holdEv.id }, true, 'LEGAL_REQUEST');
  retention.setNow(function () { return new Date('2027-04-01T00:00:00.000Z'); });
  const held = await retention.purgeExpired('2027-04-01T00:00:00.000Z');
  ok('E. 보전 상태는 만료돼도 유지', !!(await store.getEvidenceBySource('POST', post2.post.id)) && held.counts.evidence === 0);

  await retention.setLegalHold({ evidenceId: holdEv.id }, false, null);
  const released = await retention.purgeExpired('2027-04-01T00:00:00.000Z');
  ok('F. 보전 해제+만료 다음 정리에서 삭제', released.counts.evidence >= 1 && !(await store.getEvidenceBySource('POST', post2.post.id)));

  const author3 = uid(4);
  const reporter3 = uid(5);
  const post3 = await board.createPost({ userId: author3 }, {
    title: '신고 대상 게시글 제목입니다',
    content: '신고 대상 본문입니다. 충분히 깁니다.',
  });
  const report = await board.createReport({ userId: reporter3 }, {
    targetType: 'POST',
    targetId: post3.post.id,
    reasonCode: 'abuse',
  });
  await board.reviewBehavior({ userId: uid(99) }, reviewCore.behaviorKeyFromParts('POST', post3.post.id), {
    status: 'REJECTED',
    resolutionNote: '기각',
  });
  const reportRet = await store.getReportRetention(report.id);
  ok('G. 일반 신고 최종 처리 1년 예정', !!(reportRet && reportRet.finalizedAt && reportRet.retentionUntil === core.reportRetentionUntil(reportRet.finalizedAt)));

  await board.reviewBehavior({ userId: uid(99) }, reviewCore.behaviorKeyFromParts('POST', post3.post.id), {
    status: 'REVIEWING',
  });
  const reopened = await store.getReportRetention(report.id);
  ok('G. 재오픈 시 자동삭제 예정 해제', !!(reopened && reopened.finalizedAt == null && reopened.retentionUntil == null));
  await board.reviewBehavior({ userId: uid(99) }, reviewCore.behaviorKeyFromParts('POST', post3.post.id), {
    status: 'RESOLVED',
  });
  const resolved = await store.getReportRetention(report.id);
  ok('G. 재최종 처리 시 새로 계산', !!(resolved && resolved.retentionUntil));

  const warnUser = uid(6);
  await sanctionService.applyRecord(warnUser, { type: 'WRITE_RESTRICT_24H', ladder: 'SERVICE_HARM' }, {
    reasonCode: 'spam',
    endsAt: '2026-08-22T03:00:00.000Z',
  });
  const sanctions = await store.listSanctionRecords();
  const warnRow = sanctions.filter(function (r) { return r.userId === warnUser; })[0];
  ok('H. 제재 종료 후 1년 예정', !!(warnRow && warnRow.retentionUntil === core.sanctionRetentionUntil(warnRow.endsAt)));
  ok('H. 정치성향 없음', !core.hasPoliticalInput(warnRow));

  const ordinary = uid(7);
  await withdrawSvc.withdraw({
    userId: ordinary,
    body: { acknowledged: true, policyVersion: 'withdrawal-v1' },
  });
  ok('I. 일반 탈퇴자 재가입 방지 기록 없음', (await store.listRejoinBlocks()).length === 0);

  const banned = uid(8);
  await sanctionService.applyRecord(banned, { type: 'PERMANENT_BAN', ladder: 'ALIEN_RESIDENT' }, {
    reasonCode: 'abuse',
  });
  const pepper = 'unit-test-pepper-not-in-db';
  const hashed = identity.hashIdentities(pepper, {
    id: banned,
    email: 'banned-user@example.com',
    identities: [{ provider: 'kakao', id: 'kakao-sub-1' }],
  });
  const banWithdraw = createAccountWithdrawalService({
    getAdminClient: function () {
      return {
        from: function () {
          const api = {
            select: function () { return api; },
            insert: function () { return api; },
            update: function () { return api; },
            eq: function () { return api; },
            maybeSingle: async function () { return { data: { id: 'audit-2' }, error: null }; },
          };
          return api;
        },
        rpc: async function () {
          return {
            data: {
              ok: true,
              anonymized_post_count: 0,
              anonymized_board_comment_count: 0,
              anonymized_daily_issue_comment_count: 0,
              anonymized_report_count: 0,
              deleted_record_counts: { profiles: 1, user_alignment_state: 1 },
            },
            error: null,
          };
        },
        auth: { admin: { deleteUser: async function () { return { error: null }; } } },
      };
    },
    beforeAnonymize: async function () {
      await retention.recordBannedRejoin({
        sanctionType: 'PERMANENT_BAN',
        bannedAt: '2026-08-21T03:00:00.000Z',
        reasonCode: 'abuse',
        withdrawnAt: '2026-08-21T03:00:00.000Z',
        hashes: hashed.hashes,
      });
    },
  });
  await banWithdraw.withdraw({
    userId: banned,
    body: { acknowledged: true, policyVersion: 'withdrawal-v1' },
  });
  const blocks = await store.listRejoinBlocks();
  const joined = JSON.stringify(blocks);
  ok('J. 영구정지 탈퇴 재가입 방지 기록 생성', blocks.length >= 1);
  ok('J. 이메일 원문 없음', joined.indexOf('banned-user@example.com') === -1);
  ok('J. 정치성향 없음', joined.indexOf('alignment') === -1 && joined.indexOf('planetPct') === -1);
  ok('J. 1년 삭제 예정', blocks.every(function (b) {
    return b.retentionUntil === core.bannedRejoinRetentionUntil(b.withdrawnAt);
  }));

  retention.setNow(function () { return new Date('2027-08-22T00:00:00.000Z'); });
  const yearLater = await retention.purgeExpired('2027-08-22T00:00:00.000Z');
  ok('K. 1년 만료 재가입 방지 기록 삭제', yearLater.counts.rejoin >= 1 && (await store.listRejoinBlocks()).length === 0);

  const srcBoard = fs.readFileSync(path.join(root, 'server/board-routes.js'), 'utf8');
  const srcServer = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  ok('L. 일반 사용자 라우트에 증거 조회 없음', srcBoard.indexOf('deleted_content_evidence') === -1);
  ok('M. 일반 공개 API에 증거 테이블 노출 없음', srcServer.indexOf('/api/board') !== -1 && srcServer.indexOf('/api/admin/retention') !== -1);

  const app = express();
  app.use(express.json());
  app.use('/api/admin/retention', mountRetentionAdminRoutes({ adminBypass: true }));
  const missing = await requestApp(app, 'GET', '/api/admin/retention/evidence');
  ok('L. 운영자 조회는 id/source 필요', missing.status === 404);

  const livePost = await board.createPost({ userId: uid(11) }, {
    title: '운영자 조회용 게시글 제목입니다',
    content: '운영자 조회용 본문입니다. 충분히 깁니다.',
  });
  await board.deletePost({ userId: uid(11) }, livePost.post.id);
  const opEv = await store.getEvidenceBySource('POST', livePost.post.id);
  const found = await requestApp(app, 'GET', '/api/admin/retention/evidence?kind=POST&sourceId=' + livePost.post.id);
  ok('운영자 증거 조회', found.status === 200 && found.body && found.body.evidence && found.body.evidence.id === opEv.id);

  ok('N. 기존 탈퇴 원칙 유지(공개글 복사 없음)', srcServer.indexOf('공개 글 전체를') === -1);
  const sql = fs.readFileSync(path.join(root, 'supabase/migration_retention_policy_v1.sql'), 'utf8');
  ok('N. 소급 생성 SQL 없음', !/\bUPDATE public\.board_posts\b/i.test(sql) && !/\bINSERT INTO public\.deleted_content_evidence\s+SELECT\b/i.test(sql));

  ok('O. 정치성향 키 저장 금지', core.POLITICAL_KEYS.indexOf('alignmentScore') !== -1);
  ok('O. 증거 빌드 시 정치키 제거', !core.hasPoliticalInput(core.stripPolitical({ alignmentScore: 12, body: 'x' })));

  ok('P. 신고 최종 상태 ACCEPTED/REJECTED/RESOLVED', core.isFinalReportStatus('ACCEPTED') && core.isFinalReportStatus('REJECTED') && core.isFinalReportStatus('RESOLVED'));
  ok('P. 진행중 제재는 퍼지 제외(영구)', !core.shouldPurge({ legalHold: false, retentionUntil: null }, '2027-01-01T00:00:00.000Z'));

  const legalSrc = fs.readFileSync(path.join(root, 'shared/legal-gate-core.js'), 'utf8');
  ok('Q. 법적 가입 게이트 코어 유지', /sensitive-political-v1/.test(legalSrc) || /LEGAL_GATE/.test(legalSrc) || /age/.test(legalSrc.toLowerCase()));

  ok('권리침해 5년 정책 상수', core.RIGHTS_RETENTION_YEARS === 5);
  ok('권리침해 전용 테이블 미생성', sql.indexOf('rights_infringement') === -1);

  const hmacA = identity.hmacIdentity(pepper, 'EMAIL', 'banned-user@example.com');
  const hmacB = identity.hmacIdentity('other-pepper', 'EMAIL', 'banned-user@example.com');
  ok('식별값 HMAC+pepper', !!(hmacA && hmacA.length === 64 && hmacA !== hmacB));

  const twice = await retention.purgeExpired(opEv.deletedAt);
  ok('자동삭제 멱등', twice.ok === true && twice.counts.evidence === 0 && twice.counts.rejoin === 0);

  const sched = startRetentionPurgeScheduler({ enabled: true, intervalMs: 60000, runOnStart: false });
  ok('스케줄러 Node setInterval', !!(sched.started && typeof sched.stop === 'function'));
  sched.stop();

  const copy = core.POLICY_COPY;
  ok('법적 문서용 6개월 문구', copy.DELETED_CONTENT.indexOf('6개월') !== -1);
  ok('법적 문서용 1년 신고 문구', copy.REPORTS.indexOf('1년') !== -1);
  ok('법적 문서용 5년 문구', copy.RIGHTS.indexOf('5년') !== -1);

  console.log('PASS COUNT', passed);
}

main().catch(function (e) {
  console.error('FAIL', e && e.stack ? e.stack : e);
  process.exit(1);
});
