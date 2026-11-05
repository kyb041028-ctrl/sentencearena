'use strict';

/**
 * 데일리 이슈 전용 PostgreSQL client
 *
 * - DAILY_ISSUE_DATABASE_URL 만 사용 (운영 DATABASE_URL / SUPABASE 자동 사용 금지)
 * - 비밀번호·URL 원문을 로그에 남기지 않음
 */

const contract = require('../shared/daily-issue-review-repository-contract');
const migrationCore = require('../shared/daily-issue-production-migration-core');

const ALLOWED_TEST_SCHEMA = /^daily_issue_(test|dev)(_[a-z0-9]+)?$/i;

/** @type {Set<{ end: Function }>} */
const activePools = new Set();

function registerPool(pool) {
  if (pool && typeof pool.end === 'function') activePools.add(pool);
}

function unregisterPool(pool) {
  if (pool) activePools.delete(pool);
}

async function closeAllDailyIssuePools() {
  const list = Array.from(activePools);
  activePools.clear();
  for (let i = 0; i < list.length; i++) {
    try {
      await list[i].end();
    } catch (_) {
      /* ignore */
    }
  }
  return { closed: list.length };
}

function readEnv(name) {
  return String(process.env[name] || '').trim();
}

function resolveDailyIssueDatabaseUrl(options) {
  const opt = options || {};
  if (opt.databaseUrl) return String(opt.databaseUrl).trim();
  // Explicit daily-issue URL only — never fall back to DATABASE_URL or SUPABASE
  return readEnv('DAILY_ISSUE_DATABASE_URL');
}

function resolveSchemaName(options) {
  const opt = options || {};
  const schema = String(opt.schemaName || opt.schema || readEnv('DAILY_ISSUE_DB_SCHEMA') || 'public').trim();
  return schema || 'public';
}

function isAllowedTestSchema(schema) {
  return ALLOWED_TEST_SCHEMA.test(String(schema || ''));
}

function maskDatabaseUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol + '//' + (u.hostname || 'host') + ':' + (u.port || '') + '/[db]';
  } catch (_) {
    return '[invalid-url]';
  }
}

function readDatabaseHostname(url) {
  try {
    return String(new URL(String(url || '')).hostname || '').toLowerCase();
  } catch (_) {
    return '';
  }
}

function isSupabaseDatabaseHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'supabase.com' ||
    host.endsWith('.supabase.com') ||
    host === 'supabase.co' ||
    host.endsWith('.supabase.co');
}

/**
 * supabase.com / supabase.co 는 신뢰할 수 있는 인증서 검증을 강제한다.
 * 인증서 검증을 끄는 값을 기본값으로 두지 않는다. 로컬 Postgres 는 SSL 을 강제하지 않는다.
 * @returns {object|undefined}
 */
function buildDailyIssuePgSsl(url, options) {
  const opt = options || {};
  const host = readDatabaseHostname(url);
  if (!isSupabaseDatabaseHost(host)) {
    if (opt.ssl && typeof opt.ssl === 'object') return opt.ssl;
    if (opt.ssl === true) return { rejectUnauthorized: true };
    return undefined;
  }

  const ca = migrationCore.validateDailyIssueSslCa(process.env);
  if (!ca.ok) {
    const err = new Error(ca.code);
    err.code = ca.code;
    throw err;
  }
  const ssl = { rejectUnauthorized: true, ca: ca.pem };
  if (opt.ssl && typeof opt.ssl === 'object') {
    if (opt.ssl.cert != null) ssl.cert = opt.ssl.cert;
    if (opt.ssl.key != null) ssl.key = opt.ssl.key;
    if (opt.ssl.servername) ssl.servername = String(opt.ssl.servername);
  }
  ssl.rejectUnauthorized = true;
  return ssl;
}

function applyDailyIssuePoolConnection(poolConfig, url) {
  const parsed = new URL(String(url));
  poolConfig.user = decodeURIComponent(parsed.username || '');
  poolConfig.password = decodeURIComponent(parsed.password || '');
  poolConfig.host = parsed.hostname;
  poolConfig.port = parsed.port ? Number(parsed.port) : 5432;
  poolConfig.database = decodeURIComponent(String(parsed.pathname || '').replace(/^\/+/, ''));
  delete poolConfig.connectionString;
}

function validatePgClientConfig(options) {
  const url = resolveDailyIssueDatabaseUrl(options);
  const schema = resolveSchemaName(options);
  const errors = [];
  if (!url) errors.push('DAILY_ISSUE_DATABASE_URL missing');
  if (!schema) errors.push('schema missing');
  if (errors.length) {
    return {
      valid: false,
      code: contract.ERROR_CODES.DATABASE_UNAVAILABLE,
      errors: errors,
      schema: schema,
    };
  }
  return {
    valid: true,
    schema: schema,
    maskedUrl: maskDatabaseUrl(url),
    hasUrl: true,
  };
}

/**
 * @param {object} [options]
 * @param {string} [options.databaseUrl]
 * @param {string} [options.schemaName]
 * @param {object} [options.Pool] inject pg.Pool for tests
 * @param {object} [options.pool] existing pool
 */
