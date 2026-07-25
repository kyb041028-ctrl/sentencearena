# 센텐스크래프트 — 변경 기록 (CHANGELOG)

> 최근 주요 변경 사항을 날짜 역순으로 정리합니다.
> 날짜는 git 커밋 기준. 마지막 업데이트: 2026-07-25 (영토 발전 Hover)

---

## [미배포] — 현 작업 이후

### ★ 2026-07-25 — Hover 다음 단계 필요 인원·진행률 바

- `getTerritoryEvolutionNextStageProgress` · state에 remaining/progress 필드 추가
- 헤더: `다음 단계 …까지` / `발전 인원 N명 필요` + 구간 진행률 바
- 6단계: `최고 단계 … 달성` (바 숨김) · 임계값·peek·위치 미변경

### ★ 2026-07-25 — 영토 발전 인원 집계·단계 하락 정책 확정

- 집계 = 현재 소속 전체 회원 (활동/휴면 무관) · 탈퇴·삭제·게스트 제외
- 외계 이동자 = 현재 소속(alien)에만 집계 · 이전 영토 역사 필드는 집계 미사용·보존
- 단계 = 현재 발전 인원 재판정 (상승·하락) · highestStage 보정 없음
- `territory-evolution-population.js` — 집계 계약·함수 · live 주입 / Mock fallback
- 실데이터 census API·Supabase territory 필드 없음 → Mock 유지 (가짜 API 미추가)

### ★ 2026-07-25 — 영토 발전 인원·단계 자동 판정 (Mock)

- `TERRITORY_POPULATION_MOCK_SOURCE` · 단계 임계값 · 발전 인원/단계 계산 함수
- 중앙광장 = 직접 소속 + 개척·수호 각 30%(floor) · 외계 미포함
- Hover 헤더: `발전 인원수` + `단계 기준` · 기존 UI/위치/peek 유지
- 실제 DB·API·단계 하락 정책 없음

### ★ 2026-07-25 — 외계행성 발전 단계 표시명 분리

- `ALIEN_EVOLUTION_STAGE_LABELS` 추가 · `getTerritoryEvolutionStageLabel(key, stage)`
- Hover 헤더·안내 박스·이미지 alt에 영토별 단계명 적용
- 공통 `TERRITORY_EVOLUTION_STAGE_LABELS` 평면 구조 유지 (기존 참조 호환)
- 이미지 경로·순서·명패 상수 미변경

### ★ 2026-07-25 — 영토 발전 Hover · 단계 안내 UI 통일

- 금색 pill 제거 → 전단계/현재/다음단계 공통 2줄 `stage-label`
- 세 안내 상단 기준선 정렬 · 현재 단계만 크기·명도·테두리로 강조
- 양옆 안내 약화 · peek 비율·패널 위치 미변경

### ★ 2026-07-25 — 영토 발전 Hover · 전단계/다음단계 안내 overlay

- peek 카드 내부 badge 제거 → viewer 좌·우 상단 독립 `side-label`
- 표기: `← 전단계` / `다음단계 →` + 단계명 별도 줄
- 현재 단계 중앙 badge 유지 · 1·6단계 안내 미표시
- peek 비율·패널 위치·Mock 값 미변경

### ★ 2026-07-25 — 영토 발전 Hover 패널 · peek 슬라이드 UI

- 하단 썸네일 제거 → 메인 viewer 안 현재 중심 + 좌우 peek
- 헤더: 영토명 / **현재 인구수** / 현재 단계 위계 분리
- 카드 badge: `이전 단계 · …` / `현재 단계 · …` / `다음 단계 · …`
- alien 배치를 `alien-left`(수호와 같은 왼쪽 슬롯)로 변경
- Mock 값·이미지 상수·지도·히트존·클릭 이동 미변경

### ★ 2026-07-25 — 영토 발전 Hover 패널 (Mock)

- `territory-evolution-hover.js` — 싱글톤 패널 · Mock 단계/인원 · 이전·현재·다음 이미지
- 기존 히트존 `pointerenter/move/leave`에만 연결 · 클릭 이동·hover 강조 CSS 유지
- `TERRITORY_EVOLUTION_IMAGES` / `TERRITORY_BELIEFS.displayName` 재사용
- 화면 경계 clamp · fade/translateY · ScMiniProfile 미수정
- 실제 인원 집계·임계값·API 없음

---

### ★ 2026-07-25 — 수호 발전단계 3장 보충

- 수호 근대·현대·미래 PNG 등록 완료 (`guardian-early-modern` · `guardian-modern` · `guardian-future`)
- `territory-evolution-images.js` 수호 4~6단계 `null` 해제
- 공식 등록 **22장 구성 완성** (공통1 + 개척5 + 수호5 + 중앙5 + 외계6)
- 수호 현대와 기존 개척 현대가 동일 파일이라, 개척 현대는 `_review` 후보 이미지로 교체 (중복 해소)
- 확인용 미리보기: `/tools/territory-evolution-preview.html`

### ★ 2026-07-25 — 영토 발전단계 이미지 등록 (에셋만)

- `public/assets/territory-evolution/` — 발전단계 PNG 등록 (패널·판정·hover 미연결)
- `public/territory-evolution-images.js` — 경로 목록 상수
- 1차 등록 19장 · 수호 근대·현대·미래는 이후 보충
- 세계지도·히트존·hover 미변경

---

### ★ 2026-07-22 — 영토 지도 업데이트

- 새 통합 영토 이미지 적용 완료 (`territory-zones-tribal-s1.png` · `territory-zones-unified.png`)
- 새 이미지 기준 영토별 히트존 적용 완료 (`territory-hit-zones.json` · viewBox `0 0 1600 900`)
- 영토별 마우스 호버 동작 적용 완료 (개척·수호·광장 강도 완화 · 외계행성 기존 강도 유지)
- 중앙광장 성장 이미지는 아직 기획 및 제작 단계
- 이후 작업에서는 현재 지도 이미지, 히트존 좌표계와 호버 동작을 기준선으로 유지

---

### ★ 2026-07-12 — 세션 요약 (Follow System v1 · ProfileFrame)

**Follow System v1**
- 1차: `follow-list-modal.js` · HUD 팔로워/팔로우 수 클릭 · 2탭 목록 모달 · 프로필 연결 · Empty · `sc_follow_v1`
- 2차: 팔로잉 탭 `언팔로우` · `toggleFollow` · Toast · 목록·HUD·게시글 버튼 즉시 갱신
- **다음:** 2차 QA 체크리스트 통과 후 완료 처리

**ProfileFrame**
- 상단 팔로워: `followersLabel`/`followers` · `getFollowerCount` · 4스킨 좌표 통일 · 금색 라벨 · 명성 톤 숫자 박스 · 에디터 X/Y/W/H · **아이콘 없음(텍스트만)**
- 표시 안정화: `normalizeProfileActivityDisplay` · `normalizeTerritoryRecordDisplay` · `finalizeProfileDisplayFields`
- 0 표시: 활동·영토 숫자 **0→`--`** · 팔로워는 **0→`0`**
- 모달 Overlay: `ensureProfileFrameListLayerBounds` · HUD/모달 동기화 · `__scInspectProfileFrame`

---

### ★ 2026-07-12 — Follow System v1 2차 (팔로잉 탭 언팔로우)

- **팔로잉 탭만** 행 우측 `언팔로우` 버튼 (`board__follow-btn` 스타일)
- `FollowSystem.toggleFollow(userId)` 재사용 · 클릭 시 `preventDefault`/`stopPropagation`
- 언팔로우 후 `getFollowing` 재조회 렌더 · HUD 숫자·게시글 팔로우 버튼·랭킹(refresh) 자동 갱신
- Toast: 「언팔로우했습니다.」 · 팔로워 탭 버튼 없음 · localStorage 전용 유지

---

### ★ 2026-07-12 — ProfileFrame 팔로워 UI 최종 (텍스트 전용)

- **아이콘/Emoji 제거** — 팔로워 라벨 텍스트만 「팔로워」
- **라벨** — 금색 `#d4a86a` · LEVEL·명성과 동일 폰트 · `padding-right: 14px`
- **숫자 박스** — layout `followers` rect 크기 적용 · 붉은 금속 테두리 · 어두운 내부 · 명성 톤
- **좌표 에디터** — 팔로워 숫자 박스 X/Y/Width/Height 실시간 입력

---

### ★ 2026-07-12 — ProfileFrame 팔로워 좌표 (4스킨 통일)

