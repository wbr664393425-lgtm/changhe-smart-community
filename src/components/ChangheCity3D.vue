<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { COMMUNITIES, store } from '../store/appStore'
import { CHANGHE_OUTER_BOUNDARY, CHANGHE_LABEL_OFFSETS } from '../utils/changheGeo'
import { createCockpitWaterfront, WATER_REFLECTION_LAYER } from '../utils/cockpitWaterfront'
import amapPolyData from '../utils/changheAmapPolygons.json'
import {
  latLngToWorldXZ,
  CHANGHE_HQ_LATLNG,
  loadChangheAmapAssets,
  buildMergedAmapBuildingGeometries
} from '../utils/cityModelCache'
import {
  getCockpitBuildingIndex,
  buildEventBuildingMap,
  buildCockpitEntities
} from '../utils/cockpitBuildingIndex'

const props = defineProps({
  mode: { type: String, default: 'cockpit' }, // cockpit | portal | hub | grid | single | patrol | armed
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
  emergencyInfo: { type: Object, default: null }
})

const emit = defineEmits([
  'select-community',
  'select-event',
  'select-point',
  'select-patrol-step',
  'select-building',
  'select-entity',
  'reset-panorama',
  'webgl-fallback'
])

const rootEl = ref(null)
const canvasHost = ref(null)
const loading = ref(true)
const loadProgress = ref(20)
const webglFailed = ref(false)
const autoOrbit = ref(false)
const cameraPreset = ref('hero') // hero | park | xingkai | top
const lightingOverride = ref(null) // null（跟随驾驶舱/工作台深浅态） | 'day' | 'night'
const groundStyle = ref('amap') // amap（高德官方矢量底图·默认） | sat（卫星实景叠加）
const comparingImagery = ref(false)
const IMAGERY_LAYER = 2
const hoveredLocal = ref('')
const hoveredBuilding = ref(null) // { bldg, x, y, openCount, chip }
const hoveredPatrolIdx = ref(-1)
const projectedLabels = ref([])
const projectedEntityLabels = ref([])
const projectedSingleLabel = ref(null)
const projectedPatrolLabels = ref([])
const projectedArmedLabels = ref([])
const hqScreenPos = ref({ x: 0, y: 0, visible: false })

// 驾驶舱左下角业务图层开关（克制默认：标杆楼宇常显，其余随专题或勾选浮现）
const cockpitLayers = ref({
  landmarks: true,
  staff: false,
  aid: false,
  eco: false
})
const activeLegendLevel = ref(-1) // -1 表示全部，0..3 表示按图例聚焦某一重点类型

const isNightScene = computed(() => {
  if (lightingOverride.value === 'day') return false
  if (lightingOverride.value === 'night') return true
  return props.dark || store.preset === 'command-dark'
})
const activeHover = computed(() => hoveredLocal.value || props.hoveredCommunity)

const SLICE_PALETTES = {
  safety: {
    title: '治理体检 · 隐患态势',
    unit: '社区等级',
    ticks: ['标杆', '稳健', '关注', '督办'],
    colors: ['#10b981', '#3b82f6', '#f59e0b', '#ef4444']
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
  return openHz > 0 ? `${openHz}隐患` : '平稳'
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
let innerBldgMat = null
let outerBldgMat = null
let innerEdgeMat = null
let outerEdgeMat = null
let assetsRef = null
let cityGroup = null
let overlayGroup = null
let dynamicGroup = null
let entityGroup = null
let emergencyGroup = null
let selectionOutlineGroup = null
let outerTubeMat = null
let outerGlowMat = null
let hqBeamMat = null
let hqBeacon = null
let hqRings = []
let arcParticles = []
let alertRings = []
const zoneEntries = new Map() // name -> { polyXZ, centerXZ, borderMat, fillMesh, fillMat, selTubeMesh, selTubeMat, community }

// 驾驶舱建筑语义索引与 128×64 RGBA DataTexture（兼容所有集显，零新增 DrawCall 动态着色）
const SEM_TEX_W = 128
const SEM_TEX_H = 64
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

// 着色器统一驱动（切换日/夜与主题时瞬间平滑更新，无需重建几何体）
const bldgUniforms = {
  uBottomCol: { value: new THREE.Color('#cfd8e3') },
  uTopCol: { value: new THREE.Color('#f6f8fb') },
  uRoofCol: { value: new THREE.Color('#ffffff') },
  uLineCol: { value: new THREE.Color('#b6c4d4') },
  uNight: { value: 0 },
  uOuterBottomCol: { value: new THREE.Color('#dde4ec') },
  uOuterTopCol: { value: new THREE.Color('#f2f5f9') },
  uOuterRoofCol: { value: new THREE.Color('#f7f9fc') },
  uBldgColorTex: { value: bldgColorTex },
  uUseSemantic: { value: 0 }
}

let rafId = null
let resizeObserver = null
let intersectionObserver = null
let isRenderPaused = false
let contentSkipped = false
let narrowScreen = null
let prefersReducedMotion = false
let isDisposed = false

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
let pointerDownPos = { x: 0, y: 0 }

const camTargetPos = new THREE.Vector3()
const camTargetLook = new THREE.Vector3()
let isCamAnimating = false

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
  if (isCockpit && waterfront && (preset === 'park' || preset === 'bridge')) {
    const bridge = preset === 'bridge'
    const { x, y: z } = bridge ? waterfront.bridgeFocus : waterfront.parkFocus
    return {
      pos: bridge ? new THREE.Vector3(x + 21, 28, z + 58) : new THREE.Vector3(x - 13, 72, z + 87),
      look: new THREE.Vector3(x, 1, z)
    }
  }
  if (preset === 'park') {
    // 46° 端庄建筑摄影角特写长河公园大湖与周边建筑群
    const [px, pz] = latLngToWorldXZ(37.4418, 116.3485)
    return {
      pos: new THREE.Vector3(px - 28, 152, pz + 148),
      look: new THREE.Vector3(px + 6, 2, pz - 10)
    }
  }
  if (preset === 'xingkai') {
    // 46° 端庄俯瞰星凯商圈与堤口/锦绣街区
    const [sx, sz] = latLngToWorldXZ(37.4445, 116.3415)
    return {
      pos: new THREE.Vector3(sx - 30, 156, sz + 150),
      look: new THREE.Vector3(sx + 6, 2, sz - 8)
    }
  }
  if (preset === 'top') {
    return {
      pos: new THREE.Vector3(6, isCockpit ? 590 : 510, 110),
      look: new THREE.Vector3(6, 0, -10)
    }
  }
  // 默认黄金 50° 端庄鸟瞰角：上北下南对称规整，北侧德馨/杨庄/八里庄留足顶部净空不触专题研判条
  return {
    pos: new THREE.Vector3(isCockpit ? -30 : -26, isCockpit ? 438 : 365, isCockpit ? 388 : 322),
    look: new THREE.Vector3(8, 0, isCockpit ? -28 : -12)
  }
}

function animateCameraTo(pos, look) {
  camTargetPos.copy(pos)
  camTargetLook.copy(look)
  if (prefersReducedMotion && camera && controls) {
    camera.position.copy(pos)
    controls.target.copy(look)
    controls.update()
    isCamAnimating = false
    return
  }
  isCamAnimating = true
}

function applyCameraPreset(preset) {
  cameraPreset.value = preset
  if (preset === 'hero' && props.mode === 'cockpit') {
    emit('reset-panorama')
  }
  const pose = getCameraPose(preset)
  animateCameraTo(pose.pos, pose.look)
}

function toggleDayNight() {
  lightingOverride.value = isNightScene.value ? 'day' : 'night'
}

function toggleGroundStyle() {
  groundStyle.value = groundStyle.value === 'amap' ? 'sat' : 'amap'
}

function toggleImageryComparison() {
  if (!camera) return
  comparingImagery.value = !comparingImagery.value
  camera.layers.set(comparingImagery.value ? IMAGERY_LAYER : 0)
  if (comparingImagery.value) {
    clearHoveredBuilding()
    hoveredLocal.value = ''
    updateZoneStyles()
    renderer.domElement.style.cursor = 'grab'
  }
}

function resetCameraView() {
  cameraPreset.value = 'hero'
  if (props.mode === 'cockpit') {
    emit('reset-panorama')
  } else if (props.selectedCommunity !== '全街道') {
    emit('select-community', props.selectedCommunity)
  }
  const pose = getCameraPose('hero')
  animateCameraTo(pose.pos, pose.look)
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
    new THREE.Vector3(cx, 2, cz - (props.mode === 'cockpit' ? 10 : 3))
  )
}

