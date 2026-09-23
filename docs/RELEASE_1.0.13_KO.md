# aidot-mini 1.0.13 — 공개 파일 누락 검사 통합

기준: 첨부된 `aidot-mini-v1.0.12-full.zip`과 `aidot-mini-public-check.zip`.
작성·검증일: 2026-09-23. 소스 버전: **1.0.13**.

## 원인과 재현

`src/core/security.js`는 `./apiAuth.js`를 import하지만 `scripts/publish/public-files.json`에는 해당 파일이 없었습니다. Full에는 파일이 있으므로 Full에서 실행할 때는 정상이고, 공개 목록으로 내보낸 v1.0.12에서 `node start.js`를 실행하면 `ERR_MODULE_NOT_FOUND`와 `src/core/apiAuth.js`가 표시되며 종료됐습니다. 이 현상을 첨부 소스에서 실제로 재현했습니다.

기존 `publicEntries`/`verifySnapshot`은 선택된 파일의 안전성·존재·복사 결과·해시는 검사했지만, 선택 목록 자체가 필요한 import 대상을 빠뜨렸는지는 검사하지 않았습니다. `node --check` 중심의 문법 검사도 이 누락을 검출하지 못합니다.

동일한 `apiAuth.js` 누락이 AI Starter와 설치형 런타임의 명시적 파일 목록에도 있었습니다.

## 반영 내용

| 위치 | 변경 |
|---|---|
| `scripts/publish/public-files.json` | `src/core/apiAuth.js`, 검사기, 검사기 테스트, 이 안내를 공개 목록에 추가하고 `check:public` 명령을 공개 |
| `scripts/starter-files.json` | AI Starter에 `src/core/apiAuth.js` 포함 |
| `scripts/dist/runtime-files.json` | Windows/Linux/robot 설치형 공통 런타임에 `src/core/apiAuth.js` 포함 |
| `scripts/check-public.mjs` | 첨부 검사기의 Node 진입점→의존성 추적 방식을 통합·보완. Node 내장 모듈만 사용 |
| `scripts/publish/export-public.mjs` | 생성한 공개본의 파일·해시 검증에 의존성 완전성 검사를 추가 |
| `scripts/publish/sync-public.mjs` | GitHub 접근 전에 공개본 생성·검사. Git staging 전에도 재검사. `--dry-run`은 임시 공개본을 실제 생성·검사하고 삭제 |
| `.github/workflows/ci.yml` | Full·Public 모두 `npm run check:public`을 실행 |
| `tests/public-check.test.mjs`, `tests/publication.test.mjs` | 원래 누락 재현과 다시 누락됐을 때 게시가 중단되는 회귀 검사 |

검사기 보완 사항:

- **Full에서도 공개 목록 안에서만 해결**합니다. 같은 폴더에 있는 Full 전용 파일이나 공개되지 않는 하위 `package.json`을 근거로 통과하지 않습니다. Full 전용 npm 명령은 공개 대상에서 제외합니다.
- Public에서는 `PUBLIC_MANIFEST.json`의 파일 존재·중복·경로·SHA-256·버전 일치도 확인합니다. 명시적으로 지정한 매니페스트가 없으면 실패합니다.
- 정상 워크스페이스 별칭은 참고 정보로 표시하며 실패 건수에 넣지 않습니다. 상대 별칭의 적용 범위와 ESM 파일 경로는 실제 로더 규칙에 맞춥니다.
- `package.main`, `bin`, Node 실행 스크립트와 Python 실행 래퍼의 파일 경로를 확인합니다. 따옴표 경로·Node 옵션 뒤 진입점을 처리합니다.
- 문자열·주석·정규식 안의 import 예문은 제외하고, 리터럴 `import`/`export from`/`import()`/`require()`와 로더·Worker에서 쓰는 `new URL(..., import.meta.url)`을 추적합니다.

새 파일을 자동으로 공개 목록에 넣지는 않습니다. 빠진 파일을 오류로 알려주고, 검토한 파일을 명시적 정책에 추가하는 기존 방식은 유지합니다.

런타임 API·인증 구현·업무 소스·기존 migration은 변경하지 않았습니다. `workspace-eicu-pacs/`는 기존과 같이 Full에 보존됩니다.

## 버전 관리

`package.json`, 루트 `package-lock.json`의 두 버전 필드, `module.json`, `examples/product-module.json`, Windows 설치 스크립트의 기본 버전을 **1.0.13**으로 맞췄습니다. 기존 ZIP에서 일부 값이 1.0.11로 남아 있던 불일치도 정리했습니다. README와 현재 사용 안내, CHANGELOG, REVISION을 갱신했으며 과거 릴리스 검증 기록은 보존했습니다.

Full 내보내기의 `FULL_MANIFEST.json`에도 현재 버전과 파일별 SHA-256을 기록합니다. Full 정책은 2,316개, Public 정책은 2,195개 파일이며 각각의 생성 매니페스트는 별도 1개입니다. 독립 Product 클라이언트 패키지는 코드 변경이 없어 기존 버전 1.0.7을 유지합니다.

