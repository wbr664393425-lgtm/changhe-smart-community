<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { COMMUNITIES, store } from '../store/appStore'
import {
  CHANGHE_OUTER_BOUNDARY,
  CHANGHE_PARKS,
  CHANGHE_SURROUND_BLOCKS,
  CHANGHE_NEIGHBORS,
  CHANGHE_LABEL_OFFSETS
} from '../utils/changheGeo'

const props = defineProps({
  mode: { type: String, default: 'cockpit' }, // cockpit | hub | grid | armed | patrol | single
  baseMode: { type: String, default: 'gov' }, // gov（2.5D 治理政务沙盘） | aerial（卫星影像） | street（电子路网） | vector
  dark: { type: Boolean, default: false },
  showBaseSwitch: { type: Boolean, default: true },
  selectedCommunity: { type: String, default: '全街道' },
  hoveredCommunity: { type: String, default: '' },
  slice: { type: String, default: 'safety' }, // safety | party | economy | eco | aid
  events: { type: Array, default: () => [] },
  armedTopic: { type: String, default: 'party' }, // party | militia | recruit | mobilize | education
  mobilizeLayer: { type: String, default: 'both' }, // both | rally | veteran
  armedPlaces: { type: Array, default: () => [] },
  patrolRecord: { type: Object, default: null },
  patrolStepIdx: { type: Number, default: 0 },
  patrolThreshold: { type: Number, default: 30 },
  boxSelectActive: { type: Boolean, default: false },
  singleEvent: { type: Object, default: null },
  focusCoord: { type: Array, default: null },
  liveStaff: { type: Array, default: () => [] },
  staffLayerActive: { type: Boolean, default: false },
  staffCommunityCounts: { type: Object, default: null },
  staffStatusFocus: { type: String, default: 'all' },
  selectedStaffId: { type: String, default: '' }
})

const emit = defineEmits(['select-community', 'select-event', 'select-point', 'select-staff', 'select-staff-community', 'box-selected', 'update:baseMode'])

const mapEl = ref(null)
const internalBase = ref(props.baseMode === 'vector' ? 'gov' : props.baseMode)
const effectiveBase = computed(() => (store.xinchuang.offlineSimulated ? 'gov' : internalBase.value))
const effectiveDark = computed(() => props.dark || store.preset === 'command-dark')
const scaleLabel = ref('1 公里')

let map = null
let tileLayer = null
let labelTileLayer = null
let vectorGroup = null
let polyGroup = null
let roadBlockGroup = null
let dataGroup = null
let staffGroup = null
const staffMarkers = new Map()
const staffIcon = L.divIcon({
  className: 'geo-staff-marker',
  html: '<span class="geo-staff-pin" aria-hidden="true"><i class="geo-staff-mini"></i><i class="geo-staff-portrait"></i></span>',
  iconSize: [28, 32],
  iconAnchor: [14, 28]
})
let initialFitTimer = 0
let portraitBlend = -1
let showStreetStaff = false
let boxRectLayer = null
let dragStartLatLng = null
let resizeObserver = null
let communityLabelItems = []
const polyLayerMap = new Map()

const HQ_COORD = [37.44875, 116.36286]

// 分级道路网：一级主干道采用双线描边 + 路名胶囊牌，二级干道轻描骨架
const ROADS = [
  { name: '天衢东路', primary: true, labelIdx: 0, coords: [[37.4547, 116.326], [37.4526, 116.3494], [37.4519, 116.382]] },
  { name: '三八东路', primary: true, labelIdx: 0, coords: [[37.4504, 116.326], [37.4474, 116.3493], [37.4462, 116.382]] },
  { name: '东方红东路', primary: true, labelIdx: 0, coords: [[37.4465, 116.324], [37.4406, 116.3492], [37.4374, 116.382]] },
  { name: '东风东路', primary: true, labelIdx: 0, coords: [[37.4310, 116.318], [37.4304, 116.3493], [37.4300, 116.382]] },
  { name: '长河大道', primary: true, labelIdx: 0, coords: [[37.4660, 116.3494], [37.4474, 116.3493], [37.4160, 116.3488]] },
  { name: '大学东路', primary: false, labelIdx: 0, coords: [[37.4642, 116.326], [37.4622, 116.3494], [37.4606, 116.382]] },
  { name: '新河东路', primary: false, labelIdx: 0, coords: [[37.4235, 116.316], [37.4186, 116.3487], [37.4182, 116.382]] },
  { name: '岔河东大道', primary: false, labelIdx: 0, coords: [[37.4660, 116.3385], [37.4504, 116.3294], [37.4350, 116.3215], [37.4220, 116.3180]] },
  { name: '康博大道', primary: false, labelIdx: 0, coords: [[37.4650, 116.3584], [37.4400, 116.3580], [37.4160, 116.3578]] },
  { name: '晶华大道', primary: false, labelIdx: 0, coords: [[37.4640, 116.3730], [37.4400, 116.3725], [37.4150, 116.3718]] }
]

const RIVERS = [
  { name: '岔河水系', width: 17, labelIdx: 1, coords: [[37.4710, 116.3378], [37.4540, 116.3290], [37.4410, 116.3220], [37.4240, 116.3155], [37.4090, 116.3118]] },
  { name: '减河生态带', width: 15, labelIdx: 1, coords: [[37.4710, 116.3822], [37.4420, 116.3832], [37.4090, 116.3842]] }
]

// 5 专题矿彩低饱和分级色阶（浅色宣瓷 / 深色指挥舱）
const SLICE_PALETTES = {
  safety: {
    title: '治理体检 · 隐患态势',
    unit: '社区等级',
    ticks: ['标杆', '稳健', '关注', '督办'],
    light: ['#cbe4d6', '#e6efe0', '#f5d79b', '#e8947d'],
    dark: ['#174d41', '#1c3844', '#6e4d18', '#7a2622'],
    selStroke: ['#a81b26', '#f3d7a0']
  },
  party: {
    title: '党建引领 · 在册党员',
    unit: '人',
    ticks: ['<140', '140+', '170+', '210+'],
    light: ['#f7e6df', '#eec4b6', '#dc8c7a', '#c44b42'],
    dark: ['#3a1e24', '#5c262d', '#852e34', '#b3363b'],
    selStroke: ['#8f131d', '#f7d99c']
  },
  economy: {
    title: '经济脉动 · 规上产值',
    unit: '亿元',
    ticks: ['<10', '10+', '14+', '20+'],
    light: ['#f6ecd6', '#ebd29e', '#d9ae63', '#be8632'],
    dark: ['#2e2618', '#4f3d1d', '#785921', '#a67828'],
    selStroke: ['#8a560f', '#f6d48b']
  },
  eco: {
    title: '生态防汛 · 风险指数',
    unit: '点位',
    ticks: ['平稳', '常规', '关注', '重点'],
    light: ['#d8ece2', '#a8d5c2', '#6db4a8', '#3b8994'],
    dark: ['#133832', '#185249', '#1e6e68', '#248a8a'],
    selStroke: ['#125963', '#6ee7d8']
  },
  aid: {
    title: '民情守护 · 重点关怀',
    unit: '人',
    ticks: ['<120', '120+', '135+', '150+'],
    light: ['#eae4f2', '#d1c4e4', '#ad98cf', '#826ab3'],
    dark: ['#262138', '#392f54', '#514178', '#6e56a1'],
    selStroke: ['#533b87', '#c8b6f2']
  }
}

const currentLegend = computed(() => {
  const pal = SLICE_PALETTES[props.slice] || SLICE_PALETTES.safety
  return {
    title: pal.title,
    unit: pal.unit,
    ticks: pal.ticks,
    colors: effectiveDark.value ? pal.dark : pal.light
  }
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
  // safety 默认治理体检
  const openHz = c.safety.hazards - c.safety.fixed
  if (c.health === 'bad') return 3
  if (c.health === 'warn') return 2
  if (c.safety.coverage >= 98 && openHz === 0) return 0
  return 1
}

function getCommunityMetricChip(c, slice) {
  if (slice === 'party') return `${c.party}党员`
  if (slice === 'economy') return `${c.biz.revenue}亿`
  if (slice === 'eco') return `涝${c.env.floodPts}火${c.env.firePts}`
  if (slice === 'aid') {
    const sum = c.special.elderAlone + c.special.lowIncome + c.special.disabled + c.special.veteran
    return `${sum}关怀`
  }
  const openHz = c.safety.hazards - c.safety.fixed
  return openHz > 0 ? `${openHz}隐患` : '平稳'
}

function buildQuadraticArc(from, to, curveOffset = 0.0032, steps = 18) {
  const midLat = (from[0] + to[0]) / 2 + curveOffset
  const midLng = (from[1] + to[1]) / 2 + (to[1] >= from[1] ? 0.0012 : -0.0012)
  const pts = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const inv = 1 - t
    const lat = inv * inv * from[0] + 2 * inv * t * midLat + t * t * to[0]
    const lng = inv * inv * from[1] + 2 * inv * t * midLng + t * t * to[1]
    pts.push([lat, lng])
  }
  return pts
}

function updateScaleBar() {
  if (!map) return
  const center = map.getCenter()
  const pt1 = map.latLngToContainerPoint(center)
  const pt2 = L.point(pt1.x + 60, pt1.y)
  const dist = center.distanceTo(map.containerPointToLatLng(pt2))
  if (dist >= 1000) {
    const km = dist >= 2500 ? Math.round(dist / 1000) : (dist / 1000).toFixed(1)
    scaleLabel.value = `${km} 公里`
  } else {
    const m = Math.max(50, Math.round(dist / 50) * 50)
    scaleLabel.value = `${m} 米`
  }
}

