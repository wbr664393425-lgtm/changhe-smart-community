<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import BrandLogo from './BrandLogo.vue'
import { CHANGHE_OUTER_BOUNDARY, CHANGHE_COMMUNITY_GEO } from '../utils/changheGeo'
import { LOADER_HQ_LATLNG, LOADER_WATER_COORDS } from '../utils/cockpitLoaderGeo'

const props = defineProps({
  visible: { type: Boolean, default: false },
  targetProgress: { type: Number, default: 4 },
  sceneReady: { type: Boolean, default: false },
  minCurtainMs: { type: Number, default: 2500 },
  holdMs: { type: Number, default: 400 },
  dark: { type: Boolean, default: false },
  fallbackNotice: { type: String, default: '' }
})

const emit = defineEmits(['reveal-ready'])

const STAGES = ['地理底图', '三维楼宇', '水系图层', '光影预热']

const SVG_W = 460
const SVG_H = 312
const PAD_X = 38
const PAD_Y = 24
const COS_LAT = Math.cos((37.4408 * Math.PI) / 180)

// 一次性将长河街道真实经纬度轮廓、14 社区界线及真实岔河/长河水系等比投影至 SVG 视口（零大 JSON 与 Three.js 依赖）
const geoSvg = (() => {
  const toXY = ([lat, lng]) => [lng * COS_LAT, -lat]
  const rawOuter = CHANGHE_OUTER_BOUNDARY.map(toXY)

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  rawOuter.forEach(([x, y]) => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  })

  const spanX = Math.max(1e-6, maxX - minX)
  const spanY = Math.max(1e-6, maxY - minY)
  const scale = Math.min((SVG_W - PAD_X * 2) / spanX, (SVG_H - PAD_Y * 2) / spanY)
  const drawW = spanX * scale
  const drawH = spanY * scale
  const offX = (SVG_W - drawW) / 2
  const offY = (SVG_H - drawH) / 2

  const project = ([lat, lng]) => {
    const [rx, ry] = toXY([lat, lng])
    return [
      Number((offX + (rx - minX) * scale).toFixed(2)),
      Number((offY + (ry - minY) * scale).toFixed(2))
    ]
  }

  const ptsToPath = (coords) => {
    if (!coords?.length) return ''
    const p = coords.map(project)
    return `M ${p[0][0]} ${p[0][1]} ` + p.slice(1).map(([x, y]) => `L ${x} ${y}`).join(' ') + ' Z'
  }

  const waterPaths = LOADER_WATER_COORDS.map(ptsToPath)

  const outerPts = CHANGHE_OUTER_BOUNDARY.map(project)
  const closedOuter = [...outerPts, outerPts[0]]
  const cumLens = [0]
  let totalLen = 0
  for (let i = 1; i < closedOuter.length; i++) {
    const dx = closedOuter[i][0] - closedOuter[i - 1][0]
    const dy = closedOuter[i][1] - closedOuter[i - 1][1]
    totalLen += Math.hypot(dx, dy)
    cumLens.push(totalLen)
  }

  const hqPt = project(LOADER_HQ_LATLNG)

  // 将 14 社区按自西南向东北依次排序，随进度均匀优雅点亮
  const commEntries = Object.entries(CHANGHE_COMMUNITY_GEO).map(([name, geo]) => {
    const cPt = project(geo.center)
    return {
      name,
      shortName: name.replace('社区', ''),
      path: ptsToPath(geo.polygon),
      cx: cPt[0],
      cy: cPt[1],
      orderScore: cPt[0] * 0.65 - cPt[1] * 0.85
    }
  })
  commEntries.sort((a, b) => a.orderScore - b.orderScore)
  const communities = commEntries.map((item, idx) => ({
    ...item,
    threshold: 8 + Math.round((idx / Math.max(1, commEntries.length - 1)) * 80)
  }))

  return {
    outerPath: ptsToPath(CHANGHE_OUTER_BOUNDARY),
    waterPaths,
    closedOuter,
    cumLens,
    totalLen: Math.max(1, totalLen),
    hqPt,
    communities
  }
})()

// 将 60fps 平滑进度插值隔离在 CockpitLoader 内部，彻底避免父组件 CockpitView 820 行模板 60fps 重渲染
const smoothProgress = ref(props.visible ? 2 : 100)
let startTime = 0
let rafId = null
let holdTimer = null
let emittedReady = false

