import * as THREE from 'three'

// 德州市天衢新区长河街道 1:1 真实地理世界坐标投影（1 Three.js 单位 = 10 米）
export const ORIGIN_LAT = 37.4408
export const ORIGIN_LNG = 116.3472
export const METERS_PER_DEG_LAT = 111320
export const METERS_PER_DEG_LNG = 111320 * Math.cos((ORIGIN_LAT * Math.PI) / 180)
export const WORLD_DIV = 10 // 1 unit = 10 meters

export function latLngToWorldXZ(lat, lng) {
  return [
    ((lng - ORIGIN_LNG) * METERS_PER_DEG_LNG) / WORLD_DIV,
    -((lat - ORIGIN_LAT) * METERS_PER_DEG_LAT) / WORLD_DIV
  ]
}

// 长河街道办事处真实经纬度（德州市天衢新区三八东路 1420 号，实景办公主楼，零水域重叠）
export const CHANGHE_HQ_LATLNG = [37.44875, 116.36286]

// 五章汇报推荐电影级真实地理机位（端庄 48°~52° 建筑规划俯瞰角，严格对应长河街道真实片区）
export const CHANGHE_CHAPTER_CAMERAS = [
  // 0. 全域家底与党建引领（端庄正南微偏西黄金俯瞰长河街道全境 14 社区）
  { pos: [-32, 415, 365], target: [6, 0, -14] },
  // 1. 十四社区治理体检（端正聚焦西片堤口与中轴核心小区）
  { pos: [-95, 225, 165], target: [-58, 2, -65] },
  // 2. 安全生产与经济脉动（聚焦星凯国际广场、泰和、德馨核心楼宇区）
  { pos: [-35, 205, 185], target: [8, 4, -38] },
  // 3. 城乡生态与防汛防火（俯瞰长河公园大湖、岔河水系与西南湿地湖泊）
  { pos: [-110, 235, 255], target: [-38, 2, 24] },
  // 4. 民情闭环与平安守护（正南偏东对称全景俯瞰 14 社区调度光弧）
  { pos: [65, 395, 360], target: [4, 0, -14] }
]

const baseUrl = import.meta.env.BASE_URL || '/'

const TEXTURE_SPECS = {
  lightVecTex: { url: `${baseUrl}textures/changhe-amap-light.webp`, isColor: true, fallbackBytes: 1450000 },
  darkVecTex: { url: `${baseUrl}textures/changhe-amap-dark.webp`, isColor: true, fallbackBytes: 1220000 },
  satTex: { url: `${baseUrl}textures/changhe-sat-hd.webp`, isColor: true, fallbackBytes: 4700000 },
  shoreDistanceTex: { url: `${baseUrl}textures/changhe-shore-distance.webp`, isColor: false, fallbackBytes: 770000 }
}

const cachedAssets = {
  lightVecTex: null,
  darkVecTex: null,
  satTex: null,
  shoreDistanceTex: null
}

const texturePromises = new Map()
const textureByteProgress = new Map()
const textureProgressListeners = new Map()

function getSpec(key) {
  return TEXTURE_SPECS[key] || null
}

function loadTextureFallback(loader, url, isColor = true) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        tex.wrapS = THREE.ClampToEdgeWrapping
        tex.wrapT = THREE.ClampToEdgeWrapping
        if (isColor) tex.colorSpace = THREE.SRGBColorSpace
        resolve(tex)
      },
      undefined,
      reject
    )
  })
}

