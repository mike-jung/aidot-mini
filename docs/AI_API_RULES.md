# aidot-mini API 구현 지침 — 이 문서만으로 작업하는 AI용

문서 개정: 2026-09-12 · 기준 실행 프로젝트: aidot-mini 0.6.0

이 문서는 Claude 등 **이 프로젝트와 이전 대화를 전혀 모르는 AI**에게 전달하는 작업 지침이다. 아래에 프로그램 구조, 사용할 함수의 의미, 생략 없는 예제 파일, 실행·검증 방법을 모두 적었다. 다른 프로젝트의 이름이나 별도 튜토리얼을 알아야 이해할 수 있는 전제는 없다.

이 문서로 코드의 규칙을 이해할 수 있다. 실제 실행에는 사용자가 제공한 **aidot-mini 최소 프로젝트**가 필요하다. 이 문서에 서버 런타임 전체를 다시 구현하라는 뜻은 아니다. 프로젝트가 없다면 업무 파일을 작성할 수는 있지만 실행 성공을 주장하지 말고 필요한 런타임 파일을 명시한다.

## 1. AI가 맡은 일과 사용자가 제공할 정보

당신의 일은 사용자의 업무 요구사항을 HTTP API로 구현하는 것이다. API는 웹 요청으로 데이터를 조회·추가·수정·삭제하는 기능이다. 이 네 동작을 CRUD라고 한다.

사용자가 다음 정보를 제공했는지 확인한다. 이미 제공된 정보는 다시 묻지 않는다. 경로·이름 등 일반적인 선택은 작업 내용을 근거로 정하고 기록하되, 데이터 삭제 정책·공개 범위처럼 동작을 크게 바꾸는 조건은 임의로 확정하지 않는다.

| 입력 | 구체적인 예 |
|---|---|
| 프로젝트 루트 | `C:/dev/aidot-mini` 또는 `/opt/aidot-mini` |
| 업무 파일을 넣을 폴더 | 기본 `workspace` 또는 지정한 외부 폴더 |
| API 기능 | 작업 목록 조회, 작업 추가, 작업 수정, 작업 삭제 |
| API 주소 | `/api/tasks`, `/api/tasks/:id` |
| 저장할 데이터 | 테이블 `task`, 필드 `id`, `title`, `body` |
| 입력 조건 | 제목 필수, 길이 1~200, 본문 생략 가능 |
| 인증 | 공개 API 또는 관리자 로그인 필요 |
| 응답·오류 정책 | 생성 201, 없는 데이터 조회 404, 입력 오류 400 |
| 기존 데이터 처리 | 기존 Note 유지 여부, 물리 삭제인지 상태 변경인지 |

완료할 때는 **업무 소스, 신규 DB migration, 서버가 자동 생성한 meta와 그 확인 결과, 실제 HTTP 검사 코드와 실행 결과**를 제출한다. 코드 설명만 제출하고 구현을 끝낸 것으로 처리하지 않는다.

## 2. 이미 제공된 서버는 무엇을 해 주는가

### 2.1 실행 환경과 자동 로딩

- JavaScript ES module 프로젝트다. 파일 확장자는 `.js`, 모듈 문법은 `import`와 `export`를 쓴다.
- Node.js **22.13 이상**이 필요하다. 내장 SQLite를 데이터베이스로 사용한다.
- 서버가 사용하는 npm 의존성은 `esbuild-wasm` 한 개다. 이 컴파일러가 아래의 `@Controller` 같은 문법을 처리한다.
- `@`로 시작하는 표시는 **annotation 또는 decorator**다. 이 문서에서는 클래스·메서드·필드에 서버의 역할을 표시하는 문법이다. Java 코드나 TypeScript 타입을 작성하라는 뜻은 아니다.
- 서버 시작 시 선택한 workspace의 migration을 적용하고, SQL과 Service를 읽은 뒤 Controller의 주소를 등록한다. 이 과정에서 Controller·Service의 meta 파일이 없으면 폴더와 파일을 자동 생성하고, 있으면 읽어 선언 정보를 동기화한다. 사용자 코드에서 서비스 생성·라우트 등록·DB 연결을 다시 작성하지 않는다.
- Controller와 Service는 서버가 만들고 재사용한다. 요청별 사용자 정보나 `params`를 `this` 필드에 보관하지 않는다.
- 코드 변경은 일반 실행에서는 서버를 재시작해 반영한다. 개발 중 `npm run dev`를 쓰면 파일 변경을 감지해 서버 프로세스를 재시작한다.

### 2.2 폴더와 파일의 역할

아래 경로는 **프로젝트 루트 기준**이다. `workspace`는 업무 폴더의 기본 이름이다.

| 경로 | 역할 | 새 API 작업 시 처리 |
|---|---|---|
| `start.js` | 서버 시작, DB와 업무 모듈 로딩 | 기존 파일 사용 |
| `src/` | annotation, HTTP, 인증, SQL, DB 구현 | 업무 API를 추가하려고 런타임을 재설계하지 않음 |
| `public/` | 관리자 콘솔 | 기본 Note 시험 화면 제공 |
| `workspace/controller/` | HTTP 주소와 Service 호출 | Controller 작성 |
| `workspace/service/` | 업무 처리와 SQL 실행 | Service 작성 |
| `workspace/sql/` | 이름으로 선택하는 SQL 쿼리 | SQL 파일 작성 |
| `workspace/controller/meta/` | Controller의 선언을 설명하는 JSON | 서버가 없으면 생성하고 자동 로딩 |
| `workspace/service/meta/` | Service의 선언을 설명하는 JSON | 서버가 없으면 생성하고 자동 로딩 |
| `workspace/migrations/` | 테이블·인덱스 등의 생성과 변경 | 적용 이력을 보존하며 새 SQL 파일 추가 |
| `scripts/` | 개발·검증 명령 | 필요하면 새 API의 검증 스크립트 추가 |
| `module.json` | 내보낼 업무 파일 목록 | 이식할 파일 목록 갱신 |
| `data/` | 기본 DB, 설정, 관리자 계정의 저장 위치 | 업무 소스와 함께 복사하거나 덮어쓰지 않음 |

기본 배치는 Controller와 Service 파일을 각각 해당 폴더 바로 아래에 두는 것이다. 자동 로더는 하위 폴더도 탐색하지만 `meta` 폴더와 JSON을 업무 코드로 실행하지 않는다. 다른 파일을 참조하는 상대 import가 있다면 파일 이동에 따라 그 관계도 확인한다. 심볼릭 링크로 업무 파일을 연결하지 않는다.

### 2.3 사용자 workspace 선택

가장 간단한 방법은 프로젝트의 `.env`에 다음 값을 넣는 것이다. 아래는 Windows 경로 예다. Linux에서는 `/opt/my-api-workspace`처럼 실제 서버 경로로 바꾼다.

```dotenv
APP_WORKSPACE=C:/work/my-api-workspace
DATA_DIR=C:/work/my-api-data
```

`APP_WORKSPACE`는 **업무 폴더의 최상위 경로**다. `controller` 폴더 자체를 지정하지 않는다. 해당 경로 안에 `controller`, `service`, `sql`, `migrations`가 있어야 한다. `DATA_DIR`는 데이터 저장 위치이며 업무 코드 폴더와 역할이 다르다.

