# 센텐스크래프트 — AI 세션 인수인계 문서

> **새 Cursor/AI 세션 시작 시 이 문서를 먼저 읽으세요.**  
> 마지막 업데이트: 2026-07-30 (세션 마감 · 외계 메인 split + 출신 파티션)  
> 상세 맥락: `docs/PROJECT_CONTEXT.md` · 작업 목록: `docs/TODO.md` · 최근 변경: `docs/CHANGELOG.md`

---

## 0. 30초 요약

| 항목 | 내용 |
|------|------|
| 프로젝트 | 게임형 정치 커뮤니티 SPA — **글·반응 → 성향 변화 → 영토 소속** |
| 프론트 | **단일 파일** `public/index.html` (HTML+CSS+JS, 빌드 없음) + 보조 JS |
| 백엔드 | `server.js` (Express) + Supabase Auth/DB (일부) |
| 현재 단계 | **외계 메인 좌우 split·출신 파티션·이벤트 파이프라인 코드 준비 완료** · **실 DB·운영 API 미실행** |

### [오늘 세션 마감] (2026-07-30)

#### 오늘 완료
- 외계행성 메인 좌우 split (지구 관측 / 외계 커뮤니티)
- `alienOriginTerritory` + 자유/개척/수호 파티션 권한
- 관측 원문 참조형 · board-service 파티션 차단
- 사용자 이벤트 파이프라인 운영 기반 (동일 일자)
- 테스트: `test:alien-system` 119 PASS · `test:user-event` 93 PASS

#### 다음 세션 우선
- [ ] 외계 migration · origin 없는 기존 사용자 정책
- [ ] 관측/파티션 API 운영 전 UI 연결
- [ ] 인기 관측·명예의 전당 공식 · scheduler
- [ ] user-event migration · 실이벤트 연결

### [사용자 이벤트 파이프라인] (2026-07-30)

#### 완료 (코드만)
- domain event contract · policy table · orchestrator dry-run
- 명성등급(reputation grade) vs 시민등급(citizen rank) 분리 — 시민등급 규칙 미확정
- progression plan (확정 XP만) · achievement evaluation engine · notification/activity 분리
- board/alignment/alien/evolution adapter (plan only)
- SQL 초안 (`migration_user_event_pipeline.sql` **미적용**)
- `npm run test:user-event` — 93 PASS (alignment 1회)
- **실 XP/명성/업적/알림/활동 write 금지** · **localStorage UI 유지**

#### 핵심 파일
| 파일 | 역할 |
|------|------|
| `shared/user-domain-event-core.js` | 이벤트 계약·dedupe·sanitize |
| `shared/user-rank-core.js` | 명성등급 vs 시민등급 |
| `shared/user-progression-event-core.js` | XP/reputation plan |
| `shared/achievement-evaluation-core.js` | 업적 조건 판정 |
| `shared/user-notification-core.js` · `user-activity-core.js` | 알림·활동 plan |
| `server/user-event-orchestrator.js` | 이벤트→plan 파이프라인 |
| `server/*-user-event-adapter.js` | 게시판/alignment/외계/발전 adapter |
| `public/user-event-data-adapter.js` | legacy↔contract |
| `supabase/migration_user_event_pipeline.sql` | domain event log·RPC |

#### 다음 세션 이어서
- [ ] migration 실제 적용 · event persist RPC 검증
- [ ] 게시판·alignment batch 실이벤트 연결
- [ ] 시민등급·Lv6~10 XP·empathy→명성 수치 확정
- [ ] 실제 알림·활동 생성 · 레벨업/영토 팝업 연결

### [외계행성 시스템 운영 기반] (2026-07-30)

#### 완료 (코드만)
- moderation 상태 계약 · 복귀 페널티 7/15/30/시즌
- SQL 초안 (`migration_alien_system.sql` **미적용**)
- 접근 context · 관측 contract · 자유광장 board 재사용
- 지구/외계 댓글·반응 `audience_scope` 분리
- 랭크 정의·주간 인기인 이력 계약 (점수식 미구현)
- 외계 메인 좌우 split UI(지구 관측/외계 커뮤니티) + 기본 선택(인기 관측글/자유광장)
- `alienOriginTerritory` contract + 출신별(개척/수호/중앙/UNKNOWN) 파티션 권한
- board-service ALIEN category 권한 차단(read/write/comment/react)
- `npm run test:alien-system` — 119 PASS
- **실 이동·자동 판정·API_OPERATIONAL 금지**

#### 핵심 파일
| 파일 | 역할 |
|------|------|
| `shared/alien-moderation-core.js` | 상태·페널티·plan |
| `shared/alien-origin-core.js` | 출신 성향 snapshot·파티션 권한 |
| `shared/alien-access-core.js` | 접근 권한 |
| `shared/alien-observation-core.js` | 관측 계약 |
| `shared/alien-rank-core.js` | 랭크 정의 |
| `shared/alien-legacy-map.js` | 레거시→ALIEN |
| `supabase/migration_alien_system.sql` | state/event/signal/RPC |
| `server/alien-*-*.js` | repo/service/routes |
| `public/alien-observation-*.js` · `alien-system-inspect.js` | client |

#### 다음 세션 이어서
- [ ] migration 실제 적용 · state 초기화
- [ ] 신고 review → signal · 복합 판정 공식
- [ ] 관측/자유광장 API 운영 활성화 전 UI
- [ ] 시즌 종료 데이터 · 랭크/주간 인기인 공식

### [영토 발전 데이터 연결] (2026-07-30)

#### 완료 (코드만)
- `shared/territory-evolution-core.js` — 계약·임계값·label·이미지 SSOT
- CENTRAL **직접 소속만** 집계 (개척·수호 30% 합산 제거)
- population adapter/repo · evolution service · snapshot SQL 초안
- client adapter/API client · hover contract 연결
- `npm run test:territory-evolution`
- **이미지·지도·패널 위치 미변경** · **실 count/migration 미실행**

#### 다음 세션 이어서
- [ ] migration 실제 적용 · 실 사용자 territory count
- [ ] snapshot 주기·scheduler 확정
- [ ] `TERRITORY_EVOLUTION_OPERATIONAL` 활성화 전 UI 전환
- [ ] 휴면/탈퇴 포함 여부 · 유효 시민 정의

### [프로필 UI 데이터 연결] (2026-07-30)

#### 완료 (코드만 · 운영 미연결)
- 단일 public profile contract · self/public 분리
- assembler · 영토/성향지도 adapter · mini/modal adapter · API client+캐시
- 익명 작성자 프로필 오픈 차단
- `npm run test:user-profile` (단위 + user-data 회귀)
- **PNG·좌표·레이아웃 미변경** · **USER_DATA_OPERATIONAL 미활성**

