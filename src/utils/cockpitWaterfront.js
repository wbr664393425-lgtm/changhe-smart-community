import * as THREE from 'three'
import { Reflector } from 'three/addons/objects/Reflector.js'
import layout from './changheWaterfront.json'
import { buildCockpitBridges, buildCockpitBridgesAsync } from './cockpitBridges'
import { buildCockpitGroves, buildCockpitGrovesAsync } from './cockpitGroves'

// 倒影只绘制静态桥岸与树冠。主相机仍使用默认图层。
export const WATER_REFLECTION_LAYER = 1
const WATER_Y = 0.045

// 模块级单例缓存水体与驳岸静态 Indexed BufferGeometry，跨路由切回 0ms 复用
let cachedWaterfrontGeos = null

function matricesClose(a, b, eps = 1e-4) {
  const ae = a.elements
  const be = b.elements
  for (let i = 0; i < 16; i++) {
    if (Math.abs(ae[i] - be[i]) > eps) return false
  }
  return true
}

function createWater(geometry, shoreDistance, compact) {
  const mesh = new Reflector(geometry, { textureWidth: compact ? 384 : 640, textureHeight: compact ? 240 : 384, multisample: 0 })
  mesh.getRenderTarget().texture.type = THREE.UnsignedByteType
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = WATER_Y
  mesh.receiveShadow = true
  mesh.userData.sharedGeo = true
  const reflection = mesh.material.uniforms
  mesh.material.dispose()
  const material = new THREE.MeshStandardMaterial({ roughness: 0.39, metalness: 0.04 })
  mesh.material = material
  material.addEventListener('dispose', () => mesh.getRenderTarget().dispose())
  const uniforms = {
    uReflection: reflection.tDiffuse, uReflectionMatrix: reflection.textureMatrix,
    uDistance: { value: shoreDistance }, uTime: { value: 0 },
    uShallow: { value: new THREE.Color() }, uDeep: { value: new THREE.Color() },
    uRiverShallow: { value: new THREE.Color() }, uRiverDeep: { value: new THREE.Color() },
    uSky: { value: new THREE.Color() }, uSatellite: { value: 0 }, uNight: { value: 0 }
  }
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float riverMask;
        varying float isRiver;
        uniform mat4 uReflectionMatrix;
        varying vec4 waterProjection;
        varying vec2 waterXZ;
        varying vec2 shoreUV;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        isRiver = riverMask;
        waterProjection = uReflectionMatrix * vec4(position, 1.);
        waterXZ = vec2(position.x, -position.y);
        shoreUV = uv;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uDistance, uReflection;
        uniform float uTime, uSatellite, uNight;
        uniform vec3 uShallow, uDeep, uSky, uRiverShallow, uRiverDeep;
        varying float isRiver;
        varying vec4 waterProjection;
        varying vec2 waterXZ, shoreUV;
        float noiseHash(vec2 cell) {
          vec3 h = fract(vec3(cell.xyx) * vec3(.1031,.1030,.0973));
          h += dot(h, h.yzx + 33.33);
          return fract((h.x+h.y)*h.z);
        }
        float waterNoise(vec2 p) {
          vec2 cell = floor(p), f = fract(p);
          f = f*f*(3.-2.*f);
          return mix(mix(noiseHash(cell),noiseHash(cell+vec2(1,0)),f.x),
                     mix(noiseHash(cell+vec2(0,1)),noiseHash(cell+vec2(1,1)),f.x),f.y);
        }
        float filteredWave(float phase) {
          return sin(phase) * (1.0 - smoothstep(0.7, 3.1, fwidth(phase)));
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 p = waterXZ;
        float shore = texture2D(uDistance, shoreUV).r;
        float gust = 2.*waterNoise(p*.135 + vec2(uTime*.017,0.))-1.;
        vec2 warped = p + mix(1., .28, isRiver) * vec2(gust*2.6, 1.25*sin(p.x*.23 + gust*3.9));
        float longWave = filteredWave(dot(warped,vec2(.52,1.31)) + 3.3*gust - .62*uTime);
        float crossWave = filteredWave(dot(warped,vec2(-1.48,2.55)) + 1.65*longWave + .84*uTime);
        float capillary = filteredWave(dot(warped,vec2(1.87,4.86)) + 2.4*crossWave - 1.13*uTime);
        float wave = .42*longWave + .34*crossWave + .24*capillary;
        float ripplePhase = dot(warped,vec2(-1.28,7.55)) + 2.6*crossWave - 1.12*uTime;
        float ripples = filteredWave(ripplePhase);
        float windPatch = waterNoise(p*.51 + vec2(.025*uTime,-.014*uTime));
        float streak = smoothstep(.48,.94,ripples) * smoothstep(.46,.76,windPatch) * smoothstep(-.2,.55,crossWave);
        float depth = smoothstep(.025, .54, shore + .018*gust);
        vec3 bodyColor = mix(mix(uShallow,uDeep,depth), mix(uRiverShallow,uRiverDeep,depth), isRiver);
        float rippleStrength = mix(1., .39, isRiver);
        vec3 lake = bodyColor * (1.0 + .08*gust + rippleStrength*(.085*wave + .048*ripples));
        float glint = smoothstep(.23, .86, wave) * (.45 + .55*smoothstep(-.6,1.,gust));
        vec3 glintColor = mix(vec3(.09,.14,.14),vec3(.015,.055,.075),uNight);
        lake += glintColor*rippleStrength*(.40*glint*windPatch + .95*streak);
        diffuseColor.rgb = mix(lake, diffuseColor.rgb * (.98 + .065*wave), uSatellite*.81);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 slope = vec3(.037*crossWave + .024*capillary, 0., .054*longWave + .065*ripples);
        normal = normalize(normal + mat3(viewMatrix)*slope*rippleStrength);`)
      .replace('#include <opaque_fragment>', `
        vec2 distortion = vec2(crossWave*.0016 + capillary*.0009, longWave*.0018 + ripples*.0008);
        vec2 reflectUV = clamp(waterProjection.xy / waterProjection.w + distortion, .002, .998);
        vec3 mirrored = texture2D(uReflection, reflectUV).rgb;
        // 岸边物体比天空暗，让投影区保留轮廓，开阔水面只取掠射角的天光。
        vec3 reflectedShade = clamp(mirrored / max(uSky, vec3(.055)), vec3(.09), vec3(1.18));
        float fTerm = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0., 1.);
        float fresnel = fTerm * fTerm;
        float nightEmit = smoothstep(0.35, 0.85, uNight);
        if (nightEmit > 0.001) {
          outgoingLight += (lake * (.67 + .14 * wave) + vec3(.002, .006, .009)) * nightEmit;
        }
        outgoingLight *= mix(vec3(1.), reflectedShade, .59 - .27*uSatellite);
        outgoingLight = mix(outgoingLight, mirrored, (.065 + .16*fresnel)*(1.-.52*uSatellite)*mix(1.,.68,isRiver));
        #include <opaque_fragment>`)
  }

  const renderReflection = mesh.onBeforeRender
  const lastView = new THREE.Matrix4(), lastProjection = new THREE.Matrix4()
  const nightWaterTint = new THREE.Color('#71839a')
  let dirty = true, softDirty = false, lastUpdate = -Infinity, reflectionPaused = false, suppressDirty = false
  mesh.onBeforeRender = function(renderer, scene, camera) {
    if (reflectionPaused && (suppressDirty || !dirty)) return
    const now = performance.now()
    if (!dirty) {
      if (now - lastUpdate < 70) return
      if (!softDirty && matricesClose(lastView, camera.matrixWorld, 1e-4) && matricesClose(lastProjection, camera.projectionMatrix, 1e-5)) return
    }
    this.getReflectionCamera(camera).layers.set(WATER_REFLECTION_LAYER)
    renderReflection.call(this, renderer, scene, camera)
    lastView.copy(camera.matrixWorld)
    lastProjection.copy(camera.projectionMatrix)
    dirty = false
    softDirty = false
    lastUpdate = now
  }
  return {
    mesh,
    advance(seconds) { uniforms.uTime.value = seconds },
    setReflectionPaused(paused, forceSuppress = false) {
      reflectionPaused = Boolean(paused)
      suppressDirty = Boolean(paused && forceSuppress)
      if (!reflectionPaused) dirty = true
    },
    setAtmosphere({ sky, shallow, deep, riverShallow, riverDeep, nightFactor = 0, waterTint, satellite = null, forceReflection = true }) {
      if (forceReflection) dirty = true
      else softDirty = true
      if (sky) uniforms.uSky.value.set(sky)
      if (shallow) uniforms.uShallow.value.set(shallow)
      if (deep) uniforms.uDeep.value.set(deep)
      if (riverShallow) uniforms.uRiverShallow.value.set(riverShallow)
      if (riverDeep) uniforms.uRiverDeep.value.set(riverDeep)
      uniforms.uNight.value = nightFactor
      uniforms.uSatellite.value = satellite ? 1 : 0
      if (waterTint) material.color.set(waterTint)
      else material.color.set('#ffffff').lerp(nightWaterTint, nightFactor)
      if (material.map !== satellite) { material.map = satellite; material.needsUpdate = true }
    },
    setTheme(theme, night, satellite) {
      dirty = true
      uniforms.uSky.value.set(theme.bg)
      uniforms.uShallow.value.set(night ? '#346678' : '#82bfb6')
      uniforms.uDeep.value.set(night ? '#1e435a' : '#347f8d')
      uniforms.uRiverShallow.value.set(night ? '#344f58' : '#748981')
      uniforms.uRiverDeep.value.set(night ? '#1c3846' : '#425f63')
      uniforms.uNight.value = Number(night)
      uniforms.uSatellite.value = satellite ? 1 : 0
      material.color.set(night ? '#71839a' : '#ffffff')
      if (material.map !== satellite) { material.map = satellite; material.needsUpdate = true }
    }
  }
}