function createDailyIssuePgExecutor(options) {
  const opt = options || {};
  const validation = validatePgClientConfig(opt);
  if (!validation.valid && !opt.pool && !opt.query) {
    return {
      ok: false,
      error: contract.ERROR_CODES.DATABASE_UNAVAILABLE,
      message: (validation.errors || []).join('; '),
      initialize: function () {
        return contract.repoError(contract.ERROR_CODES.DATABASE_UNAVAILABLE, (validation.errors || []).join('; '));
      },
      healthCheck: function () {
        return contract.repoError(contract.ERROR_CODES.DATABASE_UNAVAILABLE);
      },
      query: function () {
        return Promise.resolve(contract.repoError(contract.ERROR_CODES.DATABASE_UNAVAILABLE));
      },
      withTransaction: function () {
        return Promise.resolve(contract.repoError(contract.ERROR_CODES.DATABASE_UNAVAILABLE));
      },
      end: function () {
        return Promise.resolve();
      },
      schemaName: resolveSchemaName(opt),
    };
  }

  // Injected query/transaction (unit tests / custom)
  if (typeof opt.query === 'function' && typeof opt.withTransaction === 'function') {
    return {
      ok: true,
      kind: 'injected',
      schemaName: resolveSchemaName(opt),
      query: opt.query,
      withTransaction: opt.withTransaction,
      healthCheck: opt.healthCheck || function () {
        return Promise.resolve({ ok: true, kind: 'injected' });
      },
      end: opt.end || function () {
        return Promise.resolve();
      },
    };
  }

  let Pool;
  try {
    Pool = opt.Pool || require('pg').Pool;
  } catch (e) {
    return {
      ok: false,
      error: contract.ERROR_CODES.DATABASE_UNAVAILABLE,
      message: 'pg package unavailable',
      query: function () {
        return Promise.resolve(contract.repoError(contract.ERROR_CODES.DATABASE_UNAVAILABLE, 'pg unavailable'));
      },
      withTransaction: function () {
        return Promise.resolve(contract.repoError(contract.ERROR_CODES.DATABASE_UNAVAILABLE, 'pg unavailable'));
      },
      end: function () {
        return Promise.resolve();
      },
      schemaName: resolveSchemaName(opt),
    };
  }

  const url = resolveDailyIssueDatabaseUrl(opt);
  const schemaName = resolveSchemaName(opt);
  const poolConfig = {
    max: Number(opt.max || 5),
    connectionTimeoutMillis: Number(opt.connectionTimeoutMillis || 20000),
  };
  let ssl;
  try {
    ssl = buildDailyIssuePgSsl(url, opt);
  } catch (e) {
    return {
      ok: false,
      error: contract.ERROR_CODES.DATABASE_UNAVAILABLE,
      message: (e && e.code) || 'SSL_CONFIG_FAILED',
      query: function () {
        return Promise.resolve(contract.repoError(contract.ERROR_CODES.DATABASE_UNAVAILABLE, 'ssl config failed'));
      },
      withTransaction: function () {
        return Promise.resolve(contract.repoError(contract.ERROR_CODES.DATABASE_UNAVAILABLE, 'ssl config failed'));
      },
      end: function () {
        return Promise.resolve();
      },
      schemaName: schemaName,
    };
  }
  if (isSupabaseDatabaseHost(readDatabaseHostname(url))) {
    applyDailyIssuePoolConnection(poolConfig, url);
    poolConfig.ssl = ssl;
  } else {
    poolConfig.connectionString = url;
    if (ssl) poolConfig.ssl = ssl;
  }
  const pool = opt.pool || new Pool(poolConfig);
  if (!opt.pool) registerPool(pool);
  let ended = false;

  async function query(sql, params) {
    if (ended) {
      return Promise.reject(
        Object.assign(new Error(contract.ERROR_CODES.DATABASE_UNAVAILABLE), {
          code: contract.ERROR_CODES.DATABASE_UNAVAILABLE,
        }),
      );
    }
    const result = await pool.query(sql, params || []);
    return result;
  }

  async function withTransaction(callback) {
    if (ended) {
      return contract.repoError(contract.ERROR_CODES.DATABASE_UNAVAILABLE);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Restrict search_path to target schema first
      await client.query('SELECT set_config($1, $2, true)', ['search_path', schemaName + ', public']);
      const tx = {
        query: function (sql, params) {
          return client.query(sql, params || []);
        },
        schemaName: schemaName,
      };
      const result = await callback(tx);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {
        /* ignore */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  return {
    ok: true,
    kind: 'pg',
    schemaName: schemaName,
    maskedUrl: maskDatabaseUrl(url),
    query: query,
    withTransaction: withTransaction,
    healthCheck: async function () {
      try {
        await query('SELECT 1 AS ok');
        return { ok: true, kind: 'pg', schema: schemaName, maskedUrl: maskDatabaseUrl(url) };
      } catch (e) {
        return contract.repoError(contract.ERROR_CODES.DATABASE_UNAVAILABLE, String(e.message || e));
      }
    },
    end: async function () {
      ended = true;
      unregisterPool(pool);
      await pool.end();
    },
  };
}

module.exports = {
  createDailyIssuePgExecutor: createDailyIssuePgExecutor,
  resolveDailyIssueDatabaseUrl: resolveDailyIssueDatabaseUrl,
  resolveSchemaName: resolveSchemaName,
  validatePgClientConfig: validatePgClientConfig,
  isAllowedTestSchema: isAllowedTestSchema,
  maskDatabaseUrl: maskDatabaseUrl,
  readDatabaseHostname: readDatabaseHostname,
  isSupabaseDatabaseHost: isSupabaseDatabaseHost,
  buildDailyIssuePgSsl: buildDailyIssuePgSsl,
  ALLOWED_TEST_SCHEMA: ALLOWED_TEST_SCHEMA,
  registerPool: registerPool,
  unregisterPool: unregisterPool,
  closeAllDailyIssuePools: closeAllDailyIssuePools,
};