function getCockpitPadding() {
  if (props.mode !== 'cockpit') return { padTL: [26, 26], padBR: [26, 26] }
  const compact = typeof window !== 'undefined' && window.innerWidth <= 1520
  return {
    padTL: compact ? [304, 140] : [330, 148],
    padBR: compact ? [326, 90] : [354, 92]
  }
}

function layoutCommunityLabels() {
  if (!map || !communityLabelItems.length) return
  const placed = []
  if (props.mode === 'cockpit' || props.mode === 'grid' || props.mode === 'hub') {
    const hqPt = map.latLngToContainerPoint(HQ_COORD)
    placed.push({ x: hqPt.x, y: hqPt.y + 8, bw: 80, bh: 48 })
  }
  const cands = [
    [0, 0],
    [0, -28],
    [0, 28],
    [-46, -24],
    [46, -24],
    [-46, 24],
    [46, 24],
    [82, 0],
    [-82, 0],
    [0, -56],
    [0, 56],
    [82, -30],
    [-82, -30],
    [82, 30],
    [-82, 30],
    [0, -84],
    [0, 84],
    [-108, -26],
    [108, -26]
  ]
  const hits = (cx, cy, bw, bh) =>
    placed.some((p) => Math.abs(cx - p.x) < (bw + p.bw) * 0.5 + 5 && Math.abs(cy - p.y) < (bh + p.bh) * 0.5 + 4)

  const sorted = [...communityLabelItems].sort((a, b) => (b.isSel ? 1 : 0) - (a.isSel ? 1 : 0))
  sorted.forEach((item) => {
    const anchorPt = map.latLngToContainerPoint(item.baseLatLng)
    let chosenX = anchorPt.x
    let chosenY = anchorPt.y
    for (const [dx, dy] of cands) {
      const tx = anchorPt.x + dx
      const ty = anchorPt.y + dy
      if (!hits(tx, ty, item.bw, item.bh)) {
        chosenX = tx
        chosenY = ty
        break
      }
    }
    placed.push({ x: chosenX, y: chosenY, bw: item.bw, bh: item.bh })
    item.marker.setLatLng(map.containerPointToLatLng([chosenX, chosenY]))
  })
}

function setBase(mode) {
  internalBase.value = mode
  emit('update:baseMode', mode)
}

function drawGovernanceBase() {
  if (!vectorGroup) return
  vectorGroup.clearLayers()
  const isDark = effectiveDark.value
  const isVermilion = store.preset === 'vermilion-seal'
  const isJade = store.preset === 'jade-emerald'

  // 1. 周边非辖区低对比街区肌理（打破白纸孤岛感）
  const blockFill = isDark
    ? (isVermilion ? '#17141b' : '#131a29')
    : (isVermilion ? '#e4dcd0' : isJade ? '#d7e3dd' : '#dce4ef')
  const blockLine = isDark ? 'rgba(255,255,255,0.035)' : 'rgba(110,92,80,0.08)'
  CHANGHE_SURROUND_BLOCKS.forEach((poly) => {
    L.polygon(poly, {
      color: blockLine,
      weight: 0.7,
      fillColor: blockFill,
      fillOpacity: isDark ? 0.62 : 0.46,
      interactive: false
    }).addTo(vectorGroup)
  })

  // 2. 虚线测绘经纬网与四邻极淡方位注记
  const gridCol = isDark
    ? (isVermilion ? 'rgba(232,204,154,0.075)' : 'rgba(120,165,215,0.085)')
    : (isVermilion ? 'rgba(108,82,70,0.095)' : 'rgba(46,72,108,0.09)')
  for (let lat = 37.408; lat <= 37.476; lat += 0.008) {
    L.polyline([[lat, 116.298], [lat, 116.404]], { color: gridCol, weight: 0.7, dashArray: '2 6', interactive: false }).addTo(vectorGroup)
  }
  for (let lng = 116.304; lng <= 116.402; lng += 0.010) {
    L.polyline([[37.404, lng], [37.478, lng]], { color: gridCol, weight: 0.7, dashArray: '2 6', interactive: false }).addTo(vectorGroup)
  }

  const neighborCol = isDark ? 'rgba(196,204,218,0.28)' : 'rgba(110,94,84,0.44)'
  CHANGHE_NEIGHBORS.forEach((nb) => {
    L.marker(nb.coord, {
      interactive: false,
      icon: L.divIcon({
        className: '',
        html: `<div style="color:${neighborCol};font-size:10.5px;font-weight:600;letter-spacing:0.22em;white-space:nowrap;pointer-events:none">${nb.name}</div>`,
        iconSize: [90, 16],
        iconAnchor: [45, 8]
      })
    }).addTo(vectorGroup)
  })

  // 3. 三层复合双水系（滨水生态绿带 + 主水域 + 慢速流向高光纹）
  const riverGreen = isDark ? 'rgba(24,84,70,0.38)' : 'rgba(146,192,162,0.34)'
  const riverBank = isDark ? '#2d769b' : '#6eaac9'
  const riverWater = isDark ? '#1a4c6b' : '#9ed1e7'
  const riverFlow = isDark ? 'rgba(112,206,244,0.45)' : 'rgba(255,255,255,0.72)'
  const riverLbl = isDark ? '#82cde8' : '#1b6685'
  RIVERS.forEach((rv) => {
    L.polyline(rv.coords, { color: riverGreen, weight: rv.width + 18, lineCap: 'round', interactive: false }).addTo(vectorGroup)
    L.polyline(rv.coords, { color: riverBank, weight: rv.width + 2, opacity: 0.85, lineCap: 'round', interactive: false }).addTo(vectorGroup)
    L.polyline(rv.coords, { color: riverWater, weight: rv.width, opacity: 0.92, lineCap: 'round', interactive: false }).addTo(vectorGroup)
    L.polyline(rv.coords, { color: riverFlow, weight: 2, dashArray: '10 14', className: 'river-flow', lineCap: 'round', interactive: false }).addTo(vectorGroup)
    const mid = rv.coords[rv.labelIdx]
    L.marker(mid, {
      interactive: false,
      icon: L.divIcon({
        className: '',
        html: `<div style="color:${riverLbl};font-size:10px;font-weight:700;white-space:nowrap;letter-spacing:0.1em;text-shadow:${isDark ? '0 1px 4px rgba(0,0,0,0.7)' : '0 1px 2px rgba(255,255,255,0.95)'}">≈ ${rv.name}</div>`,
        iconSize: [78, 16],
        iconAnchor: [39, 8]
      })
    }).addTo(vectorGroup)
  })

  // 4. 外围与滨水公园湿地绿地斑块（位于沙盘外侧的先绘制）
  const parkFill = isDark ? '#143d34' : '#b7d9bf'
  const parkEdge = isDark ? '#276b5b' : '#76a985'
  const parkTxt = isDark ? 'rgba(128,214,182,0.78)' : 'rgba(42,108,68,0.82)'
  CHANGHE_PARKS.filter((p) => p.name !== '长河公园' && p.name !== '太阳湖绿心').forEach((pk) => {
    L.polygon(pk.polygon, {
      color: parkEdge,
      weight: 0.9,
      dashArray: '3 3',
      fillColor: parkFill,
      fillOpacity: isDark ? 0.50 : 0.45,
      interactive: false
    }).addTo(vectorGroup)
    if (pk.showLabel) {
      L.marker(pk.labelPos, {
        interactive: false,
        icon: L.divIcon({
          className: '',
          html: `<div style="color:${parkTxt};font-size:9.5px;font-weight:650;white-space:nowrap;pointer-events:none">${pk.name}</div>`,
          iconSize: [76, 14],
          iconAnchor: [38, 7]
        })
      }).addTo(vectorGroup)
    }
  })

  // 5. 5 层阶梯 2.5D 立体沙盘底座（漫射远影 → 接触压边影 → 下斜切侧壁 → 上斜切侧壁 → 顶面承托底板）
  const shiftPoly = (dLat, dLng) => CHANGHE_OUTER_BOUNDARY.map(([lat, lng]) => [lat + dLat, lng + dLng])

  const farShadow = isDark ? '#000000' : (isVermilion ? '#3a261f' : '#1c304a')
  const nearShadow = isDark ? '#02060d' : (isVermilion ? '#5e3529' : '#1d4375')
  const sideDeepFill = isDark
    ? (isVermilion ? '#3d1a21' : isJade ? '#0e3b33' : '#162b4d')
    : (isVermilion ? '#b98774' : isJade ? '#6ea698' : '#7fa1cb')
  const sideDeepEdge = isDark
    ? (isVermilion ? '#612832' : isJade ? '#1a5c50' : '#244578')
    : (isVermilion ? '#9e5a4a' : isJade ? '#487f72' : '#537cb0')
  const sideMidFill = isDark
    ? (isVermilion ? '#5c252f' : isJade ? '#16584c' : '#234374')
    : (isVermilion ? '#d8b3a2' : isJade ? '#9ec9be' : '#a8c3e4')
  const sideMidEdge = isDark
    ? (isVermilion ? '#8a3946' : isJade ? '#257d6c' : '#3562a6')
    : (isVermilion ? '#c47a68' : isJade ? '#6ea698' : '#7ba3d4')
  const topPlateFill = isDark
    ? (isVermilion ? '#1b151a' : isJade ? '#0f241f' : '#121d30')
    : (isVermilion ? '#fbf7f2' : '#f7faff')

  L.polygon(shiftPoly(-0.0038, 0.0012), { color: 'transparent', fillColor: farShadow, fillOpacity: isDark ? 0.52 : 0.11, interactive: false }).addTo(vectorGroup)
  L.polygon(shiftPoly(-0.0024, 0.0007), { color: 'transparent', fillColor: nearShadow, fillOpacity: isDark ? 0.72 : 0.18, interactive: false }).addTo(vectorGroup)
  L.polygon(shiftPoly(-0.0015, 0.0004), { color: sideDeepEdge, weight: 1.2, fillColor: sideDeepFill, fillOpacity: isDark ? 0.96 : 0.90, interactive: false }).addTo(vectorGroup)
  L.polygon(shiftPoly(-0.0007, 0.0002), { color: sideMidEdge, weight: 1.2, fillColor: sideMidFill, fillOpacity: isDark ? 0.98 : 0.94, interactive: false }).addTo(vectorGroup)
  L.polygon(CHANGHE_OUTER_BOUNDARY, { color: 'transparent', fillColor: topPlateFill, fillOpacity: 1, interactive: false }).addTo(vectorGroup)
}

