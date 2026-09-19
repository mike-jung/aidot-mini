# AI API RULES — aidot Controller / Service / SQL

**이 문서는 AI의 코드 생성·수정 지시문이다.** aidot-mini 1.0.8과 첨부 aidot-express 1.45.8 Full에서 **동일한 Controller·Service·SQL 파일을 수정 없이 복사해 실행**할 수 있도록 작성한다. mini Starter는 이를 빠르게 작성·실행 검증하는 최소 서버 환경이다. 브라우저 UI·Vue·개발 도구를 요구하거나 런타임을 재구현하지 않는다.

## 1. 입력과 산출물

먼저 요청 대상 workspace와 기존 Controller·Service·SQL·스키마를 읽는다. Product 예제는 `examples/product-workspace`, 기본 Note 예제는 `workspace`다. 일반 업무 API는 사용자가 지정한 이름·필드·경로·권한을 따른다. Product의 관리자 권한·가격 범위·이미지 기능을 관계없는 업무에 자동 적용하지 않는다. 불명확한 중요 조건만 질문하고, 기존 계약으로 결정 가능한 내용은 유지한다.

| 산출물 | 책임 |
|---|---|
| `<workspace>/controller/<Name>Controller.js` | HTTP 경로·메서드·인증/권한, Service 호출, 필요한 HTTP 상태 |
| `<workspace>/service/<Name>Service.js` | 입력 검증, 업무 규칙, DB 실행, 반환값 |
| `<workspace>/sql/<name>.sql` | `-- @name:`으로 구분한 named SQL |
| 설정된 migration 디렉터리의 **새** SQL 파일 | 필요한 경우 스키마 변경. 이미 실행한 파일은 수정하지 않음 |
| `scripts/verify-<name>.mjs` 등 실행 가능한 검증 | 해당 API의 정상·오류·권한·상태 보존 검사 |

요청된 파일은 생략·TODO 없는 완성 코드로 제공한다. 수정 시 기존 메서드를 삭제하거나 문서의 일부 발췌로 전체 파일을 교체하지 않는다. 실제 변경 경로, 실행 명령·결과·미실행 항목을 함께 보고한다. `meta/`와 컴파일 캐시는 loader가 생성한다. 직접 작성하지 않는다.

최소 작업 입력 양식:

```text
작업: 신규 / 수정, 업무 이름:
workspace 경로 / API prefix:
대상 DB와 기존 테이블·컬럼 / 필요한 스키마 변경:
각 HTTP 메서드·경로 / 요청 필드·형식·필수 여부 / 응답:
목록·검색·정렬·페이지 규칙:
인증 realm·역할 / 미존재·중복·검증 오류 정책:
수정 시 생략·null의 의미 / 여러 DB 작업의 원자성:
보존할 기존 동작 / 반드시 검증할 사례:
```

## 2. 필수 구조와 import

JavaScript ES module, `.js`, default export class, 2칸 들여쓰기를 사용한다. Controller → Service → named SQL 계층을 유지한다. 새 Router·DB 연결·repository·서비스 레지스트리·호스트별 분기를 추가하지 않는다. Controller·Service는 공유 인스턴스이므로 요청별 사용자·payload를 `this`에 저장하지 않는다.

```js
// Controller에서 필요한 항목만 import한다.
import { Controller, GetMapping, PostMapping, PutMapping, DeleteMapping, Autowired, Auth } from '@aidot/core/decorators.js';
// Service에서 필요한 항목만 import한다.
import { Service, Sql } from '@aidot/core/decorators.js';
import db from '@aidot/database/db.js';
// 이미지 업무일 때만 사용한다.
import { validateImagePath } from '@aidot/core/uploads.js';
```

- `@Autowired('ProductService') productService;`와 `@Service('ProductService')` 이름은 일치해야 한다.
- `@Sql('product') productSql;`은 `sql/product.sql`에 대응한다. `this.productSql.get('findById')`는 **SQL 문자열**이다.
- 외부 workspace 이식용 import는 `@aidot/...`를 유지한다. `../core/...`, `../database/...`, `../../src/...`로 바꾸거나 workspace에 프레임워크 파일을 복제하지 않는다.
- 이 별칭과 decorator는 각 서버 loader가 처리한다. decorated 파일을 일반 `node`로 직접 실행하거나 `node --check`만으로 검증하지 않는다.

## 3. HTTP·params·응답 계약