function focusOnPointXZ(cx, cz, dist = 104, height = 108) {
  cameraPreset.value = ''
  animateCameraTo(
    new THREE.Vector3(cx - 22, height, cz + dist),
    new THREE.Vector3(cx, 3, cz - 4)
  )
}

/** 创建高德官方 3D 旗舰渐变白模 / DataV 暗黑晶格材质（保留完整 PBR 阴影与立体光照，支持零 DrawCall 专题着色） */
function createAmapBuildingMaterial(isInner) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: isInner ? 0.52 : 0.72,
    metalness: isInner ? 0.16 : 0.08,
    transparent: !isInner,
    opacity: isInner ? 0.96 : 0.78
  })

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBottomCol = isInner ? bldgUniforms.uBottomCol : bldgUniforms.uOuterBottomCol
    shader.uniforms.uTopCol = isInner ? bldgUniforms.uTopCol : bldgUniforms.uOuterTopCol
    shader.uniforms.uRoofCol = isInner ? bldgUniforms.uRoofCol : bldgUniforms.uOuterRoofCol
    shader.uniforms.uLineCol = bldgUniforms.uLineCol
    shader.uniforms.uNight = bldgUniforms.uNight
    shader.uniforms.uBldgColorTex = bldgUniforms.uBldgColorTex
    shader.uniforms.uUseSemantic = bldgUniforms.uUseSemantic

    shader.vertexShader = `
      attribute float aHeightRatio;
      attribute float aBldgId;
      varying float vHR;
      varying float vBldgId;
      varying vec3 vWPos;
      varying vec3 vWNorm;
    ` + shader.vertexShader

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vHR = aHeightRatio;
       vBldgId = aBldgId;
       vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
       vWNorm = normalize(mat3(modelMatrix) * objectNormal);`
    )

    shader.fragmentShader = `
      uniform vec3 uBottomCol;
      uniform vec3 uTopCol;
      uniform vec3 uRoofCol;
      uniform vec3 uLineCol;
      uniform float uNight;
      uniform sampler2D uBldgColorTex;
      uniform float uUseSemantic;
      varying float vHR;
      varying float vBldgId;
      varying vec3 vWPos;
      varying vec3 vWNorm;
    ` + shader.fragmentShader

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       float isRoof = step(0.65, vWNorm.y);
       // 垂直柔和渐变（底部接地沉稳，上部明亮通透）
       vec3 wallGrad = mix(uBottomCol, uTopCol, pow(clamp(vHR, 0.0, 1.0), 0.78));
       // 极其克制细腻的楼层水平玻璃线（每 0.42 单位 = 一层楼，远看干净不杂乱，近看极精致）
       float floorBand = smoothstep(0.84, 0.96, abs(sin(vWPos.y * 7.4)));
       wallGrad = mix(wallGrad, uLineCol, floorBand * ${isInner ? '0.26' : '0.12'});
       // 东西/南北立面细微明暗立体区分，强化高德 3D 建筑体块雕塑感
       float sunBias = 0.93 + 0.09 * clamp(dot(vWNorm, normalize(vec3(0.55, 0.55, 0.62))), -1.0, 1.0);
       vec3 baseCol = mix(wallGrad * sunBias, uRoofCol, isRoof);
       ${isInner ? `
       if (uUseSemantic > 0.5) {
         float bx = mod(vBldgId, 128.0) + 0.5;
         float by = floor(vBldgId / 128.0) + 0.5;
         vec4 sem = texture2D(uBldgColorTex, vec2(bx / 128.0, by / 64.0));
         if (sem.a > 0.01) {
           // 保留立面垂直渐变、楼层玻璃线和日光体块明暗，绝不糊成平涂色块
           vec3 semWall = mix(sem.rgb * 0.78, sem.rgb * 1.10, pow(clamp(vHR, 0.0, 1.0), 0.75));
           semWall = mix(semWall, uLineCol, floorBand * 0.20) * sunBias;
           vec3 semRoof = mix(sem.rgb, vec3(1.0), 0.24);
           baseCol = mix(baseCol, mix(semWall, semRoof, isRoof), sem.a);
         }
       }` : ''}
       diffuseColor.rgb = baseCol;`
    )

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
       if (uNight > 0.5) {
         float isRoofE = step(0.65, vWNorm.y);
         float topGlow = pow(clamp(vHR, 0.0, 1.0), 1.65);
         float floorGlow = smoothstep(0.86, 0.98, abs(sin(vWPos.y * 7.4)));
         // 夜间 DataV 晶格微发光：顶部柔和辉光 + 细腻楼层横丝，彻底告别死黑方块
         vec3 sideEmit = uTopCol * (0.14 + topGlow * ${isInner ? '0.36' : '0.14'}) + uLineCol * floorGlow * ${isInner ? '0.22' : '0.06'};
         vec3 roofEmit = uRoofCol * ${isInner ? '0.28' : '0.10'};
         totalEmissiveRadiance += mix(sideEmit, roofEmit, isRoofE);
         ${isInner ? `
         if (uUseSemantic > 0.5) {
           float bxE = mod(vBldgId, 128.0) + 0.5;
           float byE = floor(vBldgId / 128.0) + 0.5;
           vec4 semE = texture2D(uBldgColorTex, vec2(bxE / 128.0, byE / 64.0));
           if (semE.a > 0.35) {
             totalEmissiveRadiance += semE.rgb * (semE.a * (0.16 + topGlow * 0.16));
           }
         }` : ''}
       }`
    )
  }
  mat.customProgramCacheKey = () => `amap-3d-bldg-sem-${isInner ? 'in' : 'out'}`
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

/** 同步 6 套主题预设 × 日/夜双态 3D 建模配色与底图 */
function applyVisualTheme() {
  if (!scene || !renderer || !assetsRef) return
  const night = isNightScene.value
  const presetKey = PRESET_3D_THEMES[store.preset] ? store.preset : 'vermilion-seal'
  const t = PRESET_3D_THEMES[presetKey][night ? 'night' : 'day']
  const isSat = groundStyle.value === 'sat'

  terrainCorrection.value.set(isSat ? 0 : 1, night ? 1 : 0)
  waterfront?.setTheme(t, night, isSat ? assetsRef.satTex : null)
  bldgUniforms.uNight.value = night ? 1 : 0
  scene.background = new THREE.Color(t.bg)
  scene.fog.color.set(t.bg)
  scene.fog.density = night ? 0.00056 : 0.00046
  if (farGroundMesh) farGroundMesh.material.color.set(t.far)

  sunLight.intensity = t.sunInt
  sunLight.color.set(t.sunCol)
  fillLight.intensity = t.fillInt
  fillLight.color.set(t.fillCol)
  hemiLight.intensity = night ? 0.85 : 0.92
  hemiLight.color.set(t.hemiSky)
  hemiLight.groundColor.set(t.hemiGnd)

  bldgUniforms.uBottomCol.value.set(t.bottom)
  bldgUniforms.uTopCol.value.set(t.top)
  bldgUniforms.uRoofCol.value.set(t.roof)
  bldgUniforms.uLineCol.value.set(t.line)
  bldgUniforms.uOuterBottomCol.value.set(t.outerBottom)
  bldgUniforms.uOuterTopCol.value.set(t.outerTop)
  bldgUniforms.uOuterRoofCol.value.set(t.outerRoof)

  if (innerEdgeMat) { innerEdgeMat.color.set(t.edgeIn); innerEdgeMat.opacity = t.edgeInOp }
  if (outerEdgeMat) { outerEdgeMat.color.set(t.edgeOut); outerEdgeMat.opacity = t.edgeOutOp }
  if (outerTubeMat) outerTubeMat.color.set(t.outerLine)
  if (outerGlowMat) outerGlowMat.color.set(t.outerGlow)
  if (hqBeamMat) hqBeamMat.color.set(t.hqBeam)
  if (hqBeacon?.material) {
    hqBeacon.material.color.set(t.hqRing)
    hqBeacon.material.emissive.set(t.hqBeam)
  }
  hqRings.forEach((r) => r.mat.color.set(t.hqRing))

  if (groundMat) {
    if (isSat) {
      groundMat.map = assetsRef.satTex
      groundMat.color.set(night ? '#5a6a82' : '#ffffff')
    } else {
      groundMat.map = night ? assetsRef.darkVecTex : assetsRef.lightVecTex
      groundMat.color.set('#ffffff')
    }
    groundMat.needsUpdate = true
  }

  if (renderer.shadowMap) renderer.shadowMap.needsUpdate = true
}

function disposeGroup(grp) {
  if (!grp) return
  grp.traverse((obj) => {
    if (obj.isInstancedMesh) obj.dispose()
    if (obj.geometry && !obj.userData.sharedGeo) obj.geometry.dispose()
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
      else obj.material.dispose()
    }
  })
}

// ── 构建高德官方风格 1:1 真实多边形三维城市 ──
function buildAmap3DCity() {
  if (!scene || !assetsRef) return
  if (cityGroup) {
    waterfront?.disposeInactive()
    disposeGroup(cityGroup)
    scene.remove(cityGroup)
  }
  cityGroup = new THREE.Group()
  scene.add(cityGroup)

  const maxAniso = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4
  ;[assetsRef.lightVecTex, assetsRef.darkVecTex, assetsRef.satTex].forEach((t) => {
    if (t) t.anisotropy = maxAniso
  })

  // 1. 远景延展无缝大地
  farGroundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(4200, 4200),
    new THREE.MeshBasicMaterial({ color: '#ece9e2' })
  )
  farGroundMesh.rotation.x = -Math.PI / 2
  farGroundMesh.position.y = -0.35
  cityGroup.add(farGroundMesh)

  // 2. 1:1 精确对齐的高德官方高清矢量底图地表（3840×3584）
  const sb = amapPolyData.baseBounds
  const [xW, zN] = latLngToWorldXZ(sb.north, sb.west)
  const [xE, zS] = latLngToWorldXZ(sb.south, sb.east)
  const groundW = Math.abs(xE - xW)
  const groundD = Math.abs(zS - zN)
  const groundCX = (xW + xE) / 2
  const groundCZ = (zN + zS) / 2

  groundMat = new THREE.MeshStandardMaterial({
    map: assetsRef.lightVecTex,
    roughness: 0.94,
    metalness: 0.02
  })
  if (props.mode === 'cockpit') {
    // R 为水内岸距，G 是旧水色及滨水地表的补色权重，B 表示影像植被强度。
    groundMat.onBeforeCompile = shader => {
      shader.uniforms.uShore = { value: assetsRef.shoreDistanceTex }
      shader.uniforms.uCorrection = terrainCorrection
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uShore;\nuniform vec2 uCorrection;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec3 mask = texture2D(uShore, vMapUv).rgb;
          vec3 dayLand = mix(vec3(.86,.84,.78), vec3(.23,.39,.24), mask.b);
          vec3 nightLand = mix(vec3(.033,.045,.061), vec3(.027,.060,.048), mask.b);
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(dayLand, nightLand, uCorrection.y), mask.g*uCorrection.x);`)
    }
  }
  groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(groundW, groundD), groundMat)
  groundMesh.rotation.x = -Math.PI / 2
  groundMesh.position.set(groundCX, 0, groundCZ)
  groundMesh.receiveShadow = true
  cityGroup.add(groundMesh)

  if (props.mode === 'cockpit') {
    // 共用原地面的投影和卫星纹理，切换时保留当前相机、光照方案和业务选择。
    const imagery = new THREE.Mesh(groundMesh.geometry, new THREE.MeshBasicMaterial({
      map: assetsRef.satTex, toneMapped: false, fog: false
    }))
    imagery.userData.sharedGeo = true
    imagery.position.copy(groundMesh.position)
    imagery.rotation.copy(groundMesh.rotation)
    imagery.layers.set(IMAGERY_LAYER)
    farGroundMesh.layers.enable(IMAGERY_LAYER)
    cityGroup.add(imagery)
    waterfront = createCockpitWaterfront(xW, zN, xE, zS, assetsRef.shoreDistanceTex, compactRenderer)
    for (const light of [sunLight, fillLight, hemiLight]) light.layers.enable(WATER_REFLECTION_LAYER)
    cityGroup.add(waterfront.group)
  }

  // 3. 合批 4,205 栋精确多边形真实轮廓 3D 建筑 + 锐利屋顶轮廓棱边线
  const geos = buildMergedAmapBuildingGeometries(amapPolyData.buildings)

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

