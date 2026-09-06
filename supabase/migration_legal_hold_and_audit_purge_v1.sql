-- SentenceArena DEC-021 legal_hold + DEC-020 admin audit 1y controlled purge (additive).
-- No DROP TABLE / DROP COLUMN / TRUNCATE / backfill of fake ops data.
-- Does not weaken append-only protection for normal DELETE/UPDATE paths.

-- Report / sanction reason columns (evidence/rights already have legal_hold_reason)
ALTER TABLE public.board_reports
  ADD COLUMN IF NOT EXISTS legal_hold_reason text NULL;
ALTER TABLE public.user_sanction_records
  ADD COLUMN IF NOT EXISTS legal_hold_reason text NULL;

COMMENT ON COLUMN public.board_reports.legal_hold_reason IS
  'DEC-021 OWNER legal_hold 사유. hold 중만 의미 있음.';
COMMENT ON COLUMN public.user_sanction_records.legal_hold_reason IS
  'DEC-021 OWNER legal_hold 사유. hold 중만 의미 있음.';

-- Separate hold state for append-only admin audit events (no UPDATE on audit rows)
CREATE TABLE IF NOT EXISTS public.admin_moderation_audit_legal_holds (
  audit_event_id uuid PRIMARY KEY
    REFERENCES public.admin_moderation_audit_events(id) ON DELETE CASCADE,
  legal_hold boolean NOT NULL DEFAULT false,
  legal_hold_reason text NULL,
  held_at timestamptz NULL,
  held_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  released_at timestamptz NULL,
  released_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  release_reason text NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_moderation_audit_legal_holds IS
  'DEC-021 admin moderation audit용 legal_hold 상태. audit row 자체는 UPDATE하지 않음.';

CREATE INDEX IF NOT EXISTS idx_admin_audit_legal_holds_active
  ON public.admin_moderation_audit_legal_holds (legal_hold)
  WHERE legal_hold = true;

ALTER TABLE public.admin_moderation_audit_legal_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_moderation_audit_legal_holds FROM PUBLIC;
REVOKE ALL ON public.admin_moderation_audit_legal_holds FROM anon;
REVOKE ALL ON public.admin_moderation_audit_legal_holds FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.admin_moderation_audit_legal_holds TO service_role;
REVOKE DELETE, TRUNCATE ON public.admin_moderation_audit_legal_holds FROM service_role;
REVOKE DELETE, TRUNCATE ON public.admin_moderation_audit_legal_holds FROM anon;
REVOKE DELETE, TRUNCATE ON public.admin_moderation_audit_legal_holds FROM authenticated;

-- Append-only operator log for HOLD_SET / HOLD_RELEASE (all allowed targets)
CREATE TABLE IF NOT EXISTS public.legal_hold_operator_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  actor_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_hold_operator_events_action_chk CHECK (
    action_type IN ('HOLD_SET', 'HOLD_RELEASE')
  ),
  CONSTRAINT legal_hold_operator_events_target_chk CHECK (
    target_type IN ('EVIDENCE', 'REPORT', 'SANCTION', 'RIGHTS_CASE', 'ADMIN_AUDIT')
  ),
  CONSTRAINT legal_hold_operator_events_reason_len_chk CHECK (
    char_length(reason) >= 1 AND char_length(reason) <= 500
  )
);

COMMENT ON TABLE public.legal_hold_operator_events IS
  'DEC-021 OWNER legal_hold 설정/해제 append-only 감사. 일반 회원 비공개.';

CREATE INDEX IF NOT EXISTS idx_legal_hold_operator_events_created
  ON public.legal_hold_operator_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_legal_hold_operator_events_target
  ON public.legal_hold_operator_events (target_type, target_id, created_at DESC);

ALTER TABLE public.legal_hold_operator_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legal_hold_operator_events FROM PUBLIC;
REVOKE ALL ON public.legal_hold_operator_events FROM anon;
REVOKE ALL ON public.legal_hold_operator_events FROM authenticated;
GRANT SELECT, INSERT ON public.legal_hold_operator_events TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON public.legal_hold_operator_events FROM service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON public.legal_hold_operator_events FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.legal_hold_operator_events FROM authenticated;

CREATE OR REPLACE FUNCTION public.legal_hold_operator_events_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'LEGAL_HOLD_EVENT_APPEND_ONLY';
END;
$$;

DROP TRIGGER IF EXISTS trg_legal_hold_operator_events_no_update
  ON public.legal_hold_operator_events;
CREATE TRIGGER trg_legal_hold_operator_events_no_update
BEFORE UPDATE ON public.legal_hold_operator_events
FOR EACH ROW EXECUTE PROCEDURE public.legal_hold_operator_events_block_mutation();

DROP TRIGGER IF EXISTS trg_legal_hold_operator_events_no_delete
  ON public.legal_hold_operator_events;
CREATE TRIGGER trg_legal_hold_operator_events_no_delete
BEFORE DELETE ON public.legal_hold_operator_events
FOR EACH ROW EXECUTE PROCEDURE public.legal_hold_operator_events_block_mutation();

