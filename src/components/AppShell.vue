<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  Compass, Database, BookOpen, Shield, Layers, Table2,
  Smartphone, Server, WifiOff, PanelLeftClose, PanelLeftOpen, Monitor, Menu, X
} from 'lucide-vue-next'
import AppSelect from './AppSelect.vue'
import BrandLogo from './BrandLogo.vue'
import GovWatermark from './GovWatermark.vue'
import {
  store, PRESETS, ROLES, COMMUNITIES, getCurrentRole, getEffectiveCommunity,
  applyPreset, switchRole, resetDemoData, showToast
} from '../store/appStore'

const props = defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' }
})

const router = useRouter()
const route = useRoute()

const menuSearch = ref('')
const collapsedGroups = ref({})
const dropdownOpen = ref(false)
const accountBtnRef = ref(null)
const dropdownStyle = ref({})
const isMobileNav = ref(false)
const mobileNavOpen = ref(false)
let mobileMq = null

const isSidebarCollapsed = computed(() => !isMobileNav.value && store.sidebarCollapsed)

function updateMobileMq(e) {
  isMobileNav.value = !!e.matches
  if (!isMobileNav.value) mobileNavOpen.value = false
}

function closeMobileNav() {
  mobileNavOpen.value = false
}

const currentRole = computed(() => getCurrentRole())
const effectiveScope = computed(() => getEffectiveCommunity())

const SIDEBAR_GROUPS = [
  {
    id: 'portal',
    title: '门户总览',
    icon: Compass,
    items: [
      { path: '/portal', label: '工作总览' },
      { path: '/grid', label: '治理一张图', query: { tab: 'onemap' } }
    ]
  },
  {
    id: 'data',
    title: '中枢与智库',
    icon: Database,
    items: [
      { path: '/data-hub', label: '数据中枢' },
      { path: '/think-tank', label: '数据智库' }
    ]
  },
  {
    id: 'armed',
    title: '数字武装',
    icon: Shield,
    items: [
      { path: '/armed-forces', label: '五专题工作台' }
    ]
  },
  {
    id: 'grid',
    title: '网格治理',
    icon: Layers,
    items: [
      { path: '/grid', label: '事件研判', badge: 'events', query: { tab: 'triage' } },
      { path: '/grid', label: '楼栋房态', query: { tab: 'building' } },
      { path: '/grid', label: '权责规则', query: { tab: 'rules' } },
      { path: '/grid', label: '轨迹督办', query: { tab: 'patrol' } },
      { path: '/grid', label: '绩效分析', query: { tab: 'analysis' } }
    ]
  },
  {
    id: 'direct',
    title: '数据直达',
    icon: Table2,
    items: [
      { path: '/data-direct', label: '分色宽表', query: { tab: 'overview' } },
      { path: '/data-direct', label: '字段规则', query: { tab: 'model' } },
      { path: '/data-direct', label: '三态填报', query: { tab: 'fill' } },
      { path: '/data-direct', label: '红绿核查', badge: 'verify', query: { tab: 'verify' } },
      { path: '/data-direct', label: '隔离履历', query: { tab: 'query' } },
      { path: '/data-direct', label: '合并报表', query: { tab: 'report' } }
    ]
  },
  {
    id: 'mobile',
    title: '移动办公',
    icon: Smartphone,
    items: [
      { path: '/mobile', label: '掌上协同' }
    ]
  },
  {
    id: 'xinchuang',
    title: '信创底座',
    icon: Server,
    items: [
      { path: '/xinchuang', label: '安全保障' }
    ]
  }
]

const filteredGroups = computed(() => {
  const allowed = currentRole.value.allowedRoutes
  const q = menuSearch.value.trim()
  return SIDEBAR_GROUPS.map((g) => {
    const permitted = g.items.filter((it) => allowed.includes(it.path))
    const matched = q ? permitted.filter((it) => `${g.title}${it.label}`.includes(q)) : permitted
    return { ...g, items: matched }
  }).filter((g) => g.items.length > 0)
})