#### 핵심 파일
| 파일 | 역할 |
|------|------|
| `shared/public-profile-core.js` | 계약·sanitize·XP·업적·상태 VM·익명 게이트 |
| `server/user-profile-assembler.js` | 공개/본인 프로필 조립 |
| `server/user-profile-territory-adapter.js` | 영토 조회 (클라이언트 미신뢰) |
| `server/user-profile-alignment-map-adapter.js` | 공개 성향지도 (원점수 미노출) |
| `public/user-profile-data-adapter.js` | API↔Mini/Modal |
| `public/user-profile-api-client.js` | 모드·캐시·`__scInspectUserProfileData` |

#### 다음 세션 이어서 (미완료)
- [ ] 실제 public/self profile API 운영 연결 (`USER_DATA_OPERATIONAL`)
- [ ] 실 DB join 검증 · territory/alignment map 실연결
- [ ] Lv6~10 XP · citizenRank 확정
- [ ] 프로필 사진 Storage · 업적 아이콘 · Mock 제거

### [사용자 데이터] (2026-07-29)

#### 완료 (코드만 · DB 미적용)
- 레벨 범위 **1~10** (`USER_LEVEL_MIN/MAX`, `LEVEL_RANGE` — `shared/user-data-config-core.js`)
- XP 자동 계산은 **Lv1~5 임계값만** (`autoLevelCap: 5`) — Lv6~10 XP TODO · `player-progression.js` UI **미변경**
- RPC 권한 분리: **authenticated JWT** (팔로우·대표업적·알림읽음·북마크) vs **service_role** (progression·업적부여)
- `userClient` / `adminClient` 분리 · Express route 소유권 검증
- `npm run test:user-data` → **80/80 PASS** (회귀: board-core · board-compat · alignment)

#### 핵심 파일
| 파일 | 역할 |
|------|------|
| `shared/user-data-config-core.js` · `shared/user-data-schema-core.js` | UUID·레벨·모드·검증 |
| `supabase/migration_user_data_system.sql` | 스키마·RLS·RPC·GRANT (**미적용**) |
| `server/user-data-*.js` | memory/supabase repo · service · routes |
| `public/user-data-legacy-adapter.js` · `user-data-api-client.js` | localStorage 조사 · API dry-run |
| `tools/test-user-data-system.js` | 80항 통합 테스트 |

#### 다음 세션 이어서 할 일 (미완료 · TODO.md 참고)
- [ ] `migration_user_data_system.sql` **실제 Supabase 적용**
- [ ] 실 DB RLS/RPC 검증 · 기존 profiles 충돌 확인
- [ ] 실제 사용자 데이터 migration preview · 이전 정책
- [ ] `USER_DATA_OPERATIONAL=true` 전 UI localStorage → API 치환
- [ ] Lv6~10 XP 임계값 확정 · citizen_rank CHECK
- [ ] user_bookmarks `post_id` FK (board migration 후)

#### 절대 하지 말 것
- migration 실제 적용·운영 API 활성화 (명시적 작업 전까지)
- `player-progression.js` XP/레벨 UI 로직 변경
- service-role key 클라이언트 노출

### [게시판·alignment 전환 준비] (2026-07-29)

- 게시판: `shared/board-*-core.js` · `server/board-*` · `migration_board_core_system.sql` · `npm run test:board-core` / `test:board-compat`
- alignment: `public/alignment-*.js` (구 `political-orientation-territory-rules.js` 대체) · `migration_alignment_system.sql` · `npm run test:alignment-supabase`
- **BOARD_OPERATIONAL / USER_DATA_OPERATIONAL / alignment live** 모두 **비활성** 유지

#### 테스트 명령
```bash
npm run test:user-data      # 80/80 (~9분, alignment 1회)
npm run test:board-core
npm run test:board-compat   # 내부 회귀 포함
npm run test:alignment-supabase
```

#### 회귀 테스트 참고
- `test:user-data`는 `SC_SKIP_COMPAT_REGRESSION=1`로 board-compat **단위만** 실행 후 alignment 1회 (중복 방지)

### [정치 성향] (2026-07-26)

#### 핵심 파일
| 파일 | 역할 |
|------|------|
| `public/political-orientation-simulation.js` | 1~5차 Mock 시뮬레이션 (페이지 로드 시 자동 실행 없음) |
| `public/alignment-territory-rules.js` | **운영용** 영토 판정 순수 함수 (구 `political-orientation-territory-rules.js`) |
| `docs/TODO.md` · `docs/CHANGELOG.md` | 완료/미완료 · 변경 기록 |

#### 시뮬 모드 (서로 상태 덮어쓰지 않음)
1. `BASE_SCORE_MOVEMENT` — 기본 점수 보유 이동
2. `ZERO_START_LATENT_ORIENTATION` — 0점·중앙 시작 · 숨은 성향으로 반응만 생성
3. `LARGE_SCALE_THRESHOLD_COMPARISON` — 1,000명 · CENTRAL ±1000/800/600/400
4. `TERRITORY_OSCILLATION_CAUSE_ANALYSIS` — 왕복 원인 (경계 노이즈 등)
5. `TERRITORY_STABILIZATION_COMPARISON` — 안정화 방식 비교

#### 운영용 영토 판정 (채택안 · DB 미연결)
`alignment-territory-rules.js` 고정 규칙:
- 중앙 **-1000 ~ +1000**
- 진입: `+1001` / `-1001` · 복귀: `+800` / `-800` (200점 히스테리시스)
- **2회 연속** pending 확인 후 영토 변경
- PIONEER ↔ GUARDIAN **직접 이동 금지** (반드시 CENTRAL 경유)
- 입력: 이미 계산된 `orientationScore`만 · 점수 자체는 변경하지 않음

개발용 콘솔:
```js
__scRunPoliticalTerritoryRuleTests()          // 18항
__scGetPoliticalTerritoryRules()
__scEvaluatePoliticalTerritoryTransition(state, batchTime)
__scRunTerritoryStabilizationQuickComparison() // 5차 빠른 비교
__scRunAllOrientationFixedTests()              // 시뮬 고정 테스트 124항
```

#### 점수 계산 규칙 (시뮬 · 변경 금지)
- `DELTA_WINDOW_SCORE` · 99일 50% + 최근 30일 50%
- 반응 가중치 80/120 · 배치당 ±500 · 05:00/17:00
- 외계행성(ALIEN) 정치 성향 제외

