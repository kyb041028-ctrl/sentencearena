-- SentenceArena admin moderation audit v1 (additive).
-- Append-only operator action log. Does not replace board_reports / sanctions / evidence.
-- No existing-row UPDATE/DELETE. No DROP TABLE / DROP COLUMN / TRUNCATE.
-- Political alignment / email / XP / Fame / post body snapshots are not stored.

CREATE TABLE IF NOT EXISTS public.admin_moderation_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  target_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  reason_code text NOT NULL,
  operator_note text NOT NULL DEFAULT '',
  sanction_id uuid NULL,
  report_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_moderation_audit_events_target_type_chk CHECK (
    target_type IN ('POST', 'COMMENT')
  ),
  CONSTRAINT admin_moderation_audit_events_note_len_chk CHECK (
    char_length(operator_note) <= 500
  )
);

COMMENT ON TABLE public.admin_moderation_audit_events IS
  'ADMIN/OWNER 직접조치 append-only 감사 로그. 신고/제재/증거 테이블과 분리. 게시글 본문·email·성향 미저장.';
COMMENT ON COLUMN public.admin_moderation_audit_events.actor_user_id IS
  '조치한 ADMIN/OWNER auth.users.id. 탈퇴 시 SET NULL.';
COMMENT ON COLUMN public.admin_moderation_audit_events.target_id IS
  '대상 게시글/댓글 ID. soft delete 후에도 유지. hard FK 없음.';
COMMENT ON COLUMN public.admin_moderation_audit_events.report_id IS
  '사용자 신고에서 시작된 경우에만. 관리자 직접 발견이면 NULL.';
COMMENT ON COLUMN public.admin_moderation_audit_events.sanction_id IS
  '관련 제재 식별자. 없으면 NULL. 기존 제재 테이블 hard FK 없음.';