| 선언 | 사용 |
|---|---|
| `@Controller('/api/product')` | 클래스의 HTTP 경로 prefix |
| `@GetMapping('/paged')`, `@GetMapping('/:id')` | 조회 |
| `@PostMapping('/')` | 생성 |
| `@PutMapping('/:id')` | 정해진 전체 수정 계약 |
| `@PatchMapping('/:id')` | 부분 수정이 명시적으로 필요한 경우에만, 누락/null 처리 구현 필수 |
| `@DeleteMapping('/:id')` | 삭제 |
| `@Auth({ realm: 'admin', roles: ['admin'] })` | **메서드에** 관리자 인증 영역과 역할을 함께 제한 |
| `@Log log;` | 필요할 때 logger 주입; `@Log()`로 쓰지 않음 |

고정 경로 `/paged`는 `/:id`보다 먼저 선언한다. handler는 `(params, req, res)`를 받으며 `params`는 **query < JSON body < path** 우선순위로 병합된다. path/query 숫자는 보통 문자열이다. 병합은 검증이 아니며 요청 본문 전체를 DB에 넘기지 않는다. 경로 id가 body id보다 우선한다는 계약도 검사한다.

Product는 공개 조회, 관리자 등록·수정·삭제다. admin realm 로그인과 admin 역할은 다르므로 쓰기마다 둘 다 명시한다. 화면 버튼 숨김은 서버 권한 검사를 대체하지 않는다. 별도 업무의 공개/인증/역할 정책은 요청에 따라 결정한다.

기존 Product Controller의 기준 패턴(다른 기존 메서드는 보존):

```js
@Controller('/api/product')
export default class ProductController {
  @Autowired('ProductService') productService;

  @GetMapping('/paged')
  async listPaged(params) {
    return this.productService.listPaged(params);
  }

  @GetMapping('/:id')
  async get(params) {
    return this.productService.getById(params.id);
  }

  @PostMapping('/')
  @Auth({ realm: 'admin', roles: ['admin'] })
  async create(params, req, res) {
    const data = await this.productService.create(params);
    res.status(201).json({
      code: 201,
      message: 'Created',
      header: {
        requestCode: params.requestCode || null,
        timestamp: new Date().toLocaleString('sv-SE', {
          timeZone: 'Asia/Seoul', hour12: false,
        }),
      },
      data,
    });
  }

  @PutMapping('/:id')
  @Auth({ realm: 'admin', roles: ['admin'] })
  async update(params) {
    return this.productService.update(params);
  }

  @DeleteMapping('/:id')
  @Auth({ realm: 'admin', roles: ['admin'] })
  async remove(params) {
    return this.productService.remove(params.id);
  }
}
```

보통 값을 반환하면 loader가 HTTP 200, `{ code, message, header, data }`로 응답한다. 생성은 위처럼 HTTP 201과 code 201을 직접 응답한다. `res.json()` 후 다시 값을 반환하거나 응답하지 않는다. `undefined`만 반환해 요청을 끝내지 않는 메서드를 만들지 않는다. 오류는 `Object.assign(new Error(message), { status: 400 })`처럼 던진다. 미존재 상태는 해당 업무 계약에 따라 404 또는 rowsAffected=0으로 결정한다. 기존 Product는 404, Note 수정·삭제는 rowsAffected=0을 유지한다.

## 4. Service·DB 반환값·트랜잭션

DB 연결·마이그레이션은 런타임이 준비한다. 업무 파일에서 open/init/close를 호출하거나 raw SQLite handle을 사용하지 않는다. 공통 업무에서는 async `db.execute`, `db.executeList`, `db.transaction`만 사용한다.

| 작업 | 실행과 반환 |
|---|---|
| 목록 | `const result = await db.execute(sql, values); return result.rows;` |
| 상세 | `result.rows[0]`을 읽고 미존재 계약 처리 |
| 생성 | `{ insertId: result.insertId, rowsAffected: result.rowsAffected }` 반환 |
| 수정·삭제 | `{ rowsAffected: result.rowsAffected }` 반환 |
| 페이지 | `return db.executeList(sql, values, options);`로 `{ rows, header }` 전체 반환 |

`db.execute` 결과는 `{ rows, rowsAffected, insertId?, meta? }` 형태다. SELECT의 rowsAffected 의미는 adapter마다 다를 수 있으므로 조회 건수는 `rows.length`, 전체 페이지 건수는 `header.total`을 사용한다. insertId는 INSERT 결과로만 사용하고 모든 DB에서 모든 문장에 존재한다고 가정하지 않는다.

