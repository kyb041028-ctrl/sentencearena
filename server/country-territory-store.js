'use strict';

/**
 * 국가별 영토 소속. 정본은 user_activity_region_profile (user_id, activity_region).
 * profiles.territory 는 읽지도 쓰지도 않는다.
 * HTTP 이동 라우트가 아니다.
 */

const KEYS = Object.freeze({
  pioneer: 'pioneer',
  central: 'central',
  guardian: 'guardian',
  alien: 'alien',
});

function fail(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

function countryOf(value) {
  const text = String(value == null ? '' : value).trim().toUpperCase();
  if (text === 'KR' || text === 'US') return text;
  return null;
}

function canonicalTerritory(value) {
  if (value == null) return null;
  const text = String(value).trim().toLowerCase();
  if (!text) return null;
  return KEYS[text] || null;
}

function boardTerritory(value) {
  const key = canonicalTerritory(value);
  return key ? key.toUpperCase() : null;
}

async function countryTableReady(query) {
  if (typeof query !== 'function') return false;
  const table = await query(`SELECT to_regclass('public.user_activity_region_profile') AS name`);
  if (!table.rows[0] || !table.rows[0].name) return false;
  const column = await query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'user_activity_region_profile'
       AND column_name = 'territory'`
  );
  return column.rows.length > 0;
}

async function countCountryPopulation(query, region, territory) {
  const country = countryOf(region);
  const key = canonicalTerritory(territory);
  if (!country) throw fail('COUNTRY_REQUIRED');
  if (!key) throw fail('TERRITORY_INVALID');
  if (!(await countryTableReady(query))) {
    return {
      available: false,
      population: null,
      region: country,
      territory: key,
      source: 'user_activity_region_profile',
      reason: 'COUNTRY_PROFILE_UNAVAILABLE',
    };
  }
  const citizen = await query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'citizenship_status'`
  );
  const params = [country, key];
  const earthFilter = key !== 'alien' && citizen.rows.length
    ? ` AND (p.citizenship_status IS NULL OR p.citizenship_status <> 'KANTAPBIYA_RESIDENT')`
    : '';
  const join = earthFilter
    ? 'LEFT JOIN public.profiles p ON p.id = rp.user_id'
    : '';
  const res = await query(
    `SELECT count(*)::int AS n
     FROM public.user_activity_region_profile rp
     ${join}
     WHERE rp.activity_region = $1
       AND rp.territory IS NOT NULL
       AND btrim(rp.territory) <> ''
       AND lower(btrim(rp.territory)) = $2` + earthFilter,
    params
  );
  return {
    available: true,
    population: res.rows[0].n,
    region: country,
    territory: key,
    source: 'user_activity_region_profile',
    reason: null,
  };
}

async function readAffiliation(query, userId, region) {
  const country = countryOf(region);
  if (!country) throw fail('COUNTRY_REQUIRED');
  const id = String(userId || '').trim();
  if (!id) throw fail('USER_REQUIRED');
  if (typeof query !== 'function') throw fail('COUNTRY_TERRITORY_QUERY_REQUIRED');
  const res = await query(
    'SELECT territory FROM public.user_activity_region_profile ' +
      'WHERE user_id = $1 AND activity_region = $2',
    [id, country]
  );
  const row = res.rows[0] || null;
  return {
    userId: id,
    region: country,
    stored: !!row,
    territory: row ? canonicalTerritory(row.territory) : null,
    source: 'user_activity_region_profile',
  };
}

async function setCountryTerritory(query, input) {
  const src = input || {};
  const session = countryOf(src.sessionRegion);
  const target = countryOf(src.targetRegion);
  if (!session || !target) throw fail('COUNTRY_REQUIRED');
  if (session !== target) throw fail('REGION_MISMATCH');
  const territory = canonicalTerritory(src.territory);
  if (!territory) throw fail('TERRITORY_INVALID');
  const id = String(src.userId || '').trim();
  if (!id) throw fail('USER_REQUIRED');
  if (typeof query !== 'function') throw fail('COUNTRY_TERRITORY_QUERY_REQUIRED');
  const before = await readAffiliation(query, id, target);
  await query(
    'INSERT INTO public.user_activity_region_profile (user_id, activity_region, territory) ' +
      'VALUES ($1, $2, $3) ' +
      'ON CONFLICT (user_id, activity_region) DO UPDATE ' +
      'SET territory = EXCLUDED.territory, updated_at = now()',
    [id, target, territory]
  );
  return {
    userId: id,
    region: target,
    territory: territory,
    previous: before.territory,
    source: 'user_activity_region_profile',
    route: null,
  };
}

module.exports = {
  countryTableReady: countryTableReady,
  countCountryPopulation: countCountryPopulation,
  readAffiliation: readAffiliation,
  setCountryTerritory: setCountryTerritory,
  canonicalTerritory: canonicalTerritory,
  boardTerritory: boardTerritory,
  countryOf: countryOf,
};
