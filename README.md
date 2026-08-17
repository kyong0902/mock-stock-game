# 모의주식투자 (초등학생 경제교육용)

닉네임만 입력하면 바로 참여할 수 있는 온라인 모의주식투자 게임입니다. 30개의 가상 종목(실제 기업을 연상시키는 패러디 이름)이 호재/악재, 거시경제, 실적발표 뉴스에 따라 실시간으로 움직이고, 동전주 2개는 "묻지마 투자"의 위험(펌프 후 상장폐지)을 직접 경험하도록 설계되어 있습니다. 가진 돈을 모두 잃으면 파산 처리되어 게임이 종료됩니다.

## 화면 구성
- `/` : 학생 입장 (닉네임 입력)
- `/game.html` : 학생 거래 화면
- `/bankrupt.html` : 파산 안내 화면 (자동 이동)
- `/results.html` : 최종 순위 화면 (프로젝터로 크게 띄워서 사용)
- `/admin.html` : 교사 관리 화면 (비밀번호 필요)

## 1. 로컬에서 먼저 실행해보기

```
npm install
copy .env.example .env    (Mac/Linux는 cp .env.example .env)
npm start
```

`.env` 파일을 열어 `ADMIN_PASSWORD`를 원하는 비밀번호로 바꿔두세요.

브라우저에서 `http://localhost:3000` 접속 → 닉네임 입력해서 거래 테스트, `http://localhost:3000/admin.html`에서 관리자 기능 테스트.

> Node.js 22.5 이상이 필요합니다 (내장 SQLite 모듈 사용, 별도 컴파일 불필요).

## 2. 온라인 배포 (Render 무료 Web Service)

학생들이 "URL 하나로 누구나" 접속하게 하려면 인터넷에 배포해야 합니다. 아래는 무료로 가능한 Render.com 기준 절차입니다.

### 2-1. GitHub에 코드 올리기
1. https://github.com 에서 계정이 없다면 가입
2. 새 저장소(Repository) 생성 (예: `mock-stock-game`, Public 또는 Private 무관)
3. 이 프로젝트 폴더에서 아래 명령 실행 (본인 저장소 주소로 변경):
   ```
   git init
   git add .
   git commit -m "초등학생 모의주식투자 게임"
   git branch -M main
   git remote add origin https://github.com/본인아이디/mock-stock-game.git
   git push -u origin main
   ```

### 2-2. Render에 배포
1. https://render.com 가입 (GitHub 계정으로 로그인 가능)
2. Dashboard → **New** → **Web Service**
3. 방금 만든 GitHub 저장소 선택
4. 설정값 입력
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
5. **Environment** 탭에서 환경변수 추가
   - `ADMIN_PASSWORD` = 원하는 관리자 비밀번호
   - `START_CASH` = `1000000` (원하는 시작 자금)
6. **Create Web Service** 클릭 → 몇 분 후 `https://xxxx.onrender.com` 같은 주소가 발급됨

이 주소를 학생들에게 공유하면 누구나 접속해 참여할 수 있습니다. 교사는 `주소/admin.html`로 접속해 관리, `주소/results.html`을 프로젝터로 띄워 최종 순위를 함께 확인하면 됩니다.

### 주의사항
- **무료 티어 슬립**: 일정 시간 접속이 없으면 서버가 잠들어, 첫 접속 시 30~50초 정도 로딩될 수 있습니다. 수업 시작 5~10분 전에 미리 한 번 접속해 깨워두세요.
- **재배포 시 데이터 초기화 가능**: 코드를 다시 배포(재배포)하면 그동안 쌓인 학생 데이터가 사라질 수 있습니다. 수업 중간에 데이터를 지우고 싶을 땐 재배포 대신 관리자 화면의 **"전체 초기화"** 버튼을 사용하세요.
- 매 수업(반)마다 새로 시작하려면 관리자 화면에서 전체 초기화를 눌러주세요.

## 3. 수업 진행 팁
1. 수업 시작 전: 관리자 화면(`/admin.html`)에서 전체 초기화 → 거래 시작 상태 확인
2. 학생들에게 사이트 주소 공유 → 각자 닉네임으로 입장
3. 수업 중: 관리자 화면의 "수동 이벤트 발동"으로 특정 종목에 호재/악재를 직접 터뜨려 설명 자료로 활용 가능
4. 수업 마무리: "게임 종료" 버튼 → `/results.html`을 프로젝터로 띄워 최종 순위 발표
5. 다음 반 수업 전: 다시 "전체 초기화"

## 기술 스택
Node.js(Express, Socket.IO) + 내장 SQLite(`node:sqlite`) + 순수 HTML/CSS/JS. 빌드 과정이 없어 배포가 간단합니다.
