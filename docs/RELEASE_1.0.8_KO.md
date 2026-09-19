# aidot-mini 1.0.8 릴리스 준비 기록

1.0.8은 검토 수정본 1.0.7을 기반으로 README의 제품 목적을 정리하고, 운영체제별 런타임 배포와 Windows 설치·설정·삭제 절차를 추가하는 버전입니다. **이 문서는 GitHub Release 발행 사실을 의미하지 않습니다.**

README·릴리즈 명령 수정본에서는 공개 GitHub 저장소용 README를 영문으로 정리하고, `npm run release:github`의 기본 동작을 `mike-jung/aidot-mini`의 Draft Release 생성으로 변경했습니다. 업로드 없는 로컬 검토는 `npm run release:github -- --dry-run`으로 실행합니다. 아래 기존 플랫폼 실행 기록은 이전 검증 결과이며, 이 명령 수정만으로 새 플랫폼 빌드나 GitHub 게시가 수행된 것은 아닙니다.

## 제품과 호환성

- 로봇·드론·모바일 단말에서 업무 API를 실행하는 최소 환경을 기본으로 합니다.
- Controller·Service·SQL은 aidot-mini와 첨부 aidot-express 1.45.8 Full 사이에서 **파일 수정 없이 이식하는 100% 동일 소스 호환**을 설계 원칙으로 합니다.
- 호환 대상은 공통 decorator·DB 호출·응답·인증·업로드 계약입니다. mini가 Express의 모든 기능·DB 드라이버를 포함한다는 의미는 아닙니다.
- DB schema·접속 설정·계정·업로드·기존 데이터는 대상 호스트에서 별도로 준비합니다. 서로 다른 DB의 모든 SQL 문법을 자동 변환한다고 보장하지 않습니다.
- API 작성용 작은 AI Starter와 Node를 내장한 장치 배포물을 구분합니다. Starter 소스 ZIP의 크기를 설치형 전체 크기나 RAM 사용량으로 표현하지 않습니다.

## 변경 범위

| 영역 | 1.0.8 변경 목적 |
|---|---|
| README | 동일 업무 소스 호환·최소 실행·로봇/드론/모바일 사용처와 실제 지원 범위 명시 |
| Windows | 최소/화면 포함 런타임과 NSIS 사용자별 설치 프로그램 |
| 초기 설정 | 포트·SQLite 파일명·Note/Product 프로필 입력, 기존 설정 보존 |
| Windows 파일 경로 | 프로그램과 AppData 상태 분리. DB·계정·workspace·업로드·로그·캐시의 쓰기 위치 일원화 |
| 삭제 | 기본은 데이터 유지. 명시적 선택 시 관리되는 사용자 데이터까지 제거 |
| Linux/Robot | x64/ARM64 런타임 빌드 명령 및 로봇 통합 배포 경로 |
| Android | 실제 Android runtime/SDK 조건을 확인하는 APK 빌드 경로 |
| GitHub Release | 기본 명령으로 공개 저장소에 Draft Release 생성, `--dry-run`으로 로컬 계획만 확인 |
| Windows 실제 빌드 | NSIS 입력의 Windows 경로 구분자·공백 인수 처리를 수정하여 Linux 교차 빌드 외의 Windows 네이티브 빌드도 확인 |
| Android 빌드 경로 | Debian 패키지 이름의 콜론이 NTFS 대체 데이터 스트림으로 해석되는 문제 수정. 해시 접두사와 안전한 캐시 파일명 사용 |
| 타사 라이선스 | 이전 ICU 파일의 `404: Not Found` 응답을 공식 ICU 78.3 라이선스로 교체. Android 라이선스 6개에 크기·SHA-256 및 오류 응답 거절 검사 추가 |

## 빌드 명령

```sh
npm ci --ignore-scripts
npm run dist:win
npm run dist:win:full
npm run dist:linux -- --arch x64
npm run dist:linux -- --arch arm64
npm run dist:robot
npm run dist:android
npm run release:github
```

`release:github`는 이미 빌드한 `dist/release/`의 공개 산출물과 sidecar를 검증하고 체크섬을 생성한 뒤 Draft Release에 업로드합니다. GitHub CLI 인증(`gh auth login`)과 대상 원격 저장소에 미리 push한 버전 태그 `v1.0.8`이 필요합니다. 빌드·커밋·태그 생성·태그 push는 자동 수행하지 않습니다.

```sh
# GitHub 접속 없이 산출물과 업로드 계획만 확인
npm run release:github -- --dry-run
# 다른 저장소 선택
npm run release:github -- --repo owner/repository
# 기존 명령도 계속 지원
npm run release:github -- --publish --repo mike-jung/aidot-mini
```

