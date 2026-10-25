# Launch Finalization 준비 문서

상태: 내부 준비 문서. 완료된 출시 작업이 아님.  
사이트 공개 페이지에 연결하지 않음.  
공개 개인정보처리방침의 확정 항목표가 아님.  
기준: master `11cbab05d280b673b3bd0c78379e114bda13d417`  
이 문서를 만든 작업은 제품 코드, Production DB, Production Supabase, NAVER를 바꾸지 않았다. 서버를 시작하지 않았다. 법률 문서를 게시하지 않았다. 사업자 사실과 시행일을 만들지 않았다.

---

## 1. 비워 둔 사업자 정보

아래 값은 넣지 않는다. 표기는 정확히 `Launch Finalization에서 확정`이다.

1. 운영자/사업자 명칭: Launch Finalization에서 확정
2. 대표자: Launch Finalization에서 확정
3. 사업장 주소: Launch Finalization에서 확정
4. 고객 지원 이메일: Launch Finalization에서 확정
5. 개인정보 보호책임자/담당자: Launch Finalization에서 확정
6. 시행일: Launch Finalization에서 확정

공개 초안은 특정 법원 이름을 적지 않는다.

---

## 2. 소셜 로그인 — 코드에서 확인한 범위

이 절은 공개 개인정보 항목표가 아니다. Google과 Naver의 개발자 콘솔 scope는 이 저장소에 없다. 없는 항목은 구현되지 않은 것으로 적는다.

공통 프로필 저장은 OAuth 제공자 응답을 활동명으로 복사하지 않는다.

저장 SQL: `supabase/migration_canonical_territory_central_start.sql` 46-77행 `public.handle_new_user()`.

이 INSERT가 `public.profiles`에 넣는 값:

- `id`: `auth.users.id`
- `display_name`: 빈 문자열. 61-63행 주석은 Google/Kakao/Naver metadata와 email을 활동명으로 쓰지 않는다고 적는다
- `home_country`: `raw_user_meta_data.home_country`가 ISO 2글자면 그 값, 아니면 `KR` (56-59행)
- `citizenship_status`: `CITIZEN`
- `territory`: `CENTRAL` (65-71행). 같은 파일 16-17행은 컬럼 기본값도 `CENTRAL`

회원 로그인 호출 `public/auth.js` 99-109행은 `signInWithOAuth` options에 `redirectTo`만 넘긴다. `home_country`를 보내지 않는다. 따라서 OAuth 신규 프로필의 국가값은 제공자가 보낸 국가가 아니라 트리거 기본값 `KR`이다.

`public.profiles` INSERT에 없는 항목: 이메일, 실명, 소셜 닉네임, 프로필 이미지, Google 프로필 필드. 이 저장소의 SQL은 `auth.users` 또는 `auth.identities`에 어떤 claim이 남는지를 정의하지 않는다. 그 저장 여부는 여기서 확정하지 않는다.

### 2-1. Google

회원 버튼: `public/index.html` 13691행 `data-provider="google"`.  
로그인: `public/auth.js` 99-109행. provider 기본값은 `google`. scope 문자열, queryParams, 프로필 필드 매핑이 없다.

- 요청 scope: 구현되지 않음. 앱 코드와 저장소 설정에 Google scope 문자열이 없다
- 앱이 실제로 읽는 필드: 구현되지 않음. Google userinfo 파서가 없다
- DB에 이 앱 SQL이 저장하는 제공자 필드: 없다. 위 공통 프로필 행만 생긴다
- 로그인에만 쓰고 저장하지 않는 필드로 코드에 적힌 항목: 없다. 이름 있는 Google 필드 자체가 없다

### 2-2. Kakao

요청 scope 상수: `server/auth/kakao-oauth-scopes.js` 4행 `profile_nickname profile_image`.  
같은 파일 13-21행과 50-53행이 authorize URL의 scope를 그 값으로 바꾼다. `account_email`은 빼도록 되어 있다.  
호출: `public/auth.js` 66-96행. `skipBrowserRedirect: true` 뒤 `POST /api/auth/kakao-resolve-authorize`. 92-94행은 결과 URL에 `account_email`이 있으면 실패시킨다.  
서버: `server.js` 200-230행. 224-226행도 `account_email`이 남으면 `SCOPE_FIX_FAILED`이다.