콘솔의 설정 화면에서도 workspace를 지정할 수 있다. OS 환경변수는 `.env`보다 우선하고, 환경변수와 `.env`는 콘솔에 저장한 설정보다 우선한다. 바꾼 뒤 서버를 재시작한다. 원격 브라우저에서 입력하는 경로도 **서버 컴퓨터의 경로**다.

새 폴더를 만들면서 기본 예제를 복사하려면 프로젝트 루트에서 실행한다.

```bash
npm run workspace:init -- ./my-api-workspace
```

완전히 빈 업무 폴더가 필요하면 다음을 쓴다.

```bash
npm run workspace:init -- ./my-api-workspace --empty
```

명령은 기존 파일이 있는 대상 폴더를 덮어쓰지 않는다. 외부 workspace에도 아래 예제의 프레임워크 import 문자열은 유지한다. 서버 로더가 설정된 업무 폴더의 표준 import를 해당 런타임에 연결한다.

## 3. 사용할 문법과 함수 — 이름만 보고 추측하지 말 것

### 3.1 Annotation

| 문법 | 어디에 쓰는가 | 정확한 의미 |
|---|---|---|
| `@Controller('/api/notes')` | Controller 클래스 위 | 클래스의 공통 HTTP 경로 |
| `@GetMapping('/')` | Controller 메서드 위 | 목록 GET. 최종 주소는 `/api/notes` |
| `@GetMapping('/:id')` | Controller 메서드 위 | 단건 GET. `id`를 경로에서 추출 |
| `@PostMapping('/')` | Controller 메서드 위 | 생성 POST |
| `@PutMapping('/:id')` | Controller 메서드 위 | 수정 PUT |
| `@DeleteMapping('/:id')` | Controller 메서드 위 | 삭제 DELETE |
| `@Service('NoteService')` | Service 클래스 위 | 주입할 서비스의 등록 이름 |
| `@Autowired('NoteService') noteService;` | 클래스 필드 | 등록된 서비스를 `this.noteService`로 사용 |
| `@Sql('note') noteSql;` | Service 필드 | 선택한 workspace의 `sql/note.sql` 쿼리 묶음을 주입 |
| `@Log log;` | 클래스 필드 | `this.log.info(...)`, `debug(...)` 등을 제공 |
| `@Auth()` | Controller **메서드** 위 | 해당 경로가 관리자 인증을 요구함 |

`@Log`에는 괄호를 붙이지 않는다. `@Controller`, `@Service`, `@Autowired`, `@Sql`, `@Auth`는 예제처럼 괄호를 쓴다. Controller와 Service는 모두 `export default class`로 내보낸다.

업무 소스가 가져오는 기본 모듈은 다음 세 개다. 이미 서버에 들어 있는 모듈이므로 AI가 다시 구현하지 않는다.

| import 경로 | 가져오는 기능 |
|---|---|
| `../../src/core/decorators.js` | 위 annotation 함수들 |
| `../../src/database/db.js` | 기본 export인 `db`, 그 안의 `execute` |
| `../../src/core/sqlLoader.js` | 이름 있는 export `fillPlaceholders` |

### 3.2 Controller의 `params`, `req`, `res`

Controller 메서드를 서버가 `method(params, req, res)` 형태로 호출한다. 첫 인자는 request 객체가 아니라 **합쳐진 입력 값**이다.

`params`는 URL query, JSON body, URL path parameter를 합친 객체이며 우선순위는 **query < body < path**다. query와 path 값은 기본적으로 문자열이다. 검증 없이 숫자라고 가정하지 않는다.

```http
PUT /api/notes/7?id=99
Content-Type: application/json

{"id":88,"title":"Changed","body":null}
```

위 요청에서 메서드가 받는 값은 `params.id === '7'`, `params.title === 'Changed'`, `params.body === null`이다. 경로의 ID가 다른 입력보다 우선한다.

- `req`는 요청 정보다. 필요한 경우 헤더 또는 인증이 설정한 `req.user`를 읽는다.
- `res`는 응답 전송 객체다. 예제의 `res.status(201).json(...)`를 지원한다.
- 일반 메서드는 값을 `return`하면 된다. 서버가 아래 성공 응답 형식으로 감싼다.
- 생성 메서드처럼 `res.status(...).json(...)`을 호출했다면 응답을 다시 전송하거나 다른 결과를 `return`해 이중 응답을 만들지 않는다.

### 3.3 SQL 선택과 DB 호출

```javascript
const sql = this.noteSql.get('findById');
const result = await db.execute(sql, { id });
```

첫 줄은 `note.sql`에서 `-- @name: findById` 아래의 SQL 문자열을 가져온다. 아직 DB를 실행하지 않는다. 두 번째 줄이 실제 쿼리를 실행한다.

- `db.execute(sql, params)`는 비동기이므로 `await`한다.
- SELECT 결과는 `result.rows` 배열이다. 단건은 `result.rows[0] ?? null`로 반환한다.
- INSERT 후에는 `result.insertId`와 `result.rowsAffected`를 사용한다.
- UPDATE·DELETE 후에는 `result.rowsAffected`를 사용한다.
- 한 번의 `execute`에는 **SQL 문장 하나**를 넘긴다. migration 파일에는 여러 DDL 문장이 들어갈 수 있다.
- 값은 SQL의 `:id`, `:title` 같은 이름에 바인딩한다. 입력 값을 SQL 문자열에 직접 이어 붙이지 않는다.
- 테이블명·정렬 컬럼처럼 SQL 식별자가 입력에서 온다면 값 바인딩으로 해결되지 않는다. 허용된 이름을 코드에서 선택한다.
- 선택한 workspace의 SQL 파일명, `@Sql('...')`, `.get('쿼리이름')`이 서로 일치해야 한다.

`fillPlaceholders(sql, params)`는 SQL에 있는 `:이름`만 골라 객체를 만들고, 값이 없거나 `undefined`이면 `null`로 채운다. 보안 검사나 필수값 검사를 해 주는 함수가 아니다.

```javascript
fillPlaceholders('UPDATE note SET body = :body WHERE id = :id', { id: 7 });
// 결과: { body: null, id: 7 }
```

따라서 아래 예제의 PUT은 지정한 필드를 전체 교체한다. `body`를 보내지 않아도 기존 값을 유지하지 않고 NULL로 바꾼다. 일부 필드만 유지하며 수정하는 API가 필요하다면 별도 요구사항으로 정하고 SQL·검증·테스트를 함께 작성한다.

### 3.4 응답 형식과 상태 코드

| 동작 | HTTP 상태 | `data`에 들어가는 값 |
|---|---|---|
| 목록 조회 | 200 | 행 배열 |
| 단건 조회 | 200 | 행 객체 |
| 없는 행 단건 조회 | 404 | 오류 응답에는 `data`가 없을 수 있음 |
| 생성 | 201 | `{ "insertId": 2, "rowsAffected": 1 }` |
| 수정 | 200 | `{ "rowsAffected": 1 }` |
| 삭제 | 200 | `{ "rowsAffected": 1 }` |
| 없는 행 수정·삭제 | 200 | `{ "rowsAffected": 0 }` |

일반 성공 응답의 예는 다음과 같다. ID와 시각은 실행마다 달라진다.

