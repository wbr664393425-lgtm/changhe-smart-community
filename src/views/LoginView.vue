<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  User,
  Lock,
  Eye,
  EyeOff,
  LoaderCircle,
  ChevronDown,
  CheckCircle2,
  Check,
  AlertCircle,
  ShieldCheck
} from 'lucide-vue-next'
import BrandLogo from '../components/BrandLogo.vue'
import CockpitClock from '../components/CockpitClock.vue'
import {
  store,
  ROLES,
  PRESETS,
  COMMUNITIES,
  getCurrentRole,
  switchRole,
  applyPreset,
  addAuditLog,
  showToast,
  markCockpitLoginHandoff
} from '../store/appStore'
import { SVG_W, SVG_H, CHANGHE_GEO_SVG as geoSvg } from '../utils/changheGeoSvg'

const router = useRouter()
const route = useRoute()

const selectedRoleId = ref(store.roleId || 'street_admin')
const showPwd = ref(false)
const submitting = ref(false)
const entered = ref(
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
)
const handoffPhase = ref('idle') // 'idle' | 'cockpit' | 'portal'

const username = ref('')
const password = ref('')
const authError = ref('')
const usernameInputRef = ref(null)
const passwordInputRef = ref(null)

// 实境测绘舆图交互与 FLIP 无缝转场引用
const geoSvgRef = ref(null)
const hoveredCommName = ref('')
const flipStyle = ref({})
let navTimer = null
let idlePrefetchTimer = null
let idlePrefetchId = null
let enterRaf1 = null
let enterRaf2 = null
let cockpitPrefetchPromise = null
let portalPrefetchPromise = null
let isDestroyed = false

function prefetchCockpitChunks() {
  if (!cockpitPrefetchPromise) {
    cockpitPrefetchPromise = Promise.all([
      import('./CockpitView.vue').catch(() => {}),
      import('../components/ChangheCity3D.vue').catch(() => {})
    ])
  }
  return cockpitPrefetchPromise
}

function prefetchPortalChunks() {
  if (!portalPrefetchPromise) {
    portalPrefetchPromise = import('./PortalView.vue').catch(() => {})
  }
  return portalPrefetchPromise
}

// 配色下拉浮层（顶层 Teleport 100% 不透明实色面）
const presetMenuOpen = ref(false)
const presetBtnEl = ref(null)
const presetMenuPos = ref({ top: 0, right: 0 })

const currentPreset = computed(() => PRESETS.find((p) => p.id === store.preset) || PRESETS[0])
const isDarkPreset = computed(() => store.preset === 'command-dark')

watch([username, password], () => {
  if (authError.value) authError.value = ''
})

// 岗位短称与精简部门（确保单格双行零截断）
const quickName = (r) => r.name.replace(/·.*$/, '')
const shortDept = (dept) =>
  String(dept || '')
    .replace(/^长河街道人民/, '')
    .replace(/^长河街道/, '')
    .replace(/^德馨社区/, '德馨')

const selectedRoleObj = computed(() => ROLES.find((r) => r.id === selectedRoleId.value) || ROLES[0])
const scopedCommunityName = computed(() => {
  const sc = selectedRoleObj.value?.scope || '全街道'
  return sc !== '全街道' ? sc : ''
})

// 14 社区按姓名索引真实底数
const communityMap = computed(() => {
  const m = new Map()
  COMMUNITIES.forEach((c) => m.set(c.name, c))
  return m
})

const activeFocusComm = computed(() => hoveredCommName.value || scopedCommunityName.value || '')

const mapCaption = computed(() => {
  const targetName = hoveredCommName.value || scopedCommunityName.value
  if (targetName) {
    const c = communityMap.value.get(targetName)
    if (c) {
      return `${c.name} · ${c.grids} 个责任网格 · ${c.pop.toLocaleString('zh-CN')} 常住人口`
    }
  }
  return '长河街道 14 社区 · 真实地理测绘疆域'
})

// 严格与驾驶舱口径一致的实时底数标尺
const stats = computed(() => {
  const pop = COMMUNITIES.reduce((a, c) => a + (c.pop || 0), 0)
  const branches = COMMUNITIES.reduce((a, c) => a + (c.branches?.length || 0), 0)
  const grids = COMMUNITIES.reduce((a, c) => a + (c.grids || 0), 0)
  const gridForce = COMMUNITIES.reduce((a, c) => a + (c.gridStaff || 0) + (c.publicPost || 0), 0)
  const homes = COMMUNITIES.reduce((a, c) => a + (c.housing?.homes || 0), 0)
  return [
    {
      key: 'c',
      label: '辖区社区',
      value: COMMUNITIES.length,
      unit: '个',
      sub: `${branches} 个基层支部`
    },
    {
      key: 'g',
      label: '责任网格',
      value: grids,
      unit: '个',
      sub: `${gridForce} 名网格力量`
    },
    {
      key: 'p',
      label: '常住人口',
      value: pop.toLocaleString('zh-CN'),
      unit: '人',
      sub: `${homes.toLocaleString('zh-CN')} 户实有房屋`
    }
  ]
})

function togglePresetMenu() {
  if (!presetMenuOpen.value && presetBtnEl.value) {
    const r = presetBtnEl.value.getBoundingClientRect()
    presetMenuPos.value = {
      top: Math.round(r.bottom + 6),
      right: Math.round(window.innerWidth - r.right)
    }
  }
  presetMenuOpen.value = !presetMenuOpen.value
}

function pickPreset(id, ev) {
  applyPreset(id, ev)
  presetMenuOpen.value = false
}

function onDocPointerDown(e) {
  if (!presetMenuOpen.value) return
  if (presetBtnEl.value?.contains(e.target) || e.target.closest?.('.lg-preset-menu')) return
  presetMenuOpen.value = false
}

function onDocKeydown(e) {
  if (e.key === 'Escape' && presetMenuOpen.value) {
    presetMenuOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown)
  document.addEventListener('keydown', onDocKeydown)
  if (!entered.value) {
    enterRaf1 = requestAnimationFrame(() => {
      enterRaf1 = null
      enterRaf2 = requestAnimationFrame(() => {
        enterRaf2 = null
        entered.value = true
      })
    })
  }
  // 浏览器空闲窗口静默预热驾驶舱分包，确保点击登录后无需等待 JS 拉取
  if (typeof requestIdleCallback === 'function') {
    idlePrefetchId = requestIdleCallback(() => {
      idlePrefetchId = null
      prefetchCockpitChunks()
    }, { timeout: 1400 })
  } else {
    idlePrefetchTimer = setTimeout(() => {
      idlePrefetchTimer = null
      prefetchCockpitChunks()
    }, 600)
  }
})

