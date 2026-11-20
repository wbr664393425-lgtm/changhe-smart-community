<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  Sun, Moon, Play, Pause, Maximize2, ArrowRight, Bell, Send,
  Users, Flag, Building2, Briefcase, AlertTriangle, CheckCircle2, ChevronRight, X
} from 'lucide-vue-next'
import BrandLogo from '../components/BrandLogo.vue'
import GeoMap from '../components/GeoMap.vue'
import ChangheCity3D from '../components/ChangheCity3D.vue'
import EvidencePhoto from '../components/EvidencePhoto.vue'
import DrilldownDrawer from '../components/DrilldownDrawer.vue'
import BuildingProfilePanel from '../components/BuildingProfilePanel.vue'
import {
  store, PRESETS, COMMUNITIES, EVENT_CATEGORIES, getCurrentRole, getEffectiveCommunity, getVisibleCommunities,
  applyPreset, showToast, addAuditLog, nowStr
} from '../store/appStore'
import { buildScenePhoto } from '../utils/sampleImages'
import { latLngToWorldXZ } from '../utils/cityModelCache'
import {
  getCockpitBuildingIndex,
  buildEventBuildingMap,
  buildBuildingDetail,
  queryEmergencyRadius
} from '../utils/cockpitBuildingIndex'
import {
  buildPartyBranchDrill,
  buildSpecialGroupDrill,
  buildHousingDrill,
  buildUnitResourceDrill,
  buildSafetyHazardsDrill
} from '../utils/drilldownData'

const router = useRouter()

// 一屏双态（汇报叙事态 / 日常调度态）+ 14 社区治理体感带 + 全量真实汇总看板
const viewMode = ref('report') // report | dispatch
const activeChapter = ref(0)
const activeSlice = ref('safety')
const narrowPanel = ref('map')
const previewPose = ref('hero')
const previewRoot = import.meta.env.BASE_URL + 'model-previews/'
const previewViews = { hero: '全景鸟瞰', park: '长河公园', bridge: '岔河桥景' }
const mapBase = ref('city3d') // city3d（三维社区沙盘·默认） | gov（政务平面图） | aerial（卫星影像） | street（电子路网）
const hoveredComm = ref('')
const selectedEvent = ref(null)
const selectedBuildingIndex = ref(-1)
const selectedEntity = ref(null)
const radiusActive = ref(false)
const aidTick = ref(0)
const activeCategoryFilter = ref('')
const rightFootTab = ref('police') // police | armed
const tourRunning = ref(false)
const clockTime = ref('')
const clockDate = ref('')
let tourTimer = null
let clockTimer = null

const drill = ref({ open: false, title: '', subtitle: '', summary: '', filters: [], columns: [], rows: [], exportName: '' })

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

  // 共享辅助站物资
  void aidTick.value
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
  const events = store.events.filter((e) => scope.value === '全街道' || e.community === scope.value)
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

  // 数据直达宽表采集任务实时进度（读取真实 doneCount / totalTarget 字段）
  const directTasks = store.dataDirect.tasks
    .filter((t) => !t.expiredLocked)
    .slice(0, 2)
    .map((t) => {
      const done = Number(t.doneCount || 0)
      const total = Number(t.totalTarget || 1)
      const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0
      return { id: t.id, title: t.name || t.title || '宽表采集任务', done, total, pct }
    })

  // 警网联勤通报
  const policeList = store.policeAlerts.filter((p) => scope.value === '全街道' || p.community === scope.value)

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
      ok: list.filter((c) => c.health === 'ok').length,
      warn: list.filter((c) => c.health === 'warn').length,
      bad: list.filter((c) => c.health === 'bad').length
    },
    floodPts, firePts, riversKm: riversKm.toFixed(1), bareSoilWan: (bareSoil / 10000).toFixed(2),
    aidDetail, aidItems, armed,
    events, doneCnt, openEvents, acceptDispatch, handleReview, overdueCnt, rateExact, avgHours,
    categoryStats, partyTop, riskTop, revenueTop, ecoTop, rankMax, directTasks,
    commCount: list.length,
    policeList,
    avgPerGrid: grids ? Math.round(pop / grids) : 0
  }
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
  return list.slice(0, 6)
})

