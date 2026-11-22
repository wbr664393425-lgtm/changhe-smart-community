import * as THREE from 'three'

// 模块级单例缓存 5 组桥梁合批 Indexed BufferGeometry，跨路由切回 0ms 复用
let cachedBridgeGeos = null

// 单位立方体（24 顶点 / 36 索引，6 个独立法线面），避免每根栏杆立柱都 new BoxGeometry().toNonIndexed()
const UNIT_BOX = (() => {
  const g = new THREE.BoxGeometry(1, 1, 1)
  const pos = g.getAttribute('position').array
  const norm = g.getAttribute('normal').array
  const idx = g.getIndex().array
  const result = {
    pos: new Float32Array(pos),
    norm: new Float32Array(norm),
    idx: new Uint16Array(idx),
    vCount: g.getAttribute('position').count
  }
  g.dispose()
  return result
})()

function createBucket() {
  return { pos: [], norm: [], idx: [], vOffset: 0 }
}

const _up = new THREE.Vector3(0, 1, 0)
const _axis = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _tmpV = new THREE.Vector3()
const _tmpN = new THREE.Vector3()
const _e1 = new THREE.Vector3()
const _e2 = new THREE.Vector3()
const _fn = new THREE.Vector3()

function appendBox(bucket, cx, cy, cz, sx, sy, sz, quat) {
  const base = bucket.vOffset
  const bPos = bucket.pos
  const bNorm = bucket.norm
  const bIdx = bucket.idx
  const uPos = UNIT_BOX.pos
  const uNorm = UNIT_BOX.norm
  const uIdx = UNIT_BOX.idx

  for (let i = 0; i < UNIT_BOX.vCount; i++) {
    const i3 = i * 3
    _tmpV.set(uPos[i3] * sx, uPos[i3 + 1] * sy, uPos[i3 + 2] * sz)
    _tmpN.set(uNorm[i3], uNorm[i3 + 1], uNorm[i3 + 2])
    if (quat) {
      _tmpV.applyQuaternion(quat)
      _tmpN.applyQuaternion(quat)
    }
    bPos.push(_tmpV.x + cx, _tmpV.y + cy, _tmpV.z + cz)
    bNorm.push(_tmpN.x, _tmpN.y, _tmpN.z)
  }
  for (let i = 0; i < uIdx.length; i++) {
    bIdx.push(base + uIdx[i])
  }
  bucket.vOffset += UNIT_BOX.vCount
}

function appendQuad(bucket, a, b, c, d) {
  _e1.subVectors(b, a)
  _e2.subVectors(c, a)
  _fn.crossVectors(_e1, _e2).normalize()
  const nx = _fn.x, ny = _fn.y, nz = _fn.z
  const base = bucket.vOffset
  bucket.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z)
  bucket.norm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz)
  bucket.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  bucket.vOffset += 4
}

function finalizeBucket(bucket) {
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(bucket.pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.norm, 3))
  geo.setIndex(
    bucket.vOffset <= 65535
      ? new THREE.Uint16BufferAttribute(bucket.idx, 1)
      : new THREE.Uint32BufferAttribute(bucket.idx, 1)
  )
  geo.computeBoundingSphere()
  return geo
}