async function decodeBlobToTexture(blob, isColor) {
  // 优先使用后台线程 createImageBitmap（预翻转 Y，避免主线程解码与 WebGL UNPACK_FLIP_Y 卡顿）
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, {
        imageOrientation: 'flipY',
        premultiplyAlpha: 'none'
      })
      const tex = new THREE.Texture(bitmap)
      tex.flipY = false
      tex.wrapS = THREE.ClampToEdgeWrapping
      tex.wrapT = THREE.ClampToEdgeWrapping
      if (isColor) tex.colorSpace = THREE.SRGBColorSpace
      tex.needsUpdate = true
      return tex
    } catch {
      // 老旧信创内核不支持 imageOrientation 选项时平滑回退至 Image 解码
    }
  }

  const objectUrl = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = objectUrl
    if (typeof img.decode === 'function') {
      try {
        await img.decode()
      } catch {
        await new Promise((resolve, reject) => {
          if (img.complete && img.naturalWidth > 0) return resolve()
          img.onload = resolve
          img.onerror = reject
        })
      }
    } else {
      await new Promise((resolve, reject) => {
        if (img.complete && img.naturalWidth > 0) return resolve()
        img.onload = resolve
        img.onerror = reject
      })
    }

    const tex = new THREE.Texture(img)
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    if (isColor) tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    return tex
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function loadTextureWithStream(url, isColor, onByteProgress) {
  // 兼容 file:// 协议或不支持 ReadableStream 的老旧信创内核，自动回退 TextureLoader
  if (typeof fetch !== 'function' || (typeof location !== 'undefined' && location.protocol === 'file:')) {
    const tex = await loadTextureFallback(new THREE.TextureLoader(), url, isColor)
    onByteProgress(1, 1, true)
    return tex
  }

  let res
  try {
    res = await fetch(url, { credentials: 'same-origin' })
  } catch {
    const tex = await loadTextureFallback(new THREE.TextureLoader(), url, isColor)
    onByteProgress(1, 1, true)
    return tex
  }

  if (!res.ok) {
    throw new Error(`纹理加载失败 (${res.status}): ${url}`)
  }

  const contentLength = Number(res.headers.get('content-length') || 0)
  let blob
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader()
    const chunks = []
    let received = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        received += value.byteLength
        onByteProgress(received, contentLength, false)
      }
    }
    blob = new Blob(chunks, { type: res.headers.get('content-type') || 'image/webp' })
    onByteProgress(received, Math.max(contentLength, received), false)
  } else {
    blob = await res.blob()
    onByteProgress(blob.size, blob.size, false)
  }

  const tex = await decodeBlobToTexture(blob, isColor)
  onByteProgress(blob.size, blob.size, true)
  return tex
}

/** 按需单例加载单张纹理，支持进度监听与多方并发复用 */
export function ensureAmapTexture(key, onByteProgress) {
  const spec = getSpec(key)
  if (!spec) return Promise.resolve(null)

  if (cachedAssets[key]) {
    if (onByteProgress) onByteProgress(spec.fallbackBytes, spec.fallbackBytes, true)
    return Promise.resolve(cachedAssets[key])
  }

  let listeners = textureProgressListeners.get(key)
  if (!listeners) {
    listeners = new Set()
    textureProgressListeners.set(key, listeners)
  }
  if (onByteProgress) {
    listeners.add(onByteProgress)
    const last = textureByteProgress.get(key)
    if (last) onByteProgress(last.loaded, last.total, last.decoded)
  }

  let promise = texturePromises.get(key)
  if (!promise) {
    textureByteProgress.set(key, { loaded: 0, total: spec.fallbackBytes, decoded: false })
    promise = loadTextureWithStream(spec.url, spec.isColor, (loaded, total, decoded) => {
      const next = {
        loaded,
        total: total > 0 ? Math.max(total, loaded) : spec.fallbackBytes,
        decoded: Boolean(decoded)
      }
      textureByteProgress.set(key, next)
      const set = textureProgressListeners.get(key)
      if (set) {
        set.forEach((fn) => {
          try { fn(next.loaded, next.total, next.decoded) } catch { /* noop */ }
        })
      }
    })
      .then((tex) => {
        cachedAssets[key] = tex
        textureProgressListeners.delete(key)
        return tex
      })
      .catch((err) => {
        texturePromises.delete(key)
        textureByteProgress.delete(key)
        textureProgressListeners.delete(key)
        throw err
      })
    texturePromises.set(key, promise)
  }

  return promise.finally(() => {
    if (onByteProgress) {
      textureProgressListeners.get(key)?.delete(onByteProgress)
    }
  })
}

