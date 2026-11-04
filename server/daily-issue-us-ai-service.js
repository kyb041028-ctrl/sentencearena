'use strict';

/**
 * US Daily Issue — AI step after rule gates (KR path untouched).
 */

const { readUsAiEnv } = require('../config/daily-issue-us-ai-env');
const evalCore = require('../shared/daily-issue-us-ai-eval-core');
const openaiAdapter = require('./daily-issue-openai-adapter');

function emptySummary() {
  return {
    eligible: 0,
    skippedNotEligible: 0,
    blockedNotConfigured: false,
    aiCallOk: 0,
    callFailed: 0,
    validationFailed: 0,
    costLimited: 0,
    readyBeforeAi: 0,
    enqueuedAfterAi: 0,
    calls: [],
    estimatedUsdTotal: 0,
  };
}

async function evaluateOneCandidate(cand, opts) {
  const o = opts || {};
  const asOf = o.asOf || cand.retrievedAt || new Date().toISOString();
  const gate = evalCore.ruleEligibleForAi(cand);
  if (!gate.ok) {
    return {
      ok: false,
      skipped: true,
      outcome: evalCore.OUTCOME.SKIPPED_NOT_ELIGIBLE,
      reason: gate.reason,
      candidate: cand,
    };
  }

  const env = readUsAiEnv(o.env);
  if (!env.configured) {
    return {
      ok: false,
      outcome: evalCore.OUTCOME.BLOCKED_NOT_CONFIGURED,
      errorCode: env.blockedReason || 'BLOCKED_NOT_CONFIGURED',
      candidate: cand,
      aiMeta: { configured: false, outcome: 'BLOCKED_NOT_CONFIGURED', asOf: asOf },
    };
  }

  if (o.callsSoFar >= env.maxCallsPerRun) {
    return {
      ok: false,
      outcome: evalCore.OUTCOME.AI_COST_LIMIT,
      errorCode: 'AI_COST_LIMIT',
      candidate: cand,
    };
  }

  if (o.estimatedUsdSoFar >= env.maxEstimatedUsdPerRun) {
    return {
      ok: false,
      outcome: evalCore.OUTCOME.AI_COST_LIMIT,
      errorCode: 'AI_COST_LIMIT',
      candidate: cand,
    };
  }

  const input = evalCore.buildModelInput(cand, { asOf: asOf });
  const callFn =
    (o.adapter && typeof o.adapter.callStructured === 'function' && o.adapter.callStructured.bind(o.adapter)) ||
    function () {
      return openaiAdapter.callOpenAiStructured(input, { env: o.env });
    };

  const started = Date.now();
  const res = await callFn(input, { env: o.env });
  const latencyMs = Date.now() - started;

  const callLog = {
    candidateTitle: String(cand.title || '').slice(0, 120),
    latencyMs: latencyMs,
    ok: res.ok === true,
    errorCode: res.errorCode || null,
    estimatedUsd: res.estimatedUsd || 0,
    usage: res.usage || null,
    provider: res.provider || 'openai',
    model: res.model || env.model,
  };

  if (!res.ok) {
    return {
      ok: false,
      outcome:
        res.errorCode === 'AI_AUTH_ERROR'
          ? evalCore.OUTCOME.AI_AUTH_ERROR
          : res.errorCode === 'AI_RATE_LIMIT'
            ? evalCore.OUTCOME.AI_RATE_LIMIT
            : res.errorCode === 'AI_TIMEOUT'
              ? evalCore.OUTCOME.AI_TIMEOUT
              : res.errorCode === 'BLOCKED_NOT_CONFIGURED'
                ? evalCore.OUTCOME.BLOCKED_NOT_CONFIGURED
                : evalCore.OUTCOME.AI_CALL_FAILED,
      errorCode: res.errorCode || 'AI_CALL_FAILED',
      candidate: cand,
      callLog: callLog,
    };
  }

  const validation = evalCore.validateStructuredOutput(cand, res.payload);
  if (!validation.ok) {
    return {
      ok: false,
      outcome: evalCore.OUTCOME.AI_OUTPUT_VALIDATION_FAILED,
      errorCode: 'AI_OUTPUT_VALIDATION_FAILED',
      blockedReasons: validation.blockedReasons,
      candidate: cand,
      callLog: callLog,
      aiMeta: {
        outcome: 'AI_OUTPUT_VALIDATION_FAILED',
        blockedReasons: validation.blockedReasons,
        asOf: asOf,
      },
    };
  }

  const enriched = evalCore.applyAiContentToCandidate(cand, res.payload);
  enriched.lifecycleMeta = Object.assign({}, enriched.lifecycleMeta || {}, {
    activityRegion: 'US',
    usAiEval: {
      outcome: 'AI_CALL_OK',
      validatedAt: asOf,
      model: res.model,
      provider: res.provider,
      estimatedUsd: res.estimatedUsd,
      usage: res.usage,
    },
  });

  return {
    ok: true,
    outcome: evalCore.OUTCOME.AI_CALL_OK,
    candidate: enriched,
    callLog: callLog,
  };
}

