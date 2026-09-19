# AI API 작성 — 시작 문서

이 프로젝트의 목적은 Controller·Service·named SQL을 생성하고 같은 파일을 mini와 aidot-express에서 사용하는 것이다. 일반 업무 API를 위해 프레임워크·라우터·DB 연결을 새로 만들지 않는다.

1. [공통 생성 계약과 Product 예시](AI_API_RULES_PRODUCT.md)를 읽는다. 공통 규칙을 적용하고 Product 고유 필드·가격 범위·권한은 새 업무 요구사항에 맞게 정한다.
2. API 경로·입력 타입·테이블·권한·오류 상태·기존 데이터 처리 조건을 확인한다. 미지정 조건은 가정으로 명시하며 기존 migration을 덮어쓰지 않는다.
3. 별도 workspace의 `controller/`, `service/`, `sql/`에 작성한다. 필요한 migration과 업무 HTTP 사례 JSON을 함께 제공한다. metadata는 런타임이 만든다.
4. 다음처럼 실제 생성한 workspace를 검증한다. 예제 Note/Product 테스트만 통과한 것을 새 업무의 검증으로 보고하지 않는다.

```sh
npm ci --ignore-scripts
npm run workspace:verify -- --workspace ./my-workspace --cases ./my-cases.json
```

migration이 workspace 외부에 있다면 `--migrations ./my-migrations`를 추가한다. `--cases`는 method·path·body·status·expect를 담은 배열이다. [실행 가능한 Product 사례](AI_WORKSPACE_CASES.json)를 참고하되 새 API의 URL과 예상 응답으로 바꾼다. `auth: "admin"`은 검증용 임시 관리자 토큰을 쓴다.

검증기는 소스 복사본·임시 DB를 사용한다. 사례를 생략하면 기동·선언 확인만 수행하며 업무 동작을 확인한 것이 아니다. 제출할 때 실행 명령·종료 결과·업무 사례 수·미검증 환경을 짧게 기록한다.

작은 실제 예제는 `workspace`의 Note와 `examples/product-workspace`다. AI Starter에는 API만 있으며 Vue나 브라우저 콘솔 화면은 없다. 프런트엔드 생성은 Full/별도 클라이언트와 Frontend RULES를 사용한다. 이식 시 대상 DB·환경·계정·업로드도 별도로 준비한다.
