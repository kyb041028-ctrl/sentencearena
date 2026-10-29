'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createLegalGateService } = require('../server/legal-gate-service');
const core = require('../shared/legal-gate-core');

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log('PASS', name);
}

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
}

function sliceFn(sql, startMark, grantMark) {
  const start = sql.indexOf(startMark);
  const grant = sql.indexOf(grantMark, start);
  assert.ok(start >= 0 && grant > start, startMark);
  return sql.slice(start, grant);
}

const beta = read('supabase/migration_political_alignment_beta_v1.sql');
const batchCandidate = read('supabase/migration_alignment_batch_consent_recheck_candidate.sql');
const reactionCandidate = read('supabase/migration_reaction_snapshot_consent_recheck_candidate.sql');
const withdrawSql = read('supabase/migration_sensitive_consent_withdraw_tx_v1.sql');
const legalSql = read('supabase/migration_legal_gate_v1.sql');

const batchStart = 'CREATE OR REPLACE FUNCTION public.apply_alignment_score_batch(plan jsonb)';
const batchGrant = 'GRANT EXECUTE ON FUNCTION public.apply_alignment_score_batch(jsonb) TO service_role;';
const reactionStart = 'CREATE OR REPLACE FUNCTION public.toggle_board_reaction(';
const reactionGrant = 'GRANT EXECUTE ON FUNCTION public.toggle_board_reaction(text, uuid, text, text, text, text) TO service_role;';

const liveBatch = sliceFn(beta, batchStart, batchGrant);
const nextBatch = sliceFn(batchCandidate, batchStart, batchGrant);
const liveReaction = sliceFn(beta, reactionStart, reactionGrant);
const nextReaction = sliceFn(reactionCandidate, reactionStart, reactionGrant);

ok('현재 계산 함수에는 동의 재확인이 없음', !liveBatch.includes('user_legal_consents'));
ok('후보 계산 함수가 저장 전에 동의를 잠금', nextBatch.indexOf('FROM public.user_legal_consents') < nextBatch.indexOf('INSERT INTO public.user_alignment_state'));
ok('계산 후보의 여러 회원 동의 잠금은 사용자 번호 순', nextBatch.indexOf('ORDER BY 1') > 0 && nextBatch.indexOf('ORDER BY 1') < nextBatch.indexOf('INSERT INTO public.user_alignment_state'));
ok('후보 계산 함수의 점수식은 현재 본문과 같음', (function () {
  const mark = 'INSERT INTO public.user_alignment_state (user_id, score, previous_signal)';
  return liveBatch.slice(liveBatch.indexOf(mark)) === nextBatch.slice(nextBatch.indexOf(mark));
})());
ok('상한 500과 시그널 차감이 유지됨', nextBatch.includes('v_cap numeric(20, 6) := 500') && nextBatch.includes('v_raw := v_combined - v_prev_signal'));
ok('계산 함수 권한은 service_role만', nextBatch.includes('REVOKE ALL ON FUNCTION public.apply_alignment_score_batch(jsonb) FROM authenticated') && batchCandidate.includes(batchGrant) && !batchCandidate.includes('GRANT EXECUTE ON FUNCTION public.apply_alignment_score_batch(jsonb) TO authenticated'));
ok('계산 함수는 SECURITY DEFINER와 search_path를 유지', nextBatch.includes('SECURITY DEFINER') && nextBatch.includes('SET search_path = public, pg_temp'));

ok('현재 반응 함수는 영토 인자를 그대로 저장', liveReaction.includes('p_actor_territory, p_target_author_territory'));
ok('후보 반응 함수는 복사본 변수만 저장', nextReaction.includes('v_actor_territory_copy, v_target_territory_copy') && !nextReaction.includes('p_actor_territory, p_target_author_territory'));
ok('반응 개수와 취소 구간은 현재 본문과 같음', (function () {
  const mark = "IF p_audience_scope = 'EARTH' THEN";
  const restored = nextReaction
    .slice(nextReaction.indexOf(mark))
    .replace(/v_actor_territory_copy/g, 'p_actor_territory')
    .replace(/v_target_territory_copy/g, 'p_target_author_territory');
  return restored === liveReaction.slice(liveReaction.indexOf(mark));
})());
ok('반응 후보는 기존 반응을 지우지 않음', !nextReaction.includes('DELETE FROM public.board_reactions'));
ok('반응 후보는 게시글 잠금 다음에 동의 행을 잠금', nextReaction.indexOf('FROM public.board_posts WHERE id = p_target_id FOR UPDATE') < nextReaction.indexOf('FROM public.user_legal_consents WHERE user_id = v_actor FOR UPDATE'));
ok('영토 스냅샷 NULL 허용은 같은 후보 파일에 있음', reactionCandidate.includes('ALTER COLUMN actor_territory_at_reaction DROP NOT NULL') && reactionCandidate.includes('actor_territory_at_reaction IS NULL'));
ok('반응 함수 권한은 현재와 같음', nextReaction.includes('GRANT EXECUTE ON FUNCTION public.toggle_board_reaction(text, uuid, text, text, text, text) TO authenticated'));