function getOrBuildWaterfrontGeos(xWest, zNorth, xEast, zSouth, point, scaleX, scaleZ, width, height) {
  if (cachedWaterfrontGeos) return cachedWaterfrontGeos

  const wPos = [], wNorm = [], wUvs = [], wRiver = [], wIdx = []
  let wvOffset = 0

  const bPos = [], bNorm = [], bColors = [], bIdx = []
  let bvOffset = 0
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3()

  function roundedBank(pixels) {
    const ring = pixels.map(point)
    return ring.flatMap((v, i) => {
      const [x, y] = pixels[i]
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return [v]
      const prev = ring[(i + ring.length - 1) % ring.length], next = ring[(i + 1) % ring.length]
      const radius = Math.min(1.22, v.distanceTo(prev) * 0.23, v.distanceTo(next) * 0.23)
      const a = v.clone().lerp(prev, radius / v.distanceTo(prev))
      const b = v.clone().lerp(next, radius / v.distanceTo(next))
      return [a, v.clone().multiplyScalar(0.5).addScaledVector(a, 0.25).addScaledVector(b, 0.25), b]
    })
  }

  for (const [index, polygon] of layout.water.entries()) {
    const river = index === layout.riverIndex
    const rings = polygon.map(roundedBank)
    const vertices = rings.flat()
    const baseW = wvOffset
    for (let vi = 0; vi < vertices.length; vi++) {
      const { x, y: z } = vertices[vi]
      wPos.push(x, -z, 0)
      wNorm.push(0, 0, 1)
      wRiver.push(river ? 1 : 0)
      wUvs.push((x - xWest) / (xEast - xWest), (zSouth - z) / (zSouth - zNorth))
      wvOffset++
    }
    for (const face of THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1))) {
      wIdx.push(baseW + face[2], baseW + face[1], baseW + face[0])
    }

    for (const ring of rings) {
      const offsets = ring.map((v, i) => {
        const prev = ring[(i + ring.length - 1) % ring.length], next = ring[(i + 1) % ring.length]
        const a = new THREE.Vector2(v.y - prev.y, prev.x - v.x).normalize()
        const b = new THREE.Vector2(next.y - v.y, v.x - next.x).normalize()
        const miter = a.clone().add(b).normalize()
        return miter.multiplyScalar(1 / Math.max(0.63, miter.dot(b)))
      })
      const section = river
        ? [[-0.48,0.03,0.69], [-0.24,0.12,0.78], [0.19,0.055,0.72], [0.25,0.045,0.60]]
        : [[-0.34,0.03,0.69], [-0.16,0.36,0.82], [0.14,0.36,1.00],
          [0.16,0.17,0.55], [0.36,0.12,0.79], [0.40,0.045,0.58]]
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length, a = ring[i], b = ring[j]
        if ((Math.abs(a.x - b.x) < 0.001 && (a.x < xWest + scaleX || a.x > xEast - scaleX)) ||
            (Math.abs(a.y - b.y) < 0.001 && (a.y < zNorth + scaleZ || a.y > zSouth - scaleZ))) continue
        for (let k = 0; k < section.length - 1; k++) {
          const [off0, y0, shade] = section[k]
          const [off1, y1] = section[k + 1]
          const ax0 = ring[i].x + offsets[i].x * off0, az0 = ring[i].y + offsets[i].y * off0
          const bx0 = ring[j].x + offsets[j].x * off0, bz0 = ring[j].y + offsets[j].y * off0
          const bx1 = ring[j].x + offsets[j].x * off1, bz1 = ring[j].y + offsets[j].y * off1
          const ax1 = ring[i].x + offsets[i].x * off1, az1 = ring[i].y + offsets[i].y * off1
          e1.set(bx0 - ax0, y0 - y0, bz0 - az0)
          e2.set(bx1 - ax0, y1 - y0, bz1 - az0)
          fn.crossVectors(e1, e2).normalize()
          const r = shade * (river ? 0.72 : 1), g = shade, bl = shade * (river ? 0.77 : 1)
          const base = bvOffset
          bPos.push(ax0, y0, az0, bx0, y0, bz0, bx1, y1, bz1, ax1, y1, az1)
          bNorm.push(fn.x, fn.y, fn.z, fn.x, fn.y, fn.z, fn.x, fn.y, fn.z, fn.x, fn.y, fn.z)
          bColors.push(r, g, bl, r, g, bl, r, g, bl, r, g, bl)
          bIdx.push(base, base + 1, base + 2, base, base + 2, base + 3)
          bvOffset += 4
        }
      }
    }
  }

  const waterGeometry = new THREE.BufferGeometry()
  waterGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3))
  waterGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(wNorm, 3))
  waterGeometry.setAttribute('riverMask', new THREE.Float32BufferAttribute(wRiver, 1))
  waterGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(wUvs, 2))
  waterGeometry.setIndex(wvOffset <= 65535 ? new THREE.Uint16BufferAttribute(wIdx, 1) : new THREE.Uint32BufferAttribute(wIdx, 1))
  waterGeometry.computeBoundingSphere()

  const bankGeometry = new THREE.BufferGeometry()
  bankGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bPos, 3))
  bankGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(bNorm, 3))
  bankGeometry.setAttribute('color', new THREE.Float32BufferAttribute(bColors, 3))
  bankGeometry.setIndex(bvOffset <= 65535 ? new THREE.Uint16BufferAttribute(bIdx, 1) : new THREE.Uint32BufferAttribute(bIdx, 1))
  bankGeometry.computeBoundingSphere()

  cachedWaterfrontGeos = { waterGeometry, bankGeometry }
  return cachedWaterfrontGeos
}

