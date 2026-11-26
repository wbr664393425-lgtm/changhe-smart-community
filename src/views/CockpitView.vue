<script>
// 会话级标记：浏览器当前会话首次进入大屏时展示完整疆域进度序幕；从工作台等子页二次切回跳过进度页直进三幕动画
let cockpitSessionCurtainShown = false
</script>

<script setup>
import { ref, shallowRef, computed, defineAsyncComponent, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import {
  Sun, Moon, Play, Pause, Maximize2, ArrowRight, Bell, Send, ChevronDown,
  Users, Flag, Building2, Briefcase, AlertTriangle, CheckCircle2, ChevronRight, ChevronLeft, X,
  Search, PanelLeftClose, PanelLeftOpen, Navigation
} from 'lucide-vue-next'
import BrandLogo from '../components/BrandLogo.vue'
import CockpitLoader from '../components/CockpitLoader.vue'
import CockpitClock from '../components/CockpitClock.vue'
import EvidencePhoto from '../components/EvidencePhoto.vue'
import BuildingProfilePanel from '../components/BuildingProfilePanel.vue'
import {
  store, PRESETS, COMMUNITIES, EVENT_CATEGORIES, getCurrentRole, getEffectiveCommunity, getVisibleCommunities,
  applyPreset, runThemeViewTransition, showToast, addAuditLog, nowStr, consumeCockpitLoginHandoff
} from '../store/appStore'
import { buildScenePhoto } from '../utils/sampleImages'

// 重型 3D / 2D / 抽屉 / 检索弹窗按需异步分包，让全屏加载序幕首绘零阻塞；楼栋档案直连导入避免点击瞬白
const ChangheCity3D = defineAsyncComponent(() => import('../components/ChangheCity3D.vue'))
const GeoMap = defineAsyncComponent(() => import('../components/GeoMap.vue'))
const DrilldownDrawer = defineAsyncComponent(() => import('../components/DrilldownDrawer.vue'))
const SpatialSearchModal = defineAsyncComponent(() => import('../components/SpatialSearchModal.vue'))

// 纯算术经纬度投影，避免在 CockpitView 首屏引入含 Three.js 的 cityModelCache
const _ORIGIN_LAT = 37.4408
const _ORIGIN_LNG = 116.3472
const _M_PER_LAT = 111320
const _M_PER_LNG = 111320 * Math.cos((_ORIGIN_LAT * Math.PI) / 180)
function latLngToWorldXZ(lat, lng) {
  return [((lng - _ORIGIN_LNG) * _M_PER_LNG) / 10, -((lat - _ORIGIN_LAT) * _M_PER_LAT) / 10]
}

// 异步按需载入楼栋空间索引模块，避免 519KB+ 地理 JSON 阻塞首屏解析
const bldgIdxMod = shallowRef(null)
let bldgIdxModPromise = null
function loadBldgIdxMod() {
  if (bldgIdxMod.value) return Promise.resolve(bldgIdxMod.value)
  if (!bldgIdxModPromise) {
    bldgIdxModPromise = import('../utils/cockpitBuildingIndex')
      .then((mod) => {
        bldgIdxMod.value = mod
        return mod
      })
      .catch((err) => {
        bldgIdxModPromise = null
        throw err
      })
  }
  return bldgIdxModPromise
}

const NARROW_PANEL_TABS = [
  { key: 'map', label: '地图' },
  { key: 'data', label: '辖区数据' },
  { key: 'events', label: '治理事项' }
]

const router = useRouter()

// 一屏双态（汇报叙事态 / 日常调度态）+ 14 社区治理体感带 + 全量真实汇总看板
const viewMode = ref('report') // report | dispatch
const activeChapter = ref(0)
const activeSlice = ref('safety')
const narrowPanel = ref('map')
const mobileCommOpen = ref(false)
const previewPose = ref('hero')
const previewRoot = import.meta.env.BASE_URL + 'model-previews/'
const previewViews = { hero: '全景鸟瞰', park: '长河公园', bridge: '岔河桥景' }
const mapBase = ref('city3d') // city3d（三维社区沙盘·默认） | gov（政务平面图） | aerial（卫星影像） | street（电子路网）
const city3dMounted = ref(true) // 首次懒挂载后切平面图用 v-show 保活，避免销毁重建 WebGL 上下文
const hoveredComm = ref('')
const selectedEvent = ref(null)
const selectedBuildingIndex = ref(-1)
const selectedEntity = shallowRef(null)
const focusedFloor = shallowRef(null)
const radiusActive = ref(false)
const aidTick = ref(0)
const activeCategoryFilter = ref('')
const rightFootTab = ref('police') // police | armed
const tourRunning = ref(false)
const searchOpen = ref(false)
const staffLayerActive = ref(false)
const staffDirectoryOpen = ref(false)
const staffSearch = ref('')
const staffStatusFilter = ref('all')
const STAFF_FILTERS = [
  { status: 'all', label: '全员', key: 'total', tone: 'var(--ck-ink)' },
  { status: '在岗巡查', label: '巡查', key: 'patrol', tone: 'var(--ck-ok)' },
  { status: '在办处置', label: '处置', key: 'handling', tone: 'var(--ck-run)' },
  { status: '滞留提醒', label: '滞留', key: 'alert', tone: 'var(--ck-danger)' }
]
const liveStaffList = shallowRef([])
const staffRosterReady = ref(false)
let staffEngine = null
const followStaffId = ref('')
const followAltitude = ref('low') // low | mid
const dashboardTheater = ref(false)
const followTheater = ref(true)
// 随航默认让出两侧街景；退出时回到进入前的面板布局。
const theaterMode = computed({
  get: () => followStaffId.value ? followTheater.value : dashboardTheater.value,
  set: (wide) => {
    if (followStaffId.value) followTheater.value = wide
    else dashboardTheater.value = wide
  }
})
const activeStaffTelemetry = shallowRef(null)
const hoveredPopSeg = ref('') // '' | 'youth' | 'elder' | 'teen'
const hoveredTrendIdx = ref(-1)
let tourTimer = null
let isViewUnmounted = false

// ── 大屏全屏资源加载序幕 & 电影级三幕渐进入场编排 ──
const city3dRef = ref(null)
const geoMapRef = ref(null)
const fromLoginHandoff = consumeCockpitLoginHandoff()
const isFirstSessionEntry = !cockpitSessionCurtainShown || fromLoginHandoff
const loaderVisible = ref(isFirstSessionEntry)
const loaderTargetProgress = ref(isFirstSessionEntry ? (fromLoginHandoff ? 2 : 4) : 100)
const loaderSceneReady = ref(false)
const loaderFallbackNotice = ref('')
const entrancePhase = ref('pre') // pre | revealing | ready
const city3dLabelsVisible = ref(false)
const countUpFactor = ref(0)
const chartSweepFactor = ref(0)

let revealTriggered = false
let countUpRafId = null
let watchdogTimer = null
let revisitSafetyTimer = null
let revealTimers = []
let prefersReducedMotion = false

const MIN_CURTAIN_MS = 3000
const CURTAIN_HOLD_MS = 460
const LOAD_TIMEOUT_MS = 16000
const TOUR_MS = 7800

// 配色方案下拉（顶层挂载实色浮层）
const presetMenuOpen = ref(false)
const presetBtnEl = ref(null)
const presetMenuPos = ref({ top: 0, right: 0 })
const currentPreset = computed(() => PRESETS.find((p) => p.id === store.preset) || PRESETS[0])
function togglePresetMenu() {
  if (!presetMenuOpen.value && presetBtnEl.value) {
    const r = presetBtnEl.value.getBoundingClientRect()
    presetMenuPos.value = { top: Math.round(r.bottom + 6), right: Math.round(window.innerWidth - r.right) }
  }
  presetMenuOpen.value = !presetMenuOpen.value
}
function pickPreset(id, ev) {
  applyPreset(id, ev)
  presetMenuOpen.value = false
}
function onDocPointerDown(e) {
  if (!presetMenuOpen.value) return
  if (presetBtnEl.value?.contains(e.target) || e.target.closest?.('.ck-preset-menu')) return
  presetMenuOpen.value = false
}
function onDocKeydown(e) {
  if (e.key === 'Escape') {
    if (searchOpen.value) {
      searchOpen.value = false
      return
    }
    if (followStaffId.value) {
      followStaffId.value = ''
      return
    }
    if (staffDirectoryOpen.value) {
      if (selectedEntity.value?.entityType === 'staff') closeRightPenetration()
      else closeStaffDirectory()
      return
    }
    if (presetMenuOpen.value || mobileCommOpen.value) {
      presetMenuOpen.value = false
      mobileCommOpen.value = false
      return
    }
    if (theaterMode.value) {
      theaterMode.value = false
    }
    return
  }
  const tag = e.target?.tagName
  const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable
  if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (!isTyping && e.key === '/')) {
    e.preventDefault()
    searchOpen.value = true
  }
}

function clearEntranceTimers() {
  if (countUpRafId !== null) {
    cancelAnimationFrame(countUpRafId)
    countUpRafId = null
  }
  if (watchdogTimer) {
    clearTimeout(watchdogTimer)
    watchdogTimer = null
  }
  if (revisitSafetyTimer) {
    clearTimeout(revisitSafetyTimer)
    revisitSafetyTimer = null
  }
  revealTimers.forEach((id) => clearTimeout(id))
  revealTimers = []
}

function scheduleRevealTimer(fn, delay) {
  const id = setTimeout(fn, delay)
  revealTimers.push(id)
  return id
}

function startNumericEntrance() {
  if (prefersReducedMotion) {
    countUpFactor.value = 1
    chartSweepFactor.value = 1
    return
  }
  const countDelay = 1460
  const countDur = 1220
  const chartOffset = 80
  const chartDur = 1080

  // 延后至 1460ms 再启动跳数 rAF，彻底消除前 88 帧空转与父模板重渲染
  scheduleRevealTimer(() => {
    if (isViewUnmounted) return
    const start = performance.now()
    const step = (now) => {
      if (isViewUnmounted) {
        countUpRafId = null
        return
      }
      const elapsed = now - start
      const ct = Math.min(1, Math.max(0, elapsed / countDur))
      const ch = Math.min(1, Math.max(0, (elapsed - chartOffset) / chartDur))
      countUpFactor.value = 1 - Math.pow(1 - ct, 3)
      chartSweepFactor.value = 1 - Math.pow(1 - ch, 3)
      if (ct < 1 || ch < 1) {
        countUpRafId = requestAnimationFrame(step)
      } else {
        countUpFactor.value = 1
        chartSweepFactor.value = 1
        countUpRafId = null
      }
    }
    countUpRafId = requestAnimationFrame(step)
  }, countDelay)
}

function beginReveal() {
  if (revealTriggered || isViewUnmounted) return
  revealTriggered = true
  if (watchdogTimer) {
    clearTimeout(watchdogTimer)
    watchdogTimer = null
  }
  if (revisitSafetyTimer) {
    clearTimeout(revisitSafetyTimer)
    revisitSafetyTimer = null
  }

  cockpitSessionCurtainShown = true
  loaderVisible.value = false

  if (prefersReducedMotion) {
    countUpFactor.value = 1
    chartSweepFactor.value = 1
    city3dLabelsVisible.value = true
    entrancePhase.value = 'ready'
    city3dRef.value?.playIntroCamera(0)
    return
  }

  entrancePhase.value = 'revealing'

  // 第一幕（0.00s – 2.05s）：与幕布薄纱淡出同帧启动，3D 镜头 14° 航拍弧线压镜 + 晨雾渐散 + 指挥中心柔光扫楼
  city3dRef.value?.playIntroCamera(2050)

  // 第三幕：核心数字沉稳滚动跳数 + 人口结构环舒展
  startNumericEntrance()

  // 第三幕压轴（2.04s）：3D 弧线压镜即将落定时，3D 社区与地标铭牌轻柔浮现
  scheduleRevealTimer(() => {
    city3dLabelsVisible.value = true
  }, 2040)

  // 入场收口（3.25s）：清除临时过渡态，释放所有常规交互后再静默预载楼栋索引
  scheduleRevealTimer(() => {
    entrancePhase.value = 'ready'
    loadBldgIdxMod()
  }, 3250)
}

function handleCityLoadProgress({ percent }) {
  if (revealTriggered) return
  if (percent > loaderTargetProgress.value) {
    loaderTargetProgress.value = percent
  }
}

function handleCitySceneReady() {
  if (revealTriggered) return
  loaderSceneReady.value = true
  loaderTargetProgress.value = 100
  if (watchdogTimer) {
    clearTimeout(watchdogTimer)
    watchdogTimer = null
  }
  // 二次切回大屏跳过进度页，首帧稳住后立即进入三幕渐进动画
  if (!loaderVisible.value) {
    beginReveal()
  }
}

function preloadImageWithCap(url, timeoutMs = 2400) {
  return new Promise((resolve) => {
    const img = new Image()
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    const timer = scheduleRevealTimer(done, timeoutMs)
    img.onload = () => { clearTimeout(timer); done() }
    img.onerror = () => { clearTimeout(timer); done() }
    img.src = url
  })
}

async function triggerPreviewFallback(noticeText) {
  if (revealTriggered || loaderSceneReady.value) return
  city3dMounted.value = false
  mapBase.value = 'preview'
  if (loaderVisible.value) {
    loaderFallbackNotice.value = noticeText
    loaderTargetProgress.value = Math.max(loaderTargetProgress.value, 92)
    const previewUrl = previewRoot + previewPose.value + (isDark.value ? '-night.webp' : '-day.webp')
    await preloadImageWithCap(previewUrl, 2200)
    if (revealTriggered || isViewUnmounted) return
    loaderSceneReady.value = true
    loaderTargetProgress.value = 100
  } else {
    beginReveal()
  }
}

function handleCityWebglFallback() {
  if (!revealTriggered && !loaderSceneReady.value) {
    triggerPreviewFallback('正在载入三维沙盘静态视图')
  } else {
    city3dMounted.value = false
    mapBase.value = 'preview'
  }
}

// 数值补间：入场阶段由 countUpFactor 统一跳数；入场完成后数据变化（锁定社区、复位、派单）从旧值平滑滚到新值
const tweenRafs = new Set()
function useTween(getter, duration = 320) {
  const out = ref(Number(getter()) || 0)
  let raf = null
  watch(getter, (next) => {
    const to = Number(next) || 0
    if (raf !== null) { cancelAnimationFrame(raf); tweenRafs.delete(raf); raf = null }
    if (prefersReducedMotion || entrancePhase.value !== 'ready' || isViewUnmounted) {
      out.value = to
      return
    }
    const from = out.value
    if (Math.abs(to - from) < 0.01) {
      out.value = to
      return
    }
    const t0 = performance.now()
    const step = (now) => {
      tweenRafs.delete(raf)
      const p = Math.min(1, (now - t0) / duration)
      const cur = from + (to - from) * (1 - Math.pow(1 - p, 3))
      if (p < 1 && Math.abs(to - cur) >= 0.35 && !isViewUnmounted) {
        out.value = cur
        raf = requestAnimationFrame(step)
        tweenRafs.add(raf)
      } else {
        out.value = to
        raf = null
      }
    }
    raf = requestAnimationFrame(step)
    tweenRafs.add(raf)
  })
  return out
}

// 显示值 = 补间值 × 入场跳数系数
function shownNum(twRef, decimals = 0) {
  const v = twRef.value * countUpFactor.value
  return decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString()
}

const drill = shallowRef({ open: false, title: '', subtitle: '', summary: '', filters: [], columns: [], rows: [], exportName: '' })

const role = computed(() => getCurrentRole())
const scope = computed(() => getEffectiveCommunity())
const visibleComms = computed(() => getVisibleCommunities())
const isDark = computed(() => store.cockpitTheme === 'dark' || store.preset === 'command-dark')

// 章节结论由 stats 实时生成（见 chapterConclusion），随社区锁定与数据变化同步
const CHAPTERS = [
  { id: 'home', short: '全域家底党建', label: '全域家底与党建引领', slice: 'party', focus: [37.4465, 116.3515] },
  { id: 'health', short: '十四社区体检', label: '十四社区治理体检', slice: 'safety', focus: [37.436, 116.356] },
  { id: 'economy', short: '安全经济脉动', label: '安全生产与经济脉动', slice: 'economy', focus: [37.4465, 116.3515] },
  { id: 'eco', short: '生态防汛防火', label: '城乡生态与防汛防火', slice: 'eco', focus: [37.420, 116.365] },
  { id: 'peace', short: '民情闭环守护', label: '民情闭环与平安守护', slice: 'aid', focus: [37.4632, 116.3532] }
]

const PENDING_STAGES = ['待受理', '待补充', '待派单']
const isOverdue = (ev) => ev.stage !== '已办结' && Number(ev.elapsedHours) > Number(ev.deadlineHours)
const fmtHours = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(1) : '0.0')

// 社区治理分级（与三维沙盘图例同一口径）：标杆 / 平稳 / 关注 / 督办
const LEVEL_LABEL = { lead: '标杆', ok: '平稳', warn: '关注', bad: '督办' }
const openHzOf = (c) => c.safety.hazards - c.safety.fixed
function commLevel(c) {
  if (c.health === 'bad') return 'bad'
  if (c.health === 'warn') return 'warn'
  if (c.safety.coverage >= 98 && openHzOf(c) === 0) return 'lead'
  return 'ok'
}
const commChipText = (c) => (openHzOf(c) ? `待销 ${openHzOf(c)}` : LEVEL_LABEL[commLevel(c)])
function stageTagClass(ev) {
  if (!ev) return 'st-wait'
  if (ev.stage === '已办结') return 'st-ok'
  if (isOverdue(ev) || PENDING_STAGES.includes(ev.stage)) return 'st-bad'
  return 'st-wait'
}
function stageDotColor(ev) {
  if (ev.stage === '已办结') return 'var(--ck-ok)'
  if (isOverdue(ev) || ev.stage === '待受理') return 'var(--ck-danger)'
  return 'var(--ck-warn)'
}
const barPct = (v, max) => (max > 0 ? Math.max(4, Math.min(100, Math.round((v / max) * 100))) : 0)
const shortName = (name) => name.replace('社区', '')

// 独立拆分共享辅助站与事件范围 computed，避免调拨物资（aidTick）引发地图 :events 引用重建
const scopedEvents = computed(() =>
  store.events.filter((e) => scope.value === '全街道' || e.community === scope.value)
)

const aidStats = computed(() => {
  void aidTick.value
  const list = visibleComms.value
  const aidDetail = list.reduce(
    (acc, c) => {
      acc.wheelchair += c.gov.aidStation.wheelchair
      acc.crutch += c.gov.aidStation.crutch
      acc.medkit += c.gov.aidStation.medkit
      acc.toolbox += c.gov.aidStation.toolbox
      acc.umbrella += c.gov.aidStation.umbrella
      return acc
    },
    { wheelchair: 0, crutch: 0, medkit: 0, toolbox: 0, umbrella: 0 }
  )
  const aidItems = Object.values(aidDetail).reduce((a, b) => a + b, 0)
  return { aidDetail, aidItems }
})