- **팔로워 라벨** `{ x:785, y:25, w:92, h:33 }`
- **팔로워 숫자 박스** `{ x:882, y:25, w:96, h:33 }`
- `center` · `pioneer` · `guardian` · `alien` 전 스킨 동일

---

### ★ 2026-07-12 — ProfileFrame 팔로워 영역 UI 폴리싱

- **라벨** — LEVEL·명성과 동일 금색(`#d4a86a`) · text-shadow 통일
- **숫자 박스** — 명성 PNG 박스와 동일 톤(테두리·배경·radius·inset 광택) · `#followersLayer` 전용 CSS
- **간격** — 좌표 유지 · 라벨-숫자 밀착 배치
- 명성·LEVEL·경험치·PNG·기존 좌표 변경 없음

---

### ★ 2026-07-12 — ProfileFrame 상단 팔로워 표시 추가

- **명성 위 빈 공간** — `followersLabel` · `followers` 오버레이 레이어 추가 (PNG·기존 좌표 변경 없음)
- **데이터:** `FollowSystem.getFollowerCount(userId)` · `profileData.followers` · `finalizeProfileDisplayFields()`에서 확정
- **표시:** 0명도 `0` (천 단위 구분은 명성과 동일 `formatScProfileDisplayNumber`)
- **4스킨 좌표:** `SC_PROFILE_LAYOUT_BY_SKIN` — center/pioneer/guardian/alien `followersLabel`·`followers` 추가
- **좌표 에디터:** 팔로워 라벨·값 타깃 등록 · HUD·모달 ProfileFrame 동일 렌더

---

### ★ 2026-07-12 — Follow System v1 1차 (팔로워·팔로잉 목록)

- **`public/follow-list-modal.js`** — `window.FollowListModal` (`open` · `close` · `render` · `setTab`)
- 좌측 HUD `#avatar-dock-follow-summary` — **팔로워 N명** / **팔로우 N명** 각각 클릭 → 해당 탭 모달
- 2탭 모달 (`sc-follow-modal`) — 팔로워 · 팔로잉 · ESC/배경/X 닫기
- 데이터: `FollowSystem.getFollowers` / `getFollowing` · `sc_follow_v1` localStorage (구조·계산 변경 없음)
- 시민 행: 통합검색 `sc-search-modal__item` 패턴 · `resolveDisplayName` · 아바타·이름만 프로필 연결
- Empty: 「아직 팔로워가 없습니다.」 / 「아직 팔로우한 시민이 없습니다.」
- 정렬: `resolveDisplayName` 가나다 오름차순
- 디버그: `window.__scFollowLists(userId)` — `{ followers, following }` 조회 전용
- **2차 예정:** 언팔로우 버튼 · 타인 프로필 팔로워 목록 · 서버 동기화 없음

---

### ★ 2026-07-12 — ProfileFrame 숫자 0 표시 → -- 통일

- **활동 요약·영토 기록 숫자형** (작성 글·댓글·받은 공감·토론 참여·전달한 아우라·이동 횟수·시민 영향력): 화면에서 **0도 `--`**
- **1 이상**만 실제 숫자 표시 · `formatProfileFrameCountDisplay()` 단일 처리
- **원본** `activity` / `territory` 숫자 0 유지 · `activityDisplay` / `territoryDisplay`만 변환
- LEVEL·명성·경험치 % · 현재 소속·시민 등급 표시 규칙 변경 없음

---

### ★ 2026-07-12 — ProfileFrame 모달 Overlay 값 바인딩 버그 수정

- **원인:** 모달 ProfileFrame의 `activitySummaryLayer`·`territoryRecordLayer`가 `id` 없이 `data-pf-layer`만 존재 → HUD용 `#activitySummaryLayer` CSS(100%×100%) 미적용 → 레이어 0×0 + `overflow:hidden`으로 textContent는 설정됐으나 화면에서 클리핑
- **수정:** `ensureProfileFrameListLayerBounds()` — `applyProfileFramePixelLayout(frameRoot)`에서 목록 레이어 전체 오버레이 크기 확보
- **렌더 순서:** `renderProfileFrameInModal` — layout 적용 후 `renderProfileData` (`paintModalProfileFrame` · rAF 재실행)
- **디버그:** `window.__scInspectProfileFrame(userId)` — 최종 data + 모달 DOM textContent·layerBounds 조회
- frameRoot scoped 조회 유지 (`queryProfileFrameLayer`) · PNG·좌표·SC_PROFILE_LAYOUT 변경 없음

---

### ★ 2026-07-12 — ProfileFrame 활동·영토 빈칸 표시 수정

- **원인:** `formatScProfileDisplayNumber(undefined)` → 빈 문자열 · `aura` 미집계 시 undefined · merge 후 표시값 미확정
- **표시 정규화 단일화:** `normalizeProfileActivityDisplay()` · `normalizeTerritoryRecordDisplay()` · `finalizeProfileDisplayFields()`
- **표시 기준:** 실제 값 표시 · **활동·영토 숫자형은 0도 `--`** · 1 이상만 숫자 · 데이터 확인 불가 `--` · 현재 소속 없음 `기록 없음` · 등급 없음 `참여자` · 전달한 아우라 계산 없음 `--` (Mock 숫자 금지)
- **`value || '--'` 금지** — `null`/`undefined`/`''` 만 `--` 처리
- 디버그: `window.__scResolvedProfileData(userId)` — 렌더 직전 최종 profileData clone
- ProfileFrame PNG · 좌표 · HTML/CSS · PlayerProgression 수식 변경 없음

---

### ★ 2026-07-12 — Community System v2 북마크 목록 1차

- HUD `sc-map-tab-bookmarks` (🔖) — 북마크 목록 모달 진입
- `public/bookmark-list.js` — `sc_bookmarks_v1` 목록 · `findPostByIdAnywhere` · `__scBoardNavigateToPost`
- 항목 표시: 제목 · 작성자(displayName) · 영토 Badge · 작성시간 · 저장시간
- 제목 클릭 → 게시글 상세 · 모달 닫힘 · 삭제 → `togglePostBookmark` + Toast
- Empty: 「저장한 게시글이 없습니다.」 · 정렬: `createdAt` DESC
- `window.findPostByIdAnywhere` 노출 (읽기 전용)
- 새 저장소 없음 · 게시글 bundle 구조 변경 없음

---

### ★ 2026-07-12 — Search System v1 완료 (통합검색 · 시민 + 토론)

- **토론 검색** — `sc_board_bundle_v1` 클라이언트 스캔 · 제목 · 본문 · 작성자 `displayName` · 최대 20건 · postId 중복 제거
- 정렬: 제목 완전/시작/부분 → 본문 → 작성자 displayName
- 결과 UI: `board__item` 스타일 · 제목 · 본문 말줄임(~50자) · 작성자 · 영토 Badge · 작성시간
- 제목 클릭 → `__scBoardNavigateToPost()` → 검색 모달 닫힘
- 디버그: `window.__scSearchDiscussions(query)`
- **Search System v1 완료** — 통합검색(시민 + 토론) · displayName 기준 · userId 내부 식별자

---

### ★ 2026-07-12 — Search System v1 1차 (통합검색 모달 · 시민 검색)

- 지도 HUD `sc-map-tab-search` (🔍) — 통합검색 진입
- `sc-search-modal` — 검색창 · **시민** 결과 · **토론** 준비 중 안내
- `public/search-system.js` — `searchCitizensByDisplayName` · `openSearchModal` / `closeSearchModal` · `renderCitizenSearchResults`
- 시민 검색: `collectDisplayNameIndex()` + `resolveDisplayName` · displayName 부분 일치 · 완전/시작/부분 일치 정렬 · 최대 15명
- 결과 클릭(이름·아바타만) → `openUserProfile` → 검색 모달 닫힘
- 디버그: `window.__scSearchCitizens(query)`
- **토론 검색 미구현** — 2차 예정
- ProfileFrame · 지도 · bundle 구조 · PlayerProgression 변경 없음

---

### ★ 2026-07-12 — displayName 통일 기반 (Search System v1 사전 작업)