여러 DB 쓰기를 하나로 묶어야 하는 업무에만 아래 패턴을 사용한다. callback이 끝나면 commit, 오류를 던지면 rollback된다. `tx`는 callback 안에서만 사용하고 모든 DB 호출을 await한다. nested transaction·`tx.executeList`·직접 BEGIN/COMMIT·mini 전용 transactionSync를 생성하지 않는다. callback 안에서는 `db.execute` 대신 **`tx.execute`**를 사용한다.

```js
// Service 메서드 내부 패턴: SQL과 검증된 values는 해당 업무에서 준비한다.
return db.transaction(async (tx) => {
  const first = await tx.execute(firstSql, firstValues);
  await tx.execute(secondSql, secondValues);
  return { rowsAffected: first.rowsAffected };
});
```

트랜잭션의 콜백에서 오류를 잡아 성공으로 반환하면 rollback을 막을 수 있다. 실패를 전파한다. HTTP 이미지 업로드·외부 호출·파일 저장은 이 DB 트랜잭션에 포함되지 않는다. DB별 SQL 기능과 insertId 형식까지 보편적으로 같다고 가정하지 말고 실제 대상에서 검사한다.

## 5. SQL·스키마·입력 검증

- named SQL은 `-- @name: findById`처럼 이름을 지정하고 한 이름에 실행할 SQL 한 문장을 둔다. 요청 값은 `:id`, `:name` 등으로 바인딩한다.
- SQL에 untrusted 값을 문자열로 붙이지 않는다. table/column/sort는 바인딩할 수 없으므로 코드의 고정 허용 목록을 사용한다.
- 누락된 바인딩의 null 보정 또는 `fillPlaceholders`는 검증·부분 수정 기능이 아니다. Service에서 허용 필드만 선택하고 undefined/null 의미를 먼저 처리한다.
- DDL은 migration에, 조회·쓰기 DML은 `sql/`에 둔다. Product는 `demo_product`, `image_path AS imagePath` 계약을 유지한다. 기존 스키마 이름·테이블 접두사·컬럼 매핑을 임의로 변경하지 않는다.
- 신규 Product DB DDL은 `examples/product-database/{sqlite,mariadb}`에 있다. `DB_MIGRATIONS_DIR`은 이 상위 디렉터리를 가리킨다. 일반 업무는 설정된 기존 migration 구조를 따른다.
- schema-qualified SQL이 있으면 실제 DB schema와 mini의 `DB_APP_SCHEMA` 지원 범위를 확인한다. Product에는 schema prefix가 없다. 임의 `{{app}}` 토큰이나 모든 DB dialect를 자동 변환하는 가정을 추가하지 않는다.
- 이미 실행된 migration·checksum은 변경하지 않는다. 기존 데이터의 파괴·재seed는 요청 없이 수행하지 않는다. DB별 DDL과 같은 업무 DML의 호환 범위를 구별한다.

Product 검증 규칙:

| 입력 | 규칙 |
|---|---|
| `id` | 양의 안전 정수; query/path의 정수 문자열 허용 |
| `page` / `perPage` | 기본 1 / 10; 최대 1,000,000 / 100; 양의 안전 정수 |
| `q` / `sort` | trim 후 100자 이하 문자열 / newest,name,priceAsc,priceDesc 허용 목록 |
| `name` | 문자열, trim 후 1~100자 |
| `price` | JSON number, 0~1,000,000의 안전 정수; 숫자 문자열 자동 변환 금지 |
| `memo` | 생략/null 또는 최대 500자 문자열; trim 후 빈 값은 null |

기존 `positiveInteger`, `parseId`, `productPayload`를 유지한다. 배열·객체·불리언·지수 표기·소수·빈 값을 정상 숫자로 느슨하게 변환하지 않는다. 다른 업무의 범위와 필수값은 작업 입력에서 정한다.

## 6. Product 페이지 조회

`listPaged`는 Service 메서드명이고 엔진은 `db.executeList`다. 정렬은 `newest: 'id DESC'`, `name: 'name ASC, id ASC'`, `priceAsc: 'price ASC, id ASC'`, `priceDesc: 'price DESC, id DESC'`를 사용한다. 허용 목록 밖 값은 400이며 같은 값의 순서도 id로 고정한다.