```json
{
  "code": 200,
  "message": "OK",
  "header": {
    "requestCode": "read-001",
    "timestamp": "2026-09-12 18:00:00"
  },
  "data": {
    "id": 2,
    "title": "My note",
    "body": null,
    "created_at": "2026-09-12 09:00:00",
    "updated_at": null
  }
}
```

`header.requestCode`는 요청에 넣은 `requestCode`를 되돌려 주며 생략 시 null이다. 응답 `header.timestamp`는 서버가 서울 시간으로 만든 문자열이다. DB의 `created_at`과 같은 뜻이나 시간대라고 가정하지 않는다.

아래 기본 메서드처럼 행·배열·결과 객체를 반환한다. 새로운 API에서 이미 `data`나 `rows`라는 키를 가진 복합 객체를 반환하려면 서버의 응답 변환과 충돌하는지 실제 응답을 확인한다.

의도한 오류는 예제처럼 `Object.assign(new Error('메시지'), { status: 404 })`로 발생시킨다. 일반 내부 오류는 500이다. 오류를 잡아서 성공 응답으로 바꾸거나 모든 실패를 빈 배열로 숨기지 않는다.

## 4. 기본 Note 예제의 동작과 적용 방법

Note는 제목과 본문을 저장하는 메모다. 아래 **Controller·Service·SQL·migration 네 파일**이 직접 작성할 공개 CRUD 예제다. 파일 제목의 경로로 저장한다. 이어지는 두 meta JSON은 서버의 자동 생성 결과를 이해하기 위한 참고 자료이며, 사용자가 작성하거나 복사할 필요가 없다.

| 필드 | 저장 의미와 현재 동작 |
|---|---|
| `id` | DB가 증가시키는 기본키. 생성 body에서 직접 지정하지 않음 |
| `title` | NULL 불가 문자열. 기본 코드에는 공백·길이 검증이 없음 |
| `body` | 문자열 또는 null. 생략하면 null |
| `created_at` | INSERT 시 DB의 기본 시각 |
| `updated_at` | nullable 예약 필드. 기본 UPDATE는 자동 갱신하지 않음 |

아래 코드는 읽기 쉽게 줄바꿈과 경로 설명 주석을 정리한 **완전한 실행 예제**다. 필수 코드가 생략된 의사코드가 아니다. SQL의 `VARCHAR(200)`만으로 SQLite가 문자열 길이를 제한한다고 가정하지 않는다.

빈 프로젝트/새 업무 폴더에 재현하거나 기존 동일 파일을 참고하는 용도다. 이미 적용된 `002_create_note.sql`을 다시 작성해 migration 체크섬을 바꾸지 않는다. 새 API와 변경된 테이블에는 새 번호의 migration을 추가한다.

### 파일: `workspace/controller/NoteController.js`

```javascript
///
/// NoteController
/// My Note API
///

import {
  Controller,
  Log,
  GetMapping,
  PostMapping,
  PutMapping,
  DeleteMapping,
  Autowired,
} from '../../src/core/decorators.js';


@Controller('/api/notes')
export default class NoteController {

  @Autowired('NoteService') noteService;

  @Log log;

  // 1. GET /api/notes/  →  NoteController.list
  @GetMapping('/')
  async list(params) {
    this.log.info(`${this.constructor.name}::list 호출됨`);
    const result = await this.noteService.list();
    return result;
  }

  // 2. GET /api/notes/:id  →  NoteController.get
  @GetMapping('/:id')
  async get(params) {
    this.log.info(`${this.constructor.name}::get 호출됨 -> id=${params.id}`);
    const result = await this.noteService.getById(params.id);
    if (result === null || result === undefined) {
      throw Object.assign(
        new Error(`id ${params.id} 을(를) 찾을 수 없습니다`),
        { status: 404 },
      );
    }
    return result;
  }

  // 3. POST /api/notes/  →  NoteController.create
  @PostMapping('/')
  async create(params, req, res) {
    this.log.info(`${this.constructor.name}::create 호출됨 -> params=${JSON.stringify(params)}`);
    const result = await this.noteService.create(params);
    res.status(201).json({
      code: 201,
      message: 'Created',
      header: {
        requestCode: params.requestCode || null,
        timestamp: new Date().toLocaleString('sv-SE', {
          timeZone: 'Asia/Seoul',
          hour12: false,
        }).replace('T', ' '),
      },
      data: result,
    });
  }

  // 4. PUT /api/notes/:id  →  NoteController.update
  @PutMapping('/:id')
  async update(params) {
    this.log.info(`${this.constructor.name}::update 호출됨 -> id=${params.id}`);
    return this.noteService.update(params);
  }

  // 5. DELETE /api/notes/:id  →  NoteController.remove
  @DeleteMapping('/:id')
  async remove(params) {
    this.log.info(`${this.constructor.name}::remove 호출됨 -> id=${params.id}`);
    return this.noteService.remove(params.id);
  }
}
```

Controller의 `create`는 전체 응답을 직접 보내므로 `header`도 작성한다. 이 반환 형태를 `{ id }`, 저장된 행 또는 `{ success: true }`로 임의 변경하지 않는다. 기존 클라이언트가 생성된 행을 읽으려면 `data.insertId`로 GET을 호출한다.

### 파일: `workspace/service/NoteService.js`

```javascript
///
/// NoteService
/// My Note Service
///

import { Service, Sql, Log } from '../../src/core/decorators.js';
import db from '../../src/database/db.js';
import { fillPlaceholders } from '../../src/core/sqlLoader.js';


@Service('NoteService')
export default class NoteService {

  // SQL 파일: 선택한 workspace의 sql/note.sql
  @Sql('note') noteSql;

  @Log log;

  // 전체 조회
  async list() {
    this.log.info(`${this.constructor.name}::list 호출됨`);
    const sql = this.noteSql.get('findAll');
    const res = await db.execute(sql, {});
    return res.rows;
  }

  // 단건 조회
  async getById(id) {
    this.log.debug(`${this.constructor.name}::getById 호출됨 -> id=${id}`);
    const sql = this.noteSql.get('findById');
    const res = await db.execute(sql, { id });
    return res.rows[0] ?? null;
  }

  // 생성
  async create(payload) {
    this.log.info(`${this.constructor.name}::create 호출됨`);
    const sql = this.noteSql.get('insert');
    const res = await db.execute(sql, payload);
    return { insertId: res.insertId, rowsAffected: res.rowsAffected };
  }

  // 수정
  async update(params) {
    this.log.info(`${this.constructor.name}::update 호출됨 -> id=${params?.id}`);
    const sql = this.noteSql.get('update');
    const res = await db.execute(sql, fillPlaceholders(sql, params));
    return { rowsAffected: res.rowsAffected };
  }

  // 삭제
  async remove(id) {
    this.log.info(`${this.constructor.name}::remove 호출됨 -> id=${id}`);
    const sql = this.noteSql.get('deleteById');
    const res = await db.execute(sql, { id });
    return { rowsAffected: res.rowsAffected };
  }
}
```

생성 후 행을 다시 SELECT하는 보조 메서드나 별도 Repository 계층을 기본 예제에 추가하지 않는다. 여러 단계의 업무가 실제로 필요하면 그 요구를 구현하되, 해당 단계가 왜 필요한지와 실패 시 동작을 테스트한다. 예제의 로그 형식은 참고용이며 새 API에서 비밀번호·토큰·민감한 본문을 통째로 로그에 넣지 않는다.