- `public/display-name.js` — `resolveDisplayName(userId)` · `rememberDisplayName` · `syncCurrentUserDisplayName` · `collectDisplayNameIndex`
- 우선순위: 로그인 프로필 `nickname` / Auth `display_name` → `sc_display_names_v1` 캐시 → **fallback `userId`**
- `userId`는 내부 식별자 유지 · 화면 표시·향후 검색은 **displayName 기준**
- 적용: 게시글 목록·상세·댓글 · 알림 · 랭킹 · 아바타 HUD · Hover `aria-label` · 채팅 · 미니프로필 · 타 유저 ProfileFrame 모달
- **검색 UI/알고리즘 미구현** — Search System v1은 **검색창 하나 · displayName 기반 통합검색** · 결과 **「시민」+「토론」** 그룹 분리 예정
- 디버그: `window.__scResolveDisplayName` · `window.__scCollectDisplayNameIndex`
- 게시글/댓글 bundle 데이터 구조 · ProfileFrame PNG/좌표 · PlayerProgression 수식 변경 없음

---

### ★ 2026-07-12 — ProfileFrame 영토 기록 표시 기준 정정

- **현재 소속**만 사용 — `territory.current`에 `resolveCurrentTerritoryIdForUser()` 기반 현재 영토 표시
- **「최초 소속」 폐기** — 코드·주석·문서에서 제거 (복원·계산 안 함)
- 표시 fallback 단일 처리: `normalizeTerritoryRecordDisplay()` — 현재 소속 `기록 없음` · 이동 `0` · 영향력 `0` · 등급 `참여자`
- `SC_PROFILE_DATA.territory` Mock — 중앙광장 / 0 / 0 / 참여자 (데모 유저)
- ProfileFrame PNG · 좌표 · HTML/CSS 변경 없음

---

### ★ 2026-07-12 — ProfileFrame 영토 기록 실데이터 연결 1차

- `resolveUserTerritoryRecord(userId)` — 기존 PlayerProgression·유저 버킷·시즌 아카이브·성장 기여 데이터 조회
- 연결 항목 4개: **현재 소속**(`territory.current`) · **이동 횟수**(`territory.moved`) · **시민 영향력**(`territory.influence`) · **시민 등급**(`territory.rank`)
- (후속 정정) 최초 소속 로직 제거 → 현재 소속 기준으로 변경
- 이동 횟수: 시즌 아카이브 주 영토 변경 횟수 · 없으면 exileHistory · 없으면 0
- 시민 영향력: `getMyStandings` / `rankReputationScore` 재사용 · 없으면 Mock fallback
- `loadCurrentUserProfile()` · `buildUserProfileDataForModal()` — `mergeResolvedProfileTerritory()` merge
- 디버그: `window.__scTerritoryRecord(userId)`
- ProfileFrame PNG · 좌표 · HTML/CSS 변경 없음 · 새 영향력/이동 기록 시스템 미도입

---

### ★ 2026-07-12 — ProfileFrame 활동 요약 실데이터 연결 1차

- `resolveUserProfileActivity(userId)` — 게시판 bundle(`sc_board_bundle_v1`) 기반 활동 집계 헬퍼 추가
- 연결 항목 5개: **작성 글**(`posts`) · **댓글**(`comments`) · **받은 공감**(`receivedLikes`, empathy만) · **토론 참여**(`discussions`, 서로 다른 postId 수) · **전달한 아우라**(`aura` — 기존 계산값 없어 Mock fallback 유지)
- `loadCurrentUserProfile()` · `buildUserProfileDataForModal()` — clone 후 `mergeResolvedProfileActivity()` merge (SC_PROFILE_DATA 원본 미변경)
- 디버그: `window.__scProfileActivity(userId)` · `window.resolveUserProfileActivity(userId)`
- ProfileFrame PNG · 좌표 · `SC_PROFILE_LAYOUT` · HTML/CSS 변경 없음

---

### ★ 2026-07-11 — UserCard UX 단순화

- `ScMiniProfile.attachHover()` 화면 연결 해제 — 큰 팝업 미표시 · 컴포넌트 코드는 보류
- 프로필 클릭 범위를 **아바타·닉네임·유저 ID**로 축소 (게시글 상세·댓글·알림·랭킹)
- Hover 안내: `title` / `aria-label` — `클릭해서 유저 프로필 보기`
- 활동 피드: 작성자 이름 미표시 → 프로필 연결 해제
- 클릭 흐름 `openUserProfile()` → ScProfileModal → ProfileFrame 유지

---

### ★ 2026-07-11 — 랭킹 작성자 프로필 UX 1차

- 랭킹 모달 항목 닉네임 영역 — Hover `ScMiniProfile` · 클릭 `openUserProfile()` → `ScProfileModal` / ProfileFrame
- 전체·중앙·개척·수호·외계 탭 공통 · `userId` 없는 항목은 미연결

---

### ★ 2026-07-11 — 랭킹 UI 개선 2차

- TOP1~3 행 여백 확대 · 👑🥈🥉 아이콘·순위 숫자 가독성 정리
- 영토명 `sc-rank-modal__terr` Badge (`data-territory` 색상) · 내 순위 2×2 HUD 정보 그리드
- 모달 폭 `29rem` 소폭 확대 — 기능·데이터 변경 없음

---

### ★ 2026-07-11 — 랭킹 UI 개선 1차

- 랭킹 모달 탭 **전체 / 중앙 / 개척 / 수호 / 외계** 5종 (`getLeaderboard` 필터: `null` · `COMMON` · `PROGRESSIVE` · `CONSERVATIVE` · `KANTAPBIYA`)
- TOP1~5 시각 강조 — 👑🥈🥉 금·은·동 테두리 · 4~5위 ⭐ + TOP4/TOP5 Badge
- `rank-leaderboard.js` · `index.html` 모달 HTML/CSS — `PlayerProgression` 구조 변경 없음

---

### ★ 2026-07-11 — Community System v1 · 게시글 신고 상세 의견

- 신고 모달 **상세 의견** textarea (최대 300자 · 실시간 `0 / 300` 카운터)
- 사유별 규칙: 일반 사유는 선택 입력 · **기타** 선택 시 상세 의견 필수
- `sc_reports_v1` 항목에 `detail` 필드 추가 · `detail` 없는 기존 데이터 호환 유지

---

### ★ 2026-07-11 — Community System v1 · 게시글 신고 1차

- 게시글 목록·상세 반응 바 **신고** 버튼 (`sc-react-btn--report`) · HUD 모달 · 행동 기준 사유 6종 (정치 의견·성향 사유 없음)
- `sc_reports_v1` localStorage · userKey별 `{ postId, reason, createdAt, reporterId }[]` 저장
- 중복 신고·본인 글 신고 차단 · Toast 안내만 — 숨김·제재·외계행성 이동·관리자 기능 미포함

---

### ★ 2026-07-11 — Community System v1 · 게시글 공유 1차

- 게시글 목록·상세 반응 바 **공유** 버튼 (`sc-react-btn--share`) · `linkTarget` 동일 쿼리(`view`/`postId`/`territoryId`/`stage`) URL 복사
- `navigator.clipboard.writeText` + textarea fallback · HUD Toast `링크가 복사되었습니다.`
- SNS/카카오/QR/통계/DB 미포함

---

### ★ 2026-07-11 — Community System v1 · 게시글 북마크 1차

- `sc_bookmarks_v1` localStorage · userKey별 `{ postId, createdAt }[]` 저장
- 게시글 목록·상세 반응 바에 **저장** 버튼 (`sc-react-btn--bookmark`) · 토글 · 새로고침 유지
- 북마크 목록 UI·DB·검색 미포함 (v1 저장만)

---

### ★ 2026-07-11 — 알림 작성자 프로필 클릭과 콘텐츠 이동 영역 분리

- `buildNotificationItemElement` — `actorId` 있을 때 좌측 작성자 영역(아바타·닉네임)과 알림 내용 영역 클릭 분리
- 작성자 영역: Hover `ScMiniProfile` · 클릭 `openUserProfile()` (`stopPropagation`)
- 알림 내용 영역: 클릭 `navigateFromNotification()` · 읽음 처리 유지
- 시스템 알림(`level_up`/`alien_*` 등)은 기존 단일 클릭 동작 유지

---

### ★ 2026-07-11 — 알림 작성자 프로필 UX 1차

- **데이터 점검:** `sc_notifications_v1` 기존 항목은 `actorId` 미저장 · `follow`만 `linkTarget.userId` 보유
- `addNotification` — `actorId`/`authorId`/`userId` 또는 `linkTarget.userId` 저장 · 렌더 시 식별값 있는 항목만 `ScMiniProfile` + `openUserProfile` 연결
- `comment`/`like` 생성 시 `actorId` 기록 · `level_up`/`alien_*` 등 시스템 알림은 미연결

---

### ★ 2026-07-11 — 활동 피드 작성자 프로필 UX 1차

