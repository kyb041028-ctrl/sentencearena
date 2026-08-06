'use strict';

/**
 * supabase-server-auth-config — Auth는 anon/publishable만, service-role 폴백 금지
 */

const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const modPath = path.join(ROOT, 'server', 'supabase-server-auth-config.js');

function withEnv(patch, fn) {
  const prev = {};
  const keys = Object.keys(patch);
  keys.forEach(function (k) {
    prev[k] = process.env[k];
    if (patch[k] == null) delete process.env[k];
    else process.env[k] = patch[k];
  });
  try {
    delete require.cache[require.resolve(modPath)];
    return fn(require(modPath));
  } finally {
    keys.forEach(function (k) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    });
    delete require.cache[require.resolve(modPath)];
  }
}

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log('PASS', name);
}

withEnv(
  {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: '',
    SUPABASE_PUBLISHABLE_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_should_not_be_used',
  },
  function (mod) {
    const c = mod.resolveSupabaseServerAuthConfig();
    ok('1. service-role alone → Auth not configured', c.configured === false && c.keySource === 'missing' && !c.key);
  },
);

withEnv(
  {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon_test_key',
    SUPABASE_PUBLISHABLE_KEY: 'pub_test_key',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_ignored',
  },
  function (mod) {
    const c = mod.resolveSupabaseServerAuthConfig();
    ok('2. anon preferred over publishable/service', c.configured && c.keySource === 'anon' && c.key === 'anon_test_key');
  },
);

withEnv(
  {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: '',
    SUPABASE_PUBLISHABLE_KEY: 'pub_only',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_ignored',
  },
  function (mod) {
    const c = mod.resolveSupabaseServerAuthConfig();
    ok('3. publishable when anon missing', c.configured && c.keySource === 'publishable' && c.key === 'pub_only');
  },
);

withEnv(
  {
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: 'anon_test_key',
    SUPABASE_PUBLISHABLE_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
  },
  function (mod) {
    const c = mod.resolveSupabaseServerAuthConfig();
    ok('4. url missing → not configured', c.configured === false);
  },
);

const fs = require('fs');
const src = fs.readFileSync(modPath, 'utf8');
ok('5. module does not assign service-role as Auth key', !/keySource\s*=\s*['"]service_role/.test(src));
ok('6. usesServiceRoleFallback removed', !/usesServiceRoleFallback/.test(src));

console.log('OK', passed);
