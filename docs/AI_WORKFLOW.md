# AI와 새 API 만들기

1. 최소 프로젝트를 새 폴더에 풀고 `npm ci --ignore-scripts`를 실행합니다.
2. `docs/AI_API_RULES.md`와 최소 프로젝트를 AI에 제공합니다. 문서에는 사전 지식 없이 이해할 수 있는 전체 소스와 검사 코드가 있습니다.
3. API 경로·테이블·필드·권한·오류 조건과 배포할 Express 버전·DB를 지정합니다.
4. 선택한 workspace의 Controller·Service·SQL과 신규 migration을 작성합니다. meta는 서버가 생성·로딩하므로 직접 작성하지 않습니다.
5. `npm run check`, `npm run contract:check`를 실행한 뒤 새 API의 실제 HTTP 검증을 수행합니다.
6. 파일을 대상 Express의 workspace로 복사하고 같은 요청의 동작·응답을 비교합니다.
7. 검증한 파일·migration·문서와 실행 근거를 함께 보관합니다.

붙여 넣어 사용할 작업 지시문과 응답 규약은 `AI_API_RULES.md`에 있습니다.
기본 `npm run api:verify`는 Note 예제의 시험입니다. 다른 API를 만들었다면 그 API용
검증을 작성해야 합니다. 콘솔 샘플 탭은 `/api/notes` 전용이며 모든 새 API의 UI를 자동
생성하지는 않습니다. 새 API는 HTTP 클라이언트로 검증하거나 별도 화면을 작성합니다.