- **데이터 점검:** 기존 `sc_activity_feed_v1` 항목은 `authorId`/`userId` 미저장 — 익명 메시지(`한 시민이…`, `누군가…`) 유형은 식별값 추가 없음
- `addActivityFeedItem` — `authorId`/`userId` 선택 저장 · `renderActivityFeed`에서 식별값 있는 항목만 `ScMiniProfile` + `openUserProfile` 연결
- `post_created` 이벤트만 `authorId` 기록 (글 작성자)

---

### ★ 2026-07-11 — 댓글 작성자 프로필 UX 1차

- `renderThreadedCommentNode` — 댓글 작성자 meta에 `ScMiniProfile.attachHover` · 클릭 `openUserProfile()` 연결 (게시글·상세·데일리 이슈·대댓글 공통)
- 기존 `ScMiniProfile` · `ScProfileModal` · ProfileFrame 재사용 — 새 Hover/Modal/UI 없음

---

### ★ 2026-07-10 — ScProfileModal ProfileFrame 회귀 QA

- Hover · Click · ProfileFrame · 4스킨 · HUD 복원 · 닫기 · DOM/리스너 중복 — 회귀 검사 완료
- **FIX** `closeScProfileModal()` — `transitionend` + `setTimeout` 이중 호출로 `restoreHudProfileFrameAfterModal` 2회 실행되던 버그 수정 (`finished` 가드)

---

### ★ 2026-07-10 — ScProfileModal ProfileFrame 렌더 연결 1차

- `openUserProfile()` → 모달 내 기존 ProfileFrame 재사용 (`renderProfileData` · `applyProfileFramePixelLayout` · `data-pf-layer` 스코프)
- `buildUserProfileDataForModal(userId)` — MiniProfile · PlayerProgression · clone `SC_PROFILE_DATA` · `territorySkin`별 PNG/좌표

---

### ★ 2026-07-10 — 프로필 모달 껍데기 1차 (`ScProfileModal`)

- `openUserProfile(userId)` → HUD 프로필 모달 오픈 · `userId` state 저장 · 본문 `프로필을 불러오는 중...` placeholder
- ESC · 배경 클릭 · X · 닫기 버튼 · fade 0.2s — ProfileFrame 미연결

---

### ★ 2026-07-10 — Hover 미니 프로필 1차 (작성자 카드)

- 공통 `ScMiniProfile` · `#sc-mini-profile-popover` — HUD 미니 카드 (아바타·Lv/명성·영토·대표업적·활동지표)
- 게시글 상세 작성자 카드 Hover 표시 · 클릭 `openUserProfile()` → `ScProfileModal`

---

### ★ 2026-07-10 — 게시글 상세 작성자 카드 3차 (영토 Badge)

- 레벨/명성 아래 작성시간 행에 `[중앙광장]` 등 작은 영토 Badge 추가 (`data-territory` · `territoryShortLabel` 재사용)

---

### ★ 2026-07-10 — 게시글 상세 작성자 카드 2차 (레벨·명성)

- 닉네임 아래 `Lv.N · 명성등급` 표시 (`PlayerProgression.getDisplay` · 본인 `getCurrentProfileData()` 보강)

---

### ★ 2026-07-10 — 게시글 상세 작성자 영역 1차 CSS 개선

- 상단 작성자 메타를 어두운 HUD 카드형으로 정리 (아바타·닉네임/시간/카테고리 간격 · 팔로우 버튼 겹침 배치 · 약한 hover glow)

---

### ★ 2026-07-10 — ProfileFrame 좌표 에디터 기본 숨김

- localhost에서도 좌표 에디터·스킨 전환 버튼 기본 비표시
- 필요 시 콘솔 `__scShowProfileLayoutEditor()` / `__scHideProfileLayoutEditor()`

---

### ★ 2026-07-10 — 최근 세계 활동 피드 1차

- `sc_activity_feed_v1` localStorage · `global_demo` 키 · 최대 30건 저장 · 화면 8건 표시
- 메인 지도 좌하단 **최근 세계 활동** HUD 패널
- 글/댓글/공감/좋아요/팔로우/레벨업/외계 경고·이동 이벤트 연결 · 영토 변경 피드 제외
- 디버그: `__scAddActivity()` · `__scActivityFeed()` · `__scClearActivityFeed()`

---

### ★ 2026-07-10 — ProfileFrame 성향지도 첫 펼침 좌표 보정

- 접힌 상태에서 `refreshCurrentProfile()`·boot layout 스킵 → 펼침 후 double-rAF·애니메이션 종료 시 재동기화
- `renderProfileData()` — 영토 스킨/layout 적용 후 성향지도 렌더 (순서 수정)

---

### ★ 2026-07-10 — 알림센터 1차 (Notification Center)

- `sc_notifications_v1` localStorage · 유저별 알림 저장 (최대 50건)
- 맵 HUD 우상단 **알림** 버튼 + 프로필 벨 · 드롭다운 패널 · 읽지 않음 배지 · ESC/바깥 클릭 닫기
- 타입: `comment` · `like` · `follow` · `level_up` · `alien_warn` · `alien_move` · `achievement`(예비)
- 이벤트 연결: 댓글/공감/팔로우/레벨업 · 영토 변경 알림은 생성하지 않음
- 디버그: `__scAddNotification()` · `__scNotifications()` · `__scClearNotifications()`

---

### ★ 2026-07-10 — ProfileFrame 로그인 사용자 데이터 어댑터

- `loadCurrentUserProfile()` — Auth 세션 · `/api/auth/me` · `/api/me/profile` 캐시와 `PlayerProgression`을 merge해 ProfileFrame 데이터 생성
- `getCurrentProfileData()`는 `loadCurrentUserProfile()`만 호출 · `SC_PROFILE_DATA`는 미로그인 fallback (원본 불변)
- `__scPrefetchUserProfile()` — 로그인 후 프로필 API 선조회 · `__scCurrentProfile()` 디버그 헬퍼

---

### ★ 2026-07-10 — ProfileFrame 성향지도 게임 성향 어댑터

- `mapPoliticalScoresToProfileAlignment()` — `sc_political_scores_v1` → 표시용 4축 alignment 매핑
- `getCurrentProfileData()`가 localStorage 성향을 읽어 ProfileFrame 성향지도에 반영 · `__scPreviewProfileAlignment()` 디버그

---

### ★ 2026-07-10 — AI 인수인계 문서 (`docs/AI_HANDOFF.md`)

- 프로젝트 구조 · 완료/미완료 · 막힘·리팩토링 · **성향 변화 요소·수치** 정리

---

### ★ 2026-07-10 — 성향지도 이동 애니메이션 보강

- `alignment` 값 변경 시 polygon · polyline · circle 0.28s ease-out 보간 이동
- polygon fill-opacity 0.18 → 0.22 자연 변화 · glow 강도 유지 · SVG 구조·좌표 무변경

---

### ★ 2026-07-10 — ProfileFrame 접기 애니메이션

- 접기 버튼 클릭 시 0.18s ease-in · opacity + translateY/scale 퇴장 후 기존 hide 실행
- 펼침 애니메이션 유지 · 레이아웃·좌표 무변경

---

### ★ 2026-07-10 — ProfileFrame 펼침 애니메이션

- 프로필 탭 클릭(펼침) 시에만 0.2s ease-out · opacity + translateY/scale 진입
- 페이지 최초 진입·접힌 상태에서는 실행하지 않음 · 레이아웃·좌표 무변경

---

### ★ 2026-07-10 — 업적 이름·날짜 좌표 확정 (영토별)

- center/pioneer · guardian · alien `achievementTitles[3]` · `achievementDates[3]` 에디터 최종값 반영

---

### ★ 2026-07-10 — 업적 이름·날짜 좌표 에디터

- `achievementTitles[3]` · `achievementDates[3]` — 아이콘과 분리된 px 좌표 (1024×819)
- 에디터: 업적 아이콘 / 업적 이름 / 획득 날짜 각각 선택·드래그·크기 조절
- 영토별 기본값 (center·guardian·alien) · 복사 포맷에 titles/dates 포함
- 레이아웃 적용: `#achievementLayer` 내 img·title·date 개별 absolute 배치

---

### ★ 2026-07-10 — 대표 업적 이름·획득 날짜 텍스트

- `achievements` 객체 배열 (`id` · `title` · `date`) · 문자열 배열 하위 호환
- 슬롯 내 `profile-achievement-title` · `profile-achievement-date` · `renderProfileAchievements()` 연동

---

### ★ 2026-07-10 — 대표 업적 슬롯 좌표 확정 (영토별)

