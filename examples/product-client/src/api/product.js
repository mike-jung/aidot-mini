import api from './axios';

// HTTP 경로와 응답 형식을 한곳에 모읍니다. 화면 상태는 Pinia가 관리합니다.
export async function listProducts(params, signal) {
  const response = await api.get('/product/paged', { params, signal });
  return response.data;
}

export async function getProduct(id, signal) {
  const response = await api.get(`/product/${id}`, { signal });
  return response.data.data;
}

export async function createProduct(product) {
  const response = await api.post('/product', product);
  return response.data.data;
}

export async function updateProduct(id, product) {
  const response = await api.put(`/product/${id}`, product);
  return response.data.data;
}

export async function deleteProduct(id) {
  const response = await api.delete(`/product/${id}`);
  return response.data.data;
}

export async function uploadProductImage(file, { signal, onUploadProgress } = {}) {
  const form = new FormData();
  form.append('file', file, file.name);

  // Content-Type을 직접 지정하면 multipart boundary가 누락될 수 있습니다.
  const response = await api.post('/uploads/multipart', form, {
    params: { profile: 'image' },
    signal,
    onUploadProgress,
    timeout: 90000,
  });

  return response.data.data;
}
