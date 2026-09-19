> 이전 1.0.6 검토·검증 기록입니다. 현재 Full·Starter 1.0.7 결과는 서버 루트의 docs/RELEASE_1.0.7_KO.md와 docs/VERIFICATION_1.0.7.md를 확인하세요.

# aidot-mini / aidot-express 호환성 검토와 수정 내역

> 2026-09-18 검토·수정·실행 결과. 이 문서의 경로는 각 프로젝트 루트 기준이다. 상세 실행 로그는 docs/verification-1.0.6/에 포함했다.

**이번 Product 예제는 mini의 공통 기능과 업무 코드 일부를 수정하는 것이 맞다. 비교 대상인 첨부 aidot-express 1.45.8 Full은 수정하지 않아도 된다.** Express가 이미 제공하는 `@aidot` import, 업로드, DB, 인증 계약에 mini와 Product 코드를 맞춘다. 첨부 mini Starter 전체를 GitHub 프로젝트에 그대로 덮어쓰면 기존 Note, 실행 기본값, 개발 도구와 테스트를 잃으므로, GitHub 소스를 보존하면서 Product를 추가하는 방식으로 정리했다.

수정본의 호환성 목표는 **동일한 Product Controller·Service·SQL 소스를 두 서버에서 실행하는 것**이다. 데이터베이스와 이미지 파일, 계정까지 세 폴더 복사만으로 자동 이전되는 것은 아니다. 아래 실행 조건을 갖춘 대상에서 소스가 동일하게 동작하는지를 실제 HTTP로 검증한다.

## 1. 비교한 원본

| 대상 | 실제 기준 |
|---|---|
| GitHub `mike-jung/aidot-mini` | clone한 v1.0.1, commit `fdff6332b21058baaed7328fb6e334c06521d717` |
| 최초 GitHub Express 비교본 | v1.45.7, commit `6f5df9528c0ab82f59774b0227ad8d492357a463` |
| 최종 Express 검증본 | 추가 첨부한 `aidot-express-1.45.8-full.zip`의 원본 소스. GitHub v1.45.7이나 별도 수정본으로 대신하지 않음 |
| mini 입력본 | `aidot-mini-v1.0.5-starter.zip` |
| Vue 입력본 | `aidot-product-client-v1.0.5-full.zip`; 내부 package 버전은 1.0.3이었음 |
| 결과물 버전 | mini 및 Product client 1.0.6 검토 수정본. GitHub 공식 릴리스를 의미하지 않음 |

Express 1.45.8 ZIP SHA-256:

```text
deed278e294a6ceb9f2b77912e1a26b401f3578db262f41f6ab43cb5e8774bd0
```

mini 입력 ZIP SHA-256:

```text
08357c16e7cc47e7003f68544f2c8c202e79d35ac7760bca9e6be9b6aa523404
```

GitHub mini 추적 파일 207개를 기준으로 Starter는 **동일 49개, 변경 20개, 누락 138개**였다. Starter에 추가된 파일은 1,911개다. 누락에는 Android 40개, 배포 25개, addon 6개, module 5개, 테스트 23개, 스크립트 9개, Note workspace·인증 예제 20개 등이 포함된다.

SDK·Android·ROS·배포 도구를 Starter에서 빼는 것은 원래 배포 설계다. 누락 숫자 전체를 결함으로 판단하지 않았다. 반면 **Full 소스에는 기존 기능과 원본 테스트를 복구**하고, Product용 변경 때문에 기존 런타임 계약이 사라진 부분을 고쳤다. 원본 Starter의 manifest 1,979개 파일 해시는 모두 일치했다. 입력 파일 손상으로 생긴 문제가 아니다.

## 2. 어느 쪽을 수정해야 하는가

| 항목 | 문제의 원인 | 이번 처리 |
|---|---|---|
| 프레임워크 import | 두 호스트의 상대 import 해석이 다름 | mini에 `@aidot` 지원 추가, Product import 통일. Express 1.45.8은 기존 지원 사용 |
| 서버 재시작 | mini의 workspace loader 상태가 새 공통 Controller 로딩으로 덮임 | mini loader 초기화 상태 분리 |
| 실행·데이터 기본값 | Product Starter가 일반 mini 기본값을 바꿈 | 일반 기본값 복구, Product 명령을 분리 |
| 관리자 권한 | Product가 admin realm만 지정하고 role을 명시하지 않음 | Product 쓰기 API에 realm과 role을 함께 지정 |
| DB pagination | 기존 `db.executeList`로 필요한 계약 제공 | 기존 엔진 유지 |
| 업로드 | 두 서버의 공통 기능 계약을 맞춰야 함 | mini가 Express 1.45.8의 helper와 같은 구현 사용 |
| Vue 비동기 상태 | 화면 이동·인증 요청 순서에 따라 오래된 작업이 반영됨 | store 및 View 수명 관리 수정 |
| 초기화·내보내기·검증 | 범용 기능을 Product 전용으로 대체 | 기존 기능 복구 후 Product 옵션 추가 |