const stats = computed(() => {
  const list = visibleComms.value
  const pop = list.reduce((a, c) => a + c.pop, 0)
  const hukou = list.reduce((a, c) => a + c.hukou, 0)
  const party = list.reduce((a, c) => a + c.party, 0)
  const branches = list.reduce((a, c) => a + c.branches.length, 0)
  const grids = list.reduce((a, c) => a + c.grids, 0)
  const gridStaff = list.reduce((a, c) => a + c.gridStaff, 0)
  const publicPost = list.reduce((a, c) => a + c.publicPost, 0)
  const elderly = list.reduce((a, c) => a + c.elderly, 0)
  const students = list.reduce((a, c) => a + c.students, 0)
  const youthPct = pop ? Math.round(((pop - elderly - students) / pop) * 100) : 0
  const elderPct = pop ? Math.round((elderly / pop) * 100) : 0
  const teenPct = pop ? Math.max(0, 100 - youthPct - elderPct) : 0
  const hukouPct = pop ? ((hukou / pop) * 100).toFixed(1) : '0.0'

  // 重点关怀底数
  const special = list.reduce(
    (acc, c) => {
      acc.elderAlone += c.special.elderAlone
      acc.lowIncome += c.special.lowIncome
      acc.disabled += c.special.disabled
      acc.veteran += c.special.veteran
      return acc
    },
    { elderAlone: 0, lowIncome: 0, disabled: 0, veteran: 0 }
  )

  // 房屋资产结构
  const homes = list.reduce((a, c) => a + c.housing.homes, 0)
  const buildings = list.reduce((a, c) => a + c.housing.buildings, 0)
  const selfLive = list.reduce((a, c) => a + c.housing.selfLive, 0)
  const rent = list.reduce((a, c) => a + c.housing.rent, 0)
  const vacant = list.reduce((a, c) => a + c.housing.vacant, 0)
  const selfPct = homes ? Math.round((selfLive / homes) * 100) : 0
  const rentPct = homes ? Math.round((rent / homes) * 100) : 0
  const vacantPct = homes ? Math.max(0, 100 - selfPct - rentPct) : 0
  const avgPropertyRate = list.length
    ? (list.reduce((a, c) => a + c.housing.propertyRate, 0) / list.length).toFixed(1)
    : '—'

  // 经济与安全底数
  const largeEnt = list.reduce((a, c) => a + c.biz.large, 0)
  const smallEnt = list.reduce((a, c) => a + c.biz.small, 0)
  const selfBiz = list.reduce((a, c) => a + c.biz.self, 0)
  const ent = largeEnt + smallEnt + selfBiz
  const coBuild = list.reduce((a, c) => a + c.biz.coBuild, 0)
  const revenue = list.reduce((a, c) => a + c.biz.revenue, 0)
  const employees = list.reduce((a, c) => a + c.biz.employees, 0)
  const regEnt = list.reduce((a, c) => a + c.safety.regEnt, 0)
  const hazards = list.reduce((a, c) => a + c.safety.hazards, 0)
  const fixed = list.reduce((a, c) => a + c.safety.fixed, 0)
  const avgCoverage = list.length
    ? (list.reduce((a, c) => a + c.safety.coverage, 0) / list.length).toFixed(1)
    : '—'
  const avgGovPass = list.length
    ? (list.reduce((a, c) => a + c.gov.passRate, 0) / list.length).toFixed(1)
    : '—'

  // 生态防汛防火
  const floodPts = list.reduce((a, c) => a + c.env.floodPts, 0)
  const firePts = list.reduce((a, c) => a + c.env.firePts, 0)
  const riversKm = list.reduce((a, c) => a + c.env.rivers, 0)
  const bareSoil = list.reduce((a, c) => a + c.env.bareSoil, 0)

  // 共享辅助站物资（引用独立 computed）
  const { aidDetail, aidItems } = aidStats.value

  // 数字武装实时底数
  const armed = list.reduce(
    (acc, c) => {
      acc.militia += c.armed.militia
      acc.recruitReg += c.armed.recruitReg
      acc.veterans += c.armed.veterans
      acc.eduCount += c.armed.eduCount
      acc.eduPeople += c.armed.eduPeople
      return acc
    },
    { militia: 0, recruitReg: 0, veterans: 0, eduCount: 0, eduPeople: 0 }
  )

  // 治理事件全周期闭环
  const events = scopedEvents.value
  const doneEvents = events.filter((e) => e.stage === '已办结')
  const openEvents = events.filter((e) => e.stage !== '已办结')
  const doneCnt = doneEvents.length
  const acceptDispatch = events.filter((e) => PENDING_STAGES.includes(e.stage)).length
  const handleReview = events.filter((e) => ['处置中', '待复核'].includes(e.stage)).length
  const overdueCnt = openEvents.filter(isOverdue).length
  const rateExact = events.length ? ((doneCnt / events.length) * 100).toFixed(1) : '—'
  const timedDone = doneEvents.filter((e) => Number.isFinite(Number(e.elapsedHours)) && e.elapsedHours !== '' && e.elapsedHours != null)
  const avgHours = timedDone.length
    ? (timedDone.reduce((a, e) => a + Number(e.elapsedHours), 0) / timedDone.length).toFixed(1)
    : '—'

  // 事件四类分布
  const catColors = ['var(--chart-1)', 'var(--chart-3)', 'var(--chart-5)', 'var(--chart-2)']
  const categoryStats = EVENT_CATEGORIES.map((cat, idx) => {
    const count = events.filter((e) => e.category === cat).length
    const pct = events.length ? Math.round((count / events.length) * 100) : 0
    return { name: cat, count, pct, color: catColors[idx % catColors.length] }
  })

  // 排行洞察（随五章变化）
  const partyTop = [...list].sort((a, b) => b.party - a.party).slice(0, 4)
  const riskTop = [...list]
    .sort((a, b) => (b.safety.hazards - b.safety.fixed) - (a.safety.hazards - a.safety.fixed) || a.gov.passRate - b.gov.passRate)
    .slice(0, 4)
  const revenueTop = [...list].sort((a, b) => b.biz.revenue - a.biz.revenue).slice(0, 4)
  const ecoTop = [...list].sort((a, b) => (b.env.floodPts + b.env.firePts) - (a.env.floodPts + a.env.firePts)).slice(0, 4)
  // 排行条按当前榜单最大值归一，避免固定分母在数据变化后溢出或过短
  const rankMax = {
    party: Math.max(0, ...partyTop.map((c) => c.party)),
    risk: Math.max(0, ...riskTop.map((c) => c.safety.hazards - c.safety.fixed)),
    revenue: Math.max(0, ...revenueTop.map((c) => c.biz.revenue)),
    eco: Math.max(0, ...ecoTop.map((c) => c.env.floodPts + c.env.firePts))
  }

  // 数据直达宽表采集任务实时进度（全街道显示汇总，单社区下钻按分派社区精确拆分本社区配额）
  const splitShare = (val, count, idx) => {
    if (count <= 1) return val
    const base = Math.floor(val / count)
    const rem = val - base * count
    return base + (idx < rem ? 1 : 0)
  }
  const directTasks = store.dataDirect.tasks
    .filter((t) => !t.expiredLocked && (scope.value === '全街道' || (t.assignees || []).includes(scope.value)))
    .slice(0, 3)
    .map((t) => {
      const rawDone = Number(t.doneCount || 0)
      const rawTotal = Number(t.totalTarget || 1)
      const assignees = Array.isArray(t.assignees) && t.assignees.length ? t.assignees : []
      let done = rawDone
      let total = rawTotal
      if (scope.value !== '全街道' && assignees.length > 0) {
        const idx = Math.max(0, assignees.indexOf(scope.value))
        total = Math.max(1, splitShare(rawTotal, assignees.length, idx))
        done = Math.min(total, splitShare(rawDone, assignees.length, idx))
      }
      const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0
      return { id: t.id, title: t.name || t.title || '宽表采集任务', done, total, pct }
    })

  // 警网联勤通报
  const policeList = store.policeAlerts.filter((p) => scope.value === '全街道' || p.community === scope.value)

  // 近 7 日受理与办结微趋势（锚定全量事件最新日期，随社区锁定实时联动）
  const allDates = (store.events || [])
    .map((e) => String(e.createdAt || '').slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
  const anchorStr = allDates[allDates.length - 1] || '2026-11-20'
  const anchorDate = new Date(`${anchorStr}T00:00:00`)
  const trend7d = []
  for (let offset = 6; offset >= 0; offset--) {
    const d = new Date(anchorDate)
    d.setDate(d.getDate() - offset)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const iso = `${yyyy}-${mm}-${dd}`
    let intake = 0
    let closed = 0
    for (let j = 0; j < events.length; j++) {
      const ev = events[j]
      if (String(ev.createdAt || '').slice(0, 10) === iso) intake += 1
      const lastHist = ev.history?.[ev.history.length - 1]
      const closeDay = ev.stage === '已办结' ? String(lastHist?.time || ev.createdAt || '').slice(0, 10) : ''
      if (closeDay === iso) closed += 1
    }
    trend7d.push({ iso, label: `${mm}-${dd}`, intake, closed })
  }

  return {
    pop, hukou, hukouPct, party, branches, grids, gridStaff, publicPost,
    youthPct, elderPct, teenPct, special,
    homes, buildings, selfPct, rentPct, vacantPct, avgPropertyRate,
    largeEnt, smallEnt, selfBiz, ent, coBuild, revenue: revenue.toFixed(1),
    employeesWan: (employees / 10000).toFixed(2),
    regEnt, hazards, fixed, openHazards: hazards - fixed,
    fixRate: hazards ? ((fixed / hazards) * 100).toFixed(1) : '100.0',
    avgCoverage, avgGovPass,
    healthCounts: {
      lead: list.filter((c) => commLevel(c) === 'lead').length,
      ok: list.filter((c) => commLevel(c) === 'ok').length,
      warn: list.filter((c) => c.health === 'warn').length,
      bad: list.filter((c) => c.health === 'bad').length
    },
    floodPts, firePts, riversKm: riversKm.toFixed(1), bareSoilWan: (bareSoil / 10000).toFixed(2),
    aidDetail, aidItems, armed,
    events, doneCnt, openEvents, acceptDispatch, handleReview, overdueCnt, rateExact, avgHours,
    categoryStats, partyTop, riskTop, revenueTop, ecoTop, rankMax, directTasks,
    commCount: list.length,
    policeList,
    trend7d,
    avgPerGrid: grids ? Math.round(pop / grids) : 0
  }
})

const popRingCenter = computed(() => {
  if (hoveredPopSeg.value === 'youth') return { pct: shownNum(tw.youth), label: '中青年', color: 'var(--chart-1)' }
  if (hoveredPopSeg.value === 'elder') return { pct: shownNum(tw.elder), label: '老年人', color: 'var(--chart-2)' }
  if (hoveredPopSeg.value === 'teen') return { pct: shownNum(tw.teen), label: '在校生', color: 'var(--chart-3)' }
  return { pct: shownNum(tw.youth), label: '中青年', color: '' }
})

const trendChart = computed(() => {
  const days = stats.value.trend7d || []
  const maxVal = Math.max(2, ...days.flatMap((d) => [d.intake, d.closed]))
  const W = 252
  const H = 40
  const padX = 8
  const padTop = 5
  const padBot = 5
  const spanX = W - padX * 2
  const spanY = H - padTop - padBot
  const pts = days.map((d, i) => {
    const x = days.length > 1 ? padX + (i / (days.length - 1)) * spanX : W / 2
    const yIn = padTop + spanY * (1 - d.intake / maxVal)
    const yCl = padTop + spanY * (1 - d.closed / maxVal)
    return { ...d, x: Math.round(x * 10) / 10, yIn: Math.round(yIn * 10) / 10, yCl: Math.round(yCl * 10) / 10 }
  })
  const smoothPath = (arr, key) => {
    if (!arr.length) return ''
    if (arr.length === 1) return `M ${arr[0].x},${arr[0][key]}`
    let d = `M ${arr[0].x},${arr[0][key]}`
    for (let i = 0; i < arr.length - 1; i++) {
      const p0 = arr[i]
      const p1 = arr[i + 1]
      const cx = ((p0.x + p1.x) / 2).toFixed(1)
      d += ` C ${cx},${p0[key]} ${cx},${p1[key]} ${p1.x},${p1[key]}`
    }
    return d
  }
  const intakePath = smoothPath(pts, 'yIn')
  const closedPath = smoothPath(pts, 'yCl')
  const areaBase = H - padBot
  const intakeArea = pts.length ? `${intakePath} L ${pts[pts.length - 1].x},${areaBase} L ${pts[0].x},${areaBase} Z` : ''
  const closedArea = pts.length ? `${closedPath} L ${pts[pts.length - 1].x},${areaBase} L ${pts[0].x},${areaBase} Z` : ''
  return { pts, intakePath, closedPath, intakeArea, closedArea, width: W, height: H }
})

// 优先展示未办结事项，其次展示近期已闭环事项；支持四类构成条点选过滤
const filteredStreamEvents = computed(() => {
  let list = [...stats.value.events]
  if (activeCategoryFilter.value) {
    list = list.filter((e) => e.category === activeCategoryFilter.value)
  }
  list.sort((a, b) => {
    const aOpen = a.stage === '已办结' ? 1 : 0
    const bOpen = b.stage === '已办结' ? 1 : 0
    if (aOpen !== bOpen) return aOpen - bOpen
    return String(b.createdAt).localeCompare(String(a.createdAt))
  })
  return list.slice(0, 14)
})

// ── 数值补间源 ──
const tw = {
  pop: useTween(() => stats.value.pop),
  party: useTween(() => stats.value.party),
  homes: useTween(() => stats.value.homes),
  ent: useTween(() => stats.value.ent),
  openHazards: useTween(() => stats.value.openHazards),
  open: useTween(() => stats.value.openEvents.length),
  youth: useTween(() => stats.value.youthPct),
  elder: useTween(() => stats.value.elderPct),
  teen: useTween(() => stats.value.teenPct),
  rate: useTween(() => (stats.value.rateExact === '—' ? 0 : Number(stats.value.rateExact))),
  elderAlone: useTween(() => stats.value.special.elderAlone),
  lowIncome: useTween(() => stats.value.special.lowIncome),
  disabled: useTween(() => stats.value.special.disabled),
  veteran: useTween(() => stats.value.special.veteran),
  largeEnt: useTween(() => stats.value.largeEnt),
  revenue: useTween(() => Number(stats.value.revenue)),
  employeesWan: useTween(() => Number(stats.value.employeesWan))
}
const RING_C = 219.9
const GAUGE_ARC = 109.96
// 环图三段弧长随补间与入场扫描同步
const ringArcs = computed(() => {
  const f = chartSweepFactor.value
  const y = (tw.youth.value / 100) * RING_C * f
  const e = (tw.elder.value / 100) * RING_C * f
  const t = (tw.teen.value / 100) * RING_C * f
  return { y, e, t }
})
const rateGaugeDash = computed(() => {
  const pct = Math.max(0, Math.min(100, tw.rate.value)) / 100
  return pct * GAUGE_ARC * chartSweepFactor.value
})

// ── 当前章专题排行：全街道口径排序，锁定社区时高亮并保证其可见 ──
const RANK_DEFS = [
  { note: '在册党员排行', val: (c) => c.party, text: (c) => `${c.party} 名`, color: () => 'var(--chart-1)' },
  {
    note: '待销号隐患排行',
    val: (c) => openHzOf(c),
    tie: (a, b) => a.gov.passRate - b.gov.passRate,
    text: (c) => (openHzOf(c) ? `待销 ${openHzOf(c)} 处` : '已清零'),
    color: (c) => (c.health === 'bad' ? 'var(--ck-danger)' : c.health === 'warn' ? 'var(--ck-warn)' : 'var(--ck-ok)')
  },
  { note: '规上产值排行', val: (c) => c.biz.revenue, text: (c) => `${c.biz.revenue} 亿`, color: () => 'var(--ck-accent)' },
  {
    note: '汛火点位排行',
    val: (c) => c.env.floodPts + c.env.firePts,
    text: (c) => `易涝 ${c.env.floodPts} · 防火 ${c.env.firePts}`,
    color: () => 'var(--ck-run)'
  },
  {
    note: '重点关怀排行',
    val: (c) => c.special.elderAlone + c.special.lowIncome + c.special.disabled + c.special.veteran,
    text: (c) => `${c.special.elderAlone + c.special.lowIncome + c.special.disabled + c.special.veteran} 人`,
    color: () => 'var(--chart-2)'
  }
]
const rankBoard = computed(() => {
  void aidTick.value
  const def = RANK_DEFS[activeChapter.value] || RANK_DEFS[0]
  const pool = role.value.scope === '全街道' ? COMMUNITIES : visibleComms.value
  const sorted = [...pool].sort((a, b) => def.val(b) - def.val(a) || (def.tie ? def.tie(a, b) : 0))
  const max = Math.max(0, ...sorted.map(def.val))
  const rows = sorted.map((c, i) => {
    const v = def.val(c)
    return {
      c,
      rank: i + 1,
      pct: v > 0 ? barPct(v, max) : 0,
      text: def.text(c),
      color: def.color(c),
      isScope: c.name === scope.value
    }
  })
  const note = scope.value !== '全街道' ? `全街道 · ${def.note}` : def.note
  return { note, rows, total: sorted.length }
})

// ── 列表按剩余高度整条适配：只显示能完整放下的条目，杜绝半截行 ──
const unwrapEl = (r) => r?.$el ?? r
function useFitCount(elRef, deps) {
  const count = ref(99)
  let ro = null
  const measure = () => {
    if (loaderVisible.value) return
    if (typeof window !== 'undefined' && window.innerWidth <= 1100) {
      count.value = 99
      return
    }
    const el = unwrapEl(elRef.value)
    if (!el || !el.children) return
    const limit = el.clientHeight + 1
    let n = 0
    for (const child of el.children) {
      if (child.offsetTop + child.offsetHeight <= limit) n += 1
      else break
    }
    count.value = Math.max(1, n)
  }
  onMounted(() => {
    ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (typeof window !== 'undefined') window.addEventListener('resize', measure)
    watch(
      () => unwrapEl(elRef.value),
      (el, old) => {
        if (old) ro?.unobserve(old)
        if (el) ro?.observe(el)
        nextTick(measure)
      },
      { immediate: true }
    )
    watch(loaderVisible, (vis) => {
      if (!vis) requestAnimationFrame(measure)
    })
  })
  watch(deps, () => nextTick(measure))
  onBeforeUnmount(() => {
    ro?.disconnect()
    if (typeof window !== 'undefined') window.removeEventListener('resize', measure)
  })
  return count
}
const rankListEl = ref(null)
const liveListEl = ref(null)
const doneListEl = ref(null)
const timelineEl = ref(null)
const rankFit = useFitCount(rankListEl, () => [activeChapter.value, scope.value, viewMode.value])
const liveFit = useFitCount(liveListEl, () => [filteredStreamEvents.value.length, scope.value, activeCategoryFilter.value, viewMode.value])

// 锁定社区排名靠后时，以其替换可视区最后一行，保证始终能看到本社区位次
const rankRowsShown = computed(() => {
  const rows = rankBoard.value.rows
  const n = rankFit.value
  const idx = rows.findIndex((r) => r.isScope)
  if (idx < 0 || idx < n || n < 2) return rows
  return [...rows.slice(0, n - 1), rows[idx], ...rows.slice(n - 1, idx), ...rows.slice(idx + 1)]
})

// 调度态：在办待办之下补充近期办结流，填充左轨剩余高度
const recentDoneEvents = computed(() =>
  stats.value.events
    .filter((e) => e.stage === '已办结')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 12)
)
const doneFit = useFitCount(doneListEl, () => [recentDoneEvents.value.length, scope.value, viewMode.value])
const timelineFit = useFitCount(timelineEl, () => [selectedEvent.value?.id, selectedEvent.value?.history?.length])
const selectedTimeline = computed(() => {
  const h = selectedEvent.value?.history || []
  return [...h].reverse()
})

// 新增事项短暂高亮（派单、排查工单写回事件流时）
const freshIds = ref(new Set())
watch(
  () => store.events.length,
  (len, oldLen) => {
    if (!(len > oldLen) || entrancePhase.value !== 'ready') return
    const added = store.events.slice(0, len - oldLen).map((e) => e.id)
    const next = new Set(freshIds.value)
    added.forEach((id) => next.add(id))
    freshIds.value = next
    setTimeout(() => {
      if (isViewUnmounted) return
      const s = new Set(freshIds.value)
      added.forEach((id) => s.delete(id))
      freshIds.value = s
    }, 2000)
  }
)

// 地图悬停社区 → 底部社区格联动高亮
const mapHoverComm = ref('')

const currentChapterObj = computed(() => CHAPTERS[activeChapter.value])

// 调度态：全街道实时在岗网格员名录与状态统计（随锁定社区联动）
const scopedLiveStaff = computed(() => {
  const rank = { 滞留提醒: 0, 在办处置: 1, 在岗巡查: 2 }
  return liveStaffList.value
    .filter((s) => scope.value === '全街道' || s.community === scope.value)
    .slice()
    .sort((a, b) => {
      const dr = (rank[a.status] ?? 9) - (rank[b.status] ?? 9)
      if (dr !== 0) return dr
      if (a.status === '滞留提醒' && a.stayMinutes !== b.stayMinutes) {
        return (b.stayMinutes || 0) - (a.stayMinutes || 0)
      }
      return (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0) || a.idx - b.idx
    })
})

const staffCounts = computed(() => {
  const list = scopedLiveStaff.value
  let patrol = 0
  let handling = 0
  let alert = 0
  for (let i = 0; i < list.length; i++) {
    const st = list[i].status
    if (st === '滞留提醒') alert++
    else if (st === '在办处置') handling++
    else if (st === '在岗巡查') patrol++
  }
  return { total: list.length, patrol, handling, alert }
})

const statusLiveStaff = computed(() => staffStatusFilter.value === 'all'
  ? scopedLiveStaff.value
  : scopedLiveStaff.value.filter((st) => st.status === staffStatusFilter.value)
)
const staffCommunityCounts = computed(() => {
  if (!staffLayerActive.value || !staffRosterReady.value) return null
  const counts = Object.create(null)
  for (const person of statusLiveStaff.value) counts[person.community] = (counts[person.community] || 0) + 1
  return counts
})
const filteredLiveStaff = computed(() => {
  const term = staffSearch.value.trim().toLowerCase()
  if (!term) return statusLiveStaff.value
  return statusLiveStaff.value.filter((st) =>
    [st.name, st.community, st.grid].some((v) => String(v || '').toLowerCase().includes(term))
  )
})
const showStaffDirectory = computed(() =>
  staffDirectoryOpen.value && !selectedEntity.value && selectedBuildingIndex.value < 0 && !selectedEvent.value
)

const followStaffObj = computed(() => {
  if (!followStaffId.value) return null
  if (activeStaffTelemetry.value?.id === followStaffId.value) return activeStaffTelemetry.value
  return liveStaffList.value.find((s) => s.id === followStaffId.value) || selectedEntity.value || null
})

function onStaffRosterReady(list) {
  liveStaffList.value = Array.isArray(list) ? list : []
  staffRosterReady.value = true
  if (selectedEntity.value?.entityType === 'staff') {
    const fresh = liveStaffList.value.find((s) => s.id === selectedEntity.value.id)
    if (fresh) {
      selectedEntity.value = fresh
      activeStaffTelemetry.value = fresh
    }
  }
}

// 三维渲染与平面地图轮流推进同一份巡防位置，切图不会重置人员或处置状态。
let staffEnginePromise = null
function getStaffEngine(buildingIndex, createEngine) {
  if (!staffEngine) staffEngine = createEngine(store, buildingIndex)
  return staffEngine
}
async function getStaffEngineAsync(buildingIndex, createEngineAsync, yieldFn) {
  if (staffEngine) return staffEngine
  if (!staffEnginePromise) {
    staffEnginePromise = createEngineAsync(store, buildingIndex, yieldFn)
      .then((eng) => {
        staffEngine = eng
        return eng
      })
      .catch((err) => {
        staffEnginePromise = null
        throw err
      })
  }
  return staffEnginePromise
}

function updateStaffStatus(id, status, extra) {
  const fromScene = city3dRef.value?.updateLiveStaffStatus?.(id, status, extra)
  if (fromScene) return fromScene
  const updated = staffEngine?.setStatus(id, status, extra)
  if (updated) onStaffRosterReady(staffEngine.getAll())
  return updated
}

const flatStaffMode = computed(() => {
  if (mapBase.value === 'city3d') return ''
  if (!staffLayerActive.value && !staffDirectoryOpen.value && selectedEntity.value?.entityType !== 'staff') return ''
  return mapBase.value === 'preview' ? 'preview' : 'map'
})

watch(flatStaffMode, async (mode, _previous, onCleanup) => {
  if (!mode) return
  let cancelled = false
  let timer
  onCleanup(() => {
    cancelled = true
    clearInterval(timer)
  })
  if (!staffEngine) {
    try {
      const [indexModule, staffModule] = await Promise.all([loadBldgIdxMod(), import('../utils/cockpitStaffLive')])
      if (cancelled) return
      const index = await indexModule.getCockpitBuildingIndexAsync(() => new Promise(resolve => setTimeout(resolve, 0)))
      if (cancelled) return
      getStaffEngine(index, staffModule.createStaffLiveEngine)
    } catch {
      if (!cancelled) showToast('网格员定位数据暂时无法加载')
      return
    }
  }
  onStaffRosterReady(staffEngine.getAll())
  if (mode === 'preview') return
  let lastTick = performance.now()
  timer = setInterval(() => {
    const now = performance.now()
    const elapsed = (now - lastTick) / 1000
    lastTick = now
    if (document.hidden) return
    staffEngine.step(elapsed, 1)
    onStaffRosterReady(staffEngine.getAll())
  }, 1000)
})

function onStaffLiveTick(snap) {
  if (!snap) return
  activeStaffTelemetry.value = snap
  if (selectedEntity.value?.id === snap.id) {
    selectedEntity.value = { ...selectedEntity.value, ...snap }
  }
}

function openStaffDirectory(status = 'all') {
  stopTour()
  if (mapBase.value === 'preview') mapBase.value = 'gov'
  staffLayerActive.value = true
  if (staffStatusFilter.value !== status) staffSearch.value = ''
  staffStatusFilter.value = status
  closeRightPenetration()
  selectedEvent.value = null
  staffDirectoryOpen.value = true
  narrowPanel.value = 'events'
}

async function openCommunityStaff(name) {
  const status = staffStatusFilter.value
  if (scope.value !== name) {
    toggleCommunityLock(name)
    if (scope.value !== name) return
    await nextTick() // 辖区切换先清理旧人员，再按刚才查看的状态打开本社区名录。
  }
  if (scope.value === name && staffLayerActive.value) openStaffDirectory(status)
}

function closeStaffDirectory() {
  staffDirectoryOpen.value = false
  staffSearch.value = ''
  narrowPanel.value = 'map'
}

function resetStaffContext() {
  if (staffDirectoryOpen.value || selectedEntity.value?.entityType === 'staff') narrowPanel.value = 'map'
  staffDirectoryOpen.value = false
  staffStatusFilter.value = 'all'
  staffSearch.value = ''
  if (selectedEntity.value?.entityType === 'staff') closeRightPenetration()
  stopFollowStaff()
}

watch(scope, resetStaffContext)
watch(staffLayerActive, (active) => { if (!active) resetStaffContext() })

function viewStaffClose(st) {
  if (!st || st.entityType !== 'staff') return
  stopTour()
  stopFollowStaff()
  narrowPanel.value = 'map'
  if (mapBase.value === 'preview') mapBase.value = 'gov'
  nextTick(() => {
    if (mapBase.value === 'city3d') city3dRef.value?.focusOnStaff(st.id)
    else geoMapRef.value?.focusOnStaff(staffEngine?.getById(st.id) || st)
  })
}

function toggleFollowStaff(ent, altitude = 'low') {
  if (!ent || ent.entityType !== 'staff') return
  if (!city3dMounted.value) return
  if (followStaffId.value === ent.id) {
    followStaffId.value = ''
    showToast(`已退出对「${ent.name}」的低空跟拍`)
    return
  }
  if (mapBase.value !== 'city3d') mapBase.value = 'city3d'
  narrowPanel.value = 'map'
  staffLayerActive.value = true
  radiusActive.value = false
  followAltitude.value = altitude
  followStaffId.value = ent.id
  activeStaffTelemetry.value = ent
  addAuditLog(`驾驶舱开启对网格员「${ent.name}」的低空实时跟拍`, '实时跟拍')
}

function stepFollowStaff(dir = 1) {
  const pool = statusLiveStaff.value.length ? statusLiveStaff.value : scopedLiveStaff.value
  if (!pool.length) return
  const curIdx = pool.findIndex((s) => s.id === followStaffId.value)
  const nextIdx = curIdx < 0 ? 0 : (curIdx + dir + pool.length) % pool.length
  const nextSt = pool[nextIdx]
  if (nextSt.id !== followStaffId.value) {
    handleSelectEntity(nextSt)
    toggleFollowStaff(nextSt, followAltitude.value)
  }
}

function stopFollowStaff() {
  if (!followStaffId.value) return
  followStaffId.value = ''
}

function handleSuperviseStaff(staff) {
  if (!staff) return
  const updated = updateStaffStatus(staff.id, '在岗巡查', {
    task: '已接收街道督办提醒，恢复网格正常巡防'
  })
  const rec = (store.patrolRecords || []).find((p) => p.staff === staff.name && p.community === staff.community)
  if (rec) {
    rec.superviseStatus = '已督办'
    rec.superviseNote = '驾驶舱实时定位下发提醒督办'
    rec.stayMinutes = 0
  }
  if (updated) {
    activeStaffTelemetry.value = updated
    if (selectedEntity.value?.id === updated.id) selectedEntity.value = updated
  }
  addAuditLog(`驾驶舱对滞留网格员「${staff.name}（${staff.community}）」发送提醒督办`, '巡防督办')
  showToast(`已向「${staff.name}」发送滞留提醒督办，对方已恢复巡查`)
}

// 调度态待办：超时优先，其次按时限消耗比例倒序
const dispatchEvents = computed(() => {
  const ratio = (e) => Number(e.elapsedHours || 0) / Math.max(0.1, Number(e.deadlineHours || 1))
  return [...stats.value.openEvents].sort((a, b) => {
    const d = Number(isOverdue(b)) - Number(isOverdue(a))
    return d || ratio(b) - ratio(a)
  })
})

const chapterConclusion = computed(() => {
  const s = stats.value
  const all = scope.value === '全街道'
  const who = all ? '全街道' : scope.value
  const names = (arr, n = 2) => arr.slice(0, n).map((c) => shortName(c.name)).join('、')
  switch (activeChapter.value) {
    case 0:
      return `${who}${all ? ` ${s.commCount} 个社区` : ''}设基层支部 ${s.branches} 个、责任网格 ${s.grids} 个，在册党员 ${s.party.toLocaleString()} 名，共驻共建单位 ${s.coBuild} 家。`
    case 1: {
      if (!all) return `${who}待销号隐患 ${s.openHazards} 处，安全检查覆盖率 ${s.avgCoverage}%，政务抽查合格率 ${s.avgGovPass}%。`
      const bad = visibleComms.value.filter((c) => c.health === 'bad')
      return `${s.healthCounts.lead} 个标杆社区、${s.healthCounts.ok} 个运行平稳、${s.healthCounts.warn} 个重点关注${bad.length ? `，${names(bad, 3)}已纳入街道督办` : ''}。`
    }
    case 2:
      return `${who}规上企业 ${s.largeEnt} 家、规上产值 ${s.revenue} 亿元${all ? `，${names(s.revenueTop, 3)}居前` : ''}；隐患整改销号率 ${s.fixRate}%。`
    case 3:
      return `${who}河道巡防 ${s.riversKm} 公里，易涝点 ${s.floodPts} 处、防火点 ${s.firePts} 处${all ? `，重点盯防${names(s.ecoTop)}` : ''}。`
    default:
      return `${who}在办事项 ${s.openEvents.length} 件、办结率 ${s.rateExact}%，${s.commCount} 处共享辅助站在库物资 ${s.aidItems} 件。`
  }
})

const kpiCards = computed(() => {
  const s = stats.value
  return [
    {
      key: 'pop',
      label: '常住人口',
      icon: Users,
      value: shownNum(tw.pop),
      unit: '人',
      sub: `户籍占比 ${s.hukouPct}%`,
      tone: 'var(--chart-2)',
      valColor: 'var(--chart-2)',
      tip: '点击下钻分网格常住与流动人口明细',
      action: () => openDrill('pop')
    },
    {
      key: 'party',
      label: '在册党员',
      icon: Flag,
      value: shownNum(tw.party),
      unit: '名',
      sub: `${s.branches} 个基层支部`,
      tone: 'var(--primary)',
      valColor: 'var(--primary)',
      tip: '点击下钻党总支与支部明细',
      action: () => openDrill('party')
    },
    {
      key: 'homes',
      label: '实有房屋',
      icon: Building2,
      value: shownNum(tw.homes),
      unit: '户',
      sub: `物业覆盖 ${s.avgPropertyRate}%`,
      tone: 'var(--chart-5)',
      valColor: 'var(--chart-5)',
      tip: '点击下钻楼栋结构与物业覆盖率',
      action: () => openDrill('housing')
    },
    {
      key: 'ent',
      label: '市场主体',
      icon: Briefcase,
      value: shownNum(tw.ent),
      unit: '家',
      sub: `规上企业 ${s.largeEnt} 家`,
      tone: 'var(--chart-4)',
      valColor: 'var(--chart-4)',
      tip: '点击下钻规上企业与经济产值明细',
      action: () => openDrill('economy')
    },
    {
      key: 'hazards',
      label: '待销号隐患',
      icon: AlertTriangle,
      value: shownNum(tw.openHazards),
      unit: '处',
      sub: `整改销号 ${s.fixRate}%`,
      tone: 'var(--ck-warn)',
      valColor: 'var(--ck-warn)',
      tip: '点击下钻安全生产隐患台账',
      action: () => openDrill('hazards')
    },
    {
      key: 'open',
      label: '在办事项',
      icon: CheckCircle2,
      value: shownNum(tw.open),
      unit: '件',
      sub: s.overdueCnt ? `已超时 ${s.overdueCnt} 件` : '均在时限内',
      tone: s.overdueCnt ? 'var(--ck-danger)' : 'var(--ck-ok)',
      valColor: s.overdueCnt ? 'var(--ck-danger)' : 'var(--ck-ok)',
      tip: '进入网格事件研判台',
      action: () => router.push('/grid')
    }
  ]
})
const focusCoord = computed(() => {
  if (selectedEvent.value) return [selectedEvent.value.lat, selectedEvent.value.lng]
  if (scope.value !== '全街道') {
    const c = COMMUNITIES.find((x) => x.name === scope.value)
    return c ? c.center : null
  }
  return viewMode.value === 'report' ? currentChapterObj.value.focus : null
})

