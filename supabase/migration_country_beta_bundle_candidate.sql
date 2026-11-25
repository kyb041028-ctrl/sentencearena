-- Superseded marker. The single beta entry is supabase/migration_country_beta_apply.sql.
-- Do not apply this file as a second schema. It does not create tables and does not replace functions.

CREATE OR REPLACE FUNCTION public.country_beta_bundle_order()
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'use-migration-country-beta-apply'::text;
$$;

COMMENT ON FUNCTION public.country_beta_bundle_order() IS
  'Points at supabase/migration_country_beta_apply.sql. This file is not the apply entry.';
