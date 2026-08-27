# SentenceArena Production 기준점 — NAVER Cloud Korea 이전 전

기록 날짜: 2026-08-27
기록 성격: 읽기 전용. 현재 Railway Production 정상 상태를 이후 비교/복구할 수 있도록 고정한다.
이번 작업에서 하지 않은 것: NAVER Cloud 서버 생성, DNS 변경, Railway 설정 변경, 환경변수 변경, OAuth 변경, 코드 기능 수정, DB 변경, Production 재배포 지시.

Secret 원문은 이 문서에 넣지 않는다.
비밀값은 `[SECRET - COPY SECURELY AT MIGRATION]` 만 표시한다.

NAVER Cloud 앱 서버는 새 DB를 만들지 않고 동일 Production Supabase를 사용한다.

---

## 1. 기록 날짜 / 범위

1. 기록 시각: 2026-08-27 (KST)
2. 대상: Railway project `beneficial-reflection` / environment `production` / service `sentencearena`
3. 공개 origin: `https://sentencearena.com`
4. 보호 파일(미추적, 이번 작업 미접촉):
   - shared/political-alignment-gradual-sim-core.js
   - tools/run-fast-alignment-simulation.js
   - tools/run-gradual-alignment-simulation.js
   - tools/test-gradual-alignment-simulation.js
   - tools/verify-daily-issue-alignment-seed-live.js
5. 보류 작업(미접촉): 비회원 권리침해 이메일 인증

---

## 2. Git 기준

Git HEAD와 Railway 실행 commit을 같다고 가정하지 않고 각각 확인했다.

Repository HEAD:
- branch: master
- commit: 304ebcd5e7d17373a4a0157ed47ffdfb95e82169
- message: docs: record naver production follow-up audit
- origin/master: 304ebcd5e7d17373a4a0157ed47ffdfb95e82169 (HEAD와 동일)

Documentation-only commits:
- 304ebcd 는 docs-only (AI_HANDOFF / CHANGELOG / OPEN_BETA 체크리스트 / TODO 만 변경)
- 04999b9..304ebcd diff: 코드 0, 문서 4파일

마지막 기능 commit:
- 04999b963f9109ad3accffe5332f494c2f92963b
- message: fix: block redecided appeals and duplicate behavior sanctions

Production deployed code:
- 실제 실행 배포 commit: 304ebcd5e7d17373a4a0157ed47ffdfb95e82169
- 이유: master 자동배포가 켜져 있어 docs-only 304ebcd도 Production에 배포됨
- 앱 기능 코드: 04999b9 와 동일 (docs-only 차이만)
- 이전 기능 배포: 0b450a51-ee1f-497b-ae3b-219b4bdb9602 (04999b9, status=REMOVED, 304ebcd 배포에 의해 교체)

Production deployment:
- id: 63ab24b4-a873-494f-808b-1aa0c761e237
- status: SUCCESS
- createdAt: 2026-08-26T08:10:04.787Z
- reason: deploy (GitHub master push)
- 정적 파일 Last-Modified: Wed, 26 Aug 2026 08:10:00 GMT (304ebcd와 일치)

---

## 3. Railway 구조

실제 확인값만 기록. ServiceInstance 기본값과 최근 SUCCESS 배포 스냅샷이 다른 항목은 배포 스냅샷을 정본으로 한다.

1. project 이름: beneficial-reflection
2. project id: 4bdd1d1c-7982-445f-9a8e-9ec9e360ac63
3. environment 이름: production
4. environment id: f3c4bc7f-ed11-47ad-aaae-f5d50abe0692
5. service 이름: sentencearena
6. service id: e037ac94-4c64-47a2-8ab1-6ae9e0b5da9d
7. region: ams (replicas=1). Railway edge 응답 헤더: hnd1
8. 연결 Git repository: kyb041028-ctrl/sentencearena
9. branch: master
10. provider: github
11. 자동배포: YES (serviceInstanceAutoDeployStatus.enabled=true)
12. deployment trigger: master → production sentencearena, checkSuites=false
13. Root Directory: 없음 (null, 저장소 루트)
14. build 방식: Nixpacks v1.41.0
    - setup: nodejs_22, npm-9_x
    - install: npm ci
    - start: npm start
    - configFile: /railway.json
    - nixpacksConfigPath: /nixpacks.toml
    - Dockerfile: 저장소에 없음. Nixpacks가 빌드 중 생성
    - 참고: ServiceInstance.builder 필드는 RAILPACK로 보이지만 최근 SUCCESS 배포는 NIXPACKS
