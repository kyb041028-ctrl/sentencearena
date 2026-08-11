'use strict';

const { createServerClient } = require('@supabase/ssr');
const { parse, serialize } = require('cookie');

function isProductionSecure() {
  return String(process.env.NODE_ENV || '').trim() === 'production';
}

function parseCookieHeader(header) {
  const parsed = parse(header || '');
  return Object.keys(parsed).map((name) => ({
    name,
    value: parsed[name] ?? '',
  }));
}

function appendSetCookie(res, value) {
  const prev = res.getHeader('Set-Cookie');
  if (!prev) {
    res.setHeader('Set-Cookie', value);
    return;
  }
  const list = Array.isArray(prev) ? prev.slice() : [String(prev)];
  list.push(value);
  res.setHeader('Set-Cookie', list);
}

function normalizeCookieOptions(options) {
  const opts = { ...(options || {}) };
  if (!isProductionSecure()) {
    opts.secure = false;
  } else if (opts.secure == null) {
    opts.secure = true;
  }
  if (opts.sameSite == null) opts.sameSite = 'lax';
  if (opts.path == null) opts.path = '/';
  return opts;
}

function serializeSupabaseCookie(name, value, options) {
  return serialize(name, value, normalizeCookieOptions(options));
}

/**
 * Request-scoped Supabase SSR client (never store on module globals).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{ url: string, key: string }} config
 */
function createRequestSupabaseClient(req, res, config) {
  if (!config || !config.url || !config.key) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return parseCookieHeader(req.headers.cookie);
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          appendSetCookie(res, serializeSupabaseCookie(name, value, options));
        });
      },
    },
  });
}

module.exports = {
  createRequestSupabaseClient,
  parseCookieHeader,
  appendSetCookie,
  serializeSupabaseCookie,
};
