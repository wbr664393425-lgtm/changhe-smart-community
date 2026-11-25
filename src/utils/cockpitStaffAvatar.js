import { BufferGeometry, Color, Float32BufferAttribute, MeshLambertMaterial, Uint8BufferAttribute } from 'three'

const paint = {
  vest: 0x078a80,
  hem: 0x085d59,
  reflector: 0xe4f3c7,
  shirt: 0x597a89,
  collar: 0x324b5c,
  pants: 0x304656,
  boots: 0x23343e,
  sole: 0x182a35,
  skin: 0xe1ad88,
  lips: 0xa86c58,
  eyes: 0x384346,
  hair: 0x413833,
  hairLight: 0x59463c,
  hairTie: 0x73948b,
  cap: 0x17645f,
  capBand: 0x174d50,
  badge: 0xe5ebdc
}

// 夜间补光沿用各面原有的线性色。反光织物和裸露皮肤比裤子、头发更亮。
const nightResponse = new Map([
  [paint.reflector, 255], [paint.badge, 230], [paint.vest, 222], [paint.skin, 191],
  [paint.cap, 162], [paint.hem, 147], [paint.shirt, 140], [paint.capBand, 128], [paint.lips, 114],
  [paint.hairLight, 138], [paint.hairTie, 172]
])

// 顺着正面、右侧、背面、左侧绕一圈。较宽的正背平面能读出反光条。
const jacketOutline = [
  [-0.70, 1], [0.70, 1], [1, 0.48], [1, -0.48],
  [0.70, -1], [-0.70, -1], [-1, -0.48], [-1, 0.48]
]
const limbOutline = [
  [-0.58, 1], [0.58, 1], [1, 0], [0.58, -1], [-0.58, -1], [-1, 0]
]

function section(y, width, depth, x = 0, z = 0) {
  return { y, width, depth, x, z }
}

