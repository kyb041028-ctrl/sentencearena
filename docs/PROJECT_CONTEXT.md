# 센텐스크래프트 — 프로젝트 컨텍스트

> 다른 Cursor 세션에서 이 문서를 먼저 읽어 프로젝트 전체 맥락을 파악하세요.
> 마지막 업데이트: 2026-08-07 (브랜드 SentenceCraft · GitHub `sentencecraft`)
>
> **AI 인수인계 요약:** `docs/AI_HANDOFF.md` ← 새 세션 시 이 문서도 함께 읽기

---

## 1. 프로젝트 소개

### 브랜드 · GitHub 식별자 (2026-08-07 확정)

| 항목 | 값 |
|------|-----|
| 한글 브랜드 | 센텐스크래프트 |
| 영문 브랜드 | **SentenceCraft** |
| GitHub repository | `kyb041028-ctrl/sentencecraft` |
| clone / origin | `https://github.com/kyb041028-ctrl/sentencecraft.git` |
| npm package name | `sentence-craft` (내부 slug · 하이픈 유지) |
| API service name | `sentence-craft-api` |
| 브라우저 storage prefix | `sc_*` |

> 구명 `sentnse_craft` → `sentence-craft` → 최종 `sentencecraft`. 오타 `SentensCraft` 등은 표시에 사용하지 않음.

### 데일리 이슈 현재 운영 원칙 (2026-08-04~07)

- 데일리 이슈는 정치 성향 설문이 아닌 출처 기반 자유 토론 콘텐츠다.
- 시스템은 절대적 진실을 판정하지 않는다. 확인된 내용·주장·불일치·미확인·분석을 분리 표시한다.
- **수집:** 교차 확인 가능 출처 묶음 + 공식기관 allowlist. 뉴스 사이트 대량 본문 크롤 금지.
- 검수·저장: repository · PostgreSQL · 관리자/공개 API · 관리자 UI(`/admin/daily-issues`). 개발 schema `daily_issue_test`. 운영 schema `daily_issue`(베타 전).
- **공개 UI:** 중앙광장 → `GET /api/daily-issues` · PUBLISHED·미만료만.
- **아침 스케줄러:** 04:30 수집 / 05:00 게시(KST) · 첫 Railway 배포 시 OFF 권장.
- 답변 선택 제거 · 열람/체류/작성 성향 미반영 · 댓글 좋아요/싫어요 LEGACY_LOCAL 유지.
- 정적 풀 58개는 운영 게시 대상 아님(QUARANTINED).

**센텐스크래프트(SentenceCraft)**는 "글로 싸우는 전쟁"을 테마로 한 게임형 커뮤니티 플랫폼입니다.

- 일반 SNS/커뮤니티가 아닌, **전략 게임의 세계관을 가진 커뮤니티**
- 사용자가 글을 쓰고 반응하면서 자신의 **성향(정치 스펙트럼)** 이 결정되고 **영토에 소속**됨
- 영토별로 게시판 접근 권한이 다르며, 충분한 비호감을 받으면 **외계행성으로 추방**됨
- 현재: **베타 뼈대** 상태 (기능 구조는 잡혀 있으나 일부 미구현)

### 기술 스택

| 구성 | 내용 |
|------|------|
| 백엔드 | Node.js + Express (`server.js`) |
| DB / Auth | Supabase (PostgreSQL + Supabase Auth) |
| 프론트엔드 | 단일 파일 SPA (`public/index.html`) — 빌드 없음 |
| 배포 | `npm start` → `http://localhost:3000` |
| 결제 | 카카오페이 / 토스페이 / 휴대폰 소액결제 (기획 정의됨, 미구현) |

---

## 2. 세계관

### 핵심 개념

- **글 = 무기**: 게시글·댓글·반응이 모두 플레이어의 성향과 영토 기여에 영향을 미침
- **성향(Alignment)**: 개척(좌) ↔ 중도 ↔ 수호(우) 스펙트럼. 활동할수록 수치가 이동
- **영토 귀속**: 성향 수치가 일정 기준에 도달하면 해당 영토의 주민이 됨
- **첩자(Spy)**: 소속 영토가 아닌 타 영토 게시판에 글을 쓸 경우 "종횡무진 척후대" 배지 부여
- **추방(Exile)**: 비호감 30개 이상 → 외계행성으로 추방, 3,000원 결제 시 귀환 가능

### 결제 상품

| 상품 | 가격 | 설명 |
|------|------|------|
| 월 구독권 | 4,900원 | 구독 보너스 부여 (매일 5시 리셋) |
| 직언패스500 | 500원 | 영구 보존 (리셋 후에도 소멸 안 됨) |
| 지구귀환티켓 | 3,000원 | 외계행성 추방 후 영토 귀환 |