/**
 * 首屏按需加载当前明暗对应的 1 张矢量底图（+ 仅驾驶舱模式加载岸线距离图）
 * 其余非首屏纹理在揭幕后通过 preloadSecondaryAmapAssets 静默预热，或切换时按需秒载
 */
export async function loadChangheAmapAssets(onProgress, options = {}) {
  const { initialDark = false, needShoreDistance = true } = options
  const primaryKey = initialDark ? 'darkVecTex' : 'lightVecTex'
  const requiredKeys = needShoreDistance ? [primaryKey, 'shoreDistanceTex'] : [primaryKey]

  if (requiredKeys.every((k) => Boolean(cachedAssets[k]))) {
    if (onProgress) onProgress(100)
    return cachedAssets
  }

  const state = requiredKeys.map((key) => ({
    loaded: 0,
    total: TEXTURE_SPECS[key].fallbackBytes,
    decoded: false
  }))

  let lastPct = 0
  const emitCombined = () => {
    if (!onProgress) return
    let sumLoaded = 0
    let sumTotal = 0
    let decodedCount = 0
    for (let i = 0; i < state.length; i++) {
      sumLoaded += Math.min(state[i].loaded, state[i].total)
      sumTotal += state[i].total
      if (state[i].decoded) decodedCount++
    }
    const dlRatio = sumTotal > 0 ? sumLoaded / sumTotal : 0
    const decRatio = decodedCount / state.length
    const pct = Math.max(lastPct, Math.min(100, Math.round(dlRatio * 84 + decRatio * 16)))
    if (pct >= lastPct) {
      lastPct = pct
      onProgress(pct)
    }
  }

  await Promise.all(
    requiredKeys.map((key, idx) =>
      ensureAmapTexture(key, (loaded, total, decoded) => {
        if (total > 0) state[idx].total = Math.max(total, loaded)
        state[idx].loaded = loaded
        if (decoded) state[idx].decoded = true
        emitCombined()
      })
    )
  )

  if (onProgress) onProgress(100)
  return cachedAssets
}

/** 揭幕完成后在浏览器空闲期静默预热另一明暗底图与高清卫星底图 */
export function preloadSecondaryAmapAssets(onTextureReady) {
  const keys = ['darkVecTex', 'lightVecTex', 'satTex'].filter((k) => !cachedAssets[k])
  if (!keys.length) return () => {}

  let cancelled = false
  let idleHandle = null
  const schedule = (fn) => {
    if (typeof requestIdleCallback === 'function') {
      idleHandle = requestIdleCallback(() => {
        idleHandle = null
        if (!cancelled) fn()
      }, { timeout: 2200 })
    } else {
      idleHandle = setTimeout(() => {
        idleHandle = null
        if (!cancelled) fn()
      }, 450)
    }
  }

  let idx = 0
  const runNext = () => {
    if (cancelled || idx >= keys.length) return
    const key = keys[idx++]
    ensureAmapTexture(key)
      .then((tex) => {
        if (!cancelled && tex && typeof onTextureReady === 'function') {
          onTextureReady(key, tex)
        }
      })
      .catch(() => { /* 后台预热失败静默忽略，切换时再按需重试 */ })
      .finally(() => {
        if (!cancelled && idx < keys.length) schedule(runNext)
      })
  }

  schedule(runNext)
  return () => {
    cancelled = true
    if (idleHandle !== null) {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(idleHandle)
      else clearTimeout(idleHandle)
      idleHandle = null
    }
  }
}

export function isChangheAssetsCached(initialDark = false, needShoreDistance = true) {
  const primaryKey = initialDark ? 'darkVecTex' : 'lightVecTex'
  const hasPrimary = Boolean(cachedAssets[primaryKey])
  const hasShore = !needShoreDistance || Boolean(cachedAssets.shoreDistanceTex)
  return Boolean(hasPrimary && hasShore && cachedGeometries)
}

/**
 * 将 4,205 栋高德精确多边形建筑一次性合批编译为极速 Indexed BufferGeometry + 屋顶轮廓线
 * 两遍预分配 TypedArray，零百万级 Array.push 扩容与临时 Vector2 GC，顶点数减少 ~39%~50%，显存降至 ~2.7 MB
 */
