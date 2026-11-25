'use strict';

/**
 * 실제 회원 표에서 계급 평가 입력을 읽는다.
 * 점수 계산은 shared/rank-formula-core.js, 배치는 shared/dec023-rank-evaluation-core.js 를 그대로 쓴다.
 * 국가 진행 표가 있으면 그 국가의 reputation_score만 명성으로 읽는다.
 * 표가 없으면 옛 user_progression.reputation_score 를 읽는다. citizen_rank 는 바꾸지 않는다.
 * 미국도 같은 국가 진행 표를 읽는다. 없는 국가 행은 한국 값으로 채우지 않는다.
 */
const formula = require('../shared/rank-formula-core');
const rank = require('../shared/dec023-rank-evaluation-core');

const TERRITORY_TO_PROFILE = Object.freeze({
  pioneer: 'PIONEER',
  central: 'CENTRAL',
  guardian: 'GUARDIAN',
});
const PROFILE_TO_TERRITORY = Object.freeze({
  PIONEER: 'pioneer',
  CENTRAL: 'central',
  GUARDIAN: 'guardian',
});

function localHost(client) {
  const params = client && client.connectionParameters ? client.connectionParameters : null;
  const host = params ? String(params.host || '') : '';
  return host === '127.0.0.1' || host === 'localhost';
}

function blocked(reason, extra) {
  return Object.assign({
    ok: false,
    applied: false,
    dryRun: true,
    reason: reason,
    productionApply: false,
    liveSupabase: false,
  }, extra || {});
}

async function tableColumns(client, table) {
  const found = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  const set = Object.create(null);
  found.rows.forEach(function (row) { set[row.column_name] = true; });
  return set;
}

function selectList(base, columns, optional) {
  const names = base.slice();
  optional.forEach(function (name) {
    if (columns[name]) names.push(name);
  });
  return names.join(', ');
}
function reactorFromDedupe(key) {
  const text = String(key || '');
  const prefix = 'EMPATHY_RECEIVED:';
  if (text.indexOf(prefix) !== 0) return '';
  const rest = text.slice(prefix.length);
  const cut = rest.lastIndexOf(':');
  if (cut <= 0) return '';
  return rest.slice(cut + 1).trim();
}