onBeforeUnmount(() => {
  isDestroyed = true
  document.removeEventListener('pointerdown', onDocPointerDown)
  document.removeEventListener('keydown', onDocKeydown)
  if (enterRaf1 !== null) {
    cancelAnimationFrame(enterRaf1)
    enterRaf1 = null
  }
  if (enterRaf2 !== null) {
    cancelAnimationFrame(enterRaf2)
    enterRaf2 = null
  }
  if (idlePrefetchId !== null && typeof cancelIdleCallback === 'function') {
    cancelIdleCallback(idlePrefetchId)
    idlePrefetchId = null
  }
  if (idlePrefetchTimer !== null) {
    clearTimeout(idlePrefetchTimer)
    idlePrefetchTimer = null
  }
  if (navTimer) {
    clearTimeout(navTimer)
    navTimer = null
  }
})

function resolveTargetPath(role) {
  const rawRedirect = typeof route.query?.redirect === 'string' ? route.query.redirect : ''
  if (rawRedirect.startsWith('/') && role.allowedRoutes.includes(rawRedirect.split('?')[0])) {
    return rawRedirect
  }
  return role.landingMode === 'leader' && role.allowedRoutes.includes('/cockpit') ? '/cockpit' : '/portal'
}

function doLogin() {
  if (submitting.value) return
  const u = username.value.trim()
  const p = password.value
  if (!u || !p) {
    authError.value = '请输入账号和登录口令'
    ;(!u ? usernameInputRef : passwordInputRef).value?.focus()
    return
  }
  if (u !== 'admin' || p !== 'admin888') {
    authError.value = '账号或登录口令不正确，请核对后重试'
    passwordInputRef.value?.focus()
    return
  }

  authError.value = ''
  submitting.value = true

  const nextRole = ROLES.find((r) => r.id === selectedRoleId.value) || getCurrentRole()
  const targetPath = resolveTargetPath(nextRole)
  const isCockpitTarget = targetPath.split('?')[0] === '/cockpit'
  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (isCockpitTarget) {
    const chunkReady = prefetchCockpitChunks()

    const svgEl = geoSvgRef.value
    const rect = svgEl?.getBoundingClientRect()
    const canFlip = !reducedMotion && rect && rect.width > 40 && window.innerWidth > 1100

    if (canFlip) {
      const targetW = Math.min(460, window.innerWidth * 0.88)
      const targetCx = window.innerWidth / 2
      const offsetY = window.innerWidth <= 640 ? 80 : 89
      const targetCy = window.innerHeight / 2 - offsetY
      const curCx = rect.left + rect.width / 2
      const curCy = rect.top + rect.height / 2
      const dx = targetCx - curCx
      const dy = targetCy - curCy
      const scale = targetW / rect.width

      flipStyle.value = {
        transform: `translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`
      }
      handoffPhase.value = 'cockpit'
    } else {
      handoffPhase.value = 'portal'
    }

    const delayMs = canFlip ? 430 : reducedMotion ? 90 : 220
    const animDone = new Promise((resolve) => {
      navTimer = setTimeout(() => {
        navTimer = null
        resolve()
      }, delayMs)
    })
    Promise.all([chunkReady, animDone]).then(() => {
      if (isDestroyed) return
      markCockpitLoginHandoff()
      store.loggedIn = true
      switchRole(selectedRoleId.value)
      addAuditLog('通过政务统一身份认证平台登录系统', '会话签发')
      router.push(targetPath)
    })
    return
  }

  // 普通岗位进门户：后台预热分包，干脆收束转场
  const portalReady = prefetchPortalChunks()
  handoffPhase.value = 'portal'
  const animDone = new Promise((resolve) => {
    navTimer = setTimeout(() => {
      navTimer = null
      resolve()
    }, reducedMotion ? 90 : 220)
  })
  Promise.all([portalReady, animDone]).then(() => {
    if (isDestroyed) return
    store.loggedIn = true
    switchRole(selectedRoleId.value)
    addAuditLog('通过政务统一身份认证平台登录系统', '会话签发')
    router.push(targetPath)
  })
}

function forgotPwd() {
  showToast('请联系街道党政综合办信息管理员重置登录口令')
}
</script>