/** 脚底 y=0，帽顶 y=1，正面 +Z。aStaffSurface 的两个字节分别表示肢体类型和夜间补光强度。 */
export function createStaffAvatarGeometry(gender = 'male') {
  const female = gender === 'female'
  const jacketWidth = female ? 0.92 : 1
  const positions = []
  const colors = []
  const indices = []
  const surfaces = []
  const tint = new Color()
  let limb = 0 // 0 躯干，1 腿和鞋，2 手臂
  let widthScale = 1

  function addFace(vertices, color) {
    const first = positions.length / 3
    tint.setHex(color)
    const r = Math.round(tint.r * 255)
    const g = Math.round(tint.g * 255)
    const b = Math.round(tint.b * 255)
    const lift = nightResponse.get(color) ?? 72
    for (const vertex of vertices) {
      positions.push(vertex[0] * widthScale, vertex[1], vertex[2])
      colors.push(r, g, b)
      surfaces.push(limb, lift)
    }
    return first
  }

  function triangle(a, b, c, color) {
    const i = addFace([a, b, c], color)
    indices.push(i, i + 1, i + 2)
  }

  function quad(a, b, c, d, color) {
    const i = addFace([a, b, c, d], color)
    indices.push(i, i + 1, i + 3, i + 1, i + 2, i + 3)
  }

  function loft(sections, bands, outline = jacketOutline, top, bottom) {
    const rings = sections.map(s => outline.map(([x, z]) => [
      s.x + s.width * x, s.y, s.z + s.depth * z
    ]))
    for (let level = 0; level < rings.length - 1; level++) {
      const lower = rings[level]
      const upper = rings[level + 1]
      const band = bands[level]
      for (let i = 0; i < outline.length; i++) {
        const next = (i + 1) % outline.length
        quad(lower[i], lower[next], upper[next], upper[i], Array.isArray(band) ? band[i] : band)
      }
    }
    const first = rings[0]
    const last = rings[rings.length - 1]
    for (let i = 1; i < outline.length - 1; i++) {
      if (top !== undefined) triangle(last[0], last[i], last[i + 1], top)
      if (bottom !== undefined) triangle(first[0], first[i + 1], first[i], bottom)
    }
  }

  // 静止时双脚前后错开。移动时按行进距离驱动四肢，肩、髋与路面锚点固定。
  for (const side of [-1, 1]) {
    const hipX = side * 0.078
    const ankleX = side * 0.089
    const stride = side * 0.055
    limb = 1
    widthScale = 1
    loft([
      section(0.000, 0.054, 0.085, ankleX, stride + 0.024),
      section(0.022, 0.058, 0.087, ankleX, stride + 0.024),
      section(0.070, 0.049, 0.058, ankleX, stride + 0.007)
    ], [paint.sole, paint.boots], limbOutline, paint.boots, paint.sole)
    loft([
      section(0.055, 0.047, 0.051, ankleX, stride),
      section(0.226, 0.055, 0.057, hipX, stride * 0.68 + 0.007),
      section(0.428, 0.069, 0.068, hipX, -0.010)
    ], [paint.pants, paint.pants], limbOutline)

    const hand = section(0.440, 0.034, 0.038, side * 0.202, -stride * 1.32)
    const wrist = section(0.478, 0.032, 0.035, side * 0.205, -stride * 1.10)
    const cuff = section(0.514, 0.041, 0.041, side * 0.203, -stride * 0.82)
    limb = 2
    widthScale = jacketWidth
    loft([
      section(0.419, 0.023, 0.027, hand.x, hand.z + 0.006),
      hand, wrist, cuff
    ], [paint.skin, paint.skin, paint.skin], limbOutline, undefined, paint.skin)
    loft([
      cuff,
      section(0.573, 0.046, 0.044, side * 0.195, -stride * 0.56 - 0.014),
      section(0.654, 0.054, 0.063, side * 0.164, 0.003),
      section(0.678, 0.036, 0.044, side * 0.145, 0.005)
    ], [paint.shirt, paint.shirt, paint.shirt], limbOutline, paint.shirt)
  }
  limb = 0
  widthScale = jacketWidth

  const belt = section(0.506, 0.145, 0.086)
  const beltTop = section(0.538, 0.149, 0.088, 0, 0.002)
  const chest = section(0.646, 0.168, 0.091, 0, 0.005)
  const shoulder = section(0.680, 0.149, 0.084, 0, 0.006)
  const neckline = section(0.708, 0.064, 0.047, 0, 0.008)
  loft([
    section(0.398, 0.129, 0.075, 0, -0.008),
    section(0.420, 0.138, 0.081, 0, -0.005),
    belt, beltTop, chest, shoulder, neckline
  ], [paint.hem, paint.vest, paint.reflector, paint.vest, paint.vest, paint.vest],
  jacketOutline, paint.hem, paint.pants)

  // 反光肩带贴合胸背的斜面；低空机位从身后也能识别巡查马甲。
  function facePoint(s, x, side) {
    return [x, s.y, s.z + side * (s.depth + 0.0015)]
  }
  for (const face of [-1, 1]) {
    for (const side of [-1, 1]) {
      const strap = [[beltTop, 0.074], [chest, 0.093], [shoulder, 0.084]]
      for (let i = 0; i < strap.length - 1; i++) {
        const [lo, a] = strap[i]
        const [hi, b] = strap[i + 1]
        const half = face * 0.014
        quad(facePoint(lo, side * a - half, face), facePoint(lo, side * a + half, face),
          facePoint(hi, side * b + half, face), facePoint(hi, side * b - half, face), paint.reflector)
      }
    }
  }
  quad(facePoint(chest, -0.021, 1), facePoint(chest, 0.021, 1),
    facePoint(shoulder, 0.052, 1), facePoint(shoulder, -0.052, 1), paint.collar)
  quad([0.017, 0.586, 0.095], [0.056, 0.586, 0.095],
    [0.056, 0.613, 0.097], [0.017, 0.613, 0.097], paint.badge)

  widthScale = 1
  loft([section(0.694, 0.047, 0.044), section(0.774, 0.048, 0.047, 0, 0.012)],
    [paint.skin], limbOutline)
  const hairline = [paint.skin, paint.skin, paint.hair, paint.hair,
    paint.hair, paint.hair, paint.hair, paint.skin]
  loft([
    section(0.737, female ? 0.052 : 0.061, 0.053, 0, 0.017),
    section(0.786, female ? 0.086 : 0.095, 0.077, 0, 0.019),
    section(0.841, female ? 0.103 : 0.108, 0.087, 0, 0.018),
    section(0.911, 0.108, 0.089, 0, 0.012)
  ], [paint.skin, female ? hairline : paint.skin, hairline], jacketOutline, undefined, paint.skin)

  for (const side of [-1, 1]) {
    const x = side * 0.043
    quad([x - 0.010, 0.855, 0.106], [x + 0.008, 0.855, 0.106],
      [x + 0.010, 0.864, 0.106], [x - 0.009, 0.864, 0.106], paint.eyes)
    const earX = side * 0.102
    const rim = [[earX, 0.800, 0.003], [earX, 0.844, -0.001],
      [earX, 0.847, 0.036], [earX, 0.806, 0.038]]
    const earTip = [side * 0.119, 0.825, 0.021]
    if (side < 0) rim.reverse()
    for (let i = 0; i < rim.length; i++) triangle(rim[i], rim[(i + 1) % rim.length], earTip, paint.skin)
  }
  const nose = [0, 0.817, 0.128]
  const root = [0, 0.854, 0.105]
  const left = [-0.014, 0.819, 0.103]
  const right = [0.014, 0.819, 0.103]
  triangle(root, left, nose, paint.skin)
  triangle(root, nose, right, paint.skin)
  triangle(left, right, nose, paint.skin)
  quad([-0.017, 0.794, 0.099], [0.017, 0.794, 0.099],
    [0.014, 0.800, 0.100], [-0.014, 0.800, 0.100], paint.lips)

  if (female) {
    // 从后颈收拢、向一侧垂落的低马尾。低空跟拍与头像的轮廓均取自这一份几何。
    loft([
      section(0.617, 0.014, 0.014, 0.145, -0.126),
      section(0.656, 0.039, 0.034, 0.157, -0.144),
      section(0.710, 0.052, 0.047, 0.130, -0.155),
      section(0.756, 0.043, 0.045, 0.082, -0.149),
      section(0.783, 0.026, 0.027, 0.049, -0.128),
      section(0.800, 0.031, 0.032, 0.036, -0.114),
      section(0.837, 0.049, 0.051, 0.012, -0.082)
    ], [paint.hairLight, paint.hair, paint.hairLight, paint.hair, paint.hairTie, paint.hair],
    limbOutline, paint.hair, paint.hairLight)

    for (const side of [-1, 1]) {
      loft([
        section(side < 0 ? 0.719 : 0.730, 0.008, 0.012, side * 0.107, 0.037),
        section(0.761, 0.025, 0.024, side * 0.105, 0.035),
        section(0.816, 0.031, 0.041, side * 0.100, 0.025),
        section(0.897, 0.024, 0.055, side * 0.096, 0.015)
      ], [paint.hairLight, paint.hair, paint.hair], limbOutline, undefined, paint.hairLight)
    }
    triangle([-0.093, 0.856, 0.069], [-0.062, 0.880, 0.107],
      [0.037, 0.899, 0.107], paint.hairLight)
    triangle([-0.093, 0.856, 0.069], [0.037, 0.899, 0.107],
      [-0.091, 0.899, 0.081], paint.hair)
  }

  // 鸭舌向 +Z 明显伸出，帽冠收顶；俯视和侧视都能判断面向。
  loft([
    section(0.898, 0.107, 0.067, 0, 0.114),
    section(0.914, 0.107, 0.067, 0, 0.114)
  ], [paint.capBand], limbOutline, paint.cap, paint.capBand)
  loft([
    section(0.896, 0.114, 0.099, 0, 0.008),
    section(0.922, 0.122, 0.106, 0, 0.008),
    section(0.966, 0.113, 0.101, 0, 0.002),
    section(0.989, 0.082, 0.074, 0, -0.003),
    section(1.000, 0.044, 0.041, 0, -0.008)
  ], [paint.capBand, paint.cap, paint.cap, paint.cap], jacketOutline, paint.cap)
  quad([-0.023, 0.939, 0.112], [0.023, 0.939, 0.112],
    [0.023, 0.952, 0.110], [-0.023, 0.952, 0.110], paint.reflector)

  const geometry = new BufferGeometry()
  geometry.setIndex(indices)
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Uint8BufferAttribute(colors, 3, true))
  geometry.setAttribute('aStaffSurface', new Uint8BufferAttribute(surfaces, 2))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  // 包含迈步后脚尖和鞋跟的最大纵向范围。
  geometry.boundingBox.min.z = Math.min(geometry.boundingBox.min.z, -0.17)
  geometry.boundingBox.max.z = Math.max(geometry.boundingBox.max.z, 0.20)
  geometry.computeBoundingSphere()
  geometry.boundingSphere.radius += 0.025
  return geometry
}