ok('철회 함수 본문은 계산 함수를 대체하지 않음', !withdrawSql.includes('apply_alignment_score_batch') && !withdrawSql.includes('toggle_board_reaction'));
ok('철회 함수는 게시글 행을 잠그지 않음', !withdrawSql.includes('board_posts') && !withdrawSql.includes('board_comments'));
const accountSqlEarly = read('supabase/migration_account_withdrawal_v1.sql');
ok('계정 탈퇴는 동의 행을 먼저 잠그지 않음', !accountSqlEarly.includes('user_legal_consents'));
const dailyStore = read('server/daily-issue-alignment-reaction-store.js');
ok('Daily Issue 반응 저장은 동의 행과 게시글 행을 잠그지 않음', !dailyStore.includes('user_legal_consents') && !dailyStore.includes('FOR UPDATE'));
ok('철회 함수는 동의 행을 먼저 잠그고 성향 행을 지움', withdrawSql.indexOf('FROM public.user_legal_consents') < withdrawSql.indexOf('DELETE FROM public.user_alignment_state'));
ok('동의 행은 계정 삭제 때 함께 사라지는 외래 키', legalSql.includes('user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE'));
ok('이번 후보는 감사기록과 legal_hold를 지우지 않음', !batchCandidate.includes('legal_hold') && !reactionCandidate.includes('legal_hold') && !batchCandidate.includes('admin_moderation_audit'));

function validConsent(id) {
  return {
    user_id: id,
    age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
    age_policy_version: core.AGE_POLICY_VERSION,
    sensitive_political_consented_at: '2026-01-02T00:00:00.000Z',
    sensitive_political_policy_version: core.SENSITIVE_POLICY_VERSION,
    territory_disclosure_consented_at: '2026-01-02T00:00:00.000Z',
    territory_disclosure_policy_version: core.TERRITORY_DISCLOSURE_POLICY_VERSION,
  };
}

function clearConsent(row) {
  row.sensitive_political_consented_at = null;
  row.sensitive_political_policy_version = null;
  row.territory_disclosure_consented_at = null;
  row.territory_disclosure_policy_version = null;
}

function applyAtWrite(store, userId, consent) {
  if (!core.isComplete(consent)) {
    store.skipped.push(userId);
    return;
  }
  store.rows[userId] = { score: 12, history: true };
}

function withdrawAfter(store, consent) {
  delete store.rows[consent.user_id];
  clearConsent(consent);
}

const withdrawnFirst = { rows: {}, skipped: [] };
const consentA = validConsent('user-a');
clearConsent(consentA);
applyAtWrite(withdrawnFirst, 'user-a', consentA);
ok('철회가 먼저면 계산은 새 성향 행을 만들지 않음', !withdrawnFirst.rows['user-a'] && withdrawnFirst.skipped[0] === 'user-a');

const calcFirst = { rows: {}, skipped: [] };
const consentB = validConsent('user-b');
applyAtWrite(calcFirst, 'user-b', consentB);
ok('계산이 먼저면 성향 행이 생김', calcFirst.rows['user-b'] && calcFirst.rows['user-b'].score === 12);
withdrawAfter(calcFirst, consentB);
ok('그 다음 철회가 그 성향 행을 지움', !calcFirst.rows['user-b'] && !core.isComplete(consentB));

function reactionWrite(prior, actorConsent, targetConsent) {
  return {
    priorKept: prior,
    deleted: 0,
    likeCountDelta: 1,
    actorTerritory: core.isComplete(actorConsent) ? 'PIONEER' : null,
    actorScore: core.isComplete(actorConsent) ? 8 : null,
    targetTerritory: core.isComplete(targetConsent) ? 'CENTRAL' : null,
    targetScore: core.isComplete(targetConsent) ? 3 : null,
  };
}

