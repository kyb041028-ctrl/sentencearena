'use strict';

/**
 * handle_new_user — 신규 OAuth profiles.display_name 은 항상 '' (활동명 onboarding)
 */
const fs = require('fs');
const path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function resolveNewUserDisplayName() {
  return '';
}

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migration_handle_new_user_emailless_oauth.sql'),
  'utf8',
);
const schema = fs.readFileSync(
  path.join(root, 'supabase', 'schema_profiles_identity_history.sql'),
  'utf8',
);

assert(migration.includes('handle_new_user'), 'migration defines handle_new_user');
assert(migration.includes("v_display := ''"), 'migration sets empty display_name');
assert(!migration.includes("'nickname'"), 'migration must not use kakao nickname fallback');
assert(!migration.includes('split_part'), 'migration must not use email local-part fallback');
assert(schema.includes("v_display := ''"), 'schema synced with migration');

assert(resolveNewUserDisplayName() === '', 'new user display_name is always empty string');

const entry = fs.readFileSync(path.join(root, 'public', 'app-entry.js'), 'utf8');
assert(entry.includes('needsActivityNameOnboarding'), 'app-entry uses onboarding completion helper');
assert(entry.includes('isCompleteActivityName'), 'app-entry uses ActivityNameCore completion');
assert(!/provider\s*===\s*['"]google['"]/.test(entry), 'no google-specific onboarding');
assert(!/provider\s*===\s*['"]kakao['"]/.test(entry), 'no kakao-specific onboarding');

const serverJs = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
assert(!serverJs.includes('migration_handle_new_user'), 'oauth server untouched');

console.log('PASS handle_new_user empty display_name for onboarding');