### 파일: `workspace/sql/note.sql`

```sql
-- note.sql  (auto-generated)
-- My Note
-- 접근 키: 'note:<n>'  (예: 'note:findAll')

-- @name: findAll
SELECT id, title, body, created_at, updated_at FROM note ORDER BY id DESC;

-- @name: findById
SELECT id, title, body, created_at, updated_at FROM note WHERE id = :id;

-- @name: insert
INSERT INTO note (title, body)
VALUES (:title, :body);

-- @name: update
UPDATE note
   SET title = :title, body = :body
 WHERE id = :id;

-- @name: deleteById
DELETE FROM note WHERE id = :id;
```

`-- @name:` 뒤의 이름이 Service의 `.get(...)` 인자다. 실제 테이블 이름은 `note`다. SQL 파일에는 조회·변경 쿼리를 두고, 테이블 생성은 아래 migration에 둔다.

### 파일: `workspace/migrations/002_create_note.sql`

```sql
-- Create the table used by the Note example.
CREATE TABLE IF NOT EXISTS note (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  title      VARCHAR(200) NOT NULL,
  body       TEXT,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NULL,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_note_created ON note (created_at);

INSERT INTO note (title, body)
SELECT '첫 메모', 'aidot-mini 가 정상 동작합니다.'
WHERE NOT EXISTS (SELECT 1 FROM note);
```

### 파일: `workspace/migrations/003_note_seed_english.sql`

기존 migration 체크섬을 보존하면서 초기 샘플을 영문으로 바꾸는 후속 파일이다. 위 002와 함께 포함한다.

```sql
-- Translate only the original, unedited bundled Note seed.
UPDATE note
SET title = 'First note', body = 'aidot-mini is running correctly.'
WHERE id = 1 AND title = '첫 메모'
  AND body = 'aidot-mini 가 정상 동작합니다.' AND updated_at IS NULL;
```


002 파일은 테이블을 만들고 처음 한 번 메모를 넣고, 003 파일은 초기 행만 영문으로 바꾼다. aidot-mini의 migration 어댑터가 위의 `BIGINT ... AUTO_INCREMENT` 기본키 패턴을 SQLite 형식으로 변환한다. 이 DDL을 SQLite CLI에서 변환 없이 실행할 수 있다는 뜻은 아니다. 새 API도 서버의 migration 실행으로 검증한다. 임의의 DB 전용 문법까지 자동 변환된다고 가정하지 않는다.

migration은 파일명 순서로 적용되며, 적용한 내용의 체크섬을 기록한다. 이미 적용한 파일의 내용이 바뀌면 시작이 실패할 수 있다. 오류를 없애려고 기존 DB나 migration 이력을 지우지 않는다.

### 서버 자동 생성 결과: `workspace/controller/meta/NoteController.meta.json`

```json
{
  "name": "NoteController",
  "basePath": "/api/notes",
  "controllerType": "DB",
  "serviceName": "NoteService",
  "description": "My Note API",
  "auth": false,
  "roles": [],
  "routes": [
    {
      "type": "list",
      "method": "get",
      "path": "/",
      "handlerName": "list",
      "auth": false,
      "roles": []
    },
    {
      "type": "getById",
      "method": "get",
      "path": "/:id",
      "handlerName": "get",
      "auth": false,
      "roles": []
    },
    {
      "type": "create",
      "method": "post",
      "path": "/",
      "handlerName": "create",
      "auth": false,
      "roles": []
    },
    {
      "type": "update",
      "method": "put",
      "path": "/:id",
      "handlerName": "update",
      "auth": false,
      "roles": []
    },
    {
      "type": "remove",
      "method": "delete",
      "path": "/:id",
      "handlerName": "remove",
      "auth": false,
      "roles": []
    }
  ],
  "realtime": {
    "enabled": false,
    "channel": ""
  },
  "_generatedAt": "2026-09-12T13:01:12.485Z",
  "_version": 2
}
```

### 서버 자동 생성 결과: `workspace/service/meta/NoteService.meta.json`

```json
{
  "name": "NoteService",
  "sqlFile": "note",
  "description": "My Note Service",
  "methods": [
    "list",
    "getById",
    "create",
    "update",
    "remove"
  ],
  "multiSqlMethods": [],
  "_generatedAt": "2026-09-12T13:01:12.494Z",
  "_version": 2
}
```

### 4.1 meta는 서버가 생성하고 읽는다

사용자와 AI는 Controller·Service 코드에 선언한다. `controller/meta`와 `service/meta` 폴더 및 파일을 미리 만들지 않아도 된다. 서버가 코드와 annotation을 읽으면서 다음 동작을 수행한다.

| 실행 시 파일 상태 | 동작 | 관리자 조회의 `status` |
|---|---|---|
| meta 파일 또는 폴더가 없음 | 해당 파일 옆의 `meta/<파일명>.meta.json`을 만들고 로딩 | `generated` |
| 기존 파일과 코드 선언이 같음 | 기존 JSON을 로딩. 파일 내용·수정 시각 유지 | `loaded` |
| 경로·메서드·주입·인증 선언이 달라짐 | 코드 기준으로 동기화하고 로딩 | `updated` |
| JSON 손상·지원하지 않는 버전 | 파일을 덮어쓰지 않고 명확한 오류로 시작 중단 | 성공 상태 없음 |

Controller의 `name`, `basePath`, Service 주입 이름, 경로별 `method`, `path`, `handlerName`, `auth`, `roles`는 실제 선언에서 가져온다. 기본 CRUD의 `type`은 `list`, `getById`, `create`, `update`, `remove`다. 따라서 단건 경로의 `type: "getById"`와 `handlerName: "get"`은 역할이 다르다.

Service의 `sqlFile`은 `@Sql`의 단일 파일 이름이며 `.sql`을 붙이지 않는다. `methods`는 실제 메서드 이름을 기록한다. 위 두 JSON은 기본형의 생성 결과다. `_generatedAt`은 서버가 생성·갱신한 시각이므로 예시 시각과 달라도 정상이다. `_version: 2`는 메타데이터 형식 버전이다.

기존 설명, 확장 필드와 유지되는 경로의 부가 정보는 보존한다. 여러 Service·SQL을 함께 사용하거나 사용자 정의 로직을 가진 코드는 단일 DB CRUD 편집 모델로 모두 역변환할 수 없다. 메서드 본문을 추측하여 `multiSqlMethods`를 만들거나 realtime 기능을 켜지 않는다. 표준 예제는 `multiSqlMethods: []`, `realtime.enabled: false`다.

**라우트 등록과 인증의 기준은 코드다.** meta의 `auth`를 손으로 바꿔도 인증 정책이 생기거나 없어지지 않는다. 코드를 바꾼 뒤 재시작한다. SQL별 `sql/meta` 파일은 만들지 않는다. SQL 쿼리 이름은 `-- @name:`으로 표현한다. 삭제·이름 변경된 업무 파일의 오래된 meta는 로딩 대상에서 제외되며 서버가 사용자 파일을 임의 삭제하지 않는다.