function drawCityMicroBlocks() {
  if (!roadBlockGroup || effectiveBase.value !== 'gov') return
  const isDark = effectiveDark.value
  const isVermilion = store.preset === 'vermilion-seal'
  const isJade = store.preset === 'jade-emerald'

  const shadowFill = isDark ? 'rgba(2,6,14,0.62)' : 'rgba(64,48,40,0.16)'
  const roofFill = isDark
    ? (isVermilion ? 'rgba(244,212,158,0.22)' : isJade ? 'rgba(94,234,212,0.20)' : 'rgba(130,214,250,0.22)')
    : (isVermilion ? 'rgba(255,252,246,0.72)' : 'rgba(255,255,255,0.76)')
  const roofEdge = isDark
    ? (isVermilion ? 'rgba(245,214,158,0.34)' : isJade ? 'rgba(94,234,212,0.32)' : 'rgba(130,214,250,0.34)')
    : (isVermilion ? 'rgba(136,102,88,0.24)' : 'rgba(64,98,142,0.22)')

  const inPoly = (lat, lng, poly) => {
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const yi = poly[i][0], xi = poly[i][1]
      const yj = poly[j][0], xj = poly[j][1]
      const hit = (yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-9) + xi
      if (hit) inside = !inside
    }
    return inside
  }

  COMMUNITIES.forEach((c, idx) => {
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180
    c.polygon.forEach(([la, ln]) => {
      if (la < minLat) minLat = la
      if (la > maxLat) maxLat = la
      if (ln < minLng) minLng = ln
      if (ln > maxLng) maxLng = ln
    })
    let seed = (idx + 1) * 4999
    const rand = () => {
      seed = (seed * 16807) % 2147483647
      return (seed - 1) / 2147483646
    }
    const count = Math.round(7 + (c.housing.buildings / 76) * 11)
    let drawn = 0
    for (let k = 0; k < count * 5 && drawn < count; k++) {
      const la = minLat + (0.12 + rand() * 0.76) * (maxLat - minLat)
      const ln = minLng + (0.12 + rand() * 0.76) * (maxLng - minLng)
      if (!inPoly(la, ln, c.polygon)) continue
      const hLat = 0.00052 + rand() * 0.00058
      const wLng = 0.00072 + rand() * 0.00095
      const tall = 0.00028 + rand() * (c.biz.revenue > 16 ? 0.00048 : 0.00026)

      // 建筑立体投影底座
      L.polygon(
        [
          [la - tall, ln + tall * 0.65],
          [la - tall, ln + wLng + tall * 0.65],
          [la + hLat - tall, ln + wLng + tall * 0.65],
          [la + hLat - tall, ln + tall * 0.65]
        ],
        { color: 'transparent', fillColor: shadowFill, fillOpacity: 1, interactive: false }
      ).addTo(roadBlockGroup)

      // 建筑屋顶高光块
      L.polygon(
        [
          [la, ln],
          [la, ln + wLng],
          [la + hLat, ln + wLng],
          [la + hLat, ln]
        ],
        { color: roofEdge, weight: 0.7, fillColor: roofFill, fillOpacity: 1, interactive: false }
      ).addTo(roadBlockGroup)
      drawn++
    }
  })
}

function drawRoadsAndInnerParks() {
  if (!roadBlockGroup) return
  roadBlockGroup.clearLayers()
  if (effectiveBase.value !== 'gov') return
  const isDark = effectiveDark.value
  const isVermilion = store.preset === 'vermilion-seal'

  // 先绘社区内部 2.5D 微缩建筑肌理
  drawCityMicroBlocks()

  // 辖区内绿心公园（半透明叠于社区块上 + 微缩林木点阵）
  const parkFill = isDark ? 'rgba(20,108,86,0.56)' : 'rgba(136,196,154,0.52)'
  const parkEdge = isDark ? 'rgba(64,196,158,0.68)' : 'rgba(62,134,86,0.68)'
  const parkTxt = isDark ? 'rgba(164,236,204,0.92)' : 'rgba(26,90,52,0.92)'
  CHANGHE_PARKS.filter((p) => p.name === '长河公园' || p.name === '太阳湖绿心').forEach((pk) => {
    L.polygon(pk.polygon, {
      color: parkEdge,
      weight: 1.1,
      dashArray: '3 3',
      fillColor: parkFill,
      fillOpacity: 1,
      interactive: false
    }).addTo(roadBlockGroup)
    if (pk.showLabel) {
      L.marker(pk.labelPos, {
        interactive: false,
        zIndexOffset: 30,
        icon: L.divIcon({
          className: '',
          html: `<div style="color:${parkTxt};font-size:9.5px;font-weight:700;white-space:nowrap;pointer-events:none;text-shadow:${isDark ? '0 1px 3px rgba(0,0,0,0.85)' : '0 1px 2px rgba(255,255,255,0.95)'}">♣ ${pk.name}</div>`,
          iconSize: [64, 14],
          iconAnchor: [32, 7]
        })
      }).addTo(roadBlockGroup)
    }
  })

  // 主次干道三层复合发光路网（置于建筑肌理之上、标牌之下）
  const primaryOuter = isDark ? 'rgba(6,10,18,0.92)' : 'rgba(120,96,84,0.48)'
  const primaryCore = isDark ? (isVermilion ? 'rgba(242,208,148,0.48)' : 'rgba(130,210,250,0.46)') : 'rgba(255,253,248,0.95)'
  const primaryFlow = isDark ? (isVermilion ? 'rgba(255,226,164,0.72)' : 'rgba(140,232,255,0.72)') : (isVermilion ? 'rgba(196,120,64,0.34)' : 'rgba(26,86,184,0.28)')
  const secondaryCol = isDark ? 'rgba(148,184,224,0.26)' : 'rgba(136,120,112,0.34)'
  const roadBadgeBg = isDark ? 'rgba(14,20,32,0.90)' : 'rgba(255,253,249,0.94)'
  const roadBadgeBd = isDark ? 'rgba(232,204,154,0.34)' : 'rgba(148,128,116,0.38)'
  const roadBadgeFg = isDark ? 'rgba(240,224,196,0.90)' : 'rgba(76,62,56,0.92)'

  ROADS.forEach((rd) => {
    if (rd.primary) {
      L.polyline(rd.coords, { color: primaryOuter, weight: 4.8, opacity: 0.92, interactive: false }).addTo(roadBlockGroup)
      L.polyline(rd.coords, { color: primaryCore, weight: 2.4, opacity: 0.96, interactive: false }).addTo(roadBlockGroup)
      L.polyline(rd.coords, { color: primaryFlow, weight: 1.4, dashArray: '8 16', className: 'road-flow', interactive: false }).addTo(roadBlockGroup)
      const tipPt = rd.coords[rd.labelIdx]
      L.marker(tipPt, {
        interactive: false,
        zIndexOffset: 40,
        icon: L.divIcon({
          className: '',
          html: `<div style="display:inline-block;padding:1.5px 6px;border-radius:3px;background:${roadBadgeBg};border:1px solid ${roadBadgeBd};color:${roadBadgeFg};font-size:9px;font-weight:650;white-space:nowrap;line-height:1.25;box-shadow:0 2px 5px rgba(0,0,0,0.14);pointer-events:none">${rd.name}</div>`,
          iconSize: [56, 16],
          iconAnchor: [28, 8]
        })
      }).addTo(roadBlockGroup)
    } else {
      L.polyline(rd.coords, { color: secondaryCol, weight: 1.5, interactive: false }).addTo(roadBlockGroup)
    }
  })
}

function applyBaseLayer() {
  if (!map) return
  if (tileLayer && map.hasLayer(tileLayer)) {
    map.removeLayer(tileLayer)
    tileLayer = null
  }
  if (labelTileLayer && map.hasLayer(labelTileLayer)) {
    map.removeLayer(labelTileLayer)
    labelTileLayer = null
  }

  const mode = effectiveBase.value
  const pane = map.getPane('tilePane')
  if (pane) pane.classList.toggle('geo-styled', mode === 'street')

  if (mode === 'gov') {
    drawGovernanceBase()
    return
  }

  let tileLoaded = false
  vectorGroup?.clearLayers()
  const url = mode === 'aerial'
    ? 'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}'
    : 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}'
  tileLayer = L.tileLayer(url, { subdomains: ['1', '2', '3', '4'], maxZoom: 18 })
  tileLayer.on('tileload', () => {
    if (!tileLoaded) {
      tileLoaded = true
      vectorGroup?.clearLayers()
    }
  })
  tileLayer.on('tileerror', () => {
    if (!tileLoaded && vectorGroup && vectorGroup.getLayers().length === 0) {
      drawGovernanceBase()
    }
  })
  tileLayer.addTo(map)

  if (mode === 'aerial') {
    labelTileLayer = L.tileLayer('https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}', {
      subdomains: ['1', '2', '3', '4'],
      maxZoom: 18,
      opacity: 0.9
    })
    labelTileLayer.addTo(map)
  }
}

