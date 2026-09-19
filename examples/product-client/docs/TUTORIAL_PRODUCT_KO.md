# Product 튜토리얼 — pagination과 이미지 업로드

기존 Snack 강의 다음 실습으로 사용할 상품 예제다. Vue 기본 폴더는 유지하고 서버는 Spring Boot 스타일의 Controller → Service → SQL을 따른다. 목표는 상품 사진을 선택해 미리보고, 서버에 업로드한 공개 경로를 DB에 저장한 뒤 페이지 목록에서 다시 표시하는 것이다.

## 1. mini로 실행

Node >=22.19.0을 사용한다. 검증 환경은 Node 24.19.0이다.

```sh
cd aidot-mini
npm ci --ignore-scripts
npm run product:account
npm run start:product
```

직접 정한 관리자 ID/비밀번호로 로그인한다. API 기본 주소는 `http://127.0.0.1:8901`이다. `start:product` 명령은 `examples/product-workspace`를 읽고, `examples/product-database/sqlite`의 SQL로 `demo_product`와 샘플 24개를 만든다. DB·계정 기본 위치는 `data/product-demo`다.

다른 터미널에서 클라이언트를 실행한다.

```sh
cd aidot-mini/examples/product-client
npm ci
npm run dev
```

별도 클라이언트 ZIP을 쓴다면 그 루트에서 같은 명령을 실행한다. Vite가 출력한 주소의 `/product`를 연다. 목록은 공개 조회, 등록·수정·삭제·업로드는 관리자 로그인 후 사용한다.

## 2. 코드 읽는 순서

| 순서 | 파일 | 확인할 내용 |
|---|---|---|
| 1 | `controller/ProductController.js` | `/api/product/paged` → listPaged 호출 |
| 2 | `service/ProductService.js` | 페이지·검색 검증 → executeList |
| 3 | `sql/product.sql` | findPaged와 imagePath alias |
| 4 | 클라이언트 `api/product.js` | HTTP envelope와 업로드 URL |
| 5 | `stores/records_product.js` | 페이지 상태, 취소, 최신 응답 반영 |
| 6 | `views/ProductFormView.vue` | upload → DB 저장 |
| 7 | `components/ImageUpload.vue` | 선택·drop·미리보기·URL 해제 |

전체 코드와 함께 AI_API_RULES_PRODUCT.md의 서버 예제, AI_FRONTEND_RULES.md의 클라이언트 예제를 읽는다. `listPaged`는 우리가 만든 Service 메서드이며, 페이지 엔진은 기존 `db.executeList`다.

## 3. 페이지 조회 실습

```http
GET /api/product/paged?page=1&perPage=10&q=파우치&sort=priceAsc
```

page는 1부터, perPage 기본값은 10이고 최대 100이다. 정렬은 newest/name/priceAsc/priceDesc를 지원한다. 검색어는 100자 이내이며 `%`, `_`를 글자로 검색한다.

```js
return db.executeList(sql, { keyword }, {
  page: currentPage,
  perPage: pageSize,
  maxPerPage: 100,
});
```

Service가 rows만 반환하면 페이지 header가 사라진다. 위 반환값 전체를 Controller에 넘기면 loader가 `data`와 `header.total`, `page`, `perPage`, `totalPages`를 응답한다. SQL의 정렬은 id까지 지정해 같은 가격 상품의 페이지 순서가 흔들리지 않게 한다.

화면에서 다음 페이지, 검색, 정렬, 페이지 크기를 차례로 바꿔 본다. 검색/크기 변경은 1페이지로 돌아간다. 연속 검색에서는 AbortController와 요청 순번으로 오래된 응답을 무시한다.

## 4. 이미지 선택과 저장

등록 화면의 큰 영역을 클릭하거나 파일을 끌어 놓는다. PNG/JPEG/WebP, 최대 5 MiB다. 선택 즉시 로컬 미리보기가 표시되며 아직 서버에 보내지 않는다. 기존 정상 사진이 있을 때 잘못된 파일을 선택하면 이전 미리보기를 유지한다.

저장 버튼은 아래 순서로 동작한다.

1. `POST /api/uploads/multipart?profile=image`에 FormData의 `file`을 전송한다.
2. 프레임워크가 파일 형식·크기를 검사하고 `public/uploads/images/<uuid>.<ext>`에 저장한다.
3. 응답의 `data.url`을 폼의 `imagePath`로 받는다.
4. 상품 POST/PUT 요청에 imagePath를 포함한다.
5. Service가 `validateImagePath`로 존재하는 이미지 경로인지 확인하고 DB에 저장한다.
6. 페이지 조회가 `image_path AS imagePath`로 경로를 돌려주고 ProductThumbnail이 렌더링한다.

