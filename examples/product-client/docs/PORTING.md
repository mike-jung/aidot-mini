# Product의 aidot-mini ↔ aidot-express 이식

최종 기준은 **첨부 aidot-express-1.45.8-full.zip**이다. 앞서 제공된 Product upgrade v1 패치는 이미 반영된 상태이므로 이 full 위에 다시 적용하지 않는다. 이번 수정본은 Express 프레임워크 소스를 변경하지 않고, mini의 공통 import 지원과 업무 코드 및 Vue를 맞춘다.

## 1. 그대로 복사하는 파일

mini의 `examples/product-workspace/controller`, `service`, `sql` 세 폴더를 Express의 대상 workspace로 복사한다. 새 Product 소스는 `@aidot/core/decorators.js`, `@aidot/database/db.js`, `@aidot/core/uploads.js`를 import한다. 두 서버에서 같은 파일을 사용하며 호스트별 if 분기를 넣지 않는다.

`APP_WORKSPACE`가 이미 다른 API를 가리키는 경우 해당 workspace의 같은 하위 폴더에 Product 파일을 병합해도 된다. 동일 ProductController를 중복 등록하지 않는다. 기존 코드에 대한 사용자 수정은 먼저 비교한다. metadata는 각 서버 loader가 처리하게 두며 API 권한은 소스 decorator로 선언한다.

## 2. Express 설정과 DB 준비

```dotenv
APP_WORKSPACE=examples/product-workspace
DB_MIGRATIONS_DIR=examples/product-database
PUBLIC_DIR=public
DB_TYPE=sqlite
DB_FILE=./data/product-demo.db
```

DB 초기화 SQL은 mini의 `examples/product-database`를 별도로 복사한다. 업무 workspace와 DB DDL의 책임은 다르다. 기존 DB라면 실행된 migration 파일을 수정하지 않고 필요한 새 migration을 추가한다. 기존 demo_product에 image_path가 없는 별도 과거 스키마를 사용 중이라면 테이블 구조를 먼저 확인해 새 ALTER migration을 준비한다. 이번 배포는 원본 201/202 migration 바이트를 변경하지 않는다.

```sh
npm ci
npm run start:main
```

Express 계정은 Express에서 설정한다. mini의 계정 JSON, token 파일, SQLite DB를 Express 인증 저장소로 덮어쓰지 않는다. 관리자 영역의 로그인만으로 관리자 역할을 보장하지 않으므로 쓰기 Controller는 `@Auth({ realm: 'admin', roles: ['admin'] })`를 사용한다.

## 3. Vue 환경

Full의 examples/product-client 또는 별도 클라이언트 프로젝트에 적용한다. 최소 AI Starter에는 Vue 파일이 없다.

```dotenv
VITE_API_URL=/api
API_TARGET=http://127.0.0.1:7901
VITE_AUTH_MODE=express
```

API_TARGET 포트는 실제 Express listener에 맞추고 Vite를 재시작한다. mini 연결 시 VITE_AUTH_MODE=mini와 mini 주소를 사용한다. API/store/View 코드는 동일하다. mini는 cookie+CSRF, Express는 기존 password/JWT/refresh 로그인 계약을 사용한다.

## 4. 파일 복사 외에 필요한 상태

소스 세 폴더 복사는 업무 코드의 이식이다. schema와 DB 접속, 관리자 계정, 기존 상품 데이터, 공개 이미지 파일까지 자동으로 이전되지는 않는다. DB의 imagePath가 `/uploads/images/...`이면 대상 PUBLIC_DIR 아래에 그 실제 바이트가 있어야 한다. DB에 origin, `/public`, base64, blob URL을 저장하지 않는다.

공통 업로드 API는 `/api/uploads/multipart?profile=image`이며 PNG/JPEG/WebP 한 장, 파일 5 MiB/본문 6 MiB 한도를 사용한다. 업로드와 DB 저장은 별도 요청이다. DB 실패 시 URL을 재사용하며 상품 삭제로 공유 파일을 자동 삭제하지 않는다. 원본 helper의 MIME·시그니처 검사는 완전한 이미지 디코딩/재인코딩이 아니다. 더 강한 검사 정책은 양쪽 프레임워크를 함께 변경할 때 도입한다.

## 5. import와 호환 범위

mini는 기존 `../../src/...`와 `../core/...` import도 보존한다. 그러나 Express는 legacy `../../src/...`를 실제 상대 경로로 해석하며, `../core/...`는 .env 로딩 시점에 따라 외부 workspace에서 실패할 수 있다. 새 공통 API와 동봉 Note/Product 예제는 `@aidot/...`를 사용한다. 기존 사용자 코드는 자동 치환하지 않는다.

pagination은 기존 `db.executeList`를 그대로 사용한다. SQLite에서 양쪽 실제 실행을 검증했다. MariaDB DDL이 있다는 사실만으로 MariaDB 실행 호환을 확정하지 않는다. Note의 기존 missing update/delete rowsAffected=0과 Product의 missing record 404는 각각 유지한다.

## 6. 검증 및 내보내기

mini 루트에서:

```sh
npm run verify
npm run product:contract
# Bash 예시: 수정된 mini의 동일 Product 파일을 첨부 Express에 로딩한다.
EXPRESS_PROJECT_ROOT=/absolute/path/aidot-express node scripts/verify-product.mjs
EXPRESS_PROJECT_ROOT=/absolute/path/aidot-express node scripts/verify-product-contract.mjs
```

PowerShell에서는 `$env:EXPRESS_PROJECT_ROOT='C:\path\aidot-express'`를 지정한 뒤 `node scripts/verify-product.mjs`를 실행한다. 검사 스크립트는 임시 DB·계정·PUBLIC_DIR를 사용한다.

Product 모듈 선택은 `examples/product-module.json`, 일반 Note 선택은 루트 `module.json`이다. Product를 export할 때 APP_WORKSPACE와 DB_MIGRATIONS_DIR를 위 Product 경로로 지정하고 `npm run port:export -- --module examples/product-module.json`을 실행한다. export가 Express 검증을 자동 수행하는 것은 아니다. 자세한 결과는 서버 루트의 docs/VERIFICATION_1.0.7.md, 원본 Note 계약은 [PORTING_NOTE.md](PORTING_NOTE.md)를 참고한다.