#### 다음 세션 이어서 할 일 (미완료)
- [ ] 실제 정치 성향 **배치**에 `evaluatePoliticalTerritoryTransition` 연결
- [ ] 사용자 DB 필드 (`pendingTerritory` 등) 추가 · 영토 변경 저장
- [ ] 영토 변경 알림 · 시민등급 재판정 · 업적 연결
- [ ] Firebase/API · 베타 실데이터 재조정
- [ ] (검토) 3회 연속 · 쿨다운 · 최소 체류기간 — **아직 미적용**

#### 같은 날 함께 들어간 관련 작업 (커밋에 포함)
- 업적 Mock 1~2차 · 시즌 설정 스키마 · 희귀도 프레임
- 영토 발전 hover/population 소규모 보완

#### 절대 하지 말 것 (오늘 기준선)
- 시뮬 1~5차 결과/상태를 운영 로직으로 덮어쓰기
- 점수 계산 공식·가중치·상한 임의 변경
- 배치 없이 DB/API에 영토 저장 연결 (명시적 작업 전까지)

### [영토 발전 Hover 패널] (2026-07-25)

- 지도 영토 hover 시 싱글톤 `#sc-territory-evolution-hover` 표시
- 핵심 파일:
  - `public/territory-evolution-images.js` — 이미지 경로 · 공통/외계 단계명
  - `public/territory-evolution-population.js` — 직접 소속 집계 계약 · Mock/live 주입
  - `public/territory-evolution-hover.js` — 패널 UI · 위치 · 단계/진행률
  - `public/assets/territory-evolution/` — 발전단계 PNG
  - `public/tools/territory-evolution-preview.html` — 에셋 미리보기
- UI: 헤더(영토명 · 발전 인원수 · 현재 단계 · 단계 기준 · 다음 단계 필요 인원 · 진행률 바) + peek viewer
- 계산: 중앙 = central + ⌊pioneer×0.3⌋ + ⌊guardian×0.3⌋ · alien 미포함
- 단계: 현재 인원으로 매번 재판정(상승·하락) · 외계 전용 단계명
- 실데이터 census API 없음 → Mock fallback 유지
- **미변경 기준선:** 지도 wrapper · SVG viewBox/히트존 · hover 강조 · 클릭 이동

### [영토 지도 업데이트] (2026-07-22)

- 새 통합 영토 이미지 적용 완료
- 새 이미지 기준 영토별 히트존 적용 완료
- 영토별 마우스 호버 동작 적용 완료
- 중앙광장 성장 이미지는 아직 기획 및 제작 단계
- 이후 작업에서는 현재 지도 이미지, 히트존 좌표계와 호버 동작을 기준선으로 유지

| 프로필 UI | **ProfileFrame** (PNG 1024×819 + px 오버레이)가 기본. legacy 카드는 `hidden` |
| 성향 | **3축 누적점수**(보수·중도·진보) + **외계인 %** — 브라우저 localStorage 데모 |
| ProfileFrame 성향 | **4축 표시**(center/pioneer/guardian/alien 0~100) — **게임 축과 아직 미연동(더미)** |
| 신규 성향 축 | 시뮬·운영 판정은 **단일 orientationScore** (PIONEER+/GUARDIAN−) — alignment-scoring 3축과 **아직 미통합** |

### 새 세션 필수 규칙 (`.cursor/rules/sentence-craft.mdc`)

1. 작업 전 `PROJECT_CONTEXT.md` · `TODO.md` · `CHANGELOG.md` · **이 문서 §0 오늘 작업** 읽기  
2. UI는 `index.html` `<style>` 우선 · `sc-*` UI Kit · `data-territory`로 색상  
3. **기존 JS 로직(성향·레벨·팔로우·반응) 함부로 수정 금지** — UI 작업은 CSS 위주  
4. HTML `id` 변경 금지 · 작업 후 `CHANGELOG.md` + `TODO.md` 갱신  

---

## 1. 프로젝트 폴더 구조

```
sentence-craft/
├── public/                          # ★ 프론트 전부 (배포 루트)
│   ├── index.html                   # ★ 단일 SPA (~23k+ lines) — 메인 작업 파일
│   ├── political-orientation-simulation.js      # ★ 성향 1~5차 Mock 시뮬
│   ├── political-orientation-territory-rules.js # ★ 운영용 영토 판정(순수)
│   ├── season-config.js             # 시즌 설정 스키마
│   ├── achievement-definitions.js · user-achievements.js
│   ├── territory-beliefs.js         # 영토 신념 SSOT (displayName, belief, …)
│   ├── territory-evolution-images.js    # 발전단계 이미지·단계명 SSOT
│   ├── territory-evolution-population.js # 발전 인원 집계 계약·Mock/live
│   ├── territory-evolution-hover.js     # 지도 Hover 패널 (Mock UI)
│   ├── alignment-scoring.js         # ★ 성향 3축 점수 수학 (브라우저)
│   ├── player-progression.js        # 레벨·XP·명성·글당 상한 (브라우저)
│   ├── display-name.js              # ★ displayName 조회·캐시 (Search v1 사전)
│   ├── search-system.js             # ★ Search v1 — 통합검색 모달 · 시민 검색
│   ├── bookmark-list.js             # ★ Community v2 — 북마크 목록 모달
│   ├── follow-list-modal.js         # ★ Follow v1 — 팔로워·팔로잉 목록 모달 · 언팔로우
│   ├── follow-system.js
│   ├── permissions-guide.js
│   ├── rank-leaderboard.js
│   ├── tendency-trends-ui.js
│   ├── ui-sounds.js
│   ├── assets/
│   │   ├── achievements/            # 업적 아이콘 PNG · rarity-frames/
│   │   ├── territory-icons/         # 레거시 PNG (점진 교체 중)
│   │   └── territories/
│   │       ├── banners/             # WEBP v1
│   │       ├── emblems/             # WEBP v1
│   │       └── profiles/            # ProfileFrame PNG 4종 (1024×819)
│   ├── auth/callback.html           # OAuth 콜백
│   └── territories/                 # 맵 PNG, territory-hit-zones.json
├── config/                          # 서버/설계용 Node 모듈
│   ├── world-territories.js         # 영토·게시판 단계·인구 시각화 구간
│   ├── alignment-system.js          # 성향 시스템 뼈대 (SIGNAL_TYPES, 임계값)
│   ├── alignment-rank-limits.js   # 랭크별 축 상한·글당 캡 (1~10랭크)
│   ├── player-progression.js        # XP·레벨·명성 등급 (서버용 미러)
│   ├── kantapbiya.js                # 외계행성 규칙
│   └── signup-countries.js
├── docs/                            # ★ 프로젝트 문서
│   ├── AI_HANDOFF.md                # ← 이 문서
│   ├── PROJECT_CONTEXT.md
│   ├── TODO.md / CHANGELOG.md
│   ├── ALIGNMENT_REACTION_TUNING.md # ★ 성향 반응 수치 일람 (정확값)
│   ├── DAILY_ISSUE_CONTENT_GRAVITY.md
│   └── … (데일리 이슈·DB·Supabase 가이드 등)
├── scripts/ · tools/ · supabase/
├── server.js                        # Express API
├── app-config.js
└── package.json
```

