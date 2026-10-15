# SentenceArena Agent 안전규칙

이 파일은 repo 루트의 Agent 진입 규칙이다. 작업 방식의 상세는 `docs/AGENT_SAFETY_RULES.md`에 있다.

이 규칙은 기능 구현 허가가 아니다. 요청받은 범위 안에서, 승인된 방식으로만 일한다.

## 정보 우선순위

현재 사실과 정책은 아래 순서로 판단한다.

1. 실제 Production/runtime과 최신 구현
2. `docs/SENTENCEARENA_STATE.md`
3. `docs/SENTENCEARENA_DECISIONS.md`의 ACTIVE 결정
4. 이 파일과 `docs/AGENT_SAFETY_RULES.md` (Agent 작업 방식)
5. `docs/SESSION_CLOSING_PROTOCOL.md`
6. 그 밖의 handoff, TODO, `AI_START_HERE.md`, `PROJECT_CONTEXT.md`, `.cursor/rules`

`STATE`/`DECISIONS`와 오래된 문서가 충돌하면 `STATE`/`DECISIONS`를 따른다. 오래된 TODO가 최신 COMPLETE를 이기지 못한다.

`docs/SENTENCEARENA_HISTORY_CONTEXT.md`는 역사·기획의도·결정 배경 참고문서다. `STATE`와 ACTIVE `DECISIONS`보다 우선하지 않으며, 오래된 proposal을 현재 canon으로 부활시키는 근거로 사용하지 않는다.

ACTIVE 결정과 충돌하는 폐기 구조를 부활시키지 않는다. 여기에는 다음이 포함된다.

- `reform` / `order`를 영토 canonical key로 쓰는 구조
- `planetPct` Alien 인구 모델
- 정치성향을 Alien, 추방, 제재 이유로 쓰는 구조
- `KANTAPBIYA_LEFT` / `KANTAPBIYA_RIGHT`, 신호구역 정치 모델
- 가입 시 영토 선택
- 신고 횟수 = 위반, 또는 신고 횟수만으로 자동 제재/추방

영토 key는 `pioneer` / `central` / `guardian` / `alien`이다 (DEC-008). Alien은 행동 moderation이다 (DEC-007). 정치성향과 moderation은 분리한다 (DEC-005).

`.cursor/rules/sentencearena.mdc`는 alwaysApply이다. `reform` / `order` 예시, 개혁/질서/중도 표현, 신고 30회 추방, JS 전면 수정 금지, `TODO.md` 필수 갱신, handoff/`TODO` 우선 독서는 그 파일에서 제거된 상태다. UI Kit 클래스명, HTML `id` 유지, 결과 보고 형식(`.cursor/rules/copy-paste-reports.mdc`)은 유효하다.

## 승인 단계 — 모든 작업의 선행 조건

최상위 원칙: **사용자의 명시적 승인 없이 되돌리기 어렵거나 외부 상태를 바꾸는 행동을 하지 않는다.**

- "조사해", "확인해", "검토해", "의견 줘", "분석해"는 기본 READ-ONLY다. 파일, Git 상태, 외부 웹서비스 상태를 변경하지 않는다.
- 파일 변경은 "수정해", "구현해", "만들어"처럼 사용자가 명시적으로 변경을 요청한 범위에서만 가능하다. 기능 작업은 `master`가 아닌 별도 branch/worktree에서 한다.
- 수정 승인 ≠ commit 승인 ≠ push 승인 ≠ merge/master 반영 승인 ≠ Production 배포 승인이다. 각 단계는 독립이며, commit·push·merge/master 반영은 사용자가 그 세션에서 각각 별도로 명시 승인해야 한다. 자동으로 이어서 실행하지 않는다.
- GitHub, Supabase, NAVER Cloud 등은 조회/열람만 가능하며, 생성·저장·수정·삭제·실행·시작·정지·재시작·배포 등 상태 변경 조작은 별도 승인 전 금지다.
- Production deploy/rollback/restart, DB migration/apply/seed/purge/destructive SQL, NAVER Cloud 서버 시작/정지/반납, 유료 리소스 생성/변경, 플랜/용량/리전 변경, package 설치/업그레이드, `.env`/secret/credential 수정·회전은 **각 실행 직전 별도 명시 승인**을 받는다. 요청 전에 변경 대상, 영향 범위, 원복 가능 여부와 방법, 예상 비용(불명이면 비용 불명)을 보고한다.
- 범위 밖 문제는 자동 수정하지 않고 보고만 한 뒤 별도 승인을 기다린다.
- 기존 파일·이미지·그래픽·설정을 후보로 덮어쓰지 않는다. 비교 가능한 candidate/new-version 방식을 유지한다.
- 애매하면 실행하지 말고 사용자에게 묻는다. 되돌리기 어렵거나 비용/운영 영향이 있는 행동은 항상 보수적으로 판단한다.

