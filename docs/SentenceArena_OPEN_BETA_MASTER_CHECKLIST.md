# SentenceArena 오픈베타 마스터 체크리스트

> 마지막 업데이트: 2026-08-26 (운영자 중복 처리 방지)

## 관리자 권한

- 관리자 권한 원본: app_metadata.role only
- user_metadata.role: 관리자 판정 사용 금지
- 운영자 권한 상승 위험: 해결
- 비로그인 관리자 API → 401
- 일반회원 관리자 API → 403
- 실제 내부 오류 → 500 유지
- 관리자 오류 상태 정상화: PASS
- 이의제기 재결정 차단: PASS
- 동일 행동 수동 중복 제재 차단: PASS
- Production 운영자 핵심 안전장치: PASS
- 테스트: test-admin-role-app-metadata-only · test-admin-http-auth-status · test-operator-duplicate-decision-guard

## 운영자 영역 (오픈베타)

- 전용 공지 CMS: 베타 이후
- 회원 활동명 검색: 베타 이후
- 관리자 통합 대시보드: 베타 이후

## Production Mock / 임시 데이터

- 상태: Production 차단 수정 PASS (Guest 데모 유지)
- 로그인 회원 board: demo_/seed_ 혼합 제거 · 0건이면 빈 게시판
- 타인 profile: SC_PROFILE_DATA(Level12/fame3450/Mock 업적) clone 제거
- evolution API 실패: LEGACY_MOCK 820/3830/2480/310 미사용 · UNAVAILABLE
- faction battle MOCK: Production 실회원 숨김 · Guest는 체험용 표기
- 전체 명성 순위: Production 실회원 숨김 · Guest는 체험용 명성 예시
- 정치성향: 실회원 프로필에서 sc_political_scores_v1·34/33/33 기본 미표시(공식 score→레이더 변환 규칙 전까지)
- Guest ProfileFrame/board demo 유지
- 베타 이후: 진영 전황 실집계 · 서버 전체 명성 순위 · score→성향지도 공식 변환 · Activity HUD 서버 피드

## 다음 작업

- Naver Production 후속
  - 임시/tunnel URL 제거 여부 확인
  - Naver Developers 검수 마무리

## Level / XP

- 상태: Production PASS
- 게시글 +25 / 댓글 +12 / Daily Issue +10
- Level 1~10 · `user_progression` + events dedupe
- 외계 내부 활동: 일반 XP 지급 금지
- disposable 검증: 글 작성 → xp 0→25 · first-post grant · notified · cleanup 후 profiles 4

## Fame

- 상태: 코드/RPC PASS · 실이벤트는 오픈 후 관찰
- EMPATHY 수신 +1 · 자기공감/중복 방지
- 취소 회수: PENDING
- 외계 내부 Fame: 지급 금지

## Activity

- Profile COUNT (posts/comments/receivedLikes/discussions): PASS
- 월드 Activity HUD localStorage: 문구만 「최근 활동」으로 완화 (서버 실시간화는 베타 이후)

## 업적 (핵심 6)

- first-post: Production PASS (지급·조회·알림·notified)
- first-comment / first-empathy-received / territory-citizen: 코드 연결 PASS
- record-builder · conversation-bridge: 영구 1회
- Production: service_role SELECT + mark_user_achievement_notified 복구

## 베타 이후

- steady-footsteps
- empathy-from-many
- dialogue-across-territories
- witness-of-an-era
- 진영 전황 실데이터
- 서버 전체 명성 순위
- 정치성향 score → 성향지도 공식 표시

## beta-citizen

- 정책 확정: 오픈베타 기간 첫 실제 참여 1회 (글/댓글/Daily Issue 댓글)
- 로그인·가입·LIKE/DISLIKE/EMPATHY·열람만으로는 지급 금지
- 시작/종료 시각 미확정 → 코드 하드코딩 금지 · 지급 BLOCKED(미활성)

## 환경

- ALIEN_MODERATION_V1=false
- POLITICAL_ALIGNMENT_SCHEDULER_ENABLED=false
- DAILY_ISSUE_MORNING_SCHEDULER_ENABLED=false
- BOARD_OPERATIONAL=true
