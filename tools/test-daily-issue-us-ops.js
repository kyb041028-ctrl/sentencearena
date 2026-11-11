#!/usr/bin/env node
'use strict';

/**
 * 미국 데일리 이슈 규칙. 로컬 단위와 로컬 앱이다.
 * 샘플 후보는 수집 성공이 아니다. Supabase Auth 세션이 아니다.
 */

const { requestApp } = require('./daily-issue-api-http-helper');
const { makeReady, createTestApp, authHeaders, memberHeaders } = require('./daily-issue-api-test-fixtures');
const usOps = require('../shared/daily-issue-us-ops-core');
const { createUsScheduler } = require('../server/daily-issue-us-scheduler');
const { createUsNoticeAdapter } = require('../server/daily-issue-us-notice');
const { createLegalGateService } = require('../server/legal-gate-service');

let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    console.log('CHECK_OK', name);
    return;
  }
  failed += 1;
  console.log('CHECK_FAIL', name, detail || '');
}

function memoryAdmin(seed) {
  const rows = { user_legal_consents: {}, user_activity_region_legal_consents: {} };
  Object.keys(seed || {}).forEach(function (table) {
    rows[table] = seed[table];
  });
  return {
    from: function (table) {
      const state = { filters: {} };
      const api = {
        select: function () { return api; },
        eq: function (col, val) { state.filters[col] = val; return api; },
        maybeSingle: function () {
          const bag = rows[table] || {};
          const row = bag[state.filters.user_id] || null;
          if (row && state.filters.activity_region && row.activity_region !== state.filters.activity_region) {
            return Promise.resolve({ data: null, error: null });
          }
          return Promise.resolve({ data: row, error: null });
        },
      };
      return api;
    },
  };
}

function sampleIssue() {
  return {
    title: 'Federal budget talks continue',
    verifiedFactSummary: 'Two official notices describe the same scheduled hearing.',
    keyPoints: ['A hearing is scheduled.'],
    discussionQuestion: 'What should readers watch in the official record?',
    sources: [
      { url: 'https://www.congress.example/hearing', date: '2026-11-04' },
      { url: 'https://www.gao.example/note', date: '2026-11-04' },
    ],
  };
}

async function publish(app, repo, suffix, region) {
  const item = makeReady(suffix);
  if (region) {
    item.activityRegion = region;
    item.lifecycleMeta = Object.assign({}, item.lifecycleMeta || {}, { activityRegion: region });
  }
  repo.insertReviewItems([item], [], {});
  const approved = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + item.id + '/approve', {
    headers: authHeaders(),
    body: { expectedStatus: 'READY_FOR_REVIEW', expectedLockVersion: 1, reviewerId: 'us-ops' },
  });
  const lock = approved.body && approved.body.data && approved.body.data.item.lockVersion;
  const published = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + item.id + '/publish', {
    headers: authHeaders(),
    body: { expectedStatus: 'APPROVED', expectedLockVersion: lock, reviewerId: 'us-ops' },
  });
  return { id: item.id, published: published };
}