아래 작업 규칙이나 세션 종료 절차는 위 독립 승인 단계를 생략하는 허가가 아니다.

## 1. 기본 작업모드: 후보 제작

기존 구현을 즉시 덮어쓰지 않는다. 가능하면 별도 branch, worktree, 또는 candidate 파일/디렉터리에서 만든다. 사용자가 그 후보를 승인하기 전에 기존 버전을 교체하지 않는다.

## 2. 작업 범위 잠금

요청받은 기능과 파일 범위 밖은 수정하지 않는다. 다른 시스템 수정이 필요해 보여도 범위를 자동으로 넓히지 않는다. 필요성, 영향, 예상 비용을 보고하고 승인을 기다린다.

## 3. 기존 시스템 보호

아래는 그 시스템을 명시적으로 요청받은 작업이 아니면 수정하지 않는다.

- 인증
- Supabase / DB
- 정치성향
- Alien moderation
- 신고 / 제재
- Daily Issue
- retention / legal_hold
- progression
- 기존 API 계약
- 기존 HTML `id`
- `public/auth.js`

## 4. 그래픽 보호

기존 이미지, 아이콘, 디자인 원본을 자동으로 덮어쓰지 않는다. 새 시안은 candidate 또는 new-version 이름으로 따로 만든다. 사용자 승인 후에만 실제 화면에 적용한다. 기존 화면/자산과 비교할 수 있게 둔다.

## 5. Git 안전

금지:

- `master`에서 직접 기능 개발
- `master` 직접 push
- force push
- `git reset --hard`
- `git clean`
- `git add .`
- `git add -A`
- 요청과 무관한 파일 삭제 또는 restore
- 사용자가 작업 중인 modified/untracked 자동 정리

기능 작업은 별도 branch 또는 worktree에서 한다. merge는 사용자 승인 전 금지다. 변경 전에 복구 가능한 기준점(현재 `master` tip)을 유지한다.

문서만 추가하라는 이번 종류의 명시 지시가 현재 작업트리에서 파일을 만들라고 한 경우는, 그 지시에 한한다. 그 경우에도 commit과 push는 별도 승인 전 금지다.

## 6. DB / Production / 비용

승인 없이 실행하지 않는다.

- Production deploy
- Production DB migration / apply
- destructive SQL
- 서버 시작, 정지, 반납
- 유료 cloud resource 생성 또는 변경
- 요금이 생길 수 있는 서비스/플랜 변경
- secret / credential 회전

필요하면 예상 영향과 비용을 먼저 보고하고 기다린다. 로컬 `/ready`가 실패해도 migration을 적용하지 않는다.

## 7. Reviewer

Reviewer는 문제를 발견해도 직접 고치지 않는다. 문제, 회귀, 범위 초과만 보고한다. 수정은 Builder의 별도 작업으로 넘긴다.

## 8. 역할

- Lead/Coordinator: 범위 관리, SSOT 확인
- Explorer: 조사 전용. 기본은 수정 금지
- Builder: 승인된 범위에서 구현
- Reviewer/Tester: 독립 검증. 직접 수정 금지
- Visual/Browser: 화면과 그래픽 검증

작은 작업에 모든 역할을 강제로 쓰지 않는다.

## 9. 세션 종료

`docs/SESSION_CLOSING_PROTOCOL.md`를 따른다. 정책이 바뀌지 않았으면 `DECISIONS`를 수정하지 않는다. Production 검증이 없으면 COMPLETE로 기록하지 않는다.

프로토콜의 commit과 `origin/master` push 단계는, 그 세션에서 사용자가 그 commit/push를 명시적으로 승인하기 전에는 실행하지 않는다. 이 파일은 push 허가가 아니다.

## 10. 특별 보호

political alignment simulation 관련 로컬/미추적 작업물은 명시적 승인 없이 stage, commit, delete, restore, overwrite 하지 않는다. 알려진 경로와 판별은 `docs/AGENT_SAFETY_RULES.md`를 본다.