function buildCommunityOverlays() {
  if (!scene) return
  if (overlayGroup) {
    disposeGroup(overlayGroup)
    scene.remove(overlayGroup)
  }
  zoneEntries.clear()
  hqRings = []
  overlayGroup = new THREE.Group()
  scene.add(overlayGroup)

  // 1. 全街道 104 顶点双层发光外廓疆域线
  const outerPts = CHANGHE_OUTER_BOUNDARY.map(([lat, lng]) => {
    const [x, z] = latLngToWorldXZ(lat, lng)
    return new THREE.Vector3(x, 0.55, z)
  })
  const outerCurve = new THREE.CatmullRomCurve3(outerPts, true, 'catmullrom', 0.05)
  outerTubeMat = new THREE.MeshBasicMaterial({ color: 0xe63946, transparent: true, opacity: 0.92 })
  overlayGroup.add(new THREE.Mesh(new THREE.TubeGeometry(outerCurve, 260, 0.85, 6, true), outerTubeMat))

  outerGlowMat = new THREE.MeshBasicMaterial({ color: 0xf4c97a, transparent: true, opacity: 0.20, depthWrite: false })
  overlayGroup.add(new THREE.Mesh(new THREE.TubeGeometry(outerCurve, 260, 2.0, 6, true), outerGlowMat))

  // 2. 14 真实社区路网贴地分区线 + 选中态干净贴地光晕面与贴地高亮管线（彻底去除穿楼竖墙）
  COMMUNITIES.forEach((c) => {
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
  })

  // 3. 长河街道综合治理指挥中心 3D 光标（单点事件聚焦/巡查轨迹回放时隐藏，突出当前主角）
  if (props.mode !== 'single' && props.mode !== 'patrol') {
    const [hx, hz] = latLngToWorldXZ(CHANGHE_HQ_LATLNG[0], CHANGHE_HQ_LATLNG[1])
    const hqGrp = new THREE.Group()
    hqGrp.position.set(hx, 0.4, hz)

    hqBeamMat = new THREE.MeshBasicMaterial({ color: 0xd9303e, transparent: true, opacity: 0.36, side: THREE.DoubleSide, depthWrite: false })
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 1.5, 13, 16, 1, true), hqBeamMat)
    beam.position.y = 6.5
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
    hqBeacon.position.y = 14.5
    hqGrp.add(hqBeacon)

    for (let i = 0; i < 2; i++) {
      const rMat = new THREE.MeshBasicMaterial({
        color: 0xf5c869,
        transparent: true,
        opacity: 0.74,
        side: THREE.DoubleSide,
        depthWrite: false
      })
      const rMesh = new THREE.Mesh(new THREE.RingGeometry(5.5, 7.6, 48), rMat)
      rMesh.rotation.x = -Math.PI / 2
      rMesh.position.y = 0.4
      hqGrp.add(rMesh)
      hqRings.push({ mesh: rMesh, mat: rMat, phase: i * 0.5 })
    }
    overlayGroup.add(hqGrp)
  } else {
    hqBeamMat = null
    hqBeacon = null
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
  arcParticles = []
  alertRings = []
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
  const showDispatchArcs =
    props.mode !== 'cockpit' ||
    props.cockpitViewMode === 'dispatch' ||
    Boolean(props.selectedEventId)

  openEvents.forEach((ev, idx) => {
    const [ex, ez] = latLngToWorldXZ(ev.lat, ev.lng)
    const isUrgent = ev.stage === '待受理' || ev.stage === '待补充'
    const isSelectedEv = props.selectedEventId && props.selectedEventId === ev.id
    const colHex = isUrgent ? 0xdc2626 : 0xd97706

    const beamH = isSelectedEv ? 36 : isUrgent ? 28 : 22
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(isSelectedEv ? 1.0 : 0.7, isSelectedEv ? 2.2 : 1.7, beamH, 12),
      new THREE.MeshBasicMaterial({ color: colHex, transparent: true, opacity: isSelectedEv ? 0.92 : 0.72 })
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
    alertRings.push({ mesh: ring, mat: ringMat, phase: (idx * 0.25) % 1 })

    // 汇报叙事态收起常亮满屏飞线，保持 3D 建筑通透；调度态或选中具体事件时呈现光弧
    if (showDispatchArcs && (!props.selectedEventId || isSelectedEv)) {
      const endPt = new THREE.Vector3(ex, beamH * 0.68, ez)
      const dist = hqTop.distanceTo(endPt)
      const midPt = new THREE.Vector3(
        (hqTop.x + endPt.x) / 2,
        Math.max(72, 46 + dist * 0.34),
        (hqTop.z + endPt.z) / 2
      )
      const curve = new THREE.QuadraticBezierCurve3(hqTop, midPt, endPt)
      dynamicGroup.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(curve, 36, isSelectedEv ? 0.85 : 0.62, 6, false),
          new THREE.MeshBasicMaterial({ color: colHex, transparent: true, opacity: isSelectedEv ? 0.88 : 0.62 })
        )
      )

      const pMesh = new THREE.Mesh(
        new THREE.SphereGeometry(1.7, 10, 10),
        new THREE.MeshBasicMaterial({ color: isUrgent ? 0xffb3a8 : 0xffecaa })
      )
      dynamicGroup.add(pMesh)
      arcParticles.push({ mesh: pMesh, curve, t: (idx * 0.19) % 1, speed: 0.22 + (idx % 3) * 0.04 })
    }
  })

  if (props.mode === 'cockpit') {
    updateBuildingSemanticTexture()
    rebuildCockpitEntities()
    rebuildEmergencyRing()
  }
}

