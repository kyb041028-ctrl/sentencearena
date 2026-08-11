'use strict';

const { createRequestSupabaseClient } = require('./supabase-server');

/**
 * Resolve authenticated user from request cookies (Supabase SSR session).
 * @returns {Promise<{ ok: true, user: object, supabase: object } | { ok: false, status: number, error: string }>}
 */
async function requireAuthenticatedUser(req, res, config) {
  let supabase;
  try {
    supabase = createRequestSupabaseClient(req, res, config);
  } catch (_) {
    return { ok: false, status: 503, error: 'SUPABASE_NOT_CONFIGURED' };
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) {
    return { ok: false, status: 401, error: 'UNAUTHORIZED' };
  }
  return { ok: true, user: data.user, supabase };
}

module.exports = { requireAuthenticatedUser };
