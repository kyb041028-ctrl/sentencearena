'use strict';

/**
 * Daily Issue — shared AI service (KR/US). Rule gates first; no silent bypass.
 */

const { readRegionAiEnv, isAiPipelineEnabledForRegion, normalizeRegion } = require('../config/daily-issue-ai-env');
const evalCore = require('../shared/daily-issue-ai-eval-core');
const openaiAdapter = require('./daily-issue-openai-adapter');

function emptySummary(region) {
  return {
    region: normalizeRegion(region),
    eligible: 0,
    skippedNotEligible: 0,
    blockedNotConfigured: false,
    aiCallOk: 0,
    callFailed: 0,
    validationFailed: 0,
    sourceVerificationFailed: 0,
    costLimited: 0,
    readyBeforeAi: 0,
    enqueuedAfterAi: 0,
    calls: [],
    estimatedUsdTotal: 0,
  };
}

async function evaluateOneCandidate(cand, opts) {
  const o = opts || {};
  const region = normalizeRegion(o.region, cand);
  const asOf = o.asOf || cand.retrievedAt || new Date().toISOString();
  const gate = evalCore.ruleEligibleForAi(cand, region);
  if (!gate.ok) {
    return {
      ok: false,
      skipped: true,
      outcome: evalCore.OUTCOME.SKIPPED_NOT_ELIGIBLE,
      reason: gate.reason,
      runOutcome: gate.code,
      candidate: cand,
      region: region,
    };
  }

  const env = readRegionAiEnv(region, o.env);
  if (!env.configured) {
    return {
      ok: false,
      outcome: evalCore.OUTCOME.BLOCKED_NOT_CONFIGURED,
      errorCode: env.blockedReason || 'BLOCKED_NOT_CONFIGURED',
      runOutcome: evalCore.RUN_OUTCOME.AI_NOT_CONFIGURED,
      candidate: cand,
      region: region,
      aiMeta: { configured: false, outcome: 'BLOCKED_NOT_CONFIGURED', region: region, asOf: asOf },
    };
  }

  if (o.callsSoFar >= env.maxCallsPerRun) {
    return {
      ok: false,
      outcome: evalCore.OUTCOME.AI_COST_LIMIT,
      errorCode: 'AI_COST_LIMIT',
      runOutcome: evalCore.RUN_OUTCOME.AI_CALL_FAILED,
      candidate: cand,
      region: region,
    };
  }

  if (o.estimatedUsdSoFar >= env.maxEstimatedUsdPerRun) {
    return {
      ok: false,
      outcome: evalCore.OUTCOME.AI_COST_LIMIT,
      errorCode: 'AI_COST_LIMIT',
      runOutcome: evalCore.RUN_OUTCOME.AI_CALL_FAILED,
      candidate: cand,
      region: region,
    };
  }

  const input = evalCore.buildModelInput(cand, { asOf: asOf, region: region });
  const callFn =
    (o.adapter && typeof o.adapter.callStructured === 'function' &&
      function (inp) {
        return o.adapter.callStructured(inp, { env: o.env, region: region });
      }) ||
    function (inp) {
      return openaiAdapter.callOpenAiStructured(inp, { env: o.env, region: region });
    };

  const started = Date.now();
  const res = await callFn(input);
  const latencyMs = Date.now() - started;

  const callLog = {
    region: region,
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
              : evalCore.OUTCOME.AI_CALL_FAILED,
      errorCode: res.errorCode || 'AI_CALL_FAILED',
      runOutcome: evalCore.RUN_OUTCOME.AI_CALL_FAILED,
      candidate: cand,
      callLog: callLog,
      region: region,
    };
  }

  const validation = evalCore.validateStructuredOutput(cand, res.payload, region, { asOf: asOf });
  if (!validation.ok) {
    return {
      ok: false,
      outcome: evalCore.OUTCOME.AI_OUTPUT_VALIDATION_FAILED,
      errorCode: 'AI_OUTPUT_VALIDATION_FAILED',
      runOutcome: evalCore.RUN_OUTCOME.AI_OUTPUT_VALIDATION_FAILED,
      blockedReasons: validation.blockedReasons,
      candidate: cand,
      callLog: callLog,
      region: region,
      aiMeta: {
        outcome: 'AI_OUTPUT_VALIDATION_FAILED',
        blockedReasons: validation.blockedReasons,
        region: region,
        asOf: asOf,
      },
    };
  }

  const enriched = evalCore.applyAiContentToCandidate(cand, res.payload, region);
  enriched.lifecycleMeta = Object.assign({}, enriched.lifecycleMeta || {}, {
    activityRegion: region,
    aiEval: {
      outcome: 'AI_CALL_OK',
      validatedAt: asOf,
      model: res.model,
      provider: res.provider,
      estimatedUsd: res.estimatedUsd,
      usage: res.usage,
      region: region,
    },
  });
  if (region === 'US') {
    enriched.lifecycleMeta.usAiEval = enriched.lifecycleMeta.aiEval;
  }

  return {
    ok: true,
    outcome: evalCore.OUTCOME.AI_CALL_OK,
    runOutcome: null,
    candidate: enriched,
    callLog: callLog,
    region: region,
  };
}