const totalVisibleItems = computed(() => filteredGroups.value.reduce((a, g) => a + g.items.length, 0))
const allCollapsed = computed(() => filteredGroups.value.length > 0 && filteredGroups.value.every((g) => collapsedGroups.value[g.id]))

const pendingEvents = computed(() =>
  store.events.filter((e) => e.stage !== '已办结' && (effectiveScope.value === '全街道' || e.community === effectiveScope.value)).length
)
const pendingVerify = computed(() => {
  if (store.dataDirect.verifyBatch.committed) return 0
  return store.dataDirect.verifyBatch.items.filter(
    (it) => effectiveScope.value === '全街道' || it.community === effectiveScope.value
  ).length
})

function toggleAllGroups() {
  const next = !allCollapsed.value
  filteredGroups.value.forEach((g) => {
    collapsedGroups.value[g.id] = next
  })
}

function isItemActive(it) {
  if (route.path !== it.path) return false
  if (it.query?.tab) {
    return (route.query.tab || (it.path === '/grid' ? 'triage' : 'overview')) === it.query.tab
  }
  return true
}

function goNav(it) {
  closeMobileNav()
  router.push(it.query ? { path: it.path, query: it.query } : it.path)
}

function toggleSidebar() {
  if (isMobileNav.value) {
    mobileNavOpen.value = !mobileNavOpen.value
    if (mobileNavOpen.value) {
      dropdownOpen.value = false
      window.dispatchEvent(new CustomEvent('rui:close-popovers', { detail: { source: 'mobile-nav' } }))
    }
    return
  }
  store.sidebarCollapsed = !store.sidebarCollapsed
  setTimeout(() => {
    window.dispatchEvent(new Event('resize'))
  }, 300)
}

function isGroupActive(g) {
  return g.items.some((it) => isItemActive(it))
}

function getGroupBadge(g) {
  let count = 0
  let isAlert = false
  for (const it of g.items) {
    if (it.badge === 'events' && pendingEvents.value > 0) {
      count += pendingEvents.value
      isAlert = true
    } else if (it.badge === 'verify' && pendingVerify.value > 0) {
      count += pendingVerify.value
    }
  }
  return { count, isAlert }
}

function onCollapsedGroupClick(g) {
  if (g.items && g.items.length) {
    goNav(g.items[0])
  }
}

function selectPreset(id, event) {
  if (store.preset === id) return
  applyPreset(id, event)
  const label = PRESETS.find((p) => p.id === id)?.label || id
  showToast(`已切换至「${label}」配色预设`)
}

const scopeOptions = computed(() => [
  { value: '全街道', label: '辖区：全街道' },
  ...COMMUNITIES.map((c) => ({ value: c.name, label: `辖区：${c.name}` }))
])

function onScopeChange(val) {
  store.selectedCommunity = val
  showToast(`已切换辖区视角：${store.selectedCommunity}`)
}

function handleSwitchRole(roleId) {
  switchRole(roleId)
  dropdownOpen.value = false
  const targetRole = ROLES.find((r) => r.id === roleId)
  if (targetRole && !targetRole.allowedRoutes.includes(route.path)) {
    router.push('/portal')
  }
}

function goLogout() {
  dropdownOpen.value = false
  closeMobileNav()
  store.loggedIn = false
  router.push('/login')
}

function toggleAccountMenu() {
  if (dropdownOpen.value) {
    dropdownOpen.value = false
    return
  }
  window.dispatchEvent(new CustomEvent('rui:close-popovers', { detail: { source: 'account-menu' } }))
  if (accountBtnRef.value) {
    const r = accountBtnRef.value.getBoundingClientRect()
    const w = Math.min(264, window.innerWidth - 24)
    dropdownStyle.value = {
      top: `${Math.round(r.bottom + 8)}px`,
      left: `${Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12))}px`,
      width: `${w}px`,
      right: 'auto'
    }
  }
  dropdownOpen.value = true
}

function handleResetData() {
  if (window.confirm('确认重置为默认业务基线数据？当前未归档的本地修改将被清空。')) {
    resetDemoData()
    dropdownOpen.value = false
  }
}

