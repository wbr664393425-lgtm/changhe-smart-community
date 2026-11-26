<script setup>
import { ref, shallowRef, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { COMMUNITIES, store } from '../store/appStore'
import { CHANGHE_OUTER_BOUNDARY, CHANGHE_LABEL_OFFSETS } from '../utils/changheGeo'
import { createCockpitWaterfrontAsync, WATER_REFLECTION_LAYER } from '../utils/cockpitWaterfront'
import amapPolyData from '../utils/changheAmapPolygons.json'
import {
  latLngToWorldXZ,
  WORLD_DIV,
  CHANGHE_HQ_LATLNG,
  loadChangheAmapAssets,
  ensureAmapTexture,
  uploadLargeTextureSlicedAsync,
  preloadSecondaryAmapAssets,
  buildMergedAmapBuildingGeometries,
  buildMergedAmapBuildingGeometriesAsync,
  yieldToPaint
} from '../utils/cityModelCache'
import {
  getCockpitBuildingIndex,
  getCockpitBuildingIndexAsync,
  buildEventBuildingMap,
  buildCockpitEntities
} from '../utils/cockpitBuildingIndex'
import { createStaffLiveEngine, createStaffLiveEngineAsync, TRAIL_LEN } from '../utils/cockpitStaffLive'
import { createStaffMarkers, staffOverviewWeight, staffPointOpacity } from '../utils/cockpitStaffMarkers'
import {
  chooseStaffView, createStaffCameraGlide, createStreetCameraGlide, fitCommunityPanorama, getStaffFraming,
  STAFF_AIM_Y, STAFF_GROUND_Y, STAFF_MIN_VIEW_DISTANCE, STREET_ZOOM
} from '../utils/cockpitStaffView'

const props = defineProps({
  mode: { type: String, default: 'cockpit' }, // cockpit | login | portal | hub | grid | single | patrol | armed
  dark: { type: Boolean, default: false },
  selectedCommunity: { type: String, default: '全街道' },
  hoveredCommunity: { type: String, default: '' },
  slice: { type: String, default: 'safety' }, // safety | party | economy | eco | aid
  chapterIndex: { type: Number, default: 0 },
  events: { type: Array, default: () => [] },
  compact: { type: Boolean, default: false },
  singleEvent: { type: Object, default: null },
  patrolRecord: { type: Object, default: null },
  patrolStepIdx: { type: Number, default: 0 },
  patrolThreshold: { type: Number, default: 30 },
  armedTopic: { type: String, default: 'party' }, // party | militia | recruit | mobilize | education
  mobilizeLayer: { type: String, default: 'both' }, // both | rally | veteran
  armedPlaces: { type: Array, default: () => [] },
  // 驾驶舱三维实效业务扩展
  narrowPanelOpen: Boolean,
  cockpitViewMode: { type: String, default: 'report' }, // report | dispatch
  selectedBuildingIndex: { type: Number, default: -1 },
  selectedEntityId: { type: String, default: '' },
  selectedEventId: { type: String, default: '' },
  emergencyInfo: { type: Object, default: null },
  focusedFloor: { type: Object, default: null }, // { floor, totalFloors, tone, label }
  theaterMode: { type: Boolean, default: false },
  tourRunning: { type: Boolean, default: false },
  // 大屏外部全屏加载序幕与三幕入场协调
  externalLoader: { type: Boolean, default: false },
  deferReveal: { type: Boolean, default: false },
  labelsVisible: { type: Boolean, default: true },
  paused: { type: Boolean, default: false },
  // 网格员实时定位与电影级低空跟拍
  staffLayerActive: { type: Boolean, default: false },
  staffCommunityCounts: { type: Object, default: null },
  staffStatusFocus: { type: String, default: 'all' },
  getStaffEngine: { type: Function, default: null },
  getStaffEngineAsync: { type: Function, default: null },
  followStaffId: { type: String, default: '' },
  followAltitude: { type: String, default: 'low' } // low | mid
})

const emit = defineEmits([
  'select-community',
  'select-staff-community',
  'select-event',
  'select-point',
  'select-patrol-step',
  'select-building',
  'select-entity',
  'reset-panorama',
  'webgl-fallback',
  'load-progress',
  'scene-ready',
  'hover-community',
  'update:staffLayerActive',
  'stop-follow',
  'staff-roster-ready',
  'staff-live-tick',
  'orbit-change'
])

const rootEl = ref(null)
const canvasHost = ref(null)
const loading = ref(true)
const loadProgress = ref(20)
const webglFailed = ref(false)
const autoOrbit = ref(false)
const cameraPreset = ref('hero') // hero | park | bridge | xingkai | top
const timePhaseOverride = ref(null) // null（跟随深浅默认昼/夜） | 'dawn' | 'noon' | 'dusk' | 'night'
const groundStyle = ref('amap') // amap（高德官方矢量底图·默认） | sat（卫星实景叠加）
const comparingImagery = ref(false)
const IMAGERY_LAYER = 2
const hoveredLocal = ref('')
const hoveredBuilding = shallowRef(null) // { bldg, x, y, openCount, chip }
const hoveredPatrolIdx = ref(-1)
const projectedLabels = shallowRef([])
const projectedEntityLabels = shallowRef([])
const projectedFloorTag = shallowRef(null)
const projectedSingleLabel = shallowRef(null)
const projectedPatrolLabels = shallowRef([])
const projectedArmedLabels = shallowRef([])
const hqScreenPos = shallowRef({ x: 0, y: 0, visible: false })

// 标杆楼默认开启，人员巡防由演示者按需展开；辅助站/汛火点随当前专题切片同步初值并可自由开关。
const cockpitLayers = ref({
  landmarks: true,
  staff: props.staffLayerActive,
  aid: props.slice === 'aid',
  eco: props.slice === 'eco'
})
const staffLayerVisible = computed(() => cockpitLayers.value.staff || props.staffLayerActive || Boolean(props.followStaffId))
const streetFollowing = computed(() => props.mode === 'cockpit' && Boolean(props.followStaffId) && props.followAltitude === 'low')
const focusedOnPersonnel = computed(() => props.mode === 'cockpit' && staffLayerVisible.value && !props.selectedEventId &&
  (props.staffStatusFocus !== 'all' || Boolean(props.followStaffId) || Boolean(props.selectedEntityId && staffLiveEngine?.getRawById(props.selectedEntityId))))
const layerFilters = computed(() => [
  { key: 'landmarks', label: '标杆楼', active: cockpitLayers.value.landmarks },
  { key: 'staff', label: '网格员', active: staffLayerVisible.value },
  { key: 'aid', label: '辅助站', active: cockpitLayers.value.aid },
  { key: 'eco', label: '汛火点', active: cockpitLayers.value.eco }
])
const activeLegendLevel = ref(-1) // -1 表示全部，0..3 表示按图例聚焦某一重点类型

const effectiveTimePhase = computed(() => {
  if (timePhaseOverride.value) return timePhaseOverride.value
  return (props.dark || store.preset === 'command-dark') ? 'night' : 'noon'
})
const isNightScene = computed(() => effectiveTimePhase.value === 'night')
const TIME_PHASES = [
  { key: 'dawn', label: '晨', title: '晨光破晓光影' },
  { key: 'noon', label: '昼', title: '正午清朗白模' },
  { key: 'dusk', label: '暮', title: '暮金斜阳氛围' },
  { key: 'night', label: '夜', title: '暗夜万家灯火' }
]
const activeHover = computed(() => props.hoveredCommunity || hoveredLocal.value)
watch(hoveredLocal, (name) => emit('hover-community', name || ''))

const SLICE_PALETTES = {
  safety: {
    title: '治理体检 · 隐患态势',
    unit: '社区等级',
    ticks: ['标杆', '平稳', '关注', '督办'],
    colors: ['#2a8a5e', '#3d7ea6', '#d08417', '#c8402a']
  },
  party: {
    title: '党建引领 · 在册党员',
    unit: '人',
    ticks: ['<140', '140+', '170+', '210+'],
    colors: ['#f59e8b', '#ef6c5d', '#dc3838', '#b81c28']
  },
  economy: {
    title: '经济脉动 · 规上产值',
    unit: '亿元',
    ticks: ['<10', '10+', '14+', '20+'],
    colors: ['#d6be86', '#e0b354', '#e59a28', '#d97706']
  },
  eco: {
    title: '生态防汛 · 风险指数',
    unit: '点位',
    ticks: ['平稳', '常规', '关注', '重点'],
    colors: ['#34d399', '#2dd4bf', '#38bdf8', '#0284c7']
  },
  aid: {
    title: '民情守护 · 重点关怀',
    unit: '人',
    ticks: ['<120', '120+', '135+', '150+'],
    colors: ['#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9']
  }
}

const currentLegend = computed(() => {
  const pal = SLICE_PALETTES[props.slice] || SLICE_PALETTES.safety
  return { title: pal.title, unit: pal.unit, ticks: pal.ticks, colors: pal.colors }
})

function getCommunityLevel(c, slice) {
  if (slice === 'party') {
    if (c.party >= 210) return 3
    if (c.party >= 170) return 2
    if (c.party >= 140) return 1
    return 0
  }
  if (slice === 'economy') {
    if (c.biz.revenue >= 20) return 3
    if (c.biz.revenue >= 14) return 2
    if (c.biz.revenue >= 10) return 1
    return 0
  }
  if (slice === 'eco') {
    const pts = c.env.floodPts + c.env.firePts
    if (pts >= 5) return 3
    if (pts >= 3) return 2
    if (c.env.bareSoil >= 1500) return 1
    return 0
  }
  if (slice === 'aid') {
    const sum = c.special.elderAlone + c.special.lowIncome + c.special.disabled + c.special.veteran
    if (sum >= 150) return 3
    if (sum >= 135) return 2
    if (sum >= 120) return 1
    return 0
  }
  const openHz = c.safety.hazards - c.safety.fixed
  if (c.health === 'bad') return 3
  if (c.health === 'warn') return 2
  if (c.safety.coverage >= 98 && openHz === 0) return 0
  return 1
}

function getCommunityMetricChip(c, slice) {
  if (slice === 'party') return `${c.party}党员`
  if (slice === 'economy') return `${c.biz.revenue}亿`
  if (slice === 'eco') return `涝${c.env.floodPts}·火${c.env.firePts}`
  if (slice === 'aid') {
    const sum = c.special.elderAlone + c.special.lowIncome + c.special.disabled + c.special.veteran
    return `${sum}关怀`
  }
  const openHz = c.safety.hazards - c.safety.fixed
  if (openHz > 0) return `待销 ${openHz}`
  return getCommunityLevel(c, 'safety') === 0 ? '标杆' : '平稳'
}

function pointInPolyXZ(x, z, polyXZ) {
  let inside = false
  for (let i = 0, j = polyXZ.length - 1; i < polyXZ.length; j = i++) {
    const xi = polyXZ[i][0], zi = polyXZ[i][1]
    const xj = polyXZ[j][0], zj = polyXZ[j][1]
    const hit = (zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-9) + xi
    if (hit) inside = !inside
  }
  return inside
}

// ── Three.js 运行时状态 ──
let renderer = null
let scene = null
let camera = null
let controls = null
let sunLight = null
let fillLight = null
let hemiLight = null
let farGroundMesh = null
let groundMesh = null
let groundMat = null
let waterfront = null
const terrainCorrection = { value: new THREE.Vector2() }
const groundFarUniform = { value: new THREE.Color('#eae3d8') }
let innerBldgMat = null
let outerBldgMat = null
let innerEdgeMat = null
let outerEdgeMat = null
let assetsRef = null
const slicedGpuTexMap = new Map()
function resolveGroundTex(key) {
  return slicedGpuTexMap.get(key) || assetsRef?.[key] || null
}
let cityGroup = null
let overlayGroup = null
let dynamicGroup = null
let entityGroup = null
let emergencyGroup = null
let selectedOutlineGroup = null
let hoverOutlineGroup = null
let floorBandGroup = null
let imageryMat = null
let outerTubeMat = null
let outerGlowMat = null
let boundaryCurtainMat = null
let compassDiscMat = null
let skyDomeMesh = null
let skyDomeMat = null
let hqBeamMat = null
let hqBeacon = null
let hqRings = []
let dynamicTimeMats = []
let arcParticles = []
let alertRings = []
let pickableDynamicTargets = []
const zoneEntries = new Map() // name -> { polyXZ, centerXZ, borderMat, fillMesh, fillMat, selTubeMesh, selTubeMat, community }

// 人员地图层共享人物、头像和脚环三组实例，短轨迹只服务当前选中人员。
let staffLiveEngine = null
let staffLiveGroup = null
let staffMarkers = null
let staffLabelObstacles = []
let staffTrailMesh = null
let staffTrailGeo = null
let hoveredStaffId = ''
let followSmoothedYaw = 0
let followView = { offset: 0.48, ...getStaffFraming('mid', 900) }
let nextSightlineCheck = 0
let lastLabelTickMs = 0
let lastLiveTickEmitMs = 0
const _followGoalPos = new THREE.Vector3()
const _followGoalLook = new THREE.Vector3()

// 常驻复用的单栋选中/悬停/单层亮带材质，避免反复分配释放
const selOutlineTopMat = new THREE.MeshBasicMaterial({ color: 0xe63946, transparent: true, opacity: 0.96 })
const selOutlineBaseMat = new THREE.MeshBasicMaterial({ color: 0xe63946, transparent: true, opacity: 0.72 })
const hovOutlineTopMat = new THREE.MeshBasicMaterial({ color: 0xd99b38, transparent: true, opacity: 0.96 })
const hovOutlineBaseMat = new THREE.MeshBasicMaterial({ color: 0xd99b38, transparent: true, opacity: 0.72 })
const floorBandRingMat = new THREE.MeshBasicMaterial({ color: 0xf4c97a, transparent: true, opacity: 0.96 })

// 驾驶舱建筑语义索引与 128×64 RGBA DataTexture（兼容所有集显，零新增 DrawCall 动态着色）
const SEM_TEX_W = 128
const SEM_TEX_H = 64
const baseBldgColorData = new Uint8Array(SEM_TEX_W * SEM_TEX_H * 4)
const bldgColorData = new Uint8Array(SEM_TEX_W * SEM_TEX_H * 4)
const bldgColorTex = new THREE.DataTexture(bldgColorData, SEM_TEX_W, SEM_TEX_H, THREE.RGBAFormat)
bldgColorTex.minFilter = THREE.NearestFilter
bldgColorTex.magFilter = THREE.NearestFilter
bldgColorTex.generateMipmaps = false
bldgColorTex.needsUpdate = true

let buildingIndexRef = null
let cockpitEntitiesRef = { gridStaff: [], aidStations: [], ecoRisks: [], landmarks: [] }
let lastEventBldgMap = new Map()
let hoveredBldgIndex = -1
let appliedHoverBldgIndex = -1
let hoveredBldgMetaCache = null // 缓存同楼移动文案，避免每像素重算 events.filter

// 渲染/投影脏检查与缓存状态
let hostWidth = 0
let hostHeight = 0
let cachedCanvasRect = null
let lastCursor = ''
let pointerMoveRaf = null
let pendingPointerClient = null
let labelsDirty = true
let hasLastCamVP = false
const _tmpCamVP = new THREE.Matrix4()
const _lastCamVP = new Float32Array(16)
let staticRenderNeeded = true
let cancelSecondaryPreload = null
let secondaryPreloadTimer = null

// 预解析专题配色，避免 updateZoneStyles 每次悬停重复 new THREE.Color
const SLICE_COLOR_CACHE = new Map()
function getCachedThreeColor(hex) {
  let c = SLICE_COLOR_CACHE.get(hex)
  if (!c) {
    c = new THREE.Color(hex)
    SLICE_COLOR_CACHE.set(hex, c)
  }
  return c
}

// 着色器统一驱动（切换时辰与主题时平滑插值更新，无需重建几何体）
const [hqIntroX, hqIntroZ] = latLngToWorldXZ(CHANGHE_HQ_LATLNG[0], CHANGHE_HQ_LATLNG[1])
const bldgUniforms = {
  uBottomCol: { value: new THREE.Color('#cfd8e3') },
  uTopCol: { value: new THREE.Color('#f6f8fb') },
  uRoofCol: { value: new THREE.Color('#ffffff') },
  uLineCol: { value: new THREE.Color('#b6c4d4') },
  uNight: { value: 0 },
  uWindowGlow: { value: 0 },
  uStreetDetail: { value: 0 },
  uTime: { value: 0 },
  uOuterBottomCol: { value: new THREE.Color('#dde4ec') },
  uOuterTopCol: { value: new THREE.Color('#f2f5f9') },
  uOuterRoofCol: { value: new THREE.Color('#f7f9fc') },
  uBldgColorTex: { value: bldgColorTex },
  uUseSemantic: { value: 0 },
  // 楼栋电影级聚光压暗与精确单层亮带
  uFocusActive: { value: 0.0 },
  uFocusBldgId: { value: -1.0 },
  uFloorBandActive: { value: 0.0 },
  uFloorBandY: { value: 0.0 },
  uFloorBandHalfH: { value: 0.35 },
  uFloorBandCol: { value: new THREE.Color('#f4c97a') },
  // 入场指挥中心柔光扫楼 + 楼宇优雅苏醒（零额外 DrawCall）
  uWaveOrigin: { value: new THREE.Vector2(hqIntroX, hqIntroZ) },
  uWaveRadius: { value: 1400.0 },
  uWaveActive: { value: 0.0 },
  uWaveColor: { value: new THREE.Color('#e8c484') }
}

let targetFogDensity = 0.00046
let targetEdgeInOp = 0.56
let targetEdgeOutOp = 0.28
let currentAtmo = null
let lightingTransition = null
let focusTargetFactor = 0
let lastAppliedVecNight = null

let rafId = null
let resizeObserver = null
let intersectionObserver = null
let isRenderPaused = false
let introHoldPaused = false
let contentSkipped = false
let narrowScreen = null
let prefersReducedMotion = false
let isDisposed = false

const _tmpIntroLook = new THREE.Vector3()
const _tmpIntroOffset = new THREE.Vector3()
const _tmpIntroSph = new THREE.Spherical()
const _tmpFlightPos = new THREE.Vector3()
const _tmpFlightLook = new THREE.Vector3()

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
let pointerDownPos = { x: 0, y: 0 }

const camTargetPos = new THREE.Vector3()
const camTargetLook = new THREE.Vector3()
let isCamAnimating = false
let staffGlide = null
let staffWheelZoom = null
const staffWheelAnchor = new THREE.Vector3()
const staffGroundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -STAFF_GROUND_Y)
let lastPanorama = null
let cameraFlightAnim = null
let introCamAnim = null
let introWaveAnim = null

function getIntroStartPose() {
  const hero = getCameraPose('hero')
  const offset = hero.pos.clone().sub(hero.look)
  const sph = new THREE.Spherical().setFromVector3(offset)
  sph.radius *= 1.44
  sph.phi = Math.max(0.24, sph.phi * 0.88)
  sph.theta += 0.245 // 约 +14° 航拍优雅偏航角，落位时走电影级轻弧线
  const startLook = new THREE.Vector3(hero.look.x - 6, hero.look.y + 10, hero.look.z - 20)
  const startPos = startLook.clone().add(new THREE.Vector3().setFromSpherical(sph))
  return { pos: startPos, look: startLook }
}

function finishIntroVisualsImmediately() {
  introCamAnim = null
  introWaveAnim = null
  introHoldPaused = false
  bldgUniforms.uWaveActive.value = 0.0
  bldgUniforms.uWaveRadius.value = 1400.0
  if (scene?.fog) scene.fog.density = targetFogDensity
  if (innerEdgeMat) innerEdgeMat.opacity = targetEdgeInOp
  if (outerEdgeMat) outerEdgeMat.opacity = targetEdgeOutOp
  waterfront?.setReflectionPaused(false)
}

function playIntroCamera(durationMs = 2050) {
  if (!camera || !controls || isDisposed) return
  staffGlide = null
  staffWheelZoom = null
  introHoldPaused = false
  const hero = getCameraPose('hero')
  if (prefersReducedMotion || durationMs <= 0) {
    finishIntroVisualsImmediately()
    isCamAnimating = false
    camera.position.copy(hero.pos)
    controls.target.copy(hero.look)
    controls.update()
    handleVisibilityChange()
    return
  }

  const start = getIntroStartPose()
  const fromSph = new THREE.Spherical().setFromVector3(start.pos.clone().sub(start.look))
  const toSph = new THREE.Spherical().setFromVector3(hero.pos.clone().sub(hero.look))

  isCamAnimating = false
  camera.position.copy(start.pos)
  controls.target.copy(start.look)
  controls.update()

  const now = performance.now()
  introCamAnim = {
    startTime: now,
    duration: durationMs,
    fromSph,
    toSph,
    fromLook: start.look.clone(),
    toLook: hero.look.clone()
  }

  // 同步启动指挥中心柔光扫楼 + 晨雾渐散 + 屋顶棱线凝现（2 秒弧线期间复用预热好的水面倒影，杜绝帧率抖动）
  bldgUniforms.uWaveActive.value = 1.0
  bldgUniforms.uWaveRadius.value = -36.0
  if (scene?.fog) scene.fog.density = targetFogDensity * 1.95
  if (innerEdgeMat) innerEdgeMat.opacity = 0
  if (outerEdgeMat) outerEdgeMat.opacity = 0
  waterfront?.setReflectionPaused(true)
  introWaveAnim = {
    startTime: now + 80,
    waveDuration: 1920,
    fogDuration: 1680
  }

  handleVisibilityChange()
}

function getChapterFlight(idx) {
  const [hx, hz] = latLngToWorldXZ(CHANGHE_HQ_LATLNG[0], CHANGHE_HQ_LATLNG[1])
  const [px, pz] = waterfront?.parkFocus
    ? [waterfront.parkFocus.x, waterfront.parkFocus.y]
    : latLngToWorldXZ(37.4418, 116.3485)
  const [bx, bz] = waterfront?.bridgeFocus
    ? [waterfront.bridgeFocus.x, waterfront.bridgeFocus.y]
    : latLngToWorldXZ(37.4416, 116.3358)
  const [sx, sz] = latLngToWorldXZ(37.4445, 116.3415)

  switch (idx) {
    case 0: // 全域家底党建：广角端庄微推扫过指挥中心
      return {
        startPos: new THREE.Vector3(36, 560, 520),
        startLook: new THREE.Vector3(hx - 6, 4, hz + 8),
        endPos: new THREE.Vector3(-14, 525, 488),
        endLook: new THREE.Vector3(18, 2, 0)
      }
    case 1: // 十四社区体检：中景稳推堤口与中轴住宅
      return {
        startPos: new THREE.Vector3(-128, 232, 198),
        startLook: new THREE.Vector3(-56, 2, -52),
        endPos: new THREE.Vector3(-76, 210, 168),
        endLook: new THREE.Vector3(-34, 2, -48)
      }
    case 2: // 安全经济脉动：中低空环掠星凯商圈与核心写字楼群
      return {
        startPos: new THREE.Vector3(sx - 56, 138, sz + 132),
        startLook: new THREE.Vector3(sx + 6, 6, sz - 8),
        endPos: new THREE.Vector3(sx + 48, 126, sz + 118),
        endLook: new THREE.Vector3(sx + 10, 5, sz - 12)
      }
    case 3: // 生态防汛防火：低空贴水掠过岔河实景桥再缓升俯瞰长河公园
      return {
        startPos: new THREE.Vector3(bx + 36, 44, bz + 82),
        startLook: new THREE.Vector3(bx, 2, bz - 10),
        endPos: new THREE.Vector3(px - 22, 108, pz + 124),
        endLook: new THREE.Vector3(px + 8, 2, pz - 12)
      }
    default: // 民情闭环守护：拉回东南对称全景俯瞰调度光弧
      return {
        startPos: new THREE.Vector3(78, 430, 392),
        startLook: new THREE.Vector3(12, 2, -6),
        endPos: new THREE.Vector3(24, 512, 468),
        endLook: new THREE.Vector3(20, 0, 4)
      }
  }
}

function flyToChapter(idx = 0) {
  if (!camera || !controls || isDisposed || props.mode !== 'cockpit') return
  staffGlide = null
  staffWheelZoom = null
  if (introCamAnim || introWaveAnim) finishIntroVisualsImmediately()
  const flight = getChapterFlight(idx)
  cameraPreset.value = ''
  if (prefersReducedMotion) {
    cameraFlightAnim = null
    isCamAnimating = false
    camera.position.copy(flight.endPos)
    controls.target.copy(flight.endLook)
    controls.update()
    staticRenderNeeded = true
    return
  }
  isCamAnimating = false
  cameraFlightAnim = {
    startTime: performance.now(),
    enterDuration: 1450,
    glideDuration: 6200,
    fromPos: camera.position.clone(),
    fromLook: controls.target.clone(),
    startPos: flight.startPos,
    startLook: flight.startLook,
    endPos: flight.endPos,
    endLook: flight.endLook
  }
}

function getLiveStaffSnapshot() {
  return staffLiveEngine ? staffLiveEngine.getAll() : []
}

function updateLiveStaffStatus(id, nextStatus, extra = {}) {
  if (!staffLiveEngine) return null
  const updated = staffLiveEngine.setStatus(id, nextStatus, extra)
  if (updated) {
    emit('staff-roster-ready', staffLiveEngine.getAll())
    labelsDirty = true
    staticRenderNeeded = true
  }
  return updated
}

function focusOnStaff(id) {
  const st = staffLiveEngine?.getRawById(id)
  if (!st || !camera || !controls) return
  const bearing = Math.atan2(camera.position.x - st.x, camera.position.z - st.z)
  const framing = getStaffFraming('inspect', hostHeight)
  const { offset, distance, height } = chooseStaffView(buildingIndexRef, st, bearing, framing.distance, framing.height)
  const yaw = bearing + offset
  cameraPreset.value = ''
  autoOrbit.value = false
  animateCameraTo(
    new THREE.Vector3(st.x + Math.sin(yaw) * distance, height, st.z + Math.cos(yaw) * distance),
    new THREE.Vector3(st.x, STAFF_AIM_Y, st.z), 'inspect', id
  )
}

function setAutoOrbit(val) {
  autoOrbit.value = Boolean(val)
  staticRenderNeeded = true
}

defineExpose({
  playIntroCamera,
  applyCameraPreset,
  focusOnPointXZ,
  flyToChapter,
  getLiveStaffSnapshot,
  updateLiveStaffStatus,
  focusOnStaff,
  setAutoOrbit
})

function getCameraPose(preset = 'hero') {
  if (props.mode === 'single' && props.singleEvent) {
    const [ex, ez] = latLngToWorldXZ(props.singleEvent.lat, props.singleEvent.lng)
    if (preset === 'top') {
      return {
        pos: new THREE.Vector3(ex, 220, ez + 36),
        look: new THREE.Vector3(ex, 0, ez)
      }
    }
    return {
      pos: new THREE.Vector3(ex - 26, 118, ez + 116),
      look: new THREE.Vector3(ex, 4, ez - 4)
    }
  }
  if (props.mode === 'patrol' && props.patrolRecord?.track?.length) {
    const pts = props.patrolRecord.track.map((p) => latLngToWorldXZ(p.lat, p.lng))
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    pts.forEach(([x, z]) => {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    })
    const cx = (minX + maxX) / 2
    const cz = (minZ + maxZ) / 2
    const span = Math.max(46, Math.hypot(maxX - minX, maxZ - minZ))
    if (preset === 'top') {
      return {
        pos: new THREE.Vector3(cx, Math.max(190, span * 3.1), cz + 32),
        look: new THREE.Vector3(cx, 0, cz)
      }
    }
    return {
      pos: new THREE.Vector3(cx - span * 0.35, Math.max(115, span * 1.95), cz + Math.max(112, span * 1.9)),
      look: new THREE.Vector3(cx, 3, cz - 4)
    }
  }

  const isCockpit = props.mode === 'cockpit'
  const isLogin = props.mode === 'login'
  const isRichCity = isCockpit || isLogin
  const loginShiftX = isLogin ? 34 : 0
  if (isRichCity && waterfront && (preset === 'park' || preset === 'bridge')) {
    const bridge = preset === 'bridge'
    const { x, y: z } = bridge ? waterfront.bridgeFocus : waterfront.parkFocus
    return {
      pos: bridge
        ? new THREE.Vector3(x + 21 + loginShiftX, 28, z + 58)
        : new THREE.Vector3(x - 13 + loginShiftX, 72, z + 87),
      look: new THREE.Vector3(x + loginShiftX, 1, z)
    }
  }
  if (preset === 'park') {
    // 46° 端庄建筑摄影角特写长河公园大湖与周边建筑群
    const [px, pz] = latLngToWorldXZ(37.4418, 116.3485)
    return {
      pos: new THREE.Vector3(px - 28 + loginShiftX, 152, pz + 148),
      look: new THREE.Vector3(px + 6 + loginShiftX, 2, pz - 10)
    }
  }
  if (preset === 'xingkai') {
    // 46° 端庄俯瞰星凯商圈与堤口/锦绣街区
    const [sx, sz] = latLngToWorldXZ(37.4445, 116.3415)
    return {
      pos: new THREE.Vector3(sx - 30 + loginShiftX, 156, sz + 150),
      look: new THREE.Vector3(sx + 6 + loginShiftX, 2, sz - 8)
    }
  }
  if (preset === 'top') {
    return {
      pos: new THREE.Vector3(6 + loginShiftX, isCockpit ? 590 : 510, 110),
      look: new THREE.Vector3(6 + loginShiftX, 0, -10)
    }
  }
  if (isLogin) {
    // 登录页黄金鸟瞰：东偏留出左侧与中轴宽阔城景，自然避让右侧登录控制台
    return {
      pos: new THREE.Vector3(46, 368, 496),
      look: new THREE.Vector3(68, 2, -16)
    }
  }
  // 默认黄金雕塑建筑摄影鸟瞰角（~36° 黄金纵深俯仰，兼具建筑高度感、玻璃反光与 14 社区完整入镜）
  const pose = {
    pos: new THREE.Vector3(isCockpit ? -12 : -24, isCockpit ? 416 : 410, isCockpit ? 556 : 378),
    look: new THREE.Vector3(isCockpit ? 12 : 8, 2, isCockpit ? -14 : 4)
  }
  if (isCockpit && zoneEntries.size && camera) {
    const w = canvasHost.value.clientWidth, h = canvasHost.value.clientHeight
    const narrow = window.innerWidth <= 1100, compactDesk = window.innerWidth <= 1520
    const sidePanels = !narrow && !props.theaterMode
    const left = sidePanels ? (compactDesk ? 316 : 338) : 8
    const right = sidePanels ? (compactDesk ? 338 : 364) : 8
    const top = sidePanels ? Math.min(h * 0.32, 218) : narrow ? 100 : 60
    const bottom = sidePanels ? 180 : narrow ? 98 : 78
    fitCommunityPanorama(pose.pos, pose.look, zoneEntries.values(), w, h, camera.fov, {
      left: left + 38, right: w - right - 38, top: top + 22, bottom: h - bottom - 12
    })
    if (controls) controls.maxDistance = Math.max(880, pose.pos.distanceTo(pose.look) + 40)
    lastPanorama = pose
  }
  return pose
}

function animateCameraTo(pos, look, glideKind = '', staffId = '') {
  if (introCamAnim || introWaveAnim) finishIntroVisualsImmediately()
  cameraFlightAnim = null
  staffGlide = null
  staffWheelZoom = null
  camTargetPos.copy(pos)
  camTargetLook.copy(look)
  if (prefersReducedMotion && camera && controls) {
    camera.position.copy(pos)
    controls.target.copy(look)
    controls.update()
    staticRenderNeeded = true
    isCamAnimating = false
    return
  }
  if (glideKind && camera && controls) {
    staffGlide = { kind: glideKind, staffId, advance: createStaffCameraGlide(camera.position, controls.target, performance.now()) }
    hoveredStaffId = ''
  }
  isCamAnimating = !staffGlide
}

function applyCameraPreset(preset) {
  cameraPreset.value = preset
  if (preset === 'hero' && props.mode === 'cockpit') {
    emit('reset-panorama')
  }
  const pose = getCameraPose(preset)
  animateCameraTo(pose.pos, pose.look, props.mode === 'cockpit' && preset === 'hero' ? 'overview' : '')
}

function selectTimePhase(phase) {
  timePhaseOverride.value = phase
}

function toggleDayNight() {
  timePhaseOverride.value = isNightScene.value ? 'noon' : 'night'
}

function toggleGroundStyle() {
  groundStyle.value = groundStyle.value === 'amap' ? 'sat' : 'amap'
}

async function toggleImageryComparison() {
  if (!camera) return
  if (!comparingImagery.value && assetsRef && !assetsRef.satTex) {
    try {
      const tex = await ensureAmapTexture('satTex')
      if (isDisposed || !camera) return
      if (tex) {
        tex.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4
        if (typeof renderer?.initTexture === 'function') renderer.initTexture(tex)
        if (imageryMat) {
          imageryMat.map = tex
          imageryMat.needsUpdate = true
        }
      }
    } catch {
      return
    }
  }
  comparingImagery.value = !comparingImagery.value
  camera.layers.set(comparingImagery.value ? IMAGERY_LAYER : 0)
  staticRenderNeeded = true
  if (comparingImagery.value) {
    clearHoveredBuilding()
    hoveredLocal.value = ''
    updateZoneStyles()
    setCanvasCursor('grab')
  }
}