- center/pioneer · guardian · alien `achievement` · `achievementSlots[3]` 에디터 최종값 반영

---

### ★ 2026-07-10 — 업적 슬롯 에디터 선택·복사 개선

- 슬롯 div 우선 선택 (역순 탐색) — 크기 조절 Alt+←→/↑↓ 동작
- 「현재 영토 업적 슬롯 복사」·「전체 영토 업적 슬롯 복사」 (center/guardian/alien)

---

### ★ 2026-07-10 — 좌표 에디터 대표 업적 슬롯

- `SC_PROFILE_LAYOUT.achievement` · `achievementSlots[3]` px 좌표 (1024×819)
- 에디터: 대표 업적 영역 + 슬롯 0~2 드래그/방향키 · 스킨별 localStorage
- 「업적 슬롯 복사 (AI 전달용)」· 전체 좌표 복사에 achievement 포함
- `__scProfileLayoutEditor.copyAchievementSlots()` · `formatAchievementSlots()`

---

### ★ 2026-07-10 — 대표 업적 슬롯 UI (achievementLayer 내부)

- `#achievementLayer` 안 `profile-achievement-slot` × 3 (`data-slot` 0~2) · `profile-achievement-img`
- 슬롯 전용 CSS 추가 · `#achievementLayer` 좌표·기존 ProfileFrame 무변경
- `renderProfileAchievements()` 기존 구현 그대로 (`img.src`만 변경)

---

### ★ 2026-07-10 — 대표 업적 src 전용 렌더 (JS만)

- `SC_PROFILE_DATA.achievements` 더미 배열
- `renderProfileAchievements(data)` — 기존 슬롯 `img.src`만 변경 · DOM/CSS/레이아웃 무변경
- `renderProfileData()` 마지막 1줄 호출 추가

---

### ★ 2026-07-10 — 성향지도 캘리브레이션 스킨 그룹 분리

- **centerPioneer** (중앙·개척) / **guardianAlien** (수호·외계) 그룹별 `alignmentMap` · 축 최대치 분리
- `alignmentMap` — center/pioneer `{305,355}` · guardian/alien `{309,360}`
- `SC_PROFILE_ALIGNMENT_AXIS_MAX_BY_GROUP` — 축별 최대치 `{ alien:67, guardian:70, center:72, pioneer:69 }`
- 실제 성향값 렌더 시 축 스케일 적용 · 에디터는 그룹별 localStorage

---

### ★ 2026-07-10 — 좌표 에디터 성향지도 캘리브레이션

- 에디터 ON 시 축별 **최대치(0~100)** 입력 → polygon 미리보기 (`SC_PROFILE_ALIGNMENT_EDITOR_MAX`)
- **빨간 점** = SVG 중앙(최소 0) — PNG 축 중심 맞춤용
- `localStorage` `sc_profile_alignment_editor_max` 저장
- 「성향지도 복사 (AI 전달용)」→ `alignmentMap` 좌표 + `previewMax` 블록 클립보드
- `window.__scProfileLayoutEditor` — `getAlignmentEditorMax` · `setAlignmentEditorMax` · `copyAlignmentCalibration`

---

### ★ 2026-07-10 — 성향지도 SVG 완성도 보강 (glow · transition · 왕관)

- polygon stroke 강화 · drop-shadow · 점 크기 증가 · 중심점 circle
- `transition: 0.28s ease-out` — 값 변경 시 은은한 이동
- `alignmentMap` 좌표 `{ x: 304, y: 353, w: 190, h: 190 }` 확정 (전 스킨) · 왕관 마커 제거

---

### ★ 2026-07-10 — ProfileFrame 성향지도 SVG 오버레이

- `SC_PROFILE_DATA.alignment` — center/pioneer/guardian/alien (0~100)
- `SC_PROFILE_LAYOUT.alignmentMap` — px 좌표 · 좌표 에디터 대상
- `alignmentMapLayer` SVG polygon/polyline/circle · `renderProfileAlignmentMap()`
- 금색 반투명 fill · `renderProfileData(data)` 연동

---

### ★ 2026-07-10 — expGauge 그라데이션 (밝은 노랑 → 짙은 갈색)

- Fill: 좌 `#fff0a0` → 우 `#6b4512` 단계적 짙어짐
- Track: `#3d2810` (우측 톤과 통일)

---

### ★ 2026-07-09 — 프로필 시스템 (ProfileFrame) 일일 정리

**ProfileFrame 기본 UI 전환**
- PNG 기반 ProfileFrame을 기본 프로필 UI로 적용 · legacy UI `hidden` 유지
- 4종 영토 PNG (`center` / `pioneer` / `guardian` / `alien`) · `territorySkin` 자동 변경

**레이아웃**
- 좌측 하단 HUD 고정 · 패널/헤더/테두리 제거 · 접기 버튼 Frame 내부 우하단 · PNG 비율·크기 고정

**좌표**
- `%` 폐기 → `SC_PROFILE_LAYOUT` 1024×819 px · `scale = 너비 ÷ 1024`
- localhost 좌표 에디터 (드래그 · 방향키 · localStorage v3 · 복사)

**데이터 파이프라인**
- `SC_PROFILE_DATA` → `getCurrentProfileData()` → `renderProfileData()` → ProfileFrame
- `refreshCurrentProfile()` 개발용 갱신

**경험치 게이지**
- `expGaugeLayer` · 노란/골드 공통 디자인 · 100% Fill 배경 · %는 `expLayer` 텍스트만
- `expGauge` `{ x: 392, y: 126, w: 590, h: 10 }`

**미구현:** 아바타 · 성향지도 · 대표 업적 · 실유저/Firebase · 모바일 보정

---

### ★ 2026-07-09 (저녁12) — ProfileFrame 경험치 게이지 (expGauge)

- `expGaugeLayer` + `profile-frame__exp-gauge-fill` 추가
- `expGauge` 좌표 `{ x: 392, y: 126, w: 590, h: 10 }` · 좌표 에디터 대상
- 색상 회색 메탈 → **노란/골드** (가독성) · 바 100% 고정 · % 텍스트는 `expLayer`만

---

### ★ 2026-07-09 (저녁11) — Mock User Profile Adapter

- `getCurrentProfileData()` — SC_PROFILE_DATA 기반 더미 프로필 반환 (activity/territory 안전 복사)
- `refreshCurrentProfile()` — 콘솔 테스트용 get → render 파이프라인
- 초기 렌더: `getCurrentProfileData()` → `renderProfileData()` 흐름으로 통일

---

### ★ 2026-07-09 (저녁10) — renderProfileData() 영토 스킨 연동

- `data.territorySkin` → 기존 `setProfileTerritorySkin()` 호출 (center/pioneer/guardian/alien PNG)
- 텍스트 출력 + ProfileFrame 배경 스킨 한 함수로 갱신

---

### ★ 2026-07-09 (저녁9) — renderProfileData() ProfileFrame 렌더 파이프라인

- `window.renderProfileData(data)` — SC_PROFILE_DATA → ProfileFrame 13개 텍스트 슬롯 출력
- 페이지 로드 시 `renderProfileData(window.SC_PROFILE_DATA)` 1회 자동 실행
- `applyScProfileDataToFrame` 제거 · 좌표/PNG/스킨은 기존 `SC_PROFILE_LAYOUT`·`setProfileTerritorySkin` 유지

---

### ★ 2026-07-09 (저녁8) — SC_PROFILE_DATA 단일 더미 데이터 객체

- `window.SC_PROFILE_DATA` — userId, level, fame, expPercent, territorySkin, activity, territory
- ProfileFrame 오버레이 텍스트 HTML 하드코딩 제거 → 객체 참조

---

### ★ 2026-07-09 (저녁7) — ProfileFrame 영토별 좌표 분리

- `SC_PROFILE_LAYOUT_BY_SKIN` — center/pioneer 공통 · guardian/alien 개별 activity·territory 좌표
- 스킨 전환 시 `syncActiveProfileLayout()` + 좌표 자동 재적용
- localStorage v3 (스킨별 저장) · 에디터 복사/초기화 현재 스킨 기준

---

### ★ 2026-07-09 (저녁6) — ProfileFrame 4종 영토 PNG 스킨 연결

- `pioneer.png` · `guardian.png` · `alien.png` 추가 (`public/assets/territories/profiles/`)
- `setProfileTerritorySkin()` · `resolveProfileTerritorySkinKey()` — 배경 PNG만 교체, `SC_PROFILE_LAYOUT` 공통
- `renderTerritoryCreed()` 연동 · localhost 스킨 전환 버튼 (중앙/개척/수호/외계)