function syncBodyClass() {
  document.body.classList.add('view-cockpit')
  document.body.classList.toggle('cockpit-dark', isDark.value)
}

function stopTour() {
  if (tourTimer) {
    clearInterval(tourTimer)
    tourTimer = null
  }
  tourRunning.value = false
}

function switchToReport() {
  resetStaffContext()
  viewMode.value = 'report'
  followStaffId.value = ''
  activeSlice.value = CHAPTERS[activeChapter.value]?.slice || 'party'
}

function switchToDispatch() {
  stopTour()
  resetStaffContext()
  viewMode.value = 'dispatch'
  activeSlice.value = 'safety'
}

function selectChapter(idx) {
  resetStaffContext()
  activeChapter.value = idx
  activeSlice.value = CHAPTERS[idx].slice
  selectedEvent.value = null
}

function toggleCategoryFilter(catName) {
  activeCategoryFilter.value = activeCategoryFilter.value === catName ? '' : catName
}

function toggleTour() {
  if (tourRunning.value) {
    stopTour()
    showToast('已暂停五章汇报巡演')
    return
  }
  viewMode.value = 'report'
  tourRunning.value = true
  showToast('已开启「长河治理解码」五章自动巡演')
  tourTimer = setInterval(() => {
    selectChapter((activeChapter.value + 1) % CHAPTERS.length)
  }, TOUR_MS)
}

function toggleCockpitLightDark(ev) {
  const commit = () => {
    if (isDark.value) {
      if (store.preset === 'command-dark') {
        applyPreset('vermilion-seal')
      }
      store.cockpitTheme = 'light'
    } else {
      store.cockpitTheme = 'dark'
    }
    syncBodyClass()
  }
  runThemeViewTransition(commit, ev)
}

function toggleTheaterMode() {
  theaterMode.value = !theaterMode.value
}

function handleSpatialSelect(item) {
  if (!item) return
  stopTour()
  const isStaffTarget = item.kind === 'staff' && item.payload?.entityType === 'staff'
  if (isStaffTarget && mapBase.value === 'preview') {
    mapBase.value = 'gov'
  } else if (!isStaffTarget && mapBase.value !== 'city3d') {
    mapBase.value = 'city3d'
  }
  if (item.kind === 'community') {
    store.selectedCommunity = item.payload
    selectedEvent.value = null
    selectedBuildingIndex.value = -1
    selectedEntity.value = null
    focusedFloor.value = null
    radiusActive.value = false
    addAuditLog(`空间检索直达「${item.payload}」`, '空间检索')
  } else if (item.kind === 'building') {
    handleSelectBuilding(item.payload)
  } else if (item.kind === 'staff') {
    const liveMatch = staffEngine?.getById(item.payload?.id) || item.payload
    handleSelectEntity(liveMatch)
    if (!isStaffTarget && liveMatch?.x != null && liveMatch?.z != null) {
      nextTick(() => city3dRef.value?.focusOnPointXZ(liveMatch.x, liveMatch.z, 96, 102))
    }
  } else if (item.kind === 'event') {
    handleSelectEvent(item.payload)
    nextTick(() => {
      const ev = item.payload
      if (ev?.lat && ev?.lng) {
        const [ex, ez] = latLngToWorldXZ(ev.lat, ev.lng)
        city3dRef.value?.focusOnPointXZ(ex, ez, 96, 102)
      }
    })
  } else if (item.kind === 'camera') {
    handleResetPanorama()
    nextTick(() => {
      city3dRef.value?.applyCameraPreset(item.payload)
    })
  }
}

let glazeRaf = null
function onKpiPointerMove(e) {
  if (prefersReducedMotion) return
  const card = e.currentTarget
  if (!card) return
  const cx = e.clientX
  const cy = e.clientY
  if (glazeRaf) return
  glazeRaf = requestAnimationFrame(() => {
    glazeRaf = null
    const r = card.getBoundingClientRect()
    card.style.setProperty('--gx', `${Math.round(cx - r.left)}px`)
    card.style.setProperty('--gy', `${Math.round(cy - r.top)}px`)
  })
}

const hasRightPenetration = computed(() =>
  Boolean(showStaffDirectory.value || selectedBuildingDetail.value || selectedEntity.value || (viewMode.value === 'dispatch' && selectedEvent.value))
)

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  else document.documentElement.requestFullscreen().catch(() => {})
}

function toggleCommunityLock(name) {
  if (role.value.scope !== '全街道' && name !== role.value.scope) {
    showToast(`当前角色权限仅限查看「${role.value.scope}」`)
    return
  }
  const nextScope = store.selectedCommunity === name ? '全街道' : name
  store.selectedCommunity = nextScope
  if (followStaffObj.value && nextScope !== '全街道' && followStaffObj.value.community !== nextScope) {
    followStaffId.value = ''
  }
  selectedEvent.value = null
  selectedBuildingIndex.value = -1
  selectedEntity.value = null
  focusedFloor.value = null
  radiusActive.value = false
}

// ── 三维楼栋一楼一档 / 实体点位 / 300 米联动圈计算（异步按需载入空间索引模块，零首屏阻塞） ──
const selectedBuildingDetail = computed(() => {
  void store.events.length
  void aidTick.value
  const mod = bldgIdxMod.value
  if (!mod || selectedBuildingIndex.value < 0) return null
  const idx = mod.getCockpitBuildingIndex()
  const b = idx.buildings[selectedBuildingIndex.value]
  if (!b) return null
  return mod.buildBuildingDetail(b, store)
})

const selectedEventBuilding = computed(() => {
  const mod = bldgIdxMod.value
  if (!mod || !selectedEvent.value) return null
  const { eventToBldg } = mod.buildEventBuildingMap(store.events)
  return eventToBldg.get(selectedEvent.value.id) || null
})

const emergencyInfo = computed(() => {
  void store.events.length
  void aidTick.value
  const mod = bldgIdxMod.value
  // 网格员侧栏始终可以查阅周边资源，地图覆盖范围由侧栏按钮独立控制。
  if (!mod || (!radiusActive.value && selectedEntity.value?.entityType !== 'staff')) return null
  const snapList = mapBase.value === 'city3d' && staffEngine ? staffEngine.getAll() : liveStaffList.value
  if (selectedBuildingDetail.value) {
    const b = selectedBuildingDetail.value.bldg
    return mod.queryEmergencyRadius(b.cx, b.cz, 30, store, snapList)
  }
  if (selectedEntity.value) {
    const ex = activeStaffTelemetry.value?.id === selectedEntity.value.id ? activeStaffTelemetry.value.x : selectedEntity.value.x
    const ez = activeStaffTelemetry.value?.id === selectedEntity.value.id ? activeStaffTelemetry.value.z : selectedEntity.value.z
    return mod.queryEmergencyRadius(ex, ez, 30, store, snapList)
  }
  if (selectedEvent.value) {
    const [ex, ez] = latLngToWorldXZ(selectedEvent.value.lat, selectedEvent.value.lng)
    return mod.queryEmergencyRadius(ex, ez, 30, store, snapList)
  }
  return null
})

async function handleSelectBuilding(bldg) {
  if (!bldg) return
  if (role.value.scope !== '全街道' && bldg.community !== role.value.scope) {
    showToast(`当前角色权限仅限查看「${role.value.scope}」楼栋`)
    return
  }
  try {
    await loadBldgIdxMod()
  } catch {
    showToast('楼栋空间索引加载异常，请刷新页面后重试')
    return
  }
  stopTour()
  resetStaffContext()
  narrowPanel.value = 'events'
  selectedBuildingIndex.value = bldg.index
  selectedEntity.value = null
  selectedEvent.value = null
  // 直接读取 selectedBuildingDetail computed，避免重复调用 buildBuildingDetail
  const detail = selectedBuildingDetail.value
  radiusActive.value = Boolean(detail && (detail.openEvents.length > 0 || detail.hazardCount > 0))
  addAuditLog(`三维驾驶舱穿透查阅「${bldg.name}」一楼一档`, '楼栋穿透')
}

async function handleSelectBuildingByIndex(bIdx) {
  const mod = await loadBldgIdxMod()
  const idx = mod.getCockpitBuildingIndex()
  const b = idx.buildings[bIdx]
  if (b) handleSelectBuilding(b)
}

function handleSelectEntity(ent) {
  if (!ent) return
  if (role.value.scope !== '全街道' && ent.community !== role.value.scope) {
    showToast(`当前角色权限仅限查看「${role.value.scope}」`)
    return
  }
  stopTour()
  if (ent.entityType !== 'staff') resetStaffContext()
  narrowPanel.value = 'events'
  const resolved = ent.entityType === 'staff'
    ? (staffEngine?.getById(ent.id) || ent)
    : ent
  selectedEntity.value = resolved
  selectedBuildingIndex.value = -1
  selectedEvent.value = null
  focusedFloor.value = null
  radiusActive.value = resolved.entityType === 'eco'
  if (resolved.entityType === 'staff') {
    staffLayerActive.value = true
    activeStaffTelemetry.value = resolved
    if (followStaffId.value !== resolved.id) stopFollowStaff()
  } else {
    followStaffId.value = ''
    activeStaffTelemetry.value = null
  }
}

function handleSelectEvent(ev) {
  if (!ev) return
  stopTour()
  resetStaffContext()
  narrowPanel.value = 'events'
  selectedEvent.value = ev
  selectedBuildingIndex.value = -1
  selectedEntity.value = null
  focusedFloor.value = null
  viewMode.value = 'dispatch'
  radiusActive.value = true
}

function handleResetPanorama() {
  resetStaffContext()
  if (role.value.scope === '全街道') {
    store.selectedCommunity = '全街道'
  }
  followStaffId.value = ''
  activeStaffTelemetry.value = null
  selectedBuildingIndex.value = -1
  selectedEntity.value = null
  selectedEvent.value = null
  focusedFloor.value = null
  radiusActive.value = false
}

function closeRightPenetration() {
  followStaffId.value = ''
  activeStaffTelemetry.value = null
  selectedBuildingIndex.value = -1
  selectedEntity.value = null
  focusedFloor.value = null
  radiusActive.value = false
}

function handleDispatchStaff({ staff, building }) {
  if (!staff) return
  const t = nowStr()
  // 优先分派当前选中的事件或该楼待受理/待派单事件
  let targetEv = selectedEvent.value
  if (!targetEv && building?.openEvents?.length) {
    targetEv = building.openEvents.find((e) => ['待受理', '待补充', '待派单'].includes(e.stage)) || building.openEvents[0]
  }
  if (targetEv) {
    targetEv.owner = `${staff.name}（${staff.community}${staff.grid}）`
    if (['待受理', '待补充', '待派单'].includes(targetEv.stage)) {
      targetEv.stage = '处置中'
    }
    targetEv.history.push({
      node: '驾驶舱就近三维派单',
      operator: `${role.value.userName}（${role.value.name}）`,
      detail: `基于 300 米空间联动圈就近分派至在岗网格员 ${staff.name}（距 ${staff.distMeters || 120} 米）现场核查处置`,
      time: t
    })
    const updatedSt = updateStaffStatus(staff.id, '在办处置', { task: targetEv.title })
    if (updatedSt && selectedEntity.value?.id === updatedSt.id) selectedEntity.value = updatedSt
    addAuditLog(`驾驶舱将「${targetEv.title}」就近派单至网格员 ${staff.name}`, '就近派单')
    showToast(`已派单给最近网格员「${staff.name}」，事件已转入处置中`)
    return
  }

  // 若该楼或该网格员当前无在办事项，直接生成一条就近巡查核验单并实时写回全站事件流
  const commObj = COMMUNITIES.find((c) => c.name === (building?.community || staff.community)) || COMMUNITIES[0]
  const newEv = {
    id: `ev-ck-${Date.now()}`,
    title: building ? `${building.title}现场专项巡查核验` : `${staff.community}${staff.grid}就近应急巡查任务`,
    category: '安全生产',
    subType: '高层楼道消防通道占用',
    community: building?.community || staff.community,
    grid: building?.bldg?.gridName || staff.grid,
    address: building ? `${building.community} · ${building.title}` : `${staff.community} · ${staff.grid}`,
    lat: staff.lat || commObj.center[0],
    lng: staff.lng || commObj.center[1],
    buildingIndex: building?.bldg?.index,
    reporter: role.value.userName,
    owner: `${staff.name}（${staff.community}${staff.grid}）`,
    stage: '处置中',
    urgency: '紧急',
    deadlineHours: 12,
    elapsedHours: 0.2,
    createdAt: t,
    description: `驾驶舱三维空间定位下发专项核查，由在岗网格员 ${staff.name} 就近到场核验并回传整改留痕。`,
    beforePhoto: buildScenePhoto({
      scene: 'before',
      title: building ? `${building.title}现场排查` : `${staff.community}网格核查`,
      location: building ? `${building.community} · ${building.title}` : staff.community,
      time: t,
      person: `网格员 ${staff.name}`
    }),
    afterPhoto: '',
    returnReason: '',
    reminded: false,
    history: [
      {
        node: '驾驶舱三维派单直达',
        operator: `${role.value.userName}（${role.value.name}）`,
        detail: `已通过三维驾驶舱就近分派至网格员 ${staff.name} 立即到场核查`,
        time: t
      }
    ]
  }
  store.events.unshift(newEv)
  if (selectedEntity.value?.entityType !== 'staff') radiusActive.value = true
  const updatedSt = updateStaffStatus(staff.id, '在办处置', { task: newEv.title })
  if (updatedSt && selectedEntity.value?.id === updatedSt.id) selectedEntity.value = updatedSt
  addAuditLog(`驾驶舱向网格员 ${staff.name} 派发「${newEv.title}」`, '三维派单')
  showToast(`已向网格员「${staff.name}」派发核查单，三维沙盘已同步标红`)
}

function handleCreateInspection(payload) {
  const t = nowStr()
  const commObj = COMMUNITIES.find((c) => c.name === payload.community) || COMMUNITIES[0]
  const newEv = {
    id: `ev-bldg-${Date.now()}`,
    title: payload.title,
    category: payload.category || '安全生产',
    subType: payload.category === '生态环保' ? '河湖漂浮物与易涝口淤堵' : '高层楼道消防通道占用',
    community: payload.community,
    grid: payload.grid || '第一网格',
    address: payload.address,
    lat: payload.lat || commObj.center[0],
    lng: payload.lng || commObj.center[1],
    buildingIndex: payload.buildingIndex,
    reporter: role.value.userName,
    owner: payload.assignee || '街道网格处置组',
    stage: '处置中',
    urgency: '紧急',
    deadlineHours: 12,
    elapsedHours: 0.1,
    createdAt: t,
    description: payload.description,
    beforePhoto: buildScenePhoto({
      scene: 'before',
      title: payload.title,
      location: payload.address,
      time: t,
      person: `${role.value.userName} 派发`
    }),
    afterPhoto: '',
    returnReason: '',
    reminded: false,
    history: [
      {
        node: '三维楼栋发起排查工单',
        operator: `${role.value.userName}（${role.value.name}）`,
        detail: `已精准锚定建筑并派发至 ${payload.assignee} 现场核查`,
        time: t
      }
    ]
  }
  store.events.unshift(newEv)
  if (selectedEntity.value?.entityType !== 'staff') radiusActive.value = true
  addAuditLog(`驾驶舱针对「${payload.address}」发起排查工单`, '三维派单')
  showToast(`排查工单已下发至「${payload.assignee}」，该楼已同步标红`)
}

function handleBorrowAid({ community, itemKey, itemLabel }) {
  const comm = COMMUNITIES.find((c) => c.name === community)
  if (!comm?.gov?.aidStation || comm.gov.aidStation[itemKey] <= 0) {
    showToast(`${community}共享辅助站「${itemLabel}」暂无可调库存`)
    return
  }
  comm.gov.aidStation[itemKey] -= 1
  aidTick.value += 1
  addAuditLog(`驾驶舱从「${community}共享辅助站」调拨 ${itemLabel} 1 件`, '物资调拨')
  showToast(`已登记调拨「${community}」${itemLabel} 1 件，剩余 ${comm.gov.aidStation[itemKey]} 件`)
}

function remindEvent(ev) {
  if (ev.reminded) return
  ev.reminded = true
  addAuditLog(`驾驶舱对「${ev.title}」发起督办提醒`, '督办提醒')
  showToast(`督办提醒已送达「${ev.community}」，待社区签收`)
}

async function openDrill(type, subFilter = '') {
  const mod = await import('../utils/drilldownData')
  if (isViewUnmounted) return
  const list = visibleComms.value
  const sc = scope.value
  if (type === 'pop') {
    drill.value = { open: true, ...mod.buildGridPopulationDrill(list, sc, 'pop') }
  } else if (type === 'party') {
    drill.value = { open: true, ...mod.buildPartyBranchDrill(list, sc) }
  } else if (type === 'special') {
    drill.value = { open: true, ...mod.buildSpecialGroupDrill(list, sc, subFilter) }
  } else if (type === 'housing') {
    drill.value = { open: true, ...mod.buildHousingDrill(list, sc, 'all') }
  } else if (type === 'economy') {
    drill.value = { open: true, ...mod.buildUnitResourceDrill(list, sc, 'large') }
  } else {
    drill.value = { open: true, ...mod.buildSafetyHazardsDrill(list, sc, '待销号整改') }
  }
  addAuditLog(`驾驶舱下钻查阅「${drill.value.title}」`, '明细下钻')
}

watch(isDark, syncBodyClass)
watch(mapBase, (val) => {
  if (val === 'city3d' && !city3dMounted.value) {
    city3dMounted.value = true
  }
  if (val !== 'city3d' && followStaffId.value) {
    followStaffId.value = ''
  }
})

onMounted(() => {
  isViewUnmounted = false
  prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // 进入驾驶舱一律默认恢复全街道「全景鸟瞰」，避免跨页缓存的社区锁定导致一进来就放大
  if (role.value.scope === '全街道') {
    store.selectedCommunity = '全街道'
  }
  selectedBuildingIndex.value = -1
  selectedEntity.value = null
  selectedEvent.value = null
  radiusActive.value = false
  syncBodyClass()
  document.addEventListener('pointerdown', onDocPointerDown, true)
  document.addEventListener('keydown', onDocKeydown)

  if (loaderVisible.value) {
    if (mapBase.value === 'city3d') {
      watchdogTimer = setTimeout(() => {
        triggerPreviewFallback('正在载入三维沙盘静态视图')
      }, LOAD_TIMEOUT_MS)
    } else {
      loaderSceneReady.value = true
      loaderTargetProgress.value = 100
    }
  } else {
    // 二次切回大屏：跳过进度页，短暂等待 WebGL 首帧预热稳住后立即播三幕渐进动画
    revisitSafetyTimer = setTimeout(() => {
      beginReveal()
    }, 1200)
  }
})

onBeforeUnmount(() => {
  isViewUnmounted = true
  clearEntranceTimers()
  clearInterval(tourTimer)
  tweenRafs.forEach((id) => cancelAnimationFrame(id))
  tweenRafs.clear()
  if (glazeRaf !== null) {
    cancelAnimationFrame(glazeRaf)
    glazeRaf = null
  }
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  document.removeEventListener('keydown', onDocKeydown)
  document.body.classList.remove('view-cockpit', 'cockpit-dark')
})
</script>

