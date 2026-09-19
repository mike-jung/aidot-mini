# aidot-mini 1.0.8 — Public source

**로봇·드론·모바일 단말을 위한 최소 API 실행 환경. aidot-express와 Controller·Service·SQL 파일의 무수정 이식, 즉 100% 동일 소스 호환을 설계 원칙으로 합니다.**

AI가 작성한 업무 코드를 작은 Starter에서 실행·검증하고, 같은 세 폴더를 장치의 aidot-mini 또는 서버의 aidot-express로 옮겨 사용합니다. 장치마다 업무 로직을 다시 작성하지 않고, 네트워크가 없는 환경에서도 로컬 API와 SQLite로 동작하도록 구성합니다.

핵심 런타임은 Node.js의 HTTP·SQLite 기능과 직접 npm 의존성 하나인 `esbuild-wasm`을 사용합니다. API 실행에 브라우저 UI, Vue, ROS 또는 별도 DB 서버가 필수는 아닙니다. 로봇·드론의 센서/제어 SDK와 ROS 브리지는 필요할 때 연결하며, 이 서버 자체가 비행 제어기나 실시간 안전 제어기를 대신하지는 않습니다.

## aidot-express 호환 범위

호환 기준은 **첨부 aidot-express 1.45.8 Full의 공통 업무 API 계약**입니다. 같은 Controller·Service·named SQL을 그대로 복사하고, `@aidot/core/...`와 `@aidot/database/...` import를 유지합니다.

| 그대로 이식하는 것 | 대상 환경에 맞게 별도로 준비하는 것 |
|---|---|
| `controller/`: 경로·HTTP 메서드·인증/권한 선언 | workspace 경로·포트·TLS 등 서버 설정 |
| `service/`: 입력 검증·업무 처리·공통 DB 호출 | DB 종류·설정·해당 DB의 schema/migration |
| `sql/`: 공통 adapter가 지원하는 named SQL·바인딩 | 기존 DB 데이터·계정·토큰·업로드 파일 |

이 원칙은 aidot-express의 모든 서버 기능·DB 드라이버를 mini에 포함한다는 뜻이 아닙니다. mini의 기본 DB는 SQLite입니다. DB 전용 SQL·외부 패키지·호스트 내부 경로에 의존하는 업무는 공통 계약에 맞춰 작성해야 합니다. Product의 공개 조회·관리자 쓰기·페이지·이미지 계약은 두 호스트에서 같은 소스로 교차 검증했습니다. 다른 업무는 그 업무의 HTTP 사례와 대상 DB로 확인합니다. [이식 지침](docs/PORTING.md)과 [API 작성 규칙](docs/AI_API_RULES_PRODUCT.md)을 기준으로 사용하세요.

## 필요한 배포물 선택

| 배포물 | 용도 | 대상에 Node 설치 |
|---|---|---|
| **AI Starter** | AI가 만든 Controller·Service·SQL의 컴파일·HTTP 검증. UI와 장치 빌드 도구 제외 | 필요 |
| **최소 런타임** | Windows·Linux 장치에서 업무 API 실행. Node와 작은 Note/Product 예제 포함 | 불필요 |
| **화면 포함 런타임** (`dist:win:full`) | Windows에서 관리 콘솔과 로봇 화면까지 사용 | 불필요 |
| **Full 소스** | 전체 개발·예제·장치 빌드·검증·게시 도구 유지보수 | 개발용으로 필요 |

AI Starter 1.0.7의 소스 ZIP은 약 **172KB**였습니다. 이는 Node 실행 파일과 설치된 의존성을 제외한 소스 크기이며, 플랫폼 배포물 크기나 실행 메모리를 뜻하지 않습니다. `dist:win:full`의 `full`은 관리 콘솔·로봇 화면을 추가하는 배포 옵션입니다. Vue Product 클라이언트는 Full **소스**에서 별도로 빌드합니다. 비공개 Full 게시 설정과 개발 자료를 공개 실행 파일에 넣지 않습니다.

## 소스에서 바로 실행

Node.js 22.19 이상에서 실행합니다. 1.0.8 플랫폼 배포물은 체크섬을 고정한 Node.js 24.19.0을 포함합니다. 실제 manifest의 버전과 파일 목록을 확인합니다.

```sh
npm ci --ignore-scripts
npm start
```

기본 Note API는 `GET http://127.0.0.1:8901/api/notes`입니다. Full 소스는 같은 주소의 `/`에서 관리 콘솔을 제공합니다. AI Starter와 최소 런타임 배포물에는 콘솔 화면을 포함하지 않습니다. 기존 Full 사용자 데이터를 보존한 채 최소 런타임으로 바꾸면 `public`의 콘솔도 유지됩니다. 최소 런타임에서 Full로 바꾸면 없는 화면 파일만 추가하고 기존 업로드와 수정 파일은 보존합니다. 기본 바인딩은 로컬 `127.0.0.1`입니다.

