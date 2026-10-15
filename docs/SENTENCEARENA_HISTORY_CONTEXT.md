# SentenceArena Codex 통합 인수인계 컨텍스트 v2
작성 기준일: 2026-10-15
검수 기준점: GitHub `master` = `f10bee75e1924c9f3a5720d72ec92a866fb40089` (2026-10-15 Codex 전환 직전 기준점)
용도: Codex가 SentenceArena의 기획 의도, 역사, 확정 결정, 구현 상태, 보류/폐기 사항, 운영 맥락을 한 번에 이해하기 위한 참고 문서

이 v2는 다음 자료를 교차 검수해 보완했다.
- 개발 #1~#4 통합 기준선 `SentenceArena_MASTER_CONTEXT_2026-08-13.md`
- 2026-08-19~09-06 개발 #6/#7에서 이어진 Production/운영 작업 맥락
- GitHub `master`의 `STATE`, `DECISIONS`, `CHANGELOG`, `AGENTS.md`, `AGENT_SAFETY_RULES.md`
- 2026-10-14~15 NAVER Cloud 비용/정지, 새 PC 복구, Cursor→Codex 전환 및 Agent 안전규칙
- 고정 스레드의 상표 모니터링/운영 맥락

주의: 과거 채팅은 역사 자료다. 어떤 과거 수치·prototype·후보값도 최신 코드/ACTIVE DECISIONS보다 우선하지 않는다.

> 중요 우선순위
>
> 이 문서는 역사와 의도 참고용이다.
> 현재 사실과 정책 판단은 다음 순서를 우선한다.
> 1. 실제 현재 Production/runtime 및 최신 구현
> 2. `docs/SENTENCEARENA_STATE.md`
> 3. `docs/SENTENCEARENA_DECISIONS.md` ACTIVE
> 4. `AGENTS.md`
> 5. `docs/AGENT_SAFETY_RULES.md`
> 6. `docs/SESSION_CLOSING_PROTOCOL.md`
> 7. 이 문서
> 8. 오래된 handoff/TODO/AI_START_HERE/과거 채팅
>
> 이 문서와 STATE/ACTIVE DECISIONS가 충돌하면 STATE/ACTIVE DECISIONS가 이긴다.
또한 이 문서 안의 `현재`라는 표현도 작성 기준일(2026-10-15)의 snapshot이다. 이후 Git/Production이 바뀌면 최신 사실을 다시 확인한다.

---

# 1. 프로젝트의 정체성

SentenceArena는 단순 정치 게시판이 아니라 세계관과 게임 메커니즘을 얹은 커뮤니티 플랫폼이다.

핵심 경험:
**Voice → Opinion → People → Society → World**

반복해서 유지된 철학:
- 정치적 성향 자체를 제재하지 않는다.
- moderation은 행동을 본다.
- 의견 차이와 유해행동을 분리한다.
- 신고 건수 자체를 위반 횟수로 보지 않는다.
- Alien은 정치적 수용소가 아니라 행동 moderation/관측/격리 공간이다.
- 딱딱한 정치 서비스보다 게임 로비와 세계관을 가진 커뮤니티 경험을 지향한다.
- 사용자의 활동이 개인, 영토, 사회, 세계의 변화로 이어져 보이게 한다.

커뮤니티 UX 참고 방향:
- 디시인사이드: 빠른 글쓰기와 실시간성
- FM코리아: 화제글과 보상 루프
- 클리앙: 활동 이력
- 루리웹: 공간/주제 분리

배제한 요소:
- 완전 익명 중심 구조
- 추천 하나가 모든 가치를 지배하는 구조
- 네임드 권력화
- 진영 다수의 힘만으로 상대 의견을 제재하는 구조
- 정치성향과 moderation의 결합
- 신고 수 자체를 죄의 크기로 취급하는 구조

---

# 2. 브랜드와 이름

초기 프로젝트명은 `SentensCraft / 센텐스크래프트` 계열이었다.
중간에 `SentenceCraft`와 혼동이 있었지만 이후 서비스 브랜드를 최종적으로 `SentenceArena / 센텐스아레나`로 전환했다.

현재 기준:
- 영문: SentenceArena
- 한글: 센텐스아레나

과거 SentensCraft/SentenceCraft/센텐스크래프트는 역사적 이름으로만 본다.

기록된 계정:
- Gmail / YouTube / TikTok / X: `sentencearena`
- Instagram / Threads: `sentence_arena`

상표:
- SentenceArena 출원 모니터링 별도 진행
- 기록된 출원번호 `40-2026-0166850`
- 과거 검토 핵심 분류: 41류 게임/오락, 42류 SaaS, 45류 온라인 소셜 네트워킹
- 상표 상태는 제품 코드 기능 결정과 분리

---

# 3. 세계관과 영토 구조

과거에는 개혁/질서/중앙, KANTAPBIYA, 좌우 정치축 등 여러 실험이 있었다.

현재 canonical key:
- `pioneer`
- `central`
- `guardian`
- `alien`

현재 한글:
- 개척영토
- 중앙광장
- 수호영토
- 외계행성

다시 쓰면 안 되는 과거 구조:
- `reform` / `order` canonical key
- `planetPct`
- 외계인 %
- `KANTAPBIYA_LEFT` / `KANTAPBIYA_RIGHT`
- 신호구역
- 정치성향 기반 유배
- 외계행성 좌우 분리
- 성향 해금
- 가입 시 영토 선택

현재 신규 회원:
- CENTRAL 시작
- 정치 score 0
- 가입 시 영토 선택 없음

## 3-1. 게시판 단계/운영실의 역사적 맥락

