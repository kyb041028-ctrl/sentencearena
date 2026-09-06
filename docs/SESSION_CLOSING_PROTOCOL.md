# SentenceArena Session Closing Protocol

모든 개발 세션 종료 시 반드시:

1. `docs/SENTENCEARENA_STATE.md` 읽기
2. 관련 ACTIVE `docs/SENTENCEARENA_DECISIONS.md` 읽기
3. `docs/CHANGELOG.md` 확인
4. `git status` / `diff` / `log` / `origin/master` 확인
5. 이번 세션에서 실제 완료된 결과를 STATE에 반영
6. 완료된 기존 TODO/PENDING 제거
7. 새로 발견한 한계/보류는 Deferred에 기록
8. 정책이 바뀐 경우에만 DECISIONS 수정
9. 의미 있는 작업 이력은 CHANGELOG에 기록
10. 관련 파일만 명시적으로 stage
11. 필요한 commit 수행
12. origin/master push 확인
13. local master와 origin/master 동기화 확인
14. unrelated modified/untracked 파일은 절대 임의 처리하지 않음
15. 최종 완료보고에 COMPLETE / PENDING / 다음 작업을 구분

## 금지

- `git add .`
- `git add -A`
- `git reset --hard`
- `git clean`
- unrelated 파일 삭제
- 사용자가 작업 중인 modified/untracked 파일 자동정리
- Production 미검증 상태를 Production COMPLETE로 기록
- 정책 변경 없이 DECISIONS 임의 수정
- 오래된 TODO를 최신 COMPLETE보다 우선
- 커밋할 것이 없는데 빈 commit 생성
- STATE HEAD 맞추려고 pointer-only commit을 끝없이 반복

## Special protection

political alignment simulation 관련 modified/untracked 파일은
별도 사용자 지시 없이는 stage / commit / delete / restore 하지 않는다.

## Roles

- STATE = 현재 사실 SSOT
- DECISIONS = ACTIVE 정책만
- CHANGELOG = 작업 이력
- 이 프로토콜 = 세션 종료 체크리스트
