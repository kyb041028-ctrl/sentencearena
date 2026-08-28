-- =============================================================================
-- Additive: board_posts.faction_battle_enabled
-- Per-post faction battle (Pioneer/Central/Guardian). Default false.
-- CENTRAL/ALIEN UI only. Pioneer/Guardian general boards stay off in code.
-- Existing rows stay false. No TRUNCATE / DROP TABLE / DELETE FROM.
-- =============================================================================

ALTER TABLE public.board_posts
  ADD COLUMN IF NOT EXISTS faction_battle_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.board_posts.faction_battle_enabled IS
  'When true, this post shows live Pioneer/Central/Guardian battle from comments and active LIKE/DISLIKE. Default false. Not an arena-wide war.';