async function processReadyCandidatesForAi(readyList, options) {
  const o = options || {};
  const region = normalizeRegion(o.region);
  const list = Array.isArray(readyList) ? readyList : [];
  const summary = emptySummary(region);
  summary.readyBeforeAi = list.length;

  if (!isAiPipelineEnabledForRegion(region, o.env)) {
    return { candidates: list, summary: summary, runOutcomeHint: null, aiPipelineSkipped: true };
  }

  const env = readRegionAiEnv(region, o.env);
  if (!env.configured) {
    summary.blockedNotConfigured = true;
    return {
      candidates: [],
      summary: summary,
      runOutcomeHint: evalCore.RUN_OUTCOME.AI_NOT_CONFIGURED,
      aiPipelineSkipped: false,
    };
  }

  const out = [];
  let calls = 0;
  let usd = 0;

  for (let i = 0; i < list.length; i += 1) {
    const cand = Object.assign({}, list[i], { activityRegion: region });
    const gate = evalCore.ruleEligibleForAi(cand, region);
    if (!gate.ok) {
      summary.skippedNotEligible += 1;
      if (gate.code === evalCore.RUN_OUTCOME.SOURCE_VERIFICATION_FAILED) summary.sourceVerificationFailed += 1;
      continue;
    }
    summary.eligible += 1;

    const result = await evaluateOneCandidate(cand, {
      asOf: o.asOf,
      env: o.env,
      adapter: o.adapter,
      region: region,
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

  const hint = evalCore.classifyRunAiSummary(summary, region);
  return { candidates: out, summary: summary, runOutcomeHint: hint, aiPipelineSkipped: false };
}

function probeAiConfiguration(region, env) {
  const r = normalizeRegion(region);
  const e = readRegionAiEnv(r, env);
  return {
    region: r,
    configured: e.configured,
    pipelineEnabled: isAiPipelineEnabledForRegion(r, env),
    provider: e.provider,
    model: e.model,
    blockedReason: e.blockedReason,
    callPath: e.configured ? 'daily-issue-openai-adapter.callOpenAiStructured' : 'BLOCKED_NOT_CONFIGURED',
    envVarNames: [
      'DAILY_ISSUE_AI_API_KEY',
      'OPENAI_API_KEY',
      r === 'US' ? 'DAILY_ISSUE_US_AI_API_KEY' : 'DAILY_ISSUE_KR_AI_API_KEY',
    ],
  };
}

module.exports = {
  evaluateOneCandidate: evaluateOneCandidate,
  processReadyCandidatesForAi: processReadyCandidatesForAi,
  probeAiConfiguration: probeAiConfiguration,
  processReadyCandidatesForUsAi: function (list, opt) {
    return processReadyCandidatesForAi(list, Object.assign({}, opt || {}, { region: 'US' }));
  },
};
