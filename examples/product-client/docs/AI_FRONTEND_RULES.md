# AI Frontend RULES — Vue Product v2

**이 문서는 AI의 Vue 코드 생성·수정 지시문이다.** 기준은 **Product client 1.0.7, aidot-mini 1.0.7, 첨부 aidot-express 1.45.8 Full**이다. 대상은 mini Full의 `examples/product-client` 또는 독립 클라이언트 루트다. **최소 mini Starter는 서버 API 작성·검증용이며 Vue 클라이언트를 포함하지 않는다.** Starter에 프런트엔드 도구·UI를 새로 추가하지 말고 필요한 경우 별도 클라이언트를 사용한다.

Vue 3 + Vite + `<script setup>` + Pinia + Axios, JavaScript ES module을 유지한다. 기존 완성 파일을 확장한다. 아래 발췌 코드는 각 기능의 계약을 설명하며, 전체 파일을 대체하는 최소 구현으로 사용하지 않는다.

## 1. 입력·산출물·파일별 책임

작업 전에 대상 클라이언트의 package.json, API·store·View와 서버 API 계약을 읽는다. Product 외 업무라면 요청된 필드·경로·권한으로 확장하고 Product 규칙을 임의 적용하지 않는다. 요청 범위의 **완성된 변경 파일**과 검증 결과를 제공하며 TODO·모의 성공 응답으로 실제 API를 대체하지 않는다.

```text
작업: 신규 / 수정, 클라이언트 루트:
화면·라우트 / 입력 필드·필수값·범위:
서버 API method·path·params·envelope / 페이지 계약:
인증 모드·권한 / 실패·재시도 / 취소할 작업:
이미지 선택·업로드·저장 요구사항:
보존할 구조와 기존 동작 / 확인할 사용자 시나리오:
```

산출물은 아래 기존 경로를 사용한다. 새 서버 wrapper, router 체계, repository 계층을 발명하지 않는다.

| 위치 | 작성 내용 |
|---|---|
| `src/api/axios.js` | 공통 Axios 인스턴스, 메모리 인증 정보, 오류 메시지, 공개 이미지 URL |
| `src/api/product.js` | HTTP 경로·인자·응답 변환 |
| `src/stores/records_product.js` | 목록, 페이지·검색·정렬 상태, 저장·삭제 action |
| `src/stores/uploads.js` | 업로드 상태·진행률·취소 |
| `src/stores/auth.js` | mini/Express 로그인·복원 차이, 관리자 역할 판정 |
| `src/views/ProductView.vue` | 목록 화면, 검색 폼, 삭제 확인, 화면 이동 |
| `src/views/ProductFormView.vue` | 지역 폼 데이터, 상세 조회, 업로드 → 상품 저장 순서 |
| `src/components` | props와 emit으로 연결하는 재사용 UI |
| `src/router/index.js` | 수동 routes 배열과 lazy import |
| `src/assets` | 공통·반응형 CSS |

`App.vue`는 RouterView를 렌더링한다. 새 repository/composable 계층, Nuxt, 자동 파일 라우팅, 별도 상태 라이브러리를 도입하지 않는다. 2칸 들여쓰기와 기능별 빈 줄을 사용하며, 주석은 비동기 순서·실패 처리의 이유를 설명한다.

Pinia store를 템플릿에서 `products.items`처럼 직접 참조해도 된다. 상태를 구조 분해할 때는 `storeToRefs(store)`를 사용해 반응성을 보존한다. 폼 입력은 View 지역 상태에 둔다.

## 2. API 함수와 인증 헤더

기존 `axios.js`의 default export를 재사용한다. 컴포넌트에서 토큰을 직접 다루거나 localStorage/sessionStorage에 저장하지 않는다. `setCredentials`와 요청 interceptor의 역할을 유지한다. 인증 헤더는 현재 API origin에 해당하는 요청에만 붙인다.

`api/product.js`의 대표 함수는 다음과 같다. 기존 상세 조회·수정·삭제 함수도 유지한다.

```js
import api from './axios';

export async function listProducts(params, signal) {
  const response = await api.get('/product/paged', { params, signal });
  // 페이지 header가 필요하므로 JSON envelope 전체를 반환한다.
  return response.data;
}

export async function createProduct(values) {
  const response = await api.post('/product', values);
  return response.data.data;
}

export async function uploadProductImage(file, { signal, onUploadProgress } = {}) {
  const form = new FormData();
  form.append('file', file, file.name);

  const response = await api.post('/uploads/multipart', form, {
    params: { profile: 'image' },
    signal,
    onUploadProgress,
    timeout: 90000,
  });

  return response.data.data; // { fileName, size, url }
}
```

