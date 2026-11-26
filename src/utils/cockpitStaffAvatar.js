import {
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  MeshStandardMaterial,
  SRGBColorSpace,
  Uint8BufferAttribute
} from 'three'

const TAU = Math.PI * 2
const lerp = (a, b, t) => a + (b - a) * t
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const rounded = (value, exponent) => Math.sign(value) * Math.abs(value) ** exponent

// 硬朗巡防色板：低饱和政务执勤制服 + 高可见度青绿双色反光马甲 + 暖象牙肤色
const PAL = {
  skin: 0xf7d7c0,
  skinShade: 0xeac0a3,
  skinWarm: 0xf4cab1,
  hairInk: 0x262226,
  hairMid: 0x322d33,
  hairTie: 0x1b4066,
  patrolShirt: 0x243d58,
  patrolShirtShade: 0x1a2e44,
  patrolVest: 0x1a466d,
  patrolHiVis: 0x1fb588,
  patrolCap: 0x1a3756,
  patrolCapBrim: 0x12273f,
  patrolBadge: 0xf4cf7e,
  patrolPants: 0x1e2a38,
  patrolBoot: 0x1e2630,
  binding: 0x132f4c,
  belt: 0x1b222c,
  buckle: 0xc9d3de,
  reflector: 0xeef6fa,
  card: 0xf9fbfd,
  cardInk: 0x1f5fa8,
  clip: 0xc3ced9,
  deviceBody: 0x1b242f,
  deviceScreen: 0x8bd0ee,
  deviceLed: 0x45eec8
}

// [nightLift(0-255), roughness(0-255), metalness(0-255)]
const SURFACE_PROPS = new Map([
  [PAL.reflector, [255, 52, 108]],
  [PAL.patrolHiVis, [242, 92, 24]],
  [PAL.patrolBadge, [240, 60, 185]],
  [PAL.buckle, [200, 62, 195]],
  [PAL.deviceScreen, [240, 38, 22]],
  [PAL.deviceLed, [255, 42, 20]],
  [PAL.card, [215, 92, 16]],
  [PAL.clip, [180, 62, 175]],
  [PAL.cardInk, [168, 128, 18]],
  [PAL.skin, [196, 152, 2]],
  [PAL.skinWarm, [188, 156, 2]],
  [PAL.skinShade, [176, 160, 2]],
  [PAL.patrolVest, [146, 188, 8]],
  [PAL.patrolShirt, [120, 196, 6]],
  [PAL.patrolShirtShade, [106, 204, 6]],
  [PAL.patrolCap, [124, 188, 8]],
  [PAL.patrolCapBrim, [104, 198, 8]],
  [PAL.binding, [118, 206, 8]],
  [PAL.belt, [92, 142, 24]],
  [PAL.patrolPants, [86, 212, 6]],
  [PAL.patrolBoot, [78, 148, 16]],
  [PAL.deviceBody, [85, 118, 36]],
  [PAL.hairTie, [112, 176, 12]],
  [PAL.hairInk, [68, 164, 10]],
  [PAL.hairMid, [76, 160, 12]]
])

const SPEC_PATROL = {
  legPivotY: 0.415,
  armPivotY: 0.660,
  backPrintY: 0.550,
  backPrintW: 0.178,
  backPrintH: 0.056,
  backPrintZ: -0.023,
  backPrintTint: [0.98, 0.99, 1.0],
  baseRoughness: 0.64,
  baseMetalness: 0.06,
  faceMapCfg: {
    zMin: 0.020,
    centerZ: 0.007,
    angleSpan: 2.16,
    yMin: 0.742,
    yMax: 0.916
  }
}

function sec(y, width, depth, x = 0, z = 0, ao = 1.0) {
  return { y, width, depth, x, z, ao }
}