### import: 상대 경로의 모양이 같아도 이식 계약은 같지 않았다

원본 mini는 외부 workspace의 `../../src/core/...`를 자신의 프레임워크로 매핑한다. Express는 이 형태를 실제 상대 경로로 해석하므로, 프로젝트 바깥 임의 폴더로 이동하면 찾지 못할 수 있다.

Product의 기존 `../core/...`도 완전한 해결책은 아니었다. Express loader는 별도 worker에서 실행되고 workspace 환경을 읽는다. `APP_WORKSPACE`를 shell에 미리 넣는 실행은 통과해도, 서버가 나중에 `.env`를 읽는 실행에서는 loader가 workspace를 알지 못해 실패하는 경우를 실제로 재현했다. 따라서 shell 환경을 직접 주입하는 테스트만 통과시키면 일반 실행 문제를 놓친다.

Product를 다음 import로 통일했다.

```js
import { Service, Sql } from '@aidot/core/decorators.js';
import db from '@aidot/database/db.js';
import { validateImagePath } from '@aidot/core/uploads.js';
```

Express 1.45.8은 `@aidot`를 workspace 설정과 무관하게 자기 `src`로 해석한다. mini도 같은 해석을 지원하도록 추가했다. mini의 기존 상대 import 지원은 보존했다. 동봉 Note와 인증 Note의 import도 같은 alias로 변경해 workspace:init으로 만든 API가 같은 경로 계약을 사용하게 했다. Note의 HTTP·SQL 계약은 유지한다. 기존 사용자가 작성한 legacy 소스는 자동 치환하지 않는다. **모든 과거 mini API가 임의 경로에서 자동 호환된다는 포괄적 주장은 하지 않는다.** 이번 검증 대상은 수정한 Product 및 두 Note 예제와 명시한 공통 계약이다. 프레임워크 전용 기능을 임의로 사용하는 모든 사용자 코드까지 보장하지 않는다.

### 재시작: Product 추가로 드러난 mini 프레임워크 결함

공통 UploadController를 `src/controller`에서 로딩하면서 별도 `ModuleRegistry`가 loader를 다시 등록했다. 그런데 workspace와 프레임워크가 같은 `hooks.mjs` 모듈 인스턴스를 사용해, loader의 root 상태가 workspace에서 `src`로 바뀌었다.

같은 Node 프로세스에서 서버를 다시 만들 때는 등록 완료 목록 때문에 workspace 재등록이 생략됐다. 그 결과 기존 Note decorator가 컴파일되지 않고 원문으로 들어가 SyntaxError가 발생했다. 단독 Product 기동 검사는 통과할 수 있지만 기존 재시작·인증·TLS 검사를 깨뜨리는 결함이었다.

`src/loader/register.mjs`에서 workspace별 고유 hook URL을 사용해 초기화 상태를 분리했다. 이 결함을 고친 뒤 **복구한 upstream 테스트 104개가 통과**했다. 단순히 실패 테스트를 제외하거나 Product 검사로 대체하지 않았다.

### 권한: admin realm과 admin role은 구별해야 한다

기존 Product 쓰기 메서드는 `@Auth({ realm: 'admin' })`만 사용했다. realm은 로그인 영역이고 role은 실제 권한이다. Express의 관리자 영역에 로그인했다는 사실과 `admin` 역할 보유는 같은 조건이 아니다.

등록·수정·삭제에 다음 계약을 적용했다.

```js
@Auth({ realm: 'admin', roles: ['admin'] })
```

Vue도 단순 로그인 여부 대신 `isAdmin`으로 쓰기 버튼과 폼을 제어한다. 서버 권한 판정이 최종 기준이고, 화면 제어는 사용자가 할 수 없는 작업을 선택하지 않도록 맞춘 것이다. 목록·상세의 공개 조회 정책은 유지했다.