과거 영토 게시판은 단계형 접근 구조를 논의했다.
- 1단계: 공개/관찰 중심. 타 영토 열람 및 제한 참여 아이디어가 있었음.
- 2단계: 성향이 더 뚜렷한 시민의 깊은 대화 공간으로 논의. 과거 40%/60% 같은 수치는 임시값이었음.
- 3단계: 지도자 + 보조 운영진 3~4명 정도의 운영실로 거의 확정된 시기가 있었음.
- 4단계: 존재 이유가 약해 삭제 후보로 논의됐고 최종 ACTIVE 정책으로 고정되지 않음.
- 외계 관측은 중앙 전체 + 개척/수호 Stage 1 읽기 전용 방향으로 후반 구현됐고 Stage 2+는 제한.

중요:
- 이 단계 접근 구조는 현재 ACTIVE DECISION의 핵심 항목으로 모두 확정된 것이 아니다.
- 3/4단계나 과거 % 기준을 Codex가 자동 복원하면 안 된다.
- 기능을 다시 만질 때 현재 구현과 최신 정책을 먼저 조사한다.

---

# 4. 정치성향과 moderation

가장 중요한 핵심 결정이다.

정치성향은 의견/반응 신호를 이용해 moderation과 별도로 계산한다.

장기간 유지된 설계 기반:
- 최근 99일 50% + 최근 30일 50%
- Asia/Seoul 05:00 / 17:00 배치
- 반응 관계에 따른 가중치
- Daily Issue의 명시적 반응/선택을 seed로 사용할 수 있음
- 정치적 의견 자체는 sanction 이유가 아님
- 정치성향은 Alien 판정 기준이 아님
- 민감정보 별도 동의가 기본 OFF
- 동의 철회 시 alignment state/history 삭제
- 공개 API에 hidden alignment vector 노출 금지

초기/중간 기준값의 역사:
- 동일영토 긍정 80
- 타영토 긍정 120
- 동일영토 부정 120
- 타영토 부정 80
- batch cap ±500
이 값들은 중요한 설계 이력이지만, 이후 구현이 더 세분화됐으므로 숫자만 보고 현재 live 규칙으로 되살리지 않는다.

2026-08-28 전후 실제 구현 이력:
- 반응 관계 SSOT 값 70/100/130 기반
- actor-self 쪽은 관계값의 25%
- actor cap ±60
- 전체 community cap ±240
- actor-author pair 7일 cap 120
- 99일/30일 구조 유지
- 이동 임계가 당시 EXIT ±360 / RETURN ±160
- 2회 연속 조건, 48시간 stay 조건
- CENTRAL 자기행동 경로 버그 수정/배포 이력 있음

이 후반 수치 역시 향후 튜닝될 수 있는 구현 이력이다.
**Codex가 정치성향 로직을 수정하려면 반드시 최신 코드와 관련 테스트를 먼저 읽고 현재 수치를 확정해야 한다.**

과거 “Daily Issue가 자동으로 정치성향을 임의 변경한다”는 단순 연동은 폐기됐다.
Daily Issue 공개 UX와 hidden political processing을 섞지 않는다.

---

# 5. Alien

Alien은 정치적으로 다른 사람을 내쫓는 공간이 아니다.

현재 원칙:
- 행동 moderation / observation / isolation
- 정치성향과 분리
- 신고만 많이 받았다고 자동 이동하지 않음
- 운영자 판단과 행동 신호 필요
- Alien 진입 파밍 행동을 보상하지 않음
- Earth 상호작용 제한과 복귀 규칙 존재

폐기:
- 정치적 유배
- 좌/우 Alien
- alignment 기반 자동 Alien
- 신고 N회 = 추방

과거 후속 디자인 아이디어:
- 견습 → 일반 → 선임 → 수석 → 최고 분석가
- 주간 인기인/히스토리
- Alien 내부 성장
- 단계별 귀환/체류

이들은 현재 Production 완료 범위와 혼동하지 않는다.

현재 Deferred:
- operator_hold
- 잘못된 조치 cancel/rollback
- 시즌 연동 복귀
- multi-instance atomic lock
- Alien 내부 커뮤니티 확장

2026-08-26 운영 연결에서 확인된 구체 이력:
- Alien 사용자는 Earth 글/댓글/반응/EMPATHY/수정이 서버에서 제한됨.
- 본인 삭제, 신고, 권리침해 같은 안전/권리 경로는 Alien이라는 이유만으로 막지 않음.
- 관측은 CENTRAL 전체 + PIONEER/GUARDIAN Stage 1 읽기 전용, Stage 2+ 제한.
- Daily Issue 읽기는 허용하되 댓글/반응은 제한.
- 체류 이력은 1회 7일, 2회 15일, 3회 30일, 4회 이상 30일 + OPERATOR_REVIEW 방향으로 정리됨.
- 1~3회는 만료 후 lazy auto-return, 4회 이상/영구정지는 자동복귀 금지.
- `SEASON_END` 자동복귀는 실제 시즌 시스템이 없어 사용하지 않는 방향으로 정리됨.
- ALIEN_TRANSFER 이의 인정 시 Earth 복귀 가능하나 별도 계정 제재를 자동 해제하지 않음.
- 사용자 단위 lock + alreadyAlien short-circuit 이력이 있음.

현재 DEC-D09가 시즌 규칙을 미정으로 두므로, 과거 4회차 `SEASON_END` 아이디어를 부활시키지 않는다.

---

# 6. 신고 / 제재 / moderation

현재 canonical:
- 신고 수 ≠ 위반 수
- 같은 행동에 신고 여러 건이 들어와도 그 자체로 여러 번 위반 처리하지 않는다.
- 운영자 review 결과가 확정 위반을 결정한다.
- 신고자에게 상대의 구체 제재, Alien 이동, 운영자 신원, 다른 신고자, 내부 note를 공개하지 않는다.
- 일반 사용자 응답에 내부 UUID를 노출하지 않는다.

