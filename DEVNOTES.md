# 경제퀴즈 개발 노트 (CashQuiz에서 물려받음)

앱인토스 미니앱을 만들면서 실제로 부딪혔던 개념 정리. 다음에 비슷한 미니앱을 만들 때 참고용.

## 1. 헷갈리기 쉬운 CLI 두 개

같은 "앱인토스"라도 역할이 다른 두 도구가 있다.

| 도구 | 정체 | 용도 |
|---|---|---|
| `ax` (`@apps-in-toss/ax`) | AI 어시스턴트용 **MCP 서버** | 개발 중 문서 검색 (`ax mcp`) |
| `ait` (`@apps-in-toss/cli`, `web-framework`에 포함) | **빌드/배포 CLI** | `ait init` / `ait build` / `ait deploy` |

이름이 비슷해서 문서에서도 "ax CLI를 설치하고 ax mcp 연결"이라고만 나오면 헷갈리는데, 실제 앱 빌드·배포는 전부 `ait`가 한다.

## 2. MCP 연결은 두 종류 — 로컬 vs OAuth

- `claude mcp add apps-in-toss -- ax mcp` — **로컬 프로세스**를 stdio로 붙이는 방식. 즉시 연결됨.
- `claude mcp add apps-in-toss-console --transport http ... --client-id mcp-gateway` — **OAuth 인증**이 필요한 방식. `claude mcp login <name>`으로 브라우저 로그인을 완료해야 하는데, 이건 **로컬 콜백(localhost:포트)을 받아야 해서 반드시 실제 대화형 터미널**에서 실행해야 한다. 비대화형 환경(자동화 스크립트 등)에서는 완료가 안 된다.

## 3. 설정 파일 이름이 버전마다 다르다

문서를 검색하면 `granite.config.ts`라는 이름이 나오는데, 이건 **SDK 2.x(레거시)** 이름이고, 3.x는 `apps-in-toss.config.ts`다. (`ait migrate v3`로 변환 가능) 문서보다 **실제로 설치된 CLI가 뭘 요구하는지**(`ait build` 에러 메시지, 또는 `node_modules` 안의 소스)가 더 믿을 만한 근거였다.

```ts
// apps-in-toss.config.ts — 실제로 필요한 필드는 이게 전부
import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'cash-quiz',       // kebab-case, 필수, 등록 후 불변
  brand: { primaryColor: '#3D5AFE' }, // 필수
  permissions: [],
  webBundleDir: 'dist',
});
```

## 4. `appName`은 등록 후 못 바꾼다 — 콘솔과 반드시 일치

`appName`이 `intoss://{appName}` 딥링크의 기준이 되고, **한번 콘솔에 등록하면 변경 불가**다. 로컬 설정 파일의 값과 콘솔에 실제 등록된 값이 한 글자라도 다르면(`cashquiz` vs `cash-quiz`처럼) 딥링크/테스트가 어긋난다. 코드보다 **콘솔 화면을 최종 진실로 삼아야** 하는 이유다.

## 5. 사용자 식별 — 앱 유형에 따라 함수가 다르다

| 앱 유형 | 함수 | 비고 |
|---|---|---|
| 게임 | `getUserKeyForGame()` | 토스앱 5.232.0+ 필요 |
| 비게임(퀴즈 등) | `getAnonymousKey()` | SDK 2.4.5+ 필요 |

두 함수 다 반환값이 4가지 케이스다: `{type:'HASH', hash}`(성공) / `'INVALID_CATEGORY'`(앱 유형 잘못 지정) / `'ERROR'` / `undefined`(SDK 버전 낮음). 이 hash는 **서버 인증용이 아니라 내부 데이터 식별용**이라는 점도 중요하다.

```js
import { getAnonymousKey } from '@apps-in-toss/web-framework';

const res = await getAnonymousKey();
if (res && res !== 'INVALID_CATEGORY' && res !== 'ERROR' && res.type === 'HASH') {
  const userKey = res.hash; // 이 값을 저장/랭킹 등의 식별자로 사용
}
```

## 6. 토스 앱 없이도 개발할 수 있다 — `@apps-in-toss/devtools`

Vite/Webpack 플러그인 형태로 붙는 **mock SDK + 플로팅 패널**이다. `npm run dev`만 실행하면 브라우저에서 바로 SDK 호출(로그인, 결제, 광고 등)이 mock으로 동작해서, 토스 앱 없이도 화면 로직을 검증할 수 있다. 프로덕션 빌드에서는 자동으로 완전히 빠진다(0바이트).

```ts
// vite.config.js
import aitDevtools from '@apps-in-toss/devtools/unplugin';

export default defineConfig(({ command }) => ({
  plugins: [...(command === 'serve' ? [aitDevtools.vite()] : [])],
}));
```

## 7. 빌드 → 배포 파이프라인

```
vite build   → 웹 번들(dist/) 생성
ait build    → dist/를 .ait 파일로 패키징 (100MB 이하 제한)
콘솔 업로드 또는 ait deploy --api-key   → QR 발급 → 실기기 테스트
```

`ait build`는 로그인 없이 로컬에서 되고, 실기기에 올리는 단계(콘솔 업로드/`ait deploy`)부터 인증이 필요하다.

## 8. 이름 비슷한 비공식 패키지 주의

npm에 `@apps-in-toss/*`(공식, `apps-in-toss-bot` 계정)와 이름만 비슷한 `@ait-co/console-cli`(개인 개발자, "로그인 한 번으로 콘솔 자동화" 광고) 같은 패키지가 있었다. 금융 서비스 콘솔 자격 증명을 다루는 도구는 **스코프(`@apps-in-toss`)와 메인테이너를 꼭 확인**하고 설치해야 한다.

## 9. 그 밖에 실제로 겪은 사소한 함정

- `npx ait init`은 **대화형 프롬프트**(웹 번들 디렉토리 입력)가 있어서 비대화형 환경에서는 중간에 멈춘다 — 필요하면 설정 파일을 직접 작성하는 게 더 빠르다.
- `npm run build` 스크립트 체인(`vite build && ait build`)을 여러 번 초기화하면 `&& ait build`가 중복으로 붙을 수 있으니 `package.json`을 한 번 확인하는 게 안전하다.
- 앱 표시 이름(콘솔의 "앱 이름")과 `appName`(딥링크 스킴)은 별개다 — 표시 이름은 나중에 바꿔도 되지만 `appName`은 안 된다.