async function main() {
  console.log('AUTH_MODE', 'local-test-actor-not-supabase-auth');
  console.log('COLLECTION', 'sample-not-live-ai');

  const winter = usOps.slotFor('2026-01-15T16:00:00.000Z');
  const summer = usOps.slotFor('2026-07-15T15:00:00.000Z');
  const early = usOps.slotFor('2026-01-15T15:00:00.000Z');
  check('겨울 11시는 미국 동부 표준시 회차다', winter.due && winter.hour === 11 && winter.runKey === 'us-daily-issue:2026-01-15:11');
  check('여름 11시는 일광절약 회차다', summer.due && summer.hour === 11 && summer.dateKey === '2026-07-15');
  check('회차 밖은 발행하지 않는다', early.due === false);
  check('미국 스케줄러 기본은 꺼져 있다', usOps.isSchedulerEnabled({}) === false);
  check('한국 아침 플래그만으로 미국 스케줄이 켜지지 않는다', usOps.isSchedulerEnabled({ DAILY_ISSUE_MORNING_SCHEDULER_ENABLED: '1' }) === false);

  const scheduler = createUsScheduler();
  const sampleRun = scheduler.runSlot({
    forceEnabled: true,
    asOf: '2026-01-15T16:00:00.000Z',
    candidate: { sample: true, issue: sampleIssue() },
  });
  const again = scheduler.runSlot({
    forceEnabled: true,
    asOf: '2026-01-15T16:05:00.000Z',
    candidate: { liveAiConfirmed: true, relevant: true, eventDate: '2026-11-04', articleDate: '2026-11-04', sources: [{ url: 'https://a.example/a' }, { url: 'https://b.example/b' }], issue: sampleIssue() },
  });
  check('샘플 후보는 수집 성공이 아니다', sampleRun.collectionStatus === 'NOT_RUN' && sampleRun.published === 0);
  check('같은 회차는 한 번만 시작한다', again.reason === 'ALREADY_PUBLISHED');
  check('빈 지역은 한국이다', usOps.issueRegion({}) === 'KR' && usOps.issueRegion({ activityRegion: 'US' }) === 'US');

  const retry = usOps.retryDecision({ error: 'TIMEOUT', attempt: 0 });
  const second = usOps.retryDecision({ error: 'TIMEOUT', attempt: 1 });
  const stop = usOps.retryDecision({ error: 'TIMEOUT', attempt: 2 });
  const fact = usOps.retryDecision({ error: 'FACT_VERIFICATION_FAILED', attempt: 0 });
  const unknown = usOps.retryDecision({ dbStatus: 'UNKNOWN' });
  const saved = usOps.retryDecision({ dbStatus: 'UNKNOWN', readBackFound: true });
  check('일시 장애는 2분 뒤 다시 시도한다', retry.retry === true && retry.delayMinutes === 2 && second.delayMinutes === 10);
  check('두 번 뒤에는 다시 시도하지 않는다', stop.retry === false);
  check('사실 검증 실패는 다시 시도하지 않는다', fact.retry === false);
  check('저장 응답이 없으면 먼저 다시 읽는다', unknown.action === 'READ_BACK' && saved.error === 'ALREADY_SAVED');

  const weak = usOps.assessCandidate({
    liveAiConfirmed: true,
    relevant: true,
    eventDate: '2026-11-04',
    articleDate: '2026-11-03',
    sources: [{ url: 'https://a.example/a' }],
    issue: sampleIssue(),
  });
  check('독립 출처가 하나면 자동 발행하지 않는다', weak.error === 'INDEPENDENT_SOURCES_REQUIRED' && weak.publish === false);
  const conflict = usOps.assessCandidate({
    liveAiConfirmed: true,
    factConflict: true,
    relevant: true,
    eventDate: '2026-11-04',
    articleDate: '2026-11-04',
    sources: [{ url: 'https://a.example/a' }, { url: 'https://b.example/b' }],
    issue: sampleIssue(),
  });
  check('사실 충돌은 자동 발행에서 빠진다', conflict.error === 'FACT_VERIFICATION_FAILED');
  const vote = usOps.assessIssueShape(Object.assign({}, sampleIssue(), { choices: ['yes', 'no'] }));
  check('찬반 투표 칸은 거절된다', vote.ok === false);
  const hide = usOps.decideVisibility({ activityRegion: 'US' }, { coreFactVerifiablyWrong: true });
  const opinion = usOps.decideVisibility({ activityRegion: 'US' }, { opinionOnly: true });
  const reopen = usOps.decideVisibility({ activityRegion: 'US', lifecycleMeta: { usVisibility: 'TEMP_HIDDEN' } }, { republish: true });
  check('검증된 사실 오류만 임시 숨김이다', hide.action === 'TEMP_HIDE' && opinion.action === 'ADMIN_REVIEW');
  check('재공개는 관리자 승인이 필요하다', reopen.ok === false && reopen.error === 'ADMIN_APPROVAL_REQUIRED');

  const notices = createUsNoticeAdapter({ env: {} });
  const quiet = notices.notify({ kind: 'PUBLISHED', runKey: 'slot' });
  const major = notices.notify({ kind: 'MAJOR_PUBLISH_ERROR', runKey: 'slot' });
  const dup = notices.notify({ kind: 'MAJOR_PUBLISH_ERROR', runKey: 'slot' });
  check('정상 발행은 메일을 만들지 않는다', quiet.reason === 'NORMAL_QUIET');
  check('메일 설정이 없으면 내부 알림만 남긴다', major.delivered === false && major.reason === 'MAIL_NOT_CONFIGURED');
  check('같은 장애 알림은 한 번만 남긴다', dup.reason === 'DUPLICATE_NOTICE_SUPPRESSED');

  const krRow = {
    user_id: 'kr-adult',
    age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
    age_policy_version: 'age-policy-v1',
    sensitive_political_consented_at: '2026-01-01T00:00:00.000Z',
    sensitive_political_policy_version: 'sensitive-political-v1',
    territory_disclosure_consented_at: '2026-01-01T00:00:00.000Z',
    territory_disclosure_policy_version: 'territory-disclosure-v1',
  };
  const usRow = {
    user_id: 'us-adult',
    activity_region: 'US',
    age_policy_region: 'US',
    age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
    age_policy_version: 'age-policy-us-v1',
    terms_consented_at: '2026-01-01T00:00:00.000Z',
    terms_document_version: 'terms-draft-us-v1',
    privacy_acknowledged_at: '2026-01-01T00:00:00.000Z',
    privacy_document_version: 'privacy-draft-us-v1',
    privacy_processing_consent_at: null,
    sensitive_political_consented_at: '2026-01-01T00:00:00.000Z',
    sensitive_political_policy_version: 'sensitive-political-v1',
    sensitive_applies_to: 'US',
    territory_disclosure_consented_at: '2026-01-01T00:00:00.000Z',
    territory_disclosure_policy_version: 'territory-disclosure-v1',
    territory_disclosure_applies_to: 'US',
  };
  const previousEnforce = process.env.LEGAL_GATE_ENFORCE;
  process.env.LEGAL_GATE_ENFORCE = '1';
  const gate = createLegalGateService({
    getAdminClient: function () {
      return memoryAdmin({
        user_legal_consents: { 'kr-adult': krRow },
        user_activity_region_legal_consents: { 'us-adult': usRow, 'kr-adult': null },
      });
    },
  });
  const scores = [];
  const packed = createTestApp({
    legalGate: gate,
    applyUsCommentScore: function (userId, commentId) {
      scores.push({ userId: userId, commentId: commentId });
      return { connected: true, region: 'US' };
    },
    applyIssueCommentXp: function () {
      scores.push({ korean: true });
      return null;
    },
  });
  const kr = await publish(packed.app, packed.repo, 'kr1', null);
  const us = await publish(packed.app, packed.repo, 'us1', 'US');
  check('로컬 발행 준비', kr.published.body && kr.published.body.ok && us.published.body && us.published.body.ok, JSON.stringify(us.published.body));

  const krList = await requestApp(packed.app, 'GET', '/api/daily-issues', { headers: { 'accept-language': 'ko' } });
  const usList = await requestApp(packed.app, 'GET', '/api/daily-issues', { headers: { 'accept-language': 'en' } });
  const spoof = await requestApp(packed.app, 'GET', '/api/daily-issues?activityRegion=US', { headers: { 'accept-language': 'ko' } });
  const krIds = ((krList.body && krList.body.data && krList.body.data.items) || []).map(function (item) { return item.id; });
  const usIds = ((usList.body && usList.body.data && usList.body.data.items) || []).map(function (item) { return item.id; });
  check('한국 목록에는 미국 이슈가 없다', krList.status === 200 && krIds.indexOf(kr.id) >= 0 && krIds.indexOf(us.id) < 0, krIds.join(','));
  check('미국 목록에는 한국 이슈가 없다', usList.status === 200 && usIds.indexOf(us.id) >= 0 && usIds.indexOf(kr.id) < 0, usIds.join(','));
  check('국가 변경 조회는 거절된다', spoof.status === 403);

  const guest = await requestApp(packed.app, 'GET', '/api/daily-issues/' + us.id, { headers: { 'accept-language': 'en' } });
  check('비회원은 미국 이슈를 읽는다', guest.status === 200);
  const krOnlyWrite = await requestApp(packed.app, 'POST', '/api/daily-issues/' + us.id + '/comments', {
    headers: Object.assign({ 'accept-language': 'en', 'content-type': 'application/json' }, memberHeaders('kr-adult')),
    body: { body: '한국 동의만 있는 댓글' },
  });
  const usWrite = await requestApp(packed.app, 'POST', '/api/daily-issues/' + us.id + '/comments', {
    headers: Object.assign({ 'accept-language': 'en', 'content-type': 'application/json' }, memberHeaders('us-adult')),
    body: { body: '미국 동의 댓글' },
  });
  check('한국 동의만으로는 미국 이슈에 쓰지 못한다', krOnlyWrite.status === 403, String(krOnlyWrite.status));
  check('미국 동의 사용자는 미국 이슈에 쓴다', usWrite.status === 201, JSON.stringify(usWrite.body));
  check(
    '미국 댓글 점수는 지역 저장 연결로만 남는다',
    scores.length === 1 && scores[0].userId === 'us-adult' && scores[0].korean !== true,
    JSON.stringify(scores)
  );
  const krWrite = await requestApp(packed.app, 'POST', '/api/daily-issues/' + kr.id + '/comments', {
    headers: Object.assign({ 'accept-language': 'ko', 'content-type': 'application/json' }, memberHeaders('kr-adult')),
    body: { body: '한국 댓글' },
  });
  check('한국 이슈 댓글은 한국 경험치 경로다', krWrite.status === 201 && scores.some(function (row) { return row.korean === true; }));

  const reaction = await requestApp(packed.app, 'POST', '/api/daily-issues/' + us.id + '/reactions/toggle', {
    headers: Object.assign({ 'accept-language': 'en', 'content-type': 'application/json' }, memberHeaders('us-adult')),
    body: { reactionType: 'LIKE' },
  });
  check('미국 반응은 저장된다', reaction.status === 200 && reaction.body && reaction.body.ok, JSON.stringify(reaction.body));

  if (previousEnforce == null) delete process.env.LEGAL_GATE_ENFORCE;
  else process.env.LEGAL_GATE_ENFORCE = previousEnforce;

  console.log('PRODUCTION_NOT_APPLIED');
  console.log('LIVE_AI_COLLECTION_NOT_RUN');
  if (failed) {
    console.log('US_DAILY_ISSUE_FAIL', failed);
    process.exitCode = 1;
    return;
  }
  console.log('US_DAILY_ISSUE_LOCAL_OK');
}

main().catch(function (err) {
  console.log('US_DAILY_ISSUE_FAIL', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
