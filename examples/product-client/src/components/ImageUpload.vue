<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { publicImageUrl } from '@/api/axios';

const props = defineProps({
  imagePath: { type: String, default: null },
  disabled: Boolean,
});
const emit = defineEmits(['change', 'remove', 'checking']);

const input = ref(null);
const selectedFile = ref(null);
const localPreview = ref('');
const dimensions = ref('');
const selectionError = ref('');
const checking = ref(false);
const dragDepth = ref(0);
let selectionSequence = 0;

const previewUrl = computed(() => localPreview.value || publicImageUrl(props.imagePath));
const fileSize = computed(() => {
  const bytes = selectedFile.value?.size || 0;
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
});

watch(checking, (value) => emit('checking', value), { flush: 'sync' });

function releasePreview() {
  // Object URL은 메모리를 사용하므로 변경·제거·화면 종료 시 해제합니다.
  if (localPreview.value) {
    URL.revokeObjectURL(localPreview.value);
    localPreview.value = '';
  }
}

function clearImage() {
  if (props.disabled) return;

  selectionSequence++;
  releasePreview();
  selectedFile.value = null;
  dimensions.value = '';
  selectionError.value = '';
  checking.value = false;
  if (input.value) input.value.value = '';

  emit('change', null);
  emit('remove');
}

async function chooseImage(files) {
  if (props.disabled) return;

  const candidates = Array.from(files || []);
  if (!candidates.length) return;

  // 새 선택이 잘못된 경우에는 이전의 정상적인 선택을 유지합니다.
  const currentSelection = ++selectionSequence;
  checking.value = false;
  selectionError.value = '';

  if (candidates.length !== 1) {
    selectionError.value = '이미지 한 개만 선택해 주세요.';
    return;
  }

  const candidate = candidates[0];
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(candidate.type)) {
    selectionError.value = 'PNG, JPEG, WebP 이미지만 선택할 수 있어요.';
    return;
  }
  if (!candidate.size || candidate.size > 5 * 1024 * 1024) {
    selectionError.value = '0바이트보다 크고 5MB 이하인 이미지를 선택해 주세요.';
    return;
  }

  const candidateUrl = URL.createObjectURL(candidate);
  checking.value = true;

  try {
    const image = new Image();
    image.src = candidateUrl;
    await image.decode();

    // 연속으로 이미지를 선택해도 마지막 선택만 반영합니다.
    if (currentSelection !== selectionSequence) {
      URL.revokeObjectURL(candidateUrl);
      return;
    }

    releasePreview();
    selectedFile.value = candidate;
    localPreview.value = candidateUrl;
    dimensions.value = `${image.naturalWidth} × ${image.naturalHeight}`;
    emit('change', candidate);
  } catch {
    URL.revokeObjectURL(candidateUrl);
    if (currentSelection === selectionSequence) {
      selectionError.value = '이미지를 읽지 못했어요. 다른 파일을 선택해 주세요.';
    }
  } finally {
    if (currentSelection === selectionSequence) checking.value = false;
  }
}

function dropImage(event) {
  dragDepth.value = 0;
  chooseImage(event.dataTransfer.files);
}

onUnmounted(() => {
  selectionSequence++;
  releasePreview();
});
</script>

<template>
  <section
    class="image-field"
    aria-labelledby="image-title"
  >
    <div class="section-heading">
      <h2 id="image-title">
        상품 이미지
        <span class="optional">선택</span>
      </h2>
      <span class="soft-badge">최대 5 MB</span>
    </div>
    <p class="section-description">이미지를 선택하면 먼저 미리보기가 표시됩니다.</p>

    <!-- 실제 input은 숨기고 키보드로도 누를 수 있는 button을 선택 영역으로 사용합니다. -->
    <input
      ref="input"
      type="file"
      class="sr-only"
      tabindex="-1"
      aria-label="이미지 파일"
      accept="image/png,image/jpeg,image/webp"
      :disabled="disabled"
      @change="chooseImage($event.target.files)"
    />
    <button
      type="button"
      class="dropzone"
      :class="{ dragging: dragDepth > 0, 'has-preview': previewUrl }"
      :disabled="disabled"
      aria-label="여기를 눌러 이미지를 업로드하거나 드래그앤드롭하세요"
      :aria-busy="checking"
      @click="input.click()"
      @dragenter.prevent="dragDepth++"
      @dragover.prevent
      @dragleave.prevent="dragDepth = Math.max(0, dragDepth - 1)"
      @drop.prevent="dropImage"
    >
      <template v-if="previewUrl">
        <img
          class="image-preview"
          :src="previewUrl"
          alt="상품 이미지 미리보기"
          @error="
            selectionError =
              '저장된 이미지를 불러오지 못했어요. 새 이미지를 선택할 수 있습니다.'
          "
        />
        <span class="replace-overlay">클릭하거나 드래그해 이미지 변경</span>
      </template>
      <template v-else>
        <span
          class="upload-art"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 64 64"
            fill="none"
          >
            <rect
              x="12"
              y="9"
              width="40"
              height="46"
              rx="10"
              fill="white"
              stroke="currentColor"
              stroke-width="2"
            />
            <circle
              cx="25"
              cy="24"
              r="4"
              fill="currentColor"
              opacity=".5"
            />
            <path
              d="m17 46 12-13 8 7 6-6 6 12"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <circle
              cx="50"
              cy="49"
              r="12"
              fill="currentColor"
            />
            <path
              d="M50 54V44m-4 4 4-4 4 4"
              stroke="white"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        <strong>여기를 눌러 이미지를 업로드하세요</strong>
        <span>또는 이미지를 드래그앤드롭하세요</span>
        <small>PNG · JPEG · WebP</small>
      </template>
    </button>

    <p
      v-if="checking"
      class="field-help"
      role="status"
    >
      이미지를 확인하고 있어요…
    </p>
    <div
      v-if="previewUrl"
      class="file-info"
    >
      <span
        class="file-mark"
        aria-hidden="true"
      >
        ▧
      </span>
      <div>
        <strong>{{ selectedFile?.name || '저장된 상품 이미지' }}</strong>
        <span>
          {{
            selectedFile
              ? `${fileSize} · ${dimensions}`
              : '새 이미지를 선택하면 교체됩니다.'
          }}
        </span>
      </div>
      <button
        type="button"
        class="icon-button"
        :disabled="disabled"
        aria-label="이미지 제거"
        @click="clearImage"
      >
        ×
      </button>
    </div>
    <p
      v-if="selectionError"
      class="notice error"
      role="alert"
    >
      {{ selectionError }}
    </p>
  </section>
</template>
