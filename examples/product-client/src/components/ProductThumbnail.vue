<script setup>
import { computed, ref, watch } from 'vue';
import { publicImageUrl } from '@/api/axios';

const props = defineProps({ imagePath: String, name: String });
const failed = ref(false);
const imageUrl = computed(() => publicImageUrl(props.imagePath));

watch(
  () => props.imagePath,
  () => {
    failed.value = false;
  },
);
</script>

<template>
  <div class="product-thumbnail">
    <img
      v-if="imageUrl && !failed"
      :src="imageUrl"
      :alt="`${name} 이미지`"
      loading="lazy"
      @error="failed = true"
    />
    <span
      v-else
      aria-label="등록된 이미지 없음"
    >
      ◈
    </span>
  </div>
</template>
