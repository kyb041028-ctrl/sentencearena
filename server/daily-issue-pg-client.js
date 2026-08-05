'use strict';

/**
 * 데일리 이슈 전용 PostgreSQL client
 *
 * - DAILY_ISSUE_DATABASE_URL 만 사용 (운영 DATABASE_URL / SUPABASE 자동 사용 금지)
 * - 비밀번호·URL 원문을 로그에 남기지 않음
 */

const contract = require('../shared/daily-issue-review-repository-contract');

const ALLOWED_TEST_SCHEMA = /^daily_issue_(test|dev)(_[a-z0-9]+)?$/i;

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
    connectionString: url,
    max: Number(opt.max || 5),
    connectionTimeoutMillis: Number(opt.connectionTimeoutMillis || 20000),
  };
  // Supabase / managed Postgres often require TLS; local trust certs vary.
  if (/supabase\.(co|com)/i.test(String(url)) || opt.ssl === true) {
    poolConfig.ssl = opt.ssl === false ? false : { rejectUnauthorized: false };
  } else if (opt.ssl && typeof opt.ssl === 'object') {
    poolConfig.ssl = opt.ssl;
  }
  const pool = opt.pool || new Pool(poolConfig);
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
  ALLOWED_TEST_SCHEMA: ALLOWED_TEST_SCHEMA,
};
