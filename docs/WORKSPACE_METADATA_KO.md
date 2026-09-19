# Controller·Service meta 자동 생성과 로딩

0.5.1부터 사용자는 업무 코드와 migration만 작성합니다. 서버 시작 과정에서 선택한 workspace를 탐색하고, 각 Controller·Service 파일 옆의 `meta/<파일명>.meta.json`을 자동으로 준비합니다. 기본 Note의 업무 소스와 annotation 형식은 그대로입니다.

| 파일 상태 | 서버 동작 | 조회 상태 |
|---|---|---|
| 파일·폴더 없음 | 폴더와 버전 2 JSON을 만들고 로딩 | generated |
| 코드 선언과 같음 | 기존 JSON 로딩, 내용·수정 시각 유지 | loaded |
| 코드 선언이 변경됨 | 선언 동기화 후 원자적으로 저장·로딩 | updated |
| JSON 손상·지원하지 않는 버전 | 원본을 덮어쓰지 않고 시작 오류 | 성공 상태 없음 |

코드에서 읽는 값은 Controller 경로·메서드·인증·역할·Service 주입과 Service 이름·메서드·SQL 주입입니다. 기존 설명과 확장 속성, 유지되는 경로의 부가 정보는 보존합니다. 최초 생성에서는 `///` 헤더 주석을 설명으로 사용합니다. 갱신 시각은 실제 저장한 때만 바뀝니다.

로드한 JSON은 모듈 레지스트리에서 보관하며, 관리자 로그인 후 같은 브라우저에서 `/admin/metadata`를 열어 확인합니다. `data.controllers`와 `data.services`에 `name`, `file`, `status`, `metadata`가 있습니다. 익명 요청은 401이며 meta 자체가 라우트를 등록하거나 인증을 부여하지 않습니다. 코드가 실행 정책의 기준입니다.

## 사용과 배포

```bash
# meta가 없어도 시작하며 자동 생성한다.
npm start

# 서버 시작 전에 생성·동기화와 선언 검사를 수행한다.
npm run contract:check

# 읽기 전용 설치 전에 캐시와 meta를 준비한다.
npm run workspace:compile
```

최초 생성이나 선언 갱신에는 workspace 쓰기 권한이 필요합니다. 배포 대상의 프로그램을 읽기 전용으로 둘 때는 쓰기 가능한 빌드 위치에서 준비하고 코드·meta·캐시를 함께 배포합니다. Linux·Android 빌더가 이 단계를 자동 수행합니다. DB·계정·설정 등 실행 데이터는 별도 쓰기 가능한 DATA_DIR에 둡니다.

meta가 이미 일치하면 읽기만 하므로 읽기 전용 설치에서도 사용할 수 있습니다. 배포 후 코드를 직접 바꾸면 meta와 캐시를 다시 준비해야 합니다. 잘못된 JSON을 발견하면 필요한 설명·확장 정보를 먼저 보존하고 정상본을 복원하거나 해당 손상 파일만 제거해 재생성합니다. 서버가 오류를 감추기 위해 기존 사용자 파일을 지우지는 않습니다.

## 범위

표준 Note의 생성 결과는 기존 버전 2 metadata와 선언이 일치합니다. 여러 SQL·Service를 사용하는 임의의 메서드 본문을 단일 CRUD 편집 모델로 모두 역추론하지는 않습니다. 기존 `multiSqlMethods`는 해당 메서드가 있는 경우 보존하고, 없는 상태에서 사용자 정의 재생성 레시피를 추측해 만들지 않습니다. 여러 SQL을 주입한 클래스는 단일 `sqlFile`로 모두 표현할 수 없지만 실제 코드의 SQL 주입은 정상 동작합니다.

삭제·이름 변경된 업무 파일의 오래된 meta는 로딩 대상에서 제외하며 자동 삭제하지 않습니다. `sql/meta`는 만들지 않습니다. SQL은 `-- @name:`으로 쿼리를 구분합니다. meta JSON이나 meta 폴더를 심볼릭 링크로 연결하는 방식은 지원하지 않습니다.

새 런타임 의존성은 추가하지 않았습니다. 생성·동기화는 모듈 로딩 때 수행하며 요청마다 파일을 탐색하지 않습니다. 업무 Controller·Service·SQL 원본은 수정하지 않습니다.

## 재현 검사

```bash
node --test tests/metadata.test.mjs
node scripts/verify-api-example.mjs
node scripts/verify-api-example.mjs --auth
```

첫 명령은 전체 프로젝트에 있습니다. 나머지는 최소 프로젝트에도 들어 있습니다. 검사는 임시 workspace·DB를 사용합니다. 실제 실행 범위는 `VALIDATION_V051.md`를 참고하세요.
