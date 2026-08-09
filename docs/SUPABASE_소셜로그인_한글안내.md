# Supabase 소셜 로그인 (Google · Apple · Kakao · Naver)

센텐스아레나는 **Supabase Auth**로 소셜 로그인을 시작합니다.

1. 사용자가 메인에서 **`/api/auth/oauth/<provider>`** 로 이동합니다.  
2. 서버가 Supabase가 준 **제공사 로그인 URL**로 **302** 리다이렉트합니다.  
3. 로그인이 끝나면 Supabase가 브라우저를 **`/auth/callback.html`** 로 보냅니다. (이 주소는 **앱 쪽 Redirect URL**에 반드시 등록되어 있어야 합니다.)  
4. 콜백 페이지가 토큰을 **`sessionStorage` 키 `sc_sb_auth_session`** 에 넣고 `/` 로 돌아갑니다.

아래는 **직접 해야 하는 설정**을 가능한 한 순서대로 정리한 것입니다.

---

## 0. 사전 준비 (프로젝트·서버)

1. **Supabase 프로젝트**를 하나 만듭니다. (없다면 [supabase.com](https://supabase.com)에서 생성)
2. 대시보드 **Project Settings → API** 에서 다음을 복사합니다.  
   - **Project URL** → 로컬 `.env` 의 `SUPABASE_URL`  
   - **anon public** 키 → `.env` 의 `SUPABASE_ANON_KEY`
3. 프로젝트 루트에 `.env` 파일이 있고, 위 두 값이 들어 있는지 확인한 뒤 **`npm start`** 로 서버를 띄웁니다.
4. 브라우저는 반드시 **`http://localhost:3000`** 처럼 **서버 주소**로 접속합니다. (`index.html` 파일을 더블클릭해서 `file://` 로 열면 OAuth가 동작하지 않습니다.)

**참고:** `<project-ref>` 는 Supabase URL에 들어 있는 프로젝트 식별자입니다.  
예: `SUPABASE_URL` 이 `https://abcdefghijk.supabase.co` 이면 `<project-ref>` = `abcdefghijk` 입니다.

---

## 1. Supabase — URL 설정 (가장 자주 틀리는 부분)

**경로:** 대시보드 → **Authentication** → **URL Configuration** (메뉴 이름은 대시보드 버전에 따라 조금 다를 수 있습니다.)

### 1-1. Site URL

- 로컬 개발: **`http://localhost:3000`**  
  (다른 포트를 쓰면 `http://localhost:그포트` 로 맞춥니다.)
- 실제 배포: **`https://실제서비스도메인`** (예: `https://app.example.com`)

### 1-2. Redirect URLs (허용 목록)

Supabase는 “로그인 후 사용자를 보낼 수 있는 **앱 쪽 주소**”만 화이트리스트로 받습니다.  
이 프로젝트는 콜백 파일이 **`/auth/callback.html`** 이므로 아래를 **그대로** 추가합니다.

| 환경 | 추가할 URL 예시 |
|------|------------------|
| 로컬 (포트 3000) | `http://localhost:3000/auth/callback.html` |
| 로컬 (포트 3001) | `http://localhost:3001/auth/callback.html` |
| 배포 | `https://당신의도메인/auth/callback.html` |

- **끝의 `/`**, **`http` vs `https`**, **포트 번호**까지 실제 접속 주소와 **완전히 같아야** 합니다.
- 여러 환경을 쓰면 **로컬·스테이징·운영** URL을 **각각** 넣습니다.

### 1-3. “Supabase 콜백”과 “앱 콜백” 두 가지를 헷갈리지 않기

| 이름 | URL 형태 | 어디에 등록하나 |
|------|-----------|-----------------|
| **Supabase Auth 콜백** | `https://<project-ref>.supabase.co/auth/v1/callback` | **Google / Kakao / Naver / Apple** 등 **제공사 개발자 콘솔**의 “리다이렉트 URI / Callback URL” |
| **앱 콜백 (이 프로젝트)** | `http://localhost:3000/auth/callback.html` 등 | **Supabase 대시보드**의 **Redirect URLs** |

흐름은 대략 다음과 같습니다.

1. 사용자 → Google(등) 로그인  
2. Google → **Supabase** `…/auth/v1/callback`  
3. Supabase가 세션을 만든 뒤 → **앱** `…/auth/callback.html` 로 보냄  

그래서 **제공사 콘솔**에는 Supabase 주소를, **Supabase**에는 앱 주소를 넣는 식으로 **둘 다** 설정합니다.

---

## 2. Supabase — Providers 켜기

**경로:** **Authentication** → **Providers**

1. 사용할 제공사(Google, Apple, Kakao, Naver)를 **하나씩** 연다.
2. **Enable** 을 켭니다.
3. 해당 제공사 개발자 콘솔에서 발급한 **Client ID**(또는 동등한 이름)와 **Client Secret** 을 붙여 넣고 저장합니다.

**Naver:** 대시보드 Provider 목록에 **Naver** 항목이 없으면, 해당 Supabase 호스트/리전에서는 아직 제공되지 않을 수 있습니다. 그 경우 Naver는 보류하고 나머지부터 연결하거나, Supabase 공지·문서에서 Naver 지원 여부를 확인합니다.

---

## 3. Google — 직접 할 일

1. [Google Cloud Console](https://console.cloud.google.com/) 에서 프로젝트 선택 (없으면 생성).
2. **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth client ID**.
3. 앱 유형은 보통 **Web application**.
4. **Authorized redirect URIs**에 다음을 **정확히** 추가합니다.  
   `https://<project-ref>.supabase.co/auth/v1/callback`
5. 생성된 **Client ID**, **Client Secret** 을 Supabase **Authentication → Providers → Google** 에 입력합니다.
6. (선택) OAuth 동의 화면에서 테스트 사용자·앱 정보를 요구하면 콘솔 안내에 따라 채웁니다.

---

## 4. Apple — 직접 할 일 (요약)

Apple은 단계가 많고, **웹은 HTTPS**가 일반적입니다.

1. [Apple Developer](https://developer.apple.com/) — **Certificates, Identifiers & Profiles**.
2. **App ID**, **Services ID**(웹용), **Sign in with Apple** 용 키·도메인·Return URL 설정 등을 Apple 문서 순서대로 진행합니다.
3. Return URL(또는 동등 필드)에 Supabase 콜백을 넣습니다.  
   `https://<project-ref>.supabase.co/auth/v1/callback`
4. Supabase **Providers → Apple** 에 Services ID, 팀 ID, 키 ID, 비밀키(또는 대시보드가 요구하는 항목)를 입력합니다.

로컬 `http://localhost` 만으로는 Apple이 요구하는 설정과 맞지 않을 수 있어, **배포 HTTPS 도메인**에서 먼저 검증하는 경우가 많습니다.

---

## 5. Kakao — 직접 할 일

1. [Kakao Developers](https://developers.kakao.com/) 에 로그인 후 **애플리케이션 추가**.
2. **앱 키**에서 **REST API 키** 확인 (Supabase에 넣는 값은 대시보드 안내에 따름. 보통 Client ID/Secret 대응).
3. **플랫폼**에 웹 도메인 등록 (로컬은 `http://localhost:3000` 등 실제 접속 origin).
4. **카카오 로그인** 활성화, **Redirect URI** 에 Supabase 콜백 추가:  
   `https://<project-ref>.supabase.co/auth/v1/callback`
5. **동의 항목**: 이메일 등 필요한 항목을 켜고, 검수가 필요하면 카카오 안내에 따릅니다.
6. Supabase **Providers → Kakao** 에 앱에서 받은 키/비밀을 입력합니다.

카카오·Supabase 조합에서 이메일 스코프/비즈 앱 여부 때문에 막히는 경우가 있어, 동의 항목과 앱 상태를 먼저 확인하는 것이 좋습니다.

---

## 6. Naver — 직접 할 일

1. [네이버 개발자 센터](https://developers.naver.com/) 에서 **애플리케이션 등록**.
2. **로그인 오픈 API** 사용 설정, **Callback URL** 에 Supabase 콜백 추가:  
   `https://<project-ref>.supabase.co/auth/v1/callback`
3. **Client ID**, **Client Secret** 을 Supabase **Providers → Naver** 에 입력합니다.

**주의:** Supabase 대시보드에 **Naver** 자체가 없으면 이 단계는 진행할 수 없습니다. (위 2절 참고)

---

## 7. 서버 환경변수 (선택이지만 운영에서 유용)

| 변수 | 언제 쓰나 |
|------|-----------|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | **필수.** 없으면 로그인 API가 동작하지 않습니다. |
| `PORT` | 기본 3000. 바꾸면 Redirect URLs도 그 포트에 맞춰 추가합니다. |
| `TRUST_PROXY=1` | Nginx 등 **리버스 프록시 뒤**에서 HTTPS·호스트를 `X-Forwarded-*` 로 알릴 때. 잘못 켜면 보안 이슈가 될 수 있으니 **신뢰할 수 있는 프록시 뒤에서만** 사용합니다. |
| `APP_PUBLIC_ORIGIN` | 예: `https://app.example.com` — OAuth 돌아올 때 쓸 **공개 origin**을 고정하고 싶을 때 (프록시가 잘못된 Host를 넘길 때 등). **슬래시(/)로 끝나지 않게** 넣습니다. |

---

## 8. 동작 확인 체크리스트

- [ ] `.env`에 `SUPABASE_URL`, `SUPABASE_ANON_KEY` 있음  
- [ ] Supabase **Redirect URLs**에 `http://localhost:포트/auth/callback.html` 있음  
- [ ] 켠 제공사마다 **제공사 콘솔**에 `https://<project-ref>.supabase.co/auth/v1/callback` 있음  
- [ ] `npm start` 후 **`http://localhost:포트/`** 로 접속 (file:// 아님)  
- [ ] 메인에서 소셜 버튼 클릭 → 제공사 로그인 → 다시 메인으로 돌아온 뒤 **로그인: 이메일** 표시되는지 확인  

---

## 9. 문제 해결 (짧게)

| 증상 | 확인할 것 |
|------|-----------|
| `redirect_uri_mismatch` (Google 등) | 제공사 콘솔의 Redirect URI가 **Supabase** `…/auth/v1/callback` 과 **글자 하나까지** 같은지 |
| Supabase가 “redirect url not allowed” 류 | Supabase **Redirect URLs**에 **앱** `…/auth/callback.html` 이 있는지, Site URL·포트·https 일치 |
| 콜백 페이지에 PKCE 안내만 뜸 | implicit/hash 흐름이 아닌 경우. `server.js` 의 `flowType: 'implicit'` 유지 여부·대시보드 설정 확인 |
| Naver 버튼만 실패 | 대시보드에 Naver 제공사 존재 여부, 키·콜백 URL |

더 기술적인 배경은 Supabase 공식 문서의 **Social Login / OAuth** 가이드를 함께 보면 좋습니다.