function atHeight(profile, y) {
  if (y <= profile[0].y) return profile[0]
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1], b = profile[i]
    if (y > b.y) continue
    const t = (y - a.y) / Math.max(1e-6, b.y - a.y)
    return sec(
      y,
      lerp(a.width, b.width, t),
      lerp(a.depth, b.depth, t),
      lerp(a.x, b.x, t),
      lerp(a.z, b.z, t),
      lerp(a.ao, b.ao, t)
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

function createSculptBuilder() {
  const positions = []
  const colors = []
  const surfaces = []
  const indices = []
  const palette = new Map()
  let limb = 0

  function setLimb(v) {
    limb = v
  }

  function vertex(point, color, ao = 1.0, customProps = null) {
    let rgb = palette.get(color)
    if (!rgb) {
      const tint = new Color(color)
      rgb = [tint.r, tint.g, tint.b]
      palette.set(color, rgb)
    }
    const index = positions.length / 3
    positions.push(point[0], point[1], point[2])
    const shade = clamp(ao, 0.72, 1.06)
    colors.push(
      Math.min(255, Math.round(rgb[0] * 255 * shade)),
      Math.min(255, Math.round(rgb[1] * 255 * shade)),
      Math.min(255, Math.round(rgb[2] * 255 * shade))
    )
    const props = customProps || SURFACE_PROPS.get(color) || [96, 196, 8]
    surfaces.push(limb, props[0], props[1], props[2])
    return index
  }

  function shell(rings, colorFn, closed = true, aoFn = null) {
    const count = rings[0].length
    const shade = typeof colorFn === 'function' ? colorFn : () => colorFn
    const aoEval = typeof aoFn === 'function' ? aoFn : () => 1.0
    const rows = rings.map((ring, j) => ring.map((point, i) => vertex(point, shade(j, i), aoEval(j, i, point))))
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
      const rim = pts.map((point, i) => vertex(point, shade(end, i), aoEval(end, i, point)))
      const center = [0, 0, 0]
      pts.forEach(p => { center[0] += p[0] / count; center[1] += p[1] / count; center[2] += p[2] / count })
      const c = vertex(center, shade(end, 0), aoEval(end, 0, center))
      for (let i = 0; i < count; i++) {
        const n = (i + 1) % count
        if (end === 0) indices.push(c, rim[n], rim[i])
        else indices.push(c, rim[i], rim[n])
      }
    }
  }

  function loft(profile, colorFn, count = 18, exponent = 1, closed = true) {
    const rings = profile.map(s => Array.from({ length: count }, (_, i) => ringPoint(s, i * TAU / count, exponent)))
    shell(rings, colorFn, closed, (j) => profile[j].ao ?? 1.0)
  }

  /** 沿关节路径放样并自动封圆端帽，生成平滑胶囊肢体或发束。 */
  function addChain(joints, colorFn, segs = 14, endCaps = true) {
    const rings = []
    const aoVals = []
    const pushRing = (c, dir, rx, rz, ao) => {
      const len = Math.hypot(dir[0], dir[1], dir[2]) || 1
      const ty = [dir[0] / len, dir[1] / len, dir[2] / len]
      const ref = Math.abs(ty[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
      const tx = [
        ref[1] * ty[2] - ref[2] * ty[1],
        ref[2] * ty[0] - ref[0] * ty[2],
        ref[0] * ty[1] - ref[1] * ty[0]
      ]
      const txLen = Math.hypot(tx[0], tx[1], tx[2]) || 1
      tx[0] /= txLen; tx[1] /= txLen; tx[2] /= txLen
      const tz = [
        ty[1] * tx[2] - ty[2] * tx[1],
        ty[2] * tx[0] - ty[0] * tx[2],
        ty[0] * tx[1] - ty[1] * tx[0]
      ]
      const ring = []
      for (let i = 0; i < segs; i++) {
        const a = i * TAU / segs
        const ca = Math.cos(a) * rx
        const sa = Math.sin(a) * rz
        ring.push([
          c[0] + tx[0] * ca + tz[0] * sa,
          c[1] + tx[1] * ca + tz[1] * sa,
          c[2] + tx[2] * ca + tz[2] * sa
        ])
      }
      rings.push(ring)
      aoVals.push(ao)
    }

    const dirs = joints.map((j, idx) => {
      const prev = joints[Math.max(0, idx - 1)]
      const next = joints[Math.min(joints.length - 1, idx + 1)]
      return [next.x - prev.x, next.y - prev.y, next.z - prev.z]
    })

    if (endCaps) {
      const j0 = joints[0], d0 = dirs[0]
      const l0 = Math.hypot(d0[0], d0[1], d0[2]) || 1
      const capH0 = (j0.rx + j0.rz) * 0.42
      for (const f of [0.85, 0.45]) {
        const s = Math.sqrt(Math.max(0.08, 1 - f * f))
        pushRing(
          [j0.x - d0[0] / l0 * capH0 * f, j0.y - d0[1] / l0 * capH0 * f, j0.z - d0[2] / l0 * capH0 * f],
          d0, j0.rx * s, j0.rz * s, (j0.ao ?? 1) * 0.96
        )
      }
    }
    joints.forEach((j, idx) => pushRing([j.x, j.y, j.z], dirs[idx], j.rx, j.rz, j.ao ?? 1))
    if (endCaps) {
      const jn = joints[joints.length - 1], dn = dirs[joints.length - 1]
      const ln = Math.hypot(dn[0], dn[1], dn[2]) || 1
      const capHn = (jn.rx + jn.rz) * 0.42
      for (const f of [0.45, 0.85]) {
        const s = Math.sqrt(Math.max(0.08, 1 - f * f))
        pushRing(
          [jn.x + dn[0] / ln * capHn * f, jn.y + dn[1] / ln * capHn * f, jn.z + dn[2] / ln * capHn * f],
          dn, jn.rx * s, jn.rz * s, (jn.ao ?? 1) * 0.96
        )
      }
    }
    shell(rings, typeof colorFn === 'function' ? (j) => colorFn(j / Math.max(1, rings.length - 1)) : colorFn, true, (j) => aoVals[j])
  }

  function addEllipsoid(cx, cy, cz, rx, ry, rz, colorFn, segsU = 22, segsV = 12, rotX = 0, rotY = 0, rotZ = 0, aoFn = null) {
    const cx0 = Math.cos(rotX), sx0 = Math.sin(rotX)
    const cy0 = Math.cos(rotY), sy0 = Math.sin(rotY)
    const cz0 = Math.cos(rotZ), sz0 = Math.sin(rotZ)
    const xform = (x, y, z) => {
      const x1 = x * cz0 - y * sz0, y1 = x * sz0 + y * cz0, z1 = z
      const y2 = y1 * cx0 - z1 * sx0, z2 = y1 * sx0 + z1 * cx0, x2 = x1
      const x3 = x2 * cy0 + z2 * sy0, z3 = -x2 * sy0 + z2 * cy0, y3 = y2
      return [cx + x3, cy + y3, cz + z3]
    }
    const rings = []
    for (let v = 0; v <= segsV; v++) {
      const phi = -Math.PI / 2 + (v / segsV) * Math.PI
      const cp = Math.cos(phi), sp = Math.sin(phi)
      const rScale = Math.max(0.03, cp)
      const ring = []
      for (let u = 0; u < segsU; u++) {
        const theta = u * TAU / segsU
        ring.push(xform(rx * rScale * Math.sin(theta), ry * sp, rz * rScale * Math.cos(theta)))
      }
      rings.push(ring)
    }
    shell(rings, colorFn, true, aoFn)
  }

  function addRoundedBox(cx, cy, cz, hx, hy, hz, bevel, color, rotX = 0, rotY = 0, rotZ = 0, ao = 1.0) {
    const b = Math.min(bevel, hx * 0.45, hy * 0.45, hz * 0.45)
    const cx0 = Math.cos(rotX), sx0 = Math.sin(rotX)
    const cy0 = Math.cos(rotY), sy0 = Math.sin(rotY)
    const cz0 = Math.cos(rotZ), sz0 = Math.sin(rotZ)
    const xform = (x, y, z) => {
      const x1 = x * cz0 - y * sz0, y1 = x * sz0 + y * cz0, z1 = z
      const y2 = y1 * cx0 - z1 * sx0, z2 = y1 * sx0 + z1 * cx0, x2 = x1
      const x3 = x2 * cy0 + z2 * sy0, z3 = -x2 * sy0 + z2 * cy0, y3 = y2
      return [cx + x3, cy + y3, cz + z3]
    }
    const ix = hx - b, iy = hy - b, iz = hz - b
    const levels = [
      { y: -hy, x: ix, z: iz, ao: ao * 0.90 },
      { y: -iy, x: hx, z: hz, ao: ao * 0.96 },
      { y: iy, x: hx, z: hz, ao },
      { y: hy, x: ix, z: iz, ao: ao * 1.02 }
    ]
    const rings = levels.map(lv => {
      const pts = [
        [-lv.x + b * 0.3, lv.y, lv.z], [lv.x - b * 0.3, lv.y, lv.z],
        [lv.x, lv.y, lv.z - b * 0.3], [lv.x, lv.y, -lv.z + b * 0.3],
        [lv.x - b * 0.3, lv.y, -lv.z], [-lv.x + b * 0.3, lv.y, -lv.z],
        [-lv.x, lv.y, -lv.z + b * 0.3], [-lv.x, lv.y, lv.z - b * 0.3]
      ]
      return pts.map(([x, y, z]) => xform(x, y, z))
    })
    shell(rings, color, true, (j) => levels[j].ao)
  }

  function addCoatBand(profile, exponent, thetaStart, thetaEnd, yBot, yTop, radialOffset, thickness, color, segs = 18, ao = 1.0) {
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
    const pushQuad = (a, b, c, d, qAo) => {
      const ia = vertex(a, color, qAo), ib = vertex(b, color, qAo), ic = vertex(c, color, qAo), id = vertex(d, color, qAo)
      indices.push(ia, ib, ic, ia, ic, id)
    }
    for (let i = 0; i < segs; i++) {
      pushQuad(outerBot[i], outerBot[i + 1], outerTop[i + 1], outerTop[i], ao)
      pushQuad(outerTop[i], outerTop[i + 1], innerTop[i + 1], innerTop[i], ao * 1.02)
      pushQuad(innerBot[i], innerBot[i + 1], outerBot[i + 1], outerBot[i], ao * 0.90)
    }
    pushQuad(innerBot[0], outerBot[0], outerTop[0], innerTop[0], ao * 0.94)
    pushQuad(outerBot[segs], innerBot[segs], innerTop[segs], outerTop[segs], ao * 0.94)
  }

  function addCollar(collarY, neckR, shirtCol, shadeCol) {
    for (const sign of [-1, 1]) {
      const segs = 10
      const oTop = [], oBot = [], iTop = [], iBot = []
      for (let i = 0; i <= segs; i++) {
        const t = i / segs
        const theta = sign * lerp(0.24, Math.PI * 0.94, t)
        const yTop = collarY + lerp(0.008, 0.030, Math.sin(t * Math.PI * 0.68))
        const yTip = collarY - lerp(0.032, -0.006, Math.pow(t, 0.72))
        const rx = neckR + 0.004 * (1 - t)
        const rz = neckR * 0.96 + 0.005 * (1 - t)
        const nx = Math.sin(theta), nz = Math.cos(theta)
        iTop.push([nx * rx, yTop, nz * rz])
        oTop.push([nx * (rx + 0.006), yTop + 0.001, nz * (rz + 0.006)])
        const spread = lerp(0.017, 0.007, t)
        oBot.push([nx * (rx + spread), yTip, nz * (rz + spread)])
        iBot.push([nx * (rx + spread - 0.005), yTip + 0.001, nz * (rz + spread - 0.005)])
      }
      const q = (a, b, c, d, col, ao) => {
        const ia = vertex(a, col, ao), ib = vertex(b, col, ao), ic = vertex(c, col, ao), id = vertex(d, col, ao)
        indices.push(ia, ib, ic, ia, ic, id)
      }
      for (let i = 0; i < segs; i++) {
        if (sign > 0) {
          q(oBot[i], oBot[i + 1], oTop[i + 1], oTop[i], shirtCol, 1.0)
          q(oTop[i], oTop[i + 1], iTop[i + 1], iTop[i], shirtCol, 1.02)
          q(iBot[i], oBot[i], oBot[i + 1], iBot[i + 1], shadeCol, 0.94)
        } else {
          q(oBot[i + 1], oBot[i], oTop[i], oTop[i + 1], shirtCol, 1.0)
          q(oTop[i + 1], oTop[i], iTop[i], iTop[i + 1], shirtCol, 1.02)
          q(oBot[i], iBot[i], iBot[i + 1], oBot[i + 1], shadeCol, 0.94)
        }
      }
      if (sign > 0) q(iBot[0], oBot[0], oTop[0], iTop[0], shadeCol, 0.94)
      else q(oBot[0], iBot[0], iTop[0], oTop[0], shadeCol, 0.94)
    }
  }

  function addUniformTorso({
    coatProfile,
    coatExp = 0.78,
    vBottomY,
    topY,
    yokeY,
    vestCol,
    yokeCol,
    bindingCol,
    reflectCol,
    beltY,
    pantsCol,
    shirtCol,
    shirtShadeCol,
    neckR,
    collarY,
    isFemale
  }) {
    setLimb(0)
    // 完整骨盆闭环，兜住马甲下摆内沿与大腿根部，防止穿模露缝
    const hipBase = coatProfile[0]
    loft([
      sec(beltY - 0.055, hipBase.width * 0.94, hipBase.depth * 0.92, 0, -0.003, 0.90),
      sec(beltY - 0.015, hipBase.width * 0.98, hipBase.depth * 0.95, 0, -0.003, 0.95),
      sec(beltY + 0.025, hipBase.width * 0.95, hipBase.depth * 0.92, 0, -0.002, 0.94)
    ], pantsCol, 22, 0.84)

    const shBotY = vBottomY - 0.025
    loft([
      sec(shBotY, hipBase.width * 0.84, hipBase.depth * 0.82, 0, 0.001, 0.93),
      sec(lerp(shBotY, yokeY, 0.52), coatProfile[2].width * 0.87, coatProfile[2].depth * 0.86, 0, 0.001, 0.98),
      sec(yokeY + 0.015, coatProfile[3].width * 0.85, coatProfile[3].depth * 0.82, 0, -0.001, 1.0),
      sec(topY - 0.005, coatProfile[4].width * 0.76, coatProfile[4].depth * 0.78, 0, -0.001, 0.97),
      sec(collarY, neckR, neckR * 0.94, 0, 0.0, 0.95)
    ], shirtCol, 24, 0.84)

    addCollar(collarY, neckR, shirtCol, shirtShadeCol)

    const coatSegs = 30
    const outerRings = []
    const innerRings = []
    for (let j = 0; j < coatProfile.length; j++) {
      const s = coatProfile[j]
      const vp = clamp((s.y - vBottomY) / Math.max(0.01, topY - vBottomY), 0, 1)
      const openHalf = s.y <= vBottomY ? 0.014 : lerp(0.028, 0.44, Math.pow(vp, 0.80))
      const oRing = [], iRing = []
      for (let i = 0; i <= coatSegs; i++) {
        const theta = lerp(openHalf, TAU - openHalf, i / coatSegs)
        const pOut = ringPoint(s, theta, coatExp)
        const nx = Math.sin(theta), nz = Math.cos(theta)
        oRing.push(pOut)
        iRing.push([pOut[0] - nx * 0.0055, pOut[1], pOut[2] - nz * 0.0055])
      }
      outerRings.push(oRing)
      innerRings.push(iRing)
    }

    const coatColAt = (y) => (y >= yokeY || y <= lerp(coatProfile[0].y, yokeY, 0.34)) ? yokeCol : vestCol
    const coatRows = outerRings.map((ring, j) => {
      const s = coatProfile[j]
      return ring.map(p => vertex(p, coatColAt(s.y), s.ao ?? 1.0))
    })
    for (let j = 1; j < coatRows.length; j++) {
      for (let i = 0; i < coatSegs; i++) {
        const lo = coatRows[j - 1], hi = coatRows[j]
        indices.push(lo[i], lo[i + 1], hi[i], lo[i + 1], hi[i + 1], hi[i])
      }
    }
    for (const [ring, inRing, flip] of [
      [outerRings[0], innerRings[0], true],
      [outerRings[outerRings.length - 1], innerRings[innerRings.length - 1], false]
    ]) {
      const col = flip ? bindingCol : coatColAt(ring[0][1])
      for (let i = 0; i < coatSegs; i++) {
        const a = vertex(ring[i], col, 0.92), b = vertex(ring[i + 1], col, 0.92)
        const c = vertex(inRing[i + 1], col, 0.90), d = vertex(inRing[i], col, 0.90)
        if (flip) indices.push(a, d, c, a, c, b)
        else indices.push(a, b, c, a, c, d)
      }
    }
    for (let j = 1; j < outerRings.length; j++) {
      for (const sideIdx of [0, coatSegs]) {
        const a = vertex(outerRings[j - 1][sideIdx], bindingCol, 0.95)
        const b = vertex(outerRings[j][sideIdx], bindingCol, 0.95)
        const c = vertex(innerRings[j][sideIdx], bindingCol, 0.92)
        const d = vertex(innerRings[j - 1][sideIdx], bindingCol, 0.92)
        if (sideIdx === 0) indices.push(a, b, c, a, c, d)
        else indices.push(a, d, c, a, c, b)
      }
    }

    addCoatBand(coatProfile, coatExp, -0.015, 0.015, coatProfile[0].y + 0.008, vBottomY, 0.0006, 0.0020, bindingCol, 2, 0.95)
    addCoatBand(coatProfile, coatExp, 0.28, 0.88, yokeY - 0.036, yokeY - 0.020, 0.0008, 0.0026, reflectCol, 10)
    addCoatBand(coatProfile, coatExp, -0.88, -0.28, yokeY - 0.036, yokeY - 0.020, 0.0008, 0.0026, reflectCol, 10)
    addCoatBand(coatProfile, coatExp, 2.18, TAU - 2.18, yokeY - 0.014, yokeY + 0.002, 0.0008, 0.0026, reflectCol, 16)
    const lowerBandY = lerp(coatProfile[0].y, vBottomY, 0.42)
    addCoatBand(coatProfile, coatExp, 0.06, TAU - 0.06, lowerBandY, lowerBandY + 0.016, 0.0008, 0.0026, reflectCol, 26)

    const beltS = sec(beltY, hipBase.width * 1.005, hipBase.depth * 0.985, 0, -0.002, 0.96)
    loft([
      sec(beltY - 0.013, beltS.width, beltS.depth, 0, -0.002, 0.94),
      sec(beltY + 0.013, beltS.width, beltS.depth, 0, -0.002, 0.98)
    ], PAL.belt, 24, 0.82)
    addRoundedBox(0, beltY, beltS.z + beltS.depth + 0.0025, 0.015, 0.012, 0.0038, 0.002, PAL.buckle)

    const cardY = lerp(coatProfile[0].y, yokeY, 0.64)
    const cardSurf = atHeight(coatProfile, cardY)
    const cardZ = ringPoint(cardSurf, 0.46, coatExp)[2] + 0.0045
    const cardX = cardSurf.width * (isFemale ? 0.43 : 0.42)
    addRoundedBox(cardX, cardY, cardZ, 0.018, 0.014, 0.0022, 0.0018, PAL.card, 0, 0.30, 0)
    addRoundedBox(cardX - 0.005, cardY, cardZ + 0.0020, 0.0045, 0.0082, 0.0012, 0.0008, PAL.cardInk, 0, 0.30, 0)
    addRoundedBox(cardX, cardY + 0.016, cardZ, 0.0052, 0.0034, 0.0024, 0.001, PAL.clip, 0, 0.30, 0)

    const micY = lerp(yokeY, topY, 0.48)
    const micSurf = atHeight(coatProfile, micY)
    const micZ = ringPoint(micSurf, -0.58, coatExp)[2] + 0.0052
    const micX = -micSurf.width * 0.56
    addRoundedBox(micX, micY, micZ, 0.0105, 0.015, 0.0046, 0.0022, PAL.deviceBody, -0.18, -0.44, 0)
    addRoundedBox(micX - 0.0016, micY + 0.006, micZ + 0.0044, 0.0028, 0.0028, 0.0016, 0.0008, PAL.deviceLed, -0.18, -0.44, 0)
  }

  function addLegs({ hipY, hipX, footX, footZ, thighR, calfR, ankleR, pantsCol, shoeCol, soleCol, footLen = 0.068, footW = 0.042 }) {
    setLimb(1)
    for (const sign of [-1, 1]) {
      const fx = sign * footX
      const hx = sign * hipX
      loft([
        sec(0.000, footW * 0.96, footLen * 0.96, fx, footZ + 0.012, 0.86),
        sec(0.015, footW * 1.02, footLen * 1.00, fx, footZ + 0.012, 0.94)
      ], soleCol, 16, 0.76)
      loft([
        sec(0.013, footW * 0.98, footLen * 0.97, fx, footZ + 0.012, 0.96),
        sec(0.030, footW * 0.92, footLen * 0.88, fx, footZ + 0.009, 1.0),
        sec(0.048, footW * 0.82, footLen * 0.64, fx, footZ + 0.001, 0.98),
        sec(0.066, ankleR * 0.94, ankleR * 0.98, fx, -0.002, 0.94)
      ], shoeCol, 16, 0.82)
      const kneeY = hipY * 0.54
      loft([
        sec(0.056, ankleR * 1.02, ankleR * 1.05, fx, -0.002, 0.92),
        sec(lerp(0.06, kneeY, 0.45), calfR, calfR * 1.05, lerp(fx, hx, 0.25), -0.002, 0.97),
        sec(kneeY, calfR * 1.06, calfR * 1.12, lerp(fx, hx, 0.55), 0.003, 0.99),
        sec(lerp(kneeY, hipY, 0.55), thighR * 0.96, thighR * 1.02, lerp(fx, hx, 0.82), 0.001, 0.99),
        sec(hipY + 0.028, thighR * 0.94, thighR * 1.00, hx, -0.002, 0.93)
      ], pantsCol, 16, 0.88)
    }
  }

  function addArms({ shY, elbowY, wristY, shX, elbowX, wristX, armR = 0.032, sleeveCol }) {
    setLimb(2)
    for (const sign of [-1, 1]) {
      const sx = sign * shX
      const ex = sign * elbowX
      const wx = sign * wristX
      const ez = sign < 0 ? 0.005 : -0.006
      const wz = sign < 0 ? 0.044 : 0.020

      addEllipsoid(sx - sign * 0.005, shY - 0.006, -0.001, armR * 1.08, armR * 1.12, armR * 1.15, sleeveCol, 14, 8, 0, 0, 0, () => 0.98)
      addChain([
        { x: sx, y: shY, z: -0.001, rx: armR * 1.02, rz: armR * 1.08, ao: 0.97 },
        { x: ex, y: elbowY, z: ez, rx: armR * 0.88, rz: armR * 0.92, ao: 0.99 },
        { x: wx + sign * 0.002, y: wristY + 0.020, z: wz - 0.008, rx: armR * 0.72, rz: armR * 0.76, ao: 0.95 }
      ], sleeveCol, 14, true)

      const handY = wristY - 0.010
      const handZ = wz + 0.006
      addEllipsoid(wx, handY, handZ, armR * 0.44, armR * 0.72, armR * 0.58, PAL.skin, 12, 8, -0.18, 0, sign * 0.06, () => 0.98)
      addEllipsoid(wx - sign * armR * 0.34, handY + armR * 0.16, handZ + armR * 0.34, armR * 0.22, armR * 0.36, armR * 0.24, PAL.skinWarm, 10, 6, 0.35, 0, -sign * 0.35)

      if (sign < 0) {
        const px = wx + armR * 0.48
        const py = handY + 0.008
        const pz = handZ + 0.010
        addRoundedBox(px, py, pz, 0.017, 0.032, 0.0038, 0.0022, PAL.deviceBody, -0.34, 1.02, 0.06)
        addRoundedBox(px + 0.0020, py + 0.0010, pz + 0.0012, 0.0135, 0.026, 0.0014, 0.0012, PAL.deviceScreen, -0.34, 1.02, 0.06)
      }
    }
  }

  function buildGeometry() {
    const geometry = new BufferGeometry()
    geometry.setIndex(indices)
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new Uint8BufferAttribute(colors, 3, true))
    geometry.setAttribute('aStaffSurface', new Uint8BufferAttribute(surfaces, 4))
    geometry.computeVertexNormals()
    geometry.computeBoundingBox()
    geometry.boundingBox.min.z = Math.min(geometry.boundingBox.min.z, -0.24)
    geometry.boundingBox.max.z = Math.max(geometry.boundingBox.max.z, 0.24)
    geometry.computeBoundingSphere()
    geometry.boundingSphere.radius += 0.05
    return geometry
  }

  return {
    setLimb,
    loft,
    shell,
    addChain,
    addEllipsoid,
    addRoundedBox,
    addUniformTorso,
    addLegs,
    addArms,
    buildGeometry
  }
}

/** 绘制硬朗巡防男女通用面部贴图（左男右女，对应头前曲面 yMin=0.742..yMax=0.916 映射）。 */
function createPatrolFaceAtlas() {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const angMax = SPEC_PATROL.faceMapCfg.angleSpan * 0.5
  const paintHalf = (female) => {
    const cx = female ? 768 : 256
    const px = (ang) => cx + (ang / angMax) * 256
    const py = (vNorm) => 512 * (1 - vNorm)
    const sx = (dAng) => (dAng / angMax) * 256
    const sy = (dv) => dv * 512

    // 轻暖腮红（位于外眼角下方）
    const blushAlpha = female ? 0.14 : 0.08
    for (const sign of [-1, 1]) {
      const bx = px(sign * 0.40)
      const by = py(0.32)
      const br = sx(0.13)
      const g = ctx.createRadialGradient(bx, by, 1, bx, by, br)
      g.addColorStop(0, `rgba(242, 126, 118, ${blushAlpha})`)
      g.addColorStop(1, 'rgba(242, 126, 118, 0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.ellipse(bx, by, br, sy(0.055), 0, 0, TAU)
      ctx.fill()
    }

    // 双眼与短眉（清晰位于帽檐 0.870 下方，保持眼高 > 鼻高 > 嘴高）
    for (const sign of [-1, 1]) {
      const eyeAng = sign * 0.30
      const eyeV = 0.42
      const browV = 0.54

      ctx.save()
      ctx.strokeStyle = female ? '#3a2b27' : '#2b201d'
      ctx.lineWidth = 6.6
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(px(eyeAng - sign * 0.105), py(browV - 0.008))
      ctx.quadraticCurveTo(px(eyeAng), py(browV + (female ? 0.024 : 0.018)), px(eyeAng + sign * 0.108), py(browV - 0.012))
      ctx.stroke()
      ctx.restore()

      const ex = px(eyeAng)
      const ey = py(eyeV)
      ctx.fillStyle = '#1d1715'
      ctx.beginPath()
      ctx.ellipse(ex, ey, sx(0.066), sy(0.055), 0, 0, TAU)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.92)'
      ctx.beginPath()
      ctx.arc(ex - sx(0.018), ey - sy(0.014), sx(0.018), 0, TAU)
      ctx.fill()
    }

    // 鼻头柔暖晕染（与 y=0.794 处 3D 鼻球对齐）
    const ny = py(0.30)
    const ng = ctx.createRadialGradient(px(0), ny, 1, px(0), ny, sx(0.048))
    ng.addColorStop(0, 'rgba(208, 126, 102, 0.28)')
    ng.addColorStop(1, 'rgba(208, 126, 102, 0)')
    ctx.fillStyle = ng
    ctx.beginPath()
    ctx.ellipse(px(0), ny, sx(0.048), sy(0.026), 0, 0, TAU)
    ctx.fill()

    // 温和微笑弧线（位于鼻子下方 y=0.775）
    const my = py(0.19)
    const mw = sx(0.108)
    ctx.save()
    ctx.strokeStyle = female ? 'rgba(176, 86, 82, 0.88)' : 'rgba(148, 86, 74, 0.86)'
    ctx.lineWidth = 4.6
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(px(0) - mw, my - sy(0.010))
    ctx.quadraticCurveTo(px(0), my + sy(0.026), px(0) + mw, my - sy(0.010))
    ctx.stroke()
    ctx.restore()
  }

  paintHalf(false)
  paintHalf(true)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  return tex
}

/** 生成「硬朗巡防」网格员 3D 人物几何体（高度归一化 0..1 米）。 */
export function createStaffAvatarGeometry(gender = 'male') {
  const female = gender === 'female'
  const b = createSculptBuilder()
  const sh = female ? 0.92 : 1.0

  // 1. 执勤裤与防滑战靴
  b.addLegs({
    hipY: 0.415,
    hipX: female ? 0.055 : 0.058,
    footX: 0.061,
    footZ: 0.012,
    thighR: 0.055,
    calfR: 0.043,
    ankleR: 0.035,
    pantsCol: PAL.patrolPants,
    shoeCol: PAL.patrolBoot,
    soleCol: PAL.belt,
    footLen: 0.068,
    footW: 0.042
  })

  // 2. 藏蓝执勤长袖 + 青绿双色安全反光马甲 + 右侧执勤腰包
  const coatProfile = [
    sec(0.402, 0.098 * sh, 0.065, 0, -0.003, 0.91),
    sec(0.440, 0.110 * sh, 0.072, 0, -0.003, 0.96),
    sec(0.505, 0.105 * sh, 0.068, 0, -0.002, 0.99),
    sec(0.568, (female ? 0.094 : 0.104) * sh, 0.067, 0, 0.000, 1.0),
    sec(0.625, 0.115 * sh, 0.072, 0, 0.002, 1.01),
    sec(0.668, 0.120 * sh, 0.070, 0, 0.001, 1.0),
    sec(0.698, 0.108 * sh, 0.058, 0, -0.002, 0.98),
    sec(0.714, 0.054, 0.044, 0, -0.001, 0.95)
  ]
  b.addUniformTorso({
    coatProfile,
    coatExp: 0.78,
    vBottomY: 0.602,
    topY: 0.714,
    yokeY: 0.648,
    vestCol: PAL.patrolVest,
    yokeCol: PAL.patrolHiVis,
    bindingCol: PAL.binding,
    reflectCol: PAL.reflector,
    beltY: 0.408,
    pantsCol: PAL.patrolPants,
    shirtCol: PAL.patrolShirt,
    shirtShadeCol: PAL.patrolShirtShade,
    neckR: 0.032,
    collarY: 0.722,
    isFemale: female
  })
  b.addRoundedBox(0.098 * sh, 0.404, 0.012, 0.018, 0.022, 0.015, 0.003, PAL.belt, 0, 0.12, 0)

  // 3. 长袖执勤臂与亮屏终端
  b.addArms({
    shY: 0.658,
    elbowY: 0.526,
    wristY: 0.404,
    shX: 0.121 * sh,
    elbowX: female ? 0.140 : 0.152,
    wristX: female ? 0.127 : 0.139,
    armR: 0.032,
    sleeveCol: PAL.patrolShirt
  })

  // 4. 颈部与头部
  b.setLimb(0)
  b.loft([
    sec(0.712, 0.031, 0.031, 0, 0.001, 0.94),
    sec(0.738, 0.030, 0.030, 0, 0.004, 0.97),
    sec(0.764, 0.034, 0.035, 0, 0.006, 0.96)
  ], PAL.skin, 18, 0.96)

  const headW = female ? 0.084 : 0.088
  const headD = female ? 0.080 : 0.083
  const headZ = 0.007
  const headY = 0.856

  b.setLimb(female ? 4 : 3)
  b.addEllipsoid(
    0, headY, headZ,
    headW, 0.114, headD,
    (j) => (j <= 2 ? PAL.skinShade : PAL.skin),
    28, 14, -0.02, 0, 0,
    (_j, _i, pt) => (pt[1] > 0.892 ? 0.90 : pt[1] < 0.785 ? 0.93 : 1.0)
  )
  // 鼻梁自然坐落于双眼(0.815)与微笑唇线(0.775)之间
  b.addEllipsoid(0, 0.794, headZ + headD * 0.845, 0.0065, 0.0075, 0.0065, PAL.skinWarm, 10, 6)
  for (const sign of [-1, 1]) {
    b.addEllipsoid(sign * (headW + 0.003), 0.836, headZ - 0.002, 0.010, 0.018, 0.011, PAL.skinShade, 10, 8)
  }

  // 5. 帽下贴合发边 + 立体巡防鸭舌帽（女款马尾穿过帽后孔）
  b.setLimb(0)
  b.addEllipsoid(0, 0.876, headZ - headD * 0.18, headW * 1.02, 0.072, headD * 1.02, PAL.hairInk, 22, 10)
  for (const sign of [-1, 1]) {
    b.addEllipsoid(sign * headW * 0.94, 0.848, headZ + headD * 0.06, 0.007, 0.030, headD * 0.24, PAL.hairInk, 10, 7)
  }

  b.addEllipsoid(0, 0.904, headZ - 0.004, headW * 1.08, 0.068, headD * 1.11, (j) => (j < 4 ? PAL.patrolCapBrim : PAL.patrolCap), 26, 12, -0.04, 0, 0)
  b.addEllipsoid(0, 0.972, headZ - 0.010, 0.009, 0.005, 0.009, PAL.patrolCapBrim, 10, 6)
  b.addRoundedBox(0, 0.916, headZ + headD * 1.07, 0.015, 0.015, 0.0030, 0.002, PAL.clip, -0.14, 0, 0)
  b.addRoundedBox(0, 0.916, headZ + headD * 1.09, 0.010, 0.010, 0.0022, 0.0014, PAL.patrolBadge, -0.14, 0, 0)

  const brimRings = []
  const brimSteps = 12
  for (const [rScale, yOff, zOff, ao] of [
    [0.98, 0.886, 0.0, 0.90],
    [1.34, 0.878, 0.026, 0.97],
    [1.54, 0.870, 0.042, 1.0]
  ]) {
    const ring = []
    for (let i = 0; i <= brimSteps; i++) {
      const ang = lerp(-1.16, 1.16, i / brimSteps)
      const curveDip = 0.007 * (1 - Math.abs(ang) / 1.16)
      ring.push([
        Math.sin(ang) * headW * 1.04 * (0.85 + 0.15 * rScale),
        yOff + curveDip,
        headZ + Math.cos(ang) * headD * 1.05 + zOff * Math.pow(Math.cos(ang * 0.72), 1.4)
      ])
    }
    brimRings.push({ ring, ao })
  }
  const brimShell = []
  const brimAo = []
  for (const layer of [
    { offY: -0.0032, pts: brimRings[0].ring, ao: 0.86 },
    { offY: -0.0036, pts: brimRings[1].ring, ao: 0.90 },
    { offY: -0.0022, pts: brimRings[2].ring, ao: 0.96 },
    { offY: 0.0026, pts: brimRings[2].ring, ao: 1.02 },
    { offY: 0.0030, pts: brimRings[1].ring, ao: 1.0 },
    { offY: 0.0026, pts: brimRings[0].ring, ao: 0.95 }
  ]) {
    brimShell.push(layer.pts.map(([x, y, z]) => [x, y + layer.offY, z]))
    brimAo.push(layer.ao)
  }
  b.shell(brimShell, PAL.patrolCapBrim, false, (j) => brimAo[j])

  if (female) {
    const px = 0.0, py = 0.868, pz = headZ - headD * 1.00
    b.addEllipsoid(px, py, pz, 0.019, 0.017, 0.017, PAL.hairTie, 12, 8, 0.4, 0, 0)
    b.addChain([
      { x: px, y: py, z: pz - 0.004, rx: 0.018, rz: 0.018, ao: 0.95 },
      { x: 0.006, y: py - 0.032, z: pz - 0.032, rx: 0.027, rz: 0.028, ao: 1.0 },
      { x: 0.012, y: py - 0.080, z: pz - 0.038, rx: 0.024, rz: 0.025, ao: 0.98 },
      { x: 0.018, y: py - 0.122, z: pz - 0.026, rx: 0.013, rz: 0.015, ao: 0.94 }
    ], PAL.hairMid, 14, true)
  }

  return b.buildGeometry()
}

/** aStridePhase 由实例提供，单位弧度；负值保持站姿。uLift 可在昼夜切换时直接更新。 */
export function createStaffAvatarMaterial() {
  const material = new MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: SPEC_PATROL.baseRoughness,
    metalness: SPEC_PATROL.baseMetalness
  })

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
  const faceMap = createPatrolFaceAtlas()

  material.addEventListener('dispose', () => {
    vestPrint.dispose()
    faceMap.dispose()
  })

  const uLift = { value: 0.12 }
  material.userData.uLift = uLift

  const legPivotY = SPEC_PATROL.legPivotY.toFixed(4)
  const armPivotY = SPEC_PATROL.armPivotY.toFixed(4)
  const backY = SPEC_PATROL.backPrintY.toFixed(4)
  const backW = SPEC_PATROL.backPrintW.toFixed(4)
  const backH = SPEC_PATROL.backPrintH.toFixed(4)
  const backZ = SPEC_PATROL.backPrintZ.toFixed(4)
  const backTint = SPEC_PATROL.backPrintTint
  const faceCfg = SPEC_PATROL.faceMapCfg

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
            float pivotY = ${legPivotY};
            float pivotZ = -0.002;
            float t = clamp((pivotY - p.y) / ${legPivotY}, 0.0, 1.0);
            float hipAng = -phase * 0.36 * smoothstep(0.0, 0.16, t);
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
            float pivotY = ${armPivotY};
            float pivotZ = -0.001;
            float span = max(0.08, ${armPivotY} - 0.25);
            float t = clamp((pivotY - p.y) / span, 0.0, 1.0);
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
        vVestPrint = vec3(0.5 - position.x / ${backW}, 0.5 + (position.y - ${backY}) / ${backH},
          step(position.z, ${backZ}) * step(aStaffSurface.x, 0.5));`)
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
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${backTint[0]}, ${backTint[1]}, ${backTint[2]}), 0.94 * inkAlpha);
        }
        if (vFaceGender > 2.5 && vHeadLocal.z > ${faceCfg.zMin.toFixed(4)}) {
          bool isFemale = vFaceGender > 3.5;
          float ang = atan(vHeadLocal.x, max(0.001, vHeadLocal.z - ${faceCfg.centerZ.toFixed(4)}));
          float uLocal = 0.5 + ang / ${faceCfg.angleSpan.toFixed(4)};
          float vLocal = (vHeadLocal.y - ${faceCfg.yMin.toFixed(4)}) / ${(faceCfg.yMax - faceCfg.yMin).toFixed(4)};
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
        float rim = pow(clamp(1.0 - abs(dot(normalize(normal), viewDir)), 0.0, 1.0), 2.5);
        vec3 rimTint = mix(vec3(0.98, 0.96, 0.92), vec3(0.74, 0.88, 0.98), nightFactor);
        float skinWarmth = vFaceGender > 2.5 ? mix(0.11, 0.16, nightFactor) : 0.0;
        totalEmissiveRadiance += diffuseColor.rgb * (uStaffLift * vStaffLightResponse * 0.62 + skinWarmth);
        totalEmissiveRadiance += rimTint * rim * mix(0.11, 0.30, nightFactor);`)
      .replace('#include <opaque_fragment>', `
        outgoingLight = mix(outgoingLight, vec3(dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722))) * 0.72, vStaffFade.y * 0.80);
        #include <opaque_fragment>`)
  }

  material.customProgramCacheKey = () => 'cockpit-staff-patrol-v1'
  return material
}