### 실행

```bash
npm start   # http://localhost:3000
```

- ProfileFrame **좌표 에디터**: localhost 전용 (`__scProfileLayoutEditor`)
- 히트존 에디터: 별도 도구 (territory-hit-zones, viewBox `0 0 1600 900`)

---

## 2. 구현 완료 ✅

### 핵심 플랫폼

- [x] 로그인/회원가입 UI · 게스트 모드 · Supabase Auth API (`/api/auth/*`)
- [x] 메인 지도 (16:9 tribal-s1) · SVG 히트존 · 4영토 클릭 진입
- [x] 중앙광장 허브 (데일리 이슈, 인기글, 실시간 현황, 게시글, 페이지네이션)
- [x] 영토 게시판 (개척/수호/외계) · 글/댓글/반응 UI
- [x] 팔로우 + 알림 (클라이언트)
- [x] 채팅 API (인메모리 베타)
- [x] 권한 안내 · 히스토리 탭 · 게시글 상세

### 정치 성향 Mock + 운영 판정 (2026-07-26) — ★ 최신

- [x] 1~5차 시뮬레이션 (`political-orientation-simulation.js`) · 고정 테스트 124항
- [x] 운영용 영토 판정 순수 함수 (`political-orientation-territory-rules.js`) · 테스트 18항
- [x] 채택 규칙: CENTRAL ±1000 · hysteresis 200 · 2회 연속 · 직접 교차 이동 금지
- [ ] 배치·DB·API·알림·시민등급 연결 (내일 이후)

### ProfileFrame (2026-07-09 ~ 07-10) — **현재 기본 프로필 UI**

- [x] PNG 4스킨 (`center`/`pioneer`/`guardian`/`alien`) · 좌하단 HUD · 접기/펼침
- [x] **펼침 애니메이션** 0.2s ease-out · **접기 애니메이션** 0.18s ease-in (애니 후 hide)
- [x] `SC_PROFILE_LAYOUT` px 좌표 (1024×819) · 스킨별 `SC_PROFILE_LAYOUT_BY_SKIN`
- [x] localhost **좌표 에디터** (localStorage `sc_profile_layout_editor_v3`)
- [x] 데이터 파이프라인: `SC_PROFILE_DATA` → `getCurrentProfileData()` → `renderProfileData()`
- [x] **활동 요약 실데이터 1차 + 표시 안정화** (2026-07-12): `resolveUserProfileActivity` · `normalizeProfileActivityDisplay` · 0→`--` · 모달 HUD 동기화
- [x] **영토 기록 실데이터 1차 + 표시 fallback** (2026-07-12): `resolveUserTerritoryRecord` · `normalizeTerritoryRecordDisplay` · 빈값 규칙
- [x] 오버레이: USER ID · LEVEL · 명성 · 경험치% · expGauge · 활동 5 · 영토 4
- [x] **성향지도 SVG** (`alignmentMapLayer`) · 4축 polygon/line/dot · **0.28s 이동 애니메이션**
- [x] 성향지도 **캘리브레이션 에디터** (축 최대치 · 그룹별 centerPioneer / guardianAlien)
- [x] **대표 업적** 3슬롯 (아이콘·이름·날짜) · `renderProfileAchievements()` · 좌표 에디터
- [x] legacy `.profile-citizen-card__legacy` — `hidden` 유지 (JS id 호환)

### 게시글 작성자 프로필 UX (2026-07-10, 개발 #3)

**철학:** 글보다 **사람** — 게시글 → 작성자 → 프로필 → 팔로우 → 다른 글 탐색.

| 단계 | 상태 | API / 비고 |
|------|------|------------|
| 작성자 카드 HUD | ✅ | 1차 HUD 스타일 · 2차 `Lv.N · 명성` · 3차 영토 Badge |
| Hover 미니 프로필 | ⚠️ 보류 | `ScMiniProfile` 코드 유지 · **화면 attachHover 연결 해제** (2026-07-11) · Hover는 `title` 안내만 |
| 프로필 모달 | ✅ | `ScProfileModal` — `open` · `close` · `getUserId` · ESC/배경/X/닫기 · scroll lock · fade |
| 모달 ProfileFrame | ✅ | **새 UI 없음** — `renderProfileFrameInModal` · `buildUserProfileDataForModal` · `data-pf-layer` 스코프 |
| 회귀 QA | ✅ | Hover/Click/Frame/4스킨/HUD복원/닫기/DOM — `closeScProfileModal` 이중 콜백 FIX |
| 댓글 작성자 프로필 | ✅ | `renderThreadedCommentNode` — Hover + 클릭 → `openUserProfile` (2026-07-11) |
| 활동 피드 작성자 프로필 | ✅ | `authorId` 있는 항목만 Hover/클릭 · `post_created` 저장 (2026-07-11) |
| 알림 작성자 프로필 | ✅ | `actorId` 항목 — 작성자 영역 → 프로필 · 내용 영역 → 목적지 이동 (2026-07-11) |

**절대 금지 (요청 없이):** ProfileFrame HTML/CSS · `SC_PROFILE_LAYOUT` · `SC_PROFILE_LAYOUT_BY_SKIN` · PNG 수정.  
**스킨 규칙:** `territorySkin` → 해당 PNG → `SC_PROFILE_LAYOUT_BY_SKIN[skin]` 좌표 (center 좌표를 다른 스킨에 쓰지 않음).

**다음 확장 순서 (닉네임 있는 모든 곳):**

1. [x] 댓글 작성자 — Hover → `openUserProfile` (2026-07-11)
2. [x] 활동 피드 작성자 — `authorId` 저장만 (화면에 이름 미표시 → 프로필 연결 없음, 2026-07-11)
3. [x] 알림 작성자 — 아바타·닉네임만 `openUserProfile` (2026-07-11)
4. [x] 랭킹 — 닉네임(유저 ID)만 `openUserProfile` (2026-07-11)
5. [x] **displayName 통일** — `resolveDisplayName(userId)` 전역 표시 (2026-07-12)

