<script setup>
import { ref, onMounted, nextTick } from 'vue';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const showLogin = ref(false);
const username = ref('');
const password = ref('');
const usernameInput = ref(null);

async function openLogin() {
  showLogin.value = true;
  await nextTick();
  usernameInput.value?.focus();
}

async function login() {
  try {
    await auth.login(username.value, password.value);
    closeLogin();
  } catch {
    // 인증 오류는 store에 저장하고 로그인 폼 아래에 표시합니다.
  }
}

async function logout() {
  try {
    await auth.logout();
  } catch {
    await openLogin();
  }
}

function closeLogin() {
  showLogin.value = false;
  password.value = '';
  auth.error = '';
}

// 화면을 이동해도 store가 복원 요청을 한 번만 실행합니다.
onMounted(() => auth.restore());
</script>

<template>
  <header class="topbar">
    <RouterLink
      :to="{ name: 'product' }"
      class="brand"
      aria-label="Product Studio 홈"
    >
      <span
        class="brand-icon"
        aria-hidden="true"
      >
        p
        <span>•</span>
      </span>
      <span>
        Product
        <b>Studio</b>
      </span>
    </RouterLink>
    <nav
      class="header-nav"
      aria-label="주 메뉴"
    >
      <RouterLink :to="{ name: 'product' }">상품 목록</RouterLink>
      <RouterLink
        v-if="auth.isAdmin"
        :to="{ name: 'productCreate' }"
      >
        상품 등록
      </RouterLink>
    </nav>
    <div class="account-area">
      <span
        v-if="auth.user"
        class="account-name"
      >
        {{ auth.user.username || auth.user.name || '관리자' }}
      </span>
      <button
        class="button quiet"
        :disabled="auth.busy"
        @click="auth.user ? logout() : openLogin()"
      >
        {{ auth.user ? '로그아웃' : '로그인' }}
      </button>
    </div>
  </header>

  <section
    v-if="showLogin"
    class="card login-card"
    aria-label="관리자 로그인"
  >
    <form @submit.prevent="login">
      <strong>관리자 로그인</strong>
      <label>
        <span class="sr-only">아이디</span>
        <input
          ref="usernameInput"
          v-model="username"
          autocomplete="username"
          placeholder="아이디"
          aria-label="아이디"
          required
          :disabled="auth.busy"
        />
      </label>
      <label>
        <span class="sr-only">비밀번호</span>
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          placeholder="비밀번호"
          aria-label="비밀번호"
          required
          :disabled="auth.busy"
        />
      </label>
      <button
        class="button primary"
        :disabled="auth.busy"
      >
        {{ auth.busy ? '확인 중…' : '로그인' }}
      </button>
      <button
        type="button"
        class="button quiet"
        :disabled="auth.busy"
        @click="closeLogin"
      >
        닫기
      </button>
    </form>
    <p
      v-if="auth.error"
      class="notice error"
      role="alert"
    >
      {{ auth.error }}
    </p>
  </section>
</template>
