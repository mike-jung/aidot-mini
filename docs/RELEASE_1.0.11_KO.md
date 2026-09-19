# aidot-mini 1.0.11 — GitHub CLI 누락 오류 수정

## 원인과 수정

1.0.10의 `release:github`는 기존 게시 설정의 `.env` 토큰을 읽지 않고 `gh`를 직접 실행했습니다. GitHub CLI가 설치되지 않았거나 PATH에 없으면 `spawnSync gh ENOENT`로 중단됐습니다. 원격 PC에는 프로젝트의 GITHUB_TOKEN이 설정돼 있지만 gh 실행 파일은 없음을 확인했습니다. 토큰 값은 출력하지 않았습니다.

1.0.11은 기존 게시 명령과 같은 순서로 `.env.publish`, `.env`, `.env.local`을 읽으며 프로세스 환경 변수가 같은 키를 덮어씁니다. GITHUB_TOKEN이 GH_TOKEN보다 우선합니다. 토큰이 있으면 Node의 HTTPS 요청으로 GitHub Draft Release를 만들고 검증된 배포물과 SHA256SUMS.txt를 업로드합니다. GitHub CLI는 필요하지 않습니다. 토큰에는 대상 저장소의 Contents: Read and write 권한이 필요합니다.

토큰이 없으면 인증된 gh를 사용합니다. GH_PATH 또는 Windows의 일반 설치 위치도 확인합니다. 도구가 없으면 토큰 설정, `winget install --id GitHub.cli --exact`, `gh auth login --hostname github.com`을 안내합니다.

## 사용

빌드 파일은 소스 버전과 일치해야 합니다. 이전 버전의 dist/release는 별도 폴더에 보관한 뒤 새 버전으로 빌드합니다. 공개 소스 checkout에서 대상 저장소에 `v1.0.11` 태그를 먼저 push해야 합니다. 이 명령은 빌드·소스 게시·커밋·태그 push를 자동 실행하지 않습니다.

```sh
npm run release:github
npm run release:github -- --dry-run
npm run release:github -- --repo owner/repository
npm run release:github -- --publish --repo mike-jung/aidot-mini
```

기본 대상은 `mike-jung/aidot-mini`, 기본 상태는 Draft입니다. `--publish`는 이전 명령 호환 옵션이며 공개 게시로 바꾸지 않습니다. GitHub에 이미 있는 동일 태그의 릴리즈와 Draft는 덮어쓰지 않습니다. 업로드 도중 실패하면 생성된 Draft와 완료된 파일 목록을 RELEASE_PLAN.json에 남기고 uploadPerformed는 false로 유지합니다.

토큰은 CLI 인자·릴리즈 계획·오류 로그에 넣지 않습니다. HTTPS의 GitHub API·업로드 주소만 사용하고 HTTP 리디렉션을 따라 다른 주소에 인증 정보를 전달하지 않습니다. 공개 산출물 검증, 버전·파일 크기·SHA-256 검사, Full 소스 제외 정책을 유지합니다.

## 검증 범위

이 패치는 GitHub 릴리즈 기능의 수정입니다. 이전 Android ARM64 에뮬레이터에서 관찰한 Node JavaScript SIGSEGV는 해결됐다고 판정하지 않습니다. 이전 버전의 플랫폼 실행 통과를 이번 버전의 실제 기기 실행 결과로 확대 해석하지 않습니다.

기술 근거: [GitHub Releases API](https://docs.github.com/en/rest/releases/releases), [Release assets API](https://docs.github.com/en/rest/releases/assets).

### 완료한 검사

- Linux x86_64 / Node 24.19.0 / SQLite: `npm run verify` 성공. 정적 검사 142/142, 회귀 검사 173개, Product HTTP 56개 통과.
- Product 클라이언트 `npm run format:check` 및 `npm run build` 성공.
- 원격 Windows 11 10.0.26200 / Node 24.15.0: 릴리즈 관련 회귀 검사 26개 통과. 토큰으로 gh 없이 Draft 생성·업로드하는 흐름, 기존 Draft 보호, 없는 태그·인증 실패·부분 업로드·외부 업로드 주소 거부를 검사했습니다. 생성과 업로드는 모의 응답으로 검증했습니다.

| 원격 Windows 명령 | 종료 코드 | 소요 시간 |
| --- | ---: | ---: |
| `node --test tests/dist.test.mjs tests/github-release.test.mjs` | 0 | 0.32초 |
| `npm run dist:win` | 0 | 70.47초 |
| `npm run dist:win:full` | 0 | 62.57초 |
| `npm run dist:linux -- --arch x64` | 0 | 7.66초 |
| `npm run dist:linux -- --arch arm64` | 0 | 7.36초 |
| `npm run dist:robot` | 0 | 7.43초 |
| `npm run dist:android` | 0 | 59.03초 |
| `npm run release:github -- --dry-run` | 0 | 0.68초 |

Windows ZIP·설치 EXE 4개, Linux/Robot TAR 3개, Android APK 4개로 총 11개의 배포 파일을 생성했습니다. 모든 파일의 크기와 SHA-256이 일치했습니다. ZIP/APK의 CRC, APK 내부 서버 ZIP의 CRC, TAR gzip CRC와 Node의 0755 실행 권한을 확인했습니다. Android release-unsigned APK는 별도의 운영 서명이 필요합니다.

실제 원격 PC의 기존 `.env`로 새 릴리즈 코드를 실행하되, 검사에서 GitHub 요청을 GET으로 제한했습니다. gh를 호출하지 않고 인증된 GitHub 조회를 수행했으며 원격 v1.0.11 태그가 없다는 404 응답까지 확인했습니다. 이는 gh 누락 오류가 해소됐다는 검증이며 실제 Draft 생성·업로드 완료를 뜻하지 않습니다. 저장소 소스·태그·Release는 이번 작업에서 원격으로 변경하지 않았습니다.

공개 소스 checkout에 1.0.11 소스를 반영한 뒤 해당 커밋에 태그를 붙입니다. Full 비공개 소스 checkout에서 공개 저장소로 push하지 않습니다.

```sh
# Run in the public source checkout after its 1.0.11 source commit is pushed.
git tag v1.0.11
git push origin v1.0.11
# Run in the build project, using its existing .env token.
npm run release:github
```

상세 결과와 배포 파일 해시는 [검증 기록](RELEASE_1.0.11_VERIFICATION.json)에 있습니다. full 소스 ZIP에는 정확한 소스 목록, 버전과 파일별 SHA-256을 넣으며, 실제 토큰·.env·DB·node_modules·빌드 캐시·생성한 실행 배포물은 포함하지 않습니다.