function resetCameraView() {
  cameraPreset.value = 'hero'
  timePhaseOverride.value = null
  groundStyle.value = 'amap'
  autoOrbit.value = false
  if (comparingImagery.value) {
    comparingImagery.value = false
    if (camera) camera.layers.set(0)
    staticRenderNeeded = true
  }
  if (props.mode === 'cockpit') {
    emit('reset-panorama')
  } else if (props.selectedCommunity !== '全街道') {
    emit('select-community', props.selectedCommunity)
  }
  const pose = getCameraPose('hero')
  animateCameraTo(pose.pos, pose.look, props.mode === 'cockpit' ? 'overview' : '')
}

function focusOnCommunity(name) {
  const entry = zoneEntries.get(name)
  if (!entry) {
    const pose = getCameraPose(cameraPreset.value)
    animateCameraTo(pose.pos, pose.look)
    return
  }
  cameraPreset.value = ''
  const [cx, cz] = entry.centerXZ
  const dist = props.compact ? 128 : 148
  const height = props.compact ? 142 : 166
  animateCameraTo(
    new THREE.Vector3(cx - 24, height, cz + dist),
    new THREE.Vector3(cx, 2, cz - (props.mode === 'cockpit' ? 10 : 3)), props.mode === 'cockpit' ? 'community' : ''
  )
}

function focusOnPointXZ(cx, cz, dist = 104, height = 108) {
  cameraPreset.value = ''
  animateCameraTo(
    new THREE.Vector3(cx - 22, height, cz + dist),
    new THREE.Vector3(cx, 3, cz - 4)
  )
}

/** 创建高德官方 3D 旗舰建筑材质（深雕 Contact AO + 高度分层玻璃幕墙 Fresnel 反光 + 双 LOD 远近万家灯火 + 聚光压暗与单层亮带） */
function createAmapBuildingMaterial(isInner) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: isInner ? 0.42 : 0.68,
    metalness: isInner ? 0.22 : 0.10,
    transparent: !isInner,
    opacity: isInner ? 0.97 : 0.80
  })

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBottomCol = isInner ? bldgUniforms.uBottomCol : bldgUniforms.uOuterBottomCol
    shader.uniforms.uTopCol = isInner ? bldgUniforms.uTopCol : bldgUniforms.uOuterTopCol
    shader.uniforms.uRoofCol = isInner ? bldgUniforms.uRoofCol : bldgUniforms.uOuterRoofCol
    shader.uniforms.uLineCol = bldgUniforms.uLineCol
    shader.uniforms.uNight = bldgUniforms.uNight
    shader.uniforms.uWindowGlow = bldgUniforms.uWindowGlow
    shader.uniforms.uStreetDetail = bldgUniforms.uStreetDetail
    shader.uniforms.uTime = bldgUniforms.uTime
    shader.uniforms.uFocusActive = bldgUniforms.uFocusActive
    if (isInner) {
      shader.uniforms.uBldgColorTex = bldgUniforms.uBldgColorTex
      shader.uniforms.uUseSemantic = bldgUniforms.uUseSemantic
      shader.uniforms.uFocusBldgId = bldgUniforms.uFocusBldgId
      shader.uniforms.uFloorBandActive = bldgUniforms.uFloorBandActive
      shader.uniforms.uFloorBandY = bldgUniforms.uFloorBandY
      shader.uniforms.uFloorBandHalfH = bldgUniforms.uFloorBandHalfH
      shader.uniforms.uFloorBandCol = bldgUniforms.uFloorBandCol
    }
    shader.uniforms.uWaveOrigin = bldgUniforms.uWaveOrigin
    shader.uniforms.uWaveRadius = bldgUniforms.uWaveRadius
    shader.uniforms.uWaveActive = bldgUniforms.uWaveActive
    shader.uniforms.uWaveColor = bldgUniforms.uWaveColor

    shader.vertexShader = `
      attribute float aHeightRatio;
      ${isInner ? 'attribute float aBldgId;' : ''}
      uniform vec2 uWaveOrigin;
      uniform float uWaveRadius;
      uniform float uWaveActive;
      varying float vHR;
      ${isInner ? 'varying vec2 vSemUv;\n      varying float vBldgId;' : ''}
      varying vec3 vWorldPos;
      varying vec3 vWorldNorm;
      varying float vIsRoof;
      varying float vSunBias;
      varying float vWaveDist;
    ` + shader.vertexShader

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vHR = aHeightRatio;
       ${isInner ? 'vBldgId = aBldgId;\n       vSemUv = vec2((mod(aBldgId, 128.0) + 0.5) / 128.0, (floor(aBldgId / 128.0) + 0.5) / 64.0);' : ''}
       vWaveDist = 0.0;
       if (uWaveActive > 0.5) {
         float wDist = length(position.xz - uWaveOrigin);
         vWaveDist = wDist;
         float passed = 1.0 - smoothstep(uWaveRadius - 125.0, uWaveRadius + 28.0, wDist);
         float growth = mix(0.24, 1.0, passed);
         transformed.y *= growth;
       }
       vec3 wPosB = (modelMatrix * vec4(transformed, 1.0)).xyz;
       vWorldPos = wPosB;
       vec3 wNormB = normalize(mat3(modelMatrix) * objectNormal);
       vWorldNorm = wNormB;
       vIsRoof = step(0.65, wNormB.y);
       // 东西/南北立面明显受光与背阴区分，雕琢建筑体块立体感
       vSunBias = 0.89 + 0.14 * clamp(dot(wNormB, vec3(0.5534, 0.5534, 0.6238)), -1.0, 1.0);`
    )

    shader.fragmentShader = `
      uniform vec3 uBottomCol;
      uniform vec3 uTopCol;
      uniform vec3 uRoofCol;
      uniform vec3 uLineCol;
      uniform float uNight;
      uniform float uWindowGlow;
      uniform float uStreetDetail;
      uniform float uTime;
      uniform float uFocusActive;
      ${isInner ? 'uniform sampler2D uBldgColorTex;\n      uniform float uUseSemantic;\n      uniform float uFocusBldgId;\n      uniform float uFloorBandActive;\n      uniform float uFloorBandY;\n      uniform float uFloorBandHalfH;\n      uniform vec3 uFloorBandCol;' : ''}
      uniform float uWaveRadius;
      uniform float uWaveActive;
      uniform vec3 uWaveColor;
      varying float vHR;
      ${isInner ? 'varying vec2 vSemUv;\n      varying float vBldgId;' : ''}
      varying vec3 vWorldPos;
      varying vec3 vWorldNorm;
      varying float vIsRoof;
      varying float vSunBias;
      varying float vWaveDist;
      float bldgHash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
    ` + shader.fragmentShader

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       float hrClamped = clamp(vHR, 0.0, 1.0);
       // 垂直柔和渐变 + 高度分层建筑气质（高层商务透感，低层住宅温润）
       vec3 wallGrad = mix(uBottomCol, uTopCol, pow(hrClamped, 0.72));
       float floorSine = abs(sin(vWorldPos.y * 7.4));
       float floorBand = smoothstep(0.84, 0.96, floorSine);
       wallGrad = mix(wallGrad, uLineCol, floorBand * ${isInner ? '0.32' : '0.14'});
       // 深雕贴地接触柔影（Contact AO）：高空俯瞰亦见稳重阴影基座
       float aoStr = mix(1.0, 0.42, clamp(uNight, 0.0, 1.0));
       float groundAO = mix(1.0 - 0.34 * aoStr, 1.0, smoothstep(0.0, 0.34, hrClamped) * smoothstep(0.0, 2.0, vWorldPos.y));
       // 视角 Fresnel 玻璃幕墙天光反光（高层立面掠射光泽，破除均质塑料感）
       vec3 viewDirB = normalize(cameraPosition - vWorldPos);
       float fres = pow(1.0 - clamp(abs(dot(normalize(vWorldNorm), viewDirB)), 0.0, 1.0), 2.5);
       float tallMask = smoothstep(3.0, 7.2, vWorldPos.y);
       vec3 glassReflect = mix(vec3(0.88, 0.94, 1.0), uRoofCol, 0.45);
       vec3 wallLit = wallGrad * vSunBias * groundAO;
       wallLit = mix(wallLit, glassReflect, fres * (0.14 + 0.30 * tallMask) * (1.0 - clamp(uNight, 0.0, 1.0)));
       float eaveRim = smoothstep(0.91, 1.0, hrClamped) * (1.0 - vIsRoof);
       wallLit += mix(vec3(0.06, 0.055, 0.045), uLineCol * 0.16, clamp(uNight, 0.0, 1.0)) * eaveRim;
       vec3 baseCol = mix(wallLit, uRoofCol, vIsRoof);
       ${isInner ? `
       vec4 semSample = vec4(0.0);
       if (uUseSemantic > 0.5) {
         semSample = texture2D(uBldgColorTex, vSemUv);
         if (semSample.a > 0.01) {
           vec3 semWall = mix(semSample.rgb * 0.78, semSample.rgb * 1.12, pow(hrClamped, 0.75));
           semWall = mix(semWall, uLineCol, floorBand * 0.22) * vSunBias * mix(0.82, 1.0, groundAO);
           vec3 semRoof = mix(semSample.rgb, vec3(1.0), 0.24);
           baseCol = mix(baseCol, mix(semWall, semRoof, vIsRoof), semSample.a);
         }
       }` : ''}
       // 电影级楼栋聚光压暗：选中单栋楼时柔和压暗周边，突出聚焦主角
       if (uFocusActive > 0.001) {
         ${isInner ? `
         bool isFocusTarget = abs(vBldgId - uFocusBldgId) < 0.5;
         bool isEmgHighlight = (uUseSemantic > 0.5 && semSample.a > 0.72);
         if (isFocusTarget) {
           baseCol *= mix(1.0, 1.14, uFocusActive);
         } else if (!isEmgHighlight) {
           float dimF = mix(1.0, mix(0.64, 0.38, clamp(uNight, 0.0, 1.0)), uFocusActive);
           float lum = dot(baseCol, vec3(0.299, 0.587, 0.114));
           baseCol = mix(vec3(lum), baseCol, 1.0 - 0.35 * uFocusActive) * dimF;
         }
         if (isFocusTarget && uFloorBandActive > 0.01 && vIsRoof < 0.5) {
           float bandDist = (vWorldPos.y - uFloorBandY) / max(0.18, uFloorBandHalfH);
           float bandGlow = exp(-(bandDist * bandDist)) * uFloorBandActive;
           baseCol = mix(baseCol, uFloorBandCol, clamp(bandGlow * 0.88, 0.0, 0.92));
         }` : `
         float dimOut = mix(1.0, mix(0.60, 0.34, clamp(uNight, 0.0, 1.0)), uFocusActive);
         baseCol *= dimOut;`}
       }
       if (uWaveActive > 0.5) {
         float wDelta = (vWaveDist - uWaveRadius) / 30.0;
         float wRing = exp(-(wDelta * wDelta));
         baseCol = mix(baseCol, uWaveColor, wRing * ${isInner ? '0.28' : '0.14'});
       }
       float horizCoord = abs(vWorldNorm.x) > abs(vWorldNorm.z) ? vWorldPos.z : vWorldPos.x;
       vec2 winUv = vec2(horizCoord * 2.4, vWorldPos.y * 2.25);
       // 沿用夜景的窗格尺度，在街面日光下显出窗洞与玻璃的层次。
       if (uStreetDetail > 0.001 && uNight < 0.98 && vIsRoof < 0.5 && vWorldPos.y > 0.12) {
         vec2 edge = max(fwidth(winUv), vec2(0.018));
         float resolved = 1.0 - smoothstep(0.22, 0.65, max(edge.x, edge.y));
         vec2 pane = fract(winUv);
         vec2 inside = smoothstep(vec2(0.18, 0.23) - edge, vec2(0.18, 0.23) + edge, pane)
           * (1.0 - smoothstep(vec2(0.80, 0.78) - edge, vec2(0.80, 0.78) + edge, pane));
         float sky = smoothstep(0.22, 0.78, pane.y);
         float shade = bldgHash21(floor(winUv));
         vec3 glass = mix(baseCol * vec3(0.38, 0.50, 0.60), baseCol * vec3(0.72, 0.86, 0.94), sky);
         glass *= 0.92 + 0.16 * shade;
         float frame = 1.0 - smoothstep(0.012, 0.020 + edge.x, abs(pane.x - 0.51));
         float sill = 1.0 - smoothstep(0.020, 0.032 + edge.y, abs(pane.y - 0.25));
         glass = mix(glass, baseCol * 0.91, max(frame * 0.76, sill) * (1.0 - smoothstep(0.03, 0.12, max(edge.x, edge.y))));
         baseCol = mix(baseCol, glass, inside.x * inside.y * resolved * uStreetDetail * (1.0 - uNight) * 0.90);
       }
       diffuseColor.rgb = baseCol;`
    )

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
       if (uWaveActive > 0.5) {
         float wDeltaE = (vWaveDist - uWaveRadius) / 28.0;
         float wRingE = exp(-(wDeltaE * wDeltaE));
         float wBoost = ${isInner ? '0.46' : '0.20'} * (0.35 + 0.65 * pow(hrClamped, 1.3));
         totalEmissiveRadiance += uWaveColor * wRingE * wBoost;
       }
       ${isInner ? `
       if (uFocusActive > 0.001 && uFloorBandActive > 0.01 && abs(vBldgId - uFocusBldgId) < 0.5 && vIsRoof < 0.5) {
         float bDistE = (vWorldPos.y - uFloorBandY) / max(0.18, uFloorBandHalfH);
         float bGlowE = exp(-(bDistE * bDistE)) * uFloorBandActive;
         totalEmissiveRadiance += uFloorBandCol * (bGlowE * 1.05);
       }` : ''}
       float nightAmt = clamp(uNight, 0.0, 1.0);
       if (uFocusActive > 0.001) {
         ${isInner ? `
         bool isFocusTargetE = abs(vBldgId - uFocusBldgId) < 0.5;
         bool isEmgHighlightE = (uUseSemantic > 0.5 && semSample.a > 0.72);
         if (!isFocusTargetE && !isEmgHighlightE) {
           nightAmt *= mix(1.0, 0.34, uFocusActive);
         }` : `
         nightAmt *= mix(1.0, 0.30, uFocusActive);`}
       }
       if (nightAmt > 0.01) {
         float topGlow = pow(hrClamped, 1.55);
         float floorGlow = smoothstep(0.84, 0.98, floorSine);
         vec3 viewDirE = normalize(cameraPosition - vWorldPos);
         float fresE = pow(1.0 - clamp(abs(dot(normalize(vWorldNorm), viewDirE)), 0.0, 1.0), 2.8);
         float tallE = smoothstep(3.2, 7.5, vWorldPos.y);
         // 夜间晶格 + 高层天际线玻璃掠射微辉光
         vec3 sideEmit = uTopCol * (0.12 + topGlow * ${isInner ? '0.36' : '0.14'}) + uLineCol * (floorGlow * ${isInner ? '0.26' : '0.07'} + fresE * tallE * ${isInner ? '0.32' : '0.10'});
         vec3 roofEmit = uRoofCol * ${isInner ? '0.30' : '0.10'};
         totalEmissiveRadiance += mix(sideEmit, roofEmit, vIsRoof) * nightAmt;
         ${isInner ? `
         if (uUseSemantic > 0.5 && semSample.a > 0.35) {
           totalEmissiveRadiance += semSample.rgb * (semSample.a * (0.16 + topGlow * 0.16)) * nightAmt;
         }` : ''}
       }
       // 暮色与暗夜：远近双 LOD 万家灯火（高空全景呈温润楼层灯带与顶冠，近景呈独立错落窗格）
       if (uWindowGlow > 0.01 && vIsRoof < 0.5 && vWorldPos.y > 0.32) {
         float uvRate = max(fwidth(winUv.x), fwidth(winUv.y));
         float aaWin = 1.0 - smoothstep(0.55, 1.45, uvRate);
         float seedSalt = ${isInner ? 'mod(vBldgId, 97.0) * 0.17' : '0.43'};
         float tallBoost = smoothstep(2.6, 6.8, vWorldPos.y);
         // 远景全景宏观灯带（高空俯瞰一眼可见建筑群万家灯火层次，无摩尔纹）
         float macroRow = floor(vWorldPos.y * 1.65);
         float macroCol = floor(horizCoord * 0.55);
         float hMacro = bldgHash21(vec2(macroCol + seedSalt * 3.1, macroRow + seedSalt * 1.7));
         float macroBand = smoothstep(0.28, 0.52, abs(sin(vWorldPos.y * 5.2)));
         float farLit = step(${isInner ? 'mix(0.54, 0.38, tallBoost)' : '0.74'}, hMacro) * macroBand * (1.0 - aaWin * 0.85);
         // 近景独立窗格（全景高空 aaWin <= 0.01 时跳过双哈希与窗框运算）
         float nearLit = 0.0;
         float h2 = hMacro;
         if (aaWin > 0.01) {
           vec2 winCell = floor(winUv);
           vec2 winFrac = fract(winUv);
           float maskX = smoothstep(0.16, 0.30, winFrac.x) * (1.0 - smoothstep(0.70, 0.84, winFrac.x));
           float maskY = smoothstep(0.22, 0.36, winFrac.y) * (1.0 - smoothstep(0.68, 0.82, winFrac.y));
           float h1 = bldgHash21(winCell + vec2(seedSalt, seedSalt * 0.7));
           h2 = bldgHash21(winCell * 1.37 + vec2(7.1, 3.3));
           float threshNear = ${isInner ? 'mix(0.58, 0.42, tallBoost)' : '0.72'};
           nearLit = step(threshNear, h1) * maskX * maskY * aaWin;
         }
         float combinedLit = clamp(nearLit + farLit * 0.88, 0.0, 1.0);
         if (combinedLit > 0.001) {
           float pulse = 0.92 + 0.08 * sin(uTime * 0.65 + seedSalt * 4.0 + h2 * 6.28);
           vec3 warmWin = mix(vec3(1.0, 0.84, 0.52), vec3(0.95, 0.94, 0.88), step(0.64, h2));
           vec3 winTone = mix(warmWin, uLineCol, 0.16);
           float winStr = ${isInner ? 'mix(0.46, 0.72, tallBoost)' : '0.28'} * uWindowGlow * pulse * (1.0 - 0.55 * uFocusActive);
           totalEmissiveRadiance += winTone * (combinedLit * winStr);
         }
       }`
    )
  }
  mat.customProgramCacheKey = () => `amap-3d-bldg-v3-${isInner ? 'in' : 'out'}`
  return mat
}

/** 6 套系统主题预设 × 日景/暗夜双态专属 3D 建模配色体系（每套配色均有独立建筑材质色阶与氛围光） */
const PRESET_3D_THEMES = {
  'vermilion-seal': {
    day: {
      bg: '#ece6dc', far: '#eae3d8',
      sunCol: '#fff6e8', sunInt: 2.15, fillCol: '#f5dec2', fillInt: 0.52, hemiSky: '#fffdf8', hemiGnd: '#cfc5b8',
      bottom: '#ddd2c4', top: '#faf6ee', roof: '#fffdf9', line: '#c7b398',
      outerBottom: '#e5ddd2', outerTop: '#f3eee6', outerRoof: '#f8f5ef',
      edgeIn: '#b89f82', edgeInOp: 0.56, edgeOut: '#cfc3b4', edgeOutOp: 0.28,
      outerLine: '#b81c28', outerGlow: '#d9a452', hqBeam: '#c81e2b', hqRing: '#d4a348'
    },
    night: {
      bg: '#100e16', far: '#0f0d14',
      sunCol: '#e8d4b8', sunInt: 1.12, fillCol: '#f2c879', fillInt: 0.72, hemiSky: '#7d695e', hemiGnd: '#16111a',
      bottom: '#1e1926', top: '#7a6354', roof: '#d4b17a', line: '#f3cc82',
      outerBottom: '#15121c', outerTop: '#2e2636', outerRoof: '#3b3042',
      edgeIn: '#f0c878', edgeInOp: 0.46, edgeOut: '#544659', edgeOutOp: 0.18,
      outerLine: '#e03e44', outerGlow: '#f2c879', hqBeam: '#e03e44', hqRing: '#f5cc7d'
    }
  },
  'cloud-portal': {
    day: {
      bg: '#e1ecf8', far: '#e3ebf5',
      sunCol: '#ffffff', sunInt: 2.18, fillCol: '#b6d8ff', fillInt: 0.62, hemiSky: '#f7fbff', hemiGnd: '#bfd0e6',
      bottom: '#c5daf4', top: '#edf5ff', roof: '#ffffff', line: '#86b4ed',
      outerBottom: '#d6e3f2', outerTop: '#eef4fb', outerRoof: '#f6f9fd',
      edgeIn: '#6ea4e8', edgeInOp: 0.56, edgeOut: '#adc4de', edgeOutOp: 0.28,
      outerLine: '#1464e6', outerGlow: '#3b9ef8', hqBeam: '#1464e6', hqRing: '#3b9ef8'
    },
    night: {
      bg: '#091529', far: '#081326',
      sunCol: '#b4d8ff', sunInt: 1.18, fillCol: '#3b9ef8', fillInt: 0.78, hemiSky: '#4e84c8', hemiGnd: '#0b1830',
      bottom: '#0e2245', top: '#2b7de8', roof: '#70c8ff', line: '#7ed8ff',
      outerBottom: '#0b1830', outerTop: '#1c3866', outerRoof: '#254a82',
      edgeIn: '#66cfff', edgeInOp: 0.48, edgeOut: '#2d5285', edgeOutOp: 0.20,
      outerLine: '#3b9ef8', outerGlow: '#6fd6ff', hqBeam: '#2575fc', hqRing: '#68d2ff'
    }
  },
  'pearl-glass': {
    day: {
      bg: '#e3eff2', far: '#e6eff0',
      sunCol: '#fffdf9', sunInt: 2.15, fillCol: '#bce8de', fillInt: 0.58, hemiSky: '#f9feff', hemiGnd: '#c4d6dc',
      bottom: '#cbe0e8', top: '#f2fafc', roof: '#ffffff', line: '#8ec2cf',
      outerBottom: '#d9e7ec', outerTop: '#eff6f8', outerRoof: '#f7fbfc',
      edgeIn: '#76b5c5', edgeInOp: 0.54, edgeOut: '#b2ccd4', edgeOutOp: 0.28,
      outerLine: '#236de9', outerGlow: '#6cd957', hqBeam: '#236de9', hqRing: '#7ce038'
    },
    night: {
      bg: '#0a1624', far: '#091421',
      sunCol: '#bce8ff', sunInt: 1.15, fillCol: '#6ee7b7', fillInt: 0.72, hemiSky: '#4d8ca8', hemiGnd: '#0c1a29',
      bottom: '#102238', top: '#2d82a8', roof: '#7be8cf', line: '#82e6a8',
      outerBottom: '#0d1b2c', outerTop: '#1d3c56', outerRoof: '#264e6c',
      edgeIn: '#7be8cf', edgeInOp: 0.46, edgeOut: '#2e5773', edgeOutOp: 0.18,
      outerLine: '#38bdf8', outerGlow: '#82dd2d', hqBeam: '#236de9', hqRing: '#82dd2d'
    }
  },
  'civic-trust': {
    day: {
      bg: '#e5ebf2', far: '#e6ebf0',
      sunCol: '#fffbf2', sunInt: 2.15, fillCol: '#c6daf2', fillInt: 0.55, hemiSky: '#ffffff', hemiGnd: '#c4cdd9',
      bottom: '#ccd7e6', top: '#f2f6fb', roof: '#ffffff', line: '#98aec9',
      outerBottom: '#dae2ec', outerTop: '#eef2f7', outerRoof: '#f6f8fb',
      edgeIn: '#87a2c4', edgeInOp: 0.55, edgeOut: '#b5c3d4', edgeOutOp: 0.28,
      outerLine: '#1a56b8', outerGlow: '#2b9e5b', hqBeam: '#1a56b8', hqRing: '#2b9e5b'
    },
    night: {
      bg: '#0c1626', far: '#0b1423',
      sunCol: '#bdd6f2', sunInt: 1.15, fillCol: '#5ca4f2', fillInt: 0.70, hemiSky: '#567db0', hemiGnd: '#0e192b',
      bottom: '#132440', top: '#3c6ea8', roof: '#8cbce8', line: '#98ccf5',
      outerBottom: '#0f1c30', outerTop: '#213a5e', outerRoof: '#2b4b75',
      edgeIn: '#8ec4f5', edgeInOp: 0.44, edgeOut: '#355680', edgeOutOp: 0.18,
      outerLine: '#3b82f6', outerGlow: '#34d399', hqBeam: '#2563eb', hqRing: '#60a5fa'
    }
  },
  'jade-emerald': {
    day: {
      bg: '#e1eee9', far: '#e2ede8',
      sunCol: '#fffcf4', sunInt: 2.14, fillCol: '#b6e6d6', fillInt: 0.56, hemiSky: '#f8fffc', hemiGnd: '#bed4cc',
      bottom: '#c3ddd4', top: '#edf7f3', roof: '#fafffd', line: '#7db8a8',
      outerBottom: '#d4e6df', outerTop: '#ecf5f1', outerRoof: '#f4faf7',
      edgeIn: '#66a897', edgeInOp: 0.55, edgeOut: '#a7c7bd', edgeOutOp: 0.28,
      outerLine: '#0f766e', outerGlow: '#f59e0b', hqBeam: '#0f766e', hqRing: '#f59e0b'
    },
    night: {
      bg: '#081718', far: '#071516',
      sunCol: '#a7f3d0', sunInt: 1.14, fillCol: '#34d399', fillInt: 0.76, hemiSky: '#3b8c80', hemiGnd: '#091d1d',
      bottom: '#0c2627', top: '#1e8078', roof: '#62ebd0', line: '#6ee7b7',
      outerBottom: '#0a1d1f', outerTop: '#174242', outerRoof: '#205756',
      edgeIn: '#5eead4', edgeInOp: 0.48, edgeOut: '#265c59', edgeOutOp: 0.20,
      outerLine: '#10b981', outerGlow: '#fbbf24', hqBeam: '#10b981', hqRing: '#fbbf24'
    }
  },
  'command-dark': {
    day: {
      bg: '#dfe9f5', far: '#e1ebf5',
      sunCol: '#ffffff', sunInt: 2.18, fillCol: '#a8e2ff', fillInt: 0.62, hemiSky: '#f5fbff', hemiGnd: '#bccfe0',
      bottom: '#c2d9ee', top: '#ebf5fc', roof: '#ffffff', line: '#7ab8de',
      outerBottom: '#d4e2ef', outerTop: '#ecf3f9', outerRoof: '#f5f9fc',
      edgeIn: '#5ba8d6', edgeInOp: 0.56, edgeOut: '#a6c2d9', edgeOutOp: 0.28,
      outerLine: '#0ea5e9', outerGlow: '#4fd3f2', hqBeam: '#0ea5e9', hqRing: '#4fd3f2'
    },
    night: {
      bg: '#070f1e', far: '#060d1a',
      sunCol: '#a5e4ff', sunInt: 1.22, fillCol: '#4fd3f2', fillInt: 0.84, hemiSky: '#4688c2', hemiGnd: '#091529',
      bottom: '#0c1c38', top: '#2580c7', roof: '#6ce4ff', line: '#56daf7',
      outerBottom: '#0a152b', outerTop: '#1b3660', outerRoof: '#24477a',
      edgeIn: '#5ae0ff', edgeInOp: 0.50, edgeOut: '#2b5285', edgeOutOp: 0.20,
      outerLine: '#4fd3f2', outerGlow: '#38bdf8', hqBeam: '#0ea5e9', hqRing: '#4fd3f2'
    }
  }
}

function mixHex(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t).getStyle()
}

/** 计算给定主题预设 + 四时辰（晨/昼/暮/夜）的目标大气与光影参数快照 */
function computeTargetAtmosphere(presetKey, phase) {
  const p = PRESET_3D_THEMES[presetKey] || PRESET_3D_THEMES['vermilion-seal']
  const day = p.day
  const night = p.night

  if (phase === 'night') {
    return {
      presetKey,
      phase,
      themeRef: night,
      nightFactor: 1.0,
      windowGlow: 1.0,
      bg: new THREE.Color(night.bg),
      far: new THREE.Color(night.far),
      fogDensity: 0.00056,
      sunPos: new THREE.Vector3(200, 380, 220),
      sunCol: new THREE.Color(night.sunCol),
      sunInt: night.sunInt,
      fillCol: new THREE.Color(night.fillCol),
      fillInt: night.fillInt,
      hemiSky: new THREE.Color(night.hemiSky),
      hemiGnd: new THREE.Color(night.hemiGnd),
      hemiInt: 0.85,
      bottom: new THREE.Color(night.bottom),
      top: new THREE.Color(night.top),
      roof: new THREE.Color(night.roof),
      line: new THREE.Color(night.line),
      outerBottom: new THREE.Color(night.outerBottom),
      outerTop: new THREE.Color(night.outerTop),
      outerRoof: new THREE.Color(night.outerRoof),
      edgeIn: new THREE.Color(night.edgeIn),
      edgeInOp: night.edgeInOp,
      edgeOut: new THREE.Color(night.edgeOut),
      edgeOutOp: night.edgeOutOp,
      outerLine: new THREE.Color(night.outerLine),
      outerGlow: new THREE.Color(night.outerGlow),
      hqBeam: new THREE.Color(night.hqBeam),
      hqRing: new THREE.Color(night.hqRing),
      waveCol: new THREE.Color(night.hqRing || night.outerGlow || '#e8c484'),
      groundTint: new THREE.Color('#ffffff'),
      waterShallow: new THREE.Color('#346678'),
      waterDeep: new THREE.Color('#1e435a'),
      riverShallow: new THREE.Color('#344f58'),
      riverDeep: new THREE.Color('#1c3846'),
      waterTint: new THREE.Color('#71839a'),
      bankColor: new THREE.Color(night.outerTop)
    }
  }

  if (phase === 'dawn') {
    return {
      presetKey,
      phase,
      themeRef: day,
      nightFactor: 0.08,
      windowGlow: 0.16,
      bg: new THREE.Color(mixHex(day.bg, '#efe1d4', 0.34)),
      far: new THREE.Color(mixHex(day.far, '#ece0d4', 0.34)),
      fogDensity: 0.00050,
      sunPos: new THREE.Vector3(410, 205, 130),
      sunCol: new THREE.Color('#ffe2c2'),
      sunInt: 1.96,
      fillCol: new THREE.Color('#c8dcf5'),
      fillInt: 0.62,
      hemiSky: new THREE.Color('#fff5ea'),
      hemiGnd: new THREE.Color(mixHex(day.hemiGnd, '#c8b8a8', 0.35)),
      hemiInt: 0.90,
      bottom: new THREE.Color(mixHex(day.bottom, '#dfd0c4', 0.28)),
      top: new THREE.Color(mixHex(day.top, '#fdf2e6', 0.30)),
      roof: new THREE.Color(mixHex(day.roof, '#fff8f0', 0.35)),
      line: new THREE.Color(mixHex(day.line, '#cfa987', 0.36)),
      outerBottom: new THREE.Color(mixHex(day.outerBottom, '#dfd4c9', 0.26)),
      outerTop: new THREE.Color(mixHex(day.outerTop, '#f5ece3', 0.26)),
      outerRoof: new THREE.Color(mixHex(day.outerRoof, '#faf4ed', 0.26)),
      edgeIn: new THREE.Color(mixHex(day.edgeIn, '#c7a483', 0.30)),
      edgeInOp: day.edgeInOp * 0.95,
      edgeOut: new THREE.Color(day.edgeOut),
      edgeOutOp: day.edgeOutOp,
      outerLine: new THREE.Color(day.outerLine),
      outerGlow: new THREE.Color(day.outerGlow),
      hqBeam: new THREE.Color(day.hqBeam),
      hqRing: new THREE.Color(day.hqRing),
      waveCol: new THREE.Color(day.hqRing || day.outerGlow || '#e8c484'),
      groundTint: new THREE.Color('#fbf4ec'),
      waterShallow: new THREE.Color('#8ec3b9'),
      waterDeep: new THREE.Color('#3b818f'),
      riverShallow: new THREE.Color('#83948a'),
      riverDeep: new THREE.Color('#4a666b'),
      waterTint: new THREE.Color('#fff4e8'),
      bankColor: new THREE.Color('#cbc2b1')
    }
  }

  if (phase === 'dusk') {
    return {
      presetKey,
      phase,
      themeRef: day,
      nightFactor: 0.28,
      windowGlow: 0.56,
      bg: new THREE.Color(mixHex(day.bg, '#2b2434', 0.42)),
      far: new THREE.Color(mixHex(day.far, '#2a2333', 0.42)),
      fogDensity: 0.00053,
      sunPos: new THREE.Vector3(-375, 160, 285),
      sunCol: new THREE.Color('#ffb266'),
      sunInt: 2.32,
      fillCol: new THREE.Color('#7a8db8'),
      fillInt: 0.66,
      hemiSky: new THREE.Color('#f0c8a4'),
      hemiGnd: new THREE.Color('#5a4e5c'),
      hemiInt: 0.84,
      bottom: new THREE.Color(mixHex(day.bottom, '#4a3d4c', 0.46)),
      top: new THREE.Color(mixHex(day.top, '#e8bc8f', 0.42)),
      roof: new THREE.Color(mixHex(day.roof, '#fae0be', 0.42)),
      line: new THREE.Color(mixHex(day.line, '#f0be7a', 0.58)),
      outerBottom: new THREE.Color(mixHex(day.outerBottom, '#3b3242', 0.48)),
      outerTop: new THREE.Color(mixHex(day.outerTop, '#967b72', 0.42)),
      outerRoof: new THREE.Color(mixHex(day.outerRoof, '#b89888', 0.42)),
      edgeIn: new THREE.Color('#eab875'),
      edgeInOp: 0.52,
      edgeOut: new THREE.Color('#7a6870'),
      edgeOutOp: 0.24,
      outerLine: new THREE.Color(mixHex(day.outerLine, night.outerLine, 0.45)),
      outerGlow: new THREE.Color('#f4c474'),
      hqBeam: new THREE.Color(mixHex(day.hqBeam, night.hqBeam, 0.45)),
      hqRing: new THREE.Color('#f4c474'),
      waveCol: new THREE.Color('#f4c474'),
      groundTint: new THREE.Color('#ebd5c0'),
      waterShallow: new THREE.Color('#b68b72'),
      waterDeep: new THREE.Color('#4a5c6e'),
      riverShallow: new THREE.Color('#8e7a6f'),
      riverDeep: new THREE.Color('#3c4d5b'),
      waterTint: new THREE.Color('#e8c7ab'),
      bankColor: new THREE.Color('#9e8878')
    }
  }

  return {
    presetKey,
    phase: 'noon',
    themeRef: day,
    nightFactor: 0.0,
    windowGlow: 0.0,
    bg: new THREE.Color(day.bg),
    far: new THREE.Color(day.far),
    fogDensity: 0.00046,
    sunPos: new THREE.Vector3(280, 460, 260),
    sunCol: new THREE.Color(day.sunCol),
    sunInt: day.sunInt,
    fillCol: new THREE.Color(day.fillCol),
    fillInt: day.fillInt,
    hemiSky: new THREE.Color(day.hemiSky),
    hemiGnd: new THREE.Color(day.hemiGnd),
    hemiInt: 0.92,
    bottom: new THREE.Color(day.bottom),
    top: new THREE.Color(day.top),
    roof: new THREE.Color(day.roof),
    line: new THREE.Color(day.line),
    outerBottom: new THREE.Color(day.outerBottom),
    outerTop: new THREE.Color(day.outerTop),
    outerRoof: new THREE.Color(day.outerRoof),
    edgeIn: new THREE.Color(day.edgeIn),
    edgeInOp: day.edgeInOp,
    edgeOut: new THREE.Color(day.edgeOut),
    edgeOutOp: day.edgeOutOp,
    outerLine: new THREE.Color(day.outerLine),
    outerGlow: new THREE.Color(day.outerGlow),
    hqBeam: new THREE.Color(day.hqBeam),
    hqRing: new THREE.Color(day.hqRing),
    waveCol: new THREE.Color(day.hqRing || day.outerGlow || '#e8c484'),
    groundTint: new THREE.Color('#ffffff'),
    waterShallow: new THREE.Color('#82bfb6'),
    waterDeep: new THREE.Color('#347f8d'),
    riverShallow: new THREE.Color('#748981'),
    riverDeep: new THREE.Color('#425f63'),
    waterTint: new THREE.Color('#ffffff'),
    bankColor: new THREE.Color('#c7c6af')
  }
}

function createSkyDome() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSkyTop: { value: new THREE.Color('#dfe8f2') },
      uSkyHorizon: { value: new THREE.Color('#ece6dc') },
      uStreetDetail: bldgUniforms.uStreetDetail,
      uNight: bldgUniforms.uNight,
      uSunDir: { value: new THREE.Vector3(280, 460, 260).normalize() },
      uSunHaloCol: { value: new THREE.Color('#fff5e0') },
      uSunHaloStr: { value: 0.22 }
    },
    vertexShader: `
      varying vec3 vWorldDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uSkyTop;
      uniform vec3 uSkyHorizon;
      uniform float uStreetDetail;
      uniform float uNight;
      uniform vec3 uSunDir;
      uniform vec3 uSunHaloCol;
      uniform float uSunHaloStr;
      varying vec3 vWorldDir;
      void main() {
        vec3 d = normalize(vWorldDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 sky = mix(uSkyHorizon, uSkyTop, pow(h, 0.52));
        float streetDay = uStreetDetail * (1.0 - uNight) * smoothstep(0.20, 0.58, uSunDir.y);
        vec3 daylight = mix(vec3(0.87, 0.89, 0.88), vec3(0.47, 0.66, 0.81), smoothstep(0.00, 0.64, h));
        sky = mix(sky, daylight, streetDay * 0.85);
        float sunDot = max(0.0, dot(d, normalize(uSunDir)));
        float halo = pow(sunDot, 10.0) * 0.45 + pow(sunDot, 42.0) * 0.55;
        sky += uSunHaloCol * (halo * uSunHaloStr);
        gl_FragColor = vec4(sky, 1.0);
      }
    `
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(2250, 32, 16), mat)
  return { mesh, mat }
}

function buildBoundaryCurtainGeometry(curve, segments = 280, height = 10.5) {
  const pts = curve.getSpacedPoints(segments)
  const pos = []
  const uvs = []
  const idx = []
  for (let i = 0; i <= segments; i++) {
    const p = pts[i % pts.length]
    const u = i / segments
    pos.push(p.x, 0.14, p.z, p.x, 0.14 + height, p.z)
    uvs.push(u, 0, u, 1)
    if (i < segments) {
      const b = i * 2
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  return geo
}

function createBoundaryCurtainMaterial(lineHex, glowHex) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(lineHex) },
      uGlowColor: { value: new THREE.Color(glowHex) },
      uTime: { value: 0 },
      uNight: { value: 0 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform vec3 uGlowColor;
      uniform float uTime;
      uniform float uNight;
      varying vec2 vUv;
      void main() {
        // 底部清晰锐利地界丝线 + 向上柔和羽化光幕
        float baseLine = smoothstep(0.11, 0.0, vUv.y);
        float curtain = pow(1.0 - vUv.y, 2.75) * mix(0.32, 0.56, clamp(uNight, 0.0, 1.0));
        // 3 道温润金脉沿全街道疆域缓速巡游
        float p1 = fract(vUv.x * 3.0 - uTime * 0.045);
        float pulse = smoothstep(0.18, 0.0, p1) * (0.45 + 0.55 * smoothstep(0.35, 0.0, vUv.y));
        vec3 col = mix(uColor, uGlowColor, clamp(pulse * 0.85 + vUv.y * 0.35, 0.0, 1.0));
        float alpha = clamp(baseLine * 0.92 + curtain + pulse * 0.48, 0.0, 0.95);
        gl_FragColor = vec4(col, alpha);
      }
    `
  })
}