const currentChapterObj = computed(() => CHAPTERS[activeChapter.value])

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
      return `${s.healthCounts.ok} 个社区运行平稳、${s.healthCounts.warn} 个重点关注${bad.length ? `，${names(bad, 3)}已纳入街道督办` : ''}。`
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
      value: s.pop.toLocaleString(),
      unit: '人',
      sub: `户籍占比 ${s.hukouPct}%`,
      tone: 'var(--chart-2)',
      valColor: 'var(--chart-2)',
      tip: '点击下钻重点关怀与人口结构明细',
      action: () => openDrill('special')
    },
    {
      key: 'party',
      label: '在册党员',
      icon: Flag,
      value: s.party.toLocaleString(),
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
      value: s.homes.toLocaleString(),
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
      value: s.ent.toLocaleString(),
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
      value: String(s.openHazards),
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
      value: String(s.openEvents.length),
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

function updateClock() {
  const d = new Date()
  clockTime.value = d.toTimeString().slice(0, 8)
  clockDate.value = `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日`
}

function stopTour() {
  if (tourTimer) {
    clearInterval(tourTimer)
    tourTimer = null
  }
  tourRunning.value = false
}

function switchToDispatch() {
  stopTour()
  viewMode.value = 'dispatch'
}

function selectChapter(idx) {
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
  }, 5000)
}

