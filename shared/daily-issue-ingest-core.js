/**
 * 데일리 이슈 — evidence/claim 후보 생성 · 후보→품질게이트 · 브라우저 번들 변환
 * (네트워크 비의존, 기존 source/claim/quality core 재사용)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./daily-issue-source-core'),
      require('./daily-issue-claim-core'),
      require('./daily-issue-quality-core'),
      require('./daily-issue-feed-core'),
      require('./daily-issue-cluster-core'),
      require('./daily-issue-freshness-core'),
    );
  } else {
    root.DailyIssueIngestCore = factory(
      root.DailyIssueSourceCore,
      root.DailyIssueClaimCore,
      root.DailyIssueQualityCore,
      root.DailyIssueFeedCore,
      root.DailyIssueClusterCore,
      root.DailyIssueFreshnessCore,
    );
  }
})(typeof self !== 'undefined' ? self : this, function dailyIssueIngestCoreFactory(
  sourceCore,
  claimCore,
  qualityCore,
  feedCore,
  clusterCore,
  freshnessCore,
) {
  'use strict';

  var DISCUSSION_TEMPLATES = Object.freeze([
    '현재 공개된 정보에서 추가로 확인해야 할 부분은 무엇이라고 생각하나요?',
    '이 사안에서 가장 중요하게 고려해야 할 기준은 무엇이라고 생각하나요?',
    '공개된 내용이 사회에 어떤 영향을 줄 수 있다고 생각하나요?',
  ]);

  var EMOTION_TITLE_MARKERS = [
    '충격',
    '경악',
    '필독',
    '속보!',
    '대반전',
    '충격적',
    '반드시 보세요',
    '논란 폭발',
    '대참사',
    '최악',
    '무능',
    '파문',
    '초토화',
    '단독',
    '속보',
  ];
  var BOILERPLATE_MARKERS = [
    '저작권',
    'copyright',
    '무단 전재',
    '관련 기사',
    '기자 프로필',
    '구독하기',
    '광고',
    'all rights reserved',
    'continue reading',
    'image credit',
  ];
  var ATTRIBUTION_RE =
    /^(.{1,40}?)(?:은|는|이|가)\s+.{0,120}?(밝혔다|설명했다|주장했다|비판했다|전망했다|발표했다|해명했다|반박했다|부인했다)/;

  function trimStr(v) {
    return String(v == null ? '' : v).trim();
  }

  function selectDiscussionPrompt(seed) {
    var n = Math.abs(Number(seed) || 0) % DISCUSSION_TEMPLATES.length;
    return DISCUSSION_TEMPLATES[n];
  }

  function titleLooksEmotional(title) {
    var t = trimStr(title);
    var i;
    for (i = 0; i < EMOTION_TITLE_MARKERS.length; i++) {
      if (t.indexOf(EMOTION_TITLE_MARKERS[i]) >= 0) return true;
    }
    if (/[!?]{2,}/.test(t)) return true;
    return false;
  }

  function selectClusterTitle(docs) {
    var list = (docs || []).slice().filter(function (d) {
      return d && d.title;
    });
    if (!list.length) return { title: '', ok: false, reason: 'TITLE_MISSING' };
    var calm = list.filter(function (d) {
      return !titleLooksEmotional(d.title);
    });
    if (!calm.length) {
      return {
        title: trimStr(list[0].publisher) + ': ' + trimStr(list[0].title),
        ok: false,
        reason: 'EMOTIONAL_TITLE_ONLY',
      };
    }
    // 1) official neutral title
    var official = calm.filter(function (d) {
      return String(d.sourceType || '').toUpperCase() === 'OFFICIAL' ||
        String(d.sourceType || '').toUpperCase() === 'STATISTICS';
    });
    var pool = official.length ? official : calm;
    // prefer titles with concrete identifiers (quotes, numbers, named entities)
    pool = pool.slice().sort(function (a, b) {
      var sa =
        (clusterCore.extractEntities(a.title).length || 0) * 3 +
        (/\d/.test(a.title) ? 2 : 0) +
        (/[「『]/.test(a.title) ? 2 : 0) -
        trimStr(a.title).length / 200;
      var sb =
        (clusterCore.extractEntities(b.title).length || 0) * 3 +
        (/\d/.test(b.title) ? 2 : 0) +
        (/[「『]/.test(b.title) ? 2 : 0) -
        trimStr(b.title).length / 200;
      return sb - sa;
    });
    return { title: trimStr(pool[0].title), ok: true, reason: '' };
  }

  function numbersInText(text) {
    return clusterCore.extractNumbers(text);
  }

  function evidenceCoversClaimNumbers(claimText, evidenceTexts) {
    var nums = numbersInText(claimText);
    var blob = evidenceTexts.join(' ');
    var i;
    for (i = 0; i < nums.length; i++) {
      if (blob.indexOf(nums[i]) < 0) return false;
    }
    return true;
  }

  /**
   * Cross-source consensus claims without inventing sentences.
   * Uses an evidence sentence from one doc only if key entities/numbers are supported by another.
   */
  function buildCrossSourceConsensusClaims(docs, evidences) {
    var claims = [];
    if (!docs || docs.length < 2 || !evidences || evidences.length < 2) return claims;
    var bySource = {};
    evidences.forEach(function (e) {
      if (!e || e.anonymousAttribution) return;
      if (!bySource[e.sourceId]) bySource[e.sourceId] = [];
      bySource[e.sourceId].push(e);
    });
    var sourceIds = Object.keys(bySource);
    if (sourceIds.length < 2) return claims;

    var sharedEntities = clusterCore.extractEntities(
      docs
        .map(function (d) {
          return (d.title || '') + ' ' + String(d.rawText || '').slice(0, 400);
        })
        .join(' '),
    );
    // entities present in at least 2 docs
    sharedEntities = sharedEntities.filter(function (ent) {
      var hit = 0;
      docs.forEach(function (d) {
        var blob = normalizeTitleSafe((d.title || '') + ' ' + String(d.rawText || '').slice(0, 400));
        if (blob.indexOf(ent) >= 0) hit += 1;
      });
      return hit >= 2;
    });
    if (!sharedEntities.length) return claims;

    var i;
    for (i = 0; i < evidences.length; i++) {
      var ev = evidences[i];
      if (!ev || !ev.text || ev.anonymousAttribution) continue;
      var entHit = sharedEntities.filter(function (ent) {
        return normalizeTitleSafe(ev.text).indexOf(ent) >= 0;
      });
      if (!entHit.length) continue;
      // find supporting evidence from another source containing same entity
      var support = null;
      var s;
      for (s = 0; s < evidences.length; s++) {
        var other = evidences[s];
        if (!other || other.id === ev.id || other.sourceId === ev.sourceId) continue;
        if (
          entHit.some(function (ent) {
            return normalizeTitleSafe(other.text).indexOf(ent) >= 0;
          })
        ) {
          support = other;
          break;
        }
      }
      if (!support) continue;
      var claimText = ev.text;
      // effect/forecast language → attributed only
      if (/도움이 될|전망|예상|우려|효과/.test(claimText) && /설명|주장|전망|밝혔/.test(claimText)) {
        claims.push({
          id: 'cl_x_attr_' + claims.length,
          text: claimText,
          classification: 'ATTRIBUTED_CLAIM',
          speaker: ev.speaker || '',
          subject: ev.subject || '',
          evidenceIds: [ev.id, support.id],
          supportingSourceIds: [ev.sourceId, support.sourceId],
          isCore: true,
        });
        continue;
      }
      if (!evidenceCoversClaimNumbers(claimText, [ev.text, support.text])) {
        // keep as disagreement or skip confirmed
        var numsA = numbersInText(ev.text);
        var numsB = numbersInText(support.text);
        var conflict =
          numsA.some(function (n) {
            return numsB.indexOf(n) < 0;
          }) && numsB.length > 0;
        if (conflict) {
          claims.push({
            id: 'cl_x_dis_' + claims.length,
            text: '해당 수치는 출처마다 다르게 집계되고 있다.',
            classification: 'SOURCE_DISAGREEMENT',
            evidenceIds: [ev.id, support.id],
            supportingSourceIds: [ev.sourceId, support.sourceId],
            variants: [
              { value: numsA[0] || '', unit: '', label: ev.sourceId, sourceIds: [ev.sourceId], evidenceIds: [ev.id] },
              {
                value: numsB[0] || '',
                unit: '',
                label: support.sourceId,
                sourceIds: [support.sourceId],
                evidenceIds: [support.id],
              },
            ],
            isCore: true,
          });
        }
        continue;
      }
      claims.push({
        id: 'cl_x_cf_' + claims.length,
        text: claimText,
        classification: 'CONFIRMED_FACT',
        speaker: ev.speaker || '',
        subject: ev.subject || '',
        evidenceIds: [ev.id, support.id],
        supportingSourceIds: [ev.sourceId, support.sourceId],
        isCore: true,
      });
      if (claims.filter(function (c) {
        return c.classification === 'CONFIRMED_FACT';
      }).length >= 2)
        break;
    }
    return claims;
  }

  function normalizeTitleSafe(s) {
    return clusterCore.normalizeTitleKey(s);
  }

  function feedItemToDocument(item, registrySource, rawTextInfo, temporalOpts) {
    var text = (rawTextInfo && rawTextInfo.text) || '';
    var hash = clusterCore.contentHash(text || item.url || item.title);
    var id =
      'doc_' +
      trimStr(registrySource && registrySource.id) +
      '_' +
      clusterCore.contentHash(trimStr(item.externalId || item.url)).slice(0, 16);
    var o = temporalOpts || {};
    var retrievedAt = trimStr(item.retrievedAt) || trimStr(o.retrievedAt) || null;
    var feedSeenAt = trimStr(item.feedSeenAt) || trimStr(o.feedSeenAt) || retrievedAt;
    // publishedAt/updatedAt은 피드 값만 — retrievedAt으로 채우지 않음
    return {
      id: id,
      sourceId: id,
      externalId: item.externalId,
      publisher: registrySource.publisher || item.publisher,
      title: item.title,
      url: item.url,
      publishedAt: item.publishedAt || null,
      updatedAt: item.updatedAt || null,
      feedSeenAt: feedSeenAt,
      retrievedAt: retrievedAt,
      firstSeenAt: trimStr(o.firstSeenAt) || retrievedAt,
      lastSeenAt: trimStr(o.lastSeenAt) || feedSeenAt,
      sourceEventDate: null,
      sourceEventDateConfidence: null,
      author: item.author || '',
      sourceType: registrySource.sourceType,
      documentType: registrySource.documentType,
      originDomain: registrySource.originDomain || feedCore.normalizeArticleUrl(item.url).originDomain,
      primarySourceUrl: '',
      language: registrySource.language || '',
      country: registrySource.country || '',
      rawText: text,
      normalizedText: text.toLowerCase(),
      contentHash: hash,
      categories: [].concat(item.categories || [], registrySource.categories || []),
      sourceRegistryId: registrySource.id,
      textFrom: (rawTextInfo && rawTextInfo.from) || 'empty',
    };
  }

  function documentToSource(doc) {
    return sourceCore.normalizeSourceDocument({
      id: doc.sourceId || doc.id,
      publisher: doc.publisher,
      title: doc.title,
      url: doc.url,
      publishedAt: doc.publishedAt,
      updatedAt: doc.updatedAt,
      feedSeenAt: doc.feedSeenAt,
      retrievedAt: doc.retrievedAt,
      firstSeenAt: doc.firstSeenAt,
      lastSeenAt: doc.lastSeenAt,
      sourceEventDate: doc.sourceEventDate,
      sourceEventDateConfidence: doc.sourceEventDateConfidence,
      sourceType: doc.sourceType,
      documentType: doc.documentType,
      originDomain: doc.originDomain,
      author: doc.author,
      primarySourceUrl: doc.primarySourceUrl,
      language: doc.language,
      country: doc.country,
      contentHash: doc.contentHash,
      rawText: doc.rawText,
      normalizedText: doc.normalizedText,
    });
  }

  function isBoilerplateSentence(s) {
    var t = String(s || '').toLowerCase();
    var i;
    for (i = 0; i < BOILERPLATE_MARKERS.length; i++) {
      if (t.indexOf(BOILERPLATE_MARKERS[i].toLowerCase()) >= 0) return true;
    }
    return false;
  }

  function splitSentences(rawText) {
    var text = String(rawText || '');
    var parts = text.split(/(?<=[.。!?？])\s+|\n+/);
    return parts.map(trimStr).filter(Boolean);
  }

  function extractSpeakerSubject(sentence) {
    var s = trimStr(sentence);
    var anonymous = /관계자|일각에서는|업계에 따르면|소식통에 따르면/.test(s);
    if (anonymous) {
      return { speaker: '', subject: '', anonymous: true };
    }
    var m = s.match(ATTRIBUTION_RE);
    if (!m) return { speaker: '', subject: '', anonymous: false };
    var speaker = trimStr(m[1]).replace(/^(또|한편|이에|또한)\s*/, '');
    if (speaker.length < 2 || speaker.length > 40) return { speaker: '', subject: '', anonymous: false };
    return { speaker: speaker, subject: speaker, anonymous: false };
  }

  function inferEvidenceType(sentence, speakerInfo) {
    if (/전망|예상|분석/.test(sentence)) return 'FORECAST';
    if (speakerInfo && speakerInfo.speaker && /밝혔|설명|주장|비판|해명/.test(sentence)) {
      return 'OFFICIAL_STATEMENT';
    }
    if (/\d/.test(sentence)) return 'DATA_POINT';
    return 'DOCUMENT_TEXT';
  }

  function extractEvidencesFromDocument(doc, opts) {
    var o = opts || {};
    var minLen = isFinite(Number(o.minLen)) ? Number(o.minLen) : 16;
    var maxCount = isFinite(Number(o.maxCount)) ? Number(o.maxCount) : 12;
    var raw = String(doc.rawText || '');
    if (raw.length < 40) return [];
    var sentences = splitSentences(raw);
    var out = [];
    var i;
    for (i = 0; i < sentences.length; i++) {
      var sent = sentences[i];
      if (sent.length < minLen || sent.length > 400) continue;
      if (isBoilerplateSentence(sent)) continue;
      var start = raw.indexOf(sent);
      if (start < 0) continue; // must be substring
      var end = start + sent.length;
      // verify exact substring
      if (raw.slice(start, end) !== sent) continue;
      var sp = extractSpeakerSubject(sent);
      var conf = 0.7;
      if (/\d{4}/.test(sent) || /\d/.test(sent)) conf += 0.1;
      if (sp.speaker) conf += 0.1;
      if (sp.anonymous) conf = 0.35;
      if (conf < 0.5 && !sp.speaker && !/\d/.test(sent)) continue;
      out.push({
        id: 'ev_' + (doc.id || 'd') + '_' + out.length,
        sourceId: doc.sourceId || doc.id,
        text: sent,
        normalizedText: sent.toLowerCase(),
        startOffset: start,
        endOffset: end,
        speaker: sp.speaker,
        subject: sp.subject,
        publishedAt: doc.publishedAt || '',
        evidenceType: inferEvidenceType(sent, sp),
        extractionConfidence: Math.min(0.95, conf),
        anonymousAttribution: !!sp.anonymous,
      });
      if (out.length >= maxCount) break;
    }
    return out;
  }

  function buildClaimsFromEvidences(evidences, sources) {
    var claims = [];
    var byText = {};
    (evidences || []).forEach(function (ev, idx) {
      if (!ev || !ev.text) return;
      if (ev.anonymousAttribution) {
        claims.push({
          id: 'cl_anon_' + idx,
          text: ev.text,
          classification: 'UNVERIFIED',
          speaker: '',
          subject: '',
          evidenceIds: [ev.id],
          supportingSourceIds: [ev.sourceId],
          isCore: false,
        });
        return;
      }
      var key = clusterCore.normalizeTitleKey(ev.text);
      if (byText[key]) {
        byText[key].evidenceIds.push(ev.id);
        if (byText[key].supportingSourceIds.indexOf(ev.sourceId) < 0) {
          byText[key].supportingSourceIds.push(ev.sourceId);
        }
        return;
      }
      var classHint = '';
      if (ev.speaker && /밝혔|설명|주장|비판|해명|전망/.test(ev.text)) {
        classHint = /전망|예상|분석/.test(ev.text) ? 'ANALYSIS_FORECAST' : 'ATTRIBUTED_CLAIM';
      }
      var claim = {
        id: 'cl_' + idx,
        text: ev.text,
        speaker: ev.speaker || '',
        subject: ev.subject || '',
        evidenceIds: [ev.id],
        supportingSourceIds: [ev.sourceId],
        isCore: true,
      };
      if (classHint) claim.classification = classHint;
      byText[key] = claim;
      claims.push(claim);
    });

    // Detect numeric disagreements across sources for same-ish claims
    var numMap = {};
    claims.forEach(function (c) {
      var nums = (c.text.match(/\d+(?:[.,]\d+)?/g) || []).map(function (x) {
        return x.replace(/,/g, '');
      });
      if (nums.length !== 1) return;
      var tokens = clusterCore.tokenize(c.text).slice(0, 5).join('|');
      if (!tokens) return;
      if (!numMap[tokens]) numMap[tokens] = [];
      numMap[tokens].push({ claim: c, value: nums[0] });
    });
    Object.keys(numMap).forEach(function (k) {
      var rows = numMap[k];
      var values = {};
      rows.forEach(function (r) {
        values[r.value] = values[r.value] || [];
        values[r.value].push(r);
      });
      var keys = Object.keys(values);
      if (keys.length < 2) return;
      var variants = keys.map(function (v) {
        return {
          value: v,
          unit: '',
          label: values[v][0].claim.supportingSourceIds[0] || '',
          sourceIds: values[v].map(function (r) {
            return r.claim.supportingSourceIds[0];
          }),
          evidenceIds: values[v].reduce(function (acc, r) {
            return acc.concat(r.claim.evidenceIds);
          }, []),
        };
      });
      claims.push({
        id: 'cl_disagree_' + k.slice(0, 12),
        text: '해당 수치는 출처마다 다르게 집계되고 있다.',
        classification: 'SOURCE_DISAGREEMENT',
        evidenceIds: variants.reduce(function (a, v) {
          return a.concat(v.evidenceIds);
        }, []),
        supportingSourceIds: variants.reduce(function (a, v) {
          return a.concat(v.sourceIds);
        }, []),
        variants: variants,
        isCore: true,
      });
    });

    // Prefer CONFIRMED_FACT only when multiple independent sources share near-identical text
    claims.forEach(function (c) {
      if (c.classification) return;
      var indep = sourceCore.countIndependentSources(
        (sources || []).filter(function (s) {
          return c.supportingSourceIds.indexOf(s.id) >= 0;
        }),
      );
      if (indep >= 2 && c.evidenceIds.length >= 2) {
        c.classification = 'CONFIRMED_FACT';
      }
    });

    return claims;
  }

  function buildCandidateFromCluster(cluster, docsById, opts) {
    var o = opts || {};
    var docs = (cluster.documentIds || [])
      .map(function (id) {
        return docsById[id];
      })
      .filter(Boolean);
    var titlePick = selectClusterTitle(docs);
    var sources = docs.map(documentToSource);
    var evidences = [];
    docs.forEach(function (d) {
      evidences = evidences.concat(extractEvidencesFromDocument(d, o.evidenceOpts));
    });
    var claims = buildClaimsFromEvidences(evidences, sources);
    var cross = buildCrossSourceConsensusClaims(docs, evidences);
    claims = claims.concat(cross);
    // 교차 확인 CONFIRMED_FACT가 있으면 부수 UNVERIFIED는 핵심 전제에서 제외
    var hasConfirmed = claims.some(function (c) {
      return c.classification === 'CONFIRMED_FACT';
    });
    if (hasConfirmed) {
      claims.forEach(function (c) {
        // 미분류·UNVERIFIED는 부수 처리 (processCandidateClaims 전)
        if (!c.classification || c.classification === 'UNVERIFIED') c.isCore = false;
      });
    }
    var prompt = selectDiscussionPrompt(cluster.id ? cluster.id.length : 0);

    var indepGate = clusterCore.clusterHasIndependentSources(cluster, docsById, sourceCore);
    if (titlePick.reason === 'EMOTIONAL_TITLE_ONLY') {
      return {
        publicationStatus: 'QUARANTINED',
        ok: false,
        qualityFailureReasons: ['EMOTIONAL_TITLE_ONLY'],
        title: titlePick.title,
        discussionPrompt: prompt,
        normalizedSources: sources,
        normalizedEvidences: evidences,
        claims: claims,
        clusterId: cluster.id,
        independentSourceGate: indepGate,
      };
    }
    if (!indepGate.ok && docs.length >= 1) {
      // still run quality gate — will fail CONFIRMED/INDEPENDENT — do not invent sources
    }
    var built = qualityCore.buildDailyIssueCandidate({
      title: titlePick.title,
      discussionPrompt: prompt,
      sources: sources,
      evidences: evidences,
      candidateClaims: claims,
      retrievedAt: o.retrievedAt || new Date().toISOString(),
    });
    built.clusterId = cluster.id;
    built.independentSourceGate = indepGate;
    built.documents = docs.map(function (d) {
      return { id: d.id, url: d.url, publisher: d.publisher, title: d.title, sourceRegistryId: d.sourceRegistryId };
    });
    built.category = cluster.category || '';
    // quality → temporal → freshness (최종 READY는 둘 다 통과)
    if (o.skipFreshness) return built;
    return freshnessCore.applyFreshnessGateToCandidate(built, {
      asOf: o.asOf || o.retrievedAt,
      observationHistory: o.observationHistory || {},
      category: cluster.category || o.category,
      maxAgeHours: o.maxAgeHours,
    });
  }

  /**
   * READY 후보만 UI 호환 번들로 변환. choices/stance 생성 금지.
   */
  function buildPublishedCentristBundleFromCandidates(input) {
    var src = input || {};
    var generatedAt = trimStr(src.generatedAt) || new Date().toISOString();
    var bundleVersion = trimStr(src.bundleVersion) || 'ingest-v1';
    var candidates = Array.isArray(src.candidates) ? src.candidates : [];
    var freshOnly = src.freshOnly === true;
    var ready = candidates.filter(function (c) {
      if (!(c && c.ok && c.publicationStatus === 'READY')) return false;
      if (freshOnly && c.freshnessOk !== true) return false;
      return true;
    });
    var byCat = {};
    ready.forEach(function (c, idx) {
      var cat = trimStr((c.documents && c.documents[0] && c.category) || c.category || 'world') || 'world';
      if (!byCat[cat]) byCat[cat] = [];
      var evidencesLite = (c.normalizedEvidences || []).map(function (e) {
        return {
          id: e.id,
          sourceId: e.sourceId,
          text: e.text,
          startOffset: e.startOffset,
          endOffset: e.endOffset,
          speaker: e.speaker,
          evidenceType: e.evidenceType,
          extractionConfidence: e.extractionConfidence,
        };
      });
      var meta = Object.assign({}, c.sourceFactMeta || {}, {
        freshnessClass: c.freshnessClass || null,
        qualityCheckedAt: c.qualityCheckedAt || null,
        freshnessCheckedAt: c.freshnessCheckedAt || null,
        lastSourceUpdateAt: c.lastSourceUpdateAt || c.latestPublishedAt || null,
        sourceCount: (c.normalizedSources || []).length,
        independentSourceCount: (c.sourceFactMeta && c.sourceFactMeta.independentSourceCount) || 0,
      });
      byCat[cat].push({
        id: 'ingest_' + (c.clusterId || idx),
        topic: c.title,
        discussionPrompt: c.discussionPrompt,
        aiQuestion: c.discussionPrompt,
        confirmedSummary: c.confirmedSummary,
        summary: c.confirmedSummary,
        factSummary: c.confirmedSummary,
        sourceRefs: (c.normalizedSources || []).map(function (s) {
          return {
            id: s.id,
            publisher: s.publisher,
            title: s.title,
            url: s.url,
            publishedAt: s.publishedAt,
            sourceType: s.sourceType,
            documentType: s.documentType,
            originDomain: s.originDomain,
            author: s.author,
            updatedAt: s.updatedAt,
            feedSeenAt: s.feedSeenAt,
            retrievedAt: s.retrievedAt,
            sourceEventDate: s.sourceEventDate,
          };
        }),
        claims: (c.claims || []).filter(function (cl) {
          return cl.classification !== 'REJECTED';
        }),
        evidences: evidencesLite,
        displayGroups: c.displayGroups,
        publicationStatus: 'READY',
        qualityGateVersion: c.qualityGateVersion,
        qualityCheckedAt: c.qualityCheckedAt,
        freshnessClass: c.freshnessClass,
        freshnessCheckedAt: c.freshnessCheckedAt,
        lastSourceUpdateAt: meta.lastSourceUpdateAt,
        qualityFailureReasons: [],
        sourceFactMeta: meta,
        updatedAt: c.qualityCheckedAt || generatedAt,
        comments: [],
      });
    });
    var categories = {};
    Object.keys(byCat).forEach(function (cat) {
      categories[cat] = { issues: byCat[cat] };
    });
    return {
      bundleVersion: bundleVersion,
      generatedAt: generatedAt,
      publicationMode: 'CANDIDATES_ONLY',
      freshOnly: freshOnly,
      categories: categories,
      readyCount: ready.length,
      excludedQuarantined: candidates.length - ready.length,
    };
  }

  function buildFreshCandidateReport(candidates, opts) {
    var o = opts || {};
    var asOf = trimStr(o.asOf) || new Date().toISOString();
    var list = Array.isArray(candidates) ? candidates : [];
    var qualityReady = list.filter(function (c) {
      return c && c.qualityReadyBeforeFreshness;
    });
    var freshnessReady = list.filter(function (c) {
      return c && c.ok && c.publicationStatus === 'READY' && c.freshnessOk;
    });
    var freshnessQuarantined = list.filter(function (c) {
      return c && c.qualityReadyBeforeFreshness && !c.freshnessOk;
    });
    var reasonCounts = {};
    list.forEach(function (c) {
      (c.freshnessFailureReasons || []).forEach(function (r) {
        reasonCounts[r] = (reasonCounts[r] || 0) + 1;
      });
    });
    return {
      asOf: asOf,
      totalCandidates: list.length,
      qualityReadyBeforeFreshness: qualityReady.length,
      freshnessReady: freshnessReady.length,
      freshnessQuarantined: freshnessQuarantined.length,
      candidateSummaries: freshnessReady.map(function (c) {
        return {
          title: c.title,
          clusterId: c.clusterId,
          freshnessClass: c.freshnessClass,
          latestPublishedAt: c.latestPublishedAt,
          noveltySignals: (c.noveltySignals || []).map(function (n) {
            return n.type;
          }),
          sources: (c.normalizedSources || []).map(function (s) {
            return s.publisher;
          }),
        };
      }),
      failureReasonCounts: reasonCounts,
      quarantinedSummaries: freshnessQuarantined.map(function (c) {
        return {
          title: c.title,
          freshnessClass: c.freshnessClass,
          freshnessFailureReasons: c.freshnessFailureReasons,
          latestPublishedAt: c.latestPublishedAt,
        };
      }),
    };
  }

  return {
    DISCUSSION_TEMPLATES: DISCUSSION_TEMPLATES,
    selectDiscussionPrompt: selectDiscussionPrompt,
    selectClusterTitle: selectClusterTitle,
    feedItemToDocument: feedItemToDocument,
    documentToSource: documentToSource,
    extractSpeakerSubject: extractSpeakerSubject,
    extractEvidencesFromDocument: extractEvidencesFromDocument,
    buildClaimsFromEvidences: buildClaimsFromEvidences,
    buildFreshCandidateReport: buildFreshCandidateReport,
    applyFreshnessGateToCandidate: freshnessCore.applyFreshnessGateToCandidate,
    buildCrossSourceConsensusClaims: buildCrossSourceConsensusClaims,
    buildCandidateFromCluster: buildCandidateFromCluster,
    buildPublishedCentristBundleFromCandidates: buildPublishedCentristBundleFromCandidates,
  };
});