async function getOrBuildWaterfrontGeosAsync(xWest, zNorth, xEast, zSouth, point, scaleX, scaleZ, width, height, yieldFn) {
  if (cachedWaterfrontGeos) return cachedWaterfrontGeos

  const wPos = [], wNorm = [], wUvs = [], wRiver = [], wIdx = []
  let wvOffset = 0
  const bPos = [], bNorm = [], bColors = [], bIdx = []
  let bvOffset = 0
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3()

  function roundedBank(pixels) {
    const ring = pixels.map(point)
    return ring.flatMap((v, i) => {
      const [x, y] = pixels[i]
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return [v]
      const prev = ring[(i + ring.length - 1) % ring.length], next = ring[(i + 1) % ring.length]
      const radius = Math.min(1.22, v.distanceTo(prev) * 0.23, v.distanceTo(next) * 0.23)
      const a = v.clone().lerp(prev, radius / v.distanceTo(prev))
      const b = v.clone().lerp(next, radius / v.distanceTo(next))
      return [a, v.clone().multiplyScalar(0.5).addScaledVector(a, 0.25).addScaledVector(b, 0.25), b]
    })
  }

  let sliceStart = performance.now()
  for (const [index, polygon] of layout.water.entries()) {
    const river = index === layout.riverIndex
    const rings = polygon.map(roundedBank)
    const vertices = rings.flat()
    const baseW = wvOffset
    for (let vi = 0; vi < vertices.length; vi++) {
      const { x, y: z } = vertices[vi]
      wPos.push(x, -z, 0)
      wNorm.push(0, 0, 1)
      wRiver.push(river ? 1 : 0)
      wUvs.push((x - xWest) / (xEast - xWest), (zSouth - z) / (zSouth - zNorth))
      wvOffset++
    }
    for (const face of THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1))) {
      wIdx.push(baseW + face[2], baseW + face[1], baseW + face[0])
    }
    if (yieldFn && performance.now() - sliceStart >= 3.5) {
      await yieldFn()
      sliceStart = performance.now()
    }

    for (const ring of rings) {
      const offsets = ring.map((v, i) => {
        const prev = ring[(i + ring.length - 1) % ring.length], next = ring[(i + 1) % ring.length]
        const a = new THREE.Vector2(v.y - prev.y, prev.x - v.x).normalize()
        const b = new THREE.Vector2(next.y - v.y, v.x - next.x).normalize()
        const miter = a.clone().add(b).normalize()
        return miter.multiplyScalar(1 / Math.max(0.63, miter.dot(b)))
      })
      const section = river
        ? [[-0.48,0.03,0.69], [-0.24,0.12,0.78], [0.19,0.055,0.72], [0.25,0.045,0.60]]
        : [[-0.34,0.03,0.69], [-0.16,0.36,0.82], [0.14,0.36,1.00],
          [0.16,0.17,0.55], [0.36,0.12,0.79], [0.40,0.045,0.58]]
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length, a = ring[i], b = ring[j]
        if ((Math.abs(a.x - b.x) < 0.001 && (a.x < xWest + scaleX || a.x > xEast - scaleX)) ||
            (Math.abs(a.y - b.y) < 0.001 && (a.y < zNorth + scaleZ || a.y > zSouth - scaleZ))) continue
        for (let k = 0; k < section.length - 1; k++) {
          const [off0, y0, shade] = section[k]
          const [off1, y1] = section[k + 1]
          const ax0 = ring[i].x + offsets[i].x * off0, az0 = ring[i].y + offsets[i].y * off0
          const bx0 = ring[j].x + offsets[j].x * off0, bz0 = ring[j].y + offsets[j].y * off0
          const bx1 = ring[j].x + offsets[j].x * off1, bz1 = ring[j].y + offsets[j].y * off1
          const ax1 = ring[i].x + offsets[i].x * off1, az1 = ring[i].y + offsets[i].y * off1
          e1.set(bx0 - ax0, y0 - y0, bz0 - az0)
          e2.set(bx1 - ax0, y1 - y0, bz1 - az0)
          fn.crossVectors(e1, e2).normalize()
          const r = shade * (river ? 0.72 : 1), g = shade, bl = shade * (river ? 0.77 : 1)
          const base = bvOffset
          bPos.push(ax0, y0, az0, bx0, y0, bz0, bx1, y1, bz1, ax1, y1, az1)
          bNorm.push(fn.x, fn.y, fn.z, fn.x, fn.y, fn.z, fn.x, fn.y, fn.z, fn.x, fn.y, fn.z)
          bColors.push(r, g, bl, r, g, bl, r, g, bl, r, g, bl)
          bIdx.push(base, base + 1, base + 2, base, base + 2, base + 3)
          bvOffset += 4
        }
      }
      if (yieldFn && performance.now() - sliceStart >= 3.5) {
        await yieldFn()
        sliceStart = performance.now()
      }
    }
  }

  const waterGeometry = new THREE.BufferGeometry()
  waterGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3))
  waterGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(wNorm, 3))
  waterGeometry.setAttribute('riverMask', new THREE.Float32BufferAttribute(wRiver, 1))
  waterGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(wUvs, 2))
  waterGeometry.setIndex(wvOffset <= 65535 ? new THREE.Uint16BufferAttribute(wIdx, 1) : new THREE.Uint32BufferAttribute(wIdx, 1))
  waterGeometry.computeBoundingSphere()

  const bankGeometry = new THREE.BufferGeometry()
  bankGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bPos, 3))
  bankGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(bNorm, 3))
  bankGeometry.setAttribute('color', new THREE.Float32BufferAttribute(bColors, 3))
  bankGeometry.setIndex(bvOffset <= 65535 ? new THREE.Uint16BufferAttribute(bIdx, 1) : new THREE.Uint32BufferAttribute(bIdx, 1))
  bankGeometry.computeBoundingSphere()

  cachedWaterfrontGeos = { waterGeometry, bankGeometry }
  return cachedWaterfrontGeos
}

