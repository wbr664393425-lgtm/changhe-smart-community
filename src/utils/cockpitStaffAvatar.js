import { BufferGeometry, CanvasTexture, Color, Float32BufferAttribute, MeshStandardMaterial, SRGBColorSpace, Uint8BufferAttribute } from 'three'

const paint = {
  vest: 0x1e4d78,
  yoke: 0x2b6292,
  binding: 0x143352,
  seam: 0x5c8ab5,
  reflector: 0xe8f4f8,
  shirt: 0xf2f4f7,
  shirtShade: 0xd9e0e8,
  pants: 0x253545,
  boots: 0x1e252e,
  sole: 0x3b4652,
  card: 0xf8fafc,
  cardInk: 0x1e5ca8,
  clip: 0xc2cdd8,
  skin: 0xf2d5bf,
  skinShade: 0xe4c1a8,
  hairDark: 0x272326,
  hairMid: 0x322d31,
  hairLight: 0x3f383d,
  hairTie: 0x1a3958,
  deviceBody: 0x1c2530,
  deviceScreen: 0x8bc9e8,
  deviceLed: 0x46e8c8
}

// 材质分区表：[nightLift(0-255), roughness(0-255), metalness(0-255)]
const surfaceProps = new Map([
  [paint.reflector, [255, 56, 96]],
  [paint.deviceScreen, [235, 42, 26]],
  [paint.deviceLed, [255, 46, 20]],
  [paint.card, [215, 92, 16]],
  [paint.clip, [180, 62, 175]],
  [paint.cardInk, [168, 128, 18]],
  [paint.skin, [186, 148, 4]],
  [paint.skinShade, [168, 152, 4]],
  [paint.shirt, [158, 188, 3]],
  [paint.shirtShade, [146, 194, 3]],
  [paint.yoke, [152, 200, 6]],
  [paint.vest, [145, 204, 6]],
  [paint.seam, [168, 140, 28]],
  [paint.binding, [118, 210, 6]],
  [paint.pants, [94, 214, 5]],
  [paint.boots, [78, 152, 14]],
  [paint.sole, [92, 188, 8]],
  [paint.deviceBody, [85, 118, 36]],
  [paint.hairTie, [110, 178, 10]],
  [paint.hairDark, [66, 168, 10]],
  [paint.hairMid, [74, 165, 10]],
  [paint.hairLight, [84, 160, 12]]
])

const TAU = Math.PI * 2
const rounded = (value, exponent) => Math.sign(value) * Math.abs(value) ** exponent
const lerp = (a, b, t) => a + (b - a) * t
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

function section(y, width, depth, x = 0, z = 0) {
  return { y, width, depth, x, z }
}

function atHeight(profile, y) {
  if (y <= profile[0].y) return profile[0]
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1], b = profile[i]
    if (y > b.y) continue
    const t = (y - a.y) / Math.max(1e-6, b.y - a.y)
    return section(
      y,
      lerp(a.width, b.width, t),
      lerp(a.depth, b.depth, t),
      lerp(a.x, b.x, t),
      lerp(a.z, b.z, t)
    )
  }
  return profile[profile.length - 1]
}

function ringPoint(s, angle, exponent = 1) {
  return [
    s.x + s.width * rounded(Math.sin(angle), exponent),
    s.y,
    s.z + s.depth * rounded(Math.cos(angle), exponent)
  ]
}