function onDocClick(e) {
  if (!e.target.closest('#account-btn') && !e.target.closest('#account-dropdown')) {
    dropdownOpen.value = false
  }
}

function onGlobalKey(e) {
  if (e.key === 'Escape') {
    if (dropdownOpen.value) {
      dropdownOpen.value = false
      accountBtnRef.value?.focus()
    } else if (mobileNavOpen.value) {
      closeMobileNav()
    }
  }
}

function onGlobalClosePopovers(e) {
  if (e?.detail?.source !== 'account-menu') {
    dropdownOpen.value = false
  }
}

watch(() => route.fullPath, () => {
  closeMobileNav()
})

onMounted(() => {
  document.body.classList.remove('view-cockpit', 'cockpit-dark')
  if (typeof window !== 'undefined' && window.matchMedia) {
    mobileMq = window.matchMedia('(max-width: 960px)')
    isMobileNav.value = mobileMq.matches
    mobileMq.addEventListener?.('change', updateMobileMq)
  }
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onGlobalKey)
  window.addEventListener('rui:close-popovers', onGlobalClosePopovers)
})

onBeforeUnmount(() => {
  mobileMq?.removeEventListener?.('change', updateMobileMq)
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onGlobalKey)
  window.removeEventListener('rui:close-popovers', onGlobalClosePopovers)
})
</script>

