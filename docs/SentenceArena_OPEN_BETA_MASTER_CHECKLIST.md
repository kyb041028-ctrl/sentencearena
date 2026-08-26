# SentenceArena 오픈베타 마스터 체크리스트

> 마지막 업데이트: 2026-08-26 (업적 Production 연결 보완)

## Level / XP

- 상태: Production PASS (목표)
- 게시글 +25 / 댓글 +12 / Daily Issue +10
- Level 1~10 · `user_progression` + events dedupe
- 외계 내부 활동: 일반 XP 지급 금지

## Fame

- 상태: 코드/RPC PASS · 실이벤트는 오픈 후 관찰
- EMPATHY 수신 +1 · 자기공감/중복 방지
- 취소 회수: PENDING
- 외계 내부 Fame: 지급 금지

## Activity

- Profile COUNT (posts/comments/receivedLikes/discussions): PASS
- 월드 Activity HUD localStorage: 별도 (이번 범위 아님)

## 업적 (핵심 6)

- first-post / first-comment / first-empathy-received / territory-citizen / record-builder / conversation-bridge
- record-builder · conversation-bridge: 영구 1회 (시즌 전 임시)
- Production: service_role SELECT + mark_user_achievement_notified 복구

## 베타 이후

- steady-footsteps
- empathy-from-many
- dialogue-across-territories
- witness-of-an-era

## beta-citizen

- 정책 확정: 오픈베타 기간 첫 실제 참여 1회 (글/댓글/Daily Issue 댓글)
- 로그인·가입·LIKE/DISLIKE/EMPATHY·열람만으로는 지급 금지
- 시작/종료 시각 미확정 → 코드 하드코딩 금지 · 지급 BLOCKED(미활성)

## 환경

- ALIEN_MODERATION_V1=false
- POLITICAL_ALIGNMENT_SCHEDULER_ENABLED=false
- DAILY_ISSUE_MORNING_SCHEDULER_ENABLED=false
- BOARD_OPERATIONAL=true
