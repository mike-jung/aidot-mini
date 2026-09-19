# aidot-mini 1.0.9 — 소스 압축파일 복구와 버전 정리

1.0.9는 이전 수정본의 다운로드 ZIP 손상을 복구하고 프로젝트 버전을 명확히 올린 패치 버전입니다. 공개용 영문 README와 `npm run release:github`의 기본 Draft Release 생성 동작을 포함합니다.

## 수정 내용

- 메인 `package.json`과 `package-lock.json`, Note/Product 모듈 명세, Windows 설치 스크립트의 기본 버전, README 배지와 릴리즈 태그를 `1.0.9`로 맞췄습니다.
- 서버 상태, AI Starter, Windows/Linux/로봇 배포물, Android `versionName`과 `versionCode`, GitHub Release 태그는 메인 패키지 버전을 기준으로 생성합니다. Android의 이번 버전 코드는 `10009`입니다.
- Public 내보내기의 현재 릴리즈 문서 링크도 패키지 버전을 사용하도록 정리했습니다.
- 전체 소스 ZIP을 표준 Deflate 형식으로 새로 만들고, 완전히 닫힌 임시 파일을 최종 파일명으로 교체합니다. `FULL_MANIFEST.json`에는 소스 버전과 각 파일의 SHA-256을 기록합니다.
- 이전 릴리즈 및 예제 클라이언트의 독립 버전·검증 이력은 소급 변경하지 않습니다.

## 릴리즈 명령

```sh
npm run dist:win
npm run dist:win:full
npm run dist:linux -- --arch x64
npm run dist:linux -- --arch arm64
npm run dist:robot
npm run dist:android
npm run release:github
```

마지막 명령은 검증된 `dist/release/` 산출물을 `mike-jung/aidot-mini`의 Draft Release에 업로드합니다. 인증된 GitHub CLI와 원격 저장소에 미리 push한 `v1.0.9` 태그가 필요합니다. 빌드·커밋·태그 생성·push는 자동 수행하지 않습니다. 기존 릴리즈를 덮어쓰지 않습니다.

```sh
npm run release:github -- --dry-run
npm run release:github -- --repo owner/repository
```

## 검증 범위

소스 ZIP의 CRC 검사, 전체 압축 해제, 매니페스트 SHA-256 대조, 버전 일치 여부를 확인합니다. 저장 후 다시 내려받은 ZIP도 생성본과 크기·SHA-256을 대조하고 압축 해제합니다.

코드 확인 명령은 `npm run verify`, Product 클라이언트의 `npm run format:check`와 `npm run build`입니다. 릴리즈 명령 회귀 검사는 GitHub CLI를 모의 처리하며 실제 GitHub Release 생성이나 업로드를 수행하지 않습니다.

Linux x64 / Node.js 24.19.0 / npm 11.9.0 / SQLite에서 `npm run verify`가 통과했습니다. 문법 138개, 회귀 152개, Product HTTP 56검사를 확인했고 Product 클라이언트의 포맷 검사와 Vite 빌드(91개 모듈)도 통과했습니다.

이번 수정으로 Windows/Linux/로봇 설치 패키지와 Android APK를 다시 빌드한 것은 아닙니다. 이전 플랫폼 실행 기록은 [1.0.8 기록](RELEASE_1.0.8_KO.md)에 남겨 둡니다.