발전 과정:
- 신고 응답 내부 user id 제거
- 신고 review와 Alien 분리
- 행동 단위 위반 카운트
- sanction ladder
- 이의신청
- 동일 행동 중복 수동 제재 방지
- 관리자 role을 `app_metadata.role` only로 정리
- admin API 401/403 통일
- report→audit linkage
- report rejection audit
- reporter notification

운영자 role:
- ADMIN
- OWNER

admin audit:
- append-only
- 과거 이벤트 수정 금지
- 정정은 새 이벤트
- 일반 operator manual audit delete UI 없음

---

# 7. 보관 / legal_hold / audit

보관 정책의 주요 기간:
- 사용자 삭제 콘텐츠 증거: 삭제일 + 6개월
- 일반 신고: 최종 처리 후 1년
- 일반 제재: 종료 후 1년
- 정식 권리침해 사건: 최종 처리 후 5년
- Admin moderation audit: 생성 후 1년

Admin moderation audit retention:
- 1년

일반 운영:
- UPDATE/DELETE 금지
- append-only

1년 이후:
- controlled system purge만 가능

legal_hold:
- 실제 법적/분쟁/수사/권리침해 등 보전 필요 시 사용
- 운영 편의 목적 사용 금지
- OWNER만 set/release
- reason 필수
- ADMIN set/release 불가
- member에게 hold 존재 노출 금지
- 보존만 제어하고 sanction/hide/Alien/account status 자동 변경 금지
- hold 중 retention delete 중지
- release 시 원래 만료가 미래면 원래 일정 유지
- 이미 만료됐으면 release + 7일 grace

현재 STATE 기준:
- legal_hold 정책/코드/Production migration COMPLETE
- controlled audit purge COMPLETE
- OWNER 실제 Chrome HOLD_SET→HOLD_RELEASE 검증은 Chrome backlog

moderation 콘텐츠 상태 구분:
- 회원 본인 삭제: `DELETED`
- 운영자 숨김: `HIDDEN_BY_OPERATOR`
- 운영자 복구: `ACTIVE`
운영자 hide와 회원 delete를 같은 의미로 취급하지 않는다.

---

# 8. 권리침해 / 허위정보

권리침해는 일반 신고와 분리.

권리침해:
- 독립 intake
- 삭제된 게시물도 대상 가능
- 비회원 신청을 고려한 설계/경로가 존재했으나, 현재 SSOT에서 non-member email verification/SMTP가 Deferred이므로 **비회원 end-to-end 제출이 Production에서 완전히 동작한다고 가정하지 않는다.**
- 접수만으로 자동 삭제/제재 금지
- 정식 사건 전환은 운영자
- 임시 게시중단과 이의절차
- 신청자 개인정보 비공개
- retention 적용

비회원 이메일 인증/SMTP:
- 일부 코드/설계 준비 후 외부 발송 환경 없어 중단
- 현재 deferred:
  - `rights_email_verify`
  - SMTP
  - non-member email verification
  - withdrawal-after-rights PII
  - permanent-ban rejoin block wiring

허위정보 신고:
- 구체 표현/허위 이유/근거 요구
- 의견/예측/풍자는 사실 부분 지정
- 신고 접수만으로 삭제/제재/Alien/정치성향 변경 없음
- 악용 신고는 별도 escalation

---

# 9. 인증과 회원가입

과거 cookie/SSR/bootstrap/session controller가 섞이며 복잡해졌고 실제 Chrome 오류가 있었다.

이후 방향:
- Supabase browser session 단일화
- `public/auth.js` 중심
- Bearer API
- browser PKCE/localStorage
- 복잡한 SSR/cookie/bootstrap 레이어 제거

현재 인증:
- Google
- Kakao
- Naver
- Guest
- session restore/logout
- 활동명 onboarding
- account withdrawal
- canonical user id = `auth.users.id`

가입:
- 만 14세 이상
- 민감 정치정보 처리 동의 별도
- 현재 소속 영토 공개 동의도 가입 완료에 필요
- 현재 영토만 공개하고 원점수·변화량·계산내역·과거 이동 세부기록은 공개하지 않는 방향
- 신규 CENTRAL / score 0
- territory 선택 없음
- OAuth provider 이름/이메일을 활동명으로 자동 확정하지 않음
- 별도 활동명 onboarding
- 기존 회원 판별의 canonical marker로 `profiles.signup_completed_at`을 사용

지원 provider:
- Google
- Kakao
- Naver
- Guest
- Apple은 현재 지원 canon에서 폐기

`public/auth.js`는 특별 보호 파일이다.
관련 없는 작업에서 수정하지 않는다.

---

# 10. 프로필 UX

Profile V1은 반복 수정 끝에 강하게 보호되는 영역이다.

기본 구조:
- `public/index.html`의 ProfileFrame
- 완성 PNG + overlay
- 1024×819 기준
- `SC_PROFILE_LAYOUT` / skin별 좌표
- 4 skin: center / pioneer / guardian / alien
- skin 파일: `center.png`, `pioneer.png`, `guardian.png`, `alien.png`
- 원본 PNG 비율/자산을 임의 변형하거나 같은 경로에 덮어쓰지 않음

2026-10-15 Profile V1 조사에서 확인된 표시 의미:
- 활동명
- Lv
- 명성
- 팔로워
- XP는 본인에게만 공개
- 활동 5항목: 작성 글 / 댓글 / 받은 공감(EMPATHY) / 토론 참여 / 전달한 아우라
- 영토 기록 4항목: 현재 소속 / 이동 횟수 / 시민 영향력 / 시민 등급
- 대표 업적 3개

중요:
- Fame(`reputation_score`)과 시민 영향력은 다른 값.
- EMPATHY와 LIKE/DISLIKE는 다른 신호.
- 공개 프로필에는 XP를 노출하지 않는 방향.
- Guest에게 가짜 member progression을 보여주지 않는다.
- 팔로워/아우라 표시 필드가 존재한다고 해서 Follow/Aura 전체 backend가 현재 COMPLETE라는 뜻은 아니다.

