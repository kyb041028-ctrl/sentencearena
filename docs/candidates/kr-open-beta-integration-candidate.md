# 한국 오픈베타 통합 후보

이 파일은 배포 후보 메모다. 출시 완료가 아니고, 운영 배포를 하지 않았다. master에 병합하지 않았다.

## 후보

- 브랜치: `cursor/map-layout-cards-bc3c`
- 이 브랜치는 `origin/master` `72573ac9f502f9a4b43f40560b03d3f6cd568b83` 를 포함한다.
- 한국 오픈베타에 이미 있던 가입, 게시판, 성장, 업적, 신고, 관리자, Daily Issue 코드는 master에 들어 있고 이 브랜치도 그 코드를 가진다.
- DEV에서 이미 PASS인 Daily Issue DB, 목록, 댓글, 반응은 다시 검증하지 않았다.
- 미국 활동지역, 미국 게시판, 미국 Daily Issue는 이 브랜치에 있으나 한국 오픈베타 필수 기능이 아니다. 해당 환경변수를 켜지 않으면 한국 경로를 바꾸지 않는다.

## 뉴스 수집, AI, 검수, 발행

- 기존 운영 정책을 유지한다. DEC-019의 아침 수집과 자동 발행 정책은 그대로다.
- 한국 AI 키가 없으면 우회하지 않고 막는다. 필요한 이름만: `DAILY_ISSUE_KR_AI_API_KEY`, 없으면 `DAILY_ISSUE_AI_API_KEY` 또는 `OPENAI_API_KEY`.
- 뉴스 RSS 수집 정책과 검수 후 발행 순서는 바꾸지 않았다.

## 아직 배포할 수 없는 이유

- Launch Finalization의 사업자 명칭, 대표자, 주소, 지원 메일, 개인정보 보호책임자, 시행일이 비어 있다. 값을 만들지 않았다.
- 공개 약관, 개인정보처리방침, 커뮤니티 정책 링크는 그 값이 정해지기 전에는 붙이지 않는다.
- 운영 DB에는 적용하지 않았다. 개발에서만 확인된 SQL은 `supabase/migration_service_role_route_min_grants_v1.sql`, `supabase/migration_audit_withdrawal_set_null_v1.sql` 이다. 운영에 두 번째 파일이 없으면 제재·감사 이력이 있는 계정의 탈퇴가 기존 트리거에서 실패할 수 있다.
- 이 브랜치의 운영 부팅은 `DAILY_ISSUE_REPOSITORY=db`, `DAILY_ISSUE_DB_SCHEMA=daily_issue`, Daily Issue pooler CA를 요구한다. 운영 스키마 적용과 서버 재가동은 하지 않았다.