관리자 로그인 후 같은 브라우저에서 `/admin/metadata`를 열면 `data.controllers`, `data.services`의 파일 경로·상태·실제로 읽은 JSON을 확인할 수 있다. 익명 요청은 401이다. `npm run contract:check`도 생성·로딩과 선언 검사를 수행한다. 이 명령의 성공은 업무 SQL과 HTTP 응답까지 검증했다는 뜻은 아니다.

첫 생성 또는 선언 갱신에는 workspace 쓰기 권한이 필요하다. 읽기 전용 배포는 **쓰기 가능한 빌드 위치에서** `npm run workspace:compile`을 실행하고 생성된 meta를 원본 코드와 함께 배포한다. 이미 일치하는 meta를 로딩할 때는 다시 쓰지 않는다.

## 5. 인증이 필요한 예제

기본 Note API는 공개다. 관리자 콘솔의 로그인 요구와 업무 API의 공개 여부는 별개다. 공개 API에 관리자 키 입력을 추가하지 않는다.

같은 Note CRUD에 인증을 요구하려면 다음 Controller를 사용한다. 이어지는 meta는 이 코드에서 자동 생성되는 결과다. `workspace/` 공개형과 **별도의 교체용 workspace**다. 동일한 Controller 두 개를 한 업무 폴더에 넣지 않는다.

아래 폴더의 `service/`, `sql/`, `migrations/`에는 4절의 해당 파일을 같은 상대 구조로 복사한다. `meta` 폴더는 서버가 만든다. 인증 때문에 Service나 SQL을 바꾸지 않는다.

### 파일: `examples/note-auth-workspace/controller/NoteController.js`

```javascript
///
/// NoteController
/// My Note API
///

import {
  Controller,
  Log,
  GetMapping,
  Auth,
  PostMapping,
  PutMapping,
  DeleteMapping,
  Autowired,
} from '../../src/core/decorators.js';


@Controller('/api/notes')
export default class NoteController {

  @Autowired('NoteService') noteService;

  @Log log;

  // 1. GET /api/notes/  →  NoteController.list
  @GetMapping('/')
  @Auth()
  async list(params) {
    this.log.info(`${this.constructor.name}::list 호출됨`);
    const result = await this.noteService.list();
    return result;
  }

  // 2. GET /api/notes/:id  →  NoteController.get
  @GetMapping('/:id')
  @Auth()
  async get(params) {
    this.log.info(`${this.constructor.name}::get 호출됨 -> id=${params.id}`);
    const result = await this.noteService.getById(params.id);
    if (result === null || result === undefined) {
      throw Object.assign(
        new Error(`id ${params.id} 을(를) 찾을 수 없습니다`),
        { status: 404 },
      );
    }
    return result;
  }

  // 3. POST /api/notes/  →  NoteController.create
  @PostMapping('/')
  @Auth()
  async create(params, req, res) {
    this.log.info(`${this.constructor.name}::create 호출됨 -> params=${JSON.stringify(params)}`);
    const result = await this.noteService.create(params);
    res.status(201).json({
      code: 201,
      message: 'Created',
      header: {
        requestCode: params.requestCode || null,
        timestamp: new Date().toLocaleString('sv-SE', {
          timeZone: 'Asia/Seoul',
          hour12: false,
        }).replace('T', ' '),
      },
      data: result,
    });
  }

  // 4. PUT /api/notes/:id  →  NoteController.update
  @PutMapping('/:id')
  @Auth()
  async update(params) {
    this.log.info(`${this.constructor.name}::update 호출됨 -> id=${params.id}`);
    return this.noteService.update(params);
  }

  // 5. DELETE /api/notes/:id  →  NoteController.remove
  @DeleteMapping('/:id')
  @Auth()
  async remove(params) {
    this.log.info(`${this.constructor.name}::remove 호출됨 -> id=${params.id}`);
    return this.noteService.remove(params.id);
  }
}
```

### 서버 자동 생성 결과: `examples/note-auth-workspace/controller/meta/NoteController.meta.json`

```json
{
  "name": "NoteController",
  "basePath": "/api/notes",
  "controllerType": "DB",
  "serviceName": "NoteService",
  "description": "My Note API",
  "auth": true,
  "roles": [],
  "routes": [
    {
      "type": "list",
      "method": "get",
      "path": "/",
      "handlerName": "list",
      "auth": true,
      "roles": []
    },
    {
      "type": "getById",
      "method": "get",
      "path": "/:id",
      "handlerName": "get",
      "auth": true,
      "roles": []
    },
    {
      "type": "create",
      "method": "post",
      "path": "/",
      "handlerName": "create",
      "auth": true,
      "roles": []
    },
    {
      "type": "update",
      "method": "put",
      "path": "/:id",
      "handlerName": "update",
      "auth": true,
      "roles": []
    },
    {
      "type": "remove",
      "method": "delete",
      "path": "/:id",
      "handlerName": "remove",
      "auth": true,
      "roles": []
    }
  ],
  "realtime": {
    "enabled": false,
    "channel": ""
  },
  "_generatedAt": "2026-09-12T13:01:12.499Z",
  "_version": 2
}
```

프로젝트에 이 교체용 예제가 이미 있다면 다음 명령으로 별도 업무 폴더를 만든다.

```bash
npm run workspace:init -- ./protected-workspace --example auth
```

그 폴더를 `APP_WORKSPACE`로 선택하고 서버를 재시작하면 다섯 경로가 모두 인증을 요구한다.

현재 기본 인증의 범위는 **관리자 ID/Password 로그인 세션 또는 서버의 관리자 Bearer 토큰**이다. `@Auth()`를 붙여도 일반 고객용 회원가입·비밀번호 관리·사용자별 권한 시스템이 생기지 않는다. 그 요구가 있으면 별도로 설계한다. 일반 사용자를 모두 관리자로 처리하는 코드를 만들지 않는다.

콘솔에서는 ID/Password로 로그인한다. 콘솔은 세션 쿠키와 변경 요청의 CSRF 헤더를 처리하므로 사용자가 매번 관리자 키를 입력할 필요가 없다. 아래 자동 검증 스크립트는 자기 임시 서버에만 사용할 임시 토큰을 생성한다. 운영 계정이나 키를 사용하지 않는다.

## 6. 새로운 API를 만들 때 바꿀 곳

예를 들어 동일한 `title`, `body` 필드로 Task API를 만드는 경우다. **Note를 유지할지 교체할지는 사용자 요구를 따른다.**

| Note 예제 | Task 예 |
|---|---|
| `NoteController.js`, `class NoteController` | `TaskController.js`, `class TaskController` |
| `@Controller('/api/notes')` | `@Controller('/api/tasks')` |
| `@Autowired('NoteService') noteService` | `@Autowired('TaskService') taskService` |
| `this.noteService` | `this.taskService` |
| `NoteService.js`, `@Service('NoteService')` | `TaskService.js`, `@Service('TaskService')` |
| `@Sql('note') noteSql` | `@Sql('task') taskSql` |
| `this.noteSql` | `this.taskSql` |
| `sql/note.sql`, 테이블 `note` | `sql/task.sql`, 테이블 `task` |
| 자동 생성: `controller/meta/NoteController.meta.json` | 자동 생성: `controller/meta/TaskController.meta.json` |
| 자동 생성: `service/meta/NoteService.meta.json` | 자동 생성: `service/meta/TaskService.meta.json` |
| `002_create_note.sql` | 사용하지 않은 다음 번호의 `004_create_task.sql` |