/** 写入 128×64 建筑语义着色纹理（克制低饱和高质感点睛，保留 85%+ 原有白模/暗夜晶格美学） */
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
  const hovIdx = hoveredBldgIndex
  const slice = props.slice
  const selComm = props.selectedCommunity
  const night = isNightScene.value
  const emgCareSet = new Set((props.emergencyInfo?.careBuildings || []).map((c) => c.index))

  // 清空所有像素（alpha=0 表示完全保留原有精调渐变白模）
  bldgColorData.fill(0)

  const setPx = (idx, r, g, b, aFloat) => {
    if (idx < 0 || idx >= SEM_TEX_W * SEM_TEX_H) return
    const off = idx * 4
    bldgColorData[off] = r
    bldgColorData[off + 1] = g
    bldgColorData[off + 2] = b
    bldgColorData[off + 3] = Math.max(0, Math.min(255, Math.round(aFloat * 255)))
  }

  const list = buildingIndexRef.buildings
  for (let i = 0; i < list.length; i++) {
    const b = list[i]
    if (!b || !b.isInner) continue

    const evs = bldgToEvents.get(i) || []
    const hasOpenEv = evs.some((e) => e.stage !== '已办结')
    const inSelComm = selComm === '全街道' || b.community === selComm

    // 1. 当前选中或悬停单栋楼：温润高亮点睛
    if (i === selIdx) {
      setPx(i, 214, 72, 62, 0.86)
      continue
    }
    if (i === hovIdx) {
      setPx(i, 212, 152, 64, 0.72)
      continue
    }

    // 2. 300m 联动圈内受波及独居高龄重点楼：柔和紫金高亮
    if (emgCareSet.has(i)) {
      setPx(i, 139, 92, 246, 0.78)
      continue
    }

    // 非锁定社区轻微压柔，突出焦点社区
    if (!inSelComm) {
      if (night) setPx(i, 18, 26, 40, 0.42)
      else setPx(i, 218, 215, 210, 0.36)
      continue
    }

    // 3. 按当前驾驶舱五章专题克制点睛（仅对真正有该业务特征的少数重点楼着色）
    if (slice === 'safety') {
      if (hasOpenEv) {
        setPx(i, 210, 56, 56, 0.84) // 红牌/在办隐患事件楼
      } else if (b.baseHazard) {
        setPx(i, 218, 134, 48, 0.62) // 待复核关注楼
      } else if (b.isLandmark) {
        setPx(i, 186, 146, 78, 0.56) // 标杆重点楼
      }
    } else if (slice === 'party') {
      if (b.isLandmark || b.category === 'public') {
        setPx(i, 188, 44, 54, 0.74) // 党群阵地与公服楼
      } else if (b.partyMembers >= 5) {
        setPx(i, 206, 98, 92, 0.48) // 党员密集红领楼栋
      }
    } else if (slice === 'economy') {
      if (b.profileKey === 'commercial' || b.revenueYi >= 3.8) {
        setPx(i, 208, 148, 46, 0.78) // 重点税源与规上楼宇
      } else if (b.category === 'commercial' || b.profileKey === 'district') {
        setPx(i, 218, 178, 98, 0.54) // 常规商务与示范商圈
      } else if (hasOpenEv) {
        setPx(i, 210, 56, 56, 0.72)
      }
    } else if (slice === 'eco') {
      if (b.floodNear) {
        setPx(i, 42, 146, 198, 0.64) // 易涝临河关注楼
      } else if (b.community === '芦李府社区' || b.community === '赵辛社区' || b.community === '岳庄社区') {
        if (b.baseHazard) setPx(i, 218, 114, 46, 0.60) // 林缘防火关注点周边
      }
    } else if (slice === 'aid') {
      if (b.elderAloneCount >= 4) {
        setPx(i, 134, 92, 214, 0.76) // 独居高龄密集关怀楼
      } else if (b.elderAloneCount >= 1) {
        setPx(i, 162, 132, 220, 0.46) // 常规关怀楼
      }
    }
  }

  bldgColorTex.needsUpdate = true
  rebuildSelectionOutline()
}