<template>
  <div
    class="login-page"
    :class="{
      'is-entered': entered,
      'is-dark': isDarkPreset,
      'is-vermilion': store.preset === 'vermilion-seal' || !store.preset,
      'is-handoff-cockpit': handoffPhase === 'cockpit',
      'is-handoff-portal': handoffPhase === 'portal'
    }"
  >
    <!-- 承接光心渐变层：转场时平滑淡入，与 CockpitLoader 背景光心 1:1 融合（消除渐变硬跳） -->
    <div class="lg-handoff-bg" aria-hidden="true"></div>

    <!-- 四角测绘准星（与驾驶舱加载序幕 1:1 像素对齐，静息柔和、落印提亮） -->
    <div class="lg-frame" aria-hidden="true">
      <i class="lg-corner tl"></i>
      <i class="lg-corner tr"></i>
      <i class="lg-corner bl"></i>
      <i class="lg-corner br"></i>
    </div>

    <!-- 克制政务顶栏：2px 礼制细眉线 + 城徽平台名 + 配色下拉 + 时钟 -->
    <header class="lg-top">
      <div class="lg-brand">
        <BrandLogo :size="28" />
        <div class="lg-brand-text">
          <strong class="lg-brand-name">长河街道智慧社区综合治理平台</strong>
          <strong class="lg-brand-short">长河街道智慧社区</strong>
          <span class="lg-brand-sep" aria-hidden="true"></span>
          <span class="lg-brand-org">德州市天衢新区长河街道办事处</span>
        </div>
      </div>

      <div class="lg-top-tools">
        <button
          ref="presetBtnEl"
          type="button"
          class="lg-preset-trigger"
          :class="{ open: presetMenuOpen }"
          :aria-expanded="presetMenuOpen"
          aria-haspopup="listbox"
          title="切换配色方案"
          @click="togglePresetMenu"
        >
          <i :style="{ background: `linear-gradient(135deg, ${currentPreset.sw1} 52%, ${currentPreset.sw2} 52%)` }"></i>
          <span class="lg-preset-label">{{ currentPreset.label }}</span>
          <ChevronDown :size="13" class="lg-preset-caret" />
        </button>

        <Teleport to="body">
          <Transition name="lg-pop">
            <div
              v-if="presetMenuOpen"
              class="lg-preset-menu"
              role="listbox"
              aria-label="界面配色方案"
              :style="{ top: presetMenuPos.top + 'px', right: presetMenuPos.right + 'px' }"
            >
              <button
                v-for="p in PRESETS"
                :key="p.id"
                type="button"
                role="option"
                :aria-selected="store.preset === p.id"
                :class="{ active: store.preset === p.id }"
                @click="pickPreset(p.id, $event)"
              >
                <i :style="{ background: `linear-gradient(135deg, ${p.sw1} 52%, ${p.sw2} 52%)` }"></i>
                <span>{{ p.label }}</span>
                <CheckCircle2 v-if="store.preset === p.id" :size="13" />
              </button>
            </div>
          </Transition>
        </Teleport>

        <CockpitClock class="lg-clock" />
      </div>
    </header>

    <!-- 主舞台：左 60% 巨幅宣瓷测绘长卷 + 右 40% 雪瓷鉴印登录台 -->
    <main class="lg-main">
      <section class="lg-showcase" aria-label="辖区测绘舆图与底数">
        <div class="lg-headline">
          <h1 class="lg-ceremony-title">
            一印见底，<span class="lg-title-accent">全域闭环</span>
          </h1>
          <span class="lg-title-rule" aria-hidden="true"></span>
          <p class="lg-motto">人房企底数一库统管 · 网格事件闭环处置 · 基层报表一表通办</p>
        </div>

        <!-- 巨幅长河街道 104 顶点真实地理测绘舆图（与驾驶舱加载幕像素级同源） -->
        <div class="lg-map-stage">
          <svg
            ref="geoSvgRef"
            class="lg-geo-svg"
            :class="{ 'is-flipping': handoffPhase === 'cockpit' }"
            :style="flipStyle"
            :viewBox="`0 0 ${SVG_W} ${SVG_H}`"
            width="460"
            height="312"
            role="img"
            aria-label="长河街道十四社区实境测绘疆域图"
          >
            <defs>
              <linearGradient id="lgGeoTraceGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="var(--lg-map-stroke-a)" />
                <stop offset="56%" stop-color="var(--lg-map-stroke-b)" />
                <stop offset="100%" stop-color="var(--lg-map-stroke-c)" />
              </linearGradient>
              <radialGradient id="lgGeoFillGrad" cx="52%" cy="48%" r="58%">
                <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.12" />
                <stop offset="100%" stop-color="var(--lg-map-gold)" stop-opacity="0.02" />
              </radialGradient>
              <clipPath id="lgGeoOuterClip">
                <path :d="geoSvg.outerPath" />
              </clipPath>
            </defs>

            <!-- 建筑比例细基准线与同心测量弧（锚定街道指挥中心） -->
            <g class="lg-geo-axes" aria-hidden="true">
              <line :x1="geoSvg.hqPt[0]" y1="12" :x2="geoSvg.hqPt[0]" :y2="SVG_H - 12" />
              <line x1="20" :y1="geoSvg.hqPt[1]" :x2="SVG_W - 20" :y2="geoSvg.hqPt[1]" />
              <circle :cx="geoSvg.hqPt[0]" :cy="geoSvg.hqPt[1]" r="68" />
              <circle :cx="geoSvg.hqPt[0]" :cy="geoSvg.hqPt[1]" r="128" />
            </g>

            <!-- 街道疆域温润底影 -->
            <path :d="geoSvg.outerPath" class="lg-geo-base-fill" fill="url(#lgGeoFillGrad)" />

            <!-- 真实岔河与长河公园大湖水系（裁剪于街道疆域内） -->
            <g class="lg-geo-water" clip-path="url(#lgGeoOuterClip)" aria-hidden="true">
              <path
                v-for="(wp, idx) in geoSvg.waterPaths"
                :key="'lw-' + idx"
                :d="wp"
                class="lg-geo-water-poly"
              />
            </g>

            <!-- 14 社区真实界线板块（支持鼠标轻拂与岗位权责高亮联动） -->
            <g class="lg-geo-communities">
              <path
                v-for="comm in geoSvg.communities"
                :key="comm.name"
                :d="comm.path"
                class="lg-geo-comm-poly"
                :class="{
                  'is-hovered': hoveredCommName === comm.name,
                  'is-scoped': scopedCommunityName === comm.name,
                  'is-dimmed': scopedCommunityName && scopedCommunityName !== comm.name && hoveredCommName !== comm.name
                }"
                @mouseenter="hoveredCommName = comm.name"
                @mouseleave="hoveredCommName = ''"
              />
            </g>

            <!-- 仅当聚焦单一社区（悬停或单社区岗位）时于质心优雅浮现简称 -->
            <g v-if="activeFocusComm && handoffPhase === 'idle'" class="lg-geo-focus-label" aria-hidden="true">
              <template v-for="comm in geoSvg.communities" :key="'lbl-' + comm.name">
                <text
                  v-if="comm.name === activeFocusComm"
                  :x="comm.cx"
                  :y="comm.cy + 3"
                  text-anchor="middle"
                >
                  {{ comm.shortName }}
                </text>
              </template>
            </g>

            <!-- 104 顶点外轮廓底刻线 + 慢速朱金巡游笔迹（完全对应 CockpitLoader 外廓） -->
            <path :d="geoSvg.outerPath" class="lg-geo-outer-ghost" />
            <path
              :d="geoSvg.outerPath"
              pathLength="1000"
              class="lg-geo-outer-cruise"
              stroke="url(#lgGeoTraceGrad)"
            />

            <!-- 长河街道指挥中心印标 + 点击登录落印涟漪 -->
            <g
              class="lg-geo-hq"
              :class="{ 'is-rippling': handoffPhase === 'cockpit' }"
              :transform="`translate(${geoSvg.hqPt[0]}, ${geoSvg.hqPt[1]})`"
              aria-hidden="true"
            >
              <circle r="13" class="lg-geo-hq-ring" />
              <circle r="7.5" class="lg-geo-hq-inner-ring" />
              <circle r="10" class="lg-geo-hq-ripple" />
              <circle r="4" class="lg-geo-hq-core" />
            </g>
          </svg>

          <p class="lg-map-caption num" aria-live="polite">{{ mapCaption }}</p>
        </div>

        <!-- 无框素瓷三线底数标尺（零套娃卡片、零红金顶条） -->
        <ul class="lg-ruler" aria-label="辖区核心底数">
          <li v-for="s in stats" :key="s.key" class="lg-ruler-cell">
            <span class="lg-ruler-label">{{ s.label }}</span>
            <strong class="lg-ruler-val num">
              {{ s.value }}<small>{{ s.unit }}</small>
            </strong>
            <span class="lg-ruler-sub num">{{ s.sub }}</span>
          </li>
        </ul>
      </section>

      <!-- 右侧：全屏唯一实体雪瓷高阶登录台 -->
      <section class="auth" aria-labelledby="auth-title">
        <div class="auth-head">
          <h2 id="auth-title" class="auth-title">
            <i class="auth-title-bar" aria-hidden="true"></i>
            <span>账号登录</span>
          </h2>
        </div>

        <form class="auth-form" method="post" novalidate aria-labelledby="auth-title" @submit.prevent="doLogin">
          <div class="fld-group">
            <label class="fld-label" for="lg-username">政务账号</label>
            <div class="fld">
              <User :size="16" class="fld-ico" aria-hidden="true" />
              <input
                id="lg-username"
                ref="usernameInputRef"
                v-model="username"
                name="username"
                type="text"
                class="fld-input"
                autocomplete="username"
                autocorrect="off"
                autocapitalize="none"
                spellcheck="false"
                enterkeyhint="next"
                required
                :aria-invalid="Boolean(authError && !username.trim())"
                aria-describedby="lg-auth-error"
                placeholder="请输入政务统一账号"
              />
            </div>
          </div>

          <div class="fld-group">
            <div class="fld-label-row">
              <label class="fld-label" for="lg-password">登录口令</label>
              <button type="button" class="link-btn" @click="forgotPwd">忘记口令</button>
            </div>
            <div class="fld">
              <Lock :size="16" class="fld-ico" aria-hidden="true" />
              <input
                id="lg-password"
                ref="passwordInputRef"
                v-model="password"
                name="password"
                :type="showPwd ? 'text' : 'password'"
                class="fld-input with-right"
                autocomplete="current-password"
                enterkeyhint="done"
                required
                :aria-invalid="Boolean(authError)"
                aria-describedby="lg-auth-error"
                placeholder="请输入登录口令"
              />
              <button
                type="button"
                class="pwd-toggle"
                :aria-pressed="showPwd"
                :aria-label="showPwd ? '隐藏口令' : '显示口令'"
                @click="showPwd = !showPwd"
              >
                <EyeOff v-if="showPwd" :size="16" aria-hidden="true" />
                <Eye v-else :size="16" aria-hidden="true" />
              </button>
            </div>
          </div>

          <!-- 一体化 2×2 细线分段岗位网格（无套娃卡片、零独立投影） -->
          <fieldset class="roles-fieldset">
            <legend class="roles-legend">工作岗位</legend>
            <div class="role-grid">
              <label
                v-for="r in ROLES"
                :key="r.id"
                class="role-cell"
                :class="{ current: selectedRoleId === r.id, disabled: submitting }"
                :title="`${r.userName} · ${r.dept}`"
              >
                <input
                  v-model="selectedRoleId"
                  type="radio"
                  name="login-role"
                  class="visually-hidden"
                  :value="r.id"
                  :disabled="submitting"
                />
                <span class="role-name">{{ quickName(r) }}</span>
                <span class="role-meta">{{ r.userName }} · {{ shortDept(r.dept) }}</span>
                <span v-if="selectedRoleId === r.id" class="role-check" aria-hidden="true">
                  <Check :size="11" />
                </span>
              </label>
            </div>
          </fieldset>

          <p id="lg-auth-error" class="auth-error" role="alert">
            <AlertCircle v-if="authError" :size="14" aria-hidden="true" />
            <span>{{ authError }}</span>
          </p>

          <button type="submit" class="submit-btn" :disabled="submitting">
            <LoaderCircle v-if="submitting && handoffPhase === 'idle'" :size="18" class="spin" aria-hidden="true" />
            <span>{{ handoffPhase !== 'idle' ? '身份核验通过' : submitting ? '正在核验' : '登 录' }}</span>
          </button>
        </form>

        <div class="auth-foot">
          <ShieldCheck :size="14" aria-hidden="true" />
          <span>全栈国产信创底座 · 政务外网统一认证</span>
        </div>
      </section>
    </main>

    <!-- 移动端专属紧凑底数条（<= 1100px 显示，与单列登录卡同屏完成） -->
    <ul class="lg-mobile-ruler" aria-label="辖区核心底数">
      <li v-for="s in stats" :key="'m-' + s.key">
        <strong class="num">{{ s.value }}<small>{{ s.unit }}</small></strong>
        <span>{{ s.label }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.login-page {
  --lg-accent-gold: color-mix(in oklab, var(--primary) 52%, var(--ink-soft));
  --lg-bg-core: color-mix(in oklab, var(--surface) 74%, var(--stage));
  --lg-bg-edge: var(--stage);
  --lg-handoff-edge: var(--ck-frame, var(--stage));
  --lg-handoff-core: color-mix(in oklab, var(--ck-panel-solid, var(--surface)) 74%, var(--ck-frame, var(--stage)));
  --lg-map-stroke-a: var(--primary);
  --lg-map-stroke-b: color-mix(in oklab, var(--primary) 72%, var(--ink));
  --lg-map-stroke-c: color-mix(in oklab, var(--primary) 46%, var(--lg-accent-gold));
  --lg-map-gold: var(--lg-accent-gold);
  --lg-water-fill: rgba(45, 122, 134, 0.16);
  --lg-water-stroke: rgba(45, 122, 134, 0.34);

  position: relative;
  height: 100dvh;
  min-height: 620px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  background: radial-gradient(circle at 38% 46%, var(--lg-bg-core) 0%, var(--lg-bg-edge) 74%);
  color: var(--ink);
  accent-color: var(--primary);
  isolation: isolate;
}

.login-page.is-vermilion {
  --lg-accent-gold: #b58d42;
  --lg-map-stroke-c: color-mix(in oklab, var(--primary) 42%, #d8ae58);
}

.login-page.is-dark {
  --lg-bg-core: color-mix(in oklab, var(--surface) 84%, var(--stage));
  --lg-bg-edge: var(--stage);
  --lg-handoff-edge: var(--ck-frame, #090e14);
  --lg-handoff-core: color-mix(in oklab, var(--ck-panel-solid, #151f2d) 86%, var(--ck-frame, #090e14));
  --lg-accent-gold: #4fd3f2;
  --lg-map-stroke-a: var(--primary);
  --lg-map-stroke-b: #6ea8ff;
  --lg-map-stroke-c: #73e4ff;
  --lg-water-fill: rgba(78, 174, 196, 0.2);
  --lg-water-stroke: rgba(112, 204, 224, 0.36);
}

.lg-handoff-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: 0;
  background: radial-gradient(circle at 50% 42%, var(--lg-handoff-core) 0%, var(--lg-handoff-edge) 74%);
  transition: opacity 0.36s cubic-bezier(0.22, 1, 0.36, 1);
}

.login-page.is-handoff-cockpit .lg-handoff-bg {
  opacity: 1;
}

.login-page ::selection {
  background: color-mix(in oklab, var(--primary) 18%, transparent);
  color: var(--ink);
}

/* ── 四角测绘准星（与 CockpitLoader.vue 像素对齐） ── */
.lg-frame {
  position: absolute;
  inset: 22px;
  pointer-events: none;
  z-index: 1;
  opacity: 0.48;
  transition: opacity 0.28s var(--ease-premium, cubic-bezier(0.16, 1, 0.3, 1));
}

.login-page.is-handoff-cockpit .lg-frame {
  opacity: 1;
}

.lg-corner {
  position: absolute;
  width: 24px;
  height: 24px;
  border-color: color-mix(in oklab, var(--lg-map-stroke-b) 44%, var(--line));
  border-style: solid;
  border-width: 0;
}

.lg-corner.tl { top: 0; left: 0; border-top-width: 1.5px; border-left-width: 1.5px; }
.lg-corner.tr { top: 0; right: 0; border-top-width: 1.5px; border-right-width: 1.5px; }
.lg-corner.bl { bottom: 0; left: 0; border-bottom-width: 1.5px; border-left-width: 1.5px; }
.lg-corner.br { bottom: 0; right: 0; border-bottom-width: 1.5px; border-right-width: 1.5px; }

/* ── 克制政务顶栏 ── */
.lg-top {
  position: relative;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 56px;
  padding: 0 36px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in oklab, var(--surface) 76%, var(--stage));
  transition: opacity 0.24s var(--ease-premium, cubic-bezier(0.16, 1, 0.3, 1)),
    transform 0.24s var(--ease-premium, cubic-bezier(0.16, 1, 0.3, 1));
}

.lg-top::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent 0%, var(--primary) 24%, var(--lg-accent-gold) 50%, var(--primary) 76%, transparent 100%);
}

.lg-brand {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}

.lg-brand-text {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.lg-brand-name,
.lg-brand-short {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--ink);
  white-space: nowrap;
}

.lg-brand-short {
  display: none;
}

.lg-brand-sep {
  width: 1px;
  height: 14px;
  background: var(--line-strong);
  flex-shrink: 0;
}

.lg-brand-org {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-muted);
  white-space: nowrap;
}