/** 正面 +Z，脚底 y=0、发顶 y=1。aStaffSurface = [region(0躯干/1腿/2臂/3男头/4女头), nightLift, roughness, metalness]。 */
export function createStaffAvatarGeometry(gender = 'male') {
  const female = gender === 'female'
  const positions = [], colors = [], surfaces = [], indices = []
  const palette = new Map()
  let limb = 0

  function vertex(point, color, customProps = null) {
    let rgb = palette.get(color)
    if (!rgb) {
      const tint = new Color(color)
      rgb = [tint.r, tint.g, tint.b].map(v => Math.round(v * 255))
      palette.set(color, rgb)
    }
    const index = positions.length / 3
    positions.push(point[0], point[1], point[2])
    colors.push(rgb[0], rgb[1], rgb[2])
    const props = customProps || surfaceProps.get(color) || [96, 196, 8]
    surfaces.push(limb, props[0], props[1], props[2])
    return index
  }

  function shell(rings, color, closed = true) {
    const count = rings[0].length
    const shade = typeof color === 'function' ? color : () => color
    const rows = rings.map((ring, j) => ring.map((point, i) => vertex(point, shade(j, i))))
    for (let j = 1; j < rows.length; j++) {
      for (let i = 0; i < count; i++) {
        const n = (i + 1) % count
        const lo = rows[j - 1], hi = rows[j]
        indices.push(lo[i], lo[n], hi[i], lo[n], hi[n], hi[i])
      }
    }
    if (!closed) return
    for (const end of [0, rows.length - 1]) {
      const pts = rings[end]
      const rim = pts.map((point, i) => vertex(point, shade(end, i)))
      const center = [0, 0, 0]
      pts.forEach(p => { center[0] += p[0] / count; center[1] += p[1] / count; center[2] += p[2] / count })
      const c = vertex(center, shade(end, 0))
      for (let i = 0; i < count; i++) {
        const n = (i + 1) % count
        if (end === 0) indices.push(c, rim[n], rim[i])
        else indices.push(c, rim[i], rim[n])
      }
    }
  }

  function loft(profile, color, count = 14, exponent = 1, closed = true) {
    shell(profile.map(s => Array.from({ length: count }, (_, i) => ringPoint(s, i * TAU / count, exponent))), color, closed)
  }

  function addBox(cx, cy, cz, hx, hy, hz, color, rotX = 0, rotY = 0, rotZ = 0) {
    const corners = [
      [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
      [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]
    ]
    const cx0 = Math.cos(rotX), sx0 = Math.sin(rotX)
    const cy0 = Math.cos(rotY), sy0 = Math.sin(rotY)
    const cz0 = Math.cos(rotZ), sz0 = Math.sin(rotZ)
    const world = corners.map(([x, y, z]) => {
      const x1 = x * cz0 - y * sz0, y1 = x * sz0 + y * cz0, z1 = z
      const y2 = y1 * cx0 - z1 * sx0, z2 = y1 * sx0 + z1 * cx0, x2 = x1
      const x3 = x2 * cy0 + z2 * sy0, z3 = -x2 * sy0 + z2 * cy0, y3 = y2
      return [cx + x3, cy + y3, cz + z3]
    })
    const faces = [
      [0, 3, 2, 1], [4, 5, 6, 7],
      [0, 1, 5, 4], [2, 3, 7, 6],
      [0, 4, 7, 3], [1, 2, 6, 5]
    ]
    for (const face of faces) {
      const idx = face.map(k => vertex(world[k], color))
      indices.push(idx[0], idx[1], idx[2], idx[0], idx[2], idx[3])
    }
  }

  function addCoatBand(profile, exponent, thetaStart, thetaEnd, yBot, yTop, radialOffset, thickness, color, segs = 16) {
    const outerBot = [], outerTop = [], innerBot = [], innerTop = []
    for (let i = 0; i <= segs; i++) {
      const theta = lerp(thetaStart, thetaEnd, i / segs)
      const sBot = atHeight(profile, yBot)
      const sTop = atHeight(profile, yTop)
      const pBot = ringPoint(sBot, theta, exponent)
      const pTop = ringPoint(sTop, theta, exponent)
      const nx = Math.sin(theta), nz = Math.cos(theta)
      outerBot.push([pBot[0] + nx * (radialOffset + thickness), pBot[1], pBot[2] + nz * (radialOffset + thickness)])
      outerTop.push([pTop[0] + nx * (radialOffset + thickness), pTop[1], pTop[2] + nz * (radialOffset + thickness)])
      innerBot.push([pBot[0] + nx * radialOffset, pBot[1], pBot[2] + nz * radialOffset])
      innerTop.push([pTop[0] + nx * radialOffset, pTop[1], pTop[2] + nz * radialOffset])
    }
    const pushQuad = (a, b, c, d) => {
      const ia = vertex(a, color), ib = vertex(b, color), ic = vertex(c, color), id = vertex(d, color)
      indices.push(ia, ib, ic, ia, ic, id)
    }
    for (let i = 0; i < segs; i++) {
      pushQuad(outerBot[i], outerBot[i + 1], outerTop[i + 1], outerTop[i])
      pushQuad(outerTop[i], outerTop[i + 1], innerTop[i + 1], innerTop[i])
      pushQuad(innerBot[i], innerBot[i + 1], outerBot[i + 1], outerBot[i])
    }
    pushQuad(innerBot[0], outerBot[0], outerTop[0], innerTop[0])
    pushQuad(outerBot[segs], innerBot[segs], innerTop[segs], outerTop[segs])
  }

  const shoulders = female ? 0.91 : 1.0
  const hipHalf = female ? 0.056 : 0.058

  // ── 1. 双腿与巡查鞋（y = 0.000 ~ 0.488，约 5.75 头身修长比例） ──
  for (const sign of [-1, 1]) {
    const footX = sign * 0.062
    const hipX = sign * hipHalf
    const footZ = 0.012
    limb = 1
    loft([
      section(0.000, 0.039, 0.066, footX, footZ + 0.014),
      section(0.014, 0.041, 0.068, footX, footZ + 0.014)
    ], paint.sole, 14, 0.78)
    loft([
      section(0.012, 0.040, 0.066, footX, footZ + 0.014),
      section(0.028, 0.039, 0.062, footX, footZ + 0.012),
      section(0.046, 0.035, 0.046, footX, footZ + 0.002),
      section(0.064, 0.032, 0.035, footX, -0.002)
    ], paint.boots, 14, 0.82)
    loft([
      section(0.054, 0.034, 0.038, footX, -0.002),
      section(0.095, 0.036, 0.039, footX, -0.002),
      section(0.215, 0.043, 0.045, lerp(footX, hipX, 0.42), 0.002),
      section(0.280, 0.045, 0.048, lerp(footX, hipX, 0.64), 0.004),
      section(0.382, 0.052, 0.056, lerp(footX, hipX, 0.86), 0.001),
      section(0.486, 0.058, 0.064, hipX, -0.003)
    ], paint.pants, 14, 0.88)

    // ── 2. 手臂与手掌（limb = 2） ──
    limb = 2
    const wristX = sign * (female ? 0.132 : 0.145)
    const elbowX = sign * (female ? 0.146 : 0.160)
    const shX = sign * 0.126 * shoulders
    const armForward = sign < 0 ? 0.028 : 0.014
    const elbowZ = sign < 0 ? 0.004 : -0.006

    loft([
      section(0.410, 0.010, 0.014, wristX - sign * 0.003, armForward + 0.006),
      section(0.428, 0.015, 0.021, wristX, armForward + 0.004),
      section(0.456, 0.017, 0.022, wristX + sign * 0.002, armForward),
      section(0.478, 0.015, 0.017, wristX + sign * 0.003, armForward * 0.7),
      section(0.538, 0.022, 0.024, elbowX, elbowZ)
    ], paint.skin, 12, 0.92)

    if (sign < 0) {
      const pdaX = wristX + 0.008
      const pdaY = 0.440
      const pdaZ = armForward + 0.015
      addBox(pdaX, pdaY, pdaZ, 0.018, 0.033, 0.0038, paint.deviceBody, -0.18, 0.95, 0.06)
      addBox(pdaX + 0.0022, pdaY + 0.0008, pdaZ + 0.0014, 0.014, 0.027, 0.0014, paint.deviceScreen, -0.18, 0.95, 0.06)
    }

    loft([
      section(0.530, 0.024, 0.026, elbowX, elbowZ),
      section(0.554, 0.027, 0.029, elbowX, elbowZ - 0.003),
      section(0.580, 0.029, 0.031, elbowX + sign * 0.001, elbowZ - 0.006)
    ], paint.shirtShade, 14, 0.90)
    loft([
      section(0.568, 0.028, 0.030, elbowX, elbowZ - 0.005),
      section(0.618, 0.032, 0.034, lerp(elbowX, shX, 0.42), -0.007),
      section(0.684, 0.035, 0.039, lerp(elbowX, shX, 0.80), -0.005),
      section(0.726, 0.038, 0.044, shX, -0.002),
      section(0.749, 0.026, 0.036, shX - sign * 0.010, -0.002),
      section(0.759, 0.011, 0.022, shX - sign * 0.020, -0.002)
    ], paint.shirt, 14, 0.90)
  }

  // ── 3. 躯干：真内衬衬衫 + 真 3D 立体小翻领 + 真开襟政务蓝马甲 ──
  limb = 0

  const shirtInner = [
    section(0.632, 0.095 * shoulders, 0.060, 0, 0.002),
    section(0.686, 0.106 * shoulders, 0.064, 0, 0.002),
    section(0.733, 0.104 * shoulders, 0.056, 0, -0.001),
    section(0.764, 0.078 * shoulders, 0.045, 0, -0.001),
    section(0.779, 0.038, 0.034, 0, -0.001)
  ]
  loft(shirtInner, paint.shirt, 24, 0.84)

  for (const sign of [-1, 1]) {
    const collarSegs = 8
    const outerTop = [], outerBot = [], innerTop = [], innerBot = []
    for (let i = 0; i <= collarSegs; i++) {
      const t = i / collarSegs
      const theta = sign * lerp(0.28, Math.PI * 0.92, t)
      const yTop = lerp(0.770, 0.794, Math.sin(t * Math.PI * 0.65))
      const yTip = lerp(0.730, 0.772, Math.pow(t, 0.68))
      const rx = 0.036 + 0.004 * (1 - t)
      const rz = 0.034 + 0.005 * (1 - t)
      const nx = Math.sin(theta), nz = Math.cos(theta)
      innerTop.push([nx * rx, yTop, nz * rz])
      outerTop.push([nx * (rx + 0.0055), yTop + 0.001, nz * (rz + 0.0055)])
      const tipSpread = lerp(0.015, 0.007, t)
      outerBot.push([nx * (rx + tipSpread), yTip, nz * (rz + tipSpread)])
      innerBot.push([nx * (rx + tipSpread - 0.0045), yTip + 0.001, nz * (rz + tipSpread - 0.0045)])
    }
    const q = (a, b, c, d, col) => {
      const ia = vertex(a, col), ib = vertex(b, col), ic = vertex(c, col), id = vertex(d, col)
      indices.push(ia, ib, ic, ia, ic, id)
    }
    for (let i = 0; i < collarSegs; i++) {
      if (sign > 0) {
        q(outerBot[i], outerBot[i + 1], outerTop[i + 1], outerTop[i], paint.shirt)
        q(outerTop[i], outerTop[i + 1], innerTop[i + 1], innerTop[i], paint.shirt)
        q(innerBot[i], outerBot[i], outerBot[i + 1], innerBot[i + 1], paint.shirtShade)
      } else {
        q(outerBot[i + 1], outerBot[i], outerTop[i], outerTop[i + 1], paint.shirt)
        q(outerTop[i + 1], outerTop[i], innerTop[i], innerTop[i + 1], paint.shirt)
        q(outerBot[i], innerBot[i], innerBot[i + 1], outerBot[i + 1], paint.shirtShade)
      }
    }
    if (sign > 0) q(innerBot[0], outerBot[0], outerTop[0], innerTop[0], paint.shirtShade)
    else q(outerBot[0], innerBot[0], innerTop[0], outerTop[0], paint.shirtShade)
  }

  const coatProfile = [
    section(0.462, 0.095, 0.063, 0, -0.004),
    section(0.494, 0.107, 0.069, 0, -0.004),
    section(0.554, 0.103, 0.066, 0, -0.003),
    section(0.610, female ? 0.092 : 0.101, 0.064, 0, -0.001),
    section(0.666, 0.114, 0.071, 0, 0.002),
    section(0.708, 0.123, 0.071, 0, 0.001),
    section(0.742, 0.118, 0.061, 0, -0.002),
    section(0.762, 0.096, 0.052, 0, -0.002),
    section(0.775, 0.048, 0.040, 0, -0.001)
  ].map(s => ({ ...s, width: s.width * shoulders }))

  const coatExp = 0.80
  const coatSegs = 28
  const vBottomY = 0.658
  const coatOuterRings = []
  const coatInnerRings = []
  for (let j = 0; j < coatProfile.length; j++) {
    const s = coatProfile[j]
    const vProgress = clamp((s.y - vBottomY) / (0.775 - vBottomY), 0, 1)
    const openHalf = s.y <= vBottomY ? 0.015 : lerp(0.025, 0.44, Math.pow(vProgress, 0.82))
    const outerRing = []
    const innerRing = []
    for (let i = 0; i <= coatSegs; i++) {
      const theta = lerp(openHalf, TAU - openHalf, i / coatSegs)
      const pOut = ringPoint(s, theta, coatExp)
      const nx = Math.sin(theta), nz = Math.cos(theta)
      outerRing.push(pOut)
      innerRing.push([pOut[0] - nx * 0.0045, pOut[1], pOut[2] - nz * 0.0045])
    }
    coatOuterRings.push(outerRing)
    coatInnerRings.push(innerRing)
  }

  const coatColorAt = (y) => (y >= 0.706 ? paint.yoke : paint.vest)
  const coatRows = coatOuterRings.map((ring, j) => ring.map(p => vertex(p, coatColorAt(coatProfile[j].y))))
  for (let j = 1; j < coatRows.length; j++) {
    for (let i = 0; i < coatSegs; i++) {
      const lo = coatRows[j - 1], hi = coatRows[j]
      indices.push(lo[i], lo[i + 1], hi[i], lo[i + 1], hi[i + 1], hi[i])
    }
  }
  for (const [ring, inRing, flip] of [
    [coatOuterRings[0], coatInnerRings[0], true],
    [coatOuterRings[coatOuterRings.length - 1], coatInnerRings[coatInnerRings.length - 1], false]
  ]) {
    const col = flip ? paint.binding : coatColorAt(ring[0][1])
    for (let i = 0; i < coatSegs; i++) {
      const a = vertex(ring[i], col), b = vertex(ring[i + 1], col)
      const c = vertex(inRing[i + 1], col), d = vertex(inRing[i], col)
      if (flip) indices.push(a, d, c, a, c, b)
      else indices.push(a, b, c, a, c, d)
    }
  }
  for (let j = 1; j < coatOuterRings.length; j++) {
    for (const sideIdx of [0, coatSegs]) {
      const p0Out = coatOuterRings[j - 1][sideIdx], p1Out = coatOuterRings[j][sideIdx]
      const p0In = coatInnerRings[j - 1][sideIdx], p1In = coatInnerRings[j][sideIdx]
      const a = vertex(p0Out, paint.binding), b = vertex(p1Out, paint.binding)
      const c = vertex(p1In, paint.binding), d = vertex(p0In, paint.binding)
      if (sideIdx === 0) indices.push(a, b, c, a, c, d)
      else indices.push(a, d, c, a, c, b)
    }
  }
  addCoatBand(coatProfile, coatExp, -0.016, 0.016, 0.474, 0.658, 0.0005, 0.0018, paint.binding, 2)
  addCoatBand(coatProfile, coatExp, -0.005, 0.005, 0.476, 0.656, 0.0012, 0.0016, paint.seam, 2)

  // 双道安全反光条
  addCoatBand(coatProfile, coatExp, 0.28, 0.86, 0.665, 0.679, 0.0008, 0.0022, paint.reflector, 10)
  addCoatBand(coatProfile, coatExp, -0.86, -0.28, 0.665, 0.679, 0.0008, 0.0022, paint.reflector, 10)
  addCoatBand(coatProfile, coatExp, 2.24, TAU - 2.24, 0.684, 0.698, 0.0008, 0.0022, paint.reflector, 16)
  addCoatBand(coatProfile, coatExp, 0.06, TAU - 0.06, 0.540, 0.555, 0.0008, 0.0022, paint.reflector, 26)
  addCoatBand(coatProfile, coatExp, 0.36, 0.78, 0.498, 0.506, 0.0006, 0.0016, paint.binding, 6)
  addCoatBand(coatProfile, coatExp, -0.78, -0.36, 0.498, 0.506, 0.0006, 0.0016, paint.binding, 6)

  const cardSurface = atHeight(coatProfile, 0.626)
  const cardZ = ringPoint(cardSurface, 0.44, coatExp)[2] + 0.004
  const cardX = 0.048 * shoulders
  addBox(cardX, 0.626, cardZ, 0.017, 0.015, 0.0020, paint.card, 0, 0.32, 0)
  addBox(cardX - 0.005, 0.626, cardZ + 0.0018, 0.0042, 0.0085, 0.0012, paint.cardInk, 0, 0.32, 0)
  addBox(cardX, 0.643, cardZ, 0.0055, 0.0035, 0.0025, paint.clip, 0, 0.32, 0)

  const micX = -0.068 * shoulders
  const micZ = ringPoint(atHeight(coatProfile, 0.726), -0.58, coatExp)[2] + 0.005
  addBox(micX, 0.727, micZ, 0.010, 0.015, 0.0045, paint.deviceBody, -0.18, -0.45, 0)
  addBox(micX - 0.0015, 0.734, micZ + 0.0042, 0.0028, 0.0028, 0.0015, paint.deviceLed, -0.18, -0.45, 0)

  // ── 4. 颈部与头部（约 5.75 头身：y = 0.822 ~ 0.990，搭配高清贴图面部） ──
  loft([
    section(0.764, 0.030, 0.030, 0, 0.001),
    section(0.788, 0.028, 0.029, 0, 0.004),
    section(0.815, 0.029, 0.031, 0, 0.007),
    section(0.838, 0.035, 0.037, 0, 0.008)
  ], paint.skinShade, 16, 0.96)

  const fw = female ? 0.94 : 1.0
  const headProfile = [
    section(0.822, female ? 0.018 : 0.024, 0.023, 0, 0.023),
    section(0.834, female ? 0.036 : 0.043, 0.038, 0, 0.019),
    section(0.850, female ? 0.051 : 0.057, 0.050, 0, 0.014),
    section(0.870, female ? 0.059 : 0.064, 0.058, 0, 0.010),
    section(0.892, female ? 0.066 : 0.070, 0.065, 0, 0.007),
    section(0.914, 0.071, 0.068, 0, 0.005),
    section(0.934, 0.072, 0.069, 0, 0.003),
    section(0.954, 0.068, 0.067, 0, 0.001),
    section(0.972, 0.057, 0.059, 0, -0.002),
    section(0.985, 0.035, 0.038, 0, -0.003),
    section(0.992, 0.010, 0.012, 0, -0.004)
  ].map(s => ({ ...s, width: s.width * fw }))

  // 头部表面设置独立标记（3=男头，4=女头），供着色器精准投射高清五官贴图
  limb = female ? 4 : 3
  function sculptFaceZ(x, y, cosAngle) {
    if (cosAngle <= 0.05) return 0
    const mask = Math.pow(cosAngle, 1.4)
    const noseBridge = 0.0048 * Math.exp(-((x / 0.011) ** 2 + ((y - 0.884) / 0.022) ** 2))
    const chinSoft = 0.0022 * Math.exp(-((x / 0.024) ** 2 + ((y - 0.836) / 0.014) ** 2))
    return mask * (noseBridge + chinSoft)
  }

  const headSegs = 28
  shell(headProfile.map(s => Array.from({ length: headSegs }, (_, i) => {
    const a = i * TAU / headSegs
    const p = ringPoint(s, a, 0.94)
    p[2] += sculptFaceZ(p[0], p[1], Math.cos(a))
    return p
  })), (j) => (j <= 1 ? paint.skinShade : paint.skin))
  limb = 0

  for (const sign of [-1, 1]) {
    const earX = sign * 0.069 * fw
    loft([
      section(0.876, 0.003, 0.004, earX, 0.002),
      section(0.884, 0.008, 0.009, earX, 0.002),
      section(0.902, 0.009, 0.010, earX, 0.000),
      section(0.916, 0.005, 0.008, earX, -0.001),
      section(0.920, 0.001, 0.003, earX, -0.002)
    ], paint.skinShade, 10, 0.95)
  }

  // ── 5. 立体发型（与 5.75 头身轮廓精确贴合） ──
  const hairProfile = [
    section(0.862, 0.060, 0.061, 0, 0.006),
    section(0.888, 0.072, 0.072, 0, 0.004),
    section(0.916, 0.076, 0.074, 0, 0.002),
    section(0.942, 0.076, 0.074, 0, 0.000),
    section(0.962, female ? 0.072 : 0.074, 0.072, -0.002, -0.001),
    section(0.978, female ? 0.060 : 0.064, 0.062, -0.004, -0.003),
    section(0.991, female ? 0.040 : 0.046, 0.045, -0.006, -0.004),
    section(1.000, 0.004, 0.004, -0.006, -0.004)
  ].map(s => ({ ...s, width: s.width * fw, x: female ? -s.x * 0.35 : s.x }))

  const hairline = female
    ? [[0, 0.938], [0.45, 0.937], [0.88, 0.926], [1.22, 0.906], [1.38, 0.884], [1.56, 0.898], [1.85, 0.902], [2.30, 0.878], [Math.PI, 0.866]]
    : [[0, 0.936], [0.46, 0.938], [0.88, 0.928], [1.18, 0.916], [1.34, 0.884], [1.52, 0.898], [1.80, 0.900], [2.28, 0.874], [Math.PI, 0.862]]

  const hairSegs = 40
  const hairLevels = [0, 0.14, 0.32, 0.54, 0.78, 1]
  function hairPoint(angle, t) {
    const theta = Math.atan2(Math.sin(angle), Math.cos(angle))
    const a = Math.abs(theta)
    let i = 1
    while (i < hairline.length - 1 && a > hairline[i][0]) i++
    const [ax, ay] = hairline[i - 1], [bx, by] = hairline[i]
    const partSweep = (female ? -0.008 : 0.009) * Math.sin(theta * 2.2) * Math.max(0, 1 - a / 1.5)
    const baseY = lerp(ay, by, (a - ax) / Math.max(1e-5, bx - ax)) + partSweep
    const y = lerp(baseY, 1.0, Math.sin(t * Math.PI / 2))
    const pt = ringPoint(atHeight(hairProfile, y), theta, 0.95)
    const crownLift = 0.0024 * Math.sin(Math.PI * t) * (female ? 0.9 : 1.05)
    pt[0] += crownLift * Math.sin(theta)
    pt[1] += crownLift * t * 0.45
    pt[2] += crownLift * Math.cos(theta)
    return pt
  }

  const scalp = hairLevels.map(t => Array.from({ length: hairSegs }, (_, i) => hairPoint(i * TAU / hairSegs, t)))
  const hairRoots = scalp[0].map(([x, y, z]) => [x * 0.92, y + 0.001, z * 0.92])
  shell([hairRoots, ...scalp], (j) => {
    if (j <= 1) return paint.hairDark
    if (j <= 4) return paint.hairMid
    return paint.hairLight
  })

  if (!female) {
    loft([
      section(0.940, 0.012, 0.006, 0.024, 0.065),
      section(0.953, 0.030, 0.010, 0.006, 0.069),
      section(0.968, 0.036, 0.012, -0.012, 0.066),
      section(0.983, 0.023, 0.010, -0.022, 0.054)
    ], paint.hairMid, 12, 0.92)
  } else {
    // 温婉斜分前额发束，柔和过渡额角
    loft([
      section(0.926, 0.010, 0.005, -0.044 * fw, 0.052),
      section(0.938, 0.022, 0.008, -0.022 * fw, 0.064),
      section(0.952, 0.028, 0.010, 0.004 * fw, 0.068),
      section(0.968, 0.022, 0.009, 0.024 * fw, 0.060)
    ], paint.hairMid, 12, 0.92)
    for (const sign of [-1, 1]) {
      const bot = sign > 0 ? 0.876 : 0.890
      loft([
        section(bot, 0.002, 0.002, sign * 0.066 * fw, 0.029),
        section(bot + 0.014, 0.006, 0.007, sign * 0.068 * fw, 0.030),
        section(0.920, 0.008, 0.009, sign * 0.068 * fw, 0.030),
        section(0.944, 0.006, 0.008, sign * 0.060 * fw, 0.033)
      ], paint.hairDark, 10, 0.92)
    }
    loft([
      section(0.772, 0.005, 0.007, 0.054, -0.074),
      section(0.790, 0.014, 0.015, 0.052, -0.086),
      section(0.814, 0.021, 0.022, 0.046, -0.096),
      section(0.838, 0.025, 0.025, 0.038, -0.100),
      section(0.860, 0.022, 0.023, 0.030, -0.099),
      section(0.878, 0.016, 0.018, 0.022, -0.094),
      section(0.892, 0.013, 0.016, 0.015, -0.086)
    ], paint.hairMid, 16, 0.96)
    loft([
      section(0.882, 0.016, 0.018, 0.018, -0.091),
      section(0.894, 0.017, 0.019, 0.014, -0.085)
    ], paint.hairTie, 16, 0.96)
    loft([
      section(0.891, 0.014, 0.017, 0.014, -0.086),
      section(0.906, 0.024, 0.026, 0.009, -0.076),
      section(0.920, 0.023, 0.024, 0.004, -0.068),
      section(0.932, 0.011, 0.014, 0.003, -0.060)
    ], paint.hairDark, 14, 0.96)
  }

  const geometry = new BufferGeometry()
  geometry.setIndex(indices)
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Uint8BufferAttribute(colors, 3, true))
  geometry.setAttribute('aStaffSurface', new Uint8BufferAttribute(surfaces, 4))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.boundingBox.min.z = Math.min(geometry.boundingBox.min.z, -0.22)
  geometry.boundingBox.max.z = Math.max(geometry.boundingBox.max.z, 0.24)
  geometry.computeBoundingSphere()
  geometry.boundingSphere.radius += 0.04
  return geometry
}

