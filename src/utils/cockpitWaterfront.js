import * as THREE from 'three'
import { Reflector } from 'three/addons/objects/Reflector.js'
import layout from './changheWaterfront.json'
import { buildCockpitBridges } from './cockpitBridges'
import { buildCockpitGroves } from './cockpitGroves'

// 倒影只绘制静态桥岸与树冠。主相机仍使用默认图层。
export const WATER_REFLECTION_LAYER = 1
const WATER_Y = 0.045

function createWater(geometry, shoreDistance, compact) {
  const mesh = new Reflector(geometry, { textureWidth: compact ? 384 : 640, textureHeight: compact ? 240 : 384, multisample: 0 })
  mesh.getRenderTarget().texture.type = THREE.UnsignedByteType
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = WATER_Y
  mesh.receiveShadow = true
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
        lake += mix(vec3(.09,.14,.14),vec3(.015,.055,.075),uNight)*rippleStrength*(.40*glint*windPatch + .95*streak);
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
        float fresnel = pow(1.0-clamp(dot(normal,normalize(vViewPosition)),0.,1.),2.);
        outgoingLight += uNight * (lake * (.67+.14*wave) + vec3(.002,.006,.009));
        outgoingLight *= mix(vec3(1.), reflectedShade, .59 - .27*uSatellite);
        outgoingLight = mix(outgoingLight, mirrored, (.065 + .16*fresnel)*(1.-.52*uSatellite)*mix(1.,.68,isRiver));
        #include <opaque_fragment>`)
  }

  const renderReflection = mesh.onBeforeRender
  const lastView = new THREE.Matrix4(), lastProjection = new THREE.Matrix4()
  let dirty = true, lastUpdate = -Infinity
  mesh.onBeforeRender = function(renderer, scene, camera) {
    const now = performance.now()
    if (!dirty && (now - lastUpdate < 70 ||
        (lastView.equals(camera.matrixWorld) && lastProjection.equals(camera.projectionMatrix)))) return
    this.getReflectionCamera(camera).layers.set(WATER_REFLECTION_LAYER)
    renderReflection.call(this, renderer, scene, camera)
    lastView.copy(camera.matrixWorld)
    lastProjection.copy(camera.projectionMatrix)
    dirty = false
    lastUpdate = now
  }
  return {
    mesh,
    advance(seconds) { uniforms.uTime.value = seconds },
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

export function createCockpitWaterfront(xWest, zNorth, xEast, zSouth, shoreDistance, compact) {
  const group = new THREE.Group()
  const [width, height] = layout.size
  const scaleX = (xEast - xWest) / width, scaleZ = (zSouth - zNorth) / height
  const point = ([x,y]) => new THREE.Vector2(xWest + (x + 0.5) * scaleX, zNorth + (y + 0.5) * scaleZ)
  const positions = [], uvs = [], riverMask = [], banks = [], colors = []

  function roundedBank(pixels) {
    const ring = pixels.map(point)
    // 对栅格提取的折角做局部圆角，地图裁剪边保持笔直，岛孔仍独立三角化。
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
    for (const face of THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1))) {
      for (const index of [face[2], face[1], face[0]]) {
        const { x, y: z } = vertices[index]
        positions.push(x, -z, 0)
        riverMask.push(river ? 1 : 0)
        uvs.push((x - xWest) / (xEast - xWest), (zSouth - z) / (zSouth - zNorth))
      }
    }
    for (const ring of rings) {
      const offsets = ring.map((v,i) => {
        const prev = ring[(i + ring.length - 1) % ring.length], next = ring[(i + 1) % ring.length]
        const a = new THREE.Vector2(v.y - prev.y, prev.x - v.x).normalize()
        const b = new THREE.Vector2(next.y - v.y, v.x - next.x).normalize()
        const miter = a.clone().add(b).normalize()
        return miter.multiplyScalar(1 / Math.max(0.63, miter.dot(b)))
      })
      // 环的右侧为水，岸顶、压顶、驳岸立面与水下脚台按同一环线生成。
      const section = river
        ? [[-0.48,0.03,0.69], [-0.24,0.12,0.78], [0.19,0.055,0.72], [0.25,0.045,0.60]]
        : [[-0.34,0.03,0.69], [-0.16,0.36,0.82], [0.14,0.36,1.00],
        [0.16,0.17,0.55], [0.36,0.12,0.79], [0.40,0.045,0.58]]
      for (let i = 0; i < ring.length; i++) {
        const j = (i+1) % ring.length, a = ring[i], b = ring[j]
        if ((Math.abs(a.x-b.x)<0.001 && (a.x<xWest+scaleX || a.x>xEast-scaleX)) ||
            (Math.abs(a.y-b.y)<0.001 && (a.y<zNorth+scaleZ || a.y>zSouth-scaleZ))) continue
        for (let k = 0; k < section.length - 1; k++) {
          for (const [v, s] of [[i,k],[j,k],[j,k+1],[i,k],[j,k+1],[i,k+1]]) {
            const [offset, y] = section[s]
            banks.push(ring[v].x + offsets[v].x * offset, y, ring[v].y + offsets[v].y * offset)
            const shade = section[k][2]
            colors.push(shade * (river ? .72 : 1), shade, shade * (river ? .77 : 1))
          }
        }
      }
    }
  }
  function geometry(coords) {
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(coords, 3))
    g.computeVertexNormals()
    return g
  }
  const waterGeometry = geometry(positions)
  waterGeometry.setAttribute('riverMask', new THREE.Float32BufferAttribute(riverMask, 1))
  waterGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  const water = createWater(waterGeometry, shoreDistance, compact)
  const bankMaterial = new THREE.MeshStandardMaterial({ roughness: 0.89, vertexColors: true })
  const bank = new THREE.Mesh(geometry(banks).setAttribute('color', new THREE.Float32BufferAttribute(colors,3)), bankMaterial)
  bank.receiveShadow = bank.castShadow = true
  const bridges = buildCockpitBridges(layout, point, scaleX)
  const groves = buildCockpitGroves(layout.trees, point, scaleX)
  for (const obj of [bank, bridges.group, groves.group]) {
    obj.traverse(part => { if (part.isMesh && !part.material.transparent) part.layers.enable(WATER_REFLECTION_LAYER) })
  }
  group.add(water.mesh, bank, bridges.group, groves.group)
  const [west, east] = layout.bridges.find(b => b.name === '东方红路').ends.map(point)
  return {
    group,
    bridgeFocus: west.lerp(east, 0.5),
    parkFocus: point([457,366]),
    advance: water.advance,
    updateTreeDetail: groves.updateDetail,
    disposeInactive: groves.disposeInactive,
    setTheme(theme, night, satellite) {
      water.setTheme(theme, night, satellite)
      bankMaterial.color.set(night ? theme.outerTop : '#c7c6af')
      bridges.setTheme(theme, night)
      groves.setTheme(theme, night)
    }
  }
}