---

### ★ 2026-07-09 (저녁5) — ProfileFrame 좌표 확정 (에디터 캘리브레이션)

- `SC_PROFILE_LAYOUT_DEFAULT` 전체 좌표 에디터 최종값 반영 (1024×819 px)

---

### ★ 2026-07-09 (저녁4) — 좌표 에디터 「전체 좌표 복사」

- `SC_PROFILE_LAYOUT_DEFAULT` 전체 블록(index.html 붙여넣기용) 클립보드 복사
- 복사 시 x/y/w/h 정수 반올림 · territory `align` 포함

---

### ★ 2026-07-09 (저녁3) — ProfileFrame 가운데 정렬 렌더링 수정

- `.profile-frame__data-text` 내부 span — flex + ellipsis 시 가운데 정렬 깨짐 해소
- localStorage 로드 시 `align`은 기본값 유지 (x/y/w/h만 복원)

---

### ★ 2026-07-09 (저녁2) — ProfileFrame 정렬: 명성·경험치 오른쪽 / 소속·등급 가운데

- `#fameLayer` · `#expLayer` → 박스 오른쪽 정렬
- 영토 기록 `territory[0]`·`[3]` → `align: 'center'` (현재 소속 · 시민 등급)

---

### ★ 2026-07-09 (저녁) — ProfileFrame 좌표 개발용 에디터

- localhost 전용 좌표 에디터: 드래그·방향키·Shift/Alt 단축키·선택 박스 x/y/w/h 표시
- `SC_PROFILE_LAYOUT` localStorage 저장·초기화·클립보드 복사
- `SC_PROFILE_LAYOUT_DEFAULT` 분리 · 운영(비-localhost)에서는 UI 미표시

---

### ★ 2026-07-09 (오후11) — ProfileFrame 하단 y +6px · 영토 기록 행별 정렬

- `activity`·`territory` y 좌표 +6px (632~732 / 632~707)
- 영토 기록 행별 정렬: 소속·등급 왼쪽 / 이동 횟수·시민 영향력 오른쪽 (`align` + `padding-right: 6px × scale`)

---

### ★ 2026-07-09 (오후10) — ProfileFrame activity·territory y +25px

- `SC_PROFILE_LAYOUT` 활동 요약·영토 기록 행 y 좌표 +25px (대제목 줄 겹침 해소)
- userId / level / fame / exp 좌표 변경 없음

---

### ★ 2026-07-09 (오후9) — ProfileFrame 좌표 체계 px 전환 (1024×819 기준)

- `%` 좌표 미세조정 중단 — `SC_PROFILE_LAYOUT`에 `{ x, y, w, h }` px 고정
- `applyProfileFramePixelLayout()` — `scale = 프레임 너비 ÷ 1024`, 화면 좌표 = px × scale
- USER ID / LEVEL / 명성 / 경험치 / 활동 요약(5) / 영토 기록(4) 적용
- `ResizeObserver` + 도크 펼침 시 재계산 · 4개 영토 스킨 공통 좌표계
- alignmentMap · achievement는 % 유지 (추후 `SC_PROFILE_LAYOUT` 확장)
- 실제 데이터 연결 없음

---

### ★ 2026-07-09 (오후8) — ProfileFrame 오버레이 좌표 3차 캘리브레이션

- 상단 4칸·활동 요약·영토 기록 % 좌표 재조정 (라벨 겹침 해소)
- 텍스트 `clamp(7px, 0.66vw, 11px)`

---

### ★ 2026-07-09 (오후7) — ProfileFrame 오버레이 색상·좌표 2차 캘리브레이션

- 텍스트 `#f8f1d8` · `clamp(8px, 0.72vw, 12px)` — 가독성 개선
- 상단 4칸·활동 요약·영토 기록 % 좌표 재조정 (프레임 기준)

---

### ★ 2026-07-09 (오후6) — ProfileFrame 오버레이 정렬 규칙 확정

- USER ID / 명성 / 경험치 / 영토 기록 → 왼쪽 정렬 + ellipsis
- LEVEL → 가운데 정렬
- 활동 요약 숫자 → 오른쪽 정렬 (끝선 맞춤)
- 공통: `position:absolute`, 칸 `width` 고정, `nowrap` + `text-overflow:ellipsis`

---

### ★ 2026-07-09 (오후5) — ProfileFrame 데이터 오버레이 캘리브레이션 (더미)

- 6개 레이어에 더미 텍스트/숫자 출력 (USER ID, LEVEL, 명성, 경험치, 활동 요약, 영토 기록)
- 금장색 `.profile-frame__data` 스타일 · % 좌표 임시값
- 실제 데이터 연결 없음 (위치 보정 단계)

---

### ★ 2026-07-09 (오후4) — ProfileFrame 좌측 여백 축소 · 접기 버튼 금장 스타일

- 도킹 `left: 0.375rem` (앱 모드 `--hud-map-inset` 대신 직접 지정)
- 접기 버튼 `right: 1.25rem; bottom: 0.85rem` — 금장 프레임 비가림
- 접기 버튼 금장/암색 계열 스타일 적용

---

### ★ 2026-07-09 (오후3) — ProfileFrame 좌하단 HUD 도킹 · 접기 버튼 카드 부착

- ProfileFrame 좌하단 정렬 (`left/bottom: 1.375rem`, center 정렬 제거)
- 패널 `width: auto` — 카드 너비에 맞춤
- 접기 버튼 ProfileFrame 내부 `absolute` (right/bottom: 0.5rem)

---

### ★ 2026-07-09 (오후2) — ProfileFrame 크롬 제거 (PNG 단독 표시)

- `avatar-dock__panel--profile-frame` — 패널 배경·테두리·그림자·backdrop 제거
- "영토 시민 카드" 헤더 숨김
- 접기 버튼만 PNG 아래 오른쪽에 소형 유지

---

### ★ 2026-07-09 (오후) — ProfileFrame 패널 맞춤 · 레거시 UI 숨김

- `.profile-frame` — `dvh` 기반 `max-height` + `aspect-ratio: 1024/819`로 패널 내 한 화면 표시
- 패널 내부 세로 스크롤 제거 (`avatar-dock__panel--profile-frame`)
- `avatar-deco-panel`(기본/참여자/없음/없음) 및 레거시 프로필 DOM `hidden` 유지

---

### ★ 2026-07-09 — ProfileFrame 기본 레이아웃 (중앙광장 스킨)

**구조**

- `ProfileFrame` 컨테이너 추가 — 중앙광장 프로필 PNG를 `contain`으로 원본 비율 표시
- 오버레이 레이어 8개 placeholder: `userIdLayer`, `levelLayer`, `fameLayer`, `expLayer`, `alignmentMapLayer`, `achievementLayer`, `activitySummaryLayer`, `territoryRecordLayer`
- `territorySkin` 상수 준비: `center` / `pioneer` / `guardian` / `alien` (center만 실제 PNG)
- 기존 프로필 HTML·ID는 `profile-citizen-card__legacy`에 보존 (hidden)

**에셋**

- `public/assets/territories/profiles/center.png` — 중앙광장 프로필 기준 이미지 (1024×819)

**미구현 (의도적)**

- 데이터 연결, 텍스트·숫자·게이지, hover/click/animation, 반응형 세부 좌표 조정

---

### ★ 2026-07-05 저녁 — 프로필 방향·에셋 v1 확정 (문서)

**확정 방향**

- 프로필 스킨(시안 PNG)은 **아직 Cursor 미적용** — 별도 작업으로 보류
- **영토 시민 카드** 게임형 HUD 유지 · **유저가 주인공**, 영토는 배경
- 좌 **전신 아바타** · 우 닉네임/Lv/명성/XP/보조배너/레이더
- 신념 배너는 보조 — 유저보다 주인공처럼 보이면 안 됨
- 성향 **레이더만** · 가로 게이지·퍼센트 **사용 안 함**
- **가입일 제외** · **소속 중복 금지**

**항목 명칭 정리**

- 활동 요약: 작성 글 / 댓글 / 받은 공감 / **토론 참여** / **전달한 아우라** (팔로워 우선순위 ↓)
- 전달한 아우라: 다른 시민에게 남긴 영향력 누적 지표 (글·댓글·토론·공감·상호작용)
- 영토 기록: 최초·현재 소속 / 이동 횟수 / **시민 영향력** / 시민 등급 (~~명명된 점수~~ 폐기)
- 성향 지도 아래 **AI 한 줄 설명** 영역 예정 (수치 대신 변화 흐름)