// 绘制 1024×512 清淡轻写实政务风男女面部贴图（左半男 0..512，右半女 512..1024）
function createStaffFaceTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const paintFace = (female) => {
    const cxBase = female ? 768 : 256
    const faceHalfW = female ? 0.061 : 0.065
    const yMin = 0.822
    const yMax = 0.954
    const px = (wx) => cxBase + (wx / faceHalfW) * 256
    const py = (wy) => 512 * (yMax - wy) / (yMax - yMin)
    const sx = (dw) => (dw / faceHalfW) * 256
    const sy = (dh) => (dh / (yMax - yMin)) * 512

    // 1. 柔和颊红气色与眼眶微淡立体感（避免扁平）
    for (const sign of [-1, 1]) {
      const cx = px(sign * 0.032)
      const cy = py(0.871)
      const r = sx(0.021)
      const blush = ctx.createRadialGradient(cx, cy, 1, cx, cy, r)
      blush.addColorStop(0, female ? 'rgba(226, 134, 122, 0.16)' : 'rgba(218, 136, 118, 0.10)')
      blush.addColorStop(1, 'rgba(226, 134, 122, 0)')
      ctx.fillStyle = blush
      ctx.beginPath()
      ctx.ellipse(cx, cy, r, sy(0.013), 0, 0, TAU)
      ctx.fill()

      // 眼窝极浅暖影
      const ex = px(sign * 0.0235)
      const ey = py(0.896)
      const orb = ctx.createRadialGradient(ex, ey, 1, ex, ey, sx(0.017))
      orb.addColorStop(0, 'rgba(176, 126, 98, 0.15)')
      orb.addColorStop(1, 'rgba(176, 126, 98, 0)')
      ctx.fillStyle = orb
      ctx.beginPath()
      ctx.ellipse(ex, ey, sx(0.016), sy(0.009), 0, 0, TAU)
      ctx.fill()
    }

    // 2. 眉与眼（左右对称绘制）
    for (const sign of [-1, 1]) {
      // 眉毛（男款沉稳微弓，女款柔和纤细柳叶弧）
      ctx.save()
      ctx.fillStyle = female ? 'rgba(54, 42, 39, 0.88)' : 'rgba(46, 36, 34, 0.92)'
      ctx.beginPath()
      if (female) {
        ctx.moveTo(px(sign * 0.0110), py(0.9035))
        ctx.quadraticCurveTo(px(sign * 0.0235), py(0.9105), px(sign * 0.039), py(0.9035))
        ctx.quadraticCurveTo(px(sign * 0.0235), py(0.9070), px(sign * 0.0110), py(0.9012))
      } else {
        ctx.moveTo(px(sign * 0.0105), py(0.9030))
        ctx.quadraticCurveTo(px(sign * 0.0235), py(0.9092), px(sign * 0.039), py(0.9030))
        ctx.quadraticCurveTo(px(sign * 0.0235), py(0.9045), px(sign * 0.0105), py(0.8992))
      }
      ctx.closePath()
      ctx.fill()
      ctx.restore()

      // 杏仁眼：清澈舒展眼型 + 暖象牙眼白 + 温润深褐虹膜 + 双点柔光
      const eyeY = female ? 0.8885 : 0.8875
      const innerX = px(sign * 0.0110)
      const midX = px(sign * 0.0240)
      const outerX = px(sign * 0.0372)
      const topY = py(eyeY + (female ? 0.0086 : 0.0074))
      const botY = py(eyeY - (female ? 0.0056 : 0.0050))
      const innerY = py(eyeY - 0.0008)
      const outerY = py(eyeY + (female ? 0.0012 : 0.0002))

      ctx.save()
      ctx.beginPath()
      ctx.moveTo(innerX, innerY)
      ctx.quadraticCurveTo(midX, topY, outerX, outerY)
      ctx.quadraticCurveTo(midX, botY, innerX, innerY)
      ctx.closePath()
      ctx.fillStyle = '#f5eee6'
      ctx.fill()
      ctx.clip()

      // 温润深褐虹膜（尺寸饱满有神）
      const irisCx = px(sign * 0.0238)
      const irisCy = py(eyeY + 0.0008)
      const irisR = sx(female ? 0.0084 : 0.0079)
      const irisGrad = ctx.createRadialGradient(irisCx, irisCy - 1, 1, irisCx, irisCy, irisR)
      irisGrad.addColorStop(0, '#1a1210')
      irisGrad.addColorStop(0.55, '#34221c')
      irisGrad.addColorStop(1, '#4b3329')
      ctx.fillStyle = irisGrad
      ctx.beginPath()
      ctx.arc(irisCx, irisCy, irisR, 0, TAU)
      ctx.fill()

      ctx.fillStyle = '#140e0d'
      ctx.beginPath()
      ctx.arc(irisCx, irisCy, irisR * 0.48, 0, TAU)
      ctx.fill()

      // 主高光点 + 右下方柔和反光点
      ctx.fillStyle = 'rgba(255, 251, 246, 0.92)'
      ctx.beginPath()
      ctx.arc(irisCx - sx(0.0022), irisCy - sy(0.0020), sx(0.0022), 0, TAU)
      ctx.fill()
      ctx.fillStyle = 'rgba(255, 248, 240, 0.45)'
      ctx.beginPath()
      ctx.arc(irisCx + sx(0.0020), irisCy + sy(0.0022), sx(0.0011), 0, TAU)
      ctx.fill()
      ctx.restore()

      // 柔和上眼睑线 + 极浅下睑影 + 淡双眼皮线
      ctx.save()
      ctx.lineCap = 'round'
      ctx.strokeStyle = female ? 'rgba(38, 28, 25, 0.92)' : 'rgba(42, 31, 28, 0.88)'
      ctx.lineWidth = female ? 4.6 : 4.2
      ctx.beginPath()
      ctx.moveTo(innerX, innerY)
      ctx.quadraticCurveTo(midX, topY, outerX + sign * 2.5, outerY - (female ? 1.2 : 0))
      ctx.stroke()

      ctx.strokeStyle = 'rgba(136, 94, 74, 0.34)'
      ctx.lineWidth = 1.8
      ctx.beginPath()
      ctx.moveTo(innerX + sign * 2, innerY + 1)
      ctx.quadraticCurveTo(midX, botY, outerX - sign * 1.5, outerY + 1)
      ctx.stroke()

      ctx.strokeStyle = 'rgba(156, 108, 84, 0.28)'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(innerX + sign * 3, py(eyeY + 0.0068))
      ctx.quadraticCurveTo(midX, py(eyeY + 0.0106), outerX - sign * 2, py(eyeY + 0.0060))
      ctx.stroke()
      ctx.restore()
    }

    // 3. 轻写实柔鼻影（鼻梁高光 + 鼻底淡弧影，不画硬线）
    const noseTipY = py(0.864)
    const noseShadow = ctx.createRadialGradient(px(0), noseTipY + 4, 1, px(0), noseTipY + 4, sx(0.0125))
    noseShadow.addColorStop(0, 'rgba(166, 114, 86, 0.28)')
    noseShadow.addColorStop(0.55, 'rgba(176, 126, 98, 0.12)')
    noseShadow.addColorStop(1, 'rgba(176, 126, 98, 0)')
    ctx.fillStyle = noseShadow
    ctx.beginPath()
    ctx.ellipse(px(0), noseTipY + 4, sx(0.012), sy(0.0052), 0, 0, TAU)
    ctx.fill()

    // 鼻梁左侧柔和提亮
    const noseGlow = ctx.createLinearGradient(px(-0.003), py(0.888), px(0.003), py(0.866))
    noseGlow.addColorStop(0, 'rgba(255, 244, 234, 0)')
    noseGlow.addColorStop(0.5, 'rgba(255, 244, 234, 0.22)')
    noseGlow.addColorStop(1, 'rgba(255, 244, 234, 0)')
    ctx.strokeStyle = noseGlow
    ctx.lineWidth = 3.0
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(px(-0.001), py(0.887))
    ctx.lineTo(px(-0.001), py(0.867))
    ctx.stroke()

    // 4. 温和微笑唇线（嘴角柔和微扬，男款淡弧自然，女款微带清淡裸豆沙色）
    const mouthY = 0.8445
    const mLeft = px(female ? -0.0150 : -0.0160)
    const mRight = px(female ? 0.0150 : 0.0160)
    const mMidX = px(0)
    const mMidY = py(mouthY - 0.0012)
    const mCornerY = py(mouthY + 0.0014)

    ctx.save()
    ctx.fillStyle = female ? 'rgba(204, 122, 112, 0.44)' : 'rgba(176, 114, 98, 0.24)'
    ctx.beginPath()
    ctx.moveTo(mLeft, mCornerY)
    ctx.quadraticCurveTo(px(-0.0055), py(mouthY + 0.0026), mMidX, py(mouthY + 0.0014))
    ctx.quadraticCurveTo(px(0.0055), py(mouthY + 0.0026), mRight, mCornerY)
    ctx.quadraticCurveTo(mMidX, py(mouthY - 0.0060), mLeft, mCornerY)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    ctx.save()
    ctx.strokeStyle = female ? 'rgba(148, 82, 76, 0.84)' : 'rgba(138, 84, 72, 0.80)'
    ctx.lineWidth = female ? 2.5 : 2.7
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(mLeft, mCornerY)
    ctx.quadraticCurveTo(mMidX, mMidY, mRight, mCornerY)
    ctx.stroke()

    ctx.strokeStyle = 'rgba(164, 112, 88, 0.26)'
    ctx.lineWidth = 2.0
    ctx.beginPath()
    ctx.moveTo(px(-0.0075), py(mouthY - 0.0052))
    ctx.quadraticCurveTo(mMidX, py(mouthY - 0.0066), px(0.0075), py(mouthY - 0.0052))
    ctx.stroke()
    ctx.restore()
  }

  paintFace(false)
  paintFace(true)

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