---

## 3. 영토 구조

### 메인 4 영토

| CSS key / 내부 ID | 표시명 | 색상 코드 | 설명 |
|-------------------|--------|-----------|------|
| `centrist` / `COMMON` | 중앙광장 | `#3DFFB3` (녹색) | 중도 성향, 데일리 이슈 허브 |
| `reform` / `PROGRESSIVE` | 개척영토 | `#5AA8FF` (파랑) | 개척(좌) 성향, 게시판 4단계 |
| `order` / `CONSERVATIVE` | 수호영토 | `#FF5A5A` (빨강) | 수호(우) 성향, 게시판 4단계 |
| `alien` / `KANTAPBIYA` | 외계행성 | `#C77DFF` (보라) | 추방자·관측자 허브 |

> ⚠️ "깐따삐아" 명칭은 사용하지 않습니다. 내부 ID `KANTAPBIYA`는 유지.

### 영토 부제 (subtitle)

| 영토 | 부제 |
|------|------|
| 중앙광장 | 대화하는 사람 |
| 개척영토 | 변화를 만드는 사람 |
| 수호영토 | 질서를 지키는 사람 |
| 외계행성 | 경계를 관측하는 사람 |

### CSS data-territory 값

UI에서 영토 색상 전환은 **`data-territory` 속성 하나로** 제어됩니다.

```js
// JS에서 영토 변경 시 이렇게만 하면 배너/신념HUD/게이지 색상이 자동 전환
document.querySelector('.avatar-dock__panel').dataset.territory = 'reform';
document.querySelector('#avatar-territory-badge').dataset.territory = 'reform';
```

### 영토 게시판 단계 (Tier)

- Tier 1: 모두 읽기 가능, 쓰기는 성향 해금 필요
- Tier 2~4: 성향 강화 해금 필요 (읽기 포함)
- 외계행성: 단계 없음, 카테고리만 존재 (자유게시판/관측기록/밈/생존일기)

### 영토 인구 시각화 단계

| 인구 구간 | 단계 키 | 표현 |
|-----------|---------|------|
| 1 ~ 500 | TRIBAL | 시대 부족, 모닥불·사냥 |
| 501 ~ 2,000 | HAMLET | 초소형 촌락 |
| 2,001 ~ 4,999 | TOWN | 마을·도시 기반 |
| 5,000+ | AGRARIAN | 농경·도시 기반 사회 |

---

## 4. 영토 신념 시스템

신념은 `public/territory-beliefs.js` — 단일 출처(Single Source of Truth)에서 관리됩니다.

```js
// window.TERRITORY_BELIEFS[cssId]
{
  displayName : '개척영토',         // 사용자 표시명
  subtitle    : '변화를 만드는 사람', // 영토 부제
  belief      : '미래는 기다리는 것이 아니라,\n개척하는 것이다.',  // 프로필 HUD 표시
  philosophy  : '변화를 두려워하지 않고\n새로운 가능성을 향해 나아간다.' // 미표시, 향후 활용
}
```

| 영토 | 신념 문장 |
|------|-----------|
| 중앙광장 | "답은 하나가 아니라, 함께 찾는 것이다." |
| 개척영토 | "미래는 기다리는 것이 아니라, 개척하는 것이다." |
| 수호영토 | "질서는 자유를 지키는 가장 강한 약속이다." |
| 외계행성 | "경계 밖의 시선은 새로운 문명을 만든다." |

### 공식 영토 에셋 v1 (2026-07-05)

배너 4장 + 엠블럼 4개를 **공식 에셋 v1**으로 취급한다.

```
public/assets/territories/banners/
  reform.webp | centrist.webp | order.webp | alien.webp

public/assets/territories/emblems/
  reform.webp | centrist.webp | order.webp | alien.webp
```

| CSS key | 표시명 | 배너 테마 | 엠블럼 |
|---------|--------|-----------|--------|
| `reform` | 개척영토 | 파랑·은색 | 검 + 날개 |
| `centrist` | 중앙광장 | 초록·금색 | 그리스 신전/기둥 |
| `order` | 수호영토 | 빨강·금색 | 방패 + 검 |
| `alien` | 외계행성 | 보라·금색 | 보라 수정 |

프로필에서 `--profile-territory-banner-url`, `--profile-territory-emblem-url` CSS 변수로 연결 중.  
레거시 `assets/territory-icons/*.png` 참조는 점진 교체 예정(아직 일부 유지).

---

## 5. UI 철학