function computeCommunityStyle(c, isSel, isHover) {
  const isDark = effectiveDark.value
  const isGov = effectiveBase.value === 'gov'
  const pal = SLICE_PALETTES[props.slice] || SLICE_PALETTES.safety
  const lvl = getCommunityLevel(c, props.slice)
  const fillCol = (isDark ? pal.dark : pal.light)[lvl]
  const selStroke = isDark ? pal.selStroke[1] : pal.selStroke[0]
  const baseStroke = isGov
    ? (isDark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.88)')
    : (isDark ? 'rgba(148,184,224,0.48)' : selStroke)

  const strokeCol = isSel ? selStroke : isHover ? selStroke : baseStroke
  const weight = isSel ? 2.8 : isHover ? 2.2 : 1.35
  const fillOpacity = isGov
    ? (isSel ? 0.96 : isHover ? 0.93 : (isDark ? 0.84 : 0.88))
    : (isSel ? 0.30 : isHover ? 0.24 : (props.selectedCommunity === '全街道' ? 0.14 : 0.06))

  return { color: strokeCol, weight, fillColor: fillCol, fillOpacity }
}

function updateHoverStyles(newName, oldName) {
  ;[oldName, newName].forEach((name) => {
    if (!name) return
    const entry = polyLayerMap.get(name)
    if (!entry) return
    const isSel = props.selectedCommunity === name
    const isHover = newName === name
    entry.poly.setStyle(computeCommunityStyle(entry.community, isSel, isHover))
    if (isHover || isSel) entry.poly.bringToFront()
  })
}