function createBridgeBuilder(layout, point, pixelScale) {
  const buckets = {
    stone: createBucket(),
    steel: createBucket(),
    road: createBucket(),
    marking: createBucket(),
    lamp: createBucket()
  }

  function bar(bucketKey, a, b, width, depth = width) {
    _axis.subVectors(b, a)
    const lenSq = _axis.lengthSq()
    if (lenSq < 0.000001) return
    const len = Math.sqrt(lenSq)
    _axis.multiplyScalar(1 / len)
    _quat.setFromUnitVectors(_up, _axis)
    appendBox(buckets[bucketKey], (a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5, width, len, depth, _quat)
  }

  function build(path, width, kind) {
    const footpath = kind === 'walk'
    const cable = kind === 'cable'
    const length = path.getLength()
    const rise = footpath ? 0.48 : Math.min(0.82, length * 0.060)
    const sections = Math.ceil(length / 0.65)
    function station(t, offset = 0, above = 0) {
      const p = path.getPointAt(t), tangent = path.getTangentAt(t)
      const ramp = THREE.MathUtils.smoothstep(Math.min(t, 1 - t), 0, 0.22)
      return new THREE.Vector3(
        p.x - tangent.y * offset,
        0.08 + rise * ramp + above,
        p.y + tangent.x * offset
      )
    }

    // 连续断面，使用 4 顶点+6 索引四边面替代非索引展开，省去 33% 顶点与法线后算
    function sweep(bucketKey, center, halfWidth, bottom, top, t0 = 0, t1 = 1) {
      const bucket = buckets[bucketKey]
      const count = Math.max(1, Math.ceil((t1 - t0) * sections))
      let prev = null
      for (let i = 0; i <= count; i++) {
        const t = t0 + (t1 - t0) * i / count
        const low = typeof bottom === 'function' ? bottom(t) : bottom
        const ring = [
          station(t, center - halfWidth, low),
          station(t, center + halfWidth, low),
          station(t, center + halfWidth, top),
          station(t, center - halfWidth, top)
        ]
        if (i === 0) appendQuad(bucket, ring[0], ring[1], ring[2], ring[3])
        if (prev) {
          for (let k = 0; k < 4; k++) {
            const j = (k + 1) % 4
            appendQuad(bucket, prev[k], ring[k], ring[j], prev[j])
          }
        }
        if (i === count) appendQuad(bucket, ring[3], ring[2], ring[1], ring[0])
        prev = ring
      }
    }

    const edge = width / 2
    sweep('stone', 0, edge, -0.20, 0)
    sweep(footpath ? 'stone' : 'road', 0, edge - 0.06, 0, 0.025)
    const nSpans = cable ? 4 : footpath ? 7 : Math.max(2, Math.round(length / 3.3))
    for (const sign of [-1, 1]) {
      sweep('steel', sign * (edge - 0.17), 0.085, t => {
        const fraction = THREE.MathUtils.clamp((t - 0.20) / 0.60, 0, 1)
        return -0.31 - 0.43 * Math.pow(Math.cos(fraction * nSpans * Math.PI), 4)
      }, -0.15, 0.16, 0.84)
      const rail = sign * (edge - (footpath ? 0.024 : 0.045))
      sweep('stone', rail, footpath ? 0.024 : 0.045, 0.020, 0.045)
      sweep('steel', rail, 0.008, 0.078, 0.090)
      sweep(footpath ? 'steel' : 'stone', rail, footpath ? 0.010 : 0.018, 0.133, 0.150)
      const nPosts = Math.ceil(length / (footpath ? 0.19 : 0.26))
      for (let i = 0; i <= nPosts; i++) {
        const t = i / nPosts
        bar(footpath ? 'steel' : 'stone', station(t, rail, 0.04), station(t, rail, 0.14), footpath ? 0.015 : 0.032)
      }
      if (cable) {
        const mast = station(0.50, sign * edge * 0.26, 4.8)
        bar('stone', station(0.50, sign * edge, -0.22), mast, 0.23, 0.28)
        for (const direction of [-1, 1]) {
          for (let k = 1; k <= 6; k++) {
            const anchor = station(0.50 + direction * (0.037 + k * 0.035), sign * (edge - 0.08), 0.16)
            bar('steel', station(0.50, sign * edge * 0.26, 3.45 + k * 0.22), anchor, 0.034)
          }
        }
      }
      if (!footpath) {
        sweep('marking', sign * (edge - 0.37), 0.026, 0.026, 0.030)
        for (const t of [0.24, 0.50, 0.76]) {
          const pole = sign * (edge - 0.19)
          const head = station(t, pole - sign * 0.34, 1.43)
          bar('steel', station(t, pole, 0.026), station(t, pole, 1.31), 0.064)
          bar('steel', station(t, pole, 1.31), head, 0.057)
          bar('lamp', head, station(t, pole - sign * 0.56, 1.42), 0.10)
        }
      }
    }
    if (!footpath) {
      const dashes = Math.floor(length / 1.20)
      for (let i = 0; i < dashes; i++) {
        sweep('marking', 0, 0.041, 0.026, 0.031, (i + 0.12) / dashes, (i + 0.67) / dashes)
      }
    }
    for (let k = 0; k <= nSpans; k++) {
      const t = 0.20 + 0.60 * k / nSpans
      const dir = path.getTangentAt(t)
      const angle = -Math.atan2(dir.y, dir.x)
      _quat.setFromAxisAngle(_up, angle)
      const abutment = k === 0 || k === nSpans
      for (const side of abutment ? [0] : [-0.29, 0.29]) {
        const cap = station(t, side * width, -0.32)
        const height = cap.y + 0.015
        appendBox(
          buckets.stone,
          cap.x,
          height / 2 - 0.015,
          cap.z,
          abutment ? 0.58 : 0.30,
          height,
          abutment ? width * 0.94 : footpath ? 0.18 : 0.35,
          _quat
        )
      }
      if (!abutment) {
        const pad = station(t)
        appendBox(buckets.steel, pad.x, 0.10, pad.z, 0.58, 0.16, width * 0.83, _quat)
      }
      sweep('stone', 0, edge - 0.08, -0.39, -0.17, t - 0.19 / length, t + 0.19 / length)
    }
  }

  return {
    buckets,
    buildBridge(bridge) {
      const [a, b] = bridge.ends.map(point)
      build(new THREE.LineCurve(a, b), bridge.width * pixelScale, bridge.kind)
    },
    buildWalk() {
      const walk = new THREE.SplineCurve(layout.footbridge.map(point))
      build(walk, 0.56, 'walk')
    },
    finalize() {
      cachedBridgeGeos = {}
      for (const [key, bucket] of Object.entries(buckets)) {
        cachedBridgeGeos[key] = finalizeBucket(bucket)
      }
      return cachedBridgeGeos
    }
  }
}

function getOrBuildBridgeGeos(layout, point, pixelScale) {
  if (cachedBridgeGeos) return cachedBridgeGeos
  const builder = createBridgeBuilder(layout, point, pixelScale)
  for (const br of layout.bridges) builder.buildBridge(br)
  builder.buildWalk()
  return builder.finalize()
}

async function getOrBuildBridgeGeosAsync(layout, point, pixelScale, yieldFn) {
  if (cachedBridgeGeos) return cachedBridgeGeos
  const builder = createBridgeBuilder(layout, point, pixelScale)
  for (const br of layout.bridges) {
    builder.buildBridge(br)
    if (yieldFn) await yieldFn()
  }
  builder.buildWalk()
  if (yieldFn) await yieldFn()
  return builder.finalize()
}

export async function buildCockpitBridgesAsync(layout, point, pixelScale, yieldFn) {
  await getOrBuildBridgeGeosAsync(layout, point, pixelScale, yieldFn)
  return buildCockpitBridges(layout, point, pixelScale)
}

// 将桥面、箱梁、栏杆和墩柱按材质合批。所有断面都跟随同一条道路中心线。
export function buildCockpitBridges(layout, point, pixelScale) {
  const geos = getOrBuildBridgeGeos(layout, point, pixelScale)
  const group = new THREE.Group()
  const materials = {}

  for (const [key, geo] of Object.entries(geos)) {
    const material = new THREE.MeshStandardMaterial({ roughness: key === 'steel' ? 0.64 : 0.90 })
    materials[key] = material
    const mesh = new THREE.Mesh(geo, material)
    mesh.castShadow = key !== 'marking'
    mesh.receiveShadow = true
    mesh.userData.sharedGeo = true
    group.add(mesh)
  }
  function setTheme(theme, night) {
    materials.stone.color.set(night ? theme.roof : theme.top)
    materials.steel.color.set(night ? '#54758b' : '#718587')
    materials.road.color.set(night ? '#354b60' : '#899297')
    materials.marking.color.set(night ? '#b4d7dd' : '#efece0')
    materials.lamp.color.set(night ? '#ffe1b0' : theme.top)
    materials.lamp.emissive.set(night ? '#e7b377' : '#000000')
    materials.stone.emissive.set(night ? theme.outerTop : '#000000').multiplyScalar(0.27)
  }
  return { group, setTheme }
}
