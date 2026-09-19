# aidot-mini 1.0.11 — GitHub 태그 누락 404 수정

## 원인과 이번 수정 범위

`npm run push`와 `npm run sync:public`은 각각 비공개 Full 저장소와 공개 저장소의 브랜치를 갱신합니다. 이 명령들은 `v1.0.11` 태그를 생성하지 않습니다. 최초 1.0.11의 릴리즈 스크립트는 태그를 필수로 요구했기 때문에 두 push가 성공해도 `GitHub tag lookup for v1.0.11 failed (HTTP 404)`로 중단되었습니다.

첨부된 1.0.11 소스에는 이전 대화에서 언급된 태그 누락 대응이 반영되어 있지 않았습니다. 이번 수정은 그 소스를 기준으로 적용했습니다. 버전은 **1.0.11로 유지**합니다. 런타임 소스와 설치 파일 형식은 변경하지 않으므로 사용자의 기존 1.0.11 배포 파일을 사용할 수 있습니다. 1.0.12로 변경하거나 플랫폼 배포물을 다시 빌드한 결과물은 아닙니다.

## 바뀐 동작

1. 인증된 릴리즈 목록을 끝까지 조회해 같은 태그의 공개 Release 또는 Draft가 있으면 중단합니다.
2. 원격 태그가 이미 있으면 해당 태그를 그대로 사용합니다.
3. 태그 조회가 실제 HTTP 404일 때만 공개 저장소와 공개 브랜치를 확인합니다. `--branch`, `PUBLIC_BRANCH`, `main` 순서로 브랜치를 선택합니다.
4. 브랜치의 커밋 SHA를 먼저 확정하고, 그 SHA의 `package.json`에서 `name=aidot-mini`, `aidotEdition=public`, 버전 `1.0.11`을 확인합니다. 브랜치가 이후 변경돼도 확인한 SHA를 사용합니다.
5. 토큰 API에는 `target_commitish=<확인한 SHA>`를, GitHub CLI에는 `--target <확인한 SHA>`를 전달해 Draft를 만들고 검증된 파일을 업로드합니다. 수동 태그 push는 필요하지 않습니다.

인증 실패, 권한 오류, API 제한, 서버 오류는 태그 누락으로 처리하지 않습니다. 기존 태그를 이동하거나 기존 Release를 덮어쓰지 않습니다. 이 명령은 Draft만 만들며, GitHub에서의 공개 Publish와 Git 태그 공개 완료를 의미하지 않습니다. API 업로드가 중간에 실패하면 `dist/release/RELEASE_PLAN.json`에 생성된 Draft와 업로드 완료 파일을 기록합니다. 기존 Draft가 있으므로 재실행 전 GitHub에서 해당 Draft를 확인해야 합니다.

## Windows 프로젝트에 적용

수정 ZIP의 `aidot-mini` 폴더 **안의 내용**을 기존 프로젝트 폴더에 덮어씁니다. 기존 프로젝트 폴더 자체를 삭제하거나 다른 빈 폴더로 바꾸지 마세요. 기존 `.env`와 `dist/release`의 1.0.11 배포 파일 및 `.release.json`은 계속 사용합니다. 이 소스 ZIP에는 로컬 설정, 토큰, 사용자 DB, 업로드 데이터, `node_modules`, 빌드된 배포 파일이 포함되지 않습니다.

기존 프로젝트 폴더의 PowerShell에서 실행합니다.

```powershell
npm run release:github -- --help
npm run release:github -- --dry-run
npm run push
npm run sync:public
npm run release:github
```

첫 명령의 도움말에 `If absent, verify the public source version` 문구가 표시되면 수정한 스크립트가 적용된 것입니다. `--dry-run`은 로컬 배포 파일의 버전·크기·SHA-256만 확인하며 원격 저장소나 인증 상태를 확인하지 않습니다. PowerShell에서는 앞 명령이 성공한 것을 확인하고 다음 명령을 실행하세요.

`push`는 수정된 Full 소스를 보관하는 단계이고, `sync:public`은 수정된 공개 소스를 반영합니다. 공개 소스와 기존 배포물의 버전이 이미 1.0.11로 맞춰져 있다면 수정 파일 적용 후 `npm run release:github`만 실행해도 태그 없이 Draft를 만들 수 있습니다.

다른 공개 브랜치를 사용하는 경우:

```powershell
npm run release:github -- --branch release/stable
```