CREATE INDEX IF NOT EXISTS idx_admin_moderation_audit_events_created
  ON public.admin_moderation_audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_moderation_audit_events_actor_created
  ON public.admin_moderation_audit_events (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_moderation_audit_events_action_created
  ON public.admin_moderation_audit_events (action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_moderation_audit_events_target
  ON public.admin_moderation_audit_events (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_admin_moderation_audit_events_target_user_created
  ON public.admin_moderation_audit_events (target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_moderation_audit_events_reason_created
  ON public.admin_moderation_audit_events (reason_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_moderation_audit_events_sanction
  ON public.admin_moderation_audit_events (sanction_id)
  WHERE sanction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admin_moderation_audit_events_report
  ON public.admin_moderation_audit_events (report_id)
  WHERE report_id IS NOT NULL;

ALTER TABLE public.admin_moderation_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_moderation_audit_events FROM PUBLIC;
REVOKE ALL ON public.admin_moderation_audit_events FROM anon;
REVOKE ALL ON public.admin_moderation_audit_events FROM authenticated;
GRANT SELECT, INSERT ON public.admin_moderation_audit_events TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON public.admin_moderation_audit_events FROM service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON public.admin_moderation_audit_events FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.admin_moderation_audit_events FROM authenticated;

CREATE OR REPLACE FUNCTION public.admin_moderation_audit_events_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ADMIN_AUDIT_APPEND_ONLY';
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_moderation_audit_events_no_update
  ON public.admin_moderation_audit_events;
CREATE TRIGGER trg_admin_moderation_audit_events_no_update
BEFORE UPDATE ON public.admin_moderation_audit_events
FOR EACH ROW EXECUTE PROCEDURE public.admin_moderation_audit_events_block_mutation();

DROP TRIGGER IF EXISTS trg_admin_moderation_audit_events_no_delete
  ON public.admin_moderation_audit_events;
CREATE TRIGGER trg_admin_moderation_audit_events_no_delete
BEFORE DELETE ON public.admin_moderation_audit_events
FOR EACH ROW EXECUTE PROCEDURE public.admin_moderation_audit_events_block_mutation();

CREATE OR REPLACE FUNCTION public.admin_insert_moderation_audit_event(
  p_actor_user_id uuid,
  p_action_type text,
  p_target_type text,
  p_target_id uuid,
  p_target_user_id uuid,
  p_reason_code text,
  p_operator_note text,
  p_sanction_id uuid DEFAULT NULL,
  p_report_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public.admin_moderation_audit_events;
BEGIN
  IF p_action_type NOT IN ('POST_SOFT_DELETE', 'POST_RESTORE', 'SANCTION_APPLIED') THEN
    RAISE EXCEPTION 'ADMIN_AUDIT_ACTION_TYPE_INVALID';
  END IF;
  IF p_target_type NOT IN ('POST', 'COMMENT') THEN
    RAISE EXCEPTION 'ADMIN_AUDIT_TARGET_TYPE_INVALID';
  END IF;

  INSERT INTO public.admin_moderation_audit_events (
    actor_user_id,
    action_type,
    target_type,
    target_id,
    target_user_id,
    reason_code,
    operator_note,
    sanction_id,
    report_id
  ) VALUES (
    p_actor_user_id,
    p_action_type,
    p_target_type,
    p_target_id,
    p_target_user_id,
    p_reason_code,
    COALESCE(p_operator_note, ''),
    p_sanction_id,
    p_report_id
  )
  RETURNING * INTO v_event;

  RETURN jsonb_build_object('audit', to_jsonb(v_event));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_operator_soft_delete_post_with_audit(
  p_post_id uuid,
  p_actor_user_id uuid,
  p_reason_code text,
  p_operator_note text,
  p_report_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post public.board_posts;
  v_event public.admin_moderation_audit_events;
BEGIN
  UPDATE public.board_posts
     SET status = 'DELETED',
         deleted_at = now(),
         deleted_by = p_actor_user_id,
         updated_at = now()
   WHERE id = p_post_id
   RETURNING * INTO v_post;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOARD_POST_NOT_FOUND';
  END IF;

  INSERT INTO public.admin_moderation_audit_events (
    actor_user_id,
    action_type,
    target_type,
    target_id,
    target_user_id,
    reason_code,
    operator_note,
    report_id
  ) VALUES (
    p_actor_user_id,
    'POST_SOFT_DELETE',
    'POST',
    v_post.id,
    v_post.author_user_id,
    p_reason_code,
    COALESCE(p_operator_note, ''),
    p_report_id
  )
  RETURNING * INTO v_event;

  RETURN jsonb_build_object('post', to_jsonb(v_post), 'audit', to_jsonb(v_event));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_operator_restore_post_with_audit(
  p_post_id uuid,
  p_actor_user_id uuid,
  p_reason_code text,
  p_operator_note text,
  p_report_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_post public.board_posts;
  v_event public.admin_moderation_audit_events;
BEGIN
  UPDATE public.board_posts
     SET status = 'ACTIVE',
         deleted_at = NULL,
         deleted_by = NULL,
         blind_reason = NULL,
         updated_at = now()
   WHERE id = p_post_id
   RETURNING * INTO v_post;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOARD_POST_NOT_FOUND';
  END IF;

  INSERT INTO public.admin_moderation_audit_events (
    actor_user_id,
    action_type,
    target_type,
    target_id,
    target_user_id,
    reason_code,
    operator_note,
    report_id
  ) VALUES (
    p_actor_user_id,
    'POST_RESTORE',
    'POST',
    v_post.id,
    v_post.author_user_id,
    p_reason_code,
    COALESCE(p_operator_note, ''),
    p_report_id
  )
  RETURNING * INTO v_event;

  RETURN jsonb_build_object('post', to_jsonb(v_post), 'audit', to_jsonb(v_event));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_insert_moderation_audit_event(uuid, text, text, uuid, uuid, text, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_insert_moderation_audit_event(uuid, text, text, uuid, uuid, text, text, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.admin_insert_moderation_audit_event(uuid, text, text, uuid, uuid, text, text, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_insert_moderation_audit_event(uuid, text, text, uuid, uuid, text, text, uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.admin_operator_soft_delete_post_with_audit(uuid, uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_operator_soft_delete_post_with_audit(uuid, uuid, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.admin_operator_soft_delete_post_with_audit(uuid, uuid, text, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_operator_soft_delete_post_with_audit(uuid, uuid, text, text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.admin_operator_restore_post_with_audit(uuid, uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_operator_restore_post_with_audit(uuid, uuid, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.admin_operator_restore_post_with_audit(uuid, uuid, text, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_operator_restore_post_with_audit(uuid, uuid, text, text, uuid) TO service_role;
