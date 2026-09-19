import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import api, { serverOrigin, setCredentials, errorMessage } from '@/api/axios';

const mode = import.meta.env.VITE_AUTH_MODE || 'mini';
if (!['mini', 'express'].includes(mode))
  throw new Error('VITE_AUTH_MODE must be mini or express');

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null);
  const isAdmin = computed(
    () =>
      Boolean(user.value) &&
      (mode === 'mini' ||
        user.value.role === 'admin' ||
        (Array.isArray(user.value.roles) && user.value.roles.includes('admin'))),
  );
  const busy = ref(false);
  const error = ref('');
  let restored = false;
  let restoring;
  let sequence = 0;
  const path = (action) =>
    mode === 'mini' ? `/admin/${action}` : `/api/admin/auth/${action}`;
  const options = { baseURL: serverOrigin };

  function accept(body) {
    const data = body?.data;
    if (!data || (!data.user && !data.username))
      throw new Error('로그인 응답 형식이 올바르지 않습니다.');
    setCredentials(data);
    user.value = data.user || { username: data.username };
  }
  async function login(username, password) {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    // refresh 쿠키 응답이 로그인/로그아웃 뒤에 도착해 세션을 덮어쓰지 않게 합니다.
    if (restoring) await restoring;
    sequence++;
    try {
      accept(
        (await api.post(path('login'), { username: username.trim(), password }, options))
          .data,
      );
      restored = true;
    } catch (failure) {
      error.value = errorMessage(failure);
      throw failure;
    } finally {
      busy.value = false;
    }
  }
  function restore() {
    if (restored) return Promise.resolve();
    if (restoring) return restoring;
    const ticket = sequence;
    restoring = (async () => {
      try {
        const response =
          mode === 'mini'
            ? await api.get(path('session'), options)
            : await api.post(path('refresh'), {}, options);
        if (ticket === sequence) accept(response.data);
      } catch (failure) {
        if (ticket === sequence) {
          user.value = null;
          setCredentials();
          if (failure.response?.status !== 401) error.value = errorMessage(failure);
        }
      } finally {
        restored = true;
        restoring = null;
      }
    })();
    return restoring;
  }
  async function logout() {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    // refresh 쿠키 응답이 로그인/로그아웃 뒤에 도착해 세션을 덮어쓰지 않게 합니다.
    if (restoring) await restoring;
    sequence++;
    try {
      await api.post(path('logout'), {}, options);
      user.value = null;
      setCredentials();
    } catch (failure) {
      if (failure.response?.status === 401) {
        user.value = null;
        setCredentials();
      } else {
        error.value = errorMessage(failure);
        throw failure;
      }
    } finally {
      busy.value = false;
    }
  }
  return { user, isAdmin, busy, error, login, restore, logout };
});