15. start command: npm start (railway.json · 배포 스냅샷. ServiceInstance.startCommand 빈 문자열은 무시)
16. restart 정책: ON_FAILURE, maxRetries=10
17. health check 경로: /health
18. health check timeout: 30초
19. 최근 healthcheck: succeeded (1/1)
20. sleepApplication: false
21. cronSchedule: 없음
22. public / custom domain:
    - custom: sentencearena.com (ACTIVE, targetPort 8080, TLS VALID)
    - Railway 자동 domain: sentencearena-production.up.railway.app (ACTIVE, targetPort 8080)
    - www: Railway domain 목록에 없음. DNS NXDOMAIN
23. custom domain DNS (Railway 확인):
    - record: CNAME
    - name: @
    - fqdn: sentencearena.com
    - required/current: hysv3qmb.up.railway.app
    - status: DNS_RECORD_STATUS_PROPAGATED
24. 로컬 nslookup:
    - sentencearena.com → CNAME hysv3qmb.up.railway.app → 69.46.46.110
    - www.sentencearena.com → NXDOMAIN
    - sentencearena-production.up.railway.app → 69.46.46.38
25. TTL: Railway/로컬 조회에서 확인 못 함 → 이전 직전 사용자 확인 필요

---

## 4. Node 실행환경