소스 실행의 기본 workspace는 `workspace`, 상태 디렉터리는 `data`입니다. **설치형/플랫폼 배포물은 운영체제의 사용자 상태 경로를 사용합니다.** Windows의 설정·DB·계정·workspace·업로드·로그·캐시는 `%LOCALAPPDATA%\aidot-mini` 아래에 모으며, 설치 폴더나 현재 터미널 위치를 데이터 저장소로 사용하지 않습니다.

## AI로 업무 API 작성·검증

1. AI에게 요구사항과 [API RULES](docs/AI_API_RULES.md)를 전달합니다. 프런트엔드가 필요할 때만 [Frontend RULES](docs/AI_FRONTEND_RULES.md)를 함께 사용합니다.
2. `controller/`, `service/`, `sql/`을 작성합니다. 새 schema는 새 migration으로 추가하며 이미 실행한 migration은 수정하지 않습니다.
3. 실제 업무의 정상·오류·권한·영속성 사례로 검증합니다. metadata와 컴파일 캐시는 런타임이 생성합니다.

```sh
npm run workspace:init -- ./my-workspace --empty
npm run workspace:compile -- ./my-workspace
npm run workspace:verify -- --workspace ./my-workspace --cases ./my-cases.json
```

migration이 workspace 밖에 있으면 `--migrations ./my-database`를 추가합니다. 검증기는 임시 소스 복사본과 새 SQLite DB를 사용합니다. `--cases`를 생략하면 기동·선언 검사만 수행하며 **업무 동작 검증 완료로 표시하지 않습니다**. [Product HTTP 사례](docs/AI_WORKSPACE_CASES.json)를 참고하되 새 업무의 URL·입력·예상 응답을 작성하세요.

`workspace:verify`는 별도 프로세스로 먼저 컴파일하고 종료한 뒤 API 서버를 실행합니다. 서버 단계에서 컴파일러 메모리를 계속 유지하지 않지만, 컴파일 단계의 메모리 요구량은 존재합니다. 특정 장치의 메모리 상한은 해당 장치와 업무 코드로 측정해야 합니다.

## Product 예제

Note 기본값은 유지하고 Product는 명시적으로 선택합니다.

```sh
npm run product:account
npm run start:product
```

두 명령은 같은 `.env`/환경 설정을 사용해야 합니다. 기본 Product workspace는 `examples/product-workspace`, migration은 `examples/product-database`, 소스 실행 상태는 `data/product-demo`입니다. 조회는 공개이며 쓰기와 이미지 업로드에는 관리자 인증·권한이 필요합니다.

Full 소스에서 별도 Vue 화면을 개발하려면 다른 터미널에서 실행합니다.

```sh
cd examples/product-client
npm ci
npm run dev
```

[Product 튜토리얼](docs/TUTORIAL_PRODUCT_KO.md)에 따라 Vite 주소의 `/product`로 접속합니다. AI Starter에서 Vue를 설치할 필요는 없습니다.

## 운영체제·장치별 빌드

<!-- DEVICE_BUILDS_START -->
아래 명령은 **개발 소스 루트**에서 실행합니다. Windows/Linux/로봇 패키지 빌드에는 Node와 Python 3, Windows 설치 파일 생성에는 NSIS가 필요합니다. 대상 장치는 내장 런타임을 사용합니다. 결과는 기본 `dist/release/`에 저장합니다. NSIS가 PATH에 없으면 `npm run dist:win -- --makensis "C:\Program Files (x86)\NSIS\makensis.exe"`처럼 실제 경로를 전달합니다.

```sh
npm run dist:win
npm run dist:win:full
npm run dist:linux -- --arch x64
npm run dist:linux:arm64
# Linux 관리 콘솔이 필요한 경우
npm run dist:linux:full
npm run dist:robot
npm run dist:android
```

| 대상 | 배포 방식·요구사항 | 확인할 항목 |
|---|---|---|
| Windows x64 | Node 포함 ZIP과 NSIS 설치 프로그램. 최소/화면 포함 옵션 | 초기 설정·AppData 쓰기·업그레이드·선택 삭제 |
| Linux x64/ARM64 | Node 포함 런타임 패키지. 지원 glibc 환경 | CPU/ABI·권한·시작/종료·DB 영속성 |
| 로봇·드론 Linux ARM64 | ARM64 런타임과 로봇 통합 자료. ROS는 별도 환경 | 보드 실기기·센서/제어 SDK·통신 끊김·재시작 |
| Android | Android Bionic용 Node, Android SDK/JDK/Gradle로 APK 빌드 | ABI·앱 전용 저장소·설치/기동·foreground service |

