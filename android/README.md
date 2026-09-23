# aidot-mini Android

Android 휴대 단말과 Android 기반 로봇·드론의 탑재 컴퓨터에서 실행하는 로컬 API 서버입니다. `controller/`, `service/`, `sql/`의 공통 계약은 데스크톱 aidot-mini와 동일합니다. Node의 Android/Bionic 빌드와 SQLite를 APK에 포함하므로 단말에 Node를 따로 설치하지 않습니다. 비행 제어나 실시간 안전 제어기는 별도로 사용하십시오.

## 빌드

프로젝트 루트에서 실행합니다. Node 22.19 이상, Python 3, JDK 17 이상(`javac` 포함), Android SDK platform 36/build-tools 35.0.0, Android SDK의 기존 라이선스 동의가 필요합니다. 누락되거나 불완전한 npm 빌드 의존성은 자동 준비합니다.

```sh
npm run dist:android
```

`ANDROID_HOME`을 SDK 폴더로 지정합니다. Windows에서는 같은 명령을 PowerShell에서 실행할 수 있습니다. Python 실행 파일을 바꾸려면 `AIDOT_PYTHON`을 지정합니다. 기본 결과물은 `dist/release/`의 ARM64 단말용 및 x86_64 에뮬레이터용 APK입니다.

```sh
# APK 대신 네이티브 런타임과 서버 자산만 준비
npm run dist:android -- --prepare-only
# 단일 ABI의 검증용 APK
npm run dist:android -- --abi x86_64 --debug-only
# 런타임 다운로드 없이 기존 검증된 패키지 캐시 사용
npm run dist:android -- --offline
```

`--offline`은 npm 캐시만 사용하며 Termux 런타임 패키지 다운로드를 금지합니다. Gradle 의존성은 처음 빌드할 때 다운로드할 수 있습니다. 런타임 캐시는 기본 `dist/.cache/android-runtime`, 사용자 지정 위치는 `AIDOT_ANDROID_RUNTIME_CACHE`입니다. 정확한 패키지 버전·SHA-256·ELF ABI·16KB 메모리 페이지 정렬을 검증하며, 패키지가 없어졌거나 해시가 달라지면 중단합니다. 임의의 Linux Node 실행 파일로 대체하지 않습니다.

## 배포 서명

`*-debug.apk`는 설치 검증용 Android debug key 서명입니다. `*-release-unsigned.apk`는 서명 전 결과물이므로 그대로 설치할 수 없습니다. 실제 업데이트 배포에는 소유자가 관리하는 동일한 release key를 계속 사용해야 합니다.

Gradle이 서명한 release APK가 필요하면 다음 환경변수를 모두 설정합니다. 키나 비밀번호를 소스·ZIP·로그에 넣지 마십시오.

- `AIDOT_ANDROID_KEYSTORE`: 기존 배포 keystore의 절대 경로
- `AIDOT_ANDROID_STORE_PASSWORD`
- `AIDOT_ANDROID_KEY_ALIAS`
- `AIDOT_ANDROID_KEY_PASSWORD`

서명된 빌드는 `*-release.apk`로 출력됩니다. `android-build-manifest.json`이 버전·ABI·서명 종류·크기·SHA-256을 기록합니다. `package.json`의 버전이 Android `versionName`의 기준이며, 1.0.13의 `versionCode`는 10013입니다.

## 실행과 데이터

앱을 열면 전경 서비스가 `127.0.0.1:8901`에 서버를 시작하고 WebView가 관리 화면을 엽니다. Android의 알림에서 서버를 중지할 수 있습니다. 설정·DB·토큰·로그·컴파일 캐시는 앱의 비공개 데이터 영역에 보관합니다. 동일 서명의 APK 업데이트는 데이터를 유지합니다. Android 설정의 **저장공간 삭제** 또는 앱 제거는 이 영역을 삭제합니다. 서버 코드 업데이트와 DB 보존 영역을 분리했으므로 APK의 서버 자산 교체가 사용자 DB를 덮어쓰지 않습니다.

백그라운드 지속 실행은 Android/OEM 정책의 영향을 받습니다. 자동 비행·로봇 구동의 안전 제어 루프를 이 서비스에 맡기지 마십시오.

## 실제 APK 검증

```sh
node android/scripts/verify-apk.mjs dist/release/aidot-mini-1.0.13-android-x86_64-debug.apk
```

검증기는 `aidot_mini_108_verify`라는 전용 AVD에서만 설치·삭제합니다. 기본 ADB serial은 `emulator-5590`이며 `ADB_SERIAL` 및 `ADB_PATH`로 지정할 수 있습니다. 서버 기동, SQLite CRUD, 실행 중인 Android Node/SQLite/crypto, 새로운 `@aidot` controller 컴파일, 재시작·재설치 데이터 보존, 삭제 후 재설치 초기화를 확인합니다. 결과는 `dist/android-verification/`에 기록됩니다.

에뮬레이터 결과는 실제 ARM64 하드웨어 실행을 대신하지 않습니다. 각 release의 검증 보고서에 기록한 ABI와 API 수준만 실행 검증된 것으로 취급하십시오.
