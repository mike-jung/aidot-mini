<script setup>
import { onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import ProductHeader from '@/components/ProductHeader.vue';
import ProductList from '@/components/ProductList.vue';
import PaginationBar from '@/components/PaginationBar.vue';
import { useProductStore } from '@/stores/records_product';
import { useAuthStore } from '@/stores/auth';
import { errorMessage } from '@/api/axios';

const router = useRouter();
const products = useProductStore();
const auth = useAuthStore();
const filters = reactive({ query: products.query, sort: products.sort });
const pendingDelete = ref(null);
const deleteError = ref('');
const deleteDialog = ref(null);
let active = true;

function search() {
  products.search(filters);
}

function resetSearch() {
  filters.query = '';
  filters.sort = 'newest';
  search();
}

function editProduct(id) {
  router.push({ name: 'productEdit', params: { id } });
}

function askDelete(product) {
  pendingDelete.value = product;
  deleteError.value = '';
  deleteDialog.value.showModal();
}

function closeDelete() {
  if (products.saving) return;
  deleteDialog.value.close();
  pendingDelete.value = null;
}

async function confirmDelete() {
  if (!pendingDelete.value || products.saving) {
    return;
  }

  try {
    await products.removeProduct(pendingDelete.value.id);
    if (!active) return;
    deleteDialog.value?.close();
    pendingDelete.value = null;
  } catch (error) {
    if (active) deleteError.value = errorMessage(error);
  }
}

onMounted(() => products.fetchPage());
onUnmounted(() => {
  active = false;
  products.cancel();
});
</script>

<template>
  <div class="product-page">
    <ProductHeader />
    <main class="product-main">
      <div class="page-intro">
        <div>
          <span class="eyebrow">PRODUCT COLLECTION</span>
          <h1>상품을 고르는 작은 즐거움.</h1>
          <p>사진과 함께 상품을 살펴보고, 새로운 상품을 등록하세요.</p>
        </div>
        <RouterLink
          v-if="auth.isAdmin"
          :to="{ name: 'productCreate' }"
          class="button primary"
        >
          상품 등록
          <span aria-hidden="true">＋</span>
        </RouterLink>
      </div>

      <p
        v-if="products.notice"
        class="notice success"
        role="status"
      >
        {{ products.notice }}
      </p>

      <section
        class="card"
        aria-labelledby="list-title"
      >
        <div class="section-heading">
          <h2 id="list-title">
            상품 목록
            <span class="count">{{ products.total }}</span>
          </h2>
          <button
            class="button quiet"
            :disabled="products.loading"
            @click="products.fetchPage()"
          >
            새로고침 ↻
          </button>
        </div>

        <form
          class="toolbar"
          @submit.prevent="search"
        >
          <label class="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              v-model="filters.query"
              aria-label="상품 검색"
              maxlength="100"
              placeholder="상품 이름이나 설명을 검색해 보세요"
            />
          </label>
          <button
            type="submit"
            class="button primary"
          >
            검색
          </button>
          <select
            v-model="filters.sort"
            aria-label="정렬"
            @change="search"
          >
            <option value="newest">최신순</option>
            <option value="name">이름순</option>
            <option value="priceAsc">낮은 가격순</option>
            <option value="priceDesc">높은 가격순</option>
          </select>
        </form>

        <div
          v-if="products.error"
          class="notice error"
          role="alert"
        >
          {{ products.error }}
          <button
            class="text-button"
            @click="products.retry()"
          >
            다시 시도
          </button>
        </div>

        <ProductList
          v-if="products.hasItems || products.loading"
          :items="products.items"
          :loading="products.loading"
          :editable="auth.isAdmin"
          @edit="editProduct"
          @remove="askDelete"
        />
        <div
          v-else-if="!products.error"
          class="empty-state"
        >
          <strong>검색 결과가 없어요</strong>
          <p>다른 검색어로 찾아보세요.</p>
          <button
            class="text-button"
            @click="resetSearch"
          >
            전체 상품 보기
          </button>
        </div>

        <PaginationBar
          :page="products.page"
          :per-page="products.perPage"
          :total="products.total"
          :total-pages="products.totalPages"
          :disabled="products.loading"
          @change-page="products.fetchPage"
          @change-page-size="products.changePageSize"
        />
      </section>
    </main>

    <dialog
      ref="deleteDialog"
      class="confirm-dialog"
      aria-labelledby="delete-title"
      @cancel.prevent="closeDelete"
    >
      <h2 id="delete-title">상품을 삭제할까요?</h2>
      <p>{{ pendingDelete?.name }}</p>
      <p
        v-if="deleteError"
        class="notice error"
        role="alert"
      >
        {{ deleteError }}
      </p>
      <div class="form-actions">
        <button
          class="button quiet"
          :disabled="products.saving"
          @click="closeDelete"
        >
          취소
        </button>
        <button
          class="button danger-button"
          :disabled="products.saving"
          @click="confirmDelete"
        >
          삭제
        </button>
      </div>
    </dialog>
  </div>
</template>