/** 单栋选中/悬停楼栋精确屋顶轮廓线（复用单组轻量化 LineLoop，零穿模） */
function rebuildSelectionOutline() {
  if (!scene || props.mode !== 'cockpit') return
  if (selectionOutlineGroup) {
    disposeGroup(selectionOutlineGroup)
    scene.remove(selectionOutlineGroup)
    selectionOutlineGroup = null
  }
  if (!buildingIndexRef) return
  const targets = []
  if (props.selectedBuildingIndex >= 0 && buildingIndexRef.buildings[props.selectedBuildingIndex]) {
    targets.push({ b: buildingIndexRef.buildings[props.selectedBuildingIndex], col: 0xe63946, r: 0.46 })
  }
  if (hoveredBldgIndex >= 0 && hoveredBldgIndex !== props.selectedBuildingIndex && buildingIndexRef.buildings[hoveredBldgIndex]) {
    targets.push({ b: buildingIndexRef.buildings[hoveredBldgIndex], col: 0xd99b38, r: 0.30 })
  }
  if (!targets.length) return

  selectionOutlineGroup = new THREE.Group()
  targets.forEach(({ b, col, r }) => {
    const roofPts = b.pts.map(([x, z]) => new THREE.Vector3(x, b.height + 0.35, z))
    if (roofPts.length >= 3) {
      const curve = new THREE.CatmullRomCurve3(roofPts, true, 'catmullrom', 0.02)
      selectionOutlineGroup.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(curve, Math.min(96, roofPts.length * 4), r, 5, true),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.96 })
        )
      )
      const basePts = b.pts.map(([x, z]) => new THREE.Vector3(x, 0.48, z))
      const baseCurve = new THREE.CatmullRomCurve3(basePts, true, 'catmullrom', 0.02)
      selectionOutlineGroup.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(baseCurve, Math.min(96, basePts.length * 4), r * 0.8, 5, true),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.72 })
        )
      )
    }
  })
  scene.add(selectionOutlineGroup)
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
  const showStaff = cockpitLayers.value.staff || props.cockpitViewMode === 'dispatch' || Boolean(props.emergencyInfo)
  const showAid = cockpitLayers.value.aid || props.slice === 'aid' || Boolean(props.emergencyInfo)
  const showEco = cockpitLayers.value.eco || props.slice === 'eco'
  const showLandmarks = cockpitLayers.value.landmarks

  const emgStaffIds = new Set((props.emergencyInfo?.nearbyStaff || []).map((s) => s.id))
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

  // 2. 在岗网格员（青蓝精巧定位标）
  if (showStaff) {
    cockpitEntitiesRef.gridStaff.forEach((st) => {
      const inEmg = emgStaffIds.has(st.id)
      if (!inEmg && selComm !== '全街道' && st.community !== selComm) return
      if (!cockpitLayers.value.staff && props.cockpitViewMode !== 'dispatch' && !inEmg) return
      const isSel = props.selectedEntityId === st.id
      const col = st.status === '滞留提醒' ? 0xd97706 : 0x0ea5e9
      const h = isSel || inEmg ? 16 : 11
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.38, 0.75, h, 10),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: isSel || inEmg ? 0.92 : 0.72 })
      )
      stem.position.set(st.x, h / 2 + 0.4, st.z)
      stem.userData.entityObj = st
      entityGroup.add(stem)

      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(isSel || inEmg ? 1.85 : 1.35, 12, 12),
        new THREE.MeshBasicMaterial({ color: isSel || inEmg ? 0xe0f2fe : col })
      )
      orb.position.set(st.x, h + 1.4, st.z)
      orb.userData.entityObj = st
      entityGroup.add(orb)
    })
  }

  // 3. 共享辅助站（翠绿方柱标）
  if (showAid) {
    cockpitEntitiesRef.aidStations.forEach((aid) => {
      const inEmg = emgAidIds.has(aid.id)
      if (!inEmg && selComm !== '全街道' && aid.community !== selComm) return
      if (!cockpitLayers.value.aid && props.slice !== 'aid' && !inEmg) return
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

  ;(info.nearbyStaff || []).slice(0, 1).forEach((s) => addLinkArc(s.x, s.z, 0x0ea5e9))
  ;(info.nearbyAids || []).slice(0, 1).forEach((a) => addLinkArc(a.x, a.z, 0x10b981))
  ;(info.careBuildings || []).slice(0, 3).forEach((cb) => addLinkArc(cb.cx, cb.cz, 0x8b5cf6))

  scene.add(emergencyGroup)
}

function toggleCockpitLayer(key) {
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

  zoneEntries.forEach((entry, name) => {
    const lvl = getCommunityLevel(entry.community, props.slice)
    const col = new THREE.Color(pal.colors[lvl])
    const isSel = sel === name
    const isHov = hov === name

    entry.borderMat.color.copy(col)
    entry.borderMat.opacity = isSel ? 0.95 : isHov ? 0.90 : (sel === '全街道' ? 0.62 : 0.22)

    // 仅使用贴地柔和光晕面 + 贴地加粗高亮边框，干净克制绝不穿楼
    entry.fillMesh.visible = isSel || isHov
    entry.selTubeMesh.visible = isSel || isHov
    if (isSel) {
      entry.fillMat.color.copy(col)
      entry.fillMat.opacity = isNightScene.value ? 0.16 : 0.11
      entry.selTubeMat.color.copy(col)
      entry.selTubeMat.opacity = 0.96
    } else if (isHov) {
      entry.fillMat.color.copy(col)
      entry.fillMat.opacity = isNightScene.value ? 0.10 : 0.07
      entry.selTubeMat.color.copy(col)
      entry.selTubeMat.opacity = 0.75
    }
  })
}

const tmpProj = new THREE.Vector3()
function projectXZ(x, y, z, w, h) {
  tmpProj.set(x, y, z)
  tmpProj.project(camera)
  return {
    inFront: tmpProj.z > -1 && tmpProj.z < 1,
    x: (tmpProj.x * 0.5 + 0.5) * w,
    y: (-tmpProj.y * 0.5 + 0.5) * h,
    z: tmpProj.z
  }
}

function updateProjectedLabels() {
  if (!camera || !canvasHost.value) return
  const w = canvasHost.value.clientWidth
  const h = canvasHost.value.clientHeight
  if (!w || !h) return

  const isCockpit = props.mode === 'cockpit'
  const compactDesk = typeof window !== 'undefined' && window.innerWidth <= 1520
  const narrowMap = isCockpit && window.innerWidth <= 1100
  const safeLeft = narrowMap ? 38 : isCockpit ? (compactDesk ? 316 : 338) : 24
  const safeRight = narrowMap ? w - 38 : isCockpit ? (w - (compactDesk ? 338 : 364)) : (w - 24)
  const safeTop = narrowMap ? 58 : isCockpit ? (compactDesk ? 196 : 208) : (props.compact && props.mode !== 'single' && props.mode !== 'patrol' ? 48 : 28)
  const safeBottom = narrowMap ? h - 210 : isCockpit ? (h - 92) : (h - 36)

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

  const next = []
  zoneEntries.forEach((entry, name) => {
    const c = entry.community
    const pr = projectXZ(entry.centerXZ[0], 11, entry.centerXZ[1], w, h)
    const visible = pr.inFront && pr.x >= safeLeft && pr.x <= safeRight && pr.y >= safeTop && pr.y <= safeBottom

    const isSel = props.selectedCommunity === name
    const isHov = activeHover.value === name
    const openHz = c.safety.hazards - c.safety.fixed

    next.push({
      name,
      shortName: name.replace('社区', ''),
      chip: getCommunityMetricChip(c, props.slice),
      health: c.health,
      hasAlert: props.slice === 'safety' && openHz > 0,
      isSel,
      isHov,
      x: Math.round(pr.x),
      y: Math.round(pr.y),
      zIndex: isSel ? 42 : isHov ? 34 : Math.round((1 - pr.z) * 20),
      visible: visible && (!isCockpit || !camera || camera.position.y > 135 || isSel)
    })
  })
  projectedLabels.value = next

  // 驾驶舱 4 类治理实体投影标签（按层级与勾选克制浮现，绝不遮挡画面）
  if (isCockpit && camera) {
    const camY = camera.position.y
    const eLabels = []
    const emgStaffIds = new Set((props.emergencyInfo?.nearbyStaff || []).map((s) => s.id))
    const emgAidIds = new Set((props.emergencyInfo?.nearbyAids || []).map((a) => a.id))
    const selComm = props.selectedCommunity

    if (cockpitLayers.value.landmarks) {
      cockpitEntitiesRef.landmarks.forEach((lm) => {
        if (selComm !== '全街道' && lm.community !== selComm) return
        const pr = projectXZ(lm.x, lm.y + 8, lm.z, w, h)
        if (!pr.inFront || pr.x < safeLeft || pr.x > safeRight || pr.y < safeTop || pr.y > safeBottom) return
        eLabels.push({
          key: lm.id,
          kind: 'landmark',
          text: lm.shortLabel,
          isSel: props.selectedBuildingIndex === lm.buildingIndex,
          payload: lm,
          x: Math.round(pr.x),
          y: Math.round(pr.y),
          zIndex: props.selectedBuildingIndex === lm.buildingIndex ? 46 : 33
        })
      })

      // 投影全街道真实小区标题铭牌（拉近镜头或聚焦社区时展开，纯净显示小区名）
      const maxEstates = selComm !== '全街道' ? 48 : camY <= 145 ? 48 : camY <= 215 ? 24 : 10
      ;(cockpitEntitiesRef.estates || []).slice(0, maxEstates).forEach((est) => {
        if (selComm !== '全街道' && est.community !== selComm) return
        const pr = projectXZ(est.x, est.y, est.z, w, h)
        if (!pr.inFront || pr.x < safeLeft || pr.x > safeRight || pr.y < safeTop || pr.y > safeBottom) return
        const isSel = props.selectedBuildingIndex === est.buildingIndex
        eLabels.push({
          key: est.id,
          kind: 'landmark',
          text: est.name,
          isSel,
          payload: est,
          x: Math.round(pr.x),
          y: Math.round(pr.y),
          zIndex: isSel ? 45 : 31
        })
      })
    }

    const showStaffLbl = cockpitLayers.value.staff || props.cockpitViewMode === 'dispatch' || Boolean(props.emergencyInfo)
    if (showStaffLbl) {
      cockpitEntitiesRef.gridStaff.forEach((st) => {
        const inEmg = emgStaffIds.has(st.id)
        const isSel = props.selectedEntityId === st.id
        if (!inEmg && !isSel && !cockpitLayers.value.staff && camY > 260) return
        if (!inEmg && selComm !== '全街道' && st.community !== selComm) return
        const pr = projectXZ(st.x, 18, st.z, w, h)
        if (!pr.inFront || pr.x < safeLeft || pr.x > safeRight || pr.y < safeTop || pr.y > safeBottom) return
        eLabels.push({
          key: st.id,
          kind: 'staff',
          text: inEmg ? `${st.name}·${props.emergencyInfo.nearbyStaff.find((x) => x.id === st.id)?.distMeters || 0}米` : st.shortLabel,
          isSel: isSel || inEmg,
          payload: st,
          x: Math.round(pr.x),
          y: Math.round(pr.y),
          zIndex: isSel || inEmg ? 47 : 29
        })
      })
    }

    const showAidLbl = cockpitLayers.value.aid || props.slice === 'aid' || Boolean(props.emergencyInfo)
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
          x: Math.round(pr.x),
          y: Math.round(pr.y),
          zIndex: isSel || inEmg ? 46 : 27
        })
      })
    }

    if (cockpitLayers.value.eco || props.slice === 'eco') {
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
          x: Math.round(pr.x),
          y: Math.round(pr.y),
          zIndex: isSel ? 47 : 30
        })
      })
    }

    // 简单屏幕网格防打架消隐（先登记已显示的 14 社区标牌与指挥中心红牌，再排布小区/实体标签，杜绝重叠）
    const placed = []
    if (hqScreenPos.value.visible) {
      placed.push({ x: hqScreenPos.value.x, y: hqScreenPos.value.y })
    }
    next.forEach((lb) => {
      if (lb.visible) placed.push({ x: lb.x, y: lb.y })
    })
    const kept = []
    eLabels
      .sort((a, b) => b.zIndex - a.zIndex)
      .forEach((item) => {
        const hit = placed.some((p) => Math.abs(p.x - item.x) < 86 && Math.abs(p.y - item.y) < 28)
        if (!hit || item.isSel) {
          placed.push(item)
          kept.push(item)
        }
      })
    projectedEntityLabels.value = kept
  } else {
    projectedEntityLabels.value = []
  }

  const [hx, hz] = latLngToWorldXZ(CHANGHE_HQ_LATLNG[0], CHANGHE_HQ_LATLNG[1])
  const hpr = projectXZ(hx, 18.5, hz, w, h)
  hqScreenPos.value = {
    x: Math.round(hpr.x),
    y: Math.round(hpr.y),
    visible: hpr.inFront && hpr.x >= safeLeft && hpr.x <= safeRight && hpr.y >= safeTop && hpr.y <= safeBottom
  }
}