**Search System v1 (2026-07-12) ✅:** `search-system.js` · `sc-map-tab-search` · `sc-search-modal` · 시민: `collectDisplayNameIndex` · 토론: `sc_board_bundle_v1` 제목/본문/작성자 displayName · `__scBoardNavigateToPost` · `__scSearchCitizens` · `__scSearchDiscussions`

**UserCard UX 규칙 (2026-07-11~):** Hover = `title`/`aria-label` **「클릭해서 유저 프로필 보기」** 만 (ScMiniProfile 팝업 미사용) · Click = **아바타·닉네임·유저 ID**만 → `openUserProfile()` → ScProfileModal → ProfileFrame · 공통 헬퍼 `wireScUserProfileLink()`.

작업 단위: **한 곳씩** · Composer 2.5 Fast · 기능 추가만 (ProfileFrame 개선/리팩토링 금지).

**알림 카드 클릭 규칙 (2026-07-11):** `actorId` 있음 → **아바타·닉네임** 클릭 = `openUserProfile()` (`stopPropagation`) · 제목/메시지 영역 클릭 = `navigateFromNotification()` · 시스템 알림은 단일 클릭 유지.

**Community System v1 — 북마크 (2026-07-11):** `sc_bookmarks_v1` · userKey별 `{ postId, createdAt }` · 게시글 목록/상세 `저장` 버튼 토글.

**Community System v2 — 북마크 목록 1차 (2026-07-12):** `bookmark-list.js` · HUD `sc-map-tab-bookmarks` · `findPostByIdAnywhere` · `__scBoardNavigateToPost` · 삭제 시 Toast.

**Follow System v1 2차 (2026-07-12):** 팔로잉 탭 `언팔로우` 버튼 · `FollowSystem.toggleFollow` · `renderList()` 재조회 · Toast · HUD·`board__follow-btn` 자동 갱신 (`follow-system.js` 기존 hook).

**Follow System v1 1차 (2026-07-12):** `follow-list-modal.js` · `FollowListModal.open(tab)` · HUD `#avatar-dock-follow-followers` / `#avatar-dock-follow-following` · `FollowSystem` + `resolveDisplayName` · 프로필 `openUserProfile` · `__scFollowLists(userId)` 디버그 · **localStorage 전용** (`sc_follow_v1`).

**ProfileFrame 상단 팔로워 (2026-07-12):** `profileData.followers` · `resolveProfileFollowerCount` → `FollowSystem.getFollowerCount` · `followersLabelLayer` + `followersLayer` · 명성(`fame`) 위 좌표 · 4스킨 통일 `{785,25,92,33}` / `{882,25,96,33}` · 0명 `0` · 금색 라벨 · 명성 톤 숫자 박스 · 에디터 X/Y/W/H · **아이콘/Emoji 없음**

**Community System v1 — 공유 (2026-07-11):** `buildPostShareUrl` · `linkTarget`과 동일 쿼리(`view=post&postId&territoryId&stage`) · `공유` 버튼 클릭 → 클립보드 · `#sc-share-toast` HUD 안내.

**Community System v1 — 신고 (2026-07-11):** `sc_reports_v1` · userKey별 `{ postId, reason, detail?, createdAt, reporterId }` · 반응 바 **신고** 버튼 → HUD 모달 · 행동 사유 6종 · **상세 의견** textarea (300자 · 기타 필수) · 중복/본인 글 Toast만 — 숨김·제재·외계행성 이동 없음.

**랭킹 UI 1차 (2026-07-11):** `rank-leaderboard.js` · 탭 전체/중앙/개척/수호/외계 · `getLeaderboard(filter)` 재사용 · TOP1~5 👑🥈🥉⭐ Badge · 프로필 Hover/클릭은 미연결.

**랭킹 UI 2차 (2026-07-11):** TOP3 행 여백·아이콘 크기 · 영토 `data-territory` Badge · 내 순위 2×2 HUD 그리드 · 모달 폭 확대.

**랭킹 프로필 UX (2026-07-11):** `rank-leaderboard.js` · 닉네임(`strong`)만 `wireScUserProfileLink` · 전 탭 공통.

### 성향·게임 로직 (브라우저 데모 — localStorage)

- [x] 3축 누적 점수 + 표시 % (`alignment-scoring.js`)
- [x] 좋아요/싫어요 → 반응자·작성자 양방향 델타 (`applyReactionScoresWithMult`)
- [x] 일일 표시 % 캡 · 글당 반응 상한 · 외계인 % (`planetPct`) 별도 축
- [x] 데일리 이슈 관점 선택 → 미세 성향 이동 (콘텐츠 중력)
- [x] 영토 해금 임계 (40% / 60%) · 외계 경고 30% · 강제 편입 50%
- [x] 레벨/XP/명성 (`player-progression.js`) — 글+25, 댓글+12, 이슈댓글+10

### UI/디자인

- [x] CSS 변수 디자인 시스템 (`--sc-*`) · UI Kit (`sc-panel`, `sc-card`, …)
- [x] `data-territory` 기반 영토 색상 자동 전환
- [x] `territory-beliefs.js` 신념 SSOT · 공식 WEBP 배너/엠블럼 v1

---

## 3. 구성 중 / 부분 구현 ⚠️

| 영역 | 상태 | 비고 |
|------|------|------|
| **ProfileFrame ↔ 실제 성향** | ⚠️ 분리됨 | 게임은 `conservative/centrist/progressive`, ProfileFrame은 `center/pioneer/guardian/alien` 더미 |
| **getCurrentProfileData()** | 부분 실데이터 | Auth·progression merge + 활동 요약 4항목 + **영토 기록 4항목** (현재소속·이동·영향력·등급) |
| **Supabase DB** | 뼈대 | 테이블·Auth 일부. 집계·프로필 실시간 동기화 미완 |
| **성향 서버 집계** | config만 | `config/alignment-system.js` — 실제 글 분석 파이프라인 없음 |
| **업적 시스템** | UI+더미 | 슬롯·렌더만. 조건 달성·DB 저장 없음 |
| **아바타** | placeholder | legacy 슬롯·업로드 UI 있음. ProfileFrame 오버레이 미구현 |
| **데일리 이슈 AI** | 로컬 풀 | AI 자동 생성 파이프라인 없음 |
| **결제·영토전·추방 자동화** | 기획만 | 상품 정의됨, 코드 미구현 |
| **localStorage 좌표** | 주의 | 에디터 저장값이 `SC_PROFILE_LAYOUT` 기본값을 덮어씀 → 「초기화」 필요할 수 있음 |

---

## 4. TODO / 남은 작업 (우선순위)

> 전체 목록: `docs/TODO.md`

