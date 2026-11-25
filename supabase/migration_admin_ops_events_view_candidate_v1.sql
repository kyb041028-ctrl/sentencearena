-- 문의 처리·공지 변경 기록을 한 곳에서 읽기 위한 조회 전용 뷰 (후보, 미적용).
-- 기존 admin_moderation_audit_events 의 제약(target_type: POST/COMMENT, 행동 종류 고정)과
-- 이벤트 종류는 건드리지 않습니다. 기존 기록을 지우거나 바꾸지 않습니다.
-- legal_hold 는 이 뷰에 연결되지 않습니다 (기존 legal_hold 표는 moderation 감사 행만 참조).
-- 선행 조건: migration_admin_inquiries_v1.sql, migration_admin_notices_v1.sql

CREATE OR REPLACE VIEW public.admin_ops_events_v AS
SELECT 'INQUIRY'::text AS target_type,
       inquiry_id AS target_id,
       event_type,
       actor_user_id,
       created_at
  FROM public.admin_inquiry_events
UNION ALL
SELECT 'NOTICE'::text AS target_type,
       notice_id AS target_id,
       event_type,
       actor_user_id,
       created_at
  FROM public.admin_notice_events;

REVOKE ALL ON public.admin_ops_events_v FROM anon, authenticated;
GRANT SELECT ON public.admin_ops_events_v TO service_role;
