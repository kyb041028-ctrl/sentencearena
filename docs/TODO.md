# 센텐스아레나 — 작업 목록 (TODO)

> 마지막 업데이트: 2026-08-28 (원글 전황 반응 관계점수)

>
> **새 AI 세션:** `docs/AI_HANDOFF.md` — 구조·완료·TODO·성향 시스템 요약
>
> **상태 구분:** ✅ 완료 · 🔜 진행중/다음 · ⏸️ 보류

---

## ✅ 2026-08-28 — 원글 전황 LIKE/DISLIKE 관계점수

- [x] 같은 진영 LIKE +0.8 / DISLIKE −1.2. 다른 진영 LIKE +1.2 / DISLIKE −0.8. 작성자 진영에 귀속
- [x] 댓글 +1/−1 · 참여자 중복 제거 · 활성만 · EMPATHY 제외 유지
- [x] ALIEN 원글 Earth 원소속 저장 없음 → 원글 관계점수만 생략. 추측 없음

## ✅ 2026-08-28 — 게시글별 진영 전황 실제 자료 연결

- [x] 가짜/Mock 전황을 실회원 화면에 넣지 않음. CENTRAL/ALIEN + 글별 ON만 실 LIVE
- [x] 활성 댓글/대댓글/LIKE/DISLIKE. EMPATHY 제외. 삭제·취소 제외. 사람 기준 중복 제거
- [x] 행동 당시 영토. Alien 4진영 아님. 정치성향/명성 코드 미수정
- [x] `board_posts.faction_battle_enabled` 저장. 작성 화면 진영 토론 토글 재사용
- [x] 원글 반응은 작성자 진영 관계점수. 댓글 반응 LIKE +1 / DISLIKE −1
- [x] 비회원 중앙광장 실전황 열람. 깃발/막대/우세 임계값 유지
- [x] 원글 LIKE/DISLIKE 관계 점수 연결 (작성자 진영 0.8/1.2)

## ✅ 2026-08-28 — CENTRAL 자기행동 0 버그 수정

- [x] Production 추적: actor-self가 author-received(CENTRAL gradual)에 종속 → score 0 자기행동 0
- [x] 최소 수정: 자기행동은 SSOT 70/100/130의 25%. 작성자 주입 gradual 유지
- [x] CENTRAL score 0 LIKE GUARDIAN/PIONEER 누적 테스트 + Production/시뮬 동일 입력 일치
- [x] 동일 seed 시뮬 재실행. 고활동 오배치 99일 성공 개선. 스케줄러 OFF
- [ ] 정치성향 자동 이동 스케줄러 ON = 별도 결정

## ✅ 2026-08-28 — 반응자 self cap 단계화 오프라인 시뮬 (운영 미적용)

- [x] MODEL A/B/C-약/C-기본/C-강 동일 seed 10개 · 180일 비교
- [x] 목표 초입 ±240 즉시 60+1.0 복귀 · 애매 사용자 확대 없음 · 받은 반응만으로는 streak 0 확인
- [x] 전체 ±240 · 7일 쌍 120 유지. Production 정치성향 코드/DB/commit 없음
- [ ] 60→70→80→90 운영 적용 = 하지 않음 (시뮬 결과 약함). 사용자 확정 전 Production 추가 수정 금지
- [ ] 99일/30일 50/50 · CENTRAL deadzone 40 · EXIT ±360 추가 검토 = 별도

## ✅ 2026-08-27 — 정치성향 쌍방향 강도 + 일관성 가속

- [x] 기존 쌍방향 유지. 작성자 70/100/130. 반응자 25% + 하루 ±60. 전체 ±240 유지
- [x] 일관성 가속(본인 actor-self만). ±240 초입 종료. 목표 영토 내부 가속 없음. 중앙 통과 streak 유지
- [x] 기존 회원 streak 0. 점수 소급 재계산 없음. 스케줄러 OFF 유지
- [x] `node tools/test-political-alignment-bidirectional-v2.js` + 기존 alignment 회귀
- [ ] 정치성향 자동 이동 스케줄러 ON = 별도 결정

## ✅ 2026-08-27 — 공감 취소 시 명성 회수

- [x] 기존 EMPATHY_RECEIVED event가 실제로 제거된 1회만 작성자 명성 -1
- [x] 중복/없는 상태/동시 취소 → 추가 감소 없음. 재공감 시 다시 +1
- [x] 게시글·댓글·대댓글(동일 board_comments) 경로. 자기 공감 ±0. LIKE/DISLIKE 명성 없음
- [x] Alien 내부 Earth 명성 불변. first-empathy-received 유지. XP/Level 불변. 새 테이블 없음
- [x] `node tools/test-empathy-fame-revoke.js`
- [x] 진영 전황 실제 데이터 연결

## ✅ 2026-08-26 — Naver Production 후속 감사

- [x] 코드/Production 임시·tunnel 주소 감사 (실행경로 깨끗)
- [x] 실제 redirect_uri / userinfo / 앱 callback 확정
- [ ] Naver Developers Callback/서비스 URL 확인·임시값 제거 · 사전 검수 신청 = 사용자
- [ ] Railway 마지막 정상 기준점 기록 = 검수 PASS 후 다음

## ✅ 2026-08-26 — 운영자 중복 처리 방지

- [x] 이의제기 재결정 서버 차단 (SUBMITTED만 · 409 APPEAL_ALREADY_DECIDED · 동시 1승)
- [x] 동일 behaviorKey 수동 제재 중복 차단 (409)
- [x] 자동 제재 사다리 회귀 유지

## ✅ 2026-08-26 — 관리자 API 인증 실패 401/403 통일

- [x] createAdminAccessGuard 인증 실패 → 401 · 역할 부족 → 403 (전역 500 오인 제거)
- [x] moderation / rights / retention / alien admin · Daily Issue 회귀
- [x] 실제 서버 오류 500 유지 · Alien V1 OFF 503 유지
- [x] 이의제기 재처리 + 수동 중복 제재 방지

## ✅ 2026-08-26 — 관리자 역할 app_metadata.role only

- [x] `resolveUserRole`에서 user_metadata / 대체 필드 제거 · app_metadata.role만
- [x] user_metadata ADMIN/OWNER 권한상승 차단 테스트
- [x] Production 관리자 app_metadata.role 확인 후 배포
- [x] 관리자 API 인증 실패 401/403 정상화
- [ ] 이의제기/수동제재 중복 처리 방지 = 다음

## ✅ 2026-08-26 — Production Mock / 임시데이터 노출 차단

- [x] 실회원 board demo_/seed_ 혼합 제거 · Guest demo 유지
- [x] 타인 profile SC_PROFILE_DATA Mock 잔류 제거
- [x] evolution API 실패 LEGACY_MOCK 제거
- [x] faction battle MOCK 실회원 숨김
- [x] 전체 명성 순위 실회원 숨김 · Guest 체험용
- [x] 정치성향 localStorage/34·33·33 실회원 미표시
- [x] Production 운영자 화면 / 운영 흐름 최종감사 (감사만 · 수정은 role 보안부터)
- [x] 진영 전황 실집계 (게시글별 LIVE)
- [ ] 서버 전체 명성 순위 = 베타 이후
- [ ] score→성향지도 공식 변환 = 베타 이후

## ✅ 2026-08-26 — 업적 Production 연결 보완

- [x] service_role SELECT + mark_user_achievement_notified Production 복구
- [x] record-builder / conversation-bridge 영구 1회
- [x] 외계 내부 일반 XP/Fame/Earth 업적 차단
- [x] empathy newlyGranted · Daily Issue territory-citizen
- [x] beta-citizen 정책 확정·BLOCKED(날짜 확정 후 활성화)
- [ ] steady-footsteps / empathy-from-many / dialogue / witness = 베타 이후
- [ ] beta-citizen 오픈베타 시작시각 확정 후 활성화

## ✅ 2026-08-26 — 외계행성 운영 연결 보완 (V1 OFF 유지)

- [x] board alienAccess Production 경로 연결. Earth 글/댓글/반응/EMPATHY/수정 서버 차단. 본인 삭제 유지. 신고·권리보호 유지
- [x] 관측 V1 연동. CENTRAL 읽기 · PIONEER/GUARDIAN Stage1 읽기 · Stage2+ 차단 · 관측 쓰기 금지
- [x] Daily Issue 외계 읽기만(댓글/반응 서버 거부)
- [x] 4회차 OPERATOR_REVIEW(30일+운영자 복귀). 1~3회 lazy auto-return. 영구정지 우선. population cache 무효화
- [x] 관리자 force return UI/이력. ALIEN_TRANSFER 이의제기
- [x] `migration_alien_operator_review_v1` Production 적용. profiles 4 불변
- [x] 자동 테스트 `tools/test-alien-production-wiring.js` + 기존 alien/제재 회귀
- [ ] Production `ALIEN_MODERATION_V1=true` 활성화 = 별도 최종 재감사 후 결정
- [ ] 외계 내부 커뮤니티(자유광장 등) 기능 확대 = 별도 작업
- [ ] 시즌 시스템 완성 후 4회차 SEASON_END 재검토

## ✅ 2026-08-22 — 일반 신고 허위정보(misinfo) 보강

- [x] misinfo 선택 시 안내 + 정확한 표현/이유/근거/기관확인 필수. 서버 검증
- [x] 의견·평가·예측·풍자·사소한 오류 자동 허위정보 확정 없음. 접수만으로 삭제/제재/Alien 없음
- [x] 운영자 판단: 근거 부족/해당 없음/추가 확인/허위조작 확인. 기존 신고 상태 재사용
- [x] 허위정보 신고 악용만 경고→30일→6개월. 일반 신고·권리침해 유지. 이의제기
- [x] 자동 테스트: `node tools/test-misinfo-report.js` 48. Production `migration_misinfo_report_v1` 적용. profiles 4 불변. commit `c8d2908` + Railway production Online. disposable 검증 후 정리
- [ ] 이용약관/운영정책 페이지 문구 = 구현과 재대조 후 작성

## ⏸️ 2026-08-22 — 비회원 권리침해 이메일 확인 (코드 준비, Production 중단)

- [x] 비회원: 이메일 입력 → 인증번호 발송 → 확인 → 인증 완료 후에만 제출
- [x] 회원: 추가 이메일 인증 없음. 기존 신청서 필수항목 유지
- [x] 6자리 HMAC 저장, 10분, 5회 실패 폐기, 60초 재발송 제한, 제출 시 이메일 일치 서버 확인
- [x] 인증 성공 ≠ 사실 확인. 자동 정식전환/게시중단/제재 없음. 중복방지·악용제재 유지
- [x] 자동 테스트: `node tools/test-rights-email-verify.js`
- [ ] 실제 이메일 발송 수단 연결 (기존 발송 기능 없음. 외부업체 임의 가입 금지)
- [ ] Production 적용은 발송 수단 + 실제 수신 검증 후에만
- [ ] 실제 파일 첨부 증빙 = 향후 안전 저장 작업(악성코드 검사·접근권한·보관·삭제 포함)
- [ ] 이용약관/개인정보처리방침 페이지 문구 = 구현과 재대조 후 작성

## ✅ 2026-08-22 — 권리침해 처리 요청 1차 (일반 신고와 분리)

- [x] 게시글/댓글 신고 메뉴에서 일반 신고와 권리침해 처리 요청 분리
- [x] 독립 신청 화면 `/rights-infringement/` (비회원·삭제된 게시물 주소 직접 입력 가능)
- [x] 필수 구체정보 서버 검증. 종류별 추가항목. 최종 확인 체크 기본 OFF
- [x] 접수 → 보완/반려/정식 사건 전환. 접수만으로 삭제·제재 없음
- [x] 정식 사건 임시 게시중단 최대 30일 + 작성자 30일 이의제기 (신청자 개인정보 비공개)
- [x] 악용은 운영자 확인 후 경고/30일/6개월 제한. 중대한 악용은 기존 제재 검토. 자동 영구정지 없음
- [x] 정식 사건 5년, 비정식 접수 1년, legal_hold 유지. 삭제 콘텐츠 증거는 운영자만 연결
- [x] 자동 테스트: `node tools/test-rights-infringement.js`
- [x] Production `migration_rights_infringement_v1` apply (rlzltrwwamrgrfwlaqxj, profiles 4 불변)
- [x] Railway Production 배포 + /health /ready
- [x] disposable 접수→전환→임시중단→이의제기→완료 검증 후 테스트 사건 0
- [ ] 실제 파일 첨부 증빙 = 향후 안전 저장 작업
- [x] 비회원 이메일 확인 코드 준비. Production은 발송 수단 없어 중단
- [ ] 이용약관/개인정보처리방침 페이지 문구 = 구현과 재대조 후 작성

## ✅ 2026-08-21 — 기존 회원 판별을 가입완료 기록으로 고정

- [x] `profiles.signup_completed_at` 추가. 기본 NULL. 소셜 프로필 자동생성과 분리
- [x] 신규는 법적 기록 저장 성공 후에만 기록. 로그인 판별은 이 값만 사용
- [x] Production 확정 기존 회원 4명 1회 백필. 미완료 auth 제외 0
- [x] 회원탈퇴 시 auth CASCADE로 함께 삭제. 첫 화면/OAuth/성향 미변경

## ✅ 2026-08-21 — 로그인과 회원가입 흐름 분리

- [x] 첫 화면: 로그인 / 회원가입 / 게스트
- [x] 로그인은 법적 화면 없이 소셜 인증. 완료 회원은 바로 앱. 미완료 기존 회원은 로그인 후 법적 확인
- [x] 회원가입만 연령→민감정보→OAuth. 로그인 우회 신규는 READY 차단 후 가입 안내
- [x] auth.js / 정책 버전 / 서버 법적 보호 미변경. 애매하면 auth 사용자 삭제 없음

## ✅ 2026-08-21 — 가입 법적 확인 화면 순서를 로그인 선택 이후로

- [x] 최초 접속은 메인 로그인 화면. 생년월일/민감정보 자동 표시 제거
- [x] Google/Kakao/Naver 클릭 → 연령 → 민감정보 동의 → 선택 provider OAuth
- [x] Guest는 법적 게이트 없음. 취소 시 로그인 복귀
- [x] 서버 법적 보호·정책 버전·auth.js 미변경

## ✅ 2026-08-21 — 삭제 콘텐츠·신고·제재 최소 기록 보관정책

- [x] 사용자 삭제 게시글/댓글: 화면 즉시 제거 + `deleted_content_evidence` 6개월
- [x] 탈퇴해도 삭제 증거 유지. 일반 개인정보/성향/XP는 기존 탈퇴 정책
- [x] 일반 신고 최종 처리(ACCEPTED/REJECTED/RESOLVED) 후 1년
- [x] 일반 제재 종료 후 1년. 영구정지는 계정 유지 중 유지
- [x] 영구정지 탈퇴만 HMAC 재가입 방지 최소정보 1년. 일반 탈퇴자 블랙리스트 없음
- [x] 권리침해 전용 시스템은 1차 구현 (`rights_infringement_*`, 일반 신고와 분리)
- [x] legal_hold 최소 구조. Node 스케줄러 자동삭제. 소급 생성 없음
- [x] Production `migration_retention_policy_v1` apply (rlzltrwwamrgrfwlaqxj, 소급 없음)
- [x] Railway Production 배포 + /health /ready
- [x] disposable 삭제→증거→탈퇴, 영구정지 탈퇴 HMAC 검증 후 테스트 row 0
- [x] 정식 권리침해 신고센터 1차 완료. 파일 첨부는 향후. 비회원 이메일 확인은 코드 준비·발송수단 없어 Production 미적용
- [ ] 재가입 차단을 로그인/가입 게이트에 연결 = 개인정보/법적 검토 후

## ✅ 2026-08-21 — 외계행성 안내를 실제 이동 결과와 맞춤

- [x] V1=false + 일반 위반 3회: 조건 계산 유지, 이동 완료 문구 제거
- [x] 실제 이동 성공 시에만 "외계행성으로 이동되었습니다"
- [x] 비로그인 400은 게스트 로컬 보드 정책. 공개 API 읽기 정책 변경 없음
- [ ] 다음 실제 공개 Daily Issue에서 제재 상태 댓글/반응 차단 1회 확인
- [ ] Production Alien V1 활성화 = 별도 최종 검증 후

## ✅ 2026-08-20 — 실제 제재 사다리 연결

- [x] 확정 위반 행동에 경고/최종경고/외계행성/작성제한/계정제한/임시중지/영구정지 연결
- [x] 서버에서 게시글·댓글·반응·Daily Issue 쓰기 차단. 법적 게이트와 독립. 탈퇴 예외
- [x] 외계행성 글/댓글 신고(기존 board_reports). spam은 외계행성 금지
- [x] 7일/30일/영구정지 이의신청. 정치성향은 제재 기록에 저장하지 않음
- [x] Production `migration_user_sanctions_v1` apply (기존 사용자 자동 제재 없음, Alien V1 OFF 유지, PRODUCTION PASS)
- [ ] Production Alien V1 활성화 = 별도 최종 검증 후
- [x] 영구정지 탈퇴 재가입 방지 최소정보 1년 보관 (가입 게이트 연결은 향후)
- [x] 권리침해 전용 처리 체계 1차 완료 (일반 신고와 분리)

## ✅ 2026-08-20 — 관리자 신고 검토 분리 · 확정 위반 행동 계산

- [x] 관리자 신고 목록/상세/검토를 `ALIEN_MODERATION_V1`과 분리
- [x] 같은 게시글/댓글 다중 신고를 행동 1건으로 묶음. 위반 인정 시에만 확정 위반 1회
- [x] spam=서비스 훼손(외계행 누적 제외). misinfo/privacy/other=자동 누적 제외
- [x] 계정 정지/영구정지/작성제한 = 제재 사다리 연결
- [x] 권리침해 전용 처리 체계 1차 완료 (일반 신고와 분리)
- [x] 신고/분쟁 법적 보존기간 = RETENTION POLICY V1 + 권리침해 1차 (일반 1년, 비정식 1년, 정식 5년)

## ✅ 2026-08-20 — 일반 사용자 신고 응답에서 내부 회원 고유번호 제거

- [x] `POST /api/board/reports` 회원 응답에서 targetAuthorUserId / reporterUserId / reviewedBy 제거
- [x] 익명 글·일반 글·댓글 신고 응답 검증. DB 저장·관리자 listReports 유지
- [x] 신고/분쟁 법적 보존기간 = RETENTION POLICY V1 (일반 1년, 권리침해 5년은 정책만)

## ✅ 2026-08-20 — 가입 법적 게이트 (만 14세 + 민감정보 별도 동의)

- [x] 만 14세 이상 확인 (생년월일 입력, 만 나이, DOB 미저장)
- [x] 정치성향 민감정보 별도 동의 (sensitive-political-v1)
- [x] 정치성향 프로필 공개/비공개 (기본 비공개). 영토 공개 멤버십은 유지
- [x] 기존 회원 자동 동의 없음. consent 없으면 다음 로그인 시 게이트
- [x] Production 서버에서 미완료 시 보드 쓰기·Daily Issue 반응/댓글·성향 apply 차단
- [x] Production DB에 `migration_legal_gate_v1.sql` apply (배포 전 필수)
- [x] Production Chrome OAuth 실가입 검증 (배포 후)
- [x] 신고/분쟁 법적 보존기간 = RETENTION POLICY V1 (일반 1년, 권리침해 5년은 정책만)
- [ ] 재가입/제재회피 방지 보유정책 = 향후 확정
- [ ] NAVER Cloud 국내 Production 이전
- [ ] 개척/중앙/수호 → 진보/중도/보수 표시명 변경 (보류, 이번 범위 아님)

## ✅ 2026-08-19 — 회원탈퇴 self-service Production PASS

