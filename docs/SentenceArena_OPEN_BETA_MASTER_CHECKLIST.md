# SentenceArena 오픈베타 마스터 체크리스트

> 마지막 업데이트: 2026-08-27 (정치성향 쌍방향 25% + 가속)

## 정치성향

- 기존 쌍방향 확인: PASS
- 작성자 0.7 / 1.0 / 1.3 적용: PASS (70 / 100 / 130)
- 반응자 25% 적용: PASS
- 반응자 하루 ±60 적용: PASS
- 전체 하루 ±240 유지: PASS
- 일관성 가속 적용: PASS (본인 actor-self만)
- 목표 영토 초입 가속 종료: PASS (±240)
- 중앙 통과 streak 유지: PASS
- 목표 영토 진입 streak 초기화: PASS
- 정치성향 스케줄러 OFF 유지: PASS (`POLITICAL_ALIGNMENT_SCHEDULER_ENABLED=false`)
- 기존 사용자 점수 소급 재계산: 없음

## Railway 마지막 정상 기준점

- 상태: PASS (읽기/문서만. 서버·DNS·env·OAuth·코드·DB 미변경)
- 기준점 문서: `docs/PRODUCTION_BASELINE_BEFORE_NAVER_CLOUD_MIGRATION.md`
- Git HEAD / origin/master / Production 배포 commit: 304ebcd (docs-only)
- 마지막 기능 commit: 04999b9
- Production deployment: 63ab24b4 SUCCESS ams
- 자동배포: ON (docs-only push도 배포됨)
- /health /ready: 200. board=true, evolution=true, daily_issue db, Alien=false
- 다음 작업: NAVER Cloud Korea 앱 서버 1회 이전

## Naver Production 후속

- 상태: 코드/Production PASS · Naver Developers 검수 PENDING
- 로그인: `ScAuth.login('naver')` → Supabase `custom:naver` → `/auth-v2/callback.html`
- userinfo: `https://sentencearena.com/api/auth/naver-userinfo` (HTTPS · Bearer 없으면 401)
- 코드/Railway 실행경로: tunnel·ngrok·trycloudflare·localhost callback 없음
- Railway Naver Client 비밀값: 없음(정상 · Supabase Custom OAuth에 보관)
- APP_PUBLIC_ORIGIN: https://sentencearena.com
- Naver Developers Callback(필수): `https://rlzltrwwamrgrfwlaqxj.supabase.co/auth/v1/callback`
- 서비스 URL(필수): `https://sentencearena.com` (또는 `sentencearena.com`)
- Supabase Redirect URLs에 앱 callback: `https://sentencearena.com/auth-v2/callback.html`
- 검수: PENDING (승인 대기. 임의 PASS 금지)
- 전용 공지 CMS / 회원 활동명 검색 / 관리자 통합 대시보드: 베타 이후

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

- 진영 전황 실제 데이터 연결 설계 검토
- Naver Developers 검수: PENDING 유지 (승인될 때까지 임의 PASS 금지)
- NAVER Cloud Korea 앱 서버 1회 이전 = 검수 PASS 후
- 이전 중 하지 않을 것: Alien ON, 정치성향/Daily Issue 아침 스케줄러 ON, 보류 기능 구현, Production DB 교체

## Level / XP

- 상태: Production PASS
- 게시글 +25 / 댓글 +12 / Daily Issue +10
- Level 1~10 · `user_progression` + events dedupe
- 외계 내부 활동: 일반 XP 지급 금지
- disposable 검증: 글 작성 → xp 0→25 · first-post grant · notified · cleanup 후 profiles 4

## Fame

- 상태: 코드/RPC PASS · 실이벤트는 오픈 후 관찰
- EMPATHY 수신 +1 · 자기공감/중복 방지
- 공감 취소 시 명성 회수: PASS (실제 EMPATHY 제거 1회만 -1 · 중복/동시 취소 안전)
- 외계 내부 Fame: 지급 금지 · 취소해도 Earth 명성 불변

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