- 요청 scope: `profile_nickname`, `profile_image`
- 요청하지 않음: `account_email`
- 앱이 실제로 읽는 Kakao 필드: 구현되지 않음. nickname, 프로필 이미지, 이메일을 읽어 테이블에 넣는 파서가 없다
- DB 저장: 공통 프로필 INSERT는 닉네임, 이미지, 이메일을 넣지 않는다
- 로그인 요청에만 있고 프로필 테이블에 저장되지 않는 항목: `profile_nickname`, `profile_image`

### 2-3. Naver

회원 로그인은 구현되어 있다. `public/auth.js` 105행이 provider를 `custom:naver`로 보낸다. scope는 넘기지 않는다.  
userinfo 프록시: `server/auth/naver-userinfo-proxy.js` 10행 `https://openapi.naver.com/v1/nid/me`.  
16-37행 `normalizeNaverUserinfo`:

- `response.id`가 비어 있으면 실패. 있으면 `sub`
- `response.email`이 비어 있지 않으면 `email`
- `response.name`이 비어 있지 않으면 `name`
- `response.nickname`이 비어 있지 않으면 `preferred_username`

그 외 Naver 필드(성별, 연령, 생일, 휴대전화, 프로필 이미지)는 이 함수가 읽지 않는다. 구현되지 않음.  
라우트: `server.js` 233-251행 `GET /api/auth/naver-userinfo`. 반환 JSON을 Supabase userinfo 호출자에게 넘긴다. 이 함수는 `public.profiles`에 INSERT하지 않는다.

- 요청 scope: 구현되지 않음. 저장소에 Naver 개발자 센터 scope 목록이 없다
- 프록시가 응답에서 읽는 필드: `response.id`, 있으면 `response.email`, `response.name`, `response.nickname`
- 호출자에게 넘기는 필드: `sub`, 있을 때만 `email`, `name`, `preferred_username`
- 이 앱 SQL이 `public.profiles`에 저장하는 Naver 필드: 없다
- 프로필 테이블에 저장하지 않고 userinfo JSON으로만 넘기는 필드: `email`, `name`, `preferred_username`. `sub`는 Supabase identity id용으로 넘긴다 (`server/auth/naver-userinfo-proxy.js` 4-7행). 프로필 행의 키는 `auth.users.id`이다
- `auth.users`에 이 JSON이 남는지는 이 저장소 SQL이 정의하지 않으므로 확정하지 않는다

탈퇴 HMAC은 별도이다. `server/retention-identity.js` 19-31행은 그 시점의 auth user에 `email`이나 identity `sub`가 이미 있으면 해시 입력으로 읽을 수 있다. OAuth 프로필을 `public.profiles`에 쓰는 코드가 아니다.

---

## 3. 초안이 맞춘 현재 제품 사실

공개 초안에 계산식을 확정 고지로 넣지 않았다.

- 영토 key: `pioneer`, `central`, `guardian`, `alien`. `reform` / `order`는 key가 아니다
- 신규 회원 시작 영토: `CENTRAL`. 가입 시 영토 선택 없음. 정치 점수 시작값은 0 (DEC-002)
- 반응 가중치: `shared/political-reaction-input-core.js` 55-60행. sameTerritoryPositive 70, centralRelation 100, otherTerritoryPositive 130, sameTerritoryNegative 130, otherTerritoryNegative 70. 같은 파일의 주석과 `shared/political-alignment-beta-v1-core.js` 248행, 314행도 70/100/130이다
- 오픈베타 권리침해 접수: 회원만. `shared/rights-infringement-core.js` 147행 `GUEST_INTAKE_OPEN = false`. 비회원 첨부 업로드는 `server/rights-infringement-routes.js` 114-116행에서 `GUEST_VERIFICATION_UNAVAILABLE`
- 정식 권리침해 보관 연수: 공개 초안은 기간을 확정하지 않는다. 코드 상수 `shared/rights-infringement-core.js` 184행 `FORMAL_RETENTION_YEARS = 5`는 공개 보관기간 확정이 아니다. 비정식 접수 상수는 185행 `INTAKE_RETENTION_YEARS = 1`이며, 그 1년 서술은 기존 초안과 코드를 그대로 둔다
- 민감정보 동의 철회: 회원용. `POST /api/me/legal/withdraw-sensitive-consent`. `server/legal-gate-service.js` 181-204행이 alignment 상태, 변화 기록, 영토 이동 기록을 지우고 동의 시각을 비운다. 계정은 지우지 않는다. `public/sensitive-consent-withdraw-ui.js` 256행은 로그인 회원만 철회한다고 안내한다
- legal_hold: OWNER만 설정, 해제 (DEC-021). 이 준비 작업은 DECISIONS를 바꾸지 않았다
- 신고 결과: `GET /api/alien/moderation/inbox`. `server/alien-moderation-routes.js` 84-94행. Alien V1이 꺼져 있어도 이 inbox를 쓴다. 저장 테이블은 `user_moderation_notifications`
- `GET /api/users/me/notifications`: `server/user-data-routes.js` 126-128행. 27-33행은 비활성이면 `USER_DATA_API_NOT_ACTIVATED`. `server.js` 747-759행은 `USER_DATA_OPERATIONAL`이 true가 아니면 그 비활성 경로다. 오픈베타 코드 블로커가 아니다
- Alien V1: DEC-019 오픈베타 정책은 켜짐. `server/alien-moderation-v1-flag.js` 20-24행은 환경변수가 없고 `NODE_ENV`가 production이면 코드 기본값이 꺼짐. 앱 서버 프로세스 정지는 2026-10-14 기록이다. 이 문서는 프로세스가 지금 실행 중이라고 쓰지 않는다
- 회원 제재 화면: `public/index.html` 18084행 버튼 문구 `제재 및 이의제기`. 동작은 `public/member-sanction-ui.js`
- 활동명 변경 UI: 저장소에서 `PUT /api/profile/me/display-name`을 호출하는 화면은 `public/activity-name-onboarding.js` 162행뿐이다. 서버 라우트는 `server/activity-name-routes.js` 94-97행에 있다