export async function createCockpitWaterfrontAsync(xWest, zNorth, xEast, zSouth, shoreDistance, compact, yieldFn) {
  const group = new THREE.Group()
  const [width, height] = layout.size
  const scaleX = (xEast - xWest) / width, scaleZ = (zSouth - zNorth) / height
  const point = ([x, y]) => new THREE.Vector2(xWest + (x + 0.5) * scaleX, zNorth + (y + 0.5) * scaleZ)

  const { waterGeometry, bankGeometry } = await getOrBuildWaterfrontGeosAsync(
    xWest, zNorth, xEast, zSouth, point, scaleX, scaleZ, width, height, yieldFn
  )
  if (yieldFn) await yieldFn()
  const water = createWater(waterGeometry, shoreDistance, compact)
  const bankMaterial = new THREE.MeshStandardMaterial({ roughness: 0.89, vertexColors: true })
  const bank = new THREE.Mesh(bankGeometry, bankMaterial)
  bank.receiveShadow = bank.castShadow = true
  bank.userData.sharedGeo = true
  if (yieldFn) await yieldFn()

  const bridges = await buildCockpitBridgesAsync(layout, point, scaleX, yieldFn)
  if (yieldFn) await yieldFn()

  const groves = await buildCockpitGrovesAsync(layout.trees, point, scaleX, yieldFn)
  if (yieldFn) await yieldFn()

  for (const obj of [bank, bridges.group, groves.group]) {
    obj.traverse(part => { if (part.isMesh && !part.material.transparent) part.layers.enable(WATER_REFLECTION_LAYER) })
  }
  group.add(water.mesh, bank, bridges.group, groves.group)
  const [west, east] = layout.bridges.find(b => b.name === '东方红路').ends.map(point)
  let lastVegNight = null
  const dayBankCol = new THREE.Color('#c7c6af')
  const nightBankCol = new THREE.Color()
  const scratchBankCol = new THREE.Color()
  return {
    group,
    bridgeFocus: west.lerp(east, 0.5),
    parkFocus: point([457, 366]),
    advance: water.advance,
    setReflectionPaused: water.setReflectionPaused,
    updateTreeDetail: groves.updateDetail,
    disposeInactive: groves.disposeInactive,
    setAtmosphere(opts) {
      water.setAtmosphere(opts)
      const nf = Math.max(0, Math.min(1, opts.nightFactor || 0))
      const gf = Math.max(nf, opts.glowFactor || 0)
      if (opts.bankColor) {
        scratchBankCol.set(opts.bankColor)
      } else {
        scratchBankCol.copy(dayBankCol).lerp(nightBankCol.set(opts.theme?.outerTop || '#2e2636'), nf)
      }
      bankMaterial.color.copy(scratchBankCol)
      const isNight = nf >= 0.5
      if (opts.theme) {
        bridges.setAtmosphere(opts.theme, nf, gf)
      }
      if (opts.theme && (lastVegNight !== isNight || opts.forceThemeSync)) {
        lastVegNight = isNight
        groves.setTheme(opts.theme, isNight)
      }
    },
    setTheme(theme, night, satellite) {
      lastVegNight = Boolean(night)
      water.setTheme(theme, night, satellite)
      bankMaterial.color.set(night ? theme.outerTop : '#c7c6af')
      bridges.setTheme(theme, night)
      groves.setTheme(theme, night)
    }
  }
}

