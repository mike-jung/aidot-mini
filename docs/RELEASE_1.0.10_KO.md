# aidot-mini 1.0.10 — 빌드 준비 단계 수정

새 소스 ZIP에서 `npm run dist:win`을 바로 실행할 때 `node_modules/esbuild-wasm/package.json` 누락으로 종료되던 문제를 수정했습니다.

- Windows, Linux x64/ARM64, 로봇, Android 빌드는 고정된 `esbuild-wasm` 패키지가 없거나 불완전하면 `npm ci --ignore-scripts --no-audit --no-fund`로 준비합니다. 이미 준비된 패키지는 다시 설치하지 않습니다.
- `--offline`은 npm의 오프라인 캐시만 사용하며, 필요한 캐시가 없으면 온라인 준비 방법을 안내합니다.
- Windows에서 npm은 `.cmd` 셸 중첩 없이 Node로 실행합니다. Python은 `AIDOT_PYTHON`, PATH의 `python`/`python3`/`py`를 확인합니다.
- NSIS는 PATH와 Windows 표준 설치 경로를 확인합니다. 별도 설치 위치는 `--makensis` 또는 `MAKENSIS`로 지정할 수 있습니다. 설치 프로그램이 필요한 기본 빌드는 NSIS가 없으면 시작 전에 안내하고 종료합니다.
- Android APK는 다운로드 전에 JDK와 Android SDK platform 36을 확인합니다. `--prepare-only`는 APK 빌드가 아닌 서버 assets·런타임 준비입니다.
- Python 기반 Starter·Linux·ROS·Android 보조 명령도 같은 Python 검색 방식을 사용합니다.
- Windows에서 Linux·로봇 TAR를 만들 때도 Node·런처·ROS 1 실행 스크립트에 실행 권한을 기록합니다. 원본 호스트의 실행 권한이 없어도 배포 파일은 `0755`가 됩니다. Windows의 chmod 제한은 [Node 파일시스템 문서](https://nodejs.org/docs/latest-v24.x/api/fs.html#fschmodpath-mode-callback)를 기준으로 확인했습니다.

## 사용 방법

```sh
npm run dist:win
npm run dist:win:full
npm run dist:linux -- --arch x64
npm run dist:linux -- --arch arm64
npm run dist:linux:full
npm run dist:robot
npm run dist:android
```

기존 1.0.9 소스를 즉시 사용해야 한다면 프로젝트 루트에서 `npm ci --ignore-scripts`를 먼저 실행하면 보고된 의존성 누락 오류를 해결할 수 있습니다. Windows 설치 파일에는 Python 3·NSIS 3, Android APK에는 Python 3·JDK 17 이상·Android SDK가 별도로 필요합니다.

## 검증 기록

검증 호스트는 Ubuntu 24.04 x64, Node 24.19.0, npm 11.9.0, Python 3.12.14입니다. Windows 설치 프로그램은 NSIS 3.09로 교차 빌드했습니다. Android 빌드는 OpenJDK 17.0.2, SDK platform 36 revision 2, build-tools 35.0.0, 프로젝트의 Gradle 8.11.1 wrapper를 사용합니다. 배포 런타임은 기존 lock을 유지하며 데스크톱 Node 24.19.0, Android Node 24.18.0입니다.

| 명령 | 이번 버전에서 확인한 결과 |
|---|---|
| `npm run dist:win` | 새 소스에 `node_modules`가 없는 상태에서 자동 의존성 설치 후 Windows 최소 ZIP·NSIS 설치 프로그램 생성 성공 |
| `npm run dist:win:full` | Windows Full ZIP·NSIS 설치 프로그램 생성 성공 |
| `npm run dist:linux -- --arch x64` | Linux x64 최소 패키지 생성 및 내장 Node 실행 검증 성공 |
| `npm run dist:linux -- --arch arm64` | Linux ARM64 패키지 생성, ELF 아키텍처·해시 검증 성공 |
| `npm run dist:linux:full` | Linux x64 Full 패키지 생성 및 내장 Node 실행 검증 성공 |
| `npm run dist:robot` | Linux ARM64 로봇 패키지와 ROS 1/2 소스 workspace 생성 성공 |
| `npm run dist:android` | ARM64·x86_64 각각 Debug 및 unsigned Release APK, 총 4개 생성 성공. Gradle 83개 task 실행 완료 |
| `npm run build:starter` | Starter ZIP 생성, CRC·버전·Python launcher 포함 확인 성공 |
| `npm run build:ros` | ROS 1/2 소스 압축파일 생성, CRC·패키지 버전 확인 성공 |
| `npm run build:linux -- --arch x64 --download --deb` | 기존 Linux tar.gz 및 Debian 패키지 생성 성공 |
| `npm run release:github -- --dry-run` | 현재 버전의 배포물 12개를 검증하고 `mike-jung/aidot-mini`, `v1.0.10`, `draft: true` 계획 생성 성공 |

데스크톱 배포물 8개의 크기·SHA-256을 release metadata와 대조했습니다. ZIP/gzip의 CRC와 압축 내부 manifest의 모든 파일 해시를 검사했습니다. Windows 설치 파일은 PE 헤더와 결과물 해시를 확인했습니다.

APK 4개는 ZIP CRC, 중첩 서버 ZIP의 CRC·SHA-256, ABI별 네이티브 파일 10개의 고정 해시, Android manifest의 `versionName=1.0.10`·`versionCode=10010`·minSdk 26·targetSdk 36, zipalign을 확인했습니다. Debug APK 2개는 apksigner 서명 검증을 통과했고 Release APK 2개는 명시된 대로 unsigned임을 확인했습니다. 배포용 Release APK는 소유자의 기존 release key로 서명해야 합니다.

Linux x64 최소 12개·Full 13개 실행 검사를 통과했습니다. 내장 Node 버전, 모든 payload 해시, 독립 데이터 디렉터리 구성, 서버 준비 상태, SQLite Product 조회, 익명 쓰기 거부, 인증 CRUD, Full 콘솔, 상태 확인·정상 종료, 삭제 시 데이터 보존·명시적 초기화, 설치 파일 원본 유지가 검사 범위입니다.

- `npm run verify`: JavaScript 문법 141/141, 회귀 테스트 161/161, Product HTTP 검사 56/56 통과.
- 신규 회귀 검사 8개: 의존성 누락·불완전·버전 불일치 복구, npm 경로의 공백·한글 처리, offline 실패 안내, 미검토 의존성 거부, Python·NSIS 검색, Android JDK·SDK 누락 안내.
- 별도 실행 권한 회귀 검사 1개: 실행 비트가 없는 원본으로 TAR를 만든 뒤 압축 해제하여 Linux 런처가 실제로 실행되는지 확인합니다. 수정 전 실패를 재현했습니다. 수정 후 Linux·로봇 패키지 4종을 다시 생성해 CRC·해시·실행 권한을 검사했고, 압축 해제한 x64 최소·Full 런처도 정상 실행했습니다.
- `examples/product-client`: `npm run format:check`, `npm run build` 통과. Vite가 91개 모듈을 빌드했습니다.
- `npm run product:contract`: SQLite 기반 HTTP 요청 112회, 계약 검사 86개 통과.
- 배포·GitHub release 회귀 검사 14개가 통과했습니다. 기본 Draft 생성·기존 `--publish --repo` 호환 동작은 모의 GitHub CLI로 검사했으며 실제 GitHub 업로드는 수행하지 않았습니다. `--publish`와 `--dry-run`을 동시에 지정하는 모순된 요청은 거부합니다.
- 기존 업무 Controller·Service·SQL, 적용된 migration, 런타임 lock은 변경하지 않았습니다.

### 검증 범위

Windows 설치 프로그램 생성은 Linux에서의 교차 빌드 결과입니다. 이번 환경에는 실제 Windows, ARM64 하드웨어, Android 단말·에뮬레이터, ROS SDK·로봇 장비가 없어 해당 환경의 설치·실행·장비 연동은 검증하지 않았습니다. ROS 결과물은 컴파일된 ROS SDK가 아닌 소스 workspace입니다. 이전 버전의 실기기·에뮬레이터 결과를 이번 버전의 결과로 계산하지 않습니다.

## 전체 소스 ZIP

파일명은 `aidot-mini-v1.0.10-full.zip`입니다. 기존 1.0.9 ZIP을 덮어 압축하지 않고, 정확한 Full 파일 목록으로 새 표준 Deflate ZIP을 생성합니다. node_modules, DB, 계정, 로컬 설정, 빌드 캐시, 생성된 배포 바이너리는 소스 ZIP에 포함하지 않습니다.

검증은 ZIP CRC 검사, 전체 압축 해제, `FULL_MANIFEST.json`의 파일별 SHA-256 대조, Windows 파일명 호환성 검사로 수행합니다. 저장본도 다시 내려받아 생성본과 전체 SHA-256 및 파일별 해시를 비교한 뒤 제공합니다.