function stopTicker() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  if (holdTimer !== null) {
    clearTimeout(holdTimer)
    holdTimer = null
  }
}

function tick(now) {
  if (!props.visible || emittedReady) {
    rafId = null
    return
  }

  const elapsed = now - startTime
  const cur = smoothProgress.value

  if (!props.sceneReady) {
    const target = Math.min(98, Math.max(cur, props.targetProgress))
    smoothProgress.value = Math.min(98, cur + (target - cur) * 0.1)
    rafId = requestAnimationFrame(tick)
    return
  }

  const minRatio = Math.min(1, elapsed / Math.max(1, props.minCurtainMs))
  const easedMin = 1 - Math.pow(1 - minRatio, 1.38)
  const smoothTarget = minRatio < 1 ? Math.min(99.2, easedMin * 100) : 100
  const gap = smoothTarget - cur
  const step = minRatio < 1 ? Math.max(0.22, gap * 0.14) : Math.max(0.75, gap * 0.22)
  const next = Math.min(smoothTarget, cur + step)
  smoothProgress.value = next

  if (next >= 99.7 && elapsed >= props.minCurtainMs) {
    smoothProgress.value = 100
    emittedReady = true
    rafId = null
    holdTimer = setTimeout(() => {
      holdTimer = null
      emit('reveal-ready')
    }, props.fallbackNotice ? 420 : props.holdMs)
    return
  }

  rafId = requestAnimationFrame(tick)
}

function startTicker() {
  if (!props.visible || emittedReady || rafId !== null) return
  startTime = performance.now()
  rafId = requestAnimationFrame(tick)
}

onMounted(() => {
  if (props.visible) startTicker()
})

watch(() => props.visible, (vis) => {
  if (vis) {
    emittedReady = false
    smoothProgress.value = 2
    startTicker()
  } else {
    stopTicker()
  }
})

onBeforeUnmount(stopTicker)

const clampedProgress = computed(() => Math.max(0, Math.min(100, smoothProgress.value)))
const progressRatio = computed(() => clampedProgress.value / 100)
const displayPct = computed(() => Math.round(clampedProgress.value))
const outerDashOffset = computed(() => Number((1000 * (1 - progressRatio.value)).toFixed(2)))
const innerSilkOffset = computed(() => Number((1000 * (1 - Math.max(0, (clampedProgress.value - 3) / 97))).toFixed(2)))
const waterOpacity = computed(() => Math.max(0, Math.min(1, (clampedProgress.value - 18) / 56)))
const isComplete = computed(() => displayPct.value >= 100)

const stageMeta = computed(() => {
  if (props.fallbackNotice) {
    return { index: 3, label: props.fallbackNotice }
  }
  const p = clampedProgress.value
  if (p >= 99.5) return { index: 3, label: '全景沙盘已就绪，即将进入驾驶舱' }
  if (p >= 88) return { index: 3, label: '正在编译三维光影与首帧渲染管线' }
  if (p >= 76) return { index: 2, label: '正在渲染岔河水系与社区拓扑图层' }
  if (p >= 50) return { index: 1, label: '正在分片构建 4,205 栋三维楼宇白模' }
  return { index: 0, label: '正在拉取高清地理底图与卫星影像' }
})

// 计算外轮廓描边前端光点坐标
const traceHead = computed(() => {
  const ratio = clampedProgress.value / 100
  const target = ratio * geoSvg.totalLen
  const { closedOuter, cumLens } = geoSvg
  if (ratio <= 0 || ratio >= 1) return { x: closedOuter[0][0], y: closedOuter[0][1] }
  let idx = 1
  while (idx < cumLens.length - 1 && cumLens[idx] < target) idx++
  const segStart = cumLens[idx - 1]
  const segLen = Math.max(1e-6, cumLens[idx] - segStart)
  const t = Math.max(0, Math.min(1, (target - segStart) / segLen))
  const p0 = closedOuter[idx - 1]
  const p1 = closedOuter[idx]
  return {
    x: Number((p0[0] + (p1[0] - p0[0]) * t).toFixed(2)),
    y: Number((p0[1] + (p1[1] - p0[1]) * t).toFixed(2))
  }
})

const litCommunitiesCount = computed(() =>
  geoSvg.communities.filter((c) => clampedProgress.value >= c.threshold).length
)
const hqLit = computed(() => clampedProgress.value >= 84)