레벨:
- canonical 개인 level 범위 1~10
- Lv1~5 초기 적응/튜토리얼
- Lv5 관련 업적 `당당한 영토시민!`
- Lv6~10 커뮤니티 활동 성장
- 현재 `user_progression`이 Level/XP/Fame 정본
- 개인 level과 Territory evolution stage는 별개

과거 사회적 rank 명칭:
- 참여자
- 시민
- 논객
- 대표
- 지도자
이 명칭/시민등급과 Fame grade의 실제 연결은 최신 코드/정책을 확인한다. 과거 UI 명칭만 보고 자동으로 계산식을 만들지 않는다.

Profile V1 보호 원칙:
- 사용자가 기존 V1을 바꾸라고 승인하지 않은 상태에서 HTML/CSS로 V1을 재설계하지 않는다.
- 그러나 **별도 branch/worktree/candidate에서 새로운 V2 시안을 만드는 것은 사용자가 명시적으로 요청하면 가능**하다.
- candidate 제작 허용이 V1 적용/교체 허가는 아니다.

2026-10-15 첫 Agent 운영 테스트:
- branch: `agent-test/profile-v2-candidate`
- worktree: `C:\Projects\sentencearena\sentencearena-agent-profile-v2`
- candidate: `candidates/profile-v2/index.html`
- screenshot: `candidates/profile-v2/review-desktop.png`
- commit/push/merge 없음
- 기존 V1 파일 수정 없음
- 같은 세션이 Explorer→Builder→Reviewer를 순차 수행했으므로 완전한 독립 Reviewer 테스트는 아니었음
- 이 후보는 실험 자산이며 canonical UI가 아니다. 자동 적용/삭제 금지.

현재 STATE:
- `user_progression` canonical
- Level / XP / Fame / real activity stats COMPLETE
- connected achievements 6개 COMPLETE

Connected:
- first-post
- first-comment
- first-empathy-received
- territory-citizen
- record-builder
- conversation-bridge

Deferred 5개:
- steady-footsteps
- empathy-from-many
- dialogue-across-territories
- witness-of-an-era
- beta-citizen

---

# 11. 지도와 월드 UI

반복 문제:
- 지도 이미지와 SVG hit-zone 불일치

고정 교훈:
- 이미지와 hit-zone은 같은 wrapper / 같은 coordinate system
- 따로 scale하지 않음
- `background-size`만 따로 확대 금지
- crop으로 영토가 사라지지 않게
- 첫 화면에서 전체 월드 구조 이해 가능해야 함

접힘 패널:
- 접히면 내부 text 완전히 숨김
- 가로 scroll 금지
- tab만 표시
- 지도 공간 충분히 확보

과도한 HUD rail/glow/particle은 여러 번 롤백됨.
시각효과가 정보/클릭 정확도를 희생하면 안 된다.

과거 기본 구현된 알림/활동 HUD:
- notification store `sc_notifications_v1`
- 최대 50개 저장
- 45초 중복 방지
- 지도 우상단 + 프로필 벨, unread badge 공유
- activity feed `sc_activity_feed_v1`
- 최대 30개 저장 / 화면 8개
- 30초 중복 방지
- 지도 좌하단
- 일반 알림 시스템이 존재한다고 해서 모든 이벤트(특히 업적)가 자동 연결돼 있다고 추론하면 안 됨

---

# 12. Territory evolution

현재 canonical:
- Earth: pioneer / central / guardian
- Alien 별도
- Central population = central + pioneer + guardian
- Alien 제외
- population 감소 시 stage 하락 가능

과거 단계명:
Earth:
1. 원시
2. 고대
3. 중세
4. 근대
5. 현대
6. 미래

Alien:
1. 문명탄생
2. 문명형성
3. 문명발전
4. 문명확장
5. 문명번영
6. 문명포화

역사적/설계 임계값:
- 0~100 → 1
- 101~300 → 2
- 301~1,000 → 3
- 1,001~2,000 → 4
- 2,001~8,000 → 5
- 8,001+ → 6
이 값은 과거 설계/Mock 기준에서 시작했으므로 실제 수정을 할 때 current code의 threshold를 다시 확인한다.

인구 계산의 변화:
- 2026-07-30 시점에는 CENTRAL 직접 소속만 세는 안이 있었음.
- 이후 확정/구현은 CENTRAL evolution population = CENTRAL + PIONEER + GUARDIAN, Alien 제외.
- 현재 ACTIVE DEC-008도 Earth 합산을 따른다.

이미지/패널 역사:
- 총 22장 구조: 공통 원시 1 + 개척/수호/중앙 각 5 + Alien 6
- Hover는 현재 단계를 가장 크게 강조
- 이전/다음 단계 preview
- 현재 발전 인원 + 다음 단계까지 필요한 인원 표시
- 단계 이미지를 클릭해 수동 선택하는 구조는 아님

현재 STATE:
- stage 1–6 COMPLETE
- population calculation COMPLETE
- images/HUD COMPLETE
- next threshold display COMPLETE
- snapshot history persistence Deferred

과거 “최고 단계 유지” 선호/추천 논의가 있었지만 현재 ACTIVE는 population 감소 시 stage 하락 가능이므로 최신 결정을 따른다.

---

# 13. 그래픽 원칙

영토 색상:
- 개척 = 파랑
- 중앙 = 초록
- 수호 = 빨강
- 박빙 = 3진영 동시

깃발/자산:
- 공통 master template
- territory skin
- 동일 canvas/지면선/깃대/animation 구조
- 투명 배경/규격 일관성
- 원본 overwrite 금지

현재 Agent 규칙:
- 기존 이미지/아이콘/디자인 원본 overwrite 금지
- 후보는 candidate/new-version
- 승인 후 실제 참조 교체
- 이전 버전 비교 가능하게 보존

