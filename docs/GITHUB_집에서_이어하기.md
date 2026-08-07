# GitHub에 올려서 집에서 이어하기 (쉬운 순서)

## 한 줄 요약

**지금 컴퓨터**에서 폴더를 **한 번 GitHub에 밀어 올리고(push)**  
**집 컴퓨터**에서는 **복제(clone)** 해서 같은 폴더를 받으면 됩니다.

---

## 그림으로

```mermaid
flowchart LR
  A[지금 PC 폴더] -->|push| B[GitHub]
  B -->|clone| C[집 PC 폴더]
```

---

## 0) 미리 준비 (두 대 다)

1. **Git 설치**  
   - Windows: [https://git-scm.com/download/win](https://git-scm.com/download/win)  
   - 설치 후 **터미널을 다시 열고** `git --version` 이 나오면 OK.

2. **GitHub 계정**  
   - [https://github.com](https://github.com) 에 로그인.

---

## 1) GitHub에서 빈 저장소 만들기

1. GitHub 오른쪽 위 **+** → **New repository**
2. **Repository name** 예: `sentencecraft`
3. **Public** 선택 (비공개도 가능)
4. **README 추가는 처음엔 안 해도 됨** (로컬에 이미 파일이 많으면 충돌 줄이려고 비워 두기도 함)
5. **Create repository** 클릭
6. 다음 화면에 나오는 주소를 복사해 둡니다.  
   - 예: `https://github.com/내아이디/sentencecraft.git`

---

## 2) 지금 PC — 폴더를 Git에 넣고 올리기

터미널(또는 Cursor 터미널)에서 **프로젝트 폴더**로 이동한 뒤:

```bash
cd Desktop\sentence-craft
```

아래를 **위에서부터 한 줄씩** 실행합니다. (`내아이디`, `저장소이름`은 본인 것으로 바꾸세요.)

```bash
git init
git add .
git status
git commit -m "센텐스크래프트 베타 작업 저장"
git branch -M main
git remote add origin https://github.com/내아이디/저장소이름.git
git push -u origin main
```

- 처음 `git push` 할 때 **GitHub 로그인** 창이 뜰 수 있어요. 안내에 따라 하면 됩니다.
- **`git commit` 할 때** `.env` 는 **올라가면 안 됩니다.**  
  이 프로젝트에는 이미 `.gitignore` 에 `.env` 가 들어 있어서, 보통은 자동으로 빠집니다.  
  `git status` 에 **`.env`가 보이면** 절대 커밋하지 말고 알려주세요.

---

## 3) 집 PC — 받아오기

```bash
cd 원하는폴더
git clone https://github.com/내아이디/저장소이름.git
cd 저장소이름
npm install
```

그다음 **집에만 있는 비밀 정보**:

- `.env.example` 을 복사해서 이름을 **`.env`** 로 바꾼 뒤  
  Supabase **URL** 과 **anon 키**를 다시 넣기 (집 PC에는 예전 `.env` 가 없을 수 있음)

```bash
npm start
```

브라우저에서 `http://localhost:3000` 으로 확인.

---

## 나중에 “집에서 고친 걸 다시 회사로” 올릴 때

집 폴더에서:

```bash
git add .
git commit -m "집에서 수정한 내용 한 줄 설명"
git push
```

회사 PC에서는:

```bash
git pull
```

---

## Git이 너무 어렵다면

**GitHub Desktop** ([https://desktop.github.com](https://desktop.github.com)) 을 쓰면  
버튼으로 **commit / push / pull** 할 수 있어요. 위 순서는 같고, 명령 대신 화면만 다릅니다.

---

## 자주 나는 문제

| 증상 | 할 일 |
|------|--------|
| `git` 을 찾을 수 없음 | Git for Windows 설치 후 터미널 재시작 |
| `push` 거절 | GitHub에 로그인·권한 확인, 저장소 주소 오타 확인 |
| `.env` 가 올라갈 뻔함 | `git status` 에서 제거 후 `.gitignore` 확인 |

### `remote: Repository not found` 가 나올 때

GitHub 웹을 **켜 둘 필요는 없고**, 아래를 순서대로 확인하세요.

1. **저장소가 실제로 있는지**  
   브라우저에서 `https://github.com/본인아이디/저장소이름` 이 열리는지 확인합니다.  
   **이름 한 글자라도 다르면** 푸시가 안 됩니다.  
   현재 정식 저장소: `https://github.com/kyb041028-ctrl/sentencecraft`  
   (과거 저장소명: `sentnse_craft` → `sentence-craft` — 현재 사용 금지)

2. **로컬 `origin` 주소가 위와 똑같은지**  
   프로젝트 폴더에서:

   ```bash
   git remote -v
   ```

   잘못됐으면 바꿉니다 (본인 주소로 수정):

   ```bash
   git remote set-url origin https://github.com/본인아이디/저장소이름.git
   ```

   가능하면 **`https://` 로 시작**하게 두는 것이 좋습니다.

3. **비공개(Private) 저장소**인데 로그인·토큰이 없으면  
   GitHub는 보안상 이유로 **같은 "not found" 메시지**를 줄 수 있습니다.  
   - Windows: 자격 증명 관리자에서 github.com 항목 확인, 또는  
   - GitHub **Settings → Developer settings → Personal access tokens** 에서 `repo` 권한 토큰을 만들고, 푸시할 때 비밀번호 대신 토큰 입력

4. **아직 GitHub에 저장소를 안 만들었으면**  
   GitHub에서 **New repository** 로 빈 저장소를 만든 뒤, 위 2번처럼 `origin` 을 그 주소로 맞춘 다음 다시 `git push -u origin main` 합니다.

이 문서는 프로젝트 안 `docs/GITHUB_집에서_이어하기.md` 에 저장해 두었습니다.

---

## ★ 작업 끝날 때마다 GitHub에 저장 (여기 PC에서)

**매번** 프로젝트 폴더에서 터미널을 열고, 아래만 순서대로 하면 됩니다.

```bash
cd "C:\Users\포키\OneDrive\Desktop\sentence-craft"
git add .
git status
```

- **`.env` 가 목록에 보이면** 커밋하지 말 것. (보통은 안 보임)

```bash
git commit -m "오늘 한 일 한 줄로 적기"
git push
```

**한 줄 기억:** `git add .` → `git status` 확인 → `git commit` → `git push`

---

## ★ 집에서 처음 열 때 (다음에 다시 볼 때)

1. **Git 설치** + `git --version` 확인  
2. 폴더 만들 위치에서:

```bash
git clone https://github.com/본인아이디/저장소이름.git
cd 저장소이름
npm install
```

3. **`.env`** — `.env.example` 복사 → `.env` 로 이름 바꾸고 Supabase 값 입력  
4. `npm start` → 브라우저 `http://localhost:3000`

이미 집에 폴더가 있다면 **처음이 아니라** 그 폴더에서만:

```bash
git pull
npm install
```

(`package.json` 이 바뀌었을 때만 `npm install` 다시 해도 됨.)

---

## ★ 명령 앞에 `git` 붙이기 (헷갈릴 때)

| 잘못 친 예 | 올바른 예 |
|------------|-----------|
| `add .` | `git add .` |
| `status` | `git status` |
| `push` | `git push` |

---

## 처음 한 번만: 커밋할 때 이름·이메일

에러 `Author identity unknown` 이 나오면 **한 번만**:

```bash
git config --global user.email "본인이메일@example.com"
git config --global user.name "본인이름"
```

그 다음부터는 `git commit` 이 됩니다.