function renderDataLayers(shouldFitView = true) {
  if (!map || !polyGroup || !dataGroup) return
  polyGroup.clearLayers()
  dataGroup.clearLayers()
  polyLayerMap.clear()
  communityLabelItems = []

  const isDark = effectiveDark.value
  const isGov = effectiveBase.value === 'gov'
  const isVermilion = store.preset === 'vermilion-seal'
  const isJade = store.preset === 'jade-emerald'
  const pal = SLICE_PALETTES[props.slice] || SLICE_PALETTES.safety

  if (props.mode === 'single' && props.singleEvent) {
    const ev = props.singleEvent
    // 完整绘制 14 社区板块与路网肌理，突出事件所在社区，彻底杜绝纯白空白底图
    COMMUNITIES.forEach((c) => {
      const isTarget = c.name === ev.community
      const style = computeCommunityStyle(c, isTarget, false)
      L.polygon(c.polygon, style).addTo(polyGroup)
    })
    const col = ev.stage === '已办结' ? '#16a34a' : (ev.stage === '待受理' || ev.stage === '待补充') ? '#dc2626' : '#d97706'
    L.circle([ev.lat, ev.lng], { radius: 130, color: col, fillColor: col, fillOpacity: 0.14, weight: 1.5, dashArray: '4 4', interactive: false }).addTo(dataGroup)
    L.marker([ev.lat, ev.lng], {
      zIndexOffset: 600,
      icon: L.divIcon({
        className: '',
        html: `<div class="geo-pulse-dot" style="--dot-color:${col}"><span class="ring"></span><span class="core"></span></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      })
    }).addTo(dataGroup)
    L.marker([ev.lat, ev.lng], {
      zIndexOffset: 650,
      interactive: false,
      icon: L.divIcon({
        className: '',
        html: `<div style="background:rgba(255,253,250,0.96);color:#1f1a18;border:1.5px solid ${col};padding:2px 8px;border-radius:5px;font-size:11px;font-weight:650;white-space:nowrap;box-shadow:0 3px 10px rgba(0,0,0,0.18)">${ev.community} · ${ev.grid}（${ev.stage}）</div>`,
        iconSize: [150, 22],
        iconAnchor: [75, 32]
      })
    }).addTo(dataGroup)
    map.setView([ev.lat, ev.lng], 14.5, { animate: false })
    return
  }

  // 1. 14 社区按专题分级赋色板块
  const boundsList = []
  COMMUNITIES.forEach((c) => {
    const isSel = props.selectedCommunity === c.name
    const isHover = props.hoveredCommunity === c.name
    const style = computeCommunityStyle(c, isSel, isHover)

    const poly = L.polygon(c.polygon, style).addTo(polyGroup)
    poly.on('click', () => emit('select-community', c.name))
    poly.on('mouseover', () => {
      if (props.selectedCommunity !== c.name) {
        poly.setStyle(computeCommunityStyle(c, false, true))
      }
    })
    poly.on('mouseout', () => {
      const stillHover = props.hoveredCommunity === c.name
      poly.setStyle(computeCommunityStyle(c, props.selectedCommunity === c.name, stillHover))
    })
    polyLayerMap.set(c.name, { poly, community: c })
    boundsList.push(poly)
  })

  // 3. 全街道 104 顶点双线发光外廓界线（内高光倒角 + 主疆域红/青/蓝外框）
  const outerLineCol = isVermilion
    ? (isDark ? '#e5c17d' : '#a81b26')
    : isJade
      ? (isDark ? '#34d399' : '#0f766e')
      : (isDark ? '#4fd3f2' : '#1a56b8')

  if (isGov) {
    // 柔光外晕 + 内高光倒角双层立体外廓
    L.polygon(CHANGHE_OUTER_BOUNDARY, {
      color: outerLineCol,
      weight: 9.5,
      opacity: isDark ? 0.22 : 0.14,
      fill: false,
      interactive: false
    }).addTo(polyGroup)
    L.polygon(CHANGHE_OUTER_BOUNDARY, {
      color: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.86)',
      weight: 4.6,
      opacity: 1,
      fill: false,
      interactive: false
    }).addTo(polyGroup)
  }
  L.polygon(CHANGHE_OUTER_BOUNDARY, {
    color: outerLineCol,
    weight: isGov ? 2.4 : 2.1,
    opacity: props.selectedCommunity === '全街道' ? 0.96 : 0.72,
    fill: false,
    dashArray: props.selectedCommunity === '全街道' ? undefined : '6 4',
    interactive: false
  }).addTo(polyGroup)

  // 先完成视野缩放落位，确保后续社区标牌像素防碰撞按最终缩放级别计算
  if (shouldFitView && props.mode !== 'patrol') {
    fitSafeBounds(boundsList)
  }

  // 4. 14 社区立体数据标牌（含微型强度条 + 督办社区脉冲警戒环 + 屏幕空间防重叠）
  if (props.mode !== 'armed' && props.mode !== 'patrol') {
    COMMUNITIES.forEach((c) => {
      const isSel = props.selectedCommunity === c.name
      const lvl = getCommunityLevel(c, props.slice)
      const toneBar = (isDark ? pal.dark : pal.light)[Math.min(3, Math.max(1, lvl))]
      const chipText = getCommunityMetricChip(c, props.slice)
      const isAlert = props.slice === 'safety' && c.health !== 'ok'
      const dotCol = c.health === 'bad' ? '#dc2626' : c.health === 'warn' ? '#d97706' : '#1b8a5a'
      const barPct = Math.min(100, Math.max(24, (lvl + 1) * 24))

      if (isGov && c.health === 'bad' && props.slice === 'safety') {
        L.circle(c.center, {
          radius: 420,
          color: '#dc2626',
          weight: 1.5,
          dashArray: '4 4',
          fillColor: '#dc2626',
          fillOpacity: isDark ? 0.16 : 0.10,
          interactive: false
        }).addTo(dataGroup)
      }

      const labelBg = isSel
        ? (isVermilion ? 'linear-gradient(135deg,#c81e2b,#92121d)' : isJade ? 'linear-gradient(135deg,#0f766e,#0b534d)' : 'linear-gradient(135deg,#1d5fd0,#12429c)')
        : (isDark ? 'rgba(14,20,32,0.92)' : 'rgba(255,253,250,0.96)')
      const labelFg = isSel ? '#ffffff' : (isDark ? '#f5f2ec' : '#1a1718')
      const labelBorder = isSel ? (isVermilion ? '#f3d7a0' : '#ffffff') : (isDark ? 'rgba(255,255,255,0.20)' : 'rgba(60,46,42,0.22)')
      const chipColor = isSel
        ? '#fde8c2'
        : isAlert
          ? (c.health === 'bad' ? '#dc2626' : '#b86b00')
          : (isDark ? '#c5d1e0' : '#5e544f')

      const offset = CHANGHE_LABEL_OFFSETS[c.name] || [0, 0]
      const pos = [c.center[0] + offset[0], c.center[1] + offset[1]]
      const shortName = c.name.replace('社区', '')
      const barColor = isSel ? '#f3d7a0' : (props.slice === 'safety' ? dotCol : toneBar)
      const bw = Math.round(shortName.length * 11.5 + (isGov ? chipText.length * 9.5 + 24 : 18))
      const bh = isGov ? 26 : 22
      const staffCountSlot = props.mode === 'cockpit' ? '<span class="geo-staff-count" hidden></span>' : ''

      const marker = L.marker(pos, {
        interactive: true,
        zIndexOffset: isSel ? 540 : 140,
        icon: L.divIcon({
          className: '',
          html: `<div style="display:flex;justify-content:center;width:100%"><div style="display:inline-flex;flex-direction:column;gap:2px;background:${labelBg};color:${labelFg};border:1px solid ${labelBorder};border-left:3px solid ${barColor};padding:2.5px 7px 3px 6px;border-radius:5px;font-size:11px;font-weight:680;white-space:nowrap;box-shadow:0 3px 10px rgba(0,0,0,${isDark ? 0.45 : 0.16})"><div style="display:flex;align-items:center;gap:4px"><span>${shortName}</span>${isGov ? `<em style="font-style:normal;font-size:9.5px;font-weight:650;color:${chipColor};padding-left:4px;border-left:1px solid ${isSel ? 'rgba(255,255,255,0.28)' : 'rgba(128,128,128,0.26)'}">${chipText}</em>` : ''}${staffCountSlot}</div>${isGov ? `<span style="display:block;width:100%;height:2px;border-radius:2px;background:${isSel ? 'rgba(255,255,255,0.22)' : 'rgba(128,128,128,0.16)'};overflow:hidden"><i style="display:block;height:100%;width:${barPct}%;background:${barColor};border-radius:2px"></i></span>` : ''}</div></div>`,
          iconSize: [bw, bh],
          iconAnchor: [Math.round(bw / 2), Math.round(bh / 2)]
        })
      }).addTo(dataGroup)
      const item = {
        marker, baseLatLng: pos, bw, bh, isSel, community: c.name, baseWidth: bw,
        countEl: staffCountSlot ? marker.getElement().querySelector('.geo-staff-count') : null,
        staffCount: 0
      }
      marker.on('click', () => emit(item.staffCount ? 'select-staff-community' : 'select-community', c.name))
      communityLabelItems.push(item)
    })
  }

  // 5. 驾驶舱/网格/数据中枢：双环政务指挥中心「中」标 + 二次贝塞尔调度飞线 + 事件点位
  if (props.mode === 'cockpit' || props.mode === 'grid' || props.mode === 'hub') {
    L.marker(HQ_COORD, {
      zIndexOffset: 680,
      icon: L.divIcon({
        className: '',
        html: `<div class="hq-seal-wrap" title="长河街道综合治理指挥中心"><span class="hq-seal-halo"></span><span class="hq-seal-core">中</span>${isGov ? '<span class="hq-seal-cap">街道指挥中心</span>' : ''}</div>`,
        iconSize: [74, 46],
        iconAnchor: [37, 16]
      })
    }).addTo(dataGroup)

    if (props.slice === 'eco' && props.mode === 'cockpit') {
      COMMUNITIES.filter((c) => props.selectedCommunity === '全街道' || c.name === props.selectedCommunity).forEach((c) => {
        L.marker([c.center[0] - 0.0022, c.center[1] + 0.0014], {
          zIndexOffset: 300,
          icon: L.divIcon({
            className: '',
            html: `<div style="background:#165e8a;color:#fff;padding:2px 6px;border-radius:4px;font-size:9.5px;font-weight:600;white-space:nowrap;border:1px solid rgba(255,255,255,0.75);box-shadow:0 2px 6px rgba(0,0,0,0.18)">易涝${c.env.floodPts} · 防火${c.env.firePts}</div>`,
            iconSize: [80, 18],
            iconAnchor: [40, 9]
          })
        }).on('click', () => emit('select-community', c.name)).addTo(dataGroup)
      })
    } else {
      props.events.forEach((ev) => {
        const col = ev.stage === '已办结' ? '#238a5c' : (ev.stage === '待受理' || ev.stage === '待补充' ? '#dc3e24' : '#d68414')
        if (ev.stage !== '已办结') {
          const arcPts = buildQuadraticArc(HQ_COORD, [ev.lat, ev.lng])
          const arcCol = isVermilion
            ? (ev.stage === '待受理' ? '#d93c28' : '#c48a28')
            : (ev.stage === '待受理' ? '#e84c3d' : '#149bb5')
          L.polyline(arcPts, { color: arcCol, weight: 2.2, opacity: 0.18, interactive: false }).addTo(dataGroup)
          L.polyline(arcPts, { color: arcCol, weight: 1.5, opacity: 0.85, dashArray: '5 7', className: 'flow-arc', interactive: false }).addTo(dataGroup)
        }
        const isOpen = ev.stage !== '已办结'
        const html = isOpen
          ? `<div class="geo-pulse-dot" style="--dot-color:${col}" title="${ev.title}"><span class="ring"></span><span class="core"></span></div>`
          : `<div class="geo-done-dot" style="--dot-color:${col}" title="${ev.title}"></div>`
        L.marker([ev.lat, ev.lng], {
          zIndexOffset: isOpen ? 420 : 80,
          icon: L.divIcon({
            className: '',
            html,
            iconSize: isOpen ? [16, 16] : [10, 10],
            iconAnchor: isOpen ? [8, 8] : [5, 5]
          })
        }).on('click', () => emit('select-event', ev)).addTo(dataGroup)
      })
    }
  }

  // 6. 数字武装 5 专题差异化点位
  if (props.mode === 'armed') {
    if (props.armedTopic === 'education' && props.armedPlaces.length) {
      props.armedPlaces.forEach((pl) => {
        L.marker(pl.coord, {
          zIndexOffset: 300,
          icon: L.divIcon({
            className: '',
            html: `<div style="background:#165e8a;color:#fff;padding:3px 8px;border-radius:5px;font-size:11px;font-weight:600;white-space:nowrap;border:1.5px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.25)">阵地 · ${pl.community.replace('社区', '')} (${pl.count}场)</div>`,
            iconSize: [110, 24],
            iconAnchor: [55, 12]
          })
        }).on('click', () => emit('select-point', pl)).addTo(dataGroup)
      })
    } else {
      COMMUNITIES.forEach((c) => {
        const isSel = props.selectedCommunity === c.name
        let html = ''
        if (props.armedTopic === 'party') {
          html = `<div style="background:${isSel ? '#a61420' : '#c81e2b'};color:#fff;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:650;white-space:nowrap;border:1.5px solid #f3d7a0;box-shadow:0 2px 8px rgba(0,0,0,0.24)">★ ${c.name.replace('社区', '')}</div>`
        } else if (props.armedTopic === 'militia') {
          html = `<div style="display:flex;align-items:center;gap:4px;background:${isSel ? '#14532d' : '#1d6945'};color:#fff;padding:3px 7px;border-radius:4px 8px 8px 4px;border-left:4px solid #c81e2b;font-size:11px;font-weight:650;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.26)">⚑ ${c.name.replace('社区', '')}连 · ${c.armed.militia}人</div>`
        } else if (props.armedTopic === 'recruit') {
          const bg = c.armed.recruitReg >= 75 ? '#1b6e49' : c.armed.recruitReg >= 60 ? '#165e8a' : '#b86b00'
          html = `<div style="background:${bg};color:#fff;padding:3px 8px;border-radius:5px;font-size:11px;font-weight:650;white-space:nowrap;border:1.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.24)">${c.name.replace('社区', '')} 登记${c.armed.recruitReg}人</div>`
        } else if (props.armedTopic === 'mobilize') {
          const showRally = props.mobilizeLayer === 'both' || props.mobilizeLayer === 'rally'
          const showVet = props.mobilizeLayer === 'both' || props.mobilizeLayer === 'veteran'
          const tag = showRally && showVet
            ? `收拢 / 优抚${c.armed.veterans}`
            : showRally ? `应急收拢·${c.name.replace('社区', '')}` : `退役服务·${c.armed.veterans}人`
          const bg = showRally && !showVet ? '#c2410c' : '#b81d2a'
          html = `<div style="background:${bg};color:#fff;padding:2px 7px;border-radius:4px;font-size:10.5px;font-weight:600;white-space:nowrap;border:1.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.24)">${tag}</div>`
        }
        L.marker(c.center, {
          zIndexOffset: isSel ? 500 : 200,
          icon: L.divIcon({ className: '', html, iconSize: [110, 24], iconAnchor: [55, 12] })
        }).on('click', () => {
          emit('select-community', c.name)
          emit('select-point', c)
        }).addTo(dataGroup)
      })
    }
  }

  // 7. 巡查轨迹回放与停留超时红点告警
  if (props.mode === 'patrol' && props.patrolRecord) {
    const rec = props.patrolRecord
    const coords = rec.track.map((p) => [p.lat, p.lng])
    L.polyline(coords, { color: isVermilion ? '#c81e2b' : '#1a56b8', weight: 4, opacity: 0.85, dashArray: '6 4' }).addTo(dataGroup)
    const walked = coords.slice(0, Math.max(1, props.patrolStepIdx + 1))
    L.polyline(walked, { color: '#1b6e49', weight: 5, opacity: 0.95 }).addTo(dataGroup)

    rec.track.forEach((pt, idx) => {
      const reached = idx <= props.patrolStepIdx
      const isCur = idx === props.patrolStepIdx
      const isAnom = pt.isStayAnomaly && rec.stayMinutes > props.patrolThreshold
      const bg = isAnom ? '#c23416' : isCur ? '#1d4ed8' : reached ? '#1b6e49' : '#64748b'
      const expanded = isAnom || isCur
      const label = isAnom ? `停留异常 ${rec.stayMinutes}分` : `${pt.time} ${pt.eventTag || '必到点'}`
      const anchorY = isAnom ? 30 : (idx % 2 === 0 ? 28 : -8)
      const html = expanded
        ? `<div style="display:inline-flex;align-items:center;gap:4px;background:${bg};color:#fff;padding:2px 8px 2px 4px;border-radius:999px;font-size:10.5px;font-weight:650;white-space:nowrap;border:1.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.28)"><b style="width:16px;height:16px;border-radius:50%;background:rgba(255,255,255,0.22);display:inline-grid;place-items:center;font-size:9.5px">${idx + 1}</b>${label}</div>`
        : `<div title="${pt.time} · ${pt.note}" style="width:22px;height:22px;border-radius:50%;background:${bg};color:#fff;display:grid;place-items:center;font-size:10.5px;font-weight:700;border:1.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.26)">${idx + 1}</div>`
      L.marker([pt.lat, pt.lng], {
        zIndexOffset: isAnom ? 900 : isCur ? 800 : 300 + idx,
        icon: L.divIcon({
          className: '',
          html,
          iconSize: expanded ? [118, 22] : [22, 22],
          iconAnchor: expanded ? [59, anchorY] : [11, 11]
        })
      }).addTo(dataGroup)
    })

    if (rec.stayMinutes > props.patrolThreshold) {
      L.circle(rec.stayCoord, { radius: 95, color: '#c23416', fillColor: '#c23416', fillOpacity: 0.22, weight: 2 }).addTo(dataGroup)
    }

    const cur = rec.track[Math.min(props.patrolStepIdx, rec.track.length - 1)]
    if (cur) {
      L.marker([cur.lat, cur.lng], {
        zIndexOffset: 1000,
        icon: L.divIcon({
          className: '',
          html: `<div class="geo-pulse-dot" style="--dot-color:${isVermilion ? '#c81e2b' : '#1d5fc4'}"><span class="ring"></span><span class="core"></span></div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        })
      }).addTo(dataGroup)
    }
    const b = L.latLngBounds(coords)
    if (b.isValid()) map.fitBounds(b, { padding: [50, 50], maxZoom: 16, animate: false })
    return
  }

  // 8. 执行社区标牌屏幕像素防重叠排布
  updateCommunityStaffCounts()
  layoutCommunityLabels()
}