파일명만 바꾸면 끝나는 작업이 아니다. 클래스명, annotation 문자열, 필드 참조, SQL의 테이블·컬럼, 테스트 주소와 데이터를 **함께** 바꾼다. meta의 이름·경로·메서드·인증 선언은 서버가 읽은 코드에 맞추어 생성·갱신한다. `.get('findAll')` 등 쿼리 이름을 유지해도 되지만 SQL 파일 안의 이름과 반드시 맞아야 한다.

새 필드가 있다면 다음 순서로 반영한다.

1. 데이터 타입, NULL 허용, 기본값, 키·인덱스를 정하고 migration을 만든다.
2. SELECT의 반환 컬럼과 INSERT·UPDATE의 컬럼·바인딩을 맞춘다.
3. Controller에서 입력의 타입·필수값·길이·허용값을 검사한다.
4. Service의 인자와 필요한 SQL 호출만 수정한다.
5. 서버를 시작하거나 `npm run contract:check`를 실행해 meta의 자동 생성·로딩 결과를 확인한다. meta를 손으로 작성하지 않는다.
6. 실제 HTTP 요청 데이터와 기대 결과를 새 요구사항으로 바꿔 검사한다.

### 6.1 입력 검증을 명시적으로 작성한다

기본 Note는 생성 규약을 보여 주는 예제이며, 친절한 업무 입력 검증을 모두 제공하지 않는다. 현재 기본형에서 제목 누락은 DB 제약 오류이므로 500일 수 있다. 이 결과를 새 운영 API의 권장 정책으로 복사하지 않는다.

사용자가 제목 1~200자를 요구했다면 아래 코드를 해당 Controller의 `create`와 `update`에서 Service 호출 **앞**에 둘 수 있다. 메서드 안에 넣는 부분 코드이며 새로운 파일 전체가 아니다.

```javascript
if (typeof params.title !== 'string' ||
    params.title.trim().length === 0 ||
    params.title.length > 200) {
  throw Object.assign(new Error('title must contain 1 to 200 characters'), { status: 400 });
}
if (params.body !== undefined && params.body !== null && typeof params.body !== 'string') {
  throw Object.assign(new Error('body must be a string or null'), { status: 400 });
}
```

이 코드는 공백만 있는 제목을 거절하지만 저장할 문자열을 자동 trim하지는 않는다. 저장 전 trim까지 필요한지는 요구사항으로 결정한다. ID를 정수로 제한하거나 수정·삭제의 없는 행을 404로 바꾸려는 경우도 정책과 테스트를 함께 작성한다.

없는 라이브러리를 설치되어 있다고 가정해 import하지 않는다. 기본 CRUD 때문에 ORM, DI 컨테이너, 별도 웹 프레임워크, TypeScript 빌드 환경을 새로 추가하지 않는다.

## 7. 실행과 콘솔 확인

프로젝트 루트에서 실행한다.

```bash
node --version
npm ci --ignore-scripts
npm run check
npm run contract:check
npm start
```

`npm run check`는 컴파일러를 통해 annotation 문법과 실제 모듈 선언을 검사한다. `node --check workspace/controller/NoteController.js`는 서버의 변환 단계를 거치지 않으므로 같은 검사로 쓰지 않는다. `.mjs` 검증 스크립트에는 일반 `node --check`를 사용할 수 있다.

브라우저에서 `http://127.0.0.1:8901`을 연다. 최초 관리자 계정을 설정하고 로그인한 뒤 Note 목록·추가·수정·삭제를 시험한다. 초기 공개 Note API만 HTTP로 호출하는 경우에는 콘솔 로그인이 필요하지 않다.

**콘솔의 샘플 화면은 `/api/notes` 전용이다.** `/api/tasks`를 만들었다고 Task 화면이 자동 생성되는 것은 아니다. 새 API는 해당 주소의 HTTP 요청으로 검증하거나 별도 UI 요구사항에 따라 화면을 구현한다.

HTTPS를 쓰려면 OpenSSL이 설치된 개발 PC에서 서버를 멈춘 뒤 실행한다.

```bash
npm run https:cert -- --hosts localhost,127.0.0.1,::1 --apply
npm start
```

이후 `https://localhost:8901`로 접속한다. 로컬 자체 서명 인증서는 브라우저의 신뢰 설정이 필요할 수 있다. HTTPS 검증을 성공으로 만들기 위해 인증서 검사를 전역 해제하지 않는다.

작은 단말에 배포하기 전에는 `npm run workspace:compile`로 컴파일 캐시와 meta를 준비한다. Linux·Android 빌드도 이 준비를 자동 수행한다. 읽기 전용 소스로 배포하려면 변경을 반영한 meta가 이미 있어야 한다. 이 캐시는 다시 만들 수 있는 산출물이고, 전달할 원본 Controller·Service·SQL·meta를 대체하지 않는다.

## 8. 문서의 예제를 직접 실행하는 검증 스크립트

아래 파일은 프로젝트의 다른 테스트 helper를 import하지 않는다. Node 표준 모듈만 사용한다. 선택한 workspace의 복사본, 임시 DB, 임시 계정 저장 경로와 무작위 포트로 서버를 띄운다. 생성·수정·삭제와 재시작 후 보존을 실제 HTTP로 검사하고 시험 폴더를 정리한다. 원래 업무 파일과 DB에 CRUD를 실행하지 않는다.

복사본에서는 기존 meta를 제외하고 서버를 시작한다. 첫 실행의 자동 생성·관리자 API 로딩과 재실행 시 파일이 바뀌지 않는 것도 검사한다.

아래 스크립트의 데이터 계약은 **Note의 `title`·`body`와 응답 규칙**이다. 새 API에서는 요청 데이터·반환 필드·인증·오류 기대값을 실제 요구사항에 맞게 수정해야 한다. URL만 바꾼 검사를 모든 새 API의 검증이라고 부르지 않는다.

### 파일: `scripts/verify-api-example.mjs`

