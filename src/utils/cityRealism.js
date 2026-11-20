import * as THREE from 'three'

// 实测太阳方向（匹配 public/environment/daylight.hdr）
const sunU = 0.59491
const sunV = 0.23346
const azimuth = (sunU - 0.5) * Math.PI * 2
const altitude = (0.5 - sunV) * Math.PI
export const daylightDirection = new THREE.Vector3(
  Math.cos(azimuth) * Math.cos(altitude),
  Math.sin(altitude),
  Math.sin(azimuth) * Math.cos(altitude)
)

/** 从 HDR 天空中扣除太阳直射盘面能量，避免与 DirectionalLight 叠加过曝 */
export function makeDaylightEnvironment(pmrem, hdr) {
  const { width, height } = hdr.image
  const pixels = hdr.image.data
  const half = hdr.type === THREE.HalfFloatType
  const decode = half ? THREE.DataUtils.fromHalfFloat : (v) => v
  const encode = half ? THREE.DataUtils.toHalfFloat : (v) => v
  const backup = []
  const x0 = Math.floor((sunU - 0.055) * width)
  const x1 = Math.ceil((sunU + 0.055) * width)
  const y0 = Math.floor((sunV - 0.065) * height)
  const y1 = Math.ceil((sunV + 0.065) * height)
  try {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4
        const r = decode(pixels[i])
        const g = decode(pixels[i + 1])
        const b = decode(pixels[i + 2])
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        if (lum <= 3) continue
        backup.push(i, pixels[i], pixels[i + 1], pixels[i + 2])
        const scale = 3 / lum
        pixels[i] = encode(r * scale)
        pixels[i + 1] = encode(g * scale)
        pixels[i + 2] = encode(b * scale)
      }
    }
    hdr.needsUpdate = true
    return pmrem.fromEquirectangular(hdr)
  } finally {
    for (let j = 0; j < backup.length; j += 4) {
      const i = backup[j]
      pixels[i] = backup[j + 1]
      pixels[i + 1] = backup[j + 2]
      pixels[i + 2] = backup[j + 3]
    }
    hdr.needsUpdate = true
  }
}

/** 实景云层天空穹顶（支持晴日与星空夜幕无缝切换） */
export function createPhotographicSky(hdr) {
  const uniforms = {
    panorama: { value: hdr },
    night: { value: 0 },
    time: { value: 0 }
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 skyDirection;
      void main() {
        skyDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D panorama;
      uniform float night;
      uniform float time;
      varying vec3 skyDirection;
      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      void main() {
        vec3 d = normalize(skyDirection);
        vec2 uv = vec2(atan(d.z, d.x) * 0.159154943 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.318309886 + 0.5);
        vec3 photo = texture2D(panorama, uv).rgb;
        float horizon = pow(1.0 - abs(d.y), 7.0);
        vec3 day = photo * 0.90;
        float l = dot(min(photo, vec3(3.0)), vec3(0.2126, 0.7152, 0.0722));
        vec3 dusk = vec3(0.018, 0.036, 0.068) * (0.72 + clamp(l, 0.0, 2.0) * 0.30) + vec3(0.030, 0.025, 0.018) * horizon;
        vec3 c = mix(day, dusk, night);
        c = mix(c, mix(vec3(0.56, 0.62, 0.66), vec3(0.048, 0.068, 0.095), night), horizon * 0.44);
        if (night > 0.5 && d.y > 0.0) {
          vec2 cell = vec2(atan(d.z, d.x) * 95.0, d.y * 150.0);
          vec2 id = floor(cell);
          float star = hash21(id);
          vec2 spot = fract(cell) - 0.5 - vec2(hash21(id + 7.0) - 0.5, hash21(id + 13.0) - 0.5) * 0.6;
          float twinkle = 0.68 + 0.32 * sin(time * (1.2 + star * 2.4) + star * 90.0);
          c += vec3(0.86, 0.91, 1.0) * step(0.955, star) * (1.0 - smoothstep(0.0, 0.16, length(spot))) * twinkle * smoothstep(0.02, 0.25, d.y) * 0.85;
        }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(2800, 48, 24), material)
  mesh.name = 'Photographic cloud sky'
  mesh.frustumCulled = false
  mesh.renderOrder = -100
  return {
    mesh,
    update(isNight, timeSec) {
      uniforms.night.value = isNight ? 1 : 0
      uniforms.time.value = timeSec
    }
  }
}

/** 湖面微水波法线贴图 */
export function createRippleTexture() {
  const n = 256
  const data = new Uint8Array(n * n * 4)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (x / n) * Math.PI * 2
      const v = (y / n) * Math.PI * 2
      const dx = Math.cos(u * 3 + v * 2) * 0.28 + Math.cos(u * 7 - v * 5) * 0.16 + Math.cos(u * 13 + v * 11) * 0.08
      const dy = Math.sin(u * 2 - v * 4) * 0.28 + Math.sin(u * 6 + v * 9) * 0.16 + Math.sin(u * 11 - v * 13) * 0.08
      const i = (y * n + x) * 4
      data[i] = Math.round((dx * 0.5 + 0.5) * 255)
      data[i + 1] = Math.round((dy * 0.5 + 0.5) * 255)
      data[i + 2] = 255
      data[i + 3] = 255
    }
  }
  const tex = new THREE.DataTexture(data, n, n)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(36, 36)
  tex.needsUpdate = true
  return tex
}

const NOISE_GLSL = `
float fHash(vec2 p){p=fract(p*vec2(127.31,311.7));p+=dot(p,p+34.23);return fract(p.x*p.y);}
float fNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(fHash(i),fHash(i+vec2(1,0)),f.x),mix(fHash(i+vec2(0,1)),fHash(i+vec2(1,1)),f.x),f.y);}
vec3 windowLight(float h){return h<.62?vec3(1.,.66,.34):h<.88?vec3(1.,.86,.64):vec3(.68,.84,1.);}
`