export function createCockpitWaterfront(xWest, zNorth, xEast, zSouth, shoreDistance, compact) {
  const group = new THREE.Group()
  const [width, height] = layout.size
  const scaleX = (xEast - xWest) / width, scaleZ = (zSouth - zNorth) / height
  const point = ([x, y]) => new THREE.Vector2(xWest + (x + 0.5) * scaleX, zNorth + (y + 0.5) * scaleZ)

  const { waterGeometry, bankGeometry } = getOrBuildWaterfrontGeos(xWest, zNorth, xEast, zSouth, point, scaleX, scaleZ, width, height)
  const water = createWater(waterGeometry, shoreDistance, compact)
  const bankMaterial = new THREE.MeshStandardMaterial({ roughness: 0.89, vertexColors: true })
  const bank = new THREE.Mesh(bankGeometry, bankMaterial)
  bank.receiveShadow = bank.castShadow = true
  bank.userData.sharedGeo = true
  const bridges = buildCockpitBridges(layout, point, scaleX)
  const groves = buildCockpitGroves(layout.trees, point, scaleX)
  for (const obj of [bank, bridges.group, groves.group]) {
    obj.traverse(part => { if (part.isMesh && !part.material.transparent) part.layers.enable(WATER_REFLECTION_LAYER) })
  }
  group.add(water.mesh, bank, bridges.group, groves.group)
  const [west, east] = layout.bridges.find(b => b.name === '东方红路').ends.map(point)
  let lastVegNight = null
  const dayBankCol = new THREE.Color('#c7c6af')
  const nightBankCol = new THREE.Color()
  const scratchBankCol = new THREE.Color()
  return {
    group,
    bridgeFocus: west.lerp(east, 0.5),
    parkFocus: point([457, 366]),
    advance: water.advance,
    setReflectionPaused: water.setReflectionPaused,
    updateTreeDetail: groves.updateDetail,
    disposeInactive: groves.disposeInactive,
    setAtmosphere(opts) {
      water.setAtmosphere(opts)
      const nf = Math.max(0, Math.min(1, opts.nightFactor || 0))
      const gf = Math.max(nf, opts.glowFactor || 0)
      if (opts.bankColor) {
        scratchBankCol.set(opts.bankColor)
      } else {
        scratchBankCol.copy(dayBankCol).lerp(nightBankCol.set(opts.theme?.outerTop || '#2e2636'), nf)
      }
      bankMaterial.color.copy(scratchBankCol)
      const isNight = nf >= 0.5
      if (opts.theme) {
        bridges.setAtmosphere(opts.theme, nf, gf)
      }
      if (opts.theme && (lastVegNight !== isNight || opts.forceThemeSync)) {
        lastVegNight = isNight
        groves.setTheme(opts.theme, isNight)
      }
    },
    setTheme(theme, night, satellite) {
      lastVegNight = Boolean(night)
      water.setTheme(theme, night, satellite)
      bankMaterial.color.set(night ? theme.outerTop : '#c7c6af')
      bridges.setTheme(theme, night)
      groves.setTheme(theme, night)
    }
  }
}