교차 빌드 성공은 다른 CPU나 실기기에서의 실행 성공을 의미하지 않습니다. Linux glibc 런타임을 Android에 넣을 수 없습니다. Android runtime·SDK·서명 조건이 갖춰지지 않으면 빌드가 실패하며, 소스나 assets ZIP을 완성 APK로 표시하지 않습니다. Android 공개 배포에는 본인의 release 서명이 필요합니다.

- [Windows 설치·초기 설정·삭제](docs/INSTALL_WINDOWS_KO.md)
- [Linux 배포](docs/DEPLOY_LINUX.md) / [ROS 통합](docs/DEPLOY_ROS.md)
- [Android 빌드·운영](docs/DEPLOY_ANDROID.md)
- [선택형 MQTT·Socket.IO 어댑터](addons/communications/README.md)

빌드 및 실행 검증 결과는 [1.0.8 릴리스 기록](docs/RELEASE_1.0.8_KO.md)을 확인합니다. 이전 결과를 새 설치 프로그램이나 실기기 검증 결과로 대체하지 않습니다.
<!-- DEVICE_BUILDS_END -->

## Windows 설치와 데이터

설치 마법사에서 **포트, SQLite DB 파일명, Note/Product 프로필**을 선택합니다. 관리자 권한 없이 현재 Windows 사용자에게 설치하며 기본 접속은 `http://127.0.0.1:<선택한 포트>`입니다. LAN 공개는 TLS·인증·접근 정책을 설정한 뒤 활성화합니다.

| 위치 | 저장 내용 |
|---|---|
| `%LOCALAPPDATA%\Programs\aidot-mini` | 프로그램·내장 Node·삭제 프로그램 |
| `%LOCALAPPDATA%\aidot-mini` | 설정·DB·계정·workspace·업로드·로그·캐시 |

삭제 시 **프로그램만 삭제하여 데이터 보존** 또는 **프로그램과 관리되는 사용자 데이터 모두 삭제**를 선택합니다. 외부에 직접 배치한 workspace·DB·TLS 파일은 자동 삭제하지 않습니다. 재설치·업그레이드에서는 사용자 파일을 예제 기본값으로 덮어쓰지 않습니다. 자세한 실행 명령은 [Windows 설치 지침](docs/INSTALL_WINDOWS_KO.md)을 따릅니다.

## 검증과 GitHub Release 준비

```sh
npm run verify
npm run product:contract
npm run build:starter
npm run release:github
```

`release:github`의 기본 동작은 로컬 배포물과 업로드 계획 확인이며 `RELEASE_PLAN.json`·`SHA256SUMS.txt`를 만듭니다. `npm run release:github -- --publish --repo mike-jung/aidot-mini`는 인증 후 **Draft Release**를 생성합니다. 인증된 GitHub CLI(`gh`)와 대상 **원격 저장소**의 기존 버전 태그 `v1.0.8`이 필요하며, 기존 릴리스를 덮어쓰지 않습니다. 소스 ZIP에는 Git 이력이 없으므로 자신의 저장소에서 배포할 커밋을 검토하고 태그를 만든 뒤 원격에 올리는 작업을 먼저 수행합니다. 이 명령은 Git 커밋·태그를 자동 생성하거나 push하지 않습니다. 문서나 ZIP을 생성한 것만으로 GitHub Release가 발행되지는 않습니다. 버전·체크섬·파일 목록과 실제 검증 결과를 확인한 뒤 업로드합니다. 비밀키·사용자 DB·계정·로컬 `.env`·업로드·캐시는 소스/릴리스에 넣지 않습니다.

Express 교차 검증은 mini 루트에서 별도로 준비한 Express 1.45.8을 지정합니다.

```sh
# Bash — 실제 Express 경로로 변경
EXPRESS_PROJECT_ROOT=/absolute/path/aidot-express node scripts/verify-product-contract.mjs
```

PowerShell에서는 `$env:EXPRESS_PROJECT_ROOT = 'C:\path\aidot-express'` 설정 후 같은 Node 명령을 실행합니다. DB schema·계정과 실행 환경은 해당 호스트 설정을 따릅니다. [1.0.7 검증 기록](docs/VERIFICATION_1.0.7.md)은 이전 버전의 참고 자료입니다.

## 라이선스

Public 프로젝트는 [Apache License 2.0](LICENSE)을 사용합니다. [저작권·배포 조건](COPYRIGHT.md), [NOTICE](NOTICE), [타사 고지](docs/THIRD_PARTY_NOTICES.md), [보안 안내](SECURITY.md)를 함께 확인하세요.