const WORLD_VERTEX = `#include <begin_vertex>
 #ifdef USE_INSTANCING
  fWorld=(modelMatrix*instanceMatrix*vec4(position,1.)).xyz;fNormal=normalize(mat3(modelMatrix)*mat3(instanceMatrix)*objectNormal);
 #else
  fWorld=(modelMatrix*vec4(position,1.)).xyz;fNormal=normalize(mat3(modelMatrix)*objectNormal);
 #endif`

function tagPanes(geometry) {
  if (geometry.getAttribute('pane')) return
  const position = geometry.getAttribute('position')
  const index = geometry.index
  const n = position.count
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const total = index ? index.count : n
  for (let i = 0; i < total; i += 3) {
    const a = find(index ? index.getX(i) : i)
    const b = find(index ? index.getX(i + 1) : i + 1)
    const c = find(index ? index.getX(i + 2) : i + 2)
    parent[b] = a
    parent[c] = a
  }
  const sums = new Map()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    let sum = sums.get(root)
    if (!sum) {
      sum = [0, 0, 0, 0]
      sums.set(root, sum)
    }
    sum[0] += position.getX(i)
    sum[1] += position.getY(i)
    sum[2] += position.getZ(i)
    sum[3]++
  }
  const pane = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const [x, y, z, count] = sums.get(find(i))
    const value = Math.sin(Math.round((x / count) * 2) * 12.9898 + Math.round((y / count) * 2) * 78.233 + Math.round((z / count) * 2) * 37.719) * 43758.5453
    pane[i] = value - Math.floor(value)
  }
  geometry.setAttribute('pane', new THREE.BufferAttribute(pane, 1))
}

/** 写实立面与夜景万家灯火着色器增强（移植自大屏3d城市孪生） */
export function applyFacadeRealism(model, materials) {
  const night = { value: 0 }
  const time = { value: 0 }
  const shared = (shader) => {
    shader.uniforms.facadeNight = night
    shader.uniforms.facadeTime = time
  }
  const head = 'uniform float facadeNight;uniform float facadeTime;varying vec3 fWorld;varying vec3 fNormal;\n' + NOISE_GLSL

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return
    const used = Array.isArray(object.material) ? object.material : [object.material]
    if (used.some((m) => /^(Facade glass|Glow windows)/.test(m.name))) {
      tagPanes(object.geometry)
    }
  })

  for (const m of materials) {
    if (/^(Facade glass|Glow windows)/.test(m.name)) {
      const glow = m.name === 'Glow windows'
      if (glow) {
        m.color.setRGB(0.30, 0.38, 0.43)
        m.roughness = 0.06
        m.metalness = 0.9
        m.emissive.set(0)
      }
      m.onBeforeCompile = (shader) => {
        shared(shader)
        shader.vertexShader = 'attribute float pane;varying float vPane;varying vec3 fWorld;varying vec3 fNormal;\n' +
          shader.vertexShader.replace('#include <begin_vertex>', WORLD_VERTEX + '\n vPane=pane;')
        shader.fragmentShader = 'varying float vPane;\n' + head + shader.fragmentShader
          .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb*=mix(.80,1.22,fract(vPane*7.13));')
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            {float on=step(vPane,${glow ? '.86' : '.30'}),level=.35+1.15*fract(vPane*23.7);
             totalEmissiveRadiance=facadeNight*on*windowLight(fract(vPane*11.9))*level*1.35;}`)
      }
      m.customProgramCacheKey = () => 'changhe-facade-panes-' + glow
      m.needsUpdate = true
    } else if (/^Context (brick|concrete|curtain|ribbon|tile|white)$/.test(m.name)) {
      const columns = m.name === 'Context curtain' ? '8.' : '4.'
      m.onBeforeCompile = (shader) => {
        shared(shader)
        shader.vertexShader = 'varying vec3 fWorld;varying vec3 fNormal;\n' +
          shader.vertexShader.replace('#include <begin_vertex>', WORLD_VERTEX)
        shader.fragmentShader = head + 'float paneMask=0.;float h1=0.;float h2=0.;float h3=0.;float paneY=0.;\n' + shader.fragmentShader
          .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
            #ifdef USE_MAP
             {paneMask=smoothstep(.25,.5,metalnessFactor);
              vec2 grid=vMapUv*vec2(${columns},4.),cell=floor(grid),salt=floor(fWorld.xz/53.);paneY=fract(grid.y);
              h1=fHash(cell+salt*7.31);h2=fHash(cell*1.7+salt+19.);h3=fHash(cell+salt*3.+47.);
              float glance=pow(1.-abs(dot(normalize(vNormal),normalize(vViewPosition))),2.2);
              vec3 pane=mix(diffuseColor.rgb*1.5,vec3(.50,.58,.64),.30+.70*glance)*mix(.68,1.32,h1);
              diffuseColor.rgb=mix(diffuseColor.rgb,pane,paneMask);
              metalnessFactor=mix(metalnessFactor,.55+.43*glance,paneMask);
              roughnessFactor=mix(roughnessFactor,.06+.10*h3,paneMask);}
            #endif`)
          .replace('#include <emissivemap_fragment>', `
            {float level=(.32+1.05*h2)*(.75+.45*paneY);
             totalEmissiveRadiance=facadeNight*paneMask*step(h3,.42)*windowLight(h1)*level*1.45;}`)
      }
      m.customProgramCacheKey = () => 'changhe-facade-context-' + columns
      m.needsUpdate = true
    }
  }

  return {
    update(isNight, elapsedSec) {
      night.value = isNight ? 1 : 0
      time.value = elapsedSec
    }
  }
}
