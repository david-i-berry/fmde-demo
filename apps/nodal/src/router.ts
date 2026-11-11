import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'status', component: () => import('./views/StatusBoard.vue') },
    { path: '/node/:group/:node', name: 'node', component: () => import('./views/NodeDetail.vue'), props: true },
    { path: '/topology', name: 'topology', component: () => import('./views/TopologyView.vue') },
    { path: '/map', name: 'map', component: () => import('./views/MapView.vue') },
    { path: '/site/:site', name: 'site', component: () => import('./views/SiteView.vue'), props: true },
    { path: '/inspector', name: 'inspector', component: () => import('./views/MessageInspector.vue') },
    { path: '/settings', name: 'settings', component: () => import('./views/Settings.vue') },
  ],
})
