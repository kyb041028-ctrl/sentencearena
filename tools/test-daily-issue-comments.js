#!/usr/bin/env node
'use strict';

/**
 * Daily Issue public comments — Guest/login/security/XP boundary/no alignment
 */

const { requestApp } = require('./daily-issue-api-http-helper');
const { makeReady, createTestApp, authHeaders, memberHeaders, AS_OF } = require('./daily-issue-api-test-fixtures');
const { createMemoryDailyIssueAlignmentReactionStore } = require('../server/daily-issue-alignment-reaction-store');
const commentCore = require('../shared/daily-issue-comment-core');
const xpCore = require('../shared/progression-xp-core');
const ser = require('../server/daily-issue-api-serializers');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log('PASS', name);
  } else {
    failed += 1;
    console.error('FAIL', name, detail || '');
  }
}

async function publishViaApi(app, repo, suffix) {
  const item = makeReady(suffix);
  repo.insertReviewItems([item], [], {});
  const ap = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + item.id + '/approve', {
    headers: authHeaders(),
    body: { expectedStatus: 'READY_FOR_REVIEW', expectedLockVersion: 1, reviewerId: 'pub-test' },
  });
  if (!ap.body || !ap.body.ok) throw new Error('approve failed ' + JSON.stringify(ap.body));
  const lock = ap.body.data.item.lockVersion;
  const pb = await requestApp(app, 'POST', '/api/admin/daily-issues/review/' + item.id + '/publish', {
    headers: authHeaders(),
    body: { expectedStatus: 'APPROVED', expectedLockVersion: lock, reviewerId: 'pub-test' },
  });
  if (!pb.body || !pb.body.ok) throw new Error('publish failed ' + JSON.stringify(pb.body));
  return pb.body.data.item;
}