<template>
  <div
    class="ck-shell"
    :class="{
      'is-pre-enter': entrancePhase === 'pre',
      'is-revealing': entrancePhase === 'revealing',
      'is-dark': isDark,
      'is-theater': theaterMode,
      'is-following': Boolean(followStaffId),
      'has-penetration': hasRightPenetration
    }"
  >
    <!-- 全屏资源预加载等待序幕（长河街道真实疆域脉络测绘 + 实时阶段光轨进度条） -->
    <CockpitLoader
      :visible="loaderVisible"
      :target-progress="loaderTargetProgress"
      :scene-ready="loaderSceneReady"
      :min-curtain-ms="fromLoginHandoff ? 2100 : MIN_CURTAIN_MS"
      :hold-ms="fromLoginHandoff ? 380 : CURTAIN_HOLD_MS"
      :dark="isDark"
      :from-login="fromLoginHandoff"
      :fallback-notice="loaderFallbackNotice"
      @reveal-ready="beginReveal"
    />

    <!-- 顶部 68px 三段对称指挥导航栏：左双态切 ｜ 中大标题居中放大 ｜ 右工具与管理工作台 -->
    <header class="ck-header ck-header-center">
      <div class="ck-head-left">
        <div class="ck-nav-tabs" role="navigation" aria-label="驾驶舱模式切换">
          <button type="button" :class="{ active: viewMode === 'report' }" @click="switchToReport">汇报叙事态</button>
          <button type="button" :class="{ active: viewMode === 'dispatch' }" @click="switchToDispatch">日常调度态</button>
        </div>
        <div class="ck-head-ops">
          <button
            type="button"
            class="ck-btn ck-btn-op"
            title="搜索社区、楼栋、网格员或治理事项"
            @click="searchOpen = true"
          >
            <Search :size="14" />
            <span>空间检索</span>
          </button>
          <button
            type="button"
            class="ck-btn ck-btn-op ck-btn-theater"
            :class="{ active: theaterMode }"
            :title="theaterMode ? '恢复完整数据驾驶舱' : '收拢两侧面板沉浸看城'"
            @click="toggleTheaterMode"
          >
            <component :is="theaterMode ? PanelLeftOpen : PanelLeftClose" :size="14" />
            <span>{{ theaterMode ? '退出沉浸' : '沉浸剧场' }}</span>
          </button>
          <button
            type="button"
            class="ck-btn ck-btn-op ck-btn-staff-entry"
            :class="{ active: showStaffDirectory }"
            :aria-expanded="showStaffDirectory"
            title="查看当前辖区在岗网格员名录"
            @click="showStaffDirectory ? closeStaffDirectory() : openStaffDirectory()"
          >
            <Users :size="15" aria-hidden="true" />
            <span>网格员</span>
            <em v-if="staffRosterReady" class="ck-op-badge num">{{ staffCounts.total }}</em>
          </button>
        </div>
      </div>

      <div class="ck-brand ck-brand-center">
        <!-- 中央弹性实色琉璃冠冕主体（两侧等比飞翼绝对锚定并重叠 2px，彻底杜绝任何缝隙） -->
        <div class="ck-crest-body">
          <svg class="ck-crest-wing is-left" width="68" height="60" viewBox="0 0 68 60" preserveAspectRatio="xMaxYMin meet" aria-hidden="true">
            <defs>
              <linearGradient id="ckWingFill" x1="50%" y1="0%" x2="50%" y2="100%">
                <stop offset="0%" stop-color="var(--ck-crest-fill-top)" />
                <stop offset="58%" stop-color="var(--ck-crest-fill-mid)" />
                <stop offset="100%" stop-color="var(--ck-crest-fill-bot)" />
              </linearGradient>
              <linearGradient id="ckWingStroke" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="var(--ck-crest-stroke-edge)" stop-opacity="0.32" />
                <stop offset="45%" stop-color="var(--ck-crest-stroke-edge)" stop-opacity="0.92" />
                <stop offset="100%" stop-color="var(--ck-crest-stroke-mid)" stop-opacity="1" />
              </linearGradient>
            </defs>
            <path d="M 0,0 L 70,0 L 70,58 L 60,58 C 35,58 25,9 0,1.5 Z" fill="url(#ckWingFill)" />
            <path d="M 10,6 C 31,15 39,53 60,53 L 70,53" fill="none" stroke="var(--ck-crest-inner)" stroke-width="1" />
            <path d="M 1,1.5 C 26,9.5 35,58 60,58 L 70,58" fill="none" stroke="url(#ckWingStroke)" stroke-width="1.6" stroke-linecap="round" />
            <polygon points="60,54.5 63.5,58 60,61.5 56.5,58" fill="var(--ck-crest-keystone)" />
          </svg>

          <div class="ck-brand-inner">
            <div class="ck-logo-pedestal">
              <BrandLogo :size="36" />
            </div>
            <div class="ck-title-group">
              <h1>
                <span class="ck-title-main">长河街道</span>
                <span class="ck-title-sep" aria-hidden="true"></span>
                <span class="ck-title-sub">智慧社区综合治理驾驶舱</span>
              </h1>
            </div>
          </div>

          <svg class="ck-crest-wing is-right" width="68" height="60" viewBox="0 0 68 60" preserveAspectRatio="xMaxYMin meet" aria-hidden="true">
            <path d="M 0,0 L 70,0 L 70,58 L 60,58 C 35,58 25,9 0,1.5 Z" fill="url(#ckWingFill)" />
            <path d="M 10,6 C 31,15 39,53 60,53 L 70,53" fill="none" stroke="var(--ck-crest-inner)" stroke-width="1" />
            <path d="M 1,1.5 C 26,9.5 35,58 60,58 L 70,58" fill="none" stroke="url(#ckWingStroke)" stroke-width="1.6" stroke-linecap="round" />
            <polygon points="60,54.5 63.5,58 60,61.5 56.5,58" fill="var(--ck-crest-keystone)" />
          </svg>
        </div>
      </div>

      <div class="ck-tools">
        <button
          ref="presetBtnEl"
          type="button"
          class="ck-preset-trigger"
          :class="{ open: presetMenuOpen }"
          :aria-expanded="presetMenuOpen"
          aria-haspopup="listbox"
          title="切换配色方案"
          @click="togglePresetMenu"
        >
          <i :style="{ background: `linear-gradient(135deg, ${currentPreset.sw1} 52%, ${currentPreset.sw2} 52%)` }"></i>
          <span>配色</span>
          <ChevronDown :size="13" class="ck-preset-caret" />
        </button>
        <Teleport to="body">
          <Transition name="ck-pop">
            <div
              v-if="presetMenuOpen"
              class="ck-preset-menu"
              :class="{ 'is-dark': isDark }"
              role="listbox"
              aria-label="配色方案"
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
        <CockpitClock />
        <button type="button" class="ck-btn primary" @click="router.push('/portal')">
          <span>管理工作台</span>
          <ArrowRight :size="15" />
        </button>
        <button
          type="button"
          class="ck-btn sq"
          :title="isDark ? '切换浅色大屏' : '切换深色大屏'"
          @click="toggleCockpitLightDark($event)"
        >
          <component :is="isDark ? Sun : Moon" :size="16" />
        </button>
        <button
          type="button"
          class="ck-btn sq ck-btn-tour"
          :class="{ active: tourRunning }"
          :title="tourRunning ? '暂停五章巡演' : '开启五章汇报巡演'"
          @click="toggleTour"
        >
          <component :is="tourRunning ? Pause : Play" :size="15" />
        </button>
        <button type="button" class="ck-btn sq ck-btn-fullscreen" title="全屏展示" @click="toggleFullscreen">
          <Maximize2 :size="15" />
        </button>
      </div>
    </header>

    <!-- 满铺实景地图 + 满载实效双悬浮玻璃轨 -->
    <main class="ck-stage" :data-panel="narrowPanel">
      <!-- 窄屏地图态左上角辖区切换按钮（点击弹起 14 社区快捷选择器，桌面端隐藏） -->
      <button
        type="button"
        class="ck-mobile-scope-btn"
        :aria-expanded="mobileCommOpen"
        @click="mobileCommOpen = true"
      >
        <span class="ck-msb-dot" :class="{ active: scope !== '全街道' }"></span>
        <span>{{ scope === '全街道' ? '全街道 · 14 社区' : scope }}</span>
        <ChevronDown :size="13" />
      </button>

      <!-- 窄屏贴底常驻三视图导航栏（地图 / 辖区数据 / 治理事项，桌面端隐藏） -->
      <nav class="ck-narrow-panels ck-nav-tabs" aria-label="驾驶舱内容">
        <button
          v-for="item in NARROW_PANEL_TABS"
          :key="item.key"
          type="button"
          :class="{ active: narrowPanel === item.key }"
          :aria-pressed="narrowPanel === item.key"
          @click="narrowPanel = item.key; mobileCommOpen = false"
        >
          <span>{{ item.label }}</span>
          <em v-if="item.key === 'events' && stats.openEvents.length > 0" class="ck-np-badge num">{{ stats.openEvents.length }}</em>
        </button>
      </nav>

      <!-- 窄屏 14 社区快捷底部选择抽屉（桌面端隐藏） -->
      <div
        v-if="mobileCommOpen"
        class="ck-mobile-comm-scrim"
        @click="mobileCommOpen = false"
      >
        <section class="ck-mobile-comm-sheet" role="dialog" aria-modal="true" aria-label="切换辖区社区" @click.stop>
          <header class="ck-mcs-head">
            <strong>切换辖区视角（{{ COMMUNITIES.length }} 个社区）</strong>
            <button type="button" class="ck-mcs-close" aria-label="关闭" @click="mobileCommOpen = false">
              <X :size="16" />
            </button>
          </header>
          <div class="ck-mcs-grid">
            <button
              type="button"
              class="ck-comm-mini is-all-anchor"
              :class="{ active: scope === '全街道' }"
              :disabled="role.scope !== '全街道'"
              @click="handleResetPanorama(); mobileCommOpen = false"
            >
              <span>全街道总览</span>
              <strong class="num">{{ COMMUNITIES.length }} 个社区</strong>
            </button>
            <button
              v-for="c in COMMUNITIES"
              :key="'m-' + c.id"
              type="button"
              class="ck-comm-mini"
              :class="['h-' + c.health, 'lv-' + commLevel(c), { active: scope === c.name }]"
              :disabled="role.scope !== '全街道' && role.scope !== c.name"
              @click="toggleCommunityLock(c.name); mobileCommOpen = false"
            >
              <span class="c14-name">
                <i class="c14-dot" :class="'d-' + commLevel(c)"></i>{{ shortName(c.name) }}
              </span>
              <strong class="num">{{ commChipText(c) }}</strong>
            </button>
          </div>
        </section>
      </div>
      <div class="ck-map-layer">
        <ChangheCity3D
          v-if="city3dMounted"
          v-show="mapBase === 'city3d'"
          ref="city3dRef"
          mode="cockpit"
          :get-staff-engine="getStaffEngine"
          :get-staff-engine-async="getStaffEngineAsync"
          :dark="isDark"
          :paused="mapBase !== 'city3d'"
          :selected-community="scope"
          :hovered-community="hoveredComm"
          :slice="activeSlice"
          :chapter-index="activeChapter"
          :events="scopedEvents"
          :narrow-panel-open="narrowPanel !== 'map'"
          :cockpit-view-mode="viewMode"
          :selected-building-index="selectedBuildingIndex"
          :selected-entity-id="selectedEntity?.id || ''"
          :selected-event-id="selectedEvent?.id || ''"
          :emergency-info="radiusActive ? emergencyInfo : null"
          :focused-floor="focusedFloor"
          :theater-mode="theaterMode"
          :tour-running="tourRunning"
          :external-loader="loaderVisible || entrancePhase === 'pre'"
          :defer-reveal="entrancePhase === 'pre'"
          :labels-visible="city3dLabelsVisible"
          v-model:staff-layer-active="staffLayerActive"
          :staff-community-counts="staffCommunityCounts"
          :staff-status-focus="staffStatusFilter"
          :follow-staff-id="followStaffId"
          :follow-altitude="followAltitude"
          @select-community="toggleCommunityLock"
          @select-staff-community="openCommunityStaff"
          @select-event="handleSelectEvent"
          @select-building="handleSelectBuilding"
          @select-entity="handleSelectEntity"
          @reset-panorama="handleResetPanorama"
          @load-progress="handleCityLoadProgress"
          @scene-ready="handleCitySceneReady"
          @webgl-fallback="handleCityWebglFallback"
          @hover-community="mapHoverComm = $event"
          @stop-follow="stopFollowStaff"
          @staff-roster-ready="onStaffRosterReady"
          @staff-live-tick="onStaffLiveTick"
        />
        <div v-if="mapBase === 'preview'" class="ck-model-preview">
          <img :src="previewRoot + previewPose + (isDark ? '-night.webp' : '-day.webp')" :alt="previewViews[previewPose] + '三维模型静态视图'" />
          <div class="ck-preview-controls ck-nav-tabs" role="group" aria-label="模型预览视角">
            <span>模型静态预览</span>
            <button v-for="(label, key) in previewViews" :key="key" type="button" :class="{ active: previewPose === key }"
              :aria-pressed="previewPose === key" @click="previewPose = key">{{ label }}</button>
          </div>
        </div>
        <GeoMap
          v-if="mapBase !== 'city3d' && mapBase !== 'preview'"
          ref="geoMapRef"
          mode="cockpit"
          :base-mode="mapBase"
          :dark="isDark"
          :selected-community="scope"
          :hovered-community="hoveredComm"
          :slice="activeSlice"
          :events="scopedEvents"
          :focus-coord="focusCoord"
          :live-staff="scopedLiveStaff"
          :staff-layer-active="staffLayerActive"
          :staff-community-counts="staffCommunityCounts"
          :staff-status-focus="staffStatusFilter"
          :selected-staff-id="selectedEntity?.entityType === 'staff' ? selectedEntity.id : ''"
          @select-community="toggleCommunityLock"
          @select-event="handleSelectEvent"
          @select-staff="handleSelectEntity"
          @select-staff-community="openCommunityStaff"
        />
      </div>

      <!-- 顶部悬浮 6 枚独立核心指标卡片 + 五章汇报导览 + 当前章核心结论微横幅 -->
      <div class="ck-map-topbar">
        <section class="ck-kpi-grid" aria-label="辖区六大核心指标">
          <button
            v-for="(item, kIdx) in kpiCards"
            :key="item.key"
            type="button"
            class="ck-kpi-card"
            :style="{ '--kpi-tone': item.tone, '--kpi-idx': kIdx }"
            :title="item.tip"
            @pointermove="onKpiPointerMove"
            @click="item.action()"
          >
            <div class="ck-kpi-head">
              <span class="ck-kpi-icon"><component :is="item.icon" :size="13" /></span>
              <span class="ck-kpi-label">{{ item.label }}</span>
              <ChevronRight class="ck-kpi-arrow" :size="12" />
            </div>
            <strong class="ck-kpi-val num">
              {{ item.value }}<small>{{ item.unit }}</small>
            </strong>
            <span class="ck-kpi-sub num">{{ item.sub }}</span>
          </button>
        </section>

        <div class="ck-map-toprow">
          <div class="ck-glass-bar" role="group" aria-label="五章汇报导览">
            <button
              v-for="(ch, idx) in CHAPTERS"
              :key="ch.id"
              type="button"
              class="ck-pill"
              :title="ch.label"
              :class="{ active: activeChapter === idx && viewMode === 'report' }"
              @click="viewMode = 'report'; selectChapter(idx)"
            >
              {{ ch.short }}
              <i
                v-if="tourRunning && activeChapter === idx && viewMode === 'report'"
                :key="'tp-' + idx"
                class="ck-tour-progress"
                :style="{ animationDuration: TOUR_MS + 'ms' }"
                aria-hidden="true"
              ></i>
            </button>
          </div>
        </div>

        <div class="ck-chapter-brief" role="status">
          <span class="ck-brief-badge">{{ viewMode === 'report' ? '专题研判' : '日常调度' }}</span>
          <span class="ck-brief-text">
            {{ viewMode === 'report' ? chapterConclusion : `当前在办事项 ${stats.openEvents.length} 件${stats.overdueCnt ? `，其中已超时 ${stats.overdueCnt} 件` : ''}，点击地图热区或左侧待办即可穿透处置与督办。` }}
          </span>
          <button
            v-if="scope !== '全街道' && role.scope === '全街道'"
            type="button"
            class="ck-brief-reset"
            title="复位查看全街道"
            @click="handleResetPanorama"
          >
            <span>已锁定：{{ scope }}</span>
            <X :size="11" />
          </button>
          <div v-else class="ck-brief-health num">
            <span><i class="c14-dot d-lead"></i>标杆 {{ stats.healthCounts.lead }}</span>
            <span><i class="c14-dot d-ok"></i>平稳 {{ stats.healthCounts.ok }}</span>
            <span><i class="c14-dot d-warn"></i>关注 {{ stats.healthCounts.warn }}</span>
            <span><i class="c14-dot d-bad"></i>督办 {{ stats.healthCounts.bad }}</span>
          </div>
        </div>

        <div
          v-if="staffLayerActive && mapBase !== 'preview' && !(followStaffId && theaterMode)"
          class="ck-staff-summary"
          role="group"
          aria-label="网格员状态"
        >
          <button
            v-for="item in STAFF_FILTERS" :key="item.status" type="button"
            class="ck-staff-filter" :class="{ active: staffStatusFilter === item.status }"
            :style="{ '--staff-tone': item.tone }" :aria-pressed="staffStatusFilter === item.status"
            :aria-label="(item.status === 'all' ? '全员' : item.status) + '名录'"
            @click="openStaffDirectory(item.status)"
          >
            <i v-if="item.status !== 'all'" aria-hidden="true"></i>
            <Users v-else :size="13" aria-hidden="true" />
            {{ item.label }} <b class="num">{{ staffRosterReady ? staffCounts[item.key] : '—' }}</b>
          </button>
          <button type="button" class="ck-staff-directory-toggle" :aria-expanded="showStaffDirectory"
            :title="showStaffDirectory ? '收起网格员名录' : '打开网格员名录'"
            @click="showStaffDirectory ? closeStaffDirectory() : openStaffDirectory(staffStatusFilter)">
            名录 <ChevronRight :size="12" aria-hidden="true" />
          </button>
        </div>
      </div>

      <!-- 右下角悬浮图层与四态沙盘/底图切换（三维沙盘时隐藏冗余图层大钮，由左下角图例精准控制） -->
      <div class="ck-map-fab">
        <button
          v-if="mapBase !== 'preview' && mapBase !== 'city3d'"
          type="button"
          class="ck-fab-btn"
          :class="{ active: staffLayerActive }"
          :aria-pressed="staffLayerActive"
          @click="staffLayerActive = !staffLayerActive"
        >
          网格员图层
        </button>
        <button v-if="mapBase !== 'preview' && mapBase !== 'city3d'" type="button" class="ck-fab-btn" :class="{ active: activeSlice === 'eco' }" :aria-pressed="activeSlice === 'eco'" @click="activeSlice = activeSlice === 'eco' ? 'safety' : 'eco'">
          防汛防火图层
        </button>
        <div class="ck-base-seg" role="group" aria-label="切换驾驶舱底图">
          <button type="button" :class="{ active: mapBase === 'city3d' || mapBase === 'preview' }" @click="mapBase = 'city3d'">三维沙盘</button>
          <button type="button" :class="{ active: mapBase === 'gov' }" @click="mapBase = 'gov'">政务图</button>
          <button type="button" :class="{ active: mapBase === 'aerial' }" @click="mapBase = 'aerial'">卫星影像</button>
          <button type="button" :class="{ active: mapBase === 'street' }" @click="mapBase = 'street'">电子路网</button>
        </div>
      </div>

      <!-- 左悬浮轨：4 大饱满实效数据板块（随 14 社区与五章全量动态联动） -->
      <aside class="ck-rail ck-rail-left ck-dense-rail">
        <template v-if="viewMode === 'report'">
          <div class="ck-rail-title ck-tight-title">
            <span class="ck-title-plaque">
              <span class="ck-title-plaque-body">
                <i class="ck-title-emblem" aria-hidden="true"></i>
                <span class="ck-title-text">人口结构与重点关怀</span>
              </span>
              <svg class="ck-title-tail" width="20" height="27" viewBox="0 0 20 27" aria-hidden="true">
                <path d="M 0,0 L 14,0 L 4,27 L 0,27 Z" fill="var(--ck-plaque-bg-end)" />
                <path d="M 0,0.6 L 14,0.6 L 4,26.4" fill="none" stroke="var(--ck-plaque-rim)" stroke-width="1.1" stroke-linejoin="round" />
                <line x1="17.8" y1="0.8" x2="8.2" y2="26.2" stroke="var(--ck-plaque-slash)" stroke-width="1.6" stroke-linecap="round" />
              </svg>
            </span>
            <button type="button" class="ck-mini-link" @click="openDrill('special')">{{ scope }} · 明细 ›</button>
          </div>

          <!-- 板块 1：人口结构环 + 四类重点关怀底数 -->
          <section class="ck-block ck-tight-block">
            <div class="ck-ring-wrap ck-ring-compact">
              <div class="ck-ring-box-sm" @mouseleave="hoveredPopSeg = ''">
                <svg viewBox="0 0 88 88" width="82" height="82" aria-hidden="true">
                  <circle cx="44" cy="44" r="35" fill="none" stroke="rgba(160,160,160,0.16)" stroke-width="8" />
                  <circle
                    cx="44" cy="44" r="35" fill="none" stroke="var(--chart-1)"
                    class="ck-ring-arc"
                    :class="{ active: hoveredPopSeg === 'youth', dimmed: hoveredPopSeg && hoveredPopSeg !== 'youth' }"
                    :stroke-width="hoveredPopSeg === 'youth' ? 10.5 : 8"
                    :stroke-dasharray="`${ringArcs.y} ${RING_C}`"
                    transform="rotate(-90 44 44)"
                    @mouseenter="hoveredPopSeg = 'youth'"
                  />
                  <circle
                    cx="44" cy="44" r="35" fill="none" stroke="var(--chart-2)"
                    class="ck-ring-arc"
                    :class="{ active: hoveredPopSeg === 'elder', dimmed: hoveredPopSeg && hoveredPopSeg !== 'elder' }"
                    :stroke-width="hoveredPopSeg === 'elder' ? 10.5 : 8"
                    :stroke-dasharray="`${ringArcs.e} ${RING_C}`"
                    :stroke-dashoffset="-ringArcs.y"
                    transform="rotate(-90 44 44)"
                    @mouseenter="hoveredPopSeg = 'elder'"
                  />
                  <circle
                    cx="44" cy="44" r="35" fill="none" stroke="var(--chart-3)"
                    class="ck-ring-arc"
                    :class="{ active: hoveredPopSeg === 'teen', dimmed: hoveredPopSeg && hoveredPopSeg !== 'teen' }"
                    :stroke-width="hoveredPopSeg === 'teen' ? 10.5 : 8"
                    :stroke-dasharray="`${ringArcs.t} ${RING_C}`"
                    :stroke-dashoffset="-(ringArcs.y + ringArcs.e)"
                    transform="rotate(-90 44 44)"
                    @mouseenter="hoveredPopSeg = 'teen'"
                  />
                </svg>
                <div class="ck-ring-center">
                  <strong class="num" style="font-size: 19px" :style="popRingCenter.color ? { color: popRingCenter.color } : null">{{ popRingCenter.pct }}<small style="font-size: 10px">%</small></strong>
                  <span style="font-size: 10px">{{ popRingCenter.label }}</span>
                </div>
              </div>
              <div class="ck-legend-list" style="gap: 4px; font-size: 11.5px" @mouseleave="hoveredPopSeg = ''">
                <div class="ck-pop-lg-row" :class="{ active: hoveredPopSeg === 'youth' }" @mouseenter="hoveredPopSeg = 'youth'"><i style="background: var(--chart-1)"></i><span>中青年</span><strong class="num">{{ shownNum(tw.youth) }}%</strong></div>
                <div class="ck-pop-lg-row" :class="{ active: hoveredPopSeg === 'elder' }" @mouseenter="hoveredPopSeg = 'elder'"><i style="background: var(--chart-2)"></i><span>老年人</span><strong class="num">{{ shownNum(tw.elder) }}%</strong></div>
                <div class="ck-pop-lg-row" :class="{ active: hoveredPopSeg === 'teen' }" @mouseenter="hoveredPopSeg = 'teen'"><i style="background: var(--chart-3)"></i><span>在校生</span><strong class="num">{{ shownNum(tw.teen) }}%</strong></div>
                <div class="ck-legend-foot"><span style="white-space: nowrap">户籍 {{ stats.hukouPct }}%</span><span style="white-space: nowrap">格均 {{ stats.avgPerGrid.toLocaleString() }} 人</span></div>
              </div>
            </div>

            <div class="ck-quad-strip">
              <button type="button" class="ck-quad-cell" style="--cell-tone: var(--ck-warn)" title="点击下钻独居高龄建档明细" @click="openDrill('special', '独居高龄')">
                <span>独居高龄</span>
                <strong class="num">{{ shownNum(tw.elderAlone) }}</strong>
              </button>
              <button type="button" class="ck-quad-cell" style="--cell-tone: var(--chart-2)" title="点击下钻低保特困建档明细" @click="openDrill('special', '低保特困')">
                <span>低保特困</span>
                <strong class="num">{{ shownNum(tw.lowIncome) }}</strong>
              </button>
              <button type="button" class="ck-quad-cell" style="--cell-tone: var(--chart-5)" title="点击下钻持证残障帮扶明细" @click="openDrill('special', '持证残障')">
                <span>残障帮扶</span>
                <strong class="num">{{ shownNum(tw.disabled) }}</strong>
              </button>
              <button type="button" class="ck-quad-cell" style="--cell-tone: var(--primary)" title="点击下钻重点优抚对象明细" @click="openDrill('special', '重点优抚')">
                <span>重点优抚</span>
                <strong class="num">{{ shownNum(tw.veteran) }}</strong>
              </button>
            </div>
          </section>

          <!-- 板块 2：房屋资产与经济主体脉动 -->
          <section class="ck-block ck-tight-block">
            <button type="button" class="ck-block-head" @click="openDrill('economy')">
              <span class="ck-block-label">房屋资产与经济脉动</span>
              <span class="ck-block-note num">{{ stats.buildings }} 栋 · 物业 {{ stats.avgPropertyRate }}%</span>
            </button>
            <div class="ck-share-bar" title="房屋居住结构：自住 / 出租 / 空置">
              <i :style="{ width: stats.selfPct + '%', background: 'var(--chart-2)' }"></i>
              <i :style="{ width: stats.rentPct + '%', background: 'var(--chart-3)' }"></i>
              <i :style="{ width: stats.vacantPct + '%', background: 'var(--chart-5)' }"></i>
            </div>
            <div class="ck-bar-caption num">
              <span><i style="background: var(--chart-2)"></i>自住 <b>{{ stats.selfPct }}%</b></span>
              <span><i style="background: var(--chart-3)"></i>出租 <b>{{ stats.rentPct }}%</b></span>
              <span><i style="background: var(--chart-5)"></i>空置 <b>{{ stats.vacantPct }}%</b></span>
            </div>
            <div class="ck-trio-compact">
              <button type="button" class="ck-mini-stat" style="--cell-tone: var(--chart-4)" @click="openDrill('economy')">
                <span>规上企业</span>
                <strong class="num">{{ shownNum(tw.largeEnt) }}<small>家</small></strong>
              </button>
              <button type="button" class="ck-mini-stat" style="--cell-tone: var(--primary)" @click="openDrill('economy')">
                <span>规上产值</span>
                <strong class="num">{{ shownNum(tw.revenue, 1) }}<small>亿</small></strong>
              </button>
              <button type="button" class="ck-mini-stat" style="--cell-tone: var(--chart-5)" @click="openDrill('economy')">
                <span>吸纳就业</span>
                <strong class="num">{{ shownNum(tw.employeesWan, 2) }}<small>万</small></strong>
              </button>
            </div>
          </section>

          <!-- 板块 3：当前汇报章 · 专题实数 + 全街道排行（随五章交叉淡入切换，排行按剩余高度整条适配） -->
          <section class="ck-block ck-tight-block ck-chapter-block">
            <div class="ck-block-head">
              <span class="ck-block-label">{{ currentChapterObj.label }}</span>
              <span class="ck-block-note">{{ rankBoard.note }}</span>
            </div>

            <Transition name="ck-swap" mode="out-in" :duration="{ enter: 760, leave: 150 }">
              <div :key="activeChapter" class="ck-chapter-body">
                <div v-if="activeChapter === 0" class="ck-trio-compact">
                  <div class="ck-mini-stat" style="--cell-tone: var(--primary)"><span>基层支部</span><strong class="num">{{ stats.branches }}<small>个</small></strong></div>
                  <div class="ck-mini-stat" style="--cell-tone: var(--chart-2)"><span>网格力量</span><strong class="num">{{ stats.gridStaff + stats.publicPost }}<small>人</small></strong></div>
                  <div class="ck-mini-stat" style="--cell-tone: var(--chart-3)"><span>共驻单位</span><strong class="num">{{ stats.coBuild }}<small>家</small></strong></div>
                </div>
                <div v-else-if="activeChapter === 1" class="ck-dual-compact">
                  <div class="ck-mini-stat" style="--cell-tone: var(--ck-ok)"><span>安全检查覆盖率</span><strong class="num">{{ stats.avgCoverage }}<small>%</small></strong></div>
                  <div class="ck-mini-stat" style="--cell-tone: var(--chart-2)"><span>政务抽查合格率</span><strong class="num">{{ stats.avgGovPass }}<small>%</small></strong></div>
                </div>
                <div v-else-if="activeChapter === 2" class="ck-dual-compact">
                  <div class="ck-mini-stat" style="--cell-tone: var(--ck-warn)"><span>重点监管企业</span><strong class="num">{{ stats.regEnt }}<small>家</small></strong></div>
                  <div class="ck-mini-stat" style="--cell-tone: var(--ck-ok)"><span>隐患整改销号率</span><strong class="num">{{ stats.fixRate }}<small>%</small></strong></div>
                </div>
                <div v-else-if="activeChapter === 3" class="ck-quad-strip">
                  <div class="ck-quad-cell" style="--cell-tone: var(--ck-run)"><span>易涝点</span><strong class="num">{{ stats.floodPts }}</strong></div>
                  <div class="ck-quad-cell" style="--cell-tone: var(--ck-danger)"><span>防火点</span><strong class="num">{{ stats.firePts }}</strong></div>
                  <div class="ck-quad-cell" style="--cell-tone: var(--chart-2)"><span>河道公里</span><strong class="num">{{ stats.riversKm }}</strong></div>
                  <div class="ck-quad-cell" style="--cell-tone: var(--chart-5)"><span>裸土万㎡</span><strong class="num">{{ stats.bareSoilWan }}</strong></div>
                </div>
                <template v-else>
                  <div class="ck-aid-grid">
                    <div class="ck-mini-stat" style="--cell-tone: var(--chart-2)"><span>轮椅</span><strong class="num">{{ stats.aidDetail.wheelchair }}</strong></div>
                    <div class="ck-mini-stat" style="--cell-tone: var(--chart-3)"><span>拐杖</span><strong class="num">{{ stats.aidDetail.crutch }}</strong></div>
                    <div class="ck-mini-stat" style="--cell-tone: var(--primary)"><span>急救箱</span><strong class="num">{{ stats.aidDetail.medkit }}</strong></div>
                    <div class="ck-mini-stat" style="--cell-tone: var(--chart-4)"><span>工具箱</span><strong class="num">{{ stats.aidDetail.toolbox }}</strong></div>
                    <div class="ck-mini-stat" style="--cell-tone: var(--chart-5)"><span>爱心伞</span><strong class="num">{{ stats.aidDetail.umbrella }}</strong></div>
                  </div>
                  <p class="ck-note-p">{{ stats.commCount }} 处共享辅助站在库物资合计 <b class="num">{{ stats.aidItems }}</b> 件，楼栋档案内可就近调拨。</p>
                </template>

                <div ref="rankListEl" class="ck-rank-list ck-rank-fit">
                  <button
                    v-for="(r, rIdx) in rankRowsShown"
                    :key="r.c.id"
                    type="button"
                    class="ck-rank-row"
                    :class="{ 'is-scope': r.isScope, 'is-clipped': rIdx >= rankFit }"
                    :tabindex="rIdx >= rankFit ? -1 : 0"
                    @click="toggleCommunityLock(r.c.name)"
                  >
                    <span class="ck-rank-no num">{{ r.rank }}</span>
                    <span class="ck-rank-name">{{ shortName(r.c.name) }}</span>
                    <span class="ck-cat-track"><i :style="{ width: r.pct + '%', background: r.color }"></i></span>
                    <b class="num" :style="activeChapter === 1 ? { color: r.color } : null">{{ r.text }}</b>
                  </button>
                </div>
              </div>
            </Transition>
          </section>

          <!-- 板块 4：基层减负「数据直达」宽表采集脉搏（锁定社区时仅显示分派至本社区的任务） -->
          <section class="ck-block ck-tight-block">
            <button type="button" class="ck-block-head" @click="router.push('/data-direct')">
              <span class="ck-block-label">数据直达 · 一表通减负</span>
              <span class="ck-accent-pill num">{{ scope === '全街道' ? '归并减负 78% ›' : '本社区配额 ›' }}</span>
            </button>
            <div class="ck-direct-list">
              <button
                v-for="(t, tIdx) in stats.directTasks"
                :key="t.id"
                type="button"
                class="ck-direct-item"
                :title="`${t.title}（${t.done}/${t.total} 条 · ${t.pct}%）`"
                :style="{ '--task-tone': t.pct >= 100 ? 'var(--ck-ok)' : (tIdx === 0 ? 'var(--chart-2)' : 'var(--primary)') }"
                @click="router.push('/data-direct')"
              >
                <div class="ck-direct-top">
                  <span>{{ t.title }}</span>
                  <b class="num">{{ t.done }}/{{ t.total }} 条 · <em>{{ t.pct }}%</em></b>
                </div>
                <div class="ck-cat-track">
                  <i :style="{ width: Math.max(t.pct, 4) + '%', background: 'var(--task-tone)' }"></i>
                </div>
              </button>
              <div v-if="!stats.directTasks.length" class="ck-empty-card">
                <span class="ck-empty-badge">无待采</span>
                <div class="ck-empty-body">
                  <strong>{{ scope }}本期无分派的宽表采集任务</strong>
                  <span>街道各科室下发任务后将在此同步进度</span>
                </div>
              </div>
            </div>
          </section>
        </template>
        <!-- 日常调度态：左轨展示治理待办，巡防入口打开右轨名录 -->
        <template v-else>
          <div class="ck-rail-title ck-tight-title">
            <span class="ck-title-plaque">
              <span class="ck-title-plaque-body">
                <i class="ck-title-emblem" aria-hidden="true"></i>
                <span class="ck-title-text">急难愁盼待办</span>
              </span>
              <svg class="ck-title-tail" width="20" height="27" viewBox="0 0 20 27" aria-hidden="true">
                <path d="M 0,0 L 14,0 L 4,27 L 0,27 Z" fill="var(--ck-plaque-bg-end)" />
                <path d="M 0,0.6 L 14,0.6 L 4,26.4" fill="none" stroke="var(--ck-plaque-rim)" stroke-width="1.1" stroke-linejoin="round" />
                <line x1="17.8" y1="0.8" x2="8.2" y2="26.2" stroke="var(--ck-plaque-slash)" stroke-width="1.6" stroke-linecap="round" />
              </svg>
            </span>
            <button type="button" class="ck-mini-link ck-patrol-link" @click="openStaffDirectory()">
              <Users :size="13" aria-hidden="true" /> 巡防名录
            </button>
          </div>

          <div class="ck-trio-compact ck-dispatch-trio">
            <div class="ck-mini-stat" style="--cell-tone: var(--ck-danger)"><span>受理派单</span><strong class="num">{{ stats.acceptDispatch }}</strong></div>
            <div class="ck-mini-stat" style="--cell-tone: var(--ck-warn)"><span>办理复核</span><strong class="num">{{ stats.handleReview }}</strong></div>
            <div class="ck-mini-stat" :style="{ '--cell-tone': stats.overdueCnt ? 'var(--ck-danger)' : 'var(--ck-ok)' }"><span>已超时</span><strong class="num">{{ stats.overdueCnt }}</strong></div>
          </div>
          <TransitionGroup tag="div" name="ck-list" class="ck-live-list ck-dispatch-list">
            <button
              v-for="ev in dispatchEvents"
              :key="ev.id"
              type="button"
              class="ck-live-item"
              :title="`${ev.title}（${ev.community} · 已耗 ${fmtHours(ev.elapsedHours)}/${ev.deadlineHours} 小时）`"
              :class="{ 'is-selected': selectedEvent?.id === ev.id, 'is-fresh': freshIds.has(ev.id) }"
              @click="handleSelectEvent(ev)"
            >
              <span class="ck-live-dot" :style="{ background: stageDotColor(ev) }"></span>
              <div class="ck-live-body">
                <span class="ck-live-title">{{ ev.title }}</span>
                <span class="ck-live-sub num">{{ ev.community }} · 已耗 {{ fmtHours(ev.elapsedHours) }}/{{ ev.deadlineHours }} 小时</span>
                <span class="ck-sla-track" aria-hidden="true">
                  <i :style="{ width: Math.min(100, Math.round((Number(ev.elapsedHours) / Math.max(0.1, Number(ev.deadlineHours))) * 100)) + '%', background: stageDotColor(ev) }"></i>
                </span>
              </div>
              <span class="tag" :class="stageTagClass(ev)">{{ isOverdue(ev) ? '已超时' : ev.stage }}</span>
            </button>
            <div v-if="!dispatchEvents.length" key="empty" class="ck-empty">当前范围内暂无在办事项</div>
          </TransitionGroup>
          <section v-if="recentDoneEvents.length" class="ck-block ck-tight-block ck-fill-block">
            <div class="ck-block-head">
              <span class="ck-block-label">近期办结</span>
              <span class="ck-block-note num">已结 {{ stats.doneCnt }} 件 · 均 {{ stats.avgHours }} 小时</span>
            </div>
            <div ref="doneListEl" class="ck-live-list ck-live-compact ck-fit-list">
              <button
                v-for="(e, dIdx) in recentDoneEvents"
                :key="e.id"
                type="button"
                class="ck-live-item"
                :title="`${e.title}（${e.community} · 用时 ${fmtHours(e.elapsedHours)} 小时）`"
                :class="{ 'is-clipped': dIdx >= doneFit }"
                :tabindex="dIdx >= doneFit ? -1 : 0"
                @click="handleSelectEvent(e)"
              >
                <span class="ck-live-dot" style="background: var(--ck-ok)"></span>
                <div class="ck-live-body">
                  <span class="ck-live-title">{{ e.title }}</span>
                  <span class="ck-live-sub num">{{ e.community }} · {{ e.category }} · 用时 {{ fmtHours(e.elapsedHours) }} 小时</span>
                </div>
                <span class="tag st-ok">已办结</span>
              </button>
            </div>
          </section>
        </template>
      </aside>

      <!-- 右悬浮轨：楼栋一楼一档 / 实体调度 / 事项穿透 / 默认全闭环统计 -->
      <aside class="ck-rail ck-rail-right ck-dense-rail">
        <section v-if="showStaffDirectory" class="ck-staff-directory" aria-label="网格员名录">
          <header class="ck-directory-head">
            <div>
              <h2>网格员名录</h2>
              <p>{{ scope }} · {{ staffStatusFilter === 'all' ? '全部状态' : staffStatusFilter }}<span v-if="staffRosterReady"> · {{ filteredLiveStaff.length }} 人</span></p>
            </div>
            <button type="button" class="ck-directory-close" aria-label="关闭网格员名录" @click="closeStaffDirectory">
              <X :size="15" />
            </button>
          </header>
          <div class="ck-directory-filters" role="group" aria-label="名录状态">
            <button v-for="item in STAFF_FILTERS" :key="item.status" type="button" class="ck-staff-filter"
              :class="{ active: staffStatusFilter === item.status }" :style="{ '--staff-tone': item.tone }"
              :aria-pressed="staffStatusFilter === item.status" @click="openStaffDirectory(item.status)">
              {{ item.label }} <b class="num">{{ staffRosterReady ? staffCounts[item.key] : '—' }}</b>
            </button>
          </div>
          <label class="ck-directory-search">
            <Search :size="15" aria-hidden="true" />
            <input v-model="staffSearch" type="search" placeholder="搜索姓名、社区或网格" aria-label="搜索姓名、社区或网格" />
          </label>
          <div class="ck-staff-roster">
            <button v-for="st in filteredLiveStaff" :key="st.id" type="button" class="ck-staff-row"
              :class="{ 'is-alert-row': st.status === '滞留提醒', 'is-busy-row': st.status === '在办处置' }"
              @click="handleSelectEntity(st)">
              <i class="ck-staff-row-dot" aria-hidden="true"></i>
              <span class="ck-staff-identity">
                <b>{{ st.name }}</b>
                <small>{{ shortName(st.community) }} · {{ st.grid }}</small>
              </span>
              <span class="ck-staff-duty">{{ st.status === '滞留提醒' && st.stayMinutes != null ? '滞留 ' + st.stayMinutes + ' 分' : st.status }}</span>
              <ChevronRight :size="12" aria-hidden="true" />
            </button>
            <div v-if="!filteredLiveStaff.length" class="ck-empty">
              {{ !staffRosterReady ? '正在加载网格员名录' : staffSearch.trim() ? '未找到匹配的网格员' : '当前范围内暂无该状态的网格员' }}
            </div>
          </div>
        </section>
        <BuildingProfilePanel
          v-else-if="selectedBuildingDetail || selectedEntity"
          :building-detail="selectedBuildingDetail"
          :entity-detail="selectedEntity"
          :emergency-info="emergencyInfo"
          :radius-active="radiusActive"
          :can-follow="city3dMounted"
          :staff-from-directory="staffDirectoryOpen"
          :is-following="Boolean(followStaffId && selectedEntity?.id === followStaffId)"
          :live-telemetry="activeStaffTelemetry?.id === selectedEntity?.id ? activeStaffTelemetry : null"
          @close="closeRightPenetration"
          @toggle-radius="radiusActive = !radiusActive"
          @dispatch-staff="handleDispatchStaff"
          @create-inspection="handleCreateInspection"
          @borrow-aid="handleBorrowAid"
          @select-building-index="handleSelectBuildingByIndex"
          @select-event="handleSelectEvent"
          @focus-floor="focusedFloor = $event"
          @view-staff-close="viewStaffClose"
          @toggle-follow="toggleFollowStaff"
          @supervise-staff="handleSuperviseStaff"
        />

        <template v-else-if="viewMode === 'dispatch' && selectedEvent">
          <div class="ck-rail-title ck-tight-title">
            <span class="ck-title-plaque">
              <span class="ck-title-plaque-body">
                <i class="ck-title-emblem" aria-hidden="true"></i>
                <span class="ck-title-text">事项处置穿透卡</span>
              </span>
              <svg class="ck-title-tail" width="20" height="27" viewBox="0 0 20 27" aria-hidden="true">
                <path d="M 0,0 L 14,0 L 4,27 L 0,27 Z" fill="var(--ck-plaque-bg-end)" />
                <path d="M 0,0.6 L 14,0.6 L 4,26.4" fill="none" stroke="var(--ck-plaque-rim)" stroke-width="1.1" stroke-linejoin="round" />
                <line x1="17.8" y1="0.8" x2="8.2" y2="26.2" stroke="var(--ck-plaque-slash)" stroke-width="1.6" stroke-linecap="round" />
              </svg>
            </span>
            <div class="ck-title-actions">
              <span class="tag" :class="stageTagClass(selectedEvent)">{{ isOverdue(selectedEvent) ? '已超时' : selectedEvent.stage }}</span>
              <button
                type="button"
                class="ck-mini-link"
                title="关闭穿透卡"
                @click="selectedEvent = null; radiusActive = false"
              >
                <X :size="13" />
              </button>
            </div>
          </div>
          <section class="ck-block ck-tight-block ck-ev-card">
            <strong class="ck-ev-title">{{ selectedEvent.title }}</strong>
            <span class="ck-ev-meta">{{ selectedEvent.address || selectedEvent.community }}</span>
            <div class="ck-ev-facts num">
              <span>{{ selectedEvent.category }}</span>
              <span>责任人 {{ selectedEvent.owner || '待派单' }}</span>
              <span :class="{ 'is-bad': isOverdue(selectedEvent) }">已耗 {{ fmtHours(selectedEvent.elapsedHours) }}/{{ selectedEvent.deadlineHours }} 小时</span>
            </div>
            <p class="ck-ev-desc">{{ selectedEvent.description }}</p>
            <EvidencePhoto
              :src="selectedEvent.beforePhoto"
              :title="selectedEvent.title"
              tone="before"
              :location="selectedEvent.address || selectedEvent.community"
              :time="selectedEvent.createdAt"
              :person="`网格员 ${selectedEvent.reporter}`"
              :compact="true"
              class="ck-ev-photo"
            />
            <EvidencePhoto
              v-if="selectedEvent.afterPhoto"
              :src="selectedEvent.afterPhoto"
              :title="`${selectedEvent.title} · 整改验收`"
              tone="after"
              :location="selectedEvent.address || selectedEvent.community"
              :time="selectedEvent.history[selectedEvent.history.length - 1]?.time || selectedEvent.createdAt"
              :person="selectedEvent.owner || '街道处置组'"
              :compact="true"
              class="ck-ev-photo"
            />
            <div v-if="emergencyInfo?.nearbyStaff?.[0]" class="ck-emg-mini">
              <div>
                <strong>{{ emergencyInfo.nearbyStaff[0].distMeters <= 300 ? '300 米内最近网格员' : '最近在岗网格员' }} · {{ emergencyInfo.nearbyStaff[0].name }}</strong>
                <span class="num">距 {{ emergencyInfo.nearbyStaff[0].distMeters }} 米 · 周边独居楼 {{ emergencyInfo.careBuildingsTotal }} 栋</span>
              </div>
              <button
                type="button"
                class="ck-mini-link ck-inline-icon"
                @click="handleDispatchStaff({ staff: emergencyInfo.nearbyStaff[0] })"
              >
                <Send :size="11" /> 派单
              </button>
            </div>
            <div class="ck-ev-actions">
              <button
                v-if="selectedEventBuilding"
                type="button"
                class="ck-btn"
                @click="handleSelectBuilding(selectedEventBuilding)"
              >
                <Building2 :size="12" /> 查事发楼
              </button>
              <button type="button" class="ck-btn" :disabled="selectedEvent.reminded || selectedEvent.stage === '已办结'" @click="remindEvent(selectedEvent)">
                <Bell :size="12" /> {{ selectedEvent.reminded ? '已督办' : '督办' }}
              </button>
              <button type="button" class="ck-btn primary" @click="router.push('/grid')">
                研判台 <ChevronRight :size="12" />
              </button>
            </div>
          </section>
          <section v-if="selectedTimeline.length" class="ck-block ck-tight-block ck-fill-block">
            <div class="ck-block-head">
              <span class="ck-block-label">处置进程</span>
              <span class="ck-block-note num">共 {{ selectedTimeline.length }} 个节点</span>
            </div>
            <ol ref="timelineEl" class="ck-timeline ck-fit-list">
              <li
                v-for="(h, hIdx) in selectedTimeline"
                :key="hIdx + h.time"
                :class="{ 'is-latest': hIdx === 0, 'is-clipped': hIdx >= timelineFit }"
              >
                <div class="ck-tl-head">
                  <strong>{{ h.node }}</strong>
                  <span class="num">{{ String(h.time).slice(5, 16) }}</span>
                </div>
                <p>{{ h.detail }}</p>
              </li>
            </ol>
          </section>
        </template>

        <template v-else>
          <div class="ck-rail-title ck-tight-title">
            <span class="ck-title-plaque">
              <span class="ck-title-plaque-body">
                <i class="ck-title-emblem" aria-hidden="true"></i>
                <span class="ck-title-text">治理事件全闭环</span>
              </span>
              <svg class="ck-title-tail" width="20" height="27" viewBox="0 0 20 27" aria-hidden="true">
                <path d="M 0,0 L 14,0 L 4,27 L 0,27 Z" fill="var(--ck-plaque-bg-end)" />
                <path d="M 0,0.6 L 14,0.6 L 4,26.4" fill="none" stroke="var(--ck-plaque-rim)" stroke-width="1.1" stroke-linejoin="round" />
                <line x1="17.8" y1="0.8" x2="8.2" y2="26.2" stroke="var(--ck-plaque-slash)" stroke-width="1.6" stroke-linecap="round" />
              </svg>
            </span>
            <span class="live-dot-badge">实时联动</span>
          </div>

          <!-- 板块 1：按期办结率弧形精工仪表 + 三态实时槽 -->
          <section class="ck-block ck-tight-block">
            <div class="ck-gauge-row">
              <div class="ck-gauge-box">
                <svg viewBox="0 0 84 48" width="84" height="48" aria-hidden="true">
                  <defs>
                    <linearGradient id="ckRateArcGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stop-color="var(--primary)" />
                      <stop offset="55%" stop-color="var(--chart-2)" />
                      <stop offset="100%" stop-color="var(--ck-ok)" />
                    </linearGradient>
                  </defs>
                  <!-- 精细外刻度虚线 -->
                  <path
                    d="M 4,41 A 38,38 0 0,1 80,41"
                    fill="none"
                    stroke="var(--ck-line)"
                    stroke-width="1.2"
                    stroke-dasharray="2 3.5"
                  />
                  <!-- 半圆底轨 -->
                  <path
                    d="M 7,41 A 35,35 0 0,1 77,41"
                    fill="none"
                    stroke="rgba(160, 160, 160, 0.16)"
                    stroke-width="6"
                    stroke-linecap="round"
                  />
                  <!-- 渐变弧线进度 -->
                  <path
                    d="M 7,41 A 35,35 0 0,1 77,41"
                    fill="none"
                    stroke="url(#ckRateArcGrad)"
                    stroke-width="6"
                    stroke-linecap="round"
                    :stroke-dasharray="`${rateGaugeDash} ${GAUGE_ARC}`"
                  />
                </svg>
                <div class="ck-gauge-val">
                  <strong class="num">{{ stats.rateExact === '—' ? '—' : shownNum(tw.rate, 1) }}<small v-if="stats.rateExact !== '—'">%</small></strong>
                </div>
              </div>
              <div class="ck-gauge-meta">
                <span class="ck-gauge-title">按期办结率</span>
                <span class="ck-block-note num">已结 {{ stats.doneCnt }}/{{ stats.events.length }} 件</span>
                <span class="ck-block-note num">平均处置 {{ stats.avgHours }} 小时</span>
              </div>
            </div>
            <div class="ck-stat-trio">
              <button type="button" class="ck-stat-cell ck-stat-sm" style="--cell-tone: var(--ck-danger)" @click="router.push('/grid')">
                <strong class="num">{{ stats.acceptDispatch }}</strong>
                <span>受理派单</span>
              </button>
              <button type="button" class="ck-stat-cell ck-stat-sm" style="--cell-tone: var(--ck-warn)" @click="router.push('/grid')">
                <strong class="num">{{ stats.handleReview }}</strong>
                <span>办理复核</span>
              </button>
              <button type="button" class="ck-stat-cell ck-stat-sm" style="--cell-tone: var(--ck-ok)" @click="router.push('/grid')">
                <strong class="num">{{ stats.doneCnt }}</strong>
                <span>已办结</span>
              </button>
            </div>
            <!-- 近 7 日受理 / 办结微趋势曲线 -->
            <div class="ck-trend-box" @mouseleave="hoveredTrendIdx = -1">
              <div class="ck-trend-head">
                <span>近 7 日闭环趋势</span>
                <span v-if="hoveredTrendIdx >= 0 && trendChart.pts[hoveredTrendIdx]" class="ck-trend-readout num">
                  {{ trendChart.pts[hoveredTrendIdx].label }} · 受理 {{ trendChart.pts[hoveredTrendIdx].intake }} / 办结 {{ trendChart.pts[hoveredTrendIdx].closed }}
                </span>
                <span v-else class="ck-trend-legend">
                  <i><b style="background: var(--primary)"></b>受理</i>
                  <i><b style="background: var(--ck-ok)"></b>办结</i>
                </span>
              </div>
              <svg
                class="ck-trend-svg"
                :viewBox="`0 0 ${trendChart.width} ${trendChart.height}`"
                preserveAspectRatio="none"
                aria-label="近七日受理与办结趋势"
              >
                <defs>
                  <linearGradient id="ckTrendInFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.22" />
                    <stop offset="100%" stop-color="var(--primary)" stop-opacity="0.01" />
                  </linearGradient>
                  <linearGradient id="ckTrendClFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="var(--ck-ok)" stop-opacity="0.24" />
                    <stop offset="100%" stop-color="var(--ck-ok)" stop-opacity="0.01" />
                  </linearGradient>
                </defs>
                <path v-if="trendChart.intakeArea" :d="trendChart.intakeArea" fill="url(#ckTrendInFill)" />
                <path v-if="trendChart.closedArea" :d="trendChart.closedArea" fill="url(#ckTrendClFill)" />
                <path v-if="trendChart.intakePath" :d="trendChart.intakePath" fill="none" stroke="var(--primary)" stroke-width="1.5" stroke-linecap="round" />
                <path v-if="trendChart.closedPath" :d="trendChart.closedPath" fill="none" stroke="var(--ck-ok)" stroke-width="1.5" stroke-linecap="round" />
                <line
                  v-if="hoveredTrendIdx >= 0 && trendChart.pts[hoveredTrendIdx]"
                  :x1="trendChart.pts[hoveredTrendIdx].x"
                  :x2="trendChart.pts[hoveredTrendIdx].x"
                  y1="3"
                  :y2="trendChart.height - 4"
                  stroke="var(--ck-border)"
                  stroke-dasharray="2 2"
                  stroke-width="1"
                />
                <g v-for="(pt, pIdx) in trendChart.pts" :key="pt.iso">
                  <circle
                    v-if="hoveredTrendIdx === pIdx"
                    :cx="pt.x" :cy="pt.yIn" r="2.8" fill="var(--primary)"
                  />
                  <circle
                    v-if="hoveredTrendIdx === pIdx"
                    :cx="pt.x" :cy="pt.yCl" r="2.8" fill="var(--ck-ok)"
                  />
                  <rect
                    :x="pt.x - 16"
                    y="0"
                    width="32"
                    :height="trendChart.height"
                    fill="transparent"
                    style="cursor: crosshair"
                    @mouseenter="hoveredTrendIdx = pIdx"
                  />
                </g>
              </svg>
            </div>
          </section>

          <!-- 板块 2：四类事件构成分布（点击可筛选下方列表） -->
          <section class="ck-block ck-tight-block">
            <div class="ck-block-head">
              <span class="ck-block-label">事件四类构成</span>
              <button v-if="activeCategoryFilter" type="button" class="ck-mini-link" @click="activeCategoryFilter = ''">清除筛选</button>
              <span v-else class="ck-block-note num">共 {{ stats.events.length }} 件</span>
            </div>
            <div class="ck-cat-list" style="gap: 5px">
              <button
                v-for="cat in stats.categoryStats"
                :key="cat.name"
                type="button"
                class="ck-cat-row ck-cat-btn"
                :class="{ active: activeCategoryFilter === cat.name }"
                :style="{ '--cat-tone': cat.color }"
                @click="toggleCategoryFilter(cat.name)"
              >
                <span class="ck-cat-name"><i :style="{ background: cat.color }"></i>{{ cat.name }}</span>
                <span class="ck-cat-track"><i :style="{ width: (cat.count ? Math.max(cat.pct, 8) : 0) + '%', background: cat.color }"></i></span>
                <b class="num" :style="cat.count ? { color: cat.color } : null">{{ cat.count }}</b>
              </button>
            </div>
          </section>

          <!-- 板块 3：实时急难愁盼与最新闭环流（自然高度不强撑，使下方警网联勤自然上浮对齐左栏） -->
          <section class="ck-block ck-tight-block ck-fill-block">
            <button type="button" class="ck-block-head" @click="router.push('/grid')">
              <span class="ck-block-label">{{ activeCategoryFilter ? `${activeCategoryFilter}事项` : '近期治理事项' }}</span>
              <span class="ck-mini-link num">研判台 ›</span>
            </button>
            <TransitionGroup ref="liveListEl" tag="div" name="ck-list" class="ck-live-list ck-live-compact ck-fit-list">
              <button
                v-for="(e, eIdx) in filteredStreamEvents"
                :key="e.id"
                type="button"
                class="ck-live-item"
                :title="`${e.title}（${e.community} · ${e.category} · ${isOverdue(e) ? '已超时' : e.stage}）`"
                :class="{ 'is-selected': selectedEvent?.id === e.id, 'is-fresh': freshIds.has(e.id), 'is-clipped': eIdx >= liveFit }"
                :tabindex="eIdx >= liveFit ? -1 : 0"
                @click="handleSelectEvent(e)"
              >
                <span class="ck-live-dot" :style="{ background: stageDotColor(e) }"></span>
                <div class="ck-live-body">
                  <span class="ck-live-title">{{ e.title }}</span>
                  <span class="ck-live-sub num">{{ e.community }} · {{ e.category }} · {{ String(e.createdAt).slice(5, 16) }}</span>
                </div>
                <span class="tag" :class="stageTagClass(e)">{{ isOverdue(e) ? '已超时' : e.stage }}</span>
              </button>
            </TransitionGroup>
          </section>

          <!-- 板块 4：警网联勤快报 / 数字武装战备底数 双切微看板 -->
          <section class="ck-block ck-tight-block">
            <div class="ck-block-head">
              <div class="ck-sub-tabs">
                <button type="button" :class="{ active: rightFootTab === 'police' }" @click="rightFootTab = 'police'">警网联勤</button>
                <button type="button" :class="{ active: rightFootTab === 'armed' }" @click="rightFootTab = 'armed'">数字武装</button>
              </div>
              <button
                type="button"
                class="ck-mini-link"
                @click="router.push(rightFootTab === 'police' ? '/data-hub' : '/armed-forces')"
              >
                详情 ›
              </button>
            </div>

            <div v-if="rightFootTab === 'police'" class="ck-police-list">
              <div v-for="pa in stats.policeList.slice(0, 2)" :key="pa.id" class="ck-police-item">
                <div class="ck-police-top">
                  <span class="ck-police-type">{{ pa.type }}</span>
                  <span>{{ pa.community }} · {{ pa.time.slice(5) }}</span>
                  <b class="ck-police-st">{{ pa.status }}</b>
                </div>
                <p>{{ pa.summary }}</p>
              </div>
              <div v-if="!stats.policeList.length" class="ck-empty-card">
                <span class="ck-empty-badge">平安稳定</span>
                <div class="ck-empty-body">
                  <strong>{{ scope }}今日零警情联勤通报</strong>
                  <span>辖区网格与派出所联勤巡防正常开展中</span>
                </div>
              </div>
            </div>

            <div v-else class="ck-quad-strip">
              <button type="button" class="ck-quad-cell" style="--cell-tone: var(--primary)" @click="router.push('/armed-forces')">
                <span>基干民兵</span>
                <strong class="num">{{ stats.armed.militia }}</strong>
              </button>
              <button type="button" class="ck-quad-cell" style="--cell-tone: var(--chart-2)" @click="router.push('/armed-forces')">
                <span>兵役登记</span>
                <strong class="num">{{ stats.armed.recruitReg }}</strong>
              </button>
              <button type="button" class="ck-quad-cell" style="--cell-tone: var(--chart-3)" title="全街道在册退役军人服务建档总数" @click="router.push('/armed-forces')">
                <span>退役军人</span>
                <strong class="num">{{ stats.armed.veterans.toLocaleString() }}</strong>
              </button>
              <button type="button" class="ck-quad-cell" style="--cell-tone: var(--chart-5)" @click="router.push('/armed-forces')">
                <span>国防宣教</span>
                <strong class="num">{{ stats.armed.eduCount }}场</strong>
              </button>
            </div>
          </section>
        </template>
      </aside>

      <!-- 底部悬浮条：14 社区实体浮坞（左主锚 + 右 14 等分社区格） -->
      <section class="ck-collect-bar ck-14-strip" aria-label="长河街道14社区治理体感带">
        <button
          type="button"
          class="ck-comm-mini is-all-anchor"
          :class="{ active: scope === '全街道' }"
          :disabled="role.scope !== '全街道'"
          @click="handleResetPanorama"
        >
          <span>全街道总览</span>
          <strong class="num">{{ COMMUNITIES.length }} 个社区</strong>
        </button>
        <div class="c14-divider" aria-hidden="true"></div>
        <div class="c14-grid">
          <button
            v-for="(c, cIdx) in COMMUNITIES"
            :key="c.id"
            type="button"
            class="ck-comm-mini"
            :class="['h-' + c.health, 'lv-' + commLevel(c), { active: scope === c.name, 'is-map-hover': mapHoverComm === c.name }]"
            :style="{ '--comm-idx': cIdx }"
            :disabled="role.scope !== '全街道' && role.scope !== c.name"
            @mouseenter="hoveredComm = c.name"
            @mouseleave="hoveredComm = ''"
            @click="toggleCommunityLock(c.name)"
          >
            <span class="c14-name">
              <i class="c14-dot" :class="'d-' + commLevel(c)"></i>{{ shortName(c.name) }}
            </span>
            <strong class="num">{{ commChipText(c) }}</strong>
          </button>
        </div>
      </section>

      <!-- 底部极细低空跟拍播控胶囊 -->
      <div
        v-if="followStaffObj && mapBase === 'city3d'"
        class="ck-follow-capsule"
        role="region"
        aria-label="网格员实时低空跟拍控制"
      >
        <div class="ck-fc-who">
          <i
            class="ck-fc-dot"
            :class="{ 'is-alert': followStaffObj.status === '滞留提醒', 'is-busy': followStaffObj.status === '在办处置' }"
          ></i>
          <strong>{{ followStaffObj.name }}</strong>
          <span class="ck-fc-status">{{ followStaffObj.status === '滞留提醒' && followStaffObj.stayMinutes ? '滞留' + followStaffObj.stayMinutes + '分钟' : followStaffObj.status }}</span>
          <span class="ck-fc-grid">{{ shortName(followStaffObj.community) }} · {{ followStaffObj.grid }}</span>
          <span class="ck-fc-sep" aria-hidden="true"></span>
          <span class="ck-fc-road" :title="followStaffObj.roadLabel">{{ followStaffObj.roadLabel }}</span>
        </div>
        <div class="ck-fc-ops">
          <div class="ck-fc-step">
            <button type="button" title="上一位网格员" @click="stepFollowStaff(-1)">
              <ChevronLeft :size="13" />
              <span>上一位</span>
            </button>
            <button type="button" title="下一位网格员" @click="stepFollowStaff(1)">
              <span>下一位</span>
              <ChevronRight :size="13" />
            </button>
          </div>
          <div class="ck-fc-alt" role="group" aria-label="跟拍视角高度">
            <button type="button" :class="{ active: followAltitude === 'low' }" @click="followAltitude = 'low'">低空穿行</button>
            <button type="button" :class="{ active: followAltitude === 'mid' }" @click="followAltitude = 'mid'">街区中景</button>
          </div>
          <button type="button" class="ck-tb-btn" @click="toggleTheaterMode">
            <component :is="theaterMode ? PanelLeftOpen : PanelLeftClose" :size="12" />
            <span>{{ theaterMode ? '展开双轨' : '收拢双轨' }}</span>
          </button>
          <button type="button" class="ck-tb-btn is-exit" @click="stopFollowStaff">
            <X :size="12" />
            <span>退出跟拍</span>
          </button>
        </div>
      </div>

      <!-- 纯净剧场沉浸态底部微字幕条（仅保留专题结论、五章快速切换与退出沉浸按钮） -->
      <div v-if="!followStaffId" class="ck-theater-bar" role="status" aria-label="沉浸剧场导览">
        <span class="ck-tb-badge">{{ currentChapterObj.short }}</span>
        <span class="ck-tb-text">{{ chapterConclusion }}</span>
        <div class="ck-tb-dots" role="group" aria-label="切换汇报章节">
          <button
            v-for="(ch, cIdx) in CHAPTERS"
            :key="'tb-' + ch.id"
            type="button"
            :title="ch.label"
            :class="{ active: activeChapter === cIdx }"
            @click="viewMode = 'report'; selectChapter(cIdx)"
          >
            {{ ch.short.slice(0, 2) }}
          </button>
        </div>
        <button type="button" class="ck-tb-btn" @click="toggleTour">
          <component :is="tourRunning ? Pause : Play" :size="12" />
          <span>{{ tourRunning ? '暂停' : '巡演' }}</span>
        </button>
        <button type="button" class="ck-tb-btn is-exit" @click="theaterMode = false">
          <PanelLeftOpen :size="12" />
          <span>退出沉浸</span>
        </button>
      </div>
    </main>

    <SpatialSearchModal
      :open="searchOpen"
      :dark="isDark"
      :load-bldg-idx="loadBldgIdxMod"
      @close="searchOpen = false"
      @select="handleSpatialSelect"
    />

    <DrilldownDrawer
      :open="drill.open"
      :title="drill.title"
      :subtitle="drill.subtitle"
      :summary-text="drill.summary"
      :filters="drill.filters"
      :columns="drill.columns"
      :rows="drill.rows"
      :export-name="drill.exportName"
      :sensitive-name="Boolean(drill.sensitiveName)"
      @close="drill = { ...drill, open: false }"
    />
  </div>