function isCommFresh(comm) {
  return clampedProgress.value >= comm.threshold && clampedProgress.value < comm.threshold + 12
}
</script>

<template>
  <Transition name="ck-loader-reveal">
    <div
      v-if="visible"
      class="ck-loader-curtain"
      :class="{ 'is-dark': dark, 'is-complete': isComplete }"
      role="status"
      aria-live="polite"
      :aria-label="`驾驶舱资源加载中 ${displayPct}%`"
    >
      <!-- 四角极细测绘标尺边线（东方建筑制图感，克制无光污染） -->
      <div class="ck-loader-frame" aria-hidden="true">
        <i class="ck-corner tl"></i>
        <i class="ck-corner tr"></i>
        <i class="ck-corner bl"></i>
        <i class="ck-corner br"></i>
      </div>

      <div class="ck-loader-core">
        <!-- 中央长河街道真实疆域脉络测绘卷轴 SVG -->
        <div class="ck-map-emblem">
          <svg
            class="ck-geo-svg"
            :viewBox="`0 0 ${SVG_W} ${SVG_H}`"
            width="460"
            height="312"
            aria-hidden="true"
          >
            <defs v-once>
              <linearGradient id="ckLoaderTraceGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="var(--ck-loader-stroke-a)" />
                <stop offset="56%" stop-color="var(--ck-loader-stroke-b)" />
                <stop offset="100%" stop-color="var(--ck-loader-stroke-c)" />
              </linearGradient>
              <radialGradient id="ckLoaderFillGrad" cx="52%" cy="48%" r="58%">
                <stop offset="0%" stop-color="var(--ck-loader-fill-core)" stop-opacity="0.2" />
                <stop offset="100%" stop-color="var(--ck-loader-fill-edge)" stop-opacity="0.025" />
              </radialGradient>
              <clipPath id="ckLoaderOuterClip">
                <path :d="geoSvg.outerPath" />
              </clipPath>
            </defs>

            <!-- 极淡十字经纬基准线 -->
            <g v-once class="ck-geo-axes">
              <line :x1="geoSvg.hqPt[0]" y1="14" :x2="geoSvg.hqPt[0]" :y2="SVG_H - 14" />
              <line x1="22" :y1="geoSvg.hqPt[1]" :x2="SVG_W - 22" :y2="geoSvg.hqPt[1]" />
            </g>

            <!-- 街道疆域底影 -->
            <path v-once :d="geoSvg.outerPath" class="ck-geo-base-fill" fill="url(#ckLoaderFillGrad)" />

            <!-- 真实岔河与长河公园大湖浅水纹（裁剪于街道疆域内，随加载柔缓显影） -->
            <g
              class="ck-geo-water"
              clip-path="url(#ckLoaderOuterClip)"
              :style="{ opacity: waterOpacity }"
            >
              <g v-once>
                <path
                  v-for="(wp, idx) in geoSvg.waterPaths"
                  :key="'w-' + idx"
                  :d="wp"
                  class="ck-geo-water-poly"
                />
              </g>
            </g>

            <!-- 14 社区真实界线：随进度逐个点亮 -->
            <g class="ck-geo-communities">
              <path
                v-for="comm in geoSvg.communities"
                :key="comm.name"
                :d="comm.path"
                class="ck-geo-comm-poly"
                :class="{
                  'is-lit': clampedProgress >= comm.threshold,
                  'is-fresh': isCommFresh(comm)
                }"
              />
            </g>

            <!-- 外轮廓底刻线 -->
            <path v-once :d="geoSvg.outerPath" class="ck-geo-outer-ghost" />

            <!-- 外轮廓半透明宽辉光层（替代 60fps 动态 drop-shadow 滤镜） + 动态描边主线 + 内金丝随行细轨 -->
            <path
              :d="geoSvg.outerPath"
              pathLength="1000"
              class="ck-geo-outer-glow"
              stroke="url(#ckLoaderTraceGrad)"
              :stroke-dashoffset="outerDashOffset"
            />
            <path
              :d="geoSvg.outerPath"
              pathLength="1000"
              class="ck-geo-outer-trace"
              stroke="url(#ckLoaderTraceGrad)"
              :stroke-dashoffset="outerDashOffset"
            />
            <path
              :d="geoSvg.outerPath"
              pathLength="1000"
              class="ck-geo-inner-silk"
              :stroke-dashoffset="innerSilkOffset"
            />

            <!-- 14 社区中心脉络点与简称微水印（点亮瞬间轻浮强调，随后沉淀为淡雅水印） -->
            <g class="ck-geo-dots">
              <g
                v-for="comm in geoSvg.communities"
                :key="comm.name + '-dot'"
                class="ck-geo-comm-node"
                :class="{
                  'is-lit': clampedProgress >= comm.threshold,
                  'is-fresh': isCommFresh(comm)
                }"
              >
                <circle
                  :cx="comm.cx"
                  :cy="comm.cy"
                  :r="clampedProgress >= comm.threshold ? 2.5 : 1.35"
                  class="ck-geo-comm-dot"
                />
                <text
                  :x="comm.cx"
                  :y="comm.cy - 5.5"
                  text-anchor="middle"
                  class="ck-geo-comm-label"
                >
                  {{ comm.shortName }}
                </text>
              </g>
            </g>

            <!-- 街道指挥中心印标（100% 时荡开细金涟漪） -->
            <g class="ck-geo-hq" :class="{ 'is-lit': hqLit, 'is-complete': isComplete }">
              <circle v-if="isComplete" :cx="geoSvg.hqPt[0]" :cy="geoSvg.hqPt[1]" r="10" class="ck-geo-hq-ripple" />
              <circle :cx="geoSvg.hqPt[0]" :cy="geoSvg.hqPt[1]" r="10.5" class="ck-geo-hq-ring" />
              <circle :cx="geoSvg.hqPt[0]" :cy="geoSvg.hqPt[1]" r="4.2" class="ck-geo-hq-core" />
            </g>

            <!-- 描边前端测绘笔尖光点 -->
            <g
              v-if="clampedProgress > 1 && clampedProgress < 100"
              class="ck-geo-tip"
              :transform="`translate(${traceHead.x}, ${traceHead.y})`"
            >
              <circle r="7" class="ck-geo-tip-halo" />
              <circle r="2.6" class="ck-geo-tip-dot" />
            </g>
          </svg>

          <div class="ck-map-meta num">
            <span>长河街道实景疆域</span>
            <i aria-hidden="true"></i>
            <span>已点亮 {{ litCommunitiesCount }}/14 社区</span>
            <i aria-hidden="true"></i>
            <span>4,205 栋楼宇白模</span>
          </div>
        </div>

        <!-- 品牌主标 -->
        <div class="ck-loader-brand">
          <div class="ck-loader-logo">
            <BrandLogo :size="34" />
          </div>
          <div class="ck-loader-titles">
            <h1>
              <span>长河街道</span>
              <i class="ck-loader-sep" aria-hidden="true"></i>
              <span>智慧社区综合治理驾驶舱</span>
            </h1>
          </div>
        </div>

        <!-- 高定细长光轨进度区 -->
        <div class="ck-loader-meter">
          <div class="ck-meter-head">
            <span class="ck-meter-stage">
              <i class="ck-stage-pulse" aria-hidden="true"></i>
              {{ stageMeta.label }}
            </span>
            <strong class="ck-meter-pct num">{{ displayPct }}<small>%</small></strong>
          </div>

          <div class="ck-meter-track">
            <span class="ck-track-tick" style="left: 25%"></span>
            <span class="ck-track-tick" style="left: 50%"></span>
            <span class="ck-track-tick" style="left: 75%"></span>
            <div class="ck-meter-fill" :style="{ transform: `scaleX(${progressRatio})` }"></div>
            <i class="ck-meter-tip" :style="{ left: clampedProgress + '%' }" aria-hidden="true"></i>
          </div>

          <!-- 四阶段里程碑 -->
          <div class="ck-meter-steps" aria-hidden="true">
            <span
              v-for="(label, idx) in STAGES"
              :key="label"
              class="ck-step-chip"
              :class="{
                'is-done': idx < stageMeta.index || displayPct >= 100,
                'is-active': idx === stageMeta.index && displayPct < 100
              }"
            >
              <i></i>
              {{ label }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.ck-loader-curtain {
  --ck-loader-bg: var(--ck-frame, #f3f0eb);
  --ck-loader-bg-inner: color-mix(in srgb, var(--ck-panel-solid, #ffffff) 74%, var(--ck-frame, #f3f0eb));
  --ck-loader-ink: var(--ck-ink, #1a1817);
  --ck-loader-muted: var(--ck-muted, #5c5652);
  --ck-loader-faint: var(--ck-faint, #8a837e);
  --ck-loader-line: var(--ck-line, rgba(36, 28, 24, 0.1));
  --ck-loader-stroke-a: var(--primary, #b81c28);
  --ck-loader-stroke-b: var(--ck-accent, var(--primary, #b81c28));
  --ck-loader-stroke-c: color-mix(in srgb, var(--primary, #b81c28) 42%, #d8ae58);
  --ck-loader-fill-core: var(--primary, #b81c28);
  --ck-loader-fill-edge: var(--ck-accent, #b58d42);
  --ck-loader-water-fill: rgba(45, 122, 134, 0.18);
  --ck-loader-water-stroke: rgba(45, 122, 134, 0.36);
  --ck-loader-track: color-mix(in srgb, var(--ck-ink, #1a1817) 10%, transparent);

  position: fixed;
  inset: 0;
  z-index: 2200;
  display: grid;
  place-items: center;
  padding: 24px;
  background: radial-gradient(circle at 50% 42%, var(--ck-loader-bg-inner) 0%, var(--ck-loader-bg) 74%);
  color: var(--ck-loader-ink);
  user-select: none;
  overflow: hidden;
  will-change: opacity, transform;
}

.ck-loader-curtain.is-dark {
  --ck-loader-bg: var(--ck-frame, #0c0d11);
  --ck-loader-bg-inner: color-mix(in srgb, var(--ck-panel-solid, #171820) 86%, var(--ck-frame, #0c0d11));
  --ck-loader-ink: var(--ck-ink, #f7f5f2);
  --ck-loader-muted: var(--ck-muted, #beb9b4);
  --ck-loader-faint: var(--ck-faint, #8c8784);
  --ck-loader-line: var(--ck-line, rgba(232, 204, 154, 0.14));
  --ck-loader-stroke-a: var(--primary, #c81e2b);
  --ck-loader-stroke-b: var(--ck-accent, #e8c484);
  --ck-loader-stroke-c: #fae0a4;
  --ck-loader-fill-core: var(--ck-accent, #e8c484);
  --ck-loader-fill-edge: var(--primary, #c81e2b);
  --ck-loader-water-fill: rgba(78, 174, 196, 0.2);
  --ck-loader-water-stroke: rgba(112, 204, 224, 0.36);
  --ck-loader-track: rgba(255, 255, 255, 0.11);
}

/* 薄纱级柔滑微放大化开揭幕（0.78s），与底层 3D 航拍弧线压镜自然叠化 */
.ck-loader-reveal-leave-active {
  will-change: opacity, transform;
  transition: opacity 0.78s cubic-bezier(0.22, 1, 0.36, 1), transform 0.78s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.ck-loader-reveal-leave-to {
  opacity: 0;
  transform: scale(1.045);
}

/* 视口四角测绘标尺 */
.ck-loader-frame {
  position: absolute;
  inset: 22px;
  pointer-events: none;
}

.ck-corner {
  position: absolute;
  width: 24px;
  height: 24px;
  border-color: color-mix(in srgb, var(--ck-loader-stroke-b) 44%, var(--ck-loader-line));
  border-style: solid;
  border-width: 0;
}

.ck-corner.tl { top: 0; left: 0; border-top-width: 1.5px; border-left-width: 1.5px; }
.ck-corner.tr { top: 0; right: 0; border-top-width: 1.5px; border-right-width: 1.5px; }
.ck-corner.bl { bottom: 0; left: 0; border-bottom-width: 1.5px; border-left-width: 1.5px; }
.ck-corner.br { bottom: 0; right: 0; border-bottom-width: 1.5px; border-right-width: 1.5px; }

.ck-loader-core {
  width: min(540px, 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}

/* 中央疆域 SVG 区 */
.ck-map-emblem {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.ck-geo-svg {
  width: min(460px, 88vw);
  height: auto;
  display: block;
  overflow: visible;
}

.ck-geo-axes line {
  stroke: var(--ck-loader-line);
  stroke-width: 0.75;
  stroke-dasharray: 2 4;
}

.ck-geo-base-fill {
  opacity: 0.85;
}

.ck-geo-water {
  will-change: opacity;
}

.ck-geo-water-poly {
  fill: var(--ck-loader-water-fill);
  stroke: var(--ck-loader-water-stroke);
  stroke-width: 0.65;
  stroke-linejoin: round;
}

.ck-geo-comm-poly {
  fill: transparent;
  stroke: color-mix(in srgb, var(--ck-loader-ink) 14%, transparent);
  stroke-width: 0.72;
  stroke-linejoin: round;
  transition: fill 0.55s ease, stroke 0.55s ease;
}

.ck-geo-comm-poly.is-lit {
  fill: color-mix(in srgb, var(--ck-loader-stroke-a) 9%, transparent);
  stroke: color-mix(in srgb, var(--ck-loader-stroke-b) 44%, transparent);
}

.ck-geo-comm-poly.is-fresh {
  fill: color-mix(in srgb, var(--ck-loader-stroke-a) 18%, transparent);
  stroke: color-mix(in srgb, var(--ck-loader-stroke-a) 68%, transparent);
}

.ck-loader-curtain.is-complete .ck-geo-comm-poly.is-lit {
  fill: color-mix(in srgb, var(--ck-loader-stroke-b) 15%, transparent);
  stroke: color-mix(in srgb, var(--ck-loader-stroke-b) 62%, transparent);
}

.ck-loader-curtain.is-dark .ck-geo-comm-poly.is-lit {
  fill: color-mix(in srgb, var(--ck-loader-stroke-b) 11%, transparent);
  stroke: color-mix(in srgb, var(--ck-loader-stroke-b) 44%, transparent);
}

.ck-loader-curtain.is-dark .ck-geo-comm-poly.is-fresh {
  fill: color-mix(in srgb, var(--ck-loader-stroke-b) 22%, transparent);
  stroke: color-mix(in srgb, var(--ck-loader-stroke-c) 76%, transparent);
}

.ck-loader-curtain.is-dark.is-complete .ck-geo-comm-poly.is-lit {
  fill: color-mix(in srgb, var(--ck-loader-stroke-b) 18%, transparent);
  stroke: color-mix(in srgb, var(--ck-loader-stroke-c) 64%, transparent);
}

.ck-geo-outer-ghost {
  fill: none;
  stroke: color-mix(in srgb, var(--ck-loader-ink) 14%, transparent);
  stroke-width: 1.05;
  stroke-linejoin: round;
}

.ck-geo-outer-glow {
  fill: none;
  stroke-width: 6.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1000;
  opacity: 0.2;
}

.ck-geo-outer-trace {
  fill: none;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1000;
}

.ck-geo-inner-silk {
  fill: none;
  stroke: var(--ck-loader-stroke-c);
  stroke-width: 0.9;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1000;
  opacity: 0.65;
}

.ck-geo-comm-dot {
  fill: color-mix(in srgb, var(--ck-loader-ink) 20%, transparent);
  transition: fill 0.42s ease, r 0.42s ease;
}

.ck-geo-comm-node.is-lit .ck-geo-comm-dot {
  fill: var(--ck-loader-stroke-b);
}

.ck-geo-comm-node.is-fresh .ck-geo-comm-dot {
  fill: var(--ck-loader-stroke-a);
}

.ck-geo-comm-label {
  font-size: 8.5px;
  font-weight: 600;
  fill: var(--ck-loader-ink);
  opacity: 0;
  pointer-events: none;
  letter-spacing: 0.04em;
  transition: opacity 0.55s ease, fill 0.45s ease;
}

.ck-geo-comm-node.is-lit .ck-geo-comm-label {
  opacity: 0.36;
}

.ck-geo-comm-node.is-fresh .ck-geo-comm-label {
  opacity: 0.92;
  fill: var(--ck-loader-stroke-a);
}

.ck-loader-curtain.is-dark .ck-geo-comm-node.is-fresh .ck-geo-comm-label {
  fill: var(--ck-loader-stroke-c);
}

.ck-loader-curtain.is-complete .ck-geo-comm-node.is-lit .ck-geo-comm-label {
  opacity: 0.52;
}

.ck-geo-hq {
  opacity: 0.2;
  transition: opacity 0.48s ease;
}

.ck-geo-hq.is-lit {
  opacity: 1;
}

.ck-geo-hq-ring {
  fill: color-mix(in srgb, var(--ck-loader-stroke-a) 14%, transparent);
  stroke: var(--ck-loader-stroke-a);
  stroke-width: 1.25;
}

.ck-geo-hq-core {
  fill: var(--ck-loader-stroke-a);
  stroke: var(--ck-loader-bg);
  stroke-width: 1.5;
}

.ck-geo-hq-ripple {
  fill: none;
  stroke: var(--ck-loader-stroke-c);
  stroke-width: 1.6;
  transform-box: fill-box;
  transform-origin: center;
  animation: ckHqSealRipple 0.85s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

@keyframes ckHqSealRipple {
  0% {
    opacity: 0.9;
    transform: scale(0.95);
  }
  100% {
    opacity: 0;
    transform: scale(3.4);
  }
}

.ck-geo-tip-halo {
  fill: color-mix(in srgb, var(--ck-loader-stroke-b) 28%, transparent);
}

.ck-geo-tip-dot {
  fill: var(--ck-loader-stroke-c);
}

.ck-map-meta {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--ck-loader-faint);
  letter-spacing: 0.02em;
}

.ck-map-meta i {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--ck-loader-stroke-b) 65%, transparent);
}

/* 品牌主标 */
.ck-loader-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.ck-loader-logo {
  flex-shrink: 0;
  display: grid;
  place-items: center;
}

.ck-loader-titles {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ck-loader-titles h1 {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-family: var(--font-ceremony, inherit);
  font-size: 22px;
  font-weight: 700;
  line-height: 1.25;
  color: var(--ck-loader-ink);
  letter-spacing: 0.04em;
}

.ck-loader-sep {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--ck-loader-stroke-a);
  flex-shrink: 0;
}

/* 进度条模块 */
.ck-loader-meter {
  width: min(468px, 100%);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ck-meter-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.ck-meter-stage {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--ck-loader-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ck-stage-pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ck-loader-stroke-a);
  flex-shrink: 0;
  animation: ckStagePulse 1.6s ease-in-out infinite;
}

@keyframes ckStagePulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.38; transform: scale(0.76); }
}

.ck-meter-pct {
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
  color: var(--ck-loader-ink);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.ck-meter-pct small {
  font-size: 13px;
  font-weight: 600;
  color: var(--ck-loader-muted);
  margin-left: 2px;
}

.ck-meter-track {
  position: relative;
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: var(--ck-loader-track);
  overflow: visible;
}

.ck-track-tick {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 1px;
  background: var(--ck-loader-bg);
  opacity: 0.72;
  z-index: 1;
  pointer-events: none;
}

.ck-meter-fill {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 999px;
  transform-origin: left center;
  will-change: transform;
  background: linear-gradient(90deg, var(--ck-loader-stroke-a) 0%, var(--ck-loader-stroke-b) 68%, var(--ck-loader-stroke-c) 100%);
  box-shadow: 0 0 10px color-mix(in srgb, var(--ck-loader-stroke-a) 32%, transparent);
  z-index: 2;
}

.ck-meter-tip {
  position: absolute;
  top: 50%;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: var(--ck-loader-stroke-c);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ck-loader-stroke-b) 28%, transparent);
  z-index: 3;
  pointer-events: none;
}

.ck-meter-steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding-top: 2px;
}

.ck-step-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--ck-loader-faint);
  transition: color 0.3s ease;
}

.ck-step-chip i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--ck-loader-ink) 20%, transparent);
  transition: background-color 0.3s ease, transform 0.3s ease;
}

.ck-step-chip.is-active {
  color: var(--ck-loader-ink);
  font-weight: 600;
}

.ck-step-chip.is-active i {
  background: var(--ck-loader-stroke-a);
  transform: scale(1.25);
}

.ck-step-chip.is-done {
  color: var(--ck-loader-muted);
}

.ck-step-chip.is-done i {
  background: var(--ck-loader-stroke-b);
}

@media (max-width: 640px) {
  .ck-loader-frame { inset: 12px; }
  .ck-loader-titles h1 { font-size: 17px; gap: 6px; }
  .ck-meter-pct { font-size: 24px; }
  .ck-map-meta { font-size: 11px; gap: 6px; }
  .ck-step-chip { font-size: 11px; }
  .ck-geo-comm-label { font-size: 7.5px; }
}

@media (prefers-reduced-motion: reduce) {
  .ck-stage-pulse,
  .ck-geo-hq-ripple { animation: none; }
  .ck-loader-reveal-leave-active { transition: opacity 0.24s ease; }
  .ck-loader-reveal-leave-to { transform: none; }
}
</style>
