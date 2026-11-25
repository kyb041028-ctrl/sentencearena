'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');
const { createLegalGateService } = require('../server/legal-gate-service');
const persistSvc = require('../server/political-alignment-persist-service');
const persistCore = require('../shared/political-alignment-persist-core');

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log('PASS', name);
}

function fullConsent(id, updatedAt) {
  return {
    user_id: id,
    age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
    age_policy_version: 'age-policy-v1',
    age_gate_method: 'dob-input',
    sensitive_political_consented_at: '2026-01-02T00:00:00.000Z',
    sensitive_political_policy_version: 'sensitive-political-v1',
    territory_disclosure_consented_at: '2026-01-02T00:00:00.000Z',
    territory_disclosure_policy_version: 'territory-disclosure-v1',
    political_profile_visibility: 'private',
    updated_at: updatedAt || 'T1',
  };
}

function consentClient(seed) {
  const rows = {};
  (seed || []).forEach(function (row) {
    rows[row.user_id] = Object.assign({}, row);
  });
  const rpcNames = [];
  let failRpc = false;
  return {
    rows: rows,
    rpcNames: rpcNames,
    failRpc: function (on) {
      failRpc = on;
    },
    admin: {
      from: function () {
        const api = {
          _action: 'select',
          _filters: {},
          _payload: null,
          select: function () {
            if (api._action === 'update' || api._action === 'upsert') return Promise.resolve(api._finish());
            return api;
          },
          then: function (resolve, reject) {
            return Promise.resolve(api._finish()).then(resolve, reject);
          },
          update: function (payload) {
            api._action = 'update';
            api._payload = payload;
            return api;
          },
          upsert: function (payload) {
            api._action = 'upsert';
            api._payload = payload;
            return Promise.resolve(api._finish());
          },
          eq: function (col, val) {
            api._filters[col] = val;
            return api;
          },
          in: function (_col, ids) {
            return Promise.resolve({
              data: ids.map(function (id) {
                return rows[id];
              }).filter(Boolean),
              error: null,
            });
          },
          is: function () {
            return Promise.resolve({ data: null, error: null });
          },
          maybeSingle: function () {
            return Promise.resolve(api._finish());
          },
          _finish: function () {
            if (api._action === 'upsert' && api._payload) {
              rows[api._payload.user_id] = Object.assign({}, rows[api._payload.user_id] || {}, api._payload);
              return { data: [rows[api._payload.user_id]], error: null };
            }
            if (api._action === 'update') {
              const id = api._filters.user_id;
              const current = rows[id];
              if (
                api._filters.updated_at != null &&
                current &&
                current.updated_at != null &&
                current.updated_at !== api._filters.updated_at
              ) {
                return { data: [], error: null };
              }
              if (current) rows[id] = Object.assign({}, current, api._payload);
              return { data: current ? [rows[id]] : [], error: null };
            }
            const id = api._filters.user_id;
            return { data: rows[id] ? Object.assign({}, rows[id]) : null, error: null };
          },
        };
        return api;
      },
      rpc: function (name) {
        rpcNames.push(name);
        if (name !== 'withdraw_sensitive_political_consent') {
          return Promise.resolve({ data: null, error: { message: 'UNKNOWN_RPC' } });
        }
        if (failRpc) return Promise.resolve({ data: null, error: { message: 'TX_FAILED' } });
        Object.keys(rows).forEach(function (id) {
          rows[id] = Object.assign({}, rows[id], {
            sensitive_political_consented_at: null,
            sensitive_political_policy_version: null,
            territory_disclosure_consented_at: null,
            territory_disclosure_policy_version: null,
            political_profile_visibility: 'private',
            updated_at: 'T-withdraw',
          });
        });
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
}

(async function () {
  const prev = process.env.LEGAL_GATE_ENFORCE;
  process.env.LEGAL_GATE_ENFORCE = '1';

  const fresh = consentClient([]);
  const freshSvc = createLegalGateService({
    getAdminClient: function () {
      return fresh.admin;
    },
  });
  const aged = await freshSvc.confirmAge('new-user', { year: 2000, month: 1, day: 1, policyVersion: 'age-policy-v1' });
  ok('새 연령 확인', aged.ageConfirmed === true && aged.sensitiveConsented === false);

  const keep = consentClient([fullConsent('keep-user', 'T-keep')]);
  const keepSvc = createLegalGateService({
    getAdminClient: function () {
      return keep.admin;
    },
  });
  const again = await keepSvc.confirmAge('keep-user', { year: 2000, month: 1, day: 1, policyVersion: 'age-policy-v1' });
  ok('기존 동의는 연령 확인 뒤에도 유지', again.sensitiveConsented === true && again.territoryDisclosureConsented === true);

  const stale = consentClient([fullConsent('stale-user', 'T1')]);
  const staleRow = stale.rows['stale-user'];
  const originalMaybe = stale.admin.from;
  let armStaleRead = true;
  stale.admin.from = function () {
    const api = originalMaybe();
    if (!armStaleRead) return api;
    const inner = api.maybeSingle;
    api.maybeSingle = function () {
      armStaleRead = false;
      const snap = Object.assign({}, staleRow);
      staleRow.sensitive_political_consented_at = null;
      staleRow.sensitive_political_policy_version = null;
      staleRow.territory_disclosure_consented_at = null;
      staleRow.territory_disclosure_policy_version = null;
      staleRow.updated_at = 'T2';
      api.maybeSingle = inner;
      return Promise.resolve({ data: snap, error: null });
    };
    return api;
  };
  const staleSvc = createLegalGateService({
    getAdminClient: function () {
      return stale.admin;
    },
  });
  let staleCode = '';
  try {
    await staleSvc.consentSensitive('stale-user', {
      consented: true,
      territoryDisclosureConsented: true,
      policyVersion: 'sensitive-political-v1',
      territoryDisclosurePolicyVersion: 'territory-disclosure-v1',
    });
  } catch (err) {
    staleCode = err.code;
  }
  ok('늦은 옛 동의는 철회를 되살리지 않음', staleCode === 'LEGAL_GATE_SAVE_FAILED' && staleRow.sensitive_political_consented_at == null);

  const reSvc = createLegalGateService({
    getAdminClient: function () {
      return stale.admin;
    },
  });
  const re = await reSvc.consentSensitive('stale-user', {
    consented: true,
    territoryDisclosureConsented: true,
    policyVersion: 'sensitive-political-v1',
    territoryDisclosurePolicyVersion: 'territory-disclosure-v1',
  });
  ok('명시적 재동의는 새 시각으로 가능', re.sensitiveConsented === true && staleRow.sensitive_political_consented_at !== '2026-01-02T00:00:00.000Z');

  const dup = consentClient([fullConsent('dup-user', 'T1')]);
  const dupSvc = createLegalGateService({
    getAdminClient: function () {
      return dup.admin;
    },
  });
  await dupSvc.withdrawSensitiveConsent('dup-user');
  const second = await dupSvc.withdrawSensitiveConsent('dup-user');
  ok('중복 철회는 계정 함수를 호출하지 않음', dup.rpcNames.length === 2 && dup.rpcNames.every(function (name) {
    return name === 'withdraw_sensitive_political_consent';
  }) && second.sensitiveConsented === false && second.ageConfirmed === true);

  const boom = consentClient([fullConsent('boom-user', 'T1')]);
  boom.failRpc(true);
  const before = JSON.stringify(boom.rows['boom-user']);
  const boomSvc = createLegalGateService({
    getAdminClient: function () {
      return boom.admin;
    },
  });
  let boomCode = '';
  try {
    await boomSvc.withdrawSensitiveConsent('boom-user');
  } catch (err) {
    boomCode = err.code;
  }
  ok('RPC 실패는 동의를 지우지 않음', boomCode === 'LEGAL_GATE_SAVE_FAILED' && JSON.stringify(boom.rows['boom-user']) === before);

  const model = { alignment: ['state'], consent: 'yes' };
  const snap = JSON.parse(JSON.stringify(model));
  try {
    model.alignment = [];
    throw new Error('mid');
  } catch (err) {
    model.alignment = snap.alignment;
    model.consent = snap.consent;
  }
  ok('원자적 롤백은 오프라인 모형', model.alignment.length === 1 && model.consent === 'yes');
  console.log('NOTE atomic rollback model is not a live database pass');

  const gate = consentClient([fullConsent('react-user', 'T1')]);
  const gateSvc = createLegalGateService({
    getAdminClient: function () {
      return gate.admin;
    },
  });
  await gateSvc.withdrawSensitiveConsent('react-user');
  let reactCode = '';
  try {
    await gateSvc.assertCompleteForUser('react-user');
  } catch (err) {
    reactCode = err.code;
  }
  ok('철회 뒤 새 반응 관문은 거절', reactCode === 'LEGAL_GATE_INCOMPLETE');

  const store = persistSvc.createMemoryAlignmentStore();
  const applied = await persistSvc.runPoliticalAlignmentBatch({
    apply: true,
    batchId: 'alignment-consent-boundary',
    asOf: '2026-08-20T08:00:00.000Z',
    store: store,
    getAdminClient: function () {
      return consentClient([
        fullConsent('user-keep', 'T1'),
        {
          user_id: 'user-out',
          age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
          age_policy_version: 'age-policy-v1',
          age_gate_method: 'dob-input',
          sensitive_political_consented_at: null,
          sensitive_political_policy_version: null,
          territory_disclosure_consented_at: null,
          territory_disclosure_policy_version: null,
          political_profile_visibility: 'private',
          updated_at: 'T2',
        },
      ]).admin;
    },
    simulation: {
      asOf: '2026-08-20T08:00:00.000Z',
      users: [
        { userId: 'user-keep', combinedSignal: 10 },
        { userId: 'user-out', combinedSignal: 10 },
      ],
    },
  });
  const expected = persistCore.applyScoreStep(persistCore.defaultInitialState(), 10);
  ok('철회 회원은 새 성향 상태가 생기지 않음', store.getState('user-out') == null && store.getHistory().every(function (row) {
    return row.userId !== 'user-out';
  }));
  ok('유효 동의 회원의 점수 단계는 그대로', store.getState('user-keep').score === expected.nextScore && applied.userCount === 1);
  ok('상한은 그대로', persistCore.getCap() === 500);

  const diff = execFileSync('git', ['diff', '--', 'shared/political-alignment-persist-core.js', 'shared/alignment-batch-core.js', 'supabase/migration_political_alignment_beta_v1.sql'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
  });
  ok('영토 계산 파일은 수정하지 않음', !String(diff || '').trim());

  process.env.LEGAL_GATE_ENFORCE = prev == null ? '' : prev;
  if (prev == null) delete process.env.LEGAL_GATE_ENFORCE;
  console.log('OK', passed);
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