---

# 14. Daily Issue

역사:
- 초기에는 정치/경제/사회/연예/세계 5분야 로컬 정적 질문 풀과 localStorage 기반 prototype으로 시작.
- 이후 실제 source collection + DB(`daily_issue`) + admin review/publish 구조로 전환.
- 과거 static/local prototype을 현재 운영 canon으로 되살리지 않는다.

현재 COMPLETE:
- source collection
- admin review
- approve
- publish
- public list/detail
- comments
- reactions
- admin management

DB schema:
- `daily_issue`
- 운영 canon으로 `daily_issue_test`나 `public` 사용 금지

운영:
- morning collection scheduler
- auto publish
- DEC-019/STATE 기준 Production ON
- auto publish는 `AUTO_PUBLISH_ELIGIBLE` only
- duplicate guard/cap 유지
- manual operator path 유지

과거 OFF/pending 스레드는 역사적 snapshot이다.

Deferred:
- 다음 실제 published issue sanction-block Chrome verification

---

# 15. 서버 / 배포

주요 방향:
- Node/Express
- always-on 단일 웹
- Supabase Auth + DB
- `/health`
- `/ready`
- fail-closed production guards
- production CORS allowlist
- graceful shutdown
- scheduler single-instance

Railway Amsterdam에서 운영되었으나 한국 사용자 + Supabase Seoul과의 지역 차이 때문에 NAVER Cloud Korea로 이전.

STATE 기준:
- NAVER Cloud migration COMPLETE
- DNS cutover COMPLETE
- post-migration validation COMPLETE
- Railway cleanup COMPLETE

하지만 최신 운영 사실:
- 2026-10-14 비용 절감을 위해 NAVER Cloud SentenceArena 서버를 사용자가 직접 정지
- STATE의 2026-09-06 `sentencearena.service active`는 당시 사실
- 현재 runtime 판단은 2026-10-14 서버 정지가 더 최신
- 베타 재개/배포 시 서버 start는 사용자 승인 필요

NAVER Cloud 서버 기록(운영 식별용, secret 아님):
- instance: `sentencearena-app-01`
- VM: G3 Standard / `s2-g3a`
- vCPU 2 / RAM 8GB
- 시작 기록: 2026-09-02 19:21
- public IP: `49.50.140.245`
- private IP: `10.0.1.6`

비용 사건:
- 2026-09 사용분 청구: 91,960원
- 2026-10-14 당시 2026-10 예상액: 42,460원
- 9월 상세에서 Server 실행 시간 비용이 대부분(77,740원)이고 Public IP/Block Storage 비용도 존재
- 임시로 켠 서버를 작업 종료 후 끄지 않아 비용 발생
- 2026-10-14 사용자가 서버를 정지
- 사용자는 정지 버튼을 이미 눌렀다면 반복적으로 상태 재확인을 요구하지 않는 것을 선호
- 이후 유료/서버 작업은 시작 전 예상비용 + 종료조건을 같이 관리
- 서버 start/stop/반납 Agent 독단 실행 금지
- 정지 상태에서도 Public IP/storage/정지 관련 비용이 일부 남을 수 있음

정지기간 관련 과거 안내:
- Standard-g3 정지 1회 최대 약 90일, 12개월 누적 180일이라는 안내가 있었음
- 2026-10-14 정지 기준 90일 부근을 대비해 2027-01-07 리마인더가 설정됨
- 실제 제한/정책은 NAVER Cloud가 변경할 수 있으므로 향후 행동 전 콘솔/공식 정책 재확인

중요:
- 서버를 잠깐 켜는 작업도 "켜기 → 검증 → 종료/정지"를 한 작업 단위로 관리한다.

---

# 16. Alien Mock 310 사건

문제:
- 실제 Alien population 0
- API count 실패 시 Alien hardcoded Mock 310
- frontend Alien 누락 시 310 fallback
- Production에서 실데이터처럼 노출

해결:
- DB가 아니라 mock/fallback 경로 차단
- API/HUD 0명
- stage 1 `문명탄생`
- `OPERATIONAL_USER_DATA`
- LEGACY_MOCK 310 차단
- Earth population 회귀 검증

교훈:
- Production member 화면에 mock 데이터 금지
- fallback 숫자 생성보다 unavailable/real last-known 우선
- 자동 테스트 PASS만으로 끝내지 말고 Chrome 실검증 필요

---

# 17. Production mock 제거 원칙

로그인 회원에게 mock/seed/demo가 실데이터처럼 보이는 문제를 제거했다.

예:
- board seed/demo
- 타인 profile mock Level/Fame
- territory evolution legacy mock
- faction battle mock
- fame ranking sample
- political profile localStorage fake
- 실시간처럼 보이는 HUD wording

원칙:
- Guest 체험용 mock은 명확히 체험용일 때 가능
- 로그인 member에게 operational data처럼 노출 금지

---

# 18. Faction battle

2026-08 후반 게시글별 LIVE 전황 prototype이 배포된 적이 있다.

당시 데이터:
- 실제 댓글/대댓글
- LIKE/DISLIKE
- EMPATHY 제외
- 당시 진영
- 중복/삭제/취소 제외

원글 반응 가중치 수정 논의:
- 같은 진영 LIKE +0.8 / DISLIKE -1.2
- 다른 진영 LIKE +1.2 / DISLIKE -0.8
- 댓글 LIKE +1 / DISLIKE -1

하지만 현재 SSOT:
- `Faction battle LIVE rules` = DEC-D08
- product-wide deferred에 Faction battle LIVE data

따라서 과거 prototype을 최종 canonical rules로 간주하지 않는다.
다시 진행할 때 먼저 정책 논의.

---

# 19. Follow / Aura / Chat / Payment / Season

