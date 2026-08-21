#!/usr/bin/env node
'use strict';
/**
 * Inspect / one-time backfill of profiles.signup_completed_at.
 * Does not print emails. Use Railway production env.
 *
 *   railway run node tools/inspect-signup-completed-candidates.js
 *   railway run node tools/inspect-signup-completed-candidates.js --confirm-backfill
 */

const {
  createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl,
  maskDatabaseUrl,
} = require('../server/daily-issue-pg-client');

const CLASSIFY_SQL = `
SELECT
  p.id::text AS id,
  CASE
    WHEN btrim(COALESCE(p.display_name, '')) <> '' THEN true
    ELSE false
  END AS has_activity_name,
  CASE
    WHEN l.age_requirement_confirmed_at IS NOT NULL
      OR l.sensitive_political_consented_at IS NOT NULL THEN true
    ELSE false
  END AS has_legal_record,
  COALESCE(prog.xp, 0)::bigint AS xp,
  COALESCE(posts.n, 0)::int AS posts,
  COALESCE(comments.n, 0)::int AS comments,
  0::int AS daily_issue_comments,
  (p.signup_completed_at IS NOT NULL) AS already_stamped,
  p.created_at
FROM public.profiles p
LEFT JOIN public.user_legal_consents l ON l.user_id = p.id
LEFT JOIN public.user_progression prog ON prog.user_id = p.id
LEFT JOIN (
  SELECT author_user_id AS uid, COUNT(*)::int AS n
  FROM public.board_posts
  WHERE author_user_id IS NOT NULL
  GROUP BY 1
) posts ON posts.uid = p.id
LEFT JOIN (
  SELECT author_user_id AS uid, COUNT(*)::int AS n
  FROM public.board_comments
  WHERE author_user_id IS NOT NULL
  GROUP BY 1
) comments ON comments.uid = p.id
ORDER BY p.created_at ASC NULLS LAST, p.id ASC
`;

function classify(row) {
  const hasName = !!row.has_activity_name;
  const hasLegal = !!row.has_legal_record;
  const hasContent =
    Number(row.posts) > 0 || Number(row.comments) > 0 || Number(row.daily_issue_comments) > 0;
  const hasXp = Number(row.xp) > 0;
  if (hasName || hasLegal || hasContent) {
    return 'confirmed_member';
  }
  if (!hasName && !hasLegal && !hasContent && !hasXp) {
    return 'incomplete_auth';
  }
  return 'ambiguous';
}

function parseArgs(argv) {
  return { confirm: argv.indexOf('--confirm-backfill') >= 0 };
}

function shortId(id) {
  return String(id || '').slice(0, 8);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = resolveDailyIssueDatabaseUrl({ databaseUrl: process.env.DAILY_ISSUE_DATABASE_URL });
  if (!url) {
    console.log(JSON.stringify({ ok: false, skipped: true, error: 'DATABASE_UNAVAILABLE' }));
    process.exit(2);
  }
  const exec = createDailyIssuePgExecutor({ databaseUrl: url });
  if (!exec.ok) {
    console.error(JSON.stringify({ ok: false, error: exec.error || 'DATABASE_UNAVAILABLE' }));
    process.exit(1);
  }

  const res = await exec.query(CLASSIFY_SQL);
  const rows = res.rows || [];
  const buckets = {
    confirmed_member: [],
    incomplete_auth: [],
    ambiguous: [],
    already_stamped: [],
  };
  rows.forEach(function (row) {
    if (row.already_stamped) {
      buckets.already_stamped.push(shortId(row.id));
      return;
    }
    const kind = classify(row);
    buckets[kind].push(shortId(row.id));
  });

  const confirmedDetails = rows.filter(function (row) {
    return classify(row) === 'confirmed_member';
  }).map(function (row) {
    return {
      idShort: shortId(row.id),
      hasActivityName: !!row.has_activity_name,
      hasLegalRecord: !!row.has_legal_record,
      posts: Number(row.posts) || 0,
      comments: Number(row.comments) || 0,
      xp: Number(row.xp) || 0,
    };
  });

  const report = {
    ok: true,
    maskedUrl: maskDatabaseUrl(url),
    profileCount: rows.length,
    confirmedMember: buckets.confirmed_member.length,
    incompleteAuth: buckets.incomplete_auth.length,
    ambiguous: buckets.ambiguous.length,
    alreadyStamped: buckets.already_stamped.length,
    grounds: {
      hasActivityName: confirmedDetails.filter(function (r) { return r.hasActivityName; }).length,
      hasLegalRecord: confirmedDetails.filter(function (r) { return r.hasLegalRecord; }).length,
      hasBoardContent: confirmedDetails.filter(function (r) { return r.posts > 0 || r.comments > 0; }).length,
      xpPositive: confirmedDetails.filter(function (r) { return r.xp > 0; }).length,
    },
    confirmedDetails: confirmedDetails,
    confirmedMemberIdsShort: buckets.confirmed_member,
    incompleteAuthIdsShort: buckets.incomplete_auth,
    ambiguousIdsShort: buckets.ambiguous,
    backfillApplied: false,
  };

  if (!args.confirm) {
    await exec.end();
    console.log(JSON.stringify(report));
    return;
  }

  const idsRes = await exec.query(CLASSIFY_SQL);
  const toStamp = (idsRes.rows || []).filter(function (row) {
    return !row.already_stamped && classify(row) === 'confirmed_member';
  }).map(function (row) {
    return row.id;
  });

  let updated = 0;
  if (toStamp.length) {
    const upd = await exec.query(
      `UPDATE public.profiles
       SET signup_completed_at = COALESCE(signup_completed_at, now())
       WHERE signup_completed_at IS NULL
         AND id = ANY($1::uuid[])
       RETURNING id`,
      [toStamp],
    );
    updated = (upd.rows || []).length;
  }
  try { await exec.query("NOTIFY pgrst, 'reload schema'"); } catch (_) {}
  await exec.end();
  report.backfillApplied = true;
  report.backfillUpdated = updated;
  console.log(JSON.stringify(report));
}

main().catch(function (e) {
  console.error(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  process.exit(1);
});