function createCompassDiscMaterial(ringHex, beamHex) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uRingCol: { value: new THREE.Color(ringHex) },
      uBeamCol: { value: new THREE.Color(beamHex) },
      uTime: { value: 0 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uRingCol;
      uniform vec3 uBeamCol;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        if (r > 1.0) discard;
        float ang = atan(p.y, p.x);
        // 旋转外刻度环
        float rotA = ang + uTime * 0.16;
        float ticks = step(0.45, cos(rotA * 36.0)) * smoothstep(0.025, 0.0, abs(r - 0.86));
        float outerArc = smoothstep(0.018, 0.0, abs(r - 0.94)) * (0.45 + 0.55 * smoothstep(-0.2, 0.8, sin(rotA * 3.0)));
        // 反向旋转内虚线环
        float rotB = ang - uTime * 0.24;
        float innerDash = step(0.15, cos(rotB * 12.0)) * smoothstep(0.018, 0.0, abs(r - 0.58));
        float coreGlow = exp(-r * r * 5.2) * 0.42;
        float ringGlow = (ticks * 0.85 + outerArc * 0.9 + innerDash * 0.72);
        vec3 col = mix(uBeamCol, uRingCol, clamp(ringGlow, 0.0, 1.0));
        float alpha = clamp(coreGlow + ringGlow * 0.9, 0.0, 0.95);
        gl_FragColor = vec4(col, alpha);
      }
    `
  })
}

function createVolumetricBeamMaterial(colHex, baseAlpha = 0.65) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(colHex) },
      uTime: { value: 0 },
      uAlpha: { value: baseAlpha }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        vUv = uv;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uAlpha;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      void main() {
        float vertFade = pow(1.0 - vUv.y, 1.45) * smoothstep(0.0, 0.09, vUv.y);
        float centerSoft = 0.45 + 0.55 * abs(dot(normalize(vNormalV), normalize(vViewDir)));
        float scan = 0.86 + 0.14 * sin(vUv.y * 18.0 - uTime * 3.4);
        float a = vertFade * centerSoft * scan * uAlpha;
        vec3 c = mix(uColor, vec3(1.0), 0.22 * (1.0 - vUv.y));
        gl_FragColor = vec4(c, a);
      }
    `
  })
  dynamicTimeMats.push(mat)
  return mat
}

