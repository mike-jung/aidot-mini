<script setup>
import ProductThumbnail from './ProductThumbnail.vue';

defineProps({
  items: { type: Array, required: true },
  loading: Boolean,
  editable: Boolean,
});

const emit = defineEmits(['edit', 'remove']);
const priceFormat = new Intl.NumberFormat('ko-KR');
</script>

<template>
  <div
    class="table-scroll"
    :aria-busy="loading"
  >
    <table>
      <thead>
        <tr>
          <th class="id-cell">번호</th>
          <th>상품</th>
          <th>설명</th>
          <th class="price-cell">가격</th>
          <th
            v-if="editable"
            class="actions-cell"
          >
            관리
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="product in items"
          :key="product.id"
        >
          <td class="id-cell">{{ product.id }}</td>
          <td>
            <div class="product-name">
              <ProductThumbnail
                :image-path="product.imagePath"
                :name="product.name"
              />
              <strong>{{ product.name }}</strong>
            </div>
          </td>
          <td class="memo-cell">{{ product.memo || '—' }}</td>
          <td class="price-cell">
            {{ priceFormat.format(product.price) }}
            <span class="currency">원</span>
          </td>
          <td
            v-if="editable"
            class="actions-cell"
          >
            <button
              class="text-button"
              :aria-label="`${product.name} 수정`"
              @click="emit('edit', product.id)"
            >
              수정
            </button>
            <button
              class="text-button danger"
              :aria-label="`${product.name} 삭제`"
              @click="emit('remove', product)"
            >
              삭제
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <div
      v-if="loading"
      class="loading-strip"
      role="status"
    >
      상품을 불러오는 중…
    </div>
  </div>
</template>
