# 정치성향 — 상태 메모

상태 라벨을 섞지 않는다.

## BETA_V1_CONFIRMED (community / territory live, 2026-08-17)

community 경로 확정값. 전체 V1 완료가 아니다. Daily Issue는 아래 NOT_CONNECTED.

- 신규 회원 CENTRAL, alignment score 0
- Daily Issue seed 역할은 후보값만 확정. 실제 canonical 입력은 아래 BLOCKED
- actor self reaction + author received reaction (한 반응 → 최대 2 신호)
- 80/120 magnitude, LIKE=RECOMMEND, DISLIKE=DOWNVOTE
- CENTRAL gradual: deadzone abs(score)≤40 → 0, 그 외 min((abs-40)/160, 1), full at 200
- community daily cap ±240 (ACTOR_SELF + AUTHOR_RECEIVED, Asia/Seoul)
- pair 7d cap 120 (affected_user + counterparty, 절대 기여)
- 99d 50% + 30d 50% combinedSignal, rawDelta = combined - previousSignal
- batch ±500
- EXIT ±360, RETURN ±160
- 2 consecutive scheduled batches
- minimum stay 48h
- PIONEER↔GUARDIAN 직접 이동 없음 (반드시 CENTRAL 경유)
- Alien/Kantapbiya 제외
- EMPATHY/REPORT/글·댓글 작성 = 0
- 자기 글 자기 반응 alignment 0
- reaction-time territory + score snapshot (서버가 user_alignment_state에서 기록)
- `profiles.territory` membership SSOT, `board_posts.territory` = 게시판 위치
- persist `TERRITORY_MOVE = SERVER_INTERNAL_BATCH`
- `POLITICAL_BATCH_SCHEDULER = READY_DISABLED` (production scheduler 켜지 않음)

## SIMULATION_CANDIDATE (오프라인 시뮬레이터만)

파일 유지. live 값으로 승격하지 않음.

- `shared/political-alignment-gradual-sim-core.js`
- `tools/run-gradual-alignment-simulation.js`
- `tools/run-fast-alignment-simulation.js`
- `tools/test-gradual-alignment-simulation.js`

이 시뮬은 ACTOR_ONLY, 옛 EXIT ±1000/800/600, consistency/unique-author 등을 비교용으로만 둔다.

## NOT_CONNECTED / BLOCKED

- DAILY_ISSUE_CANONICAL_ALIGNMENT = NOT_CONNECTED = BLOCKED_BY_CONTENT_SCHEMA (published issue에 option/directAnswers 없음. 정치 질문 임의 생성 안 함)
- production scheduler enable
- direction consistency / MIN_DIRECTIONAL_EVENTS / unique author 4 / account trust / cluster scoring
- 옛 브라우저 3축 localStorage alignment SSOT 복원
- ALIEN alignment threshold 이동
- Guest Mock/local 흐름은 기존 유지 (canonical SSOT 아님)