.lg-top-tools {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
}

.lg-preset-trigger {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 10px 0 8px;
  border-radius: var(--r-control, 6px);
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--ink-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.16s ease, color 0.16s ease;
}

.lg-preset-trigger:hover,
.lg-preset-trigger.open {
  color: var(--ink);
  border-color: color-mix(in oklab, var(--primary) 45%, var(--line-strong));
}

.lg-preset-trigger:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.lg-preset-trigger i {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 1.5px var(--surface), 0 0 0 2.5px color-mix(in oklab, var(--primary) 42%, transparent);
}

.lg-preset-caret {
  transition: transform 0.18s ease;
}

.lg-preset-trigger.open .lg-preset-caret {
  transform: rotate(180deg);
}

.lg-clock {
  border-right: 0 !important;
  padding-right: 0 !important;
}

.lg-clock :deep(strong) {
  color: var(--ink);
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}

.lg-clock :deep(span) {
  color: var(--ink-faint);
}

/* ── 主舞台（1360px 收束居中，左 60% 宣卷舆图 + 右 40% 雪瓷鉴印台） ── */
.lg-main {
  position: relative;
  z-index: 2;
  width: min(1360px, 100%);
  margin: 0 auto;
  padding: 20px clamp(28px, 4vw, 56px) 28px;
  display: grid;
  grid-template-columns: minmax(0, 1.38fr) 404px;
  align-items: center;
  gap: clamp(28px, 4.5vw, 72px);
  min-height: 0;
}