1. package.json engines: node 22.x
2. nixpacks.toml: NIXPACKS_NODE_VERSION=22
3. 실제 빌드: nodejs_22 + npm-9_x
4. 패치 버전(22.x.y): 빌드 로그에서 미확인
5. package manager: npm
6. lockfile: package-lock.json 사용. 설치 명령 npm ci
7. scripts.start: node server.js
8. Production start: npm start → node server.js
9. 실제 entry: server.js
10. 실제 listen: 0.0.0.0:8080 (HOST 기본 0.0.0.0, PORT는 Railway 주입 8080)
11. 필요한 build 단계: 프론트 번들 없음. npm ci 후 npm start
12. 정적 파일: Express가 public/, public/admin/*, public/rights-infringement, shared/ 를 static 제공. GET / 는 public/index.html

NAVER Cloud에서 같은 코드를 실행하기 위한 최소 조건:
1. Node 22.x
2. npm ci && npm start
3. 0.0.0.0 바인딩 + process.env.PORT
4. HTTPS 리버스 프록시
5. 아래 사용자 환경변수 15개 이전 (Secret은 안전하게 복사)
6. 동일 Production Supabase 유지
7. 이번 작업에서 Dockerfile/배포 스크립트는 만들지 않음

---

## 5. 환경변수 이름 목록

출처: Railway production service variables (이름 조회) + CLI list의 Railway 주입 변수.
Secret 원문 미기록.

사용자 설정 변수: 15개
Railway 런타임 주입: 11개 (NAVER Cloud로 복사하지 않음)
공유(shared) 변수: 없음

### 5.1 사용자 설정

NODE_ENV
- 존재: YES
- 비밀: NO
- 이전 필요: YES
- 값: production

APP_PUBLIC_ORIGIN
- 존재: YES
- 비밀: NO
- 이전 필요: YES
- 값: https://sentencearena.com

BOARD_OPERATIONAL
- 존재: YES
- 비밀: NO
- 이전 필요: YES
- 값: true

TERRITORY_EVOLUTION_OPERATIONAL
- 존재: YES
- 비밀: NO
- 이전 필요: YES
- 값: true

DAILY_ISSUE_REPOSITORY
- 존재: YES
- 비밀: NO
- 이전 필요: YES
- 값: db

DAILY_ISSUE_DB_SCHEMA
- 존재: YES
- 비밀: NO
- 이전 필요: YES
- 값: daily_issue

DAILY_ISSUE_DATABASE_URL
- 존재: YES
- 비밀: YES
- 이전 필요: YES
- 값: [SECRET - COPY SECURELY AT MIGRATION]

SUPABASE_URL
- 존재: YES
- 비밀: NO
- 이전 필요: YES
- 값: https://rlzltrwwamrgrfwlaqxj.supabase.co

SUPABASE_PUBLISHABLE_KEY
- 존재: YES
- 비밀: YES
- 이전 필요: YES
- 값: [SECRET - COPY SECURELY AT MIGRATION]
- 참고: SUPABASE_ANON_KEY 는 Production에 없음. Auth 키 원본은 publishable

SUPABASE_ANON_KEY
- 존재: NO
- 비밀: -
- 이전 필요: NO (현재 구성 유지 시). 코드는 ANON 또는 PUBLISHABLE 중 하나를 받음
- 값: 없음

SUPABASE_SERVICE_ROLE_KEY
- 존재: YES
- 비밀: YES
- 이전 필요: YES
- 값: [SECRET - COPY SECURELY AT MIGRATION]

POLITICAL_ALIGNMENT_SCHEDULER_ENABLED
- 존재: YES
- 비밀: NO
- 이전 필요: YES
- 값: false

ALIEN_MODERATION_V1
- 존재: YES
- 비밀: NO
- 이전 필요: YES
- 값: false

DAILY_ISSUE_MORNING_SCHEDULER_ENABLED
- 존재: YES
- 비밀: NO
- 이전 필요: YES
- 값: 0

DAILY_ISSUE_MORNING_MANUAL_RUN_ENABLED
- 존재: YES
- 비밀: NO
- 이전 필요: YES
- 값: true
- 참고: 아침 자동 스케줄러는 OFF. 관리자 수동 collect/publish 게이트만 ON. 첫 NAVER Cloud 배포에서도 이 조합 유지

RETENTION_IDENTITY_PEPPER
- 존재: YES
- 비밀: YES
- 이전 필요: YES
- 값: [SECRET - COPY SECURELY AT MIGRATION]

### 5.2 현재 없음 (기본값으로 동작)

HOST
- 존재: NO
- 기본: 0.0.0.0
- 이전 시: 리버스 프록시 뒤에서도 0.0.0.0 listen 유지

PORT
- 사용자 변수: NO
- Railway 실제 listen: 8080 (주입)
- 이전 시: 프록시가 기대하는 포트와 맞출 것. 코드 기본은 3000

TRUST_PROXY
- 존재: NO
- 현재 Express trust proxy: OFF
- 이전 시: NAVER Cloud 리버스 프록시 뒤라면 TRUST_PROXY=1 필요 가능성 있음. 이번 작업에서 변경하지 않음

DAILY_ISSUE_API_CORS_ORIGINS
- 존재: NO
- 현재 CORS: APP_PUBLIC_ORIGIN만 → https://sentencearena.com

LEGAL_GATE_ENFORCE
- 존재: NO
- 현재: NODE_ENV=production 이므로 법적 동의 강제 ON

RETENTION_PURGE_ENABLED
- 존재: NO
- 현재: NODE_ENV=production 이므로 purge scheduler ON (1시간, 부트 시 1회)

USER_DATA_OPERATIONAL / USER_DATA_MODE
- 존재: NO
- 현재 로그: LEGACY_LOCAL, USER_DATA_API_NOT_ACTIVATED

NAVER/KAKAO/GOOGLE client secret
- Railway에 없음 (정상). Supabase Auth 대시보드에만 존재

### 5.3 Railway 주입 (복사 금지)

이름만:
RAILWAY_ENVIRONMENT
RAILWAY_ENVIRONMENT_ID
RAILWAY_ENVIRONMENT_NAME
RAILWAY_PRIVATE_DOMAIN
RAILWAY_PROJECT_ID
RAILWAY_PROJECT_NAME
RAILWAY_PUBLIC_DOMAIN
RAILWAY_SERVICE_ID
RAILWAY_SERVICE_NAME
RAILWAY_SERVICE_SENTENCEARENA_URL
RAILWAY_STATIC_URL

비민감 확인값:
- RAILWAY_ENVIRONMENT_NAME=production
- RAILWAY_PROJECT_NAME=beneficial-reflection
- RAILWAY_SERVICE_NAME=sentencearena
- RAILWAY_PUBLIC_DOMAIN=sentencearena.com
- RAILWAY_PRIVATE_DOMAIN=sentencearena.railway.internal

---

## 6. 중요 기능 설정

Production /ready 및 Railway 변수 실측:

1. BOARD_OPERATIONAL=true
2. TERRITORY_EVOLUTION_OPERATIONAL=true
3. DAILY_ISSUE_REPOSITORY=db
4. DAILY_ISSUE_DB_SCHEMA=daily_issue
5. POLITICAL_ALIGNMENT_SCHEDULER_ENABLED=false
6. ALIEN_MODERATION_V1=false
7. DAILY_ISSUE_MORNING_SCHEDULER_ENABLED=0 (ready.checks.dailyIssueMorningSchedulerEnabled=false)
8. DAILY_ISSUE_MORNING_MANUAL_RUN_ENABLED=true
9. NODE_ENV=production
10. APP_PUBLIC_ORIGIN=https://sentencearena.com
11. publicOriginCanonical=true
12. boardRepository=supabase
13. database.ready=true
14. 법적 동의: NODE_ENV=production 기본 강제
15. retention purge scheduler: production 기본 ON
16. USER_DATA API: 비활성
17. USER_EVENT: 비활성
18. 외계 시스템 운영 모드: LEGACY_LOCAL / NOT_ACTIVATED (코드는 준비, V1 flag OFF)

---

## 7. Supabase

1. project URL: https://rlzltrwwamrgrfwlaqxj.supabase.co
2. project ref: rlzltrwwamrgrfwlaqxj
3. region: 코드/Railway 설정에서 확인 불가. Dashboard 수동확인 항목
4. anon/publishable key: Production은 SUPABASE_PUBLISHABLE_KEY 존재. /api/supabase-config 가 url+key 반환 (브라우저용)
5. service role key: 존재. Auth 로그인 경로에는 사용하지 않음
6. DB 직접 연결: YES. DAILY_ISSUE_DATABASE_URL (Daily Issue schema 및 다수 서버 PG 경로). JSON repository 아님
7. Auth: YES. Google / Kakao / custom:naver / 세션 검증 / 관리자 가드
8. Storage: 앱 기능으로 사용하지 않음 (코드에서 supabase.storage 호출 없음)
9. Realtime: 제품 기능으로 사용하지 않음

이전 기준:
- NAVER Cloud 앱 서버도 동일 Production Supabase를 사용한다
- 새 DB를 만들지 않는다
- Auth provider / Redirect URL / Custom OAuth 설정을 이번 이전 준비에서 바꾸지 않는다

---

## 8. Domain / origin

코드 canonical: https://sentencearena.com
(server/production-boot-guards.js CANONICAL_PRODUCTION_PUBLIC_ORIGIN)

현재 Production에서 sentencearena.com이 고정된 곳:

1. APP_PUBLIC_ORIGIN=https://sentencearena.com
2. Railway custom domain=sentencearena.com → service sentencearena:8080
3. CORS allowlist=https://sentencearena.com
4. OAuth 앱 최종 callback=https://sentencearena.com/auth-v2/callback.html
5. Naver userinfo=https://sentencearena.com/api/auth/naver-userinfo
6. 브라우저 ScAuth.redirectTo = location.origin + /auth-v2/callback.html

www:
- 사용하지 않음
- Railway domain 없음
- DNS NXDOMAIN
- CORS allowlist에 www 없음

HTTP → HTTPS:
- http://sentencearena.com/ → 301 Location: https://sentencearena.com/
- Railway edge가 처리. 앱 코드의 HTTP 리다이렉트 아님

publicOrigin / canonical:
- /ready.checks.publicOrigin=https://sentencearena.com
- publicOriginCanonical=true

CORS:
- production: DAILY_ISSUE_API_CORS_ORIGINS + APP_PUBLIC_ORIGIN
- 현재 extra CORS env 없음 → https://sentencearena.com 만
- credentials: true
- Origin 없는 요청(curl/same-origin)은 CORS 콜백에서 허용
- Daily Issue 라우터는 Origin이 allowlist 밖이면 CORS_ORIGIN_DENIED

trusted / callback 허용 origin:
- 앱 서버 기준: APP_PUBLIC_ORIGIN
- Kakao resolve: hostname이 *.supabase.co 이고 path가 /auth/v1/authorize, provider=kakao 인 URL만 허용
- Supabase Dashboard Redirect URLs: Cursor가 직접 확인 못 함 → Dashboard 수동확인 항목

---

## 9. OAuth

이번 작업에서 OAuth 설정을 변경하지 않음.

### Google

1. provider: google (ScAuth.login → signInWithOAuth)
2. Supabase callback: https://rlzltrwwamrgrfwlaqxj.supabase.co/auth/v1/callback
3. 앱 최종 redirect: https://sentencearena.com/auth-v2/callback.html
4. Production origin: https://sentencearena.com
5. Railway에 Google client secret 없음 (정상)

### Kakao

1. provider: kakao
2. skipBrowserRedirect 후 POST /api/auth/kakao-resolve-authorize 로 account_email scope 제거
3. Supabase callback: https://rlzltrwwamrgrfwlaqxj.supabase.co/auth/v1/callback
4. 앱 최종 redirect: https://sentencearena.com/auth-v2/callback.html
5. Production origin: https://sentencearena.com
6. Railway에 Kakao client secret 없음 (정상)

### Naver

코드와 알려진 Production 기준이 일치한다.

1. Supabase provider: custom:naver
2. Naver Developers Callback: https://rlzltrwwamrgrfwlaqxj.supabase.co/auth/v1/callback
3. SentenceArena 최종 callback: https://sentencearena.com/auth-v2/callback.html
4. userinfo: https://sentencearena.com/api/auth/naver-userinfo
5. Bearer 없으면 401 MISSING_BEARER (실측)
6. Railway에 NAVER Client Secret 없음 (정상. Supabase Custom OAuth에만)
7. callback.html: finishOAuthCallback() 후 /

Naver Developers 검수: PENDING
(승인 대기. 이 문서에서 PASS 처리하지 않음)

---

## 10. Supabase Redirect URL

코드/앱 기준 Production 유지 URL:

1. https://sentencearena.com/auth-v2/callback.html  ← 앱 PKCE callback. 현재 코드 CALLBACK_PATH와 일치. 유지.
2. https://rlzltrwwamrgrfwlaqxj.supabase.co/auth/v1/callback  ← provider callback (Naver Developers 필수값과 동일)

### Dashboard 수동확인 항목

Cursor가 Supabase Dashboard / Google / Kakao / Naver 콘솔을 직접 열 수 없음. 추측해서 PASS 하지 않음.

확인 필요:
1. Authentication → URL Configuration → Site URL 이 https://sentencearena.com 인지
2. Redirect URLs에 https://sentencearena.com/auth-v2/callback.html 가 있는지
3. localhost / tunnel / ngrok / trycloudflare 가 남아 있는지
4. Google authorized redirect = Supabase callback
5. Kakao redirect = Supabase callback
6. Naver Developers Callback = Supabase callback, 서비스 URL = sentencearena.com
7. Naver 검수 상태 = PENDING 유지 여부

---

## 11. CORS / security — 이전 후에도 동일해야 하는 것

1. NODE_ENV=production
2. APP_PUBLIC_ORIGIN=https://sentencearena.com
3. CORS allowlist에 localhost / www / wildcard 넣지 않음
4. 관리자 API: Authorization Bearer 필수. 비로그인 401, 역할 부족 403, 실제 오류 500
5. 관리자 역할: app_metadata.role only (ADMIN/OWNER)
6. 회원 API: Authorization Bearer (Supabase access token). 서버 세션 쿠키를 새로 도입하지 않음
7. /api/auth/naver-userinfo: Bearer 없는 요청 401
8. X-Content-Type-Options: nosniff
9. 관리자/권리침해 페이지 Cache-Control: no-store
10. TRUST_PROXY: 현재 Railway는 미설정. NAVER Cloud 프록시 뒤에서 X-Forwarded-Proto/For를 쓰려면 별도 검토. 지금은 변경하지 않음
11. boot guard: production에서 DAILY_ISSUE_REPOSITORY=db, schema=daily_issue, BOARD_OPERATIONAL=true, TERRITORY_EVOLUTION_OPERATIONAL=true, APP_PUBLIC_ORIGIN canonical HTTPS 필수
12. 개발 플래그 금지: BOARD_DEV_MEMORY, OPEN_BROWSER, ALIGNMENT_LIVE_VERIFY, ALIEN_MODERATION_ADMIN_BYPASS, DAILY_ISSUE_ALLOW_TEST_RESET, DAILY_ISSUE_APPLY_MIGRATION_IN_TEST, DAILY_ISSUE_MORNING_RUN_KEY_NAMESPACE

---

## 12. reverse proxy — Railway가 하던 것 / NAVER Cloud에서 준비할 것

아직 코드를 수정하지 않음. 차이만 기록.

Railway가 현재 처리:
1. HTTPS / TLS 인증서 (custom domain VALID, 만료 2026-11-16)
2. HTTP 301 → HTTPS
3. 공개 도메인 → 컨테이너 :8080
4. healthcheck GET /health
5. edge (응답 헤더 Server: railway-hikari)

앱 코드 현재:
1. process.env.PORT 사용. 없으면 3000
2. HOST 기본 0.0.0.0. localhost-only 아님
3. 실제 Production listen: 0.0.0.0:8080
4. TRUST_PROXY=1 일 때만 trust proxy
5. 현재 TRUST_PROXY 없음

NAVER Cloud에서 직접 준비할 가능성:
1. TLS 인증서
2. HTTP → HTTPS
3. Host 전달
4. X-Forwarded-Proto / X-Forwarded-For
5. reverse proxy → Node PORT
6. bind address 0.0.0.0
7. health check /health

---

## 13. health / ready 기준값

실측 시각: 2026-08-27T03:30:04.664Z

GET https://sentencearena.com/health
- 200
- ok: true
- service: sentencearena-api
- supabaseConfigured: true

GET https://sentencearena.com/ready
- 200
- ok: true
- service: sentencearena-api
- checks.nodeEnv: production
- checks.supabaseConfigured: true
- checks.boardOperational: true
- checks.boardRepository: supabase
- checks.territoryEvolutionOperational: true
- checks.alienModerationV1: false
- checks.politicalSchedulerEnabled: false
- checks.dailyIssueMorningSchedulerEnabled: false
- checks.dailyIssueRepository: db
- checks.dailyIssueSchema: daily_issue
- checks.publicOrigin: https://sentencearena.com
- checks.publicOriginCanonical: true
- database.ready: true
- database.error: null

NAVER Cloud 이전 후 같은 ready 결과가 나와야 한다.

추가 읽기 실측:
1. GET / → 200 HTML SentenceArena
2. GET /auth-v2/callback.html → 200, finishOAuthCallback 포함
3. GET /api/supabase-config → ok, url=https://rlzltrwwamrgrfwlaqxj.supabase.co
4. GET /api/daily-issues → 200, items=[], count=0, total=0 (공개 목록 API 정상. 기록 시각에 PUBLISHED 0건)
5. GET /api/territories/population/status → 200, mode=API_OPERATIONAL, activated=true
6. GET /api/territories/evolution → 200, dataStatus=READY, populationSource=OPERATIONAL_USER_DATA, CENTRAL population=4, PIONEER/GUARDIAN/ALIEN=0
7. GET /api/admin/daily-issues/review (비로그인) → 401 ADMIN_TOKEN_MISSING
8. GET /api/admin/moderation/inbox (비로그인) → 401 ADMIN_TOKEN_MISSING
9. GET /api/auth/naver-userinfo (Bearer 없음) → 401 MISSING_BEARER
10. https://sentencearena-production.up.railway.app/health → 200

---

## 14. 핵심 기능 PASS 상태

코드/마스터 체크리스트/최근 Production 적용 기록 기준. 이번 작업에서 전체 회귀를 다시 돌리지 않음.

1. Google login: PASS
2. Kakao login: PASS
3. Naver login: PASS (앱 코드/Production 경로). Developers 검수는 PENDING
4. Guest: PASS
5. 회원가입 / 법적 동의: PASS
6. 게시판: PASS
7. 댓글/반응: PASS
8. Profile: PASS
9. Level/XP/Fame: PASS (Fame 취소 회수는 PENDING, 핵심 지급은 PASS)
10. 핵심 업적: PASS (first-post Production PASS. 이후 4개는 베타 이후)
11. 정치성향 기본 연결: PASS
12. 영토 실인구: PASS (evolution/population 읽기 실측 READY)
13. Daily Issue DB: PASS (repository=db, schema=daily_issue, database.ready=true)
14. 일반 신고: PASS
15. 제재: PASS
16. 이의제기: PASS (재결정 차단 포함)
17. 권리침해: PASS
18. 허위정보: PASS
19. 회원탈퇴: PASS
20. 운영자 기능: PASS (401/403, app_metadata.role, 중복 처리 방지)
21. Mock 노출 차단: PASS

Alien moderation:
- 기능 준비: PASS
- Production flag: OFF (ALIEN_MODERATION_V1=false)

---

## 15. 의도적으로 OFF 유지

NAVER Cloud 첫 배포에서도 그대로 유지한다.

1. ALIEN_MODERATION_V1=false
2. POLITICAL_ALIGNMENT_SCHEDULER_ENABLED=false
3. DAILY_ISSUE_MORNING_SCHEDULER_ENABLED=0

실수로 켜지면 안 되는 개발 플래그:
BOARD_DEV_MEMORY, OPEN_BROWSER, ALIGNMENT_LIVE_VERIFY, ALIEN_MODERATION_ADMIN_BYPASS, DAILY_ISSUE_ALLOW_TEST_RESET, DAILY_ISSUE_APPLY_MIGRATION_IN_TEST, DAILY_ISSUE_MORNING_RUN_KEY_NAMESPACE, DAILY_ISSUE_REPOSITORY=json

---

## 16. 의도적으로 보류된 기능

서버 이전 도중 같이 만들지 않는다.

1. Naver Developers 검수 승인 대기 (PENDING)
2. 비회원 권리침해 이메일 인증
3. Alien Production ON
4. 정치성향 자동 스케줄러 ON
5. Daily Issue 아침 자동 스케줄러
6. beta-citizen 실제 날짜 활성화
7. 이후 4개 업적 (steady-footsteps, empathy-from-many, dialogue-across-territories, witness-of-an-era)
8. 진영 전황 실데이터
9. 채팅 영구 저장
10. 시즌
11. 결제
12. 팔로우/aura
13. 전용 공지 CMS / 회원 활동명 검색 / 관리자 통합 대시보드
14. score→성향지도 공식 변환
15. 서버 전체 명성 순위

---

## 17. Railway 복구 기준

실제 rollback은 실행하지 않음. 문서만.

1. 마지막 정상 Git commit (기능): 04999b963f9109ad3accffe5332f494c2f92963b
2. 마지막 정상 Git commit (현재 실행/문서 포함): 304ebcd5e7d17373a4a0157ed47ffdfb95e82169
3. 앱 코드는 위 두 commit이 동일. docs-only 차이만
4. 마지막 정상 Railway deployment (현재): 63ab24b4-a873-494f-808b-1aa0c761e237 SUCCESS
5. 직전 기능 배포: 0b450a51-ee1f-497b-ae3b-219b4bdb9602 (REMOVED, 04999b9)
6. Railway service: sentencearena
7. Railway env: production
8. start command: npm start
9. healthcheck: /health
10. Railway domain: sentencearena-production.up.railway.app
11. custom domain: sentencearena.com
12. sentencearena.com 복구 지점:
    - Railway custom domain을 sentencearena 서비스에 유지
    - DNS CNAME @ → hysv3qmb.up.railway.app (현재 값)
    - www는 원래 없음
13. Supabase: 그대로 유지. DB를 되돌리거나 새로 만들지 않음
14. Railway 유지 기간: NAVER Cloud 이전 후 안정 확인이 끝날 때까지 서비스/도메인/자동배포 경로를 제거하지 않는다. 구체 일수는 이전 완료 후 별도 결정

Rollback 실행 방법(실행하지 않음, 참고만):
- DNS를 다시 Railway CNAME으로
- Railway production sentencearena가 Online인지 확인
- /health /ready 가 이 문서 13절과 같은지 확인

---

## 18. DNS 확인사항

코드/Railway에서 확인된 것:
1. 연결 방식: apex CNAME → hysv3qmb.up.railway.app
2. www: 레코드 없음 (NXDOMAIN)
3. Railway custom domain ACTIVE, certificate VALID
4. HTTP 301 → HTTPS는 Railway edge

이전 직전 사용자 확인 필요:
1. DNS 등록 기관 / 콘솔 위치
2. TTL
3. CNAME flattening / ALIAS / A 레코드 여부 (Railway는 CNAME을 요구값으로 표시, 로컬은 CNAME으로 보임)
4. 루트 도메인 설정 화면의 실제 레코드 원문
5. 이메일 MX 등 이전과 무관한 레코드가 있는지

DNS 변경은 이 문서 작성 중 하지 않음.

---

## 19. NAVER Cloud 이전 후 비교표

NAVER Cloud 칸은 아직 미확인.

Git commit
- Railway 현재 정상값: 304ebcd5e7d17373a4a0157ed47ffdfb95e82169 (앱 코드=04999b9)
- NAVER Cloud 이전 후 확인값: 미확인

Node version
- Railway 현재 정상값: Node 22 (nodejs_22) / npm 9.x
- NAVER Cloud 이전 후 확인값: 미확인

Start command
- Railway 현재 정상값: npm start → node server.js
- NAVER Cloud 이전 후 확인값: 미확인

Listen
- Railway 현재 정상값: 0.0.0.0:8080
- NAVER Cloud 이전 후 확인값: 미확인

Supabase URL
- Railway 현재 정상값: https://rlzltrwwamrgrfwlaqxj.supabase.co
- NAVER Cloud 이전 후 확인값: 미확인 (동일해야 함)

Public Origin
- Railway 현재 정상값: https://sentencearena.com
- NAVER Cloud 이전 후 확인값: 미확인

Domain
- Railway 현재 정상값: sentencearena.com → Railway custom domain
- NAVER Cloud 이전 후 확인값: 미확인

Health
- Railway 현재 정상값: GET /health 200 ok=true supabaseConfigured=true
- NAVER Cloud 이전 후 확인값: 미확인

Ready
- Railway 현재 정상값: 13절 전체
- NAVER Cloud 이전 후 확인값: 미확인

Board
- Railway 현재 정상값: BOARD_OPERATIONAL=true, boardRepository=supabase
- NAVER Cloud 이전 후 확인값: 미확인

Evolution
- Railway 현재 정상값: TERRITORY_EVOLUTION_OPERATIONAL=true, API_OPERATIONAL, READY, CENTRAL=4
- NAVER Cloud 이전 후 확인값: 미확인

Daily Issue
- Railway 현재 정상값: repository=db, schema=daily_issue, database.ready=true, 공개 API 200
- NAVER Cloud 이전 후 확인값: 미확인

Alien flag
- Railway 현재 정상값: false
- NAVER Cloud 이전 후 확인값: 미확인 (false 유지)

Political scheduler
- Railway 현재 정상값: false
- NAVER Cloud 이전 후 확인값: 미확인 (false 유지)

OAuth Google
- Railway 현재 정상값: provider=google, callback=/auth-v2/callback.html
- NAVER Cloud 이전 후 확인값: 미확인

OAuth Kakao
- Railway 현재 정상값: provider=kakao + resolve-authorize
- NAVER Cloud 이전 후 확인값: 미확인

OAuth Naver
- Railway 현재 정상값: custom:naver, userinfo HTTPS, Developers PENDING
- NAVER Cloud 이전 후 확인값: 미확인

Guest
- Railway 현재 정상값: PASS
- NAVER Cloud 이전 후 확인값: 미확인

Admin
- Railway 현재 정상값: 비로그인 401 ADMIN_TOKEN_MISSING
- NAVER Cloud 이전 후 확인값: 미확인

CORS
- Railway 현재 정상값: https://sentencearena.com only
- NAVER Cloud 이전 후 확인값: 미확인

HTTPS
- Railway 현재 정상값: 301 HTTP→HTTPS, TLS VALID
- NAVER Cloud 이전 후 확인값: 미확인

---

## 20. Repository HEAD / Production deployed / docs-only 분리

1. Repository HEAD: 304ebcd5e7d17373a4a0157ed47ffdfb95e82169
2. origin/master: 304ebcd5e7d17373a4a0157ed47ffdfb95e82169
3. Production deployed code commit: 304ebcd5e7d17373a4a0157ed47ffdfb95e82169
4. Production deployment id: 63ab24b4-a873-494f-808b-1aa0c761e237
5. Documentation-only: 304ebcd (기능 코드 없음)
6. Last feature commit: 04999b963f9109ad3accffe5332f494c2f92963b
7. 자동배포: ON. docs-only push도 Production 배포를 만든다
8. 이후 기준점 문서 commit도 자동배포될 수 있다. 기능 변경은 없어야 하며 /health /ready 만 재확인한다