- **게임 HUD처럼**: 웹사이트가 아니라 전략게임/RPG의 인터페이스
- **정보 계층**: 데일리 이슈(Primary) → 인기글/실시간 현황(Secondary) → 게시글(Passive)
- **세계관 연출**: 영토 색상이 프로필 배너, 신념 영역, 성향 레이더에 통일되게 반영
- **압축 + 가독성**: 한 화면에 최대한 많은 정보가 들어오되 답답하지 않게
- **CSS-only 테마**: JS 속성 변경 한 줄로 전체 테마가 전환되도록 CSS 변수와 `data-*` 속성 활용

### 프로필 — ProfileFrame (2026-07-09 기본 UI)

> **ProfileFrame이 기본 프로필 UI.** legacy 영토 시민 카드(`.profile-citizen-card__legacy`)는 `hidden` 유지.

#### 레이아웃

| 항목 | 내용 |
|------|------|
| 위치 | 좌측 하단 HUD 고정 |
| 외곽 | 바깥 패널·헤더·테두리 제거 |
| 접기 | ProfileFrame 내부 우측 하단 (`#avatar-dock-hide`) |
| PNG | `background-size: contain` · 원본 비율 `1024 / 819` · 크기·위치 고정 |

#### ProfileFrame · territorySkin

| skin key | 영토 | 프로필 PNG 경로 | 상태 |
|----------|------|-----------------|------|
| `center` | 중앙광장 | `public/assets/territories/profiles/center.png` | ✅ |
| `pioneer` | 개척영토 | `public/assets/territories/profiles/pioneer.png` | ✅ |
| `guardian` | 수호영토 | `public/assets/territories/profiles/guardian.png` | ✅ |
| `alien` | 외계행성 | `public/assets/territories/profiles/alien.png` | ✅ |

- 기본값: `center` (`data-territory-skin="center"`)
- `renderProfileData(data).territorySkin` → `setProfileTerritorySkin()` → PNG + 스킨별 좌표 동기화

#### 오버레이 레이어

| ID | 역할 | 상태 |
|----|------|------|
| `userIdLayer` | USER ID | ✅ 데이터 출력 |
| `levelLayer` | LEVEL | ✅ |
| `fameLayer` | 명성 | ✅ |
| `expLayer` | 경험치 % 텍스트 | ✅ |
| `expGaugeLayer` | 경험치 게이지 (배경 바) | ✅ 100% Fill 고정 |
| `activitySummaryLayer` | 활동 요약 5칸 | ✅ |
| `territoryRecordLayer` | 영토 기록 4칸 | ✅ |
| `alignmentMapLayer` | 성향 지도 SVG | ✅ 데이터 출력 |
| `achievementLayer` | 대표 업적 3칸 | ✅ 이미지 슬롯 · 좌표 에디터 |

**정렬:** USER ID 왼쪽 · LEVEL 가운데 · 명성·경험치 오른쪽 · 활동 요약 오른쪽 · 영토 소속·등급 가운데 / 이동·영향력 오른쪽

#### 좌표 체계

- **% 좌표 폐기** → `SC_PROFILE_LAYOUT` / `SC_PROFILE_LAYOUT_BY_SKIN` — **1024×819 px**
- `applyProfileFramePixelLayout()` — `scale = 프레임 너비 ÷ 1024`
- center=pioneer 공통 · guardian/alien은 activity·territory 좌표 개별
- **좌표 에디터 (localhost):** 드래그 · 방향키 · localStorage v3 · 전체 좌표 복사 · 성향지도 캘리브레이션 · **대표 업적 슬롯** (영역+슬롯0~2 · AI 복사)

#### 데이터 파이프라인 (표준 흐름)

```
SC_PROFILE_DATA
      ↓
getCurrentProfileData()    ← loadCurrentUserProfile() merge (Auth · progression · 활동 요약)
      ↓
buildUserProfileDataForModal(userId)  ← 타인 프로필 모달 (활동 요약 merge)
      ↓
finalizeProfileDisplayFields()  ← activityDisplay · territoryDisplay 확정
      ↓
applyProfileFramePixelLayout(frameRoot)  ← 목록 레이어 bounds (모달 클리핑 방지)
      ↓
renderProfileData(data, { frameRoot })    ← activityDisplay/territoryDisplay · territorySkin PNG · expGauge
      ↓
ProfileFrame
```

**`SC_PROFILE_DATA` 필드**

```js
{
  userId, level, fame, expPercent, territorySkin,
  activity: { posts, comments, receivedLikes, discussions, aura },
  territory: { current, moved, influence, rank },
  alignment: { center, pioneer, guardian, alien }  // 0~100
}
```

**JS API**

