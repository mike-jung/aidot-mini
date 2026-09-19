<script setup>
import { computed } from 'vue';

const props = defineProps({
  page: { type: Number, required: true },
  perPage: { type: Number, required: true },
  total: { type: Number, required: true },
  totalPages: { type: Number, required: true },
  disabled: Boolean,
});

const emit = defineEmits(['change-page', 'change-page-size']);

// 현재 페이지 주변의 버튼을 최대 5개만 표시합니다.
const visiblePages = computed(() => {
  const count = Math.min(5, props.totalPages);
  const start = Math.max(1, Math.min(props.page - 2, props.totalPages - count + 1));
  return Array.from({ length: count }, (_, index) => start + index);
});

const firstItem = computed(() =>
  props.total ? (props.page - 1) * props.perPage + 1 : 0,
);
const lastItem = computed(() => Math.min(props.page * props.perPage, props.total));

function changePageSize(event) {
  emit('change-page-size', Number(event.target.value));
}
</script>

<template>
  <footer class="list-footer">
    <div
      class="result-count"
      aria-live="polite"
    >
      <strong>{{ firstItem }}–{{ lastItem }}</strong>
      / {{ total }}개
    </div>

    <nav
      class="pagination"
      aria-label="페이지 이동"
    >
      <button
        aria-label="첫 페이지"
        :disabled="disabled || page === 1"
        @click="emit('change-page', 1)"
      >
        «
      </button>
      <button
        aria-label="이전 페이지"
        :disabled="disabled || page === 1"
        @click="emit('change-page', page - 1)"
      >
        ‹
      </button>
      <button
        v-for="number in visiblePages"
        :key="number"
        :class="{ active: number === page }"
        :aria-current="number === page ? 'page' : undefined"
        :aria-label="`${number} 페이지`"
        :disabled="disabled"
        @click="emit('change-page', number)"
      >
        {{ number }}
      </button>
      <button
        aria-label="다음 페이지"
        :disabled="disabled || page >= totalPages"
        @click="emit('change-page', page + 1)"
      >
        ›
      </button>
      <button
        aria-label="마지막 페이지"
        :disabled="disabled || page >= totalPages"
        @click="emit('change-page', totalPages)"
      >
        »
      </button>
    </nav>

    <label class="page-size">
      표시 개수
      <select
        :value="perPage"
        :disabled="disabled"
        aria-label="페이지 크기"
        @change="changePageSize"
      >
        <option :value="10">10개</option>
        <option :value="20">20개</option>
        <option :value="50">50개</option>
      </select>
    </label>
  </footer>
</template>