- [x] 회원탈퇴 self-service 구현 (POST `/api/me/withdraw`, 안내 UI, 체크 후 탈퇴)
- [x] 공개 콘텐츠 익명화 정책: 게시글/게시판 댓글/대댓글/Daily Issue 댓글 본문 유지, 작성자 링크 제거, 표시명 "탈퇴한 사용자"
- [x] 탈퇴 audit 정책: `account_withdrawal_audit` 비식별 완료 기록만. 원 user_id/email/OAuth/성향/IP/토큰 미보관
- [x] Production public+daily_issue withdrawal migration apply (`rlzltrwwamrgrfwlaqxj`)
- [x] Production disposable 계정으로만 Auth delete 실검증 (sentencearena@gmail.com / young938410@gmail.com 탈퇴 금지)
- [x] 신고/분쟁 법적 보존기간 = RETENTION POLICY V1 (일반 1년, 권리침해 5년은 정책만) (법령명·근거·항목·목적·기간 확정 전 별도 탈퇴회원 개인정보 DB 금지)
- [x] 영구정지 탈퇴 재가입 방지 최소정보 1년 보관 (가입 게이트 연결은 향후)
- [x] 민감정보 동의 구현
- [x] 만 14세 이상 확인 구현
- [ ] NAVER Cloud 국내 Production 이전

## ✅ 2026-08-19 — DAILY ISSUE 공개 댓글

- [x] 전용 `daily_issue_comments` (PK FK = review_items.id). 게시판 댓글 테이블 미사용
- [x] GET/POST/DELETE public API. Guest 읽기 · 로그인 작성 · 본인 삭제
- [x] 상세 본문 즉시 렌더 유지. 댓글 비동기 hydrate
- [x] Production Chrome 로그인 작성/삭제 검증. 테스트 댓글 최종 삭제. XP +10 이벤트 확인

## ✅ 2026-08-19 — DAILY ISSUE 공개 상세 클릭 지연

- [x] Production Chrome 측정: 병목은 GET /api/daily-issues/:id TTFB (cold ~2.3s, warm ~0.76s). 목록 payload에 상세 본문 이미 포함
- [x] Guest 클릭 즉시 목록 데이터로 상세 렌더. 로그인만 viewerReaction hydrate
- [x] public detail getById 1 query + actor Promise.all. 수집/검수/게시/댓글 미변경

## ✅ 2026-08-19 — ALIEN EVOLUTION MOCK 310 운영 차단

- [x] API_OPERATIONAL에서 Alien Mock 310 fallback 제거 (adapter/service/frontend hydrate)
- [x] 인구 count는 공개 profiles-readable 서버 client 우선
- [x] Alien 0 → 1단계 문명탄생. Earth 합산 규칙 유지
- [x] Production 배포 후 sentencearena.com 재확인: Alien 0명 / 1단계 문명탄생 / OPERATIONAL_USER_DATA. Mock 310 미재등장

## ✅ 2026-08-18 — POST-LOGIN TRANSITION 1차

- [x] 접속중입니다.. (`html.sc-auth-checking` + `#auth-boot-status`) 인증 판정 전 표시
- [x] `/api/me/profile` inflight 재사용 · Daily Issue 부트 중복 refresh 억제
- [ ] 2차: index.html 대형 스크립트/전체 reload 병목

## ✅ 2026-08-18 — NODE 22 PRODUCTION RUNTIME FIX

- [x] production engines/nixpacks Node 20 → Node 22
- [x] ws polyfill / Supabase transport 미추가. native WebSocket 사용
- [ ] Railway 배포는 master push 후 자동. 대시보드 직접 제어 없음

## ✅ 2026-08-17 — OPEN BETA BLOCKER 작업정리 (1–3)

- [x] #1 board alignment snapshot 실데이터 (`user_alignment_state.score`)
- [x] #2 production 배포 기초 (origin/flags/health, Deploy 미실행)
- [x] #3 Production DB migration 분류·순서·dry-run runner (apply 미실행)
- [ ] Production DB apply · Railway Deploy · scheduler ON 은 별도

## ✅ 2026-08-17 — PRODUCTION DB MIGRATION PREP

- [x] supabase migration 전수 분류 (REQUIRED / OPTIONAL_LATER / DO_NOT_APPLY)
- [x] public 적용 순서 확정 + Daily Issue `daily_issue` rewrite 전략 (dev SQL 파일 하드코딩 유지)
- [x] destructive/idempotency static scan. public check/dry-run runner. DI runner에 alignment_seed 포함
- [x] Production apply 미실행. credential 없으면 NOT_CONFIGURED

## 🔜 NEXT — Production DB apply (credential 확보 후)

1. [ ] Production Supabase `DAILY_ISSUE_DATABASE_URL` + project ref 설정
2. [ ] `node tools/run-production-public-migrate.js` check → dry-run → apply → verify
3. [ ] `node tools/run-daily-issue-production-migrate.js` check → dry-run → apply → verify (`DAILY_ISSUE_DB_SCHEMA=daily_issue`)
4. [ ] confirm env 적용 후 즉시 제거. scheduler/alien flag는 별도 ON

## ✅ 2026-08-17 — PRODUCTION DEPLOYMENT FOUNDATION

- [x] Node 22 · npm start · 0.0.0.0/PORT · /health · /ready · Railway/Nixpacks 유지
- [x] APP_PUBLIC_ORIGIN=https://sentencearena.com · production CORS allowlist · boot fail-fast
- [x] 첫 배포 flags: board/territory ON · political/alien/DI morning scheduler OFF
- [x] secret scan · production-mode listen 검증. Railway Deploy/DNS/production DB 미실행

## ✅ 2026-08-17 — BOARD ALIGNMENT SCORE SNAPSHOT REAL DATA

- [x] canonical adapter `getUserAlignmentScore` → `user_alignment_state.score`
- [x] LIKE/DISLIKE 생성 시 actor/author snapshot 실제값. missing row=0. DB 오류 fail-closed
- [x] snapshot 불변 · 취소 제외 · EMPATHY 비대상 · 공식/cap 회귀 · dev DB + browser PASS

## 🔜 NEXT — Daily Issue alignment seed 이후

1. [x] Cursor 최종 검증: admin Alignment 저장 · public 추천/비추천 · 내부 성향 비노출
2. [x] Daily Issue seed checkpoint commit/push
3. [ ] production scheduler 활성화는 별도 결정 (`POLITICAL_ALIGNMENT_SCHEDULER_ENABLED` 기본 OFF)
4. [ ] consistency / unique-author / cluster 방어는 베타 데이터 후 튜닝
5. [x] ALIEN 발전 인원 = citizenship_status KANTAPBIYA_RESIDENT (territory에 ALIEN 저장 금지 유지)
6. [ ] `ALIEN_MODERATION_V1` production 활성화는 별도 결정 (기본 OFF)

## ✅ 2026-08-17 — 외계행 moderation development 활성화

- [x] development 기본 ON · production unset OFF
- [x] development DB persist 연결 (moderation state/events/notifications + citizenship)
- [x] 실DB SIMPLE 1/2/3 · OTHER admin IMMEDIATE_ALIEN · 복귀 clock · 인원/HUD · browser

## ✅ 2026-08-17 — 외계행 moderation V1

- [x] 단순신고 1/2/3 · 기타신고 admin IMMEDIATE_ALIEN · citizenship KANTAPBIYA_RESIDENT
- [x] 경고 알림 1회 · trip 7/15/30/SEASON_END · cycle reset · Earth territory 보존
- [x] ALIEN live count · Earth에서 외계 제외 · browser automation

## ✅ 2026-08-17 — 영토 발전 Earth 실인원 연결

- [x] PIONEER/GUARDIAN = profiles.territory count, CENTRAL = C+P+G, ALIEN은 citizenship live count로 후속 연결
- [x] GET /api/territories/evolution 재사용 · 개발 활성 · production 기본 비활성
- [x] hover hydrate 1회 + 30s cache · hover마다 DB count 없음

## ✅ 2026-08-17 — BETA DAILY ISSUE ALIGNMENT SEED V1 (checkpoint)

- [x] 실제 수집 Daily Issue → 기존 품질/신선도/중복/검수 → 내부 alignment_direction → 그대로 발행
- [x] P/G/NEUTRAL은 metadata. quota/balance/synthetic 반대 이슈 없음
- [x] LIKE/DISLIKE canonical persistence · 반응 시점 snapshot · public 비노출
- [x] PIONEER ±60 · GUARDIAN 반대 · NEUTRAL 0 · DI daily ±180 · community ±240 별개 · 99/30 · batch ±500
- [x] admin 내부 Alignment 선택. 4지선다/stance 복원 없음
- [x] Cursor browser/HTTP/regression 최종 검증 후 checkpoint commit

## 🔜 NEXT — community alignment checkpoint 이후

1. [x] Chrome community/territory 확인: 사용자 "별다른 이상 없음"
2. [x] Daily Issue LIKE/DISLIKE seed 연결 (option/directAnswers 없이 ACTIVE_SEED)
3. [ ] production scheduler 활성화는 별도 결정 (`POLITICAL_ALIGNMENT_SCHEDULER_ENABLED` 기본 OFF)
4. [ ] consistency / unique-author / cluster 방어는 베타 데이터 후 튜닝

## ✅ 2026-08-17 — community alignment / territory checkpoint (전체 V1 완료 아님)

- [x] ACTOR_SELF + AUTHOR_RECEIVED + 80/120 + CENTRAL gradual deadzone40/full200
- [x] pair 7d 120 · community daily ±240 · 99/30 50/50 · batch ±500
- [x] EXIT ±360 · RETURN ±160 · 2 consecutive · stay 48h · 직접 P/G 없음 · Alien 제외
- [x] reaction score snapshot additive · pending territory additive · territory history
- [x] persist `TERRITORY_MOVE = SERVER_INTERNAL_BATCH` · scheduler READY_DISABLED
- [x] Daily Issue canonical 입력 BLOCKED_BY_CONTENT_SCHEMA / NOT_CONNECTED (option 없음, 질문 미생성)
- [x] Chrome community 경로 확인 "별다른 이상 없음"
- [x] auth/OAuth/.cursor/rules 미변경

## ⏸️ 점진 전파 시뮬 (오프라인 유지)

1. [x] 현재 canonical SSOT 조사 (80/120 · actor vs author · Daily Issue 미연결)
2. [x] offline gradual simulator (5000명 · BASELINE/CANDIDATE/FAST · abuse)
3. [x] FAST 1–4일 후보 시뮬 (EXIT 300/360/420 · consistency · DI · cluster 방어)
4. [ ] DI 점화는 content schema 이후
5. [ ] 5/10계정 cluster 추가 방어는 베타 후
6. [ ] production scheduler 활성화는 별도 결정

`TERRITORY_MOVE = SERVER_INTERNAL_BATCH` (persist RPC) · `POLITICAL_BATCH_SCHEDULER = READY_DISABLED`

## ✅ 2026-08-17 — FAST 1–4일 정렬 시뮬레이션 (live 미연결)

- [x] 기존 gradual simulator 확장 (갈아엎지 않음)
- [x] ACTOR_SELF_ALIGNMENT · 80/120 target-lean · DI ±120 · community ±240 · deadzone gradual
- [x] EXIT/RETURN 300/120 · 360/160 · 420/180 및 consistency 0.75–0.90 비교
- [x] 5000 synthetic · seeds 42/123/2026/7/99 · DAY1–4/7/14
- [x] strong NON-DI · DI-only · abuse 5/10 cluster · 방어 후보 비교
- [x] live profiles/score/scheduler/UI/auth/.cursor/rules 미변경 · commit 없음

## ✅ 2026-08-17 — 점진적 성향 전파 정책 시뮬레이션 (live 미연결)

- [x] CONFIRMED vs SIMULATION_CANDIDATE vs NOT_CONNECTED 문서 구분
- [x] actor-choice signed delta (80/120 SSOT magnitude + target lean + CENTRAL gradual)
- [x] Daily Issue simulator input only (±80/±40/0, daily cap ±80)
- [x] PAIR_ALIGNMENT_7D_CAP=120 variant
- [x] movement candidates ±1000/800/600, 2 consecutive, confidence 8 / 0.20
- [x] 5000 synthetic users · seeds 42/123/2026 · 7/14/21/30
- [x] abuse: 1인 반복 / 상호 / cluster5 / 집중 / DI-only / non-DI / 양측 동일
- [x] live profiles.territory / user_alignment_state / scheduler / UI / auth 미변경
- [x] commit 없음

## ✅ 2026-08-16 — canonical membership foundation (이후 BETA V1이 이동 연결)

1. [x] `profiles.territory` canonical foundation
2. [x] 신규/기존 일반 회원 CENTRAL 시작 · score 0
3. [x] 사용자 최초 소속 선택 UI 제거 (잘못된 방향)
4. [x] board adapter membership = `profiles.territory`
5. [ ] production scheduler 활성화는 별도 결정
6. [x] BETA V1 server-internal territory transition (EXIT ±360 / RETURN ±160 / 2회 / 48h)

`TERRITORY_MOVE = SERVER_INTERNAL_BATCH` · `TERRITORY_SELECTION_UI = NOT_APPLICABLE` · `TERRITORY_SELF_WRITE = NOT_ALLOWED` · `INITIAL_TERRITORY = CENTRAL`

## ✅ 2026-08-16 — CENTRAL 자동 시작 (사용자 선택 없음)

- [x] 신규 회원 `handle_new_user` + DEFAULT CENTRAL
- [x] 기존 NULL 42명 CENTRAL backfill · row 수 유지 · score 미변경
- [x] 선택 UI / POST /api/me/territory 제거
- [x] GET /api/me/profile territory read 유지
- [x] board reaction snapshot membership source = profiles.territory
- [x] **TERRITORY_SELECTION_UI = NOT_APPLICABLE**
- [x] **TERRITORY_SELF_WRITE = NOT_ALLOWED**
- [x] **TERRITORY_MOVE = NOT_CONNECTED**

## ✅ 2026-08-16 — canonical Earth membership territory foundation

- [x] `profiles.territory` additive nullable (PIONEER/CENTRAL/GUARDIAN)
- [x] ALIEN/KANTAPBIYA CHECK 거부 (foundation 당시 DEFAULT/backfill 없음 → 이후 CENTRAL 시작으로 해소)
- [x] `getCanonicalUserTerritory` read helper · browser write API 없음
- [x] board adapter membership = `profiles.territory` (구 alignment/metadata chain 제거)
- [x] **CURRENT_TERRITORY_CANONICAL_SOURCE = profiles.territory**
- [x] **TERRITORY_MEMBERSHIP_PERSISTENCE = ACTIVE_FOUNDATION**
- [x] **TERRITORY_SELECTION_UI = NOT_APPLICABLE** (사용자 최초 소속 선택 없음)
- [x] **TERRITORY_MOVE = NOT_CONNECTED**
- [x] **TERRITORY_HISTORY = NOT_CONNECTED**
- [x] 선택 UI 연결 안 함 (잘못된 방향 · 철회)
- [x] board adapter 전환 완료

## 🔜 정치성향 scheduler (READY_DISABLED 유지)

1. [x] dest에서 `POLITICAL_ALIGNMENT_SCHEDULER_ENABLED=true` 비-slot startup 검증 PASS 후 **다시 OFF**
2. [ ] production scheduler 활성화 여부는 별도 결정

지금은 env 켜지 않음 · 실제 alignment batch 추가 실행 금지.

## ✅ 2026-08-15 — 정치성향 테스트 프로세스 종료 안정화

- [x] Windows `UV_HANDLE_CLOSING` 재현 (PASS 후 `process.exit(0)` + 열린 Socket/Pipe)
- [x] 테스트 teardown만 정리 (기능 코드/정책 미변경)
- [x] LOAD_FAILED skip/retry 추가 안 함
- [x] **POLITICAL_BATCH_SCHEDULER = READY_DISABLED** 유지
- [x] checkpoint commit

## ✅ 2026-08-15 — 정치성향 실데이터 4단계 (05:00/17:00 scheduler READY_DISABLED)

- [x] 기존 daily-issue morning scheduler 조사 후 패턴 재사용 (catch-up 미복사)
- [x] Asia/Seoul 05:00 / 17:00 slot · deterministic batch id
- [x] tick → 기존 persist service (공식 미복제)
- [x] DB batch_id idempotency · startup 즉시 실행 금지
- [x] env `POLITICAL_ALIGNMENT_SCHEDULER_ENABLED` 기본 off
- [x] **POLITICAL_BATCH_SCHEDULER = READY_DISABLED**
- [x] **MISSED_BATCH_POLICY = PENDING** · **RETRY_POLICY = PENDING**
- [ ] **TERRITORY_MOVE = NOT_CONNECTED**
- [x] checkpoint commit
- [ ] prod/local env로 scheduler 켜기 (내일 NEXT 1–5)

## ✅ 2026-08-15 — 정치성향 실데이터 3단계 (canonical persistence)

- [x] 기존 alignment migration 조사 (territory+JS plan RPC 통째 미적용)
- [x] signed SSOT 통일 (`computeSignedDelta` CENTRAL 대상영토 · away 분기 삭제)
- [x] additive `migration_political_alignment_persistence.sql` + RPC `apply_alignment_score_batch`
- [x] manual CLI dry-run / apply · idempotency ALREADY_APPLIED
- [x] **POLITICAL_SCORE_WRITE = ACTIVE_MANUAL** (dev 1회 apply: score 0 / previousSignal 0)
- [x] **POLITICAL_BATCH_SCHEDULER = READY_DISABLED** (4단계에서 구현, env 기본 off)
- [ ] **TERRITORY_MOVE = NOT_CONNECTED**
- [x] checkpoint commit

## ✅ 2026-08-15 — 정치성향 실데이터 2단계 COMPLETE (CENTRAL signed 확정)

- [x] **CENTRAL_SIGN_POLICY = CONFIRMED** — 대상 영토 기준. CENTRAL→PIONEER +/- · CENTRAL→GUARDIAN -/+ · CENTRAL→CENTRAL signed 0
- [x] 현재 score로 CENTRAL 부호를 바꾸지 않음 (레거시 0쪽/멀어짐 미사용)
- [x] Pioneer/Guardian signed · 99/30 SUM 50/50 · ±500 preview 유지
- [x] `POLITICAL_SIMULATION = ACTIVE_READ_ONLY`
- [x] synthetic fixture 1–24 숫자 검증 · live CENTRAL→CENTRAL signed 0
- [ ] **POLITICAL_SCORE_WRITE = NOT_CONNECTED**
- [ ] **POLITICAL_BATCH_SCHEDULER = NOT_CONNECTED**
- [ ] **TERRITORY_MOVE = NOT_CONNECTED** (문서 ±1000/800 이번 미승격)
- [ ] commit 금지 (이번 요청)

## ✅ 2026-08-15 — 정치성향 실데이터 2단계 (read-only simulation)

- [x] signed score 모델 전수조사 (scalar Pioneer+/Guardian− · CENTRAL는 이후 CONFIRMED)
- [x] window 50/50 = `SUM99*0.5 + SUM30*0.5` 후 previousSignal 차이 (`DELTA_WINDOW_SCORE`) 재검증
- [x] ±500 cap **preview만** (DB 미기록)
- [x] `test-political-alignment-simulation.js` + input 28 유지 · live UUID 숨김
- [ ] **POLITICAL_SCORE_WRITE = NOT_CONNECTED**
- [ ] **POLITICAL_BATCH_SCHEDULER = NOT_CONNECTED** (05:00/17:00)
- [ ] **TERRITORY_MOVE = NOT_CONNECTED** (threshold 이번 미적용)

## ✅ 2026-08-15 — 정치성향 실데이터 1단계 (입력층)