## 3. 기존 mini 기능을 보존한 Product 실행

첨부 Starter는 DATA_DIR를 `data/product-demo`, 기본 workspace를 Product로 바꿨다. 기존 설치에 적용하면 원래 DB와 계정이 삭제되지 않았더라도 다른 위치를 바라보므로 새 설치처럼 보일 수 있다.

수정본에서는 다음과 같이 구분한다.

| 목적 | 명령 / 설정 |
|---|---|
| 일반 mini 실행 | `npm start`; 기본 `workspace`, `data` |
| 일반 mini 계정 설정 | `npm run admin:account` |
| Product 실행 | `npm run start:product` |
| Product 계정 설정 | `npm run product:account` |
| Product 기본 업무 폴더 | `examples/product-workspace` |
| Product 기본 migration 폴더 | `examples/product-database` |
| Product 기본 데이터 위치 | `data/product-demo` |

Product launcher는 config를 import하기 전에 `.env`를 읽고 명시된 환경값을 우선한다. 기본값을 분리하면서 사용자가 직접 지정한 경로를 덮어쓰지 않는다. 계정 명령과 서버 명령도 동일한 Product 데이터 위치를 사용한다.

범용 `workspace:init`의 original/auth/simple/empty 사용법을 보존하고 `--example product`를 추가했다. 일반 workspace의 migrations 복사와 모듈 내보내기의 migrations 그룹도 복구했다. Product DB 초기화는 기존 설계대로 workspace 밖에 둔다. 내보내기는 `--module`로 선택 파일을 지정할 수 있으며, 실제 Express 실행을 하지 않은 내보내기 결과에 Express 통과라고 기록하지 않는다.

`npm test`에는 upstream 회귀 테스트를 유지하고 `product:verify`를 추가했다. 전체 `public` 디렉터리를 검사에서 제외하던 변경도 좁혀 mini 콘솔 JavaScript 검사가 유지되도록 했다. 원본 범용 AI 지침과 Product 지침을 분리하고 Full에 기존 Note·인증 예제·배포 도구를 복구했다.

## 4. Product 설계에서 유지한 부분

페이지 조회는 이미 올바른 프레임워크 기능을 사용하고 있었다. `listPaged`는 Product Service의 업무 메서드이며 실제 count와 LIMIT/OFFSET은 `db.executeList`가 처리한다. `{rows, header}` 전체를 반환해야 loader가 페이지 header를 보존한다. 값 바인딩, 정렬 허용 목록, 동일 가격의 id 보조 정렬, `%`·`_`를 글자로 검색하는 처리도 유지했다.

이미지는 `/uploads/images/<uuid>.<ext>` 경로만 DB에 저장한다. 업로드와 상품 저장은 별도 요청이므로 업로드 성공 후 DB 저장에 실패하면 받은 URL을 재사용한다. 수정 시 imagePath 생략은 유지, null은 연결 해제다. 상품 삭제가 공유 파일 삭제까지 수행하지 않는 정책도 유지한다.

업로드 helper는 Express 1.45.8과 같은 구현을 사용했다. MIME·시그니처·크기 확인을 완전한 이미지 디코딩 검사라고 설명하지 않는다. 한쪽 서버에만 새 decoder 정책을 추가하면 동일 요청의 허용·거부 결과가 갈리므로 이번 이식성 수정에 섞지 않았다.

기존 Note의 없는 행 수정·삭제는 `rowsAffected: 0`, Product의 없는 상품 수정·삭제는 404라는 차이는 각 예제의 별도 정책이다. Product 때문에 Note 계약을 바꾸지 않았다. 이미 적용된 SQL migration의 내용도 바꾸지 않는다.

## 5. Vue에서 고친 실제 비동기 문제

1. 삭제 요청 중 다른 화면으로 이동해도 늦게 끝난 요청이 목록을 다시 읽고 이미 파괴된 dialog를 참조할 수 있었다. `records_product.js`의 수명 세대와 `ProductView.vue`의 활성 상태 확인으로 화면을 떠난 작업이 새 화면에 영향을 주지 않도록 했다.
2. 세션 복원 또는 Express refresh가 진행 중일 때 로그인·로그아웃을 시작하면, 늦게 돌아온 응답 쿠키가 새 인증 상태를 덮을 수 있었다. `auth.js`에서 진행 중인 복원 이후 로그인·로그아웃이 순서대로 수행되도록 했다.
3. Express에서는 로그인한 모든 역할에 쓰기 UI가 보였다. role/roles를 반영한 `isAdmin`으로 Header·목록·폼을 맞췄다.
4. 파일명 1.0.5와 내부 package 1.0.3의 혼선을 없애도록 결과물 package와 lockfile 버전을 정리했다.

