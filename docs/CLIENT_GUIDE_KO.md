# Product Vue 클라이언트 1.0.7

`api/stores/views/components/router/assets`와 RouterView 중심 App.vue를 유지했다. ProductView는 페이지 목록, ProductFormView는 등록·수정 공용 폼이다.

```sh
npm ci
npm run dev
```

mini 기본 주소는 127.0.0.1:8901이다. Express를 사용하면 `.env.example`을 `.env.local`로 복사해 API_TARGET과 VITE_AUTH_MODE를 바꾸고 Vite를 재시작한다. Express는 첨부 1.45.8 Full 기준이며 v1 패치를 다시 적용하지 않는다. mini 서버는 product:account와 start:product 명령으로 실행한다.

`api/product.js` → `stores/records_product.js` → `views/ProductView.vue` 순서로 목록을 읽는다. 폼 데이터는 View 지역 상태이고, 공유 목록/업로드 상태는 Pinia에 둔다. UI 컴포넌트는 props/emit으로 연결한다.

이미지 선택은 로컬 미리보기다. 저장 시 공통 `/api/uploads/multipart?profile=image`의 `data.url`을 받아 상품의 imagePath로 저장한다. FormData boundary는 브라우저가 정한다. DB 저장만 실패하면 받은 URL을 유지해 업로드를 반복하지 않는다.

`ProductThumbnail`은 `/uploads/images/...` 경로에 API origin을 연결하고 실패 시 대체 UI를 표시한다. Vite proxy는 개발용이다. 운영 웹 서버에는 SPA fallback과 API/이미지 reverse proxy가 필요하다.

- [AI Frontend RULES](AI_FRONTEND_RULES.md): 코드 생성 지시문
- [Product 튜토리얼](TUTORIAL_PRODUCT_KO.md): 서버부터 화면까지 실습
- [이전 검증 기록](VERIFICATION.md): 1.0.6 실행 범위. 현재 패키지 결과는 서버 루트의 docs/VERIFICATION_1.0.7.md를 확인한다.