| 전역 | 역할 |
|------|------|
| `window.SC_PROFILE_DATA` | 더미 단일 소스 (개발·테스트) |
| `window.getCurrentProfileData()` | 프로필 객체 반환 (안전 복사) |
| `window.resolveUserProfileActivity(userId)` | 활동 요약 5칸 집계 (게시판 bundle · postId/commentId 중복 제거) |
| `window.resolveUserTerritoryRecord(userId)` | 영토 기록 4칸 집계 (PlayerProgression · 시즌 아카이브 · 유저 버킷) |
| `window.finalizeProfileDisplayFields(profile, userId)` | 렌더 직전 `activityDisplay` · `territoryDisplay` 확정 |
| `window.__scResolvedProfileData(userId)` | 렌더 직전 최종 profileData clone (디버그) |
| `window.__scInspectProfileFrame(userId)` | 최종 data + 모달 DOM textContent·layerBounds 조회 |
| `window.__scProfileActivity(userId)` | 활동 요약 디버그 별칭 |
| `window.__scTerritoryRecord(userId)` | 영토 기록 디버그 별칭 |
| `window.renderProfileData(data)` | ProfileFrame 렌더 |
| `window.refreshCurrentProfile()` | get → render 개발용 갱신 |
| `window.setProfileTerritorySkin(key)` | PNG + 좌표 스킨 전환 |
| `window.SC_PROFILE_LAYOUT` | 활성 px 좌표 (에디터 가변) |
| `window.__scProfileLayoutEditor` | localhost 좌표 에디터 API (`getAlignmentEditorMax` · `copyAlignmentCalibration` 등) |

#### 경험치 게이지 (expGauge)

- **영토 색상 사용 안 함** — 4개 영토 모두 동일 디자인 (유저 성장 수치)
- Fill: `linear-gradient(90deg, #fff0a0 → #f0d050 → #d4a828 → #a07018 → #6b4512)` — 좌 밝은 노랑 · 우 짙은 갈색
- Track: `#3d2810`
- 게이지 바: **항상 100% Fill** (배경) · 실제 진행률은 `expLayer` 텍스트(`68%` 등)만
- `expGauge`: `{ x: 392, y: 126, w: 590, h: 10 }` — 좌표 에디터로 조정 가능

#### 성향 지도 SVG (alignmentMapLayer)

- `data.alignment` 4축 (0~100) → polygon · polyline · 점
- fill `rgba(255,215,90,0.22)` · stroke-width 2 · `drop-shadow` gold glow
- 값 변경 시 `transition 0.28s ease-out`
- 중심점 circle · 축 점 r 2.8
- **현재 소속 ♛** — 제거 (PNG 텍스트 가림 방지)
- `alignmentMap`: center/pioneer `{ x: 305, y: 355 }` · guardian/alien `{ x: 309, y: 360 }` (w/h 190)
- **캘리브레이션 그룹:** `centerPioneer` (중앙·개척) · `guardianAlien` (수호·외계)
- `SC_PROFILE_ALIGNMENT_AXIS_MAX_BY_GROUP` — 축별 최대 스케일 (게임값 100 → PNG 축 끝)
- 에디터: 그룹별 `previewMax` · 빨간 점 = 중앙(0) · 「성향지도 복사」

#### 대표 업적 (achievementLayer)

- `data.achievements` — `{ id, title, date }` 객체 배열 (최대 3) · 문자열 id 하위 호환
- 슬롯 3단: 아이콘 → 이름 → 날짜 (`profile-achievement-title` · `profile-achievement-date`)
- `SC_PROFILE_LAYOUT.achievement` — 영역 · `achievementSlots[0~2]` — 슬롯 (1024×819 px)
- 좌표 에디터: 영역+슬롯 드래그 · 스킨별 localStorage · 「업적 슬롯 복사 (AI 전달용)」

#### 영토 시민 카드 확정 방향 (legacy·향후 연동 참고)

> ⚠️ 아래 원칙은 legacy UI 및 향후 아바타·레이더 연동 시 준수. ProfileFrame 단계에서는 PNG+오버레이만 적용.

| 원칙 | 내용 |
|------|------|
| 주인공 | **유저**가 주인공. 영토는 배경 정체성 |
| 카드 형태 | **영토 시민 카드** 기반 게임형 HUD 유지 |
| 아바타 | **왼쪽 전신 영역**으로 크게 확보 (placeholder → 추후 전신 이미지) |
| 신념 배너 | 우측 정보 영역 **보조 배너**. 유저보다 주인공처럼 보이면 안 됨 |
| 성향 | **레이더 하나만** 사용 |
| 금지 UI | 정치성향 **가로 게이지**, **퍼센트 노출** 사용 안 함 |
| 금지 항목 | 프로필 **가입일** 표시 안 함 |
| 소속 | **중복 표기 금지** — 한 곳(아바타 하단 등)에만 |

