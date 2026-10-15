# SentenceArena Agent 안전규칙 (상세)

진입 요약: 루트 `AGENTS.md`  
현재 사실: `docs/SENTENCEARENA_STATE.md`  
ACTIVE 정책: `docs/SENTENCEARENA_DECISIONS.md`  
세션 종료: `docs/SESSION_CLOSING_PROTOCOL.md`

이 문서는 Agent가 기존 시스템을 임의로 갈아엎지 못하게 하는 작업 규칙이다. 제품 정책을 바꾸지 않는다. `DECISIONS`의 ACTIVE 항목을 이 파일로 대체하지 않는다.

## SSOT와 폐기 구조

판단 순서는 `AGENTS.md`의 정보 우선순위와 같다.

오래된 문서(`AI_START_HERE.md`, `AI_HANDOFF.md`, `PROJECT_CONTEXT.md`, `TODO.md`, 과거 CHANGELOG 설명)가 `STATE`/`DECISIONS`와 다르면 오래된 쪽을 따르지 않는다. 코드를 오래된 문서에 맞추려고 되돌리지 않는다. 차이가 있으면 사실만 보고하고, `STATE` 수정은 그 세션의 실제 완료 범위일 때만 한다.

부활 금지 (SUPERSEDED 및 충돌 규칙):

- SUP-012: `reform` / `order` canonical 영토명. 현재 key는 DEC-008의 `pioneer` / `central` / `guardian` / `alien`
- SUP-013: `planetPct` Alien 모델
- SUP-009, SUP-010, SUP-011, SUP-014, SUP-015: 정치성향 = moderation, 정치성향에 따른 Alien 추방, 좌우 Alien 분리, `KANTAPBIYA_LEFT` / `KANTAPBIYA_RIGHT`, 신호구역 정치 모델
- SUP-001: 가입 중 영토 선택. 신규 회원은 CENTRAL / score 0 (DEC-002)
- DEC-015와 충돌하는 "신고 N회면 자동 추방/제재"

`DECISIONS` 안에서 문장이 서로 다르면 ACTIVE 결정과 `STATE`의 Production 사실이 이긴다. 예: SUP-016의 "Alien V1 currently OFF" 노트는 DEC-019와 `STATE`의 Production ON을 이기지 못한다. 이 충돌을 고치려고 이번 안전규칙 작업에서 `DECISIONS`를 수정하지 않는다.

### 기존 Cursor 규칙

현재 `master` 작업트리의 `.cursor/rules`에는 다음만 있다.

- `sentencearena.mdc` (alwaysApply)
- `copy-paste-reports.mdc` (alwaysApply)

`sentence-craft.mdc`는 이 작업트리에 없다.

`sentencearena.mdc`에서 계속 유효한 것:

- UI 작업 시 기존 `sc-*` 클래스와 CSS 변수 우선
- 기존 HTML `id` 유지. 기존 `class` 제거 전 확인
- 결과 보고는 `copy-paste-reports.mdc` 형식

`sentencearena.mdc`에서 SSOT와 충돌해 무효인 것:

- 새 세션 필독을 `AI_HANDOFF.md` / `PROJECT_CONTEXT.md` / `TODO.md`로 두는 조항. 필독은 `STATE`, 관련 ACTIVE `DECISIONS`, `SESSION_CLOSING_PROTOCOL`, 이 파일이다. `CHANGELOG`는 이력 확인용이다.
- `dataset.territory = 'reform'` 예시
- 개혁/질서/중도 표현과 "비호감·신고 30회 초과 시 추방"
- 기존 JS를 일절 수정하지 않고 UI는 `public/index.html`의 `<style>`만 수정한다는 전면 금지. 승인된 범위의 서버/공유 모듈 수정까지 막지 않는다. 반대로, 승인되지 않은 핵심 시스템 수정은 이 안전규칙이 금지한다.
- 작업마다 `TODO.md`를 반드시 갱신한다는 조항. `TODO.md`는 `STATE`를 대체하지 않는다.

`reform` / `order`, 신고 30회 자동추방 등 위 충돌 조항은 `.cursor/rules/sentencearena.mdc`에서 이미 제거되었다. `AGENTS.md`도 그 현재 상태에 맞게 정정되어 있다.

## 1. 후보 제작

기본 모드다.

