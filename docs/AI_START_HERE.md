# 새 AI — 여기부터 읽기 (1분)

## 이 프로젝트는?

**센텐스아레나** = 글 쓰고 반응하면 **성향**이 바뀌고 **영토**에 소속되는 게임형 커뮤니티.

- 화면: `public/index.html` **한 파일**에 다 있음 (빌드 없음)
- 실행: `npm start` → http://localhost:3000

---

## 작업 전 꼭 읽을 것 (순서)

1. `docs/PROJECT_CONTEXT.md` — 세계관·화면 구조
2. `docs/TODO.md` — 뭘 했고 뭘 남겼는지
3. `docs/CHANGELOG.md` — 최근에 뭘 바꿨는지

더 자세한 건 `docs/AI_HANDOFF.md` (필수 아님)

---

## 지금 상태 (한 줄씩)

**된 것**
- 메인 지도, 중앙광장, 영토 게시판, 로그인 UI
- **ProfileFrame** 프로필 (PNG + 글자·게이지·성향지도·업적 3칸)
- 성향 계산 **브라우저 데모** (localStorage)
- localhost **좌표 에디터** (프로필 글자 위치 조정)

**아직 안 된 것**
- 로그인 유저 **실제 데이터** 연결
- 성향 **서버 저장**
- 아바타, 결제, 영토전
- 프로필 성향지도 ↔ 게시판 성향 **연결** (지금은 더미 숫자)

---

## 성향 — 꼭 알 것 (쉬운 버전)

### 유저 성향은 3가지 숫자가 쌓임
- **수호(보수)** · **중도** · **개척(진보)**  
- 저장: 브라우저 `sc_political_scores_v1`

### 뭐 하면 바뀌나?

| 행동 | 성향 바뀜? |
|------|------------|
| 남 글 **좋아요** | ✅ O (나는 글쓴이 반대쪽으로, 글쓴이는 나 방향으로) |
| 남 글 **싫어요** | ✅ O (약하게, 싫어요는 더 약함) |
| **공감** 버튼 | ❌ X (성향 안 바뀜) |
| 글/댓글 **쓰기** | ❌ X (경험치만 +25/+12) |
| 데일리 이슈 **관점 고르기** | ✅ O (조금) |
| 데일리 이슈 댓글 | ❌ X (관점 선택만 성향에 영향) |

### 외계인 % (planetPct)
- 정치 성향이랑 **별개**
- 싫어요 많이 받으면 올라감 → 50% 넘으면 외계행성

### 프로필 성향 **지도**(4각형)
- `center` / `pioneer` / `guardian` / `alien` 숫자로 그림
- **게시판 성향이랑 아직 연결 안 됨** — `SC_PROFILE_DATA` 더미

### 숫자 자세히
→ `docs/ALIGNMENT_REACTION_TUNING.md`

---

## 건드리면 안 되는 것

- HTML **id** 이름 바꾸기
- `SC_PROFILE_LAYOUT` 좌표 (요청 없으면)
- 성향·레벨·팔로우 **JS 로직** (요청 없으면)
- UI만 고칠 때: `index.html` **`<style>`** 안에서

## 영토 색

```js
element.dataset.territory = 'reform';  // centrist | reform | order | alien
```

---

## 작업 끝나면

- `docs/CHANGELOG.md`에 한 줄 추가
- `docs/TODO.md` 체크

---

## 자주 쓰는 파일

| 파일 | 뭐 있나 |
|------|---------|
| `public/index.html` | 화면 전부 |
| `public/alignment-scoring.js` | 성향 계산 공식 |
| `public/territory-beliefs.js` | 영토 신념 문장 |
| `config/world-territories.js` | 영토 규칙 |
