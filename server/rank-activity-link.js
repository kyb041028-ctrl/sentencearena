'use strict';

/**
 * 신규 공감·팔로우만 후보 함수로 한 번 기록한다.
 * 기존 명성 함수와 기존 팔로우 토글은 호출하지 않는다.
 * 가입 국가는 읽지 않는다.
 */

const EARTH = { PIONEER: true, CENTRAL: true, GUARDIAN: true };

function activityContext(input) {
  const src = input || {};
  if (src.activityRegion == null || src.territory == null) return { ok: false, code: 'CONTEXT_UNKNOWN' };
  const region = String(src.activityRegion).trim();
  const territory = String(src.territory).trim();
  if ((region !== 'KR' && region !== 'US') || !EARTH[territory]) return { ok: false, code: 'CONTEXT_UNKNOWN' };
  return { ok: true, region: region, territory: territory };
}

async function grantEmpathy(client, input) {
  const src = input || {};
  const ctx = activityContext(src);
  if (!ctx.ok) return { status: 'ERROR', code: ctx.code, fameDelta: 0 };
  if (ctx.region !== 'KR') return { status: 'ERROR', code: 'FAME_NOT_COUNTRY_SEPARATED', fameDelta: 0 };
  if (src.amount == null || !src.recipientId || !src.dedupeKey) {
    return { status: 'ERROR', code: 'CONTEXT_UNKNOWN', fameDelta: 0 };
  }
  const found = await client.query(
    `SELECT public.apply_empathy_fame_with_context($1,$2,$3,$4,$5,$6,$7) AS result`,
    [
      src.recipientId,
      src.amount,
      src.sourceId || null,
      src.dedupeKey,
      src.occurredAt || new Date().toISOString(),
      ctx.region,
      ctx.territory,
    ]
  );
  return found.rows[0].result;
}

async function cancelEmpathy(client, input) {
  const src = input || {};
  const ctx = activityContext(src);
  if (!ctx.ok) return { status: 'ERROR', code: ctx.code, fameDelta: 0 };
  const found = await client.query(
    `SELECT public.cancel_empathy_fame_with_context($1,$2,$3,$4) AS result`,
    [src.recipientId, src.dedupeKey, ctx.region, ctx.territory]
  );
  return found.rows[0].result;
}

async function follow(client, input) {
  const src = input || {};
  const ctx = activityContext(src);
  if (!ctx.ok) return { status: 'ERROR', code: 'FOLLOW_SCOPE_UNKNOWN' };
  const found = await client.query(
    `SELECT public.link_user_follow_activity($1,$2,$3,$4,$5) AS result`,
    [src.followerId, src.targetId, ctx.region, ctx.territory, src.cancel === true]
  );
  return found.rows[0].result;
}

module.exports = {
  grantEmpathy: grantEmpathy,
  cancelEmpathy: cancelEmpathy,
  follow: follow,
};
