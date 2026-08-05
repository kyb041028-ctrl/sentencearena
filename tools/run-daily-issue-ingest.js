#!/usr/bin/env node
'use strict';

/**
 * 데일리 이슈 외부 출처 수집 CLI (3차 — freshness)
 * 기본: dry-run
 *
 * --group=korea-economy|korea-policy|world
 * --fresh-only --as-of=ISO --max-age-hours=n
 * --publish-candidates --output=path --output-fresh-bundle=path
 */

const path = require('path');
const { runDailyIssueIngest } = require('../server/daily-issue-ingest-service');
const registry = require('../config/daily-issue-source-registry');

function parseArgs(argv) {
  const out = {
    dryRun: true,
    publishCandidates: false,
    freshOnly: false,
    verbose: false,
    smoke: false,
    writeCache: false,
    includeBackground: false,
  };
  argv.forEach(function (a) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--write-cache') {
      out.writeCache = true;
      out.dryRun = false;
    } else if (a === '--publish-candidates') out.publishCandidates = true;
    else if (a === '--fresh-only') {
      out.freshOnly = true;
      out.publishCandidates = true;
    } else if (a === '--verbose') out.verbose = true;
    else if (a === '--smoke') {
      out.smoke = true;
      out.maxItems = 3;
      out.dryRun = true;
    } else if (a === '--include-background=true') out.includeBackground = true;
    else if (a === '--include-background=false') out.includeBackground = false;
    else if (a.startsWith('--source=')) out.sourceId = a.slice(9);
    else if (a.startsWith('--group=')) out.group = a.slice(8);
    else if (a.startsWith('--category=')) out.category = a.slice(11);
    else if (a.startsWith('--max-items=')) out.maxItems = Number(a.slice(12));
    else if (a.startsWith('--since-hours=')) out.sinceHours = Number(a.slice(14));
    else if (a.startsWith('--max-age-hours=')) out.maxAgeHours = Number(a.slice(16));
    else if (a.startsWith('--as-of=')) out.asOf = a.slice(8);
    else if (a.startsWith('--output=')) out.output = a.slice(9);
    else if (a.startsWith('--output-fresh-bundle=')) out.outputFreshBundle = a.slice(22);
  });
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const enabled = args.group ? registry.listSourcesByGroup(args.group) : registry.listEnabledSources();
  if (args.verbose) {
    console.log(
      'sources:',
      enabled
        .map(function (s) {
          return s.id;
        })
        .join(', '),
    );
  }

  const result = await runDailyIssueIngest({
    dryRun: args.dryRun,
    sourceId: args.sourceId,
    group: args.group,
    category: args.category,
    maxItems: args.maxItems,
    sinceHours: args.sinceHours,
    maxAgeHours: args.maxAgeHours,
    asOf: args.asOf,
    publishCandidates: args.publishCandidates,
    freshOnly: args.freshOnly,
    output: args.output,
    outputFreshBundle: args.outputFreshBundle,
    verbose: args.verbose,
  });

  const m = result.manifest;
  console.log('=== daily-issue ingest ===');
  console.log('runId:', m.runId);
  console.log('dryRun:', m.dryRun, 'group:', m.group || '(all)', 'asOf:', m.asOf);
  console.log('sources:');
  (m.sourceResults || []).forEach(function (r) {
    console.log(
      ' -',
      r.sourceId,
      r.ok ? 'OK' : 'FAIL',
      'fetchedItems=' + (r.fetchedItems || 0),
      'feedAccepted=' + (r.feedAcceptedItems || 0),
      'fullTextOk=' + (r.fullTextFetchSucceeded || 0) + '/' + (r.fullTextFetchAttempted || 0),
      r.error ? 'err=' + r.error : '',
    );
  });
  console.log(
    'documents:',
    m.normalizedCount,
    'dedup:',
    m.deduplicatedDocuments,
    'clusters:',
    m.clusterCount,
    'multiSource:',
    m.multiSourceClusterCount,
  );
  console.log(
    'fullText:',
    m.fullTextFetchSucceeded + '/' + m.fullTextFetchAttempted,
    'evidenceEligible:',
    m.evidenceEligibleDocuments,
  );
  console.log(
    'qualityReady(before freshness):',
    m.qualityReadyBeforeFreshness,
    'freshnessReady:',
    m.freshnessReady,
    'READY(final):',
    m.readyCount,
    'QUARANTINED:',
    m.quarantinedCount,
  );
  console.log('failure reasons:', JSON.stringify(m.failureReasonCounts || {}));
  console.log('freshness reasons:', JSON.stringify(m.freshnessFailureReasonCounts || {}));
  if (m.pairAnalysis) {
    console.log(
      'pairAnalysis: candidates=',
      m.pairAnalysis.crossSourcePairCandidates,
      'rejects=',
      JSON.stringify(m.pairAnalysis.rejectedPairReasons || {}),
    );
  }
  if (m.readyTitles && m.readyTitles.length) {
    console.log('READY titles (quality+freshness):');
    m.readyTitles.forEach(function (t) {
      console.log(' -', t.title, '[' + (t.freshnessClass || '') + ']', '(' + (t.sources || []).join(', ') + ')');
    });
  }
  if (m.freshReport && m.freshReport.quarantinedSummaries && m.freshReport.quarantinedSummaries.length) {
    console.log('quality-READY but freshness-quarantined:');
    m.freshReport.quarantinedSummaries.forEach(function (t) {
      console.log(' -', t.title, '[' + t.freshnessClass + ']', (t.freshnessFailureReasons || []).join(','));
    });
  }
  if (m.multiSourceClusters && m.multiSourceClusters.length && args.verbose) {
    console.log('multi-source clusters:');
    m.multiSourceClusters.forEach(function (c) {
      console.log(' -', c.id, 'ents=', (c.sharedEntities || []).join('|'), 'tokens=', (c.sharedTokens || []).slice(0, 5).join('|'));
    });
  }
  if (m.errors && m.errors.length) console.log('errors:', JSON.stringify(m.errors));
  if (args.output) console.log('wrote:', path.resolve(args.output));
  if (args.outputFreshBundle) console.log('fresh bundle:', path.resolve(args.outputFreshBundle));
  if ((args.publishCandidates || args.freshOnly) && result.bundle) {
    console.log('bundle readyCount:', result.bundle.readyCount, 'freshOnly:', result.bundle.freshOnly);
  }
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