**공식 에셋 v1**

- `public/assets/territories/banners/` — reform · centrist · order · alien `.webp`
- `public/assets/territories/emblems/` — 동일 4종
- 매핑: 개척(파랑·검+날개) / 중앙(초록·신전) / 수호(빨강·방패+검) / 외계(보라·수정)

**코드 작업 (오늘)**

- 에셋 WEBP 8종 정리 · CSS 변수 1차 연결 · 시민 카드 2열 골격 · 패널 스크롤 안정화

**내일 TODO:** `docs/TODO.md` §「다음 작업 — 프로필 마무리」1~10

### ★ 프로필 패널 레이아웃 안정화

- `.avatar-dock__panel` 세로 스크롤 허용 (`overflow-y: auto`)
- flex `min-height: 0` / `overflow: hidden` 압축 제거 → 콘텐츠 자연 높이
- 보조 배너 72px 고정, 성향 레이더 `min-height: 150px`

### ★ 영토 시민 카드 레이아웃 골격 재정렬 (시안)

- 상단 전체 배너 제거 → `.profile-main-zone` 내부 보조 배너(80~110px)
- `.profile-citizen-card__body` 2열: `.profile-avatar-zone` | `.profile-main-zone`
- 좌: 전신 아바타 세로 카드 + `--profile-territory-emblem-url`
- 우: 닉네임/Lv/명성/XP → 배너 → 레이더+성향 설명
- 하단 3카드(대표 업적/활동/영토 기록) 유지

### ★ 영토 배너·엠블럼 에셋 1차 UI 연결

- `public/index.html` — `SC_TERRITORY_BANNERS` / `SC_TERRITORY_EMBLEMS` 상수, `applyProfileTerritoryAssets()` 추가
- `renderTerritoryCreed()` → `#avatar-player-card-wrap`에 `--profile-territory-banner-url`, `--profile-territory-emblem-url` 설정
- 신념 박스(`.profile-citizen-card__belief`) — 공식 배너 hero 표시 (gradient·워터마크 제거, HTML 텍스트 sr-only)
- 기존 `territory-icons` PNG 참조 유지

### ★ 영토 배너·엠블럼 에셋 정리

- `public/assets/territories/banners/` — reform / centrist / order / alien `.webp` 4종 추가
- `public/assets/territories/emblems/` — reform / centrist / order / alien `.webp` 4종 추가
- PNG 소스 → WEBP 변환 (`tools/convert-territory-assets.py`); HTML/CSS/JS 연결 없음

### ★ 프로필 HUD 최종 다듬기 (Grid 유지)

- Lv / 명성 / 시민등급 → `profile-header__infobar` 단일 정보 바로 통합
- `profile-main` stretch 제거 → 신념·경험치 아래 빈 공간 축소
- 신념 카드 높이 ~25% 축소, motto 글자 크기 확대 (`white-space: pre-line` 유지)
- 아바타 카드 프레임·영토 소속 foot 강화 (`avatar-card-territory-name` 노출)
- 성향 레이더 제목 시각 숨김, 차트 ~12% 확대 (9.5rem)
- 하단 3요약 카드 padding/gap/font ~12% 압축
- 모바일(767px↓)만 프로필 내부 스크롤 허용

### ★ 영토 시민 카드 레이아웃 재정렬

- `profile-citizen-card` 단일 카드: 신념 crest → 아바타·성향·시민정보 body → 시민 기록 footer
- 영토 신념·엠블럼을 카드 상단 hero로 승격 (워터마크·영토 그라디언트)
- 아바타·성향 레이더·하단 기록을 카드 내부 구역으로 통합 (개별 패널 테두리 제거)
- 패널 제목 "영토 시민 카드"로 변경

_다음 우선순위는 TODO.md 참조_

---

## 2026-07-04

### ★ 오늘 작업 요약

- 메인 영토맵을 신규 16:9 원시시대 버전으로 교체
- 영토 명칭을 **개척영토 / 중앙광장 / 수호영토 / 외계행성**으로 통일
- `territory-beliefs.js` 기반 공식 신념 시스템 적용
- 영토 엠블럼 및 신념 이미지 교체
- 메인맵 레이아웃 확대 및 화면 최적화
- 프로필 UI를 기존 레이아웃에서 **Grid 기반 구조**로 재설계 시작

### 메인맵 · 영토

- tribal-s1 원시시대 16:9 지도 에셋 적용 (`territory-zones-tribal-s1.png`)
- `territory-hit-zones.json` — viewBox `0 0 1600 900`, 4영역 좌표 재조정
  (`progressive` / `conservative` / `plaza` / `kantapbiya`)
- 메인맵 표시 영역 확대 및 HUD 레이아웃 화면 최적화

### 신념 · 엠블럼

- `public/territory-beliefs.js` — Single Source of Truth, `renderTerritoryCreed()` 연동
- 영토별 엠블럼 PNG 교체 (`assets/territory-icons/`)
- 프로필 신념 HUD: 엠블럼 + `belief` 문장 + `displayName`의 신념

### 프로필 UI (Grid 재설계)

- **상단** `profile-main`: 사이드바(아바타+4축 레이더) | 메인(헤더+신념+경험치)
- **하단** `profile-summaries`: 대표 업적 · 활동 요약 · 영토 기록 3카드
- 오른쪽 정치 성향 가로 게이지 제거 → 좌측 4축 성향 레이더로 통합
- 패널 폭 48rem → 56rem, 반응형 브레이크포인트(767/1199px)
- 뷰포트 높이 최적화: 패널 세로 스크롤 제거, 여백·신념 카드·레이더 축소, 하단 3카드 첫 화면 노출

---

## 2026-07-02 (오늘)

### ★ 영토 명칭 전면 통일

- **개혁영토** → **개척영토** (내부 ID `PROGRESSIVE` / CSS key `reform` 유지)
- **질서영토** → **수호영토** (내부 ID `CONSERVATIVE` / CSS key `order` 유지)
- **깐따삐아** → **외계행성** (내부 ID `KANTAPBIYA` 유지)
- 적용 범위: `public/index.html`, `public/permissions-guide.js`, `config/world-territories.js`, `config/alignment-rank-limits.js`, `docs/`
- 성향 게이지 라벨: "개혁%/질서%" → "개척%/수호%"
- TOP3 헤더: "개혁 · TOP3" → "개척 · TOP3", "질서 · TOP3" → "수호 · TOP3"
- 인기댓글 섹션: "개혁 인기댓글" → "개척 인기댓글", "질서 인기댓글" → "수호 인기댓글"
- 호감도 라벨: "개혁 호감도" → "개척 호감도", "질서 호감도" → "수호 호감도"
- aria-label, 게시판 해금 안내, 진영 이동 레이블 등 모든 사용자 노출 문자열 교체

### ★ 영토 신념 데이터 파일 분리 (`public/territory-beliefs.js` 신규 생성)

- 신념 데이터의 **Single Source of Truth** 확립
- `window.TERRITORY_BELIEFS` 으로 전역 노출 (IIFE 패턴)
- 데이터 구조:
  ```js
  {
    displayName : '개척영토',
    subtitle    : '변화를 만드는 사람',
    belief      : '미래는 기다리는 것이 아니라,\n개척하는 것이다.',
    philosophy  : '변화를 두려워하지 않고\n새로운 가능성을 향해 나아간다.'
  }
  ```
- `philosophy` 필드: 데이터에만 존재, 프로필 미노출 (향후 영토 소개·툴팁 활용)
- `index.html` 에서 `<script src="/territory-beliefs.js">` 로 가장 먼저 로드

### ★ 프로필 신념 HUD — 외부 데이터 연동

- `index.html` 인라인 `TERRITORY_BELIEFS` 상수 제거
- `renderTerritoryCreed()` → `window.TERRITORY_BELIEFS[cssId].belief` 참조로 교체
- HUD 서브텍스트: `displayName` 기반으로 "— 개척영토의 신념 —" 동적 생성
- `.avatar-territory-creed__motto` CSS에 `white-space: pre-line` 추가 (`\n` 줄바꿈 적용)

### 신념 문장 최종 확정

| 영토 | 신념 |
|------|------|
| 중앙광장 | "답은 하나가 아니라, 함께 찾는 것이다." |
| 개척영토 | "미래는 기다리는 것이 아니라, 개척하는 것이다." |
| 수호영토 | "질서는 자유를 지키는 가장 강한 약속이다." |
| 외계행성 | "경계 밖의 시선은 새로운 문명을 만든다." |