- [x] 기존 설계 vs 구현 전수조사 (`alignment-batch-core` 80/120 · 99/30 · 반응 당시 영토)
- [x] `POLITICAL_REACTION_INPUT = ACTIVE_CANONICAL` (`board_reactions` read-only adapter)
- [x] EMPATHY/REPORT/inactive/ALIEN/99일 밖 제외 · identity = auth.users.id
- [x] 가중치 helper SSOT `alignment-batch-core` (충돌 없음)
- [x] Guest `applyReactionScoresWithMult` 유지 · 정본 아님 표시
- [x] `test-political-reaction-input.js` + live dry-run (절대 count 고정 없음)
- [ ] **POLITICAL_SCORE_WRITE = NOT_CONNECTED** (점수 UPDATE / ±500 cap)
- [ ] **POLITICAL_BATCH = NOT_CONNECTED** (05:00/17:00)
- [ ] **TERRITORY_MOVE = NOT_CONNECTED**
- [x] CENTRAL actor 부호 = 대상 영토 기준 CONFIRMED (레거시 점수-away 분기 미사용)
- [ ] commit 금지 (이번 요청)

---

## ✅ 2026-08-15 — 게시판 leftover canonical (추천/비추천·신고)

- [x] 실Chrome 게시판 전수조사 상태표 (feed/create/comment/empathy = 기존 ACTIVE_CANONICAL 유지)
- [x] 추천/비추천: 기존 `board_reactions` + toggle RPC/API → 실회원 UI 연결 · Guest localStorage
- [x] 신고: 기존 `board_reports` + POST /reports → 실회원 UUID 글 연결 · Guest `sc_reports_v1`
- [x] EMPATHY와 LIKE/DISLIKE 미병합 · XP/fame/업적/auth/app-entry 미변경
- [x] `test-board-reactions-canonical.js` + 기존 board/empathy/xp/profile/achievement 회귀
- [x] Chrome: 추천 ON/전환 · 새로고침 반응 유지 · 게시글 신고 · 새로고침 중복 차단 PASS
- [x] commit `feat: connect canonical board reactions and reports`
- [ ] 통합검색 canonical (현재 `sc_board_bundle_v1` LOCAL_ONLY)
- [ ] 게시글/댓글 수정·삭제 UI (서버 PATCH/DELETE만 있음 · XP 회수 PENDING)
- [ ] 댓글 신고 UI · 댓글 공감 canonical · planetVoters

---

## ✅ 2026-08-15 — 회귀 테스트 live snapshot 안정화 + checkpoint

- [x] empathy-fame live: 특정 회원 event/fame 절대값 제거 → 불변식
- [x] 관련 live snapshot(xp=0, posts=0) 고정값 제거
- [x] 전체 회귀 PASS 후 commit/push

---

## ✅ 2026-08-15 — ProfileFrame 활동 수치 canonical 연결 (미커밋)

- [x] 현재 ProfileFrame 활동 슬롯만 조사 (신규 지표 없음)
- [x] POST_COUNT / COMMENT_COUNT / DISCUSSION_COUNT = ACTIVE_CANONICAL (`board_posts`/`board_comments` ACTIVE)
- [x] RECEIVED_EMPATHY_COUNT = ACTIVE_CANONICAL (`EMPATHY_RECEIVED` event 건수 · fame과 별도 · 댓글 공감 미포함)
- [x] FOLLOWER_COUNT = DATA_NOT_CONNECTED (실회원 0 · follow 신규 구현 없음)
- [x] AURA_COUNT = NOT_IMPLEMENTED (실회원 `--`)
- [x] `GET /api/me/profile` `activityStats` · Guest Mock 유지 · `test-profile-activity-canonical.js`
- [x] Chrome: 새로고침 → 프로필 열기 → 활동 숫자 확인
- [x] commit (canonical checkpoint)
- [ ] 댓글 받은 공감 canonical
- [ ] 팔로워 canonical follow
- [ ] 전달한 아우라 집계 정의

---

## ✅ 2026-08-15 — 실회원 게시판 feed canonical 전환 (미커밋)

- [x] 목록 정본: 실회원 `board_posts` GET · Guest `sc_board_bundle_v1`
- [x] 기존 GET /api/board/posts · listPosts 재사용 · source=server_canonical
- [x] legacy user p_ 글 제외 · demo/seed display-only · 자동 migration 없음
- [x] 작성 후 서버 UUID 목록 반영 · 새로고침 GET 복원 · empathy events hydrate
- [x] `test-board-feed-canonical.js` + board/empathy/comment/xp/profile 회귀
- [ ] Chrome: 새로고침 → 중앙광장에서 쇠똥구리 글·sentencearena 글 공감 → 각 작성자 명성 +1
- [ ] commit (사용자 요청 시)

---

## ✅ 2026-08-15 — 공감→명성 계정 불일치 조사 (미커밋)

- [x] 쇠똥구리 성공 글 vs 타 계정: post id / UUID / board_posts / author_user_id / event / fame 비교
- [x] FAIL = 피드 legacy(non-UUID) 또는 board_posts 없는 글 → 서버 empathy 미호출. localStorage authorId fame 지급 안 함
- [x] 게이트를 `isAuthenticatedBoardMember` + `isCanonicalBoardUuid`로 통일 (특정 계정 하드코딩 없음)
- [x] fixture A→B / A→C canonical fame · legacy p_ 거부 · LEVEL/EXP 회귀
- [ ] Chrome: 상대 실회원의 **새 canonical UUID 글**에만 공감 → 작성자 명성 +1 (legacy 글 클릭 금지)
- [ ] commit (사용자 요청 시)

---

## ✅ 2026-08-15 — 게시글 공감 → reputation_score +1 (미커밋)

- [x] Chrome 공감 경로 추적 → localStorage 수치만 (분류 A)
- [x] 공식 +1 SSOT · atomic RPC · self/dedupe · cancel REVOKE_ON_REMOVED_EMPATHY
- [x] ProfileFrame GET /api/me/profile fame hydrate 유지
- [x] first-empathy-received evaluator 수신자 경로
- [ ] Chrome: A가 B 글 공감 1회 → B 명성 X→X+1 → 새로고침 유지
- [x] 댓글 공감 fame (게시글과 동일 EMPATHY_RECEIVED · 대댓글은 board_comments)
- [x] 공감 취소 시 명성 회수 (실제 제거 1회만 -1)
- [ ] commit (사용자 요청 시)

---

## ✅ 2026-08-15 — ProfileFrame 명성 canonical 연결 (미커밋)

- [x] 기존 `user_progression.reputation_score` 재사용 (신규 테이블 없음)
- [x] ensure-on-read fame 0 · 기존 값 유지 · `/api/me/profile` `fame`
- [x] 실회원 ProfileFrame `#fameLayer` = canonical · Mock/localStorage 금지 · fame=0 표시
- [x] rank 기본 참여자 · threshold 미확정 유지
- [x] `test-profileframe-fame-canonical.js` + LEVEL/EXP 회귀
- [ ] FAME_EARNING: DATA_NOT_CONNECTED (공감 서버화 후 +1 연결)
- [ ] SEASON_FAME_RESET: DEFINED / NOT_CONNECTED
- [ ] 타인 ProfileFrame fame
- [ ] Chrome: 새로고침 → 프로필 열기 → 명성 숫자
- [ ] commit (사용자 요청 시)

---

## ✅ 2026-08-15 — ProfileFrame LEVEL/EXP hydrate 미반영 수정 (미커밋)

- [x] app-entry cache가 progression 버리는 경로 확정 · index.html prefetch 보정
- [x] 프로필 열기 cross-IIFE 인증 체크 수정 · expPercent=0 안전 렌더
- [x] `test-profileframe-hydrate-canonical.js` + 회귀
- [ ] Chrome: 새로고침 → 프로필 열기만 (기대 Lv2 / EXP 44% · 활동명「쇠똥구리」회원과 동일 시)
- [ ] commit (사용자 요청 시)

---

## ✅ 2026-08-15 — XP 재접속 영속성 수정 (미커밋)

- [x] DB→RPC→API→hydrate 추적 · 원인 확정
- [x] RPC 후 별도 SELECT 검증 · ensure non-overwrite · member profile-xp canonical
- [x] event history reconcile dry-run (테스트 회원 일치)
- [x] `test-progression-xp-persistence.js` + 회귀
- [ ] Chrome: 사이트 재접속 → 프로필 열기만 (새 글/댓글 불필요)
- [ ] commit (사용자 요청 시)

---

## ✅ 2026-08-15 — 실회원 게시판 댓글 canonical + XP +12 (미커밋)

- [x] 실회원 댓글 → board_comments INSERT · author = auth.users.id
- [x] BOARD_COMMENT_CREATED +12 · idempotent · ProfileFrame 즉시 갱신
- [x] openPostDetail hydrate · Guest localStorage 유지
- [x] first-comment = 타인 글만 · 자기 글 댓글은 XP만
- [ ] Chrome: 타인 글 댓글 · EXP+12 · first-comment 알람 · 새로고침
- [x] ISSUE_COMMENT_CREATED 서버 연결 (Daily Issue 공개 댓글 XP +10, 저장과 실패 분리)
- [ ] commit (사용자 요청 시)

---

## ✅ 2026-08-15 — 공식 Lv1~10 XP + POST_CREATED 서버 earning (미커밋)

- [x] `shared/progression-xp-core.js` SSOT · MAX 10 · MAX_TOTAL_XP 1500
- [x] `user_progression_events` + `apply_user_progression_event` migration 적용
- [x] POST_CREATED +25 ACTIVE · idempotent · ProfileFrame 즉시 갱신
- [x] Lv5 → territory-citizen evaluator (progression 후)
- [x] Guest local · DELETE_XP_POLICY PENDING
- [ ] Chrome: 어휴힘들다 글 1개 → xp 0→25 · EXP 0%→63%
- [x] BOARD_COMMENT / ISSUE_COMMENT 서버 연결 (BOARD +12 · ISSUE +10 ACTIVE)
- [ ] commit (사용자 요청 시)

---

## ⏸️ 2026-08-15 — 서버 XP earning / level-up (블로커) → 해제

- [x] **Lv6~10 XP threshold 정책 확정** (운영 확정값 반영)
- [x] 게시글 canonical → atomic progression · ProfileFrame · territory-citizen
- [ ] 댓글 UI canonical 전환 후 +12 연결

---

## ✅ 2026-08-15 — 프로필 실데이터 3단계: ProfileFrame EXP canonical (미커밋)

- [x] `user_progression.xp` 누적 XP 정본 (기존 컬럼 · DEFAULT 0)
- [x] `ensureAndGetProgression` → level + xp + expPercent
- [x] ProfileFrame EXP text + expGauge = canonical (localStorage EXP 미사용)
- [x] Guest Mock expPercent 68 유지 · LEVEL 연결 유지
- [x] 명성 canonical 연결 (2026-08-15 · earning은 DATA_NOT_CONNECTED)
- [ ] Chrome: 실회원 LEVEL+EXP+명성 · 닫기/재오픈 · 새로고침
- [ ] commit (사용자 요청 시)

---

## ✅ 2026-08-15 — 프로필 실데이터 2단계: ProfileFrame LEVEL canonical (미커밋)

- [x] `user_progression` additive migration 적용 (dev)
- [x] `ensureAndGetProgressionLevel` · `/api/me/profile` level · `/api/users/me/progression`
- [x] 실회원 ProfileFrame LEVEL = DB level (localStorage level 미사용)
- [x] Guest Mock level 유지 · 신규회원 ensure → level 1
- [x] territory-citizen / LEVEL_REACHED 동일 canonical
- [x] 아바타 placeholder · EXP/명성 표시 기존 유지 → EXP는 3단계 · 명성은 4단계에서 canonical
- [ ] Chrome: 실회원 로그인 → 프로필 LEVEL · 닫기/재오픈 · 새로고침
- [ ] XP / 실제 level-up pipeline (다음)
- [x] 명성 canonical 연결 (표시 · 2026-08-15)
- [ ] 타인 ProfileFrame level (공개 API 없음 · 미연결)
- [ ] commit (사용자 요청 시)

---

## ✅ 2026-08-15 — 프로필 실데이터 1단계: 아바타 placeholder (미커밋)

- [x] ProfileFrame `avatarLayer` 추가 (좌측 전신 슬롯)
- [x] CSS/SVG 사람 실루엣 + 「준비중」
- [x] HUD + ScProfileModal 동일 placeholder
- [x] 실회원/Guest 동일 표시 · 업로드/실이미지 미연결
- [x] 기존 USER ID/LEVEL/명성/EXP/성향지도/업적 좌표 미변경
- [x] Chrome 4스킨 시각 확인 (center/pioneer/guardian/alien · Guest HUD)
- [ ] commit (사용자 요청 시)

---

## 📌 2026-08-13 하루 마감

**오늘 끝난 것 (커밋 `86c8576` · origin/master 반영됨)**

- 베타 업적 11개 복원 · rarity 5단계 · LEGENDARY 0
- 서버 전용 grant · `user_achievements` persistence · `acquired_at` / `acquisition_sequence`
- `acquisition_notified_at` · 중앙 획득 알람 FIFO · 오프라인/소급 알람 1회
- 실회원 대표 업적 canonical → ProfileFrame 즉시 반영 (Guest만 Mock)
- first-post: canonical `board_posts` 연동 + 실시간 grant + `RETROACTIVE` backfill 기반
- browser self-grant 404 · auth/app-entry/OAuth/ProfileFrame PNG·좌표 미변경

**다음 세션에서 이어서**

1. Chrome 실회원 확인 (대표 업적 슬롯 · first-post 신규 작성 알람 · 재로그인 재알람 없음)
2. 나머지 10개 업적 `conditionHistoryPolicy` 확정 (임의 RETROACTIVE 금지)
3. empathy / beta-citizen / dialogue / witness canonical 연결 (아직 UNSET)
4. legacy localStorage 글은 서버가 소유권을 증명할 수 없어 자동 소급 불가 — 필요 시 admin export migration만

**주의**

- `BOARD_OPERATIONAL=true` (local .env)
- 영토 없는 회원 canonical 글은 스키마상 last-resort `CENTRAL` (NOT NULL + 4값 CHECK)
- 정치성향/OAuth/영토 시스템 재설계 금지

---

## ✅ 2026-08-13 — first-post RETROACTIVE 소급 backfill

- [x] 과거 게시글 저장 위치 조사 (localStorage pre-canonical · Supabase `board_posts` post-canonical)
- [x] `first-post` `conditionHistoryPolicy = RETROACTIVE`
- [x] `server/achievement-backfill-service.js` 공통 backfill (evaluator 재사용 · policy gate)
- [x] `tools/run-achievement-backfill.js` (inspect / dry-run / apply)
- [x] `tools/migrate-legacy-board-posts-export.js` (UUID ownership export → canonical INSERT)
- [x] `tools/test-achievement-backfill.js` 24 PASS
- [x] dev DB inspect: canonical 작성자 전원 first-post 보유 → backfill 대상 0
- [ ] legacy localStorage export → migration (해당 계정 export 시 admin one-time)
- [ ] Chrome: canonical 글만 있는 기존 회원 로그인 → backfill 후 알람 1회 (dev eligible 0이라 별도 시드 필요 시)
- [x] 안정화 커밋 (feat: complete achievement persistence, alerts and retroactive foundation)

## ✅ 2026-08-13 — 대표 업적 ProfileFrame + 소급/알람 정책

- [x] 실회원 ProfileFrame 3칸 = canonical owned + featured (Mock fallback 금지)
- [x] 선택 완료 즉시 슬롯 반영 · hydrate 후 순서 유지
- [x] 서버 featured 미보유/4개/중복 거부
- [x] `conditionHistoryPolicy` RETROACTIVE | FORWARD_ONLY | UNSET (**first-post RETROACTIVE**, 나머지 UNSET)
- [x] `acquisition_notified_at` + 기존 row backfill + 신규 NULL
- [x] 중앙 알람 실제 표시 후 notified 처리 · FIFO
- [x] 대량 소급 지급 미실행
- [ ] Chrome: 대표 업적 선택 → 슬롯1 "글쓰기 버튼이 눌렸다" · 새로고침 유지 · first-post 재알람 없음
- [ ] ~~업적별 RETROACTIVE/FORWARD_ONLY 확정 후 이력 backfill (별도 작업)~~ → first-post RETROACTIVE backfill 완료 · 나머지 업적 정책 확정은 별도
- [x] 안정화 커밋

## ✅ 2026-08-13 — first-post 실회원 canonical 연결

- [x] UI 글쓰기 → 서버 `POST /api/board/posts` (실회원만)
- [x] `board_posts` migration 적용
- [x] `BOARD_OPERATIONAL=true` (local .env)
- [x] createPost await evaluator → first-post grant
- [x] `newlyGrantedAchievements` → 중앙 알람
- [x] Guest localStorage 유지
- [x] self-grant 404 / CLIENT_GRANT_FORBIDDEN 유지
- [x] `test-first-post-canonical.js`
- [ ] Chrome: 실회원 로그인 → 게시글 1개 작성 → "글쓰기 버튼이 눌렸다" 알람
- [x] 안정화 커밋

## ✅ 2026-08-13 — 베타 업적 복원 + 중앙 획득 알람 (Chrome 확인 완료)

- [x] achievement definitions 11개 복원/검증 (LEGENDARY 신규 0)
- [x] rarity 5단계 프레임 asset 재사용 (일반/청동/황금/수정/전설)
- [x] server evaluator + stats service (`achievement-evaluator-service.js`)
- [x] board API 성공 hook (createPost/createComment → evaluate, BOARD_OPERATIONAL 시)
- [x] secure server-only grant 유지 · browser self-grant 404
- [x] centered acquisition alert + FIFO queue (`achievement-acquired-alert.js`)
- [x] initial hydrate alarm suppression (`memberAlertBaseline`)
- [x] Guest Mock 3 baseline only · 진입 알람 0
- [x] localhost preview `__scPreviewAchievementAcquired`
- [x] `test-achievement-restore.js` 46 PASS · persist 42 PASS
- [x] Chrome localhost preview/ Guest 검증
- [ ] beta-citizen auto-grant — 베타 시작/종료 canonical 설정 필요
- [ ] empathy 계열 ACTIVE — board empathy canonical 저장소 필요
- [ ] dialogue-across-territories — CANDIDATE 정책 확정 후
- [ ] witness-of-an-era — 영토 발전 이벤트 canonical 후
- [x] 안정화 커밋

## ✅ 2026-08-13 — 업적 persistence 기반 (정리 2단계 · superseded by 복원 작업)

현재 구현 단계:

- [x] achievement definitions 11개 유지 (조건/목록 미변경)
- [x] evaluator framework/plan 존재 (실지급 비활성)
- [x] user_achievements / featured persistence + canonical acquired_at/sequence
- [x] member hydrate · 신규 0개 · Mock seed 금지
- [x] featured 보유분 max 3 persist
- [x] Guest Mock 3개 유지 (territory-citizen · empathy-from-many · beta-citizen)
- [x] first-post 게시글 자동 hook **제거** (definition은 유지)
- [x] 공개 browser self-grant API **차단** (404) · 서버 grant service/RPC 유지
- [x] first-post: 실회원 게시글 → server evaluator → grant 연결 (2026-08-13)
- [x] 안정화 커밋 `86c8576` (Chrome 잔여 확인은 다음 세션)

## ✅ Naver OAuth 개발환경 (2026-08-13) CLOSED · 운영 미완료

개발 Chrome PASS:

- [x] `custom:naver` · 공통 `/auth-v2/callback.html` · 공통 post-login
- [x] UserInfo proxy `response.id` → `sub`
- [x] 신규가입 → 활동명 → 지도 → 앱 → 프로필 (소속 영토 직접 선택이 아님)
- [x] DB 새 구조 없음 · Google/Kakao 미변경
- [x] tag `auth-naver-dev-stable-2026-08-13` (dev-stable · 운영 stable 아님)

운영 전 TODO:

- [ ] Railway/공개 서버에 `/api/auth/naver-userinfo` 배포
- [ ] Supabase `custom:naver` Userinfo URL을 임시 Cloudflare tunnel → 운영 HTTPS로 변경
- [ ] `sentencearena.com` Redirect URL 확인 (Supabase Redirect URLs)
- [ ] Naver Developers 운영/검수 단계
- [ ] 운영환경 Chrome Naver 재검증

## ⏸️ 2026-08-12 세션 종료 · 다음 시작 지점

오늘 CLOSED:

- 신규회원 ProfileFrame clean default + 실회원 업적 Mock 분리
- commit `9675167` · tag `profile-new-member-clean-stable-2026-08-12`

유지 태그 (이동 금지):

- `auth-browser-google-stable-2026-08-12` (`2091026`)
- `auth-kakao-stable-2026-08-12` (`fab0091`)

다음 세션 주의:

- `auth.js` / Google·Kakao OAuth / ProfileFrame PNG·좌표 임의 수정 금지
- 업적 정의·지급 조건·DB bulk 초기화 금지

남은 후보:

- [ ] 활동명 onboarding Chrome 확인 (신규/기존 Google)
- [ ] Naver OAuth (보류)

## ✅ 신규회원 ProfileFrame 초기화 + 실회원 업적 Mock 분리 (2026-08-12) CLOSED

- [x] 실회원 canonical `currentAchievements = []` (Mock seed 미주입 · 날짜 필터 제거)
- [x] Guest/demo만 `DEFAULT_USER_ACHIEVEMENT_MOCK`
- [x] 계정 A→B 전환 시 member state 누수 없음 (userId bind)
- [x] 실 auth id가 leftover `sc_sb_guest_ok`보다 우선
- [x] 0건 빈 상태 문구 “아직 획득한 업적이 없습니다.”
- [x] ProfileFrame: USER ID=활동명 · Lv.1 · EXP 0 · 활동 0 · 대표 업적 없음
- [x] Chrome 신규 실회원 확인 완료
- [x] 안정 커밋 + tag `profile-new-member-clean-stable-2026-08-12`

## 🔜 활동명 onboarding Chrome 확인 (2026-08-12)

- [x] `handle_new_user` 신규 profile `display_name=''` (provider metadata 미사용)
- [x] `app-entry.js` provider 공통 `needsActivityNameOnboarding` + `isCompleteActivityName`
- [x] `ScActivityNameOnboarding` / 주사위 / API 기존 구현 유지
- [x] `test-activity-name-onboarding` · handle-new-user 테스트 갱신
- [ ] `npm run auth:handle-new-user:migrate` dev DB 적용 (DAILY_ISSUE_DATABASE_URL)
- [ ] Chrome 신규 Google 계정 — 활동명 화면 → 저장 → 지도 (소속은 CENTRAL 자동, 사용자가 PIONEER/CENTRAL/GUARDIAN을 고르지 않음)
- [ ] Chrome 기존 Google 계정 — 활동명 화면 없음

## ✅ 공통 post-auth session pipeline (2026-08-12)

- [x] `GET /api/session/bootstrap` (auth+profile 1회)
- [x] `ScSessionController` — BOOTING / UNAUTHENTICATED / PROFILE_INCOMPLETE / READY / GUEST / ERROR
- [x] Apple 로그인 UI 제거 · Google/Kakao/Naver/Guest 유지
- [x] OAuth 미변경 · Naver 추가 시 controller 수정 불필요 구조
- [x] `test-session-pipeline` + auth 회귀 PASS

## ⏸️ 다음 사용자 확인

- [ ] Google 로그인 1회 + Kakao 로그인 1회 (공통 pipeline)
- [~] Kakao OAuth E2E · 활동명/지도
- [ ] Naver OAuth / Production redirect (보류)

## ✅ 활동명 온보딩 · profile identity (2026-08-11)

- [x] `auth.users.id` = `profiles.id` 기준 회원 연결 (provider-independent)
- [x] display_name 미완료 → 활동명 설정 UI → 지도 (회원 소속 PIONEER/CENTRAL/GUARDIAN 선택이 아님)
- [x] 활동명 규칙 2~16 · 공백/특수문자 거부 · case-insensitive UNIQUE
- [x] 🎲 자동 활동명 후보 (저장은 확정 버튼만)
- [x] `PUT /api/profile/me/display-name` · availability API (cookie auth)
- [x] Guest와 AUTHENTICATED+PROFILE_INCOMPLETE 분리
- [x] 게시글/댓글 ownership = `author_user_id` 유지 확인
- [x] OAuth/cookie auth 회귀 PASS · local commit · GitHub push

## ✅ Google OAuth / 쿠키 인증 (2026-08-09~11) — AUTH STABLE BASELINE

- [x] 서버 `/health` · `/api/auth/oauth/google` 302 정상 확인
- [x] Google 버튼 DOM/href · 전용 click 가로채기·overlay 1차 점검
- [x] Supabase SSR cookie auth 재구축 (`@supabase/ssr` · handoff/sessionStorage 폐기)
- [x] OAuth PKCE cookie → callback `exchangeCodeForSession` → Set-Cookie → `/?postLogin=board`
- [x] `/api/auth/me` cookie · board API cookie · `POST /api/auth/logout`
- [x] app-bootstrap `/api/auth/me` 1회 · `tools/test-auth-cookie.js`
- [x] 로그인 후 지도 화면 복구 (자동 COMMON 게시판 제거). 당시 「영토 선택」= 지도 탐색, 소속 선택이 아님
- [x] Chrome Google 로그인 1회 → 지도 화면 정상 (2026-08-11 사용자 확인)

## 🔜 다음 인증 작업 후보

- [x] Kakao email-less DB trigger — `migration_handle_new_user_emailless_oauth.sql` dev DB 적용 + pg smoke PASS (`npm run auth:handle-new-user:migrate`)
- [~] Kakao OAuth E2E — DB trigger 적용 후 실제 Kakao 계정 로그인 1회 사용자 확인
- [ ] Naver OAuth 연결
- [ ] Production redirect/domain 적용 (Railway 배포 시)

## ✅ 브랜드 리브랜딩 SentenceArena (2026-08-09)

- [x] 표시명 `SentenceArena` / `센텐스아레나` 통일
- [x] GitHub `sentencecraft` → `sentencearena` · origin/docs/package URL 정리
- [x] npm `sentencearena` · API `sentencearena-api` · Cursor rule `sentencearena.mdc`
- [x] `sc_*` / migration checksum / Supabase / OAuth secrets 유지
- [x] 로컬 폴더명 `sentence-craft` 유지 (workspace 안정성)

## ✅ 작업 정리 · 문서 동기화 (2026-08-07)

- [x] PROJECT_CONTEXT / AI_HANDOFF / CHANGELOG에 당시 브랜드·GitHub 상태 반영
- [ ] Railway 프로젝트 생성 · Variables 입력 · 첫 배포 (사용자 대시보드)

## ✅ GitHub repository → sentencecraft (2026-08-07 · legacy)

- [x] `sentence-craft` → `sentencecraft` (이후 `sentencearena`로 통합)

## ✅ GitHub repository rename (2026-08-07 · legacy)

- [x] `sentnse_craft` → `sentence-craft` (이후 `sentencecraft` → `sentencearena`)

## ✅ 브랜드 철자 교정 SentenceCraft (2026-08-07 · legacy)

- [x] 당시 표시명 `SentenceCraft` 통일 (2026-08-09 SentenceArena로 교체)
- [x] `sc_*`/migration checksum 호환 유지

## ✅ Railway 베타 배포 준비 (2026-08-07)

- [x] `0.0.0.0` bind · engines 20.x · `railway.json` · `nixpacks.toml`
- [x] `.env.production.example` A/B/C · 첫 배포 scheduler OFF
- [x] 배포 직전 점검: gitignore 보강 · 회귀 PASS · secret 미추적 확인
- [ ] Railway 프로젝트 생성 · Variables 입력 · 첫 배포 (사용자 대시보드)
- [ ] 운영 `daily_issue` migration apply → `/ready` → scheduler ON(web=1)

## ✅ 베타 배포 전 서버 안정화 1차 (2026-08-07)

- [x] Graceful shutdown (SIGTERM/SIGINT · scheduler · PG pool · timeout)
- [x] Production CORS allowlist · development localhost 유지
- [x] Scheduler 단일 웹 인스턴스 정책 문서화
- [x] `GET /ready` · production boot fail-closed
- [x] `test:server-stability` 26 · API/morning 회귀 PASS
- [ ] Railway/Render 실배포 · 운영 migration apply

## ✅ 운영용 daily_issue migration 절차 1차 (2026-08-07)

- [x] 운영 schema=`daily_issue` 확정 · test/public 차단
- [x] production migrate check/dry-run/apply/verify 도구 · confirm 게이트 · checksum · transaction
- [x] `.env.production.example` · 개발 플래그 제외
- [x] `test:daily-issue-production-migrate` 27 PASS · 실 운영 DB 미적용
- [ ] 배포 직전: 운영 DB에 dry-run → apply → verify (수동)

## ✅ 제목·RSS 요약 교차출처 confirmed fact (2026-08-06)

- [x] `daily-issue-title-fact-core` — fact tuple · 공통 필드만 CONFIRMED · 수치 충돌 기록 · 전망/해석 제외
- [x] ingest 연동 · 교차 CONFIRMED 없을 때 title-fact 병합 · `feedSummary` · require 버그 수정
- [x] 클러스터 본문 generic(온라인 등) 오병합 차단 (title 고유명사 합의 필수)
- [x] `test:daily-issue-title-fact` 8 · cross-source 35 · E2E 수동 enqueue 없이 PASS
- [x] `daily-issue:validate-confirmed-fact-live` 스크립트
- quality v2 · AUTO 판정 미완화

### 후속
- [ ] 실 RSS에서 CJ프레시웨이 등 제목-only 2출처 동시 유입 시 READY 전환 모니터링
- [ ] 원문 fetch 성공 시 본문 근거 우선 경로 E2E 검증

## ✅ 정식 관리자 인증 1차 (2026-08-06)

- [x] `/admin/daily-issues` 토큰 입력 방식 제거 → Supabase 이메일·비밀번호 로그인 화면 전환
- [x] 관리자 API 인증을 서버 Supabase access token 검증 + 역할 게이트(ADMIN/OWNER)로 전환
- [x] USER/MODERATOR 권한 차단(403) · ADMIN/OWNER 접근 허용
- [x] 로그아웃 시 세션 삭제 + 로그인 화면 복귀
- [x] 기존 검수/게시/보류/반려/종료/스케줄러 기능 유지
- [x] 회귀: `test:daily-issue-admin-api` · `test:daily-issue-api-security` · `test:daily-issue-admin-ui` · `test:daily-issue-admin-ui-security` · `test:daily-issue-public-api` · `test:daily-issue-public-ui`
- [x] Auth 정식화: service-role fallback 제거 · anon/publishable만 Auth 사용 · service-role은 Admin API 전용
- [x] `tools/test-supabase-server-auth-config.js` (폴백 금지 검증)
- [x] `.env`에 `SUPABASE_ANON_KEY` 또는 `SUPABASE_PUBLISHABLE_KEY` 설정 후 서버 재시작 · 실로그인 확인 (publishable · signin/admin/signout 200)

## ✅ 관리자 데일리 이슈 운영자 UX 단순화 (2026-08-06)

- [x] daily_issue_test 테스트 fixture 정리 · 실제 한국어 후보 유지
- [x] 상태·판정·스케줄러·감사 이력 한국어 표시 · KST 시간
- [x] 목록·상세 단순화 · 개발 정보 접기 영역
- [x] 필터·큐 운영자용 라벨 · API/정책 변경 없음
- [x] admin UI 테스트 41 · publication 24 · scheduler 32 회귀 PASS

### 후속 보류
- [ ] 보류/반려/승인됨 등 추가 상태 빠른 필터
- [ ] 사후 검수 큐 전용 상세 워크플로

## ✅ 정식 아침판 스케줄러·운영 감시 1차 (2026-08-06) — A~G PASS

- [x] 04:30 collect / 05:00 publish 분리 · Asia/Seoul · catch-up/MISSED/BLOCKED
- [x] runKey + DB advisory lock/unique · 실행 이력 테이블
- [x] 관리자 status/history/수동 실행 API · UI 운영 패널·경고
- [x] 사후 검수 큐(AUTO_MORNING_EDITORIAL) · retire 유지
- [x] 단위 32 · PG smoke 13 · 판정 회귀 24 · public schema/`npm start` 미사용

### 후속 보류
- [ ] 외부 알림(이메일·SMS·푸시)
- [ ] 독립 cron 워커 프로세스(서버 setInterval 외)
- [ ] AUTO 허용 범위 점진 확대 · 운영 대시보드 고도화

## ✅ 데일리 이슈 자동 게시 / 수동 검수 2단계 (2026-08-06)

- [x] `AUTO_PUBLISH_ELIGIBLE` / `MANUAL_REVIEW_REQUIRED` 판정 코어 · enqueue 메타 부착
- [x] 05:00 KST 아침판 AUTO만 게시 · actor `AUTO_MORNING_EDITORIAL` · audit 근거
- [x] HOLD/REJECT/중복/수동 후보 자동 게시 차단 · 관리자 approve/publish/retire 유지
- [x] 관리자 UI·serializer 게시 판정 표시
- [x] 단위 테스트 24 · PG smoke 12 (`daily_issue_test`) · 운영 public schema 미사용
- [x] quality/freshness/lifecycle 임계치 미완화 · AUTO 범위 좁게 시작

### 후속 보류
- [ ] AUTO 허용 주제 점진 확대(운영 로그 기반) · 확신도 점수화
- [ ] 정식 cron/워커(프로세스 내 setInterval opt-in 외)
- [ ] 관리자 사후 검수 큐(자동 게시분만 필터)
- [ ] 공개 화면 고도화(분야 필터·댓글·아카이브)

## ✅ 데일리 이슈 사용자 공개 화면 연결 1차 (2026-08-06)

- [x] 중앙광장 데일리 섹션 → `GET /api/daily-issues` · `/:id` 상세
- [x] PUBLISHED·미만료만 · 로딩/빈/오류 구분 · 금지 필드 미표시
- [x] 관리자 UI·지도 메인 구조 유지 · `test:daily-issue-public-ui`
- [x] 자동 수집 고도화 · quality/freshness 정책 변경 · 운영 public schema **미구현/미사용**

### 후속 보류
- [ ] 공개 화면 고도화(분야 필터·댓글·아카이브 연동)
- [x] 2단계 자동 게시 정책 (2026-08-06)

## ✅ 데일리 이슈 8차 관리자 검수 화면 1차 (2026-08-05) — A~G PASS

- [x] `/admin/daily-issues` 목록·상세·history · 승인/보류/반려/게시/종료/재검증
- [x] 개발용 토큰 모달 · sessionStorage만 · 사용자 UI 링크 없음
- [x] expectedStatus+lockVersion · approve≠publish · 409/401 안전 처리
- [x] `test:daily-issue-admin-ui` · `test:daily-issue-admin-ui-security` · `daily-issue:admin-ui:smoke`
- [x] 정식 인증·스케줄러·자동 게시·운영 화면 · `npm start` **미구현/미실행**

### 후속 보류
- [x] 정식 관리자 인증·권한 (USER/MODERATOR/ADMIN/OWNER) 1차
- [ ] 운영용 관리자 화면 고도화
- [ ] 스케줄러 · 자동 게시(금지 유지 시 수동만)
- [x] 공개 사용자 화면 연결 1차 (중앙광장 · 2026-08-06)
- [ ] 공개 화면 댓글 API

## ✅ 데일리 이슈 7차 서버 API 1차 (2026-08-05) — A~G PASS

- [x] 관리자 HTTP API: list/show/approve/hold/reject/publish/expire/retire/revalidate/history
- [x] 공개 HTTP API: `GET /api/daily-issues` · `GET /api/daily-issues/:id` (PUBLISHED·미만료만)
- [x] 임시 관리자 토큰 가드 (`DAILY_ISSUE_ADMIN_API_TOKEN` · timing-safe · fail-closed)
- [x] expectedStatus + expectedLockVersion · approve≠publish · service/repository만 사용
- [x] requestId · 오류 매핑 · memory rate limit · CORS allowlist · no-store
- [x] 테스트: `test:daily-issue-api` · `daily-issue:api:smoke`
- [x] 관리자 UI 1차 완료(8차) · 정식 USER/MODERATOR/ADMIN 권한·스케줄러·자동 게시·운영 public schema · `npm start` **미구현/미실행**

### 후속 보류
- [x] 관리자 웹 검수 화면 1차 (8차)
- [x] 정식 관리자 인증·권한 (USER/MODERATOR/ADMIN/OWNER) 1차
- [ ] 스케줄러 · 자동 게시(금지 유지 시 수동만)
- [ ] 댓글 API · 가입 초기 성향 설문

## ✅ 데일리 이슈 6차 실 PostgreSQL 통합 검증 (2026-08-05) — A~G PASS

- [x] 개발 Supabase pooler 연결 · schema=`daily_issue_test`
- [x] migration 적용·재실행 · 12 tables · unique/FK/index/RLS
- [x] `test:daily-issue-postgres` 13 · `test:daily-issue-postgres-atomicity` 18 · migration 9
- [x] JSON/실 DB bundle 동일 · fail-closed · 테스트 schema만 TRUNCATE
- [x] 서버 API 1차 완료 (7차) · 관리자 UI·스케줄러·운영 migration **미구현/미실행**

### 후속 보류
- [x] 서버 API가 repository 인터페이스 재사용 (7차)
- [ ] 관리자 인증·권한 · 관리자 웹
- [ ] 스케줄러 · 자동 게시
- [ ] 가입 초기 성향 설문

## ✅ 데일리 이슈 실 PostgreSQL adapter 6차 (2026-08-05)

- [x] `pg` client · SQL repository · 상태+audit 동일 transaction · lockVersion SQL
- [x] `DAILY_ISSUE_DATABASE_URL` 전용 (DATABASE_URL 자동 사용 금지 · JSON fallback 금지)
- [x] memory-SQL executor 단위 테스트 · migration apply 도구 · document jsonb
- [x] 실 Postgres integration / migration apply: **PASS** (통합 검증 완료)
- [x] CLI `--repository=db` · 기존 JSON review/atomicity 유지
- [x] 서버 API 1차 완료 (7차) · 관리자 UI·스케줄러·운영 migration **미구현/미실행**

### 후속 보류
- [x] 서버 API가 repository 인터페이스 재사용 (7차)
- [ ] 관리자 인증·권한 · 관리자 웹
- [ ] 스케줄러 · 자동 게시
- [ ] 가입 초기 성향 설문

## ✅ 데일리 이슈 DB 스키마·저장소 추상화 5차 (2026-08-05)

- [x] repository 계약 · JSON adapter · fake-db adapter · factory
- [x] review service → repository만 의존 (파일 직접 조작 제거)
- [x] SQL migration 초안 (`supabase/migration_daily_issue_review_lifecycle.sql`) — **운영 미적용**
- [x] lockVersion · 상태+감사 동일 transaction · DB fail-closed (JSON 자동 fallback 금지)
- [x] JSON→DB migration dry-run 도구 · contract/schema/json 테스트
- [x] 기본 repository=`json` · CLI·기존 review/atomicity 테스트 유지
- [x] 서버 API·관리자 인증/UI·스케줄러·자동 게시·운영 DB 연결 **미구현**

### 후속 보류
- [ ] 서버 API가 repository 인터페이스 재사용
- [ ] 운영 migration 적용 · 실 SQL executor wiring
- [ ] 관리자 인증·권한 · 관리자 웹 검수 화면
- [ ] 서버 스케줄러(expire/retire/enqueue)
- [ ] 가입 초기 성향 설문
- [ ] 외부 AI API

## ✅ 검수 상태·감사 로그 원자성 (2026-08-05)

- [x] B방식: 로그 실패 시 상태 스냅샷 rollback
- [x] `test:daily-issue-review-atomicity`

## ✅ 데일리 이슈 검수·게시 생명주기 4차 (2026-08-05)

- [x] JSON 검수 대기열 · 허용 상태 전환 · 감사 로그
- [x] approve/hold/reject/publish/expire/retire CLI (승인≠게시)
- [x] 중복·UPDATE_PENDING · 만료·RETIRED · PUBLISHED 번들만
- [x] atomic write · path traversal 차단 · dry-run
- [x] `test:daily-issue-review` · 실 후보 임시 lifecycle
- [x] 자동 게시·실 DB·관리자 웹·스케줄러 미구현 유지