```javascript
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    workspace: { type: 'string' },
    'base-path': { type: 'string', default: '/api/notes' },
    auth: { type: 'boolean', default: false },
  },
});
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(values.workspace || process.env.APP_WORKSPACE ||
  path.join(root, values.auth ? 'examples/note-auth-workspace' : 'workspace'));
const api = values['base-path'].replace(/\/$/, '');
assert.match(api, /^\/api\/[A-Za-z0-9/_-]+$/);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aidot-guide-api-'));
const workspace = path.join(temp, 'workspace');
const token = randomBytes(32).toString('hex');
const cases = [];
let child;
let origin;

async function start() {
  let stderr = '';
  child = fork(path.join(root, 'start.js'), [], {
    cwd: root,
    execArgv: [],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: {
      ...process.env,
      ENV_FILE: path.join(temp, 'empty.env'),
      APP_WORKSPACE: workspace,
      DATA_DIR: path.join(temp, 'data'),
      DB_FILE: path.join(temp, 'data', 'test.db'),
      SETTINGS_FILE: path.join(temp, 'data', 'settings.json'),
      ADMIN_ACCOUNT_FILE: path.join(temp, 'data', 'admin-account.json'),
      ADMIN_TOKEN_FILE: path.join(temp, 'data', 'admin-token'),
      ADMIN_TOKEN: token,
      HOST: '127.0.0.1',
      PORT: '0',
      HTTPS_ENABLED: 'false',
      MANAGED_ENDPOINT: 'false',
      LOG_TO_FILE: 'false',
      LOG_LEVEL: 'error',
    },
  });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timeout: ' + stderr)), 30000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error('Server exited: ' + code + '\n' + stderr));
    });
    child.on('message', message => {
      if (message.type === 'ready') { clearTimeout(timer); resolve(message.port); }
    });
  });
  origin = 'http://127.0.0.1:' + port;
}

async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const target = child;
  await new Promise(resolve => {
    const timer = setTimeout(() => target.kill('SIGKILL'), 5000);
    target.once('exit', () => { clearTimeout(timer); resolve(); });
    if (target.connected) target.send({ type: 'aidot:shutdown' });
    else target.kill('SIGTERM');
  });
}

async function request(name, method, url, body, status = 200, authorized = values.auth) {
  const headers = { 'Content-Type': 'application/json' };
  if (authorized) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(origin + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  assert.equal(response.status, status, name + ': ' + JSON.stringify(result));
  assert.equal(result.code, status, name + ': response code');
  cases.push(name);
  return result;
}

try {
  fs.writeFileSync(path.join(temp, 'empty.env'), '');
  fs.mkdirSync(workspace);
  for (const folder of ['controller', 'service', 'sql', 'migrations']) {
    fs.cpSync(path.join(source, folder), path.join(workspace, folder), {
      recursive: true,
      filter: file => path.basename(file) !== 'meta',
    });
  }
  fs.writeFileSync(path.join(workspace, 'package.json'), '{"type":"module","private":true}\n');
  await start();
  const generated = await request('Metadata generated and loaded', 'GET',
    '/admin/metadata', undefined, 200, true);
  const records = [...generated.data.controllers, ...generated.data.services];
  assert.ok(records.length >= 2);
  const metadataBytes = new Map();
  for (const record of records) {
    assert.equal(record.status, 'generated');
    assert.equal(record.metadata._version, 2);
    assert.ok(record.file.startsWith(workspace + path.sep));
    const bytes = fs.readFileSync(record.file, 'utf8');
    assert.deepEqual(JSON.parse(bytes), record.metadata);
    metadataBytes.set(record.file, bytes);
  }

  if (values.auth) {
    for (const [method, suffix, body] of [
      ['GET', '', undefined], ['GET', '/1', undefined],
      ['POST', '', { title: 'Denied', body: null }],
      ['PUT', '/1', { title: 'Denied', body: null }], ['DELETE', '/1', undefined],
    ]) {
      await request('Anonymous rejected: ' + method + suffix, method, api + suffix, body, 401, false);
    }
  }

  // This payload contract belongs to the Note example. Change both data and assertions for another API.
  let result = await request('List', 'GET', api);
  assert.ok(Array.isArray(result.data));
  const initialCount = result.data.length;
  result = await request('Create', 'POST', api, {
    title: 'AI sample', body: "한국어 and SQL text ':id'", requestCode: 'guide-create',
  }, 201);
  assert.equal(result.message, 'Created');
  assert.equal(result.header.requestCode, 'guide-create');
  assert.equal(result.data.rowsAffected, 1);
  const id = result.data.insertId;
  assert.ok(Number.isSafeInteger(id) && id > 0);
  assert.deepEqual(Object.keys(result.data).sort(), ['insertId', 'rowsAffected']);
  const rowUrl = api + '/' + id;
  result = await request('Read created row', 'GET', rowUrl);
  assert.equal(result.data.title, 'AI sample');
  assert.equal(result.data.body, "한국어 and SQL text ':id'");

  result = await request('Update; path ID wins', 'PUT', rowUrl + '?id=999999', {
    id: 888888, title: 'Changed', body: null,
  });
  assert.deepEqual(result.data, { rowsAffected: 1 });
  result = await request('Read updated row', 'GET', rowUrl);
  assert.equal(result.data.title, 'Changed');
  assert.equal(result.data.body, null);
  result = await request('Omit optional body', 'PUT', rowUrl, { title: 'Persisted' });
  assert.deepEqual(result.data, { rowsAffected: 1 });
  result = await request('Omitted body becomes NULL', 'GET', rowUrl);
  assert.equal(result.data.body, null);

  await stop();
  await start();
  const reloaded = await request('Metadata reloaded without rewriting', 'GET',
    '/admin/metadata', undefined, 200, true);
  for (const record of [...reloaded.data.controllers, ...reloaded.data.services]) {
    assert.equal(record.status, 'loaded');
    assert.equal(fs.readFileSync(record.file, 'utf8'), metadataBytes.get(record.file));
  }
  result = await request('Persisted after restart', 'GET', rowUrl);
  assert.equal(result.data.title, 'Persisted');
  assert.equal(result.data.body, null);
  result = await request('List after create', 'GET', api + '?requestCode=guide-list');
  assert.equal(result.data.length, initialCount + 1);
  assert.equal(result.header.requestCode, 'guide-list');
  assert.equal(result.data[0].id, id);

  result = await request('Delete', 'DELETE', rowUrl);
  assert.deepEqual(result.data, { rowsAffected: 1 });
  await request('Deleted row is 404', 'GET', rowUrl, undefined, 404);
  result = await request('Repeat delete returns zero', 'DELETE', rowUrl);
  assert.deepEqual(result.data, { rowsAffected: 0 });
  result = await request('Update deleted row returns zero', 'PUT', rowUrl, { title: 'Missing', body: null });
  assert.deepEqual(result.data, { rowsAffected: 0 });
  result = await request('List restored', 'GET', api);
  assert.equal(result.data.length, initialCount);
  await request('Admin metadata stays protected', 'GET', '/admin/metadata', undefined, 401, false);
  console.log(JSON.stringify({ passed: cases.length, auth: values.auth, api, cases }, null, 2));
} finally {
  await stop();
  fs.rmSync(temp, { recursive: true, force: true });
}
```

프로젝트 루트에서 다음 명령을 실행한다.

```bash
# 공개 Note: 실제 HTTP 17건 (meta 조회 2건 포함)
node scripts/verify-api-example.mjs

# 인증 Note: 같은 17건 + 익명 접근 거절 5건 = 22건
node scripts/verify-api-example.mjs --auth
```

외부 workspace를 지정하는 예는 다음과 같다. 아래 경로는 실제 만들어 둔 폴더로 바꾼다. 필드·응답이 Note와 다르면 먼저 스크립트의 payload와 assertion도 수정한다.

```bash
node scripts/verify-api-example.mjs --workspace ./my-api-workspace --base-path /api/tasks
```

이 검사는 브라우저 화면 검사가 아니다. 콘솔 UI를 바꿨다면 브라우저에서 목록·생성·수정 취소·수정 저장·삭제 취소·삭제 확인·새로고침 후 보존을 별도로 확인한다.

### 8.1 새 API의 합격 조건

