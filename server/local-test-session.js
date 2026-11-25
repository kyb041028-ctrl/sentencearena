'use strict';

/**
 * 로컬 시험 세션. 운영에서는 켜지지 않는다.
 * 클라이언트가 보낸 사용자 번호는 받지 않고, 서버가 저장한 토큰 해시만 확인한다.
 * Supabase Auth 세션이 아니다.
 */

const crypto = require('crypto');

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createLocalSessionVerifier(query) {
  if (typeof query !== 'function') return null;
  return async function verify(req) {
    if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') return null;
    if (String(process.env.SA_LOCAL_AUTH_VERIFY || '').trim() !== '1') return null;
    const header = req && req.headers ? req.headers.authorization || '' : '';
    const match = String(header).match(/^Bearer\s+(\S+)$/i);
    if (!match) return null;
    let found;
    try {
      found = await query(
        'SELECT user_id FROM auth.local_test_sessions WHERE token_hash = $1 AND expires_at > now()',
        [hashToken(match[1])]
      );
    } catch (_) {
      return null;
    }
    const id = found && found.rows && found.rows[0] && found.rows[0].user_id;
    if (!id) return null;
    return { userId: String(id) };
  };
}

function localAuthEnabled() {
  return String(process.env.NODE_ENV || '').toLowerCase() !== 'production'
    && String(process.env.SA_LOCAL_AUTH_VERIFY || '').trim() === '1';
}

async function loginWithPassword(query, body) {
  if (!localAuthEnabled() || typeof query !== 'function') return null;
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) return { ok: false, status: 400, error: 'LOCAL_LOGIN_REQUIRED' };
  let found;
  try {
    found = await query(
      'SELECT id::text AS id, local_password_hash FROM auth.users WHERE lower(email) = $1',
      [email]
    );
  } catch (_) {
    return { ok: false, status: 503, error: 'LOCAL_LOGIN_UNAVAILABLE' };
  }
  const row = found.rows[0];
  if (!row || !row.local_password_hash) return { ok: false, status: 401, error: 'LOCAL_LOGIN_FAILED' };
  const [salt, expected] = String(row.local_password_hash).split(':');
  const actual = crypto.scryptSync(password, salt, 32).toString('hex');
  const a = Buffer.from(actual);
  const b = Buffer.from(expected || '');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: 'LOCAL_LOGIN_FAILED' };
  }
  const token = crypto.randomBytes(32).toString('hex');
  await query(
    `INSERT INTO auth.local_test_sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + interval '12 hours')`,
    [hashToken(token), row.id]
  );
  return { ok: true, token: token, userId: row.id };
}

async function registerLocalMember(query, body) {
  if (!localAuthEnabled() || typeof query !== 'function') return null;
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const displayName = String(body.displayName || body.display_name || '').trim();
  const region = body.region === 'US' ? 'US' : body.region === 'KR' ? 'KR' : null;
  if (!email || email.indexOf('@') < 1 || password.length < 8) {
    return { ok: false, status: 400, error: 'LOCAL_SIGNUP_REQUIRED' };
  }
  if (!displayName || displayName.length > 24 || displayName.indexOf('@') >= 0) {
    return { ok: false, status: 400, error: 'DISPLAY_NAME_INVALID' };
  }
  if (!region) return { ok: false, status: 400, error: 'COUNTRY_REQUIRED' };
  if (region === 'KR' && body.confirmAge14 !== true) {
    return { ok: false, status: 403, error: 'AGE_UNDER_14' };
  }
  if (region === 'US' && body.confirmAge18 !== true) {
    return { ok: false, status: 403, error: 'AGE_UNDER_18' };
  }
  const existing = await query('SELECT id FROM auth.users WHERE lower(email) = $1', [email]);
  if (existing.rows.length) return { ok: false, status: 409, error: 'ALREADY_MEMBER' };
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = salt + ':' + crypto.scryptSync(password, salt, 32).toString('hex');
  const id = crypto.randomUUID();
  await query(
    'INSERT INTO auth.users (id, email, local_password_hash) VALUES ($1, $2, $3)',
    [id, email, hash]
  );
  await query(
    `INSERT INTO public.profiles (id, display_name, signup_completed_at)
     VALUES ($1, $2, now())
     ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, signup_completed_at = now()`,
    [id, displayName]
  );
  await query(
    `INSERT INTO public.user_activity_region_profile (user_id, activity_region, territory)
     VALUES ($1, $2, 'pioneer')
     ON CONFLICT (user_id, activity_region) DO UPDATE SET territory = COALESCE(public.user_activity_region_profile.territory, 'pioneer')`,
    [id, region]
  );
  if (region === 'KR') {
    await query(
      `INSERT INTO public.user_legal_consents (
         user_id, age_requirement_confirmed_at, age_policy_version, age_gate_method,
         sensitive_political_consented_at, sensitive_political_policy_version,
         territory_disclosure_consented_at, territory_disclosure_policy_version
       ) VALUES ($1, now(), 'age-policy-v1', 'dob-input', now(), 'sensitive-political-v1', now(), 'territory-disclosure-v1')
       ON CONFLICT (user_id) DO UPDATE SET
         age_requirement_confirmed_at = now(),
         age_policy_version = 'age-policy-v1',
         sensitive_political_consented_at = now(),
         sensitive_political_policy_version = 'sensitive-political-v1',
         territory_disclosure_consented_at = now(),
         territory_disclosure_policy_version = 'territory-disclosure-v1'`,
      [id]
    );
  } else {
    await query(
      `INSERT INTO public.user_activity_region_legal_consents (
         user_id, activity_region, age_requirement_confirmed_at, age_policy_version, age_policy_region,
         age_gate_method, terms_document_version, terms_consented_at, privacy_document_version,
         privacy_acknowledged_at, sensitive_political_consented_at, sensitive_political_policy_version,
         sensitive_applies_to, territory_disclosure_consented_at, territory_disclosure_policy_version,
         territory_disclosure_applies_to
       ) VALUES (
         $1, 'US', now(), 'age-policy-us-v1', 'US', 'dob-input', 'terms-draft-us-v1', now(),
         'privacy-draft-us-v1', now(), now(), 'sensitive-political-v1', 'US', now(),
         'territory-disclosure-v1', 'US'
       )`,
      [id]
    );
  }
  const token = crypto.randomBytes(32).toString('hex');
  await query(
    `INSERT INTO auth.local_test_sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + interval '12 hours')`,
    [hashToken(token), id]
  );
  return { ok: true, created: true, token: token, userId: id, region: region };
}

module.exports = {
  createLocalSessionVerifier: createLocalSessionVerifier,
  loginWithPassword: loginWithPassword,
  registerLocalMember: registerLocalMember,
  localAuthEnabled: localAuthEnabled,
  hashToken: hashToken,
};
