import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// 模块级单例缓存树干、树冠（near/far）与阴影盘几何体及实例矩阵，跨路由切回 0ms 复用
let cachedGroveStatic = null

// 每种冠形由相交的主冠和侧冠构成，顶点色表现冠顶受光、内膛遮阴。
function crownShape(lobes, seed, distant = false) {
  const willow = seed === 4
  const parts = lobes.map(([cx, cy, cz, rx, ry, rz], i) => {
    const detail = i === 0 || willow ? 2 : 1
    const g = new THREE.IcosahedronGeometry(1, distant ? detail - 1 : detail)
    g.deleteAttribute('uv')
    const vertices = g.getAttribute('position'), colors = [], radial = []
    for (let j = 0; j < vertices.count; j++) {
      const x = vertices.getX(j), y = vertices.getY(j), z = vertices.getZ(j)
      const noise = Math.sin(4.2 * x + 3.4 * z + seed) * Math.sin(3.6 * y - 2.2 * x + i)
      const azimuth = Math.atan2(z, x)
      const flutes = Math.cos(azimuth * (willow ? 10 : 5) + i + y * 2.3) * (1 - y * y)
      const r = 1 + 0.115 * noise + (willow ? 0.11 : 0.055) * flutes
      const h = cy + y * ry * r - (willow ? 0.19 : 0.045) * Math.max(0, flutes)
      vertices.setXYZ(j, cx + x * rx * r, h + (willow ? 0 : 0.11), cz + z * rz * r)
      radial.push(new THREE.Vector3(x / rx, y / ry, z / rz).normalize())
      const lit = 0.57 + 0.34 * THREE.MathUtils.smoothstep(h, 0.7, 2.9) + 0.11 * y + 0.045 * noise + 0.038 * flutes
      colors.push(lit, lit + 0.025, lit - 0.035)
    }
    g.computeVertexNormals()
    const normals = g.getAttribute('normal')
    const n = new THREE.Vector3()
    radial.forEach((outward, j) => {
      n.fromBufferAttribute(normals, j).lerp(outward, 0.56).normalize()
      normals.setXYZ(j, n.x, n.y, n.z)
    })
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    return g
  })
  const result = mergeGeometries(parts)
  parts.forEach(g => g.dispose())
  result.computeBoundingSphere()
  return result
}

function getOrBuildGroveStatic(trees, point, pixelScale) {
  if (cachedGroveStatic) return cachedGroveStatic

  const forms = [
    [[0,1.84,0,0.69,0.91,0.66], [-0.42,1.55,0.11,0.62,0.55,0.58], [0.44,1.65,0.16,0.55,0.62,0.58], [0.17,1.88,-0.40,0.52,0.67,0.51], [-0.18,2.21,0.19,0.50,0.56,0.51]],
    [[0,1.95,0,0.67,1.35,0.68], [-0.27,1.63,0.12,0.48,0.77,0.50], [0.25,2.04,-0.12,0.49,0.90,0.48]],
    [[0,1.60,0,0.88,0.76,0.77], [-0.39,1.71,-0.18,0.64,0.67,0.66], [0.38,1.74,0.12,0.65,0.64,0.70], [0.00,1.92,0.08,0.68,0.63,0.64]],
    [[0,1.94,0,0.72,0.63,0.72], [-0.49,1.40,0.12,0.53,0.92,0.61], [0.49,1.42,0.16,0.52,0.89,0.55],
      [-0.08,1.52,-0.48,0.71,0.89,0.52], [0.08,1.37,0.54,0.62,0.79,0.47]]
  ]
  const buckets = forms.map(() => [])
  for (const [x, y, radius, willow] of trees) {
    const seed = ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0)
    const grove = Math.sin(x * 0.082) + Math.cos(y * 0.12)
    const type = willow ? 3 : grove > 0.75 && seed % 5 !== 0 ? 1 : seed % 2 === 0 ? 0 : 2
    buckets[type].push({ p: point([x, y]), r: radius * pixelScale, seed })
  }

  function branch(a, b, bottom, top) {
    const axis = b.clone().sub(a)
    const g = new THREE.CylinderGeometry(top, bottom, axis.length(), 6)
    g.deleteAttribute('uv')
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()))
    const mid = a.clone().lerp(b, 0.5)
    return g.translate(mid.x, mid.y, mid.z)
  }
  const fork = new THREE.Vector3(0, 0.62, 0)
  const wood = [
    branch(new THREE.Vector3(), fork, 0.12, 0.095),
    branch(fork, new THREE.Vector3(0.10, 1.55, 0.04), 0.095, 0.054),
    branch(fork, new THREE.Vector3(-0.44, 1.39, 0.11), 0.085, 0.04),
    branch(new THREE.Vector3(0.03, 0.83, 0), new THREE.Vector3(0.49, 1.55, -0.13), 0.074, 0.037)
  ]
  const trunkGeo = mergeGeometries(wood)
  wood.forEach(g => g.dispose())
  trunkGeo.computeBoundingSphere()

  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)

  // 预计算接触阴影软圆纹理像素，复用静态数组
  const size = 32
  const shadowPixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot((x + 0.5) * 2 / size - 1, (y + 0.5) * 2 / size - 1)
      const i = 4 * (y * size + x)
      shadowPixels[i] = shadowPixels[i + 1] = shadowPixels[i + 2] = 255
      shadowPixels[i + 3] = Math.round(255 * (1 - THREE.MathUtils.smoothstep(dist, 0.08, 1)))
    }
  }

  const pose = new THREE.Object3D()
  const tint = new THREE.Color()
  const totalCount = trees.length
  const trunkMatrices = new Float32Array(totalCount * 16)
  const shadowMatrices = new Float32Array(totalCount * 16)
  const crownSpecs = []
  let total = 0

  buckets.forEach((items, type) => {
    // 跳过 0 棵树的空桶（如 willow=0），省去无用几何构建与空 InstancedMesh
    if (!items.length) return
    const near = crownShape(forms[type], type + 1, false)
    const far = crownShape(forms[type], type + 1, true)
    const matrices = new Float32Array(items.length * 16)
    const colors = new Float32Array(items.length * 3)
    items.forEach(({ p, r, seed }, i) => {
      pose.position.set(p.x, 0, p.y)
      pose.rotation.set(0, (seed % 628) * 0.01, 0)
      pose.scale.set(r, r * (0.86 + (seed % 31) / 100), r * (0.86 + (seed % 21) / 100))
      pose.updateMatrix()
      pose.matrix.toArray(trunkMatrices, total * 16)
      pose.matrix.toArray(matrices, i * 16)

      const value = 0.72 + (seed % 28) / 100
      const warmth = (seed % 13) / 75
      tint.setRGB(value * (type === 1 ? 0.80 : 0.98 + warmth), value, value * (type === 3 ? 1.06 : 0.86 + warmth))
      colors[i * 3] = tint.r
      colors[i * 3 + 1] = tint.g
      colors[i * 3 + 2] = tint.b

      pose.position.set(p.x - 0.23 * r, 0.055, p.y - 0.26 * r)
      pose.scale.set(2.94 * r, 1, 2.57 * r)
      pose.updateMatrix()
      pose.matrix.toArray(shadowMatrices, total * 16)
      total++
    })
    crownSpecs.push({ count: items.length, near, far, matrices, colors })
  })

  cachedGroveStatic = {
    totalCount: total,
    trunkGeo,
    shadowGeo,
    shadowSize: size,
    shadowPixels,
    trunkMatrices,
    shadowMatrices,
    crownSpecs
  }
  return cachedGroveStatic
}

