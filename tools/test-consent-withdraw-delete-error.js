'use strict';

const assert = require('assert');
const { createLegalGateService } = require('../server/legal-gate-service');

function adminWithDeleteError(failTable) {
  const calls = [];
  return {
    calls: calls,
    from: function (table) {
      const api = {
        delete: function () {
          return api;
        },
        update: function () {
          return api;
        },
        eq: function () {
          calls.push(table);
          if (table === failTable) return Promise.resolve({ data: null, error: { message: 'DELETE_FAILED' } });
          return Promise.resolve({ data: null, error: null });
        },
      };
      return api;
    },
  };
}

(async function () {
  const client = adminWithDeleteError('alignment_history');
  const svc = createLegalGateService({
    getAdminClient: function () {
      return client;
    },
  });
  await assert.rejects(
    function () {
      return svc.withdrawSensitiveConsent('user-a');
    },
    function (err) {
      return err && err.code === 'LEGAL_GATE_SAVE_FAILED';
    },
  );
  assert.deepStrictEqual(client.calls, ['user_alignment_state', 'alignment_history']);
  console.log('PASS consent withdrawal stops before clearing consent when a delete returns an error');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