FormData의 Content-Type은 브라우저가 boundary와 함께 설정하게 둔다. upload store의 `upload(file)`은 응답 객체에서 `url` 문자열을 검증한 뒤 View에 그 문자열을 반환한다. 별도 Product 전용 업로드 API를 만들지 않는다.

## 3. 로그인 복원과 관리자 UI

`VITE_AUTH_MODE`는 `mini` 또는 `express`다. 인증 경로와 응답 차이는 auth store에서만 처리한다.

| 모드 | 인증 요청 | 브라우저에서 관리하는 정보 |
|---|---|---|
| mini | `/admin/login`, `/admin/session`, `/admin/logout` | 세션 cookie와 메모리 CSRF token |
| express | `/api/admin/auth/login`, `/api/admin/auth/refresh`, `/api/admin/auth/logout` | 메모리 access token과 서버가 설정한 refresh cookie |

- `restore()`는 완료 상태와 실행 중 Promise를 공유한다. 여러 ProductHeader가 mount되어도 중복 복원하지 않는다.
- **이미 실행 중인 복원이 있으면 로그인·로그아웃은 해당 응답을 기다린 뒤 실행한다.** 요청 순번으로 오래된 사용자 상태 반영도 차단한다. 자바스크립트 상태만 무시해도 늦은 refresh 응답의 Set-Cookie는 적용될 수 있으므로 네트워크 순서까지 유지한다.
- 로그인/로그아웃 중에는 `busy`로 중복 동작을 막는다. 복원 시 401은 미로그인 상태로 처리하고, 나머지 오류는 사용자에게 표시한다.
- 등록·수정·삭제 UI와 저장 함수에는 `auth.isAdmin`을 사용한다. `Boolean(auth.user)`만으로 쓰기를 허용하지 않는다.
- mini의 현재 계정 계약은 로그인 사용자가 관리자다. Express는 `user.role === 'admin'` 또는 `user.roles`에 `'admin'`이 있는지 확인한다.
- 서버의 `@Auth({ realm: 'admin', roles: ['admin'] })`가 최종 권한 기준이다. 화면에서 권한을 확인해도 서버의 401/403 처리를 유지한다.

권한 확인은 기존 store의 computed 값을 재사용한다. 컴포넌트마다 별도 역할 판정식을 만들지 않는다.

## 4. 목록·검색·삭제의 비동기 순서

`records_product.js`의 완성 구현을 유지한다. 단순히 `items = body.data`만 대입하는 예제로 축소하지 않는다.

| 상황 | 유지할 동작 |
|---|---|
| 연속 조회·검색 | 이전 AbortController 취소 + requestSequence 증가; 최신 요청만 상태 변경 |
| 응답 수신 | data 배열과 header.page/perPage/total/totalPages 안전 정수·범위 검증 |
| 빈 결과 | 표시용 totalPages는 `Math.max(1, header.totalPages)` |
| 검색·정렬·페이지 크기 변경 | 1페이지부터 조회 |
| 마지막 행 삭제 | 요청 페이지가 범위를 벗어나면 마지막 유효 페이지 재조회 |
| 조회 실패 | 목록 오류 표시, 재시도는 실패한 retryPage 조회 |
| 삭제 성공 후 목록 조회 실패 | 삭제 성공과 조회 실패를 구분; DELETE를 다시 보내지 않음 |
| 화면 이탈 | cancel()에서 screenSequence와 requestSequence를 모두 증가시키고 조회 취소 |
| 화면 이탈 후 삭제 완료 | 삭제 전 screenSequence와 달라졌으면 목록 조회를 다시 시작하지 않음 |

`removeProduct`의 screenSequence와 `fetchPage`의 requestSequence는 역할이 다르므로 하나로 합치지 않는다. 목록 페이지의 `onUnmounted`에서 `products.cancel()`을 호출한다. 삭제 응답 후 dialog 조작·오류 표시는 View가 활성 상태일 때만 수행한다.

저장·삭제 action의 실패는 View로 전파한다. 성공 메시지나 화면 이동은 서버 성공 응답 이후에만 처리한다. DELETE/상품 POST·PUT이 서버에 도달한 뒤 화면을 떠났다고 서버 처리가 자동 롤백되는 것은 아니다. 기존 구현은 목록·상세·업로드 요청을 취소하고, 끝난 업무 변경의 늦은 응답이 종료된 화면을 조작하지 않도록 한다.

## 5. 폼: 이미지 선택 → 업로드 → 상품 저장

기존 `ProductFormView.vue`, `ImageUpload.vue`, `uploads.js`, `records_product.js` 계약을 사용한다.

