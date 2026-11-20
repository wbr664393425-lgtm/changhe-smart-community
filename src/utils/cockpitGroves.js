import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// 每种冠形由相交的主冠和侧冠构成，顶点色表现冠顶受光、内膛遮阴。
function crownShape(lobes, seed, distant = false) {
  const willow = seed === 4
  const parts = lobes.map(([cx, cy, cz, rx, ry, rz], i) => {
    const detail = i === 0 || willow ? 2 : 1
    const g = new THREE.IcosahedronGeometry(1, distant ? detail - 1 : detail)
    const vertices = g.getAttribute('position'), colors = [], radial = []
    for (let j = 0; j < vertices.count; j++) {
      const x = vertices.getX(j), y = vertices.getY(j), z = vertices.getZ(j)
      const noise = Math.sin(4.2 * x + 3.4 * z + seed) * Math.sin(3.6 * y - 2.2 * x + i)
      const azimuth = Math.atan2(z, x)
      const flutes = Math.cos(azimuth * (willow ? 10 : 5) + i + y * 2.3) * (1 - y*y)
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
  return result
}

export function buildCockpitGroves(trees, point, pixelScale) {
  const group = new THREE.Group()
  const leaf = new THREE.MeshStandardMaterial({ roughness: 0.96, vertexColors: true })
  const bark = new THREE.MeshStandardMaterial({ roughness: 1 })
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
  const pose = new THREE.Object3D()
  // 树干与分叉共享一份模型；林窗和树种分布保存在实例变换中。
  function branch(a, b, bottom, top) {
    const axis = b.clone().sub(a)
    const g = new THREE.CylinderGeometry(top, bottom, axis.length(), 6)
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), axis.normalize()))
    const mid = a.clone().lerp(b, 0.5)
    return g.translate(mid.x, mid.y, mid.z)
  }
  const fork = new THREE.Vector3(0,0.62,0)
  const wood = [branch(new THREE.Vector3(), fork, 0.12, 0.095),
    branch(fork, new THREE.Vector3(0.10,1.55,0.04), 0.095, 0.054),
    branch(fork, new THREE.Vector3(-0.44,1.39,0.11), 0.085, 0.04),
    branch(new THREE.Vector3(0.03,0.83,0), new THREE.Vector3(0.49,1.55,-0.13), 0.074, 0.037)]
  const trunks = new THREE.InstancedMesh(mergeGeometries(wood), bark, trees.length)
  wood.forEach(g => g.dispose())
  group.add(trunks)
  // 接触阴影承托树冠，远景缩小时仍能读出绿地与树林的区别。
  const size = 32, pixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dist = Math.hypot((x + 0.5) * 2 / size - 1, (y + 0.5) * 2 / size - 1)
    const i = 4 * (y * size + x)
    pixels[i] = pixels[i+1] = pixels[i+2] = 255
    pixels[i+3] = Math.round(255 * (1 - THREE.MathUtils.smoothstep(dist, 0.08, 1)))
  }
  const shadowTex = new THREE.DataTexture(pixels, size, size)
  shadowTex.magFilter = shadowTex.minFilter = THREE.LinearFilter
  shadowTex.needsUpdate = true
  const shade = new THREE.MeshBasicMaterial({
    color: '#334039', map: shadowTex, transparent: true, opacity: 0.35, depthWrite: false
  })
  shade.addEventListener('dispose', () => shadowTex.dispose())
  const shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI / 2), shade, trees.length)
  group.add(shadows)

  const tint = new THREE.Color()
  const crowns = []
  let distant = false
  let total = 0
  buckets.forEach((items, type) => {
    const canopy = new THREE.InstancedMesh(crownShape(forms[type], type + 1), leaf, items.length)
    crowns.push({ canopy, near: canopy.geometry, far: crownShape(forms[type], type + 1, true) })
    items.forEach(({p, r, seed}, i) => {
      pose.position.set(p.x, 0, p.y)
      pose.rotation.set(0, (seed % 628) * 0.01, 0)
      pose.scale.set(r, r * (0.86 + (seed % 31) / 100), r * (0.86 + (seed % 21) / 100))
      pose.updateMatrix()
      trunks.setMatrixAt(total, pose.matrix)
      canopy.setMatrixAt(i, pose.matrix)
      const value = 0.72 + (seed % 28) / 100
      const warmth = (seed % 13) / 75
      tint.setRGB(value * (type === 1 ? 0.80 : 0.98 + warmth), value, value * (type === 3 ? 1.06 : 0.86 + warmth))
      canopy.setColorAt(i, tint)
      pose.position.set(p.x - 0.23 * r, 0.055, p.y - 0.26 * r)
      pose.scale.set(2.94 * r, 1, 2.57 * r)
      pose.updateMatrix()
      shadows.setMatrixAt(total++, pose.matrix)
    })
    canopy.castShadow = canopy.receiveShadow = true
    group.add(canopy)
  })

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

  // 正在显示的几何体随场景统一释放。
  function disposeInactive() {
    for (const { near, far } of crowns) (distant ? near : far).dispose()
  }
  return { group, setTheme, updateDetail, disposeInactive }
}