function pickTarget(clientX, clientY) {
  if (!renderer || !camera || comparingImagery.value) return null
  const rect = renderer.domElement.getBoundingClientRect()
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(pointer, camera)

  if (entityGroup && props.mode === 'cockpit') {
    const entHits = raycaster.intersectObjects(entityGroup.children, false)
    const lmHit = entHits.find((h) => h.object.userData.landmarkObj)
    if (lmHit) return { type: 'landmark', landmark: lmHit.object.userData.landmarkObj }
    const entHit = entHits.find((h) => h.object.userData.entityObj)
    if (entHit) return { type: 'entity', entity: entHit.object.userData.entityObj }
  }

  if (dynamicGroup) {
    const dynHits = raycaster.intersectObjects(dynamicGroup.children, false)
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
}

function clearHoveredBuilding() {
  if (hoveredBldgIndex !== -1) {
    hoveredBldgIndex = -1
    hoveredBuilding.value = null
    if (props.mode === 'cockpit' && !loading.value) {
      updateBuildingSemanticTexture()
    }
  }
}

function onPointerMove(e) {
  const hit = pickTarget(e.clientX, e.clientY)
  if (hit && hit.type === 'building') {
    const b = hit.building
    const rect = canvasHost.value?.getBoundingClientRect()
    const rx = rect ? Math.min(rect.width - 220, Math.max(16, e.clientX - rect.left + 14)) : 0
    const ry = rect ? Math.min(rect.height - 96, Math.max(76, e.clientY - rect.top - 12)) : 0
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

    hoveredBuilding.value = {
      name: b.name,
      estate: b.estate || '',
      community: b.community,
      gridName: b.gridName,
      chip,
      isAlert: openCnt > 0 || b.baseHazard,
      x: Math.round(rx),
      y: Math.round(ry)
    }
    if (hoveredBldgIndex !== b.index) {
      hoveredBldgIndex = b.index
      updateBuildingSemanticTexture()
    }
    if (hoveredLocal.value !== b.community) {
      hoveredLocal.value = b.community
      updateZoneStyles()
    }
    if (renderer) renderer.domElement.style.cursor = 'pointer'
    return
  }

  clearHoveredBuilding()

  if (hit && hit.type === 'community') {
    if (hoveredLocal.value !== hit.name) {
      hoveredLocal.value = hit.name
      updateZoneStyles()
    }
    if (renderer) renderer.domElement.style.cursor = 'pointer'
  } else if (hit && (hit.type === 'event' || hit.type === 'armed' || hit.type === 'entity' || hit.type === 'landmark')) {
    if (renderer) renderer.domElement.style.cursor = 'pointer'
  } else {
    if (hoveredLocal.value) {
      hoveredLocal.value = ''
      updateZoneStyles()
    }
    if (renderer) renderer.domElement.style.cursor = 'grab'
  }
}

function onPointerUp(e) {
  const dx = e.clientX - pointerDownPos.x
  const dy = e.clientY - pointerDownPos.y
  if (dx * dx + dy * dy > 25) return
  const hit = pickTarget(e.clientX, e.clientY)
  if (!hit) return
  if (hit.type === 'landmark') {
    const b = buildingIndexRef?.buildings?.[hit.landmark.buildingIndex]
    if (b) {
      focusOnPointXZ(b.cx, b.cz, 98, 102)
      emit('select-building', b)
    }
  } else if (hit.type === 'entity') {
    focusOnPointXZ(hit.entity.x, hit.entity.z, 108, 112)
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
  if (item.kind === 'landmark') {
    const b = buildingIndexRef?.buildings?.[item.payload.buildingIndex]
    if (b) {
      focusOnPointXZ(b.cx, b.cz, 98, 102)
      emit('select-building', b)
    }
  } else {
    focusOnPointXZ(item.payload.x, item.payload.z, 108, 112)
    emit('select-entity', item.payload)
  }
}

function handleArmedLabelClick(item) {
  if (props.armedTopic !== 'education' && item.commName) {
    emit('select-community', item.commName)
  }
  emit('select-point', item.payload)
}

function onLabelHover(name) {
  hoveredLocal.value = name
  updateZoneStyles()
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

  if (compactRenderer && lastTime && now - lastTime < 1000 / 30 - 1) return
  const dt = Math.min(0.05, (now - (lastTime || now)) / 1000)
  lastTime = now

  if (isCamAnimating && controls) {
    const lerpF = 1 - Math.exp(-4.8 * dt)
    camera.position.lerp(camTargetPos, lerpF)
    controls.target.lerp(camTargetLook, lerpF)
    if (camera.position.distanceTo(camTargetPos) < 0.6 && controls.target.distanceTo(camTargetLook) < 0.6) {
      isCamAnimating = false
    }
  }

  if (controls) {
    controls.autoRotate = autoOrbit.value && !prefersReducedMotion && !comparingImagery.value
    controls.update()
  }

  if (comparingImagery.value) {
    renderer.render(scene, camera)
    return
  }

  if (waterfront) {
    const unitsPerPixel = camera.position.y / (camera.projectionMatrix.elements[5] * halfViewportHeight)
    waterfront.updateTreeDetail(unitsPerPixel)
  }
  if (!prefersReducedMotion) {
    const sec = now * 0.001
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
      r.mat.opacity = (1 - r.phase) * 0.76
    })
    arcParticles.forEach((p) => {
      p.t = (p.t + dt * p.speed) % 1
      p.curve.getPointAt(Math.min(0.999, Math.max(0, p.t)), p.mesh.position)
    })
  }

  renderer.render(scene, camera)
  updateProjectedLabels()
}

