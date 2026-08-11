'use strict';

/**
 * handle_new_user — email-less OAuth (Kakao) display_name resolution
 */
const fs = require('fs');
const path = require('path');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function resolveDisplayName(user) {
  const meta = user.raw_user_meta_data || {};
  const email = user.email;
  return (
    [
      meta.display_name,
      meta.nickname,
      meta.full_name,
      meta.name,
      meta.preferred_username,
      email ? String(email).split('@')[0] : '',
    ]
      .map((v) => (v == null ? '' : String(v).trim()))
      .find((v) => v.length > 0) || ''
  );
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
assert(migration.includes("'nickname'"), 'migration uses kakao nickname fallback');
assert(migration.includes("COALESCE(NEW.email, '')"), 'migration null-safe email');
assert(!migration.includes('@kakao'), 'no fake kakao email');
assert(schema.includes("'nickname'"), 'schema synced with migration');

assert(
  resolveDisplayName({ email: 'user@gmail.com', raw_user_meta_data: {} }) === 'user',
  'google email fallback',
);
assert(
  resolveDisplayName({
    email: null,
    raw_user_meta_data: { nickname: '카카오유저' },
  }) === '카카오유저',
  'kakao nickname',
);
assert(
  resolveDisplayName({ email: null, raw_user_meta_data: {} }) === '',
  'email-less empty metadata -> empty string not null',
);
assert(
  resolveDisplayName({
    email: 'a@b.com',
    raw_user_meta_data: { display_name: 'Nick' },
  }) === 'Nick',
  'display_name priority',
);

const serverJs = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
assert(!serverJs.includes('migration_handle_new_user'), 'oauth server untouched');

console.log('PASS handle_new_user email-less oauth trigger logic');