### 후속 보류
- [x] 저장소 추상화 · DB 스키마 초안 (5차 완료)
- [ ] 실 DB / Supabase persistence (운영 적용)
- [ ] 관리자 웹 검수 화면
- [ ] 서버 스케줄러(expire/retire/enqueue)
- [ ] 가입 초기 성향 설문
- [ ] 외부 AI API

## ✅ 데일리 이슈 최신성 게이트 3차 (2026-08-05)

- [x] 시간 필드 표준화 (상호 대체 금지)
- [x] freshness policy + freshness-core
- [x] quality 이후 freshness 게이트 연결 · 오늘 게시 후보 분리
- [x] 재순환·장기사건 novelty · 미래/비정상 날짜 차단
- [x] Ceuta/Ukraine READY 재판정 · world/korea-economy fresh dry-run
- [x] `test:daily-issue-freshness` · pair 원인 수치화(기준 미완화)
- [x] 자동 게시/스케줄러/외부 AI/가입 설문 미구현 유지

### 후속 보류
- [x] korea-economy 교차 READY 1건(연합뉴스 ko + 매일경제 · 오세훈-김용범 회동 · 승인/게시 안 함)
- [x] korea-economy 교차 READY 안정화 — 클러스터링 보강(한국어 proper noun·제목 정규화 · 2026-08-06 실 RSS READY 2건)
- [x] korea-economy 교차 READY 확대(국내 뉴스 동일 사건 자동 병합 · 기준 미완화)
- [ ] 서버 스케줄러·실 DB·관리자 검수·자동 PUBLISHED
- [ ] 유료 뉴스 API / 외부 AI 요약
- [ ] 가입 초기 성향 설문

## ✅ 외부 출처 수집 파이프라인 2차 (2026-08-05)

- [x] 교차 확인 가능 출처 확대(검증된 RSS만 enabled)
- [x] 공식기관 full-text allowlist + board 본문 제한 추출
- [x] BOK 한국어 description 없음 → 원문 fetch evidence (조건 A)
- [x] 보수 군집화·교차 claim · world READY≥1 (조건 B/C)
- [x] 그룹별 dry-run CLI · cross-source 테스트
- [x] 품질 기준 미완화 · 뉴스 대량 본문 크롤 금지

### 후속 보류
- [x] korea-economy 교차 READY 샘플 1건(연합 ko + 매경)
- [ ] korea-economy 교차 READY 추가(본문 없는 RSS · CONFIRMED claim 추출 보강 — CJ 등)
- [ ] WHO 등 description 품질/신선도 추가 검증
- [ ] 서버 스케줄러·실 DB·관리자 검수
- [ ] 유료 뉴스 API / 외부 AI 요약
- [ ] 가입 초기 성향 설문

## ✅ 외부 출처 수집 파이프라인 1차 (2026-08-05)

- [x] 출처 레지스트리 + HTTP 검증된 enabled 피드만 활성
- [x] SSRF 안전 fetch · RSS/Atom 파싱 · URL 정규화
- [x] 중복 제거 · 보수적 군집화 · evidence substring 추출
- [x] `buildDailyIssueCandidate` 연결 · dry-run CLI · 캐시(`.cache/daily-issue`)
- [x] fixture 테스트 `tools/test-daily-issue-ingest-system.js`
- [x] 품질 기준 미완화 · 정적 풀 게시 미사용 · localStorage 자동 주입 없음

### 후속 보류
- [ ] 본문 있는 공식 공식 피드 확대 · 교차 출처 READY 증가
- [ ] 공식 문서 제한적 full-text(셀렉터 크롤 금지 유지)
- [ ] 서버 스케줄러·실 DB·관리자 검수
- [ ] 유료 뉴스 API / 외부 AI 요약
- [ ] 가입 초기 성향 설문

## ✅ 출처 근거 기반 claim 분류·검증 파이프라인 (2026-08-05)

- [x] 출처 문서·evidence·claim 표준 구조 (`shared/daily-issue-source-core.js` · `claim-core.js`)
- [x] 7분류 자동 분류 + 문장-근거 연결 검증
- [x] `buildDailyIssueCandidate` 품질 게이트 v2 (`shared/daily-issue-quality-core.js`)
- [x] UI 분류별 구획 표시 · REJECTED 미노출
- [x] 실행 테스트 `tools/test-daily-issue-claim-system.js` (33) + 기존 daily-issue (31)
- [x] 정적 풀 58개 QUARANTINED 유지 (가짜 출처/evidence 미삽입)

### 후속 보류
- [x] 외부 RSS 수집기 → `buildDailyIssueCandidate` 연결 (1차 완료)
- [x] 사건 군집화·복제기사 제거 (보수적 1차)
- [ ] 서버 품질 게이트·자동 정정 추적
- [ ] 관리자 검수 콘솔
- [ ] 가입 초기 성향 설문

## ✅ 데일리 댓글 반응 LEGACY_LOCAL 성향 연결 (2026-08-05)

- [x] 데일리 댓글·대댓글 좋아요/싫어요 → `applyReactionScoresWithMult` 재사용
- [x] 좋아요↔싫어요 전환 시 게시판과 동일 취소→적용 순서
- [x] empathy·열람·체류·선택·작성 자체 성향 미반영 유지
- [x] 외계 actor/author·영토 미확인 시 성향 스킵
- [x] 실행형 테스트 보강 (`tools/test-daily-issue-system.js` + `shared/daily-issue-reaction-align-core.js`)

### 후속 보류
- [ ] 일반 게시판·데일리 반응을 공통 reaction event로 저장
- [ ] 두 경로를 동시에 05:00/17:00 서버 배치로 전환
- [ ] 클라이언트 즉시 성향 반영 제거
- [ ] 서버 SSOT·감사 로그

## ✅ 외계 submit 파티션 재검사 (2026-08-02)

## ✅ 데일리 이슈 자유 토론 전환 (2026-08-04)

- [x] 데일리 이슈 답변 선택 UI 제거
- [x] 댓글/대댓글/반응 stance 선행 게이트 제거
- [x] 데일리 이슈 선택/열람/체류 기반 성향 가중 경로 제거
- [x] 출처 표준 구조 정규화 + 독립 출처 계산 추가
- [x] 게시 품질 게이트 + QUARANTINED fail-closed 적용
- [x] 통과 이슈 없음 카테고리 준비 중 상태 표시
- [x] 집중 테스트 추가 (`tools/test-daily-issue-system.js`)

### 후속 보류 (우선순위)
- [ ] 외부 출처 수집 파이프라인
- [ ] 사건 군집화 및 복제기사 제거
- [x] 확인 내용·주장·불확실성 자동 분리 ← claim 파이프라인으로 완료
- [ ] 서버 품질 게이트
- [ ] 자동 정정 추적
- [ ] 가입 초기 성향 탐색

- [x] 버튼·모달·submit 동일 `resolveWriteButtonState` 규칙
- [x] RETURNED/SUSPENDED·hall·출신 불일치 submit 차단
- [x] 실패 시 저장·XP·피드 부수 효과 선행 차단
- [x] focused tests (`SC_ALIEN_UNIT_ONLY=1`)

### 보류
- [ ] 실 API 활성화 시 shared alien access core와 UI 권한 단일화
- [ ] 서버 영구 저장 경로 권한 테스트
- [ ] 클라이언트 localStorage 경로 제거
- [ ] 권한 reason 코드 공통화

## ✅ 제한형 리치 본문 에디터 (2026-08-02)

- [x] 새 글 모달 제한형 리치 에디터 (본문/소제목·인라인·목록·링크·인용·HR·undo/redo)
- [x] 본문 영역·모달 폭 확대 · 상단 설정 압축
- [x] `body` + `bodyFormat` · sanitization · plain 호환
- [x] 상세 안전 렌더 · excerpt/검색 태그 미노출
- [x] focused tests (`npm run test:board-rich-editor`)

### 보류
- [ ] 실제 DB rich content 저장 필드와 migration
- [ ] 운영 데이터 plain to rich 정책
- [ ] 본문 내 이미지 삽입 여부
- [ ] 모바일 에디터 툴바 최적화
- [ ] 임시저장
- [ ] 멘션과 해시태그
- [ ] 긴 글 성능 검증
- [ ] 게시글 수정 화면 round-trip UI (현재 수정 플로우 없음)

## ✅ 글 성격 카드 · 진영 토론 모드 (2026-08-02)

- [x] 새 글 모달 글 성격 선택 카드 (`debate`/`light`/`info`)
- [x] `factionBattleEnabled` 저장·normalize 기본 false
- [x] 유머 카테고리에서 진영 토론 비활성
- [x] 전황 UI 진입 조건에 진영 토론 ON 게이트
- [x] focused UI tests

### 보류
- [x] 실 DB/API `factionBattleEnabled` 컬럼·migration
- [ ] 작성 후 편집 토글 변경 UX
- [ ] 색각·모바일 모달 배치 추가 검증

## ✅ 진영 전황 UI — 중앙·외계 (2026-08-02)

- [x] 상세 레이어 PNG 깃발 연출 (`FactionFlagEffect` / `BalancedFactionFlagsEffect`)
- [x] faction battle UI contract (`shared/faction-battle-core.js`)
- [x] central/alien list battle strip
- [x] detail winner flag · balanced three flags
- [x] flag drop/impact/wave · reduced-motion
- [x] comment composer relocation (본문·반응 아래)
- [x] focused UI tests (`npm run test:faction-battle`)

### 보류
- [ ] 실제 reaction participant 집계
- [ ] 실제 DB/API 전황 데이터
- [ ] 운영용 가중치 확정
- [ ] threshold 튜닝
- [ ] 실제 flag asset 최종 적용
- [ ] 실제 sound asset
- [ ] 모바일 상세 배치
- [ ] 색각 접근성 추가 검증
- [ ] 외계 내부 진영 분류 최종 확정

## ✅ 영토 Hover 작전 정보 HUD (2026-08-02)

- [x] territory Hover summary HUD (`.territory-operation-hud`)
- [x] Hover border reduction · gradient 암막
- [x] current-stage single image · masked edge
- [x] parallel horizontal reveal · hover debounce/cancel
- [x] reduced-motion fallback · sound hook/cooldown
- [x] Hover UI tests (`SC_TEVO_UNIT_ONLY=1`)

### 보류
- [ ] 클릭 상세 UI 최종 정리 (`buildDetailStageCompare` 연결)
- [ ] 실제 효과음 asset 확정 · 사용자 효과음 설정
- [ ] 모바일 Hover 대체
- [ ] 실제 API population 연결
- [ ] 발전 단계 history 상세

## ✅ 세계 활동 영토맵 전용 표시 (2026-08-02)

- [x] `#screen-main` 활성 시에만 표시 · 게시판/상세/기타 화면 숨김
- [x] scrollTop·접기·데이터·DOM 유지 · `notifyAppViewChanged` 공용 연결
- [x] 관련 단위 테스트 (`SC_WORLD_ACTIVITY_UNIT_ONLY=1`)

## ✅ 세계 활동 패널 폭 · 문구 밀도 (2026-08-02)

- [x] preferred width 230px (220~240) · min 210 · gap 16 유지
- [x] 활동 문구 0.64rem · line-clamp 2 · 시간 한 줄
- [x] 관련 단위 테스트 (`SC_WORLD_ACTIVITY_UNIT_ONLY=1`)

## ✅ 세계 활동 패널 좌표 에디터 드래그 · 자동저장 (2026-07-31)

- [x] 좌표 에디터 ON 시 활동 패널 드래그
- [x] `sc_world_activity_panel_pos_v1` 자동 저장
- [x] 저장 좌표 우선 적용 · 초기화 시 리셋
- [x] 관련 단위 테스트 (`npm run test:world-activity-panel` UNIT_ONLY)

---

## ✅ 세계 활동 패널 top map 상단 정렬 (2026-07-31)

- [x] ACTIVITY_TOP_OFFSET 4 (0~16px)
- [x] 실제 overlap일 때만 top 보정 (좌표 에디터·영토 버튼)
- [x] navigation 아래 유지 · 가로/gap/LIVE_SCROLL 미변경

---

## ✅ 세계 활동 LIVE_SCROLL · 지도 비침범 재조정 (2026-07-31)

- [x] activity live-scroll mode (pagination 제거)
- [x] activity pagination removal
- [x] activity top positioning (map.top + offset)
- [x] activity/map strict boundary (style left/width, gap 16)
- [x] scroll preservation on prepend
- [x] 관련 테스트 (`npm run test:world-activity-panel`)

---

## ✅ 세계 활동 왼쪽 rail · 지도 비침범 · 채팅 복원 (2026-07-31)

- [x] activity left-side relocation (`#sc-left-side-stack`)
- [x] activity/map overlap prevention (`syncLeftActivityRailToMap`)
- [x] profile/activity stacking (z 35 < avatar 50)
- [x] chat height restoration (14rem 차감 제거)
- [x] chat open-tab visibility fix (펼침 시 세로 탭 숨김)
- [x] actual bounding overlap inspection (`gapToMap` / `overlapsMap`)
- [x] 관련 UI 테스트 (`npm run test:world-activity-panel`)

---

## ✅ 프로필 바깥 즉시 닫기 · 세계 활동 우측 재배치 (2026-07-31)

- [x] outside-click instant collapse (`animate:false`)
- [x] 수동 접기 애니메이션 유지 (`animate:true`)
- [x] activity right-side relocation (`#sc-right-side-stack` · 채팅 위) → **이후 왼쪽 rail로 재이동**
- [x] activity pagination (pageSize 4)
- [x] activity internal scrollbar removal
- [x] activity panel collapse (세션 메모리 · 채팅 독립)
- [x] chat/activity overlap tests · inspect (`__scInspectWorldActivityPanel`)
- [x] `npm run test:world-activity-panel` · `test:profile-outside-collapse` 갱신

---

## ✅ 프로필 바깥 클릭 접기 (2026-07-31)

- [x] 프로필 outside-click 접기 (`pointerdown` → `collapseProfilePanel`)
- [x] 프로필 interaction surface (`data-sc-profile-interaction-surface`)
- [x] 대표 업적 모달 예외
- [x] 활동 목록 모달 예외
- [x] 좌표 에디터 예외 (활성 중 자동 접기 비활성)
- [x] listener 중복 방지
- [x] 관련 UI 테스트 (`npm run test:profile-outside-collapse`)

---

## ✅ 대표 업적 선택 모달 UI (2026-07-31)

- [x] 선택 카드 겹침 제거 (icon/content/selection 분리)
- [x] 체크박스 영역 분리 · 독립 클릭
- [x] 선택 카드 업적명 최대 2줄
- [x] 획득 기록 분류 탭 (실제 category · 빈 탭 숨김 · 미분류)
- [x] 획득 기록 pagination (pageSize 5)
- [x] 획득 기록 내부 scrollbar 제거
- [x] 업적 모달 inspect 확장 (`inspectFeaturedAchievementModal`)
- [x] 관련 UI 테스트 (`npm run test:featured-achievement-modal`)
- [x] 선택 카드 고정 3열 · 체크박스 우측 동일 정렬 (`3.25rem | 1fr | 2.75rem`)
- [x] 프로필 `sc-profile-achievement` absolute 누수 제거
- [x] 상단 대표 업적 미리보기 (3슬롯 · 체크박스 없음)
- [x] 빈 대표 업적 슬롯
- [x] 하단 획득 기록 체크박스 선택
- [x] 페이지·분류 간 선택 유지
- [x] 최대 3개 선택 안내
- [x] 선택 완료 시에만 저장
- [x] 실회원 선택 목록 = 실제 획득 기록만 (canonical state 분리, 2026-08-12)
- [ ] 대표 업적 서버 저장·실 DB 연결 (기존 보류 유지)
- [ ] 시즌 종료 배치 · 히스토리 실이동 (기존 보류 유지)

---

## ✅ 사용자 이벤트 파이프라인 운영 기반 (2026-07-30)

- [x] 기존 명성·시민등급·업적·알림 구조 조사
- [x] user domain event contract (`shared/user-domain-event-core.js`)
- [x] reputation/citizen rank core (`shared/user-rank-core.js`)
- [x] citizen rank placeholder evaluation (`shared/citizen-rank-evaluation-core.js`)
- [x] achievement definition SSOT (`shared/achievement-definitions-core.js`)
- [x] achievement evaluation engine (`shared/achievement-evaluation-core.js`)
- [x] acquisition sequence plan (memory repo)
- [x] notification policy contract (`shared/user-notification-core.js`)
- [x] activity policy contract (`shared/user-activity-core.js`)
- [x] event orchestrator dry-run (`server/user-event-orchestrator.js`)
- [x] event persistence SQL 초안 (`migration_user_event_pipeline.sql` 미적용)
- [x] board event adapter (`server/board-user-event-adapter.js`)
- [x] alignment event adapter (`server/alignment-user-event-adapter.js`)
- [x] alien event adapter (`server/alien-user-event-adapter.js`)
- [x] evolution event adapter (`server/territory-evolution-user-event-adapter.js`)
- [x] user event client adapter (`public/user-event-data-adapter.js`)
- [x] 개발용 검사 함수 (`__scInspectUserEventSystem`)
- [x] user event 단위 테스트 (`npm run test:user-event`)
- [ ] migration_user_event_pipeline.sql 실제 적용
- [ ] 실제 event processing table/RPC 검증
- [ ] 실제 게시판 이벤트 연결
- [ ] 실제 empathy → 명성 이벤트 연결
- [ ] 실제 XP 지급량 확정 (Lv6~10 포함)
- [ ] 레벨 6~10 XP 임계값 확정
- [ ] 시민등급 계산 기준·임계값 확정
- [ ] alignment batch 시민등급 평가 연결
- [ ] 실제 업적 condition 데이터 source
- [ ] 기존 Mock 업적 실제 DB migration
- [ ] 실제 acquisitionSequence 동시성 검증
- [ ] 실제 업적 자동 부여
- [ ] 실제 중요 알림 생성
- [ ] 실제 활동 피드 생성
- [ ] 알림 DB retention·pruning 정책
- [ ] 활동 DB retention 정책
- [ ] 레벨업·영토변경 중앙 팝업 실연결
- [ ] 외계 이동·복귀 알림 실연결
- [ ] “전설이 되었다” 업적 실연결
- [ ] 영토 발전 단계 변경 알림 대상 정책
- [ ] 실제 이벤트 retry/dead-letter 정책
- [ ] 실제 event observability·관리자 화면
- [ ] 운영 캐시 무효화
- [ ] 모바일 알림·활동 UI

---

## ✅ 프로필 대표 업적·활동 목록 (2026-07-31)

- [x] 대표 업적 제목 2줄 UI
- [x] 획득 날짜 가독성 개선
- [x] 활동 요약 클릭 상태 (작성 글·댓글)
- [x] 사용자 콘텐츠 목록 contract (`shared/user-content-list-core.js`)
- [x] 작성글 목록 Mock/service
- [x] 댓글 목록 Mock/service
- [x] 활동 목록 모달 (`ScUserContentModal`)
- [x] pagination (pageSize 10)
- [x] 게시글 이동 adapter
- [x] 댓글 이동 adapter (anchor contract + fallback)
- [x] inspect 함수 (`__scInspectUserContentSystem`)
- [x] 신규 테스트 (`npm run test:user-content`)
- [ ] 실제 작성자별 게시글 API 연결
- [ ] 실제 작성자별 댓글 API 연결
- [ ] Supabase query/RLS 검증
- [ ] 익명 활동 본인 확인 방식 확정
- [ ] 다른 사용자 활동 공개 정책 최종 확정
- [ ] 삭제·블라인드 목록 보존 정책
- [ ] 댓글 anchor·highlight 실제 연결
- [ ] 스레드 부모 댓글 자동 펼침
- [ ] 외계 관측 댓글 실 route 연결
- [ ] Mock count와 실제 목록 count 단일화
- [ ] POST/COMMENT 이벤트 기반 캐시 무효화 실행
- [ ] 모바일 활동 목록 모달
- [ ] 실제 API pagination
- [ ] 활동 목록 검색·필터 필요 여부

