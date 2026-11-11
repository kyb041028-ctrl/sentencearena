/**
 * 통합 실행으로 띄운 개발 서버를 멈춘다. 저장 JSON은 지우지 않는다.
 * node tools/stop-leader-dev.js
 */
'use strict';

const fs = require('fs');
const launch = require('../server/leader-dev-launch');

const pidPath = launch.pidFile(process.env.LEADER_DEV_DATA_DIR);
if (!fs.existsSync(pidPath)) {
  process.stdout.write('integrated leader dev servers already stopped\n');
  process.exit(0);
}
const record = JSON.parse(fs.readFileSync(pidPath, 'utf8'));
(record.pids || []).forEach(function (pid) {
  try { process.kill(pid); }
  catch (err) { return; }
});
fs.unlinkSync(pidPath);
process.stdout.write('integrated leader dev servers stopped\n');
process.stdout.write('directory=' + (record.directory || '') + '\n');