const strideVertex = /* glsl */ `
  attribute vec2 aStaffSurface;
  #ifdef USE_INSTANCING
    attribute float aStridePhase;
    attribute vec2 aStaffFade;
  #endif
  varying float vStaffLightResponse;
  varying vec2 vStaffFade;

  // xy = 竖向抬升和前后摆幅，zw = 两项对原始顶点高度的导数，用于同步修正光照法线。
  vec4 staffStrideOffset(vec3 p) {
    #ifdef USE_INSTANCING
      if (aStridePhase >= 0.0 && aStaffSurface.x > 0.5) {
        bool leg = aStaffSurface.x < 1.5;
        float side = sign(p.x);
        float phase = side * sin(aStridePhase);
        float swingFoot = max(0.0, side * cos(aStridePhase));
        float span = leg ? 0.365 : 0.225;
        float reach = clamp(((leg ? 0.425 : 0.654) - p.y) / span, 0.0, 1.0);
        float slope = reach > 0.0 && reach < 1.0 ? -1.0 / span : 0.0;
        float sweep = leg ? phase * 0.078 - side * 0.055 : side * 0.067 - phase * 0.066;
        float knee = leg ? 0.017 * swingFoot : 0.0;
        float lift = leg ? 0.030 * swingFoot * swingFoot : 0.008 * max(0.0, -phase);
        return vec4(reach * reach * lift, reach * sweep + 4.0 * reach * (1.0 - reach) * knee,
          slope * 2.0 * reach * lift, slope * (sweep + 4.0 * (1.0 - 2.0 * reach) * knee));
      }
    #endif
    return vec4(0.0);
  }
`