#### 활동 요약 (표시명·우선순위) — **실데이터 연결 1차 (2026-07-12)**

| 항목 | 필드 | 데이터 소스 |
|------|------|-------------|
| 작성 글 | `activity.posts` | `sc_board_bundle_v1` — authorId 일치 · postId 중복 제거 |
| 댓글 | `activity.comments` | 동일 bundle — 댓글·대댓글 · authorId 식별 가능만 · commentId 중복 제거 |
| 받은 공감 | `activity.receivedLikes` | 본인 글·댓글의 `reactions.empathy` 합 (likes/dislikes 제외) |
| **토론 참여** | `activity.discussions` | 글·댓글 작성이 있었던 **서로 다른 postId** 수 |
| **전달한 아우라** | `activity.aura` | 기존 집계 없음 → 표시 `--` (Mock은 미로그인 데모만) |

> 집계 헬퍼: `resolveUserProfileActivity(userId)` · 표시 확정: `finalizeProfileDisplayFields()` → `activityDisplay`.

**표시 기준 (2026-07-12):** 활동·영토 **숫자형** — 1 이상 숫자 · **0도 `--`** · bundle/기록 확인 불가 `--` · `value \|\| '--'` 금지 · 원본 `activity`/`territory` 숫자는 유지.

> **팔로워**는 프로필 핵심 활동 요약에서 우선순위를 낮춤. (팔로우 수는 헤더 등 보조 영역 가능)

**전달한 아우라** — 정의:

> 내 활동이 다른 시민에게 전달한 영향력.  
> 글 / 댓글 / 토론 참여 유도 / 공감 / 상호작용 등을 통해 다른 시민에게 남긴 영향력의 **누적 지표**.

#### 영토 기록 (표시명) — **실데이터 연결 1차 (2026-07-12)**

ProfileFrame `territoryRecordLayer` 4칸 (`renderProfileData` 순서):

| 표시명 | 필드 | 데이터 소스 |
|------|------|-------------|
| **현재 소속** | `territory.current` | `__scPlayer.territoryId` · `PlayerProgression.getState().territoryId` · `forcedTerritory` · 없으면 `기록 없음` |
| 이동 횟수 | `territory.moved` | 시즌 아카이브 · `exileHistory` · 기록 없으면 `--` · **집계 0도 `--`** |
| 시민 영향력 | `territory.influence` | `getMyStandings` / `rankReputationScore` · 계산 불가 `--` · **0도 `--`** |
| 시민 등급 | `territory.rank` | `PlayerProgression.getDisplay().rankShort` · 없으면 **참여자** |

> **「최초 소속」은 사용하지 않음** (폐기된 표현). 집계: `resolveUserTerritoryRecordRaw` · 표시: `normalizeTerritoryRecordDisplay` · `finalizeProfileDisplayFields`.

#### 성향 지도 — AI 한 줄 설명 (향후)

레이더 **아래**에 AI가 성향 변화를 한 줄로 설명하는 보조 영역을 둔다.  
수치·퍼센트 대신 **변화 흐름**을 설명한다.

예: `"최근 활동으로 개척 성향이 조금 증가하고 있습니다."`

---

## 6. 디자인 시스템

### CSS 변수 (`:root`)

| 카테고리 | 변수 접두어 | 예시 |
|---------|------------|------|
| 여백 | `--sc-sp-*` | `--sc-sp-sm`, `--sc-sp-md` |
| 테두리 반경 | `--sc-r-*` | `--sc-r-sm`, `--sc-r-md` |
| 테두리 색 | `--sc-bc-*` | `--sc-bc-subtle` |
| 버튼 | `--sc-btn-*` | `--sc-btn-h` |
| 카드 | `--sc-card-*` | |
| 타이틀 | `--sc-title-*` | |
| 폰트 | `--sc-fs-*` | |
| 패널 | `--sc-panel-*` | |
| 입력 | `--sc-input-*` | |
| 트랜지션 | `--sc-ease` | `all 0.15s ease` |
| 프로필 패널 폭 | `--avatar-panel-width` | `56rem` |
| 좌측 카드 폭 | `--avatar-left-col-w` | `18.5rem` |

### UI Kit 클래스

| 클래스 | 역할 |
|--------|------|
| `sc-panel` | 패널 컨테이너 (프로필, 채팅 등) |
| `sc-card` | 카드 컴포넌트 |
| `sc-badge` | 배지 (레벨, 영토, 업적 등) |
| `sc-btn` | 버튼 (Primary / Secondary) |
| `sc-section-title` | 섹션 헤더 |
| `sc-tag` | 태그 (자유토론, 정보·분석 등) |
| `sc-input` | 입력창 |

