import { createRouter, createWebHistory } from 'vue-router';

// 강의에서 사용한 수동 routes 배열과 views 폴더 구조를 유지합니다.
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: { name: 'product' },
    },
    {
      path: '/product',
      name: 'product',
      component: () => import('../views/ProductView.vue'),
    },
    {
      path: '/product/new',
      name: 'productCreate',
      component: () => import('../views/ProductFormView.vue'),
    },
    {
      path: '/product/:id/edit',
      name: 'productEdit',
      component: () => import('../views/ProductFormView.vue'),
    },
    {
      path: '/product/upload',
      redirect: { name: 'productCreate' },
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: { name: 'product' },
    },
  ],
  scrollBehavior() {
    return { top: 0 };
  },
});

export default router;