function startLoop() {
  if (isRenderPaused || loading.value || rafId !== null || webglFailed.value || isDisposed) return
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
  isRenderPaused = document.hidden || contentSkipped || (narrowScreen?.matches && props.narrowPanelOpen)
  if (isRenderPaused) stopLoop()
  else startLoop()
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
  halfViewportHeight = h / 2
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
}

function handleContextLoss() {
  if (isDisposed || props.mode !== 'cockpit') return
  stopLoop()
  webglFailed.value = true
  emit('webgl-fallback')
}

async function initScene() {
  if (!canvasHost.value) return
  prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  compactRenderer = props.mode === 'cockpit' && window.innerWidth <= 1100
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    })
  } catch {
    webglFailed.value = true
    loading.value = false
    emit('webgl-fallback')
    return
  }

  const w = canvasHost.value.clientWidth || 1080
  const h = canvasHost.value.clientHeight || 640
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
  Object.assign(sunLight.shadow.camera, {
    left: -460,
    right: 460,
    top: 460,
    bottom: -460,
    near: 80,
    far: 1450
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
  controls.minDistance = 65
  controls.maxDistance = 880
  controls.minPolarAngle = 0.16
  controls.maxPolarAngle = Math.PI * 0.45
  controls.autoRotateSpeed = 0.42
  controls.target.copy(pose.look)
  controls.update()

  renderer.domElement.style.cursor = 'grab'
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerup', onPointerUp)
  renderer.domElement.addEventListener('pointerleave', clearHoveredBuilding)

  try {
    assetsRef = await loadChangheAmapAssets((pct) => {
      loadProgress.value = pct
    })
  } catch {
    if (!isDisposed) {
      webglFailed.value = true
      loading.value = false
      emit('webgl-fallback')
    }
    return
  }

  if (isDisposed || !scene) return

  if (props.mode === 'cockpit') {
    buildingIndexRef = getCockpitBuildingIndex()
  }

  buildAmap3DCity()
  buildCommunityOverlays()
  applyVisualTheme()

  // 驾驶舱一律强制以全街道「全景鸟瞰」开场（绝不被跨页缓存的 selectedCommunity 拉近）
  if (props.mode === 'cockpit') {
    cameraPreset.value = 'hero'
    const heroPose = getCameraPose('hero')
    isCamAnimating = false
    camera.position.copy(heroPose.pos)
    controls.target.copy(heroPose.look)
    controls.update()
    updateBuildingSemanticTexture()
    rebuildCockpitEntities()
    rebuildEmergencyRing()
  } else if (props.selectedCommunity && props.selectedCommunity !== '全街道' && props.mode !== 'single' && props.mode !== 'patrol') {
    focusOnCommunity(props.selectedCommunity)
  }

  loading.value = false
  renderer.shadowMap.needsUpdate = true
  handleResize()
  handleVisibilityChange()
}

watch(() => props.narrowPanelOpen, handleVisibilityChange)

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
  () => store.preset,
  () => {
    lightingOverride.value = null
    if (!loading.value) {
      applyVisualTheme()
      updateZoneStyles()
      if (props.mode === 'cockpit') updateBuildingSemanticTexture()
    }
  }
)

watch(
  () => [isNightScene.value, groundStyle.value],
  () => {
    if (!loading.value) {
      applyVisualTheme()
      updateZoneStyles()
      if (props.mode === 'cockpit') {
        updateBuildingSemanticTexture()
        rebuildEmergencyRing()
      }
    }
  }
)

watch(
  () => [props.slice, props.events, props.cockpitViewMode, props.selectedEventId],
  () => {
    if (!loading.value) {
      updateZoneStyles()
      rebuildDynamicEvents()
    }
  },
  { deep: true }
)

watch(
  () => [props.selectedBuildingIndex, props.selectedEntityId, props.emergencyInfo],
  ([bIdx]) => {
    if (loading.value || props.mode !== 'cockpit') return
    updateBuildingSemanticTexture()
    rebuildCockpitEntities()
    rebuildEmergencyRing()
    if (typeof bIdx === 'number' && bIdx >= 0 && buildingIndexRef?.buildings?.[bIdx]) {
      const b = buildingIndexRef.buildings[bIdx]
      focusOnPointXZ(b.cx, b.cz, 98, 102)
    }
    updateProjectedLabels()
  },
  { deep: true }
)

watch(
  () => props.singleEvent?.id,
  () => {
    if (loading.value || props.mode !== 'single') return
    updateZoneStyles()
    rebuildDynamicEvents()
    const pose = getCameraPose(cameraPreset.value)
    animateCameraTo(pose.pos, pose.look)
  }
)

watch(
  () => props.patrolRecord?.id,
  () => {
    if (loading.value || props.mode !== 'patrol') return
    updateZoneStyles()
    rebuildDynamicEvents()
    const pose = getCameraPose(cameraPreset.value)
    animateCameraTo(pose.pos, pose.look)
  }
)

watch(
  () => [props.patrolStepIdx, props.patrolThreshold],
  () => {
    if (loading.value || props.mode !== 'patrol') return
    rebuildDynamicEvents()
    updateProjectedLabels()
  }
)

watch(
  () => [props.armedTopic, props.mobilizeLayer, props.armedPlaces],
  () => {
    if (loading.value || props.mode !== 'armed') return
    rebuildDynamicEvents()
    updateProjectedLabels()
  },
  { deep: true }
)

watch(
  () => props.hoveredCommunity,
  () => {
    if (!loading.value) updateZoneStyles()
  }
)

watch(
  () => props.selectedCommunity,
  (val) => {
    if (loading.value) return
    if (props.mode === 'single' || props.mode === 'patrol') return
    updateZoneStyles()
    if (props.mode === 'armed') rebuildDynamicEvents()
    if (props.mode === 'cockpit') {
      updateBuildingSemanticTexture()
      rebuildCockpitEntities()
    }
    if (val && val !== '全街道') {
      focusOnCommunity(val)
    } else {
      cameraPreset.value = 'hero'
      const pose = getCameraPose('hero')
      animateCameraTo(pose.pos, pose.look)
    }
  }
)

