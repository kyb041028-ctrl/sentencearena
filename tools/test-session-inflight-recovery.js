'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const entry = fs.readFileSync(path.join(__dirname, '../public/app-entry.js'), 'utf8');
const empty = { data: { session: null }, error: null };

function loadEntry(getSession) {
  const window = { ScAuth: { getSession: getSession } };
  vm.runInNewContext(entry, { window: window });
  return window;
}

(async function () {
  let calls = 0;
  const rejected = loadEntry(function () {
    calls += 1;
    return calls === 1 ? Promise.reject(new Error('TEMP_SESSION')) : Promise.resolve(empty);
  });
  await assert.rejects(function () {
    return rejected.__scGetSessionShared();
  }, /TEMP_SESSION/);
  assert.deepStrictEqual(await rejected.__scGetSessionShared(), empty);
  assert.strictEqual(calls, 2);

  let errorCalls = 0;
  const failed = { data: { session: null }, error: { message: 'TEMP_SESSION' } };
  const errored = loadEntry(function () {
    errorCalls += 1;
    return Promise.resolve(errorCalls === 1 ? failed : empty);
  });
  assert.deepStrictEqual(await errored.__scGetSessionShared(), failed);
  assert.deepStrictEqual(await errored.__scGetSessionShared(), empty);
  assert.strictEqual(errorCalls, 2);

  let sharedCalls = 0;
  let resolvePending;
  const pending = new Promise(function (resolve) {
    resolvePending = resolve;
  });
  const shared = loadEntry(function () {
    sharedCalls += 1;
    return pending;
  });
  const first = shared.__scGetSessionShared();
  const second = shared.__scGetSessionShared();
  assert.strictEqual(first, second);
  assert.strictEqual(sharedCalls, 1);
  resolvePending(empty);
  await first;
  console.log('PASS session lookup retries after failure and shares one in-flight request');
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