// 真实关节圆弧旋转步态：腿绕髋部旋转 + 膝部自然屈曲，臂绕肩部反相摆动，法线同步旋转
const strideVertexPars = /* glsl */ `
  attribute vec4 aStaffSurface;
  #ifdef USE_INSTANCING
    attribute float aStridePhase;
    attribute vec2 aStaffFade;
  #endif
  varying float vStaffLightResponse;
  varying vec2 vStaffPbr;
  varying vec2 vStaffFade;
  varying vec3 vVestPrint;
  varying vec3 vHeadLocal;
  varying float vFaceGender;

  struct StaffMotion {
    vec3 pos;
    float sinAng;
    float cosAng;
  };

  StaffMotion evalStaffMotion(vec3 p) {
    StaffMotion m;
    m.pos = p;
    m.sinAng = 0.0;
    m.cosAng = 1.0;
    #ifdef USE_INSTANCING
      if (aStridePhase >= 0.0) {
        if (aStaffSurface.x < 0.5 || aStaffSurface.x > 2.5) {
          m.pos.y += 0.0055 * abs(sin(aStridePhase));
          return m;
        }
        bool leg = aStaffSurface.x < 1.5;
        float side = p.x >= 0.0 ? 1.0 : -1.0;
        float phase = side * sin(aStridePhase);
        float swingFoot = max(0.0, side * cos(aStridePhase));
        if (leg) {
          float pivotY = 0.482;
          float pivotZ = -0.002;
          float t = clamp((pivotY - p.y) / 0.482, 0.0, 1.0);
          float hipAng = -phase * 0.34 * smoothstep(0.0, 0.14, t);
          float kneeMask = smoothstep(0.42, 0.62, t);
          float kneeAng = swingFoot * 0.44 * kneeMask;
          float totalAng = hipAng + kneeAng;
          float c = cos(totalAng), s = sin(totalAng);
          float dy = p.y - pivotY;
          float dz = p.z - pivotZ;
          m.pos.y = pivotY + dy * c - dz * s + 0.016 * swingFoot * t;
          m.pos.z = pivotZ + dy * s + dz * c;
          m.sinAng = s;
          m.cosAng = c;
          return m;
        } else {
          float pivotY = 0.733;
          float pivotZ = -0.002;
          float t = clamp((pivotY - p.y) / 0.323, 0.0, 1.0);
          float armAng = phase * 0.28 * smoothstep(0.0, 0.18, t) - max(0.0, phase) * 0.14 * smoothstep(0.48, 0.72, t);
          float c = cos(armAng), s = sin(armAng);
          float dy = p.y - pivotY;
          float dz = p.z - pivotZ;
          m.pos.y = pivotY + dy * c - dz * s;
          m.pos.z = pivotZ + dy * s + dz * c;
          m.sinAng = s;
          m.cosAng = c;
          return m;
        }
      }
    #endif
    return m;
  }
`

