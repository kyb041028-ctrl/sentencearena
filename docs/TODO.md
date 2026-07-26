# 센텐스크래프트 — 작업 목록 (TODO)

> 마지막 업데이트: 2026-07-26 (성향 운영용 영토 판정 모듈)
>
> **새 AI 세션:** `docs/AI_HANDOFF.md` — 구조·완료·TODO·성향 시스템 요약
>
> **상태 구분:** ✅ 완료 · 🔜 진행중/다음 · ⏸️ 보류

---

## ✅ 정치 성향 운영용 영토 판정 모듈 (2026-07-26)

- [x] 운영용 영토 판정 순수 함수 (`political-orientation-territory-rules.js`)
- [x] pending 영토 상태 처리
- [x] 2회 연속 확인
- [x] 개척·수호 직접 이동 방지
- [x] 영토 판정 단위 테스트 (`__scRunPoliticalTerritoryRuleTests`)
- [ ] 실제 정치 성향 배치 연결
- [ ] 사용자 DB 필드 추가
- [ ] 실제 영토 변경 저장
- [ ] 영토 변경 알림
- [ ] 시민등급 재판정
- [ ] 업적 연결
- [ ] Firebase/API
- [ ] 베타 실데이터 재조정

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