### 게시글 작성자 프로필 확장 (개발 #3 다음)

1. [x] 댓글 작성자 — Hover → `openUserProfile` (2026-07-11)
2. [x] 활동 피드 · `authorId` 항목만 (2026-07-11)
3. [x] 알림 · `actorId` 항목만 (2026-07-11)
4. [x] 랭킹 — 닉네임만 `openUserProfile` (2026-07-11)

### Community System v1 (2026-07-11~)

1. [x] 게시글 북마크 1차 — `sc_bookmarks_v1` · `togglePostBookmark` · 반응 바 **저장** 버튼
2. [x] 게시글 공유 1차 — `buildPostShareUrl` · **공유** 버튼 · 링크 복사 Toast
3. [x] 게시글 신고 1차 — `sc_reports_v1` · **신고** 버튼 · HUD 모달 · 행동 사유만 · 기록만 (제재 없음)
4. [x] 게시글 신고 상세 의견 — textarea 300자 · 기타 필수 · `detail` 필드 저장
5. [x] 북마크 목록 화면 2차 → **v2 북마크 목록 1차 완료** (2026-07-12)

### Follow System v1 (2026-07-12) — 구현 완료 · QA 대기

1. [x] 팔로워·팔로잉 2탭 목록 모달 — `follow-list-modal.js` · HUD 숫자 클릭 진입
2. [x] 시민 행 · 프로필 연결 · Empty · 정렬(displayName)
3. [x] ProfileFrame 상단 팔로워 수 — `followers` 레이어 · 4스킨 좌표
4. [x] **팔로잉 탭 언팔로우** — `toggleFollow` · Toast (2026-07-12)
5. [ ] **2차 QA** — 언팔로우·`sc_follow_v1`·HUD·목록·Empty·Toast·게시글 버튼·랭킹·ProfileFrame 회귀 확인

### 다음 세션 최우선 (2026-07-12)

1. [ ] **Follow System v1 2차 QA** — 위 체크리스트 통과 후 완료 처리
2. [ ] **Settings System v1** (이후)
3. [ ] **Admin System v1** (이후)

### ⏸️ 보류 — 기능

업적 시스템(설계 후) · 타인 프로필 팔로워 목록 · 추천 사용자 · 친구 시스템 · 차단 · 팔로워/팔로잉 검색 · 서버 동기화 · 실시간 DB · Follow 검색/페이지네이션

### ⏸️ 보류 — UI

ProfileFrame 전체 폴리싱 · 팔로워 최종 디자인 · 버튼/배지 통일 · 아이콘 통일 · 모달 UI 통일 · 반응형 최종 점검

**기타 보류:** ScMiniProfile 코드 삭제 · 랭킹 UI 추가 개선 · 아바타 · 관리자 · 업적 고도화

### ProfileFrame 다음 순서

1. [ ] **아바타** ProfileFrame 오버레이
2. [ ] `getCurrentProfileData()` — 로그인/API 실데이터 연결
3. [ ] **게임 성향 → ProfileFrame 4축** 매핑 연동
4. [ ] 경험치 게이지 위치 최종 보정
5. [ ] `SC_PROFILE_LAYOUT` 4스킨 최종 확정 + QA
6. [ ] ProfileFrame **모바일** 최종 보정

### 게임/백엔드

- [ ] 성향 **서버 집계** (글/댓글/반응 → DB)
- [ ] 영토 귀속 **자동화** · 첩자 배지
- [ ] XP/명성 **실제 적용** (현재 클라이언트 데모)
- [ ] 추방 (비호감 30) · 지구귀환티켓
- [ ] 결제 (카카오/토스/소액)
- [ ] 영토전 · 업적 조건 처리 · AI 데일리 이슈

---

## 5. 현재 막혀 있는 / 주의할 부분 🚧

1. **이중 성향 모델**  
   - 게임 로직: `conservative` · `centrist` · `progressive` (+ `planetPct`)  
   - ProfileFrame SVG: `center` · `pioneer` · `guardian` · `alien` (0~100)  
   - **연결 함수 없음** — 프로필 지도는 더미, 게시판 막대는 별도 저장소

2. **단일 파일 SPA**  
   - `index.html` 2만 줄+ → 탐색은 `Grep` 필수. 무분별 리팩토링 위험

3. **JS 수정 제한 규칙**  
   - UI 작업이어도 프로필/성향 **데이터 로직** 건드리면 회귀 위험. 요청 없이 수정 금지

4. **localStorage 의존**  
   - 성향·데일리 이슈·좌표 에디터·프로필 사진 등 **브라우저 로컬** — 다기기/서버 동기화 없음

5. **PROJECT_CONTEXT.md 일부 구식**  
   - §7 미구현 목록에 “대표 업적 미구현” 등 **낡은 표현** 있음 → `CHANGELOG.md`·이 문서 우선

6. **문서 인코딩**  
   - `config/alignment-rank-limits.js` 헤더 주석 일부 깨짐 (내용은 정상)

---

## 6. 리팩토링이 필요한 부분 (장기)

| 항목 | 이유 | 권장 방향 |
|------|------|-----------|
| `index.html` 분리 | 유지보수·AI 컨텍스트 한계 | CSS/JS 모듈 분리 (빌드 도입 시) — **현재는 의도적 단일 파일** |
| legacy 프로필 카드 | hidden이나 JS id 다수 참조 | ProfileFrame 완성 후 단계적 제거 |
| `territory-icons/` PNG | WEBP v1과 혼재 | `assets/territories/`로 통일 |
| 성향 모델 통합 | 3축 vs 4축 vs planetPct | 단일 `ProfileAlignment` 어댑터 설계 |
| localStorage → API | 데모 한계 | `/api/me/profile` 확장 + Supabase |
| `alignment-rank-limits` | 1~10랭크 vs `player-progression` 1~5랭크 | 기획 정합성 검토 필요 |

---

## 7. ★ 성향(Alignment) 시스템 — 반드시 전달할 사항

> **정치 성향은 제재하지 않는다.** 방향 자체를 막지 않고, **행동(비호감·신고 30회)** 만 moderation.  
> **외계인 %(`planetPct`)** 는 정치 축과 분리 — 싫어요·외계 표시가 주로 증가.

### 7.1 저장소 (브라우저 데모)

| 키 | 내용 |
|----|------|
| `sc_political_scores_v1` | 유저별 `{ conservative, centrist, progressive, planetPct?, forcedTerritory? }` |
| `sc_align_daily_pct_cap_v1` | 일일 표시 % 변동 캡 (기준선 스냅샷) |
| `sc_align_content_gravity_v1` | 데일리 이슈 콘텐츠 중력 일일 합산 |
| `sc_daily_issue_stance_v1` | 데일리 이슈 관점 선택 기록 |

