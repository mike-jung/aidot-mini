# 콘솔에서 코드와 로그 보기 — 0.6.0

관리자 ID/Password로 로그인하면 **Workspace files**와 **Log files** 탭이 보인다. 새 기기의 기본 언어는 English이며, 오른쪽 위 메뉴에서 한국어로 바꿀 수 있다. 기존에 저장한 언어 설정이나 `CONSOLE_LANGUAGE` 환경변수는 계속 우선한다. 기존 설치에서도 기본 언어를 영어로 바꾸려면 Settings → Default language → English → Save settings를 사용한다. 환경변수로 고정되어 있다면 `CONSOLE_LANGUAGE=en`으로 변경하고 재시작한다.

## Workspace files

1. 왼쪽에서 `controller/NoteController.js`, `service/NoteService.js`, `sql/note.sql` 같은 파일을 선택한다.
2. 소스 내용을 수정한다. Tab은 공백 두 칸을 넣으며 Shift+Tab으로 편집기 밖으로 이동할 수 있다.
3. **Validate and save**를 누른다. JavaScript/TypeScript는 기존 annotation 컴파일러로 문법을 검사하고, SQL은 `-- @name:` 이름·중복·빈 쿼리를 검사한다. SQL 문법 전체, 테이블 존재, 업무 결과까지 검사하는 버튼은 아니다.
4. **일반 실행은 서버 재시작 후 적용**, `npm run dev`는 소스 변경을 감지하여 자동 재시작한다. Sample API나 API 검증 스크립트로 실제 응답을 확인한다. 운영 서비스의 무중단 hot reload는 제공하지 않는다.

다른 편집기나 브라우저에서 파일이 바뀌면 저장은 409로 거절된다. 편집 중인 내용을 따로 복사하고 **Reload from disk**로 최신 내용을 읽은 뒤 합친다. 오래된 편집 내용을 강제로 덮어쓰는 버튼은 없다. 저장 오류가 나면 편집 내용은 화면에 남는다.

| 범위 | 지원 |
|---|---|
| controller/service `.js`, `.mjs`, `.ts`, `.mts` | 조회·기존 파일 수정·저장 |
| sql `.sql` | 조회·기존 파일 수정·저장 |
| controller/service meta | 읽기 전용. 서버가 생성·동기화한다. |
| migrations `.sql` | 읽기 전용. 적용된 migration의 해시를 바꾸지 않는다. 새 migration은 개발 도구/AI로 추가한다. |
| `.env`, 계정, 키, DB, 다른 폴더 | 편집 API가 제공하지 않는다. |
| 파일 크기/목록 | UTF-8 64 KiB 이하, 디렉터리 항목 최대 2,000개, 깊이 제한. |

설정 화면에서 workspace를 바꿔 저장했어도 재시작 전에는 **현재 실행 중인 workspace**를 편집한다. 심볼릭 링크·하드 링크·상위 경로는 거절한다. 임시 파일 후 원자적 rename으로 저장한다. 서버와 같은 OS 계정으로 파일을 동시에 바꾸는 비신뢰 프로세스를 격리하는 샌드박스는 아니다.

코드 편집 권한은 서버에서 코드를 실행할 수 있는 관리자 권한과 같다. 관리 콘솔을 일반 업무 API의 사용자에게 공개하지 않는다. 기본 인증과 CSRF 검사는 조회·저장 API 모두에서 기존 관리자 체계와 결합한다.

## Log files

`LOG_DIR` 안의 `server.log`와 순환 파일 `server.log.1`부터 `.19`까지 표시한다. 파일·로그 수준·문자열을 선택하고 Refresh logs를 누른다. 자동 갱신을 켜면 해당 탭이 보일 때 5초마다 요청하며 숨겨진 탭·로그아웃에서는 읽지 않는다.

한 번에 파일의 최근 **128 KiB**까지만 읽고 최대 500줄(API), 300줄(화면)을 표시한다. 검색은 이 범위에만 적용된다. 일치하는 결과가 없다는 표시가 로그 전체에 없다는 뜻은 아니다. 로그는 HTML로 실행하지 않고 텍스트로 표시한다. 대용량 다운로드, 임의 경로 검색, 로그 삭제는 제공하지 않는다.

`LOG_TO_FILE=false`이면 새 로그가 기록되지 않는다. 기존 로그가 남아 있으면 조회할 수 있다. 기본 순환 용량은 파일당 1 MiB, 최대 5개이며 기존 LOG_MAX_BYTES/LOG_KEEP_FILES 설정을 사용한다. 로그는 업무 코드가 남긴 민감한 내용을 포함할 수 있으므로 관리자만 접근한다.

## 영문 Note 초기 데이터

새로 실행한 기본 workspace는 `First note` / `aidot-mini is running correctly.`를 표시한다. 이전 `002_create_note.sql` 파일은 변경하지 않았다. 새 `003_note_seed_english.sql`이 id=1, 기존 제목·본문과 정확히 일치하고 updated_at이 없는 초기 행만 번역한다. 수정된 메모·추가 메모는 보존한다. 현재 표본의 controller/service/sql 코드 규칙도 유지한다.