아래는 **입력 검증이 끝난** listPaged 내부다. SORT_ORDERS와 검증은 완성 Service에서 유지한다.

```js
const escapedQuery = q.trim().replace(/[!%_]/g, (character) => '!' + character);
const keyword = `%${escapedQuery}%`;
const sql = `${this.productSql.get('findPaged')}\nORDER BY ${SORT_ORDERS[sort]}`;
return db.executeList(sql, { keyword }, {
  page: currentPage,
  perPage: pageSize,
  maxPerPage: 100,
});
```

```sql
-- @name: findPaged
SELECT id, name, price, memo, image_path AS imagePath
FROM demo_product
WHERE name LIKE :keyword ESCAPE '!'
   OR COALESCE(memo, '') LIKE :keyword ESCAPE '!'

-- @name: insert
INSERT INTO demo_product (name, price, memo, image_path)
VALUES (:name, :price, :memo, :imagePath);
```

findPaged에는 LIMIT/OFFSET을 넣지 않고 마지막 세미콜론을 생략한다. COUNT와 페이지 SQL은 프레임워크가 만든다. `__limit`, `__offset`은 예약 바인딩 이름이다. `{ rows, header }`를 그대로 Controller에 넘기면 loader가 rows를 data로, total/page/perPage/totalPages를 header로 보낸다. 빈 결과의 totalPages는 adapter에 따라 0 또는 1일 수 있다. 프런트 표시에서는 최소 1로 보정한다.

## 7. Product 이미지 계약

공통 `POST /api/uploads/multipart?profile=image`를 사용한다. 별도 이미지 Controller를 만들지 않는다. 관리자 인증·권한을 요구하며 multipart의 `file` 필드 하나, PNG/JPEG/WebP, 0바이트 초과·5 MiB 이하를 허용한다. 이미지 본문 한도는 6 MiB이고 공통 서버 한도가 더 낮으면 그 제한도 적용된다. 응답 data는 `{ fileName, size, url }`, 공개 경로는 `/uploads/images/<uuid>.<png|jpg|webp>`다.

서버는 MIME·시그니처를 확인한다. 완전한 이미지 디코딩·재인코딩이라고 설명하지 않는다. Service는 `validateImagePath`로 경로 형식과 파일 존재를 확인한다. 아래는 create 내부 패턴이다.

```js
const values = productPayload(input);
values.imagePath = await validateImagePath(input.imagePath);
const result = await db.execute(this.productSql.get('insert'), values);
return { insertId: result.insertId, rowsAffected: result.rowsAffected };
```

- DB에는 실제 업로드 응답의 상대 공개 경로만 저장한다. origin, `/public`, 절대 파일 경로, base64, blob URL, 임의 예시 UUID를 저장하지 않는다.
- 생성의 imagePath 생략/null/빈 문자열은 null. 수정의 **생략은 기존 값 유지**, null/빈 문자열은 연결 해제다.
- 업로드 성공·DB 저장 실패 시 URL을 보존해 재사용한다. 두 요청을 한 트랜잭션이라고 설명하지 않는다.
- 상품 삭제로 파일을 자동 삭제하지 않는다. 공유 URL을 참조하는 다른 레코드가 있을 수 있다.
- 다른 서버로 복사할 때 DB·계정·기존 데이터·실제 PUBLIC_DIR 이미지 파일과 환경은 별도로 준비한다. 소스 세 폴더 복사는 이 상태들을 이전하지 않는다.

## 8. 실행·검증·보고

Node >=22.19.0과 고정 package-lock.json을 사용한다. 검증 환경은 명령 실행 당시의 `node --version`, `npm --version`으로 기록한다. 아래 명령은 **mini Full 또는 최소 Starter 루트**에서 실행한다. Starter에는 Vue 클라이언트가 필요하지 않다.

```sh
npm ci --ignore-scripts
# 생성한 업무 workspace와 해당 업무 검사 파일의 실제 경로로 바꾼다.
npm run workspace:compile -- ./my-workspace
npm run workspace:verify -- --workspace ./my-workspace --cases ./my-cases.json
# migration이 workspace 밖에 있으면 --migrations ./my-database를 추가한다.
```

