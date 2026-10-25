-- SentenceArena: withdrawal may null audit user references. Rows stay.
-- The original FKs are ON DELETE SET NULL, and actor_user_id is documented
-- as SET NULL on withdrawal. The append-only trigger rejected that UPDATE,
-- so auth user delete raised ADMIN_AUDIT_APPEND_ONLY.
-- This does not delete rows, edit action/reason/target/note/time columns,
-- change retention, or change DEC-021. Controlled purge still needs
-- app.allow_admin_audit_purge. Not in the production REQUIRED catalog.

CREATE OR REPLACE FUNCTION public.admin_moderation_audit_events_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  old_rest jsonb;
  new_rest jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.allow_admin_audit_purge', true) = '1' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'ADMIN_AUDIT_APPEND_ONLY';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    old_rest := to_jsonb(OLD) - 'actor_user_id' - 'target_user_id';
    new_rest := to_jsonb(NEW) - 'actor_user_id' - 'target_user_id';
    IF old_rest IS NOT DISTINCT FROM new_rest
       AND (
         NEW.actor_user_id IS NOT DISTINCT FROM OLD.actor_user_id
         OR NEW.actor_user_id IS NULL
       )
       AND (
         NEW.target_user_id IS NOT DISTINCT FROM OLD.target_user_id
         OR NEW.target_user_id IS NULL
       )
       AND (
         NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
         OR NEW.target_user_id IS DISTINCT FROM OLD.target_user_id
       )
    THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'ADMIN_AUDIT_APPEND_ONLY';
END;
$fn$;

COMMENT ON FUNCTION public.admin_moderation_audit_events_block_mutation() IS
  'Append-only. DELETE only when app.allow_admin_audit_purge=1. UPDATE only when actor_user_id and/or target_user_id become NULL and every other column is unchanged.';

CREATE OR REPLACE FUNCTION public.legal_hold_operator_events_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(OLD) - 'actor_user_id') IS NOT DISTINCT FROM (to_jsonb(NEW) - 'actor_user_id')
     AND NEW.actor_user_id IS NULL
     AND OLD.actor_user_id IS NOT NULL
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'LEGAL_HOLD_EVENT_APPEND_ONLY';
END;
$fn$;

COMMENT ON FUNCTION public.legal_hold_operator_events_block_mutation() IS
  'Append-only. UPDATE only when actor_user_id becomes NULL and every other column is unchanged. DELETE stays blocked.';