embedded client와 standalone client 원본은 같은 바이트였다. 수정본도 두 배포 경로가 달라지지 않도록 동일 소스를 반영한다. Vue store 검사는 mini/express 모드 각각 7개, 실제 Chromium 브라우저 검사는 두 서버 각각 12개가 통과했다. format:check와 production build도 통과했다.

## 6. “세 폴더 그대로 복사”의 실행 조건

| 구분 | 옮길 것 / 준비할 것 |
|---|---|
| 업무 소스 | 동일한 controller/service/sql; 호스트별 분기 코드 없음 |
| 공통 프레임워크 | mini 수정본 또는 첨부 Express 1.45.8; 각 서버 loader로 실행 |
| workspace 설정 | 대상 서버의 APP_WORKSPACE 지정. 같은 URL의 Controller 중복 등록 방지 |
| DB | 대상 DB 연결 및 `demo_product` schema 준비; DB_MIGRATIONS_DIR 지정 |
| 기존 데이터 | 필요한 상품 데이터를 별도로 이관. DB 파일 복사와 schema 호환을 혼동하지 않음 |
| 기존 이미지 | DB 경로에 대응하는 실제 파일을 대상 PUBLIC_DIR에 배치 |
| 인증 | 대상 서버의 관리자 계정과 로그인 방식 사용 |
| Vue | API_TARGET 및 VITE_AUTH_MODE를 mini/express에 맞게 설정 |

DB 초기화 SQL과 계정·파일 배치는 호스트 환경 준비다. 업무 코드를 수정해야 한다는 뜻이 아니다. SQLite와 MariaDB용 DDL을 제공해도 MariaDB 실제 실행을 하지 않았다면 MariaDB 통합 호환을 확정할 수 없다.

## 7. 실행 검증과 남은 범위

아래는 **이번 작업에서 확인한 결과**다. 입력물에 들어 있던 과거 검증 횟수는 수정본의 검증 결과로 재사용하지 않는다.

| 검사 | 이번 상태 |
|---|---|
| mini 최종 회귀 테스트 | 105개 통과(원래 104 + 공통 이미지 형식/MIME 검사 1); 구문 99/99 및 metadata 통과 |
| Express 1.45.8 원본 Product 기준 검사 | SQLite HTTP 58개 통과 |
| Express 1.45.8 `npm run check` | syntax 409, references 114, SQL names 61 통과 |
| Express 기존 security 검사 | 17/17 통과 |
| Express 원본 보존 | `.env` 실행 검사 후 첨부 Full 1.45.8과 source 변경 0개 확인 |
| 최종 동일 Product 파일의 mini/Express HTTP | 기본 mini 56 / Express 58; 추가 계약 mini 86개(HTTP 112회) / Express 88개(HTTP 118회), 전부 통과 |
| Express .env-only 실행 및 외부 workspace | shell의 APP_WORKSPACE를 제거하고 `.env`만으로 지정. 수정 mini의 동일 Product 파일을 외부 임시 workspace에 복사한 뒤 실제 HTTP 58개 통과 |
| Vue 검증 | store 각 7개, 실제 Chromium 각 12개, format/build 모두 통과 |
| Starter/Full/patch 재현 | 새로 푼 Starter 설치·검증 통과. 최종 ZIP 무결성 및 세 종류 patch dry-run/충돌 보호/apply/Full 동일성 결과는 동봉 PACKAGE_VERIFICATION.json 참조 |

Linux x64 / Node 24.19.0 / SQLite / Chromium 153.0.8010.0에서 실행했다. 정확한 명령은 `VERIFICATION.md`에 기록했다. HTTP 검증에는 pagination·검색·권한·업로드 형식/크기·DB 저장·재시작 후 조회·삭제 정책을 포함한다. MariaDB·Oracle 통합 실행, Windows/Android/Electron/ROS 장치 실행은 해당 실행 증거가 없으면 미검증으로 표시한다. 이번에는 사용자 PC 원격 접속을 사용하지 않았다. 로컬 Linux 실행으로 요청한 서버·브라우저 검증을 수행했다.

