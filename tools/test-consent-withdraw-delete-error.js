'use strict';

const assert = require('assert');
const { createLegalGateService } = require('../server/legal-gate-service');

function consentRow() {
  return {
    user_id: 'user-a',
    age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
    age_policy_version: 'age-policy-v1',
    sensitive_political_consented_at: '2026-01-02T00:00:00.000Z',
    sensitive_political_policy_version: 'sensitive-political-v1',
    territory_disclosure_consented_at: '2026-01-02T00:00:00.000Z',
    territory_disclosure_policy_version: 'territory-disclosure-v1',
    political_profile_visibility: 'public',
  };
}

function memory(options) {
  const opt = options || {};
  const row = consentRow();
  const alignment = [
    { table: 'user_alignment_state', userId: 'user-a' },
    { table: 'alignment_history', userId: 'user-a' },
    { table: 'alignment_territory_history', userId: 'user-a' },
  ];
  const calls = [];
  return {
    row: row,
    alignment: alignment,
    calls: calls,
    admin: {
      from: function () {
        const api = {
          select: function () {
            return api;
          },
          eq: function () {
            return api;
          },
          maybeSingle: function () {
            return Promise.resolve({ data: Object.assign({}, row), error: null });
          },
        };
        return api;
      },
      rpc: function (name) {
        calls.push(name);
        if (opt.fail) {
          return Promise.resolve({ data: null, error: { message: 'TX_FAILED' } });
        }
        alignment.length = 0;
        row.sensitive_political_consented_at = null;
        row.sensitive_political_policy_version = null;
        row.territory_disclosure_consented_at = null;
        row.territory_disclosure_policy_version = null;
        row.political_profile_visibility = 'private';
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
}

(async function () {
  const failed = memory({ fail: true });
  const before = JSON.stringify({ row: failed.row, alignment: failed.alignment });
  const failSvc = createLegalGateService({
    getAdminClient: function () {
      return failed.admin;
    },
  });
  await assert.rejects(
    function () {
      return failSvc.withdrawSensitiveConsent('user-a');
    },
    function (err) {
      return err && err.code === 'LEGAL_GATE_SAVE_FAILED';
    },
  );
  assert.deepStrictEqual(failed.calls, ['withdraw_sensitive_political_consent']);
  assert.strictEqual(JSON.stringify({ row: failed.row, alignment: failed.alignment }), before);
  console.log('PASS consent withdrawal rolls back when the transaction returns an error');

  const okMem = memory({ fail: false });
  const okSvc = createLegalGateService({
    getAdminClient: function () {
      return okMem.admin;
    },
  });
  const status = await okSvc.withdrawSensitiveConsent('user-a');
  assert.strictEqual(status.sensitiveConsented, false);
  assert.strictEqual(status.territoryDisclosureConsented, false);
  assert.strictEqual(status.ageConfirmed, true);
  assert.deepStrictEqual(okMem.alignment, []);
  assert.strictEqual(okMem.row.political_profile_visibility, 'private');
  assert.strictEqual(okMem.row.age_requirement_confirmed_at, '2026-01-01T00:00:00.000Z');
  console.log('PASS consent withdrawal clears alignment and consent together');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