function fitSafeBounds(boundsList) {
  if (!map) return
  const { padTL, padBR } = getCockpitPadding()
  if (props.selectedCommunity !== '全街道') {
    const target = COMMUNITIES.find((c) => c.name === props.selectedCommunity)
    if (target) {
      const targetPoly = L.polygon(target.polygon)
      map.fitBounds(targetPoly.getBounds(), { paddingTopLeft: padTL, paddingBottomRight: padBR, maxZoom: 15, animate: false })
      return
    }
  }
  if (props.focusCoord && props.focusCoord.length === 2 && props.mode !== 'cockpit') {
    map.setView(props.focusCoord, 14, { animate: true })
    return
  }
  const polys = boundsList?.length ? boundsList : Array.from(polyLayerMap.values()).map((x) => x.poly)
  if (polys.length) {
    const fg = L.featureGroup(polys)
    map.fitBounds(fg.getBounds(), { paddingTopLeft: padTL, paddingBottomRight: padBR, maxZoom: 14, animate: false })
  }
}

function setupBoxSelection() {
  if (!map) return
  map.on('mousedown', (e) => {
    if (!props.boxSelectActive) return
    dragStartLatLng = e.latlng
    map.dragging.disable()
    if (boxRectLayer) {
      map.removeLayer(boxRectLayer)
      boxRectLayer = null
    }
  })
  map.on('mousemove', (e) => {
    if (!props.boxSelectActive || !dragStartLatLng) return
    const bounds = L.latLngBounds(dragStartLatLng, e.latlng)
    if (boxRectLayer) {
      boxRectLayer.setBounds(bounds)
    } else {
      const col = store.preset === 'vermilion-seal' ? '#c81e2b' : '#1d5fc4'
      boxRectLayer = L.rectangle(bounds, { color: col, weight: 2, fillColor: col, fillOpacity: 0.16, dashArray: '5 4' }).addTo(map)
    }
  })
  map.on('mouseup', (e) => {
    if (!props.boxSelectActive || !dragStartLatLng) return
    const bounds = L.latLngBounds(dragStartLatLng, e.latlng)
    dragStartLatLng = null
    map.dragging.enable()
    const hitCommunities = COMMUNITIES.filter((c) => bounds.contains(L.latLng(c.center[0], c.center[1]))).map((c) => c.name)
    emit('box-selected', hitCommunities.length ? hitCommunities : ['德馨社区', '星凯社区', '堤口社区'])
  })
}

function handleFullscreenOrResize() {
  if (!map) return
  map.invalidateSize()
  if (props.mode === 'cockpit') {
    fitSafeBounds()
  }
  layoutCommunityLabels()
}

function updateStaffZoom(zoom) {
  if (props.mode !== 'cockpit' || !mapEl.value) return
  // 全街道自动取景上限为 14 级，拉近街区后才展开个人。
  const street = zoom >= 14.75
  if (street !== showStreetStaff) {
    showStreetStaff = street
    renderStaffLayer()
  }
  const fraction = Math.max(0, Math.min(1, (zoom - 14) / 1.5))
  const blend = Math.round(fraction * fraction * (3 - 2 * fraction) * 32) / 32
  if (blend === portraitBlend) return
  portraitBlend = blend
  mapEl.value.style.setProperty('--staff-portrait-blend', String(blend))
}

function focusOnStaff(staff, animate = true) {
  if (!map || !Number.isFinite(staff?.lat) || !Number.isFinite(staff?.lng)) return
  clearTimeout(initialFitTimer)
  const motion = animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const point = L.latLng(staff.lat, staff.lng)
  const zoom = Math.max(map.getZoom(), 15.5)
  if (map.getZoom() === zoom && map.getCenter().equals(point)) return
  if (motion) map.flyTo(point, zoom, { duration: 0.65 })
  else map.setView(point, zoom, { animate: false })
}
defineExpose({ focusOnStaff })

onMounted(() => {
  if (!mapEl.value) return
  map = L.map(mapEl.value, {
    center: [37.442, 116.348],
    zoom: 13.5,
    minZoom: 11,
    maxZoom: 17,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    zoomControl: props.mode !== 'cockpit',
    attributionControl: false
  })
  vectorGroup = L.layerGroup().addTo(map)
  polyGroup = L.layerGroup().addTo(map)
  roadBlockGroup = L.layerGroup().addTo(map)
  dataGroup = L.layerGroup().addTo(map)
  staffGroup = L.layerGroup().addTo(map)
  applyBaseLayer()
  drawRoadsAndInnerParks()
  renderDataLayers(true)
  renderStaffLayer()
  setupBoxSelection()
  updateScaleBar()
  updateStaffZoom(map.getZoom())
  map.on('zoom', () => updateStaffZoom(map.getZoom()))
  map.on('zoomanim', e => updateStaffZoom(e.zoom))
  map.on('moveend', () => {
    if (showStreetStaff && props.staffLayerActive) renderStaffLayer()
  })
  map.on('zoomend', () => {
    updateScaleBar()
    layoutCommunityLabels()
  })

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      map?.invalidateSize()
      layoutCommunityLabels()
    })
    resizeObserver.observe(mapEl.value)
  }
  document.addEventListener('fullscreenchange', handleFullscreenOrResize)
  initialFitTimer = setTimeout(() => {
    map.invalidateSize()
    fitSafeBounds()
    layoutCommunityLabels()
    updateScaleBar()
  }, 160)
  map.once('movestart', () => clearTimeout(initialFitTimer))
})

watch(
  () => props.baseMode,
  (val) => {
    internalBase.value = val === 'vector' ? 'gov' : val
  }
)

watch(
  () => [effectiveBase.value, effectiveDark.value, store.preset],
  () => {
    applyBaseLayer()
    drawRoadsAndInnerParks()
    renderDataLayers(false)
  }
)

// 悬停高亮单独走轻量样式更新，杜绝全图层销毁重建与视野跳动
watch(
  () => props.hoveredCommunity,
  (newVal, oldVal) => {
    updateHoverStyles(newVal, oldVal)
  }
)

const geoEventsSig = computed(() => {
  const list = props.events || []
  let s = ''
  for (let i = 0; i < list.length; i++) {
    const e = list[i]
    s += `${e.id}:${e.stage}:${e.lat}:${e.lng}:${e.community}|`
  }
  return s
})

watch(
  () => [
    props.selectedCommunity,
    props.slice,
    geoEventsSig.value,
    props.armedTopic,
    props.mobilizeLayer,
    props.patrolRecord?.id,
    props.patrolStepIdx,
    props.patrolThreshold,
    props.singleEvent?.id
  ],
  ([newSel, , , , , newPatrolId, , , newSingleId], [oldSel, , , , , oldPatrolId, , , oldSingleId] = []) => {
    // 仅当社区/单点/巡查记录切换时才重新 fitSafeBounds，切专题或步进不引发视野重算
    const needFit = newSel !== oldSel || newPatrolId !== oldPatrolId || newSingleId !== oldSingleId
    renderDataLayers(needFit)
  }
)

function updateCommunityStaffCounts() {
  if (props.mode !== 'cockpit') return false
  const totals = props.staffLayerActive && !showStreetStaff ? props.staffCommunityCounts : null
  const focus = props.staffStatusFocus
  let resized = false
  for (const item of communityLabelItems) {
    const chip = item.countEl
    if (!chip) continue
    const count = totals?.[item.community] || 0
    if (count === item.staffCount && (!count || focus === item.staffFocus)) continue
    item.staffCount = count
    item.staffFocus = focus
    chip.hidden = !count
    chip.textContent = count ? `${count}人` : ''
    const el = item.marker.getElement()
    if (count) {
      const label = `${item.community}，${focus === 'all' ? '网格员' : focus}${count}人，查看人员名录`
      el.title = label
      el.setAttribute('aria-label', label)
    } else {
      el.removeAttribute('title')
      el.removeAttribute('aria-label')
    }
    const width = item.baseWidth + (count ? 18 + String(count).length * 6 : 0)
    if (width !== item.bw) {
      item.bw = width
      el.style.width = `${width}px`
      el.style.marginLeft = `-${Math.round(width / 2)}px`
      resized = true
    }
  }
  return resized
}