/* ── 左区：无框宣纸长卷三段纵排（改用 transition 入场，避免 animation-fill-mode: both 锁死退场） ── */
.lg-showcase {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 18px;
  align-content: center;
  min-width: 0;
  max-height: 100%;
  transition: opacity 0.38s var(--ease-premium, cubic-bezier(0.16, 1, 0.3, 1)),
    transform 0.38s var(--ease-premium, cubic-bezier(0.16, 1, 0.3, 1));
}

.login-page:not(.is-entered) .lg-showcase {
  opacity: 0;
  transform: translate3d(0, 10px, 0);
}

.lg-headline {
  display: grid;
  gap: 8px;
  transition: opacity 0.24s var(--ease-premium, cubic-bezier(0.16, 1, 0.3, 1)),
    transform 0.24s var(--ease-premium, cubic-bezier(0.16, 1, 0.3, 1));
}

.lg-ceremony-title {
  margin: 0;
  font-family: var(--font-ceremony, var(--font-sans));
  font-size: 36px;
  font-weight: 700;
  line-height: 1.18;
  letter-spacing: 0.04em;
  color: var(--ink);
}

.lg-title-accent {
  color: var(--primary);
}

.lg-title-rule {
  display: block;
  width: 44px;
  height: 2px;
  border-radius: 1px;
  background: linear-gradient(90deg, var(--primary), var(--lg-accent-gold));
}