export function buildCockpitGroves(trees, point, pixelScale) {
  const cached = getOrBuildGroveStatic(trees, point, pixelScale)
  const group = new THREE.Group()
  const leaf = new THREE.MeshStandardMaterial({ roughness: 0.96, vertexColors: true })
  const bark = new THREE.MeshStandardMaterial({ roughness: 1 })

  const trunks = new THREE.InstancedMesh(cached.trunkGeo, bark, cached.totalCount)
  trunks.instanceMatrix.array.set(cached.trunkMatrices)
  trunks.instanceMatrix.needsUpdate = true
  trunks.userData.sharedGeo = true
  group.add(trunks)

  const shadowTex = new THREE.DataTexture(cached.shadowPixels, cached.shadowSize, cached.shadowSize)
  shadowTex.magFilter = shadowTex.minFilter = THREE.LinearFilter
  shadowTex.needsUpdate = true
  const shade = new THREE.MeshBasicMaterial({
    color: '#334039', map: shadowTex, transparent: true, opacity: 0.35, depthWrite: false
  })
  shade.addEventListener('dispose', () => shadowTex.dispose())

  const shadows = new THREE.InstancedMesh(cached.shadowGeo, shade, cached.totalCount)
  shadows.instanceMatrix.array.set(cached.shadowMatrices)
  shadows.instanceMatrix.needsUpdate = true
  shadows.userData.sharedGeo = true
  group.add(shadows)

  const crowns = []
  let distant = false
  for (const spec of cached.crownSpecs) {
    const canopy = new THREE.InstancedMesh(spec.near, leaf, spec.count)
    canopy.instanceMatrix.array.set(spec.matrices)
    canopy.instanceMatrix.needsUpdate = true
    canopy.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(spec.colors), 3)
    canopy.castShadow = canopy.receiveShadow = true
    canopy.userData.sharedGeo = true
    group.add(canopy)
    crowns.push({ canopy, near: spec.near, far: spec.far })
  }

  function setTheme(theme, night) {
    leaf.color.set(night ? '#719da4' : '#9ab895').lerp(new THREE.Color(theme.outerTop), night ? 0.19 : 0.16)
    leaf.emissive.set(night ? '#13282b' : '#000000')
    bark.color.set(night ? '#4a5964' : '#7d7867')
    shade.opacity = night ? 0.21 : 0.29
  }

  // 使用同一组树位、冠幅和颜色，只有全景里小于数个像素的冠瓣减少细分。
  function updateDetail(unitsPerPixel) {
    const next = unitsPerPixel > (distant ? 0.21 : 0.27)
    if (next === distant) return
    distant = next
    for (const { canopy, near, far } of crowns) canopy.geometry = distant ? far : near
  }

  // 静态几何已由模块级单例缓存持久化复用，无需随组件卸载释放。
  function disposeInactive() {}
  return { group, setTheme, updateDetail, disposeInactive }
}