- `npm run check`와 `npm run contract:check`가 선택한 workspace에서 통과한다.
- 생성한 행의 ID와 실제 저장 값을 조회해 확인한다. HTTP 200만 확인하고 끝내지 않는다.
- 수정 후 실제 값, null·생략 값 처리, 없는 ID의 동작을 확인한다.
- 삭제와 중복 삭제의 결과를 확인한다.
- 프로세스를 재시작해 데이터 보존을 확인한다.
- 인증 API는 인증된 CRUD뿐 아니라 **각 경로의 익명 거절**을 확인한다.
- 새 입력 검증을 추가했다면 잘못된 타입, 빈 값, 경계 길이, 허용하지 않은 값도 확인한다.
- 테스트는 임시 DB에서 실행하고 사용자 데이터를 초기화하지 않는다.

기본 프로젝트의 `npm run api:verify`와 최소 프로젝트의 기본 `npm test`는 기본 Note만 검사한다. 새 API 검증 스크립트를 만든 뒤 `package.json`의 테스트 명령에 추가한다. 예를 들어 Note를 유지하면서 Task 검증을 추가했다면 기존 Note 테스트와 Task 테스트가 **둘 다 실행**되도록 한다. 전체 프로젝트에는 더 넓은 회귀 검사가 있으므로 기존 명령을 짧은 예제 테스트로 덮어쓰지 않는다.

## 9. 검증한 업무 파일 내보내기

`module.json`은 **프로젝트 루트**에 둔다. 다음은 직접 작성한 네 파일과 서버가 생성한 두 meta, 총 여섯 파일을 선택하는 완전한 예다.

### 파일: `module.json`

```json
{
  "name": "aidot-note",
  "controller": [
    "NoteController.js",
    "meta/NoteController.meta.json"
  ],
  "service": [
    "NoteService.js",
    "meta/NoteService.meta.json"
  ],
  "sql": [
    "note.sql"
  ],
  "migrations": [
    "002_create_note.sql",
    "003_note_seed_english.sql"
  ],
  "version": "0.5.1"
}
```

Task를 내보내려면 이 목록의 파일명·meta 경로·migration과 `name`을 실제 Task 파일로 맞춘다. 검증 파일을 `npm test`에 연결한 뒤 실행한다.

```bash
npm run port:export
```

명령은 문법을 검사하고 meta를 자동 생성·동기화한 후 선언 검사와 프로젝트의 `npm test`를 실행한 뒤 원본 업무 파일을 `dist/<name>-v<package.json의 version>/`에 복사한다. 위 예에서 프로젝트 버전이 0.5.1이면 `dist/aidot-note-v0.5.1/`다. 이미 그 폴더가 있으면 덮어쓰지 않으며, 기존 결과를 보관하거나 출력 이름을 조정하고 다시 실행한다. 임의의 출력 경로 인자를 지원한다고 가정하지 않는다.

파일을 다른 서버에 전달할 때는 `controller`, `service`, `sql`과 두 `meta`의 상대 구조를 보존한다. DB 테이블 생성, 계정, TLS, 배포 경로는 대상 서버에서 준비한다. 다른 DB나 런타임에서 실행한 적이 없다면 그 환경에서도 검증했다고 쓰지 않는다.

## 10. 자주 생기는 실수

| 증상 또는 잘못된 선택 | 확인하거나 고칠 내용 |
|---|---|
| Controller를 만들었는데 주소가 없음 | 선택된 workspace, 클래스의 default export·annotation, 재시작 여부 |
| `Missing service` | `@Autowired` 문자열과 `@Service` 문자열 일치 여부 |
| SQL 이름을 찾지 못함 | `@Sql` 파일명과 `-- @name:`·`.get()` 이름 일치 여부 |
| `no such table` | migration 파일 위치와 실제 적용 결과 |
| `Cannot save generated metadata` | workspace 쓰기 권한 확인. 읽기 전용 설치 전 `npm run workspace:compile`로 준비 |
| `Cannot read metadata` | 손상 파일을 백업하고 정상본 복원. 필요한 설명·확장 정보를 보존한 뒤 해당 손상 파일만 제거하면 재생성 가능 |
| meta를 수정했는데 인증이 바뀌지 않음 | 인증은 코드의 메서드 annotation으로 선언. 서버 재시작 시 코드 기준으로 동기화 |
| 컴파일 오류를 없애려고 `@` 문법을 제거 | 원본 문법을 유지하고 프로젝트의 컴파일·로드 경로를 확인 |
| POST 후 `data.id`가 undefined | 예제의 생성 ID는 `data.insertId` |
| PUT에서 보낸 적 없는 body가 사라짐 | 이 예제는 생략 필드를 NULL로 바꾸는 전체 필드 교체 방식 |
| 없는 행을 삭제했는데 200 | 기본 계약은 `rowsAffected: 0`; 별도 404 정책을 구현한 것은 아님 |
| 콘솔이 계속 Note를 표시 | 샘플 화면은 Note 전용. 새 API용 UI가 자동 생성되지 않음 |
| 설정 화면의 workspace 변경이 반영 안 됨 | OS 환경변수·`.env`의 APP_WORKSPACE 우선 여부와 재시작 확인 |
| migration drift | 적용한 파일을 복구하고 변경은 새로운 migration으로 작성 |
| 다른 폴더로 옮기자 import 오류 | 표준 프레임워크 import와 사용자 간 상대 import를 구분해 확인 |

## 11. AI가 마지막에 제출할 내용

1. 추가·수정한 각 업무 파일의 경로와 전체 소스, 신규 migration. meta는 서버가 생성한 결과를 포함하고 수동 작성하지 않는다.
2. 변경된 API의 경로·필드·인증·정상 응답·오류 조건.
3. 사용한 workspace와 실행 명령. OS, Node 버전, DB 종류를 포함한다.
4. 문법·meta·HTTP·재시작 검사 결과. 실패와 미실행 항목도 구분한다.
5. 재현 가능한 검증 스크립트와 필요한 설정 예. 운영 비밀값은 넣지 않는다.

단순한 문법 통과, 과거 Note 테스트 결과, HTTP 상태 하나만으로 새 업무 API의 동작을 보장하지 않는다. 구현·문서·테스트가 서로 같은 규칙을 설명해야 한다.

## 12. 사용자가 이 문서와 함께 붙여 넣을 요청 양식

```text
첨부한 aidot-mini 최소 프로젝트와 이 문서를 기준으로 아래 API를 구현해줘.
이전 대화나 다른 프로젝트를 안다고 가정하지 마.

프로젝트 루트: <경로>
사용할 workspace: <기본 workspace 또는 외부 경로>
만들 기능: <업무 기능>
API 주소: <목록/단건/생성/수정/삭제 주소>
테이블과 필드: <이름·타입·필수·기본값·키>
인증: <공개 또는 관리자 로그인 필요>
입력 검증: <타입·길이·범위·허용값>
수정/삭제 정책: <필드 생략 처리, 없는 행 처리, 실제 삭제 여부>
기존 Note 유지 여부: <유지/교체>

문서의 완전한 예제를 참고해 Controller, Service, SQL, 신규 migration을 작성해줘.
annotation과 기본 import·DB 호출 규약을 유지해줘.
meta는 직접 작성하지 말고 서버 시작 시 자동 생성·로딩되는지 확인해줘.
새 API용 실제 HTTP 검사도 작성하고 임시 DB에서 실행해줘.
기존 사용자 데이터와 적용된 migration을 보존해줘.
완료하면 전체 업무 소스와 실행 결과, 재현 명령을 제출해줘.
```
