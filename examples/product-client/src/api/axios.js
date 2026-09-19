import axios from 'axios';

// 기존 default export와 AxiosResponse 형식을 유지합니다.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 15000,
  withCredentials: true,
  headers: { Accept: 'application/json' },
});

let accessToken = '';
let csrfToken = '';
export function setCredentials({ accessToken: access = '', csrfToken: csrf = '' } = {}) {
  accessToken = access;
  csrfToken = csrf;
}

const apiOrigin = new URL(api.defaults.baseURL, window.location.origin).origin;
export const serverOrigin = apiOrigin;

api.interceptors.request.use((config) => {
  const target = new URL(api.getUri(config), window.location.origin);
  if (target.origin === apiOrigin) {
    if (accessToken) config.headers.set('Authorization', `Bearer ${accessToken}`);
    if (csrfToken && !['get', 'head', 'options'].includes(config.method)) {
      config.headers.set('X-CSRF-Token', csrfToken);
    }
  }
  // JSON은 Axios가, FormData의 multipart boundary는 브라우저가 설정합니다.
  return config;
});

export function errorMessage(error) {
  const status = error?.response?.status;
  if (status === 401) return '로그인이 필요하거나 만료되었습니다. 다시 로그인해 주세요.';
  if (status === 403)
    return '요청 권한을 확인해 주세요. 로그인 상태가 오래되었다면 다시 로그인해 주세요.';
  if (status === 413) return '파일이 너무 큽니다. 5MB 이하 이미지를 선택해 주세요.';
  if (['ECONNABORTED', 'ETIMEDOUT'].includes(error?.code))
    return '응답 시간이 초과되었습니다. 연결을 확인해 주세요.';
  if (error?.code === 'ERR_NETWORK')
    return '서버에 연결할 수 없습니다. API 주소와 서버 실행 상태를 확인해 주세요.';
  const message = error?.response?.data?.message;
  return typeof message === 'string' ? message : error?.message || '요청에 실패했습니다.';
}

export const isCanceled = axios.isCancel;
export default api;

export function publicImageUrl(imagePath) {
  if (
    !imagePath ||
    !/^\/uploads\/images\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(imagePath)
  ) {
    return '';
  }

  // DB에는 origin을 저장하지 않습니다. 표시할 때 현재 API 서버에 연결합니다.
  return new URL(imagePath, serverOrigin).href;
}