async function processReadyCandidatesForUsAi(readyList, options) {
  const list = Array.isArray(readyList) ? readyList : [];
  const summary = emptySummary();
  summary.readyBeforeAi = list.length;

  const env = readUsAiEnv((options && options.env) || process.env);
  if (!env.configured) {
    summary.blockedNotConfigured = true;
    return { candidates: [], summary: summary, runOutcomeHint: 'AI_NOT_CONFIGURED' };
  }

  const out = [];
  let calls = 0;
  let usd = 0;

  for (let i = 0; i < list.length; i += 1) {
    const cand = list[i];
    const gate = evalCore.ruleEligibleForAi(cand);
    if (!gate.ok) {
      summary.skippedNotEligible += 1;
      continue;
    }
    summary.eligible += 1;

    const result = await evaluateOneCandidate(cand, {
      asOf: options && options.asOf,
      env: options && options.env,
      adapter: options && options.adapter,
      callsSoFar: calls,
      estimatedUsdSoFar: usd,
    });

    if (result.callLog) {
      summary.calls.push(result.callLog);
      if (result.callLog.ok) {
        calls += 1;
        usd += Number(result.callLog.estimatedUsd) || 0;
      }
    }

    if (result.outcome === evalCore.OUTCOME.BLOCKED_NOT_CONFIGURED) {
      summary.blockedNotConfigured = true;
      break;
    }
    if (result.outcome === evalCore.OUTCOME.AI_COST_LIMIT) {
      summary.costLimited += 1;
      continue;
    }
    if (result.skipped) {
      summary.skippedNotEligible += 1;
      continue;
    }
    if (result.ok) {
      summary.aiCallOk += 1;
      summary.enqueuedAfterAi += 1;
      summary.estimatedUsdTotal += Number(result.callLog && result.callLog.estimatedUsd) || 0;
      out.push(result.candidate);
      if (calls >= env.maxCallsPerRun) break;
      continue;
    }

    if (result.outcome === evalCore.OUTCOME.AI_OUTPUT_VALIDATION_FAILED) summary.validationFailed += 1;
    else summary.callFailed += 1;
  }

  const hint = evalCore.classifyRunAiSummary(summary);
  return { candidates: out, summary: summary, runOutcomeHint: hint };
}

module.exports = {
  evaluateOneCandidate: evaluateOneCandidate,
  processReadyCandidatesForUsAi: processReadyCandidatesForUsAi,
  probeAiConfiguration: function probeAiConfiguration(env) {
    const e = readUsAiEnv(env);
    return {
      configured: e.configured,
      provider: e.provider,
      model: e.model,
      blockedReason: e.blockedReason,
      callPath: e.configured ? 'daily-issue-openai-adapter.callOpenAiStructured' : 'BLOCKED_NOT_CONFIGURED',
      envPresent: !!(e.apiKey && e.apiKey.length),
      envVarNames: ['DAILY_ISSUE_US_AI_API_KEY', 'OPENAI_API_KEY', 'DAILY_ISSUE_US_AI_MODEL'],
    };
  },
};