.lg-motto {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.5;
  letter-spacing: 0.03em;
  color: var(--ink-muted);
}

/* ── 中段：巨幅长河街道实境测绘舆图 ── */
.lg-map-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 0;
  padding: 4px 0;
}

.lg-geo-svg {
  width: min(560px, 100%);
  max-height: 44dvh;
  height: auto;
  display: block;
  overflow: visible;
  will-change: transform;
  transform-origin: center center;
}

.lg-geo-svg.is-flipping {
  position: relative;
  z-index: 30;
  transition: transform 0.38s cubic-bezier(0.22, 1, 0.36, 1) 0.03s;
}

.lg-geo-axes line {
  stroke: var(--line);
  stroke-width: 0.75;
  stroke-dasharray: 2 4;
}

.lg-geo-axes circle {
  fill: none;
  stroke: color-mix(in oklab, var(--ink-faint) 18%, transparent);
  stroke-width: 0.75;
  stroke-dasharray: 3 5;
  transition: opacity 0.2s ease;
}

.lg-geo-svg.is-flipping .lg-geo-axes circle {
  opacity: 0;
}

.lg-geo-water {
  transition: opacity 0.32s ease;
}

.lg-geo-svg.is-flipping .lg-geo-water {
  opacity: 0.42;
}

.lg-geo-water-poly {
  fill: var(--lg-water-fill);
  stroke: var(--lg-water-stroke);
  stroke-width: 0.9;
}

.lg-geo-comm-poly {
  fill: color-mix(in oklab, var(--surface) 42%, transparent);
  stroke: color-mix(in oklab, var(--ink-muted) 22%, transparent);
  stroke-width: 0.85;
  stroke-linejoin: round;
  cursor: pointer;
  transition: fill 0.22s ease, stroke 0.22s ease, stroke-width 0.22s ease, opacity 0.22s ease;
}

.lg-geo-comm-poly.is-scoped {
  fill: color-mix(in oklab, var(--primary) 13%, var(--surface));
  stroke: color-mix(in oklab, var(--primary) 65%, transparent);
  stroke-width: 1.25;
}

.lg-geo-comm-poly.is-hovered {
  fill: color-mix(in oklab, var(--primary) 17%, var(--surface));
  stroke: var(--primary);
  stroke-width: 1.4;
}

.lg-geo-comm-poly.is-dimmed {
  opacity: 0.45;
}

.lg-geo-svg.is-flipping .lg-geo-comm-poly {
  fill: transparent;
  stroke: color-mix(in oklab, var(--ink-faint) 24%, transparent);
  stroke-width: 0.7;
  opacity: 1;
}

.lg-geo-focus-label text {
  font-size: 10.5px;
  font-weight: 700;
  fill: var(--ink);
  letter-spacing: 0.04em;
  paint-order: stroke;
  stroke: var(--surface);
  stroke-width: 3px;
  stroke-linejoin: round;
  pointer-events: none;
}

.lg-geo-outer-ghost {
  fill: none;
  stroke: color-mix(in oklab, var(--ink-muted) 20%, transparent);
  stroke-width: 1.15;
  stroke-linejoin: round;
}

.lg-geo-outer-cruise {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 220 780;
  stroke-dashoffset: 1000;
  animation: lg-cruise 14s linear infinite;
  transition: opacity 0.2s ease;
}

.lg-geo-svg.is-flipping .lg-geo-outer-cruise {
  opacity: 0;
}

@keyframes lg-cruise {
  from { stroke-dashoffset: 1000; }
  to { stroke-dashoffset: 0; }
}

.lg-geo-hq {
  transition: opacity 0.3s ease;
}

.lg-geo-svg.is-flipping .lg-geo-hq {
  opacity: 0.45;
}

.lg-geo-hq-ring {
  fill: none;
  stroke: var(--primary);
  stroke-width: 1.1;
  opacity: 0.42;
  animation: lg-hq-breathe 3.6s ease-in-out infinite;
  transition: opacity 0.2s ease;
}

.lg-geo-svg.is-flipping .lg-geo-hq-ring {
  opacity: 0;
}

.lg-geo-hq-inner-ring {
  fill: var(--surface);
  stroke: color-mix(in oklab, var(--lg-accent-gold) 75%, var(--primary));
  stroke-width: 1.1;
}

.lg-geo-hq-core {
  fill: var(--primary);
}

.lg-geo-hq-ripple {
  fill: none;
  stroke: var(--primary);
  stroke-width: 1.6;
  opacity: 0;
  transform-box: fill-box;
  transform-origin: center;
}

.lg-geo-hq.is-rippling .lg-geo-hq-ripple {
  animation: lg-seal-ripple 0.48s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

@keyframes lg-hq-breathe {
  0%, 100% { opacity: 0.42; transform: scale(1); }
  50% { opacity: 0.16; transform: scale(1.16); }
}

@keyframes lg-seal-ripple {
  0% { opacity: 0.92; transform: scale(0.9); }
  100% { opacity: 0; transform: scale(3.2); }
}

.lg-map-caption {
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-soft);
  letter-spacing: 0.03em;
  transition: opacity 0.2s ease;
}

/* ── 下段：无框素瓷三线底数标尺（零卡片套娃、零顶红条） ── */
.lg-ruler {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
  padding: 14px 0 0;
  list-style: none;
  border-top: 1.5px solid var(--ink);
  transition: opacity 0.24s var(--ease-premium, cubic-bezier(0.16, 1, 0.3, 1)),
    transform 0.24s var(--ease-premium, cubic-bezier(0.16, 1, 0.3, 1));
}

.login-page.is-dark .lg-ruler {
  border-top: 1px solid var(--line-strong);
}

.lg-ruler-cell {
  position: relative;
  display: grid;
  gap: 2px;
  padding: 0 18px 0 0;
}

.lg-ruler-cell + .lg-ruler-cell {
  padding-left: 18px;
}

.lg-ruler-cell + .lg-ruler-cell::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 1px;
  background: var(--line);
}

.lg-ruler-label {
  font-size: 12px;
  color: var(--ink-soft);
  white-space: nowrap;
}

