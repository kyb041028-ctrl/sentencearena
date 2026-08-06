'use strict';

/**
 * 데일리 이슈 수집 오케스트레이션 (3차 — freshness gate)
 * dry-run 기본 · 공식 allowlist full-text · 최신성 게이트 · fail-closed
 */

const fs = require('fs');
const path = require('path');
const registry = require('../config/daily-issue-source-registry');
const fetcher = require('./daily-issue-feed-fetcher');
const officialExtractor = require('./daily-issue-official-page-extractor');
const feedCore = require('../shared/daily-issue-feed-core');
const clusterCore = require('../shared/daily-issue-cluster-core');
const ingestCore = require('../shared/daily-issue-ingest-core');
const sourceCore = require('../shared/daily-issue-source-core');

const DEFAULT_CACHE_ROOT = path.join(__dirname, '..', '.cache', 'daily-issue');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, obj) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
}

function pruneCacheDir(dir, maxFiles) {
  if (!fs.existsSync(dir)) return;
  const files = fs
    .readdirSync(dir)
    .map(function (name) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      return { p: p, mtime: st.mtimeMs };
    })
    .sort(function (a, b) {
      return b.mtime - a.mtime;
    });
  files.slice(Math.max(0, maxFiles || 40)).forEach(function (f) {
    try {
      fs.unlinkSync(f.p);
    } catch (_) {}
  });
}

function countReasons(candidates) {
  const map = {};
  (candidates || []).forEach(function (c) {
    (c.qualityFailureReasons || []).forEach(function (r) {
      const key = String(r).split(':')[0];
      map[key] = (map[key] || 0) + 1;
    });
    (c.freshnessFailureReasons || []).forEach(function (r) {
      const key = 'fresh:' + String(r).split(':')[0];
      map[key] = (map[key] || 0) + 1;
    });
  });
  return map;
}

function loadObservationHistory(cacheRoot) {
  const file = path.join(cacheRoot, 'observation-index.json');
  if (!fs.existsSync(file)) {
    return { urlFirstSeenAt: {}, contentHashFirstSeenAt: {}, titleHashFirstSeenAt: {} };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      urlFirstSeenAt: raw.urlFirstSeenAt || {},
      contentHashFirstSeenAt: raw.contentHashFirstSeenAt || {},
      titleHashFirstSeenAt: raw.titleHashFirstSeenAt || {},
    };
  } catch (_) {
    return { urlFirstSeenAt: {}, contentHashFirstSeenAt: {}, titleHashFirstSeenAt: {} };
  }
}

function mergeObservationHistory(prev, documents, asOf) {
  const out = {
    urlFirstSeenAt: Object.assign({}, (prev && prev.urlFirstSeenAt) || {}),
    contentHashFirstSeenAt: Object.assign({}, (prev && prev.contentHashFirstSeenAt) || {}),
    titleHashFirstSeenAt: Object.assign({}, (prev && prev.titleHashFirstSeenAt) || {}),
  };
  (documents || []).forEach(function (d) {
    const url = String(d.url || '').toLowerCase();
    const hash = String(d.contentHash || '');
    const titleKey = clusterCore.normalizeTitleKey(d.title || '');
    if (url && !out.urlFirstSeenAt[url]) out.urlFirstSeenAt[url] = asOf;
    if (hash && !out.contentHashFirstSeenAt[hash]) out.contentHashFirstSeenAt[hash] = asOf;
    if (titleKey && !out.titleHashFirstSeenAt[titleKey]) out.titleHashFirstSeenAt[titleKey] = asOf;
  });
  return out;
}

function emptySourceStats(sourceId) {
  return {
    sourceId: sourceId,
    ok: false,
    fetchedItems: 0,
    feedAcceptedItems: 0,
    feedRejectedItems: 0,
    fullTextFetchAttempted: 0,
    fullTextFetchSucceeded: 0,
    fullTextFetchFailed: 0,
    normalizedDocuments: 0,
    evidenceEligibleDocuments: 0,
    rejectionReasonCounts: {},
    error: null,
  };
}