Windows/Linux/로봇 빌드 결과는 기본 `dist/release/`에 저장됩니다. Node.js 24.19.0 런타임과 해시를 고정합니다. 빌드 PC에는 Node·Python 3, Windows 설치 파일 컴파일에는 NSIS가 필요합니다.

Windows `full`은 관리 콘솔과 로봇 화면을 포함하는 실행 배포물입니다. 비공개 Full 게시 도구, `.env`, 사용자 상태, Enterprise 자료를 공개 런타임에 포함하지 않습니다. Vue Product 클라이언트는 Full 소스에서 별도로 빌드합니다. 소스 프로젝트의 Full/Public 에디션과 구분합니다.

Android는 Linux glibc 바이너리를 사용할 수 없습니다. 필요한 Bionic runtime·SDK·JDK·서명 조건을 만족하지 못하면 실패해야 하며, 서버 assets ZIP만 생성한 결과를 APK라고 설명하지 않습니다. debug APK, unsigned release APK, 서명된 release APK도 각각 구분합니다.

Android 캐시 파일명 정규화는 다운로드 바이트나 고정 SHA-256을 변경하지 않습니다. Windows의 Gradle 실행은 중첩된 `cmd.exe` 인용 때문에 task 이름에 따옴표가 섞이지 않도록 공식 Gradle Wrapper의 Java 진입점을 직접 호출합니다.

## Windows 설치 정책

NSIS는 사용자별 설치와 초기 설정·삭제 대화상자를 제공하면서 Linux에서도 Windows 설치 프로그램을 빌드할 수 있어 선택했습니다. 기본 프로그램 위치는 `%LOCALAPPDATA%\Programs\aidot-mini`, 변경 가능한 상태는 `%LOCALAPPDATA%\aidot-mini`입니다. Node/npm의 사전 설치, 관리자 권한, 자동 시작 등록, 자동 방화벽 변경은 기본 요구사항이 아닙니다.

초기 설정은 SQLite 파일명과 업무 프로필을 선택하며, 처음에는 `127.0.0.1`로만 접속합니다. LAN 공개에는 TLS·인증·접근 정책을 별도로 구성합니다. 설치 변경·재설치와 사용자 DB 초기화는 분리하며, 앱 밖에 둔 외부 workspace·DB·인증서는 전체 삭제 옵션에서도 임의로 지우지 않습니다.

[Windows 설치 지침](INSTALL_WINDOWS_KO.md)에 사용자 절차, 무인 실행 옵션과 검증 기준을 기록합니다.

## 실행 검증 상태

아래는 1.0.8 소스로 실제 실행한 결과입니다. 아직 ‘확인 필요’인 항목은 통과를 의미하지 않으며, 최종 산출물 확정 시 실행 결과와 한계를 추가합니다.

| 대상 | 확인해야 할 증거 | 현재 기록 |
|---|---|---|
| 공통 소스 | 정적 검사·회귀·Product HTTP | 최종 Full ZIP 추출본에서 문법 138/138, 회귀 144/144, Product 56 통과 |
| 동일 소스 교차 실행 | mini와 첨부 Express 1.45.8·SQLite | mini 86검사/112 HTTP, Express 88검사/118 HTTP 통과. 업무 소스 SHA-256 동일 |
| Vue 클라이언트 | 포맷·실제 production build | format:check와 Vite 8.3.0 빌드 통과, 91개 모듈 |
| 압축 해제한 AI Starter | 새 npm 설치·실제 API 실행 | 문법 59/59·선언 계약·Note 15·Product 56·업무 사례 10/10 통과 |
| Windows 설치 파일 | Windows에서 실제 NSIS 3.12 Unicode 빌드 | x64 minimal/full ZIP과 설치 EXE 생성. 내장 Node 24.19.0, 설치 EXE는 코드 서명 없음 |
| Windows 설치/삭제 | Windows 11 build 26200·비상승 일반 사용자 | 새 실행 1회에서 주요 단계 7/7 통과(36.07초). 그중 인증/CRUD HTTP 요청 8개 검사 포함 |
| Linux x64 | Node 24.19.0 내장 패키지 실제 실행 | 12개 실행 확인 항목 통과: 해시·기동·SQLite CRUD/인증·종료·상태 보존/전체 삭제·프로그램 파일 불변. HTTP 요청 수와는 구분 |
| 배포 도구 | 정책·CPU 형식·릴리스 sidecar | Node test 5개 통과. 허용 목록·경로·PE/ELF·변조/비공개/버전 거절 검사 |
| Linux ARM64/로봇 | 패키지 ABI·체크섬 | 교차 빌드·해시·ELF 검사 완료. ARM64 보드/로봇 실기기 실행은 미실행 |
| Android APK 4개 | ARM64/x86_64 각 debug·unsigned release | APK 버전 1.0.8/code 10008, native 해시·ELF 의존성·16KB LOAD·zipalign 검사 통과. debug 2개 서명 유효, release 2개는 미서명 |
| Android 실제 실행 | Android 14/API 34·x86_64 전용 에뮬레이터 | 설치·로컬 API·DB·WebView 관리자 초기 화면 등 19/19 통과. ARM64 실기기 실행은 미실행 |
| Release 계획 | 허용한 산출물 목록·SHA-256·버전·게시 여부 | 공개 산출물 13개와 SHA256SUMS 생성·검증. `uploadPerformed=false`; GitHub에는 게시하지 않음 |