function createFlowArcMaterial(colHex, glowHex, baseOpacity = 0.34, speed = 0.28, offset = 0) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color(colHex) },
      uGlowColor: { value: new THREE.Color(glowHex) },
      uTime: { value: 0 },
      uBaseOp: { value: baseOpacity },
      uSpeed: { value: speed },
      uOffset: { value: offset }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform vec3 uGlowColor;
      uniform float uTime;
      uniform float uBaseOp;
      uniform float uSpeed;
      uniform float uOffset;
      varying vec2 vUv;
      void main() {
        float head = fract(uTime * uSpeed + uOffset);
        float d = fract(head - vUv.x);
        float comet = smoothstep(0.24, 0.0, d) * step(0.0, d);
        float head2 = fract(head + 0.5);
        float d2 = fract(head2 - vUv.x);
        float comet2 = smoothstep(0.18, 0.0, d2) * 0.65;
        float trail = max(comet, comet2);
        vec3 col = mix(uColor, uGlowColor, clamp(trail * 1.15, 0.0, 1.0));
        float alpha = clamp(uBaseOp + trail * 0.82, 0.0, 0.98);
        gl_FragColor = vec4(col, alpha);
      }
    `
  })
  dynamicTimeMats.push(mat)
  return mat
}

function cloneAtmosphere(a) {
  return {
    ...a,
    bg: a.bg.clone(),
    far: a.far.clone(),
    sunPos: a.sunPos.clone(),
    sunCol: a.sunCol.clone(),
    fillCol: a.fillCol.clone(),
    hemiSky: a.hemiSky.clone(),
    hemiGnd: a.hemiGnd.clone(),
    bottom: a.bottom.clone(),
    top: a.top.clone(),
    roof: a.roof.clone(),
    line: a.line.clone(),
    outerBottom: a.outerBottom.clone(),
    outerTop: a.outerTop.clone(),
    outerRoof: a.outerRoof.clone(),
    edgeIn: a.edgeIn.clone(),
    edgeOut: a.edgeOut.clone(),
    outerLine: a.outerLine.clone(),
    outerGlow: a.outerGlow.clone(),
    hqBeam: a.hqBeam.clone(),
    hqRing: a.hqRing.clone(),
    waveCol: a.waveCol.clone(),
    groundTint: a.groundTint.clone(),
    waterShallow: a.waterShallow.clone(),
    waterDeep: a.waterDeep.clone(),
    riverShallow: a.riverShallow.clone(),
    riverDeep: a.riverDeep.clone(),
    waterTint: a.waterTint.clone(),
    bankColor: a.bankColor.clone()
  }
}

const ATMO_COLOR_KEYS = [
  'bg', 'far', 'sunCol', 'fillCol', 'hemiSky', 'hemiGnd',
  'bottom', 'top', 'roof', 'line', 'outerBottom', 'outerTop', 'outerRoof',
  'edgeIn', 'edgeOut', 'outerLine', 'outerGlow', 'hqBeam', 'hqRing', 'waveCol',
  'groundTint', 'waterShallow', 'waterDeep', 'riverShallow', 'riverDeep', 'waterTint', 'bankColor'
]
const _skyNightCol = new THREE.Color('#040710')
const _skyDayCol = new THREE.Color('#8cb4dc')
const _skyDuskCol = new THREE.Color('#1d243b')
const _skyTopScratch = new THREE.Color()
let transitionScratchAtmo = null

function lerpAtmosphereInto(out, from, to, t) {
  out.presetKey = to.presetKey
  out.phase = to.phase
  out.themeRef = to.themeRef
  out.nightFactor = THREE.MathUtils.lerp(from.nightFactor, to.nightFactor, t)
  out.windowGlow = THREE.MathUtils.lerp(from.windowGlow, to.windowGlow, t)
  out.fogDensity = THREE.MathUtils.lerp(from.fogDensity, to.fogDensity, t)
  out.sunInt = THREE.MathUtils.lerp(from.sunInt, to.sunInt, t)
  out.fillInt = THREE.MathUtils.lerp(from.fillInt, to.fillInt, t)
  out.hemiInt = THREE.MathUtils.lerp(from.hemiInt, to.hemiInt, t)
  out.edgeInOp = THREE.MathUtils.lerp(from.edgeInOp, to.edgeInOp, t)
  out.edgeOutOp = THREE.MathUtils.lerp(from.edgeOutOp, to.edgeOutOp, t)
  out.sunPos.lerpVectors(from.sunPos, to.sunPos, t)
  for (let i = 0; i < ATMO_COLOR_KEYS.length; i++) {
    const k = ATMO_COLOR_KEYS[i]
    out[k].copy(from[k]).lerp(to[k], t)
  }
  return out
}

function applyAtmosphereSnapshot(atmo, opts = {}) {
  if (!scene || !renderer || !assetsRef) return
  const { forceReflection = true, skipClone = false } = opts
  if (!skipClone) {
    currentAtmo = cloneAtmosphere(atmo)
  }
  const isSat = groundStyle.value === 'sat'
  const isNightTex = atmo.nightFactor >= 0.5

  terrainCorrection.value.set(isSat ? 0 : 1, atmo.nightFactor)
  waterfront?.setAtmosphere({
    sky: atmo.bg,
    shallow: atmo.waterShallow,
    deep: atmo.waterDeep,
    riverShallow: atmo.riverShallow,
    riverDeep: atmo.riverDeep,
    nightFactor: atmo.nightFactor,
    glowFactor: atmo.windowGlow,
    waterTint: atmo.waterTint,
    bankColor: atmo.bankColor,
    theme: atmo.themeRef,
    satellite: isSat ? assetsRef.satTex : null,
    forceReflection
  })

  if (skyDomeMat) {
    skyDomeMat.uniforms.uSkyHorizon.value.copy(atmo.bg)
    _skyTopScratch.copy(atmo.bg).lerp(
      atmo.nightFactor > 0.5 ? _skyNightCol : _skyDayCol,
      atmo.nightFactor > 0.5 ? 0.58 : (atmo.phase === 'dusk' ? 0.36 : 0.42)
    )
    if (atmo.phase === 'dusk') {
      _skyTopScratch.lerp(_skyDuskCol, 0.48)
    }
    skyDomeMat.uniforms.uSkyTop.value.copy(_skyTopScratch)
    skyDomeMat.uniforms.uSunDir.value.copy(atmo.sunPos).normalize()
    skyDomeMat.uniforms.uSunHaloCol.value.copy(atmo.sunCol)
    skyDomeMat.uniforms.uSunHaloStr.value = atmo.phase === 'dusk' ? 0.52 : atmo.phase === 'dawn' ? 0.36 : atmo.nightFactor > 0.5 ? 0.08 : 0.22
  }

  bldgUniforms.uNight.value = atmo.nightFactor
  bldgUniforms.uWindowGlow.value = atmo.windowGlow
  if (scene.background?.isColor) scene.background.copy(atmo.bg)
  else scene.background = atmo.bg.clone()
  scene.fog.color.copy(atmo.bg)
  targetFogDensity = atmo.fogDensity
  if (!introWaveAnim) {
    scene.fog.density = atmo.fogDensity
  }
  if (farGroundMesh) farGroundMesh.material.color.copy(atmo.far)
  groundFarUniform.value.copy(atmo.far)

  sunLight.position.copy(atmo.sunPos)
  sunLight.intensity = atmo.sunInt
  sunLight.color.copy(atmo.sunCol)
  fillLight.intensity = atmo.fillInt
  fillLight.color.copy(atmo.fillCol)
  hemiLight.intensity = atmo.hemiInt
  hemiLight.color.copy(atmo.hemiSky)
  hemiLight.groundColor.copy(atmo.hemiGnd)

  bldgUniforms.uBottomCol.value.copy(atmo.bottom)
  bldgUniforms.uTopCol.value.copy(atmo.top)
  bldgUniforms.uRoofCol.value.copy(atmo.roof)
  bldgUniforms.uLineCol.value.copy(atmo.line)
  bldgUniforms.uOuterBottomCol.value.copy(atmo.outerBottom)
  bldgUniforms.uOuterTopCol.value.copy(atmo.outerTop)
  bldgUniforms.uOuterRoofCol.value.copy(atmo.outerRoof)
  bldgUniforms.uWaveColor.value.copy(atmo.waveCol)

  targetEdgeInOp = atmo.edgeInOp
  targetEdgeOutOp = atmo.edgeOutOp
  if (innerEdgeMat) { innerEdgeMat.color.copy(atmo.edgeIn); if (!introWaveAnim) innerEdgeMat.opacity = atmo.edgeInOp }
  if (outerEdgeMat) { outerEdgeMat.color.copy(atmo.edgeOut); if (!introWaveAnim) outerEdgeMat.opacity = atmo.edgeOutOp }
  if (outerTubeMat) outerTubeMat.color.copy(atmo.outerLine)
  if (outerGlowMat) outerGlowMat.color.copy(atmo.outerGlow)
  if (boundaryCurtainMat) {
    boundaryCurtainMat.uniforms.uColor.value.copy(atmo.outerLine)
    boundaryCurtainMat.uniforms.uGlowColor.value.copy(atmo.outerGlow)
    boundaryCurtainMat.uniforms.uNight.value = atmo.nightFactor
  }
  if (compassDiscMat) {
    compassDiscMat.uniforms.uRingCol.value.copy(atmo.hqRing)
    compassDiscMat.uniforms.uBeamCol.value.copy(atmo.hqBeam)
  }
  if (hqBeamMat) {
    if (hqBeamMat.uniforms?.uColor) hqBeamMat.uniforms.uColor.value.copy(atmo.hqBeam)
    else hqBeamMat.color?.copy(atmo.hqBeam)
  }
  if (hqBeacon?.material) {
    hqBeacon.material.color.copy(atmo.hqRing)
    hqBeacon.material.emissive.copy(atmo.hqBeam)
  }
  hqRings.forEach((r) => r.mat.color.copy(atmo.hqRing))

  if (groundMat) {
    const desiredKey = isSat ? 'satTex' : (isNightTex ? 'darkVecTex' : 'lightVecTex')
    const desiredTex = resolveGroundTex(desiredKey)
    if (desiredTex) {
      const prevHasMap = Boolean(groundMat.map)
      if (groundMat.map !== desiredTex) {
        groundMat.map = desiredTex
        if (!prevHasMap) groundMat.needsUpdate = true
      }
    } else if (lastAppliedVecNight !== desiredKey) {
      lastAppliedVecNight = desiredKey
      ensureAmapTexture(desiredKey)
        .then((tex) => {
          if (isDisposed || !renderer || !tex) return
          tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
          if (typeof renderer.initTexture === 'function') renderer.initTexture(tex)
          if (desiredKey === 'satTex' && imageryMat && imageryMat.map !== tex) {
            imageryMat.map = tex
            imageryMat.needsUpdate = true
          }
          applyVisualTheme(true)
        })
        .catch(() => {})
    }
    if (isSat && isNightTex) {
      groundMat.color.set('#5a6a82')
    } else {
      groundMat.color.copy(atmo.groundTint)
    }
  }
  staticRenderNeeded = true
}

/** 同步 6 套主题预设 × 四时辰 3D 建模配色与底图（支持 1.2s 丝滑插值过渡） */
function applyVisualTheme(instant = false) {
  if (!scene || !renderer || !assetsRef) return
  const phase = effectiveTimePhase.value
  const presetKey = PRESET_3D_THEMES[store.preset] ? store.preset : 'vermilion-seal'
  const target = computeTargetAtmosphere(presetKey, phase)

  if (instant || !currentAtmo || loading.value || prefersReducedMotion) {
    lightingTransition = null
    const sunMoved = !currentAtmo || currentAtmo.sunPos.distanceToSquared(target.sunPos) > 1
    applyAtmosphereSnapshot(target)
    if (sunMoved && renderer && !loading.value) {
      renderer.shadowMap.needsUpdate = true
    }
    return
  }

  const startFrom = (lightingTransition && transitionScratchAtmo)
    ? cloneAtmosphere(transitionScratchAtmo)
    : cloneAtmosphere(currentAtmo)
  if (!transitionScratchAtmo) {
    transitionScratchAtmo = cloneAtmosphere(target)
  }
  lightingTransition = {
    startTime: performance.now(),
    duration: 1200,
    from: startFrom,
    to: target,
    shadowTick: 0
  }
  staticRenderNeeded = true
}

function disposeGroup(grp) {
  if (!grp) return
  grp.traverse((obj) => {
    if (obj.isInstancedMesh) obj.dispose()
    if (obj.geometry && !obj.userData.sharedGeo) obj.geometry.dispose()
    if (obj.material && !obj.userData.sharedMat) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
      else obj.material.dispose()
    }
  })
}

// ── 构建高德官方风格 1:1 真实多边形三维城市 ──
async function buildAmap3DCity(precomputedGeos = null, yieldFn = null) {
  if (!scene || !assetsRef) return
  if (cityGroup) {
    waterfront?.disposeInactive()
    disposeGroup(cityGroup)
    scene.remove(cityGroup)
  }
  cityGroup = new THREE.Group()
  scene.add(cityGroup)

  const skyDome = createSkyDome()
  skyDomeMesh = skyDome.mesh
  skyDomeMat = skyDome.mat
  cityGroup.add(skyDomeMesh)

  const maxAniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4
  ;[assetsRef.lightVecTex, assetsRef.darkVecTex, assetsRef.satTex].forEach((t) => {
    if (t) t.anisotropy = maxAniso
  })

  // 1. 远景延展无缝大地（采用与主地表一致的 PBR 光照响应，消除倾斜视角下远端明暗阶跃硬边）
  farGroundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(4800, 4800),
    new THREE.MeshStandardMaterial({ color: '#eae3d8', roughness: 0.94, metalness: 0.02 })
  )
  farGroundMesh.rotation.x = -Math.PI / 2
  farGroundMesh.position.y = -0.35
  cityGroup.add(farGroundMesh)

  // 2. 1:1 精确对齐的高德官方高清矢量底图地表（3840×3584）+ 四周边际柔和羽化过渡
  const sb = amapPolyData.baseBounds
  const [xW, zN] = latLngToWorldXZ(sb.north, sb.west)
  const [xE, zS] = latLngToWorldXZ(sb.south, sb.east)
  const groundW = Math.abs(xE - xW)
  const groundD = Math.abs(zS - zN)
  const groundCX = (xW + xE) / 2
  const groundCZ = (zN + zS) / 2

  groundMat = new THREE.MeshStandardMaterial({
    map: (isNightScene.value ? resolveGroundTex('darkVecTex') : resolveGroundTex('lightVecTex')) || resolveGroundTex('lightVecTex') || resolveGroundTex('darkVecTex'),
    roughness: 0.94,
    metalness: 0.02
  })
  groundMat.onBeforeCompile = (shader) => {
    shader.uniforms.uFarLand = groundFarUniform
    if (props.mode === 'cockpit' || props.mode === 'login') {
      shader.uniforms.uShore = { value: assetsRef.shoreDistanceTex }
      shader.uniforms.uCorrection = terrainCorrection
      shader.uniforms.uStreetDetail = bldgUniforms.uStreetDetail
      shader.uniforms.uGroundMeters = { value: new THREE.Vector2(groundW * WORLD_DIV, groundD * WORLD_DIV) }
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D uShore;
          uniform vec2 uCorrection, uGroundMeters;
          uniform vec3 uFarLand;
          uniform float uStreetDetail;
          float surfaceGrain(vec2 cell) {
            vec3 p = fract(vec3(cell.xyx) * 0.1031);
            p += dot(p, p.yzx + 33.33);
            return fract((p.x + p.y) * p.z);
          }
          float groundNoise(vec2 point) {
            vec2 cell = floor(point), blend = fract(point);
            blend *= blend * (3.0 - 2.0 * blend);
            return mix(mix(surfaceGrain(cell), surfaceGrain(cell + vec2(1,0)), blend.x),
                       mix(surfaceGrain(cell + vec2(0,1)), surfaceGrain(cell + vec2(1,1)), blend.x), blend.y);
          }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec3 mask = texture2D(uShore, vMapUv).rgb;
          vec3 dayLand = mix(vec3(.86,.84,.78), vec3(.23,.39,.24), mask.b);
          vec3 nightLand = mix(vec3(.033,.045,.061), vec3(.027,.060,.048), mask.b);
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(dayLand, nightLand, uCorrection.y), mask.g*uCorrection.x);
          // 沿用底图的硬质铺地和绿地，仅在街面近景叠加材质；像素覆盖多个纹理单元时渐隐。
          if (uStreetDetail > 0.001 && uCorrection.x > 0.5) {
            vec2 meters = (vMapUv - 0.5) * uGroundMeters;
            vec2 tile = meters / vec2(0.96, 0.62);
            vec2 aa = max(fwidth(tile), vec2(0.001));
            float detail = uStreetDetail * (1.0 - smoothstep(0.12, 0.64, max(aa.x, aa.y)));
            tile.x += 0.5 * mod(floor(tile.y), 2.0);
            vec2 jointDist = 0.5 - abs(fract(tile) - 0.5);
            vec2 surface = smoothstep(vec2(0.004) - aa * 0.5, vec2(0.014) + aa * 0.5, jointDist);
            vec3 color = diffuseColor.rgb;
            float chroma = max(max(color.r, color.g), color.b) - min(min(color.r, color.g), color.b);
            float paving = (1.0 - smoothstep(0.05, 0.17, chroma)) * (1.0 - mask.b);
            float grass = smoothstep(0.012, 0.075, color.g - max(color.r, color.b));
            vec2 grainAxis = vec2(meters.x + 0.37 * meters.y, meters.y - 0.37 * meters.x);
            float fine = groundNoise(grainAxis * vec2(27.0, 15.0)) - 0.5;
            float stone = (surfaceGrain(floor(tile)) - 0.5) * 0.079 - (1.0 - surface.x * surface.y) * 0.20;
            diffuseColor.rgb *= 1.0 + detail * (paving * stone + (0.035 + grass * 0.14) * fine);
          }
          float edgeMask = smoothstep(0.0, 0.075, vMapUv.x) * smoothstep(1.0, 0.925, vMapUv.x) * smoothstep(0.0, 0.065, vMapUv.y) * smoothstep(1.0, 0.885, vMapUv.y);
          diffuseColor.rgb = mix(uFarLand, diffuseColor.rgb, edgeMask);`)
    } else {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uFarLand;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float edgeMask = smoothstep(0.0, 0.075, vMapUv.x) * smoothstep(1.0, 0.925, vMapUv.x) * smoothstep(0.0, 0.065, vMapUv.y) * smoothstep(1.0, 0.885, vMapUv.y);
          diffuseColor.rgb = mix(uFarLand, diffuseColor.rgb, edgeMask);`)
    }
  }
  groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(groundW, groundD), groundMat)
  groundMesh.rotation.x = -Math.PI / 2
  groundMesh.position.set(groundCX, 0, groundCZ)
  groundMesh.receiveShadow = true
  cityGroup.add(groundMesh)

  if (props.mode === 'cockpit') {
    // 共用原地面的投影和卫星纹理，切换时保留当前相机、光照方案和业务选择。
    imageryMat = new THREE.MeshBasicMaterial({
      map: assetsRef.satTex || null, toneMapped: false, fog: false
    })
    const imagery = new THREE.Mesh(groundMesh.geometry, imageryMat)
    imagery.userData.sharedGeo = true
    imagery.position.copy(groundMesh.position)
    imagery.rotation.copy(groundMesh.rotation)
    imagery.layers.set(IMAGERY_LAYER)
    farGroundMesh.layers.enable(IMAGERY_LAYER)
    cityGroup.add(imagery)
    if (yieldFn) await yieldFn()
    if (isDisposed || !scene) return
  }
  if (props.mode === 'cockpit' || props.mode === 'login') {
    waterfront = await createCockpitWaterfrontAsync(xW, zN, xE, zS, assetsRef.shoreDistanceTex, compactRenderer, yieldFn)
    if (isDisposed || !scene) return
    for (const light of [sunLight, fillLight, hemiLight]) light.layers.enable(WATER_REFLECTION_LAYER)
    cityGroup.add(waterfront.group)
    if (yieldFn) await yieldFn()
    if (isDisposed || !scene) return
  }

  // 3. 合批 4,205 栋精确多边形真实轮廓 3D 建筑 + 锐利屋顶轮廓棱边线
  const geos = precomputedGeos || buildMergedAmapBuildingGeometries(amapPolyData.buildings)

  innerBldgMat = createAmapBuildingMaterial(true)
  const innerMesh = new THREE.Mesh(geos.inner.meshGeo, innerBldgMat)
  innerMesh.castShadow = true
  innerMesh.receiveShadow = true
  innerMesh.userData.sharedGeo = true
  cityGroup.add(innerMesh)

  innerEdgeMat = new THREE.LineBasicMaterial({ color: '#9ab0c7', transparent: true, opacity: 0.55 })
  const innerEdges = new THREE.LineSegments(geos.inner.edgeGeo, innerEdgeMat)
  innerEdges.userData.sharedGeo = true
  cityGroup.add(innerEdges)

  outerBldgMat = createAmapBuildingMaterial(false)
  const outerMesh = new THREE.Mesh(geos.outer.meshGeo, outerBldgMat)
  outerMesh.castShadow = true
  outerMesh.receiveShadow = true
  outerMesh.userData.sharedGeo = true
  cityGroup.add(outerMesh)

  outerEdgeMat = new THREE.LineBasicMaterial({ color: '#bcc8d6', transparent: true, opacity: 0.28 })
  const outerEdges = new THREE.LineSegments(geos.outer.edgeGeo, outerEdgeMat)
  outerEdges.userData.sharedGeo = true
  cityGroup.add(outerEdges)
}

async function buildCommunityOverlays(yieldFn = null) {
  if (!scene) return
  if (overlayGroup) {
    disposeGroup(overlayGroup)
    scene.remove(overlayGroup)
  }
  zoneEntries.clear()
  hqRings = []
  overlayGroup = new THREE.Group()
  scene.add(overlayGroup)

  // 1. 全街道 104 顶点「竖向渐变羽化疆域光幕 + 巡游金脉」
  const outerPts = CHANGHE_OUTER_BOUNDARY.map(([lat, lng]) => {
    const [x, z] = latLngToWorldXZ(lat, lng)
    return new THREE.Vector3(x, 0.25, z)
  })
  const outerCurve = new THREE.CatmullRomCurve3(outerPts, true, 'catmullrom', 0.05)
  outerTubeMat = new THREE.MeshBasicMaterial({ color: 0xe63946, transparent: true, opacity: 0.92 })
  overlayGroup.add(new THREE.Mesh(new THREE.TubeGeometry(outerCurve, 260, 0.36, 5, true), outerTubeMat))

  boundaryCurtainMat = createBoundaryCurtainMaterial(0xe63946, 0xf4c97a)
  outerGlowMat = null
  overlayGroup.add(new THREE.Mesh(buildBoundaryCurtainGeometry(outerCurve, 280, 10.5), boundaryCurtainMat))
  if (yieldFn) await yieldFn()
  if (isDisposed || !scene) return

  // 2. 14 真实社区路网贴地分区线 + 选中态干净贴地光晕面与贴地高亮管线（按微切片分批构建，杜绝单帧卡顿）
  let sliceStart = performance.now()
  for (let cIdx = 0; cIdx < COMMUNITIES.length; cIdx++) {
    const c = COMMUNITIES[cIdx]
    const polyXZ = c.polygon.map(([lat, lng]) => latLngToWorldXZ(lat, lng))
    const offset = CHANGHE_LABEL_OFFSETS[c.name] || [0, 0]
    const centerXZ = latLngToWorldXZ(c.center[0] + offset[0], c.center[1] + offset[1])

    const borderPts = polyXZ.map(([x, z]) => new THREE.Vector3(x, 0.30, z))
    const borderMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.65 })
    overlayGroup.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(borderPts), borderMat))

    // 贴地极柔和选区底面光晕（位于地面 y=0.08，零遮挡、不穿楼）
    const shape = new THREE.Shape()
    polyXZ.forEach(([x, z], idx) => {
      if (idx === 0) shape.moveTo(x, -z)
      else shape.lineTo(x, -z)
    })
    shape.closePath()
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0xd9303e,
      transparent: true,
      opacity: 0.12,
      depthWrite: false
    })
    const fillMesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), fillMat)
    fillMesh.rotation.x = -Math.PI / 2
    fillMesh.position.y = 0.08
    fillMesh.visible = false
    overlayGroup.add(fillMesh)

    // 选中态贴地高亮加粗边界管线（紧贴路面 y=0.45，干净锐利）
    const cleanPts = []
    polyXZ.forEach(([x, z]) => {
      const prev = cleanPts[cleanPts.length - 1]
      if (!prev || Math.hypot(x - prev.x, z - prev.z) > 0.25) {
        cleanPts.push(new THREE.Vector3(x, 0.45, z))
      }
    })
    const selCurve = new THREE.CatmullRomCurve3(cleanPts, true, 'catmullrom', 0.03)
    const selTubeMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.96 })
    const selTubeMesh = new THREE.Mesh(new THREE.TubeGeometry(selCurve, Math.min(180, cleanPts.length * 4), 0.58, 6, true), selTubeMat)
    selTubeMesh.visible = false
    overlayGroup.add(selTubeMesh)

    zoneEntries.set(c.name, {
      polyXZ,
      centerXZ,
      borderMat,
      fillMesh,
      fillMat,
      selTubeMesh,
      selTubeMat,
      community: c
    })

    if (yieldFn && (cIdx % 2 === 1 || performance.now() - sliceStart >= 3.5)) {
      await yieldFn()
      if (isDisposed || !scene) return
      sliceStart = performance.now()
    }
  }

  // 3. 长河街道综合治理指挥中心 3D 体积光柱 + 双环精密旋转罗盘
  if (props.mode !== 'single' && props.mode !== 'patrol') {
    const [hx, hz] = latLngToWorldXZ(CHANGHE_HQ_LATLNG[0], CHANGHE_HQ_LATLNG[1])
    const hqGrp = new THREE.Group()
    hqGrp.position.set(hx, 0.4, hz)

    hqBeamMat = createVolumetricBeamMaterial(0xd9303e, 0.62)
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 2.1, 15, 20, 1, true), hqBeamMat)
    beam.position.y = 7.5
    hqGrp.add(beam)

    hqBeacon = new THREE.Mesh(
      new THREE.OctahedronGeometry(2.2, 0),
      new THREE.MeshStandardMaterial({
        color: 0xf5d48a,
        emissive: 0xc81e2b,
        emissiveIntensity: 0.82,
        roughness: 0.2,
        metalness: 0.78
      })
    )
    hqBeacon.position.y = 15.2
    hqGrp.add(hqBeacon)

    compassDiscMat = createCompassDiscMaterial(0xf5c869, 0xd9303e)
    const compassMesh = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), compassDiscMat)
    compassMesh.rotation.x = -Math.PI / 2
    compassMesh.position.y = 0.22
    hqGrp.add(compassMesh)

    for (let i = 0; i < 2; i++) {
      const rMat = new THREE.MeshBasicMaterial({
        color: 0xf5c869,
        transparent: true,
        opacity: 0.58,
        side: THREE.DoubleSide,
        depthWrite: false
      })
      const rMesh = new THREE.Mesh(new THREE.RingGeometry(6.8, 7.6, 48), rMat)
      rMesh.rotation.x = -Math.PI / 2
      rMesh.position.y = 0.4
      hqGrp.add(rMesh)
      hqRings.push({ mesh: rMesh, mat: rMat, phase: i * 0.5 })
    }
    overlayGroup.add(hqGrp)
  } else {
    hqBeamMat = null
    hqBeacon = null
    compassDiscMat = null
  }

  updateZoneStyles()
  rebuildDynamicEvents()
}

function rebuildDynamicEvents() {
  if (!scene) return
  if (dynamicGroup) {
    disposeGroup(dynamicGroup)
    scene.remove(dynamicGroup)
  }
  dynamicTimeMats = []
  arcParticles = []
  alertRings = []
  pickableDynamicTargets = []
  dynamicGroup = new THREE.Group()
  scene.add(dynamicGroup)

  // 模式 A：单点事件实景三维精准定位
  if (props.mode === 'single' && props.singleEvent) {
    const ev = props.singleEvent
    const [ex, ez] = latLngToWorldXZ(ev.lat, ev.lng)
    const isDone = ev.stage === '已办结'
    const isUrgent = ev.stage === '待受理' || ev.stage === '待补充'
    const colHex = isDone ? 0x10b981 : isUrgent ? 0xef4444 : 0xf59e0b

    const beamH = 26
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.65, 1.85, beamH, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: colHex, transparent: true, opacity: 0.52, side: THREE.DoubleSide, depthWrite: false })
    )
    beam.position.set(ex, beamH / 2 + 0.4, ez)
    dynamicGroup.add(beam)

    const beacon = new THREE.Mesh(
      new THREE.OctahedronGeometry(2.6, 0),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: colHex,
        emissiveIntensity: 0.9,
        roughness: 0.2,
        metalness: 0.4
      })
    )
    beacon.position.set(ex, beamH + 3.4, ez)
    dynamicGroup.add(beacon)

    const baseDisc = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 28),
      new THREE.MeshBasicMaterial({ color: colHex, transparent: true, opacity: 0.35, depthWrite: false })
    )
    baseDisc.rotation.x = -Math.PI / 2
    baseDisc.position.set(ex, 0.55, ez)
    dynamicGroup.add(baseDisc)

    for (let i = 0; i < 2; i++) {
      const ringMat = new THREE.MeshBasicMaterial({
        color: colHex,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false
      })
      const ring = new THREE.Mesh(new THREE.RingGeometry(3.8, 5.6, 36), ringMat)
      ring.rotation.x = -Math.PI / 2
      ring.position.set(ex, 0.72, ez)
      dynamicGroup.add(ring)
      alertRings.push({ mesh: ring, mat: ringMat, phase: i * 0.5 })
    }
    return
  }

  // 模式 B：网格员巡查三维立体轨迹回放与防挂机滞留告警
  if (props.mode === 'patrol' && props.patrolRecord?.track?.length) {
    const rec = props.patrolRecord
    const worldPts = rec.track.map((p) => {
      const [x, z] = latLngToWorldXZ(p.lat, p.lng)
      return new THREE.Vector3(x, 1.5, z)
    })

    // 1) 全程待巡检规划轨迹管线（柔和蓝灰）
    if (worldPts.length >= 2) {
      const fullCurve = new THREE.CatmullRomCurve3(worldPts, false, 'catmullrom', 0.12)
      dynamicGroup.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(fullCurve, worldPts.length * 20, 0.55, 8, false),
          new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.45 })
        )
      )
    }

    // 2) 已走过轨迹加粗发光翠绿管线 + 流动光珠
    const stepClamped = Math.min(Math.max(0, props.patrolStepIdx), worldPts.length - 1)
    if (stepClamped >= 1) {
      const walkedPts = worldPts.slice(0, stepClamped + 1).map((v) => new THREE.Vector3(v.x, 1.9, v.z))
      const walkedCurve = new THREE.CatmullRomCurve3(walkedPts, false, 'catmullrom', 0.12)
      dynamicGroup.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(walkedCurve, walkedPts.length * 22, 0.95, 10, false),
          new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.94 })
        )
      )
      const pMesh = new THREE.Mesh(
        new THREE.SphereGeometry(1.45, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xa7f3d0 })
      )
      dynamicGroup.add(pMesh)
      arcParticles.push({ mesh: pMesh, curve: walkedCurve, t: 0, speed: 0.32 })
    }

    // 3) 轨迹各必到点立柱与停留异常红光警戒圈
    rec.track.forEach((pt, idx) => {
      const wp = worldPts[idx]
      const reached = idx <= stepClamped
      const isCur = idx === stepClamped
      const isAnom = pt.isStayAnomaly && rec.stayMinutes > props.patrolThreshold
      const colHex = isAnom ? 0xef4444 : isCur ? 0x1d4ed8 : reached ? 0x10b981 : 0x64748b

      const h = isAnom ? 22 : isCur ? 18 : 11
      const pin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.9, h, 10),
        new THREE.MeshBasicMaterial({ color: colHex, transparent: true, opacity: isAnom || isCur ? 0.88 : 0.7 })
      )
      pin.position.set(wp.x, h / 2 + 0.4, wp.z)
      dynamicGroup.add(pin)

      const head = new THREE.Mesh(
        new THREE.SphereGeometry(isAnom || isCur ? 1.8 : 1.2, 12, 12),
        new THREE.MeshBasicMaterial({ color: isAnom ? 0xfca5a5 : isCur ? 0x93c5fd : 0xffffff })
      )
      head.position.set(wp.x, h + 1.4, wp.z)
      dynamicGroup.add(head)

      if (isAnom) {
        const warnZone = new THREE.Mesh(
          new THREE.CircleGeometry(14, 36),
          new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.22, depthWrite: false })
        )
        warnZone.rotation.x = -Math.PI / 2
        warnZone.position.set(wp.x, 0.52, wp.z)
        dynamicGroup.add(warnZone)

        for (let i = 0; i < 2; i++) {
          const rMat = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false })
          const ring = new THREE.Mesh(new THREE.RingGeometry(5.5, 7.4, 36), rMat)
          ring.rotation.x = -Math.PI / 2
          ring.position.set(wp.x, 0.68, wp.z)
          dynamicGroup.add(ring)
          alertRings.push({ mesh: ring, mat: rMat, phase: i * 0.5 })
        }
      } else if (isCur) {
        const rMat = new THREE.MeshBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
        const ring = new THREE.Mesh(new THREE.RingGeometry(3.6, 5.2, 32), rMat)
        ring.rotation.x = -Math.PI / 2
        ring.position.set(wp.x, 0.65, wp.z)
        dynamicGroup.add(ring)
        alertRings.push({ mesh: ring, mat: rMat, phase: 0 })
      }
    })
    return
  }

  // 模式 C：数字武装五专题 3D 立体光标与军政柱阵
  if (props.mode === 'armed') {
    if (props.armedTopic === 'education' && props.armedPlaces.length) {
      props.armedPlaces.forEach((pl, idx) => {
        const [px, pz] = latLngToWorldXZ(pl.coord[0], pl.coord[1])
        const h = 16 + Math.min(20, (pl.count || 6) * 1.4)
        const pillar = new THREE.Mesh(
          new THREE.CylinderGeometry(1.1, 1.9, h, 14),
          new THREE.MeshBasicMaterial({ color: 0x0ea5e9, transparent: true, opacity: 0.82 })
        )
        pillar.position.set(px, h / 2 + 0.4, pz)
        pillar.userData.armedPoint = pl
        dynamicGroup.add(pillar)

        const rMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false })
        const ring = new THREE.Mesh(new THREE.RingGeometry(3.8, 5.4, 32), rMat)
        ring.rotation.x = -Math.PI / 2
        ring.position.set(px, 0.68, pz)
        dynamicGroup.add(ring)
        alertRings.push({ mesh: ring, mat: rMat, phase: (idx * 0.2) % 1 })
      })
    } else {
      COMMUNITIES.forEach((c, idx) => {
        const offset = CHANGHE_LABEL_OFFSETS[c.name] || [0, 0]
        const [cx, cz] = latLngToWorldXZ(c.center[0] + offset[0], c.center[1] + offset[1])
        const isSel = props.selectedCommunity === c.name
        let colHex = 0xc81e2b
        let h = 16
        if (props.armedTopic === 'militia') {
          colHex = 0x1d6945
          h = 12 + (c.armed.militia / 32) * 20
        } else if (props.armedTopic === 'recruit') {
          colHex = c.armed.recruitReg >= 75 ? 0x16a34a : c.armed.recruitReg >= 60 ? 0x0284c7 : 0xd97706
          h = 10 + (c.armed.recruitReg / 95) * 24
        } else if (props.armedTopic === 'mobilize') {
          colHex = props.mobilizeLayer === 'rally' ? 0xea580c : 0xc81e2b
          h = 14 + (c.armed.veterans / 132) * 16
        }
        const pillar = new THREE.Mesh(
          new THREE.CylinderGeometry(isSel ? 1.5 : 0.95, isSel ? 2.4 : 1.6, h, 12),
          new THREE.MeshBasicMaterial({ color: colHex, transparent: true, opacity: isSel ? 0.95 : 0.78 })
        )
        pillar.position.set(cx, h / 2 + 0.4, cz)
        pillar.userData.armedPoint = c
        dynamicGroup.add(pillar)

        if (isSel) {
          const rMat = new THREE.MeshBasicMaterial({ color: colHex, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
          const ring = new THREE.Mesh(new THREE.RingGeometry(4.2, 6.2, 32), rMat)
          ring.rotation.x = -Math.PI / 2
          ring.position.set(cx, 0.7, cz)
          dynamicGroup.add(ring)
          alertRings.push({ mesh: ring, mat: rMat, phase: (idx * 0.17) % 1 })
        }
      })
    }
    return
  }

  const [hx, hz] = latLngToWorldXZ(CHANGHE_HQ_LATLNG[0], CHANGHE_HQ_LATLNG[1])
  const hqTop = new THREE.Vector3(hx, 40, hz)

  if (props.slice === 'eco' && props.mode !== 'cockpit') {
    COMMUNITIES.filter((c) => props.selectedCommunity === '全街道' || c.name === props.selectedCommunity).forEach((c) => {
      const [cx, cz] = latLngToWorldXZ(c.center[0], c.center[1])
      const fH = 14 + c.env.floodPts * 10
      const fMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(1.5, 2.2, fH, 12),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.82 })
      )
      fMesh.position.set(cx - 7, fH / 2 + 0.4, cz + 5)
      dynamicGroup.add(fMesh)

      const fiH = 12 + c.env.firePts * 9
      const fiMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(1.5, 2.2, fiH, 12),
        new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.82 })
      )
      fiMesh.position.set(cx + 7, fiH / 2 + 0.4, cz + 5)
      dynamicGroup.add(fiMesh)
    })
    return
  }

  const openEvents = props.events.filter((e) => e.stage !== '已办结').slice(0, 12)
  if (props.mode === 'cockpit' && props.selectedEventId && !openEvents.some(ev => ev.id === props.selectedEventId)) {
    const selected = props.events.find(ev => ev.id === props.selectedEventId && ev.stage !== '已办结')
    if (selected) openEvents.push(selected)
  }
  const showDispatchArcs =
    (props.mode !== 'cockpit' && props.mode !== 'login') ||
    Boolean(props.selectedEventId)

  openEvents.forEach((ev, idx) => {
    const [ex, ez] = latLngToWorldXZ(ev.lat, ev.lng)
    const isUrgent = ev.stage === '待受理' || ev.stage === '待补充'
    const isSelectedEv = props.selectedEventId && props.selectedEventId === ev.id
    const colHex = isUrgent ? 0xdc2626 : 0xd97706
    const glowHex = isUrgent ? 0xffb3a8 : 0xffe4a0

    const beamH = isSelectedEv ? 36 : isUrgent ? 28 : 22
    const beamAlpha = isSelectedEv ? 0.88 : isUrgent ? 0.72 : 0.56
    const beamMat = createVolumetricBeamMaterial(colHex, beamAlpha)
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(isSelectedEv ? 0.65 : 0.45, isSelectedEv ? 2.4 : 1.85, beamH, 16, 1, true),
      beamMat
    )
    beam.position.set(ex, beamH / 2 + 0.4, ez)
    beam.userData.eventObj = ev
    dynamicGroup.add(beam)

    const ringMat = new THREE.MeshBasicMaterial({
      color: colHex,
      transparent: true,
      opacity: isSelectedEv ? 0.92 : 0.74,
      side: THREE.DoubleSide,
      depthWrite: false
    })
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.8, 5.6, 32), ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.set(ex, 0.8, ez)
    dynamicGroup.add(ring)
    alertRings.push({ mesh: ring, mat: ringMat, phase: (idx * 0.25) % 1, beamMat, beamAlpha })

    // 驾驶舱选定事件后才显示调度连线，登录页仍展示概览动效。
    const showReportSubtleArc = props.mode === 'login' && !showDispatchArcs && idx < 4
    if ((showDispatchArcs && (!props.selectedEventId || isSelectedEv)) || showReportSubtleArc) {
      const endPt = new THREE.Vector3(ex, beamH * 0.68, ez)
      const dist = hqTop.distanceTo(endPt)
      const midPt = new THREE.Vector3(
        (hqTop.x + endPt.x) / 2,
        Math.max(72, 46 + dist * 0.34),
        (hqTop.z + endPt.z) / 2
      )
      const curve = new THREE.QuadraticBezierCurve3(hqTop, midPt, endPt)
      const tubeRadius = isSelectedEv ? 0.78 : showDispatchArcs ? 0.52 : 0.36
      const arcMat = createFlowArcMaterial(
        colHex,
        glowHex,
        isSelectedEv ? 0.48 : showDispatchArcs ? 0.30 : 0.16,
        0.22 + (idx % 3) * 0.04,
        (idx * 0.19) % 1
      )
      dynamicGroup.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(curve, 40, tubeRadius, 6, false),
          arcMat
        )
      )
    }
  })

  pickableDynamicTargets = dynamicGroup.children.filter(
    (obj) => obj.userData?.armedPoint || obj.userData?.eventObj
  )
  updateEventEmphasis()
  staticRenderNeeded = true
}

function updateEventEmphasis() {
  if (props.mode !== 'cockpit') return
  const emphasis = focusedOnPersonnel.value ? 0.24 : 1
  for (const ring of alertRings) {
    if (!ring.beamMat) continue
    ring.emphasis = emphasis
    ring.beamMat.uniforms.uAlpha.value = ring.beamAlpha * emphasis
    ring.mat.opacity = (1 - ring.phase) * 0.76 * emphasis
  }
  staticRenderNeeded = true
}

/** 写入 128×64 建筑语义着色纹理（底色镜像 + 悬停 O(1) 增量叠加，保留 85%+ 原有白模/暗夜晶格美学） */
function updateBuildingSemanticTexture() {
  if (props.mode !== 'cockpit') {
    bldgUniforms.uUseSemantic.value = 0
    return
  }
  bldgUniforms.uUseSemantic.value = 1
  if (!buildingIndexRef) buildingIndexRef = getCockpitBuildingIndex()
  const { bldgToEvents } = buildEventBuildingMap(props.events)
  lastEventBldgMap = bldgToEvents

  const selIdx = props.selectedBuildingIndex
  const slice = props.slice
  const selComm = props.selectedCommunity
  const night = isNightScene.value
  const emgCareSet = new Set((props.emergencyInfo?.careBuildings || []).map((c) => c.index))

  // 先写入不含 hover 的底色镜像（alpha=0 表示完全保留原有精调渐变白模）
  baseBldgColorData.fill(0)

  const setBasePx = (idx, r, g, b, aFloat) => {
    if (idx < 0 || idx >= SEM_TEX_W * SEM_TEX_H) return
    const off = idx * 4
    baseBldgColorData[off] = r
    baseBldgColorData[off + 1] = g
    baseBldgColorData[off + 2] = b
    baseBldgColorData[off + 3] = Math.max(0, Math.min(255, Math.round(aFloat * 255)))
  }

  const list = buildingIndexRef.buildings
  for (let i = 0; i < list.length; i++) {
    const b = list[i]
    if (!b || !b.isInner) continue

    const evs = bldgToEvents.get(i) || []
    const hasOpenEv = evs.some((e) => e.stage !== '已办结')
    const inSelComm = selComm === '全街道' || b.community === selComm

    // 1. 当前选中单栋楼：温润高亮点睛
    if (i === selIdx) {
      setBasePx(i, 214, 72, 62, 0.86)
      continue
    }

    // 2. 300m 联动圈内受波及独居高龄重点楼：柔和紫金高亮
    if (emgCareSet.has(i)) {
      setBasePx(i, 139, 92, 246, 0.78)
      continue
    }

    // 非锁定社区轻微压柔，突出焦点社区
    if (!inSelComm) {
      if (night) setBasePx(i, 18, 26, 40, 0.42)
      else setBasePx(i, 218, 215, 210, 0.36)
      continue
    }

    // 3. 按当前驾驶舱五章专题克制点睛（仅对真正有该业务特征的少数重点楼着色）
    if (slice === 'safety') {
      if (hasOpenEv) {
        setBasePx(i, 210, 56, 56, 0.84)
      } else if (b.baseHazard) {
        setBasePx(i, 218, 134, 48, 0.62)
      } else if (b.isLandmark) {
        setBasePx(i, 186, 146, 78, 0.56)
      }
    } else if (slice === 'party') {
      if (b.isLandmark || b.category === 'public') {
        setBasePx(i, 188, 44, 54, 0.74)
      } else if (b.partyMembers >= 5) {
        setBasePx(i, 206, 98, 92, 0.48)
      }
    } else if (slice === 'economy') {
      if (b.profileKey === 'commercial' || b.revenueYi >= 3.8) {
        setBasePx(i, 208, 148, 46, 0.78)
      } else if (b.category === 'commercial' || b.profileKey === 'district') {
        setBasePx(i, 218, 178, 98, 0.54)
      } else if (hasOpenEv) {
        setBasePx(i, 210, 56, 56, 0.72)
      }
    } else if (slice === 'eco') {
      if (b.floodNear) {
        setBasePx(i, 42, 146, 198, 0.64)
      } else if (b.community === '芦李府社区' || b.community === '赵辛社区' || b.community === '岳庄社区') {
        if (b.baseHazard) setBasePx(i, 218, 114, 46, 0.60)
      }
    } else if (slice === 'aid') {
      if (b.elderAloneCount >= 4) {
        setBasePx(i, 134, 92, 214, 0.76)
      } else if (b.elderAloneCount >= 1) {
        setBasePx(i, 162, 132, 220, 0.46)
      }
    }
  }

  bldgColorData.set(baseBldgColorData)
  appliedHoverBldgIndex = -1
  if (hoveredBldgIndex >= 0 && hoveredBldgIndex !== selIdx && hoveredBldgIndex < SEM_TEX_W * SEM_TEX_H) {
    const off = hoveredBldgIndex * 4
    bldgColorData[off] = 212
    bldgColorData[off + 1] = 152
    bldgColorData[off + 2] = 64
    bldgColorData[off + 3] = Math.round(0.72 * 255)
    appliedHoverBldgIndex = hoveredBldgIndex
  }
  bldgColorTex.needsUpdate = true
  rebuildSelectedOutline()
  rebuildHoverOutline()
  staticRenderNeeded = true
}

/** 鼠标跨楼悬停 O(1) 增量更新语义纹理（仅改旧/新 2 像素，免全量遍历 4,205 栋楼与重建选中描边） */
function applyHoverSemanticDelta(nextIdx) {
  if (props.mode !== 'cockpit') return
  const prevIdx = appliedHoverBldgIndex
  if (prevIdx >= 0 && prevIdx < SEM_TEX_W * SEM_TEX_H) {
    const off = prevIdx * 4
    bldgColorData[off] = baseBldgColorData[off]
    bldgColorData[off + 1] = baseBldgColorData[off + 1]
    bldgColorData[off + 2] = baseBldgColorData[off + 2]
    bldgColorData[off + 3] = baseBldgColorData[off + 3]
  }
  if (nextIdx >= 0 && nextIdx !== props.selectedBuildingIndex && nextIdx < SEM_TEX_W * SEM_TEX_H) {
    const off = nextIdx * 4
    bldgColorData[off] = 212
    bldgColorData[off + 1] = 152
    bldgColorData[off + 2] = 64
    bldgColorData[off + 3] = Math.round(0.72 * 255)
    appliedHoverBldgIndex = nextIdx
  } else {
    appliedHoverBldgIndex = -1
  }
  bldgColorTex.needsUpdate = true
  rebuildHoverOutline()
  staticRenderNeeded = true
}

function buildSingleOutlineGroup(b, r, topMat, baseMat) {
  const grp = new THREE.Group()
  const roofPts = b.pts.map(([x, z]) => new THREE.Vector3(x, b.height + 0.35, z))
  if (roofPts.length >= 3) {
    const curve = new THREE.CatmullRomCurve3(roofPts, true, 'catmullrom', 0.02)
    const topMesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.min(96, roofPts.length * 4), r, 5, true),
      topMat
    )
    topMesh.userData.sharedMat = true
    grp.add(topMesh)

    const basePts = b.pts.map(([x, z]) => new THREE.Vector3(x, 0.48, z))
    const baseCurve = new THREE.CatmullRomCurve3(basePts, true, 'catmullrom', 0.02)
    const baseMesh = new THREE.Mesh(
      new THREE.TubeGeometry(baseCurve, Math.min(96, basePts.length * 4), r * 0.8, 5, true),
      baseMat
    )
    baseMesh.userData.sharedMat = true
    grp.add(baseMesh)
  }
  return grp
}

/** 选中单栋楼精确轮廓线 + 聚光压暗状态同步 + 单层环带亮线 */
function rebuildSelectedOutline() {
  if (!scene || props.mode !== 'cockpit') return
  if (selectedOutlineGroup) {
    disposeGroup(selectedOutlineGroup)
    scene.remove(selectedOutlineGroup)
    selectedOutlineGroup = null
  }
  if (!buildingIndexRef) {
    focusTargetFactor = 0
    bldgUniforms.uFocusBldgId.value = -1.0
    rebuildFloorBand()
    return
  }
  const b = props.selectedBuildingIndex >= 0 ? buildingIndexRef.buildings[props.selectedBuildingIndex] : null
  if (!b) {
    focusTargetFactor = 0
    bldgUniforms.uFocusBldgId.value = -1.0
    rebuildFloorBand()
    return
  }
  focusTargetFactor = 1.0
  bldgUniforms.uFocusBldgId.value = props.selectedBuildingIndex
  selectedOutlineGroup = buildSingleOutlineGroup(b, 0.46, selOutlineTopMat, selOutlineBaseMat)
  scene.add(selectedOutlineGroup)
  rebuildFloorBand()
}

/** 绘制单栋楼宇精确单层亮带轮廓环（跟随右侧一楼一档悬停/点选楼层同步上下滑扫） */
function rebuildFloorBand() {
  if (!scene || props.mode !== 'cockpit') return
  if (floorBandGroup) {
    disposeGroup(floorBandGroup)
    scene.remove(floorBandGroup)
    floorBandGroup = null
  }
  const b = (props.selectedBuildingIndex >= 0 && buildingIndexRef)
    ? buildingIndexRef.buildings[props.selectedBuildingIndex]
    : null
  const ff = props.focusedFloor
  if (!b || !ff || !ff.floor) {
    bldgUniforms.uFloorBandActive.value = 0.0
    projectedFloorTag.value = null
    staticRenderNeeded = true
    return
  }
  const totalFloors = Math.max(1, Number(ff.totalFloors) || 6)
  const clampedFl = Math.max(1, Math.min(totalFloors, Number(ff.floor) || 1))
  const bandY = Math.max(0.42, Math.min(b.height - 0.18, ((clampedFl - 0.5) / totalFloors) * b.height))
  const bandColorHex = ff.tone === 'hazard' ? '#ef4444' : ff.tone === 'care' ? '#f59e0b' : '#f4c97a'

  bldgUniforms.uFloorBandActive.value = 1.0
  bldgUniforms.uFloorBandY.value = bandY
  bldgUniforms.uFloorBandHalfH.value = Math.max(0.28, Math.min(0.68, (b.height / totalFloors) * 0.72))
  bldgUniforms.uFloorBandCol.value.set(bandColorHex)
  floorBandRingMat.color.set(bandColorHex)

  const ringPts = b.pts.map(([x, z]) => {
    const dx = x - b.cx
    const dz = z - b.cz
    return new THREE.Vector3(b.cx + dx * 1.028, bandY, b.cz + dz * 1.028)
  })
  if (ringPts.length >= 3) {
    floorBandGroup = new THREE.Group()
    const curve = new THREE.CatmullRomCurve3(ringPts, true, 'catmullrom', 0.02)
    const ringMesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.min(84, ringPts.length * 4), 0.28, 5, true),
      floorBandRingMat
    )
    ringMesh.userData.sharedMat = true
    floorBandGroup.add(ringMesh)
    scene.add(floorBandGroup)
  }
  labelsDirty = true
  staticRenderNeeded = true
}

/** 悬停单栋楼轻量轮廓线（复用常驻材质） */
function rebuildHoverOutline() {
  if (!scene || props.mode !== 'cockpit') return
  if (hoverOutlineGroup) {
    disposeGroup(hoverOutlineGroup)
    scene.remove(hoverOutlineGroup)
    hoverOutlineGroup = null
  }
  if (!buildingIndexRef) return
  if (hoveredBldgIndex < 0 || hoveredBldgIndex === props.selectedBuildingIndex) return
  const b = buildingIndexRef.buildings[hoveredBldgIndex]
  if (!b) return
  hoverOutlineGroup = buildSingleOutlineGroup(b, 0.30, hovOutlineTopMat, hovOutlineBaseMat)
  scene.add(hoverOutlineGroup)
}

/** 渲染 4 类克制精致的 3D 治理实体小模型（在岗网格员 / 共享辅助站 / 易涝防火点 / 标杆楼宇顶标） */
function rebuildCockpitEntities() {
  if (!scene || props.mode !== 'cockpit') return
  if (entityGroup) {
    disposeGroup(entityGroup)
    scene.remove(entityGroup)
  }
  entityGroup = new THREE.Group()
  scene.add(entityGroup)

  cockpitEntitiesRef = buildCockpitEntities(store)
  const selComm = props.selectedCommunity
  const showAid = cockpitLayers.value.aid || Boolean(props.emergencyInfo)
  const showEco = cockpitLayers.value.eco
  const showLandmarks = cockpitLayers.value.landmarks

  const emgAidIds = new Set((props.emergencyInfo?.nearbyAids || []).map((a) => a.id))

  // 1. 标杆楼宇暖金菱形顶标
  if (showLandmarks) {
    cockpitEntitiesRef.landmarks.forEach((lm) => {
      if (selComm !== '全街道' && lm.community !== selComm) return
      const isSel = props.selectedBuildingIndex === lm.buildingIndex
      const pin = new THREE.Mesh(
        new THREE.OctahedronGeometry(isSel ? 2.1 : 1.5, 0),
        new THREE.MeshStandardMaterial({
          color: 0xf4c97a,
          emissive: 0xb81c28,
          emissiveIntensity: isSel ? 0.75 : 0.35,
          roughness: 0.25,
          metalness: 0.65
        })
      )
      pin.position.set(lm.x, lm.y + 4.5, lm.z)
      pin.userData.landmarkObj = lm
      entityGroup.add(pin)
    })
  }

  // 2. 在岗网格员已由独立实时巡防批处理系统 (staffLiveGroup) 接管

  // 3. 共享辅助站（翠绿方柱标）
  if (showAid) {
    cockpitEntitiesRef.aidStations.forEach((aid) => {
      const inEmg = emgAidIds.has(aid.id)
      if (!inEmg && selComm !== '全街道' && aid.community !== selComm) return
      if (!cockpitLayers.value.aid && !inEmg) return
      const isSel = props.selectedEntityId === aid.id
      const h = isSel || inEmg ? 14 : 9.5
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(isSel || inEmg ? 2.6 : 1.9, h, isSel || inEmg ? 2.6 : 1.9),
        new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: isSel || inEmg ? 0.92 : 0.74 })
      )
      box.position.set(aid.x, h / 2 + 0.4, aid.z)
      box.userData.entityObj = aid
      entityGroup.add(box)
    })
  }

  // 4. 易涝积水 / 林缘防火点（天蓝/暖橙立体锥）
  if (showEco) {
    cockpitEntitiesRef.ecoRisks.forEach((pt) => {
      if (selComm !== '全街道' && pt.community !== selComm) return
      const isSel = props.selectedEntityId === pt.id
      const col = pt.kind === 'flood' ? 0x0284c7 : 0xea580c
      const h = isSel ? 18 : 13
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(isSel ? 2.4 : 1.8, h, 4),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: isSel ? 0.94 : 0.80 })
      )
      cone.position.set(pt.x, h / 2 + 0.5, pt.z)
      cone.userData.entityObj = pt
      entityGroup.add(cone)
    })
  }
}

/** 绘制 300 米三维空间应急联动圈与贴地协同引导弧线 */
function rebuildEmergencyRing() {
  if (!scene || props.mode !== 'cockpit') return
  if (emergencyGroup) {
    disposeGroup(emergencyGroup)
    scene.remove(emergencyGroup)
    emergencyGroup = null
  }
  const info = props.emergencyInfo
  if (!info?.center) return

  emergencyGroup = new THREE.Group()
  const { x: cx, z: cz } = info.center
  const R = info.radiusUnits || 30 // 300 米

  // 贴地克制半透明警戒圆盘
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(R, 64),
    new THREE.MeshBasicMaterial({
      color: 0xdc2626,
      transparent: true,
      opacity: isNightScene.value ? 0.14 : 0.08,
      depthWrite: false
    })
  )
  disc.rotation.x = -Math.PI / 2
  disc.position.set(cx, 0.22, cz)
  emergencyGroup.add(disc)

  // 外圈锐利边界环 + 150 米内圈虚辅环
  const outerRing = new THREE.Mesh(
    new THREE.RingGeometry(R - 0.65, R + 0.35, 72),
    new THREE.MeshBasicMaterial({ color: 0xdc2626, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false })
  )
  outerRing.rotation.x = -Math.PI / 2
  outerRing.position.set(cx, 0.42, cz)
  emergencyGroup.add(outerRing)

  const midRing = new THREE.Mesh(
    new THREE.RingGeometry(R * 0.5 - 0.25, R * 0.5 + 0.25, 64),
    new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false })
  )
  midRing.rotation.x = -Math.PI / 2
  midRing.position.set(cx, 0.36, cz)
  emergencyGroup.add(midRing)

  // 柔和贴地引导弧线：连向最近网格员（青蓝）与最近共享辅助站（翠绿）
  const addLinkArc = (tx, tz, colHex) => {
    const p0 = new THREE.Vector3(cx, 3.2, cz)
    const p2 = new THREE.Vector3(tx, 3.2, tz)
    const dist = p0.distanceTo(p2)
    const p1 = new THREE.Vector3((cx + tx) / 2, Math.min(28, 8 + dist * 0.28), (cz + tz) / 2)
    const curve = new THREE.QuadraticBezierCurve3(p0, p1, p2)
    emergencyGroup.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(curve, 28, 0.42, 6, false),
        new THREE.MeshBasicMaterial({ color: colHex, transparent: true, opacity: 0.82 })
      )
    )
  }

  if (staffLayerVisible.value && info.nearbyStaff?.length) {
    const person = info.nearbyStaff[0]
    addLinkArc(person.x, person.z, 0x0ea5e9)
  }
  ;(info.nearbyAids || []).slice(0, 1).forEach((a) => addLinkArc(a.x, a.z, 0x10b981))
  ;(info.careBuildings || []).slice(0, 3).forEach((cb) => addLinkArc(cb.cx, cb.cz, 0x8b5cf6))

  scene.add(emergencyGroup)
}

async function initStaffLiveVisuals(yieldFn = null) {
  if (!scene || props.mode !== 'cockpit') return
  if (!buildingIndexRef) return
  if (staffLiveGroup) {
    disposeGroup(staffLiveGroup)
    scene.remove(staffLiveGroup)
    staffLiveGroup = null
  }
  staffMarkers?.disposeTexture()
  if (yieldFn) {
    staffLiveEngine = props.getStaffEngineAsync
      ? await props.getStaffEngineAsync(buildingIndexRef, createStaffLiveEngineAsync, yieldFn)
      : await createStaffLiveEngineAsync(store, buildingIndexRef, yieldFn)
    if (isDisposed || !scene) return
    await yieldFn()
    if (isDisposed || !scene) return
  } else {
    staffLiveEngine = props.getStaffEngine?.(buildingIndexRef, createStaffLiveEngine)
      || createStaffLiveEngine(store, buildingIndexRef)
  }
  staffLiveGroup = new THREE.Group()
  staffLiveGroup.visible = false
  scene.add(staffLiveGroup)
  staffMarkers = createStaffMarkers(Math.max(1, staffLiveEngine.list.length), () => {
    staticRenderNeeded = true
    labelsDirty = true
  })
  staffLiveGroup.add(staffMarkers.group)

  const count = TRAIL_LEN
  const positions = new THREE.Float32BufferAttribute(new Float32Array(count * 6), 3)
  positions.setUsage(THREE.DynamicDrawUsage)
  const alpha = []
  const indices = []
  for (let j = 0; j < count; j++) {
    const fade = (j / (count - 1)) ** 1.3
    alpha.push(fade, fade)
    if (j < count - 1) {
      const v = j * 2
      indices.push(v, v + 2, v + 1, v + 1, v + 2, v + 3)
    }
  }
  staffTrailGeo = new THREE.BufferGeometry()
  staffTrailGeo.setAttribute('position', positions)
  staffTrailGeo.setAttribute('aFade', new THREE.Float32BufferAttribute(alpha, 1))
  staffTrailGeo.setIndex(indices)
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 1 } },
    vertexShader: `
      attribute float aFade;
      varying float fade;
      void main() {
        fade = aFade;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float fade;
      void main() {
        gl_FragColor = vec4(uColor, fade * 0.65 * uOpacity);
        #include <colorspace_fragment>
      }`
  })
  staffTrailMesh = new THREE.Mesh(staffTrailGeo, material)
  staffTrailMesh.frustumCulled = false
  staffTrailMesh.renderOrder = 5
  staffTrailMesh.visible = false
  staffLiveGroup.add(staffTrailMesh)
  emit('staff-roster-ready', staffLiveEngine.getAll())
}

function getStaffToneHex(status, isSel, night) {
  if (status === '滞留提醒') return night ? '#ff5c57' : '#dc2626'
  if (status === '在办处置') return night ? '#60b8ff' : '#2563eb'
  if (isSel) return night ? '#7ff7e8' : '#0b7a70'
  return night ? '#38f2d6' : '#0d9488'
}

function drawStaffTrail(st, tone, opacity) {
  const start = st.trail.length - TRAIL_LEN
  if (start < 0) return
  const positions = staffTrailGeo.attributes.position
  for (let j = 0; j < TRAIL_LEN; j++) {
    const [x, z] = st.trail[start + j]
    const prev = st.trail[Math.max(start, start + j - 1)]
    const next = st.trail[Math.min(st.trail.length - 1, start + j + 1)]
    const dx = next[0] - prev[0]
    const dz = next[1] - prev[1]
    const length = Math.hypot(dx, dz) || 1
    const halfWidth = 0.055 + 0.13 * j / (TRAIL_LEN - 1)
    const nx = -dz / length * halfWidth
    const nz = dx / length * halfWidth
    positions.setXYZ(j * 2, x + nx, STAFF_GROUND_Y, z + nz)
    positions.setXYZ(j * 2 + 1, x - nx, STAFF_GROUND_Y, z - nz)
  }
  positions.needsUpdate = true
  staffTrailMesh.material.uniforms.uColor.value.set(tone)
  staffTrailMesh.material.uniforms.uOpacity.value = opacity
  staffTrailMesh.visible = true
}

function syncStaffLiveFrame(dt, cameraMoving = false) {
  if (!staffLiveEngine || !staffMarkers || !camera || props.mode !== 'cockpit') return
  if (!prefersReducedMotion && dt > 0) staffLiveEngine.step(dt)
  const layerOn = staffLayerVisible.value
  if (!layerOn && !staffLiveGroup.visible) return
  const scoped = props.selectedCommunity
  const focusedId = props.followStaffId || props.selectedEntityId
  const viewDistance = camera.position.distanceTo(controls.target)
  const opacity = layerOn ? staffPointOpacity(viewDistance, scoped !== '全街道') : 0
  const nearby = layerOn ? props.emergencyInfo?.nearbyStaff : null
  if (!staffLiveGroup.visible && opacity <= 0.006 && !nearby?.length &&
    !(layerOn && focusedId && staffLiveEngine.getRawById(focusedId))) return
  const night = isNightScene.value
  const trailOpacity = 1 - staffOverviewWeight(viewDistance)
  const streetRadius = Math.max(20, viewDistance * 0.8)
  staffMarkers.begin(camera, hostWidth, hostHeight, night, prefersReducedMotion, {
    viewDistance, statusFocus: props.staffStatusFocus, obstacles: props.labelsVisible ? staffLabelObstacles : [], dt, cameraMoving
  })
  staffTrailMesh.visible = false
  for (const st of layerOn ? staffLiveEngine.list : []) {
    const following = st.id === props.followStaffId
    const selected = st.id === focusedId
    if (props.followStaffId && !following) continue
    const emergency = nearby?.some(person => person.id === st.id)
    if (!selected && !emergency && scoped !== '全街道' && st.community !== scoped) continue
    if (!selected && !emergency && (opacity <= 0.006 || (props.staffStatusFocus !== 'all' && st.status !== props.staffStatusFocus))) continue
    // 低角度看街道时，视锥会一直延伸到天际；远处几个社区的人不应浮在眼前的楼面上。
    const localOpacity = selected || emergency ? 1 : opacity * (1 - THREE.MathUtils.smoothstep(
      Math.hypot(st.x - controls.target.x, st.z - controls.target.z), streetRadius, streetRadius * 1.55))
    if (localOpacity <= 0.006) continue
    const tone = getStaffToneHex(st.status, selected, night)
    if (!staffMarkers.place(st, selected, following, tone, localOpacity)) continue
    if (selected && !streetFollowing.value && trailOpacity > 0 && st.speedKmh > 0) drawStaffTrail(st, tone, trailOpacity)
  }
  staffMarkers.finish()
  staffLiveGroup.visible = staffMarkers.group.children.some(child => child.visible)
}

function toggleCockpitLayer(key) {
  if (key === 'staff') {
    const next = !staffLayerVisible.value
    if (!next && props.followStaffId) emit('stop-follow')
    cockpitLayers.value.staff = next
    emit('update:staffLayerActive', next)
    return
  }
  cockpitLayers.value[key] = !cockpitLayers.value[key]
  if (!loading.value && props.mode === 'cockpit') {
    rebuildCockpitEntities()
    updateProjectedLabels()
  }
}

function updateZoneStyles() {
  const pal = SLICE_PALETTES[props.slice] || SLICE_PALETTES.safety
  const sel =
    props.mode === 'single' && props.singleEvent
      ? props.singleEvent.community
      : props.mode === 'patrol' && props.patrolRecord
        ? props.patrolRecord.community
        : props.selectedCommunity
  const hov = activeHover.value
  const night = isNightScene.value

  zoneEntries.forEach((entry, name) => {
    const lvl = getCommunityLevel(entry.community, props.slice)
    const col = getCachedThreeColor(pal.colors[lvl])
    const isSel = sel === name
    const isHov = hov === name

    entry.borderMat.color.copy(col)
    entry.borderMat.opacity = isSel ? 0.95 : isHov ? 0.90 : (sel === '全街道' ? 0.62 : 0.22)

    // 仅使用贴地柔和光晕面 + 贴地加粗高亮边框，干净克制绝不穿楼
    entry.fillMesh.visible = isSel || isHov
    entry.selTubeMesh.visible = isSel || isHov
    if (isSel) {
      entry.fillMat.color.copy(col)
      entry.fillMat.opacity = night ? 0.16 : 0.11
      entry.selTubeMat.color.copy(col)
      entry.selTubeMat.opacity = 0.96
    } else if (isHov) {
      entry.fillMat.color.copy(col)
      entry.fillMat.opacity = night ? 0.10 : 0.07
      entry.selTubeMat.color.copy(col)
      entry.selTubeMat.opacity = 0.75
    }
  })
  staticRenderNeeded = true
}

const tmpProj = new THREE.Vector3()
const _projResult = { inFront: false, x: 0, y: 0, z: 0 }
function projectXZ(x, y, z, w, h) {
  tmpProj.set(x, y, z)
  tmpProj.project(camera)
  _projResult.inFront = tmpProj.z > -1 && tmpProj.z < 1
  _projResult.x = (tmpProj.x * 0.5 + 0.5) * w
  _projResult.y = (-tmpProj.y * 0.5 + 0.5) * h
  _projResult.z = tmpProj.z
  return _projResult
}

function updateProjectedLabels() {
  if (!camera || !canvasHost.value || props.mode === 'login') return
  const w = hostWidth || canvasHost.value.clientWidth
  const h = hostHeight || canvasHost.value.clientHeight
  if (!w || !h) return
  labelsDirty = false
  if (streetFollowing.value) return

  const isCockpit = props.mode === 'cockpit'
  const compactDesk = typeof window !== 'undefined' && window.innerWidth <= 1520
  const narrowMap = isCockpit && window.innerWidth <= 1100
  const isTheater = isCockpit && !narrowMap && props.theaterMode
  const safeLeft = narrowMap ? 38 : isTheater ? 24 : isCockpit ? (compactDesk ? 316 : 338) : 24
  const safeRight = narrowMap ? w - 38 : isTheater ? w - 24 : isCockpit ? (w - (compactDesk ? 338 : 364)) : (w - 24)
  const safeTop = narrowMap ? 58 : isTheater ? 42 : isCockpit ? (compactDesk ? 168 : 176) : (props.compact && props.mode !== 'single' && props.mode !== 'patrol' ? 48 : 28)
  const safeBottom = narrowMap ? h - 210 : isTheater ? (h - 76) : isCockpit ? (h - 86) : (h - 36)

  // 模式 A：单点事件精准定位浮标
  if (props.mode === 'single') {
    projectedLabels.value = []
    projectedPatrolLabels.value = []
    projectedArmedLabels.value = []
    hqScreenPos.value = { x: 0, y: 0, visible: false }
    if (props.singleEvent) {
      const ev = props.singleEvent
      const [ex, ez] = latLngToWorldXZ(ev.lat, ev.lng)
      const pr = projectXZ(ex, 32, ez, w, h)
      const isDone = ev.stage === '已办结'
      const isUrgent = ev.stage === '待受理' || ev.stage === '待补充'
      projectedSingleLabel.value = {
        x: Math.round(pr.x),
        y: Math.round(pr.y),
        visible: pr.inFront && pr.x >= 20 && pr.x <= w - 20 && pr.y >= 24 && pr.y <= h - 14,
        title: ev.community + ' · ' + ev.grid,
        stage: ev.stage,
        tone: isDone ? 'ok' : isUrgent ? 'bad' : 'warn'
      }
    } else {
      projectedSingleLabel.value = null
    }
    return
  }
  projectedSingleLabel.value = null

  // 模式 B：巡查轨迹节点浮标（带智能屏幕防碰撞偏移）
  if (props.mode === 'patrol') {
    projectedLabels.value = []
    projectedArmedLabels.value = []
    hqScreenPos.value = { x: 0, y: 0, visible: false }
    const rec = props.patrolRecord
    if (!rec?.track?.length) {
      projectedPatrolLabels.value = []
      return
    }
    const stepClamped = Math.min(Math.max(0, props.patrolStepIdx), rec.track.length - 1)
    const rawItems = rec.track.map((pt, idx) => {
      const [px, pz] = latLngToWorldXZ(pt.lat, pt.lng)
      const isAnom = !!(pt.isStayAnomaly && rec.stayMinutes > props.patrolThreshold)
      const isCur = idx === stepClamped
      const reached = idx <= stepClamped
      const hPin = isAnom ? 25 : isCur ? 21 : 14
      const pr = projectXZ(px, hPin, pz, w, h)
      const expanded = isAnom || isCur || hoveredPatrolIdx.value === idx
      return {
        idx,
        order: idx + 1,
        time: pt.time,
        note: pt.note,
        label: isAnom ? `滞留 ${rec.stayMinutes}分` : `${pt.time} ${pt.eventTag || '必到点'}`,
        isAnom,
        isCur,
        reached,
        expanded,
        ax: pr.x,
        ay: pr.y,
        x: pr.x,
        y: pr.y,
        zIndex: isAnom ? 46 : isCur ? 44 : hoveredPatrolIdx.value === idx ? 48 : 26 + idx,
        visible: pr.inFront && pr.x >= 18 && pr.x <= w - 18 && pr.y >= 22 && pr.y <= h - 22
      }
    })
    // 屏幕空间两两防重叠错位（展开胶囊优先保位，碰撞时轻柔上下/左右错开）
    const placed = []
    const sorted = [...rawItems].sort((a, b) => b.zIndex - a.zIndex)
    sorted.forEach((item) => {
      if (!item.visible) return
      const bw = item.expanded ? 116 : 28
      const bh = item.expanded ? 28 : 28
      let dx = 0
      let dy = 0
      const candidates = [
        [0, 0], [0, -32], [0, 30], [72, -16], [-72, -16], [0, -62], [86, 18], [-86, 18]
      ]
      for (const [cx, cy] of candidates) {
        const tx = Math.min(Math.max(bw / 2 + 8, item.ax + cx), w - bw / 2 - 8)
        const ty = Math.min(Math.max(bh + 8, item.ay + cy), h - 18)
        const hit = placed.some(
          (p) => Math.abs(tx - p.x) < (bw + p.bw) * 0.48 && Math.abs(ty - p.y) < (bh + p.bh) * 0.56
        )
        if (!hit) {
          dx = tx - item.ax
          dy = ty - item.ay
          break
        }
      }
      item.x = Math.round(item.ax + dx)
      item.y = Math.round(item.ay + dy)
      placed.push({ x: item.x, y: item.y, bw, bh })
    })
    projectedPatrolLabels.value = rawItems
    return
  }
  projectedPatrolLabels.value = []

  // 模式 C：数字武装五专题 3D 浮标
  if (props.mode === 'armed') {
    projectedLabels.value = []
    hqScreenPos.value = { x: 0, y: 0, visible: false }
    const items = []
    if (props.armedTopic === 'education' && props.armedPlaces.length) {
      props.armedPlaces.forEach((pl) => {
        const [px, pz] = latLngToWorldXZ(pl.coord[0], pl.coord[1])
        const hPin = 18 + Math.min(20, (pl.count || 6) * 1.4)
        const pr = projectXZ(px, hPin, pz, w, h)
        items.push({
          key: pl.id || pl.name,
          text: `阵地 · ${pl.community.replace('社区', '')}`,
          chip: `${pl.count}场`,
          tone: 'edu',
          isSel: props.selectedCommunity === pl.community,
          payload: pl,
          commName: pl.community,
          x: Math.round(pr.x),
          y: Math.round(pr.y),
          zIndex: props.selectedCommunity === pl.community ? 44 : 28,
          visible: pr.inFront && pr.x >= safeLeft && pr.x <= safeRight && pr.y >= safeTop && pr.y <= safeBottom
        })
      })
    } else {
      COMMUNITIES.forEach((c) => {
        const offset = CHANGHE_LABEL_OFFSETS[c.name] || [0, 0]
        const [cx, cz] = latLngToWorldXZ(c.center[0] + offset[0], c.center[1] + offset[1])
        const isSel = props.selectedCommunity === c.name
        const shortName = c.name.replace('社区', '')
        let text = `★ ${shortName}`
        let chip = ''
        let tone = 'party'
        let hPin = 18
        if (props.armedTopic === 'militia') {
          text = `⚑ ${shortName}连`
          chip = `${c.armed.militia}人`
          tone = 'militia'
          hPin = 14 + (c.armed.militia / 32) * 20
        } else if (props.armedTopic === 'recruit') {
          text = shortName
          chip = `登记${c.armed.recruitReg}`
          tone = c.armed.recruitReg >= 75 ? 'recruit-ok' : c.armed.recruitReg >= 60 ? 'recruit-mid' : 'recruit-warn'
          hPin = 12 + (c.armed.recruitReg / 95) * 24
        } else if (props.armedTopic === 'mobilize') {
          const showRally = props.mobilizeLayer === 'both' || props.mobilizeLayer === 'rally'
          const showVet = props.mobilizeLayer === 'both' || props.mobilizeLayer === 'veteran'
          text = showRally && showVet ? shortName : showRally ? `收拢·${shortName}` : shortName
          chip = showRally && showVet ? `优抚${c.armed.veterans}` : showRally ? '集结点' : `退役${c.armed.veterans}`
          tone = showRally && !showVet ? 'mobilize-rally' : 'mobilize'
          hPin = 16 + (c.armed.veterans / 132) * 16
        }
        const pr = projectXZ(cx, hPin, cz, w, h)
        items.push({
          key: c.id,
          text,
          chip,
          tone,
          isSel,
          payload: c,
          commName: c.name,
          x: Math.round(pr.x),
          y: Math.round(pr.y),
          zIndex: isSel ? 44 : Math.round((1 - pr.z) * 20) + 12,
          visible: pr.inFront && pr.x >= safeLeft && pr.x <= safeRight && pr.y >= safeTop && pr.y <= safeBottom
        })
      })
    }
    projectedArmedLabels.value = items
    return
  }
  projectedArmedLabels.value = []

  // 先投影指挥中心红牌并注册占位盒，保证社区铭牌与实体标签均与指挥中心保持干净避让
  const hprNow = projectXZ(hqIntroX, 18.5, hqIntroZ, w, h)
  const nextHqPos = {
    x: Math.round(hprNow.x),
    y: Math.round(hprNow.y),
    visible: hprNow.inFront && hprNow.x >= safeLeft && hprNow.x <= safeRight && hprNow.y >= safeTop && hprNow.y <= safeBottom
  }
  hqScreenPos.value = nextHqPos

  // 左下角图例卡与右下角控制栏屏幕禁入矩形（防止边缘小区/社区铭牌与浮层卡片重叠裁切）
  const hudBoxes = []
  if (isCockpit && !narrowMap) {
    if (isTheater) {
      hudBoxes.push({ x: 120, y: h - 74, bw: 224, bh: 120 })
      hudBoxes.push({ x: w - 256, y: h - 72, bw: 480, bh: 56 })
      hudBoxes.push({ x: w * 0.5, y: h - 38, bw: Math.min(760, w * 0.62), bh: 52 })
    } else {
      const lgLeft = compactDesk ? 308 : 332
      const lgRight = lgLeft + (compactDesk ? 246 : 250)
      hudBoxes.push({ x: (lgLeft + lgRight) / 2, y: h - 140, bw: lgRight - lgLeft + 14, bh: 126 })
      const ctrlRight = w - (compactDesk ? 328 : 356)
      const ctrlLeft = Math.max(lgRight + 18, ctrlRight - (compactDesk ? 410 : 480))
      hudBoxes.push({ x: (ctrlLeft + ctrlRight) / 2, y: h - 134, bw: ctrlRight - ctrlLeft + 12, bh: 58 })
    }
  }

  const hitsBox = (cx, cy, bw, bh, list) =>
    list.some((p) => Math.abs(cx - p.x) < (bw + p.bw) * 0.5 + 6 && Math.abs(cy - p.y) < (bh + p.bh) * 0.5 + 5)

  const placed = []
  if (nextHqPos.visible) {
    // translate(-50%, -100%) 锚定在底边中点，盒中心位于 y - 15
    placed.push({ x: nextHqPos.x, y: nextHqPos.y - 15, bw: 194, bh: 30 })
  }

  const distance = controls ? camera.position.distanceTo(controls.target) : 0
  const scoped = props.selectedCommunity !== '全街道'
  const cityOverview = isCockpit && !scoped && !props.tourRunning
  const overviewWeight = cityOverview ? staffOverviewWeight(distance) : 0
  const summaryOpacity = isCockpit && staffLayerVisible.value && props.staffCommunityCounts
    ? 1 - staffPointOpacity(distance, scoped) : 0
  const next = []
  zoneEntries.forEach((entry, name) => {
    const c = entry.community
    const pr = projectXZ(entry.centerXZ[0], 11, entry.centerXZ[1], w, h)
    const visible = pr.inFront && pr.x >= safeLeft && pr.x <= safeRight && pr.y >= safeTop && pr.y <= safeBottom

    const isSel = props.selectedCommunity === name
    const isHov = activeHover.value === name
    const openHz = c.safety.hazards - c.safety.fixed
    const sName = name.replace('社区', '')
    const chip = getCommunityMetricChip(c, props.slice)
    const count = summaryOpacity > 0.01 ? props.staffCommunityCounts[name] || 0 : 0
    const quiet = count > 0 || (overviewWeight > 0.5 && !isSel && !isHov)
    const countWidth = count ? String(count).length * 7 + 18 : 0
    const bw = quiet ? sName.length * 12 + 14 + countWidth : Math.round(sName.length * 13.5 + chip.length * 9.5 + 38) * (isSel ? 1.08 : 1)
    const bh = quiet ? 20 : isSel ? 32 : 28

    next.push({
      name,
      shortName: sName,
      quiet,
      chip,
      count,
      countOpacity: summaryOpacity,
      health: c.health,
      level: ['lead', 'ok', 'warn', 'bad'][getCommunityLevel(c, 'safety')],
      hasAlert: props.slice === 'safety' && openHz > 0,
      isSel,
      isHov,
      ax: pr.x,
      ay: pr.y,
      x: Math.round(pr.x),
      y: Math.round(pr.y),
      bw,
      bh,
      zIndex: isSel ? 42 : isHov ? 34 : Math.round((1 - pr.z) * 20),
      visible: visible && (!isCockpit || camera.position.y > 135 || count > 0 || isSel)
    })
  })

  // 14 社区铭牌按优先级微调错位，彻底杜绝被指挥中心红牌、底部控件或相邻社区压盖
  const commCandidates = [[0, 0], [0, -30], [0, 30], [54, -18], [-54, -18], [72, 18], [-72, 18], [0, -56]]
  ;[...next]
    .sort((a, b) => b.zIndex - a.zIndex)
    .forEach((lb) => {
      if (!lb.visible) return
      for (const [dx, dy] of commCandidates) {
        const tx = Math.min(Math.max(safeLeft + lb.bw * 0.4, lb.ax + dx), safeRight - lb.bw * 0.4)
        const ty = Math.min(Math.max(safeTop + lb.bh, lb.ay + dy), safeBottom)
        const cy = ty - lb.bh * 0.5
        if (!hitsBox(tx, cy, lb.bw, lb.bh, placed) && !hitsBox(tx, cy, lb.bw, lb.bh, hudBoxes)) {
          lb.x = Math.round(tx)
          lb.y = Math.round(ty)
          break
        }
      }
      placed.push({ x: lb.x, y: lb.y - lb.bh * 0.5, bw: lb.bw, bh: lb.bh })
    })
  projectedLabels.value = next

  // 驾驶舱治理实体与小区投影标签（真实像素宽度防碰撞 + 避开左下角图例卡）
  if (isCockpit && camera) {
    const camY = camera.position.y
    const eLabels = []
    const emgStaffIds = new Set((props.emergencyInfo?.nearbyStaff || []).map((s) => s.id))
    const emgAidIds = new Set((props.emergencyInfo?.nearbyAids || []).map((a) => a.id))
    const selComm = props.selectedCommunity
    const buildingLabelOpacity = focusedOnPersonnel.value ? 0 : 1 - overviewWeight

    if (cockpitLayers.value.landmarks) {
      cockpitEntitiesRef.landmarks.forEach((lm) => {
        if (selComm !== '全街道' && lm.community !== selComm) return
        const featured = props.selectedBuildingIndex === lm.buildingIndex || hoveredBldgIndex === lm.buildingIndex
        if (!featured && buildingLabelOpacity <= 0.01) return
        const pr = projectXZ(lm.x, lm.y + 8, lm.z, w, h)
        if (!pr.inFront || pr.x < safeLeft || pr.x > safeRight || pr.y < safeTop || pr.y > safeBottom) return
        eLabels.push({
          key: lm.id,
          kind: 'landmark',
          opacity: featured ? 1 : buildingLabelOpacity,
          text: lm.shortLabel,
          isSel: props.selectedBuildingIndex === lm.buildingIndex,
          payload: lm,
          ax: pr.x,
          ay: pr.y,
          x: Math.round(pr.x),
          y: Math.round(pr.y),
          bw: String(lm.shortLabel || '').length * 11.5 + 28,
          bh: 26,
          canNudge: true,
          zIndex: props.selectedBuildingIndex === lm.buildingIndex ? 46 : 33
        })
      })

      // 投影全街道真实小区次级铭牌（使用独立 estate 弱化样式，拉近镜头或聚焦社区时展开）
      const maxEstates = selComm !== '全街道' ? 48 : camY <= 145 ? 48 : camY <= 215 ? 24 : 10
      ;(cockpitEntitiesRef.estates || []).slice(0, maxEstates).forEach((est) => {
        if (selComm !== '全街道' && est.community !== selComm) return
        const featured = props.selectedBuildingIndex === est.buildingIndex || hoveredBldgIndex === est.buildingIndex
        if (!featured && buildingLabelOpacity <= 0.01) return
        const pr = projectXZ(est.x, est.y, est.z, w, h)
        if (!pr.inFront || pr.x < safeLeft || pr.x > safeRight || pr.y < safeTop || pr.y > safeBottom) return
        const isSel = props.selectedBuildingIndex === est.buildingIndex
        eLabels.push({
          key: est.id,
          kind: 'estate',
          opacity: featured ? 1 : buildingLabelOpacity,
          text: est.name,
          isSel,
          payload: est,
          ax: pr.x,
          ay: pr.y,
          x: Math.round(pr.x),
          y: Math.round(pr.y),
          bw: String(est.name || '').length * 10.5 + 24,
          bh: 23,
          canNudge: true,
          zIndex: isSel ? 45 : 25
        })
      })
    }

    if (staffLiveGroup?.visible && staffMarkers) {
      for (const st of staffLiveEngine.list) {
        const location = staffMarkers.locations[st.idx]
        if (!location.visible || location.opacity < 0.35) continue
        const selected = st.id === (props.followStaffId || props.selectedEntityId)
        const hovered = st.id === hoveredStaffId
        const nearby = emgStaffIds.has(st.id)
        const alert = st.status === '滞留提醒'
        if (!selected && !hovered && !nearby) continue
        const x = location.headX
        const y = location.top - 5
        if (x < safeLeft || x > safeRight || y < safeTop || y > safeBottom) continue
        const distance = nearby ? props.emergencyInfo.nearbyStaff.find(person => person.id === st.id)?.distMeters : null
        const detail = nearby && distance != null && !selected ? `${distance}米` : alert ? `滞留${st.stayMinutes}分` : st.status
        const text = `${st.name} · ${detail}`
        eLabels.push({
          key: st.id,
          kind: alert ? 'staff-alert' : st.status === '在办处置' ? 'staff-busy' : 'staff',
          text,
          isSel: selected || hovered || nearby,
          payload: st,
          ax: x, ay: y, x, y,
          bw: text.length * 11.2 + 20,
          bh: 23,
          canNudge: !selected && !hovered,
          zIndex: selected ? 50 : hovered ? 49 : nearby ? 45 : 38
        })
      }
    }

    const showAidLbl = cockpitLayers.value.aid || Boolean(props.emergencyInfo)
    if (showAidLbl) {
      cockpitEntitiesRef.aidStations.forEach((aid) => {
        const inEmg = emgAidIds.has(aid.id)
        const isSel = props.selectedEntityId === aid.id
        if (!inEmg && !isSel && !cockpitLayers.value.aid && camY > 240) return
        if (!inEmg && selComm !== '全街道' && aid.community !== selComm) return
        const pr = projectXZ(aid.x, 15, aid.z, w, h)
        if (!pr.inFront || pr.x < safeLeft || pr.x > safeRight || pr.y < safeTop || pr.y > safeBottom) return
        eLabels.push({
          key: aid.id,
          kind: 'aid',
          text: aid.shortLabel,
          isSel: isSel || inEmg,
          payload: aid,
          ax: pr.x,
          ay: pr.y,
          x: Math.round(pr.x),
          y: Math.round(pr.y),
          bw: String(aid.shortLabel || '').length * 11.5 + 28,
          bh: 26,
          canNudge: true,
          zIndex: isSel || inEmg ? 46 : 27
        })
      })
    }

    if (cockpitLayers.value.eco) {
      cockpitEntitiesRef.ecoRisks.forEach((pt) => {
        if (selComm !== '全街道' && pt.community !== selComm) return
        const isSel = props.selectedEntityId === pt.id
        const pr = projectXZ(pt.x, 18, pt.z, w, h)
        if (!pr.inFront || pr.x < safeLeft || pr.x > safeRight || pr.y < safeTop || pr.y > safeBottom) return
        eLabels.push({
          key: pt.id,
          kind: pt.kind === 'flood' ? 'flood' : 'fire',
          text: pt.shortLabel,
          isSel,
          payload: pt,
          ax: pr.x,
          ay: pr.y,
          x: Math.round(pr.x),
          y: Math.round(pr.y),
          bw: String(pt.shortLabel || '').length * 11.5 + 28,
          bh: 26,
          canNudge: true,
          zIndex: isSel ? 47 : 30
        })
      })
    }

    const entCandidates = [[0, 0], [0, -34], [0, 34], [82, -20], [-82, -20], [82, 20], [-82, 20], [0, -64], [0, 64]]
    const kept = []
    const staffObstacles = placed.concat(hudBoxes)
    eLabels
      .sort((a, b) => b.zIndex - a.zIndex)
      .forEach((item) => {
        const tries = item.canNudge ? entCandidates : [[0, 0]]
        let accepted = false
        for (const [dx, dy] of tries) {
          const tx = item.ax + dx
          const ty = item.ay + dy
          if (tx - item.bw * 0.5 < safeLeft || tx + item.bw * 0.5 > safeRight || ty - item.bh < safeTop || ty > safeBottom) {
            continue
          }
          const cy = ty - item.bh * 0.5
          if (!item.isSel && hitsBox(tx, cy, item.bw, item.bh, hudBoxes)) continue
          if (!hitsBox(tx, cy, item.bw, item.bh, placed) || item.isSel) {
            item.x = Math.round(tx)
            item.y = Math.round(ty)
            const box = { x: item.x, y: item.y - item.bh * 0.5, bw: item.bw, bh: item.bh }
            placed.push(box)
            if (!item.kind.startsWith('staff') && (item.opacity ?? 1) > 0.25) staffObstacles.push(box)
            kept.push(item)
            accepted = true
            break
          }
        }
        void accepted
      })
    projectedEntityLabels.value = kept
    staffLabelObstacles = staffObstacles.map(({ x, y, bw, bh }) => ({
      left: x - bw / 2, right: x + bw / 2, top: y - bh / 2, bottom: y + bh / 2
    }))

    // 投影当前单层聚焦小铭牌（如「4层 · 隐患」）
    if (
      props.selectedBuildingIndex >= 0 &&
      props.focusedFloor?.floor &&
      buildingIndexRef?.buildings?.[props.selectedBuildingIndex]
    ) {
      const fb = buildingIndexRef.buildings[props.selectedBuildingIndex]
      const tot = Math.max(1, Number(props.focusedFloor.totalFloors) || 6)
      const fl = Math.max(1, Math.min(tot, Number(props.focusedFloor.floor) || 1))
      const fy = Math.max(0.42, Math.min(fb.height - 0.18, ((fl - 0.5) / tot) * fb.height))
      const pr = projectXZ(fb.maxX + 1.2, fy, fb.cz, w, h)
      if (pr.inFront && pr.x >= safeLeft && pr.x <= safeRight && pr.y >= safeTop && pr.y <= safeBottom) {
        projectedFloorTag.value = {
          x: Math.round(pr.x),
          y: Math.round(pr.y),
          tone: props.focusedFloor.tone || 'normal',
          text: props.focusedFloor.label ? `${fl}层 · ${props.focusedFloor.label}` : `${fl}层`
        }
      } else {
        projectedFloorTag.value = null
      }
    } else {
      projectedFloorTag.value = null
    }
    return
  } else {
    projectedEntityLabels.value = []
    projectedFloorTag.value = null
  }
}

function setCanvasCursor(cur) {
  if (!renderer || lastCursor === cur) return
  lastCursor = cur
  renderer.domElement.style.cursor = cur
}

function getCanvasRect() {
  if (!cachedCanvasRect && renderer?.domElement) {
    cachedCanvasRect = renderer.domElement.getBoundingClientRect()
  }
  return cachedCanvasRect
}

function pickTarget(clientX, clientY) {
  if (!renderer || !camera || comparingImagery.value || props.mode === 'login') return null
  const rect = getCanvasRect()
  if (!rect || !rect.width || !rect.height) return null
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)

  if (props.mode === 'cockpit' && staffLiveGroup?.visible) {
    const person = staffMarkers.pick(clientX - rect.left, clientY - rect.top)
    if (person) return { type: 'entity', entity: staffLiveEngine.getById(person.id) }
  }

  if (entityGroup && props.mode === 'cockpit') {
    const entHits = raycaster.intersectObjects(entityGroup.children, false)
    const lmHit = entHits.find((h) => h.object.userData.landmarkObj)
    if (lmHit) return { type: 'landmark', landmark: lmHit.object.userData.landmarkObj }
    const entHit = entHits.find((h) => h.object.userData.entityObj)
    if (entHit) return { type: 'entity', entity: entHit.object.userData.entityObj }
  }

  if (dynamicGroup?.visible && pickableDynamicTargets.length) {
    const dynHits = raycaster.intersectObjects(pickableDynamicTargets, false)
    const armedHit = dynHits.find((h) => h.object.userData.armedPoint)
    if (armedHit) return { type: 'armed', point: armedHit.object.userData.armedPoint }
    const evHit = dynHits.find((h) => h.object.userData.eventObj)
    if (evHit) return { type: 'event', event: evHit.object.userData.eventObj }
  }

  if (groundMesh && props.mode !== 'single' && props.mode !== 'patrol') {
    const gHits = raycaster.intersectObject(groundMesh, false)
    if (gHits.length) {
      const pt = gHits[0].point
      if (props.mode === 'cockpit') {
        if (!buildingIndexRef) buildingIndexRef = getCockpitBuildingIndex()
        const b = buildingIndexRef.pickBuildingAtXZ(pt.x, pt.z)
        if (b && b.isInner) {
          return { type: 'building', building: b }
        }
      }
      for (const [name, entry] of zoneEntries.entries()) {
        if (pointInPolyXZ(pt.x, pt.z, entry.polyXZ)) {
          return { type: 'community', name }
        }
      }
    }
  }
  return null
}

function onPointerDown(e) {
  pointerDownPos = { x: e.clientX, y: e.clientY }
  isCamAnimating = false
  staffGlide = null
  staffWheelZoom = null
  if (introCamAnim || introWaveAnim) finishIntroVisualsImmediately()
}

// 滚轮和触控板围绕指针下的地面位置缩放；反向滚动从当前画面立即折返。
function onStaffWheel(e) {
  if (props.mode !== 'cockpit' || !staffLayerVisible.value || !controls?.enableZoom || comparingImagery.value || e.buttons || !e.deltaY) return
  e.preventDefault()
  e.stopImmediatePropagation()
  if (!staffWheelZoom) controls.dispatchEvent({ type: 'start' })
  const rect = getCanvasRect()
  const x = e.clientX - rect.left, y = e.clientY - rect.top
  const person = staffLiveGroup?.visible && staffMarkers.pick(x, y)
  if (person) staffWheelAnchor.set(person.x, STAFF_GROUND_Y, person.z)
  else {
    pointer.set(x / rect.width * 2 - 1, 1 - y / rect.height * 2)
    raycaster.setFromCamera(pointer, camera)
    if (!raycaster.ray.intersectPlane(staffGroundPlane, staffWheelAnchor) ||
        staffWheelAnchor.distanceTo(controls.target) > camera.position.distanceTo(controls.target)) {
      staffWheelAnchor.copy(controls.target)
    }
  }
  const radius = camera.position.distanceTo(controls.target)
  const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1) * (e.ctrlKey ? 10 : 1)
  const direction = Math.sign(delta)
  const from = staffWheelZoom?.direction === direction ? staffWheelZoom.radius : radius
  const next = from * Math.exp(THREE.MathUtils.clamp(delta * controls.zoomSpeed * 0.000513, -3, 3))
  staffWheelZoom = { radius: THREE.MathUtils.clamp(next, controls.minDistance, controls.maxDistance), direction }
  staticRenderNeeded = true
}

function advanceWheelZoom(dt) {
  const current = camera.position.distanceTo(controls.target)
  const remaining = Math.log(staffWheelZoom.radius / current)
  const done = prefersReducedMotion || Math.abs(remaining) < 0.001
  const step = done ? remaining : THREE.MathUtils.clamp(remaining * (1 - Math.exp(-12 * dt)), -0.10, 0.10)
  const factor = Math.exp(step)
  camera.position.sub(staffWheelAnchor).multiplyScalar(factor).add(staffWheelAnchor)
  controls.target.sub(staffWheelAnchor).multiplyScalar(factor).add(staffWheelAnchor)
  if (done) staffWheelZoom = null
}

function clearHoveredBuilding() {
  hoveredBldgMetaCache = null
  if (hoveredBldgIndex !== -1) {
    hoveredBldgIndex = -1
    hoveredBuilding.value = null
    if (props.mode === 'cockpit' && !loading.value) {
      applyHoverSemanticDelta(-1)
    }
  }
}

function processPointerHover(clientX, clientY) {
  if (isDisposed || !renderer || isCamAnimating || staffGlide || introCamAnim) return
  const hit = pickTarget(clientX, clientY)
  const staffId = hit?.entity?.entityType === 'staff' ? hit.entity.id : ''
  if (hoveredStaffId !== staffId) {
    hoveredStaffId = staffId
    labelsDirty = true
    staticRenderNeeded = true
  }
  if (hit && hit.type === 'building') {
    const b = hit.building
    const rect = getCanvasRect()
    const rx = rect ? Math.min(rect.width - 220, Math.max(16, clientX - rect.left + 14)) : 0
    const ry = rect ? Math.min(rect.height - 96, Math.max(76, clientY - rect.top - 12)) : 0
    const nextX = Math.round(rx)
    const nextY = Math.round(ry)

    if (hoveredBldgIndex !== b.index || !hoveredBldgMetaCache) {
      const evs = lastEventBldgMap.get(b.index) || []
      const openCnt = evs.filter((ev) => ev.stage !== '已办结').length
      const chip = openCnt > 0
        ? `在办 ${openCnt} 件`
        : b.baseHazard
          ? '关注复核'
          : b.category === 'commercial' && b.revenueYi
            ? `产值 ${b.revenueYi} 亿`
            : b.elderAloneCount > 0
              ? `独居关怀 ${b.elderAloneCount} 户`
              : `${b.floors} 层 · ${b.households} 户`
      hoveredBldgMetaCache = {
        name: b.name,
        estate: b.estate || '',
        community: b.community,
        gridName: b.gridName,
        chip,
        isAlert: openCnt > 0 || b.baseHazard
      }
      if (hoveredBldgIndex !== b.index) {
        hoveredBldgIndex = b.index
        applyHoverSemanticDelta(b.index)
      }
    }

    const prevTip = hoveredBuilding.value
    if (!prevTip || prevTip.name !== hoveredBldgMetaCache.name || prevTip.x !== nextX || prevTip.y !== nextY) {
      hoveredBuilding.value = { ...hoveredBldgMetaCache, x: nextX, y: nextY }
    }
    if (hoveredLocal.value !== b.community) {
      hoveredLocal.value = b.community
      updateZoneStyles()
    }
    setCanvasCursor('pointer')
    return
  }

  clearHoveredBuilding()

  if (hit && hit.type === 'community') {
    if (hoveredLocal.value !== hit.name) {
      hoveredLocal.value = hit.name
      updateZoneStyles()
    }
    setCanvasCursor('pointer')
  } else if (hit && (hit.type === 'event' || hit.type === 'armed' || hit.type === 'entity' || hit.type === 'landmark')) {
    setCanvasCursor('pointer')
  } else {
    if (hoveredLocal.value) {
      hoveredLocal.value = ''
      updateZoneStyles()
    }
    setCanvasCursor('grab')
  }
}

function onPointerMove(e) {
  // 触屏设备与登录展示模式跳过悬停拾取；拖拽旋转镜头或相机动画中跳过拾取，并以 rAF 单帧合并高刷鼠标事件
  if (props.mode === 'login' || e.pointerType === 'touch' || e.buttons !== 0 || isCamAnimating || introCamAnim) return
  pendingPointerClient = { x: e.clientX, y: e.clientY }
  if (pointerMoveRaf === null) {
    pointerMoveRaf = requestAnimationFrame(() => {
      pointerMoveRaf = null
      const pt = pendingPointerClient
      pendingPointerClient = null
      if (pt) processPointerHover(pt.x, pt.y)
    })
  }
}

function onPointerUp(e) {
  if (props.mode === 'login') return
  const dx = e.clientX - pointerDownPos.x
  const dy = e.clientY - pointerDownPos.y
  const tapThresholdSq = e.pointerType === 'touch' ? 100 : 25
  if (dx * dx + dy * dy > tapThresholdSq) return
  const hit = pickTarget(e.clientX, e.clientY)
  if (!hit) return
  if (hit.type === 'landmark') {
    const b = buildingIndexRef?.buildings?.[hit.landmark.buildingIndex]
    if (b) {
      focusOnPointXZ(b.cx, b.cz, 98, 102)
      emit('select-building', b)
    }
  } else if (hit.type === 'entity') {
    if (hit.entity.entityType !== 'staff') focusOnPointXZ(hit.entity.x, hit.entity.z, 108, 112)
    emit('select-entity', hit.entity)
  } else if (hit.type === 'building') {
    focusOnPointXZ(hit.building.cx, hit.building.cz, 98, 102)
    emit('select-building', hit.building)
  } else if (hit.type === 'armed') {
    if (hit.point?.name && props.armedTopic !== 'education') emit('select-community', hit.point.name)
    emit('select-point', hit.point)
  } else if (hit.type === 'event') {
    const [ex, ez] = latLngToWorldXZ(hit.event.lat, hit.event.lng)
    if (props.mode === 'cockpit') focusOnPointXZ(ex, ez, 112, 118)
    emit('select-event', hit.event)
  } else if (hit.type === 'community') {
    emit('select-community', hit.name)
  }
}

function handleEntityLabelClick(item) {
  if (item.kind === 'landmark' || item.kind === 'estate') {
    const b = buildingIndexRef?.buildings?.[item.payload.buildingIndex]
    if (b) {
      focusOnPointXZ(b.cx, b.cz, 98, 102)
      emit('select-building', b)
    }
  } else {
    if (item.payload.entityType !== 'staff') focusOnPointXZ(item.payload.x, item.payload.z, 108, 112)
    emit('select-entity', item.payload)
  }
}

function handleArmedLabelClick(item) {
  if (props.armedTopic !== 'education' && item.commName) {
    emit('select-community', item.commName)
  }
  emit('select-point', item.payload)
}

// 指针离开画布（含移入浮层面板）时清除社区悬停，避免残留高亮
function onCanvasLeave() {
  if (hoveredStaffId) {
    hoveredStaffId = ''
    labelsDirty = true
    staticRenderNeeded = true
  }
  clearHoveredBuilding()
  if (hoveredLocal.value) {
    hoveredLocal.value = ''
    updateZoneStyles()
  }
}

function onLabelHover(name) {
  hoveredLocal.value = name
  updateZoneStyles()
}

function hasCameraMoved() {
  _tmpCamVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  const els = _tmpCamVP.elements
  if (!hasLastCamVP) {
    _lastCamVP.set(els)
    hasLastCamVP = true
    return true
  }
  for (let i = 0; i < 16; i++) {
    if (Math.abs(els[i] - _lastCamVP[i]) > 1e-5) {
      _lastCamVP.set(els)
      return true
    }
  }
  return false
}

let lastTime = 0
let compactRenderer = false
let halfViewportHeight = 1
function animate(now) {
  if (isRenderPaused || isDisposed || !renderer || !scene || !camera) {
    rafId = null
    return
  }
  rafId = requestAnimationFrame(animate)

  // 紧凑屏限 30fps，高刷屏（120Hz/144Hz）常规模式封顶 60fps，避免 2× GPU 负载
  const minFrameMs = compactRenderer ? (1000 / 30 - 1) : 15.2
  if (lastTime && now - lastTime < minFrameMs) return
  const dt = Math.min(0.05, (now - (lastTime || now)) / 1000)
  lastTime = now

  let camDriven = false
  if (props.mode === 'cockpit' && props.followStaffId && staffLiveEngine && controls && !introCamAnim) {
    const fSt = staffLiveEngine.getRawById(props.followStaffId)
    if (fSt) {
      camDriven = true
      cameraFlightAnim = null
      isCamAnimating = false
      if (fSt.speedKmh > 0) {
        let diff = ((fSt.heading - followSmoothedYaw + Math.PI) % (Math.PI * 2)) - Math.PI
        if (diff < -Math.PI) diff += Math.PI * 2
        followSmoothedYaw += diff * Math.min(1, dt * 2.6)
      }
      const bearing = followSmoothedYaw + Math.PI
      if (now >= nextSightlineCheck && (!staffGlide || nextSightlineCheck === 0)) {
        const framing = getStaffFraming(props.followAltitude === 'mid' ? 'mid' : 'low', hostHeight)
        followView = chooseStaffView(buildingIndexRef, fSt, bearing, framing.distance, framing.height, followView.offset)
        nextSightlineCheck = now + 1100
      }
      const chaseYaw = bearing + followView.offset
      _followGoalLook.set(fSt.x, STAFF_AIM_Y, fSt.z)
      _followGoalPos.set(
        fSt.x + Math.sin(chaseYaw) * followView.distance,
        followView.height,
        fSt.z + Math.cos(chaseYaw) * followView.distance
      )
      if (staffGlide?.kind === 'follow') {
        if (staffGlide.advance(now, _followGoalPos, _followGoalLook, camera.position, controls.target)) staffGlide = null
      } else {
        const fLerp = prefersReducedMotion ? 1 : 1 - Math.exp(-3.8 * dt)
        camera.position.lerp(_followGoalPos, fLerp)
        controls.target.lerp(_followGoalLook, fLerp)
      }
    }
  } else if (staffWheelZoom && controls) {
    camDriven = true
    advanceWheelZoom(dt)
  } else if (staffGlide && controls) {
    camDriven = true
    _tmpFlightPos.copy(camTargetPos)
    _tmpFlightLook.copy(camTargetLook)
    if (staffGlide.staffId) {
      const st = staffLiveEngine?.getRawById(staffGlide.staffId)
      if (st) {
        _tmpFlightLook.set(st.x, camTargetLook.y, st.z)
        _tmpFlightPos.sub(camTargetLook).add(_tmpFlightLook)
      }
    }
    if (staffGlide.advance(now, _tmpFlightPos, _tmpFlightLook, camera.position, controls.target)) staffGlide = null
  } else if (introCamAnim && controls) {
    camDriven = true
    const rawT = Math.min(1, Math.max(0, (now - introCamAnim.startTime) / introCamAnim.duration))
    const eased = 1 - Math.pow(1 - rawT, 3.6)
    _tmpIntroLook.lerpVectors(introCamAnim.fromLook, introCamAnim.toLook, eased)
    _tmpIntroSph.set(
      THREE.MathUtils.lerp(introCamAnim.fromSph.radius, introCamAnim.toSph.radius, eased),
      THREE.MathUtils.lerp(introCamAnim.fromSph.phi, introCamAnim.toSph.phi, eased),
      THREE.MathUtils.lerp(introCamAnim.fromSph.theta, introCamAnim.toSph.theta, eased)
    )
    _tmpIntroOffset.setFromSpherical(_tmpIntroSph)
    camera.position.copy(_tmpIntroLook).add(_tmpIntroOffset)
    controls.target.copy(_tmpIntroLook)
    if (rawT >= 1) {
      controls.target.copy(introCamAnim.toLook)
      _tmpIntroOffset.setFromSpherical(introCamAnim.toSph)
      camera.position.copy(introCamAnim.toLook).add(_tmpIntroOffset)
      introCamAnim = null
      waterfront?.setReflectionPaused(false)
    }
  } else if (cameraFlightAnim && controls) {
    camDriven = true
    const elapsed = now - cameraFlightAnim.startTime
    if (elapsed < cameraFlightAnim.enterDuration) {
      const p1 = Math.min(1, Math.max(0, elapsed / cameraFlightAnim.enterDuration))
      const e1 = 1 - Math.pow(1 - p1, 3)
      _tmpFlightPos.lerpVectors(cameraFlightAnim.fromPos, cameraFlightAnim.startPos, e1)
      _tmpFlightLook.lerpVectors(cameraFlightAnim.fromLook, cameraFlightAnim.startLook, e1)
      // 飞行弧线微抬升，避免低空穿梭擦碰屋顶
      _tmpFlightPos.y += Math.sin(p1 * Math.PI) * 24
      camera.position.copy(_tmpFlightPos)
      controls.target.copy(_tmpFlightLook)
    } else {
      const gElapsed = elapsed - cameraFlightAnim.enterDuration
      const p2 = Math.min(1, Math.max(0, gElapsed / cameraFlightAnim.glideDuration))
      const e2 = p2 < 0.5 ? 2 * p2 * p2 : 1 - Math.pow(-2 * p2 + 2, 2) / 2
      camera.position.lerpVectors(cameraFlightAnim.startPos, cameraFlightAnim.endPos, e2)
      controls.target.lerpVectors(cameraFlightAnim.startLook, cameraFlightAnim.endLook, e2)
      if (p2 >= 1) {
        camera.position.copy(cameraFlightAnim.endPos)
        controls.target.copy(cameraFlightAnim.endLook)
        cameraFlightAnim = null
      }
    }
  } else if (isCamAnimating && controls) {
    camDriven = true
    const lerpF = 1 - Math.exp(-4.8 * dt)
    camera.position.lerp(camTargetPos, lerpF)
    controls.target.lerp(camTargetLook, lerpF)
    if (camera.position.distanceTo(camTargetPos) < 0.6 && controls.target.distanceTo(camTargetLook) < 0.6) {
      isCamAnimating = false
    }
  }

  let lightingActive = false
  if (lightingTransition) {
    lightingActive = true
    const rawL = Math.min(1, Math.max(0, (now - lightingTransition.startTime) / Math.max(1, lightingTransition.duration)))
    const easedL = 1 - Math.pow(1 - rawL, 3)
    if (!transitionScratchAtmo) transitionScratchAtmo = cloneAtmosphere(lightingTransition.to)
    lerpAtmosphereInto(transitionScratchAtmo, lightingTransition.from, lightingTransition.to, easedL)
    applyAtmosphereSnapshot(transitionScratchAtmo, {
      forceReflection: rawL >= 1,
      skipClone: rawL < 1
    })
    lightingTransition.shadowTick = (lightingTransition.shadowTick + 1) % 4
    if (renderer && (lightingTransition.shadowTick === 0 || rawL >= 1)) {
      renderer.shadowMap.needsUpdate = true
    }
    if (rawL >= 1) {
      lightingTransition = null
    }
  }

  let focusChanged = false
  if (Math.abs(bldgUniforms.uFocusActive.value - focusTargetFactor) > 0.004) {
    const fStep = prefersReducedMotion ? 1 : Math.min(1, dt * 6.8)
    bldgUniforms.uFocusActive.value = THREE.MathUtils.lerp(bldgUniforms.uFocusActive.value, focusTargetFactor, fStep)
    if (Math.abs(bldgUniforms.uFocusActive.value - focusTargetFactor) <= 0.004) {
      bldgUniforms.uFocusActive.value = focusTargetFactor
    }
    focusChanged = true
  }

  if (introWaveAnim) {
    const wt = Math.min(1, Math.max(0, (now - introWaveAnim.startTime) / introWaveAnim.waveDuration))
    const ft = Math.min(1, Math.max(0, (now - (introWaveAnim.startTime - 80)) / introWaveAnim.fogDuration))
    const waveEased = 1 - Math.pow(1 - wt, 1.85)
    bldgUniforms.uWaveRadius.value = -36.0 + waveEased * 960.0

    if (scene?.fog) {
      const fogEased = 1 - Math.pow(1 - ft, 2.4)
      scene.fog.density = THREE.MathUtils.lerp(targetFogDensity * 1.95, targetFogDensity, fogEased)
    }

    const edgeFactor = Math.min(1, Math.max(0, (wt - 0.52) / 0.48))
    const edgeSmooth = edgeFactor * edgeFactor * (3 - 2 * edgeFactor)
    if (innerEdgeMat) innerEdgeMat.opacity = targetEdgeInOp * edgeSmooth
    if (outerEdgeMat) outerEdgeMat.opacity = targetEdgeOutOp * edgeSmooth

    if (wt >= 1 && ft >= 1) {
      // 100% 高度阴影已在加载序幕后台烘焙完成，此处收口零重算、零掉帧
      introWaveAnim = null
      bldgUniforms.uWaveActive.value = 0.0
      bldgUniforms.uWaveRadius.value = 1400.0
      if (scene?.fog) scene.fog.density = targetFogDensity
      if (innerEdgeMat) innerEdgeMat.opacity = targetEdgeInOp
      if (outerEdgeMat) outerEdgeMat.opacity = targetEdgeOutOp
      waterfront?.setReflectionPaused(false)
    }
  }

  let controlsChanged = false
  if (controls) {
    if (props.mode === 'cockpit') {
      // 贴近街面时缩短近裁剪距离，街区俯视使用地图的正常投影精度。
      const streetLens = camera.position.y < 2
      const detail = streetLens ? 1 - THREE.MathUtils.smoothstep(camera.position.y, 0.4, 3) : 0
      bldgUniforms.uStreetDetail.value = detail
      const showOverlays = !streetFollowing.value
      if (overlayGroup) overlayGroup.visible = showOverlays
      if (dynamicGroup) dynamicGroup.visible = showOverlays
      const near = streetLens ? 0.035 : 1
      const zoom = streetLens ? THREE.MathUtils.lerp(STREET_ZOOM, 1, THREE.MathUtils.smoothstep(camera.position.y, 0.28, 1.9)) : 1
      if (camera.near !== near || Math.abs(camera.zoom - zoom) > 0.0001) {
        camera.near = near
        camera.zoom = zoom
        camera.updateProjectionMatrix()
        controls.maxPolarAngle = Math.PI * (streetLens ? 0.53 : 0.45)
      }
    }
    controls.autoRotate = autoOrbit.value && !prefersReducedMotion && !comparingImagery.value
    controlsChanged = controls.update()
  }

  // 影像对照与减弱动效模式在画面完全静止时按需渲染，零 GPU 空转
  if (comparingImagery.value) {
    if (staticRenderNeeded || camDriven || controlsChanged) {
      renderer.render(scene, camera)
      staticRenderNeeded = false
    }
    return
  }

  if (prefersReducedMotion && !camDriven && !controlsChanged && !staticRenderNeeded && !lightingActive && !focusChanged) {
    return
  }

  if (waterfront) {
    const unitsPerPixel = camera.position.y / (camera.projectionMatrix.elements[5] * halfViewportHeight)
    waterfront.updateTreeDetail(unitsPerPixel)
  }
  if (!prefersReducedMotion) {
    const sec = now * 0.001
    bldgUniforms.uTime.value = sec
    if (boundaryCurtainMat) boundaryCurtainMat.uniforms.uTime.value = sec
    if (compassDiscMat) compassDiscMat.uniforms.uTime.value = sec
    if (hqBeamMat?.uniforms?.uTime) hqBeamMat.uniforms.uTime.value = sec
    for (let i = 0; i < dynamicTimeMats.length; i++) {
      if (dynamicTimeMats[i].uniforms?.uTime) dynamicTimeMats[i].uniforms.uTime.value = sec
    }
    waterfront?.advance(sec)
    if (hqBeacon) {
      hqBeacon.rotation.y += dt * 0.85
      hqBeacon.position.y = 14.5 + Math.sin(sec * 2.2) * 0.8
    }
    hqRings.forEach((r) => {
      r.phase = (r.phase + dt * 0.34) % 1
      const sc = 0.85 + r.phase * 1.85
      r.mesh.scale.set(sc, sc, 1)
      r.mat.opacity = (1 - r.phase) * 0.72
    })
    alertRings.forEach((r) => {
      r.phase = (r.phase + dt * 0.40) % 1
      const sc = 0.8 + r.phase * 1.65
      r.mesh.scale.set(sc, sc, 1)
      r.mat.opacity = (1 - r.phase) * 0.76 * (r.emphasis ?? 1)
    })
    arcParticles.forEach((p) => {
      p.t = (p.t + dt * p.speed) % 1
      p.curve.getPointAt(Math.min(0.999, Math.max(0, p.t)), p.mesh.position)
    })
    syncStaffLiveFrame(dt, camDriven || controlsChanged)
  } else {
    syncStaffLiveFrame(0)
  }

  renderer.render(scene, camera)
  staticRenderNeeded = false
  if (renderer && renderer.shadowMap.needsUpdate && !lightingTransition) {
    renderer.shadowMap.needsUpdate = false
  }

  if (props.labelsVisible) {
    const moved = hasCameraMoved()
    const staffMoving = props.mode === 'cockpit' && staffLiveGroup?.visible && (now - lastLabelTickMs >= 110)
    if (moved || labelsDirty || staffMoving) {
      if (staffMoving) lastLabelTickMs = now
      updateProjectedLabels()
    }
  }

  if (props.mode === 'cockpit' && staffLiveEngine && (props.followStaffId || props.selectedEntityId) && now - lastLiveTickEmitMs >= 420) {
    lastLiveTickEmitMs = now
    const targetId = props.followStaffId || props.selectedEntityId
    const snap = staffLiveEngine.getById(targetId)
    if (snap) emit('staff-live-tick', snap)
  }
}

function startLoop() {
  if (isRenderPaused || introHoldPaused || loading.value || rafId !== null || webglFailed.value || isDisposed) return
  lastTime = performance.now()
  rafId = requestAnimationFrame(animate)
}

function stopLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

function handleVisibilityChange() {
  isRenderPaused =
    document.hidden ||
    contentSkipped ||
    introHoldPaused ||
    props.paused ||
    (narrowScreen?.matches && props.narrowPanelOpen)
  if (isRenderPaused) {
    stopLoop()
  } else {
    staticRenderNeeded = true
    labelsDirty = true
    cachedCanvasRect = null
    startLoop()
  }
}

function handleContentVisibility(e) {
  contentSkipped = e.skipped
  handleVisibilityChange()
}

function handleResize() {
  if (!renderer || !camera || !canvasHost.value) return
  const w = canvasHost.value.clientWidth
  const h = canvasHost.value.clientHeight
  if (!w || !h) return
  const wasPanorama = lastPanorama && controls && (w !== hostWidth || h !== hostHeight) &&
    camera.position.distanceTo(lastPanorama.pos) < 1 && controls.target.distanceTo(lastPanorama.look) < 1
  hostWidth = w
  hostHeight = h
  halfViewportHeight = h / 2
  cachedCanvasRect = null
  labelsDirty = true
  staticRenderNeeded = true
  camera.aspect = w / h
  nextSightlineCheck = 0
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
  if (wasPanorama) {
    const pose = getCameraPose('hero')
    camera.position.copy(pose.pos)
    controls.target.copy(pose.look)
    controls.update()
  }
}

function handleContextLoss() {
  if (isDisposed || (props.mode !== 'cockpit' && props.mode !== 'login')) return
  stopLoop()
  webglFailed.value = true
  emit('webgl-fallback')
}

async function initScene() {
  if (!canvasHost.value) return
  prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // 首次加载幕布展示时，先留出 240ms 纯净起步窗让开场描边丝滑起跑，再错峰创建 WebGL 上下文
  if (props.externalLoader && !prefersReducedMotion) {
    await new Promise((resolve) => setTimeout(resolve, 240))
    if (isDisposed || !canvasHost.value) return
  }

  compactRenderer = window.innerWidth <= 768 || ((props.mode === 'cockpit' || props.mode === 'login') && window.innerWidth <= 1100)
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    })
  } catch (err) {
    console.error('[ChangheCity3D] WebGLRenderer create failed:', err)
    webglFailed.value = true
    loading.value = false
    emit('webgl-fallback')
    return
  }

  const w = canvasHost.value.clientWidth || 1080
  const h = canvasHost.value.clientHeight || 640
  renderer.debug.checkShaderErrors = false
  renderer.domElement.addEventListener('webglcontextlost', handleContextLoss)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compactRenderer ? 1.25 : 2))
  renderer.setSize(w, h)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.shadowMap.autoUpdate = false
  renderer.shadowMap.needsUpdate = true
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.06
  canvasHost.value.appendChild(renderer.domElement)

  if (props.externalLoader) {
    await yieldToPaint(16)
    if (isDisposed || !canvasHost.value || !renderer) return
  }

  scene = new THREE.Scene()
  scene.background = new THREE.Color('#e6ecf2')
  scene.fog = new THREE.FogExp2('#e6ecf2', 0.00048)

  camera = new THREE.PerspectiveCamera(40, w / h, 1.0, 4800)
  const pose = getCameraPose('hero')
  camera.position.copy(pose.pos)

  hemiLight = new THREE.HemisphereLight('#ffffff', '#c8ced6', 0.92)
  scene.add(hemiLight)

  sunLight = new THREE.DirectionalLight('#fff9ef', 2.15)
  sunLight.position.set(280, 460, 260)
  sunLight.castShadow = true
  const shadowSize = compactRenderer ? 1024 : 2048
  sunLight.shadow.mapSize.set(shadowSize, shadowSize)
  // 紧贴 4,205 栋建筑与滨水实际 AABB（X:[-285,250], Z:[-282,276]），提升 ~35% 有效阴影纹素密度
  Object.assign(sunLight.shadow.camera, {
    left: -380,
    right: 380,
    top: 380,
    bottom: -380,
    near: 120,
    far: 1200
  })
  sunLight.shadow.camera.updateProjectionMatrix()
  sunLight.shadow.bias = -0.00025
  sunLight.shadow.normalBias = 0.03
  scene.add(sunLight)

  fillLight = new THREE.DirectionalLight('#cfe4ff', 0.55)
  fillLight.position.set(-320, 220, -260)
  scene.add(fillLight)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.07
  controls.minDistance = props.mode === 'cockpit' ? STAFF_MIN_VIEW_DISTANCE : 65
  controls.maxDistance = 880
  controls.minPolarAngle = 0.16
  controls.maxPolarAngle = Math.PI * 0.45
  controls.autoRotateSpeed = props.mode === 'login' ? 0.24 : 0.42
  if (props.mode === 'login') {
    controls.enableZoom = false
    controls.enablePan = false
    autoOrbit.value = !prefersReducedMotion
    emit('orbit-change', autoOrbit.value)
  }
  controls.target.copy(pose.look)
  controls.update()
  controls.addEventListener('change', () => {
    staticRenderNeeded = true
  })
  controls.addEventListener('start', () => {
    isCamAnimating = false
    staffGlide = null
    staffWheelZoom = null
    cameraFlightAnim = null
    staticRenderNeeded = true
    if (props.mode === 'login' && autoOrbit.value) {
      autoOrbit.value = false
      emit('orbit-change', false)
    }
    if (introCamAnim || introWaveAnim) finishIntroVisualsImmediately()
    if (props.followStaffId) emit('stop-follow')
  })

  setCanvasCursor('grab')
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerup', onPointerUp)
  if (props.mode === 'cockpit') renderer.domElement.addEventListener('wheel', onStaffWheel, { capture: true, passive: false })
  renderer.domElement.addEventListener('pointerleave', onCanvasLeave)

  const reportProgress = (percent, stage, stageIndex) => {
    const p = Math.max(0, Math.min(100, Math.round(percent)))
    loadProgress.value = p
    emit('load-progress', { percent: p, stage, stageIndex })
  }

  const nextPaintFrame = () => yieldToPaint(props.externalLoader ? 4 : 0)

  reportProgress(4, '正在拉取高清地理底图与卫星影像', 0)
  await nextPaintFrame()
  if (isDisposed || !scene) return

  // 并行启动「首帧必需底图下载」与「4,205 栋三维白模分片构建」，将 CPU 建模重叠隐藏在网络下载窗口内
  let texPct = 0
  let geoPct = 0
  const emitParallelProgress = () => {
    const combined = 4 + texPct * 0.44 + geoPct * 0.30
    if (texPct < 100) {
      reportProgress(combined, '正在拉取高清地理底图与卫星影像', 0)
    } else {
      reportProgress(combined, '正在分片构建 4,205 栋三维楼宇白模', 1)
    }
  }

  let prebuiltGeos = null
  try {
    const [loadedAssets, builtGeos] = await Promise.all([
      loadChangheAmapAssets(
        (pct) => {
          texPct = pct
          emitParallelProgress()
        },
        {
          initialDark: isNightScene.value,
          needShoreDistance: props.mode === 'cockpit' || props.mode === 'login'
        }
      ),
      buildMergedAmapBuildingGeometriesAsync(amapPolyData.buildings, (pct) => {
        geoPct = pct
        emitParallelProgress()
      })
    ])
    assetsRef = loadedAssets
    prebuiltGeos = builtGeos
  } catch (err) {
    console.error('[ChangheCity3D] assets/geo init failed:', err)
    if (!isDisposed) {
      webglFailed.value = true
      loading.value = false
      emit('webgl-fallback')
    }
    return
  }

  if (isDisposed || !scene) return

  reportProgress(80, '正在渲染岔河水系与社区拓扑图层', 2)
  await nextPaintFrame()
  if (isDisposed || !scene) return

  if (props.mode === 'cockpit') {
    buildingIndexRef = await getCockpitBuildingIndexAsync(nextPaintFrame)
    if (isDisposed || !scene) return
    await initStaffLiveVisuals(nextPaintFrame)
    if (isDisposed || !scene) return
  }

  await buildAmap3DCity(prebuiltGeos, nextPaintFrame)
  if (isDisposed || !scene) return
  reportProgress(84, '正在渲染岔河水系与社区拓扑图层', 2)
  await nextPaintFrame()
  if (isDisposed || !scene) return

  await buildCommunityOverlays(nextPaintFrame)
  if (isDisposed || !scene) return
  applyVisualTheme(true)
  reportProgress(88, '正在渲染岔河水系与社区拓扑图层', 2)
  await nextPaintFrame()
  if (isDisposed || !scene) return

  // 驾驶舱一律强制以全街道「全景鸟瞰」开场（绝不被跨页缓存的 selectedCommunity 拉近）
  const willIntro = props.mode === 'cockpit' && props.deferReveal && !prefersReducedMotion
  if (props.mode === 'cockpit') {
    cameraPreset.value = 'hero'
    const heroPose = getCameraPose('hero')
    isCamAnimating = false
    introCamAnim = null
    introWaveAnim = null
    // 先以 100% 满高度状态预热，一次性把 4,205 栋白模显存缓冲与最终 2048×2048 阴影在加载页后台烘焙完毕
    bldgUniforms.uWaveActive.value = 0.0
    bldgUniforms.uWaveRadius.value = 1400.0
    camera.position.copy(heroPose.pos)
    controls.target.copy(heroPose.look)
    controls.update()
    updateBuildingSemanticTexture()
    rebuildCockpitEntities()
    rebuildEmergencyRing()
  } else if (props.mode === 'login') {
    cameraPreset.value = 'hero'
    const heroPose = getCameraPose('hero')
    isCamAnimating = false
    introCamAnim = null
    introWaveAnim = null
    bldgUniforms.uWaveActive.value = 0.0
    bldgUniforms.uWaveRadius.value = 1400.0
    camera.position.copy(heroPose.pos)
    controls.target.copy(heroPose.look)
    controls.update()
  } else if (props.selectedCommunity && props.selectedCommunity !== '全街道' && props.mode !== 'single' && props.mode !== 'patrol') {
    focusOnCommunity(props.selectedCommunity)
  }

  reportProgress(90, '正在编译三维光影与首帧渲染管线', 3)
  await nextPaintFrame()
  if (isDisposed || !scene || !renderer) return

  // 在加载遮罩后台逐帧将首帧必需底图（12 条带分片）与岸线、语义纹理预上传至 GPU 显存
  handleResize()
  try {
    const primaryKey = isNightScene.value ? 'darkVecTex' : 'lightVecTex'
    if (assetsRef[primaryKey]) {
      const gpuTex = await uploadLargeTextureSlicedAsync(renderer, assetsRef[primaryKey], nextPaintFrame, 12)
      if (isDisposed || !scene || !renderer) return
      if (gpuTex) {
        slicedGpuTexMap.set(primaryKey, gpuTex)
        if (groundMat && groundMat.map === assetsRef[primaryKey]) {
          groundMat.map = gpuTex
          groundMat.needsUpdate = true
        }
      }
      reportProgress(93, '正在编译三维光影与首帧渲染管线', 3)
      await nextPaintFrame()
      if (isDisposed || !scene || !renderer) return
    }

    if (typeof renderer.initTexture === 'function') {
      const preloadTexList = [
        (props.mode === 'cockpit' || props.mode === 'login') ? assetsRef.shoreDistanceTex : null,
        bldgColorTex
      ].filter(Boolean)
      for (let i = 0; i < preloadTexList.length; i++) {
        renderer.initTexture(preloadTexList[i])
        reportProgress(93 + Math.round(((i + 1) / preloadTexList.length) * 2), '正在编译三维光影与首帧渲染管线', 3)
        await nextPaintFrame()
        if (isDisposed || !scene || !renderer) return
      }
    }

    if (typeof renderer.compileAsync === 'function') {
      await renderer.compileAsync(scene, camera)
    } else if (typeof renderer.compile === 'function') {
      renderer.compile(scene, camera)
    }
    if (isDisposed || !scene || !renderer) return

    const compiledPrograms = Array.isArray(renderer.info?.programs) ? renderer.info.programs : []
    let progSliceStart = performance.now()
    for (let i = 0; i < compiledPrograms.length; i++) {
      compiledPrograms[i]?.getUniforms?.()
      if (performance.now() - progSliceStart >= 2.8) {
        await yieldToPaint(0)
        if (isDisposed || !scene || !renderer) return
        progSliceStart = performance.now()
      }
    }

    reportProgress(96, '正在编译三维光影与首帧渲染管线', 3)
    await yieldToPaint(16)
    if (isDisposed || !scene || !renderer) return

    // 首帧烘焙前即按真实视距同步树木 LOD，避免阴影/倒影/主通道白渲高模树冠三角
    if (waterfront) {
      const unitsPerPixel = camera.position.y / (camera.projectionMatrix.elements[5] * halfViewportHeight)
      waterfront.updateTreeDetail(unitsPerPixel)
    }

    // 预热 Pass A：单独烘焙最终阴影贴图与主场景 VBO（暂跳过水面 Reflector，避免同帧双重消耗）
    waterfront?.setReflectionPaused(true, true)
    renderer.shadowMap.needsUpdate = true
    renderer.render(scene, camera)
    reportProgress(97, '正在编译三维光影与首帧渲染管线', 3)
    await yieldToPaint(16)
    if (isDisposed || !scene || !renderer) return

    // 预热 Pass B：单独预热水面 Reflector 倒影通道（复用已烘焙阴影贴图）
    renderer.shadowMap.needsUpdate = false
    waterfront?.setReflectionPaused(false)
    renderer.render(scene, camera)
    reportProgress(99, '正在编译三维光影与首帧渲染管线', 3)
    await yieldToPaint(16)
    if (isDisposed || !scene || !renderer) return

    // 预热 Pass C：切至入场起始高空弧线机位并刷新管线（保留已烘焙好的最终阴影贴图，不再重算阴影）
    if (willIntro) {
      const startPose = getIntroStartPose()
      camera.position.copy(startPose.pos)
      controls.target.copy(startPose.look)
      controls.update()
      if (waterfront) {
        const unitsPerPixel = camera.position.y / (camera.projectionMatrix.elements[5] * halfViewportHeight)
        waterfront.updateTreeDetail(unitsPerPixel)
      }
      bldgUniforms.uWaveActive.value = 1.0
      bldgUniforms.uWaveRadius.value = -36.0
      if (scene?.fog) scene.fog.density = targetFogDensity * 1.95
      if (innerEdgeMat) innerEdgeMat.opacity = 0
      if (outerEdgeMat) outerEdgeMat.opacity = 0
      waterfront?.setReflectionPaused(true)
    } else {
      waterfront?.setReflectionPaused(false)
    }
    renderer.shadowMap.needsUpdate = false
    renderer.render(scene, camera)
    const gl = renderer.getContext?.()
    if (gl && typeof gl.flush === 'function') {
      gl.flush()
    }
    await nextPaintFrame()
    if (isDisposed || !scene || !renderer) return
    labelsDirty = true
    if (props.labelsVisible) {
      updateProjectedLabels()
    }
  } catch (err) {
    console.error('[ChangheCity3D] warmup render failed:', err)
    if (!isDisposed) {
      webglFailed.value = true
      loading.value = false
      emit('webgl-fallback')
    }
    return
  }

  // 若由外部全屏加载序幕控制揭幕，先暂停后台 3D 渲染循环，避免与遮罩 SVG 争抢 GPU；待揭幕瞬间立刻恢复
  introHoldPaused = Boolean(props.mode === 'cockpit' && props.deferReveal)
  reportProgress(100, '全景沙盘已就绪，即将进入驾驶舱', 3)
  loading.value = false
  handleVisibilityChange()
  emit('scene-ready')

  // 延后至揭幕三幕动画完全收官后，再在浏览器空闲窗口后台静默预热非首帧底图（避免与开场抢占 GPU/解码线程）
  secondaryPreloadTimer = setTimeout(() => {
    secondaryPreloadTimer = null
    if (isDisposed || !renderer) return
    cancelSecondaryPreload = preloadSecondaryAmapAssets((key, tex) => {
      if (isDisposed || !renderer || !tex) return
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
      if (typeof renderer.initTexture === 'function') renderer.initTexture(tex)
      if (key === 'satTex' && imageryMat && imageryMat.map !== tex) {
        imageryMat.map = tex
        imageryMat.needsUpdate = true
      }
    })
  }, props.mode === 'cockpit' ? 4500 : 1200)
}

// ── 微任务脏标记合并调度器：合并五章切换 / 锁社区 / 切主题并发引发的多次重建 ──
let syncScheduled = false
const syncFlags = {
  theme: false,
  zones: false,
  dynamic: false,
  semantic: false,
  entities: false,
  emergency: false,
  labels: false
}

function scheduleSync(flags) {
  if (loading.value || isDisposed) return
  Object.assign(syncFlags, flags)
  if (syncScheduled) return
  syncScheduled = true
  queueMicrotask(() => {
    syncScheduled = false
    if (loading.value || isDisposed || !scene) return
    const f = { ...syncFlags }
    syncFlags.theme = syncFlags.zones = syncFlags.dynamic = syncFlags.semantic = syncFlags.entities = syncFlags.emergency = syncFlags.labels = false
    if (f.theme) applyVisualTheme()
    if (f.zones) updateZoneStyles()
    if (f.dynamic) rebuildDynamicEvents()
    if (f.semantic && props.mode === 'cockpit') updateBuildingSemanticTexture()
    if (f.entities && props.mode === 'cockpit') rebuildCockpitEntities()
    if (f.emergency && props.mode === 'cockpit') rebuildEmergencyRing()
    if (f.labels) {
      labelsDirty = true
      if (props.labelsVisible) updateProjectedLabels()
    }
    staticRenderNeeded = true
  })
}

const eventsVisualSig = computed(() => {
  const list = props.events || []
  let s = ''
  for (let i = 0; i < list.length; i++) {
    const e = list[i]
    s += `${e.id}:${e.stage}:${e.lat}:${e.lng}:${e.community}|`
  }
  return s
})

watch(() => props.labelsVisible, (vis) => {
  if (vis && !loading.value) {
    labelsDirty = true
    updateProjectedLabels()
  }
})

watch(() => [props.narrowPanelOpen, props.paused], handleVisibilityChange)

onMounted(() => {
  narrowScreen = window.matchMedia('(max-width: 1100px)')
  narrowScreen.addEventListener('change', handleVisibilityChange)
  initScene()
  if (typeof ResizeObserver !== 'undefined' && canvasHost.value) {
    resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(canvasHost.value)
  }
  document.addEventListener('visibilitychange', handleVisibilityChange)

  if (rootEl.value) {
    const supportsCV = 'contentVisibility' in document.documentElement.style
    if (supportsCV) {
      rootEl.value.addEventListener('contentvisibilityautostatechange', handleContentVisibility)
    } else if (typeof IntersectionObserver !== 'undefined') {
      intersectionObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            contentSkipped = !entry.isIntersecting
            handleVisibilityChange()
          })
        },
        { rootMargin: '180px' }
      )
      intersectionObserver.observe(rootEl.value)
    }
  }
})

watch(
  () => [props.dark, store.preset],
  () => {
    timePhaseOverride.value = null
    scheduleSync({ theme: true, zones: true, semantic: true })
  }
)

watch(
  () => [effectiveTimePhase.value, groundStyle.value],
  () => {
    scheduleSync({ theme: true, zones: true, semantic: true, emergency: true })
  }
)

watch(
  () => props.slice,
  (newSlice) => {
    cockpitLayers.value.aid = newSlice === 'aid'
    cockpitLayers.value.eco = newSlice === 'eco'
  }
)

watch(
  () => [props.slice, eventsVisualSig.value, props.cockpitViewMode, props.selectedEventId],
  ([newSlice, newEvSig, newViewMode, newSelEv], [oldSlice, oldEvSig, oldViewMode, oldSelEv] = []) => {
    const needDyn = props.mode !== 'cockpit' || newEvSig !== oldEvSig || newViewMode !== oldViewMode || newSelEv !== oldSelEv
    scheduleSync({
      zones: true,
      dynamic: needDyn,
      semantic: true,
      entities: newSlice !== oldSlice || newViewMode !== oldViewMode,
      labels: true
    })
  }
)

watch(
  () => [props.selectedBuildingIndex, props.selectedEntityId, props.emergencyInfo],
  ([bIdx]) => {
    if (loading.value || props.mode !== 'cockpit') return
    scheduleSync({ semantic: true, entities: true, emergency: true, labels: true })
    if (typeof bIdx === 'number' && bIdx >= 0 && buildingIndexRef?.buildings?.[bIdx]) {
      const b = buildingIndexRef.buildings[bIdx]
      focusOnPointXZ(b.cx, b.cz, 98, 102)
    }
  }
)

watch(
  () => props.singleEvent?.id,
  () => {
    if (loading.value || props.mode !== 'single') return
    scheduleSync({ zones: true, dynamic: true, labels: true })
    const pose = getCameraPose(cameraPreset.value)
    animateCameraTo(pose.pos, pose.look)
  }
)

watch(
  () => props.patrolRecord?.id,
  () => {
    if (loading.value || props.mode !== 'patrol') return
    scheduleSync({ zones: true, dynamic: true, labels: true })
    const pose = getCameraPose(cameraPreset.value)
    animateCameraTo(pose.pos, pose.look)
  }
)

watch(
  () => [props.patrolStepIdx, props.patrolThreshold],
  () => {
    if (loading.value || props.mode !== 'patrol') return
    scheduleSync({ dynamic: true, labels: true })
  }
)

watch(
  () => [props.armedTopic, props.mobilizeLayer, props.armedPlaces?.length],
  () => {
    if (loading.value || props.mode !== 'armed') return
    scheduleSync({ dynamic: true, labels: true })
  }
)

watch(
  () => props.hoveredCommunity,
  () => {
    scheduleSync({ zones: true })
  }
)

watch(
  () => props.selectedCommunity,
  (val) => {
    if (loading.value) return
    if (props.mode === 'single' || props.mode === 'patrol') return
    scheduleSync({
      zones: true,
      dynamic: props.mode === 'armed',
      semantic: true,
      entities: true,
      labels: true
    })
    if (val && val !== '全街道') {
      focusOnCommunity(val)
    } else {
      cameraPreset.value = 'hero'
      const pose = getCameraPose('hero')
      animateCameraTo(pose.pos, pose.look, props.mode === 'cockpit' ? 'overview' : '')
    }
  }
)

// 驾驶舱切五章：全街道报告态执行电影级弧线推轨运镜，同步切换专题语义着色与重点标识
watch(
  () => props.chapterIndex,
  (idx) => {
    if (loading.value || props.mode !== 'cockpit') return
    scheduleSync({ semantic: true, entities: true, labels: true })
    if (
      props.cockpitViewMode === 'report' &&
      props.selectedCommunity === '全街道' &&
      props.selectedBuildingIndex < 0 &&
      !props.selectedEventId
    ) {
      flyToChapter(idx)
    }
  }
)

watch(
  () => [props.focusedFloor?.floor, props.focusedFloor?.totalFloors, props.focusedFloor?.tone, props.focusedFloor?.label],
  () => {
    if (loading.value || props.mode !== 'cockpit') return
    rebuildFloorBand()
    if (props.labelsVisible) updateProjectedLabels()
  }
)

watch(
  () => props.theaterMode,
  () => {
    if (loading.value || props.mode !== 'cockpit') return
    labelsDirty = true
    if (props.labelsVisible) updateProjectedLabels()
  }
)

watch(focusedOnPersonnel, updateEventEmphasis)

watch(
  () => [props.staffLayerActive, props.staffStatusFocus, props.staffCommunityCounts],
  ([active], [wasActive]) => {
    cockpitLayers.value.staff = Boolean(active)
    if (!active) hoveredStaffId = ''
    syncStaffLiveFrame(0)
    if (active !== wasActive && props.emergencyInfo) rebuildEmergencyRing()
    labelsDirty = true
    if (props.labelsVisible) updateProjectedLabels()
    staticRenderNeeded = true
  }
)

watch(
  () => [props.followStaffId, props.followAltitude],
  ([id, altitude], [previousId]) => {
    if (id && staffLiveEngine && camera && controls) {
      const fSt = staffLiveEngine.getRawById(id)
      if (fSt) {
        staffWheelZoom = null
        if (previousId !== id) {
          followSmoothedYaw = fSt.heading
          followView.offset = 0.48
        }
        if (introCamAnim || introWaveAnim) finishIntroVisualsImmediately()
        autoOrbit.value = false
        const street = altitude !== 'mid' || camera.near < 1
        const now = performance.now()
        staffGlide = prefersReducedMotion ? null : { kind: 'follow', advance: street
          ? createStreetCameraGlide(buildingIndexRef, camera.position, controls.target, now)
          : createStaffCameraGlide(camera.position, controls.target, now) }
        nextSightlineCheck = 0
        cameraFlightAnim = null
        isCamAnimating = false
        emit('staff-live-tick', staffLiveEngine.getById(id))
      }
    } else if (staffGlide?.kind === 'follow') staffGlide = null
    labelsDirty = true
    if (!loading.value && props.labelsVisible) updateProjectedLabels()
    staticRenderNeeded = true
  }
)

watch(
  () => props.followAltitude,
  () => {
    nextSightlineCheck = 0
    staticRenderNeeded = true
  }
)

const mobileHudPanel = ref('') // '' | 'legend' | 'ctrl' (仅窄屏驾驶舱折叠使用)
function toggleMobileHud(panel) {
  mobileHudPanel.value = mobileHudPanel.value === panel ? '' : panel
}

onBeforeUnmount(() => {
  isDisposed = true
  stopLoop()
  if (pointerMoveRaf !== null) {
    cancelAnimationFrame(pointerMoveRaf)
    pointerMoveRaf = null
  }
  if (secondaryPreloadTimer !== null) {
    clearTimeout(secondaryPreloadTimer)
    secondaryPreloadTimer = null
  }
  cancelSecondaryPreload?.()
  cancelSecondaryPreload = null
  narrowScreen?.removeEventListener('change', handleVisibilityChange)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  rootEl.value?.removeEventListener('contentvisibilityautostatechange', handleContentVisibility)
  intersectionObserver?.disconnect()
  resizeObserver?.disconnect()
  if (renderer?.domElement) {
    renderer.domElement.removeEventListener('webglcontextlost', handleContextLoss)
    renderer.domElement.removeEventListener('pointerdown', onPointerDown)
    renderer.domElement.removeEventListener('pointermove', onPointerMove)
    renderer.domElement.removeEventListener('pointerup', onPointerUp)
    renderer.domElement.removeEventListener('wheel', onStaffWheel, true)
    renderer.domElement.removeEventListener('pointerleave', onCanvasLeave)
  }
  waterfront?.disposeInactive()
  ;[cityGroup, overlayGroup, dynamicGroup, entityGroup, staffLiveGroup, emergencyGroup, selectedOutlineGroup, hoverOutlineGroup, floorBandGroup].forEach((g) => {
    if (g && scene) {
      disposeGroup(g)
      scene.remove(g)
    }
  })
  staffLiveEngine = null
  staffMarkers?.disposeTexture()
  staffMarkers = null
  staffTrailMesh = staffTrailGeo = null
  selOutlineTopMat.dispose()
  selOutlineBaseMat.dispose()
  hovOutlineTopMat.dispose()
  hovOutlineBaseMat.dispose()
  floorBandRingMat.dispose()
  bldgColorTex.dispose()
  slicedGpuTexMap.forEach((t) => t.dispose())
  slicedGpuTexMap.clear()
  sunLight?.shadow?.map?.dispose()
  zoneEntries.clear()
  dynamicTimeMats = []
  pickableDynamicTargets = []
  skyDomeMesh = null
  skyDomeMat = null
  boundaryCurtainMat = null
  compassDiscMat = null
  controls?.dispose()
  renderer?.dispose()
  renderer?.forceContextLoss()
  if (renderer?.domElement?.parentNode) {
    renderer.domElement.parentNode.removeChild(renderer.domElement)
  }
  renderer = null
  scene = null
  camera = null
  controls = null
  waterfront = null
  cityGroup = overlayGroup = dynamicGroup = entityGroup = emergencyGroup = selectedOutlineGroup = hoverOutlineGroup = floorBandGroup = null
  imageryMat = null
})
</script>

<template>
  <div
    ref="rootEl"
    class="city3d-root"
    :class="['preset-' + store.preset, 'mode-' + mode, { dark: isNightScene, compact: compact || (mode !== 'cockpit' && mode !== 'login') }]"
  >
    <div ref="canvasHost" class="city3d-canvas"></div>
    <div v-if="!comparingImagery && !streetFollowing" class="city3d-horizon-mist" aria-hidden="true"></div>

    <!-- 首次载入进度提示（大屏与登录模式由外层接管，子页面保留轻提示） -->
    <div v-if="loading && !externalLoader && mode !== 'login'" class="city3d-loading">
      <div class="c3d-load-card">
        <strong>正在加载长河街道高德实景三维白模</strong>
        <div class="c3d-load-bar"><i :style="{ width: loadProgress + '%' }"></i></div>
        <span class="num">建筑轮廓载入中 · {{ loadProgress }}%</span>
      </div>
    </div>

    <!-- 3D 实时投影悬浮铭牌层 -->
    <div
      v-if="mode !== 'login'"
      v-show="!loading && !comparingImagery"
      class="city3d-labels"
      :inert="streetFollowing"
      :class="{ 'is-stage-hidden': !labelsVisible || streetFollowing, 'has-hover': mode === 'cockpit' && !!hoveredCommunity }"
      aria-label="长河街道三维实景地标"
    >
      <!-- 常规模式：指挥中心与 14 社区铭牌 -->
      <div
        v-if="hqScreenPos.visible"
        class="city3d-hq-tag"
        title="长河街道办事处（天衢新区三八东路 1420 号）"
        :style="{ transform: `translate3d(${hqScreenPos.x}px, ${hqScreenPos.y}px, 0) translate(-50%, -100%)` }"
      >
        <span class="hq-badge-seal">中</span>
        <span>长河街道办事处 · 指挥中心</span>
      </div>

      <button
        v-for="lb in projectedLabels"
        v-show="lb.visible"
        :key="lb.name"
        type="button"
        class="city3d-comm-tag"
        :class="['h-' + lb.health, 'lv-' + lb.level, { active: lb.isSel, hover: lb.isHov, alert: lb.hasAlert, quiet: lb.quiet }]"
        :aria-label="lb.count ? lb.name + '，' + (staffStatusFocus === 'all' ? '网格员' : staffStatusFocus) + lb.count + '人，查看名录' : lb.name + '，' + lb.chip"
        :style="{
          transform: `translate3d(${lb.x}px, ${lb.y}px, 0) translate(-50%, -100%)`,
          zIndex: lb.zIndex
        }"
        @mouseenter="onLabelHover(lb.name)"
        @mouseleave="onLabelHover('')"
        @click="emit(lb.count ? 'select-staff-community' : 'select-community', lb.name)"
      >
        <i v-if="!lb.quiet" class="tag-dot"></i>
        <span class="tag-name">{{ lb.shortName }}</span>
        <span v-if="lb.count" class="tag-staff-count num" :style="{ opacity: lb.countOpacity }">{{ lb.count }}人</span>
        <em v-if="!lb.quiet && (!compact || lb.isSel || lb.isHov || lb.hasAlert)" class="tag-chip num">{{ lb.chip }}</em>
      </button>

      <!-- 驾驶舱 4 类治理实体 3D 投影轻标签（按图层/联动按需浮现） -->
      <button
        v-for="et in projectedEntityLabels"
        :key="et.key"
        type="button"
        class="city3d-ent-tag"
        :class="['k-' + et.kind, { active: et.isSel }]"
        :style="{
          transform: `translate3d(${et.x}px, ${et.y}px, 0) translate(-50%, -100%)`,
          zIndex: et.zIndex, opacity: et.opacity
        }"
        @click="handleEntityLabelClick(et)"
      >
        <i class="ent-dot"></i>
        <span>{{ et.text }}</span>
      </button>

      <!-- 单栋 3D 楼房悬停轻量名片 -->
      <div
        v-if="mode === 'cockpit' && hoveredBuilding"
        class="city3d-bldg-tip"
        :style="{ transform: `translate3d(${hoveredBuilding.x}px, ${hoveredBuilding.y}px, 0)` }"
      >
        <div class="bldg-tip-head">
          <strong>{{ hoveredBuilding.name }}</strong>
          <em :class="{ alert: hoveredBuilding.isAlert }">{{ hoveredBuilding.chip }}</em>
        </div>
        <div class="bldg-tip-sub">{{ hoveredBuilding.community }}{{ hoveredBuilding.estate ? ' · ' + hoveredBuilding.estate : '' }} · {{ hoveredBuilding.gridName }} · 点击查看一楼一档</div>
      </div>

      <!-- 3D 单层亮带侧挂铭牌（跟随一楼一档悬停/点选楼层） -->
      <div
        v-if="mode === 'cockpit' && projectedFloorTag"
        class="city3d-floor-tag"
        :class="'tone-' + projectedFloorTag.tone"
        :style="{ transform: `translate3d(${projectedFloorTag.x}px, ${projectedFloorTag.y}px, 0) translate(8px, -50%)` }"
      >
        <i></i>
        <span>{{ projectedFloorTag.text }}</span>
      </div>

      <!-- 单点事件定位浮标 -->
      <div
        v-if="mode === 'single' && projectedSingleLabel?.visible"
        class="city3d-single-tag"
        :class="'tone-' + projectedSingleLabel.tone"
        :style="{ transform: `translate3d(${projectedSingleLabel.x}px, ${projectedSingleLabel.y}px, 0) translate(-50%, -100%)` }"
      >
        <i class="st-dot"></i>
        <span>{{ projectedSingleLabel.title }}</span>
        <em>{{ projectedSingleLabel.stage }}</em>
      </div>

      <!-- 巡查轨迹防碰撞节点浮标（非当前点紧凑序号圆标，悬停/当前/异常展开完整铭牌） -->
      <button
        v-for="pl in projectedPatrolLabels"
        v-show="pl.visible"
        :key="'pt-' + pl.idx"
        type="button"
        class="city3d-patrol-tag"
        :class="{
          anom: pl.isAnom,
          cur: pl.isCur,
          reached: pl.reached,
          compact: !pl.expanded
        }"
        :style="{
          transform: `translate3d(${pl.x}px, ${pl.y}px, 0) translate(-50%, -100%)`,
          zIndex: pl.zIndex
        }"
        :title="`${pl.time} · ${pl.note}`"
        @mouseenter="hoveredPatrolIdx = pl.idx"
        @mouseleave="hoveredPatrolIdx = -1"
        @click="emit('select-patrol-step', pl.idx)"
      >
        <b class="pt-num num">{{ pl.order }}</b>
        <span v-if="pl.expanded" class="pt-txt">{{ pl.label }}</span>
      </button>

      <!-- 数字武装 5 专题 3D 浮标 -->
      <button
        v-for="ar in projectedArmedLabels"
        v-show="ar.visible"
        :key="ar.key"
        type="button"
        class="city3d-armed-tag"
        :class="['t-' + ar.tone, { active: ar.isSel }]"
        :style="{
          transform: `translate3d(${ar.x}px, ${ar.y}px, 0) translate(-50%, -100%)`,
          zIndex: ar.zIndex
        }"
        @click="handleArmedLabelClick(ar)"
      >
        <span>{{ ar.text }}</span>
        <em v-if="ar.chip" class="num">{{ ar.chip }}</em>
      </button>
    </div>

    <!-- 单点模式顶部简洁地址坐标胶囊 -->
    <div v-if="mode === 'single' && singleEvent && !loading" class="city3d-single-addr">
      <span class="sa-dot"></span>
      <strong>{{ singleEvent.address }}</strong>
      <span class="num sa-coord">{{ singleEvent.lat.toFixed(4) }}°N, {{ singleEvent.lng.toFixed(4) }}°E</span>
    </div>

    <!-- 窄屏驾驶舱：图例与视角折叠开关胶囊（桌面端 display: none） -->
    <div
      v-if="mode === 'cockpit' && !loading && !comparingImagery"
      class="city3d-mobile-hud-toggle"
      :class="{ 'is-stage-hidden': !labelsVisible }"
    >
      <button
        type="button"
        :class="{ active: mobileHudPanel === 'legend' }"
        @click="toggleMobileHud('legend')"
      >
        图层图例
      </button>
      <button
        type="button"
        :class="{ active: mobileHudPanel === 'ctrl' }"
        @click="toggleMobileHud('ctrl')"
      >
        视角光影
      </button>
    </div>

    <!-- 左下角紧凑 3D 专题图例卡 -->
    <aside
      v-if="!compact && !loading && !comparingImagery && mode !== 'login' && mode !== 'single' && mode !== 'patrol' && mode !== 'armed'"
      v-show="!streetFollowing || !theaterMode || mobileHudPanel === 'legend'"
      class="city3d-legend"
      :class="{ 'is-cockpit': mode === 'cockpit', 'is-theater': theaterMode, 'is-stage-hidden': !labelsVisible, 'is-mobile-open': mobileHudPanel === 'legend' }"
      aria-label="三维沙盘专题图例"
    >
      <div class="c3d-lg-head">
        <strong>{{ currentLegend.title }}</strong>
        <span>{{ currentLegend.unit }}</span>
      </div>
      <div class="c3d-lg-ramp">
        <div v-for="(col, idx) in currentLegend.colors" :key="idx" class="c3d-lg-step">
          <i :style="{ background: col }"></i>
          <span>{{ currentLegend.ticks[idx] }}</span>
        </div>
      </div>
      <div v-if="mode === 'cockpit'" class="c3d-lg-layers" role="group" aria-label="三维业务图层开关">
        <button v-for="layer in layerFilters" :key="layer.key" type="button" :aria-pressed="layer.active"
          :class="{ active: layer.active }" @click="toggleCockpitLayer(layer.key)">
          <i class="ly-dot" :class="'d-' + layer.key" aria-hidden="true"></i>{{ layer.label }}
        </button>
      </div>
      <div v-else class="c3d-lg-foot">
        <span><b class="lg-hq">中</b>指挥中心</span>
        <span><b class="lg-arc"></b>调度光弧</span>
        <span><b class="lg-zone"></b>社区路网界线</span>
      </div>
    </aside>

    <!-- 三维视角与四时辰光影控制胶囊（驾驶舱单排整合瘦身；单点/巡查自动精简） -->
    <div
      v-if="!loading && mode !== 'login'"
      class="city3d-ctrl"
      :class="{ 'is-cockpit': mode === 'cockpit', 'is-theater': theaterMode, 'is-compact': compact, 'is-mini': mode === 'single' || mode === 'patrol', 'is-stage-hidden': !labelsVisible, 'is-mobile-open': mobileHudPanel === 'ctrl' }"
      role="group"
      aria-label="三维视角与光影控制"
    >
      <template v-if="mode === 'single' || mode === 'patrol'">
        <button type="button" :class="{ active: cameraPreset === 'hero' }" @click="applyCameraPreset('hero')">斜视</button>
        <button type="button" :class="{ active: cameraPreset === 'top' }" @click="applyCameraPreset('top')">俯瞰</button>
        <button type="button" @click="toggleDayNight">{{ isNightScene ? '日景' : '暗夜' }}</button>
        <button type="button" @click="toggleGroundStyle">{{ groundStyle === 'amap' ? '卫星' : '矢量' }}</button>
        <button type="button" @click="resetCameraView">复位</button>
      </template>
      <template v-else-if="mode === 'cockpit'">
        <button type="button" title="全景鸟瞰" :class="{ active: cameraPreset === 'hero' }" @click="applyCameraPreset('hero')">全景</button>
        <button type="button" title="长河公园大湖" :class="{ active: cameraPreset === 'park' }" @click="applyCameraPreset('park')">公园</button>
        <button type="button" title="岔河实景桥景" :class="{ active: cameraPreset === 'bridge' }" @click="applyCameraPreset('bridge')">桥景</button>
        <button type="button" title="星凯商圈楼群" :class="{ active: cameraPreset === 'xingkai' }" @click="applyCameraPreset('xingkai')">商圈</button>
        <button type="button" title="正射俯瞰" :class="{ active: cameraPreset === 'top' }" @click="applyCameraPreset('top')">俯瞰</button>
        <i class="c3d-ctrl-sep" aria-hidden="true"></i>
        <div v-if="!comparingImagery" class="c3d-time-seg" role="group" aria-label="四时辰光影">
          <button
            v-for="tp in TIME_PHASES"
            :key="tp.key"
            type="button"
            :title="tp.title"
            :class="{ active: effectiveTimePhase === tp.key, 'is-dusk': tp.key === 'dusk' && effectiveTimePhase === 'dusk' }"
            @click="selectTimePhase(tp.key)"
          >
            {{ tp.label }}
          </button>
        </div>
        <i v-if="!comparingImagery" class="c3d-ctrl-sep" aria-hidden="true"></i>
        <button v-if="!comparingImagery" type="button" :title="groundStyle === 'amap' ? '叠加高清卫星影像' : '切换纯净矢量底图'" :class="{ active: groundStyle === 'sat' }" @click="toggleGroundStyle">卫星</button>
        <button type="button" title="高清卫星影像对照" aria-label="影像对照" :aria-pressed="comparingImagery" :class="{ active: comparingImagery }" @click="toggleImageryComparison">{{ comparingImagery ? '返回' : '对照' }}</button>
        <button v-if="!comparingImagery" type="button" title="绕中心自动慢速环绕" :class="{ active: autoOrbit }" @click="autoOrbit = !autoOrbit">{{ autoOrbit ? '暂停' : '环绕' }}</button>
        <button type="button" title="恢复默认鸟瞰与光影" @click="resetCameraView">复位</button>
      </template>
      <template v-else>
        <button type="button" :class="{ active: cameraPreset === 'hero' }" @click="applyCameraPreset('hero')">全景鸟瞰</button>
        <button type="button" :class="{ active: cameraPreset === 'park' }" @click="applyCameraPreset('park')">长河公园</button>
        <button type="button" :class="{ active: cameraPreset === 'xingkai' }" @click="applyCameraPreset('xingkai')">星凯商圈</button>
        <button type="button" :class="{ active: cameraPreset === 'top' }" @click="applyCameraPreset('top')">正射俯瞰</button>
        <button v-if="!comparingImagery" type="button" @click="toggleDayNight">{{ isNightScene ? '日景白模' : '暗夜晶格' }}</button>
        <button v-if="!comparingImagery" type="button" @click="toggleGroundStyle">{{ groundStyle === 'amap' ? '叠加卫星' : '纯净矢量' }}</button>
        <button v-if="!comparingImagery" type="button" :class="{ active: autoOrbit }" @click="autoOrbit = !autoOrbit">{{ autoOrbit ? '暂停' : '环绕' }}</button>
        <button type="button" @click="resetCameraView">复位</button>
      </template>
    </div>

    <!-- 嵌入工作台左上角轻提示 -->
    <div v-if="compact && !loading && mode !== 'login' && mode !== 'single' && mode !== 'patrol'" class="city3d-hint">
      {{ mode === 'armed' ? '三维实景武装阵地沙盘 · 拖拽旋转 · 点击点位联动查阅' : '城市建筑三维白模 · 拖拽旋转 · 点击任意社区联动' }}
    </div>
  </div>
</template>

<style scoped>
.city3d-root {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 280px;
  overflow: hidden;
  user-select: none;
  background: #e6ecf2;
  content-visibility: auto;
  contain-intrinsic-size: auto 560px;
}

.city3d-root.mode-cockpit,
.city3d-root.mode-login {
  content-visibility: visible;
}

/* 浅色 94%-95% 不透明小铭牌与宣瓷 3D 控件免除冗余 WebGL 模糊回读，大幅削减并发 Backdrop Pass */
.city3d-root:not(.dark) .city3d-comm-tag,
.city3d-root:not(.dark) .city3d-ent-tag,
.city3d-root.preset-vermilion-seal .city3d-legend.is-cockpit,
.city3d-root.preset-vermilion-seal .city3d-ctrl.is-cockpit {
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.city3d-root.dark {
  background: #0e131e;
}

.city3d-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  touch-action: none;
}

/* 顶部极轻薄雾柔化（让程序化天际穹顶自然透出，仅做轻薄衔接） */
.city3d-horizon-mist {
  position: absolute;
  inset: 0 0 auto 0;
  height: 76px;
  z-index: 6;
  pointer-events: none;
  opacity: 0.42;
  background: linear-gradient(180deg, #e6ecf2 0%, rgba(230, 236, 242, 0.45) 45%, rgba(230, 236, 242, 0) 100%);
}
.city3d-root.preset-vermilion-seal:not(.dark) .city3d-horizon-mist {
  background: linear-gradient(180deg, #ece6dc 0%, rgba(236, 230, 220, 0.74) 38%, rgba(236, 230, 220, 0) 100%);
}
.city3d-root.preset-cloud-portal:not(.dark) .city3d-horizon-mist {
  background: linear-gradient(180deg, #e1ecf8 0%, rgba(225, 236, 248, 0.72) 38%, rgba(225, 236, 248, 0) 100%);
}
.city3d-root.preset-pearl-glass:not(.dark) .city3d-horizon-mist {
  background: linear-gradient(180deg, #e3eff2 0%, rgba(227, 239, 242, 0.72) 38%, rgba(227, 239, 242, 0) 100%);
}
.city3d-root.preset-jade-emerald:not(.dark) .city3d-horizon-mist {
  background: linear-gradient(180deg, #e1eee9 0%, rgba(225, 238, 233, 0.72) 38%, rgba(225, 238, 233, 0) 100%);
}
.city3d-root.dark .city3d-horizon-mist {
  background: linear-gradient(180deg, #0e131e 0%, rgba(14, 19, 30, 0.74) 38%, rgba(14, 19, 30, 0) 100%);
}
.city3d-root.preset-vermilion-seal.dark .city3d-horizon-mist {
  background: linear-gradient(180deg, #100e16 0%, rgba(16, 14, 22, 0.76) 38%, rgba(16, 14, 22, 0) 100%);
}

.city3d-mobile-hud-toggle {
  display: none;
}

.city3d-loading {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  background: radial-gradient(circle at 50% 45%, rgba(22, 32, 46, 0.86), rgba(10, 14, 22, 0.94));
  backdrop-filter: blur(8px);
}

.c3d-load-card {
  width: 300px;
  padding: 18px 20px;
  border-radius: 12px;
  background: rgba(18, 24, 36, 0.92);
  border: 1px solid rgba(240, 201, 122, 0.34);
  color: #f6f1e8;
  text-align: center;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.45);
}

.c3d-load-card strong {
  display: block;
  font-size: 13.5px;
  font-weight: 700;
  margin-bottom: 10px;
}

.c3d-load-bar {
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  overflow: hidden;
  margin-bottom: 8px;
}

.c3d-load-bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #c81e2b, #f0c97a);
  transition: width 0.2s ease;
}

.c3d-load-card span {
  font-size: 11px;
  color: rgba(226, 218, 206, 0.78);
}

.city3d-labels {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 20;
  transition: opacity 0.68s cubic-bezier(0.22, 1, 0.36, 1);
}

.city3d-labels.is-stage-hidden,
.city3d-legend.is-stage-hidden,
.city3d-ctrl.is-stage-hidden {
  opacity: 0;
  pointer-events: none;
}

.city3d-legend,
.city3d-ctrl {
  transition: opacity 0.66s cubic-bezier(0.22, 1, 0.36, 1), transform 0.66s cubic-bezier(0.22, 1, 0.36, 1);
}

.city3d-legend.is-stage-hidden,
.city3d-ctrl.is-stage-hidden {
  transform: translateY(10px);
}

.city3d-hq-tag {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 45;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px 3px 4px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(184, 28, 40, 0.95), rgba(128, 16, 26, 0.96));
  border: 1.5px solid rgba(247, 217, 152, 0.9);
  color: #fff8eb;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  box-shadow: 0 6px 20px rgba(184, 28, 40, 0.45);
  will-change: transform;
}

.hq-badge-seal {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #f5d48a;
  color: #7c1019;
  display: inline-grid;
  place-items: center;
  font-size: 10px;
  font-weight: 800;
}

.city3d-comm-tag {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px 3px 6px;
  border-radius: 5px;
  border: 1px solid rgba(255, 255, 255, 0.24);
  background: rgba(14, 20, 32, 0.88);
  color: #f6f2eb;
  font-size: 11px;
  font-weight: 680;
  white-space: nowrap;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.36);
  backdrop-filter: blur(8px);
  transition: background-color 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
  will-change: transform;
}

.city3d-root:not(.dark) .city3d-comm-tag {
  background: rgba(255, 253, 249, 0.95);
  color: #1c1818;
  border-color: rgba(60, 48, 42, 0.22);
  box-shadow: 0 3px 10px rgba(24, 20, 18, 0.15);
}

.city3d-comm-tag .tag-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #16a34a;
  flex-shrink: 0;
}
.city3d-comm-tag.h-warn .tag-dot { background: #d97706; }
.city3d-comm-tag.h-bad .tag-dot { background: #dc2626; box-shadow: 0 0 6px rgba(220, 38, 38, 0.85); }

.city3d-comm-tag .tag-chip {
  font-style: normal;
  font-size: 9.5px;
  font-weight: 650;
  padding-left: 4px;
  border-left: 1px solid rgba(255, 255, 255, 0.24);
  color: #dfd0b4;
}
.city3d-root:not(.dark) .city3d-comm-tag .tag-chip {
  border-left-color: rgba(84, 68, 58, 0.22);
  color: #5e524c;
}
.city3d-comm-tag.alert .tag-chip {
  color: #fca5a5;
}
.city3d-root:not(.dark) .city3d-comm-tag.alert .tag-chip {
  color: #c23416;
}

.city3d-comm-tag.hover {
  border-color: var(--primary, #c81e2b);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.42);
  scale: 1.12;
}
.city3d-comm-tag {
  transform-origin: 50% 100%;
}
.city3d-comm-tag.lv-lead .tag-dot { background: #2a8a5e; }
.city3d-comm-tag.lv-ok .tag-dot { background: #3d7ea6; }
.city3d-root .city3d-comm-tag.quiet {
  padding: 1px 5px;
  background: rgba(252, 249, 243, 0.83);
  color: #514c44;
  font-size: 11px;
  font-weight: 580;
  border-color: rgba(95, 80, 64, 0.21);
  box-shadow: none;
}
.city3d-root.dark .city3d-comm-tag.quiet {
  background: rgba(20, 28, 35, 0.78);
  color: #e5e1d7;
  border-color: rgba(225, 227, 228, 0.25);
}
.city3d-comm-tag .tag-staff-count {
  padding-left: 5px;
  border-left: 1px solid currentColor;
  color: #626d65;
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
}
.city3d-root.dark .tag-staff-count { color: #b1c1b6; }
.city3d-comm-tag.active .tag-staff-count { color: inherit; }
.city3d-labels.has-hover .city3d-comm-tag:not(.hover):not(.active) {
  opacity: 0.42;
}
.city3d-comm-tag {
  transition: background-color 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease, opacity 0.18s ease, scale 0.18s ease;
}
.c3d-ctrl-sep {
  width: 1px;
  height: 14px;
  margin: 0 3px;
  background: var(--ck-line, rgba(60, 48, 42, 0.18));
  flex-shrink: 0;
}

.city3d-comm-tag.active {
  background: var(--primary, #b81c28) !important;
  border-color: #f5d48a !important;
  color: #ffffff !important;
  box-shadow: 0 6px 20px rgba(184, 28, 40, 0.45);
}
.city3d-comm-tag.active .tag-chip {
  color: #fde8b8 !important;
  border-left-color: rgba(255, 255, 255, 0.34) !important;
}

.city3d-legend {
  position: absolute;
  z-index: 30;
  left: 14px;
  bottom: 14px;
  width: 242px;
  padding: 8px 11px 7px;
  border-radius: var(--r-card, 10px);
  border: var(--hair, 1px) solid var(--ck-border, rgba(255, 255, 255, 0.16));
  background: var(--ck-panel, rgba(16, 20, 30, 0.86));
  color: var(--ck-ink, #f4efe7);
  backdrop-filter: blur(18px);
  box-shadow: var(--e2);
}
.city3d-legend.is-cockpit {
  left: 332px;
  bottom: 84px;
  width: 250px;
  padding: 7px 9px 6px;
}
.city3d-legend.is-cockpit.is-theater {
  left: 16px;
  bottom: 18px;
}

.c3d-lg-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 6px;
}
.c3d-lg-head strong { font-size: 11px; font-weight: 700; color: var(--ck-ink); }
.c3d-lg-head span { font-size: 10px; color: var(--ck-faint); }

.c3d-lg-ramp {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
  margin-bottom: 6px;
}
.c3d-lg-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}
.c3d-lg-step i {
  display: block;
  width: 100%;
  height: 6px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.14);
}
.c3d-lg-step span {
  font-size: 9.5px;
  color: var(--ck-muted);
  white-space: nowrap;
}

.c3d-lg-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 5px;
  border-top: var(--hair, 1px) solid var(--ck-line);
  font-size: 9.5px;
  color: var(--ck-muted);
}
.c3d-lg-foot span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.lg-hq {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--primary, #c81e2b);
  color: #fff;
  display: inline-grid;
  place-items: center;
  font-size: 8px;
  font-weight: 700;
}
.lg-arc {
  display: inline-block;
  width: 11px;
  height: 2px;
  border-radius: 2px;
  background: #f59e0b;
}
.lg-zone {
  display: inline-block;
  width: 10px;
  height: 8px;
  border-radius: 2px;
  border: 1.5px solid #e63946;
  background: rgba(230, 57, 70, 0.18);
}

.city3d-ctrl {
  position: absolute;
  z-index: 32;
  right: 12px;
  bottom: 12px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: var(--r-control, 8px);
  border: var(--hair, 1px) solid var(--ck-border, rgba(60, 48, 42, 0.16));
  background: var(--ck-panel, rgba(255, 253, 250, 0.92));
  backdrop-filter: blur(18px);
  box-shadow: var(--e2);
}
.city3d-root.dark .city3d-ctrl {
  border-color: rgba(255, 255, 255, 0.16);
  background: rgba(16, 20, 30, 0.86);
}
.city3d-ctrl.is-cockpit {
  bottom: 120px;
  right: 356px;
  max-width: calc(100% - 760px);
  flex-wrap: nowrap;
  justify-content: flex-end;
  gap: 1.5px;
}
.city3d-ctrl.is-cockpit.is-theater {
  bottom: 54px;
  right: 16px;
  max-width: calc(100% - 260px);
}
.city3d-ctrl.is-cockpit button {
  padding: 0 5.5px;
  font-size: 10.5px;
}
.c3d-time-seg {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  padding: 1px;
  border-radius: calc(var(--r-control, 8px) - 2px);
  background: rgba(128, 148, 170, 0.12);
}
.city3d-ctrl.is-cockpit .c3d-time-seg button {
  height: 22px;
  min-width: 22px;
  padding: 0 5px;
  font-size: 10.5px;
}
.city3d-ctrl.is-cockpit .c3d-time-seg button.active.is-dusk {
  background: linear-gradient(135deg, #c96a28, #e69a38);
  color: #ffffff;
}

.city3d-ctrl button {
  height: 24px;
  padding: 0 7px;
  border: 0;
  border-radius: calc(var(--r-control, 8px) - 2px);
  background: transparent;
  color: #5c524c;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.city3d-root.dark .city3d-ctrl button {
  color: #c2ccd9;
}
.city3d-ctrl.is-cockpit button {
  color: var(--ck-muted, #c2ccd9);
}
.city3d-ctrl button:hover {
  color: #1a1718;
  background: rgba(120, 108, 96, 0.14);
}
.city3d-root.dark .city3d-ctrl button:hover,
.city3d-ctrl.is-cockpit button:hover {
  color: var(--ck-ink, #ffffff);
  background: rgba(148, 163, 184, 0.18);
}
.city3d-ctrl button.active,
.city3d-ctrl.is-cockpit button.active {
  background: var(--primary, #b81c28);
  color: var(--on-primary, #ffffff);
}

.city3d-hint {
  position: absolute;
  z-index: 30;
  left: 12px;
  top: 10px;
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(255, 253, 249, 0.9);
  border: 1px solid rgba(60, 48, 42, 0.18);
  color: #3f3632;
  font-size: 11px;
  font-weight: 600;
  backdrop-filter: blur(10px);
  pointer-events: none;
}
.city3d-root.dark .city3d-hint {
  background: rgba(15, 20, 30, 0.78);
  border-color: rgba(255, 255, 255, 0.16);
  color: rgba(242, 237, 229, 0.88);
}

@media (min-width: 1101px) and (max-width: 1520px) {
  .city3d-ctrl.is-cockpit:not(.is-theater) {
    max-width: calc(100% - 880px);
    flex-wrap: wrap;
    justify-content: flex-end;
  }
}

@media (max-width: 1520px) {
  .city3d-legend.is-cockpit:not(.is-theater) {
    left: 308px;
    bottom: 82px;
    width: 228px;
    padding: 6px 8px;
  }
  .city3d-legend.is-cockpit:not(.is-theater) .c3d-lg-layers button {
    padding: 0 2px;
    font-size: 9.5px;
    gap: 2px;
  }
  .city3d-ctrl.is-cockpit:not(.is-theater) {
    bottom: 120px;
    right: 328px;
  }
  .city3d-ctrl.is-cockpit button {
    padding: 0 5px;
  }
}

@media (min-width: 1101px) and (max-width: 1360px) {
  .city3d-legend.is-cockpit:not(.is-theater) {
    left: 300px;
    width: 222px;
  }
  .city3d-ctrl.is-cockpit:not(.is-theater) {
    right: 318px;
    max-width: calc(100% - 856px);
  }
}

.city3d-root.mode-single {
  min-height: 180px;
}

.city3d-ctrl.is-mini {
  right: 8px;
  bottom: 8px;
  padding: 2px;
}
.city3d-ctrl.is-mini button {
  height: 22px;
  padding: 0 6px;
  font-size: 10.5px;
}

/* 单点事件精准定位顶部地址条与浮标 */
.city3d-single-addr {
  position: absolute;
  z-index: 30;
  left: 10px;
  top: 8px;
  max-width: calc(100% - 20px);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(255, 253, 250, 0.94);
  border: 1px solid rgba(42, 34, 30, 0.16);
  color: #1f1a18;
  font-size: 11px;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.12);
  pointer-events: none;
}
.city3d-root.dark .city3d-single-addr {
  background: rgba(14, 20, 32, 0.88);
  border-color: rgba(255, 255, 255, 0.18);
  color: #f3efe8;
}
.city3d-single-addr strong {
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.city3d-single-addr .sa-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--primary, #c81e2b);
  flex-shrink: 0;
}
.city3d-single-addr .sa-coord {
  font-size: 10px;
  color: #6b635e;
  padding-left: 6px;
  border-left: 1px solid rgba(120, 110, 100, 0.22);
  white-space: nowrap;
  flex-shrink: 0;
}
.city3d-root.dark .city3d-single-addr .sa-coord {
  color: #a8b5c8;
}

.city3d-single-tag {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 42;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 6px;
  background: rgba(255, 253, 250, 0.96);
  color: #1c1818;
  border: 1.5px solid #ef4444;
  font-size: 11px;
  font-weight: 680;
  white-space: nowrap;
  box-shadow: 0 5px 16px rgba(0, 0, 0, 0.22);
}
.city3d-single-tag.tone-warn { border-color: #d97706; }
.city3d-single-tag.tone-ok { border-color: #16a34a; }
.city3d-single-tag .st-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ef4444;
}
.city3d-single-tag.tone-warn .st-dot { background: #d97706; }
.city3d-single-tag.tone-ok .st-dot { background: #16a34a; }
.city3d-single-tag em {
  font-style: normal;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: #fee2e2;
  color: #b91c1c;
}
.city3d-single-tag.tone-warn em { background: #fef3c7; color: #b45309; }
.city3d-single-tag.tone-ok em { background: #dcfce7; color: #15803d; }

/* 巡查轨迹防碰撞节点浮标 */
.city3d-patrol-tag {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px 3px 4px;
  border-radius: 999px;
  border: 1.5px solid #ffffff;
  background: #475569;
  color: #ffffff;
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
  transition: transform 0.14s ease, background-color 0.14s ease;
}
.city3d-patrol-tag.compact {
  padding: 2px;
  width: 24px;
  height: 24px;
  justify-content: center;
}
.city3d-patrol-tag .pt-num {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.22);
  display: inline-grid;
  place-items: center;
  font-size: 10px;
  font-weight: 700;
}
.city3d-patrol-tag.compact .pt-num {
  background: transparent;
}
.city3d-patrol-tag.reached {
  background: #15803d;
}
.city3d-patrol-tag.cur {
  background: #1d4ed8;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.32), 0 5px 14px rgba(0, 0, 0, 0.32);
}
.city3d-patrol-tag.anom {
  background: #c81e2b;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.32), 0 5px 16px rgba(185, 28, 28, 0.4);
}

/* 数字武装 5 专题 3D 浮标 */
.city3d-armed-tag {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 5px;
  border: 1.5px solid rgba(255, 255, 255, 0.9);
  background: #b81c28;
  color: #ffffff;
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
}
.city3d-armed-tag em {
  font-style: normal;
  font-size: 10px;
  padding-left: 5px;
  border-left: 1px solid rgba(255, 255, 255, 0.32);
  color: #fde8b8;
}
.city3d-armed-tag.t-party { background: #b81c28; border-color: #f3d7a0; }
.city3d-armed-tag.t-militia { background: #1d6945; border-left: 4px solid #c81e2b; }
.city3d-armed-tag.t-recruit-ok { background: #1b6e49; }
.city3d-armed-tag.t-recruit-mid { background: #165e8a; }
.city3d-armed-tag.t-recruit-warn { background: #b86b00; }
.city3d-armed-tag.t-mobilize { background: #b81d2a; }
.city3d-armed-tag.t-mobilize-rally { background: #c2410c; }
.city3d-armed-tag.t-edu { background: #0f6b75; border-color: #bae6fd; }
.city3d-armed-tag.active {
  box-shadow: 0 0 0 3px rgba(245, 212, 138, 0.65), 0 6px 18px rgba(0, 0, 0, 0.42);
}

/* 驾驶舱 4 类治理实体极简投影轻标签 */
.city3d-ent-tag {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px 2px 5px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.24);
  background: rgba(16, 22, 34, 0.86);
  color: #f4efe7;
  font-size: 10px;
  font-weight: 650;
  white-space: nowrap;
  cursor: pointer;
  backdrop-filter: blur(8px);
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.28);
  will-change: transform;
}
.city3d-root:not(.dark) .city3d-ent-tag {
  background: rgba(255, 253, 249, 0.94);
  color: #241e1b;
  border-color: rgba(68, 54, 46, 0.22);
  box-shadow: 0 2px 8px rgba(24, 20, 18, 0.14);
}
.city3d-ent-tag .ent-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.city3d-ent-tag.k-landmark .ent-dot { background: #d4a348; }
.city3d-ent-tag.k-estate {
  padding: 1.5px 6px 1.5px 4.5px;
  font-size: 9.5px;
  font-weight: 560;
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(15, 20, 32, 0.56);
  color: rgba(232, 236, 244, 0.86);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
}
.city3d-root:not(.dark) .city3d-ent-tag.k-estate {
  background: rgba(255, 253, 249, 0.74);
  color: #5a504b;
  border-color: rgba(84, 70, 62, 0.14);
  box-shadow: 0 1px 4px rgba(24, 20, 18, 0.07);
}
.city3d-ent-tag.k-estate .ent-dot {
  width: 4.5px;
  height: 4.5px;
  background: #8d99ae;
}
.city3d-ent-tag.k-staff .ent-dot { background: #147a6c; }
.city3d-ent-tag.k-staff-busy .ent-dot { background: #1d5fa8; }
.city3d-ent-tag.k-staff-alert .ent-dot { background: #dc2626; }
.city3d-root.dark .city3d-ent-tag.k-staff .ent-dot { background: #38d9c0; }
.city3d-root.dark .city3d-ent-tag.k-staff-busy .ent-dot { background: #5bb4ff; }
.city3d-root.dark .city3d-ent-tag.k-staff-alert .ent-dot { background: #f25c54; }
.city3d-ent-tag.k-staff-alert {
  border-color: color-mix(in srgb, #dc2626 52%, transparent);
}
.city3d-root .city3d-ent-tag:is(.k-staff, .k-staff-busy, .k-staff-alert).active {
  border-color: var(--staff-accent, #157d72);
  background: var(--ck-panel, #fffdf9);
  color: var(--ck-ink, #1c2929);
  box-shadow: 0 2px 6px rgba(20, 42, 38, 0.18);
}
.city3d-ent-tag.k-staff-busy { --staff-accent: #3674aa; }
.city3d-ent-tag.k-staff-alert { --staff-accent: #bf4641; }
.city3d-ent-tag.k-aid .ent-dot { background: #10b981; }
.city3d-ent-tag.k-flood .ent-dot { background: #0284c7; }
.city3d-ent-tag.k-fire .ent-dot { background: #ea580c; }
.city3d-ent-tag.active:not(.k-staff, .k-staff-busy, .k-staff-alert) {
  background: var(--primary, #b81c28) !important;
  border-color: #f5d48a !important;
  color: #ffffff !important;
  box-shadow: 0 5px 16px rgba(184, 28, 40, 0.4);
}

/* 单栋 3D 楼房悬停轻量名片（与驾驶舱 KPI 卡、宽抽屉三端同源：2px 礼制顶线 + 实色底板） */
.city3d-bldg-tip {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 52;
  pointer-events: none;
  min-width: 184px;
  max-width: 256px;
  padding: 7px 10px;
  border-radius: var(--r-md, 8px);
  border: var(--hair, 1px) solid var(--ck-border, rgba(60, 48, 42, 0.18));
  border-top: 2px solid var(--primary, #b81c28);
  background: var(--ck-panel-solid, #ffffff);
  color: var(--ck-ink, #1c1818);
  box-shadow: var(--e2);
  font-family: var(--font-sans, inherit);
  will-change: transform;
}
.bldg-tip-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
  margin-bottom: 2px;
}
.bldg-tip-head strong {
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bldg-tip-head em {
  font-style: normal;
  font-size: 10px;
  font-weight: 650;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(128, 148, 170, 0.14);
  color: var(--ck-muted);
  white-space: nowrap;
  flex-shrink: 0;
}
.bldg-tip-head em.alert {
  background: rgba(220, 38, 38, 0.14);
  color: var(--ck-danger, #dc2626);
}
.bldg-tip-sub {
  font-size: 10px;
  color: var(--ck-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 3D 单层亮带侧挂铭牌 */
.city3d-floor-tag {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 48;
  pointer-events: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px 2px 6px;
  border-radius: 4px;
  background: var(--ck-panel-solid, #181e2c);
  border: 1px solid color-mix(in srgb, #f4c97a 55%, var(--ck-border));
  color: var(--ck-ink, #f4efe7);
  font-size: 10.5px;
  font-weight: 700;
  white-space: nowrap;
  box-shadow: var(--e2);
  will-change: transform;
}
.city3d-floor-tag i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f4c97a;
}
.city3d-floor-tag.tone-hazard {
  border-color: rgba(239, 68, 68, 0.72);
}
.city3d-floor-tag.tone-hazard i {
  background: #ef4444;
}
.city3d-floor-tag.tone-care {
  border-color: rgba(245, 158, 11, 0.72);
}
.city3d-floor-tag.tone-care i {
  background: #f59e0b;
}

/* 左下角紧凑可筛选业务图层按钮行 */
.c3d-lg-layers {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 3px;
  padding-top: 5px;
  border-top: var(--hair, 1px) solid var(--ck-line);
}
.c3d-lg-layers button {
  height: 22px;
  padding: 0 5px;
  border-radius: 4px;
  border: 1px solid transparent;
  background: rgba(128, 148, 170, 0.10);
  color: var(--ck-muted);
  font-size: 10px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}
.c3d-lg-layers button:hover {
  color: var(--ck-ink);
  background: rgba(128, 148, 170, 0.18);
}
.c3d-lg-layers button:focus-visible {
  outline: 2px solid var(--primary, #b81c28);
  outline-offset: 1px;
}
.c3d-lg-layers button.active {
  background: var(--primary-soft, rgba(184, 28, 40, 0.14));
  border-color: color-mix(in srgb, var(--primary, #b81c28) 42%, transparent);
  color: var(--ck-ink);
}
.ly-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}
.ly-dot.d-landmarks { background: #d4a348; }
.ly-dot.d-staff { background: #137c73; }
.ly-dot.d-aid { background: #10b981; }
.ly-dot.d-eco { background: #0284c7; }

@media (max-width: 1100px) {
  .city3d-mobile-hud-toggle {
    position: absolute;
    z-index: 38;
    right: 8px;
    top: 8px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px;
    border-radius: var(--r-control, 8px);
    border: var(--hair, 1px) solid var(--ck-border, rgba(60, 48, 42, 0.16));
    background: var(--ck-panel-solid, #ffffff);
    box-shadow: var(--e2);
  }
  .city3d-mobile-hud-toggle button {
    height: 26px;
    padding: 0 8px;
    border: 0;
    border-radius: calc(var(--r-control, 8px) - 2px);
    background: transparent;
    color: var(--ck-muted, #5c524c);
    font-size: 11px;
    font-weight: 650;
    white-space: nowrap;
    cursor: pointer;
  }
  .city3d-mobile-hud-toggle button.active {
    background: var(--primary, #b81c28);
    color: var(--on-primary, #ffffff);
  }
  .city3d-legend.is-cockpit {
    display: none;
    left: 8px;
    right: 8px;
    top: 46px;
    bottom: auto;
    width: auto;
    max-width: 280px;
    margin-left: auto;
    z-index: 40;
    background: var(--ck-panel-solid, #ffffff);
  }
  .city3d-legend.is-cockpit.is-mobile-open {
    display: block;
  }
  .city3d-ctrl.is-cockpit {
    display: none;
    left: 8px;
    right: 8px;
    top: 46px;
    bottom: auto;
    max-width: calc(100% - 16px);
    flex-wrap: wrap;
    z-index: 40;
    background: var(--ck-panel-solid, #ffffff);
  }
  .city3d-ctrl.is-cockpit.is-mobile-open {
    display: inline-flex;
  }
  .city3d-ctrl.is-compact {
    left: 8px;
    right: 8px;
    bottom: 8px;
    width: auto;
    max-width: calc(100% - 16px);
    display: flex;
    flex-wrap: nowrap;
    justify-content: flex-start;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .city3d-ctrl.is-compact button {
    flex: 0 0 auto;
  }
  .city3d-ctrl.is-compact::-webkit-scrollbar {
    display: none;
  }
  .city3d-root.compact .city3d-comm-tag {
    font-size: 9.5px;
    padding: 1px 5px;
  }
  .city3d-root.compact .city3d-hq-tag {
    font-size: 9.5px;
    padding: 2px 6px;
  }
  .city3d-hint {
    max-width: calc(100% - 20px);
    font-size: 10.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .city3d-bldg-tip {
    display: none;
  }
  .city3d-comm-tag {
    font-size: 10.5px;
    padding: 2px 6px;
  }
  .city3d-hq-tag {
    font-size: 10.5px;
    padding: 3px 7px;
  }
}
</style>