// 驾驶舱切五章保持全景鸟瞰不动镜头，仅切换建筑专题着色与重点标识
watch(
  () => props.chapterIndex,
  () => {
    if (loading.value || props.mode !== 'cockpit') return
    updateBuildingSemanticTexture()
    rebuildCockpitEntities()
  }
)

onBeforeUnmount(() => {
  isDisposed = true
  stopLoop()
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
    renderer.domElement.removeEventListener('pointerleave', clearHoveredBuilding)
  }
  waterfront?.disposeInactive()
  ;[cityGroup, overlayGroup, dynamicGroup, entityGroup, emergencyGroup, selectionOutlineGroup].forEach((g) => {
    if (g && scene) {
      disposeGroup(g)
      scene.remove(g)
    }
  })
  controls?.dispose()
  renderer?.dispose()
  renderer?.forceContextLoss()
  if (renderer?.domElement?.parentNode) {
    renderer.domElement.parentNode.removeChild(renderer.domElement)
  }
})
</script>

<template>
  <div
    ref="rootEl"
    class="city3d-root"
    :class="['preset-' + store.preset, 'mode-' + mode, { dark: isNightScene, compact: compact || mode !== 'cockpit' }]"
  >
    <div ref="canvasHost" class="city3d-canvas"></div>

    <!-- 首次载入进度提示 -->
    <div v-if="loading" class="city3d-loading">
      <div class="c3d-load-card">
        <strong>正在加载长河街道高德实景三维白模</strong>
        <div class="c3d-load-bar"><i :style="{ width: loadProgress + '%' }"></i></div>
        <span class="num">建筑轮廓载入中 · {{ loadProgress }}%</span>
      </div>
    </div>

    <!-- 3D 实时投影悬浮铭牌层 -->
    <div v-show="!loading && !comparingImagery" class="city3d-labels" aria-label="长河街道三维实景地标">
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
        :class="['h-' + lb.health, { active: lb.isSel, hover: lb.isHov, alert: lb.hasAlert }]"
        :style="{
          transform: `translate3d(${lb.x}px, ${lb.y}px, 0) translate(-50%, -100%)`,
          zIndex: lb.zIndex
        }"
        @mouseenter="onLabelHover(lb.name)"
        @mouseleave="onLabelHover('')"
        @click="emit('select-community', lb.name)"
      >
        <i class="tag-dot"></i>
        <span class="tag-name">{{ lb.shortName }}</span>
        <em v-if="!compact || lb.isSel || lb.isHov || lb.hasAlert" class="tag-chip num">{{ lb.chip }}</em>
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
          zIndex: et.zIndex
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

    <!-- 左下角紧凑 3D 专题图例卡 -->
    <aside
      v-if="!compact && !loading && !comparingImagery && mode !== 'single' && mode !== 'patrol' && mode !== 'armed'"
      class="city3d-legend"
      :class="{ 'is-cockpit': mode === 'cockpit' }"
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
        <button type="button" :class="{ active: cockpitLayers.landmarks }" @click="toggleCockpitLayer('landmarks')">
          <i class="ly-dot d-lm"></i>标杆楼
        </button>
        <button type="button" :class="{ active: cockpitLayers.staff || cockpitViewMode === 'dispatch' }" @click="toggleCockpitLayer('staff')">
          <i class="ly-dot d-st"></i>网格员
        </button>
        <button type="button" :class="{ active: cockpitLayers.aid || slice === 'aid' }" @click="toggleCockpitLayer('aid')">
          <i class="ly-dot d-aid"></i>辅助站
        </button>
        <button type="button" :class="{ active: cockpitLayers.eco || slice === 'eco' }" @click="toggleCockpitLayer('eco')">
          <i class="ly-dot d-eco"></i>汛火点
        </button>
      </div>
      <div v-else class="c3d-lg-foot">
        <span><b class="lg-hq">中</b>指挥中心</span>
        <span><b class="lg-arc"></b>调度光弧</span>
        <span><b class="lg-zone"></b>社区路网界线</span>
      </div>
    </aside>

    <!-- 三维视角与高德日/夜白模控制胶囊（单点/巡查自动精简避免拥挤） -->
    <div
      v-if="!loading"
      class="city3d-ctrl"
      :class="{ 'is-cockpit': mode === 'cockpit', 'is-compact': compact, 'is-mini': mode === 'single' || mode === 'patrol' }"
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
      <template v-else>
        <button type="button" :class="{ active: cameraPreset === 'hero' }" @click="applyCameraPreset('hero')">全景鸟瞰</button>
        <button type="button" :class="{ active: cameraPreset === 'park' }" @click="applyCameraPreset('park')">长河公园</button>
        <button v-if="mode === 'cockpit'" type="button" :class="{ active: cameraPreset === 'bridge' }" @click="applyCameraPreset('bridge')">岔河桥景</button>
        <button type="button" :class="{ active: cameraPreset === 'xingkai' }" @click="applyCameraPreset('xingkai')">星凯商圈</button>
        <button type="button" :class="{ active: cameraPreset === 'top' }" @click="applyCameraPreset('top')">正射俯瞰</button>
        <button v-if="!comparingImagery" type="button" @click="toggleDayNight">{{ isNightScene ? '日景白模' : '暗夜晶格' }}</button>
        <button v-if="!comparingImagery" type="button" @click="toggleGroundStyle">{{ groundStyle === 'amap' ? '叠加卫星' : '纯净矢量' }}</button>
        <button v-if="mode === 'cockpit'" type="button" aria-label="影像对照" :aria-pressed="comparingImagery"
          :class="{ active: comparingImagery }" @click="toggleImageryComparison">{{ comparingImagery ? '返回模型' : '影像对照' }}</button>
        <button v-if="!comparingImagery" type="button" :class="{ active: autoOrbit }" @click="autoOrbit = !autoOrbit">
          {{ autoOrbit ? '暂停' : '环绕' }}
        </button>
        <button type="button" @click="resetCameraView">复位</button>
      </template>
    </div>

    <!-- 嵌入工作台左上角轻提示 -->
    <div v-if="compact && !loading && mode !== 'single' && mode !== 'patrol'" class="city3d-hint">
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

.city3d-root.dark {
  background: #0e131e;
}

.city3d-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
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
  bottom: 158px;
  right: 356px;
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
  .city3d-ctrl.is-cockpit {
    max-width: calc(100% - 636px);
    flex-wrap: wrap;
    justify-content: flex-end;
  }
}

@media (max-width: 1520px) {
  .city3d-legend.is-cockpit {
    left: 308px;
    bottom: 82px;
    width: 226px;
    padding: 6px 9px;
  }
  .city3d-ctrl.is-cockpit {
    bottom: 152px;
    right: 328px;
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
.city3d-ent-tag.k-staff .ent-dot { background: #0ea5e9; }
.city3d-ent-tag.k-aid .ent-dot { background: #10b981; }
.city3d-ent-tag.k-flood .ent-dot { background: #0284c7; }
.city3d-ent-tag.k-fire .ent-dot { background: #ea580c; }
.city3d-ent-tag.active {
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

/* 左下角紧凑可筛选业务图层按钮行 */
.c3d-lg-layers {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 3px;
  padding-top: 5px;
  border-top: var(--hair, 1px) solid var(--ck-line);
}
.c3d-lg-layers button {
  height: 20px;
  padding: 0 2px;
  border-radius: 4px;
  border: 1px solid transparent;
  background: rgba(128, 148, 170, 0.10);
  color: var(--ck-muted);
  font-size: 9.5px;
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
.ly-dot.d-lm { background: #d4a348; }
.ly-dot.d-st { background: #0ea5e9; }
.ly-dot.d-aid { background: #10b981; }
.ly-dot.d-eco { background: #0284c7; }
</style>
