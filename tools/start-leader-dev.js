/**
 * 선거, 보궐 진행, 임명 개발 서버를 같은 저장 디렉터리로 띄운다.
 * node tools/start-leader-dev.js
 * node tools/start-leader-dev.js --check
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const launch = require('../server/leader-dev-launch');

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return false;
  }
}

function waitReady(child, readyText) {
  return new Promise(function (resolve, reject) {
    let buf = '';
    const timer = setTimeout(function () {
      reject(new Error(readyText + ' did not start ' + buf));
    }, 10000);
    child.stdout.on('data', function (chunk) {
      buf += chunk.toString();
      if (buf.indexOf(readyText) >= 0) {
        clearTimeout(timer);
        resolve(buf);
      }
    });
    child.stderr.on('data', function (chunk) { buf += chunk.toString(); });
    child.on('exit', function (code) {
      if (buf.indexOf(readyText) < 0) {
        clearTimeout(timer);
        reject(new Error('exited ' + code + ' ' + buf));
      }
    });
  });
}

if (process.argv.indexOf('--check') >= 0) {
  const report = launch.describe(process.env);
  if (!report.same) {
    process.stderr.write(launch.formatMismatch(report) + '\n');
    process.exit(1);
  }
  process.stdout.write('CONFIG_OK\n');
  process.exit(0);
}

const planned = launch.childEnv(process.env.LEADER_DEV_DATA_DIR);
const childEnv = Object.assign({}, process.env, planned.env);
const report = launch.describe(childEnv);
if (!report.same) {
  process.stderr.write(launch.formatMismatch(report) + '\n');
  process.exit(1);
}

const pidPath = launch.pidFile(planned.paths.directory);
if (fs.existsSync(pidPath)) {
  const previous = JSON.parse(fs.readFileSync(pidPath, 'utf8'));
  const running = (previous.pids || []).filter(alive);
  if (running.length) {
    process.stderr.write('CONFIG_ALREADY_RUNNING\n');
    process.exit(1);
  }
}

fs.mkdirSync(planned.paths.directory, { recursive: true });
const root = path.join(__dirname, '..');
const specs = [
  { name: 'election', script: 'server/leader-election-dev-http.js', ready: 'leader election dev http' },
  { name: 'by-election', script: 'server/by-election-run-dev-http.js', ready: 'by-election run dev http' },
  { name: 'appointment', script: 'server/leader-appointment-dev-http.js', ready: 'leader appointment dev http' },
  { name: 'filing', script: 'server/leader-filing-dev-http.js', ready: 'leader filing dev http' },
  { name: 'rep-vote', script: 'server/rep-impeach-vote-dev-http.js', ready: 'rep impeach vote dev http' },
  { name: 'citizen-vote', script: 'server/citizen-impeach-vote-dev-http.js', ready: 'citizen impeach vote dev http' },
  { name: 'vacancy', script: 'server/impeachment-vacancy-dev-http.js', ready: 'impeachment vacancy dev http' },
];
const children = [];

(async function () {
  for (const spec of specs) {
    const child = spawn(process.execPath, [spec.script], {
      cwd: root,
      env: childEnv,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    children.push(child);
    try {
      await waitReady(child, spec.ready);
    } catch (err) {
      children.forEach(function (item) {
        try { process.kill(item.pid); } catch (killErr) { return; }
      });
      throw err;
    }
  }
  const record = {
    directory: planned.paths.directory,
    paths: planned.paths,
    pids: children.map(function (child) { return child.pid; }),
    ports: {
      election: childEnv.LEADER_ELECTION_DEV_PORT,
      byElection: childEnv.BY_ELECTION_RUN_DEV_PORT,
      appointment: childEnv.LEADER_APPOINTMENT_DEV_PORT,
    },
  };
  fs.writeFileSync(pidPath, JSON.stringify(record, null, 2));
  children.forEach(function (child) {
    if (child.stdout) child.stdout.destroy();
    if (child.stderr) child.stderr.destroy();
    child.unref();
  });
  process.stdout.write('integrated leader dev servers\n');
  process.stdout.write('directory=' + planned.paths.directory + '\n');
  launch.COMPARE_KEYS.forEach(function (key) {
    process.stdout.write(key + '=' + planned.paths[key] + '\n');
  });
  process.stdout.write('ports election=' + record.ports.election + ' by-election=' + record.ports.byElection + ' appointment=' + record.ports.appointment + '\n');
  process.exit(0);
})().catch(function (err) {
  process.stderr.write(String(err && err.stack || err) + '\n');
  process.exit(1);
});