### 영토 색상 체계

```css
/* 성향 게이지 그라디언트 */
centrist  : #3DFFB3 → #8CFFD9
reform    : #5AA8FF → #A5D4FF
order     : #FF5A5A → #FFB1B1
alien     : #C77DFF → #E6B3FF

/* 배너 배경 (8~10% 투명도) */
centrist  : rgba(61, 255, 179, 0.08)
reform    : rgba(90, 168, 255, 0.08)
order     : rgba(255, 90, 90, 0.08)
alien     : rgba(199, 125, 255, 0.08)
```

---

## 7. 현재 구현 상태

> **2026-07-25 세션 요약**  
> **영토 발전 Hover 패널 (Mock)** — 지도 영토 hover 시 발전 이미지·인원·단계·다음 단계 진행률 표시  
> `territory-evolution-images.js` · `territory-evolution-population.js` · `territory-evolution-hover.js`  
> 실데이터 census API 없음 → Mock fallback · 지도/히트존/클릭 미변경  
> **다음:** Follow System v1 **2차 QA** · 발전 인원 실데이터 API

> **2026-07-12 세션 요약**  
> **Follow System v1** — 팔로워/팔로잉 목록 모달 · HUD 진입 · 팔로잉 탭 언팔로우 · ProfileFrame 상단 팔로워 수 · **localStorage 전용** (`sc_follow_v1`)  
> **ProfileFrame** — 활동/영토 표시 안정화 · 빈값/`--` 규칙 · 활동 숫자 0→`--` · HUD/모달 Overlay 동기화  
> **이후 예정:** Settings System v1 · Admin System v1

### ✅ 구현 완료

- **영토 발전 Hover 패널 (2026-07-25, Mock)** — peek viewer · 발전 인원/단계 자동 판정 · 외계 전용 단계명 · 다음 단계 필요 인원·진행률 바 · 집계 정책/하락 정책 확정(실데이터 연동은 미완)
- 로그인/회원가입 UI (소셜 로그인 버튼 포함)
- 게스트 모드
- 메인 지도 화면 — **2026-07-22 통합 영토 이미지** · 히트존(`0 0 1600 900`) · 영토별 호버 (기준선 유지)
- 중앙광장 허브 (데일리 이슈, 오늘의 인기글, 실시간 영토 현황, 게시글, 페이지네이션)
- 영토 게시판 (개척/수호/외계행성)
- 게시글 작성/조회/반응 (공감/추천/비추천)
- **Community System v1 (2026-07-11)** — 북마크(`sc_bookmarks_v1`) · 공유(링크 복사) · 신고(`sc_reports_v1` · 상세 의견)
- **Community System v2 북마크 목록 1차 (2026-07-12)** — `bookmark-list.js` · HUD 북마크 모달 · 저장 글 목록·이동·해제
- **Follow System v1 (2026-07-12)** — `follow-list-modal.js` · `FollowListModal` · HUD 팔로워/팔로우 수 클릭 진입 · 2탭 모달(팔로워/팔로잉) · 시민 목록·프로필 연결 · **팔로잉 탭 언팔로우** (`toggleFollow`) · `__scFollowLists` · **localStorage** (`sc_follow_v1`)
- **ProfileFrame 상단 팔로워 (2026-07-12)** — `followers` · `FollowSystem.getFollowerCount` · 4스킨 좌표 통일 · 금색 라벨 · 명성 박스 톤 숫자 박스 · 좌표 에디터 X/Y/W/H · **아이콘/Emoji 없음(텍스트만)**
- **ProfileFrame 표시 안정화 (2026-07-12)** — 활동 요약/영토 기록 `normalize*Display` · 빈값 `--` · 활동·영토 숫자 0→`--` · 모달 Overlay 레이어 바인딩 수정 · `__scInspectProfileFrame`
- **UserCard / 프로필 진입 UX (2026-07-11)** — `wireScUserProfileLink()` · 아바타·닉네임·유저 ID만 클릭 · Hover는 `title` 안내만 (`ScMiniProfile` 팝업 연결 해제, 코드 보류)
- **displayName 통일 기반 (2026-07-12)** — `public/display-name.js` · `resolveDisplayName(userId)` · `sc_display_names_v1` 캐시 · 표시 fallback `userId`
- **Search System v1 (2026-07-12) ✅** — `search-system.js` · 통합검색 모달 · **시민** displayName 검색 · **토론** 제목/본문/작성자 검색 · `__scBoardNavigateToPost`
- **랭킹 UI (2026-07-11)** — 전체/중앙/개척/수호/외계 5탭 · TOP5 강조 · `rank-leaderboard.js`
- 팔로우 시스템 + 알림
- **플레이어 프로필 — ProfileFrame (2026-07-09)**
  - PNG 기반 기본 UI · 4종 `territorySkin` · 좌측 하단 HUD · 접기 버튼 내장
  - `SC_PROFILE_LAYOUT` px 좌표 (1024×819) · localhost 좌표 에디터
  - `SC_PROFILE_DATA` · `getCurrentProfileData()` · `renderProfileData()` · `refreshCurrentProfile()`
  - 출력: USER ID · LEVEL · 팔로워 · 명성 · 경험치% · 활동 요약 5 · 영토 기록 4 · expGauge
  - legacy `.profile-citizen-card__legacy` — hidden 유지
