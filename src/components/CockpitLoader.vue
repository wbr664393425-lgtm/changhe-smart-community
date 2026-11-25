<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import BrandLogo from './BrandLogo.vue'
import {
  SVG_W,
  SVG_H,
  CHANGHE_GEO_SVG as geoSvg,
  computeOuterPointAtRatio
} from '../utils/changheGeoSvg'

const props = defineProps({
  visible: { type: Boolean, default: false },
  targetProgress: { type: Number, default: 4 },
  sceneReady: { type: Boolean, default: false },
  minCurtainMs: { type: Number, default: 2500 },
  holdMs: { type: Number, default: 400 },
  dark: { type: Boolean, default: false },
  fromLogin: { type: Boolean, default: false },
  fallbackNotice: { type: String, default: '' }
})

const emit = defineEmits(['reveal-ready'])

const STAGES = ['地理底图', '三维楼宇', '水系图层', '光影预热']

// ── 60fps 零 VDOM Diff 直驱引擎：高频属性由 rAF 直接写入 DOM/合成层，Vue 仅在整数百分比变化时更新 ──
const startPct = props.fromLogin ? 2 : 0
const displayPct = ref(props.visible ? startPct : 100)
const waterLayerRef = ref(null)
const outerGlowRef = ref(null)
const outerTraceRef = ref(null)
const innerSilkRef = ref(null)
const traceTipRef = ref(null)
const meterFillRef = ref(null)
const meterTipWrapRef = ref(null)

let smoothVal = props.visible ? startPct : 100
let startTime = 0
let lastTime = 0
let rafId = null
let holdTimer = null
let emittedReady = false

function paintVisualFrame(pct) {
  const p = Math.max(0, Math.min(100, pct))
  const ratio = p / 100
  const outerOffset = (1000 * (1 - ratio)).toFixed(2)
  const innerOffset = (1000 * (1 - Math.max(0, (p - 3) / 97))).toFixed(2)
  const waterOp = props.fromLogin
    ? (0.42 + 0.58 * Math.max(0, Math.min(1, (p - 4) / 68))).toFixed(3)
    : Math.max(0, Math.min(1, (p - 16) / 56)).toFixed(3)

  if (outerGlowRef.value) outerGlowRef.value.style.strokeDashoffset = outerOffset
  if (outerTraceRef.value) outerTraceRef.value.style.strokeDashoffset = outerOffset
  if (innerSilkRef.value) innerSilkRef.value.style.strokeDashoffset = innerOffset
  if (waterLayerRef.value) waterLayerRef.value.style.opacity = waterOp
  if (meterFillRef.value) meterFillRef.value.style.transform = `scaleX(${ratio.toFixed(5)})`
  if (meterTipWrapRef.value) {
    meterTipWrapRef.value.style.transform = `translate3d(${p.toFixed(3)}%, 0, 0)`
    meterTipWrapRef.value.style.opacity = p > 0.5 && p < 99.9 ? '1' : '0'
  }
  if (traceTipRef.value) {
    if (p > 0.8 && p < 99.8) {
      const head = computeOuterPointAtRatio(ratio)
      traceTipRef.value.style.opacity = '1'
      traceTipRef.value.style.transform = `translate3d(${head.x.toFixed(2)}px, ${head.y.toFixed(2)}px, 0)`
    } else {
      traceTipRef.value.style.opacity = '0'
    }
  }
}

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

  const dt = lastTime ? Math.min(34, Math.max(4, now - lastTime)) : 16.67
  lastTime = now
  const elapsed = now - startTime
  const cur = smoothVal

  // 恒流从容巡航曲线：按真实时间优雅推进，彻底避免因后台阶段停顿造成“走走停停”
  const minMs = Math.max(1200, props.minCurtainMs)
  const basePct = props.fromLogin ? 2 : 0
  const cruiseRatio = Math.min(1, elapsed / (minMs * 0.94))
  const cruisePct = basePct + (92 - basePct) * (1 - Math.pow(1 - cruiseRatio, 1.55))

  let desired
  if (!props.sceneReady) {
    // 后台仍在构建时：随恒流巡航稳步推进，最多温柔减速贴近 93.5%，绝不死停也不突跳
    const realCap = Math.min(93.5, Math.max(cruisePct, props.targetProgress * 0.92))
    const creep = cur >= 88 ? Math.min(93.5, cur + dt * 0.0022) : cur
    desired = Math.min(93.5, Math.max(realCap, creep))
  } else {
    const minRatio = Math.min(1, elapsed / minMs)
    const easedEnd = 1 - Math.pow(1 - minRatio, 1.45)
    desired = minRatio < 1 ? Math.max(cur, Math.min(99.4, basePct + (100 - basePct) * easedEnd)) : 100
  }

  // 时间归一化指数阻尼 + 连续加速收敛（取消 minMs 处的阶跃跳档）+ 单帧最大步长限幅
  const finishBlend = props.sceneReady
    ? Math.min(1, Math.max(0, (elapsed - minMs * 0.72) / (minMs * 0.28)))
    : 0
  const k = 0.0056 + finishBlend * 0.0044
  const alpha = 1 - Math.exp(-k * dt)
  const rawDelta = Math.max(0, desired - cur) * alpha
  const minCruiseStep = props.sceneReady ? dt * (0.006 + finishBlend * 0.014) : 0
  const maxStep = dt * (0.038 + finishBlend * 0.022)
  const step = Math.min(maxStep, Math.max(rawDelta, desired > cur ? minCruiseStep : 0))
  smoothVal = Math.min(desired, cur + step)

  paintVisualFrame(smoothVal)

  const rounded = Math.min(100, Math.floor(smoothVal + 0.15))
  if (rounded !== displayPct.value) {
    displayPct.value = rounded
  }

  if (props.sceneReady && smoothVal >= 99.75 && elapsed >= minMs) {
    smoothVal = 100
    displayPct.value = 100
    paintVisualFrame(100)
    emittedReady = true
    rafId = null
    holdTimer = setTimeout(() => {
      holdTimer = null
      emit('reveal-ready')
    }, props.fallbackNotice ? 440 : props.holdMs)
    return
  }

  rafId = requestAnimationFrame(tick)
}

