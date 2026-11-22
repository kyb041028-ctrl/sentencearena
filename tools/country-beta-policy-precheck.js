'use strict';

/**
 * Compares a saved policy snapshot with the policies in
 * supabase/migration_country_beta_apply.sql.
 * This file never opens a database and never prints a DROP statement.
 * A missing snapshot stops the check. Production comparison needs a
 * separately approved snapshot file.
 */

const fs = require('fs');

const COUNTRY_EXPR = "activity_region = NULLIF(upper(btrim(COALESCE(current_setting('request.jwt.claim.country', true), ''))), '')";

const REQUIRED_TABLES = [
  'user_activity_region_profile',
  'user_activity_region_achievement',
  'country_territory_history',
  'user_follows',
  'board_posts',
];

const EXPECTED = [
  policy('user_activity_region_profile', 'country_beta_profile_select_own', 'SELECT', false, '(user_id = auth.uid())', null),
  policy('user_activity_region_achievement', 'country_beta_achievement_select_own', 'SELECT', false, '(user_id = auth.uid())', null),
  policy('country_territory_history', 'country_beta_territory_select_own', 'SELECT', false, '(user_id = auth.uid())', null),
  policy('user_follows', 'country_beta_follow_select_party', 'SELECT', false, '(follower_user_id = auth.uid() OR following_user_id = auth.uid())', null),
  policy('user_follows', 'country_beta_follow_insert_own', 'INSERT', false, null, '(follower_user_id = auth.uid() AND ' + COUNTRY_EXPR + ')'),
  policy('user_legal_consents', 'country_beta_consent_select_own', 'SELECT', false, '(user_id = auth.uid())', null),
  policy('user_notifications', 'country_beta_notification_select_own', 'SELECT', false, '(user_id = auth.uid())', null),
  policy('user_activity_events', 'country_beta_activity_select_own', 'SELECT', false, '(user_id = auth.uid())', null),
  policy('board_posts', 'country_beta_post_country_update', 'UPDATE', true, '(' + COUNTRY_EXPR + ')', '(' + COUNTRY_EXPR + ')'),
  policy('board_posts', 'country_beta_post_country_insert', 'INSERT', true, null, '(' + COUNTRY_EXPR + ')'),
  policy('board_posts', 'board_posts_select_visible', 'SELECT', false, "(status IN ('ACTIVE', 'DELETED', 'BLINDED', 'HIDDEN_BY_OPERATOR'))", null),
];

function policy(table, name, command, restrictive, usingExpr, checkExpr) {
  return {
    table: table,
    name: name,
    command: command,
    restrictive: restrictive,
    roles: ['authenticated'],
    using: usingExpr,
    check: checkExpr,
  };
}

function norm(value) {
  let text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (text.charAt(0) === '(' && text.charAt(text.length - 1) === ')') {
    let depth = 0;
    let wrapsAll = true;
    for (let i = 0; i < text.length; i += 1) {
      if (text.charAt(i) === '(') depth += 1;
      else if (text.charAt(i) === ')') depth -= 1;
      if (depth === 0 && i < text.length - 1) {
        wrapsAll = false;
        break;
      }
    }
    if (wrapsAll && depth === 0) text = text.slice(1, -1).trim();
  }
  return text;
}

function rolesOf(row) {
  const raw = row && (row.roles || row.role);
  const list = Array.isArray(raw) ? raw : String(raw || '').replace(/[{}]/g, '').split(',');
  return list.map(function (item) { return String(item || '').trim().toLowerCase(); }).filter(Boolean).sort();
}

function sameScope(want, found) {
  const foundRestrictive = found.restrictive === true || String(found.permissive || '').toUpperCase() === 'RESTRICTIVE';
  return norm(found.command || found.cmd) === want.command
    && foundRestrictive === want.restrictive
    && rolesOf(found).join(',') === want.roles.join(',')
    && norm(found.using || found.qual) === norm(want.using)
    && norm(found.check || found.withCheck || found.with_check) === norm(want.check);
}

