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

let cachedPromise = null

function loadTexture(loader, url, isColor = true) {
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

/** 单例加载并缓存高德官方日/夜高清矢量地图、高清卫星图与岸线距离纹理（0ms 路由复用） */
export function loadChangheAmapAssets(onProgress) {
  if (cachedPromise) return cachedPromise

  cachedPromise = (async () => {
    const baseUrl = import.meta.env.BASE_URL || '/'
    const texLoader = new THREE.TextureLoader()
    let done = 0
    const step = () => {
      done++
      if (onProgress) onProgress(Math.min(96, Math.round((done / 4) * 100)))
    }
    const track = (p) => p.then((res) => { step(); return res })

    const [lightVecTex, darkVecTex, satTex, shoreDistanceTex] = await Promise.all([
      track(loadTexture(texLoader, `${baseUrl}textures/changhe-amap-light.jpg`, true)),
      track(loadTexture(texLoader, `${baseUrl}textures/changhe-amap-dark.jpg`, true)),
      track(loadTexture(texLoader, `${baseUrl}textures/changhe-sat-hd.jpg`, true)),
      track(loadTexture(texLoader, `${baseUrl}textures/changhe-shore-distance.png`, false))
    ])

    return { lightVecTex, darkVecTex, satTex, shoreDistanceTex }
  })().catch((err) => {
    cachedPromise = null
    throw err
  })

  return cachedPromise
}

/**
 * 将 4,205 栋高德精确多边形建筑一次性合批编译为极速静态 BufferGeometry + 屋顶锐利轮廓线
 * 仅 3 次 DrawCall 即可 60fps 渲染全城任意 L/U/T/回字形真实建筑轮廓！
 */
let cachedGeometries = null

export function buildMergedAmapBuildingGeometries(buildings) {
  if (cachedGeometries) return cachedGeometries

  const createBucket = () => ({ pos: [], norm: [], heightRatio: [], bldgId: [], roofEdges: [] })
  const inner = createBucket()
  const outer = createBucket()

  buildings.forEach(([pts, height, isInner], bldgIdx) => {
    if (!pts || pts.length < 3) return
    const bucket = isInner ? inner : outer

    // 统一将 2D 多边形按逆时针排列（保证墙面法线朝外、顶面法线朝上）
    const vec2s = pts.map(([x, z]) => new THREE.Vector2(x, -z))
    if (THREE.ShapeUtils.isClockWise(vec2s)) {
      vec2s.reverse()
    }
    const n = vec2s.length
    if (n < 3) return

    // 1. 屋顶多边形精确三角剖分
    const faces = THREE.ShapeUtils.triangulateShape(vec2s, [])
    for (let f = 0; f < faces.length; f++) {
      const [ia, ib, ic] = faces[f]
      const a = vec2s[ia], b = vec2s[ib], c = vec2s[ic]
      // 转回世界 (x, height, z = -y)
      bucket.pos.push(a.x, height, -a.y, b.x, height, -b.y, c.x, height, -c.y)
      bucket.norm.push(0, 1, 0, 0, 1, 0, 0, 1, 0)
      bucket.heightRatio.push(1.0, 1.0, 1.0)
      bucket.bldgId.push(bldgIdx, bldgIdx, bldgIdx)
    }

    // 2. 逐边构建垂直外立面墙体 + 屋顶锐利轮廓棱边
    for (let i = 0; i < n; i++) {
      const p1 = vec2s[i]
      const p2 = vec2s[(i + 1) % n]
      const x1 = p1.x, z1 = -p1.y
      const x2 = p2.x, z2 = -p2.y

      // 逆时针环在 (x, -z) 中对应世界 (x, z) 顺时针，外法线为 (-(z2-z1), 0, (x2-x1)) 方向校验
      const dx = x2 - x1
      const dz = z2 - z1
      const len = Math.hypot(dx, dz) || 1
      // 在 (x, y_2d = -z) 中 CCW 边的右手法线是 (dy, -dx) -> 世界 (-(z2-z1), 0, -(x2-x1))
      const nx = -dz / len
      const nz = dx / len

      // 两个三角形拼出精确立面矩形
      bucket.pos.push(
        x1, 0, z1, x2, 0, z2, x2, height, z2,
        x1, 0, z1, x2, height, z2, x1, height, z1
      )
      for (let k = 0; k < 6; k++) {
        bucket.norm.push(nx, 0, nz)
        bucket.bldgId.push(bldgIdx)
      }
      bucket.heightRatio.push(0, 0, 1, 0, 1, 1)

      // 屋顶边缘棱线
      bucket.roofEdges.push(x1, height + 0.04, z1, x2, height + 0.04, z2)
    }
  })

  const toGeo = (b) => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.norm, 3))
    geo.setAttribute('aHeightRatio', new THREE.Float32BufferAttribute(b.heightRatio, 1))
    geo.setAttribute('aBldgId', new THREE.Float32BufferAttribute(b.bldgId, 1))
    geo.computeBoundingSphere()

    const edgeGeo = new THREE.BufferGeometry()
    edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(b.roofEdges, 3))
    edgeGeo.computeBoundingSphere()
    return { meshGeo: geo, edgeGeo }
  }

  cachedGeometries = {
    inner: toGeo(inner),
    outer: toGeo(outer)
  }
  return cachedGeometries
}