.lg-ruler-val {
  font-size: 24px;
  line-height: 1.12;
  font-weight: 700;
  color: var(--ink);
  font-variant-numeric: tabular-nums lining-nums;
  white-space: nowrap;
}

.lg-ruler-val small {
  margin-left: 3px;
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-muted);
}

.lg-ruler-sub {
  font-size: 11.5px;
  color: var(--ink-faint);
  white-space: nowrap;
}

/* ── 右侧：全屏唯一实体高阶登录台（改用 transition 入场，让退场不被 animation fill-mode 锁死） ── */
.auth {
  position: relative;
  width: 100%;
  padding: 24px 28px 20px;
  border-radius: var(--r-card, 12px);
  background: var(--surface);
  border: 1px solid var(--line-strong);
  box-shadow: var(--e2), var(--edge);
  transition: opacity 0.38s var(--ease-premium, cubic-bezier(0.16, 1, 0.3, 1)) 0.05s,
    transform 0.38s var(--ease-premium, cubic-bezier(0.16, 1, 0.3, 1)) 0.05s;
}

.login-page:not(.is-entered) .auth {
  opacity: 0;
  transform: translate3d(0, 10px, 0);
}

.auth-head {
  padding-bottom: 14px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--line);
}

.auth-title {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 20px;
  font-weight: 700;
  line-height: 1.25;
  color: var(--ink);
  letter-spacing: 0.02em;
}

.auth-title-bar {
  width: 3px;
  height: 18px;
  border-radius: 2px;
  background: var(--primary);
  flex-shrink: 0;
}

/* ── 表单控件（严格对齐 modern-web-guidance + 全站公共令牌） ── */
.auth-form {
  display: grid;
  gap: 13px;
}

.fld-group {
  display: grid;
  gap: 6px;
}

.fld-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.fld-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-muted);
}

.link-btn {
  border: 0;
  padding: 2px 0;
  background: transparent;
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--brand-text);
  cursor: pointer;
}

.link-btn:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.link-btn:focus-visible {
  outline: 2px solid var(--focus, var(--primary));
  outline-offset: 2px;
  border-radius: 3px;
}

.fld {
  position: relative;
  display: flex;
  align-items: center;
}

.fld-ico {
  position: absolute;
  left: 13px;
  color: var(--ink-faint);
  pointer-events: none;
}

.fld-input {
  width: 100%;
  height: 42px;
  padding: 0 14px 0 39px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-control, 6px);
  background: var(--sunken);
  font: inherit;
  font-size: 14px;
  color: var(--ink);
  caret-color: var(--primary);
  transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
}

.fld-input::placeholder {
  color: var(--ink-faint);
}

.fld-input:hover {
  border-color: var(--control-line, var(--line-strong));
}

.fld-input:focus-visible {
  outline: none;
  border-color: var(--primary);
  background: var(--surface);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--primary) 14%, transparent);
}

.fld-input[aria-invalid='true'] {
  border-color: var(--status-bad);
}

.fld-input.with-right {
  padding-right: 44px;
}

.pwd-toggle {
  position: absolute;
  right: 5px;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--ink-faint);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.pwd-toggle:hover {
  color: var(--ink);
  background: var(--state-hover);
}

.pwd-toggle:focus-visible {
  outline: 2px solid var(--focus, var(--primary));
  outline-offset: 1px;
}

/* 一体化 2×2 细线分段岗位网格（零套娃卡片） */
.roles-fieldset {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}

.roles-legend {
  padding: 0;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-muted);
}

.role-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-control, 6px);
  background: var(--sunken);
  overflow: hidden;
}

.visually-hidden {
  position: absolute;
  clip-path: inset(50%);
  overflow: hidden;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  white-space: nowrap;
}