- 기존 파일의 동작을 그 자리에서 바로 교체하지 않는다.
- 기능 후보는 `master`가 아닌 branch 또는 worktree에 둔다. 브랜치 이름은 `candidate/<주제>`처럼 기존 브랜치와 구분되게 짓는다.
- 파일 후보가 필요하면 `candidate/` 아래, 또는 기존 파일을 대체하지 않는 `*.candidate.*` / `*-new-version.*` 이름으로 만든다.
- 후보를 런타임 경로, import, 라우트, 정적 자산 경로에 연결하는 것은 "기존 버전 교체"다. 사용자 승인 전에 하지 않는다.
- 승인 전에는 기존 파일을 삭제하지 않는다.
- 후보와 기존 결과를 나란히 비교할 수 있어야 한다.

예외는 사용자가 그 세션에서 "이 파일을 직접 수정하라"고 범위와 파일을 특정한 경우뿐이다. 그 경우에도 아래 보호 시스템, Git 금지, DB/Production 금지는 유지된다.

## 2. 범위 잠금

- 시작 전에 요청 기능, 허용 파일/디렉터리, 하지 않을 일을 적는다.
- 허용 목록 밖 파일은 읽기만 한다. 수정이 필요해 보이면 이유와 영향만 보고하고 멈춘다.
- 리팩터, 포맷 전체 적용, 의존성 업그레이드, 근처 버그 수정, 문서 대량 정리를 끼워 넣지 않는다.
- Explorer가 찾은 문제를 Builder가 같은 턴에 알아서 고치지 않는다. Lead가 범위를 확인하고, 사용 승인이 있으면 Builder 작업으로 분리한다.

## 3. 보호 시스템

요청이 그 시스템의 변경을 파일 단위로 승인하지 않았으면 수정하지 않는다. 조사와 설명은 가능하다.

- 인증: 로그인, 세션, OAuth, `public/auth.js`, 가입/연령/활동명 게이트
- Supabase / DB: 스키마, migration, RLS, RPC, service role 사용처, `.env`
- 정치성향: 점수, 스케줄러, 동의, 영토 이동 규칙
- Alien moderation: 판정, 격리, 복귀, `ALIEN_MODERATION_V1`
- 신고 / 제재: 신고 처리, 제재, 관리자 숨김/복구, audit
- Daily Issue: 수집, 발행, 공개 API, morning scheduler, auto-publish
- retention / legal_hold: 보존, purge, OWNER 전용 hold
- progression: `user_progression`, XP, Fame, 업적
- 기존 API 계약: 경로, 상태 코드, 응답 필드, 인증 요구
- 기존 HTML `id`

보호 시스템을 읽다가 문제를 발견해도, 그 수정은 새 승인 범위다.

## 4. 그래픽 보호

- `public/` 및 자산 디렉터리의 기존 이미지, 아이콘, SVG, 스프라이트, 디자인 원본을 같은 경로에 덮어쓰지 않는다.
- 새 시안 파일명에 `candidate` 또는 `new-version`을 넣는다. 예: `candidate/icons/foo-new-version.png`
- 기존 파일과 새 파일을 둘 다 남겨 비교할 수 있게 한다.
- CSS로 기존 화면의 레이아웃, 색, 타이포를 승인 없이 갈아엎지 않는다. 화면 후보는 별도 경로이거나, 승인된 파일 안의 비교 가능한 초안이어야 한다.
- 사용자 승인 후에만 기존 경로 교체 또는 참조 교체를 한다. 교체 후에도 이전 파일은 승인 없이 삭제하지 않는다.

## 5. Git

기능 개발, 그래픽 교체, 보호 시스템 수정은 `master`에서 하지 않는다. `master`는 복구 기준점이다.

작업 전:

- `git status`, 현재 branch, HEAD, `origin/master` tip을 확인한다.
- 사용자 modified/untracked가 있으면 그 목록을 보고만 하고 치우지 않는다.
- 후보 branch/worktree는 그 시점의 `origin/master`에서 만든다. `master`를 이동시키지 않는다.

금지 명령과 동등한 동작:

- `master` 직접 push. `git push origin master` 포함
- force push (`--force`, `--force-with-lease` 포함)
- `git reset --hard`
- `git clean` (`-fd`, `-fdx` 포함)
- `git add .`
- `git add -A`
- 범위 밖 파일의 `git checkout --`, `git restore`, `git rm`
- 훅 건너뛰기(`--no-verify`)와 사용자 지시가 없는 amend

stage는 승인된 경로만 파일 단위로 한다. commit과 push는 그 세션에서 사용자가 명시적으로 시킨 뒤에만 한다. merge는 승인 전 금지다.

## 6. DB / Production / 비용

다음을 승인 없이 실행하지 않는다.