</template>

<style scoped>
.ck-dense-rail {
  padding: 13px 15px !important;
  border-color: var(--ck-border) !important;
  box-shadow:
    inset 0 2px 0 var(--ck-rail-top-bar),
    var(--e3),
    var(--ck-edge) !important;
}
/* 双悬浮轨四角 8px 建筑测绘角标（纯 CSS 多重背景，零额外 DOM 与发光球） */
.ck-dense-rail::before {
  content: '';
  position: absolute;
  inset: 4px;
  border-radius: calc(var(--r-card, 10px) - 3px);
  pointer-events: none;
  z-index: 5;
  opacity: 0.72;
  background:
    linear-gradient(var(--ck-plaque-rim, var(--primary)), var(--ck-plaque-rim, var(--primary))) left top / 8px 1.2px no-repeat,
    linear-gradient(var(--ck-plaque-rim, var(--primary)), var(--ck-plaque-rim, var(--primary))) left top / 1.2px 8px no-repeat,
    linear-gradient(var(--ck-plaque-rim, var(--primary)), var(--ck-plaque-rim, var(--primary))) right top / 8px 1.2px no-repeat,
    linear-gradient(var(--ck-plaque-rim, var(--primary)), var(--ck-plaque-rim, var(--primary))) right top / 1.2px 8px no-repeat,
    linear-gradient(var(--ck-plaque-rim, var(--primary)), var(--ck-plaque-rim, var(--primary))) left bottom / 8px 1.2px no-repeat,
    linear-gradient(var(--ck-plaque-rim, var(--primary)), var(--ck-plaque-rim, var(--primary))) left bottom / 1.2px 8px no-repeat,
    linear-gradient(var(--ck-plaque-rim, var(--primary)), var(--ck-plaque-rim, var(--primary))) right bottom / 8px 1.2px no-repeat,
    linear-gradient(var(--ck-plaque-rim, var(--primary)), var(--ck-plaque-rim, var(--primary))) right bottom / 1.2px 8px no-repeat;
}

