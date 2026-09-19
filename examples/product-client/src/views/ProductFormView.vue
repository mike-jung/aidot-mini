<script setup>
import { computed, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ProductHeader from '@/components/ProductHeader.vue';
import ImageUpload from '@/components/ImageUpload.vue';
import { getProduct } from '@/api/product';
import { errorMessage, isCanceled } from '@/api/axios';
import { useAuthStore } from '@/stores/auth';
import { useProductStore } from '@/stores/records_product';
import { useUploadStore } from '@/stores/uploads';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const products = useProductStore();
const uploads = useUploadStore();

// 입력 중인 폼은 이 화면에서만 사용하므로 Pinia가 아닌 지역 상태로 둡니다.
const form = reactive({ name: '', price: 0, memo: '', imagePath: null });
const selectedFile = ref(null);
const imageChecking = ref(false);
const saving = ref(false);
const loading = ref(false);
const loadError = ref('');
const saveError = ref('');
const formVersion = ref(0);
const productId = computed(() => (route.params.id ? Number(route.params.id) : null));
const isEdit = computed(() => route.name === 'productEdit');
let loadRequest;
let screenSequence = 0;

const saveLabel = computed(() => {
  if (uploads.uploading) return `이미지 업로드 중 ${uploads.progress}%`;
  if (saving.value) return '상품 저장 중…';
  return isEdit.value ? '변경사항 저장' : '상품 등록';
});

async function loadForm() {
  const currentScreen = ++screenSequence;
  loadRequest?.abort();
  uploads.cancel();
  loadRequest = new AbortController();

  Object.assign(form, { name: '', price: 0, memo: '', imagePath: null });
  selectedFile.value = null;
  imageChecking.value = false;
  formVersion.value++;
  loadError.value = '';
  saveError.value = '';
  loading.value = isEdit.value;

  if (!isEdit.value) return;

  try {
    const product = await getProduct(productId.value, loadRequest.signal);
    if (currentScreen === screenSequence) {
      Object.assign(form, {
        name: product.name,
        price: product.price,
        memo: product.memo || '',
        imagePath: product.imagePath,
      });
    }
  } catch (error) {
    if (currentScreen === screenSequence && !isCanceled(error)) {
      loadError.value = errorMessage(error);
    }
  } finally {
    if (currentScreen === screenSequence) loading.value = false;
  }
}

async function save() {
  if (saving.value || imageChecking.value || !auth.isAdmin) return;

  saveError.value = '';
  const name = form.name.trim();
  if (
    !name ||
    !Number.isSafeInteger(form.price) ||
    form.price < 0 ||
    form.price > 1000000
  ) {
    saveError.value = '상품 이름과 0~1,000,000 사이의 정수 가격을 입력해 주세요.';
    return;
  }

  const currentScreen = screenSequence;
  const id = productId.value;
  saving.value = true;

  try {
    // 1. 이미지가 바뀐 경우에만 업로드하고 공개 경로를 받습니다.
    if (selectedFile.value) {
      const imagePath = await uploads.upload(selectedFile.value);
      if (currentScreen !== screenSequence) return;

      form.imagePath = imagePath;
      selectedFile.value = null;
    }

    // 2. 상품 정보와 공개 경로를 한 행으로 저장합니다.
    // DB 저장만 실패하면 경로를 유지하므로 다시 저장할 때 중복 업로드하지 않습니다.
    await products.saveProduct(id, {
      name,
      price: form.price,
      memo: form.memo.trim(),
      imagePath: form.imagePath,
    });

    if (currentScreen === screenSequence) {
      await router.push({ name: 'product' });
    }
  } catch (error) {
    if (currentScreen === screenSequence && !isCanceled(error)) {
      saveError.value = errorMessage(error);
    }
  } finally {
    saving.value = false;
  }
}

// /product/new와 /product/:id/edit가 같은 컴포넌트를 사용하므로 라우트 변경도 처리합니다.
watch(() => route.fullPath, loadForm, { immediate: true });
onUnmounted(() => {
  screenSequence++;
  loadRequest?.abort();
  uploads.cancel();
});
</script>

<template>
  <div class="product-page">
    <ProductHeader />
    <main class="product-main form-main">
      <RouterLink
        :to="{ name: 'product' }"
        class="back-link"
      >
        ← 상품 목록
      </RouterLink>
      <div class="page-intro">
        <div>
          <span class="eyebrow">{{ isEdit ? 'EDIT PRODUCT' : 'NEW PRODUCT' }}</span>
          <h1>
            {{ isEdit ? '상품 정보를 더 정확하게.' : '좋아하는 상품을 소개해 주세요.' }}
          </h1>
          <p>이름과 가격을 입력하고, 상품을 닮은 사진을 더해 보세요.</p>
        </div>
      </div>

      <p
        v-if="loading"
        class="notice"
        role="status"
      >
        상품을 불러오는 중…
      </p>
      <p
        v-else-if="loadError"
        class="notice error"
        role="alert"
      >
        {{ loadError }}
      </p>
      <form
        v-else
        class="card product-form"
        @submit.prevent="save"
      >
        <div class="form-grid">
          <fieldset
            :disabled="saving"
            class="details-fields"
          >
            <legend>상품 정보</legend>
            <label for="product-name">
              상품 이름
              <span aria-hidden="true">*</span>
            </label>
            <input
              id="product-name"
              v-model="form.name"
              required
              maxlength="100"
              placeholder="예: 데일리 세라믹 머그"
            />
            <label for="product-price">
              가격
              <span aria-hidden="true">*</span>
            </label>
            <div class="price-input">
              <input
                id="product-price"
                v-model.number="form.price"
                type="number"
                required
                min="0"
                max="1000000"
                step="1"
              />
              <span>원</span>
            </div>
            <label for="product-memo">
              설명
              <span class="optional">선택</span>
            </label>
            <textarea
              id="product-memo"
              v-model="form.memo"
              rows="5"
              maxlength="500"
              placeholder="상품의 특징을 간단히 적어 주세요."
            ></textarea>
            <span class="field-help memo-count">{{ form.memo.length }} / 500</span>
          </fieldset>

          <ImageUpload
            :key="formVersion"
            :image-path="form.imagePath"
            :disabled="saving"
            @change="selectedFile = $event"
            @remove="form.imagePath = null"
            @checking="imageChecking = $event"
          />
        </div>

        <p
          v-if="saveError"
          class="notice error"
          role="alert"
        >
          {{ saveError }}
        </p>
        <div
          v-if="uploads.uploading"
          class="upload-progress"
          role="status"
        >
          <span>이미지를 저장하고 있어요… {{ uploads.progress }}%</span>
          <progress
            max="100"
            :value="uploads.progress"
            aria-label="이미지 업로드 진행률"
          ></progress>
        </div>
        <footer class="form-footer">
          <p>
            {{
              auth.isAdmin
                ? '등록한 사진은 상품 목록에도 표시됩니다.'
                : auth.user
                  ? '상품 저장은 관리자 권한이 필요합니다.'
                  : '상단에서 로그인하면 저장할 수 있어요.'
            }}
          </p>
          <button
            type="submit"
            class="button primary"
            :disabled="saving || imageChecking || !auth.isAdmin"
          >
            {{ saveLabel }}
            <span aria-hidden="true">↗</span>
          </button>
        </footer>
      </form>
    </main>
  </div>
</template>
