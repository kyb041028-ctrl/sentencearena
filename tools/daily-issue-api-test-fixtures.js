'use strict';

/**
 * Shared fixtures for daily-issue API tests
 */

const quality = require('../shared/daily-issue-quality-core');
const freshness = require('../shared/daily-issue-freshness-core');
const reviewCore = require('../shared/daily-issue-review-core');
const { createFakeDbDailyIssueReviewRepository } = require('../server/daily-issue-review-db-repository');
const { createDailyIssueApiApp } = require('../server/daily-issue-routes');
const { createMemoryRateLimiter } = require('../server/daily-issue-api-rate-limit');

const AS_OF = '2026-08-05T12:00:00.000Z';
const ADMIN_TOKEN = 'test-admin-token-daily-issue-7';

function makeReady(suffix, overrides) {
  const s1 = {
    id: 's1_' + suffix,
    publisher: 'BBC',
    title: 't',
    url: 'https://bbc.example.com/' + suffix,
    publishedAt: '2026-08-04T10:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'bbc.example.com',
    contentHash: 'h1_' + suffix,
  };
  const s2 = {
    id: 's2_' + suffix,
    publisher: 'Guardian',
    title: 't',
    url: 'https://guardian.example.com/' + suffix,
    publishedAt: '2026-08-04T12:00:00.000Z',
    sourceType: 'NEWS',
    documentType: 'NEWS_REPORT',
    originDomain: 'guardian.example.com',
    contentHash: 'h2_' + suffix,
  };
  const text = 'Officials announced a new decision on border crisis after the crossing event occurred.';
  const evidences = [
    {
      id: 'ev1_' + suffix,
      sourceId: s1.id,
      text: text,
      evidenceType: 'DOCUMENT_TEXT',
      extractionConfidence: 0.9,
      rawText: 'SECRET_RAW_' + suffix,
    },
    {
      id: 'ev2_' + suffix,
      sourceId: s2.id,
      text: text,
      evidenceType: 'DOCUMENT_TEXT',
      extractionConfidence: 0.9,
    },
  ];
  const built = quality.buildDailyIssueCandidate({
    title: 'EU responds to border crossing crisis ' + suffix,
    discussionPrompt: '이 사안을 어떻게 평가하시나요?',
    sources: [s1, s2],
    evidences: evidences,
    candidateClaims: [
      {
        id: 'c1_' + suffix,
        text: text,
        classification: 'CONFIRMED_FACT',
        evidenceIds: [evidences[0].id, evidences[1].id],
        supportingSourceIds: [s1.id, s2.id],
        isCore: true,
      },
    ],
    retrievedAt: AS_OF,
  });
  const gated = freshness.applyFreshnessGateToCandidate(built, { asOf: AS_OF });
  const created = reviewCore.createReviewItem(
    Object.assign({}, gated, {
      clusterId: 'cl_' + suffix,
      category: (overrides && overrides.category) || 'world',
      candidateId: 'cand_' + suffix,
    }),
    { asOf: AS_OF, existingItems: [] },
  );
  const item = created.item;
  if (overrides) Object.assign(item, overrides);
  return item;
}

function createTestApp(extra) {
  const ex = extra || {};
  const repo = ex.repositoryInstance || createFakeDbDailyIssueReviewRepository({});
  repo.initialize();
  const rateLimiter = ex.rateLimiter || createMemoryRateLimiter({ now: ex.now });
  const app = createDailyIssueApiApp({
    repositoryInstance: repo,
    adminToken: Object.prototype.hasOwnProperty.call(ex, 'adminToken') ? ex.adminToken : ADMIN_TOKEN,
    rateLimiter: rateLimiter,
    rateLimits: ex.rateLimits,
    corsOrigins: ex.corsOrigins || ['http://localhost:3000', 'http://allowed.test'],
    asOf: ex.asOf || AS_OF,
    now: ex.now,
  });
  return { app: app, repo: repo, rateLimiter: rateLimiter };
}

function authHeaders(token) {
  return { Authorization: 'Bearer ' + (token || ADMIN_TOKEN) };
}

module.exports = {
  AS_OF: AS_OF,
  ADMIN_TOKEN: ADMIN_TOKEN,
  makeReady: makeReady,
  createTestApp: createTestApp,
  authHeaders: authHeaders,
};