## ✅ 외계 split UI 다듬기 (2026-07-31)

- [x] 외계 메인 좌우 폭 균형 조정 (52:48)
- [x] 내부 목록 스크롤 제거 (document scroll만)
- [x] 관측 목록 pagination (pageSize 6)
- [x] 커뮤니티 목록 pagination (pageSize 7)
- [x] 좌우 paging state 독립
- [x] 오른쪽 메뉴 PC 한 줄 정리
- [x] 글쓰기 버튼 오른쪽 패널 헤더 이동
- [x] 상단 겹침 요소 수정 (헤더 flex · stacking)
- [x] pagination·레이아웃 테스트

## ✅ 외계 메인 분할·출신 권한 파티션 (2026-07-30)

- [x] 외계 메인 좌우 split UI (지구 관측 / 외계 커뮤니티)
- [x] 왼쪽 메뉴 3개 (인기/중앙/영토 관측)
- [x] 오른쪽 메뉴 4개 (자유/개척/수호/명예의 전당)
- [x] 기본 선택 (왼쪽 인기 관측글 / 오른쪽 자유광장)
- [x] `alienOriginTerritory` contract (`shared/alien-origin-core.js`)
- [x] 출신별 파티션 권한 core (free/pioneer/guardian read·write 분리)
- [x] board-service 외계 파티션 read/write/comment/react 차단
- [x] 중앙/영토 관측 원문 참조형 목록 렌더 (복제 row 없음)
- [x] 읽기 전용 구역 안내 문구 + 글쓰기 버튼 제어
- [x] `__scInspectAlienSystem()` split/partition/origin/permissions 확장
- [x] 외계 SQL 초안 확장 (origin 컬럼 + observation_thread 참조형 table)
- [ ] migration 실제 적용
- [ ] origin 없는 기존 외계 사용자 운영 정책 확정
- [ ] 관측 thread 실제 API/DB 활성화
- [ ] 인기 관측/영토 관측 공식 확정
- [ ] 외계 댓글·반응 실저장 API 활성화
- [ ] 명예의 전당 계산식·scheduler 실연결

---

- [x] 기존 외계 시스템 구조 조사
- [x] 외계 상태 공용 contract (`shared/alien-moderation-core.js`)
- [x] 복귀 페널티 core (7/15/30/시즌)
- [x] moderation SQL 초안 (`migration_alien_system.sql` 미적용)
- [x] moderation repository/service 계약
- [x] 외계 접근 context
- [x] 외계 관측 contract
- [x] 외계 댓글 scope 구조 (`board_comments.audience_scope`)
- [x] 외계 반응 scope 연결 (기존 board reactions)
- [x] 외계 자유광장 board 재사용 구조
- [x] 외계 랭크 definition
- [x] 주간 인기인 persistence contract
- [x] 외계 API dry-run 구조
- [x] 외계 시스템 단위 테스트 (`npm run test:alien-system`)
- [x] 개발용 검사 함수 (`__scInspectAlienSystem`)
- [ ] migration_alien_system.sql 실제 적용
- [ ] 실제 moderation state 초기화
- [ ] 기존 외계 Mock 사용자 migration
- [ ] moderation signal 실제 생성 source
- [ ] 신고 review → signal 연결
- [ ] 복합 moderation 판정 공식
- [ ] 악의적 신고 유도 탐지
- [ ] 운영자 검토 화면
- [ ] 운영자 외계 이동·복귀 UI
- [ ] 실제 복귀 scheduler
- [ ] 시즌 종료 데이터 연결
- [ ] 4차 이상 복귀 정책 세부 확정
- [ ] 외계 관측 API 운영 활성화
- [ ] 외계 자유광장 운영 활성화
- [ ] 외계 댓글·반응 실데이터 연결
- [ ] 지구 사용자에게 외계 반응 수치 노출 여부
- [ ] 영토관측 인기글 선정 공식
- [ ] 지구/외계 댓글 TOP 정렬 공식
- [ ] 외계 랭크 점수 공식
- [ ] 1일 활동량 상한 수치
- [ ] 외계 랭크 임계값
- [ ] 외계 주간 인기인 계산 공식
- [ ] 반대 성향 좋아요 가중치
- [ ] 주간 선출 scheduler
- [ ] “전설이 되었다” 업적 실제 연결
- [ ] 외계 알림 실제 연결
- [ ] 외계 프로필 표시 확장
- [ ] 실제 외계 인원 count
- [ ] 모바일 외계 관측 UI

---

## ✅ 영토 발전 ↔ 실제 사용자 데이터 연결 준비 (2026-07-30)

- [x] 기존 영토 발전 구조 조사
- [x] evolution 공용 규칙 단일화 (`shared/territory-evolution-core.js`)
- [x] population adapter 계약
- [x] population repository 계약 (memory · supabase stub)
- [x] evolution service
- [x] snapshot schema 초안 (`migration_territory_evolution_system.sql` 미적용)
- [x] public evolution API 구조 (운영 비활성)
- [x] client adapter · API client
- [x] hover panel data contract 연결
- [x] 단계 하락 계산 · 중앙 독립 집계 검증
- [x] evolution cache 구조
- [x] evolution 단위 테스트 (`npm run test:territory-evolution`)
- [x] 개발용 검사 함수 (`__scInspectTerritoryEvolutionData`)
- [ ] migration_territory_evolution_system.sql 실제 적용
- [ ] 실제 territory population repository 연결
- [ ] 실제 사용자 영토 데이터 source 확정
- [ ] 전체 소속 인원 집계 쿼리 검증
- [ ] 휴면·정지·탈퇴 사용자 포함 여부
- [ ] 유효 시민 정의
- [ ] snapshot 집계 주기 · scheduler
- [ ] 실제 snapshot 저장
- [ ] 실제 public evolution API 활성화
- [ ] 실제 지도 hover API 연결
- [ ] 운영 캐시 TTL 튜닝
- [ ] 인원 급변 시 캐시·snapshot 정책
- [ ] 단계 상승·하락 알림
- [ ] 발전 단계 history UI
- [ ] 중앙 집계 정책 변경 여부 재검토
- [ ] 실제 외계 인원 집계
- [ ] 모바일 hover 대체 UI

---

## ✅ 프로필 UI ↔ 실제 사용자 데이터 연결 준비 (2026-07-30)

- [x] 프로필 데이터 흐름 조사 (Mini/Modal/작성자/팔로우/검색/랭킹)
- [x] public profile contract (`shared/public-profile-core.js`)
- [x] self/public mapper 분리 · sanitize
- [x] profile assembler (`server/user-profile-assembler.js`)
- [x] 영토 adapter 계약 (`user-profile-territory-adapter.js`)
- [x] 성향지도 adapter 계약 (`user-profile-alignment-map-adapter.js`)
- [x] 대표 업적 profile mapping (slot·owned·definition warning)
- [x] mini/modal 공용 adapter (`user-profile-data-adapter.js`)
- [x] 익명 profile open 차단 (`canOpenProfileFromAuthorContext`)
- [x] profile 상태 view model (LOADING/NOT_FOUND/PRIVATE/DELETED/UNAVAILABLE/LEGACY_MOCK)
- [x] profile cache 구조 (TTL·pending 병합·무효화)
- [x] profile 단위 테스트 (`npm run test:user-profile`)
- [ ] 실제 public profile API 운영 연결
- [ ] 실제 self profile API 운영 연결
- [ ] 실제 profiles·progression·achievement·follow join 검증
- [ ] 실제 user territory adapter 연결
- [ ] 실제 public alignment map 연결
- [ ] 6~10 XP 임계값 확정
- [ ] citizenRank 규칙 확정
- [ ] 프로필 사진 Supabase Storage 이전
- [ ] 대표 업적 실제 아이콘 연결
- [ ] 기존 Mock 프로필 제거
- [ ] 프로필 API 캐시 운영 튜닝
- [ ] 탈퇴·정지·비공개 계정 실제 정책 확정
- [ ] 모바일 프로필 연결
- [ ] 프로필 애니메이션 최종 조정

---

## ✅ 사용자 데이터 연결 구조·Supabase 운영 전환 준비 (2026-07-29)

- [x] 사용자 데이터 구조 조사 (인증·프로필·경험치·팔로우·업적·알림·활동·북마크·신고)
- [x] 운영 userId 규칙 (Supabase UUID 통일, guest/email 차단)
- [x] user progression 레벨 범위 1~10 (`USER_LEVEL_MIN`/`USER_LEVEL_MAX` 단일 원천)
- [x] 사용자 JWT RPC와 service-role RPC 권한 분리 (GRANT/REVOKE · auth.uid() 소유권)
- [x] 서버 전용 progression/achievement/알림·활동 생성 권한
- [x] userClient/adminClient 분리 (`user-data-supabase-repository.js` · `user-data-service.js`)
- [x] 사용자 데이터 통합 테스트 정상화 (`npm run test:user-data` 80/80)
- [x] `shared/user-data-config-core.js` · `shared/user-data-schema-core.js`
- [x] `supabase/migration_user_data_system.sql` (SQL만, 미적용)
- [x] user_progression 스키마 (XP/레벨/명성, citizen_rank null 허용)
- [x] user_follows 스키마 (자기 팔로우 금지, unique, count 원자 갱신 RPC)
- [x] user_achievements 스키마 (비시즌/시즌 중복 방지, acquiredAt/sequence 보존)
- [x] user_featured_achievements 스키마 (슬롯 1~3, 보유 검증 RPC)
- [x] user_notifications 스키마 (dedupe_key, 서버 전용 INSERT)
- [x] user_activity_events 스키마 (서버 전용 INSERT)
- [x] user_bookmarks 스키마 (unique, post_id FK 후속 migration 예정)
- [x] user_progression_events 스키마 (dedup unique, RPC)
- [x] RLS 정책 (각 테이블별)
- [x] RPC (apply_user_progression_event · toggle_user_follow · grant_user_achievement · set_featured_achievements · mark_user_notification_read · create/remove_user_bookmark)
- [x] `server/user-data-memory-repository.js` · `server/user-data-supabase-repository.js`
- [x] `server/user-data-service.js` · `server/user-data-mapper.js` · `server/user-data-routes.js`
- [x] `public/user-data-legacy-adapter.js` (inspectLegacyUserData · buildLegacyUserMigrationPreview)
- [x] `public/user-data-api-client.js` (LEGACY_LOCAL/DRY_RUN/OPERATIONAL 모드)
- [x] `window.__scInspectLegacyUserData()` 개발용 호환성 검사
- [x] 사용자 데이터 통합 테스트 80항 (`npm run test:user-data` — board/alignment 회귀 포함)
- [ ] `migration_user_data_system.sql` 실제 적용
- [ ] 기존 profiles 스키마와 실제 DB 충돌 검증
- [ ] 실제 사용자 데이터 migration preview (실 데이터 기반)
- [ ] 사용자별 이전 동의 또는 운영 정책
- [ ] 실제 progression 초기화 (기존 사용자 row 생성)
- [ ] 실제 팔로우 이전
- [ ] 실제 업적 이전
- [ ] 실제 알림·활동 피드 이전
- [ ] 실제 북마크 이전
- [ ] 프로필 사진 스토리지 이전
- [ ] USER_DATA API 운영 활성화 (`USER_DATA_OPERATIONAL=true`)
- [ ] 기존 UI API 치환 (localStorage → 운영 API)
- [ ] 실제 이벤트 기반 XP·명성 연결
- [ ] empathy 평판 이벤트 연결
- [ ] citizen_rank 컬럼 확정 후 CHECK 제약 추가
- [ ] 실제 영토 context 연결
- [ ] user_bookmarks post_id FK (board migration 후)

---

## ✅ 게시판 구조 충돌 정리·API 전환 준비 (2026-07-29)

- [x] 게시판 댓글 길이 기준 통일 (1500자, `board-config-core`)
- [x] empathy 역할 분리 (alignment 4종과 분리, adapter 보존)
- [x] planetVoters 레거시 분류 (DEFERRED, 운영 API 제외)
- [x] 영토 ID 변환 모듈 (`normalizeBoardTerritory` 단일 경계)
- [x] legacy 게시판 호환 adapter (`board-legacy-adapter.js`)
- [x] API dry-run 전환 구조 (`LEGACY_LOCAL` / `API_DRY_RUN` / `API_OPERATIONAL`)
- [x] localStorage 호환성 검사 (`__scInspectLegacyBoardCompatibility`)
- [x] 게시판 호환 테스트 (`npm run test:board-compat`)
- [ ] 실제 migration 적용
- [ ] 실제 게시판 API 활성화 (`BOARD_OPERATIONAL` / `API_OPERATIONAL`)
- [ ] 실제 localStorage 데이터 이전
- [ ] empathy 별도 DB 스키마 (`social_reactions` 등)
- [ ] 평판 시스템 실제 연결
- [ ] planetVoters 최종 삭제 또는 재설계
- [ ] 실제 영토 context adapter
- [ ] 실제 외계 상태 adapter
- [ ] alignment 실제 반응 연결

---

## ✅ 게시판 코어 운영 시스템 (2026-07-29)

- [x] 게시글 운영 스키마 (`board_posts`)
- [x] 댓글 운영 스키마 (`board_comments`, 대댓글 1단계)
- [x] 반응 운영 스키마 (`board_reactions`)
- [x] 신고 운영 스키마 (`board_reports`)
- [x] 4종 반응 규칙 · 계열별 취소·교체 RPC
- [x] 익명 응답 보호 (View + mapper)
- [x] 소프트 삭제
- [x] 지구·외계 반응 분리 집계
- [x] 게시판 서버 repository/service/routes
- [x] API client 기반 구조 (`public/board-api-client.js`)
- [x] 게시판 단위 테스트 (`npm run test:board-core`)
- [ ] migration 실제 적용
- [ ] 실제 사용자 영토 adapter
- [ ] 실제 외계 상태 adapter
- [ ] 실제 게시판 데이터 이전 (localStorage → DB)
- [ ] 실제 게시판 API 활성화 (`BOARD_OPERATIONAL`)
- [ ] 기존 Mock 게시글 이전
- [ ] 실제 반응 기반 alignment dataSource 연결
- [ ] 관리자 신고 검토 화면
- [ ] 자동 블라인드
- [ ] moderation 판정
- [ ] 운영 부하 테스트
- [ ] 수정 이력 테이블 (요구 확정 시)

---

## ✅ alignment 운영용 영토 판정 모듈 (2026-07-26)

- [x] 운영용 영토 판정 순수 함수 (`alignment-territory-rules.js`)
- [x] 공용 UMD 코어 분리 (`shared/alignment-territory-core.js`)
- [x] pending 영토 상태 처리
- [x] 2회 연속 확인
- [x] 개척·수호 직접 이동 방지
- [x] 영토 판정 단위 테스트 (`__scRunAlignmentTerritoryRuleTests`)
- [ ] 실제 정치 성향 배치 연결
- [ ] 사용자 DB 필드 추가
- [ ] 실제 영토 변경 저장
- [ ] 영토 변경 알림
- [ ] 시민등급 재판정
- [ ] 업적 연결
- [ ] Firebase/API
- [ ] 베타 실데이터 재조정

---

## ✅ alignment 운영용 배치 처리 모듈 (2026-07-28)

- [x] alignment 운영용 배치 처리 순수 함수 (`alignment-batch-processor.js`)
- [x] 공용 UMD 코어 분리 (`shared/alignment-batch-core.js`)
- [x] 점수 계산(DELTA_WINDOW_SCORE)과 영토 판정 연결
- [x] 사용자 여러 명 배치 처리
- [x] 배치 결과 요약
- [x] 사용자 단위 오류 격리
- [x] batchId 중복 처리 방지
- [x] 저장 직전 nextState 생성
- [x] 운영용 배치 단위 테스트 (`__scRunAlignmentBatchProcessorTests`)
- [ ] 실제 사용자 반응 데이터 연결
- [ ] 실제 사용자 상태 조회
- [ ] DB 트랜잭션
- [ ] 배치 이력 저장
- [ ] 05:00 / 17:00 실제 스케줄
- [ ] 서버 중복 실행 방지
- [ ] 시민등급 변경
- [ ] 업적 판정
- [ ] 중요 알림
- [ ] Firebase/API
- [ ] 베타 실데이터 검증

---

## ✅ alignment 운영 저장 스키마 (2026-07-28)

- [x] alignment 사용자 상태 저장 구조 (`users/{userId}.alignment`)
- [x] alignment 배치 이력 구조
- [x] 배치 실행 정보 구조
- [x] 저장용 update 변환 함수
- [x] persistence plan 생성
- [x] 저장 스키마 검증
- [x] 금지어 key 검사
- [ ] 실제 사용자 문서 마이그레이션
- [ ] Firebase/DB 연결
- [ ] DB 트랜잭션
- [ ] 배치 실행 기록 실제 저장
- [ ] 사용자별 이력 실제 저장
- [ ] 서버 중복 실행 방지
- [ ] 05:00 / 17:00 스케줄
- [ ] 알림·시민등급·업적 연결
- [ ] 베타 실데이터 검증

---

## ✅ alignment Supabase 운영 저장 시스템 (2026-07-28)

- [x] alignment Supabase SQL 스키마 (`migration_alignment_system.sql`)
- [x] user_alignment_state / alignment_batches / alignment_history 설계
- [x] alignment RLS 설계 (authenticated SELECT own only)
- [x] alignment RPC 원자적 저장 (`persist_alignment_batch_plan`)
- [x] 서버 전용 Supabase 관리자 클라이언트 (`server/alignment-supabase-admin.js`)
- [x] Supabase repository (`server/alignment-supabase-repository.js`)
- [x] 서버 배치 서비스 (`server/alignment-batch-service.js`)
- [x] dry-run 지원
- [x] 서버 dataSource 계약 + 테스트용 메모리 dataSource
- [x] shared alignment 스키마 코어 분리 (`shared/alignment-schema-core.js`)
- [x] batchId 생성 유틸 (Asia/Seoul)
- [x] 통합 테스트 (`npm run test:alignment-supabase`)
- [x] numeric 기반 저장 안정성 (`numeric(20,6)`)
- [x] 동시 batchId 충돌 처리 (`ON CONFLICT DO NOTHING`)
- [x] 서버 territory/batch core 분리 · vm/browser 비의존
- [x] service-role 노출 방지 검증
- [x] live 검증 스크립트 (`tools/verify-alignment-supabase-live.js`)
- [ ] 테스트 Supabase migration 실제 적용
- [ ] RLS 실제 검증
- [ ] RPC 실제 호출
- [ ] 실제 rollback 검증
- [ ] 실제 사용자 상태 초기화/마이그레이션
- [ ] 실제 반응 테이블 연결
- [ ] 실제 사용자 dataSource
- [ ] 서버 배치 잠금
- [ ] 05:00 / 17:00 스케줄 등록
- [ ] 운영 모니터링
- [ ] 알림·시민등급·업적 연결

---

## ✅ alignment 저장소 인터페이스와 메모리 저장소 (2026-07-28)

- [x] alignment persistence repository 계약
- [x] 테스트용 메모리 저장소
- [x] 원자적 저장 검증
- [x] batchId 중복 저장 방지
- [x] 사용자 상태 저장 검증
- [x] 사용자별 이력 저장 검증
- [x] 배치 기록 저장 검증
- [x] 저장 실패 rollback 테스트
- [ ] 실제 Firebase repository
- [ ] 실제 사용자 문서 마이그레이션
- [ ] 실제 DB 트랜잭션
- [ ] 서버 중복 실행 방지
- [ ] 배치 실행 잠금
- [ ] 05:00 / 17:00 스케줄
- [ ] 알림·시민등급·업적 연결
- [ ] 베타 실데이터 검증

---

## ✅ 정치 성향 5차 영토 안정화 방식 비교 (2026-07-26)