현재 Deferred:
- Follow / Aura
- Chat DB persistence
- Payments
- Real season system
- Full USER_EVENT pipeline
- advanced analytics

과거 일부 UI/prototype이 있어도 current COMPLETE로 간주하지 않는다.

real season이 없으므로:
- 자동 `SEASON_END` 규칙 강행 금지
- 시즌 연동 복귀는 시즌 정책 결정 이후

---

# 20. 오픈베타 운영 플래그

현재 ACTIVE / Production COMPLETE 정책:
- political scheduler ON
- Alien Moderation V1 ON
- Daily Issue morning scheduler ON
- Daily Issue auto publish ON

과거 스레드의 OFF/미정 기록은 당시 snapshot.
현재 DEC-019 우선.

단, 서버 자체는 2026-10-14 정지 상태이므로:
- 정책상 ON
- 현재 서버 running
을 구분한다.

---

# 21. 오픈베타 전 남은 큰 작업

STATE 기준 remaining candidates:
- 법률 문서 최종화 (`docs/legal/`에 과거 검토용 초안이 있었지만 final/사이트 연결 완료로 간주하지 않음)
- 개인정보처리방침
- 이용약관
- 커뮤니티/moderation/신고 정책
- 권리침해 안내
- 탈퇴/지원/footer 정보
- 운영자/사업자 법적 정보
- FAQ
- 세계관/영토 가이드
- Known Issues
- Feedback/bug channel
- 오픈 공지
- 초기 공식/커뮤니티 콘텐츠
- 초기 Daily Issue
- 최종 Chrome regression
- 운영 체크리스트

Chrome backlog:
- first visit guide
- relogin no-repeat
- logged-in rights submission
- nonmember rights guidance
- official post badge
- real ADMIN pages
- real MEMBER admin block
- other-member Level
- next Daily Issue sanction block
- OWNER legal_hold real action

많은 항목은 기능 미구현이 아니라 실브라우저/실계정 검증 증거만 남은 것.

관련 구현 메모:
- Guest는 read-only. 글/댓글/반응/신고/follow/chat send 등 write action 차단.
- Official posts는 ADMIN/OWNER만 생성/수정/종료/삭제 가능. 일반 회원은 official 위조 불가. 운영 공식글은 정상 member XP/업적 reward 제외.
- First visit guide는 가입 완료 뒤 최초 1회 흐름으로 구현됐으며 기존 회원 강제 backfill 없음. 실 Chrome repeat/no-repeat 검증이 backlog.

---

# 22. 정책 토론이 먼저 필요한 것

현재 우선:
- Member report history UI 필요/시점
- Faction battle LIVE 계산 규칙
- Future season rules

이 영역은 Codex가 먼저 구현하면 안 된다.
사용자와 큰 틀을 논의한 뒤 결정.

---

# 23. 개발 방식과 사용자 운영규칙

사용자는:
- 큰 구조를 Agent가 임의로 정하는 것을 원하지 않는다.
- 먼저 조사
- 선택지/의견 제시
- 사용자와 합의
- 그 다음 구현

싫어하는 것:
- 다른 시스템을 “정리 차원”에서 건드리기
- 기존 그래픽 overwrite
- 오래된 설계 부활
- 복구점 없이 작업
- 사용자를 AI 사이 복붙 전달자로 만들기
- 비용 발생 서버/클라우드를 종료계획 없이 실행

repo에 이미 영구 저장된 Agent 안전 원칙:
- 기능 개발은 별도 branch/worktree
- 기존 V1/candidate 분리
- 범위 밖 수정 금지
- commit/push는 명시 승인 필요
- merge는 승인 전 금지
- Production/DB/서버 start-stop/유료 리소스/secret 변경은 승인 전 금지
- Reviewer 직접 수정 금지
- 기존 그래픽/파일 자동 overwrite 금지

2026-10-15 Codex와 추가로 합의한 **더 보수적인 운영 원칙**:
- 조사/확인/검토/분석 = READ ONLY
- `수정해 / 구현해 / 만들어` 등 명시 요청 때만 파일 변경
- 수정 승인 ≠ commit 승인
- commit 승인 ≠ push 승인
- push 승인 ≠ merge 승인
- merge 승인 ≠ Production 승인
- package 설치/업그레이드와 `.env` 수정도 별도 승인
- GitHub/Supabase/NAVER Cloud는 조회 가능, 생성/저장/삭제/실행/시작/정지/배포 등 상태 변경은 승인 필요
- 범위 밖 문제는 보고만
- 애매하면 실행하지 말고 질문

**중요한 현재 상태:**
이 추가 보수 원칙은 현재 작업트리의 `AGENTS.md` / `docs/AGENT_SAFETY_RULES.md`에 이미 반영되어 있다.
따라서 이 문서를 repo에 넣더라도 안전규칙 SSOT를 대신하지 않는다.
단, 해당 안전문서 변경은 아직 commit/push되지 않았다.

영구 규칙:
- `AGENTS.md`
- `docs/AGENT_SAFETY_RULES.md`

2026-10-15 master 안전 기준점:
- `f10bee75e1924c9f3a5720d72ec92a866fb40089`

---

# 24. 현재 로컬 개발환경과 미해결 기술 상태

2026-10-15 Codex 전환 시점 snapshot:
- repo: `kyb041028-ctrl/sentencearena`
- local: `C:\Projects\sentencearena\sentencearena`
- branch: `master`
- Node `v22.22.3`
- npm `10.9.8`
- `.env` local + gitignored
- `.env`의 publishable key 이름은 `SUPABASE_PUBLISHABLE_KEY`; 최신 master는 이를 server auth config에서 fallback으로 지원
- `npm start` local 실행 확인
- `/health` 200 확인
- 최신 master 재시작 후 `supabaseConfigured=true` 확인
- 마지막 로컬 확인에서는 `/ready`가 503 / `database.ready:false`였던 이력이 있음
- 이것을 이유로 Production migration/DB 변경을 자동 실행하면 안 됨
- local DB readiness는 별도 조사 대상으로 취급