1. 이름·가격·설명·imagePath는 View의 reactive form에 둔다. 선택한 File은 별도 ref로 보관한다.
2. 저장 함수는 `saving`, `imageChecking`, `!auth.isAdmin`을 확인한다. HTML 입력 제한과 함께 이름·정수 가격을 검사하고, 최종 검증은 서버가 수행한다.
3. 선택한 File이 있을 때만 upload store로 업로드한다. 완료 후 **같은 화면인지 확인한 뒤** `form.imagePath`를 받은 URL로 바꾸고 `selectedFile`을 null로 만든다.
4. 그 URL과 상품 값을 `products.saveProduct(id, values)`로 저장한다. DB 저장만 실패하면 URL을 유지하므로 재시도에서 같은 파일을 다시 업로드하지 않는다.
5. 서버 저장 성공 후 같은 화면일 때만 목록으로 이동한다. 실패는 현재 폼에 표시한다.

다음은 기존 save 함수의 순서 설명용 발췌다. 이름·가격 검증, saving 설정·해제, catch 처리와 아래 lifecycle 규칙은 완성 View에서 함께 유지한다.

```js
const currentScreen = screenSequence;
const id = productId.value;

if (selectedFile.value) {
  const imagePath = await uploads.upload(selectedFile.value);
  if (currentScreen !== screenSequence) return;

  form.imagePath = imagePath;
  selectedFile.value = null;
}

await products.saveProduct(id, {
  name,
  price: form.price,
  memo: form.memo.trim(),
  imagePath: form.imagePath,
});

if (currentScreen === screenSequence) {
  await router.push({ name: 'product' });
}
```

`/product/new`와 `/product/:id/edit`는 같은 컴포넌트를 재사용한다. **unmount 플래그만으로는 충분하지 않다.** 기존 `watch(() => route.fullPath, loadForm, { immediate: true })`를 유지한다. loadForm은 screenSequence를 증가시키고 이전 상세 조회·업로드를 취소하며 form, selectedFile, 오류·checking 상태를 초기화한다. formVersion을 증가시켜 ImageUpload의 `:key`를 바꾸면 이전 로컬 미리보기도 정리된다. 상세 조회 응답도 같은 screenSequence일 때만 적용한다. unmount 시 순번 증가와 요청 취소를 다시 수행한다.

ImageUpload 연결은 다음과 같다. 실제 사용 위치는 완성 ProductFormView의 form 내부다.

```vue
<ImageUpload
  :key="formVersion"
  :image-path="form.imagePath"
  :disabled="saving"
  @change="selectedFile = $event"
  @remove="form.imagePath = null"
  @checking="imageChecking = $event"
/>
```

ImageUpload의 제거 동작은 먼저 `change(null)`을 emit하고 다음에 `remove`를 emit한다. 부모는 선택한 File과 저장 경로를 모두 해제한다. 이미지 변경 없이 수정하면 기존 경로를 보내며, 제거는 null을 보낸다. 서버에서 imagePath 생략은 기존 값 유지지만 null은 연결 해제라는 차이를 지킨다.

저장 중 입력·파일 선택을 막고, 저장 버튼은 `saving || imageChecking || !auth.isAdmin`일 때 비활성화한다. 진행률 100%는 전송 이벤트만으로 표시하지 않고 서버 저장 응답을 받은 뒤 표시한다.

## 6. 이미지 UI와 표시

- 기존 숨긴 file input과 실제 button dropzone을 사용해 Enter/Space로도 선택할 수 있게 한다. 화면에 클릭·드래그앤드롭 안내를 표시한다.
- MIME은 PNG/JPEG/WebP, 크기는 0바이트 초과·5 MiB 이하인지 확인하고 `Image.decode()`로 미리보기를 확인한다.
- 파일 선택은 로컬 미리보기만 수행한다. 저장 버튼을 누르기 전에 업로드하지 않는다.
- 잘못된 파일 선택은 이전 정상 미리보기와 선택 File을 유지한다. 선택 순번으로 마지막 선택의 decode 결과만 반영한다.
- `URL.createObjectURL`은 교체·제거·unmount 및 취소된 decode 결과 정리 시 revoke한다.
- 저장 중 중복 제출·선택 변경을 막는다. 로딩·오류·빈 결과를 구별하고 오류에는 role="alert"를 사용한다.
- 목록은 실패 fallback을 제공하는 기존 `ProductThumbnail.vue`를 재사용한다. 단순 img만으로 대체하지 않는다.
- DB 경로는 `/uploads/images/<uuid>.<ext>`다. `publicImageUrl`은 경로를 확인한 뒤 현재 API origin을 붙인다. 서버 origin이나 `/public`을 DB에 저장하지 않는다.

