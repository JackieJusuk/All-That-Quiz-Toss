# 올댓퀴즈(All-That-Quiz)

CashQuiz-toss를 복제해 경제 상식 퀴즈로 바꾼 앱인토스 미니앱. 인프라(Render·Supabase·앱인토스 앱/광고 그룹)는 CashQuiz와 분리한다 — 초기 설정 체크리스트는 `requirements.md` §12.0.

작업 시작 전에 **`requirements.md`의 §13 설계 원칙**을 먼저 확인하세요. 새 기능을 추가하거나 화면/문구를 바꿀 때 지켜야 할 규칙들이 정리되어 있고, 이 문서가 기능·설계 원칙의 단일 진실 공급원(source of truth)입니다.

특히 화면/UI를 수정하거나 새 화면·모달을 추가할 때는 **§13 원칙 16(반응형 레이아웃)을 항상 먼저 적용**하세요:

> 모든 화면의 메뉴/버튼은 **스크롤 없이 한 화면에 다 보이는 것을 1차 목표**로 한다. 폰트·여백·버튼 크기를 `clamp()` 등으로 화면 크기에 비례해 줄이되, `vh`/`vw` 값이 실제로 최소~최대 사이를 오가는지 직접 계산해서 확인한다(한쪽 끝에 고정되면 아무 효과 없음). `overflow-y:auto`(또는 `.scroll` 클래스)로 **페이지 전체**를 스크롤시키는 건 그래도 안 들어가는 극단적으로 작은 화면을 위한 **최후의 안전장치**로만 쓴다. **목록/카드 안에 별도의 작은 내부 스크롤 박스를 만들어 콘텐츠를 숨기지 않는다** — 사용자가 스크롤이 되는 줄 모르고 "안 보인다"고 느낀다(실제로 겪은 실패 사례, §3.14). 늘어나는 목록은 내부 스크롤보다 행을 압축해서 전부 펼쳐 보여주는 쪽을 우선한다. 작은 화면(예: 360×640, 콘텐츠 영역 기준 600px 높이)을 포함한 **여러 뷰포트 크기로 직접 렌더링해 확인**한다 — 데스크톱 미리보기 하나만으로 판단하지 않는다.
>
> 이 세션(샌드박스) 환경은 HTTPS가 자체 서명 프록시를 거쳐서, Playwright 기본 Chromium은 Google Fonts 로드가 인증서 오류로 조용히 실패하고 폴백 폰트로 렌더링된다 — 실제 웹폰트 렌더링을 확인하려면 `chromium.launch({ args: ['--ignore-certificate-errors'] })`로 띄우고 로컬 HTTP 서버로 서빙해서 검증한다.

배경과 실제 발생했던 문제(결과 화면 버튼이 작은 화면에서 눌리지 않던 사례)는 `requirements.md` §3.14 참고.

**§13 원칙 17(글씨체 통일)도 항상 지키세요**: 앱 전체에서 글씨체는 하나(`Gothic A1`)로 통일한다. 화면·항목별로 다른 폰트 패밀리를 섞어 쓰지 않는다 — 구분은 색상/굵기/크기로 한다. 숫자용으로 쓰던 `--font-mono`도 `--font-kr`을 그대로 가리키도록 통합되어 있다(`src/style.css`). 새 폰트를 추가하기 전에 이미 로드된 `Gothic A1`으로 원하는 효과를 낼 수 없는지 먼저 확인한다.

**§13 원칙 22(대원칙: 한국 사용자에 최적화된 System Architecture)**: 이 프로젝트와 이후 모든 프로젝트의 요구사항이다. 서버·DB 등 리전을 고르는 구성요소는 **서울 → 도쿄 → 싱가포르** 순으로 가장 가까운 리전을 명시해서 만들고(서비스 기본값인 미국 리전을 그대로 두지 않는다), 서버와 DB는 서로 가까이 둔다. 날짜 경계는 KST로 계산하고, 결정한 리전과 실측 응답 시간을 §6/§6.1에 기록한다. 실제 사례: 오레곤 서버 + 도쿄 DB로 지연 발생 → 싱가포르로 재구축(§3.11, §6.1).

**§13 원칙 19(대원칙: System Architecture Diagram 유지)**: 새 구성요소(외부 서비스, 배포 대상 등)가 추가되거나 배포/통신 흐름이 바뀌는 작업을 할 때는 `requirements.md` §6에 링크된 System Architecture Diagram(1장, C4 Container 레벨)도 함께 갱신한다. 다이어그램: https://claude.ai/artifact/9kNU1bjivb63kdH6dyXfXY (원본 CashQuiz 다이어그램: https://claude.ai/artifact/DtuVUQuyPXfpF1rEMq3ZCy)

## 프로젝트 구조
- `server/index.js`: 백엔드 (Express + Supabase + Anthropic API, Render에 배포)
- `server/seed/invest_questions.json`: 재테크 주제 초기 문제(CashQuiz에서 이관, 서버 시작 시 DB에 없으면 자동 추가)
- `supabase/schema.sql`: DB 스키마 (새 Supabase 프로젝트에서 1회 실행), `supabase/aggregates.sql`: 점수·랭킹 집계 SQL 함수(schema.sql 다음에 실행), `render.yaml`: Render 블루프린트
- **집계는 DB에서**: Supabase 조회는 1회 최대 1,000행이라, 기록을 통째로 가져와 서버에서 더하지 말고 `aggregates.sql`의 함수(`supabase.rpc`)로 합산한다(`requirements.md` §5)
- `src/main.js`, `src/style.css`, `index.html`: 프론트엔드 (앱인토스 미니앱, vanilla JS)
- `requirements.md`: 요구사항 명세서 — §13 설계 원칙은 항상 준수, §12는 남은 과제

## 배포 흐름
- **백엔드**: `master`에 push하면 Render가 자동배포 (직접 확인은 브라우저로 `https://all-that-quiz.onrender.com/api/...` 호출)
- **프론트**: `npm run build`(`vite build && ait build`)로 `.ait` 파일 생성 → 앱인토스 콘솔에 업로드
  - `ait deploy` CLI는 원인 불명의 403 Forbidden으로 현재 막혀있음(키/appName/권한 전부 정상 확인됨) → **콘솔 웹 화면에서 `.ait` 파일을 직접 업로드**하는 방식으로 우회 중