Windows의 7개 단계는 잘못된 포트 거절, 실제 GUI 초기 설정(포트·SQLite·Product·한글/공백 경로), 시작 메뉴 실행과 read-only 프로그램/DB·캐시·로그 쓰기 및 인증 CRUD, Minimal→Full 업그레이드 보존/콘솔, GUI 기본 삭제의 데이터·무관한 파일 보존, 재설치의 보존 상태 인식, GUI 전체 삭제의 앱 소유 프로그램·상태·바로가기·HKCU 제거입니다. GUI 단계 수와 내부 assertion 또는 HTTP 요청 수를 합쳐 하나의 테스트 수로 부풀리지 않습니다.

Starter의 새 검증은 Linux x64·Node 24.19.0·npm 11.9.0·SQLite에서 수행했습니다. 10개 HTTP 요청에 응답 assertion 10개를 적용했고 sourceUnchanged=true였습니다. 해당 실행에서 서버 RSS는 도구 출력 `runtimeRssMB=70`, 별도 컴파일 프로세스 완료 시 RSS는 `241 MiB`, 프로세스 최대 RSS는 `249,412 KiB`였습니다. 서로 다른 프로세스의 관측값이며 전체 작업의 최대 메모리나 장치별 메모리 상한을 보장하지 않습니다.

1.0.7의 공통 런타임 검증은 [이전 기록](VERIFICATION_1.0.7.md)에 있습니다. 그 결과를 새 Windows 설치 프로그램·ARM64 보드·Android 실기기의 이번 실행 결과로 재사용하지 않습니다. Wine만 사용했으면 Wine으로, 정적 검사만 했으면 정적 검사로 표시합니다. 원격 PC 검증을 하지 못했다면 하지 못한 사실을 명시합니다.

## 릴리스 적용

- 장치에는 CPU/OS에 맞는 배포물을 사용하고 실행 상태는 패키지 밖에 보관합니다.
- 기존 사용자 데이터와 계정은 업그레이드 전에 백업하고 서버를 정지합니다.
- 플랫폼 빌드를 먼저 완료한 뒤 `npm run release:github`를 실행하면 `mike-jung/aidot-mini`에 Draft Release를 생성합니다. `--repo owner/repository`로 대상을 변경할 수 있으며 기존 릴리스를 덮어쓰지 않습니다. `--dry-run`은 로컬 `RELEASE_PLAN.json`·`SHA256SUMS.txt`·`RELEASE_NOTES.md`만 만들고 GitHub에 접속하지 않습니다. 인증된 GitHub CLI와 대상 원격 저장소의 기존 `v1.0.8` 태그가 필요합니다.
- 코드 서명이나 Android release 서명에 필요한 개인키를 소스/패치/릴리스 ZIP에 포함하지 않습니다.
- 새로운 업무 API는 해당 업무의 HTTP 검증을 수행합니다. 예제 Product의 통과가 새 업무 또는 모든 DB 조합의 통과를 의미하지 않습니다.

## README·릴리즈 명령 수정본 검증

이번 수정본은 Linux x64, Node.js 24.19.0, npm 11.9.0, SQLite 환경에서 확인했습니다.

| 검사 | 결과 |
|---|---|
| `npm run verify` | 최종 실행 통과: 문법 138/138, 선언 계약, 회귀 152/152, Product HTTP 56검사 |
| 릴리즈 명령 회귀 | 전체 회귀에 포함된 `tests/dist.test.mjs` 13개 통과. 기본 Draft 생성, dry-run, 저장소 변경, 기존 옵션, 중복 릴리즈·파일 변조·CLI 오류 처리 확인 |
| Product 클라이언트 | `npm run format:check`와 `npm run build` 통과, Vite 91개 모듈 |
| 공개 README | 영문 구성, 상대 문서 링크 20개와 안내 npm 명령의 Public 파일·스크립트 포함 여부 확인 |

릴리즈 회귀 검사는 GitHub CLI 호출을 모의 처리했습니다. 실제 GitHub 인증·태그 조회·업로드는 수행하지 않았으며, 플랫폼 설치 프로그램이나 APK를 이번 수정으로 다시 빌드하지 않았습니다. 최초 전체 검사 도중 README를 수정하여 공개 내보내기 반복 검사 1개가 실패했으며, 파일을 고정한 뒤 해당 검사와 최종 전체 검사가 모두 통과했습니다.
