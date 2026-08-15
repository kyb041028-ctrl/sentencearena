'use strict';
/**
 * Test-only process teardown.
 * Closes leftover test handles so Node can exit 0 without process.exit(0).
 * Does not change production request lifecycle.
 */

function closeSupabaseClient(client) {
  if (!client) return;
  try {
    if (typeof client.removeAllChannels === 'function') client.removeAllChannels();
  } catch (e) {}
  try {
    if (client.realtime && typeof client.realtime.disconnect === 'function') {
      client.realtime.disconnect();
    }
  } catch (e) {}
  try {
    if (client.auth && typeof client.auth.stopAutoRefresh === 'function') {
      client.auth.stopAutoRefresh();
    }
  } catch (e) {}
}

function closeAdminClientIfOpen() {
  try {
    const persist = require('../server/achievement-persist-service');
    if (typeof persist.closeAdminClientForTests === 'function') {
      persist.closeAdminClientForTests();
    }
  } catch (e) {}
}

function unrefStdio() {
  try {
    if (process.stdin && typeof process.stdin.unref === 'function') process.stdin.unref();
  } catch (e) {}
}

async function closeKeepAliveDispatchers() {
  try {
    const undici = require('undici');
    if (typeof undici.getGlobalDispatcher === 'function') {
      const dispatcher = undici.getGlobalDispatcher();
      if (dispatcher && typeof dispatcher.close === 'function') {
        await dispatcher.close();
      } else if (dispatcher && typeof dispatcher.destroy === 'function') {
        dispatcher.destroy();
      }
    }
  } catch (e) {}
  try {
    const http = require('http');
    if (http.globalAgent && typeof http.globalAgent.destroy === 'function') {
      http.globalAgent.destroy();
    }
  } catch (e) {}
  try {
    const https = require('https');
    if (https.globalAgent && typeof https.globalAgent.destroy === 'function') {
      https.globalAgent.destroy();
    }
  } catch (e) {}
}

/**
 * @param {number} failCount
 * @param {object[]} [extraClients]
 */
async function finishTest(failCount, extraClients) {
  const failed = Number(failCount) > 0;
  process.exitCode = failed ? 1 : 0;
  const extras = Array.isArray(extraClients) ? extraClients : [];
  extras.forEach(closeSupabaseClient);
  closeAdminClientIfOpen();
  unrefStdio();
  await closeKeepAliveDispatchers();
}

module.exports = {
  finishTest,
  closeSupabaseClient,
  closeAdminClientIfOpen,
};