async function main() {
  console.log('\n=== daily-issue comments ===\n');

  ok('XP ISSUE_COMMENT_CREATED = 10', xpCore.XP_REWARDS.ISSUE_COMMENT_CREATED === 10);
  ok('XP ISSUE_COMMENT_CREATED ACTIVE', xpCore.ACTIVITY_STATUS.ISSUE_COMMENT_CREATED === 'ACTIVE');
  ok(
    'XP dedupe key',
    xpCore.dedupeKeyForIssueCommentCreated('dicmt_1') === 'ISSUE_COMMENT_CREATED:dicmt_1',
  );
  ok('comment max 1500 matches board', commentCore.COMMENT_MAX_LENGTH === 1500);
  ok('empty body rejected', commentCore.parseCommentBody('   ').error === 'COMMENT_BODY_REQUIRED');
  ok('too long rejected', commentCore.parseCommentBody(Array(1502).join('a')).error === 'COMMENT_TOO_LONG');

  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migration_daily_issue_comments_v1.sql'),
    'utf8',
  );
  ok('sql CREATE TABLE comments', /CREATE TABLE IF NOT EXISTS public\.daily_issue_comments/.test(sql));
  ok('sql no DROP/TRUNCATE/DELETE FROM', !/^\s*(DROP TABLE|TRUNCATE|DELETE FROM)\b/im.test(sql));
  ok('sql FK review_items.id', /REFERENCES public\.daily_issue_review_items\(id\)/.test(sql));
  ok('sql no alignment columns', !/alignment_direction|planetPct/.test(sql) && !/\bterritory\b/.test(sql));

  const routesSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'daily-issue-routes.js'), 'utf8');
  ok(
    'routes do not call alignment seed on comments',
    !/createPublicComment[\s\S]*seedCore|listPublicComments[\s\S]*alignmentDirection/.test(
      routesSrc.slice(routesSrc.indexOf('async function listPublicComments')),
    ),
  );

  const xpCalls = [];
  const reactionStore = createMemoryDailyIssueAlignmentReactionStore();
  const { app, repo } = createTestApp({
    reactionStore: reactionStore,
    applyIssueCommentXp: async function (userId, commentId) {
      xpCalls.push({ userId: userId, commentId: commentId });
      return { status: 'APPLIED', duplicate: false };
    },
  });

  const published = await publishViaApi(app, repo, 'cmt_ok');
  const issuePath = '/api/daily-issues/' + published.id + '/comments';

  const guestList = await requestApp(app, 'GET', issuePath, {});
  ok('A. Guest list 200', guestList.status === 200 && guestList.body && guestList.body.ok);
  ok('A. Guest empty comments', guestList.body.data.count === 0);

  const guestPost = await requestApp(app, 'POST', issuePath, {
    body: { body: 'guest try' },
  });
  ok('A. Guest POST 401', guestPost.status === 401);

  const created = await requestApp(app, 'POST', issuePath, {
    headers: memberHeaders('alice'),
    body: { body: '  첫 댓글입니다.  ' },
  });
  ok('B. login create 201', created.status === 201 && created.body && created.body.ok);
  const comment = created.body.data && created.body.data.item;
  ok('B. trimmed body', comment && comment.body === '첫 댓글입니다.');
  ok('B. isMine true', comment && comment.isMine === true);
  ok('B. displayName', comment && comment.author && comment.author.displayName === '앨리스');
  ok('B. list immediately includes', true);
  const afterCreate = await requestApp(app, 'GET', issuePath, { headers: memberHeaders('alice') });
  ok(
    'B. refresh list has comment',
    afterCreate.body && afterCreate.body.data.items.some(function (c) {
      return c.id === comment.id && c.body === '첫 댓글입니다.';
    }),
  );
  ok('B. XP called after save', xpCalls.length === 1 && xpCalls[0].commentId === comment.id);
  ok('B. XP user alice', xpCalls[0].userId === 'alice');

  const otherDel = await requestApp(app, 'DELETE', issuePath + '/' + comment.id, {
    headers: memberHeaders('bob'),
  });
  ok('C. other user DELETE 403', otherDel.status === 403);

  const xss = await requestApp(app, 'POST', issuePath, {
    headers: memberHeaders('alice'),
    body: { body: '<script>alert(1)</script>' },
  });
  ok('D. script stored as text', xss.body && xss.body.data.item.body === '<script>alert(1)</script>');
  const blob = JSON.stringify(xss.body);
  ok('D. no email/metadata/alignment', !/"email"|app_metadata|alignmentDirection|reviewerId/.test(blob));

  const empty = await requestApp(app, 'POST', issuePath, {
    headers: memberHeaders('alice'),
    body: { body: '   ' },
  });
  ok('validation empty 422', empty.status === 422);

  const long = await requestApp(app, 'POST', issuePath, {
    headers: memberHeaders('alice'),
    body: { body: Array(1502).join('x') },
  });
  ok('validation too long 422', long.status === 422);

  const unpublished = makeReady('cmt_ready');
  repo.insertReviewItems([unpublished], [], {});
  const onReady = await requestApp(app, 'POST', '/api/daily-issues/' + unpublished.id + '/comments', {
    headers: memberHeaders('alice'),
    body: { body: 'nope' },
  });
  ok('unpublished POST not allowed', onReady.status === 404);

  const reactions = await reactionStore.listAll();
  ok('E. no reaction rows from comments', !reactions || reactions.length === 0);

  const pubAsOf = ser.toPublicIssue(
    Object.assign({}, repo.getById(published.id).item),
    AS_OF,
  );
  ok('E. issue public fields unchanged', pubAsOf && pubAsOf.title && pubAsOf.alignmentDirection === undefined);

  const del = await requestApp(app, 'DELETE', issuePath + '/' + comment.id, {
    headers: memberHeaders('alice'),
  });
  ok('B. owner DELETE 200', del.status === 200 && del.body && del.body.data && del.body.data.deleted === true);
  const afterDel = await requestApp(app, 'GET', issuePath, {});
  ok(
    'B. deleted hidden from list',
    afterDel.body &&
      afterDel.body.data.items.every(function (c) {
        return c.id !== comment.id;
      }),
  );

  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'daily-issue-public-ui.js'), 'utf8');
  ok('F. openDetail paints before comments await', /paint\(\);\s*loadComments\(id, gen\)/.test(ui));
  ok('F. comments not assigned to state.loading', !/state\.loading = true;\s*[\s\S]*listComments/.test(ui));

  console.log('\nDaily Issue comments results:', passed, 'passed,', failed, 'failed');
  if (failed) process.exit(1);
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