-- Allow DELETE on admin audit only when controlled purge sets local GUC
CREATE OR REPLACE FUNCTION public.admin_moderation_audit_events_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('app.allow_admin_audit_purge', true) = '1' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ADMIN_AUDIT_APPEND_ONLY';
END;
$$;

-- Upsert audit legal hold (service_role path used by Node OWNER API)
CREATE OR REPLACE FUNCTION public.set_admin_moderation_audit_legal_hold(
  p_audit_event_id uuid,
  p_hold boolean,
  p_reason text,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
  v_row public.admin_moderation_audit_legal_holds;
  v_reason text := trim(coalesce(p_reason, ''));
BEGIN
  IF p_audit_event_id IS NULL THEN
    RAISE EXCEPTION 'ADMIN_AUDIT_EVENT_ID_REQUIRED';
  END IF;
  IF char_length(v_reason) < 1 THEN
    RAISE EXCEPTION 'LEGAL_HOLD_REASON_REQUIRED';
  END IF;
  IF char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'LEGAL_HOLD_REASON_TOO_LONG';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.admin_moderation_audit_events e WHERE e.id = p_audit_event_id
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'ADMIN_AUDIT_NOT_FOUND';
  END IF;

  SELECT * INTO v_row
  FROM public.admin_moderation_audit_legal_holds
  WHERE audit_event_id = p_audit_event_id;

  IF p_hold THEN
    IF v_row.audit_event_id IS NOT NULL AND v_row.legal_hold IS TRUE THEN
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'legal_hold', true,
        'legal_hold_reason', v_row.legal_hold_reason,
        'held_at', v_row.held_at,
        'released_at', v_row.released_at
      );
    END IF;
    INSERT INTO public.admin_moderation_audit_legal_holds AS h (
      audit_event_id,
      legal_hold,
      legal_hold_reason,
      held_at,
      held_by,
      released_at,
      released_by,
      release_reason,
      updated_at
    ) VALUES (
      p_audit_event_id,
      true,
      v_reason,
      now(),
      p_actor_user_id,
      NULL,
      NULL,
      NULL,
      now()
    )
    ON CONFLICT (audit_event_id) DO UPDATE SET
      legal_hold = true,
      legal_hold_reason = EXCLUDED.legal_hold_reason,
      held_at = now(),
      held_by = EXCLUDED.held_by,
      released_at = NULL,
      released_by = NULL,
      release_reason = NULL,
      updated_at = now()
    RETURNING * INTO v_row;
  ELSE
    IF v_row.audit_event_id IS NULL OR v_row.legal_hold IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'legal_hold', false,
        'legal_hold_reason', COALESCE(v_row.legal_hold_reason, NULL),
        'held_at', v_row.held_at,
        'released_at', v_row.released_at
      );
    END IF;
    UPDATE public.admin_moderation_audit_legal_holds
    SET legal_hold = false,
        release_reason = v_reason,
        released_at = now(),
        released_by = p_actor_user_id,
        updated_at = now()
    WHERE audit_event_id = p_audit_event_id
    RETURNING * INTO v_row;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'legal_hold', v_row.legal_hold,
    'legal_hold_reason', v_row.legal_hold_reason,
    'held_at', v_row.held_at,
    'released_at', v_row.released_at,
    'release_reason', v_row.release_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_admin_moderation_audit_legal_hold(uuid, boolean, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_admin_moderation_audit_legal_hold(uuid, boolean, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.set_admin_moderation_audit_legal_hold(uuid, boolean, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_moderation_audit_legal_hold(uuid, boolean, text, uuid) TO service_role;

-- Controlled purge: cutoff fixed inside DB (now() - 1 year). No client cutoff param.
CREATE OR REPLACE FUNCTION public.purge_expired_admin_moderation_audit_events()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  PERFORM set_config('app.allow_admin_audit_purge', '1', true);

  WITH doomed AS (
    SELECT e.id
    FROM public.admin_moderation_audit_events e
    LEFT JOIN public.admin_moderation_audit_legal_holds h
      ON h.audit_event_id = e.id
    WHERE e.created_at < (now() - interval '1 year')
      AND COALESCE(h.legal_hold, false) = false
      AND (
        h.released_at IS NULL
        OR h.released_at + interval '7 days' <= now()
      )
  ),
  deleted AS (
    DELETE FROM public.admin_moderation_audit_events e
    USING doomed d
    WHERE e.id = d.id
    RETURNING e.id
  )
  SELECT count(*)::integer INTO v_deleted FROM deleted;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_admin_moderation_audit_events() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_expired_admin_moderation_audit_events() FROM anon;
REVOKE ALL ON FUNCTION public.purge_expired_admin_moderation_audit_events() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_admin_moderation_audit_events() TO service_role;

COMMENT ON FUNCTION public.purge_expired_admin_moderation_audit_events() IS
  'DEC-020/021 controlled admin audit purge. created_at < now()-1y; active legal_hold excluded; release+7d grace. No arbitrary cutoff.';
