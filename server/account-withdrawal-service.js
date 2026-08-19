'use strict';

const core = require('../shared/account-withdrawal-core');

function makeError(code, status) {
  const err = new Error(code);
  err.code = code;
  err.status = status || 500;
  return err;
}

function createAccountWithdrawalService(options) {
  const opt = options || {};

  async function withdraw(input) {
    const parsed = core.parseWithdrawBody(input && input.body);
    if (!parsed.ok) throw makeError(parsed.error, parsed.status);

    const userId = String((input && input.userId) || '').trim();
    if (!userId) throw makeError('UNAUTHORIZED', 401);

    const admin = typeof opt.getAdminClient === 'function' ? opt.getAdminClient() : null;
    if (!admin) throw makeError('WITHDRAW_ADMIN_UNAVAILABLE', 503);

    const job = await upsertJob(admin, userId, parsed.policyVersion);

    let pack = null;
    let auditId = job.lastAuditId || null;

    if (job.status !== 'ANONYMIZED' || !auditId) {
      try {
        pack = await anonymize(admin, userId);
      } catch (e) {
        await markJob(admin, userId, 'FAILED', auditId);
        throw e;
      }

      const auditRow = {
        withdrawal_policy_version: parsed.policyVersion,
        privacy_policy_version: null,
        anonymized_post_count: Number(pack.anonymized_post_count || 0),
        anonymized_board_comment_count: Number(pack.anonymized_board_comment_count || 0),
        anonymized_daily_issue_comment_count: Number(pack.anonymized_daily_issue_comment_count || 0),
        anonymized_report_count: Number(pack.anonymized_report_count || 0),
        deleted_record_counts: pack.deleted_record_counts || {},
        auth_deleted: false,
        result: 'ANONYMIZED',
      };
      if (core.containsForbiddenAuditKeys(auditRow)) {
        throw makeError('WITHDRAW_AUDIT_FORBIDDEN_KEYS', 500);
      }

      if (auditId) {
        const upd = await admin
          .from('account_withdrawal_audit')
          .update(auditRow)
          .eq('id', auditId)
          .select('id')
          .maybeSingle();
        if (upd.error) {
          const err = makeError('WITHDRAW_AUDIT_UPDATE_FAILED', 500);
          err.detail = upd.error.message;
          throw err;
        }
      } else {
        const inserted = await admin
          .from('account_withdrawal_audit')
          .insert(auditRow)
          .select('id')
          .maybeSingle();
        if (inserted.error) {
          const err = makeError('WITHDRAW_AUDIT_INSERT_FAILED', 500);
          err.detail = inserted.error.message;
          throw err;
        }
        auditId = inserted.data && inserted.data.id;
      }

      await markJob(admin, userId, 'ANONYMIZED', auditId);
    } else {
      pack = {
        anonymized_post_count: 0,
        anonymized_board_comment_count: 0,
        anonymized_daily_issue_comment_count: 0,
        anonymized_report_count: 0,
      };
      const existingAudit = await admin
        .from('account_withdrawal_audit')
        .select(
          'anonymized_post_count, anonymized_board_comment_count, anonymized_daily_issue_comment_count, anonymized_report_count',
        )
        .eq('id', auditId)
        .maybeSingle();
      if (existingAudit.data) pack = existingAudit.data;
    }

    let authDeleted = false;
    try {
      authDeleted = await deleteAuthUser(admin, userId);
    } catch (e) {
      if (auditId) {
        await admin
          .from('account_withdrawal_audit')
          .update({ result: 'AUTH_DELETE_FAILED' })
          .eq('id', auditId);
      }
      await markJob(admin, userId, 'FAILED', auditId);
      throw e;
    }

    if (auditId) {
      await admin
        .from('account_withdrawal_audit')
        .update({ auth_deleted: !!authDeleted, result: 'COMPLETED' })
        .eq('id', auditId);
    }

    const response = {
      withdrawn: true,
      policyVersion: parsed.policyVersion,
      withdrawnAt: new Date().toISOString(),
      authDeleted: !!authDeleted,
      anonymized: {
        posts: Number(pack.anonymized_post_count || 0),
        boardComments: Number(pack.anonymized_board_comment_count || 0),
        dailyIssueComments: Number(pack.anonymized_daily_issue_comment_count || 0),
        reports: Number(pack.anonymized_report_count || 0),
      },
    };
    if (core.containsForbiddenAuditKeys(response)) {
      throw makeError('WITHDRAW_AUDIT_FORBIDDEN_KEYS', 500);
    }
    return response;
  }

  async function upsertJob(admin, userId, policyVersion) {
    const existing = await admin
      .from('account_withdrawal_jobs')
      .select('id, status, last_audit_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (existing.error) {
      const err = makeError('WITHDRAW_JOB_QUERY_FAILED', 500);
      err.detail = existing.error.message;
      throw err;
    }
    if (existing.data && existing.data.id) {
      await admin
        .from('account_withdrawal_jobs')
        .update({
          status: existing.data.status === 'ANONYMIZED' ? 'ANONYMIZED' : 'PENDING',
          policy_version: policyVersion,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.data.id);
      return {
        id: existing.data.id,
        status: existing.data.status,
        lastAuditId: existing.data.last_audit_id || null,
      };
    }
    const ins = await admin
      .from('account_withdrawal_jobs')
      .insert({ user_id: userId, status: 'PENDING', policy_version: policyVersion })
      .select('id, status, last_audit_id')
      .maybeSingle();
    if (ins.error) {
      const err = makeError('WITHDRAW_JOB_INSERT_FAILED', 500);
      err.detail = ins.error.message;
      throw err;
    }
    return {
      id: ins.data && ins.data.id,
      status: (ins.data && ins.data.status) || 'PENDING',
      lastAuditId: (ins.data && ins.data.last_audit_id) || null,
    };
  }

  async function markJob(admin, userId, status, lastAuditId) {
    const patch = { status: status, updated_at: new Date().toISOString() };
    if (lastAuditId) patch.last_audit_id = lastAuditId;
    await admin.from('account_withdrawal_jobs').update(patch).eq('user_id', userId);
  }

  async function anonymize(admin, userId) {
    if (typeof opt.anonymizeFn === 'function') {
      return opt.anonymizeFn(userId);
    }
    const rpc = await admin.rpc('withdraw_account_anonymize', { p_user_id: userId });
    if (rpc.error) {
      const err = makeError('WITHDRAW_ANONYMIZE_FAILED', 500);
      err.detail = rpc.error.message;
      throw err;
    }
    const data = rpc.data && typeof rpc.data === 'object' ? rpc.data : {};
    if (data.ok === false) {
      throw makeError('WITHDRAW_ANONYMIZE_FAILED', 500);
    }
    return data;
  }

  async function deleteAuthUser(admin, userId) {
    if (typeof opt.deleteAuthUserFn === 'function') {
      return opt.deleteAuthUserFn(userId);
    }
    const authAdmin = admin.auth && admin.auth.admin;
    if (!authAdmin || typeof authAdmin.deleteUser !== 'function') {
      throw makeError('WITHDRAW_AUTH_DELETE_UNAVAILABLE', 503);
    }
    const res = await authAdmin.deleteUser(userId);
    if (res.error) {
      const msg = String(res.error.message || '');
      if (/not found|user not found|already/i.test(msg)) return true;
      const err = makeError('WITHDRAW_AUTH_DELETE_FAILED', 500);
      err.detail = res.error.message;
      throw err;
    }
    return true;
  }

  return { withdraw: withdraw };
}

module.exports = {
  createAccountWithdrawalService,
};