async function readSnapshot(client, country, territory, asOfMs, lock) {
  if (!localHost(client)) return blocked('REMOTE_DATABASE_BLOCKED');
  if (country !== 'KR' && country !== 'US') return blocked('COUNTRY_REQUIRED');
  if (!formula.isLocalMidnight(asOfMs, formula.zoneFor(country))) return blocked('NOT_REFRESH_MOMENT');
  const profileTerritory = TERRITORY_TO_PROFILE[territory];
  if (!profileTerritory) return blocked(territory === 'alien' ? 'TERRITORY_NOT_IN_PROFILES' : 'TERRITORY_REQUIRED');

  const countryFame = await client.query(
    `SELECT to_regclass('public.user_activity_region_profile') AS name`
  );
  const fameByCountry = !!(countryFame.rows[0] && countryFame.rows[0].name);
  const countryTerritoryColumn = fameByCountry
    ? await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'user_activity_region_profile'
         AND column_name = 'territory'`
    )
    : { rows: [] };
  const affiliationByCountry = countryTerritoryColumn.rows.length > 0;
  if (country === 'US' && !affiliationByCountry) return blocked('COUNTRY_PROFILE_UNAVAILABLE');
  if (fameByCountry && !affiliationByCountry) return blocked('COUNTRY_COLUMN_MISSING');
  const members = affiliationByCountry
    ? await client.query(
      `SELECT rp.user_id::text AS id,
              upper(rp.territory) AS territory,
              NULL::text AS home_country,
              rp.reputation_score
       FROM public.user_activity_region_profile rp
       WHERE rp.activity_region = $2
         AND rp.territory IS NOT NULL
         AND btrim(rp.territory) <> ''
         AND upper(btrim(rp.territory)) = $1`,
      [profileTerritory, country]
    )
    : await client.query(
      `SELECT p.id::text AS id, p.territory, p.home_country, up.reputation_score
       FROM public.profiles p
       LEFT JOIN public.user_progression up ON up.user_id = p.id
       WHERE p.territory = $1`,
      [profileTerritory]
    );
  const ids = members.rows.map(function (row) { return row.id; });
  if (!ids.length) return blocked('MEMBER_SOURCE_MISSING');
  if (lock === true) {
    await client.query('SELECT id FROM public.profiles WHERE id = ANY($1::uuid[]) FOR UPDATE', [ids]);
    if (fameByCountry) {
      await client.query(
        `SELECT user_id, reputation_score FROM public.user_activity_region_profile
         WHERE user_id = ANY($1::uuid[]) AND activity_region = $2 FOR UPDATE`,
        [ids, country]
      );
    } else {
      await client.query(
        'SELECT user_id, reputation_score FROM public.user_progression WHERE user_id = ANY($1::uuid[]) FOR UPDATE',
        [ids]
      );
    }
  }

  async function tableRows(table, sql, params) {
    const found = await client.query('SELECT to_regclass($1) AS name', ['public.' + table]);
    if (!found.rows[0] || !found.rows[0].name) return [];
    const result = await client.query(sql, params);
    return result.rows;
  }
  const eventColumns = await tableColumns(client, 'user_progression_events');
  const followColumns = await tableColumns(client, 'user_follows');
  const reactionTable = await client.query(`SELECT to_regclass('public.board_reactions') AS name`);
  const reactionColumns = reactionTable.rows[0] && reactionTable.rows[0].name
    ? await tableColumns(client, 'board_reactions')
    : null;
  const events = { rows: await tableRows(
    'user_progression_events',
    `SELECT ${selectList(
      ['user_id::text AS user_id', 'amount', 'dedupe_key', 'occurred_at'],
      eventColumns,
      ['source_id', 'activity_region', 'territory_at_event']
    )}
     FROM public.user_progression_events
     WHERE event_type = 'EMPATHY_RECEIVED' AND user_id = ANY($1::uuid[])`,
    [ids]
  ) };
  const followParams = [ids];
  let followWhere = 'following_user_id = ANY($1::uuid[])';
  if (followColumns.activity_region) {
    followParams.push(country);
    followWhere += ' AND activity_region = $' + followParams.length;
  }
  if (followColumns.cancelled_at) followWhere += ' AND cancelled_at IS NULL';
  const follows = { rows: await tableRows(
    'user_follows',
    `SELECT ${selectList(
      ['follower_user_id::text AS follower_id', 'following_user_id::text AS target_id', 'created_at'],
      followColumns,
      ['activity_region', 'territory_at_follow', 'cancelled_at']
    )}
     FROM public.user_follows
     WHERE ${followWhere}`,
    followParams
  ) };
  const posts = { rows: await tableRows(
    'board_posts',
    `SELECT author_user_id::text AS author_id, territory, activity_region, created_at
     FROM public.board_posts
     WHERE author_user_id = ANY($1::uuid[]) AND status = 'ACTIVE'`,
    [ids]
  ) };
  const comments = { rows: await tableRows(
    'board_comments',
    `SELECT author_user_id::text AS author_id, territory, activity_region, created_at
     FROM public.board_comments
     WHERE author_user_id = ANY($1::uuid[]) AND status = 'ACTIVE'`,
    [ids]
  ) };
  let reactions = [];
  if (reactionColumns) {
    const reactionRows = await client.query(
      `SELECT ${selectList(
        [
          'actor_user_id::text AS actor_id',
          'target_author_user_id::text AS target_id',
          'reaction_group',
          'created_at',
          'cancelled_at',
          'target_author_territory_at_reaction',
          'post_id::text AS post_id',
          'comment_id::text AS comment_id',
        ],
        reactionColumns,
        ['activity_region']
      )}
       FROM public.board_reactions
       WHERE target_author_user_id = ANY($1::uuid[])`,
      [ids]
    );
    reactions = reactionRows.rows;
  }
  const stored = await client.query(
    `SELECT person_id, rank, comparison_score, elected_leader, first_qualification_used
     FROM public.leader_rank_members
     WHERE country = $1 AND territory = $2 AND person_id = ANY($3::text[])`,
    [country, territory, ids]
  );
  return {
    ok: true,
    country: country,
    members: members.rows,
    events: events.rows,
    follows: follows.rows,
    reactions: reactions,
    reactionLogPresent: !!reactionColumns,
    eventColumns: eventColumns,
    followColumns: followColumns,
    posts: posts.rows,
    comments: comments.rows,
    stored: stored.rows,
  };
}

function explicitRegion(value) {
  const region = value == null ? '' : String(value).trim();
  if (region === 'KR' || region === 'US') return region;
  return 'UNKNOWN';
}

function inConfirmedCountry(row, country) {
  return explicitRegion(row.activity_region) === country;
}

function eventContext(row, columns) {
  if (!columns.activity_region || !columns.territory_at_event) return 'UNKNOWN';
  const country = explicitRegion(row.activity_region);
  const place = row.territory_at_event == null ? '' : String(row.territory_at_event).trim();
  if (country === 'UNKNOWN' || !place) return 'UNKNOWN';
  return country + ':' + place;
}

function project(snapshot, territory, asOfMs) {
  const country = snapshot.country;
  const profileTerritory = TERRITORY_TO_PROFILE[territory];
  const windowStart = asOfMs - formula.WINDOW_MS;
  const byId = Object.create(null);
  snapshot.stored.forEach(function (row) { byId[row.person_id] = row; });
  const blockedMember = Object.create(null);
  function block(id, reason) {
    if (!blockedMember[id]) blockedMember[id] = reason;
  }
  const reactions = [];
  const cumulative = Object.create(null);
  const linked = Object.create(null);
  snapshot.events.forEach(function (row) {
    const at = new Date(row.occurred_at).getTime();
    if (!isFinite(at) || at > asOfMs) return;
    const actor = reactorFromDedupe(row.dedupe_key);
    const context = eventContext(row, snapshot.eventColumns);
    const wanted = country + ':' + profileTerritory;
    const confirmed = actor && row.amount != null && row.amount !== '' && context === wanted;
    const otherCountry = (country === 'KR' && context.indexOf('US:') === 0) || (country === 'US' && context.indexOf('KR:') === 0);
    if (at < windowStart) {
      if (!confirmed) return;
      if (!cumulative[row.user_id]) cumulative[row.user_id] = Object.create(null);
      cumulative[row.user_id][actor] = true;
      return;
    }
    if (!confirmed) {
      if (otherCountry) block(row.user_id, 'COUNTRY_MIXED_EVENT');
      else if (context.indexOf(country + ':') === 0) return;
      else block(row.user_id, row.amount == null || row.amount === '' ? 'FAME_OVERLAP_UNCONFIRMED' : 'CONTEXT_UNKNOWN');
      return;
    }
    if (!cumulative[row.user_id]) cumulative[row.user_id] = Object.create(null);
    cumulative[row.user_id][actor] = true;
    if (row.source_id) linked[row.user_id + '\n' + actor + '\n' + String(row.source_id)] = Number(row.amount);
    reactions.push({
      country: country,
      territory: territory,
      actor_id: actor,
      target_id: row.user_id,
      polarity: 1,
      at_ms: at,
      fame_delta: Number(row.amount),
    });
  });
  if (snapshot.reactionLogPresent) {
    snapshot.reactions.forEach(function (row) {
      const at = new Date(row.created_at).getTime();
      if (!isFinite(at) || at > asOfMs) return;
      const cancelled = row.cancelled_at ? new Date(row.cancelled_at).getTime() : null;
      if (cancelled != null && cancelled <= asOfMs) return;
      if (at < windowStart) return;
      const eventCountry = explicitRegion(row.activity_region);
      const place = row.target_author_territory_at_reaction == null ? '' : String(row.target_author_territory_at_reaction).trim();
      if (eventCountry !== country || place !== profileTerritory) {
        if (eventCountry !== country && (eventCountry === 'KR' || eventCountry === 'US')) block(row.target_id, 'COUNTRY_MIXED_EVENT');
        else if (eventCountry === 'UNKNOWN' || !place) block(row.target_id, 'CONTEXT_UNKNOWN');
        return;
      }
      const sourceId = row.post_id || row.comment_id;
      const delta = sourceId ? linked[row.target_id + '\n' + row.actor_id + '\n' + sourceId] : null;
      if (delta == null) block(row.target_id, 'FAME_OVERLAP_UNCONFIRMED');
    });
  }
  const follows = [];
  snapshot.follows.forEach(function (row) {
    const at = new Date(row.created_at).getTime();
    if (!isFinite(at) || at > asOfMs) return;
    const cancelled = row.cancelled_at ? new Date(row.cancelled_at).getTime() : null;
    if (cancelled != null && cancelled <= asOfMs) return;
    const followCountry = snapshot.followColumns.activity_region ? explicitRegion(row.activity_region) : 'UNKNOWN';
    const place = snapshot.followColumns.territory_at_follow && row.territory_at_follow != null
      ? String(row.territory_at_follow).trim()
      : '';
    if (followCountry !== country || place !== profileTerritory) {
      block(row.target_id, followCountry !== country && (followCountry === 'KR' || followCountry === 'US') ? 'COUNTRY_MIXED_EVENT' : 'FOLLOW_SCOPE_UNKNOWN');
      return;
    }
    follows.push({
      country: country,
      territory: territory,
      follower_id: row.follower_id,
      target_id: row.target_id,
      at_ms: at,
    });
  });

  const lastPost = Object.create(null);
  const lastComment = Object.create(null);
  function stamp(map, author, at) {
    if (map[author] == null || at > map[author]) map[author] = at;
  }
  snapshot.posts.forEach(function (row) {
    if (!inConfirmedCountry(row, country) || row.territory !== profileTerritory) return;
    const at = new Date(row.created_at).getTime();
    if (isFinite(at) && at <= asOfMs) stamp(lastPost, row.author_id, at);
  });
  snapshot.comments.forEach(function (row) {
    if (!inConfirmedCountry(row, country) || row.territory !== profileTerritory) return;
    const at = new Date(row.created_at).getTime();
    if (isFinite(at) && at <= asOfMs) stamp(lastComment, row.author_id, at);
  });

  const unverified = [];
  const members = [];
  let population = 0;
  snapshot.members.forEach(function (row) {
    const previous = byId[row.id];
    const currentRank = previous && previous.rank ? previous.rank : 'citizen';
    if (row.reputation_score == null) {
      unverified.push({ id: row.id, reason: 'FAME_SOURCE_MISSING', rank: currentRank, changed: false });
      return;
    }
    if (blockedMember[row.id]) {
      unverified.push({ id: row.id, reason: blockedMember[row.id], rank: currentRank, changed: false });
      return;
    }
    const postAt = lastPost[row.id] != null ? lastPost[row.id] : null;
    const commentAt = lastComment[row.id] != null ? lastComment[row.id] : null;
    const recent = (postAt != null && asOfMs - postAt <= 30 * formula.DAY_MS) ||
      (commentAt != null && asOfMs - commentAt <= 30 * formula.DAY_MS);
    if (recent) population += 1;
    members.push({
      id: row.id,
      country: country,
      territory: territory,
      fame: Number(row.reputation_score),
      homeCountryIgnored: row.home_country,
      currentRank: currentRank,
      electedLeader: previous ? previous.elected_leader === true : false,
      firstQualificationUsed: previous && previous.first_qualification_used ? previous.first_qualification_used : {},
      uniquePositiveEvaluators: cumulative[row.id] ? Object.keys(cumulative[row.id]).length : 0,
      lastPostAtMs: postAt,
      lastCommentAtMs: commentAt,
    });
  });
  return {
    ok: true,
    members: members,
    reactions: reactions.filter(function (row) { return !blockedMember[row.target_id]; }),
    follows: follows.filter(function (row) { return !blockedMember[row.target_id]; }),
    territoryPopulation: population,
    unverified: unverified,
    reactionLogPresent: snapshot.reactionLogPresent === true,
  };
}

function censusOf(projected) {
  const unverified = projected.unverified || [];
  const members = projected.members || [];
  const reasons = Object.create(null);
  unverified.forEach(function (row) {
    const key = row.reason || 'UNKNOWN';
    reasons[key] = (reasons[key] || 0) + 1;
  });
  function sitting(rankName) {
    const unevaluable = unverified.filter(function (row) { return row.rank === rankName; }).length;
    const evaluable = members.filter(function (row) { return row.currentRank === rankName; }).length;
    if (!unevaluable && !evaluable) return null;
    return unevaluable === 0;
  }
  const complete = unverified.length === 0 && members.length > 0;
  return {
    totalMembers: members.length + unverified.length,
    evaluableCount: members.length,
    unevaluableCount: unverified.length,
    unevaluableReasons: reasons,
    sittingRepresentativeEvaluable: sitting('representative'),
    sittingElderEvaluable: sitting('elder'),
    officialCapsApplied: complete,
    resumeCondition: 'CUTOFF_UNCONFIRMED',
  };
}

function scoreSnapshot(projected, asOfMs) {
  const unverified = projected.unverified || [];
  const census = censusOf(projected);
  if (!projected.members.length) {
    return {
      ok: true,
      applied: false,
      dryRun: true,
      productionApply: false,
      liveSupabase: false,
      scores: [],
      planned: [],
      unverified: unverified,
      reason: unverified.length ? unverified[0].reason : 'NO_VERIFIED_MEMBER',
      officialApply: false,
      scoreKind: 'REFERENCE',
      census: census,
      referenceAssignments: [],
      reactionLogPresent: projected.reactionLogPresent === true,
      usedCitizenRank: false,
      usedHomeCountry: false,
    };
  }
  const country = projected.members[0].country;
  const zone = formula.zoneFor(country);
  const scored = formula.scoreCohort({
    country: country,
    territory: projected.members[0].territory,
    asOfMs: asOfMs,
    members: projected.members,
    reactions: projected.reactions,
    follows: projected.follows,
  });
  if (!scored.ok) return Object.assign({ dryRun: true, productionApply: false, liveSupabase: false }, scored);
  const byScore = Object.create(null);
  scored.members.forEach(function (row) { byScore[row.id] = row; });
  const populationComplete = unverified.length === 0;
  const evaluated = rank.applyWeeklyRanks({
    country: country,
    territory: projected.members[0].territory,
    territoryPopulation: projected.territoryPopulation,
    refreshComplete: true,
    clock: { weekday: formula.weekdayName(asOfMs, zone), hour: 0, minute: 0 },
    members: projected.members.map(function (row) {
      const score = byScore[row.id];
      return {
        id: row.id,
        currentRank: row.currentRank,
        electedLeader: row.electedLeader,
        comparisonScore: score ? score.combined : null,
        uniquePositiveEvaluators: row.uniquePositiveEvaluators,
        firstQualificationUsed: row.firstQualificationUsed,
      };
    }),
  });
  return {
    ok: evaluated.ok === true,
    applied: false,
    dryRun: true,
    productionApply: false,
    liveSupabase: false,
    formulaStatus: scored.formulaStatus,
    territoryPopulation: projected.territoryPopulation,
    scores: scored.members,
    planned: populationComplete ? (evaluated.assignments || []) : [],
    referenceAssignments: populationComplete ? [] : (evaluated.assignments || []),
    counts: populationComplete ? (evaluated.counts || null) : null,
    referenceCounts: populationComplete ? null : (evaluated.counts || null),
    reason: populationComplete ? (evaluated.reason || null) : 'POPULATION_INCOMPLETE',
    officialApply: populationComplete,
    scoreKind: populationComplete ? 'COMPLETE_COHORT' : 'REFERENCE',
    census: census,
    unverified: unverified,
    reactionLogPresent: projected.reactionLogPresent === true,
    usedCitizenRank: false,
    usedHomeCountry: false,
    profileTerritory: PROFILE_TO_TERRITORY[TERRITORY_TO_PROFILE[projected.members[0].territory]],
  };
}

async function dryRun(client, input) {
  const src = input || {};
  const asOfMs = Number(src.asOfMs);
  const country = String(src.country || '');
  const territory = String(src.territory || '');
  if (src.homeCountry != null || src.clientRank != null || src.clientScore != null) {
    return blocked('CLIENT_MEMBER_DATA_IGNORED');
  }
  const snapshot = await readSnapshot(client, country, territory, asOfMs);
  if (!snapshot.ok) return snapshot;
  const projected = project(snapshot, territory, asOfMs);
  if (!projected.ok) return projected;
  return scoreSnapshot(projected, asOfMs);
}

async function applyIsolated(client, input) {
  const src = input || {};
  if (src.apply !== true) return blocked('DRY_RUN_REQUIRED');
  if (!localHost(client)) return blocked('REMOTE_DATABASE_BLOCKED');
  const preview = await dryRun(client, src);
  if (!preview.ok || !preview.planned) return Object.assign({}, preview, { applied: false, dryRun: true });
  if (preview.officialApply !== true) {
    return Object.assign({}, preview, { applied: false, officialApply: false });
  }
  if (!preview.reactionLogPresent) return blocked('REACTION_LOG_UNVERIFIED');
  if (!preview.planned.length) return Object.assign({}, preview, { applied: false });
  const country = String(src.country || '');
  const territory = String(src.territory || '');
  const asOfMs = Number(src.asOfMs);
  const roundKey = formula.localDateKey(asOfMs, formula.zoneFor(country));
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT 1 FROM public.leader_rank_rounds WHERE country = $1 AND territory = $2 AND round_key = $3',
      [country, territory, roundKey]
    );
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return blocked('ROUND_ALREADY_APPLIED');
    }
    const again = await readSnapshot(client, country, territory, asOfMs, true);
    if (!again.ok) {
      await client.query('ROLLBACK');
      return again;
    }
    if (typeof src.afterLock === 'function') await src.afterLock();
    const projected = project(again, territory, asOfMs);
    if (!projected.ok) {
      await client.query('ROLLBACK');
      return projected;
    }
    const scored = scoreSnapshot(projected, asOfMs);
    if (!scored.ok || scored.officialApply !== true || !scored.planned) {
      await client.query('ROLLBACK');
      return Object.assign({}, scored, { applied: false, officialApply: false });
    }
    for (let i = 0; i < projected.members.length; i += 1) {
      const member = projected.members[i];
      const next = scored.planned.filter(function (row) { return row.id === member.id; })[0];
      const score = scored.scores.filter(function (row) { return row.id === member.id; })[0];
      await client.query(
        `INSERT INTO public.leader_rank_members
          (country, territory, person_id, fame, rank, comparison_score, valid, last_post_at_ms, last_comment_at_ms,
           elected_leader, unique_positive_evaluators, first_qualification_used)
         VALUES ($12,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
         ON CONFLICT (country, territory, person_id) DO UPDATE
         SET rank = CASE WHEN leader_rank_members.elected_leader THEN leader_rank_members.rank ELSE EXCLUDED.rank END,
             comparison_score = EXCLUDED.comparison_score,
             valid = EXCLUDED.valid,
             last_post_at_ms = EXCLUDED.last_post_at_ms,
             last_comment_at_ms = EXCLUDED.last_comment_at_ms,
             unique_positive_evaluators = EXCLUDED.unique_positive_evaluators`,
        [
          territory,
          member.id,
          member.fame,
          next ? next.rank : member.currentRank,
          score ? score.storedScore : null,
          member.lastPostAtMs != null || member.lastCommentAtMs != null,
          member.lastPostAtMs,
          member.lastCommentAtMs,
          member.electedLeader,
          member.uniquePositiveEvaluators,
          JSON.stringify(member.firstQualificationUsed || {}),
          country,
        ]
      );
    }
    await client.query(
      `INSERT INTO public.leader_rank_scopes (country, territory, territory_population)
       VALUES ($1,$2,$3)
       ON CONFLICT (country, territory) DO UPDATE SET territory_population = EXCLUDED.territory_population`,
      [country, territory, projected.territoryPopulation]
    );
    await client.query(
      'INSERT INTO public.leader_rank_rounds (country, territory, round_key) VALUES ($1,$2,$3)',
      [country, territory, roundKey]
    );
    await client.query('COMMIT');
    return {
      ok: true,
      applied: true,
      dryRun: false,
      officialApply: true,
      productionApply: false,
      liveSupabase: false,
      planned: scored.planned,
      scores: scored.scores,
      usedCitizenRank: false,
      usedHomeCountry: false,
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_rollback) { /* 이미 닫힘 */ }
    return blocked('RANK_APPLY_FAILED', { detail: error && error.message ? error.message : '' });
  }
}

async function readCountryInputs(client, country, territory) {
  if (!localHost(client)) return blocked('REMOTE_DATABASE_BLOCKED');
  if (country !== 'KR' && country !== 'US') return blocked('COUNTRY_REQUIRED');
  const profileTerritory = TERRITORY_TO_PROFILE[territory];
  if (!profileTerritory) return blocked('TERRITORY_REQUIRED');
  const ready = await client.query(`SELECT to_regclass('public.user_activity_region_profile') AS name`);
  if (!ready.rows[0] || !ready.rows[0].name) return blocked('COUNTRY_PROFILE_UNAVAILABLE');
  const members = await client.query(
    `SELECT rp.user_id::text AS id, upper(btrim(rp.territory)) AS territory
     FROM public.user_activity_region_profile rp
     WHERE rp.activity_region = $2
       AND rp.territory IS NOT NULL
       AND btrim(rp.territory) <> ''
       AND upper(btrim(rp.territory)) = $1`,
    [profileTerritory, country]
  );
  const ids = members.rows.map(function (row) { return row.id; });
  const followColumns = await tableColumns(client, 'user_follows');
  let follows = [];
  if (ids.length && followColumns.follower_user_id) {
    const params = [ids];
    let where = 'following_user_id = ANY($1::uuid[])';
    if (followColumns.activity_region) {
      params.push(country);
      where += ' AND activity_region = $' + params.length;
    }
    if (followColumns.cancelled_at) where += ' AND cancelled_at IS NULL';
    const rows = await client.query(
      `SELECT follower_user_id::text AS follower_id, activity_region
       FROM public.user_follows WHERE ${where}`,
      params
    );
    follows = rows.rows;
  }
  return {
    ok: true,
    evaluated: false,
    weeklyRun: false,
    country: country,
    territory: territory,
    members: members.rows,
    follows: follows,
  };
}

async function readMemberProfile(client, country, userId) {
  if (!localHost(client)) return blocked('REMOTE_DATABASE_BLOCKED');
  if (country !== 'KR' && country !== 'US') return blocked('COUNTRY_REQUIRED');
  const id = String(userId || '').trim();
  if (!id) return blocked('PERSON_REQUIRED');
  const ready = await client.query(`SELECT to_regclass('public.user_activity_region_profile') AS name`);
  if (!ready.rows[0] || !ready.rows[0].name) return blocked('COUNTRY_PROFILE_UNAVAILABLE');
  const profile = await client.query(
    `SELECT user_id::text AS id, activity_region, level, xp, reputation_score, territory
     FROM public.user_activity_region_profile
     WHERE user_id = $1::uuid AND activity_region = $2`,
    [id, country]
  );
  if (!profile.rows[0]) return blocked('PROFILE_MISSING');
  const row = profile.rows[0];
  const territory = row.territory ? String(row.territory).toLowerCase() : '';
  const rankRow = territory
    ? await client.query(
      `SELECT rank, comparison_score, elected_leader
       FROM public.leader_rank_members
       WHERE country = $1 AND territory = $2 AND person_id = $3`,
      [country, territory, id]
    )
    : { rows: [] };
  const office = territory
    ? await client.query(
      'SELECT leader_id FROM public.leader_offices WHERE country = $1 AND territory = $2',
      [country, territory]
    )
    : { rows: [] };
  const leader = !!(office.rows[0] && office.rows[0].leader_id === id);
  let termStatus = leader ? 'IN_TERM' : 'NOT_LEADER';
  let threeMonthAtMs = null;
  if (leader) {
    const appointed = await client.query(
      'SELECT at_ms FROM public.leader_appointments WHERE person_id = $1 ORDER BY at_ms DESC LIMIT 1',
      [id]
    );
    if (appointed.rows[0]) {
      const plan = require('../shared/leader-term-core').planTerm({
        inauguratedAtMs: Number(appointed.rows[0].at_ms),
        seasonId: null,
      });
      threeMonthAtMs = plan.threeMonthAtMs;
      termStatus = 'IN_TERM';
    }
  }
  return {
    ok: true,
    id: row.id,
    country: row.activity_region,
    level: Number(row.level),
    xp: Number(row.xp),
    fame: Number(row.reputation_score),
    territory: territory,
    rank: rankRow.rows[0] ? rankRow.rows[0].rank : null,
    score: rankRow.rows[0] ? rankRow.rows[0].comparison_score : null,
    leader: leader,
    electedLeader: rankRow.rows[0] ? rankRow.rows[0].elected_leader === true : false,
    termStatus: termStatus,
    threeMonthAtMs: threeMonthAtMs,
    seasonLength: 'UNCONFIRMED',
    productionAuth: false,
  };
}

module.exports = {
  dryRun: dryRun,
  applyIsolated: applyIsolated,
  readCountryInputs: readCountryInputs,
  readMemberProfile: readMemberProfile,
  TERRITORY_TO_PROFILE: TERRITORY_TO_PROFILE,
};