### 7.2 사람 축 3개 — 누적 점수 → 표시 %

**파일:** `public/alignment-scoring.js` (`window.AlignmentScoring`)

| 상수 | 값 | 의미 |
|------|-----|------|
| `initialScores()` | 각 축 **12** | 초기 합 36 — 소수 반응에 %가 덜 흔들림 |
| `MIN_AXIS` | **0.5** | 축 최소 클램프 |
| `W_REACTOR_LIKE` | **2.0** | 반응자: 남 글 **좋아요** → 작성자 **반대편** 방향으로 밀림 |
| `W_REACTOR_DISLIKE` | **-0.6** | 반응자: **싫어요** |
| `W_AUTHOR_LIKE` | **1.0** | 작성자: 내 글에 **좋아요** → 반응자 성향 방향으로 |
| `W_AUTHOR_DISLIKE` | **-0.6** | 작성자: **싫어요** 받음 |

**표시 %:** `toDisplayPercent()` = 세 축 합으로 나눈 비율 (합≈100).  
**UI 라벨 격차:** `LEAN_NEUTRAL_MAX=12`, `LEAN_MILD_MAX=25` (질서·개혁 격차만 표시)

#### 한 번의 좋아요/싫어요 알고리즘

```
반응자 델타 = oppositeFaceUnit(작성자 단위벡터) × W_REACTOR_*
작성자 델타 = unit3(반응자) × W_AUTHOR_*
→ applyDelta로 conservative/centrist/progressive 누적
```

- `oppositeFaceUnit`: 작성자 최대 축의 **반대 면** 중심 방향  
- 균형(스프레드 < 0.08)이면 중도·양극에 살짝 분산

### 7.3 게시판 추가 스케일 (`index.html`)

| 상수 | 값 |
|------|-----|
| `PEER_SOCIAL_PRESSURE_SCALE` | **0.33** | 사람 축 델타 전체 추가 축소 |
| `DISLIKE_ALIGN_SCALE` | **0.4** | 싫어요 시 사람 축만 추가 40% |
| `FACTION_UNLOCK_PCT` | **40** | 영토 1단계 해금 표시 % |
| `FACTION_STAGE2_PCT` | **60** | 2단계 |
| `ALIGN_DAILY_PCT_PER_AXIS` | **5** | 하루 표시 % 각 축 ±5% 캡 |
| `ALIEN_WARN_PCT` | **30** |
| `ALIEN_FORCE_KANTA_PCT` | **50** |
| `ALIEN_MARK_DELTA` | **10** | 외계 표시 1회 |
| `LIKE_RECV_PLANET_DELTA` | **2** | 받은 좋아요 → planetPct |
| `DISLIKE_RECV_PLANET_DELTA` | **3** | 받은 싫어요 → planetPct (더 큼) |

**적용 순서** (`applyReactionScoresWithMult`): mult → 싫어요 스케일 → 글당 상한 → 일일 % 캡 → 저장

### 7.4 무엇이 성향을 움직이고 / 안 움직이나

| 행동 | 사람 3축 | planetPct | 비고 |
|------|----------|-----------|------|
| 좋아요 / 싫어요 (지구 게시판) | ✅ | 싫어요·외계표시 시 ✅ | 외계 **게시판**은 사람 축 경로 제외 |
| **공감** | ❌ | ❌ | 영토 인구 bump만 (`EMPATHY_POP_BUMP=4`) |
| 데일리 이슈 **관점 선택** | ✅ (약함) | ❌ | mult **0.12** |
| 데일리 이슈 공감/좋아요 | ✅ | ❌ | mult **0.2** |
| 데일리 이슈 싫어요 | ✅ (반대 lean) | ❌ | mult **0.2** |
| 이슈 클릭/체류 | ✅ (매우 약) | ❌ | 0.005 / 0.01 / 0.015 |
| 데일리 이슈 **댓글 작성** | ❌ | ❌ | 활동·XP만 |
| 글/댓글 **작성 자체** | ❌ (XP만) | ❌ | XP: 글25, 댓글12, 이슈10 |

**데일리 이슈 역할 → lean 벡터** (`DAILY_ISSUE_ROLE_LEAN`):

| type | progressive | centrist | conservative |
|------|-------------|----------|--------------|
| progressive | 0.7 | 0.2 | 0.1 |
| centrist | 0.25 | 0.5 | 0.25 |
| conservative | 0.1 | 0.2 | 0.7 |
| unsure | 0.2 | 0.6 | 0.2 |

- UI에는 **라벨만** 노출. lean은 `leanForDailyIssueRoleType(type)`만 신뢰 (AI가 넣어도 덮어씀)
- 상세: `docs/DAILY_ISSUE_CONTENT_GRAVITY.md`

### 7.5 상한·캡

| 종류 | 값 | 위치 |
|------|-----|------|
| 글당 반응 상한 (랭크 0~4) | `[120, 200, 320, 480, 720]` | `player-progression.js` `PER_POST_REACTION_CAP` |
| 콘텐츠 중력 일일 합 | **0.65** | `ALIGN_CONTENT_GRAVITY_DAILY_MAX` |
| 랭크별 축 절대 상한 (설계) | 3천~100만 | `config/alignment-rank-limits.js` (서버 연동 예정) |

### 7.6 ProfileFrame 성향지도 (표시 전용)

**데이터:** `SC_PROFILE_DATA.alignment` — `{ center, pioneer, guardian, alien }` 각 **0~100**

**렌더:** `renderProfileAlignmentMap()` — SVG viewBox `0 0 100 100`

| 축 | 방향 (중심 50,50) |
|----|-------------------|
| alien | 위 (y 감소) |
| guardian | 오른쪽 (x 증가) |
| center | 아래 (y 증가) |
| pioneer | 왼쪽 (x 감소) |

**축 스케일:** `SC_PROFILE_ALIGNMENT_AXIS_MAX_BY_GROUP` — 게임값 100이 PNG 끝이 아님  
- 예: `center: 72` → 표시값 72가 축 끝  
- 그룹: `centerPioneer` (중앙·개척 PNG) / `guardianAlien` (수호·외계 PNG)

**애니메이션:** 값 변경 시 0.28s ease-out 보간 (polygon·polyline·circle)

> ⚠️ **아직 `sc_political_scores_v1`과 자동 동기화되지 않음.** 연동 시 매핑 규칙 설계 필요.

### 7.7 영토 ID 대응표