function toggleCockpitLightDark() {
  if (isDark.value) {
    if (store.preset === 'command-dark') {
      applyPreset('vermilion-seal')
    }
    store.cockpitTheme = 'light'
  } else {
    store.cockpitTheme = 'dark'
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  else document.documentElement.requestFullscreen().catch(() => {})
}

function toggleCommunityLock(name) {
  if (role.value.scope !== '全街道' && name !== role.value.scope) {
    showToast(`当前角色权限仅限查看「${role.value.scope}」`)
    return
  }
  store.selectedCommunity = store.selectedCommunity === name ? '全街道' : name
  selectedEvent.value = null
  selectedBuildingIndex.value = -1
  selectedEntity.value = null
  radiusActive.value = false
}

// ── 三维楼栋一楼一档 / 实体点位 / 300 米联动圈计算 ──
const selectedBuildingDetail = computed(() => {
  void store.events.length
  void aidTick.value
  if (selectedBuildingIndex.value < 0) return null
  const idx = getCockpitBuildingIndex()
  const b = idx.buildings[selectedBuildingIndex.value]
  if (!b) return null
  return buildBuildingDetail(b, store)
})

const selectedEventBuilding = computed(() => {
  if (!selectedEvent.value) return null
  const { eventToBldg } = buildEventBuildingMap(store.events)
  return eventToBldg.get(selectedEvent.value.id) || null
})

const emergencyInfo = computed(() => {
  void store.events.length
  void aidTick.value
  if (!radiusActive.value) return null
  if (selectedBuildingDetail.value) {
    const b = selectedBuildingDetail.value.bldg
    return queryEmergencyRadius(b.cx, b.cz, 30, store)
  }
  if (selectedEntity.value) {
    return queryEmergencyRadius(selectedEntity.value.x, selectedEntity.value.z, 30, store)
  }
  if (selectedEvent.value) {
    const [ex, ez] = latLngToWorldXZ(selectedEvent.value.lat, selectedEvent.value.lng)
    return queryEmergencyRadius(ex, ez, 30, store)
  }
  return null
})

function handleSelectBuilding(bldg) {
  if (!bldg) return
  if (role.value.scope !== '全街道' && bldg.community !== role.value.scope) {
    showToast(`当前角色权限仅限查看「${role.value.scope}」楼栋`)
    return
  }
  stopTour()
  narrowPanel.value = 'events'
  selectedBuildingIndex.value = bldg.index
  selectedEntity.value = null
  selectedEvent.value = null
  // 有隐患或在办事件的楼栋自动展开 300 米应急联动圈
  const detail = buildBuildingDetail(bldg, store)
  radiusActive.value = Boolean(detail && (detail.openEvents.length > 0 || detail.hazardCount > 0))
  addAuditLog(`三维驾驶舱穿透查阅「${bldg.name}」一楼一档`, '楼栋穿透')
}

function handleSelectBuildingByIndex(bIdx) {
  const idx = getCockpitBuildingIndex()
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
  narrowPanel.value = 'events'
  selectedEntity.value = ent
  selectedBuildingIndex.value = -1
  selectedEvent.value = null
  radiusActive.value = ent.entityType === 'eco' || ent.entityType === 'staff'
}

function handleSelectEvent(ev) {
  if (!ev) return
  stopTour()
  narrowPanel.value = 'events'
  selectedEvent.value = ev
  selectedBuildingIndex.value = -1
  selectedEntity.value = null
  viewMode.value = 'dispatch'
  radiusActive.value = true
}

function handleResetPanorama() {
  if (role.value.scope === '全街道') {
    store.selectedCommunity = '全街道'
  }
  selectedBuildingIndex.value = -1
  selectedEntity.value = null
  selectedEvent.value = null
  radiusActive.value = false
}

function closeRightPenetration() {
  selectedBuildingIndex.value = -1
  selectedEntity.value = null
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
  radiusActive.value = true
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
  radiusActive.value = true
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

function openDrill(type) {
  const list = visibleComms.value
  const sc = scope.value
  if (type === 'party') {
    drill.value = { open: true, ...buildPartyBranchDrill(list, sc) }
  } else if (type === 'special') {
    drill.value = { open: true, ...buildSpecialGroupDrill(list, sc) }
  } else if (type === 'housing') {
    drill.value = { open: true, ...buildHousingDrill(list, sc, 'all') }
  } else if (type === 'economy') {
    drill.value = { open: true, ...buildUnitResourceDrill(list, sc, 'large') }
  } else {
    drill.value = { open: true, ...buildSafetyHazardsDrill(list, sc, '待销号整改') }
  }
  addAuditLog(`驾驶舱下钻查阅「${drill.value.title}」`, '明细下钻')
}

watch(isDark, syncBodyClass)

onMounted(() => {
  // 进入驾驶舱一律默认恢复全街道「全景鸟瞰」，避免跨页缓存的社区锁定导致一进来就放大
  if (role.value.scope === '全街道') {
    store.selectedCommunity = '全街道'
  }
  selectedBuildingIndex.value = -1
  selectedEntity.value = null
  selectedEvent.value = null
  radiusActive.value = false
  syncBodyClass()
  updateClock()
  clockTimer = setInterval(updateClock, 1000)
})

onBeforeUnmount(() => {
  clearInterval(tourTimer)
  clearInterval(clockTimer)
  document.body.classList.remove('view-cockpit', 'cockpit-dark')
})
</script>

<template>
  <div class="ck-shell">
    <!-- 顶部 68px 三段对称指挥导航栏：左双态切 ｜ 中大标题居中放大 ｜ 右工具与管理工作台 -->
    <header class="ck-header ck-header-center">
      <div class="ck-head-left">
        <div class="ck-nav-tabs" role="navigation" aria-label="驾驶舱模式切换">
          <button type="button" :class="{ active: viewMode === 'report' }" @click="viewMode = 'report'">汇报叙事态</button>
          <button type="button" :class="{ active: viewMode === 'dispatch' }" @click="switchToDispatch">日常调度态</button>
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
        <div class="ck-preset-bar" role="group" aria-label="切换驾驶舱与三维建模配色">
          <button
            v-for="p in PRESETS"
            :key="p.id"
            type="button"
            class="ck-preset-dot"
            :class="{ active: store.preset === p.id }"
            :title="`切换配色：${p.label}`"
            :aria-label="p.label"
            @click="applyPreset(p.id, $event)"
          >
            <i :style="{ background: `linear-gradient(135deg, ${p.sw1} 52%, ${p.sw2} 52%)` }"></i>
          </button>
        </div>
        <div class="ck-clock">
          <strong class="num">{{ clockTime }}</strong>
          <span>{{ clockDate }}</span>
        </div>
        <button type="button" class="ck-btn primary" @click="router.push('/portal')">
          <span>管理工作台</span>
          <ArrowRight :size="15" />
        </button>
        <button
          type="button"
          class="ck-btn sq"
          :title="isDark ? '切换浅色大屏' : '切换深色大屏'"
          @click="toggleCockpitLightDark"
        >
          <component :is="isDark ? Sun : Moon" :size="16" />
        </button>
        <button
          type="button"
          class="ck-btn sq"
          :class="{ active: tourRunning }"
          :title="tourRunning ? '暂停五章巡演' : '开启五章汇报巡演'"
          @click="toggleTour"
        >
          <component :is="tourRunning ? Pause : Play" :size="15" />
        </button>
        <button type="button" class="ck-btn sq" title="全屏展示" @click="toggleFullscreen">
          <Maximize2 :size="15" />
        </button>
      </div>
    </header>

    <!-- 满铺实景地图 + 满载实效双悬浮玻璃轨 -->
    <main class="ck-stage" :data-panel="narrowPanel">
      <nav class="ck-narrow-panels ck-nav-tabs" aria-label="驾驶舱内容">
        <button v-for="item in [{key:'map', label:'地图'}, {key:'data', label:'辖区数据'}, {key:'events', label:'治理事项'}]"
          :key="item.key" type="button" :class="{ active: narrowPanel === item.key }" :aria-pressed="narrowPanel === item.key"
          @click="narrowPanel = item.key">{{ item.label }}</button>
      </nav>
      <div class="ck-map-layer">
        <ChangheCity3D
          v-if="mapBase === 'city3d'"
          mode="cockpit"
          :dark="isDark"
          :selected-community="scope"
          :hovered-community="hoveredComm"
          :slice="activeSlice"
          :chapter-index="activeChapter"
          :events="stats.events"
          :narrow-panel-open="narrowPanel !== 'map'"
          :cockpit-view-mode="viewMode"
          :selected-building-index="selectedBuildingIndex"
          :selected-entity-id="selectedEntity?.id || ''"
          :selected-event-id="selectedEvent?.id || ''"
          :emergency-info="emergencyInfo"
          @select-community="toggleCommunityLock"
          @select-event="handleSelectEvent"
          @select-building="handleSelectBuilding"
          @select-entity="handleSelectEntity"
          @reset-panorama="handleResetPanorama"
          @webgl-fallback="mapBase = 'preview'"
        />
        <div v-else-if="mapBase === 'preview'" class="ck-model-preview">
          <img :src="previewRoot + previewPose + (isDark ? '-night.webp' : '-day.webp')" :alt="previewViews[previewPose] + '三维模型静态视图'" />
          <div class="ck-preview-controls ck-nav-tabs" role="group" aria-label="模型预览视角">
            <span>模型静态预览</span>
            <button v-for="(label, key) in previewViews" :key="key" type="button" :class="{ active: previewPose === key }"
              :aria-pressed="previewPose === key" @click="previewPose = key">{{ label }}</button>
          </div>
        </div>
        <GeoMap
          v-else
          mode="cockpit"
          :base-mode="mapBase"
          :dark="isDark"
          :selected-community="scope"
          :hovered-community="hoveredComm"
          :slice="activeSlice"
          :events="stats.events"
          :focus-coord="focusCoord"
          @select-community="toggleCommunityLock"
          @select-event="handleSelectEvent"
        />
      </div>

      <!-- 顶部悬浮 6 枚独立核心指标卡片 + 五章汇报导览 + 当前章核心结论微横幅 -->
      <div class="ck-map-topbar">
        <section class="ck-kpi-grid" aria-label="辖区六大核心指标">
          <button
            v-for="item in kpiCards"
            :key="item.key"
            type="button"
            class="ck-kpi-card"
            :style="{ '--kpi-tone': item.tone }"
            :title="item.tip"
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
            <span><i class="c14-dot d-ok"></i>平稳 {{ stats.healthCounts.ok }}</span>
            <span><i class="c14-dot d-warn"></i>关注 {{ stats.healthCounts.warn }}</span>
            <span><i class="c14-dot d-bad"></i>督办 {{ stats.healthCounts.bad }}</span>
          </div>
        </div>
      </div>

      <!-- 右下角悬浮图层与四态沙盘/底图切换（默认三维立体沙盘，一键切政务图/卫星影像/电子路网） -->
      <div class="ck-map-fab">
        <button v-if="mapBase !== 'preview'" type="button" class="ck-fab-btn" :class="{ active: activeSlice === 'eco' }" @click="activeSlice = activeSlice === 'eco' ? 'safety' : 'eco'">
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
              <div class="ck-ring-box-sm">
                <svg viewBox="0 0 88 88" width="82" height="82" aria-hidden="true">
                  <circle cx="44" cy="44" r="35" fill="none" stroke="rgba(160,160,160,0.16)" stroke-width="8" />
                  <circle cx="44" cy="44" r="35" fill="none" stroke="var(--chart-1)" stroke-width="8" :stroke-dasharray="`${(stats.youthPct / 100) * 219.9} 219.9`" transform="rotate(-90 44 44)" />
                  <circle cx="44" cy="44" r="35" fill="none" stroke="var(--chart-2)" stroke-width="8" :stroke-dasharray="`${(stats.elderPct / 100) * 219.9} 219.9`" :stroke-dashoffset="`-${(stats.youthPct / 100) * 219.9}`" transform="rotate(-90 44 44)" />
                  <circle cx="44" cy="44" r="35" fill="none" stroke="var(--chart-3)" stroke-width="8" :stroke-dasharray="`${(stats.teenPct / 100) * 219.9} 219.9`" :stroke-dashoffset="`-${((stats.youthPct + stats.elderPct) / 100) * 219.9}`" transform="rotate(-90 44 44)" />
                </svg>
                <div class="ck-ring-center">
                  <strong class="num" style="font-size: 19px">{{ stats.youthPct }}<small style="font-size: 10px">%</small></strong>
                  <span style="font-size: 10px">中青年</span>
                </div>
              </div>
              <div class="ck-legend-list" style="gap: 4px; font-size: 11.5px">
                <div><i style="background: var(--chart-1)"></i><span>中青年</span><strong class="num">{{ stats.youthPct }}%</strong></div>
                <div><i style="background: var(--chart-2)"></i><span>老年人</span><strong class="num">{{ stats.elderPct }}%</strong></div>
                <div><i style="background: var(--chart-3)"></i><span>在校生</span><strong class="num">{{ stats.teenPct }}%</strong></div>
                <div class="ck-legend-foot"><span style="white-space: nowrap">户籍 {{ stats.hukouPct }}%</span><span style="white-space: nowrap">格均 {{ stats.avgPerGrid }}人</span></div>
              </div>
            </div>

            <div class="ck-quad-strip">
              <button type="button" class="ck-quad-cell" style="--cell-tone: var(--ck-warn)" @click="openDrill('special')">
                <span>独居高龄</span>
                <strong class="num">{{ stats.special.elderAlone }}</strong>
              </button>
              <button type="button" class="ck-quad-cell" style="--cell-tone: var(--chart-2)" @click="openDrill('special')">
                <span>低保特困</span>
                <strong class="num">{{ stats.special.lowIncome }}</strong>
              </button>
              <button type="button" class="ck-quad-cell" style="--cell-tone: var(--chart-5)" @click="openDrill('special')">
                <span>残障帮扶</span>
                <strong class="num">{{ stats.special.disabled }}</strong>
              </button>
              <button type="button" class="ck-quad-cell" style="--cell-tone: var(--primary)" @click="openDrill('special')">
                <span>退役优抚</span>
                <strong class="num">{{ stats.special.veteran }}</strong>
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
                <strong class="num">{{ stats.largeEnt }}<small>家</small></strong>
              </button>
              <button type="button" class="ck-mini-stat" style="--cell-tone: var(--primary)" @click="openDrill('economy')">
                <span>规上产值</span>
                <strong class="num">{{ stats.revenue }}<small>亿</small></strong>
              </button>
              <button type="button" class="ck-mini-stat" style="--cell-tone: var(--chart-5)" @click="openDrill('economy')">
                <span>吸纳就业</span>
                <strong class="num">{{ stats.employeesWan }}<small>万</small></strong>
              </button>
            </div>
          </section>

          <!-- 板块 3：当前汇报章 · 专题实数洞察（随顶部五章动态换图表） -->
          <section class="ck-block ck-tight-block">
            <div class="ck-block-head">
              <span class="ck-block-label">{{ currentChapterObj.label }}</span>
              <span class="ck-block-note">{{ scope }}</span>
            </div>

            <!-- 第 1 章：党建引领与社区治理力量排行 -->
            <template v-if="activeChapter === 0">
              <div class="ck-trio-compact">
                <div class="ck-mini-stat" style="--cell-tone: var(--primary)"><span>基层支部</span><strong class="num">{{ stats.branches }}<small>个</small></strong></div>
                <div class="ck-mini-stat" style="--cell-tone: var(--chart-2)"><span>网格力量</span><strong class="num">{{ stats.gridStaff + stats.publicPost }}<small>人</small></strong></div>
                <div class="ck-mini-stat" style="--cell-tone: var(--chart-3)"><span>共驻单位</span><strong class="num">{{ stats.coBuild }}<small>家</small></strong></div>
              </div>
              <div class="ck-rank-list">
                <button
                  v-for="c in stats.partyTop"
                  :key="c.id"
                  type="button"
                  class="ck-rank-row"
                  @click="toggleCommunityLock(c.name)"
                >
                  <span class="ck-rank-name">{{ shortName(c.name) }}</span>
                  <span class="ck-cat-track"><i :style="{ width: barPct(c.party, stats.rankMax.party) + '%', background: 'var(--chart-1)' }"></i></span>
                  <b class="num">{{ c.party }}名</b>
                </button>
              </div>
            </template>

            <!-- 第 2 章：十四社区治理体检与待销号盯防 -->
            <template v-else-if="activeChapter === 1">
              <div class="ck-dual-compact">
                <div class="ck-mini-stat" style="--cell-tone: var(--ck-ok)"><span>安全检查覆盖率</span><strong class="num">{{ stats.avgCoverage }}<small>%</small></strong></div>
                <div class="ck-mini-stat" style="--cell-tone: var(--chart-2)"><span>政务抽查合格率</span><strong class="num">{{ stats.avgGovPass }}<small>%</small></strong></div>
              </div>
              <div class="ck-rank-list">
                <button
                  v-for="c in stats.riskTop"
                  :key="c.id"
                  type="button"
                  class="ck-rank-row"
                  @click="toggleCommunityLock(c.name)"
                >
                  <span class="ck-rank-name">{{ shortName(c.name) }}</span>
                  <span class="ck-cat-track">
                    <i :style="{ width: barPct(c.safety.hazards - c.safety.fixed, stats.rankMax.risk) + '%', background: c.health === 'bad' ? 'var(--ck-danger)' : 'var(--ck-warn)' }"></i>
                  </span>
                  <b class="num" :style="{ color: c.health === 'bad' ? 'var(--ck-danger)' : 'var(--ck-warn)' }">待销 {{ c.safety.hazards - c.safety.fixed }} 处</b>
                </button>
              </div>
            </template>

            <!-- 第 3 章：安全生产与产值前四强社区 -->
            <template v-else-if="activeChapter === 2">
              <div class="ck-dual-compact">
                <div class="ck-mini-stat" style="--cell-tone: var(--ck-warn)"><span>重点监管企业</span><strong class="num">{{ stats.regEnt }}<small>家</small></strong></div>
                <div class="ck-mini-stat" style="--cell-tone: var(--ck-ok)"><span>隐患整改销号率</span><strong class="num">{{ stats.hazards ? ((stats.fixed / stats.hazards) * 100).toFixed(1) : '100.0' }}<small>%</small></strong></div>
              </div>
              <div class="ck-rank-list">
                <button
                  v-for="c in stats.revenueTop"
                  :key="c.id"
                  type="button"
                  class="ck-rank-row"
                  @click="toggleCommunityLock(c.name)"
                >
                  <span class="ck-rank-name">{{ shortName(c.name) }}</span>
                  <span class="ck-cat-track"><i :style="{ width: barPct(c.biz.revenue, stats.rankMax.revenue) + '%', background: 'var(--ck-accent)' }"></i></span>
                  <b class="num">{{ c.biz.revenue }}亿</b>
                </button>
              </div>
            </template>

            <!-- 第 4 章：城乡生态与防汛防火盯防 -->
            <template v-else-if="activeChapter === 3">
              <div class="ck-quad-strip">
                <div class="ck-quad-cell" style="--cell-tone: var(--ck-run)"><span>易涝点</span><strong class="num">{{ stats.floodPts }}</strong></div>
                <div class="ck-quad-cell" style="--cell-tone: var(--ck-danger)"><span>防火点</span><strong class="num">{{ stats.firePts }}</strong></div>
                <div class="ck-quad-cell" style="--cell-tone: var(--chart-2)"><span>河道公里</span><strong class="num">{{ stats.riversKm }}</strong></div>
                <div class="ck-quad-cell" style="--cell-tone: var(--chart-5)"><span>裸土万㎡</span><strong class="num">{{ stats.bareSoilWan }}</strong></div>
              </div>
              <div class="ck-rank-list">
                <button
                  v-for="c in stats.ecoTop"
                  :key="c.id"
                  type="button"
                  class="ck-rank-row"
                  @click="toggleCommunityLock(c.name)"
                >
                  <span class="ck-rank-name">{{ shortName(c.name) }}</span>
                  <span class="ck-cat-track"><i :style="{ width: barPct(c.env.floodPts + c.env.firePts, stats.rankMax.eco) + '%', background: 'var(--ck-run)' }"></i></span>
                  <b class="num">易涝 {{ c.env.floodPts }} · 防火 {{ c.env.firePts }}</b>
                </button>
              </div>
            </template>

            <!-- 第 5 章：共享辅助站 5 类物资库存实数 -->
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
          </section>

          <!-- 板块 4：基层减负「数据直达」宽表采集脉搏 -->
          <section class="ck-block ck-tight-block">
            <button type="button" class="ck-block-head" @click="router.push('/data-direct')">
              <span class="ck-block-label">数据直达 · 一表通减负</span>
              <span class="ck-accent-pill num">归并减负 78% ›</span>
            </button>
            <div class="ck-direct-list">
              <button
                v-for="(t, tIdx) in stats.directTasks"
                :key="t.id"
                type="button"
                class="ck-direct-item"
                :style="{ '--task-tone': t.pct >= 100 ? 'var(--ck-ok)' : (tIdx === 0 ? 'var(--chart-2)' : 'var(--primary)') }"
                @click="router.push('/data-direct')"
              >
                <div class="ck-direct-top">
                  <span>{{ t.title }}</span>
                  <b class="num">{{ t.done }}/{{ t.total }}条 · <em>{{ t.pct }}%</em></b>
                </div>
                <div class="ck-cat-track">
                  <i :style="{ width: Math.max(t.pct, 4) + '%', background: 'var(--task-tone)' }"></i>
                </div>
              </button>
            </div>
          </section>
        </template>

        <!-- 日常调度态：左轨变为今日急难愁盼待办流 -->
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
            <span class="num ck-title-count">在办 {{ stats.openEvents.length }} 件</span>
          </div>
          <div class="ck-trio-compact ck-dispatch-trio">
            <div class="ck-mini-stat" style="--cell-tone: var(--ck-danger)"><span>受理派单</span><strong class="num">{{ stats.acceptDispatch }}</strong></div>
            <div class="ck-mini-stat" style="--cell-tone: var(--ck-warn)"><span>办理复核</span><strong class="num">{{ stats.handleReview }}</strong></div>
            <div class="ck-mini-stat" :style="{ '--cell-tone': stats.overdueCnt ? 'var(--ck-danger)' : 'var(--ck-ok)' }"><span>已超时</span><strong class="num">{{ stats.overdueCnt }}</strong></div>
          </div>
          <div class="ck-live-list ck-dispatch-list">
            <button
              v-for="ev in dispatchEvents"
              :key="ev.id"
              type="button"
              class="ck-live-item"
              :class="{ 'is-selected': selectedEvent?.id === ev.id }"
              @click="handleSelectEvent(ev)"
            >
              <span class="ck-live-dot" :style="{ background: stageDotColor(ev) }"></span>
              <div class="ck-live-body">
                <span class="ck-live-title">{{ ev.title }}</span>
                <span class="ck-live-sub num">{{ ev.community }} · 已耗 {{ ev.elapsedHours }}/{{ ev.deadlineHours }} 小时</span>
                <span class="ck-sla-track" aria-hidden="true">
                  <i :style="{ width: Math.min(100, Math.round((Number(ev.elapsedHours) / Math.max(0.1, Number(ev.deadlineHours))) * 100)) + '%', background: stageDotColor(ev) }"></i>
                </span>
              </div>
              <span class="tag" :class="stageTagClass(ev)">{{ isOverdue(ev) ? '已超时' : ev.stage }}</span>
            </button>
            <div v-if="!dispatchEvents.length" class="ck-empty">当前范围内暂无在办事项</div>
          </div>
        </template>
      </aside>

      <!-- 右悬浮轨：楼栋一楼一档 / 实体调度 / 事项穿透 / 默认全闭环统计 -->
      <aside class="ck-rail ck-rail-right ck-dense-rail">
        <BuildingProfilePanel
          v-if="selectedBuildingDetail || selectedEntity"
          :building-detail="selectedBuildingDetail"
          :entity-detail="selectedEntity"
          :emergency-info="emergencyInfo"
          :radius-active="radiusActive"
          @close="closeRightPenetration"
          @toggle-radius="radiusActive = !radiusActive"
          @dispatch-staff="handleDispatchStaff"
          @create-inspection="handleCreateInspection"
          @borrow-aid="handleBorrowAid"
          @select-building-index="handleSelectBuildingByIndex"
          @select-event="handleSelectEvent"
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
              <span :class="{ 'is-bad': isOverdue(selectedEvent) }">已耗 {{ selectedEvent.elapsedHours }}/{{ selectedEvent.deadlineHours }} 小时</span>
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
                <strong>300 米内最近网格员 · {{ emergencyInfo.nearbyStaff[0].name }}</strong>
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

          <!-- 板块 1：按期办结率 + 三态实时槽 -->
          <section class="ck-block ck-tight-block">
            <div style="display: flex; align-items: baseline; justify-content: space-between; gap: 6px; min-width: 0">
              <div class="ck-big-figure" style="flex-shrink: 0; white-space: nowrap">
                <strong class="num" style="font-size: 26px; color: var(--ck-ok)">{{ stats.rateExact }}<small v-if="stats.rateExact !== '—'" style="font-size: 13px">%</small></strong>
                <span style="font-size: 11.5px; white-space: nowrap">办结率</span>
              </div>
              <span class="ck-block-note num" style="white-space: nowrap; font-size: 11px">已结 {{ stats.doneCnt }}/{{ stats.events.length }} · 均 {{ stats.avgHours }} 小时</span>
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
          <section class="ck-block ck-tight-block">
            <button type="button" class="ck-block-head" @click="router.push('/grid')">
              <span class="ck-block-label">{{ activeCategoryFilter ? `${activeCategoryFilter}事项` : '近期治理事项' }}</span>
              <span class="ck-mini-link num">研判台 ›</span>
            </button>
            <div class="ck-live-list ck-live-compact">
              <button
                v-for="e in filteredStreamEvents"
                :key="e.id"
                type="button"
                class="ck-live-item"
                :class="{ 'is-selected': selectedEvent?.id === e.id }"
                @click="handleSelectEvent(e)"
              >
                <span class="ck-live-dot" :style="{ background: stageDotColor(e) }"></span>
                <div class="ck-live-body">
                  <span class="ck-live-title">{{ e.title }}</span>
                  <span class="ck-live-sub num">{{ e.community }} · {{ e.category }} · {{ String(e.createdAt).slice(5, 16) }}</span>
                </div>
                <span class="tag" :class="stageTagClass(e)">{{ isOverdue(e) ? '已超时' : e.stage }}</span>
              </button>
            </div>
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
              <button type="button" class="ck-quad-cell" style="--cell-tone: var(--chart-3)" @click="router.push('/armed-forces')">
                <span>退役优抚</span>
                <strong class="num">{{ stats.armed.veterans }}</strong>
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
            v-for="c in COMMUNITIES"
            :key="c.id"
            type="button"
            class="ck-comm-mini"
            :class="['h-' + c.health, { active: scope === c.name }]"
            :disabled="role.scope !== '全街道' && role.scope !== c.name"
            @mouseenter="hoveredComm = c.name"
            @mouseleave="hoveredComm = ''"
            @click="toggleCommunityLock(c.name)"
          >
            <span class="c14-name">
              <i class="c14-dot" :class="'d-' + c.health"></i>{{ shortName(c.name) }}
            </span>
            <strong class="num">{{ c.safety.hazards - c.safety.fixed ? `待销 ${c.safety.hazards - c.safety.fixed}` : '平稳' }}</strong>
          </button>
        </div>
      </section>
    </main>

    <DrilldownDrawer
      :open="drill.open"
      :title="drill.title"
      :subtitle="drill.subtitle"
      :summary-text="drill.summary"
      :filters="drill.filters"
      :columns="drill.columns"
      :rows="drill.rows"
      :export-name="drill.exportName"
      @close="drill.open = false"
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

.ck-preset-bar {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding: 0 9px;
  border-radius: var(--r-control);
  border: var(--hair) solid var(--ck-border);
  background: var(--ck-panel);
  box-shadow: var(--e1), var(--ck-edge);
}

.ck-preset-dot {
  width: 18px;
  height: 18px;
  padding: 2px;
  border-radius: 50%;
  border: 1.5px solid transparent;
  background: transparent;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: transform 0.14s ease, border-color 0.14s ease;
}

.ck-preset-dot:hover {
  transform: scale(1.12);
}

.ck-preset-dot.active {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--primary-soft);
}

.ck-preset-dot i {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
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
.ck-narrow-panels.ck-nav-tabs { display: none; }
@media (max-width: 1100px) {
  .ck-shell { padding: 0 6px 6px; grid-template-rows: auto minmax(0,1fr); }
  .ck-header.ck-header-center {
    grid-template-columns: auto minmax(0,1fr);
    grid-template-areas: "brand brand" "mode tools";
    gap: 3px 6px;
    padding: 0 4px 5px;
  }
  .ck-brand.ck-brand-center { grid-area: brand; height: 46px; }
  .ck-head-left { grid-area: mode; }
  .ck-header.ck-header-center .ck-tools {
    grid-area: tools; max-width: 100%; min-width: 0; gap: 5px; overflow-x: auto; scrollbar-width: none;
  }
  .ck-tools > * { flex: none; }
  .ck-clock { display: none; }
  .ck-narrow-panels.ck-nav-tabs {
    display: inline-flex; position: absolute; z-index: 430; top: 8px; left: 8px; background: var(--ck-panel-solid);
  }
  .ck-stage .ck-map-topbar, .ck-stage .ck-rail { display: none; }
  .ck-stage[data-panel="data"] .ck-map-topbar {
    display: flex; left: 8px; right: 8px; top: 49px; gap: 4px;
  }
  .ck-stage[data-panel="data"] .ck-rail-left, .ck-stage[data-panel="events"] .ck-rail-right {
    display: flex; left: 8px; right: 8px; width: auto; bottom: 8px; background: var(--ck-panel-solid);
  }
  .ck-stage[data-panel="data"] .ck-rail-left { top: 197px; }
  .ck-stage[data-panel="events"] .ck-rail-right { top: 49px; }
  .ck-stage:not([data-panel="map"]) .ck-map-fab,
  .ck-stage:not([data-panel="map"]) .ck-collect-bar { display: none; }
  .ck-stage:not([data-panel="map"]) .ck-map-layer { visibility: hidden; }
  .ck-map-topbar .ck-kpi-grid {
    display: grid; grid-template-columns: repeat(6, minmax(104px, 1fr)); overflow-x: auto; scrollbar-width: thin;
  }
  .ck-stage .ck-collect-bar { left: 8px; right: 8px; bottom: 8px; }
  .ck-model-preview .ck-preview-controls { left: 8px; right: auto; bottom: 74px; }
  .ck-stage .ck-map-fab { bottom: 111px; right: 8px; }
  .ck-map-layer :deep(.city3d-ctrl.is-cockpit) {
    bottom: 74px; left: 8px; right: 8px; max-width: max-content; overflow-x: auto; scrollbar-width: none;
  }
  .ck-map-layer :deep(.city3d-legend.is-cockpit) { left: 8px; bottom: 111px; width: 200px; }
}
@media (max-width: 480px) {
  .ck-map-layer :deep(.city3d-legend.is-cockpit) { bottom: 153px; }
  .ck-stage .ck-map-fab { flex-direction: row; align-items: center; flex-wrap: wrap; left: 8px; }
  .ck-map-topbar .ck-pill { padding-inline: 2px; }
}
</style>
