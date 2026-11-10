/**
 * 개발 서버를 한 저장 디렉터리로 띄우는 실행 설정.
 * 임명 규칙과 조회 규칙은 바꾸지 않는다.
 */
'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_DIR = path.join(ROOT, 'dev-data', 'leader-integrated');
const COMPARE_KEYS = ['election', 'vacancy', 'rank', 'filing', 'run', 'citizen'];
const ENV_KEYS = {
  election: 'LEADER_ELECTION_STORE',
  filing: 'LEADER_FILING_STORE',
  vacancy: 'IMPEACHMENT_VACANCY_STORE',
  rank: 'LEADER_APPOINTMENT_RANK_STORE',
  run: 'BY_ELECTION_RUN_STORE',
  citizen: 'LEADER_APPOINTMENT_CITIZEN_STORE',
};

function integratedPaths(dir) {
  const root = dir ? path.resolve(dir) : DEFAULT_DIR;
  return {
    directory: root,
    election: path.join(root, 'election.json'),
    vacancy: path.join(root, 'vacancy.json'),
    rank: path.join(root, 'rank.json'),
    filing: path.join(root, 'filing.json'),
    run: path.join(root, 'run.json'),
    citizen: path.join(root, 'citizen.json'),
  };
}

function soloElection(env) {
  const dir = path.join(ROOT, 'dev-data');
  return {
    election: env.LEADER_ELECTION_STORE || path.join(dir, 'leader-election-store.json'),
    filing: env.LEADER_FILING_STORE || path.join(dir, 'leader-filing-store.json'),
    vacancy: env.IMPEACHMENT_VACANCY_STORE || path.join(dir, 'impeachment-vacancy-store.json'),
    rank: env.LEADER_APPOINTMENT_RANK_STORE || path.join(dir, 'leader-appointment-rank.json'),
    run: env.BY_ELECTION_RUN_STORE || path.join(dir, 'by-election-run.json'),
    citizen: env.LEADER_APPOINTMENT_CITIZEN_STORE || path.join(dir, 'leader-appointment-citizen.json'),
  };
}

function soloBy(env) {
  const dir = path.join(ROOT, 'dev-data');
  return {
    vacancy: env.IMPEACHMENT_VACANCY_STORE || path.join(dir, 'by-election-vacancy.json'),
    election: env.LEADER_ELECTION_STORE || path.join(dir, 'by-election-election.json'),
    filing: env.LEADER_FILING_STORE || path.join(dir, 'by-election-filing.json'),
    run: env.BY_ELECTION_RUN_STORE || path.join(dir, 'by-election-run.json'),
    rank: env.LEADER_APPOINTMENT_RANK_STORE || path.join(dir, 'leader-appointment-rank.json'),
    citizen: env.LEADER_APPOINTMENT_CITIZEN_STORE || path.join(dir, 'leader-appointment-citizen.json'),
  };
}

function soloAppointment() {
  const dir = path.join(ROOT, 'dev-data');
  return {
    vacancy: path.join(dir, 'leader-appointment-vacancy.json'),
    election: path.join(dir, 'leader-appointment-election.json'),
    filing: path.join(dir, 'leader-appointment-filing.json'),
    rank: path.join(dir, 'leader-appointment-rank.json'),
    citizen: path.join(dir, 'leader-appointment-citizen.json'),
    run: path.join(dir, 'leader-appointment-run.json'),
  };
}

function integratedFromEnv(env) {
  const canonical = integratedPaths(env.LEADER_DEV_DATA_DIR);
  const out = { directory: canonical.directory };
  COMPARE_KEYS.forEach(function (key) {
    out[key] = env[ENV_KEYS[key]] ? path.resolve(env[ENV_KEYS[key]]) : canonical[key];
  });
  return out;
}

function storesFor(role, env) {
  const source = env || {};
  if (source.LEADER_DEV_INTEGRATION === '1') return integratedFromEnv(source);
  if (role === 'election') return soloElection(source);
  if (role === 'by-election') return soloBy(source);
  return soloAppointment();
}

function findStoreMismatch(maps) {
  const roles = Object.keys(maps);
  const errors = [];
  COMPARE_KEYS.forEach(function (key) {
    const values = roles.map(function (role) { return path.resolve(maps[role][key]); });
    const unique = values.filter(function (value, index) { return values.indexOf(value) === index; });
    if (unique.length > 1) {
      errors.push({
        key: key,
        paths: roles.map(function (role, index) { return role + '=' + values[index]; }),
      });
    }
  });
  return errors;
}

function describe(env) {
  const source = env || {};
  const maps = {
    election: storesFor('election', source),
    'by-election': storesFor('by-election', source),
    appointment: storesFor('appointment', source),
  };
  const errors = findStoreMismatch(maps);
  return { same: errors.length === 0, errors: errors, maps: maps };
}

function formatMismatch(report) {
  const lines = ['CONFIG_STORE_MISMATCH', '서버가 서로 다른 저장 파일을 가리킵니다.'];
  report.errors.forEach(function (error) {
    lines.push(error.key + ': ' + error.paths.join(' | '));
  });
  return lines.join('\n');
}

function soloHint() {
  const shared = integratedPaths();
  const lines = [
    '이 프로세스는 단독 실행입니다. 통합 실행에 필요한 환경 변수와 파일:',
    'directory=' + shared.directory,
    'LEADER_DEV_INTEGRATION=1',
    'LEADER_DEV_DATA_DIR=' + shared.directory,
  ];
  COMPARE_KEYS.forEach(function (key) {
    lines.push(ENV_KEYS[key] + '=' + shared[key]);
  });
  lines.push('start: node tools/start-leader-dev.js');
  lines.push('stop: node tools/stop-leader-dev.js');
  return lines.join('\n') + '\n';
}

function choose(role, env) {
  const source = env || process.env;
  if (source.LEADER_DEV_INTEGRATION === '1') {
    const report = describe(source);
    if (!report.same) return { ok: false, report: formatMismatch(report) + '\n' };
    return { ok: true, paths: storesFor(role, source), hint: '' };
  }
  return { ok: true, paths: storesFor(role, source), hint: soloHint() };
}

function childEnv(dir, ports) {
  const shared = integratedPaths(dir);
  const env = {
    LEADER_DEV_INTEGRATION: '1',
    LEADER_DEV_DATA_DIR: shared.directory,
  };
  COMPARE_KEYS.forEach(function (key) { env[ENV_KEYS[key]] = shared[key]; });
  const chosenPorts = ports || {};
  env.LEADER_ELECTION_DEV_PORT = String(chosenPorts.election || process.env.LEADER_ELECTION_DEV_PORT || 3013);
  env.BY_ELECTION_RUN_DEV_PORT = String(chosenPorts.byElection || process.env.BY_ELECTION_RUN_DEV_PORT || 3018);
  env.LEADER_APPOINTMENT_DEV_PORT = String(chosenPorts.appointment || process.env.LEADER_APPOINTMENT_DEV_PORT || 3019);
  return { env: env, paths: shared };
}

function pidFile(dir) {
  return path.join(integratedPaths(dir).directory, 'launch-pids.json');
}

module.exports = {
  DEFAULT_DIR: DEFAULT_DIR,
  COMPARE_KEYS: COMPARE_KEYS,
  ENV_KEYS: ENV_KEYS,
  integratedPaths: integratedPaths,
  storesFor: storesFor,
  findStoreMismatch: findStoreMismatch,
  describe: describe,
  formatMismatch: formatMismatch,
  soloHint: soloHint,
  choose: choose,
  childEnv: childEnv,
  pidFile: pidFile,
};