- 레벨/XP/명성 표시 (legacy 영역 + ProfileFrame 더미)
- 권한 안내 탭
- 히스토리 탭
- 게시글 상세 화면
- Supabase Auth API (`/api/auth/*`)
- 플레이어 프로필 API (`/api/me/profile`)
- 채팅 API (인메모리 베타)
- **영토 신념 데이터** (`public/territory-beliefs.js`) — Single Source of Truth
- **공식 에셋 v1** WEBP 8종 (`assets/territories/banners/`, `emblems/`)
- **프로필 PNG 4종** (`assets/territories/profiles/` — center, pioneer, guardian, alien)

### ⚠️ 부분 구현 / 뼈대만 있음

- Supabase DB 연동 (테이블 설계됨, 일부 API 미완성)
- 성향 계산 로직 (config 정의됨, 실제 집계 미구현)
- 레벨/XP 계산 (config 정의됨, ProfileFrame은 더미 `expPercent`만)
- 영토 귀속 자동화 (룰 정의됨, 자동 처리 미구현)
- 프로필 활동 요약 — **ProfileFrame 실데이터 1차** + **표시 안정화** (2026-07-12): `normalizeProfileActivityDisplay` · 0→`--` · 모달 HUD 동기화
- 프로필 영토 기록 — **ProfileFrame 실데이터 1차** + **표시 fallback** (2026-07-12): `normalizeTerritoryRecordDisplay` · 빈값 규칙
- ProfileFrame `alignmentMapLayer` — SVG 더미 연동 완료 · `achievementLayer` placeholder
- **`ScMiniProfile` Hover 팝업** — 컴포넌트 코드 유지 · 화면 `attachHover` 연결 해제 (2026-07-11)
- 성향 AI 한 줄 설명 — UI 골격만 (legacy), AI 연동 없음
- 레거시 `territory-icons` PNG — 신규 emblems WEBP와 **혼재**

### ❌ 미구현

- **ProfileFrame 아바타** (전신 이미지 오버레이)
- **ProfileFrame 대표 업적** (`achievementLayer`)
- **실로그인/Firebase → `getCurrentProfileData()` 연결**
- **실제 경험치·활동 데이터 집계** — 활동 요약 4항목 + 영토 기록 4항목 연결 완료 · `aura` Mock 유지
- ProfileFrame **모바일 최종 보정**
- 결제 시스템 (상품 정의됨)
- 영토전 (배틀 시스템)
- 업적 시스템 (더미 데이터)
- 활동 메뉴 링크 (버튼 disabled 상태)
- AI 데일리 이슈 자동 생성
- 관리자/운영 도구

### 🔜 다음 작업 (2026-07-12 기준)

| 우선순위 | 항목 |
|----------|------|
| **최우선** | **Follow System v1 2차 QA** — 언팔로우·`toggleFollow`·`sc_follow_v1`·HUD·목록·Empty·Toast·게시글 버튼·랭킹·ProfileFrame 회귀 |
| 이후 | **Settings System v1** |
| 이후 | **Admin System v1** |

### ⏸️ 보류 (기능)

업적 시스템(설계 후 개발) · 타인 프로필 팔로워 목록 · 추천 사용자 · 친구 시스템 · 차단 · 팔로워/팔로잉 검색 · 서버 동기화 · 실시간 DB 연동

### ⏸️ 보류 (UI)

ProfileFrame 전체 UI 폴리싱 · 팔로워 영역 최종 디자인 · 버튼/배지 디자인 통일 · 아이콘 스타일 통일 · 전체 모달 UI 통일 · 최종 반응형 점검

---

## 8. 개발 원칙