let cachedGeometries = null
let cachedGeometriesPromise = null
let lastGeoProgress = 0
const geoProgressListeners = new Set()

function notifyGeoProgress(pct) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)))
  if (clamped >= lastGeoProgress) {
    lastGeoProgress = clamped
    geoProgressListeners.forEach((fn) => {
      try { fn(clamped) } catch { /* noop */ }
    })
  }
}

function estimateBucketBounds(buildings) {
  const inner = { maxVerts: 0, maxIndices: 0, maxEdgeVerts: 0, maxEdgeIndices: 0 }
  const outer = { maxVerts: 0, maxIndices: 0, maxEdgeVerts: 0, maxEdgeIndices: 0 }
  for (let i = 0; i < buildings.length; i++) {
    const entry = buildings[i]
    const pts = entry?.[0]
    const n = pts ? pts.length : 0
    if (n < 3) continue
    const st = entry[2] ? inner : outer
    // 屋顶 n 个顶点（(n-2) 三角），每面墙 4 个顶点（2 三角 = 6 索引）
    st.maxVerts += n + n * 4
    st.maxIndices += (n - 2) * 3 + n * 6
    // 屋顶棱线共享 n 个顶点 + 2n 索引
    st.maxEdgeVerts += n
    st.maxEdgeIndices += n * 2
  }
  return { inner, outer }
}

function allocateBucketBuffers(bounds, withBldgId) {
  return {
    withBldgId,
    pos: new Float32Array(bounds.maxVerts * 3),
    norm: new Int16Array(bounds.maxVerts * 3),
    heightRatio: new Uint8Array(bounds.maxVerts),
    bldgId: withBldgId ? new Uint16Array(bounds.maxVerts) : null,
    indices: new Uint32Array(bounds.maxIndices),
    vOffset: 0,
    iOffset: 0,
    edgePos: new Float32Array(bounds.maxEdgeVerts * 3),
    edgeIndices: new Uint32Array(bounds.maxEdgeIndices),
    evOffset: 0,
    eiOffset: 0
  }
}

// 复用轮廓 Vector2 对象池（仅数十个实例，兼容 ShapeUtils.triangulateShape 的 .equals()，零 29,859 次 GC）
const _polyPool = []
function getScratchContour(pts) {
  const n = pts.length
  while (_polyPool.length < n) _polyPool.push(new THREE.Vector2())
  let area2 = 0
  for (let i = 0; i < n; i++) {
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    // 映射至 (x, -z) 2D 平面
    area2 += p1[0] * (-p2[1]) - p2[0] * (-p1[1])
  }
  const reverse = area2 < 0 // 顺时针时反转为逆时针，确保法线朝外、屋顶法线朝上
  const contour = new Array(n)
  for (let i = 0; i < n; i++) {
    const src = pts[reverse ? n - 1 - i : i]
    const v = _polyPool[i]
    v.set(src[0], -src[1])
    contour[i] = v
  }
  return contour
}