dependency 상태:
- 새 PC `npm install` 당시 `npm audit`에 4개 vulnerability(3 moderate, 1 critical) 보고
- `npm audit fix`는 실행하지 않았음
- dependency 자동 업그레이드/auto-fix 금지. 필요 시 영향 조사 후 별도 승인

Git branch 함정:
- 현재 개발 기준 branch는 `master`
- 2026-10-15 확인 당시 `main`은 2026-07-13의 오래된 commit `4def2a3...`에 머물러 있었음
- `master`가 최신 개발선이며, `main`을 default라는 이유로 canonical로 취급하면 안 됨
- Codex 전환 기준 master checkpoint: `f10bee75e1924c9f3a5720d72ec92a866fb40089`
- 이 SHA는 영구 current가 아니라 **2026-10-15 안전 기준점**이다

문서 함정:
- 오래된 `AI_START_HERE.md`에는 browser-only demo, `planetPct`, `reform/order`, real login data 미연결 등 현재와 충돌하는 설명이 남아 있었음
- `STATE/DECISIONS/AGENTS`보다 우선하지 않는다

Codex:
- 로컬 프로젝트 연결 완료
- Chrome 연결 완료
- GitHub/Supabase/NAVER Cloud 로그인 세션 접근 가능 확인

주의:
- 비밀번호/secret 채팅 출력 금지
- 세션 만료/2FA/CAPTCHA만 사용자 개입

---

# 24-1. 새 PC로 옮긴 보호 작업물

옛 노트북의 political alignment simulation 작업물은 현재 repo에 섞지 않고 별도 안전 폴더에 보관했다.

보관 위치:
`C:\Users\user\SentenceArena_OldLaptop_Files`

알려진 파일:
- `.env` 백업
- `political-alignment-bidirectional-sim-core.js`
- `political-alignment-gradual-sim-core.js`
- `run-fast-alignment-simulation.js`
- `run-gradual-alignment-simulation.js`
- `run-selfcap-alignment-simulation.js`
- `test-gradual-alignment-simulation.js`
- `test-selfcap-alignment-sim.js`
- `verify-daily-issue-alignment-seed-live.js`

원칙:
- 자동 stage/commit/delete/restore/overwrite 금지
- 현재 repo가 깨끗하다고 해서 이 별도 폴더를 불필요 파일로 간주하지 않음
- `supabase/.temp/`는 USB 백업에 남아 있었고 새 repo에 자동 복원하지 않았음

---

# 25. Cursor의 현재 위치

과거 주 개발환경은 Cursor였다.

현재:
- Codex 중심 개발로 전환 중
- Cursor는 불필요 판단 시 구독 해지/삭제 예정
- `.cursor/rules` 충돌 규칙은 정리됨
- Codex는 repo `AGENTS.md` 중심으로 안전규칙 사용

Cursor를 현재 대표 개발 Agent로 가정하지 않는다.

---

# 26. 절대 부활 금지

- `reform` / `order` canonical territory
- `planetPct`
- 외계인 %
- KANTAPBIYA_LEFT / RIGHT
- 신호구역 정치모델
- 정치성향 기반 Alien 추방
- 가입 시 영토 선택
- 신고 N회 자동 제재/추방
- report count = violation count
- Guest fake Level/Fame
- Daily Issue public API hidden alignment vector 노출
- operator hard delete 기본화
- audit log 수정/덮어쓰기
- Admin legal_hold 자유 toggle
- real season 없이 season-end 규칙
- member/Production 화면 mock 수치를 실데이터처럼 표시
- 오래된 handoff/TODO를 STATE보다 우선
- `public/auth.js` 관련 없는 리팩터링
- stable auth/DOM/world cleanup refactor

---

# 27. Codex 수정 전 체크

1. 현재 COMPLETE 시스템을 바꾸는가?
2. ACTIVE DECISION에 걸리는가?
3. 조사인가 실제 수정인가?
4. 별도 branch/worktree가 필요한가?
5. 기존 V1/graphics/asset overwrite인가?
6. Supabase/DB/Auth/Production 영향이 있는가?
7. 서버를 켜거나 비용이 발생하는가?
8. 옛 proposal을 현재 canon으로 착각하지 않았는가?
9. Chrome 실검증이 필요한가?
10. 정책 논의를 먼저 해야 하는 영역인가?

불명확하면 먼저 보고.

---

# 28. 상태 요약

## 확정/구현 완료 핵심
- SentenceArena 브랜드
- pioneer / central / guardian / alien
- 정치성향과 moderation 분리
- Alien behavior moderation
- 신규 CENTRAL / score 0
- age 14+
- sensitive political consent
- Google/Kakao/Naver auth
- guest read-only
- board posts/comments/replies/reactions
- EMPATHY separate
- real user_progression
- Level / XP / Fame
- 6 achievements
- Daily Issue core
- territory evolution core
- political scheduler policy ON
- Alien V1 policy ON
- Daily Issue morning/auto publish policy ON
- report/sanction/admin moderation
- admin audit append-only
- audit retention 1y
- legal_hold
- controlled audit purge
- rights infringement
- official posts
- NAVER Cloud migration
- Agent safety rules / Codex handoff

## 실브라우저 검증 일부 남음
- first visit
- rights UI cases
- official post badge
- admin permission surfaces
- other-member Level
- Daily Issue sanction block
- OWNER real legal_hold action

## Deferred
- 5 achievements
- territory snapshot history
- expanded Alien community
- season
- multi-instance Alien lock
- report history UI
- faction battle final LIVE rules
- Follow/Aura
- chat DB
- payments
- rights email verification / SMTP
- additional progression rewards
- atomicity improvements
- advanced analytics