- Production deploy, 재시작, 롤백, 호스트 env 변경
- Production 또는 공유 DB에 migration/apply, seed, purge, destructive SQL (`DROP`, `TRUNCATE`, 무제한 `DELETE`/`UPDATE` 포함)
- 로컬이든 원격이든 서버 프로세스 시작, 정지, 인스턴스 반납
- 유료 cloud 자원 생성/변경, 플랜/용량/리전 변경
- secret, credential, 키 회전, `.env` 수정, 비밀값 출력

로컬 서버가 이미 떠 있는 것을 승인 없이 죽이지 않는다. `/health` 실패나 `/ready`의 `DATABASE_UNAVAILABLE`을 이유로 migration이나 Production 조치를 하지 않는다.

승인 요청에는 대상, 예상 데이터 영향, 되돌릴 수 있는지, 요금이 생길 수 있는지를 적는다. 비용을 모르면 모른다고 적고 실행하지 않는다.

## 7. Reviewer / Tester

- 검증 대상과 범위를 승인된 변경으로 제한한다.
- 실패, 회귀, 범위 밖 변경, SSOT 충돌을 보고한다.
- 고치지 않는다. 패치, 리팩터, "돌아가는 김에" 수정은 Builder의 다음 승인 작업이다.
- Production COMPLETE, 정책 변경, `DECISIONS` 수정을 검증 보고에 섞지 않는다.

## 8. 역할 운영

작은 조사나 오타처럼 범위가 한 곳인 작업은 Lead가 직접 하거나 Explorer 하나만 써도 된다. 다섯 역할을 항상 켜지 않는다.

역할을 나눌 때의 기본:

- Lead/Coordinator: SSOT와 허용 범위를 고정하고, 범위 확대 요청을 사용자에게 올린다.
- Explorer: 검색과 설명만. 파일을 쓰지 않는다.
- Builder: 승인된 branch/worktree 또는 candidate 경로에서만 구현한다.
- Reviewer/Tester: Builder와 따로 검증한다.
- Visual/Browser: 화면과 그래픽 후보를 기존 화면과 비교한다. 자산 원본을 교체하지 않는다.

## 9. 세션 종료

`docs/SESSION_CLOSING_PROTOCOL.md`의 확인 순서를 따른다. 추가 제한:

- 정책이 바뀌지 않았으면 `DECISIONS`를 수정하지 않는다.
- Production에서 확인하지 못한 항목을 `STATE`나 `CHANGELOG`에 Production COMPLETE로 쓰지 않는다.
- 이번 세션에 제품 동작 변화가 없으면 `STATE`의 HEAD나 COMPLETE 목록을 맞추려고 수정하지 않는다.
- 의미 있는 문서/코드 변경의 CHANGELOG 기록은, 사용자가 그 변경의 commit을 승인한 세션에서 한다. 승인 전 세션에서는 CHANGELOG를 미리 고치지 않아도 된다.
- 프로토콜 11–13의 commit, `origin/master` push, 동기화 확인은 사용자가 그 행위를 명시적으로 승인한 뒤에만 한다. "프로토콜을 따르라"는 문장만으로 push 하지 않는다.
- unrelated modified/untracked는 프로토콜과 같이 자동 처리하지 않는다.
- 커밋할 내용이 없으면 빈 commit을 만들지 않는다. `STATE` HEAD만 맞추는 pointer commit을 반복하지 않는다.

## 10. Political alignment simulation 특별 보호

정치성향 시뮬레이션의 로컬 또는 미추적 작업물은 명시적 사용자 승인 없이 stage, commit, delete, restore, overwrite 하지 않는다.

이름에 다음이 들어가는 파일은 이 보호에 포함한다.

- `alignment-simulation`
- `alignment-sim`
- `political-alignment-gradual-sim`
- `run-fast-alignment-simulation`
- `run-gradual-alignment-simulation`
- `run-selfcap-alignment-simulation`

저장소에 이미 있는 관련 문서/도구를 승인 없이 지우거나 덮어쓰지 않는다. 작업트리에 같은 주제의 modified/untracked가 있으면 목록만 보고하고 손대지 않는다. 이 보호는 정치성향 Production 스케줄러(DEC-019)를 끄거나 켜는 허가가 아니다.

## 이 규칙의 한계

이 문서는 기능 코드, UI, 그래픽 원본, DB, Production, `.env`를 변경하지 않는다. `.cursor/rules/sentencearena.mdc`의 충돌 조항은 이미 제거된 상태다.