범용 검사기는 workspace를 임시 경로로 복사하고 새 SQLite DB·계정으로 서버를 실행한다. 서버 실행 중 메모리 사용을 줄이기 위해 기존 컴파일러를 별도 프로세스에서 실행해 임시 캐시를 먼저 만들고 그 프로세스가 종료된 뒤 변경하지 않은 API 런타임을 실행하며, 컴파일 단계에는 별도 메모리가 필요하므로 전체 실행의 최대 메모리 감소를 보장하지 않는다. cases는 같은 서버·DB에서 순서대로 실행할 JSON 배열이다. path/status는 필수, method 기본값은 GET이며 body/auth/expect/name은 선택이다. auth 생략은 비로그인이며 관리자 검사가 필요할 때 `'admin'`을 사용한다. expect 객체는 부분 일치, 배열은 길이·순서까지 일치한다. response id 캡처·변수 치환은 제공하지 않으므로 필요하면 업무 전용 Node 검증기를 작성한다.

```json
[
  { "name": "공개 목록", "method": "GET", "path": "/api/example", "status": 200, "expect": { "code": 200 } }
]
```

위 경로·assertion은 실제 업무에 맞춰 바꾼다. 상태 코드만 확인하지 말고 중요한 응답 필드·오류·상태 변경을 검사한다. cases 없는 실행은 startup/metadata 확인이며 **businessVerified:false**다. businessRequests는 HTTP 요청 수, businessAssertions는 expect가 있는 요청 수다. 상태 코드 검사만으로 payload 검증을 완료했다고 말하지 않는다. 요청 사례가 통과해도 검사하지 않은 업무 요구사항까지 검증됐다고 보고하지 않는다.

동봉 Product 검사와 컴파일은 같은 mini 루트에서 실행한다.

```sh
npm run workspace:compile -- ./examples/product-workspace
npm run workspace:verify -- --workspace examples/product-workspace --migrations examples/product-database --cases docs/AI_WORKSPACE_CASES.json
npm run product:verify
npm run product:contract
```

컴파일·metadata 생성 성공은 HTTP 성공이 아니다. 실제 HTTP 검사 성공도 다른 업무의 요구사항을 자동으로 검증하지 않는다. 신규 API는 자기 payload·경로·상태·영속성 assertion을 가진 검증기를 추가한다. 기존 `api:verify`는 Note, `product:verify`는 Product 전용이다. 신규 업무 파일에는 `npm run workspace:compile -- ./대상-workspace`를 사용하고 해당 설정으로 별도 HTTP 검증을 실행한다.

수동 Product 실행은 같은 루트에서 `npm run product:account`, `npm run start:product`다. 기본 주소는 `http://127.0.0.1:8901`. 일반 `npm start`는 기본 Note 예제를 실행한다. 환경·`.env`의 APP_WORKSPACE/DB_MIGRATIONS_DIR/DATA_DIR/DB_FILE/계정 경로 override를 두 명령이 함께 사용하므로 다른 예제 설정이 남아 있지 않은지 확인한다.

Express 검증은 설치된 첨부 1.45.8을 대상으로 **mini 루트**에서 실행한다.

```sh
# Bash: 실제 경로로 바꾼다. 같은 업무 파일을 외부 workspace에 복사해 실행한다.
EXPRESS_PROJECT_ROOT=/absolute/path/aidot-express node scripts/verify-product.mjs
EXPRESS_PROJECT_ROOT=/absolute/path/aidot-express node scripts/verify-product-contract.mjs
```

PowerShell은 `$env:EXPRESS_PROJECT_ROOT = 'C:\path\aidot-express'` 설정 후 위 두 node 명령을 실행한다. Express 수동 실행은 Express 루트의 `npm ci`, `npm run start:main`이며 APP_WORKSPACE, DB_MIGRATIONS_DIR, DB_TYPE, DB_FILE, PUBLIC_DIR와 해당 호스트 계정을 준비한다.

검증 보고에는 컴파일/HTTP를 나눠 **실제로 실행한 명령·종료 코드·검사 결과**를 기록한다. 공개 조회·인증 실패·권한 실패·정상 CRUD·잘못된 필드·없는 id·페이지 경계·검색 escape·서버 재시작 후 DB/이미지 유지·rollback(추가한 경우)을 검사한다. 임시 DB·계정으로 수행하고 운영 데이터를 검증용으로 삭제하지 않는다. 실행하지 못한 Express/MariaDB/Windows/브라우저 검사를 성공으로 기재하지 않는다.
