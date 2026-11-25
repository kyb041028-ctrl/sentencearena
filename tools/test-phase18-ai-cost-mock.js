#!/usr/bin/env node
'use strict';

/**
 * KR/US AI 비용 상한 — 모의 adapter만. 유료 OpenAI 호출 없음. 키 로그 없음.
 */

const aiService = require('../server/daily-issue-ai-service');
const evalCore = require('../shared/daily-issue-ai-eval-core');
const fixtures = require('./lib/daily-issue-phase16-fixtures');

const AS_OF = fixtures.AS_OF;
let failed = 0;

function check(name, ok, detail) {
  if (ok) console.log('CHECK_OK', name);
  else {
    failed += 1;
    console.log('CHECK_FAIL', name, detail || '');
  }
}

async function main() {
  process.env.DAILY_ISSUE_US_AI_API_KEY = 'phase18-mock-key-not-real';
  process.env.DAILY_ISSUE_KR_AI_API_KEY = 'phase18-mock-key-not-real';
  process.env.DAILY_ISSUE_KR_AI_ENABLED = '1';
  const env = Object.assign({}, process.env);
  const us = fixtures.buildUsReady('cost');
  const kr = fixtures.buildKrReady('cost');

  const usBlock = await aiService.evaluateOneCandidate(us, {
    region: 'US',
    asOf: AS_OF,
    env: env,
    estimatedUsdSoFar: 999,
    adapter: fixtures.mockAdapter(fixtures.usAiPayload(us)),
  });
  check('US 비용 상한 차단', usBlock.ok !== true && usBlock.outcome === evalCore.OUTCOME.AI_COST_LIMIT);

  const krBlock = await aiService.evaluateOneCandidate(kr, {
    region: 'KR',
    asOf: AS_OF,
    env: Object.assign({}, env, { DAILY_ISSUE_KR_AI_ENABLED: '1' }),
    estimatedUsdSoFar: 999,
    adapter: fixtures.mockAdapter(fixtures.krAiPayload(kr)),
  });
  check('KR 비용 상한 차단', krBlock.ok !== true && krBlock.outcome === evalCore.OUTCOME.AI_COST_LIMIT);

  const usOk = await aiService.evaluateOneCandidate(us, {
    region: 'US',
    asOf: AS_OF,
    env: env,
    estimatedUsdSoFar: 0,
    adapter: fixtures.mockAdapter(fixtures.usAiPayload(us)),
  });
  const logStr = JSON.stringify(usOk);
  check('로그에 sk- 키 없음', !/sk-[a-z0-9]{8,}/i.test(logStr));
  check('모의 US 호출 성공', usOk.ok === true && usOk.outcome === evalCore.OUTCOME.AI_CALL_OK);

  delete process.env.DAILY_ISSUE_US_AI_API_KEY;
  delete process.env.DAILY_ISSUE_KR_AI_API_KEY;
  delete process.env.DAILY_ISSUE_KR_AI_ENABLED;

  if (failed) {
    console.log('PHASE18_AI_COST_FAIL', failed);
    process.exitCode = 1;
    return;
  }
  console.log('PHASE18_AI_COST_MOCK_OK');
  console.log('LIVE_OPENAI', 'NOT_RUN');
}

main().catch(function (e) {
  console.log('PHASE18_AI_COST_FAIL', e && e.message ? e.message : e);
  process.exitCode = 1;
});