.role-cell {
  position: relative;
  display: grid;
  align-content: center;
  gap: 2px;
  min-height: 44px;
  padding: 6px 22px 6px 12px;
  background: transparent;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.role-cell:nth-child(2n) {
  border-left: 1px solid var(--line);
}

.role-cell:nth-child(n + 3) {
  border-top: 1px solid var(--line);
}

.role-cell:hover:not(.disabled):not(.current) {
  background: color-mix(in oklab, var(--surface) 64%, var(--sunken));
}

.role-cell.current {
  background: color-mix(in oklab, var(--primary) 8%, var(--surface));
  box-shadow: inset 3px 0 0 var(--primary);
}

.role-cell:has(input:focus-visible) {
  outline: 2px solid var(--focus, var(--primary));
  outline-offset: -2px;
  z-index: 1;
}

.role-cell.disabled {
  cursor: progress;
  opacity: 0.85;
}

.role-name {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.25;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.role-cell.current .role-name {
  color: var(--brand-text);
}

.role-meta {
  font-size: 11px;
  line-height: 1.2;
  color: var(--ink-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.role-check {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--primary);
  color: var(--on-primary, #ffffff);
}

/* 错误区固定预留高度防跳动 */
.auth-error {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 20px;
  margin: -3px 0;
  font-size: 12.5px;
  line-height: 20px;
  color: var(--status-bad);
}

.submit-btn {
  width: 100%;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: var(--r-control, 6px);
  background: var(--primary);
  color: var(--on-primary, #ffffff);
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.14em;
  box-shadow: var(--e-accent);
  cursor: pointer;
  transition: background-color 0.15s ease, transform 0.09s ease;
}

.submit-btn:hover:not(:disabled) {
  background: var(--primary-hover);
}

.submit-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.submit-btn:focus-visible {
  outline: 2px solid var(--focus, var(--primary));
  outline-offset: 2px;
}

.submit-btn:disabled {
  cursor: progress;
  opacity: 0.9;
}

.spin {
  animation: lg-spin 0.9s linear infinite;
}

@keyframes lg-spin {
  to {
    transform: rotate(360deg);
  }
}

.auth-foot {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-faint);
}

.auth-foot svg {
  color: var(--primary);
  flex-shrink: 0;
}

/* ── 无缝转场编排：进驾驶舱时外围 240ms 清场退场，疆域 SVG 30ms 后丝滑 FLIP 归中 ── */
.login-page.is-handoff-cockpit .lg-top {
  opacity: 0;
  transform: translate3d(0, -14px, 0);
  transition-duration: 0.24s;
  transition-delay: 0s;
  pointer-events: none;
}

.login-page.is-handoff-cockpit .auth {
  opacity: 0;
  transform: translate3d(26px, 0, 0) scale(0.985);
  transition: opacity 0.24s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.24s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.login-page.is-handoff-cockpit .lg-headline,
.login-page.is-handoff-cockpit .lg-ruler,
.login-page.is-handoff-cockpit .lg-map-caption {
  opacity: 0;
  transform: translate3d(0, 14px, 0);
  transition-duration: 0.22s;
  transition-delay: 0s;
  pointer-events: none;
}

.login-page.is-handoff-portal .lg-main,
.login-page.is-handoff-portal .lg-top,
.login-page.is-handoff-portal .lg-mobile-ruler {
  opacity: 0;
  transform: scale(0.992);
  transition: opacity 0.18s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

/* 移动端底数条（桌面端默认隐藏） */
.lg-mobile-ruler {
  display: none;
}

/* ── 响应式适配 ── */
@media (max-width: 1440px) {
  .lg-main {
    grid-template-columns: minmax(0, 1.32fr) 392px;
    gap: 32px;
    padding: 16px 32px 22px;
  }
  .lg-ceremony-title {
    font-size: 30px;
  }
  .lg-geo-svg {
    width: min(490px, 100%);
    max-height: 41dvh;
  }
  .lg-ruler-val {
    font-size: 21px;
  }
  .auth {
    padding: 20px 24px 18px;
  }
}

@media (max-height: 790px) {
  .lg-top {
    height: 50px;
  }
  .lg-main {
    padding: 12px 32px 16px;
  }
  .lg-showcase {
    gap: 12px;
  }
  .lg-ceremony-title {
    font-size: 28px;
  }
  .lg-geo-svg {
    max-height: 39dvh;
  }
  .lg-ruler {
    padding-top: 10px;
  }
  .lg-ruler-val {
    font-size: 20px;
  }
  .auth {
    padding: 18px 24px 16px;
  }
  .auth-head {
    padding-bottom: 10px;
    margin-bottom: 12px;
  }
  .auth-form {
    gap: 10px;
  }
  .fld-input {
    height: 40px;
  }
  .role-cell {
    min-height: 40px;
  }
  .submit-btn {
    height: 42px;
  }
  .auth-foot {
    margin-top: 10px;
    padding-top: 10px;
  }
}

@media (max-width: 1180px) {
  .lg-brand-sep,
  .lg-brand-org {
    display: none;
  }
}

@media (max-width: 1100px) {
  .login-page {
    height: auto;
    min-height: 100dvh;
    grid-template-rows: auto auto minmax(0, 1fr);
    overflow: clip;
  }
  .lg-top {
    padding: 0 18px;
  }
  .lg-main {
    grid-template-columns: 1fr;
    justify-items: center;
    align-content: center;
    padding: 14px 16px 24px;
    gap: 0;
  }
  .lg-showcase {
    display: none;
  }
  .lg-mobile-ruler {
    grid-row: 2;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    width: min(412px, calc(100% - 32px));
    margin: 14px auto 0;
    padding: 10px 0 8px;
    list-style: none;
    border-top: 1.5px solid var(--ink);
    border-bottom: 1px solid var(--line);
    text-align: center;
  }
  .login-page.is-dark .lg-mobile-ruler {
    border-top-color: var(--line-strong);
  }
  .lg-mobile-ruler li {
    display: grid;
    gap: 2px;
  }
  .lg-mobile-ruler strong {
    font-size: 16px;
    font-weight: 700;
    color: var(--ink);
    font-variant-numeric: tabular-nums lining-nums;
  }
  .lg-mobile-ruler small {
    margin-left: 2px;
    font-size: 11px;
    font-weight: 500;
    color: var(--ink-muted);
  }
  .lg-mobile-ruler span {
    font-size: 11px;
    color: var(--ink-faint);
  }
  .auth {
    width: min(412px, 100%);
  }
}

@media (max-width: 640px) {
  .lg-frame {
    inset: 12px;
  }
  .lg-top {
    height: 48px;
    padding: 0 14px;
  }
  .lg-brand-name {
    display: none;
  }
  .lg-brand-short {
    display: inline;
    font-size: 14px;
  }
  .lg-preset-label,
  .lg-clock {
    display: none;
  }
  .lg-preset-trigger {
    padding: 0 8px;
    gap: 5px;
  }
  .auth {
    padding: 18px 18px 16px;
  }
  .fld-input {
    height: 44px;
    font-size: 16px;
  }
  .submit-btn {
    height: 46px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .lg-geo-outer-cruise,
  .lg-geo-hq-ring,
  .lg-geo-hq.is-rippling .lg-geo-hq-ripple {
    animation: none;
  }
  .lg-handoff-bg,
  .lg-frame,
  .lg-top,
  .lg-showcase,
  .lg-headline,
  .lg-ruler,
  .auth,
  .lg-geo-svg.is-flipping {
    transition: none;
  }
}

@media (forced-colors: active) {
  .auth,
  .role-grid,
  .lg-preset-trigger,
  .fld-input,
  .submit-btn {
    border: 1px solid CanvasText;
  }
  .role-cell.current {
    outline: 2px solid Highlight;
    outline-offset: -2px;
  }
}
</style>

<!-- 顶层 Teleport 配色下拉浮层（100% 不透明实色面，消费全站主题令牌） -->
<style>
.lg-preset-menu {
  position: fixed;
  z-index: 3000;
  min-width: 176px;
  padding: 5px;
  display: grid;
  gap: 2px;
  border-radius: var(--r-card, 10px);
  border: 1px solid var(--line-strong);
  background: var(--surface);
  box-shadow: var(--e3);
}

.lg-preset-menu button {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) 14px;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.lg-preset-menu button:hover {
  background: var(--state-hover);
}

.lg-preset-menu button.active {
  color: var(--brand-text);
  background: var(--primary-soft);
}

.lg-preset-menu button i {
  width: 14px;
  height: 14px;
  border-radius: 50%;
}

.lg-preset-menu button span {
  white-space: nowrap;
}

.lg-pop-enter-active,
.lg-pop-leave-active {
  transition: opacity 0.16s ease, transform 0.16s cubic-bezier(0.22, 1, 0.36, 1);
}

.lg-pop-enter-from,
.lg-pop-leave-to {
  opacity: 0;
  transform: translate3d(0, -4px, 0);
}
</style>
