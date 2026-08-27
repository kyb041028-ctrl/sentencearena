# 레벨 · XP · 명성·등급 — 현재 로직 일람 (정확값)

다른 도구/AI와 **상의용**으로 그대로 붙여 쓰면 됩니다.  
**XP SSOT:** `shared/progression-xp-core.js`  
브라우저 Guest 호환: `public/player-progression.js` · 서버: `config/player-progression.js` (core 재export)

**명성 숫자 (ProfileFrame `#fameLayer`, 2026-08-15)**

- 실회원 SSOT: `user_progression.reputation_score` (API 필드 `fame`)
- 정책: 공감 1개 = +1 · 실제 제거 1회만 회수 · 신규 0 · **게시글/댓글 공감 earning ACTIVE**
- 공감 earning pipeline = **ACTIVE (canonical 게시글 only)** · 댓글 공감 DATA_NOT_CONNECTED
- 명성등급 threshold(시민/논객/…) = **미확정** · ProfileFrame 기본 rank 「참여자」
- 아래 3.4 리더보드 점수(`글♥+댓글♥×2+팔로워×5`)는 Guest/legacy local 공식 · 실회원 ProfileFrame 명성으로 쓰지 않음

**철학**

- **레벨** = 활동 경험(누적 total XP).
- **명성 등급** = 받은 반응·팔로 기반 **절대 기준 + 영토 인구 캡** (권력 계급·상대 순위 강등 아님).
- **성향 / 외계성**은 `alignment-scoring`·게시판 쪽과 역할 분리.
- **DELETE_XP_POLICY = PENDING** — 글 삭제 시 XP 회수 로직 없음(미확정).

---

## 1. 저장소

| 항목 | 값 |
|------|-----|
| 실회원 canonical | `user_progression.level` · `user_progression.xp` · **`user_progression.reputation_score`(fame)** |
| 이벤트 | `user_progression_events` · `apply_user_progression_event` RPC (service-role) |
| Guest localStorage | `sc_player_progression_v1` · 필드 `totalXp` 등 |

---

## 2. 레벨 상한 · XP (공식 Lv1~10)

| 이름 | 값 |
|------|-----|
| `MAX_LEVEL` | `10` |
| `MAX_TOTAL_XP` | `1500` (게이지 100% cap · Lv10 시작은 1100) |
| `LURK_UNLOCK_LEVEL` | `3` |
| `RANK_UNLOCK_LEVEL` | `4` |

### 2.1 XP 보상 (`XP_REWARDS`)

| 액션 | XP | 서버 연결 |
|------|-----|-----------|
| `POST_CREATED` / `post_write` | `25` | **ACTIVE** (canonical board post) |
| `BOARD_COMMENT_CREATED` / `board_comment` | `12` | **ACTIVE** (canonical board_comments) |
| `ISSUE_COMMENT_CREATED` / `issue_comment` | `10` | ACTIVE |

### 2.2 구간 XP (`XP_PER_LEVEL`)

`[40, 50, 60, 70, 80, 120, 160, 220, 300, 400]`

누적 경계: `[0, 40, 90, 150, 220, 300, 420, 580, 800, 1100, 1500]`

| Level | total XP 구간 | 비고 |
|-------|---------------|------|
| 1 | 0~39 | 탐색/튜토리얼 |
| 2 | 40~89 | |
| 3 | 90~149 | |
| 4 | 150~219 | |
| 5 | 220~299 | territory-citizen 해금 기준 |
| 6 | 300~419 | 커뮤니티 성장 |
| 7 | 420~579 | |
| 8 | 580~799 | |
| 9 | 800~1099 | |
| 10 | 1100+ | 게이지 1100~1500 · 1500+=100% |

---

## 3. 명성 등급 (`rankTier`, 0~4)

| tier | 한글 |
|------|------|
| 0 | (Lv&lt;4 미참여 또는 Lv4+ **논객 수치 미달** — UI: “참여 중” 등) |
| 1 | 시민 (레거시 데이터에만 남을 수 있음) |
| 2 | 논객 |
| 3 | 대표 |
| 4 | 지도자 |

### 3.1 해금

- `levelFromTotalXp(totalXp) >= RANK_UNLOCK_LEVEL` (**4**) 인 경우만 절대 기준·캡에 들어감. 미만이면 `rankTier` 계산상 **0**.

### 3.2 절대 기준 (`RANK_ABSOLUTE`) — **세 지표 동시** 충족

| 티어 | 글 ♥ | 댓글 ♥ | 팔로워 |
|------|------|--------|--------|
| 2 논객 | ≥3 | ≥2 | ≥2 |
| 3 대표 | ≥15 | ≥8 | ≥8 |
| 4 지도자 | ≥40 | ≥20 | ≥20 |

### 3.3 인구 캡 (`RANK_CAPS`)

| 규칙 | 값 |
|------|-----|
| `politicianMaxRatio` | `0.1` |
| `chiefsMaxCount` | `5` |

### 3.4 리더보드용 명성 점수

`글받은♥ + 댓글받은♥×2 + 팔로워×5`

---

## 4. 글·스레드당 반응 상한 (`PER_POST_REACTION_CAP`)

`getPerPostReactionCap(rankTier)` — `rankTier`를 **0~4**로 클램프.

| `rankTier` | 상한 |
|------------|------|
| 0 | `120` |
| 1 | `120` |
| 2 | `200` |
| 3 | `320` |
| 4 | `480` |

---

## 5. 조정 시 참고

| 바꾸고 싶은 것 | 위치 |
|----------------|------|
| XP·레벨 공식 | **`shared/progression-xp-core.js`만** |
| 명성 해금 시점 | `RANK_UNLOCK_LEVEL` |
| 논객/대표/지도자 난이도 | `RANK_ABSOLUTE` |

---

*코드와 숫자가 어긋나면 `shared/progression-xp-core.js`를 기준으로 이 문서를 갱신하세요.*