1. **기능/JS/데이터 로직은 건드리지 않는다** — UI 작업 시 id, class, 함수명은 유지
2. **CSS/UI 수정은 `public/index.html` 의 `<style>` 블록에서만** — 별도 CSS 파일 없음
3. **영토 색상은 `data-territory` 하나로 전체 전환** — 하드코딩 금지
4. **빌드 단계 없음** — 파일 수정 후 브라우저 새로고침으로 확인
5. **CSS 변수(`--sc-*`)를 우선 재사용** — 새 색상/값은 변수로 추가
6. **모바일 터치 영역 유지** — 데스크톱 압축 시 `@media`로 모바일 보호
7. **추측하지 않는다** — 불확실하면 코드를 먼저 읽는다
8. **신념 문장은 `territory-beliefs.js`에서만 수정** — index.html 하드코딩 금지
9. **UserCard 프로필 진입** — Hover 팝업 없음 · `openUserProfile(userId)` → ScProfileModal → ProfileFrame · 클릭 범위는 아바타·닉네임·유저 ID만 (`wireScUserProfileLink`)
10. **표시 이름** — 화면·향후 검색은 `resolveDisplayName(userId)` · `userId`는 내부 식별자만 · 닉네임 없으면 `userId` fallback

---

## 8.1 displayName · Search 준비

| 항목 | 내용 |
|------|------|
| 헬퍼 | `resolveDisplayName(userId)` — `display-name.js` |
| 캐시 | `sc_display_names_v1` (localStorage, 게시글 bundle 구조 변경 없음) |
| 동기화 | `syncCurrentUserDisplayName()` — `loadCurrentUserProfile()` 종료 시 현재 유저 닉네임 등록 |
| Search v1 | **완료** — 검색창 하나 · displayName 통합검색 · **시민** + **토론** · `__scSearchCitizens` · `__scSearchDiscussions` |
| 인덱스 | `collectDisplayNameIndex()` · `__scSearchCitizens(query)` |
| 디버그 | `__scResolveDisplayName` · `__scCollectDisplayNameIndex` · `__scSearchCitizens` |

### UserCard 프로필 UX (2026-07-11~)

| 화면 | 클릭 가능 | 비클릭 (프로필 미열림) |
|------|-----------|------------------------|
| 게시글 상세 | 아바타 · 닉네임 | Lv/명성 · 영토 Badge · 시간 · 카드 여백 |
| 댓글 | 아바타 · 작성자 이름 | 작성 시간 · 댓글 본문 · 반응 버튼 |
| 알림 | 아바타 · 닉네임 | 제목/메시지(→ `navigateFromNotification`) |
| 랭킹 | 닉네임(유저 ID) | 순위 아이콘 · Lv/명성 · 영토 · 팔로워 |
| 활동 피드 | — (작성자 이름 미표시) | 문장 전체 |

Hover: `title` / `aria-label` — 「클릭해서 유저 프로필 보기」만. 큰 `ScMiniProfile` 팝업 미사용.

---

## 9. 파일 구조

```
sentence-craft/
├── public/
│   ├── index.html               # 단일 SPA 파일 (HTML + CSS + JS 전부)
│   ├── territory-beliefs.js     # ★ 영토 신념 데이터 (Single Source of Truth)
│   ├── display-name.js          # displayName 조회·캐시
│   ├── search-system.js         # 통합검색 모달
│   ├── bookmark-list.js         # 북마크 목록 모달
│   ├── follow-system.js
│   ├── player-progression.js
│   ├── permissions-guide.js
│   ├── rank-leaderboard.js
│   ├── tendency-trends-ui.js
│   ├── ui-sounds.js
│   ├── assets/
│   │   ├── territory-icons/     # 레거시 PNG (점진 교체 예정)
│   │   └── territories/         # ★ 공식 에셋 v1 (WEBP + 프로필 PNG)
│   │       ├── banners/         # reform | centrist | order | alien
│   │       ├── emblems/
│   │       └── profiles/        # center | pioneer | guardian | alien (1024×819)
│   ├── auth/
│   │   └── callback.html        # OAuth 콜백 페이지
│   └── territories/             # 영토 맵 PNG, JSON 히트존
├── config/
│   ├── world-territories.js     # 영토·게시판 규칙
│   ├── alignment-system.js      # 성향 시스템
│   ├── player-progression.js    # 레벨·XP·명성
│   ├── kantapbiya.js            # 외계행성 규칙
│   ├── alignment-rank-limits.js
│   └── signup-countries.js
├── scripts/                     # 유틸리티 스크립트
├── tools/                       # 시뮬레이션 도구
├── supabase/                    # Supabase 관련 설정
├── docs/                        # 프로젝트 문서
├── app-config.js                # 전체 설정 집약 모듈
├── server.js                    # Express 서버
└── package.json
```