/** aStridePhase 由实例提供，单位弧度；负值保持站姿。uLift 可在昼夜切换时直接更新。 */
export function createStaffAvatarMaterial() {
  const material = new MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.72,
    metalness: 0.04
  })

  // 后背「网格员」高清印字纹理
  const label = document.createElement('canvas')
  label.width = 256
  label.height = 80
  const ink = label.getContext('2d')
  ink.font = '700 62px "PingFang SC", "Microsoft YaHei", sans-serif'
  ink.textAlign = 'center'
  ink.textBaseline = 'middle'
  ink.fillStyle = '#ffffff'
  ink.fillText('网格员', label.width / 2, label.height / 2)
  const vestPrint = new CanvasTexture(label)
  const faceMap = createStaffFaceTexture()

  material.addEventListener('dispose', () => {
    vestPrint.dispose()
    faceMap.dispose()
  })

  const uLift = { value: 0.12 }
  material.userData.uLift = uLift

  material.onBeforeCompile = shader => {
    shader.uniforms.uStaffLift = uLift
    shader.uniforms.uVestPrint = { value: vestPrint }
    shader.uniforms.uFaceMap = { value: faceMap }

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${strideVertexPars}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        StaffMotion staffMot = evalStaffMotion(position);
        float nY = objectNormal.y * staffMot.cosAng - objectNormal.z * staffMot.sinAng;
        float nZ = objectNormal.y * staffMot.sinAng + objectNormal.z * staffMot.cosAng;
        objectNormal.y = nY;
        objectNormal.z = nZ;
        #ifdef USE_INSTANCING
          vStaffFade = aStaffFade;
        #else
          vStaffFade = vec2(0.0);
        #endif
        vStaffLightResponse = aStaffSurface.y / 255.0;
        vStaffPbr = vec2(aStaffSurface.z / 255.0, aStaffSurface.w / 255.0);
        vHeadLocal = position;
        vFaceGender = aStaffSurface.x;
        vVestPrint = vec3(0.5 - position.x / 0.176, 0.5 + (position.y - 0.621) / 0.056,
          step(position.z, -0.025) * step(aStaffSurface.x, 0.5));`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed = staffMot.pos;`)

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uStaffLift;
        uniform sampler2D uVestPrint;
        uniform sampler2D uFaceMap;
        varying vec3 vVestPrint;
        varying vec3 vHeadLocal;
        varying float vFaceGender;
        varying float vStaffLightResponse;
        varying vec2 vStaffPbr;
        varying vec2 vStaffFade;
        float staffBayer2(vec2 p) {
          vec2 bit = mod(floor(p), 2.0);
          return 2.0 * bit.x + 3.0 * bit.y - 4.0 * bit.x * bit.y;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vVestPrint.z > 0.5 && all(lessThan(abs(vVestPrint.xy - 0.5), vec2(0.5)))) {
          float inkAlpha = texture2D(uVestPrint, vVestPrint.xy).a;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.90, 0.95, 0.98), 0.92 * inkAlpha);
        }
        if (vFaceGender > 2.5 && vHeadLocal.z > 0.024) {
          bool isFemale = vFaceGender > 3.5;
          float halfW = isFemale ? 0.061 : 0.065;
          float uLocal = 0.5 + vHeadLocal.x / (2.0 * halfW);
          float vLocal = (vHeadLocal.y - 0.822) / 0.132;
          if (uLocal > 0.02 && uLocal < 0.98 && vLocal > 0.01 && vLocal < 0.99) {
            float uAtlas = isFemale ? (0.5 + 0.5 * uLocal) : (0.5 * uLocal);
            vec4 faceTex = texture2D(uFaceMap, vec2(uAtlas, vLocal));
            diffuseColor.rgb = mix(diffuseColor.rgb, faceTex.rgb, faceTex.a);
          }
        }`)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
        if (vStaffFade.x > 0.001) {
          float cutoff = (4.0 * staffBayer2(gl_FragCoord.xy) + staffBayer2(gl_FragCoord.xy * 0.5) + 0.5) / 16.0;
          if (1.0 - vStaffFade.x < cutoff) discard;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(vStaffPbr.x, 0.08, 0.96);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = clamp(vStaffPbr.y, 0.0, 0.9);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float nightFactor = clamp((uStaffLift - 0.12) / 0.68, 0.0, 1.0);
        vec3 viewDir = normalize(vViewPosition);
        float rim = pow(clamp(1.0 - abs(dot(normalize(normal), viewDir)), 0.0, 1.0), 2.6);
        vec3 rimTint = mix(vec3(0.98, 0.96, 0.92), vec3(0.74, 0.88, 0.98), nightFactor);
        totalEmissiveRadiance += diffuseColor.rgb * (uStaffLift * vStaffLightResponse * 0.62);
        totalEmissiveRadiance += rimTint * rim * mix(0.10, 0.30, nightFactor);`)
      .replace('#include <opaque_fragment>', `
        outgoingLight = mix(outgoingLight, vec3(dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722))) * 0.72, vStaffFade.y * 0.80);
        #include <opaque_fragment>`)
  }

  material.customProgramCacheKey = () => 'cockpit-staff-figurine-pbr-v2'
  return material
}