```json
{
  "name": "데일리 머그",
  "price": 12000,
  "memo": "가벼운 세라믹 머그",
  "imagePath": "/uploads/images/8d1c5b1d-8b20-45bb-a88f-90a7d3dfc161.png"
}
```

위 경로는 형식 예시다. 실제 업로드 응답의 url을 사용해야 한다. DB에 `/public`을 붙이거나 localhost 주소를 넣지 않는다.

## 5. 수정·실패 처리

- 이미지 변경 없이 수정하면 기존 경로를 유지한다. 이미지 제거는 null을 저장한다.
- 업로드 성공 후 상품 저장만 실패하면 업로드 URL을 폼에 유지한다. 저장 재시도에서 같은 파일을 다시 보내지 않는다.
- 화면 이동 시 남은 이미지 업로드·상세 조회를 취소하고 뒤늦은 응답의 화면 반영을 막는다.
- 레코드 삭제는 DB 행 삭제다. 다른 상품에서 같은 URL을 쓸 수 있어 파일을 자동 삭제하지 않는다.
- DB와 파일은 각각 저장된다. 두 요청을 하나의 트랜잭션으로 간주하지 않는다.

## 6. aidot-express로 실행

첨부 Express 1.45.8 Full을 사용한다. 앞서 제공된 v1 패치를 이 버전에 다시 적용하지 않는다. [PORTING.md](PORTING.md)에 따라 업무 파일과 DB 설정을 준비한다. 기존 pagination은 그대로 사용하고, 이미지 전용 profile은 첨부 Express 1.45.8에 포함되어 있다. mini만의 workspace lib를 Express로 복사하는 방식은 사용하지 않는다.

클라이언트 `.env.local`:

```dotenv
VITE_API_URL=/api
API_TARGET=http://127.0.0.1:7901
VITE_AUTH_MODE=express
```

포트는 실제 서버 설정에 맞춘다. Vite를 재시작한다. 클라이언트 API·store·View는 같은 파일을 사용하고 로그인 방식만 auth store가 구분한다. mini는 cookie+CSRF, Express는 기존 관리자 인증 API를 사용한다.

## 7. 파일 배치와 버전

| 배포물 | 용도 |
|---|---|
| mini 1.0.7 Full | 서버 + Product 클라이언트 + Full 게시·장치 도구 + 문서 |
| mini 1.0.7 AI Starter | Controller·Service·SQL 생성·실행 검증용 API 런타임. Vue·브라우저 콘솔 미포함 |
| 내장 Product client 1.0.7 | examples/product-client를 별도 폴더로 복사해 사용할 수 있는 Vue 클라이언트 |
| Express 1.45.8 Full | 최종 호환 검증 기준. 프레임워크 추가 수정 없음 |
| 1.0.7 patch ZIP | 각각 첨부 Full 0.6.2 또는 Starter 1.0.5 원본에 적용. 두 패치의 기준과 결과 에디션이 다름 |

2026-09-18 npm registry 확인: Vue 3.5.43, Vue Router 5.3.1, Pinia 4.0.3, Axios 1.20.0, Vite 8.3.0, plugin-vue 6.0.9, Prettier 3.9.8. 이는 첨부물에 기록된 당시 확인 내용이며, 이번 수정에서는 최신 버전이라는 주장을 새로 검증하지 않고 lockfile 고정 버전을 유지했다. 확인 기록은 DEPENDENCIES.json에 있다.

## 8. 확인 명령

```sh
# mini 루트
npm run verify
# client 루트
npm run format:check
npm run build
```

직접 확인: 이미지 선택 전후 서버 파일 생성 시점, 저장 후 목록 썸네일, 새로고침 및 서버 재시작 후 경로 유지, 잘못된 이미지 오류, 모바일 dropzone/버튼 배치. 현재 패키지 검증과 한계는 서버 루트의 docs/VERIFICATION_1.0.7.md에 기록했다. VERIFICATION.md는 1.0.6 기록이다.

일반 `npm start`는 기존 Note workspace를 유지한다. Product 사용자는 위의 `product:account`/`start:product`를 함께 사용한다. 서버 설정은 환경마다 지정하고 기존 계정·DB를 복사하지 않는다.