function renderStaffLayer() {
  if (!map || !staffGroup) return
  if (updateCommunityStaffCounts()) layoutCommunityLabels()
  if (props.mode !== 'cockpit' || !props.staffLayerActive || (!showStreetStaff && !props.selectedStaffId)) {
    if (staffMarkers.size) staffGroup.clearLayers()
    staffMarkers.clear()
    return
  }
  const bounds = showStreetStaff ? map.getBounds().pad(0.10) : null
  const visible = new Set()
  for (const st of props.liveStaff) {
    if (!Number.isFinite(st.lat) || !Number.isFinite(st.lng)) continue
    const selected = props.selectedStaffId === st.id
    if (!selected && (!bounds?.contains([st.lat, st.lng]) ||
      (props.staffStatusFocus !== 'all' && props.staffStatusFocus !== st.status))) continue
    visible.add(st.id)
    let entry = staffMarkers.get(st.id)
    if (!entry) {
      const tooltip = document.createElement('span')
      const marker = L.marker([st.lat, st.lng], { icon: staffIcon, autoPanOnFocus: false })
      entry = { marker, tooltip, staff: null, selected: false }
      marker.bindTooltip(tooltip, { direction: 'top', offset: [0, -23], opacity: 0.96 })
      marker.on('click', () => emit('select-staff', entry.staff))
      marker.addTo(staffGroup)
      staffMarkers.set(st.id, entry)
    } else if (entry.staff.lat !== st.lat || entry.staff.lng !== st.lng) {
      entry.marker.setLatLng([st.lat, st.lng])
    }
    const el = entry.marker.getElement()
    if (entry.staff?.gender !== st.gender) {
      el.classList.toggle('is-male', st.gender === 'male')
      el.classList.toggle('is-female', st.gender === 'female')
    }
    if (entry.staff?.status !== st.status || entry.selected !== selected) {
      const alert = st.status === '滞留提醒'
      el.classList.toggle('is-alert', alert)
      el.classList.toggle('is-busy', st.status === '在办处置')
      el.classList.toggle('is-selected', selected)
      entry.marker.setZIndexOffset(selected ? 650 : alert ? 560 : 480)
    }
    const label = `${st.name}（${st.community}·${st.grid}）· ${st.status} · ${st.roadLabel || ''}`
    if (entry.tooltip.textContent !== label) {
      entry.tooltip.textContent = label
      el.setAttribute('aria-label', label)
    }
    entry.staff = st
    entry.selected = selected
  }
  for (const [id, entry] of staffMarkers) {
    if (!visible.has(id)) {
      staffGroup.removeLayer(entry.marker)
      staffMarkers.delete(id)
    }
  }
}

watch(
  () => [props.mode, props.staffLayerActive, props.staffCommunityCounts, props.liveStaff, props.selectedStaffId, props.staffStatusFocus],
  renderStaffLayer
)

watch(
  () => props.boxSelectActive,
  (active) => {
    if (!active && boxRectLayer && map) {
      map.removeLayer(boxRectLayer)
      boxRectLayer = null
    }
  }
)

onBeforeUnmount(() => {
  clearTimeout(initialFitTimer)
  document.removeEventListener('fullscreenchange', handleFullscreenOrResize)
  resizeObserver?.disconnect()
  resizeObserver = null
  staffMarkers.clear()
  staffGroup = null
  if (map) {
    map.remove()
    map = null
  }
})
</script>

<template>
  <div
    class="geo-map-root"
    :class="[
      'preset-' + store.preset,
      { dark: effectiveDark, gov: effectiveBase === 'gov', 'box-cursor': boxSelectActive }
    ]"
  >
    <div ref="mapEl" class="geo-map-canvas"></div>

    <!-- 紧凑专题图例卡（左下角对称位，随 slice 动态展示矿彩色阶） -->
    <aside
      v-if="effectiveBase === 'gov' && mode !== 'single' && mode !== 'patrol'"
      class="geo-legend-card"
      :class="{ 'is-cockpit': mode === 'cockpit' }"
      aria-label="地图专题图例"
    >
      <div class="geo-legend-head">
        <strong>{{ currentLegend.title }}</strong>
        <span>{{ currentLegend.unit }}</span>
      </div>
      <div class="geo-legend-ramp">
        <div v-for="(col, idx) in currentLegend.colors" :key="idx" class="geo-legend-step">
          <i :style="{ background: col }"></i>
          <span>{{ currentLegend.ticks[idx] }}</span>
        </div>
      </div>
      <div class="geo-legend-foot">
        <span><b class="lg-hq">中</b>指挥中心</span>
        <span><b class="lg-arc"></b>调度光轨</span>
        <span><b class="lg-park"></b>生态绿地</span>
      </div>
    </aside>

    <!-- 传统测绘指北针 + 动态比例尺（右上角净区，零英文） -->
    <div
      v-if="effectiveBase === 'gov' && mode !== 'single'"
      class="geo-compass-scale"
      :class="{ 'is-cockpit': mode === 'cockpit' }"
      aria-hidden="true"
    >
      <div class="geo-compass">
        <span class="geo-compass-n">北</span>
        <svg viewBox="0 0 24 24" width="18" height="18">
          <polygon points="12,2 15.5,12 12,10.2 8.5,12" fill="var(--primary, #c81e2b)" />
          <polygon points="12,22 15.5,12 12,13.8 8.5,12" fill="currentColor" opacity="0.32" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" />
        </svg>
      </div>
      <div class="geo-scale">
        <span>{{ scaleLabel }}</span>
        <i class="geo-scale-bar"></i>
      </div>
    </div>

    <!-- 非驾驶舱页面自带的紧凑三态底图切换胶囊 -->
    <div
      v-if="showBaseSwitch && mode !== 'cockpit' && mode !== 'single' && !store.xinchuang.offlineSimulated"
      class="geo-base-switch"
      role="group"
      aria-label="切换地图底图"
    >
      <button type="button" :class="{ active: effectiveBase === 'gov' }" @click="setBase('gov')">治理政务图</button>
      <button type="button" :class="{ active: effectiveBase === 'aerial' }" @click="setBase('aerial')">卫星影像</button>
      <button type="button" :class="{ active: effectiveBase === 'street' }" @click="setBase('street')">电子路网</button>
    </div>

    <div v-if="store.xinchuang.offlineSimulated" class="offline-ribbon">
      政务内网离线态 · 本地信创政务沙盘运行中
    </div>
  </div>
</template>

