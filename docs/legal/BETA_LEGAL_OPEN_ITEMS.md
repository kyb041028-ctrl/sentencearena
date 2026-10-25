# 베타 전 최종 확인 필요사항

법적·운영 문서 초안(`TERMS_DRAFT.md`, `PRIVACY_POLICY_DRAFT.md`, `COMMUNITY_POLICY_DRAFT.md`)을 공개 페이지에 올리기 전에 남는 목록입니다.

임의로 채우지 마십시오. 확인된 값만 넣습니다. 이 파일은 공개 페이지가 아닙니다.

코드에서 확인한 소셜 로그인 범위와 오픈 직전 Production 체크리스트는 `docs/legal/LAUNCH_FINALIZATION.md`에 있습니다. 그 문서는 공개 개인정보 항목표가 아니고, 체크리스트는 완료된 작업이 아닙니다.

---

## 1. 사업자·운영 주체

아래는 비워 둡니다. 표기는 정확히 `Launch Finalization에서 확정`입니다.

- 사업자/운영자 공식 명칭: Launch Finalization에서 확정
- 대표자: Launch Finalization에서 확정
- 사업자 주소: Launch Finalization에서 확정
- 고객 문의 이메일: Launch Finalization에서 확정
- 개인정보 담당자: Launch Finalization에서 확정

## 2. 시행일

- 개인정보처리방침 시행일: Launch Finalization에서 확정
- 이용약관 시행일: Launch Finalization에서 확정
- 운영정책 시행일: Launch Finalization에서 확정

## 3. 서버·국외 이전

- 앱 서버: NAVER Cloud 한국 이전은 현재 상태 기록 기준 완료입니다. Railway를 현재 앱 서버로 적지 않습니다
- 앱 서버 프로세스: 2026-10-14 기준 정지입니다. 이 문서는 호스트를 다시 확인하지 않았습니다
- 서버 IP, 인스턴스 이름, 리전 코드: 적지 않습니다
- Supabase 실제 개인정보 저장/처리 지역: 확정하지 않음
- 국외 이전 여부: 확정하지 않음
- 국외 이전 시 채울 항목: 업체, 국가, 항목, 목적, 시기·방법, 보유기간, 법적 근거, 거부 방법과 영향

## 4. 소셜 로그인

공개 개인정보처리방침의 확정 항목표로 쓰지 않습니다. 상세는 `docs/legal/LAUNCH_FINALIZATION.md` 2절입니다.

- Google 요청 scope: 앱 코드와 저장소 설정에 없음. 구현되지 않음
- Kakao 요청 scope: `profile_nickname`, `profile_image`. `account_email`은 요청하지 않음
- Naver 요청 scope: 저장소에 없음. 구현되지 않음. userinfo 프록시는 `response.id`가 있으면 `sub`로 넘기고, 있으면 이메일·이름·닉네임을 넘김
- `public.profiles` INSERT는 이메일·실명·소셜 닉네임·프로필 이미지를 넣지 않음
- OAuth 제공업체가 Auth 저장소에 남기는 항목 전체: 이 저장소 SQL이 정의하지 않음. 확정하지 않음

## 5. 권리침해

- 오픈베타 접수: 로그인 회원만. 비회원 접수는 닫혀 있음. 비회원 이메일 발송 연결은 오픈베타 선행 작업이 아님
- 회원 권리침해: 필수 소명 + 증빙파일. 접수만으로 자동 삭제/정지 없음
- 첨부파일: 기존 저장소 비공개 테이블. png/jpg/gif/webp/pdf, 5개·5MB. 주민등록번호 미요구
- 정식 건의 공개 보관 기간: 이 초안은 확정하지 않음. 코드 상수를 공개 보관기간으로 적지 않음
- 반려 코드·신청자 안내 사유와 내부 메모 분리 구현됨

## 6. 기능·운영 상태

- Alien V1: 오픈베타 운영 정책은 켜짐 (DEC-019). 환경변수가 없고 production이면 코드 기본값은 꺼짐. 프로세스 실행 중이라고 쓰지 않음. 비호감 30회 자동 추방은 현재 제재 사다리가 아님
- 신고 결과 안내: moderation inbox. `GET /api/users/me/notifications`는 `USER_DATA_API_NOT_ACTIVATED`이며 오픈베타 코드 블로커가 아님
- 활동명: 서버 PUT은 가능. 그 PUT을 호출하는 화면은 가입 직후 온보딩뿐임
- 프로필 소개글·사진 입력 화면: 이 저장소에서 확인되지 않음. 프로필 수정 라우트는 비활성 user-data 경로임
- 팔로우·북마크·일반 알림 라우트: 코드에는 있으나 `USER_DATA_OPERATIONAL`이 아니면 `USER_DATA_API_NOT_ACTIVATED`
- 제재 이의신청: 서버 API가 있고, 로그인 회원 화면은 상단 「제재 및 이의제기」
- 영구정지 탈퇴 HMAC 재가입 방지값: 1년 보관 코드는 있음. 로그인·가입 차단 연결은 아직 없음
- 관할 법원: 공개 문서에 법원 이름을 적지 않음
- legal_hold: OWNER만 설정·해제 (DEC-021). ADMIN 설정·해제는 아님
- 민감정보 동의 철회: 회원에게 있음. 계정은 바로 지우지 않음

## 7. 초안에 넣지 않은 것 (구현 없음 또는 구 기획)

- 결제(구독, 직언패스, 지구귀환티켓)
- 비호감 횟수만으로 추방 후 유료 복귀
- 이용자가 영토를 직접 선택하는 가입 단계
- 정치성향 원점수의 타인 공개
- 생년월일 원문 DB 보관
- 이용약관·개인정보처리방침·운영정책 페이지의 사이트 연결 (이번 작업에서 하지 않음)