function comparePolicySnapshot(snapshot) {
  if (!snapshot || snapshot.complete !== true || !Array.isArray(snapshot.tables) || !Array.isArray(snapshot.policies)) {
    return {
      stop: true,
      code: 'PRODUCTION_STRUCTURE_UNKNOWN',
      items: [{ status: 'STOP', detail: '운영 정책 스냅샷이 없거나 완전하지 않다. 비교와 적용을 멈춘다.' }],
    };
  }
  const tables = {};
  snapshot.tables.forEach(function (name) { tables[String(name)] = true; });
  const missingTables = REQUIRED_TABLES.filter(function (name) { return !tables[name]; });
  if (missingTables.length) {
    return {
      stop: true,
      code: 'PRODUCTION_STRUCTURE_UNKNOWN',
      items: [{ status: 'STOP', detail: '운영 스냅샷에 필요한 테이블이 없다: ' + missingTables.join(', ') }],
    };
  }
  const items = [];
  let stop = false;
  let code = 'KEEP';
  snapshot.policies.forEach(function (found) {
    if (found && found.table === 'user_follows' && found.name === 'user_follows_select_all') {
      stop = true;
      code = 'POLICY_WOULD_REQUIRE_DROP';
      items.push({
        status: 'STOP',
        table: found.table,
        name: found.name,
        detail: '같은 이름의 넓은 조회 정책이 있다. 이 검사는 정책을 지우지 않는다. qual=' + norm(found.using || found.qual),
      });
    }
  });
  EXPECTED.forEach(function (want) {
    if (!tables[want.table]) return;
    const found = snapshot.policies.filter(function (row) {
      return row && row.table === want.table && row.name === want.name;
    });
    if (!found.length) {
      items.push({ status: 'ABSENT', table: want.table, name: want.name, detail: '저장소 정책이 아직 없다. 적용 시 생성만 가능하다.' });
      return;
    }
    if (found.length > 1 || !sameScope(want, found[0])) {
      stop = true;
      code = 'POLICY_SCOPE_MISMATCH';
      items.push({
        status: 'STOP',
        table: want.table,
        name: want.name,
        detail: '이름은 같고 범위가 다르다. 저장소 using=' + norm(want.using)
          + ' check=' + norm(want.check)
          + ' / 스냅샷 using=' + norm(found[0].using || found[0].qual)
          + ' check=' + norm(found[0].check || found[0].withCheck || found[0].with_check),
      });
      return;
    }
    items.push({ status: 'KEEP', table: want.table, name: want.name, detail: '같은 정책이다. 유지한다.' });
  });
  return { stop: stop, code: stop ? code : 'KEEP', items: items };
}

function printResult(result) {
  const lines = ['stop: ' + (result.stop ? 'YES' : 'NO'), 'code: ' + result.code];
  result.items.forEach(function (item) {
    lines.push([item.status, item.table || '-', item.name || '-', item.detail].join(' | '));
  });
  const text = lines.join('\n');
  if (text.indexOf('DROP POLICY') !== -1) {
    throw new Error('precheck tried to print a policy removal');
  }
  return text;
}

function selfTest() {
  const unknown = comparePolicySnapshot(null);
  if (!unknown.stop || unknown.code !== 'PRODUCTION_STRUCTURE_UNKNOWN') throw new Error('unknown snapshot did not stop');
  const base = {
    complete: true,
    tables: REQUIRED_TABLES.concat(['user_legal_consents', 'user_notifications', 'user_activity_events']),
    policies: EXPECTED.map(function (row) {
      return {
        table: row.table,
        name: row.name,
        command: row.command,
        restrictive: row.restrictive,
        roles: row.roles.slice(),
        using: row.using,
        check: row.check,
      };
    }),
  };
  const same = comparePolicySnapshot(base);
  if (same.stop || same.items.some(function (item) { return item.status !== 'KEEP'; })) throw new Error('identical policies were not kept');
  const changed = JSON.parse(JSON.stringify(base));
  changed.policies[0].using = '(true)';
  const mismatch = comparePolicySnapshot(changed);
  if (!mismatch.stop || mismatch.code !== 'POLICY_SCOPE_MISMATCH') throw new Error('different scope did not stop');
  if (JSON.stringify(mismatch).indexOf('DROP POLICY') !== -1) throw new Error('mismatch produced a policy removal');
  const broad = JSON.parse(JSON.stringify(base));
  broad.policies.push({ table: 'user_follows', name: 'user_follows_select_all', command: 'SELECT', roles: ['authenticated'], using: 'true', check: null });
  const blocked = comparePolicySnapshot(broad);
  if (!blocked.stop || blocked.code !== 'POLICY_WOULD_REQUIRE_DROP') throw new Error('broad follow policy did not stop');
  return 'self-test: PASS';
}

function main() {
  const args = process.argv.slice(2);
  if (args.indexOf('--self-test') !== -1) {
    process.stdout.write(selfTest() + '\n');
    return;
  }
  const flag = args.indexOf('--snapshot');
  if (flag === -1) {
    process.stdout.write(printResult(comparePolicySnapshot(null)) + '\n');
    process.exitCode = 2;
    return;
  }
  const file = args[flag + 1];
  if (!file) {
    process.stdout.write(printResult(comparePolicySnapshot(null)) + '\n');
    process.exitCode = 2;
    return;
  }
  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
  const result = comparePolicySnapshot(snapshot);
  process.stdout.write(printResult(result) + '\n');
  if (result.stop) process.exitCode = 2;
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    process.stderr.write(String(err && err.stack || err) + '\n');
    process.exit(1);
  }
}

module.exports = { comparePolicySnapshot, EXPECTED };