function bumpReason(stats, code) {
  const key = String(code || 'UNKNOWN');
  stats.rejectionReasonCounts[key] = (stats.rejectionReasonCounts[key] || 0) + 1;
}

/**
 * @param {object} options
 */
async function runDailyIssueIngest(options) {
  const opt = options || {};
  const dryRun = opt.dryRun !== false;
  const startedAt = new Date().toISOString();
  const runId = 'run_' + startedAt.replace(/[:.]/g, '-');
  const cacheRoot = opt.cacheRoot || DEFAULT_CACHE_ROOT;
  const errors = [];
  const sourceResults = [];
  const pageHtmlByUrl = opt.pageHtmlByUrl || {};

  let languageFilter = opt.language != null ? String(opt.language).trim().toLowerCase() : '';
  if (!languageFilter && (opt.group === 'korea-economy' || opt.group === 'korea-policy')) {
    languageFilter = 'ko';
  }

  let sources = registry.listEnabledSources();
  if (opt.group) {
    sources = registry.listSourcesByGroup(opt.group, { language: languageFilter || undefined });
  } else if (languageFilter) {
    sources = sources.filter(function (s) {
      return String(s.language || '')
        .trim()
        .toLowerCase() === languageFilter;
    });
  }
  if (opt.sourceId) {
    const one = registry.getSourceById(opt.sourceId);
    sources = one && one.enabled ? [one] : [];
    if (!one) errors.push({ code: 'SOURCE_NOT_FOUND', message: String(opt.sourceId) });
    else if (!one.enabled) errors.push({ code: 'SOURCE_DISABLED', message: String(opt.sourceId) });
    else if (languageFilter && String(one.language || '').trim().toLowerCase() !== languageFilter) {
      sources = [];
      errors.push({ code: 'SOURCE_LANGUAGE_MISMATCH', message: String(opt.sourceId) });
    }
  }
  if (opt.category) {
    const cat = String(opt.category);
    sources = sources.filter(function (s) {
      return (s.categories || []).indexOf(cat) >= 0;
    });
  }

  const documents = [];
  const retrievedAt = startedAt;

  for (const src of sources) {
    const stats = emptySourceStats(src.id);
    const maxItems = Math.min(
      Number(opt.maxItems) > 0 ? Number(opt.maxItems) : src.maxItemsPerRun || 5,
      src.maxItemsPerRun || 5,
    );
    let body = '';
    let fetchMeta = null;
    try {
      if (opt.feedBodies && opt.feedBodies[src.id] != null) {
        body = String(opt.feedBodies[src.id]);
        fetchMeta = { status: 200, url: src.feedUrl, from: 'fixture' };
      } else if (opt.skipNetwork) {
        throw Object.assign(new Error('NETWORK_SKIPPED'), { code: 'NETWORK_SKIPPED' });
      } else {
        const fetched = await fetcher.fetchTextSafe(src.feedUrl, {
          timeoutMs: 12000,
          maxBytes: 1_500_000,
        });
        body = fetched.body;
        fetchMeta = fetched;
      }

      const parsed = feedCore.parseRssOrAtom(body, {
        publisher: src.publisher,
        sourceRegistryId: src.id,
        retrievedAt: retrievedAt,
      });
      if (!parsed.ok) {
        stats.error = parsed.reason || 'FEED_PARSE_FAILED';
        bumpReason(stats, stats.error);
        sourceResults.push(stats);
        errors.push({ sourceId: src.id, code: stats.error });
        continue;
      }

      stats.ok = true;
      stats.feedKind = parsed.feedKind;
      stats.status = fetchMeta && fetchMeta.status;

      let accepted = 0;
      for (const item of parsed.items) {
        stats.fetchedItems += 1;
        if (accepted >= maxItems) break;
        if (!feedCore.isValidFeedItem(item)) {
          stats.feedRejectedItems += 1;
          bumpReason(stats, (item.parseErrors && item.parseErrors[0]) || 'ITEM_INVALID');
          continue;
        }
        if (opt.sinceHours) {
          const ageH = (Date.now() - Date.parse(item.publishedAt)) / 36e5;
          if (Number.isFinite(ageH) && ageH > Number(opt.sinceHours)) {
            stats.feedRejectedItems += 1;
            bumpReason(stats, 'STALE_ITEM');
            continue;
          }
        }
        if (src.freshnessHours) {
          const ageH = (Date.now() - Date.parse(item.publishedAt)) / 36e5;
          if (Number.isFinite(ageH) && ageH > src.freshnessHours) {
            stats.feedRejectedItems += 1;
            bumpReason(stats, 'STALE_ITEM');
            continue;
          }
        }

        let rawInfo = feedCore.pickRawTextFromFeedItem(item, {
          allowFeedDescriptionEvidence: src.allowFeedDescriptionEvidence,
        });

        const needFullText =
          (!rawInfo.text || rawInfo.text.length < 40) &&
          src.allowFullTextFetch &&
          src.fullTextFetchPolicy === 'OFFICIAL_PUBLIC_DOCUMENT_ONLY';

        if (needFullText) {
          stats.fullTextFetchAttempted += 1;
          const extracted = await officialExtractor.extractOfficialPublicPage({
            sourceRegistryId: src.id,
            url: item.url,
            html: pageHtmlByUrl[item.url],
            skipNetwork: !!opt.skipNetwork && pageHtmlByUrl[item.url] == null,
          });
          if (extracted.ok && extracted.text && extracted.text.length >= 40) {
            stats.fullTextFetchSucceeded += 1;
            rawInfo = { text: extracted.text, from: 'official_page' };
          } else {
            stats.fullTextFetchFailed += 1;
            bumpReason(stats, extracted.reason || 'FULLTEXT_FAILED');
          }
        }

        if (!rawInfo.text || rawInfo.text.length < 40) {
          stats.feedRejectedItems += 1;
          bumpReason(stats, 'TITLE_ONLY_NO_EVIDENCE');
          continue;
        }

        stats.feedAcceptedItems += 1;
        const doc = ingestCore.feedItemToDocument(item, src, rawInfo, {
          retrievedAt: retrievedAt,
          feedSeenAt: retrievedAt,
        });
        documents.push(doc);
        stats.normalizedDocuments += 1;
        stats.evidenceEligibleDocuments += 1;
        accepted += 1;
      }
      sourceResults.push(stats);
    } catch (e) {
      stats.error = e.code || String(e.message || e);
      bumpReason(stats, stats.error);
      sourceResults.push(stats);
      errors.push({ sourceId: src.id, code: stats.error, message: String(e.message || e) });
    }
  }

  const dedup = clusterCore.deduplicateDocuments(documents);
  const clusters = clusterCore.clusterDocuments(dedup.documents);
  const docsById = {};
  dedup.documents.forEach(function (d) {
    docsById[d.id] = d;
  });

  const observationHistory = opt.observationHistory || loadObservationHistory(cacheRoot);
  const asOf = opt.asOf || retrievedAt;
  const pairAnalysis = clusterCore.analyzeCrossSourcePairStats(dedup.documents);

  // mark cluster participation in pair analysis
  clusters.forEach(function (cl) {
    const gate = clusterCore.clusterHasIndependentSources(cl, docsById, sourceCore);
    (cl.documentIds || []).forEach(function (id) {
      const d = docsById[id];
      if (!d) return;
      const sid = d.sourceRegistryId || d.publisher;
      if (pairAnalysis.bySource[sid]) pairAnalysis.bySource[sid].clusterParticipated += 1;
      if (gate.ok && pairAnalysis.bySource[sid]) {
        /* counted via clusterParticipated */
      }
    });
  });

  const multiSourceClusters = clusters.filter(function (cl) {
    return clusterCore.clusterHasIndependentSources(cl, docsById, sourceCore).ok;
  });

  const candidates = clusters.map(function (cl) {
    return ingestCore.buildCandidateFromCluster(cl, docsById, {
      retrievedAt: retrievedAt,
      asOf: asOf,
      observationHistory: observationHistory,
      maxAgeHours: opt.maxAgeHours,
      skipFreshness: !!opt.skipFreshness,
    });
  });

  const qualityReadyBeforeFreshness = candidates.filter(function (c) {
    return c.qualityReadyBeforeFreshness;
  });
  const ready = candidates.filter(function (c) {
    return c.ok && c.publicationStatus === 'READY';
  });
  const quarantined = candidates.filter(function (c) {
    return !c.ok || c.publicationStatus !== 'READY';
  });
  const freshReport = ingestCore.buildFreshCandidateReport(candidates, { asOf: asOf });

  let bundle = null;
  if (opt.publishCandidates || opt.freshOnly) {
    const bundleCandidates = opt.freshOnly
      ? candidates.filter(function (c) {
          return c.ok && c.freshnessOk;
        })
      : candidates;
    bundle = ingestCore.buildPublishedCentristBundleFromCandidates({
      candidates: bundleCandidates,
      generatedAt: retrievedAt,
      bundleVersion: 'ingest-v3-fresh',
      freshOnly: true,
    });
  }

  if (opt.outputFreshBundle) {
    writeJson(path.resolve(opt.outputFreshBundle), {
      freshReport: freshReport,
      bundle: bundle,
    });
  }

  const completedAt = new Date().toISOString();
  const manifest = {
    runId: runId,
    startedAt: startedAt,
    completedAt: completedAt,
    dryRun: dryRun,
    asOf: asOf,
    group: opt.group || '',
    publishCandidates: !!opt.publishCandidates,
    freshOnly: !!opt.freshOnly,
    sourceResults: sourceResults,
    fetchedCount: sourceResults.reduce(function (n, r) {
      return n + (r.fetchedItems || 0);
    }, 0),
    normalizedCount: documents.length,
    deduplicatedDocuments: dedup.documents.length,
    duplicateCount: (dedup.duplicates || []).length,
    clusterCount: clusters.length,
    multiSourceClusterCount: multiSourceClusters.length,
    qualityReadyBeforeFreshness: qualityReadyBeforeFreshness.length,
    readyCount: ready.length,
    freshnessReady: freshReport.freshnessReady,
    freshnessQuarantined: freshReport.freshnessQuarantined,
    quarantinedCount: quarantined.length,
    failureReasonCounts: countReasons(candidates),
    freshnessFailureReasonCounts: freshReport.failureReasonCounts,
    fullTextFetchAttempted: sourceResults.reduce(function (n, r) {
      return n + (r.fullTextFetchAttempted || 0);
    }, 0),
    fullTextFetchSucceeded: sourceResults.reduce(function (n, r) {
      return n + (r.fullTextFetchSucceeded || 0);
    }, 0),
    fullTextFetchFailed: sourceResults.reduce(function (n, r) {
      return n + (r.fullTextFetchFailed || 0);
    }, 0),
    evidenceEligibleDocuments: sourceResults.reduce(function (n, r) {
      return n + (r.evidenceEligibleDocuments || 0);
    }, 0),
    pairAnalysis: {
      crossSourcePairCandidates: pairAnalysis.crossSourcePairCandidates,
      rejectedPairReasons: pairAnalysis.rejectedPairReasons,
      bySource: pairAnalysis.bySource,
    },
    errors: errors,
    readyTitles: ready.map(function (c) {
      return {
        title: c.title,
        clusterId: c.clusterId,
        freshnessClass: c.freshnessClass,
        sources: (c.normalizedSources || []).map(function (s) {
          return s.publisher;
        }),
      };
    }),
    multiSourceClusters: multiSourceClusters.map(function (cl) {
      return {
        id: cl.id,
        documentIds: cl.documentIds,
        sharedTokens: cl.sharedTokens,
        sharedEntities: cl.sharedEntities,
        reasons: cl.clusteringReasons,
      };
    }),
    freshReport: freshReport,
  };

  const outputs = {
    manifest: manifest,
    documents: dryRun
      ? dedup.documents.map(function (d) {
          return {
            id: d.id,
            title: d.title,
            url: d.url,
            publisher: d.publisher,
            publishedAt: d.publishedAt,
            updatedAt: d.updatedAt,
            feedSeenAt: d.feedSeenAt,
            retrievedAt: d.retrievedAt,
            textFrom: d.textFrom,
            sourceRegistryId: d.sourceRegistryId,
          };
        })
      : dedup.documents,
    duplicates: dedup.duplicates,
    clusters: clusters,
    candidates: candidates.map(function (c) {
      return {
        clusterId: c.clusterId,
        title: c.title,
        publicationStatus: c.publicationStatus,
        ok: c.ok,
        qualityReadyBeforeFreshness: c.qualityReadyBeforeFreshness,
        freshnessOk: c.freshnessOk,
        freshnessClass: c.freshnessClass,
        qualityFailureReasons: c.qualityFailureReasons,
        freshnessFailureReasons: c.freshnessFailureReasons,
        noveltySignals: (c.noveltySignals || []).map(function (n) {
          return n.type;
        }),
        staleSignals: (c.staleSignals || []).map(function (s) {
          return s.type;
        }),
        latestPublishedAt: c.latestPublishedAt,
        confirmedSummary: c.confirmedSummary,
        sourceCount: (c.normalizedSources || []).length,
        evidenceCount: (c.normalizedEvidences || []).length,
        claimCount: (c.claims || []).length,
        confirmedClaimCount: (c.claims || []).filter(function (x) {
          return x && x.classification === 'CONFIRMED_FACT';
        }).length,
        titleFactMeta: c.titleFactMeta || null,
        independentSourceGate: c.independentSourceGate,
      };
    }),
    readyCandidates: ready,
    freshReport: freshReport,
    bundle: bundle,
  };

  if (!dryRun) {
    const docsDir = path.join(cacheRoot, 'documents');
    const clustersDir = path.join(cacheRoot, 'clusters');
    const candDir = path.join(cacheRoot, 'candidates');
    writeJson(path.join(docsDir, runId + '.json'), {
      runId: runId,
      documents: dedup.documents.map(function (d) {
        return {
          id: d.id,
          title: d.title,
          url: d.url,
          publisher: d.publisher,
          publishedAt: d.publishedAt,
          contentHash: d.contentHash,
          rawText: String(d.rawText || '').slice(0, 8000),
          sourceRegistryId: d.sourceRegistryId,
        };
      }),
    });
    writeJson(path.join(clustersDir, runId + '.json'), { runId: runId, clusters: clusters });
    writeJson(path.join(candDir, runId + '.json'), { runId: runId, candidates: outputs.candidates });
    writeJson(path.join(cacheRoot, 'run-manifest.json'), manifest);
    writeJson(path.join(cacheRoot, 'runs', runId + '.json'), manifest);
    const mergedObs = mergeObservationHistory(observationHistory, dedup.documents, asOf);
    writeJson(path.join(cacheRoot, 'observation-index.json'), mergedObs);
    pruneCacheDir(docsDir, 30);
    pruneCacheDir(clustersDir, 30);
    pruneCacheDir(candDir, 30);
    pruneCacheDir(path.join(cacheRoot, 'runs'), 40);
  }

  if (opt.output) {
    writeJson(path.resolve(opt.output), {
      manifest: manifest,
      candidates: outputs.candidates,
      readyTitles: manifest.readyTitles,
      freshReport: freshReport,
      bundle: bundle,
    });
  }

  return outputs;
}

module.exports = {
  runDailyIssueIngest: runDailyIssueIngest,
  DEFAULT_CACHE_ROOT: DEFAULT_CACHE_ROOT,
  countReasons: countReasons,
};
