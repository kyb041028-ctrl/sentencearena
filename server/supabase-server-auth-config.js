'use strict';

/**
 * 서버 사이드 Supabase Auth(로그인·세션 검증)용 URL/키 해석.
 * 브라우저에 키를 노출하지 않는다.
 *
 * Auth 전용 키만 허용:
 * 1) SUPABASE_ANON_KEY
 * 2) SUPABASE_PUBLISHABLE_KEY (신규 대시보드 publishable)
 *
 * SUPABASE_SERVICE_ROLE_KEY 는 여기로 쓰지 않는다.
 * (Admin API / alignment 등 서버 전용 모듈에서만 사용)
 */

function readEnv(name) {
  return String(process.env[name] || '').trim();
}

function resolveSupabaseServerAuthConfig() {
  const url = readEnv('SUPABASE_URL');
  const anon = readEnv('SUPABASE_ANON_KEY');
  const publishable = readEnv('SUPABASE_PUBLISHABLE_KEY');

  let key = '';
  let keySource = 'missing';
  if (anon) {
    key = anon;
    keySource = 'anon';
  } else if (publishable) {
    key = publishable;
    keySource = 'publishable';
  }

  return {
    url: url,
    key: key,
    keySource: keySource,
    configured: !!(url && key),
  };
}

module.exports = {
  resolveSupabaseServerAuthConfig: resolveSupabaseServerAuthConfig,
};
