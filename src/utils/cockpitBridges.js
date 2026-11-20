import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// 将桥面、箱梁、栏杆和墩柱按材质合批。所有断面都跟随同一条道路中心线。
export function buildCockpitBridges(layout, point, pixelScale) {
  const group = new THREE.Group()
  const parts = { stone: [], steel: [], road: [], marking: [], lamp: [] }
  const materials = {}
  const up = new THREE.Vector3(0, 1, 0)
  function bar(bucket, a, b, width, depth = width) {
    const axis = b.clone().sub(a)
    if (axis.lengthSq() < 0.000001) return
    const geometry = new THREE.BoxGeometry(width, axis.length(), depth).toNonIndexed()
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, axis.normalize()))
    geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
    parts[bucket].push(geometry)
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
      return new THREE.Vector3(p.x - tangent.y * offset,
        0.08 + rise * ramp + above, p.y + tangent.x * offset)
    }
    // 连续断面，避免逐段拼接在弯桥外侧产生裂缝。
    function sweep(bucket, center, halfWidth, bottom, top, t0 = 0, t1 = 1) {
      const count = Math.max(1, Math.ceil((t1 - t0) * sections))
      const vertices = []
      let prev
      for (let i = 0; i <= count; i++) {
        const t = t0 + (t1 - t0) * i / count
        const low = typeof bottom === 'function' ? bottom(t) : bottom
        const ring = [station(t, center - halfWidth, low), station(t, center + halfWidth, low),
          station(t, center + halfWidth, top), station(t, center - halfWidth, top)]
        function face(a, b, c) { vertices.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z) }
        if (i === 0) { face(ring[0], ring[1], ring[2]); face(ring[0], ring[2], ring[3]) }
        if (prev) {
          for (let k = 0; k < 4; k++) {
            const j = (k + 1) % 4
            face(prev[k], ring[k], ring[j]); face(prev[k], ring[j], prev[j])
          }
        }
        if (i === count) { face(ring[2], ring[1], ring[0]); face(ring[3], ring[2], ring[0]) }
        prev = ring
      }
      const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
      g.computeVertexNormals()
      parts[bucket].push(g)
    }
    const edge = width / 2
    sweep('stone', 0, edge, -0.20, 0)
    sweep(footpath ? 'stone' : 'road', 0, edge - 0.06, 0, 0.025)
    const nSpans = cable ? 4 : footpath ? 7 : Math.max(2, Math.round(length / 3.3))
    for (const sign of [-1, 1]) {
      // 变截面边梁在墩顶加深，跨中留出通水净空。
      sweep('steel', sign * (edge - 0.17), 0.085, t => {
        const fraction = THREE.MathUtils.clamp((t - 0.20) / 0.60, 0, 1)
        return -0.31 - 0.43 * Math.pow(Math.cos(fraction * nSpans * Math.PI), 4)
      }, -0.15, 0.16, 0.84)
      const rail = sign * (edge - (footpath ? 0.024 : 0.045))
      sweep('stone', rail, footpath ? 0.024 : 0.045, 0.020, 0.045)
      // 场景每单位为十米，护栏从桥面起高约 1.2 米。
      sweep('steel', rail, 0.008, 0.078, 0.090)
      sweep(footpath ? 'steel' : 'stone', rail, footpath ? 0.010 : 0.018, 0.133, 0.150)
      const nPosts = Math.ceil(length / (footpath ? 0.19 : 0.26))
      for (let i = 0; i <= nPosts; i++) {
        const t = i / nPosts
        bar(footpath ? 'steel' : 'stone', station(t, rail, 0.04), station(t, rail, 0.14), footpath ? 0.015 : 0.032)
      }
      if (cable) {
        // 新河路桥的塔位取自跨中影像，塔、索用沙盘简化断面表达。
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
      const abutment = k === 0 || k === nSpans
      for (const side of abutment ? [0] : [-0.29, 0.29]) {
        const cap = station(t, side * width, -0.32)
        const height = cap.y + 0.015
        const g = new THREE.BoxGeometry(abutment ? 0.58 : 0.30, height,
          abutment ? width * 0.94 : footpath ? 0.18 : 0.35).toNonIndexed()
        g.rotateY(angle).translate(cap.x, height / 2 - 0.015, cap.z)
        parts.stone.push(g)
      }
      if (!abutment) {
        const pad = station(t)
        const g = new THREE.BoxGeometry(0.58, 0.16, width * 0.83).toNonIndexed()
        g.rotateY(angle).translate(pad.x, 0.10, pad.z)
        parts.steel.push(g)
      }
      sweep('stone', 0, edge - 0.08, -0.39, -0.17, t - 0.19 / length, t + 0.19 / length)
    }
  }

  for (const { ends, width, kind } of layout.bridges) {
    const [a, b] = ends.map(point)
    build(new THREE.LineCurve(a, b), width * pixelScale, kind)
  }
  const walk = new THREE.SplineCurve(layout.footbridge.map(point))
  build(walk, 0.56, 'walk')

  for (const [key, geometries] of Object.entries(parts)) {
    // BoxGeometry 的 UV 对纯色构件无用，合批前统一顶点布局。
    geometries.forEach(g => g.deleteAttribute('uv'))
    const material = new THREE.MeshStandardMaterial({ roughness: key === 'steel' ? 0.64 : 0.90 })
    materials[key] = material
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material)
    mesh.castShadow = key !== 'marking'
    mesh.receiveShadow = true
    group.add(mesh)
    geometries.forEach(g => g.dispose())
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