/* 3D 舞台暗夜四周景深微暗角，收拢视线聚焦中央城市场景 */
.ck-shell.is-dark .ck-map-layer::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 8;
  background: radial-gradient(ellipse 68% 64% at 50% 52%, transparent 56%, rgba(4, 7, 14, 0.42) 100%);
}

/* ── 侧轨一级轨顶主标题：实色朱印斜切铭牌（等比 SVG 斜尾 + 单条鎏金切线 + 红金渐隐底线） ── */
.ck-tight-title {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 6px;
  padding: 0 !important;
  margin-bottom: 6px;
  font-size: 14px !important;
}
.ck-tight-title::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1.5px;
  background: linear-gradient(
    90deg,
    var(--ck-plaque-rule-a) 0%,
    var(--ck-plaque-rule-a) 38%,
    var(--ck-plaque-rule-b) 66%,
    var(--ck-line) 88%,
    transparent 100%
  );
  pointer-events: none;
}
.ck-tight-title > :not(.ck-title-plaque) {
  padding-bottom: 5px;
  white-space: nowrap;
  flex-shrink: 0;
}

.ck-title-plaque {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: stretch;
  height: 27px;
  min-width: 0;
  filter: drop-shadow(0 2px 5px color-mix(in srgb, var(--ck-plaque-bg-end) 24%, transparent));
}
.ck-title-plaque-body {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 27px;
  padding: 0 5px 0 9px;
  min-width: 0;
  border-radius: 4px 0 0 0;
  background: linear-gradient(90deg, var(--ck-plaque-bg-start) 0%, var(--ck-plaque-bg-end) 100%);
  border-top: 1px solid var(--ck-plaque-rim);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
}
.ck-title-tail {
  display: block;
  width: 20px;
  height: 27px;
  margin-left: -1px;
  flex-shrink: 0;
  pointer-events: none;
}

.ck-title-emblem {
  position: relative;
  width: 11px;
  height: 11px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ck-title-emblem::before {
  content: '';
  position: absolute;
  inset: 0.5px;
  transform: rotate(45deg);
  border-radius: 1.5px;
  border: 1.1px solid var(--ck-plaque-emblem-ring);
  background: rgba(255, 255, 255, 0.12);
}
.ck-title-emblem::after {
  content: '';
  position: relative;
  width: 4px;
  height: 4px;
  transform: rotate(45deg);
  border-radius: 0.8px;
  background: var(--ck-plaque-emblem-core);
}

.ck-title-text {
  font-size: 13px;
  font-weight: 740;
  letter-spacing: 0.025em;
  color: var(--ck-plaque-ink);
  text-shadow: 0 1px 1px rgba(48, 4, 8, 0.25);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── 侧轨二级板块标题：去脏粉贴纸，洁净雪瓷底 + 3px 实色竖印 + 局部短脊刻度线 ── */
.ck-tight-block {
  border-top: 0 !important;
  padding: 8px 0 4px !important;
  gap: 7px !important;
}

.ck-tight-block .ck-block-head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 24px;
  padding: 0 0 6px;
  margin-bottom: 3px;
}
.ck-tight-block button.ck-block-head {
  cursor: pointer;
}
.ck-tight-block .ck-block-head::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background: linear-gradient(90deg, var(--ck-line) 0%, color-mix(in srgb, var(--ck-line) 42%, transparent) 100%);
  pointer-events: none;
}
.ck-tight-block .ck-block-head > :not(.ck-block-label):not(.ck-sub-tabs) {
  white-space: nowrap;
  flex-shrink: 0;
}

.ck-tight-block .ck-block-label {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0;
  font-size: 12.5px;
  font-weight: 720;
  letter-spacing: 0.015em;
  color: var(--ck-ink);
  white-space: nowrap;
  min-width: 0;
  transition: color var(--d-fade) ease;
}
.ck-tight-block .ck-block-label::before {
  content: '';
  width: 3px;
  height: 12px;
  border-radius: 1.5px;
  background: linear-gradient(180deg, var(--ck-subhead-anchor) 0%, var(--primary) 100%);
  flex-shrink: 0;
}
.ck-tight-block .ck-block-label::after {
  content: '';
  position: absolute;
  left: 0;
  right: -8px;
  bottom: -6px;
  height: 2px;
  z-index: 1;
  background: linear-gradient(90deg, var(--ck-subhead-anchor) 0%, var(--ck-subhead-gold) 74%, transparent 100%);
  clip-path: polygon(0 0, 100% 0, calc(100% - 2px) 100%, 0 100%);
  transform-origin: left center;
  transition: transform var(--d-fade) var(--ease-premium);
}

@media (hover: hover) {
  .ck-tight-block button.ck-block-head:hover:not(:disabled) .ck-block-label {
    color: var(--ck-subhead-anchor);
  }
  .ck-tight-block button.ck-block-head:hover:not(:disabled) .ck-block-label::after {
    transform: scaleX(1.08);
  }
}

@media (max-width: 1520px) {
  .ck-tight-title {
    gap: 4px;
  }
  .ck-title-plaque-body {
    padding: 0 3px 0 7px;
    gap: 5px;
  }
  .ck-title-text {
    font-size: 12px;
    letter-spacing: 0;
  }
  .ck-tight-title > :not(.ck-title-plaque) {
    font-size: 11px;
  }
  .ck-tight-block .ck-block-label {
    font-size: 12px;
    letter-spacing: 0;
  }
}

.ck-mini-link {
  border: 0;
  background: transparent;
  padding: 0;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ck-accent);
  cursor: pointer;
}
.ck-mini-link:hover {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.ck-ring-compact {
  gap: 11px !important;
}

.ck-ring-box-sm {
  position: relative;
  width: 82px;
  height: 82px;
  flex-shrink: 0;
}

.ck-legend-foot {
  margin-top: 3px;
  padding-top: 4px;
  border-top: var(--hair) solid var(--ck-line);
  font-size: 10.5px;
  color: var(--ck-faint);
  justify-content: space-between;
}

.ck-quad-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 5px;
}

.ck-quad-cell {
  position: relative;
  overflow: hidden;
  border: var(--hair) solid color-mix(in srgb, var(--cell-tone, var(--ck-line)) 20%, var(--ck-line));
  border-radius: var(--r-xs);
  background: linear-gradient(
    165deg,
    color-mix(in srgb, var(--cell-tone, rgba(128, 148, 170, 0.2)) 6.5%, var(--ck-panel-solid)) 0%,
    rgba(128, 148, 170, 0.05) 100%
  );
  padding: 6px 4px 5px;
  text-align: center;
  color: var(--ck-ink);
  transition: background var(--d-fade) ease, border-color var(--d-fade) ease, transform var(--d-fade) ease;
}
.ck-quad-cell::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--cell-tone, var(--ck-accent));
  opacity: 0.88;
}
.ck-quad-cell:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--cell-tone, var(--ck-accent)) 52%, var(--ck-line));
  background: linear-gradient(
    165deg,
    color-mix(in srgb, var(--cell-tone, rgba(128, 148, 170, 0.25)) 12%, var(--ck-panel-solid)) 0%,
    rgba(128, 148, 170, 0.1) 100%
  );
}
.ck-quad-cell span {
  display: block;
  font-size: 10px;
  color: var(--ck-muted);
  white-space: nowrap;
}
.ck-quad-cell strong {
  display: block;
  font-size: 14px;
  font-weight: 720;
  color: color-mix(in srgb, var(--cell-tone, var(--ck-ink)) 78%, var(--ck-ink));
  margin-top: 1px;
}

.ck-bar-caption {
  display: flex;
  justify-content: space-between;
  font-size: 10.5px;
  color: var(--ck-muted);
}
.ck-bar-caption span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.ck-bar-caption i {
  width: 6px;
  height: 6px;
  border-radius: 2px;
  flex-shrink: 0;
}
.ck-bar-caption b {
  color: var(--ck-ink);
  font-weight: 680;
}

.ck-trio-compact {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.ck-dual-compact {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.ck-aid-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 4px;
}

.ck-mini-stat {
  position: relative;
  overflow: hidden;
  border: var(--hair) solid color-mix(in srgb, var(--cell-tone, var(--ck-line)) 20%, var(--ck-line));
  border-radius: var(--r-xs);
  background: linear-gradient(
    165deg,
    color-mix(in srgb, var(--cell-tone, rgba(128, 148, 170, 0.2)) 6.5%, var(--ck-panel-solid)) 0%,
    rgba(128, 148, 170, 0.05) 100%
  );
  padding: 6px 7px 5px;
  text-align: left;
  color: var(--ck-ink);
  transition: background var(--d-fade) ease, border-color var(--d-fade) ease, transform var(--d-fade) ease;
}
.ck-mini-stat::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--cell-tone, var(--ck-accent));
  opacity: 0.88;
}
button.ck-mini-stat:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--cell-tone, var(--ck-accent)) 52%, var(--ck-line));
  background: linear-gradient(
    165deg,
    color-mix(in srgb, var(--cell-tone, rgba(128, 148, 170, 0.25)) 12%, var(--ck-panel-solid)) 0%,
    rgba(128, 148, 170, 0.1) 100%
  );
}
.ck-mini-stat span {
  display: block;
  font-size: 10px;
  color: var(--ck-muted);
  white-space: nowrap;
}
.ck-mini-stat strong {
  display: block;
  font-size: 14.5px;
  font-weight: 720;
  color: color-mix(in srgb, var(--cell-tone, var(--ck-ink)) 78%, var(--ck-ink));
  margin-top: 1px;
  line-height: 1.15;
}
.ck-mini-stat strong small {
  font-size: 10px;
  font-weight: 500;
  color: var(--ck-muted);
  margin-left: 1px;
}

.ck-rank-list {
  display: grid;
  gap: 5px;
}

.ck-rank-row {
  border: 0;
  background: transparent;
  padding: 2px 3px;
  border-radius: var(--r-xs);
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) minmax(54px, auto);
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--ck-muted);
  text-align: left;
  transition: background var(--d-fade) ease;
}
.ck-rank-row:hover {
  background: rgba(128, 148, 170, 0.14);
}
.ck-rank-name {
  color: var(--ck-ink);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ck-rank-row b {
  text-align: right;
  color: var(--ck-ink);
  font-weight: 650;
  white-space: nowrap;
}

.ck-note-p {
  font-size: 11.5px;
  color: var(--ck-muted);
  line-height: 1.5;
}

.ck-accent-pill {
  font-size: 11px;
  font-weight: 700;
  color: var(--ck-accent);
}

.ck-direct-list {
  display: grid;
  gap: 6px;
}

.ck-direct-item {
  width: 100%;
  min-width: 0;
  border: var(--hair) solid color-mix(in srgb, var(--task-tone, var(--ck-line)) 18%, var(--ck-line));
  border-left: 2.5px solid var(--task-tone, var(--ck-accent));
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--task-tone, var(--ck-accent)) 6%, var(--ck-panel-solid)) 0%,
    rgba(128, 148, 170, 0.04) 100%
  );
  border-radius: var(--r-xs);
  padding: 6px 8px;
  text-align: left;
  display: grid;
  gap: 5px;
  color: var(--ck-ink);
  transition: background var(--d-fade) ease, border-color var(--d-fade) ease;
  overflow: hidden;
}
.ck-direct-item:hover {
  border-color: color-mix(in srgb, var(--task-tone, var(--ck-accent)) 45%, var(--ck-line));
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--task-tone, var(--ck-accent)) 11%, var(--ck-panel-solid)) 0%,
    rgba(128, 148, 170, 0.1) 100%
  );
}
.ck-direct-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 11px;
}
.ck-direct-top span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.ck-direct-top b {
  color: var(--ck-muted);
  font-weight: 600;
  flex-shrink: 0;
  white-space: nowrap;
}
.ck-direct-top b em {
  font-style: normal;
  font-weight: 720;
  color: var(--task-tone, var(--ck-accent));
}

.ck-stat-sm {
  position: relative;
  overflow: hidden;
  padding: 6px 8px !important;
  text-align: left;
  border: var(--hair) solid color-mix(in srgb, var(--cell-tone, var(--ck-line)) 22%, var(--ck-line)) !important;
  background: linear-gradient(
    165deg,
    color-mix(in srgb, var(--cell-tone, rgba(128, 148, 170, 0.2)) 7.5%, var(--ck-panel-solid)) 0%,
    rgba(128, 148, 170, 0.05) 100%
  ) !important;
  transition: transform var(--d-fade) ease, border-color var(--d-fade) ease, background var(--d-fade) ease;
}
.ck-stat-sm::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2.5px;
  background: var(--cell-tone, var(--ck-accent));
}
.ck-stat-sm:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--cell-tone, var(--ck-accent)) 52%, var(--ck-line)) !important;
}
.ck-stat-sm strong {
  font-size: 19px !important;
  color: var(--cell-tone, var(--ck-ink)) !important;
}

.ck-cat-btn {
  border: 0;
  background: transparent;
  padding: 3px 5px;
  border-radius: var(--r-xs);
  width: 100%;
  text-align: left;
  transition: background var(--d-fade) ease;
}
.ck-cat-btn:hover {
  background: rgba(128, 148, 170, 0.12);
}
.ck-cat-btn.active {
  background: color-mix(in srgb, var(--cat-tone, var(--primary)) 12%, transparent);
  color: var(--ck-ink);
}
.ck-cat-name {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ck-ink);
  font-weight: 550;
  white-space: nowrap;
}
.ck-cat-name i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.ck-empty-card {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  border-radius: var(--r-xs);
  border: var(--hair) solid color-mix(in srgb, var(--ck-ok) 24%, var(--ck-line));
  border-left: 2.5px solid var(--ck-ok);
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--ck-ok) 7.5%, var(--ck-panel-solid)) 0%,
    rgba(128, 148, 170, 0.04) 100%
  );
}
.ck-empty-badge {
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: var(--r-tag);
  background: color-mix(in srgb, var(--ck-ok) 14%, transparent);
  color: var(--ck-ok);
  font-size: 10.5px;
  font-weight: 700;
}
.ck-empty-body {
  min-width: 0;
  display: grid;
  gap: 1px;
}
.ck-empty-body strong {
  font-size: 11.5px;
  font-weight: 680;
  color: var(--ck-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ck-empty-body span {
  font-size: 10px;
  color: var(--ck-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ck-live-compact {
  gap: 1px !important;
  overflow-y: auto;
  max-height: 224px;
  scrollbar-width: none;
}
.ck-live-compact::-webkit-scrollbar {
  display: none;
}
.ck-live-compact .ck-live-item {
  padding: 6px 8px !important;
}
.ck-live-compact .ck-live-title {
  font-size: 12px !important;
}
.ck-live-compact .ck-live-sub {
  font-size: 10.5px !important;
}

.ck-sub-tabs {
  display: inline-flex;
  gap: 3px;
  padding: 2px;
  border-radius: var(--r-xs);
  background: rgba(128, 148, 170, 0.12);
}
.ck-sub-tabs button {
  border: 0;
  background: transparent;
  color: var(--ck-muted);
  font-size: 11.5px;
  font-weight: 650;
  padding: 2px 8px;
  border-radius: 3px;
}
.ck-sub-tabs button.active {
  background: var(--primary);
  color: var(--on-primary);
}

.ck-police-list {
  display: grid;
  gap: 5px;
}
.ck-police-item {
  padding: 6px 8px;
  border-radius: var(--r-xs);
  background: rgba(128, 148, 170, 0.08);
  border-left: 2px solid var(--ck-accent);
}
.ck-police-top {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  color: var(--ck-muted);
  margin-bottom: 2px;
}
.ck-police-type {
  color: var(--ck-accent);
  font-weight: 700;
}
.ck-police-st {
  margin-left: auto;
  color: var(--ck-ok);
  font-weight: 650;
}
.ck-police-item p {
  font-size: 11px;
  color: var(--ck-ink);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.ck-14-strip {
  display: grid;
  grid-template-columns: 82px 1px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  height: 60px;
  padding: 6px 10px;
}

.c14-divider {
  width: 1px;
  height: 36px;
  background: var(--ck-border);
}

.c14-grid {
  display: grid;
  grid-template-columns: repeat(14, minmax(0, 1fr));
  gap: 4px;
  min-width: 0;
}

@media (max-width: 1520px) {
  .ck-14-strip {
    grid-template-columns: 74px 1px minmax(0, 1fr);
    gap: 6px;
    height: 58px;
    padding: 5px 8px;
  }
  .ck-14-strip .ck-comm-mini strong,
  .c14-name {
    font-size: 11px;
  }
}

@media (max-width: 1280px) {
  .c14-grid {
    display: flex;
    overflow-x: auto;
    scrollbar-width: thin;
  }
  .c14-grid .ck-comm-mini {
    flex: 0 0 64px;
  }
}

.ck-14-strip .ck-comm-mini {
  height: 46px;
  padding: 5px 2px 4px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.ck-14-strip .ck-comm-mini.is-all-anchor span {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--ck-ink);
}

.ck-14-strip .ck-comm-mini strong {
  font-size: 11.5px;
  font-weight: 700;
  line-height: 1.15;
  white-space: nowrap;
  margin-top: 0;
}

.c14-name {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-size: 11.5px;
  font-weight: 650;
  color: var(--ck-ink);
  line-height: 1.15;
  white-space: nowrap;
}

.c14-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.c14-dot.d-ok { background: var(--ck-ok); }
.c14-dot.d-warn { background: var(--ck-warn); }
.c14-dot.d-bad { background: var(--ck-danger); }

.ck-base-seg {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: var(--r-control);
  border: var(--hair) solid var(--ck-border);
  background: var(--ck-panel);
  box-shadow: var(--e1), var(--ck-edge);
}

.ck-base-seg button {
  height: 26px;
  padding: 0 8px;
  border: 0;
  border-radius: calc(var(--r-control) - 2px);
  background: transparent;
  color: var(--ck-muted);
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  transition: background-color var(--d-fade) ease, color var(--d-fade) ease;
}

.ck-base-seg button:hover {
  color: var(--ck-ink);
  background: rgba(128, 148, 170, 0.14);
}

.ck-base-seg button.active {
  background: var(--primary);
  color: var(--on-primary);
}

/* ── 顶部 6 枚独立 KPI 卡片（无外层套娃白框、无虚线下划线） ── */
.ck-kpi-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
  background: transparent;
  border: 0;
  padding: 0;
}

.ck-kpi-card {
  position: relative;
  overflow: hidden;
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 9px 11px 8px;
  border-radius: var(--r-card);
  border: var(--hair) solid color-mix(in srgb, var(--kpi-tone, var(--primary)) 22%, var(--ck-border));
  background: linear-gradient(
    165deg,
    color-mix(in srgb, var(--kpi-tone, var(--primary)) 6.5%, var(--ck-panel-solid)) 0%,
    var(--ck-panel-solid) 62%
  );
  box-shadow: var(--e2), var(--ck-edge);
  text-align: left;
  cursor: pointer;
  min-width: 0;
  transition: transform var(--d-fade) var(--ease-premium),
              border-color var(--d-fade) ease,
              box-shadow var(--d-fade) ease,
              background var(--d-fade) ease;
}

.ck-kpi-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--kpi-tone, var(--primary));
  opacity: 0.96;
}

@media (hover: hover) {
  .ck-kpi-card:hover {
    transform: translateY(-1.5px);
    background: linear-gradient(
      165deg,
      color-mix(in srgb, var(--kpi-tone, var(--primary)) 11%, var(--ck-panel-solid)) 0%,
      var(--ck-panel-solid) 72%
    );
    border-color: color-mix(in srgb, var(--kpi-tone, var(--primary)) 52%, var(--ck-border));
    box-shadow: var(--e2), 0 6px 16px color-mix(in srgb, var(--kpi-tone, var(--primary)) 12%, rgba(26, 22, 20, 0.06));
  }
}

.ck-kpi-card:active {
  transform: translateY(0) scale(0.99);
}

.ck-kpi-card:focus-visible {
  outline: 2px solid var(--focus, var(--primary));
  outline-offset: 2px;
}

.ck-kpi-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.ck-kpi-icon {
  width: 21px;
  height: 21px;
  border-radius: var(--r-xs);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--kpi-tone, var(--primary));
  background: color-mix(in srgb, var(--kpi-tone, var(--primary)) 14%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--kpi-tone, var(--primary)) 22%, transparent);
}