파일 한도에서 5 MiB는 `5 * 1024 * 1024` bytes다. 화면의 MB 안내를 근거로 5,000,000 bytes로 계산을 바꾸지 않는다. 서버 검사와 저장이 최종 기준이다.

## 7. 실행 환경

서버 명령은 **mini Full 또는 최소 Starter 루트**에서 실행한다. 일반 `npm start`는 기본 Note 예제를 실행한다. Product 예제는 다음 명령을 사용한다.

```sh
npm ci --ignore-scripts
npm run product:account
npm run start:product
```

`start:product`·`product:account`는 기존 환경과 `.env` 값을 존중한다. 다른 workspace나 계정 경로가 설정돼 있으면 Product용 환경을 맞춘다. 기본 API 주소는 `http://127.0.0.1:8901`이다.

다른 터미널에서 **mini Full 루트**라면 아래처럼 이동한다. **독립 클라이언트 ZIP**이면 cd 대신 그 클라이언트 루트에서 npm 명령을 실행한다. 최소 Starter에는 이 폴더가 없으므로 Full 또는 별도 클라이언트를 준비한다.

```sh
cd examples/product-client
npm ci
npm run dev
```

Vite가 출력한 주소의 `/product`를 연다. mini 서버는 Node >=22.19.0, 클라이언트는 package.json의 `^22.12.0 || >=24.0.0` 조건을 사용한다. 양쪽을 함께 실행할 때는 검증 환경인 Node 24.19.0을 사용할 수 있다. 의존성은 package-lock.json을 기준으로 유지한다.

mini 연결용 `.env.local`:

```dotenv
VITE_API_URL=/api
API_TARGET=http://127.0.0.1:8901
VITE_AUTH_MODE=mini
```

첨부 Express 1.45.8 연결용 `.env.local`:

```dotenv
VITE_API_URL=/api
API_TARGET=http://127.0.0.1:7901
VITE_AUTH_MODE=express
```

포트는 실제 listener에 맞추고 변경 후 Vite를 재시작한다. Vite는 `/api`, `/admin`, `/uploads`를 같은 서버로 proxy한다. mini의 Origin/CSRF 검사와 일치하도록 기존 `changeOrigin: false`를 유지한다. `VITE_*`는 브라우저에 공개되므로 비밀번호·토큰을 넣지 않는다. 운영 웹 서버에는 SPA fallback과 API·이미지 reverse proxy를 따로 설정한다. Express workspace·DB·계정 준비는 API RULES를 따른다.

## 8. 검증

클라이언트 루트에서:

```sh
npm test
npm run format:check
npm run build
```

Express 인증 분기는 Bash에서 `VITE_AUTH_MODE=express npm test`, PowerShell에서 `$env:VITE_AUTH_MODE = 'express'` 설정 후 `npm test`로 검사하고 사용 후 환경 변수를 해제한다.

실제 브라우저 검사는 별도 Playwright·Chromium 환경이 있는 경우 다음 명령을 사용한다.

```sh
npm run test:browser
```

Full 동봉 클라이언트는 상위 mini를 찾는다. 독립 클라이언트에서는 `QA_PROJECT_ROOT`를 검토 수정본 mini 루트로 설정한다. Express 대상은 추가로 `EXPRESS_PROJECT_ROOT`를 첨부 1.45.8 루트로 설정한다. `PLAYWRIGHT_MODULE`로 설치된 Playwright 진입 파일, `BROWSER_EXECUTABLE`로 브라우저 실행 파일을 지정할 수 있다. 검사기는 임시 DB·계정·업로드 디렉터리와 Vite를 실행한다. 이 선택적 브라우저 환경이 일반 `npm ci`만으로 모두 설치된다고 가정하지 않는다.

확인 대상은 페이지·검색·정렬, 마지막 행 삭제, 연속 요청, 화면 이동 후 삭제 완료, 로그인 복원과 로그인·로그아웃 순서, 비관리자 UI, 이미지 선택·drop·잘못된 파일 유지·제거·재시도, DB 저장 후 목록 썸네일, 새로고침·서버 재시작 후 이미지 경로다. 빌드·format 성공과 실제 API·브라우저 성공을 구분한다. `npm test`는 HTTP adapter를 제어하는 store 검사이며 실제 서버의 실행 검증을 대신하지 않는다. 실행 당시 Node/npm 버전, 실제 명령·종료 코드·결과와 미검증 항목을 기록한다. 실행하지 않은 검사를 성공으로 보고하지 않는다.
