'use strict';

/**
 * 미국 HTTP 저장을 붙일 로컬 Postgres 주소만 받는다.
 * Supabase 주소는 여기서 풀을 만들지 않는다. 서비스 롤 키는 다루지 않는다.
 */

function isRemoteSupabaseUrl(value) {
  const raw = String(value || '').toLowerCase();
  return raw.indexOf('supabase.co') !== -1
    || raw.indexOf('supabase.in') !== -1
    || raw.indexOf('pooler.supabase') !== -1;
}

function createPgQuery(connectionString) {
  const raw = String(connectionString || '').trim();
  if (!raw || isRemoteSupabaseUrl(raw)) return null;
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: raw, max: 4 });
  return function query(sql, params) {
    return pool.query(sql, params);
  };
}

function regionQueryFromEnv() {
  return createPgQuery(process.env.ACTIVITY_REGION_PG_URL);
}

module.exports = {
  isRemoteSupabaseUrl: isRemoteSupabaseUrl,
  createPgQuery: createPgQuery,
  regionQueryFromEnv: regionQueryFromEnv,
};