## 적용·공개 순서

ZIP 안의 `aidot-mini` 폴더 **내부 파일**을 기존 Full 프로젝트 폴더에 덮어씁니다. 프로젝트 폴더 자체를 삭제하지 마세요. ZIP에는 실제 `.env`, 계정·DB·업로드 데이터, `node_modules`, 캐시, 빌드된 배포물이 들어 있지 않습니다.

기존 Full 프로젝트 폴더에서 실행합니다.

```powershell
npm ci --ignore-scripts
npm run check:public
npm run push
npm run sync:public
```

- `check:public`: 공개 정책·의존성 검사. GitHub 설정·토큰·접속 불필요.
- `push`: 기존 `.env` 설정으로 Full 비공개 저장소의 소스를 갱신.
- `sync:public`: 공개본 생성·검사를 통과한 후 기존 공개 저장소의 브랜치를 갱신.

실제 원격 반영 전에 내보내기까지 검사하려면 다음을 실행합니다. 이 명령에는 기존 GitHub 저장소·브랜치 설정이 필요하지만 원격 접속은 하지 않습니다.

```powershell
npm run sync:public -- --dry-run
```

공개된 저장소에서도 아래 명령을 그대로 사용할 수 있습니다.

```powershell
npm ci --ignore-scripts
npm run check:public
npm start
```

선택한 공개본을 직접 검사하는 예:

```powershell
node scripts/check-public.mjs --root D:\release\aidot-mini-public
node scripts/check-public.mjs --root D:\release\aidot-mini-public --quiet
node scripts/check-public.mjs --files whitelist.txt
```

`--files`는 한 줄 한 경로(주석은 `#`)의 목록이며, 해당 트리의 `package.json`을 그대로 검사합니다. Full의 공개용 npm script 필터까지 반영하려면 기본 `npm run check:public` 또는 실제 내보낸 Public을 사용하세요. 명시적 `--manifest`와 `--files` 경로는 명령을 실행한 현재 폴더 기준입니다.

`sync:public`은 소스 브랜치를 갱신하는 명령입니다. GitHub Draft Release와 설치 파일 업로드는 별도 `release:github` 명령이며, **1.0.13 설치 파일을 다시 빌드한 뒤** 사용합니다. 1.0.11/1.0.12 바이너리를 1.0.13으로 이름만 바꾸어 사용하지 않습니다.

## 실제 검증 결과

호스트: **aidot-mini / Linux x64 / Node v24.19.0 / SQLite 3.53.3**.

| 검사 | 결과 |
|---|---|
| 기존 1.0.12 공개본 `node start.js` | `src/core/apiAuth.js` 누락으로 기동 실패 재현 |
| Full `npm run check:public` | 공개 대상 2,195개·진입점 32개·코드 73개·참조 348건 통과 |
| 생성된 Public `npm run check:public` | 동일 의존성 및 매니페스트 검증 통과 |
| Full `npm run verify` | 문법 147/147, declaration 계약, 회귀 **198/198**, Product HTTP **56/56** 통과 |
| Public `npm run verify` | 문법 118/118, declaration 계약, 회귀 **183/183**, Product HTTP **56/56** 통과 |
| 검사기 전용 회귀 | **12/12** 통과. 계산된 경로 문자열을 정적 import로 오인하지 않는 보완 후 재실행 |
| 잘못된 공개 목록 회귀 | Full에 apiAuth.js를 남겨두고 공개 목록에서만 제거하면 export 실패. 이 공개본의 publish도 Git 저장소 생성 전 실패 |
| 기존 게시 회귀 | 로컬 bare Git 저장소에서 히스토리 보존·변경 없음·브랜치·실행 권한·실패 진단 검사 통과 |
| 공개본 실제 `node start.js` | `/health`, `/health/ready`, `/api/notes`, `/` 모두 HTTP 200; 버전 1.0.13 |
| 생성·압축 해제한 AI Starter 실제 `node start.js` | health·ready·Note API HTTP 200; 콘솔 `/`는 의도한 HTTP 404 |
| ROS Python 단위 검사 | **12/12** 통과 |
| Product 클라이언트 | `format:check`, `build` 통과 |

검사기는 정적 참조 검사이며 완전한 JavaScript/TypeScript 파서나 모든 npm 조건부 export의 해석기는 아닙니다. 변수·계산식·동적 템플릿으로 만들어지는 경로와 실행 시 내려받는 파일, 브라우저 번들 전체는 보증하지 않습니다. 이번에는 실제 Public·Starter 기동 및 Public 회귀 검사로 현재 소스의 실행도 별도로 확인했습니다.

이번 작업에서 실제 GitHub push·Release 업로드 및 Windows/Android 기기 실행, 새 설치 바이너리 빌드는 수행하지 않았습니다. 이전 버전의 플랫폼 검증 기록을 이번 실행 결과로 간주하지 않습니다.
