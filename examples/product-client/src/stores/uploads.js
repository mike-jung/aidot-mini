import { defineStore } from 'pinia';
import { ref } from 'vue';
import { uploadProductImage } from '@/api/product';

export const useUploadStore = defineStore('uploads', () => {
  const uploading = ref(false);
  const progress = ref(0);
  let request;
  let sequence = 0;

  async function upload(file) {
    if (uploading.value) {
      throw new Error('이미지를 업로드하고 있습니다.');
    }

    request = new AbortController();
    const current = ++sequence;
    uploading.value = true;
    progress.value = 0;

    try {
      const result = await uploadProductImage(file, {
        signal: request.signal,
        onUploadProgress(event) {
          // 100%는 전송 완료가 아니라 서버의 저장 응답을 받은 뒤 표시합니다.
          if (current === sequence && event.total) {
            progress.value = Math.min(99, Math.round((event.loaded / event.total) * 100));
          }
        },
      });

      if (typeof result?.url !== 'string') {
        throw new Error('서버가 이미지 경로를 반환하지 않았습니다.');
      }

      if (current === sequence) {
        progress.value = 100;
      }

      return result.url;
    } finally {
      if (current === sequence) {
        uploading.value = false;
      }
    }
  }

  function cancel() {
    sequence++;
    request?.abort();
    uploading.value = false;
    progress.value = 0;
  }

  return { uploading, progress, upload, cancel };
});
