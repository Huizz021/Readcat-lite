import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router';

const routes: Array<RouteRecordRaw> = [
  {
    path: '/',
    redirect: '/bookshelf'
  },
  {
    name: 'bookshelf',
    path: '/bookshelf',
    meta: {
      title: '书架'
    },
    component: () => import('../views/bookshelf/index.vue')
  },
  {
    name: 'read',
    path: '/read',
    meta: {
      title: '阅读'
    },
    component: () => import('../views/read/index.vue')
  },
  {
    name: 'detail',
    path: '/detail',
    meta: {
      title: '详情'
    },
    component: () => import('../views/detail/index.vue')
  },
  {
    name: 'history',
    path: '/history',
    meta: {
      title: '历史记录'
    },
    component: () => import('../views/history/index.vue')
  },
  {
    // 兜底：已移除的 /bookstore 等历史路径与未知路径统一回到书架，避免白屏
    path: '/:pathMatch(.*)*',
    redirect: '/bookshelf'
  },

];

export default createRouter({
  routes,
  history: createWebHashHistory()
});