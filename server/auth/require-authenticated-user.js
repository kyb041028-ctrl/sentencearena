'use strict';

const { createClient } = require('@supabase/supabase-js');

function extractBearerToken(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return '';
  return h.slice(7).trim();
}

/**
 * Resolve authenticated user from Authorization: Bearer (Supabase access token).
 * @returns {Promise<{ ok: true, user: object, supabase: object, accessToken: string } | { ok: false, status: number, error: string }>}
 */
async function requireAuthenticatedUser(req, _res, config) {
  const token = extractBearerToken(req);
  if (!token) {
    return { ok: false, status: 401, error: 'UNAUTHORIZED' };
  }
  if (!config || !config.url || !config.key) {
    return { ok: false, status: 503, error: 'SUPABASE_NOT_CONFIGURED' };
  }

  const supabase = createClient(config.url, config.key, {
    global: { headers: { Authorization: 'Bearer ' + token } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) {
    return { ok: false, status: 401, error: 'UNAUTHORIZED' };
  }

  return { ok: true, user: data.user, supabase, accessToken: token };
}

module.exports = { requireAuthenticatedUser, extractBearerToken };