- [x] 영토 안정화 방식 비교 시뮬레이션 (`TERRITORY_STABILIZATION_COMPARISON`)
- [x] 진입·이탈 경계 분리 분석 (hysteresis 200 / 400)
- [x] 2회 연속 배치 확인 분석
- [x] 경계 분리+연속 확인 병합 분석
- [x] 왕복 감소율 분석
- [x] 분류 지연 분석
- [x] 적중률 손실 분석
- [x] 동일 사용자 방식별 비교 · `__scRunTerritoryStabilization*` · 고정 테스트
- [ ] 안정화 방식 최종 결정
- [ ] 중앙 범위 최종 결정
- [ ] 실제 영토 변경 로직 반영 (배치·저장 연결)
- [ ] 3회 연속 확인 검토
- [ ] 영토 변경 쿨다운 검토
- [ ] 최소 체류기간 검토
- [ ] 실제 사용자 데이터 연결 · 봇·어뷰징 감쇠 · DB/API
- [ ] 시민등급·업적·알림 연결

---

## ✅ 정치 성향 4차 영토 왕복 원인 분석 (2026-07-26)

- [x] 영토 왕복 원인 분석 (`TERRITORY_OSCILLATION_CAUSE_ANALYSIS`)
- [x] 배치 변화 원인별 기여도 분리 (신규·취소·30일/99일 만료)
- [x] 반응 취소 주도 · 기간 만료 주도 이동 분석
- [x] 경계선 민감 왕복 · 방향 반전 횟수 분석
- [x] 왕복 경로 유형 분류
- [x] 동일 사용자 기준값별 비교
- [x] 설명 불가능한 계산 차이 검증
- [x] `__scRunTerritoryOscillationCause*` · 빠른/전체 분석 · 고정 테스트
- [ ] 분석 결과 검토
- [ ] 중앙 범위 최종 결정
- [ ] 영토 안정화 규칙 검토 → 5차 시뮬레이션으로 비교 완료 · 최종 결정은 미완
- [ ] 실제 사용자 데이터 연결 · 봇·어뷰징 감쇠 · DB/API
- [ ] 시민등급·업적·알림 연결

---

## ✅ 정치 성향 3차 대규모 기준값 비교 (2026-07-26)

- [x] 1,000명 대규모 성향 시뮬레이션
- [x] 중앙 범위 4안 비교 (±1000 / ±800 / ±600 / ±400)
- [x] 10개 seed 반복 실행
- [x] 30일·99일 결과 비교
- [x] 기준값별 적중률 · 중립 잔류율 · 반대 영토 오분류 · 영토 왕복률 분석
- [x] seed 평균·편차 분석
- [x] 기준값에 따라 달라지는 사용자 추적
- [x] `__scRunLargeOrientation*` · 빠른/전체 실행 분리 · 3차 고정 테스트 18항
- [ ] 결과 검토 후 중앙 범위 최종 결정
- [ ] 반응 가중치 최종 조정
- [ ] 배치당 ±500 상한 최종 조정
- [ ] 실제 사용자 데이터 연결 · 봇·어뷰징 감쇠
- [ ] 시민등급 · 업적 · 중요 알림 연결
- [ ] 원자적 DB 저장 · Firebase/API
- [ ] 베타 전 최종 회귀 테스트

---

## ✅ 정치 성향 2차 Mock 시뮬레이션 (2026-07-26) — 0점 시작·숨은 성향

- [x] 0점 시작 정치 성향 시뮬레이션 (`ZERO_START_LATENT_ORIENTATION`)
- [x] 숨은 행동 성향 기반 반응 생성 (`latentOrientation` · 점수 직접 가산 없음)
- [x] 120명 개척/중립/수호 행동 성향 구성 (각 40)
- [x] 30일·99일 비교
- [x] 자기 성향 방향 적중률 · 반대 영토 오분류율 · 중앙 잔류율 · 첫 영토 이동 시점
- [x] 2차 고정 테스트 16항 · `__scRunZeroStart*` / `__scRunAllOrientationSimulations`
- [ ] 1차·2차 결과에 따른 가중치 조정
- [ ] 중앙 범위 최종 결정
- [ ] 배치당 ±500 상한 최종 조정
- [ ] 1,000명 대규모 시뮬레이션 → 3차 섹션으로 완료
- [ ] 실제 사용자 데이터 연결 · 봇·어뷰징 감쇠 · DB/API
- [ ] 시민등급·업적·알림 연결

---

## ✅ 정치 성향 1차 Mock 시뮬레이션 (2026-07-26)

- [x] 기본 성향 점수 기반 Mock 사용자 · 120명 1차 시뮬레이션
- [x] 개척/중앙/수호 이동 테스트 · 반응 가중치 계산
- [x] 99일/30일 롤링 계산 · 배치당 이동 상한 · 반응 취소 테스트
- [x] 영토 이동 경로 보고 · 고정 테스트 세트
- [x] 개발용 `__scRunOrientation*` 등 (배포 전 제거/비활성 대상)
- [x] 기본 점수 반복 참조 제거 · 누적 반응값 배치 차이 계산 (`DELTA_WINDOW_SCORE`)
- [x] 동일 반응 반복 가산 방지 · 반응 취소 역방향 반영 · 기간 창 만료 반영
- [x] 수정된 고정 테스트 (24항)
- [x] 모두 0점에서 시작하는 2차 시뮬레이션 (별도 섹션)
- [x] 숨은 행동 성향 기반 분화 테스트 (별도 섹션)
- [x] 1,000명 대규모 무작위 시뮬레이션 (3차 섹션)
- [ ] 실제 데이터 연결 · 봇·어뷰징 감쇠 · DB/API
- [ ] 시민등급 변경 · 업적 연결 · 중요 알림 · 베타 기준값 최종 조정

---

## ✅ 업적 시스템 2차 Mock 지급 (2026-07-26)

- [x] Mock 업적 지급 함수 (`grantCurrentUserAchievement`)
- [x] 영구 업적 중복 방지 · 시즌 업적 seasonId 중복 방지
- [x] 획득 날짜·순번 생성 · 획득 알림 연결 · 업적 히스토리 조회
- [x] 확정 업적 지급 시뮬레이션 (`__scGrant*` · 배포 전 제거/비활성 대상)
- [ ] 실제 게시글·댓글·공감·레벨 이벤트 연결
- [ ] 실제 시즌 시작일 · 시즌 종료 배치 · 시즌 히스토리 자동 이동
- [ ] 서버 중복 지급 방지 · 원자적 저장 · Firebase / DB / API
- [ ] 실제 사용자 데이터 · 업적 회수 정책 · 업적 전체 도감 · 모바일 UI

---

## ✅ 업적 시스템 1차 사용자 기능 (2026-07-26) — Mock

- [x] 사용자 업적 Mock 구조 (`user-achievements.js`)
- [x] currentAchievements · seasonHistory · featuredAchievementIds
- [x] acquiredAt · acquisitionSequence
- [x] 대표 업적 직접 선택 · 최대 3개 검증 · 체크 순서 프로필 반영
- [x] 획득 날짜 표시 · 프로필 대표 업적 연결
- [x] 현재 보유하지 않은 업적 자동 제거 헬퍼 (`removeUnavailableFeaturedAchievements`)
- [x] 개발용 대표 업적 테스트 함수 (`__sc*` — 배포 전 제거/비활성 대상)
- [ ] 실제 업적 지급 · 실제 사용자 저장 · Firebase / DB / API
- [ ] 시즌 종료 배치 · 시즌 히스토리 실제 이동 · 대표 업적 서버 저장
- [ ] 동시성 처리 · 업적 전체 도감 · 잠긴 업적 화면 · 업적 알림 · 모바일 UI

---

## ✅ 시즌 설정 스키마 (2026-07-26) — 설정·검증만

- [x] 시즌 길이 6개월 정책 확정
- [x] 첫 시즌 시작일 미정 상태 지원 (`UNSCHEDULED`)
- [x] `season-config.js` · 시즌 상태 상수 · 설정 검증 함수
- [x] 다음 시즌 시작 배치 전환 방식 메타데이터 (`NEXT_SEASON_START_BATCH`)
- [ ] 첫 시즌 시작일 확정
- [ ] seasonId 생성 규칙 · 6개월 단위 시즌 계산
- [ ] 시즌 시작·종료 판정 · 다음 시즌 생성 · 시즌 시작 배치
- [ ] 시즌 종료 초기화 · 시즌 업적 진행도 · 시즌 히스토리
- [ ] 대표 업적 자동 해제 · 실제 저장·DB·API

---

## ✅ 베타 초기 업적 정의 (2026-07-26) — 데이터만

- [x] 업적 정의 데이터 기본 구조 (`achievement-definitions.js`)
- [x] 베타 초기 업적 후보 11개 등록
- [x] 업적 카테고리 기본 구조 (GROWTH~SPECIAL)
- [x] 업적 희귀도 메타데이터 연결 (기존 rarity frames 재사용)
- [x] 프로필 Mock 업적 정의 참조 (territory-citizen · dialogue-across-territories · beta-citizen)
- [x] 가입 즉시 자동 상태(`first-step`) 업적 제외 (2026-07-26)
- [x] 베타 업적 11개 이름 검토 · 설명문 정리 (2026-07-26)
- [x] 베타 업적 9개 조건 확정 · 프로필 Mock 표시명 연결 확인 (2026-07-26)
- [x] 업적 유지 유형 분류 · `persistenceType` 필드 · isSeasonal 정합성 검증 (2026-07-26)
- [x] persistenceType 조회 헬퍼 · 정의 검증 함수 갱신 (2026-07-26)
- [x] 시즌 업적의 현재 보유 상태와 히스토리 구분 정책 확정 (2026-07-26)
- [x] 시즌 종료 후 프로필 비노출 정책 확정 (2026-07-26)
- [x] 시즌 종료 후 대표 업적 자동 해제 정책 확정 (2026-07-26)
- [x] 빈 슬롯 자동 대체 금지 정책 확정 (2026-07-26)
- [ ] `dialogue-across-territories` 조건 확정
- [ ] `witness-of-an-era` 조건 확정 · EVENT_PERMANENT 반복 기준
- [ ] 시즌 엔티티 · seasonId 구조
- [ ] 현재 보유 업적 저장 구조 · 시즌 히스토리 저장 구조
- [ ] 시즌 종료 초기화 함수 · 시즌 업적 대표 슬롯 자동 해제 · 빈 슬롯 처리
- [ ] 시즌 반복 지급 · acquiredAt · acquisitionSequence · 실제 지급 · DB/API · 동시성
- [ ] 업적 히스토리 UI · 업적 알림 · 대표 업적 서버 저장
- [ ] 실제 업적 아이콘 전체 제작 · 운영자 지급/회수
- [ ] ScMiniProfile 아이콘 구조 (텍스트 목록 — 보류)

### 정책 메모 — SEASON_REPEATABLE / 대표 업적 / 저장 구분 (구현 전)

**대표 업적 시즌 종료**
- `SEASON_REPEATABLE`은 현재 시즌에 획득한 경우에만 대표 업적으로 선택 가능
- 시즌 종료 후 해당 업적은 대표 업적 선택 대상에서 제외
- 이미 대표로 선택돼 있었다면 자동 해제 예정 (코드 미구현)
- 자동 해제된 슬롯에 다른 업적을 자동 배치하지 않음 · 빈 슬롯 유지
- 과거 시즌 업적은 히스토리 화면에서만 조회 가능
- `PERMANENT_ONCE` · `EVENT_PERMANENT`는 시즌 종료 후에도 대표 업적으로 유지 가능

**현재 보유 상태** (프로필 표시 · 대표 선택에 사용)
- 현재 시즌에 활성화된 시즌 업적 · 영구 업적 · 사건형 영구 업적

**시즌 히스토리** (프로필 표시에 사용하지 않음)
- 종료된 시즌의 획득 기록 · `seasonId` · `acquiredAt` · 해당 시즌 획득 여부

**중요:** 히스토리 보존 ≠ 현재 획득 상태 유지. 과거 시즌 기록이 히스토리에 있어도 현재 보유·대표 업적으로 취급하지 않음.

---

## ✅ 프로필 대표 업적 희귀도 테두리 (2026-07-26)

- [x] 프로필 대표 업적 희귀도 테두리 연결 (COMMON~LEGENDARY · 한글 파일명 유지)
- [x] Mock 업적 희귀도 표시 검증 (BRONZE/GOLD/LEGENDARY · `__scPreviewAchievementRarities`)
- [ ] ScMiniProfile 희귀도 테두리 (텍스트 목록 구조 — 보류)
- [ ] 실제 업적 목록 · 지급 조건 · API · 대표 업적 선택 UI · 사용자 업적 연결

---

## ✅ 영토 발전 Hover 패널 (2026-07-25) — Mock UI

- [x] 지도 영토 hover 시 이전·현재·다음 발전 이미지 패널
- [x] Mock 단계·인원 → 원천 인원 + 자동 단계 판정 (2026-07-25)
- [x] 집계·단계 하락 정책 확정 · 집계 함수/데이터 계약 (`territory-evolution-population.js`, 2026-07-25)
  - 현재 전체 소속 회원 · 외계 이동자 단일 영토 · 단계 상승·하락
  - 실데이터 API 없음 → Mock fallback 유지
- [x] Hover 다음 단계 필요 발전 인원 · 구간 진행률 바 (2026-07-25)
- [x] Mock 발전 단계 경계값·상승/하락·필요 인원·진행률·중앙 가중·외계 단계명 검증 (2026-07-26)
- [ ] 실회원 census API · Supabase/서버 영토 소속 필드 · live 주입 연동
- [x] 외계행성 전용 단계 표시명 분리 (2026-07-25)
- [x] 단계 안내 UI 통일 · 현재 단계 강조 (2026-07-25)
- [x] peek 슬라이드 레이아웃 · 인구수 강조 · alien 왼쪽 슬롯 (2026-07-25)
- [x] 전단계·다음단계 안내 overlay 분리 (문구 잘림 수정, 2026-07-25)

---

## ✅ 영토 발전단계 이미지 등록 (2026-07-25) — 에셋

- [x] `public/assets/territory-evolution/` 이미지 등록
- [x] `public/territory-evolution-images.js` 경로 목록
- [x] 수호 근대·현대·미래 이미지 보충 (2026-07-25)
- [x] 발전단계 패널 UI · hover 연동 (Mock, 2026-07-25)

---

## ✅ 영토 지도 업데이트 (2026-07-22)

- [x] 새 통합 영토 이미지 적용 완료
- [x] 새 이미지 기준 영토별 히트존 적용 완료
- [x] 영토별 마우스 호버 동작 적용 완료
- [ ] 중앙광장 성장 이미지 — 아직 기획 및 제작 단계 (코드 미포함)
- **기준선:** 현재 지도 이미지 · 히트존 좌표계 · 호버 동작 유지

---

## 🔜 최우선 (진행중) — Follow System v1 2차 QA

> **구현은 완료.** 아래 항목을 모두 확인한 뒤 버그 수정 → QA 통과 시 완료 처리.

- [ ] 언팔로우 버튼 정상 동작 (팔로잉 탭만)
- [ ] `toggleFollow()` 정상 호출
- [ ] `sc_follow_v1` localStorage 저장 정상
- [ ] HUD 팔로워/팔로잉 숫자 즉시 갱신
- [ ] 팔로잉 목록 즉시 갱신 (언팔로우 후 행 제거)
- [ ] Empty 상태 (팔로워·팔로잉 각각)
- [ ] Toast (언팔로우 완료 안내)
- [ ] 게시글 팔로우 버튼 동기화 (`board__follow-btn`)
- [ ] 랭킹 영향 여부 (회귀 없음 확인)
- [ ] ProfileFrame 영향 여부 (팔로워 수·표시 회귀 없음 확인)

---

## 🔜 이후 작업 예정

1. [ ] **Settings System v1**
2. [ ] **Admin System v1**

---

## ⏸️ 보류 — 기능

- [ ] 업적 시스템 (설계 완료 후 개발)
- [ ] 타인 프로필 팔로워 목록
- [ ] 추천 사용자
- [ ] 친구 시스템
- [ ] 차단 기능
- [ ] 팔로워/팔로잉 검색
- [ ] 서버 동기화
- [ ] 실시간 DB 연동
- [ ] Follow 후속: 검색/페이지네이션

---

## ⏸️ 보류 — UI

- [ ] ProfileFrame 전체 UI 폴리싱
- [ ] 팔로워 영역 최종 디자인
- [ ] 버튼/배지 디자인 통일
- [ ] 아이콘 스타일 통일
- [ ] 전체 모달 UI 통일
- [ ] 최종 반응형 점검

---

## ✅ Search System v1 — 완료 (2026-07-12)

> 통합검색: 검색창 하나 · displayName 기반 · 결과 **「시민」+「토론」** · userId 검색 UI 없음

1. [x] **displayName 통일 기반** — `resolveDisplayName(userId)` · `sc_display_names_v1` (2026-07-12)
2. [x] **통합검색 HUD** — `sc-map-tab-search` · `sc-search-modal` (2026-07-12)
3. [x] **시민 검색** — `collectDisplayNameIndex()` · 프로필 연결 (2026-07-12)
4. [x] **토론 검색** — bundle 제목/본문/작성자 displayName · `__scBoardNavigateToPost` (2026-07-12)

---

## ✅ Community System v2 — 북마크 목록 1차 (2026-07-12)

1. [x] HUD 북마크 버튼 · 목록 모달 (`bookmark-list.js`)
2. [x] `sc_bookmarks_v1` 최신순 목록 · 게시글 이동 · 삭제(해제) · Toast
3. [ ] 북마크 폴더/태그/메모 등 고도화 (v2 후속)

---

## ✅ Follow System v1 — 구현 완료 (2026-07-12) · QA 대기

### 1차 — 팔로워·팔로잉 목록

1. [x] 좌측 HUD 팔로워/팔로우 수 클릭 진입 (`follow-list-modal.js`)
2. [x] 2탭 모달 · 시민 목록 · 프로필 연결 · Empty · ESC/배경/X
3. [x] `FollowSystem.getFollowers` / `getFollowing` · `sc_follow_v1` · `__scFollowLists`

### 2차 — 팔로잉 탭 언팔로우

1. [x] 팔로잉 탭 행 우측 언팔로우 · `toggleFollow` · Toast · 목록·HUD 즉시 갱신
2. [ ] **2차 QA** — 위 「최우선」 체크리스트 통과 후 완료 처리

---

## ✅ ProfileFrame — 표시 안정화 (2026-07-12)

1. [x] 활동 요약 / 영토 기록 표시 안정화 — `normalizeProfileActivityDisplay` · `normalizeTerritoryRecordDisplay`
2. [x] 값 없는 데이터 표시 규칙 정리 — `finalizeProfileDisplayFields` · `value||'--'` 금지
3. [x] 0 표시 정책 — 활동·영토 숫자 **0→`--`** · 팔로워 **0→`0`**
4. [x] HUD/모달 Overlay 동기화 — `ensureProfileFrameListLayerBounds` · `__scInspectProfileFrame`

---

## ✅ ProfileFrame 상단 팔로워 표시 (2026-07-12)

1. [x] 명성 위 `followersLabel` · `followers` 레이어 · 4스킨 좌표 통일
2. [x] `FollowSystem.getFollowerCount` · 0명 `0` 표시 · 본인/타인 동일
3. [x] 팔로워 UI — 금색 라벨 · 명성 톤 숫자 박스 · 에디터 X/Y/W/H · **아이콘 없음**

---

## 🔜 다음 작업 (ProfileFrame·기타)

> **2026-07-12 완료:** ProfileFrame 활동/영토 표시 안정화 · 팔로워 상단 표시 · Follow v1 1·2차 구현  
> **2026-07-10 완료:** 성향지도 SVG · 좌표 에디터 캘리브레이션 (최대치 미리보기 · AI 복사)  
> **표준 파이프라인:** `SC_PROFILE_DATA` → `getCurrentProfileData()` → `renderProfileData()` → ProfileFrame