---

## 4. 오픈 직전 Production 체크리스트

완료 작업이 아니다. 전부 미실시다. 이 문서 작업에서 Production migration을 실행하지 않았다.

sentencearena-dev에서만 검증됨. project ref: `wzpreuseuiuzwpoqqckr`. Production에는 적용하지 않음.

- `supabase/migration_service_role_route_min_grants_v1.sql`
- `supabase/migration_audit_withdrawal_set_null_v1.sql`

두 파일은 서로를 참조하지 않는다. 둘 다 production REQUIRED catalog에 들어 있지 않다고 파일 머리말이 적는다. 적용 순서는 아직 결정이 아니다.

`supabase/migration_audit_withdrawal_set_null_v1.sql`을 Production에 적용하기 전까지, 제재/audit 이력이 있는 사용자 탈퇴는 기존 Production trigger에서 여전히 실패할 수 있다.

미실시 항목:

1. Production DB backup/status check: 미실시
2. migration order: 미실시. 위 두 파일의 상호 참조는 없다. 적용 전에 순서를 기록한다. 이 문서는 순서를 정해서 적용하지 않았다
3. Production env check: 미실시. 마지막으로 기록된 env 경로는 `/etc/sentencearena.env`이다. DEC-019 정책 ON과 2026-10-14 프로세스 정지는 별개다. 이번 작업은 호스트를 다시 보지 않았다
4. legal gate: 미실시. 코드의 production 기본 강제는 `server/legal-gate-service.js` 24-27행이다. Production env에서 다시 확인하지 않았다. 공개 법률 페이지는 아직 연결하지 않는다
5. OAuth settings: 미실시. 콘솔 scope와 Supabase provider 설정은 이 작업에서 확인하지 않았다. 앱이 기대하는 Kakao scope와 Naver userinfo 라우트는 2절이다
6. minimum smoke test: 미실시. 로그인, CENTRAL 시작, 글/댓글/반응, 신고 결과 inbox, 회원 권리침해 접수, 민감정보 동의 철회, 일반 탈퇴를 Production에서 다시 보지 않았다
7. NAVER 서버 시작: 필요할 때만. 이번 작업에서는 시작하지 않음
8. 공개 법률 페이지 연결: 미실시. 초안을 사이트에 올리지 않음
9. 최종 오픈베타 GO/NO-GO: 미실시

---

## 5. 이 작업에서 하지 않은 것

- Production migration 실행
- Production 데이터 변경
- NAVER 시작, 정지, 반납
- 법률 문서 게시 또는 공개 페이지 연결
- 사업자 명칭, 대표자, 주소, 지원 이메일, 개인정보 담당자, 시행일 기입
- 법원 이름 기입
- 정식 권리침해 보관 연수를 공개 문서로 확정
- DECISIONS 수정
