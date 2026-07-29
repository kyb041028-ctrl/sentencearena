'use strict';

const { createClient } = require('@supabase/supabase-js');

let cachedClient = null;
let injectedClient = null;

function readEnv(name) {
  return String(process.env[name] || '').trim();
}

function validateAlignmentSupabaseAdminConfig() {
  const url = readEnv('SUPABASE_URL');
  const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
  const errors = [];

  if (!url) errors.push('ALIGNMENT_SUPABASE_CONFIG_MISSING:SUPABASE_URL');
  if (!serviceRoleKey) errors.push('ALIGNMENT_SUPABASE_CONFIG_MISSING:SUPABASE_SERVICE_ROLE_KEY');

  if (errors.length) {
    return { valid: false, code: 'ALIGNMENT_SUPABASE_CONFIG_MISSING', errors };
  }

  // Never return the service-role key value from validation results.
  return { valid: true, hasUrl: true, hasServiceRoleKey: true };
}

function createAlignmentSupabaseAdminClient(options) {
  const opts = options || {};
  if (opts.client) {
    if (!opts.client || typeof opts.client.rpc !== 'function') {
      const err = new Error('ALIGNMENT_SUPABASE_CLIENT_INVALID');
      err.code = 'ALIGNMENT_SUPABASE_CLIENT_INVALID';
      throw err;
    }
    return opts.client;
  }

  const config = validateAlignmentSupabaseAdminConfig();
  if (!config.valid) {
    const err = new Error(config.code);
    err.code = config.code;
    err.details = config.errors;
    throw err;
  }

  const url = readEnv('SUPABASE_URL');
  const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function getAlignmentSupabaseAdminClient() {
  if (injectedClient) return injectedClient;
  if (cachedClient) return cachedClient;
  cachedClient = createAlignmentSupabaseAdminClient();
  return cachedClient;
}

function setAlignmentSupabaseAdminClientForTests(client) {
  injectedClient = client || null;
  cachedClient = null;
}

function resetAlignmentSupabaseAdminClientForTests() {
  injectedClient = null;
  cachedClient = null;
}

module.exports = {
  validateAlignmentSupabaseAdminConfig,
  createAlignmentSupabaseAdminClient,
  getAlignmentSupabaseAdminClient,
  setAlignmentSupabaseAdminClientForTests,
  resetAlignmentSupabaseAdminClientForTests,
};
