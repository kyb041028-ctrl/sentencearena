-- 서버 5xx 오류 집계 (후보, 미적용). 재시작해도 남도록 하루·경로·상태 단위로 횟수만 저장합니다.
-- 요청 본문, 쿼리 문자열, 토큰, IP, 사용자 식별자는 저장하지 않습니다.
-- 보관기간이 정해지기 전에는 서버 설정(ADMIN_ERROR_LOG_PERSIST)을 켜지 않습니다.
-- 행 수 상한(2000)은 애플리케이션 쓰기 구문에서 지킵니다. 자동 삭제는 만들지 않았습니다.

CREATE TABLE IF NOT EXISTS public.admin_api_error_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day date NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  status integer NOT NULL,
  occurrence_count integer NOT NULL DEFAULT 1,
  first_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now(),
  handling_status text NOT NULL DEFAULT 'NEW',
  CONSTRAINT admin_api_error_records_status_chk CHECK (status BETWEEN 500 AND 599),
  CONSTRAINT admin_api_error_records_handling_chk CHECK (handling_status IN ('NEW', 'CHECKED', 'IGNORED')),
  CONSTRAINT admin_api_error_records_path_len_chk CHECK (char_length(path) <= 160 AND char_length(method) <= 10),
  CONSTRAINT admin_api_error_records_uq UNIQUE (day, method, path, status)
);

CREATE INDEX IF NOT EXISTS idx_admin_api_error_records_last
  ON public.admin_api_error_records (last_at DESC);

ALTER TABLE public.admin_api_error_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_api_error_records FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.admin_api_error_records TO service_role;
