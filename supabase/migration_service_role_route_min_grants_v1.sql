-- =============================================================================
-- Additive: service_role route minimum table privileges (dev apply tool only)
-- - whole-table privilege bundle 없음
-- - schema-wide privilege 없음
-- - row policy 변경 없음
-- - 데이터 삭제/테이블 제거 없음
-- - 반복 적용 안전
-- - production REQUIRED catalog 에 등록하지 않음
-- =============================================================================

-- Admin official create/list/load and operator hide/restore read-modify board_posts.
GRANT SELECT, INSERT, UPDATE ON TABLE public.board_posts TO service_role;

-- Empathy target load and operator comment hide. Member comment INSERT stays authenticated.
GRANT SELECT, UPDATE ON TABLE public.board_comments TO service_role;

-- Viewer reaction read after toggle. Toggle itself is SECURITY DEFINER.
GRANT SELECT ON TABLE public.board_reactions TO service_role;

-- Admin report list and review update. Member report INSERT stays authenticated.
GRANT SELECT, UPDATE ON TABLE public.board_reports TO service_role;

-- Territory, display name, citizenship, first-visit reads.
GRANT SELECT ON TABLE public.profiles TO service_role;

-- Legal signup completion and first-visit stamps only. territory is not writable here.
GRANT UPDATE (
  signup_completed_at,
  first_visit_guide_eligible_at,
  first_visit_guide_completed_at,
  central_plaza_hint_seen_at
) ON TABLE public.profiles TO service_role;

-- Alignment score read and sensitive-consent withdrawal. Score writes stay on the definer RPC.
GRANT SELECT, DELETE ON TABLE public.user_alignment_state TO service_role;
GRANT SELECT, DELETE ON TABLE public.alignment_history TO service_role;
GRANT SELECT, DELETE ON TABLE public.alignment_territory_history TO service_role;