function startTicker() {
  if (!props.visible || emittedReady || rafId !== null) return
  startTime = performance.now()
  lastTime = startTime
  paintVisualFrame(smoothVal)
  rafId = requestAnimationFrame(tick)
}

onMounted(() => {
  if (props.visible) {
    paintVisualFrame(smoothVal)
    startTicker()
  }
})

watch(() => props.visible, (vis) => {
  if (vis) {
    emittedReady = false
    const resumePct = props.fromLogin ? 2 : 0
    smoothVal = resumePct
    displayPct.value = resumePct
    startTicker()
  } else {
    stopTicker()
  }
})

onBeforeUnmount(stopTicker)

const isComplete = computed(() => displayPct.value >= 100)

const stageMeta = computed(() => {
  if (props.fallbackNotice) {
    return { index: 3, label: props.fallbackNotice }
  }
  const p = displayPct.value
  if (p >= 100) return { index: 3, label: '全景沙盘已就绪，即将进入驾驶舱' }
  if (p >= 82) return { index: 3, label: '正在编译三维光影与首帧渲染管线' }
  if (p >= 60) return { index: 2, label: '正在渲染岔河水系与社区拓扑图层' }
  if (p >= 34) return { index: 1, label: '正在分片构建 4,205 栋三维楼宇白模' }
  return { index: 0, label: '正在拉取高清地理底图与卫星影像' }
})

const litCommunitiesCount = computed(() =>
  geoSvg.communities.filter((c) => displayPct.value >= c.threshold).length
)
const hqLit = computed(() => displayPct.value >= 84)

function isCommFresh(comm) {
  return displayPct.value >= comm.threshold && displayPct.value < comm.threshold + 12
}
</script>

