-- SentenceArena: REPORT_REJECTED allow-list + admin hide status HIDDEN_BY_OPERATOR.
-- Additive only. No new table. No DROP TABLE/COLUMN. No TRUNCATE. No DELETE FROM.
-- Existing audit rows unchanged.

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
  IF p_action_type NOT IN (
    'POST_SOFT_DELETE',
    'POST_RESTORE',
    'COMMENT_SOFT_DELETE',
    'COMMENT_RESTORE',
    'SANCTION_APPLIED',
    'REPORT_REJECTED'
  ) THEN
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
     SET status = 'HIDDEN_BY_OPERATOR',
         blind_reason = 'OPERATOR_SANCTION',
         deleted_at = NULL,
         deleted_by = NULL,
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

CREATE OR REPLACE FUNCTION public.admin_operator_soft_delete_comment_with_audit(
  p_comment_id uuid,
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
  v_comment public.board_comments;
  v_event public.admin_moderation_audit_events;
BEGIN
  UPDATE public.board_comments
     SET status = 'HIDDEN_BY_OPERATOR',
         blind_reason = 'OPERATOR_SANCTION',
         deleted_at = NULL,
         deleted_by = NULL,
         updated_at = now()
   WHERE id = p_comment_id
   RETURNING * INTO v_comment;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOARD_COMMENT_NOT_FOUND';
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
    'COMMENT_SOFT_DELETE',
    'COMMENT',
    v_comment.id,
    v_comment.author_user_id,
    p_reason_code,
    COALESCE(p_operator_note, ''),
    p_report_id
  )
  RETURNING * INTO v_event;

  RETURN jsonb_build_object('comment', to_jsonb(v_comment), 'audit', to_jsonb(v_event));
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

REVOKE ALL ON FUNCTION public.admin_operator_soft_delete_comment_with_audit(uuid, uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_operator_soft_delete_comment_with_audit(uuid, uuid, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.admin_operator_soft_delete_comment_with_audit(uuid, uuid, text, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_operator_soft_delete_comment_with_audit(uuid, uuid, text, text, uuid) TO service_role;