const oldReaction = { id: 'old', actorTerritory: 'GUARDIAN', actorScore: 1 };
const actorGone = validConsent('actor');
clearConsent(actorGone);
const targetKept = validConsent('target');
const raced = reactionWrite(oldReaction, actorGone, targetKept);
ok('철회 뒤 새 반응은 행위자 점수와 영토를 복사하지 않음', raced.actorTerritory == null && raced.actorScore == null);
ok('상대 동의가 있으면 상대 복사만 남음', raced.targetTerritory === 'CENTRAL' && raced.targetScore === 3);
ok('옛 반응과 좋아요 개수는 유지', raced.priorKept === oldReaction && raced.deleted === 0 && raced.likeCountDelta === 1);

function client(seed, authUser) {
  const rows = {};
  (seed || []).forEach(function (row) {
    rows[row.user_id] = Object.assign({}, row);
  });
  const writes = [];
  return {
    rows: rows,
    writes: writes,
    admin: {
      auth: {
        admin: {
          getUserById: async function () {
            if (!authUser) return { data: { user: null }, error: { message: 'User not found' } };
            return { data: { user: authUser }, error: null };
          },
        },
      },
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
            writes.push('upsert');
            return Promise.resolve(api._finish());
          },
          eq: function (col, val) {
            api._filters[col] = val;
            return api;
          },
          is: function () {
            return Promise.resolve({ data: null, error: null });
          },
          maybeSingle: function () {
            return Promise.resolve(api._finish());
          },
          _finish: function () {
            if (api._action === 'upsert' && api._payload) {
              rows[api._payload.user_id] = Object.assign({}, api._payload);
              return { data: rows[api._payload.user_id], error: null };
            }
            if (api._action === 'update') {
              writes.push('update');
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
            return { data: rows[api._filters.user_id] ? Object.assign({}, rows[api._filters.user_id]) : null, error: null };
          },
        };
        return api;
      },
    },
  };
}

(async function () {
  const gone = client([], null);
  const goneSvc = createLegalGateService({
    getAdminClient: function () {
      return gone.admin;
    },
  });
  let goneCode = '';
  try {
    await goneSvc.confirmAge('deleted-user', { year: 2000, month: 1, day: 1, policyVersion: 'age-policy-v1' });
  } catch (err) {
    goneCode = err.code;
  }
  ok('삭제된 계정은 연령 확인으로 동의 행을 만들지 않음', goneCode === 'LEGAL_GATE_SAVE_FAILED' && gone.writes.length === 0 && !gone.rows['deleted-user']);

  const late = client(
    [
      {
        user_id: 'late-user',
        age_requirement_confirmed_at: '2026-01-01T00:00:00.000Z',
        age_policy_version: 'age-policy-v1',
        sensitive_political_consented_at: null,
        sensitive_political_policy_version: null,
        territory_disclosure_consented_at: null,
        territory_disclosure_policy_version: null,
        political_profile_visibility: 'private',
        updated_at: 'T2',
      },
    ],
    null,
  );
  const lateSvc = createLegalGateService({
    getAdminClient: function () {
      return late.admin;
    },
  });
  let lateCode = '';
  try {
    await lateSvc.consentSensitive('late-user', {
      consented: true,
      territoryDisclosureConsented: true,
      policyVersion: 'sensitive-political-v1',
      territoryDisclosurePolicyVersion: 'territory-disclosure-v1',
    });
  } catch (err) {
    lateCode = err.code;
  }
  ok('삭제된 계정의 늦은 동의 요청은 철회를 되살리지 않음', lateCode === 'LEGAL_GATE_SAVE_FAILED' && late.rows['late-user'].sensitive_political_consented_at == null && late.writes.length === 0);

  const accountSql = read('supabase/migration_account_withdrawal_v1.sql');
  ok(
    '계정 탈퇴 SQL은 감사 행을 지우지 않고 신고는 익명화',
    !accountSql.includes('DELETE FROM public.account_withdrawal_audit') &&
      accountSql.includes('UPDATE public.board_reports SET reporter_user_id = NULL') &&
      !batchCandidate.includes('DELETE FROM public.board_reports') &&
      !reactionCandidate.includes('DELETE FROM public.board_reports'),
  );

  console.log('RESULT', passed);
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