function appendBuildingToBuffers(entry, bldgIdx, inner, outer) {
  const [pts, height, isInner] = entry
  if (!pts || pts.length < 3) return
  const b = isInner ? inner : outer
  const contour = getScratchContour(pts)
  const n = contour.length
  if (n < 3) return

  const pos = b.pos
  const norm = b.norm
  const hr = b.heightRatio
  const bid = b.bldgId
  const indices = b.indices
  let v = b.vOffset
  let idxOut = b.iOffset

  // 1. 屋顶：写入 n 个共享顶点，按 triangulateShape 结果写入索引
  const roofBase = v
  for (let i = 0; i < n; i++) {
    const p = contour[i]
    const p3 = v * 3
    pos[p3] = p.x
    pos[p3 + 1] = height
    pos[p3 + 2] = -p.y
    norm[p3] = 0
    norm[p3 + 1] = 32767
    norm[p3 + 2] = 0
    hr[v] = 255
    if (bid) bid[v] = bldgIdx
    v++
  }

  const faces = THREE.ShapeUtils.triangulateShape(contour, [])
  for (let f = 0; f < faces.length; f++) {
    const face = faces[f]
    indices[idxOut++] = roofBase + face[0]
    indices[idxOut++] = roofBase + face[1]
    indices[idxOut++] = roofBase + face[2]
  }

  // 2. 垂直外立面：每条边 4 个顶点 + 6 个索引（共享对角线 2 个顶点）
  const edgePos = b.edgePos
  const edgeIndices = b.edgeIndices
  const edgeBase = b.evOffset
  let ev = edgeBase
  let ei = b.eiOffset
  const edgeY = height + 0.04

  for (let i = 0; i < n; i++) {
    const p1 = contour[i]
    const p2 = contour[(i + 1) % n]
    const x1 = p1.x
    const z1 = -p1.y
    const x2 = p2.x
    const z2 = -p2.y

    const dx = x2 - x1
    const dz = z2 - z1
    const len = Math.hypot(dx, dz) || 1
    const nx = Math.round((-dz / len) * 32767)
    const nz = Math.round((dx / len) * 32767)

    const base = v
    // v0: (x1, 0, z1)
    let p3 = v * 3
    pos[p3] = x1; pos[p3 + 1] = 0; pos[p3 + 2] = z1
    norm[p3] = nx; norm[p3 + 1] = 0; norm[p3 + 2] = nz
    hr[v] = 0
    if (bid) bid[v] = bldgIdx
    v++
    // v1: (x2, 0, z2)
    p3 = v * 3
    pos[p3] = x2; pos[p3 + 1] = 0; pos[p3 + 2] = z2
    norm[p3] = nx; norm[p3 + 1] = 0; norm[p3 + 2] = nz
    hr[v] = 0
    if (bid) bid[v] = bldgIdx
    v++
    // v2: (x2, height, z2)
    p3 = v * 3
    pos[p3] = x2; pos[p3 + 1] = height; pos[p3 + 2] = z2
    norm[p3] = nx; norm[p3 + 1] = 0; norm[p3 + 2] = nz
    hr[v] = 255
    if (bid) bid[v] = bldgIdx
    v++
    // v3: (x1, height, z1)
    p3 = v * 3
    pos[p3] = x1; pos[p3 + 1] = height; pos[p3 + 2] = z1
    norm[p3] = nx; norm[p3 + 1] = 0; norm[p3 + 2] = nz
    hr[v] = 255
    if (bid) bid[v] = bldgIdx
    v++

    indices[idxOut++] = base
    indices[idxOut++] = base + 1
    indices[idxOut++] = base + 2
    indices[idxOut++] = base
    indices[idxOut++] = base + 2
    indices[idxOut++] = base + 3

    // 屋顶轮廓棱线（共享 n 个顶点 + 2n 索引）
    const ep3 = ev * 3
    edgePos[ep3] = x1
    edgePos[ep3 + 1] = edgeY
    edgePos[ep3 + 2] = z1
    edgeIndices[ei++] = edgeBase + i
    edgeIndices[ei++] = edgeBase + ((i + 1) % n)
    ev++
  }

  b.vOffset = v
  b.iOffset = idxOut
  b.evOffset = ev
  b.eiOffset = ei
}

function finalizeBucketBuffers(b) {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(b.pos.subarray(0, b.vOffset * 3), 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(b.norm.subarray(0, b.vOffset * 3), 3, true))
  geo.setAttribute('aHeightRatio', new THREE.BufferAttribute(b.heightRatio.subarray(0, b.vOffset), 1, true))
  if (b.bldgId) {
    geo.setAttribute('aBldgId', new THREE.BufferAttribute(b.bldgId.subarray(0, b.vOffset), 1, false))
  }
  const indexSlice = b.indices.subarray(0, b.iOffset)
  geo.setIndex(
    b.vOffset <= 65535
      ? new THREE.BufferAttribute(new Uint16Array(indexSlice), 1)
      : new THREE.BufferAttribute(indexSlice, 1)
  )
  geo.computeBoundingSphere()

  const edgeGeo = new THREE.BufferGeometry()
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(b.edgePos.subarray(0, b.evOffset * 3), 3))
  const edgeIdxSlice = b.edgeIndices.subarray(0, b.eiOffset)
  edgeGeo.setIndex(
    b.evOffset <= 65535
      ? new THREE.BufferAttribute(new Uint16Array(edgeIdxSlice), 1)
      : new THREE.BufferAttribute(edgeIdxSlice, 1)
  )
  edgeGeo.computeBoundingSphere()

  return { meshGeo: geo, edgeGeo }
}

