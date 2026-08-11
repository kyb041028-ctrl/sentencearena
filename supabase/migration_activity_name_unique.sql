/*
================================================================================
마이그레이션: profiles.display_name case-insensitive UNIQUE (비어 있지 않은 값만)
================================================================================
【목적】
- SentenceArena 활동명 중복 금지 (대소문자만 다른 이름 포함)
- 빈 문자열('') 온보딩 미완료 프로필은 여러 행 허용 (partial index)

【안전】
- auth.users 구조 변경 없음
- 기존 행 삭제 없음
- 실제 중복이 있으면 더 나중에 만든 행에만 `_` + id 접두 4자를 붙여 유일화
================================================================================
*/

-- 1) 비어 있지 않은 display_name 의 대소문자 무시 중복 해소 (삭제 없음)
WITH ranked AS (
  SELECT
    id,
    display_name,
    ROW_NUMBER() OVER (
      PARTITION BY lower(display_name)
      ORDER BY created_at ASC NULLS LAST, id ASC
    ) AS rn
  FROM public.profiles
  WHERE btrim(COALESCE(display_name, '')) <> ''
)
UPDATE public.profiles p
SET
  display_name = left(
    regexp_replace(p.display_name, '[^가-힣A-Za-z0-9_-]', '', 'g'),
    greatest(1, 16 - 5)
  ) || '_' || left(replace(p.id::text, '-', ''), 4),
  updated_at = now()
FROM ranked r
WHERE p.id = r.id
  AND r.rn > 1;

-- 접미사 후에도 규칙 깨진 극소수 보정 (최대 16자 보장)
UPDATE public.profiles
SET display_name = left('시민_' || left(replace(id::text, '-', ''), 8), 16)
WHERE btrim(COALESCE(display_name, '')) <> ''
  AND (
    char_length(display_name) > 16
    OR display_name !~ '^[가-힣A-Za-z0-9_-]+$'
  );

-- 2) case-insensitive unique (empty 제외)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_display_name_ci_unique
  ON public.profiles (lower(display_name))
  WHERE btrim(display_name) <> '';

COMMENT ON INDEX public.profiles_display_name_ci_unique IS
  '활동명 case-insensitive UNIQUE. 빈 display_name(온보딩 미완료)은 제외.';
