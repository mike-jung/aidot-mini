# Note 예제와 aidot-express의 호환성

2026-09-12 · aidot-mini 0.5.0 · generated-note-roundtrip 수정본

## 이전 상태의 문제

이전 Note는 구형 상대 import, 생성 후 행 재조회, `{ removed }` 삭제 응답,
추가 Controller 검증 등 별도 예제 규칙을 가지고 있었습니다. 일부 경로는 양쪽 서버에서
실행되었지만 **콘솔 생성형 예제와 일치한다는 요구를 충족하지 않았습니다.**
Snack 원본만 기본 폴더에 옮긴 처리도 사용자가 요청한 재사용 가능한 Note 예제와 달랐습니다.

## 현재 구성

기본 `workspace/`에는 Note CRUD만 있습니다. C/S/SQL은 수정하지 않은 실제
aidot-express 1.45.2의 `lib/admin/service/codeGenerator.js` 함수를 실행한 결과입니다.
meta는 같은 프로젝트의 `metaStorage.writeMeta`로 작성했습니다.
SQL 생성 입력은 `docs/note-table.json`에 보관합니다.

- `workspace/`: 공개 Note CRUD. 콘솔에서 조회·추가·수정·삭제 시험 가능.
- `examples/note-auth-workspace/`: 다섯 경로에 `@Auth()`를 선언한 교체용 Note.
- `tests/fixtures/express-generated-workspace/`: 과거에 첨부한 생성 파일의 변경 없는
  회귀 검증 자료. 기본 예제로 로딩하지 않으며 최소 프로젝트에는 포함하지 않습니다.

## meta가 하는 일

Express의 Controller 로더는 annotation을 읽고 meta 디렉터리를 코드 스캔에서 제외합니다.
`lib/admin/service/metaStorage.js`의 `readMeta`는 메타가 없으면 null을 반환합니다.
따라서 메타 부재가 곧 API 로딩 실패라는 뜻은 아닙니다.

하지만 `ControllerMetaService`와 `ServiceMetaService`는 콘솔의 편집 화면에서 meta를
우선 사용합니다. 특히 라우트 유형, auth·roles, SQL 파일, 메서드 목록, multi-SQL 구성이
정확해야 편집·재생성 때 원래 의도를 유지할 수 있습니다. 현재는 아래 두 파일을 제공합니다.

```text
controller/meta/NoteController.meta.json
service/meta/NoteService.meta.json
```

이 Express 생성 규약에는 SQL별 `sql/meta/*.json`이 없습니다. SQL 쿼리 이름은
`-- @name:`으로 읽습니다. meta는 코드로 실행하지 않고 mini 0.5.1부터 서버 시작 시 자동 생성·로딩합니다. 기존 JSON은 읽고
코드의 경로·메서드·인증 선언과 동기화하며 설명·확장을 보존합니다. 사용자가 직접 작성하지 않습니다.
`npm run contract:check`도 이 준비를 수행합니다. 이 문서의 생성기·왕복 시험 결과는
0.5.0에서 수행한 이력이며, 0.5.1 실행 결과는 `VALIDATION_V051.md`에서 확인합니다.

## 달라진 API 계약

| 동작 | 현재 Note | 이전 Note와 차이 |
|---|---|---|
| POST | 201, `{ insertId, rowsAffected }` | 저장된 행 반환을 제거 |
| PUT | `{ rowsAffected }`, 전체 필드 교체 | Service의 `update(params)` 사용 |
| DELETE | `{ rowsAffected }` | `{ removed }`를 사용하지 않음 |
| 없는 행 GET | 404 | 생성 Controller 오류 문구 사용 |
| 없는 행 PUT/DELETE | 200, `{ rowsAffected: 0 }` | 404로 바꾸지 않음 |

콘솔도 이 계약으로 동작하며 수정할 때 단건 GET으로 최신 값을 읽습니다. 기존 note 테이블과
002 migration의 이력은 보존했습니다. updated_at은 자동 갱신하지 않는 nullable 컬럼입니다.
업무별 입력 검증은 `AI_API_RULES.md`의 별도 항목을 따릅니다.

## 실행으로 확인한 범위

실제 mini + node:sqlite, 수정하지 않은 Express 1.45.2 + better-sqlite3에서 공개형과
인증형을 각각 실행합니다. 유형마다 15개 HTTP 사례를 두 호스트와 Express 편집 후의
mini에서 실행해 **90회 API 요청의 계약**을 비교했습니다.

Express 콘솔 API의 상세 조회에서 `hasMeta: true`, 경로·메서드 목록을 확인하고,
preview 출력과 checked-in 소스의 바이트를 비교했습니다. 실제 콘솔 저장 API로 재생성한
소스가 그대로인지 확인한 후 이 파일들을 다시 mini에서 실행했습니다.
비교 시 응답 header의 실행 시각과 개발용 stack만 제외했습니다. 데이터 행의 날짜는
고정된 동등 DDL로 비교하며 응답 비교에서 제거하지 않습니다.

실제 Chrome의 콘솔 CRUD 및 인증·외부 workspace 검증도 수행했습니다. 자세한 항목과
원시 결과는 `VALIDATION_NOTE_ROUNDTRIP.md`, `validation/note-generated/`를 확인하세요.

## 적용 전제

현재 왕복 증거는 Express 1.45.2의 **프로젝트 직속 workspace 배치와 SQLite 프로필**에
대한 것입니다. 임의 SQL 방언이나 모든 Express 버전으로 확대해서 보장하지 않습니다.
Express의 외부 폴더는 생성된 상대 import가 해당 호스트의 src를 가리켜야 합니다.
mini는 외부 workspace의 생성 import를 자체 로더에서 연결합니다.
각 호스트에서 note 테이블·계정·TLS를 준비합니다. 자세한 조건은 `PORTING.md`에 있습니다.