<template>
  <Transition name="ck-loader-reveal">
    <div
      v-if="visible"
      class="ck-loader-curtain"
      :class="{ 'is-dark': dark, 'is-complete': isComplete, 'is-from-login': fromLogin }"
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

            <!-- 真实岔河与长河公园大湖浅水纹（裁剪于街道疆域内，由 rAF 直驱 opacity 柔缓显影） -->
            <g
              ref="waterLayerRef"
              class="ck-geo-water"
              clip-path="url(#ckLoaderOuterClip)"
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

            <!-- 14 社区真实界线：随整数进度逐个点亮 -->
            <g class="ck-geo-communities">
              <path
                v-for="comm in geoSvg.communities"
                :key="comm.name"
                :d="comm.path"
                class="ck-geo-comm-poly"
                :class="{
                  'is-lit': displayPct >= comm.threshold,
                  'is-fresh': isCommFresh(comm)
                }"
              />
            </g>

            <!-- 外轮廓底刻线 -->
            <path v-once :d="geoSvg.outerPath" class="ck-geo-outer-ghost" />

            <!-- 外轮廓半透明宽辉光层 + 动态描边主线 + 内金丝随行细轨（rAF 直驱 strokeDashoffset，零 VDOM diff） -->
            <path
              ref="outerGlowRef"
              :d="geoSvg.outerPath"
              pathLength="1000"
              class="ck-geo-outer-glow"
              stroke="url(#ckLoaderTraceGrad)"
            />
            <path
              ref="outerTraceRef"
              :d="geoSvg.outerPath"
              pathLength="1000"
              class="ck-geo-outer-trace"
              stroke="url(#ckLoaderTraceGrad)"
            />
            <path
              ref="innerSilkRef"
              :d="geoSvg.outerPath"
              pathLength="1000"
              class="ck-geo-inner-silk"
            />

            <!-- 14 社区中心脉络点与简称微水印（改用 CSS transform scale 替代 SVG 半径重排） -->
            <g class="ck-geo-dots">
              <g
                v-for="comm in geoSvg.communities"
                :key="comm.name + '-dot'"
                class="ck-geo-comm-node"
                :class="{
                  'is-lit': displayPct >= comm.threshold,
                  'is-fresh': isCommFresh(comm)
                }"
              >
                <circle
                  :cx="comm.cx"
                  :cy="comm.cy"
                  r="2.45"
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
            <g class="ck-geo-hq" :class="{ 'is-from-login': fromLogin, 'is-lit': hqLit, 'is-complete': isComplete }">
              <circle v-if="isComplete" :cx="geoSvg.hqPt[0]" :cy="geoSvg.hqPt[1]" r="10" class="ck-geo-hq-ripple" />
              <circle :cx="geoSvg.hqPt[0]" :cy="geoSvg.hqPt[1]" r="10.5" class="ck-geo-hq-ring" />
              <circle :cx="geoSvg.hqPt[0]" :cy="geoSvg.hqPt[1]" r="4.2" class="ck-geo-hq-core" />
            </g>

            <!-- 描边前端测绘笔尖光点（rAF 直驱 GPU translate3d） -->
            <g
              ref="traceTipRef"
              class="ck-geo-tip"
            >
              <circle r="7" class="ck-geo-tip-halo" />
              <circle r="2.6" class="ck-geo-tip-dot" />
            </g>
          </svg>

          <div class="ck-map-meta num" :class="{ 'is-handoff-in': fromLogin }">
            <span>长河街道实景疆域</span>
            <i aria-hidden="true"></i>
            <span>已点亮 {{ litCommunitiesCount }}/14 社区</span>
            <i aria-hidden="true"></i>
            <span>4,205 栋楼宇白模</span>
          </div>
        </div>

        <!-- 品牌主标 -->
        <div class="ck-loader-brand" :class="{ 'is-handoff-in': fromLogin }">
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
        <div class="ck-loader-meter" :class="{ 'is-handoff-in': fromLogin }">
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
            <div ref="meterFillRef" class="ck-meter-fill"></div>
            <div ref="meterTipWrapRef" class="ck-meter-tip-wrap" aria-hidden="true">
              <i class="ck-meter-tip"></i>
            </div>
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
  --ck-loader-bg-inner: color-mix(in oklab, var(--ck-panel-solid, #ffffff) 74%, var(--ck-frame, #f3f0eb));
  --ck-loader-ink: var(--ck-ink, #1a1817);
  --ck-loader-muted: var(--ck-muted, #5c5652);
  --ck-loader-faint: var(--ck-faint, #8a837e);
  --ck-loader-line: var(--ck-line, rgba(36, 28, 24, 0.1));
  --ck-loader-stroke-a: var(--primary, #b81c28);
  --ck-loader-stroke-b: var(--ck-accent, var(--primary, #b81c28));
  --ck-loader-stroke-c: color-mix(in oklab, var(--primary, #b81c28) 42%, #d8ae58);
  --ck-loader-fill-core: var(--primary, #b81c28);
  --ck-loader-fill-edge: var(--ck-accent, #b58d42);
  --ck-loader-water-fill: rgba(45, 122, 134, 0.18);
  --ck-loader-water-stroke: rgba(45, 122, 134, 0.36);
  --ck-loader-track: color-mix(in oklab, var(--ck-ink, #1a1817) 10%, transparent);

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
  --ck-loader-bg-inner: color-mix(in oklab, var(--ck-panel-solid, #171820) 86%, var(--ck-frame, #0c0d11));
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
  contain: layout style;
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
  opacity: 0;
  will-change: opacity;
}

.ck-loader-curtain.is-from-login .ck-geo-water {
  opacity: 0.42;
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
  stroke-dashoffset: 1000;
  opacity: 0.2;
}

.ck-geo-outer-trace {
  fill: none;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1000;
  stroke-dashoffset: 1000;
}

.ck-loader-curtain.is-from-login .ck-geo-outer-glow,
.ck-loader-curtain.is-from-login .ck-geo-outer-trace {
  stroke-dashoffset: 980;
}

.ck-geo-inner-silk {
  fill: none;
  stroke: var(--ck-loader-stroke-c);
  stroke-width: 0.9;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1000;
  stroke-dashoffset: 1000;
  opacity: 0.65;
}

.ck-geo-comm-dot {
  fill: color-mix(in srgb, var(--ck-loader-ink) 20%, transparent);
  transform-box: fill-box;
  transform-origin: center;
  transform: scale(0.56);
  transition: fill 0.42s ease, transform 0.42s cubic-bezier(0.22, 1, 0.36, 1);
}

.ck-geo-comm-node.is-lit .ck-geo-comm-dot {
  fill: var(--ck-loader-stroke-b);
  transform: scale(1);
}

.ck-geo-comm-node.is-fresh .ck-geo-comm-dot {
  fill: var(--ck-loader-stroke-a);
  transform: scale(1.18);
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

.ck-geo-hq.is-from-login:not(.is-lit) {
  opacity: 0.45;
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

.ck-geo-tip {
  opacity: 0;
  will-change: transform, opacity;
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
  contain: layout style;
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
  transform: scaleX(0);
  will-change: transform;
  overflow: hidden;
  background: linear-gradient(90deg, var(--ck-loader-stroke-a) 0%, var(--ck-loader-stroke-b) 68%, var(--ck-loader-stroke-c) 100%);
  box-shadow: 0 0 10px color-mix(in srgb, var(--ck-loader-stroke-a) 32%, transparent);
  z-index: 2;
}

.ck-loader-curtain.is-from-login .ck-meter-fill {
  transform: scaleX(0.02);
}

.ck-meter-tip-wrap {
  position: absolute;
  inset: 0;
  pointer-events: none;
  transform: translate3d(0%, 0, 0);
  opacity: 0;
  will-change: transform, opacity;
  transition: opacity 0.2s ease;
  z-index: 3;
}

.ck-meter-tip {
  position: absolute;
  left: 0;
  top: 50%;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: var(--ck-loader-stroke-c);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ck-loader-stroke-b) 28%, transparent);
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

/* 登录页承接进入驾驶舱时：背景、标尺与疆域 0ms 零跳动接棒，图注/标题/进度轨三段错峰柔浮 */
.ck-map-meta.is-handoff-in {
  animation: ckHandoffRise 0.28s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.ck-loader-brand.is-handoff-in {
  animation: ckHandoffRise 0.3s cubic-bezier(0.22, 1, 0.36, 1) 0.045s both;
}

.ck-loader-meter.is-handoff-in {
  animation: ckHandoffRise 0.32s cubic-bezier(0.22, 1, 0.36, 1) 0.09s both;
}

@keyframes ckHandoffRise {
  from {
    opacity: 0;
    transform: translate3d(0, 8px, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
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
  .ck-geo-hq-ripple,
  .ck-map-meta.is-handoff-in,
  .ck-loader-brand.is-handoff-in,
  .ck-loader-meter.is-handoff-in { animation: none; }
  .ck-meter-tip-wrap { transition: none; }
  .ck-loader-reveal-leave-active { transition: opacity 0.24s ease; }
  .ck-loader-reveal-leave-to { transform: none; }
}
</style>
