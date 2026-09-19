> 이전 1.0.6 검토·검증 기록입니다. 현재 Full·Starter 1.0.7 결과는 서버 루트의 docs/RELEASE_1.0.7_KO.md와 docs/VERIFICATION_1.0.7.md를 확인하세요.

# 실행 검증 — 1.0.6 검토 수정본

이번 세션의 실제 실행 결과다. 환경은 Linux x64, Node **24.19.0**, npm 11.9.0, SQLite, Chromium **153.0.8010.0**이다. 최종 Express 기준은 사용자가 첨부한 **aidot-express 1.45.8 Full**이며 프레임워크 소스 변경 없이 실행했다. GitHub mini 기준은 fdff6332b21058baaed7328fb6e334c06521d717이다.

| 검사 | 실제 결과 | 증거 |
|---|---|---|
| mini `npm run verify` | 구문 99/99, metadata 일치, 회귀 105/105, Product HTTP 56 통과 | verification-1.0.6/mini-verify.log |
| mini 상세 Product 계약 | 86개 검증, HTTP 112회 통과 | mini-product-contract.log |
| Express 상세 Product 계약 | 88개 검증, HTTP 118회 통과 | express-product-contract.log |
| Express `.env` 전용 workspace | 수정된 동일 Product 소스, HTTP 58 통과 | express-dotenv-product.log |
| Express Note 복사 | 공개 HTTP 16회, 인증 HTTP 21회 통과 | express-note.log |
| Express 기존 check | 구문 409/409, Vue 참조 114, SQL 이름 61 통과 | express-check.log |
| Express 기존 보안 검사 | 17/17 통과 | express-security.log |
| Vue store/수명 검사 | mini 모드 7/7, express 모드 7/7 통과 | client-*-unit.log |
| Vue format / production build | 모두 통과, 91 modules 빌드 | client-format.log, client-build.log |
| 실제 mini + Vue + Chromium | 12/12, JavaScript 예외 0 | browser-mini/result.json |
| 실제 Express + 같은 Vue + Chromium | 12/12, JavaScript 예외 0 | browser-express/result.json |
| 새로 푼 API Starter | npm ci, 구문 70/70, metadata, Note HTTP 15, Product HTTP 56 통과 | starter-verify.log |

구문 개수는 해당 gate 실행 시점 기준이다. 이후 추가한 재현용 `verify-express-note.mjs`와 `.env` 옵션도 별도 구문 및 실제 실행 확인을 했다. 105개 회귀 검사는 원래 upstream 104개와 공통 PNG/JPEG/WebP/MIME 계약 검사 1개다. 로그의 의도된 401/403/503/잘못된 JSON 에러는 실패 응답을 검사하는 테스트 출력이며 최종 실패 수는 0이다.

## 실제로 확인한 동작

Product의 동일 Controller·Service·SQL을 공백을 포함한 외부 workspace로 복사했다. source SHA-256이 두 서버에서 같고 시작/재시작 후에도 바뀌지 않는지 검사했다. path > body > query 우선순위, 반복 query key, 잘못된 ID·입력 타입, 네 가지 정렬의 동률 페이지, 외부 migration의 단일 적용, DB 재시작 유지, 인증 및 mini metadata 재생성을 확인했다.

원본 Express Product의 role:user 관리자 영역 계정은 POST 201/PUT 200/DELETE 200으로 허용되었다. 수정된 Product `roles:['admin']`는 같은 세 요청을 403으로 차단한다. 원본 문제를 재현한 로그를 수정 후 통과 로그와 별도로 보관했다.

기존 Product HTTP 검사는 이미지 업로드/MIME/크기/잘못된 multipart, 공개 PNG 바이트/헤더, 일반 multipart/base64, 같은 파일명 동시 업로드, image_path DB 저장, 재시작, Snack 데이터 보존, 연결 해제와 상품 삭제 후 파일 유지까지 검사한다.

브라우저 검사는 실제 로그인·세션 복원·목록·검색·크기·정렬·로컬 이미지 미리보기·잘못된 파일 후 미리보기 보존·업로드 후 DB 저장·수정·이미지 제거·390px 모바일 레이아웃·삭제 취소·삭제 중 화면 이동·로그아웃을 확인한다. 저장 재시도 검사는 한 번의 상품 저장 응답을 의도적으로 HTTP 503으로 대체해 URL 재사용과 중복 업로드 방지를 확인했다. 실제 DB 장애를 발생시킨 운영 복구 시험은 아니다.

## 재현 명령

mini 루트:

```sh
npm ci --ignore-scripts
npm run verify
npm run product:contract
```

Express도 먼저 해당 루트에서 lockfile 의존성을 설치한다. 아래는 mini 루트에서 실행하는 Bash 예다. 테스트는 임시 DB·계정·PUBLIC_DIR를 사용한다.

```sh
EXPRESS_PROJECT_ROOT=/path/to/aidot-express node scripts/verify-product.mjs
EXPRESS_PROJECT_ROOT=/path/to/aidot-express node scripts/verify-product-contract.mjs
EXPRESS_PROJECT_ROOT=/path/to/aidot-express EXPRESS_WORKSPACE_FROM_ENV_FILE=1 node scripts/verify-product.mjs
EXPRESS_PROJECT_ROOT=/path/to/aidot-express node scripts/verify-express-note.mjs
```

클라이언트:

```sh
npm ci
npm test
VITE_AUTH_MODE=express npm test
npm run format:check
npm run build
```

`npm run test:browser`는 별도의 Playwright와 Chromium이 설치된 QA 환경을 사용한다. `PLAYWRIGHT_MODULE`은 설치된 Playwright의 index.mjs 절대 경로, `BROWSER_EXECUTABLE`은 Chromium 경로를 지정할 수 있다. 두 값이 없으면 기본 `playwright` 패키지와 그 브라우저를 사용한다. 이 QA 도구를 앱의 런타임 의존성에 추가하지 않았다. standalone client 검사에는 `QA_PROJECT_ROOT`로 mini 전체 소스 경로를 지정한다. Express 브라우저 검사는 `EXPRESS_PROJECT_ROOT`도 지정한다.

## 이번에 검증하지 않은 범위

MariaDB/Oracle 실제 통합 실행, Windows 사용자 PC, Android/Electron/ROS 장치 빌드·실행, 운영 reverse proxy/HTTPS 배포, 부하 시험은 수행하지 않았다. Node 22의 최소 지원 버전 실행도 이번에는 따로 수행하지 않았다. 로컬 Linux에서 요청 범위의 API·브라우저 검증을 수행할 수 있어 사용자 PC 원격 접속은 사용하지 않았다.

Express access token 만료 후 자동 재발급 interceptor는 추가하지 않았다. 장시간 페이지를 유지하다 인증이 만료되면 재로그인하거나 새로고침 시 기존 refresh 흐름을 사용한다. 공개 파일 정리, 완전한 이미지 decode/re-encode, 대량 조회 정책도 별도 운영 개선 사항이다.

첨부물에서 상속한 `docs/screenshots`, `browser-verification-*.json`, DEPENDENCIES.json은 이전 자료다. 이번 증거는 **verification-1.0.6/**만을 기준으로 한다. 이번에는 의존성 최신 여부를 재선정하지 않고 lockfile 고정 버전을 설치·검증했다.