### 신념 JS 데이터 구조 개선 (`headline` → `belief` + `philosophy` 분리)

- 기존 `headline` 단일 필드 → `belief` (표시용) + `philosophy` (보관용)
- `title` 필드 → `displayName` + `subtitle` 필드로 대체 (표시명과 부제 분리)

---

## 2026-07-02 (오전)

### 영토 신념 HUD — JS 동적 렌더링 전환

- 기존: HTML에 4개 영토 문구 하드코딩 + CSS `display:none`/`block` show/hide
- 변경: HTML 2개 동적 element (`#avatar-creed-motto`, `#avatar-creed-sub`)
- `TERRITORY_BELIEFS` 상수 정의 → `setMeta()` 내 `renderTerritoryCreed()` 호출
- `TERRITORY_CSS_MAP` 추가: `COMMON→centrist`, `PROGRESSIVE→reform`, `CONSERVATIVE→order`, `KANTAPBIYA→alien`
- CSS `[data-for]` show/hide 선택자 전체 제거
- `data-territory` 동기화: panel, badge, cardWrap 모두 `renderTerritoryCreed()` 내에서 갱신

---

## 2026-07-02 (하단 가독성 정리)

### 하단 활동 영역 가독성 개선 (`public/index.html`)

- `avatar-deco-panel__label` 색상 조정: `#334155` → `#64748b`
- `avatar-deco-panel__value--empty` 색상 조정: `#1e293b` → `#475569`
- 잠금 슬롯 opacity: `0.45` → `0.65`
- sticky 헤더 `backdrop-filter: blur(8px)` 제거 → 스크롤 하단 콘텐츠 블러 해소
- 활동 카드 라벨 색상: `#64748b` → `#94a3b8`
- 접기 버튼 row `margin-top: 0.15rem` 추가

---

## 2026-06-28

### 영토 신념 HUD + 성향 HUD 리디자인 (commit: `0b43d7b`)

#### 소속 배너 HUD Banner화
- `flex` 전환, `align-self: stretch` (전폭 소속 배너)
- `min-height: 44px`, `padding: 0.7rem 1.1rem`, `border-radius: 12px`
- 영토별 색상 체계 적용: centrist → 녹색(`#3DFFB3`), reform → 파랑(`#5AA8FF`), order → 빨강(`#FF5A5A`), alien → 보라(`#C77DFF`)
- `box-shadow: 0 0 14px rgba(영토색, 0.18)` glow 추가

#### 영토 신념 HUD (신규 섹션)
- `div.avatar-territory-creed` 신규 추가 (소속 배너 바로 아래 배치)
- 신념 문장 4종 (영토별 HTML `data-for` 속성으로 관리)
- 워터마크: `::before` 가상요소 (🏛/⚡/🛡/🪐), `font-size: 7rem`, `opacity: 0.07`
- `data-territory` 변경으로 배경·문장·워터마크·텍스트색 전체 자동 전환
- 높이: `min-height: 4.5rem` (와이드 배너 형태)
- 신념 문장: `font-size: 1.38rem`, `font-weight: 800`, `max-height: 2.6em` (2줄 제한)

#### 성향 HUD 업데이트
- 아이콘 크기: `1.15rem` → `2.2rem` (게이지와 균형), `1.9rem` (엠블럼)
- 아이콘·게이지 간격 gap: `0.4rem` → `0.28rem`
- 게이지 색상 업데이트:
  - centrist: `#3DFFB3 → #8CFFD9`
  - reform: `#5AA8FF → #A5D4FF`
  - order: `#FF5A5A → #FFB1B1`
  - alien: `#C77DFF → #E6B3FF`
- `avatar-dock__panel[data-territory]` 선택자 기반 게이지 자동 색상 전환

---

## 2026-06-26

### 영토 소속 배지 HUD 개선

- `avatar-territory-badge` 구조 확립
  - `span.avatar-territory-badge__icon` (영토 아이콘)
  - `span#avatar-meta-territory` (영토명)
  - `span.avatar-territory-badge__suffix` ("주민")
- `div.avatar-player-info-sub` 추가 (Lv + 명성 보조)
- `p#avatar-meta-summary` → `avatar-dock__sr-only` (JS 연산용, 화면 비표시)

---

## 2026-06-26 (이전)

### 영토 프로필 패널 플레이어 카드 리디자인 (commit: `3767bd2`)

#### Part 8 — 영토 소속 시각화
- `avatar-territory-badge` 도입 (`data-territory` 기반)
- 영토 전용 표시 (배지 > 레벨 > 명성 정보 흐름)

#### Part 7 — 프로필 탭 전환 애니메이션
- `.avatar-dock__tab` hide → `opacity: 0; visibility: hidden; transform: translateY(0.35rem)` 전환
- `display: none` 대신 transition 기반 (레이아웃 안정성)

#### Part 6 — 접기 버튼 위치 변경
- 헤더에서 제거 → 패널 하단 `div.avatar-panel-close-row`로 이동
- "당기듯 열고 밀어서 닫는" UX

#### Part 5 — 플레이어 카드 4:5 비율 + 명예 장식 분리
- 카드 비율: `3:4` → `4:5`
- 명예 장식 슬롯(프레임/칭호/휘장/오라)을 카드 영역에서 → 패널 하단 영역으로 분리
- 패널 폭: `34rem` → `48rem`
- 좌측 카드 폭: `8.5rem` → `18.5rem`

#### Part 4 — 2열 레이아웃 도입
- `avatar-panel-body`: 2열 grid (좌: 플레이어 카드, 우: 정보)
- `avatar-player-card` 신규 (영토 하단바 아이콘 구조 포함)
- `avatar-honor-slots` 명예 장식 슬롯 UI

#### Part 3 — 아바타 슬롯 HUD화
- "잠금 이미지" 아바타 변경, "업로드" → "편집"
- 미래형 프로필 HUD 형태의 슬롯
- 빈 이미지: SVG + "SLOT" 텍스트

---

## 2026-06 (중앙광장 레이아웃 개편, commit: `3767bd2`)

### 전체 중앙광장 레이아웃 개편

- 기존 순서: 데일리 이슈 → 인기글/실시간 현황/영토 현황(2열) → 게시글 → 사이드바
- 구 "보드 정보" 섹션을 게시글 탭에서 → 별도 보드 정보 섹션으로
- 하단 헤더 blur 고정 요소 제거

### 정보 카드 디자인 통일

- 데일리 이슈 / 인기글/실시간 현황 / 영토 현황 카드 공통 스타일 정착
- border-radius, border, padding, gap, 색상 통일
- 좌측 accent line 강조

### 시각 정보 계층화(Hierarchy) 정립

- 데일리 이슈(Primary): 굵은 accent line, background 5~8% 흐림, shadow 강화
- 인기글/실시간 현황/영토 현황(Secondary): 조금 작은 사이즈
- 게시글(Passive): 최소화

### 게시글 카드 레이아웃 최적화

- 카드 내부 padding 20~30% 축소
- 카드 간 margin 축소
- 반응 버튼 compact 구성 (사용자 참여 기반, 나머지 숫자 제거)
- 붙여넣기 버튼 카드에서 제거
- 하드 정보 한 줄 정리 (작성자 · 날짜 · 카테고리)
- 게시글 목록 1열 + 구분선

---

## 2026-06 (UI Kit 구축, commit: `3767bd2` 이전)

### 전체 UI Kit / 디자인 시스템 구축

- CSS 변수 시스템 전체 도입 (`--sc-sp-*`, `--sc-r-*`, `--sc-bc-*`, etc.)
- 버튼 Primary/Secondary 스타일
- 카드 공통 스타일
- 섹션 헤더 스타일
- 인풋 필드 스타일
- 배지(Badge), 태그(Tag) 공통 컴포넌트 이식
- 패널 공통 border/radius/background
- 입력창 스타일 통일
- Transition 속도 통일 (`--sc-ease`)

---

## 2026-05 이전 (기반 구축)

### 초기 기반 구축

- Express 서버 + Supabase 연동
- 영토 지도 (SVG 히트존, PNG 배경 배치)
- 게시판 시스템 (중앙광장/개척/수호/외계행성)
- 데일리 이슈 시스템
- 팔로우 시스템
- 레벨/XP/명성 config 정의
- 성향 시스템 config 정의
- 외계행성 추방/체류 UI
- 알림 데이터 구조
- 히스토리 탭
- 게시글 상세 화면
- OAuth 소셜 로그인 버튼 (Google, Apple, Kakao, Naver)
- 게스트 모드