<style scoped>
.geo-map-root {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 150px;
  background: var(--ck-stage-bg, #ede6dc);
  overflow: hidden;
}

/* 宣瓷墨印默认浅色测绘舞台（温润渐变 + 极细测绘点阵 + 四周柔暗角） */
.geo-map-root.gov {
  background-color: #ebe3d8;
  background-image:
    radial-gradient(rgba(120, 96, 82, 0.11) 1px, transparent 1px),
    radial-gradient(ellipse 68% 62% at 50% 48%, #f8f4ee 0%, #ede6dc 58%, #dfd5c8 100%);
  background-size: 20px 20px, 100% 100%;
  box-shadow: inset 0 0 72px rgba(92, 70, 56, 0.12);
}

/* 其他浅色政务蓝/青预设舞台 */
.geo-map-root.gov.preset-civic-trust,
.geo-map-root.gov.preset-cloud-portal,
.geo-map-root.gov.preset-pearl-glass {
  background-color: #e1eaf4;
  background-image:
    radial-gradient(rgba(46, 78, 122, 0.10) 1px, transparent 1px),
    radial-gradient(ellipse 68% 62% at 50% 48%, #f3f7fc 0%, #e4ecf6 60%, #d4e0ef 100%);
  box-shadow: inset 0 0 72px rgba(30, 58, 96, 0.10);
}

.geo-map-root.gov.preset-jade-emerald {
  background-color: #dde9e4;
  background-image:
    radial-gradient(rgba(22, 92, 78, 0.10) 1px, transparent 1px),
    radial-gradient(ellipse 68% 62% at 50% 48%, #eef6f3 0%, #dfece7 60%, #cfe0d9 100%);
  box-shadow: inset 0 0 72px rgba(16, 72, 60, 0.10);
}

/* 深色大屏测绘舞台 */
.geo-map-root.dark {
  background: var(--ck-stage-bg, #0c0d11);
}

.geo-map-root.dark.gov {
  background-color: #0d1018;
  background-image:
    radial-gradient(rgba(156, 188, 224, 0.08) 1px, transparent 1px),
    radial-gradient(ellipse 64% 58% at 50% 46%, #1b2232 0%, #101521 62%, #090c14 100%);
  background-size: 22px 22px, 100% 100%;
  box-shadow: inset 0 0 88px rgba(0, 0, 0, 0.45);
}

.geo-map-root.dark.gov.preset-vermilion-seal {
  background-color: #100d12;
  background-image:
    radial-gradient(rgba(232, 204, 154, 0.08) 1px, transparent 1px),
    radial-gradient(ellipse 64% 58% at 50% 46%, #221a20 0%, #141016 62%, #0b090d 100%);
}

.geo-map-root :deep(.leaflet-container) {
  background: transparent !important;
}

.geo-map-root.box-cursor :deep(.leaflet-container) {
  cursor: crosshair;
}

.geo-map-canvas {
  width: 100%;
  height: 100%;
}

/* 水系与主干道缓速流向动效（遵循 prefers-reduced-motion） */
.geo-map-root :deep(.river-flow) {
  @media (prefers-reduced-motion: no-preference) {
    animation: riverDash 6.5s linear infinite;
  }
}
.geo-map-root :deep(.road-flow) {
  @media (prefers-reduced-motion: no-preference) {
    animation: riverDash 5.2s linear infinite;
  }
}
@keyframes riverDash {
  to { stroke-dashoffset: -48; }
}

.geo-map-root :deep(.geo-done-dot) {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--dot-color, #238a5c);
  border: 1.5px solid rgba(255, 255, 255, 0.92);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}

.geo-map-root :deep(.hq-seal-wrap) {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: auto;
}
.geo-map-root :deep(.hq-seal-halo) {
  position: absolute;
  top: 0;
  left: 50%;
  width: 30px;
  height: 30px;
  margin-left: -15px;
  border-radius: 50%;
  border: 1.5px solid var(--primary, #c81e2b);
  opacity: 0.55;
  @media (prefers-reduced-motion: no-preference) {
    animation: hqPulse 3.2s ease-out infinite;
  }
}
@keyframes hqPulse {
  0% { transform: scale(0.95); opacity: 0.72; }
  100% { transform: scale(1.9); opacity: 0; }
}
.geo-map-root :deep(.hq-seal-core) {
  position: relative;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: linear-gradient(145deg, #d12331 0%, #96141f 100%);
  border: 2px solid #f7e4bc;
  box-shadow: 0 3px 12px rgba(150, 20, 31, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.35);
  color: #ffffff;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
}
.geo-map-root :deep(.hq-seal-cap) {
  margin-top: 2px;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(168, 21, 34, 0.92);
  color: #fff8ea;
  font-size: 9px;
  font-weight: 650;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.22);
}

/* 紧凑专题图例卡 */
.geo-legend-card {
  position: absolute;
  z-index: 420;
  left: 12px;
  bottom: 12px;
  width: 212px;
  padding: 8px 10px 7px;
  border-radius: var(--r-card, 10px);
  border: var(--hair, 1px) solid var(--ck-border, rgba(42, 30, 32, 0.14));
  background: var(--ck-panel, rgba(255, 253, 250, 0.94));
  color: var(--ck-ink, #1a1718);
  box-shadow: var(--e2, 0 4px 14px rgba(0, 0, 0, 0.08));
  pointer-events: auto;
}
.geo-legend-card.is-cockpit {
  left: 332px;
  bottom: 84px;
}
.geo-legend-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 6px;
}
.geo-legend-head strong {
  font-size: 11px;
  font-weight: 700;
  color: var(--ck-ink);
  white-space: nowrap;
}
.geo-legend-head span {
  font-size: 10px;
  color: var(--ck-faint);
  white-space: nowrap;
}
.geo-legend-ramp {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 3px;
  margin-bottom: 6px;
}
.geo-legend-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}
.geo-legend-step i {
  display: block;
  width: 100%;
  height: 6px;
  border-radius: 3px;
  border: 1px solid rgba(0, 0, 0, 0.08);
}
.geo-legend-step span {
  font-size: 9.5px;
  color: var(--ck-muted);
  white-space: nowrap;
}
.geo-legend-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 5px;
  border-top: var(--hair, 1px) solid var(--ck-line, rgba(42, 30, 32, 0.09));
  font-size: 10px;
  color: var(--ck-muted);
}
.geo-legend-foot span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
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
  width: 12px;
  height: 0;
  border-top: 2px dashed var(--ck-warn, #d68414);
}
.lg-park {
  display: inline-block;
  width: 10px;
  height: 8px;
  border-radius: 2px;
  background: #a8d2b2;
  border: 1px solid #6b9e7a;
}

/* 极简指北针 + 动态比例尺 */
.geo-compass-scale {
  position: absolute;
  z-index: 415;
  right: 12px;
  bottom: 12px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 5px 9px;
  border-radius: var(--r-control, 8px);
  background: var(--ck-panel, rgba(255, 253, 250, 0.88));
  border: var(--hair, 1px) solid var(--ck-border, rgba(42, 30, 32, 0.12));
  color: var(--ck-ink, #1a1718);
  box-shadow: var(--e1, 0 2px 6px rgba(0, 0, 0, 0.06));
  pointer-events: none;
}
.geo-compass-scale.is-cockpit {
  top: 184px;
  bottom: auto;
  right: 356px;
}
.geo-compass {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.geo-compass-n {
  font-size: 10px;
  font-weight: 700;
  color: var(--primary, #c81e2b);
}
.geo-scale {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding-left: 8px;
  border-left: var(--hair, 1px) solid var(--ck-line, rgba(42, 30, 32, 0.12));
}
.geo-scale span {
  font-size: 9.5px;
  font-weight: 600;
  color: var(--ck-muted);
  line-height: 1;
  white-space: nowrap;
}
.geo-scale-bar {
  display: block;
  width: 52px;
  height: 4px;
  border-left: 1.5px solid var(--ck-muted);
  border-right: 1.5px solid var(--ck-muted);
  border-bottom: 1.5px solid var(--ck-muted);
}

@media (max-width: 1520px) {
  .geo-legend-card.is-cockpit {
    left: 308px;
    bottom: 82px;
    width: 196px;
    padding: 6px 8px;
  }
  .geo-compass-scale.is-cockpit {
    top: 168px;
    right: 328px;
  }
}

@media (max-width: 1100px) {
  .geo-legend-card.is-cockpit,
  .geo-compass-scale.is-cockpit {
    display: none;
  }
  .geo-base-switch {
    top: 8px;
    right: 8px;
    max-width: calc(100% - 16px);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .geo-base-switch::-webkit-scrollbar {
    display: none;
  }
}

.geo-base-switch {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 620;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: var(--r-control);
  background: var(--surface);
  border: 1px solid var(--line-strong);
  box-shadow: var(--e2);
}

.geo-base-switch button {
  height: 26px;
  padding: 0 9px;
  border: 0;
  border-radius: calc(var(--r-control) - 2px);
  background: transparent;
  color: var(--ink-muted);
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  transition: background-color var(--d-fade) ease, color var(--d-fade) ease;
}

.geo-base-switch button:hover {
  color: var(--ink);
  background: var(--state-hover);
}

.geo-base-switch button.active {
  background: var(--primary);
  color: var(--on-primary);
}

:deep(.geo-staff-count) {
  padding-left: 4px;
  border-left: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  font-size: 9.5px;
  font-weight: 550;
  font-variant-numeric: tabular-nums;
  opacity: 0.76;
}
:deep(.geo-staff-count[hidden]) { display: none; }
:deep(.geo-staff-marker) {
  --staff-status: #16835d;
  --staff-edge: #f9fffc;
  --staff-column: 0%;
  --staff-row: 100%;
}
:deep(.geo-staff-marker.is-busy) {
  --staff-status: #2869b6;
  --staff-column: 50%;
}
:deep(.geo-staff-marker.is-alert) {
  --staff-status: #d73c3a;
  --staff-edge: #a31924;
  --staff-column: 100%;
}
.geo-map-root.dark :deep(.geo-staff-marker) { --staff-status: #51c99a; }
.geo-map-root.dark :deep(.geo-staff-marker.is-busy) { --staff-status: #77baff; }
.geo-map-root.dark :deep(.geo-staff-marker.is-alert) {
  --staff-status: #ff7165;
  --staff-edge: #ff9a85;
}
:deep(.geo-staff-marker.is-male) { --staff-row: 0%; }
:deep(.geo-staff-marker.is-female) { --staff-row: 50%; }

:deep(.geo-staff-pin) {
  position: absolute;
  inset: 0;
  transition: opacity 140ms ease;
}
:deep(.geo-staff-mini),
:deep(.geo-staff-portrait) {
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  pointer-events: none;
  transition: opacity 140ms ease;
}
:deep(.geo-staff-mini) {
  width: 17px;
  height: 19px;
  opacity: calc(1 - var(--staff-portrait-blend, 0));
  --staff-outline: polygon(34% 16%, 35% 10%, 39% 5%, 44% 2%, 51% 1%, 58% 2%, 63% 5%, 66% 10%, 67% 16%, 65% 23%, 62% 28%, 57% 32%, 73% 36%, 84% 61%, 74% 65%, 64% 48%, 66% 68%, 70% 98%, 55% 98%, 50% 75%, 44% 98%, 29% 98%, 34% 68%, 36% 48%, 26% 65%, 16% 61%, 28% 36%, 43% 32%, 38% 28%, 35% 23%);
}
:deep(.geo-staff-mini::before),
:deep(.geo-staff-mini::after) {
  content: '';
  position: absolute;
  inset: 0;
  clip-path: var(--staff-outline);
}
:deep(.geo-staff-mini::before) {
  background: var(--staff-edge);
  transform: scale(1.16, 1.09);
  transform-origin: center 82%;
}
:deep(.geo-staff-mini::after) {
  background:
    radial-gradient(ellipse 24% 17% at 39% 3%, #493a33 68%, transparent 76%),
    linear-gradient(to bottom, #493a33 0% 10%, #edc29d 10% 33%, var(--staff-status) 33% 52%, #f4edce 52% 59%, var(--staff-status) 59% 72%, #263b4b 72% 100%);
}
:deep(.geo-staff-portrait) {
  width: 26px;
  height: 26px;
  background-image: url('../assets/staff-map-badges.png');
  background-size: 300% 300%;
  background-position: var(--staff-column) var(--staff-row);
  background-repeat: no-repeat;
  opacity: var(--staff-portrait-blend, 0);
}
:deep(.geo-staff-marker.is-selected .geo-staff-pin::before) {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 2px;
  width: 18px;
  height: 6px;
  transform: translateX(-50%);
  border: 2px solid var(--staff-status);
  border-radius: 50%;
  box-shadow: 0 0 0 1px white;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  :deep(.geo-staff-pin),
  :deep(.geo-staff-mini),
  :deep(.geo-staff-portrait) { transition: none; }
}

.offline-ribbon {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 650;
  background: var(--inverse-surface);
  color: var(--inverse-ink);
  padding: 5px 14px;
  border-radius: var(--r-tag);
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--primary);
  box-shadow: var(--e2);
  white-space: nowrap;
}
</style>