<template>
  <div class="admin-stage">
    <div class="app-frame" :class="{ 'sidebar-collapsed': isSidebarCollapsed, 'mobile-nav-open': mobileNavOpen }">
      <!-- 移动端侧滑抽屉遮罩 -->
      <div
        v-if="isMobileNav && mobileNavOpen"
        class="pg-mobile-scrim"
        aria-hidden="true"
        @click="closeMobileNav"
      ></div>

      <!-- 左侧菜单栏（桌面端支持 266px / 68px 自由收起，移动端 <=960px 转为滑出式抽屉） -->
      <aside
        class="pg-sidebar"
        :class="{ collapsed: isSidebarCollapsed, 'mobile-open': mobileNavOpen }"
        :role="isMobileNav ? 'dialog' : undefined"
        :aria-modal="isMobileNav && mobileNavOpen ? 'true' : undefined"
        aria-label="全量业务功能目录"
      >
        <div class="pg-brand-row">
          <div
            class="pg-brand"
            style="cursor: pointer"
            :title="isSidebarCollapsed ? '长河街道智慧社区 · 返回工作总览' : ''"
            @click="closeMobileNav(); router.push('/portal')"
          >
            <BrandLogo :size="isSidebarCollapsed ? 32 : 36" />
            <div v-if="!isSidebarCollapsed" class="pg-brand-text">
              <strong>长河街道智慧社区</strong>
              <small>天衢新区 · 综合治理平台</small>
            </div>
          </div>
          <button
            v-if="isMobileNav"
            type="button"
            class="pg-mobile-close"
            aria-label="关闭导航菜单"
            @click="closeMobileNav"
          >
            <X :size="18" />
          </button>
        </div>

        <button
          v-if="currentRole.allowedRoutes.includes('/cockpit')"
          type="button"
          class="pg-cockpit-entry"
          :title="isSidebarCollapsed ? '领导驾驶舱大屏' : ''"
          @click="closeMobileNav(); router.push('/cockpit')"
        >
          <template v-if="!isSidebarCollapsed">
            <div>
              <strong>领导驾驶舱大屏</strong>
              <small>一屏双态 · 14 社区治理一张图</small>
            </div>
            <span class="pg-cockpit-dot"></span>
          </template>
          <template v-else>
            <Monitor :size="18" />
          </template>
        </button>

        <!-- 展开态：检索栏 + 分组目录 -->
        <template v-if="!isSidebarCollapsed">
          <div class="pg-menu-tools">
            <input
              v-model="menuSearch"
              type="search"
              class="pg-menu-search"
              :placeholder="`检索 ${totalVisibleItems} 项授权业务…`"
            />
            <button type="button" class="pg-menu-fold-btn" @click="toggleAllGroups">
              {{ allCollapsed ? '展开' : '收起' }}
            </button>
          </div>

          <nav class="pg-nav-scroll">
            <div
              v-for="g in filteredGroups"
              :key="g.id"
              class="pg-group"
              :class="{ collapsed: !menuSearch.trim() && collapsedGroups[g.id] }"
            >
              <button
                type="button"
                class="pg-group-head"
                :aria-expanded="!collapsedGroups[g.id]"
                @click="collapsedGroups[g.id] = !collapsedGroups[g.id]"
              >
                <span class="pg-group-left">
                  <component :is="g.icon" class="icon" :size="14" />
                  <span>{{ g.title }}</span>
                </span>
                <span class="pg-group-right">
                  <span class="pg-group-cnt num">{{ g.items.length }}</span>
                  <span class="pg-group-chev">▾</span>
                </span>
              </button>
              <div class="pg-nav-grid" :style="g.items.length === 1 ? 'grid-template-columns: 1fr' : ''">
                <button
                  v-for="(it, idx) in g.items"
                  :key="`${it.path}-${idx}`"
                  type="button"
                  class="pg-nav-btn"
                  :class="{ active: isItemActive(it) }"
                  @click="goNav(it)"
                >
                  <span class="pg-nav-label">{{ it.label }}</span>
                  <span v-if="it.badge === 'events' && pendingEvents > 0" class="pg-badge alert num">{{ pendingEvents }}</span>
                  <span v-else-if="it.badge === 'verify' && pendingVerify > 0" class="pg-badge num">{{ pendingVerify }}</span>
                </button>
              </div>
            </div>
            <div v-if="!filteredGroups.length" class="empty-box" style="padding: 20px 8px">
              <span>未找到匹配功能</span>
            </div>
          </nav>

          <div class="pg-side-foot">
            <span class="pg-health">信创底座运行正常</span>
            <button type="button" class="link-btn" style="font-size: 12px" @click="goLogout">登录页</button>
          </div>
        </template>

        <!-- 收起态：68px 精致图标导航轨 -->
        <template v-else>
          <nav class="pg-rail-nav" aria-label="快捷业务图标导航">
            <button
              v-for="g in filteredGroups"
              :key="g.id"
              type="button"
              class="pg-rail-item"
              :class="{ active: isGroupActive(g) }"
              :title="`${g.title}（${g.items.map((x) => x.label).join(' / ')}）`"
              @click="onCollapsedGroupClick(g)"
            >
              <component :is="g.icon" :size="18" />
              <span
                v-if="getGroupBadge(g).count > 0"
                class="pg-rail-badge num"
                :class="{ alert: getGroupBadge(g).isAlert }"
              >{{ getGroupBadge(g).count }}</span>
            </button>
          </nav>

          <div class="pg-side-foot collapsed">
            <span class="pg-health-dot" title="信创底座正常"></span>
            <button
              type="button"
              class="pg-rail-expand-btn"
              title="展开左侧菜单栏"
              aria-label="展开左侧菜单栏"
              @click="toggleSidebar"
            >
              <PanelLeftOpen :size="16" />
            </button>
          </div>
        </template>
      </aside>

      <!-- 右侧主工作区 -->
      <div class="pg-workspace">
        <header class="pg-top">
          <div class="pg-top-lead">
            <button
              type="button"
              class="sidebar-toggle-btn"
              :title="isMobileNav ? (mobileNavOpen ? '关闭菜单' : '打开导航菜单') : (store.sidebarCollapsed ? '展开左侧菜单栏' : '收起左侧菜单栏')"
              :aria-label="isMobileNav ? (mobileNavOpen ? '关闭菜单' : '打开导航菜单') : (store.sidebarCollapsed ? '展开左侧菜单栏' : '收起左侧菜单栏')"
              :aria-expanded="isMobileNav ? mobileNavOpen : undefined"
              @click="toggleSidebar"
            >
              <Menu v-if="isMobileNav" :size="18" />
              <PanelLeftOpen v-else-if="store.sidebarCollapsed" :size="16" />
              <PanelLeftClose v-else :size="16" />
            </button>
            <div class="pg-top-title">
              <strong>{{ title }}</strong>
              <small v-if="subtitle">{{ subtitle }}</small>
            </div>
          </div>

          <div class="pg-top-actions">
            <span v-if="store.xinchuang.offlineSimulated" class="tag st-wait">
              <WifiOff :size="12" /> 离线矢量
            </span>

            <!-- 原版四套 rui-design 配色预设一键切换器 -->
            <div class="theme-switcher" role="group" aria-label="切换配色方案">
              <button
                v-for="p in PRESETS"
                :key="p.id"
                type="button"
                class="theme-dot-btn"
                :class="{ active: store.preset === p.id }"
                :title="`切换至「${p.label}」配色`"
                @click="selectPreset(p.id, $event)"
              >
                <span class="theme-swatch" :style="{ background: `linear-gradient(135deg,${p.sw1} 50%,${p.sw2} 50%)` }"></span>
                <span class="t-name">{{ p.label }}</span>
              </button>
            </div>

            <AppSelect
              class="pg-scope-select"
              aria-label="切换辖区范围"
              :model-value="effectiveScope"
              :options="scopeOptions"
              :disabled="currentRole.scope !== '全街道'"
              @update:model-value="onScopeChange"
            />

            <slot name="top-extra" />

            <button
              id="account-btn"
              ref="accountBtnRef"
              type="button"
              class="account-chip"
              aria-haspopup="menu"
              :aria-expanded="dropdownOpen"
              @click.stop="toggleAccountMenu"
            >
              <span class="account-avatar">{{ currentRole.userName.slice(0, 1) }}</span>
              <span class="account-role-name">{{ currentRole.name }}</span>
            </button>
          </div>
        </header>

        <main class="pg-content">
          <div class="pg-stack">
            <slot />
          </div>
        </main>
      </div>
    </div>

    <!-- 全屏低干扰实名防拍水印（独立隔离 1Hz 时钟组件，关闭即停表） -->
    <GovWatermark
      v-if="store.xinchuang.watermarkEnabled"
      :user-name="currentRole.userName"
      :dept="currentRole.dept"
    />

    <!-- 顶层挂载 100% 不透明实色账号切换下拉框 -->
    <Teleport to="body">
      <div
        id="account-dropdown"
        class="top-dropdown"
        :class="{ open: dropdownOpen }"
        :style="dropdownStyle"
        role="menu"
      >
        <div class="dd-head">
          <strong>{{ currentRole.name }}（{{ currentRole.userName }}）</strong>
          <span>当前辖区：{{ effectiveScope }}</span>
        </div>
        <div class="dd-label">切换工作岗位</div>
        <button
          v-for="r in ROLES"
          :key="r.id"
          type="button"
          role="menuitem"
          class="dd-item"
          :class="{ selected: store.roleId === r.id }"
          @click="handleSwitchRole(r.id)"
        >
          <span>{{ r.name }}</span>
          <span style="font-size: 11px; opacity: 0.72">{{ r.scope }}</span>
        </button>
        <div class="dd-sep"></div>
        <div class="dd-label">界面配色预设</div>
        <button
          v-for="p in PRESETS"
          :key="p.id"
          type="button"
          role="menuitem"
          class="dd-item"
          :class="{ selected: store.preset === p.id }"
          @click="selectPreset(p.id, $event); dropdownOpen = false"
        >
          <span>{{ p.label }}</span>
          <span class="theme-swatch" :style="{ background: `linear-gradient(135deg,${p.sw1} 50%,${p.sw2} 50%)` }"></span>
        </button>
        <div class="dd-sep"></div>
        <button type="button" role="menuitem" class="dd-item" @click="goLogout">退出并返回统一身份登录页</button>
        <button type="button" role="menuitem" class="dd-item danger" @click="handleResetData">重置本地数据基线</button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.pg-stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
</style>
