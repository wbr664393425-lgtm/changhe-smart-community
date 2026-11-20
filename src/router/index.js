import { watch } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { store, getCurrentRole, addAuditLog, showToast } from '../store/appStore'

import LoginView from '../views/LoginView.vue'
import PortalView from '../views/PortalView.vue'
import CockpitView from '../views/CockpitView.vue'
import DataHubView from '../views/DataHubView.vue'
import ThinkTankView from '../views/ThinkTankView.vue'
import ArmedForcesView from '../views/ArmedForcesView.vue'
import GridBusinessView from '../views/GridBusinessView.vue'
import DataDirectView from '../views/DataDirectView.vue'
import MobileGridView from '../views/MobileGridView.vue'
import XinchuangView from '../views/XinchuangView.vue'

const routes = [
  { path: '/', redirect: '/cockpit' },
  { path: '/login', component: LoginView, meta: { public: true } },
  { path: '/portal', component: PortalView },
  { path: '/cockpit', component: CockpitView },
  { path: '/data-hub', component: DataHubView },
  { path: '/think-tank', component: ThinkTankView },
  { path: '/armed-forces', component: ArmedForcesView },
  { path: '/grid', component: GridBusinessView },
  { path: '/data-direct', component: DataDirectView },
  { path: '/mobile', component: MobileGridView },
  { path: '/xinchuang', component: XinchuangView },
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
