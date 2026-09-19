import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // 개발 시 같은 origin을 사용합니다. mini의 Origin/CSRF 검증을 위해 Host도 유지합니다.
  const target = env.API_TARGET || 'http://127.0.0.1:8901';
  return {
    plugins: [vue()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      proxy: {
        '/api': { target, changeOrigin: false },
        '/admin': { target, changeOrigin: false },
        '/uploads': { target, changeOrigin: false },
      },
    },
  };
});