1. [x] **성향 지도** SVG 오버레이 (`alignmentMapLayer` · `SC_PROFILE_LAYOUT.alignmentMap`) (2026-07-10)
2. [ ] **아바타** 구현
3. [x] **대표 업적** 구현 (`achievementLayer` · 슬롯 UI · 아이콘/이름/날짜 좌표 에디터) (2026-07-10)
4. [x] `getCurrentProfileData()` — `loadCurrentUserProfile()` merge 어댑터 (Auth · API 캐시 · progression · 미로그인 Mock fallback, 2026-07-10)
5. [x] 실제 경험치·활동·영토 집계 1차 + **표시 안정화** — 활동 5칸 · 영토 4칸 · 0→`--` · 모달 Overlay (2026-07-12)
6. [x] `alignmentMap` 좌표 확정 — center/pioneer 305,355 · guardian/alien 309,360 (2026-07-10)
7. [ ] 경험치 게이지 위치 최종 보정 (좌표 에디터)
8. [ ] `SC_PROFILE_LAYOUT` **최종 확정** (좌표 에디터 · 4스킨별)
9. [ ] 4개 영토 스킨 **최종 테스트** (PNG + 좌표 + 데이터 갱신)
10. [ ] ProfileFrame **모바일 최종 보정**

### 프로필 UI 확정 방향 (구현 시 준수)

- 유저가 주인공, 영토는 배경 정체성
- ProfileFrame = PNG + 오버레이 HUD (현재 기본 UI)
- legacy 영토 시민 카드 — hidden · 향후 아바타·레이더 연동 참고용
- 성향 **레이더만** · 가로 게이지·퍼센트 노출 **금지** (ProfileFrame exp% 텍스트·expGauge는 예외)
- 가입일 **금지** · 소속 **중복 금지**
- 경험치 게이지(expGauge) — **영토 무관** · 바 100% 배경 · % 텍스트만 실제 값 · **좌 밝은 노랑 → 우 짙은 갈색** 그라데이션

### ProfileFrame 완료 체크리스트 (2026-07-09) ✅

- [x] PNG 기본 UI · 4종 `territorySkin` · legacy hidden
- [x] 좌측 하단 HUD · 접기 버튼 · PNG contain · 크기·위치 고정
- [x] `SC_PROFILE_LAYOUT` px (1024×819) · scale · 좌표 에디터
- [x] `SC_PROFILE_DATA` · `renderProfileData()` · `getCurrentProfileData()` · `refreshCurrentProfile()`
- [x] 텍스트 13슬롯 + territorySkin PNG + expGauge
- [x] expGauge 노란/골드 · `{ x: 392, y: 126, w: 590, h: 10 }`

---
## 완료된 작업 ✅

- [x] **Search System v1 (2026-07-12)** — `search-system.js` · 통합검색(시민+토론) · displayName · bundle 스캔 · 프로필/게시글 이동

- [x] CSS 변수 기반 디자인 시스템 구축 (`--sc-sp-*`, `--sc-r-*`, `--sc-bc-*` 등)
- [x] UI Kit 클래스 정의 (`sc-panel`, `sc-card`, `sc-badge`, `sc-btn`, `sc-section-title`, `sc-tag`, `sc-input`)
- [x] 게임 HUD 전체 디자인 언어 확립
- [x] 버튼 Primary / Secondary 스타일 통일
- [x] 카드 공통 스타일 (border, radius, padding, shadow, gap)
- [x] 섹션 헤더 스타일 통일
- [x] 인풋 필드 스타일 통일
- [x] 배지(Badge), 태그(Tag) 스타일 정의
- [x] 패널 공통 border / radius / background
- [x] 여백(Spacing) 규칙 정리
- [x] 폰트 계층(Font Rule) 정리
- [x] Transition 속도 통일 (`--sc-ease`)
- [x] 영토별 색상 체계 정리 (centrist/reform/order/alien)
- [x] `data-territory` 기반 CSS 자동 테마 전환 구조

### 영토 명칭 통일 (2026-07-02)

- [x] 개혁영토 → 개척영토 (내부 ID 유지)
- [x] 질서영토 → 수호영토 (내부 ID 유지)
- [x] 깐따삐아 → 외계행성 (내부 ID KANTAPBIYA 유지)
- [x] index.html 전체 사용자 표시 문자열 교체
- [x] permissions-guide.js 영토명 교체
- [x] config/world-territories.js labelKo 교체
- [x] config/alignment-rank-limits.js notesKo 교체
- [x] docs 문서 영토명 교체

### 영토 신념 시스템 (2026-07-02)

- [x] `public/territory-beliefs.js` 생성 — Single Source of Truth
- [x] `window.TERRITORY_BELIEFS` 전역 노출 (IIFE 패턴)
- [x] `displayName`, `subtitle`, `belief`, `philosophy` 필드 구조 확립
- [x] `index.html` 인라인 신념 상수 제거 → 외부 파일 참조로 전환
- [x] `renderTerritoryCreed()` — `belief.belief` 필드 참조
- [x] `philosophy` 필드 저장만 유지 (프로필 미노출)
- [x] HUD 서브텍스트 `displayName` 기반 동적 생성
- [x] `.avatar-territory-creed__motto` CSS `white-space: pre-line` 추가
- [x] 신념 문장 4종 최종 확정

### 중앙광장 (Central Plaza)

- [x] 중앙광장 레이아웃 개편 (데일리 이슈 → 2열 카드 → 게시글 → 사이드바)
- [x] 데일리 이슈 섹션 Primary 강화 (굵은 accent line, shadow)
- [x] 인기글/실시간 현황 / 영토 현황 2열 카드 구성
- [x] 게시글 섹션 카드 스타일 통일
- [x] 하단 헤더 blur 고정 요소 제거
- [x] 게시글 카드 압축 (padding, gap, 버튼 compact)
- [x] 게시글 카드 붙여넣기 버튼 제거 (프로필 화면으로 이동)
- [x] 게시글 카드 레이아웃 선정 기준 확립
- [x] 반응 버튼 사용자 참여 기반 compact 구성
- [x] 광장 정보 섹션 전체 재 + 구분선

### 메인 지도 / 히트존 (2026-07-04)

- [x] 신규 16:9 원시시대(tribal-s1) 메인 영토맵 교체
- [x] tribal-s1 지도용 히트존 좌표 에디터 수정본 적용 (`territory-hit-zones.json`)
- [x] viewBox `0 0 1600 900` 기준 progressive / conservative / plaza / kantapbiya 4영역 재조정
- [x] 메인맵 레이아웃 확대 및 화면 최적화
- [x] 영토 엠블럼 PNG 교체 (`assets/territory-icons/`)
- [x] 영토 배너·엠블럼 WEBP 에셋 정리 (`assets/territories/banners/`, `emblems/`)
- [x] 영토 배너·엠블럼 WEBP 프로필 신념 박스 1차 연결 (CSS 변수 + 배경)

### ProfileFrame 프로필 시스템 (2026-07-09)

- [x] PNG 기반 ProfileFrame 기본 UI · legacy `hidden`
- [x] 4종 영토 프로필 PNG (`profiles/center|pioneer|guardian|alien.png`)
- [x] `territorySkin` → `setProfileTerritorySkin()` PNG 자동 변경
- [x] 좌측 하단 HUD · 접기 버튼 Frame 내 우하단 · PNG contain
- [x] `%` 좌표 폐기 → `SC_PROFILE_LAYOUT` px (1024×819) · scale
- [x] `SC_PROFILE_LAYOUT_BY_SKIN` (center=pioneer · guardian/alien 개별)
- [x] 대표 업적 슬롯 좌표 에디터 (`achievement` · `achievementSlots` · AI 복사) (2026-07-10)
- [x] 성향지도 축 스케일 그룹 분리 (`SC_PROFILE_ALIGNMENT_AXIS_MAX_BY_GROUP`) (2026-07-10)
- [x] `SC_PROFILE_DATA` 단일 더미 객체
- [x] `renderProfileData(data)` — 텍스트 · PNG · expGauge
- [x] `getCurrentProfileData()` Mock Adapter · `refreshCurrentProfile()`
- [x] 경험치 게이지 `expGaugeLayer` · 노란/골드 · 100% Fill · expLayer 텍스트 상위
- [x] `expGauge` 좌표 `{ x: 392, y: 126, w: 590, h: 10 }`
- [x] 성향지도 SVG `alignmentMapLayer` · `data.alignment` · `renderProfileAlignmentMap()` (2026-07-10)
- [x] 대표 업적 `renderProfileAchievements()` · 슬롯 UI (2026-07-10)
- [x] `alignmentMap` 좌표 `{ x: 304, y: 353, w: 190, h: 190 }` (임시)
- [x] **활동 요약 실데이터 1차** — `resolveUserProfileActivity` · posts/comments/receivedLikes/discussions · `aura` Mock 유지 (2026-07-12)
- [x] **영토 기록 실데이터 1차** — `resolveUserTerritoryRecord` · 현재소속/이동/영향력/등급 · `__scTerritoryRecord` (2026-07-12)
- [x] **영토 기록 표시 기준 정정** — 최초 소속 폐기 · 현재 소속 + 표시 fallback 단일화 (2026-07-12)
- [x] `__scProfileActivity(userId)` 디버그 API

### 프로필 패널 (2026-07-04 Grid 재설계)

- [x] 프로필 UI Grid 기반 구조 재설계 시작 (profile-main + profile-summaries)
- [x] 오른쪽 성향 가로 게이지 제거, 4축 성향 레이더로 대체
- [x] `territory-beliefs.js` 기반 신념 HUD (엠블럼 + belief + ○○의 신념)
- [x] profile-summary-* 요약 섹션 class 분리
- [x] 프로필 HUD 정보 바 통합 · 신념/아바타/레이더/하단카드 compact 다듬기
- [x] 영토 시민 카드 레이아웃 골격 재정렬 (좌 아바타 / 우 정보+보조배너+레이더, 하단 3카드)
- [x] 프로필 패널 레이아웃 안정화 (패널 스크롤, 클리핑 복구, 배너 72px·레이더 min 150px)
- [x] 프로필 방향·항목명·에셋 v1 정의 문서화 (PROJECT_CONTEXT / TODO / CHANGELOG)
- [x] 프로필 내부 스크롤 제거
- [x] 프로필 세로 여백 압축
- [x] 신념 카드 높이 최적화
- [x] 성향 레이더 크기 조정
- [x] 하단 3개 요약 카드 첫 화면 노출 레이아웃 최적화

### 프로필 패널 (이전)

- [x] 프로필 패널 게임 HUD 플레이어 카드 리디자인
- [x] 플레이어 카드 (4:5 비율, 영토별 하단 바 아이콘 구조)
- [x] 아바타 슬롯 HUD형태 (SVG 플레이스홀더, HUD 형태)
- [x] 영토 소속 배너 하단 오른쪽 배치
- [x] 플레이어 카드 HUD 코너 장식 강화
- [x] 명예 장식 슬롯 (프레임/칭호/휘장/오라) → 패널 하단 영역 HUD 패널
- [x] 소속 배너 HUD Banner화 (min-height 44px, 영토 색상)
- [x] 영토 신념 HUD 섹션 (신념 문장 + 워터마크 + 텍스트색)
- [x] 성향 게이지 영토 색상 적용 (`data-territory` 자동 전환)
- [x] 성향 아이콘 확대 (2.2rem)
- [x] 경험치 바
- [x] 대표 업적 (pill 형태 더미 데이터)
- [x] 활동 카드 (2x2 그리드, 더미 레이아웃)
- [x] 뒤로 가기 (활동 카드 위에 배치)
- [x] 접기 버튼 (패널 하단 구성)
- [x] 패널 탭 전환 (프로필 화면의 탭 전환, transition)
- [x] 패널 전체 폭 (48rem)
- [x] 반응형 (모바일 1열 자동 전환)

### 영토 게시판

- [x] 영토 게시판 기반 구조 (개척/수호/외계행성)
- [x] 게시글 작성/조회/반응
- [x] 게시글 상세 작성자 영역 1차 CSS 개선 (HUD 카드형 · 팔로우 배치)
- [x] 게시글 상세 작성자 카드 2차 (레벨/명성 · `PlayerProgression` 재사용)
- [x] 게시글 상세 작성자 카드 3차 (영토 Badge · `territoryShortLabel` / `data-territory`)
- [x] Hover 미니 프로필 1차 — `ScMiniProfile` · 작성자 카드 Hover
- [x] 프로필 모달 껍데기 1차 — `ScProfileModal` · `openUserProfile()` 연동 (placeholder)
- [x] ScProfileModal ProfileFrame 렌더 연결 1차 — `renderProfileFrameInModal` · `buildUserProfileDataForModal`
- [x] ScProfileModal ProfileFrame 회귀 QA — Hover/모달/HUD/4스킨 · 닫기 이중 콜백 FIX
- [x] 댓글 작성자 프로필 UX 1차 — `renderThreadedCommentNode` · Hover + `openUserProfile` (게시판·상세·데일리 이슈)
- [x] 활동 피드 작성자 프로필 UX 1차 — `authorId` 저장 항목만 Hover/클릭 (`post_created`)
- [x] 알림 작성자 프로필 UX 1차 — `actorId` 저장 항목만 Hover/클릭 (`comment`/`like`/`follow`)
- [x] 알림 UserCard 안정화 — 작성자 영역 클릭 → 프로필 · 내용 영역 클릭 → `navigateFromNotification`
- [x] Community System v1 — 게시글 북마크 1차 (`sc_bookmarks_v1` · localStorage 토글)
- [x] Community System v1 — 게시글 공유 1차 (링크 복사 · HUD Toast)
- [x] Community System v1 — 게시글 신고 1차 (`sc_reports_v1` · HUD 모달 · 행동 사유만 · 중복/본인 글 차단)
- [x] Community System v1 — 게시글 신고 상세 의견 (textarea 300자 · 기타 필수 · `detail` 저장)
- [x] 랭킹 UI 개선 1차 — 5개 영토 탭 · TOP5 강조 (`rank-leaderboard.js`)
- [x] 랭킹 UI 개선 2차 — TOP3 여백 · 영토 Badge · 내 순위 HUD 그리드
- [x] 랭킹 작성자 프로필 UX 1차 — `ScMiniProfile` + `openUserProfile` (`rank-leaderboard.js`)
- [x] UserCard UX 단순화 — 프로필 클릭 범위 축소 (아바타·닉네임·유저 ID) · ScMiniProfile 팝업 연결 해제
- [x] Community System v1 — 북마크 목록 화면 2차 → **v2 북마크 목록 1차 완료** (2026-07-12, `bookmark-list.js`)
- [ ] ScProfileModal 2차 — DB/Supabase 실데이터 연동
- [x] Hover 미니 프로필 2차 — 랭킹 확장 (`rank-leaderboard.js` · 전 탭)
- [x] 팔로우 시스템 + 알림
- [x] 알림센터 1차 — `sc_notifications_v1` · 맵 HUD/프로필 벨 · comment/like/follow/level_up (2026-07-10)
- [x] 최근 세계 활동 피드 1차 — `sc_activity_feed_v1` · 메인 지도 HUD (2026-07-10)
- [ ] 알림센터 2차 — 서버 동기화 · 실시간 푸시 · 업적 연동
- [x] 외계행성 단일 허브 UI

### 기반 / 백엔드

- [x] Express 서버 기반 구축
- [x] Supabase Auth API (`/api/auth/*`)
- [x] 플레이어 프로필 API (`/api/me/profile`)
- [x] 채팅 API (인메모리 베타)
- [x] 영토/게시판/성향/레벨 설정 파일 (`config/`)
- [x] 게스트 모드

---

## 다음 우선순위 (2026-07-04)

### 우선순위 1 — 프로필 뷰포트 최적화 ✅

- [x] 프로필 내부 스크롤 제거
- [x] 프로필 세로 여백 압축
- [x] 신념 카드 높이 최적화
- [x] 성향 레이더 크기 조정
- [x] 하단 3개 요약 카드가 첫 화면에 모두 보이도록 레이아웃 최적화

### 우선순위 2 — 프로필 마무리

- [x] 프로필 최종 HUD 디자인 다듬기
- [ ] 아바타 시스템 추가
- [ ] 업적/활동/영토기록 탭 시스템 추가
- [ ] 프로필 최종 QA

---

## 미완료 작업 🔲

### 프로필 패널 / ProfileFrame

- [ ] 위 **「다음 작업 — 프로필 확장」** 1~15 순서 참조
- [~] ProfileFrame 성향지도 ↔ 게임 성향 **표시 연결** (localStorage 어댑터 · 서버 집계는 미완)
- [x] `getCurrentProfileData()` · `loadCurrentUserProfile()` merge 어댑터 (2026-07-10)
- [ ] 실제 아바타 이미지 업로드 (Supabase Storage)
- [ ] 활동 메뉴 링크 실제 기능 연결
- [ ] 명예 장식 슬롯 실제 아이템 시스템 연동
- [ ] 프로필 탭 (권한/히스토리/설정/뒤로) 실제 구현
- [x] 프로필 PNG 4종 적용 (ProfileFrame — 2026-07-09)

### 중앙광장 / 영토

- [ ] 성향 AI 한 줄 설명 실제 연동 (UI 골격 → AI API)
- [ ] 성향 설명 카드 실제 수치 연동 · 시안 장식 polish
- [ ] 데일리 이슈 AI 자동 생성 (AI 기반 이슈 콘텐츠 연동)
- [ ] 인기글/실시간 현황 실제 데이터 연동
- [ ] 실시간 영토 현황 실제 데이터 연동
- [ ] 영토 인구 시각화 (인구 단계별 이미지 변화)
- [ ] 영토 게시판 단계 해금 (성향 수치 기준)
- [ ] 성향 계산 실제 집계 (글/댓글/반응 → 성향 수치 변화)
- [ ] 영토 귀속 자동화 (성향 → 영토 이동)
- [ ] 첩자 배지 자동 부여 (타 영토 게시판 작성 시)

### 레벨 / 명성

- [ ] XP 실제 적용 (글 작성 +25, 댓글 +12, 데일리 이슈 +10)
- [ ] 레벨 업 처리 (1~5단계, XP 40/50/60/70/80)
- [ ] 명성 점수 계산 (좋아요·비추·공감·팔로우)
- [ ] 영토 기여 인구 비율 기반 점수 적용

### 영토전 (배틀 시스템)

- [ ] 영토전 기반 구조 설계 및 구현
- [ ] 영토전 참여/결과 조건 정의
- [ ] 시즌 MVP 보상
- [ ] 영토전 결과 텍스트 칭호 부여 기능

### 추방 / 외계행성

- [ ] 추방 자동화 (비호감 30개 → 외계행성 이동)
- [ ] 지구귀환티켓 결제 연동
- [ ] 외계행성 체류 기간 관리 (0, 3, 7, 14, 30, 90일)
- [ ] 외계행성 전용 성향 시스템 (정치 성향 없음)

### 아바타 / 보상 시스템

- [ ] 아바타 슬롯 실제 이미지 업로드
- [ ] 영토별 기본 아바타 이미지 제작
- [ ] 시즌 보상 프레임 지급 구현
- [ ] 영토전 결과 칭호 보상 부여
- [ ] 업적 시스템 (조건 정의 + 실력 처리)
- [ ] 오라 지급 구현

### 결제

- [ ] 카카오페이 연동
- [ ] 토스페이 연동
- [ ] 휴대폰 소액결제 연동
- [ ] 월 구독권 처리 (4,900원, 매일 5시 리셋)
- [ ] 직언패스500 처리 (500원, 영구 보존)
- [ ] 지구귀환티켓 처리 (3,000원)

### 관리 / 운영

- [ ] 관리자 패널 (신고 처리, 추방 관리, 이슈 등록)
- [ ] 데일리 이슈 운영 도구
- [ ] 사용자 신고 → 조치 프로세스
- [ ] AI 이슈 자동화 파이프라인 (매일 갱신)