.ck-kpi-label {
  font-size: 11.5px;
  font-weight: 650;
  color: color-mix(in srgb, var(--kpi-tone, var(--primary)) 32%, var(--ck-ink));
  white-space: nowrap;
}

.ck-kpi-arrow {
  margin-left: auto;
  color: color-mix(in srgb, var(--kpi-tone, var(--primary)) 55%, var(--ck-faint));
  opacity: 0.65;
  flex-shrink: 0;
  transition: transform var(--d-fade) ease, opacity var(--d-fade) ease, color var(--d-fade) ease;
}

.ck-kpi-card:hover .ck-kpi-arrow {
  opacity: 1;
  color: var(--kpi-tone, var(--primary));
  transform: translateX(2px);
}

.ck-kpi-val {
  font-size: 20px;
  font-weight: 740;
  color: color-mix(in srgb, var(--kpi-tone, var(--primary)) 78%, var(--ck-ink));
  line-height: 1.15;
  letter-spacing: 0;
  white-space: nowrap;
  margin-top: 1px;
}

.ck-kpi-val small {
  font-size: 11px;
  font-weight: 550;
  color: var(--ck-muted);
  margin-left: 2px;
}

.ck-kpi-sub {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  color: var(--ck-muted);
  line-height: 1.25;
  white-space: nowrap;
  letter-spacing: 0;
}

.ck-kpi-sub::before {
  content: '';
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--kpi-tone, var(--primary));
  opacity: 0.72;
  flex-shrink: 0;
}

@container (max-width: 132px) {
  .ck-kpi-icon {
    width: 17px;
    height: 17px;
  }
  .ck-kpi-label {
    font-size: 11px;
  }
  .ck-kpi-val {
    font-size: 17px;
  }
  .ck-kpi-sub {
    font-size: 10px;
  }
}

/* ── 当前汇报章核心结论微横幅 ── */
.ck-chapter-brief {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 10px;
  border-radius: var(--r-md);
  border: var(--hair) solid var(--ck-border);
  background: var(--ck-panel);
  box-shadow: var(--e1), var(--ck-edge);
  min-width: 0;
}

.ck-brief-badge {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: var(--r-tag);
  background: var(--primary-soft);
  color: var(--brand-text, var(--primary));
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.ck-brief-text {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--ck-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ck-brief-health {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding-left: 8px;
  border-left: var(--hair) solid var(--ck-line);
  font-size: 11px;
  color: var(--ck-muted);
  white-space: nowrap;
}

.ck-brief-health span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.ck-brief-reset {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border-radius: var(--r-tag);
  border: var(--hair) solid var(--primary);
  background: var(--primary-soft);
  color: var(--brand-text, var(--primary));
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
}
:global(body.cockpit-dark) .ck-brief-reset,
:global(html[data-preset="command-dark"]) .ck-brief-reset {
  background: rgba(184, 28, 40, 0.34);
  border-color: rgba(243, 215, 160, 0.65);
  color: #fde8c2;
}

@media (max-width: 1520px) {
  .ck-kpi-grid {
    gap: 6px;
  }
  .ck-kpi-card {
    padding: 7px 9px 6px;
    gap: 2px;
  }
  .ck-chapter-brief {
    height: 28px;
    padding: 0 8px;
  }
  .ck-brief-text {
    font-size: 11.5px;
  }
}

.ck-emg-mini {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--r-xs);
  border: var(--hair) solid var(--ck-line);
  background: rgba(128, 148, 170, 0.08);
  margin-top: 4px;
}
.ck-emg-mini > div {
  min-width: 0;
  display: grid;
  gap: 1px;
}
.ck-emg-mini strong {
  font-size: 11px;
  color: var(--ck-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ck-emg-mini span {
  font-size: 10px;
  color: var(--ck-muted);
}

/* ── 列表选中态 / 时限进度 / 空态 ── */
.ck-title-count {
  font-size: 12px;
  color: var(--ck-danger);
}
.ck-dispatch-trio {
  margin-bottom: 8px;
}
.ck-dispatch-list {
  flex: 1;
  min-height: 0;
  margin: 0 -8px;
  padding: 0 8px;
  overflow-x: hidden;
  overflow-y: auto;
  align-content: start;
  scrollbar-width: none;
}
.ck-dispatch-list::-webkit-scrollbar {
  display: none;
}
.ck-live-body {
  min-width: 0;
}
.ck-live-item.is-selected {
  background: var(--primary-soft);
  box-shadow: inset 2px 0 0 var(--primary);
}
.ck-sla-track {
  display: block;
  height: 3px;
  margin-top: 5px;
  border-radius: 2px;
  background: rgba(128, 148, 170, 0.16);
  overflow: hidden;
}
.ck-sla-track i {
  display: block;
  height: 100%;
  border-radius: 2px;
}
.ck-empty {
  padding: 14px 0;
  text-align: center;
  font-size: 11.5px;
  color: var(--ck-faint);
}

/* ── 事项处置穿透卡 ── */
.ck-title-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.ck-ev-card {
  overflow-y: auto;
  scrollbar-width: none;
}
.ck-ev-card::-webkit-scrollbar {
  display: none;
}
.ck-ev-title {
  font-size: 13.5px;
  line-height: 1.4;
  color: var(--ck-ink);
}
.ck-ev-meta {
  font-size: 11.5px;
  color: var(--ck-muted);
}
.ck-ev-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.ck-ev-facts span {
  padding: 1px 6px;
  border-radius: var(--r-tag);
  background: rgba(128, 148, 170, 0.1);
  font-size: 10.5px;
  color: var(--ck-muted);
  white-space: nowrap;
}
.ck-ev-facts span.is-bad {
  color: var(--ck-danger);
  background: color-mix(in srgb, var(--ck-danger) 10%, transparent);
}
.ck-ev-desc {
  font-size: 11.5px;
  color: var(--ck-muted);
  line-height: 1.55;
}
.ck-ev-photo {
  border-radius: var(--r-sm);
  border: 1px solid var(--ck-border);
}
.ck-inline-icon {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}
.ck-ev-actions {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: 6px;
  margin-top: 4px;
}
.ck-ev-actions .ck-btn {
  height: 30px;
  padding: 0 8px;
  gap: 4px;
  font-size: 11.5px;
}
.ck-ev-actions .ck-btn:disabled {
  opacity: 0.55;
  cursor: default;
  transform: none;
}

.ck-model-preview, .ck-model-preview > img { display: block; width: 100%; height: 100%; }
.ck-model-preview > img { object-fit: cover; }
.ck-preview-controls {
  position: absolute; right: clamp(325px,23vw,356px); bottom: 155px; z-index: 5; background: var(--ck-panel-solid);
}
.ck-preview-controls span { padding: 0 8px; color: var(--ck-muted); font-size: 11px; }
.ck-narrow-panels.ck-nav-tabs,
.ck-mobile-scope-btn,
.ck-mobile-comm-scrim {
  display: none;
}

@media (max-width: 1100px) {
  .ck-shell {
    padding: env(safe-area-inset-top, 0px) 0 0;
    grid-template-rows: auto minmax(0, 1fr);
    height: 100dvh;
    overflow: hidden;
  }
  /* 861px–1100px 保持紧凑单行三段式顶栏，零多余留白；仅 ≤860px 窄屏才拆为两行 */
  .ck-header.ck-header-center {
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    gap: 6px 8px;
    padding: 5px 10px 6px;
    height: auto;
    min-height: 44px;
  }
  .ck-brand.ck-brand-center {
    height: auto;
    min-height: 36px;
    padding: 0;
    justify-content: center;
  }
  .ck-crest-wing {
    display: none;
  }
  .ck-crest-body {
    height: auto;
    min-height: 35px;
    max-width: 100%;
    padding: 3px 12px;
    border-radius: var(--r-md, 8px);
  }
  .ck-brand-inner {
    gap: 6px;
    min-width: 0;
  }
  .ck-logo-pedestal {
    transform: scale(0.8);
    transform-origin: center;
    flex-shrink: 0;
  }
  .ck-title-group {
    min-width: 0;
  }
  .ck-title-group h1 {
    font-size: 14.5px !important;
    gap: 5px !important;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ck-title-main,
  .ck-title-sub {
    font-size: 14.5px !important;
    letter-spacing: 0.02em !important;
  }
  .ck-title-sep {
    height: 11px !important;
  }
  .ck-head-left {
    justify-self: start;
  }
  .ck-head-left .ck-nav-tabs button {
    padding: 0 8px;
    font-size: 11.5px;
    height: 30px;
  }
  .ck-header.ck-header-center .ck-tools {
    justify-self: end;
    max-width: 100%;
    min-width: 0;
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .ck-header.ck-header-center .ck-tools::-webkit-scrollbar {
    display: none;
  }
  .ck-tools > * {
    flex: none;
  }
  .ck-tools .ck-btn,
  .ck-tools .ck-preset-trigger {
    height: 30px;
    padding: 0 8px;
    font-size: 11.5px;
  }
  .ck-tools .ck-btn.sq {
    width: 30px;
    height: 30px;
    padding: 0;
  }
  .ck-clock,
  .ck-btn-fullscreen {
    display: none;
  }

  /* 舞台容器：地图态相对定位满铺，数据/事项态流式自然纵向滚动 */
  .ck-stage {
    border-radius: 0;
    margin: 0;
    padding-bottom: calc(52px + env(safe-area-inset-bottom, 0px));
  }
  .ck-stage[data-panel="data"],
  .ck-stage[data-panel="events"] {
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    padding: 10px 10px calc(68px + env(safe-area-inset-bottom, 0px));
    background: var(--frame);
  }
  .ck-shell.is-dark .ck-stage[data-panel="data"],
  .ck-shell.is-dark .ck-stage[data-panel="events"] {
    background: #0d111a;
  }

  /* 底部常驻三视图切换栏 */
  .ck-narrow-panels.ck-nav-tabs {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
    position: fixed;
    z-index: 460;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 6px 10px calc(6px + env(safe-area-inset-bottom, 0px));
    border-radius: 0;
    border: 0;
    border-top: var(--hair) solid var(--ck-border);
    background: var(--ck-panel-solid);
    box-shadow: 0 -4px 18px rgba(0, 0, 0, 0.1);
  }
  .ck-narrow-panels.ck-nav-tabs button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 38px;
    font-size: 13px;
    font-weight: 650;
  }
  .ck-np-badge {
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--ck-danger);
    color: #ffffff;
    font-style: normal;
    font-size: 10.5px;
    font-weight: 700;
    display: inline-grid;
    place-items: center;
    line-height: 1;
  }

  /* 地图态左上角辖区切换按钮 */
  .ck-stage[data-panel="map"] .ck-mobile-scope-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    position: absolute;
    z-index: 430;
    top: 8px;
    left: 8px;
    max-width: calc(100% - 168px);
    height: 32px;
    padding: 0 10px;
    border-radius: var(--r-control, 8px);
    border: var(--hair) solid var(--ck-border);
    background: var(--ck-panel-solid);
    color: var(--ck-ink);
    font-size: 12px;
    font-weight: 650;
    box-shadow: var(--e2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ck-msb-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ck-ok);
    flex-shrink: 0;
  }
  .ck-msb-dot.active {
    background: var(--primary);
  }

  /* 移动端 14 社区选择底抽屉 */
  .ck-mobile-comm-scrim {
    display: flex;
    align-items: flex-end;
    position: fixed;
    inset: 0;
    z-index: 520;
    background: rgba(12, 16, 24, 0.52);
    backdrop-filter: blur(3px);
  }
  .ck-mobile-comm-sheet {
    width: 100%;
    max-height: 78dvh;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 12px calc(16px + env(safe-area-inset-bottom, 0px));
    border-radius: 16px 16px 0 0;
    background: var(--ck-panel-solid);
    color: var(--ck-ink);
    border-top: 2px solid var(--primary);
    box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.22);
    overflow-y: auto;
  }
  .ck-mcs-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .ck-mcs-head strong {
    font-size: 14px;
    font-weight: 700;
  }
  .ck-mcs-close {
    width: 30px;
    height: 30px;
    border: var(--hair) solid var(--ck-border);
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--ck-muted);
    display: inline-grid;
    place-items: center;
  }
  .ck-mcs-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 7px;
  }
  .ck-mcs-grid .ck-comm-mini {
    padding: 8px 6px;
  }
  .ck-mcs-grid .is-all-anchor {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 9px 12px;
  }

  /* 面板切换显示规则 */
  .ck-stage .ck-map-topbar,
  .ck-stage .ck-rail,
  .ck-stage .ck-collect-bar {
    display: none;
  }
  .ck-stage:not([data-panel="map"]) .ck-map-fab {
    display: none;
  }
  .ck-stage:not([data-panel="map"]) .ck-map-layer {
    position: fixed;
    inset: 0;
    z-index: -1;
    visibility: hidden;
    pointer-events: none;
  }

  /* 辖区数据态：自然纵向流（KPI 2×3 + 五章结论 + 左侧全部模块 + 14 社区实体卡） */
  .ck-stage[data-panel="data"] .ck-map-topbar {
    display: flex;
    flex-direction: column;
    position: static;
    width: 100%;
    left: auto;
    right: auto;
    top: auto;
    gap: 8px;
    pointer-events: auto;
    flex: none;
  }
  .ck-stage[data-panel="data"] .ck-kpi-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .ck-stage[data-panel="data"] .ck-map-toprow {
    width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
    justify-content: flex-start;
    -webkit-overflow-scrolling: touch;
  }
  .ck-stage[data-panel="data"] .ck-map-toprow::-webkit-scrollbar {
    display: none;
  }
  .ck-stage[data-panel="data"] .ck-map-toprow .ck-glass-bar {
    display: inline-flex !important;
    width: max-content !important;
    min-width: 100%;
    flex-wrap: nowrap;
    gap: 4px;
  }
  .ck-stage[data-panel="data"] .ck-map-toprow .ck-pill {
    flex: 0 0 auto;
    padding: 0 11px;
    overflow: visible;
    text-overflow: clip;
  }
  .ck-stage[data-panel="data"] .ck-chapter-brief {
    height: auto;
    min-height: 32px;
    padding: 8px 10px;
    flex-wrap: wrap;
    justify-content: space-between;
    row-gap: 6px;
  }
  .ck-stage[data-panel="data"] .ck-brief-text {
    flex: 1 0 100%;
    order: 3;
    white-space: normal;
    line-height: 1.5;
  }
  .ck-stage[data-panel="data"] .ck-brief-health {
    gap: 7px;
    font-size: 10.5px;
  }
  .ck-stage[data-panel="data"] .ck-rail-left,
  .ck-stage[data-panel="events"] .ck-rail-right {
    display: flex;
    position: static;
    left: auto;
    right: auto;
    top: auto;
    bottom: auto;
    width: 100%;
    height: auto;
    max-height: none;
    overflow: visible;
    background: var(--ck-panel-solid);
    flex: none;
  }
  .ck-stage[data-panel="data"] .ck-collect-bar {
    display: flex;
    flex-direction: column;
    position: static;
    left: auto;
    right: auto;
    bottom: auto;
    width: 100%;
    height: auto;
    padding: 10px;
    gap: 8px;
    background: var(--ck-panel-solid);
    flex: none;
  }
  .ck-stage[data-panel="data"] .c14-divider {
    display: none;
  }
  .ck-stage[data-panel="data"] .c14-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
    width: 100%;
  }

  /* 解除桌面端整条截断限制，移动端完整展示列表 */
  .ck-chapter-block,
  .ck-fill-block {
    flex: none;
    min-height: 0;
  }
  .ck-rank-fit,
  .ck-fit-list {
    overflow: visible !important;
    max-height: none !important;
  }
  .ck-rank-fit .is-clipped,
  .ck-fit-list .is-clipped {
    display: grid !important;
    opacity: 1 !important;
    visibility: visible !important;
    pointer-events: auto !important;
  }
  .ck-dispatch-list {
    overflow: visible;
    max-height: none;
  }

  /* 地图态底部单行紧凑底图切换条（紧贴底部三视图导航上方，留出大面积地图） */
  .ck-stage[data-panel="map"] .ck-map-fab {
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: calc(60px + env(safe-area-inset-bottom, 0px));
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .ck-stage[data-panel="map"] .ck-map-fab::-webkit-scrollbar {
    display: none;
  }
  .ck-stage[data-panel="map"] .ck-map-fab > * {
    flex: none;
  }
  .ck-model-preview .ck-preview-controls {
    left: 8px;
    right: auto;
    bottom: calc(100px + env(safe-area-inset-bottom, 0px));
  }
}

@media (max-width: 860px) {
  .ck-header.ck-header-center {
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-areas: "brand brand" "mode tools";
    padding: 4px 10px 7px;
  }
  .ck-brand.ck-brand-center {
    grid-area: brand;
    width: 100%;
  }
  .ck-head-left {
    grid-area: mode;
  }
  .ck-header.ck-header-center .ck-tools {
    grid-area: tools;
  }
}

@media (max-width: 520px) {
  .ck-header.ck-header-center {
    padding: 4px 8px 6px;
    gap: 5px 6px;
  }
  .ck-crest-body {
    padding: 3px 8px;
  }
  .ck-logo-pedestal {
    transform: scale(0.72);
  }
  .ck-title-main,
  .ck-title-sub {
    font-size: 13px !important;
    letter-spacing: 0.01em !important;
  }
  .ck-title-group h1 {
    font-size: 13px !important;
  }
  .ck-head-left .ck-nav-tabs button {
    padding: 0 7px;
    font-size: 11px;
  }
  .ck-preset-trigger span,
  .ck-btn-tour {
    display: none;
  }
  .ck-preset-trigger {
    padding: 0 6px !important;
    gap: 3px;
  }
  .ck-tools .ck-btn.primary {
    padding: 0 7px;
    gap: 3px;
  }
  .ck-mcs-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .ck-stage[data-panel="data"] .c14-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .ck-quad-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* ==========================================================================
   驾驶舱 UI 优化：配色下拉 / 侧轨填充与整条适配 / 分级口径 / 章节与列表动效
   ========================================================================== */
.ck-shell {
  --lv-lead: #2a8a5e;
  --lv-ok: #3d7ea6;
}
.ck-shell.is-dark {
  --lv-lead: #5cc394;
  --lv-ok: #74abd4;
}

/* 配色方案：单按钮 + 顶层实色下拉 */
.ck-preset-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 9px 0 8px;
  border-radius: var(--r-control);
  border: var(--hair) solid var(--ck-border);
  background: var(--ck-panel);
  color: var(--ck-muted);
  font-size: 12px;
  font-weight: 600;
  box-shadow: var(--e1), var(--ck-edge);
  cursor: pointer;
  transition: border-color var(--d-fade) ease, color var(--d-fade) ease;
}
.ck-preset-trigger:hover,
.ck-preset-trigger.open {
  color: var(--ck-ink);
  border-color: color-mix(in srgb, var(--primary) 40%, var(--ck-border));
}
.ck-preset-trigger i {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  box-shadow: 0 0 0 1.5px var(--ck-panel-solid), 0 0 0 2.5px color-mix(in srgb, var(--primary) 50%, transparent);
}
.ck-preset-caret {
  transition: transform 0.18s ease;
}
.ck-preset-trigger.open .ck-preset-caret {
  transform: rotate(180deg);
}
.ck-preset-menu {
  position: fixed;
  z-index: 3000;
  min-width: 172px;
  padding: 5px;
  display: grid;
  gap: 2px;
  border-radius: var(--r-card, 10px);
  border: 1px solid var(--ck-border, rgba(60, 48, 42, 0.16));
  background: var(--ck-panel-solid, #ffffff);
  box-shadow: 0 12px 32px rgba(24, 20, 18, 0.18), 0 2px 6px rgba(24, 20, 18, 0.08);
}
.ck-preset-menu button {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) 14px;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ck-ink, #1a1718);
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.ck-preset-menu button:hover {
  background: rgba(128, 148, 170, 0.12);
}
.ck-preset-menu button.active {
  color: var(--primary);
  background: var(--primary-soft);
}
.ck-preset-menu button i {
  width: 14px;
  height: 14px;
  border-radius: 50%;
}
.ck-preset-menu button span {
  white-space: nowrap;
}
.ck-pop-enter-active,
.ck-pop-leave-active {
  transition: opacity 0.16s ease, transform 0.16s cubic-bezier(0.22, 1, 0.36, 1);
}
.ck-pop-enter-from,
.ck-pop-leave-to {
  opacity: 0;
  transform: translate3d(0, -4px, 0);
}

/* 实时联动呼吸点：跟随主题成功色 */
.ck-shell .live-dot-badge {
  color: var(--ck-ok);
}
.ck-shell .live-dot-badge::before {
  background: var(--ck-ok);
}
.ck-shell .live-dot-badge::after {
  background: color-mix(in srgb, var(--ck-ok) 55%, transparent);
}

/* 侧轨剩余高度填充 + 列表整条适配（仅限 >1100px 桌面固定高双悬浮轨，避免窄屏纵向流被 flex-basis:0 压扁至 112px） */
@media (min-width: 1101px) {
  .ck-chapter-block,
  .ck-fill-block {
    flex: 1 1 0;
    min-height: 112px;
  }
  .ck-chapter-body {
    display: flex;
    flex-direction: column;
    gap: 7px;
    flex: 1;
    min-height: 0;
  }
  .ck-rank-fit,
  .ck-fit-list {
    position: relative;
    flex: 1;
    min-height: 0;
    max-height: none !important;
    overflow: hidden !important;
    align-content: start;
  }
  .is-clipped {
    visibility: hidden;
    pointer-events: none;
  }
}
.ck-rank-fit {
  gap: 3px;
}
.ck-dispatch-list {
  flex: 0 1 auto;
}
.ck-fit-list .ck-live-sub {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 排行：序号 + 名称 + 条 + 值，锁定社区高亮 */
.ck-rank-fit .ck-rank-row {
  grid-template-columns: 16px 40px minmax(0, 1fr) minmax(56px, auto);
  height: 24px;
  padding: 0 4px;
}
.ck-rank-no {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--ck-muted);
  text-align: center;
}
.ck-rank-row:nth-child(-n + 3) .ck-rank-no {
  color: var(--primary);
}
.ck-rank-row.is-scope {
  background: var(--primary-soft);
  box-shadow: inset 2px 0 0 var(--primary);
}
.ck-rank-row.is-scope .ck-rank-name {
  color: var(--primary);
}

/* 处置进程时间轴 */
.ck-timeline {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ck-timeline li {
  position: relative;
  padding: 0 0 9px 16px;
}
.ck-timeline li::before {
  content: '';
  position: absolute;
  left: 3px;
  top: 5px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ck-panel-solid);
  border: 1.5px solid color-mix(in srgb, var(--ck-muted) 60%, transparent);
}
.ck-timeline li::after {
  content: '';
  position: absolute;
  left: 6.5px;
  top: 14px;
  bottom: 0;
  width: 1px;
  background: var(--ck-line);
}
.ck-timeline li:last-child::after {
  display: none;
}
.ck-timeline li.is-latest::before {
  border-color: var(--primary);
  background: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-soft);
}
.ck-tl-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
}
.ck-tl-head strong {
  color: var(--ck-ink);
  font-weight: 650;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ck-tl-head span {
  flex-shrink: 0;
  color: var(--ck-muted);
  font-size: 10.5px;
}
.ck-timeline p {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--ck-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 分级口径：标杆 / 平稳 / 关注 / 督办（与三维图例一致） */
.c14-dot.d-lead { background: var(--lv-lead); }
.ck-14-strip .c14-dot.d-ok,
.ck-brief-health .c14-dot.d-ok { background: var(--lv-ok); }
.ck-14-strip .ck-comm-mini.lv-lead strong { color: var(--lv-lead); }
.ck-14-strip .ck-comm-mini.is-map-hover:not(.active) {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--primary) 48%, var(--ck-border));
  background: rgba(128, 148, 170, 0.13);
  box-shadow: 0 4px 10px rgba(24, 20, 18, 0.09);
}
.ck-14-strip .ck-comm-mini {
  transition: transform 0.18s ease, border-color 0.18s ease, background-color 0.18s ease, box-shadow 0.18s ease;
}