/**
 * 绘制后让帧原语（Double-Yield）：
 * 先等 requestAnimationFrame 进入动画帧，再用宏任务把重活推迟到浏览器完成本帧合成与上屏之后，
 * 确保加载幕布 60fps 动画帧绝不被后台构建逻辑抢占。
 */
export function yieldToPaint(extraDelayMs = 0) {
  return new Promise((resolve) => {
    let settled = false
    let rafId = null
    let timerId = null
    const done = () => {
      if (settled) return
      settled = true
      if (rafId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId)
      if (timerId !== null) clearTimeout(timerId)
      resolve()
    }
    if (typeof requestAnimationFrame === 'function' && (typeof document === 'undefined' || !document.hidden)) {
      rafId = requestAnimationFrame(() => {
        rafId = null
        timerId = setTimeout(done, extraDelayMs)
      })
      timerId = setTimeout(done, 52 + extraDelayMs)
    } else {
      timerId = setTimeout(done, extraDelayMs)
    }
  })
}

function yieldFrame() {
  return yieldToPaint(0)
}

export function buildMergedAmapBuildingGeometries(buildings) {
  if (cachedGeometries) return cachedGeometries

  const bounds = estimateBucketBounds(buildings)
  const inner = allocateBucketBuffers(bounds.inner, true)
  const outer = allocateBucketBuffers(bounds.outer, false)

  for (let i = 0; i < buildings.length; i++) {
    appendBuildingToBuffers(buildings[i], i, inner, outer)
  }

  cachedGeometries = {
    inner: finalizeBucketBuffers(inner),
    outer: finalizeBucketBuffers(outer)
  }
  return cachedGeometries
}

/** 分片异步构建 4,205 栋三维建筑 Indexed BufferGeometry，每帧让出主线程，低配/信创电脑进度条不假死 */
export function buildMergedAmapBuildingGeometriesAsync(buildings, onProgress) {
  if (cachedGeometries) {
    if (onProgress) onProgress(100)
    return Promise.resolve(cachedGeometries)
  }

  if (onProgress) {
    geoProgressListeners.add(onProgress)
    if (lastGeoProgress > 0) onProgress(lastGeoProgress)
  }

  if (!cachedGeometriesPromise) {
    lastGeoProgress = 0
    cachedGeometriesPromise = (async () => {
      const bounds = estimateBucketBounds(buildings)
      const inner = allocateBucketBuffers(bounds.inner, true)
      const outer = allocateBucketBuffers(bounds.outer, false)
      const total = buildings.length || 1
      let idx = 0

      while (idx < total) {
        const sliceStart = performance.now()
        const minBatch = 20
        let count = 0
        while (idx < total && (count < minBatch || performance.now() - sliceStart < 3.2)) {
          appendBuildingToBuffers(buildings[idx], idx, inner, outer)
          idx++
          count++
        }
        notifyGeoProgress((idx / total) * 92)
        if (idx < total) {
          await yieldFrame()
        }
      }

      await yieldFrame()
      const innerGeo = finalizeBucketBuffers(inner)
      notifyGeoProgress(96)
      await yieldFrame()
      const outerGeo = finalizeBucketBuffers(outer)

      cachedGeometries = { inner: innerGeo, outer: outerGeo }
      notifyGeoProgress(100)
      geoProgressListeners.clear()
      return cachedGeometries
    })().catch((err) => {
      cachedGeometriesPromise = null
      lastGeoProgress = 0
      geoProgressListeners.clear()
      throw err
    })
  }

  return cachedGeometriesPromise.finally(() => {
    if (onProgress) geoProgressListeners.delete(onProgress)
  })
}