배포 파일을 다른 폴더에 보관한 경우:

```powershell
npm run release:github -- --directory 'D:\releases\aidot-mini-1.0.11'
```

기존 배포물이 없으면 먼저 필요한 대상만 빌드합니다. 예를 들어 Windows 최소 런타임은 `npm run dist:win`으로 빌드합니다. 버전이 다른 파일이 섞여 있으면 별도 폴더로 이동하세요. 파일명이나 `.release.json`의 버전만 바꾸어 사용하면 안 됩니다.

`PUBLIC_BRANCH`는 기존 게시 설정에서 읽지만 릴리즈 대상 저장소의 기본값은 이전과 같이 `mike-jung/aidot-mini`입니다. 다른 공개 저장소를 쓰는 경우 `--repo owner/repository`도 명시하세요. `GITHUB_REPO`는 Full 소스 게시 대상이므로 릴리즈 대상으로 사용하지 않습니다.

## 수정 파일

- `scripts/dist/github-api.mjs`: 공통 사전 확인, 누락 태그 대응, 공개 소스 확인, 커밋 SHA 지정.
- `scripts/dist/release-github.mjs`: GitHub CLI 대응, `--branch`, 도움말, 배포 폴더 누락 안내.
- `tests/github-release.test.mjs`, `tests/dist.test.mjs`: 누락 태그, 기존 태그, 원격 버전 불일치, 인증 오류, 기존 Draft 보호 검사.
- `README.md`, `CHANGELOG.md`, `REVISION.txt`, 릴리즈 안내 문서 및 소스 파일 목록: 사용법 갱신.
- `FULL_MANIFEST.json`: 수정된 배포 소스의 SHA-256 재생성.

## GitHub 동작 근거

GitHub API의 `target_commitish`는 아직 존재하지 않는 태그에 사용할 브랜치 또는 커밋을 지정합니다. 기존 태그가 있으면 이 값은 사용되지 않습니다. 이 수정은 커밋 SHA를 전달하며, 태그를 직접 push하는 API는 호출하지 않습니다. [GitHub Release API](https://docs.github.com/en/rest/releases/releases#create-a-release)

GitHub CLI의 `--verify-tag`는 원격 태그가 없을 때 중단하는 옵션입니다. 따라서 기존 태그가 있을 때만 유지하고, 누락 태그에는 `--target`을 사용합니다. [GitHub CLI release create](https://cli.github.com/manual/gh_release_create)

## 이번 작업의 검증

검증 환경은 **Linux x64 / Node v24.19.0 / SQLite 3.53.3 / aidot-mini 호스트**입니다. 실행일은 2026-09-19 UTC(한국 시간 2026-09-20)입니다. 최초 배포본의 `RELEASE_1.0.11_VERIFICATION.json`은 이전 작업의 기록으로 보존하며, 이번 수정의 실행 결과로 간주하지 않습니다.

| 실행 | 결과 |
| --- | --- |
| `node --test tests/github-release.test.mjs tests/dist.test.mjs` | 38/38 통과 |
| `npm run verify` | 종료 코드 0; 문법 142/142, 계약 검사 통과, 회귀 검사 185/185, Product HTTP 검사 56/56 통과 |
| `examples/product-client`의 `npm run format:check` | 종료 코드 0 |
| `examples/product-client`의 `npm run build` | 종료 코드 0; 91개 모듈 빌드 |

릴리즈 검사는 GitHub 응답과 GitHub CLI 실행 결과를 주입하는 로컬 회귀 검사입니다. 태그가 없는 경우의 Draft 요청 본문·커밋 SHA·업로드 바이트, 기존 태그 재사용, 공개 소스 버전·에디션 불일치, 누락 브랜치, HTTP 401/403/429/500, 손상된 응답, 페이지 뒤쪽의 기존 Draft, 업로드 중단, 토큰 마스킹을 확인했습니다. 38개 릴리즈 관련 검사는 전체 185개에도 포함됩니다.

**이번 환경에서는 실제 GitHub 소스 push, 실제 Draft 생성·업로드, Windows 원격 PC 실행, 플랫폼별 설치 파일 재빌드, Express 호스트 또는 MariaDB 검증을 수행하지 않았습니다.** 사용자의 로컬 토큰과 기존 배포 파일은 이 첨부 소스에 없으므로 사용자의 기존 프로젝트에서 위 명령으로 실행해야 합니다. 실제 원격 성공으로 보고한 결과는 없습니다.