| CSS `data-territory` | 내부 ID | 표시명 | ProfileFrame skin |
|---------------------|---------|--------|-------------------|
| `centrist` | COMMON | 중앙광장 | `center` |
| `reform` | PROGRESSIVE | 개척영토 | `pioneer` |
| `order` | CONSERVATIVE | 수호영토 | `guardian` |
| `alien` | KANTAPBIYA | 외계행성 | `alien` |

### 7.8 튜닝 시 수정 위치 (빠른 참조)

| 조정 목표 | 파일·상수 |
|-----------|-----------|
| 반응 1회 세기 | `alignment-scoring.js` `W_*` |
| 싫어요 정치 축 약화 | `DISLIKE_ALIGN_SCALE` |
| 외계 % 민감도 | `DISLIKE_RECV_PLANET_DELTA` 등 |
| 하루 % 변동 | `ALIGN_DAILY_PCT_PER_AXIS` |
| 한 글 누적 | `PER_POST_REACTION_CAP` |
| 수치 전체 표 | **`docs/ALIGNMENT_REACTION_TUNING.md`** |

---

## 8. ProfileFrame 데이터 파이프라인

```
SC_PROFILE_DATA (더미 · 원본 미변경)
       ↓
getCurrentProfileData() / loadCurrentUserProfile()
       ↓ mergeResolvedProfileActivity(player.userId)
       ↓ mergeResolvedProfileTerritory(player.userId)
       ↓ finalizeProfileDisplayFields()
buildUserProfileDataForModal(userId)   ← 타인 프로필 모달
       ↓ mergeResolvedProfileActivity(userId)
       ↓ mergeResolvedProfileTerritory(userId)
       ↓ finalizeProfileDisplayFields()
renderProfileFrameInModal(userId)
       ↓ applyProfileFramePixelLayout(frame) → ensureProfileFrameListLayerBounds
       ↓ renderProfileData(data, { frameRoot: frame })
       ↓
renderProfileAlignmentMap(data.alignment, { frameRoot })
renderProfileAchievements(data, { frameRoot })
```

**활동 요약 집계 (`resolveUserProfileActivity`)**

| 필드 | 소스 |
|------|------|
| `posts` | `sc_board_bundle_v1` authorId · postId dedupe |
| `comments` | 댓글·대댓글 authorId · commentId dedupe |
| `receivedLikes` | 본인 글·댓글 `reactions.empathy.length` 합 |
| `discussions` | 참여한 distinct `postId` 수 |
| `aura` | **미연결** — 표시 `--` (미로그인 데모만 Mock 허용) |

디버그: `__scProfileActivity('guest_demo')` · `__scTerritoryRecord('guest_demo')` · `__scResolvedProfileData(userId)` · `__scInspectProfileFrame(userId)`

**모달 Overlay:** HUD는 `#activitySummaryLayer` CSS로 목록 레이어 100%×100%. 모달은 `data-pf-layer`만 있어 `ensureProfileFrameListLayerBounds()`로 동일 bounds 적용 (0×0 클리핑 방지).

**표시 기준:** 활동·영토 **숫자형** — 1 이상 숫자 · **0도 `--`** · 확인 불가 `--` · **팔로워(`followers`)는 0도 `0`** · 소속 없음 `기록 없음` · 등급 없음 `참여자` · LEVEL·명성·경험치 % 변경 없음 · `value||'--'` 금지 · 원본 숫자 0 유지.

**영토 기록 집계 (`resolveUserTerritoryRecord`)**

| 필드 | 표시명 | 소스 · fallback |
|------|--------|----------------|
| `current` | 현재 소속 | `__scPlayer` / `getState().territoryId` / `forcedTerritory` · 없으면 **기록 없음** |
| `moved` | 이동 횟수 | 시즌 아카이브 · exileHistory · 기록 없으면 **--** · **0도 --** |
| `influence` | 시민 영향력 | `getMyStandings` / `rankReputationScore` · 불가 **--** · **0도 --** |
| `rank` | 시민 등급 | `getDisplay().rankShort` · **참여자** |

> **「최초 소속」 사용 안 함.** 표시 fallback: `normalizeTerritoryRecordDisplay()`.

### SC_PROFILE_LAYOUT 좌표 (1024×819 px)

- `SC_PROFILE_LAYOUT_BY_SKIN`: center=pioneer 공유, guardian/alien 개별
- 에디터: `window.__scProfileLayoutEditor` (localhost)
- localStorage: `sc_profile_layout_editor_v3`
- 업적: `achievement` · `achievementSlots[3]` · `achievementTitles[3]` · `achievementDates[3]`
- 팔로워 (2026-07-12): `followersLabel` `{785,25,92,33}` · `followers` `{882,25,96,33}` — 4스킨 동일

---

## 9. 개발 도구 (localhost)

| 도구 | 접근 |
|------|------|
| ProfileFrame 좌표 에디터 | UI 토글 · `__scProfileLayoutEditor` |
| 성향지도 캘리브레이션 | 에디터 패널 · `sc_profile_alignment_axis_max_v1` |
| 업적 좌표 복사 | 「현재/전체 영토 업적 슬롯 복사」 |
| 콘솔 | `refreshCurrentProfile()` · `__scProfileActivity(userId)` · `__scTerritoryRecord(userId)` · `__scFollowLists(userId)` · `FollowListModal.open('following')` |

---

## 10. 관련 문서 인덱스

| 문서 | 용도 |
|------|------|
| `docs/PROJECT_CONTEXT.md` | 세계관·디자인·ProfileFrame 상세 |
| `docs/TODO.md` | 작업 체크리스트 |
| `docs/CHANGELOG.md` | 최근 변경 (2026-07-12 Follow v1 · ProfileFrame 세션) |
| `docs/ALIGNMENT_REACTION_TUNING.md` | 성향 반응 **정확한 상수표** |
| `docs/DAILY_ISSUE_CONTENT_GRAVITY.md` | 데일리 이슈 성향 이동 |
| `docs/PLAYER_LEVEL_PROGRESSION.md` | 레벨·XP·명성 |
| `.cursor/rules/sentence-craft.mdc` | AI 작업 규칙 |

---

## 11. 새 AI에게 첫 메시지 예시

```
docs/AI_HANDOFF.md, PROJECT_CONTEXT.md, TODO.md를 읽고 작업해 주세요.
작업: [구체적 요청]
제약: ProfileFrame 좌표/SC_PROFILE_LAYOUT 변경 없음, 기존 성향 JS 로직 수정 없음, UI는 index.html <style>만.
```

---

*이 문서는 인수인계용입니다. 코드 변경 시 관련 섹션과 `CHANGELOG.md`를 함께 갱신하세요.*