/* 地图右下：图层开关与底图切换并为一行 */
.ck-stage .ck-map-fab {
  flex-direction: row;
  align-items: center;
  transition: right 0.36s cubic-bezier(0.22, 1, 0.36, 1), bottom 0.36s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.32s ease;
}
.ck-stage .ck-map-fab .ck-fab-btn {
  height: 30px;
}
.ck-base-seg {
  padding: 2.5px;
}
.ck-base-seg button {
  height: 24px;
  padding: 0 7.5px;
  font-size: 11px;
}
.ck-fab-btn.active {
  border-color: var(--primary);
  color: var(--on-primary, #ffffff);
  background: var(--primary);
  box-shadow: var(--e-accent);
}
.ck-map-layer :deep(.city3d-ctrl.is-cockpit:not(.is-theater)) {
  bottom: 120px;
}

/* ── 顶栏左翼：空间检索与沉浸剧场控制 ── */
.ck-head-left {
  gap: 8px;
}
.ck-head-ops {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.ck-btn-op {
  height: 34px;
  padding: 0 10px;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  border-radius: var(--r-control);
  border: var(--hair) solid var(--ck-border);
  background: var(--ck-panel);
  color: var(--ck-muted);
  box-shadow: var(--e1), var(--ck-edge);
  white-space: nowrap;
}
.ck-btn-op:hover {
  color: var(--ck-ink);
  border-color: color-mix(in srgb, var(--primary) 40%, var(--ck-border));
}
.ck-btn-op.active {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary, #ffffff);
  box-shadow: var(--e-accent);
}
.ck-op-badge {
  font-style: normal;
  font-size: 10.5px;
  font-weight: 700;
  padding: 0 5px;
  height: 16px;
  line-height: 16px;
  border-radius: 999px;
  background: rgba(13, 148, 136, 0.14);
  color: #0b6e64;
}
.ck-shell.is-dark .ck-op-badge {
  background: rgba(56, 242, 214, 0.18);
  color: #7ff7e8;
}
.ck-btn-op.active .ck-op-badge {
  background: rgba(255, 255, 255, 0.22);
  color: #ffffff;
}
@media (max-width: 1520px) {
  .ck-head-left {
    gap: 6px;
  }
  .ck-head-ops {
    gap: 4px;
  }
  .ck-btn-op {
    height: 30px;
    padding: 0 7px;
    gap: 4px;
    font-size: 11px;
  }
  .ck-head-left .ck-nav-tabs button {
    height: 26px;
    padding: 0 8px;
    font-size: 11px;
  }
}
@media (max-width: 1360px) {
  .ck-btn-op {
    padding: 0 8px;
  }
  .ck-btn-op span {
    display: none;
  }
}
@media (max-width: 1100px) {
  .ck-btn-theater {
    display: none;
  }
  .ck-btn-op {
    height: 30px;
    padding: 0 7px;
  }
}

/* ── KPI 卡片 1px 釉面跟手边框高光（无光球，仅 1px 描边随指针轻扫） ── */
.ck-kpi-card::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  pointer-events: none;
  opacity: 0;
  background: radial-gradient(
    120px circle at var(--gx, -200px) var(--gy, -200px),
    color-mix(in srgb, var(--kpi-tone, var(--primary)) 68%, #f4c97a),
    transparent 72%
  );
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  transition: opacity 0.22s ease;
}
@media (hover: hover) {
  .ck-kpi-card:hover::after {
    opacity: 1;
  }
}

/* ── 人口结构环悬停扇段联动高亮 ── */
.ck-ring-center {
  pointer-events: none;
}
.ck-ring-arc {
  cursor: pointer;
  transition: stroke-width 0.18s ease, opacity 0.18s ease;
}
.ck-ring-arc.dimmed {
  opacity: 0.34;
}
.ck-pop-lg-row {
  cursor: pointer;
  border-radius: 4px;
  padding: 1px 4px;
  margin: -1px -4px;
  transition: background-color 0.15s ease;
}
.ck-pop-lg-row.active {
  background: rgba(128, 148, 170, 0.14);
}

/* ── 右侧办结率弧形精工仪表 ── */
.ck-gauge-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.ck-gauge-box {
  position: relative;
  width: 84px;
  height: 48px;
  flex-shrink: 0;
}
.ck-gauge-val {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 1px;
  text-align: center;
  pointer-events: none;
}
.ck-gauge-val strong {
  font-size: 16px;
  font-weight: 760;
  color: var(--ck-ok);
  line-height: 1;
}
.ck-gauge-val small {
  font-size: 9.5px;
  margin-left: 1px;
}
.ck-gauge-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}
.ck-gauge-title {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--ck-ink);
}

/* ── 右侧近 7 日闭环微趋势曲线 ── */
.ck-trend-box {
  margin-top: 6px;
  padding: 5px 7px 4px;
  border-radius: var(--r-sm);
  border: var(--hair) solid var(--ck-line);
  background: rgba(128, 148, 170, 0.06);
}
.ck-trend-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 2px;
  font-size: 10.5px;
  color: var(--ck-muted);
}
.ck-trend-readout {
  color: var(--ck-ink);
  font-weight: 650;
  white-space: nowrap;
}
.ck-trend-legend {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
.ck-trend-legend i {
  font-style: normal;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.ck-trend-legend b {
  width: 6px;
  height: 2px;
  border-radius: 1px;
  display: inline-block;
}
.ck-trend-svg {
  display: block;
  width: 100%;
  height: 40px;
  overflow: visible;
}

/* ── 纯净剧场沉浸态（收拢左右双轨、KPI 与 14 社区坞，仅留底部微字幕与控件） ── */
.ck-theater-bar {
  position: absolute;
  left: 50%;
  bottom: 18px;
  z-index: 430;
  display: none;
  align-items: center;
  gap: 9px;
  max-width: min(680px, calc(100vw - 560px));
  padding: 6px 10px 6px 8px;
  border-radius: var(--r-pill, 999px);
  border: var(--hair) solid var(--ck-border);
  background: var(--ck-panel);
  backdrop-filter: blur(18px);
  box-shadow: var(--e3), var(--ck-edge);
  opacity: 0;
  pointer-events: none;
  transform: translate3d(-50%, 16px, 0);
  transition: transform 0.38s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.28s ease;
}
@media (min-width: 1101px) {
  .ck-rail-left,
  .ck-rail-right,
  .ck-map-topbar,
  .ck-14-strip {
    transition: transform 0.42s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.32s ease;
  }
  .ck-shell.is-theater .ck-rail-left {
    transform: translate3d(-118%, 0, 0);
    opacity: 0;
    pointer-events: none;
  }
  .ck-shell.is-theater:not(.has-penetration) .ck-rail-right,
  .ck-shell.is-theater.is-following .ck-rail-right {
    transform: translate3d(118%, 0, 0);
    opacity: 0;
    pointer-events: none;
  }
  .ck-shell.is-theater .ck-map-topbar {
    transform: translate3d(0, -28px, 0);
    opacity: 0;
    pointer-events: none;
  }
  .ck-shell.is-theater .ck-14-strip {
    transform: translate3d(0, 125%, 0);
    opacity: 0;
    pointer-events: none;
  }
  .ck-shell.is-theater:not(.has-penetration) .ck-map-fab,
  .ck-shell.is-theater.is-following .ck-map-fab {
    right: 16px;
    bottom: 18px;
  }
  .ck-shell.is-theater.has-penetration:not(.is-following) .ck-map-fab {
    right: 356px;
    bottom: 18px;
  }
  .ck-shell.is-theater.has-penetration:not(.is-following) .ck-map-layer :deep(.city3d-ctrl.is-cockpit.is-theater) {
    right: 356px;
  }
  .ck-shell.is-theater.is-following .ck-map-layer :deep(.city3d-ctrl.is-cockpit.is-theater) {
    right: 16px;
  }
  .ck-theater-bar {
    display: inline-flex;
  }
  .ck-shell.is-theater:not(.has-penetration) .ck-theater-bar {
    opacity: 1;
    pointer-events: auto;
    transform: translate3d(-50%, 0, 0);
  }
}
@media (min-width: 1101px) and (max-width: 1520px) {
  .ck-shell:not(.is-theater) .ck-map-fab {
    right: 328px;
    bottom: 82px;
  }
  .ck-shell.is-theater.has-penetration:not(.is-following) .ck-map-fab {
    right: 328px;
  }
  .ck-shell.is-theater.has-penetration:not(.is-following) .ck-map-layer :deep(.city3d-ctrl.is-cockpit.is-theater) {
    right: 328px;
  }
  .ck-theater-bar {
    max-width: min(600px, calc(100vw - 490px));
  }
}
@media (min-width: 1101px) and (max-width: 1280px) {
  .ck-shell:not(.is-theater) .ck-map-fab {
    right: 318px;
  }
}
.ck-tb-badge {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--primary);
  color: var(--on-primary, #ffffff);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}
.ck-tb-text {
  min-width: 0;
  font-size: 11.5px;
  color: var(--ck-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ck-tb-dots {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 999px;
  background: rgba(128, 148, 170, 0.12);
  flex-shrink: 0;
}
.ck-tb-dots button {
  height: 20px;
  padding: 0 6px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ck-muted);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.ck-tb-dots button.active {
  background: var(--primary);
  color: var(--on-primary, #ffffff);
}
.ck-tb-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  border: var(--hair) solid var(--ck-border);
  background: rgba(128, 148, 170, 0.12);
  color: var(--ck-ink);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.ck-tb-btn:hover {
  background: rgba(128, 148, 170, 0.22);
  border-color: color-mix(in srgb, var(--primary) 42%, var(--ck-border));
}
.ck-tb-btn.is-exit {
  background: var(--primary-soft);
  color: var(--primary);
  border-color: color-mix(in srgb, var(--primary) 34%, transparent);
}
.ck-shell.is-dark .ck-tb-btn.is-exit {
  background: rgba(184, 28, 40, 0.38);
  border-color: rgba(243, 215, 160, 0.52);
  color: #fde8c2;
}

/* 条形数据变化平滑过渡 */
.ck-cat-track > i,
.ck-share-bar > i,
.ck-sla-track > i {
  transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}

/* 章节切换：旧内容淡出 → 新内容上浮淡入，排行条从左舒展 */
.ck-swap-enter-active {
  transition: opacity 0.26s ease, transform 0.26s cubic-bezier(0.22, 1, 0.36, 1);
}
.ck-swap-leave-active {
  transition: opacity 0.15s ease;
}
.ck-swap-enter-from {
  opacity: 0;
  transform: translate3d(0, 6px, 0);
}
.ck-swap-leave-to {
  opacity: 0;
}
.ck-swap-enter-active .ck-cat-track > i {
  transform-origin: left center;
  animation: ckBarExpand 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.06s both;
}

/* 巡演进度线 */
.ck-map-toprow .ck-pill {
  position: relative;
  overflow: hidden;
}
.ck-tour-progress {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 2px;
  height: 2px;
  border-radius: 1px;
  background: currentColor;
  opacity: 0.75;
  transform-origin: left center;
  animation-name: ckTourProgress;
  animation-timing-function: linear;
  animation-fill-mode: both;
}
@keyframes ckTourProgress {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}

/* 事项列表：新进入条目上滑淡入，新增事项短暂高亮 */
.ck-list-enter-active {
  animation: ckRowIn 0.42s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.ck-list-leave-active {
  display: none;
}
.ck-list-move {
  transition: transform 0.36s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes ckRowIn {
  from { opacity: 0; transform: translate3d(0, -6px, 0); }
  to { opacity: 1; transform: translate3d(0, 0, 0); }
}
.ck-live-item.is-fresh {
  animation: ckRowFlash 2s ease-out;
}
@keyframes ckRowFlash {
  0%, 30% { background: color-mix(in srgb, var(--primary) 14%, transparent); }
  100% { background: transparent; }
}

@media (prefers-reduced-motion: reduce) {
  .ck-swap-enter-active,
  .ck-swap-leave-active,
  .ck-list-move,
  .ck-cat-track > i,
  .ck-share-bar > i,
  .ck-sla-track > i {
    transition: none !important;
  }
  .ck-swap-enter-active .ck-cat-track > i,
  .ck-list-enter-active,
  .ck-live-item.is-fresh,
  .ck-tour-progress {
    animation: none !important;
  }
}


/* ==========================================================================
   电影级丝绸三幕二级分层入场动效（纯 GPU 合成层 transform/opacity，杜绝与 backdrop-filter 叠加模糊掉帧）
   ========================================================================== */
.ck-shell.is-pre-enter .ck-brand-center,
.ck-shell.is-pre-enter .ck-head-left,
.ck-shell.is-pre-enter .ck-tools,
.ck-shell.is-pre-enter .ck-rail-left,
.ck-shell.is-pre-enter .ck-rail-right,
.ck-shell.is-pre-enter .ck-rail .ck-block,
.ck-shell.is-pre-enter .ck-collect-bar,
.ck-shell.is-pre-enter .c14-grid .ck-comm-mini,
.ck-shell.is-pre-enter .ck-map-fab,
.ck-shell.is-pre-enter .ck-map-toprow,
.ck-shell.is-pre-enter .ck-chapter-brief,
.ck-shell.is-pre-enter .ck-kpi-card {
  opacity: 0;
  pointer-events: none;
}

.ck-shell.is-pre-enter .ck-share-bar > i,
.ck-shell.is-pre-enter .ck-cat-track > i,
.ck-shell.is-pre-enter .ck-sla-track > i {
  transform: scaleX(0);
  transform-origin: left center;
}

@keyframes ckSilkCrest {
  0% {
    opacity: 0;
    transform: translate3d(0, -12px, 0) scale(0.968);
  }
  100% {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1);
  }
}

@keyframes ckSilkFromCenterLeft {
  0% {
    opacity: 0;
    transform: translate3d(14px, -4px, 0);
  }
  100% {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}

@keyframes ckSilkFromCenterRight {
  0% {
    opacity: 0;
    transform: translate3d(-14px, -4px, 0);
  }
  100% {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}

@keyframes ckEnterLeft {
  0% {
    opacity: 0;
    transform: translate3d(-18px, 0, 0);
  }
  100% {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}

@keyframes ckEnterRight {
  0% {
    opacity: 0;
    transform: translate3d(18px, 0, 0);
  }
  100% {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}

@keyframes ckSilkSubBlock {
  0% {
    opacity: 0;
    transform: translate3d(0, 10px, 0);
  }
  100% {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}

@keyframes ckEnterRise {
  0% {
    opacity: 0;
    transform: translate3d(0, 16px, 0);
  }
  100% {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}

@keyframes ckSilkPianoKey {
  0% {
    opacity: 0;
    transform: translate3d(0, 8px, 0) scale(0.96);
  }
  100% {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1);
  }
}

@keyframes ckEnterSoftDown {
  0% {
    opacity: 0;
    transform: translate3d(0, -10px, 0);
  }
  100% {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}

@keyframes ckEnterKpi {
  0% {
    opacity: 0;
    transform: translate3d(0, 12px, 0) scale(0.975);
  }
  100% {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1);
  }
}

@keyframes ckBarExpand {
  0% {
    transform: scaleX(0);
  }
  100% {
    transform: scaleX(1);
  }
}

/* 第二幕：顶部冠冕自中央凝现向两翼舒展 */
.ck-shell.is-revealing .ck-brand-center {
  will-change: transform, opacity;
  animation: ckSilkCrest 0.78s cubic-bezier(0.22, 1, 0.36, 1) 0.68s both;
}

.ck-shell.is-revealing .ck-head-left {
  will-change: transform, opacity;
  animation: ckSilkFromCenterLeft 0.68s cubic-bezier(0.22, 1, 0.36, 1) 0.84s both;
}

.ck-shell.is-revealing .ck-tools {
  will-change: transform, opacity;
  animation: ckSilkFromCenterRight 0.68s cubic-bezier(0.22, 1, 0.36, 1) 0.86s both;
}

/* 第二幕：左右侧轨柔滑落位 + 内部 4 大板块二级错峰轻显 */
.ck-shell.is-revealing .ck-rail-left {
  will-change: transform, opacity;
  animation: ckEnterLeft 0.82s cubic-bezier(0.22, 1, 0.36, 1) 0.86s both;
}

.ck-shell.is-revealing .ck-rail-right {
  will-change: transform, opacity;
  animation: ckEnterRight 0.82s cubic-bezier(0.22, 1, 0.36, 1) 0.98s both;
}

.ck-shell.is-revealing .ck-rail-left .ck-block:nth-of-type(1) {
  animation: ckSilkSubBlock 0.58s cubic-bezier(0.22, 1, 0.36, 1) 1.04s both;
}
.ck-shell.is-revealing .ck-rail-left .ck-block:nth-of-type(2) {
  animation: ckSilkSubBlock 0.58s cubic-bezier(0.22, 1, 0.36, 1) 1.13s both;
}
.ck-shell.is-revealing .ck-rail-left .ck-block:nth-of-type(3) {
  animation: ckSilkSubBlock 0.58s cubic-bezier(0.22, 1, 0.36, 1) 1.22s both;
}
.ck-shell.is-revealing .ck-rail-left .ck-block:nth-of-type(4) {
  animation: ckSilkSubBlock 0.58s cubic-bezier(0.22, 1, 0.36, 1) 1.31s both;
}

.ck-shell.is-revealing .ck-rail-right .ck-block:nth-of-type(1) {
  animation: ckSilkSubBlock 0.58s cubic-bezier(0.22, 1, 0.36, 1) 1.14s both;
}
.ck-shell.is-revealing .ck-rail-right .ck-block:nth-of-type(2) {
  animation: ckSilkSubBlock 0.58s cubic-bezier(0.22, 1, 0.36, 1) 1.23s both;
}
.ck-shell.is-revealing .ck-rail-right .ck-block:nth-of-type(3) {
  animation: ckSilkSubBlock 0.58s cubic-bezier(0.22, 1, 0.36, 1) 1.32s both;
}
.ck-shell.is-revealing .ck-rail-right .ck-block:nth-of-type(4) {
  animation: ckSilkSubBlock 0.58s cubic-bezier(0.22, 1, 0.36, 1) 1.41s both;
}

/* 第二幕：底部 14 社区浮坞升起 + 14 社区格如琴键自左向右波浪点亮 */
.ck-shell.is-revealing .ck-collect-bar {
  will-change: transform, opacity;
  animation: ckEnterRise 0.76s cubic-bezier(0.22, 1, 0.36, 1) 1.14s both;
}

.ck-shell.is-revealing .c14-grid .ck-comm-mini {
  will-change: transform, opacity;
  animation: ckSilkPianoKey 0.48s cubic-bezier(0.22, 1, 0.36, 1) calc(1.34s + var(--comm-idx, 0) * 0.028s) both;
}

.ck-shell.is-revealing .ck-map-toprow {
  will-change: transform, opacity;
  animation: ckEnterSoftDown 0.68s cubic-bezier(0.22, 1, 0.36, 1) 1.24s both;
}

.ck-shell.is-revealing .ck-map-fab {
  will-change: transform, opacity;
  animation: ckEnterRise 0.68s cubic-bezier(0.22, 1, 0.36, 1) 1.32s both;
}

.ck-shell.is-revealing .ck-chapter-brief {
  will-change: transform, opacity;
  animation: ckEnterSoftDown 0.66s cubic-bezier(0.22, 1, 0.36, 1) 1.38s both;
}

/* 第三幕：6 张核心 KPI 卡片 110ms 阶梯点亮 + 进度条丝滑舒展 */
.ck-shell.is-revealing .ck-kpi-card {
  will-change: transform, opacity;
  animation: ckEnterKpi 0.64s cubic-bezier(0.22, 1, 0.36, 1) calc(1.38s + var(--kpi-idx, 0) * 0.11s) both;
}

.ck-shell.is-revealing .ck-share-bar > i,
.ck-shell.is-revealing .ck-cat-track > i,
.ck-shell.is-revealing .ck-sla-track > i {
  transform-origin: left center;
  animation: ckBarExpand 1.08s cubic-bezier(0.22, 1, 0.36, 1) 1.54s both;
}

@media (prefers-reduced-motion: reduce) {
  .ck-shell.is-revealing .ck-brand-center,
  .ck-shell.is-revealing .ck-head-left,
  .ck-shell.is-revealing .ck-tools,
  .ck-shell.is-revealing .ck-rail-left,
  .ck-shell.is-revealing .ck-rail-right,
  .ck-shell.is-revealing .ck-rail .ck-block,
  .ck-shell.is-revealing .ck-collect-bar,
  .ck-shell.is-revealing .c14-grid .ck-comm-mini,
  .ck-shell.is-revealing .ck-map-fab,
  .ck-shell.is-revealing .ck-map-toprow,
  .ck-shell.is-revealing .ck-chapter-brief,
  .ck-shell.is-revealing .ck-kpi-card,
  .ck-shell.is-revealing .ck-share-bar > i,
  .ck-shell.is-revealing .ck-cat-track > i,
  .ck-shell.is-revealing .ck-sla-track > i {
    animation: none !important;
    opacity: 1 !important;
    filter: none !important;
    transform: none !important;
  }
}

/* 网格员概览与当前辖区名录 */
.ck-staff-summary,
.ck-directory-filters {
  display: flex;
  align-items: center;
  gap: 2px;
}
.ck-staff-summary {
  align-self: flex-end;
  max-width: 100%;
  padding: 3px;
  border: var(--hair) solid var(--ck-border);
  border-radius: var(--r-control);
  background: var(--ck-panel-solid);
  box-shadow: var(--e2);
}
.ck-staff-filter,
.ck-staff-directory-toggle,
.ck-directory-close,
.ck-patrol-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  cursor: pointer;
}
.ck-staff-filter,
.ck-staff-directory-toggle {
  min-height: 26px;
  padding: 3px 7px;
  border: 0;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--ck-muted);
  font-size: 11px;
  font-weight: 550;
  line-height: 1;
  white-space: nowrap;
}
.ck-staff-filter {
  border: var(--hair) solid transparent;
}
.ck-staff-filter i,
.ck-staff-row-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
  background: var(--staff-tone);
}
.ck-staff-filter b {
  color: var(--ck-ink);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.ck-staff-filter.active,
.ck-staff-filter:hover {
  border-color: color-mix(in srgb, var(--staff-tone) 23%, var(--ck-line));
  background: color-mix(in srgb, var(--staff-tone) 8%, var(--ck-panel-solid));
  color: var(--ck-ink);
}
.ck-staff-directory-toggle {
  border-left: var(--hair) solid var(--ck-line);
  border-radius: 0;
}
.ck-staff-directory-toggle:hover,
.ck-directory-close:hover { color: var(--ck-ink); }
.ck-patrol-link { flex: none; }
.ck-staff-directory {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  gap: 10px;
}
.ck-directory-head,
.ck-directory-search {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ck-directory-head { justify-content: space-between; }
.ck-directory-head h2 {
  margin: 0;
  color: var(--ck-ink);
  font-size: 16px;
  line-height: 1.4;
}
.ck-directory-head p {
  margin: 3px 0 0;
  color: var(--ck-muted);
  font-size: 11px;
}
.ck-directory-close {
  align-self: flex-start;
  width: 26px;
  height: 26px;
  border: var(--hair) solid var(--ck-line);
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--ck-muted);
}
.ck-directory-search {
  padding: 0 8px;
  border: var(--hair) solid var(--ck-border);
  border-radius: var(--r-control);
  background: var(--ck-panel-solid);
  color: var(--ck-muted);
}
.ck-directory-search:focus-within { border-color: var(--ck-accent); }
.ck-directory-search input {
  width: 100%;
  min-width: 0;
  height: 31px;
  padding: 0;
  border: none;
  outline: none;
  color: var(--ck-ink);
  background: transparent;
  font: inherit;
  font-size: 12px;
}
.ck-staff-roster {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--ck-line) transparent;
}
.ck-staff-row {
  --staff-tone: var(--ck-ok);
  display: grid;
  grid-template-columns: 6px minmax(0, 1fr) auto 12px;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 46px;
  border: none;
  border-bottom: var(--hair) solid var(--ck-line);
  padding: 5px 2px;
  color: var(--ck-muted);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.ck-staff-row.is-alert-row { --staff-tone: var(--ck-danger); }
.ck-staff-row.is-busy-row { --staff-tone: var(--ck-run); }
.ck-staff-row:hover,
.ck-staff-row:focus-visible {
  background: color-mix(in srgb, var(--staff-tone) 6%, var(--ck-panel-solid));
}
.ck-staff-identity { display: grid; gap: 2px; }
.ck-staff-identity b { color: var(--ck-ink); font-size: 13px; }
.ck-staff-identity small {
  overflow: hidden;
  color: var(--ck-muted);
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ck-staff-duty {
  color: var(--staff-tone);
  font-size: 10.5px;
  font-weight: 650;
  white-space: nowrap;
}
.ck-directory-filters { display: none; }

@media (min-width: 1101px) {
  .ck-shell.is-theater .ck-map-topbar {
    right: 15px;
    opacity: 1;
    transform: none;
  }
  .ck-shell.is-theater.has-penetration:not(.is-following) .ck-map-topbar {
    right: 356px;
  }
  .ck-shell.is-theater .ck-map-topbar > :not(.ck-staff-summary) { display: none; }
}
@media (max-width: 1100px) {
  .ck-stage[data-panel="map"] .ck-map-topbar {
    display: flex;
    position: absolute;
    top: 47px;
    left: 8px;
    right: 8px;
  }
  .ck-stage[data-panel="map"] .ck-map-topbar > :not(.ck-staff-summary),
  .ck-stage[data-panel="data"] .ck-staff-summary { display: none; }
  .ck-staff-summary { align-self: flex-start; }
  .ck-staff-filter,
  .ck-staff-directory-toggle { min-height: 32px; }
  .ck-directory-filters { display: flex; }
  .ck-directory-filters .ck-staff-filter { flex: 1; }
  .ck-staff-roster { max-height: 62dvh; flex: auto; }
}
@media (max-width: 380px) {
  .ck-staff-filter,
  .ck-staff-directory-toggle { gap: 3px; padding-inline: 5px; }
}

.ck-follow-capsule {
  position: absolute;
  left: 50%;
  bottom: 188px;
  z-index: 435;
  transform: translate3d(-50%, 0, 0);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  max-width: min(820px, calc(100vw - 700px));
  padding: 7px 10px 7px 13px;
  border-radius: var(--r-pill, 999px);
  border: var(--hair) solid var(--ck-border);
  border-top: 2px solid var(--primary);
  background: var(--ck-panel-solid);
  box-shadow: var(--e3), var(--ck-edge);
  color: var(--ck-ink);
  transition: bottom 0.32s cubic-bezier(0.22, 1, 0.36, 1), max-width 0.32s ease;
}
.ck-shell.is-theater .ck-follow-capsule {
  bottom: 18px;
  max-width: min(880px, calc(100vw - 440px));
}
.ck-fc-who {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
}
.ck-fc-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ck-ok);
  flex-shrink: 0;
}
.ck-fc-dot.is-busy { background: var(--ck-run); }
.ck-fc-dot.is-alert {
  background: var(--ck-danger);
  animation: ckPulseDot 1.3s ease-in-out infinite;
}
.ck-fc-who strong {
  font-weight: 720;
  white-space: nowrap;
  flex-shrink: 0;
}
.ck-fc-status,
.ck-fc-grid {
  font-size: 11px;
  color: var(--ck-muted);
  white-space: nowrap;
  flex-shrink: 0;
}
.ck-fc-sep {
  width: 1px;
  height: 12px;
  background: var(--ck-border);
  flex-shrink: 0;
}
.ck-fc-road {
  font-size: 11px;
  color: var(--ck-ink);
  font-weight: 560;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.ck-fc-ops {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.ck-fc-step,
.ck-fc-alt {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  padding: 2px;
  border-radius: 999px;
  background: rgba(128, 148, 170, 0.12);
}
.ck-fc-step button,
.ck-fc-alt button {
  height: 22px;
  padding: 0 7px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ck-muted);
  font-size: 10.5px;
  font-weight: 620;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.14s ease, color 0.14s ease;
}
.ck-fc-step button:hover,
.ck-fc-alt button:hover:not(.active) {
  color: var(--ck-ink);
  background: rgba(128, 148, 170, 0.16);
}
.ck-fc-alt button.active {
  background: var(--primary);
  color: var(--on-primary, #ffffff);
}

@media (max-width: 1520px) {
  .ck-follow-capsule {
    max-width: min(760px, calc(100vw - 650px));
    gap: 8px;
    padding: 6px 8px 6px 11px;
  }
  .ck-fc-grid {
    display: none;
  }
}
@media (max-width: 1100px) {
  .ck-follow-capsule,
  .ck-shell.is-theater .ck-follow-capsule {
    bottom: 68px;
    max-width: calc(100vw - 20px);
    flex-wrap: wrap;
    border-radius: var(--r-md, 10px);
  }
  .ck-follow-capsule .ck-tb-btn:first-of-type {
    display: none;
  }
}
</style>
