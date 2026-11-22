import { watch } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { store, getCurrentRole, addAuditLog, showToast } from '../store/appStore'

const routes = [
  { path: '/', redirect: '/cockpit' },
  { path: '/login', component: () => import('../views/LoginView.vue'), meta: { public: true } },
  { path: '/portal', component: () => import('../views/PortalView.vue') },
  { path: '/cockpit', component: () => import('../views/CockpitView.vue') },
  { path: '/data-hub', component: () => import('../views/DataHubView.vue') },
  { path: '/think-tank', component: () => import('../views/ThinkTankView.vue') },
  { path: '/armed-forces', component: () => import('../views/ArmedForcesView.vue') },
  { path: '/grid', component: () => import('../views/GridBusinessView.vue') },
  { path: '/data-direct', component: () => import('../views/DataDirectView.vue') },
  { path: '/mobile', component: () => import('../views/MobileGridView.vue') },
  { path: '/xinchuang', component: () => import('../views/XinchuangView.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/portal' }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

router.beforeEach((to) => {
  if (to.meta.public) return true
  if (!store.loggedIn) return '/login'
  const role = getCurrentRole()
  if (!role.allowedRoutes.includes(to.path)) {
    addAuditLog(`越权访问路由「${to.path}」被系统路由守卫拦截`, '越权拦截')
    showToast(`当前角色「${role.name}」未获该模块授权，访问已拦截`)
    return '/portal'
  }
  return true
})

watch(
  () => store.roleId,
  () => {
    const cur = router.currentRoute.value
    if (!cur || cur.meta?.public || !store.loggedIn) return
    const role = getCurrentRole()
    if (!role.allowedRoutes.includes(cur.path)) {
      addAuditLog(`角色切换为「${role.name}」后自动收口越权页面「${cur.path}」`, '权限收敛')
      router.replace('/portal')
    }
  }
)

export default router