/** aStridePhase 由实例提供，单位弧度；负值保持站姿。uLift 可在昼夜切换时直接更新。 */
export function createStaffAvatarMaterial() {
  const material = new MeshLambertMaterial({ color: 0xffffff, vertexColors: true })
  const uLift = { value: 0.12 }
  material.userData.uLift = uLift
  material.onBeforeCompile = shader => {
    shader.uniforms.uStaffLift = uLift
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${strideVertex}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vec4 stride = staffStrideOffset(position);
        objectNormal.y = (objectNormal.y - stride.w * objectNormal.z) / (1.0 + stride.z);
        #ifdef USE_INSTANCING
          vStaffFade = aStaffFade;
        #else
          vStaffFade = vec2(0.0);
        #endif
        vStaffLightResponse = aStaffSurface.y / 255.0;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.yz += stride.xy;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uStaffLift;
        varying float vStaffLightResponse;
        varying vec2 vStaffFade;
        float staffBayer2(vec2 p) {
          vec2 bit = mod(floor(p), 2.0);
          return 2.0 * bit.x + 3.0 * bit.y - 4.0 * bit.x * bit.y;
        }`)
      // 有序覆盖率保留人物自身和建筑的深度遮挡；到近景后完整像素正常照明。
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
        if (vStaffFade.x > 0.001) {
          float cutoff = (4.0 * staffBayer2(gl_FragCoord.xy) + staffBayer2(gl_FragCoord.xy * 0.5) + 0.5) / 16.0;
          if (1.0 - vStaffFade.x < cutoff) discard;
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * (uStaffLift * vStaffLightResponse);`)
      .replace('#include <opaque_fragment>', `
        outgoingLight = mix(outgoingLight, vec3(dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722))) * 0.70, vStaffFade.y * 0.80);
        #include <opaque_fragment>`)
  }
  material.customProgramCacheKey = () => 'cockpit-staff-stride-lambert'
  return material
}