## 현재 운영 특별 상태
- NAVER Cloud app server는 2026-10-14 비용 절감을 위해 정지
- 서버 재가동은 사용자 명시 승인 필요
- “정책/코드상 Production COMPLETE”와 “현재 서버 running”을 혼동하지 않는다.

---


# 28-1. SentenceArena 상표 모니터링 맥락

확인된 출원:
- 출원번호: `40-2026-0166850`
- 출원일: 2026-08-13
- 2026-10-07 확인 당시 법적상태: `출원`
- 공통상태: 출원/심사대기
- 당시 심사진행/공고/등록번호는 확인되지 않음

주의:
- 과거 한 번 "검색결과 없음"으로 잘못 판단했다가 실제 정상 1건으로 정정된 이력이 있음.
- 따라서 상표 상태는 검색 실패와 실제 사건 없음 상태를 구분해야 함.
- 검토된 서비스 분류는 42류 SaaS/플랫폼, 45류 온라인 소셜 네트워킹이 핵심이었고 41류 게임/온라인 오락도 검토됨.
- 실제 출원 지정상품/류는 출원 원문을 다시 확인하지 않고 추정하지 않는다.

모니터링:
- 사용자는 이 고정방에서 "상표확인"이라고 하면 현재 상태 확인을 기대함.
- 매일 조회할 필요는 없다고 판단해 월 1일/15일 확인으로 변경한 이력이 있음.
- 2026-10-15 조회 실패 뒤 자동 모니터링이 중지된 이력이 있으므로, 현재 자동화가 살아 있다고 가정하지 않는다.
- 의미 있는 상태 변화가 있을 때 알리는 것이 목적.

상표 업무는 제품 코드/기능 정책과 분리한다.

---
# 29. 프로젝트를 한 문장으로

SentenceArena는 정치적 의견을 벌주는 서비스가 아니라,
서로 다른 의견을 가진 사람들이 세계관 속에서 활동하고 그 활동이 개인·영토·사회·세계의 변화를 만들어내되,
유해한 행동만 별도의 moderation 체계로 관리하는 게임형 커뮤니티다.

새 기능을 만들 때 가장 먼저 지켜야 하는 것은 “더 많은 기능”이 아니라
이 분리 원칙과 기존 안정화 시스템의 보존이다.


---

# Appendix A. 2026-08-20 ~ 2026-09-06 후반 Production/운영 아크

Codex가 "과거에는 OFF였는데 지금은 ON" 같은 시간축을 헷갈리지 않도록 핵심 흐름만 기록한다.

## 2026-08-20
- 만 14세 + 민감정보 동의 legal gate Production PASS
- 신고 member response 내부 UUID 제거
- 신고 review와 Alien 분리, 신고 수 ≠ 위반 수 원칙 강화
- 확정 행동 기반 sanction ladder 연결 시작

## 2026-08-21
- 제재 persistence Production 연결, Alien 자동 이동은 당시 OFF
- 삭제 콘텐츠/신고/제재 retention 구현
- 로그인/회원가입 법적 흐름 정리
- `signup_completed_at`을 기존 회원 판별 기준으로 고정

## 2026-08-22
- 권리침해 전용 flow Production PASS
- misinfo 신고 근거 요구 강화 Production
- 비회원 email verification은 SMTP 부재로 중단

## 2026-08-26
- Alien 운영 연결 보완, 당시 V1 OFF 유지
- 업적 Production 연결 보완
- Production mock 노출 차단
- admin role `app_metadata.role` only
- admin API 401/403 통일
- appeal 재결정/동일 행동 중복 수동제재 guard

## 2026-08-27~28
- 정치성향 bidirectional/actor-self 세부 로직 보완
- CENTRAL 자기행동 버그 수정/배포
- 당시 전황 prototype 등 실험 진행

## 2026-08-30
- 현재 소속 영토 공개 동의 legal consent 추가
- 첫 방문 안내, 권리침해 intake 강화, Guest read-only, official flag 등 여러 항목은 당시 코드 단계/Production 미적용 항목이 있었음
- 이후 9월 상태를 볼 때 8/30 snapshot만으로 현재 미적용이라고 단정하지 않는다

## 2026-09-03~06
- NAVER Cloud Korea 이전 및 production 안정화
- 타인 Level server canonical 연결
- admin home/posts/comments/audit/report UX 강화
- official posts ADMIN/OWNER 경로
- 신고자 처리결과 알림
- admin audit append-only + report linkage
- DEC-019: political scheduler / Alien V1 / Daily Issue morning / auto publish Production ON
- DEC-020 audit retention 1년
- DEC-021 legal_hold + controlled audit purge Production COMPLETE

후반 상태는 `STATE`와 ACTIVE `DECISIONS`를 최종 기준으로 본다.

---

# Appendix B. 이 문서를 읽을 때 특히 헷갈리기 쉬운 "과거 → 현재" 전환

- 가입 시 영토 선택 있음 → **폐기**, 신규 CENTRAL 자동 시작
- `reform/order` → **폐기**, `pioneer/central/guardian/alien`
- Alien=정치 유배 → **폐기**, 행동 moderation
- 신고 N회=위반 N회 → **폐기**, 운영자 판단/행동 단위
- Alien V1 OFF snapshot → **후반 DEC-019에서 Production ON**, 단 현재 서버 자체는 2026-10-14 정지
- Daily Issue static/local prototype → **DB source collection + admin/public flow**
- 업적 UI/더미 → **현재 6개 core achievement는 실제 연결 COMPLETE**
- CENTRAL direct-only evolution count → **Earth C+P+G 합산**
- 최고 stage 유지 선호안 → **현재 stage 하락 가능**
- Railway production → **NAVER Cloud Korea로 이전 완료**
- Cursor 중심 개발 → **2026-10-15 Codex 중심 전환 중**
