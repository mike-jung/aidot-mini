import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { isCanceled, errorMessage } from '@/api/axios';
import { listProducts, createProduct, updateProduct, deleteProduct } from '@/api/product';

function validatePageResponse(body) {
  const header = body?.header;
  const validHeader =
    header &&
    Number.isSafeInteger(header.page) &&
    header.page >= 1 &&
    Number.isSafeInteger(header.perPage) &&
    header.perPage >= 1 &&
    Number.isSafeInteger(header.total) &&
    header.total >= 0 &&
    Number.isSafeInteger(header.totalPages) &&
    header.totalPages >= 0;

  if (!Array.isArray(body?.data) || !validHeader) {
    throw new Error('페이지 조회 응답 형식이 올바르지 않습니다.');
  }

  return {
    items: body.data,
    page: header.page,
    perPage: header.perPage,
    total: header.total,
    totalPages: Math.max(1, header.totalPages),
  };
}

export const useProductStore = defineStore('records_product', () => {
  const items = ref([]);
  const page = ref(1);
  const perPage = ref(10);
  const query = ref('');
  const sort = ref('newest');
  const total = ref(0);
  const totalPages = ref(1);
  const loading = ref(false);
  const saving = ref(false);
  const error = ref('');
  const notice = ref('');
  const retryPage = ref(1);

  const hasItems = computed(() => items.value.length > 0);
  let activeRequest;
  let requestSequence = 0;
  let screenSequence = 0;

  async function fetchPage(requestedPage = page.value) {
    // 검색을 연속 실행하면 이전 요청을 취소합니다.
    // 취소 직전에 응답이 도착하는 경우도 있으므로 순번을 함께 확인합니다.
    activeRequest?.abort();
    activeRequest = new AbortController();
    const currentRequest = ++requestSequence;

    loading.value = true;
    error.value = '';
    retryPage.value = requestedPage;

    try {
      const body = await listProducts(
        {
          page: requestedPage,
          perPage: perPage.value,
          q: query.value,
          sort: sort.value,
        },
        activeRequest.signal,
      );

      if (currentRequest !== requestSequence) {
        return;
      }

      const result = validatePageResponse(body);

      // 마지막 행 삭제 등으로 해당 페이지가 없어졌으면 마지막 페이지로 이동합니다.
      if (requestedPage > result.totalPages) {
        await fetchPage(result.totalPages);
        return;
      }

      items.value = result.items;
      page.value = result.page;
      perPage.value = result.perPage;
      total.value = result.total;
      totalPages.value = result.totalPages;
    } catch (failure) {
      if (currentRequest !== requestSequence || isCanceled(failure)) {
        return;
      }

      items.value = [];
      total.value = 0;
      totalPages.value = 1;
      page.value = 1;
      error.value = errorMessage(failure);
    } finally {
      if (currentRequest === requestSequence) {
        loading.value = false;
      }
    }
  }

  function search(filters) {
    query.value = filters.query.trim();
    sort.value = filters.sort;
    return fetchPage(1);
  }

  function changePageSize(value) {
    perPage.value = value;
    return fetchPage(1);
  }

  async function saveProduct(id, values) {
    if (saving.value) {
      throw new Error('저장 중입니다. 잠시 기다려 주세요.');
    }

    saving.value = true;

    try {
      const result = id ? await updateProduct(id, values) : await createProduct(values);

      // 새 상품은 저장 직후 목록 첫 페이지에서 확인할 수 있게 합니다.
      if (!id) {
        page.value = 1;
        query.value = '';
        sort.value = 'newest';
      }

      notice.value = id ? '상품을 수정했습니다.' : '상품을 등록했습니다.';
      return result;
    } finally {
      // 실패는 View로 전달합니다. 저장 실패를 성공으로 바꾸지 않습니다.
      saving.value = false;
    }
  }

  async function removeProduct(id) {
    if (saving.value) {
      throw new Error('처리 중입니다. 잠시 기다려 주세요.');
    }

    saving.value = true;
    const currentScreen = screenSequence;

    try {
      await deleteProduct(id);
      notice.value = '상품을 삭제했습니다.';

      // 삭제가 성공했으므로 조회 실패와 구분합니다.
      // fetchPage의 오류는 목록 영역에 표시하며 삭제 POST/DELETE를 재전송하지 않습니다.
      // 화면을 떠난 뒤 완료된 삭제가 취소했던 목록 조회를 다시 시작하지 않게 합니다.
      if (currentScreen === screenSequence) await fetchPage();
    } finally {
      saving.value = false;
    }
  }

  function retry() {
    return fetchPage(retryPage.value);
  }

  function cancel() {
    screenSequence++;
    requestSequence++;
    activeRequest?.abort();
    loading.value = false;
  }

  return {
    items,
    page,
    perPage,
    query,
    sort,
    total,
    totalPages,
    loading,
    saving,
    error,
    notice,
    hasItems,
    fetchPage,
    search,
    changePageSize,
    saveProduct,
    removeProduct,
    retry,
    cancel,
  };
});