## 8. 배포물 적용 기준

Full은 기존 GitHub mini 기능을 포함한 전체 수정 소스다. Starter는 API 실습에 필요한 범위로 줄인 배포물이다. patch는 **입력 기준을 분리**해야 한다. GitHub v1.0.1 기준 patch와 첨부 v1.0.5 Starter 기준 patch는 원본 해시와 파일 구성이 다르다.

patch 적용 도구는 쓰기 전에 전체 원본·payload 해시를 확인하고, 사용자 변경이 있으면 덮어쓰지 않고 중단한다. 기본 dry-run, 적용 전 백업, 적용 후 해시 검사를 제공한다. DB·계정·`.env`·업로드·설치된 의존성은 소스 patch에 포함하지 않는다. 최종 ZIP과 source/patch manifest는 수정 완료 후 다시 생성한다.

| 배포물 | 사용 대상 |
|---|---|
| aidot-mini-v1.0.6-full.zip | 새 폴더에서 전체 수정 소스 사용. Product Vue 포함 |
| aidot-mini-github-v1.0.1-to-v1.0.6-patch.zip | clone한 GitHub fdff633 원본 → 동일 Full 결과 |
| aidot-mini-starter-v1.0.5-to-v1.0.6-patch.zip | 첨부 mini 1.0.5 Starter 원본 → 동일 Full 결과 |
| aidot-product-client-v1.0.6-full.zip | 독립 Vue 클라이언트 전체본 |
| aidot-product-client-v1.0.5-to-v1.0.6-patch.zip | 첨부 client ZIP 기준 변경분 |

mini 패치 두 개는 사용 중인 원본에 맞는 **하나만** 고른다. 기존 Full과 Starter 사이의 파일 차이가 커서 기준을 혼합하지 않는다. ZIP을 별도 폴더에 풀고 그 폴더에서 실행한다.

```sh
python apply_patch.py --target /path/to/project
python apply_patch.py --target /path/to/project --apply
```

기본은 dry-run이다. Windows에서는 python 대신 py 명령을 쓸 수 있다. 사용자 수정으로 해시가 다르면 자동 적용하지 않고 충돌을 보고한다. .env·데이터·계정·업로드는 변경하지 않는다. 수정 소스 버전 1.0.6은 이번 결과물을 식별하기 위한 값이며 GitHub에 push하거나 공식 릴리스를 발행하지 않았다.

각 ZIP의 SHA-256은 SHA256SUMS.txt, 실제 패치 검증 결과는 PACKAGE_VERIFICATION.json에 제공한다.


## 9. 추가 보완 권고와 이번에 유지한 경계

- **MariaDB 통합 검사:** DDL이 존재해도 SQLite와 정렬 collation, BIGINT 반환 타입, rowsAffected 의미가 모두 같다고 단정할 수 없다. 실제 서비스 DB가 MariaDB라면 동일 HTTP 계약 검사를 그 DB에서도 실행하는 것이 다음 우선순위다.
- **기존 스키마 변경:** 이번 입력의 201/202 migration은 그대로 보존했다. 별도로 운용 중인 과거 demo_product에 image_path가 없다면 현재 schema와 적용 이력을 먼저 확인한 후 새 migration을 추가해야 한다. CREATE TABLE IF NOT EXISTS는 기존 컬럼을 추가하지 않는다.
- **장시간 인증 유지:** Express access token 자동 재시도/refresh interceptor는 별도 개선 사항이다. 현재는 로그인/새로고침 refresh 계약을 유지했으며, 만료 후 재로그인 UI가 필요할 수 있다.
- **파일 운영 정책:** 원본과 같은 MIME/시그니처 검사만 수행한다. 완전한 디코딩·재인코딩, 미참조 파일 정리, 저장 용량·업로드 rate limit 정책은 두 호스트에 같은 계약으로 도입해야 한다.
- **대량 데이터:** 기존 `/api/product` 전체 조회는 하위 호환 때문에 유지했다. UI는 paged API를 사용한다. 실제 대용량 서비스에서는 전체 조회 사용처를 조사한 뒤 제한/폐기 여부를 결정할 수 있다.

이 항목들은 이미 검증한 기능을 실패로 분류한 것이 아니라, 실습용 예제를 운영 서비스로 확장할 때 따로 결정해야 하는 범위다.
