import { BufferGeometry, CanvasTexture, Color, Float32BufferAttribute, MeshLambertMaterial, Uint8BufferAttribute, Vector3 } from 'three'

const paint = {
  vest: 0x31556b, yoke: 0x416980, binding: 0x253e51, seam: 0x718897,
  reflector: 0xc7d7cf, shirt: 0xe8e4d8, cuff: 0xf3ede1, shirtShade: 0xc9c6b8,
  pants: 0x354653, boots: 0x374149, sole: 0x242e35,
  card: 0xf1e9d8, cardInk: 0x587e89, clip: 0xa5b2b0,
  skin: 0xe5b18b, innerEar: 0xc68d70, lip: 0xa5645c, lowerLip: 0xd5937c,
  eye: 0xe7d7c5, iris: 0x564032, pupil: 0x312927, lid: 0x674a3e,
  hair: 0x403432, hairTie: 0x293d49, cover: 0x456862, paper: 0xd7d1b9
}

// 同一个实例材质用顶点色区分面料，夜间只给反光条、浅色衣料和肤色补光。
const nightResponse = new Map([
  [paint.reflector, 255], [paint.card, 218], [paint.skin, 181], [paint.shirt, 164],
  [paint.cuff, 164], [paint.vest, 174], [paint.yoke, 178], [paint.eye, 136]
])

const circle = Math.PI * 2
const rounded = (value, exponent) => Math.sign(value) * Math.abs(value) ** exponent

// 横截面从脚向上排列，宽、深为半径。曲面和贴在衣服、脸上的细节共用同一截面。
function section(y, width, depth, x = 0, z = 0) {
  return { y, width, depth, x, z }
}

function atHeight(profile, y) {
  if (y <= profile[0].y) return profile[0]
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1], b = profile[i]
    if (y > b.y) continue
    const t = (y - a.y) / (b.y - a.y)
    return section(y, a.width + (b.width - a.width) * t, a.depth + (b.depth - a.depth) * t,
      a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)
  }
  return profile[profile.length - 1]
}

function ringPoint(s, angle, exponent = 1) {
  return [s.x + s.width * rounded(Math.sin(angle), exponent), s.y,
    s.z + s.depth * rounded(Math.cos(angle), exponent)]
}

// 将衣片裁在它覆盖的外套三角面内，陡峭的肩线和翻领也能整片贴住。
function garmentSurface(profile, side, segments, exponent) {
  const rings = profile.map(s => Array.from({ length: segments }, (_, i) => ringPoint(s, i * circle / segments, exponent)))
  const normals = new Map()
  const tangent = new Vector3(), vertical = new Vector3(), origin = new Vector3()
  rings.forEach((ring, j) => ring.forEach((p, i) => {
    tangent.fromArray(ring[(i + 1) % segments]).sub(origin.fromArray(ring[(i + segments - 1) % segments]))
    vertical.fromArray(rings[Math.min(rings.length - 1, j + 1)][i]).sub(origin.fromArray(rings[Math.max(0, j - 1)][i]))
    normals.set(p, new Vector3().crossVectors(tangent, vertical).normalize())
  }))
  const faces = []
  const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
  function add(a, b, c) {
    const area = cross(a, b, c)
    if (side * area < 1e-8) return
    faces.push({ corners: [a, b, c], area,
      minX: Math.min(a[0], b[0], c[0]), maxX: Math.max(a[0], b[0], c[0]),
      minY: Math.min(a[1], b[1], c[1]), maxY: Math.max(a[1], b[1], c[1]) })
  }
  for (let j = 1; j < rings.length; j++) {
    const lo = rings[j - 1], hi = rings[j]
    for (let i = 0; i < segments; i++) {
      const n = (i + 1) % segments
      add(lo[i], lo[n], hi[i])
      add(lo[n], hi[n], hi[i])
    }
  }
  return { lay(points, offset, draw) {
    const xs = points.map(p => p[0]), ys = points.map(p => p[1])
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    for (const { corners, area, minX: left, maxX: right, minY: low, maxY: high } of faces) {
      if (maxX <= left || minX >= right || maxY <= low || minY >= high) continue
      let poly = points
      for (let i = 0; i < 3 && poly.length; i++) {
        const a = corners[i], b = corners[(i + 1) % 3], clipped = []
        let last = poly[poly.length - 1], from = cross(a, b, last) * side
        for (const p of poly) {
          const to = cross(a, b, p) * side
          if ((from < 0) !== (to < 0)) {
            const t = from / (from - to)
            clipped.push([last[0] + (p[0] - last[0]) * t, last[1] + (p[1] - last[1]) * t])
          }
          if (to >= 0) clipped.push(p)
          last = p
          from = to
        }
        poly = clipped
      }
      if (poly.length < 3) continue
      const [a, b, c] = corners
      draw(poly, (x, y) => {
        const p = [x, y]
        return [x, y, (cross(b, c, p) * a[2] + cross(c, a, p) * b[2] + cross(a, b, p) * c[2]) / area + side * offset]
      }, (x, y) => {
        const p = [x, y]
        return new Vector3().addScaledVector(normals.get(a), cross(b, c, p) / area)
          .addScaledVector(normals.get(b), cross(c, a, p) / area)
          .addScaledVector(normals.get(c), cross(a, b, p) / area).normalize()
      })
    }
  } }
}

/** 正面 +Z，脚底 y=0、发顶 y=1。aStaffSurface 保存肢体类型与夜间补光强度。 */
export function createStaffAvatarGeometry(gender = 'male') {
  const female = gender === 'female'
  const positions = [], colors = [], surfaces = [], indices = []
  const panelNormals = []
  const palette = new Map()
  let limb = 0 // 0 躯干，1 腿，2 臂；同一实例内按巡查步幅驱动。

  function vertex(point, color) {
    let rgb = palette.get(color)
    if (!rgb) {
      const tint = new Color(color)
      rgb = [tint.r, tint.g, tint.b].map(v => Math.round(v * 255))
      palette.set(color, rgb)
    }
    const index = positions.length / 3
    positions.push(...point)
    colors.push(...rgb)
    surfaces.push(limb, nightResponse.get(color) ?? 88)
    return index
  }

  // 同一圈左右共用顶点，肤色与布料有连续法线；鞋底、领片等独立面保留折边。
  function shell(rings, color, closed = true) {
    const count = rings[0].length
    const shade = typeof color === 'function' ? color : () => color
    const rows = rings.map((ring, j) => ring.map((point, i) => vertex(point, shade(j, i))))
    for (let j = 1; j < rows.length; j++) {
      for (let i = 0; i < count; i++) {
        const n = (i + 1) % count, lo = rows[j - 1], hi = rows[j]
        indices.push(lo[i], lo[n], hi[i], lo[n], hi[n], hi[i])
      }
    }
    if (!closed) return
    for (const end of [0, rows.length - 1]) {
      const pts = rings[end], rim = pts.map((point, i) => vertex(point, shade(end, i)))
      const center = [0, 0, 0]
      pts.forEach(p => p.forEach((v, axis) => { center[axis] += v / count }))
      const c = vertex(center, shade(end, 0))
      for (let i = 0; i < count; i++) {
        const n = (i + 1) % count
        if (end === 0) indices.push(c, rim[n], rim[i])
        else indices.push(c, rim[i], rim[n])
      }
    }
  }

  function loft(profile, color, count = 10, exponent = 1) {
    shell(profile.map(s => Array.from({ length: count }, (_, i) => ringPoint(s, i * circle / count, exponent))), color)
  }

  function surface(profile, exponent = 1, side = 1) {
    return (x, y, offset = 0) => {
      const s = atHeight(profile, y)
      const u = Math.min(1, Math.abs((x - s.x) / s.width))
      const depth = (1 - u ** (2 / exponent)) ** (exponent / 2)
      return [x, y, s.z + side * (s.depth * depth + offset)]
    }
  }

  // 衣片与五官按实际曲面投影。小片独立着色，不增加材质或绘制批次。
  function patch(points, project, color, offset = 0.0008, side = 1, normalAt) {
    if (project.lay) {
      project.lay(points, offset, (polygon, onFace, normal) => patch(polygon, onFace, color, 0, side, normal))
      return
    }
    const area = points.reduce((sum, [x, y], i) => {
      const next = points[(i + 1) % points.length]
      return sum + x * next[1] - next[0] * y
    }, 0)
    if (Math.abs(area) < 1e-11) return
    const order = points.map(([x, y]) => {
      const index = vertex(project(x, y, offset), color)
      if (normalAt) panelNormals.push([index, normalAt(x, y)])
      return index
    })
    if (area * side < 0) order.reverse()
    for (let i = 1; i < order.length - 1; i++) indices.push(order[0], order[i], order[i + 1])
  }

  // 每个采样为 [x, 下沿高度, 上沿高度]，使宽胸带和细眼睑都服帖于底面。
  function ribbon(samples, project, color, offset, side = 1) {
    for (let i = 1; i < samples.length; i++) {
      const [x, lo, hi] = samples[i - 1], [nx, nlo, nhi] = samples[i]
      patch([[x, lo], [nx, nlo], [nx, nhi], [x, hi]], project, color, offset, side)
    }
  }

  const shoulders = female ? 0.92 : 1
  for (const sign of [-1, 1]) {
    const hip = sign * 0.055, foot = sign * 0.065, rest = sign * 0.036
    limb = 1
    loft([
      section(0, .043, .072, foot, rest + .017),
      section(.012, .045, .074, foot, rest + .017)
    ], paint.sole, 10, .74)
    loft([
      section(.010, .044, .072, foot, rest + .017), section(.025, .043, .070, foot, rest + .018),
      section(.043, .039, .050, foot, rest + .004), section(.061, .034, .036, foot, rest - .001)
    ], paint.boots, 10, .80)
    loft([
      section(.052, .036, .040, foot, rest), section(.084, .037, .041, foot, rest - .002),
      section(.195, .045, .047, foot - sign * .002, rest * .67 - .002),
      section(.251, .045, .049, hip + sign * .007, rest * .52 + .007),
      section(.350, .054, .060, hip + sign * .002, rest * .26),
      section(.464, .062, .068, hip, -.003)
    ], paint.pants, 10, .88)

    limb = 2
    const hand = sign * (sign < 0 ? .138 : .151) * shoulders, elbow = sign * .162 * shoulders
    loft([
      section(.410, .009, .013, hand - sign * .003, -rest + .015),
      section(.426, .017, .023, hand, -rest + .013),
      section(.451, .018, .026, hand + sign * .002, -rest + .007),
      section(.475, .016, .019, hand, -rest + .002),
      section(.548, .024, .028, elbow, -rest * .52 - .009)
    ], paint.skin, 10)
    loft([
      section(.433, .006, .008, hand - sign * .009, -rest + .033),
      section(.449, .009, .011, hand - sign * .012, -rest + .030),
      section(.463, .010, .011, hand - sign * .010, -rest + .020)
    ], paint.skin, 8)
    if (sign < 0) {
      // 薄巡查记录夹贴着手掌，拇指压住封面，随同一只手自然摆动。
      const corners = [[-.042, -.0038], [.042, -.0038], [.042, .0038], [-.042, .0038]]
      const pageRing = y => corners.map(([along, across]) => [
        hand - .013 + along * .82 + across * .572, y + along * .10,
        -rest + .035 + along * .572 - across * .82 + (.447 - y) * .14
      ])
      const lower = pageRing(.332), upper = pageRing(.445)
      for (let i = 0; i < 4; i++) {
        const n = (i + 1) % 4
        const sideColor = i === 1 ? paint.paper : paint.cover
        const [a, b, c, d] = [lower[i], lower[n], upper[n], upper[i]].map(p => vertex(p, sideColor))
        indices.push(a, b, c, a, c, d)
      }
      const pages = upper.map(p => vertex(p, paint.paper)), bottom = lower.map(p => vertex(p, paint.cover))
      indices.push(pages[0], pages[1], pages[2], pages[0], pages[2], pages[3], bottom[0], bottom[2], bottom[1], bottom[0], bottom[3], bottom[2])
    }
    loft([
      section(.526, .025, .029, elbow, -rest * .60), section(.553, .029, .031, elbow, -rest * .45 - .004),
      section(.581, .032, .034, elbow + sign * .001, -rest * .40 - .010)
    ], paint.cuff, 10)
    loft([
      section(.554, .028, .031, elbow, -rest * .5 - .004),
      section(.606, .035, .036, elbow, -rest * .30 - .012),
      section(.680, .038, .043, sign * .146 * shoulders, -.008),
      section(.727, .044, .051, sign * .133 * shoulders, -.002),
      section(.749, .032, .044, sign * .128 * shoulders, -.001),
      section(.759, .013, .030, sign * .115 * shoulders, 0)
    ], paint.shirt, 12)
  }
  limb = 0

  const coat = [
    section(.454, .103, .065, 0, -.005), section(.468, .114, .071, 0, -.005),
    section(.523, .111, .069, 0, -.004), section(.584, female ? .096 : .104, .067),
    section(.663, .126, .075, 0, .002), section(.721, .133, .074),
    section(.750, .127, .064, 0, -.003), section(.767, .101, .054, 0, -.003),
    section(.779, .047, .041, 0, -.002)
  ].map(s => ({ ...s, width: s.width * shoulders }))
  loft(coat, paint.vest, 20, .80)
  const front = garmentSurface(coat, 1, 20, .80), back = garmentSurface(coat, -1, 20, .80)
  const w = shoulders
  for (const side of [1, -1]) {
    const project = side === 1 ? front : back
    const strip = []
    for (let i = -4; i <= 4; i++) {
      const x = i / 4, y = (side === 1 ? .698 : .687) + .010 * Math.abs(x)
      strip.push([x * .117 * w, y, y + .006])
    }
    if (side === -1) {
      ribbon(strip.map(([x, y]) => [x, y + .006, .751]), back, paint.yoke, .0010, -1)
      ribbon(strip, back, paint.reflector, .0016, -1)
    } else {
      for (const band of [strip.slice(0, 4), strip.slice(5)]) {
        ribbon(band.map(([x, y]) => [x, y + .006, .747]), project, paint.yoke, .0010)
        ribbon(band, project, paint.reflector, .0016)
      }
    }
  }

  // 开领浅衬衫、布面包边、中缝拉链与平贴证件夹。
  for (const sign of [-1, 1]) {
    const strip = [[0, .686], [.018 * sign, .720], [.040 * sign, .753], [.048 * sign, .774]]
    for (let i = 1; i < strip.length; i++) {
      const [x, y] = strip[i - 1], [nx, ny] = strip[i]
      patch([[0, y], [x, y], [nx, ny], [0, ny]], front, paint.shirt, .0017)
      patch([[x, y], [x + .005 * sign, y], [nx + .005 * sign, ny], [nx, ny]], front, paint.binding, .0024)
    }
    const pocket = [[.052, .512, .516], [.074, .532, .537], [.093, .548, .554]]
    ribbon(pocket.map(([x, lo, hi]) => [x * sign * w, lo, hi]), front, paint.binding, .0016)
  }
  patch([[-.027, .779], [.027, .779], [0, .743]], front, paint.skin, .0023)
  for (const sign of [-1, 1]) {
    patch([[sign * .024, .778], [sign * .051, .762], [sign * .039, .738], [sign * .014, .751]],
      front, paint.shirtShade, .0027)
    patch([[sign * .024, .778], [sign * .049, .763], [sign * .038, .741], [sign * .014, .753]],
      front, paint.cuff, .0033)
  }
  for (let i = 1; i < coat.length && coat[i - 1].y < .686; i++) {
    const a = coat[i - 1].y, b = Math.min(.686, coat[i].y)
    patch([[-.003, a], [.003, a], [.003, b], [-.003, b]], front, paint.binding, .0014)
    patch([[-.0008, a], [.0008, a], [.0008, b], [-.0008, b]], front, paint.seam, .0017)
  }
  patch([[.035, .650], [.071, .650], [.071, .678], [.035, .678]], front, paint.card, .0020)
  patch([[.038, .655], [.047, .655], [.047, .668], [.038, .668]], front, paint.cardInk, .0025)
  ribbon([[.051, .664, .666], [.066, .664, .666]], front, paint.seam, .0026)
  patch([[.049, .674], [.058, .674], [.058, .682], [.049, .682]], front, paint.clip, .0028)

  loft([
    section(.753, .031, .031, 0, .001), section(.776, .031, .032, 0, .003),
    section(.802, .029, .032, 0, .007), section(.825, .037, .039, 0, .008)
  ], paint.skin, 14)

  const fw = female ? .95 : 1
  const head = [
    section(.803, female ? .014 : .022, .023, 0, .026), section(.812, female ? .032 : .040, .038, 0, .021),
    section(.827, female ? .047 : .055, .049, 0, .016), section(.841, female ? .053 : .061, .058, 0, .011),
    section(.858, female ? .063 : .067, .066, 0, .009), section(.872, .071, .070, 0, .007),
    section(.885, .073, .071, 0, .005), section(.901, .073, .070, 0, .004),
    section(.912, .073, .071, 0, .002),
    section(.930, .072, .070, 0, .001), section(.952, .067, .066, 0, -.001),
    section(.970, .051, .055, 0, -.004), section(.983, .025, .029, 0, -.004)
  ].map(s => ({ ...s, width: s.width * fw }))
  // 颧骨、眼窝和下巴直接起在头部曲面上，表情随光向与镜头角度自然变化。
  function faceDepth(x, y) {
    const bump = (cx, cy, rx, ry) => Math.exp(-(((Math.abs(x) - cx) / rx) ** 2 + ((y - cy) / ry) ** 2))
    return .0055 * bump(.042, .868, .021, .014) - .0042 * bump(.027, .888, .016, .009)
      + .0033 * bump(.027, .901, .022, .009) + .0036 * bump(0, .819, .025, .012)
      + .0022 * bump(0, .842, .021, .011)
  }
  const faceBase = surface(head, .95)
  const face = (x, y, offset) => faceBase(x, y, offset + faceDepth(x, y))
  shell(head.map(s => Array.from({ length: 28 }, (_, i) => {
    const a = i * circle / 28, p = ringPoint(s, a, .95)
    if (Math.cos(a) > 0) p[2] += faceDepth(p[0], p[1])
    return p
  })), paint.skin)
  for (const sign of [-1, 1]) {
    const earX = sign * .070 * fw
    loft([section(.851, .003, .005, earX, .002), section(.858, .010, .010, earX, .002),
      section(.875, .012, .012, earX, .001), section(.886, .007, .010, earX, -.001),
      section(.889, .001, .004, earX, -.002)], paint.skin, 10)
    loft([section(.861, .002, .003, sign * .078 * fw, .008),
      section(.871, .004, .007, sign * .078 * fw, .005),
      section(.880, .002, .003, sign * .077 * fw, .003)], paint.innerEar, 8)

    // 杏形眼的内外眼角收尖，上眼睑压住虹膜；眉尾随头部轮廓渐细。
    const eyeY = female ? .888 : .886
    const eyeShape = [[.012, .000, .0006], [.019, -.0023, .0038], [.027, -.0028, female ? .0054 : .0045],
      [.035, -.0014, .0043], [.042, female ? .0024 : .0013, female ? .0030 : .0023]]
    const eyeSamples = eyeShape.map(([x, lo, hi]) => [sign * x * fw, eyeY + lo, eyeY + hi])
    ribbon(eyeSamples, face, paint.eye, .00145)
    const irisX = .026 * fw
    const irisSamples = [[-.0062, -.0008, .0022], [-.0044, -.0024, .0040],
      [.000, -.0028, .0044], [.0044, -.0023, .0041], [.0062, -.0004, .0026]]
    ribbon(irisSamples.map(([x, lo, hi]) => [sign * (irisX + x), eyeY + lo, eyeY + hi]), face, paint.iris, .0020)
    patch([[irisX - .0025, eyeY - .0014], [irisX + .0022, eyeY - .0014],
      [irisX + .0022, eyeY + .003], [irisX - .0025, eyeY + .003]].map(([x, y]) => [sign * x, y]),
    face, paint.pupil, .0023)
    patch([[sign * irisX - .0017, eyeY + .0023], [sign * irisX - .0004, eyeY + .0018],
      [sign * irisX, eyeY + .0034], [sign * irisX - .0013, eyeY + .0037]], face, paint.eye, .0027)
    ribbon(eyeSamples.map(([x, , hi], i) => [x, hi - .0002, hi + (i === 0 || i === 4 ? .0003 : .0013)]),
      face, paint.lid, .0026)
    const browY = eyeY + (female ? .011 : .010)
    const brow = female
      ? [[.012, .000, .0016], [.021, .0022, .0044], [.030, .0039, .0064], [.036, .0041, .0057], [.045, .0011, .0016]]
      : [[.011, .0001, .0020], [.020, .0016, .0050], [.030, .0024, .0061], [.037, .0023, .0051], [.044, .0003, .0010]]
    ribbon(brow.map(([x, a, b]) => [sign * x * fw, browY + a, browY + b]), face, paint.hair, .0016)
  }

  // 鼻梁与鼻翼连续起伏，侧面有清楚的鼻尖，正面以自然光影塑形。
  const nose = [
    [.854, .008, .0018], [.857, .013, .0075], [.862, .012, female ? .012 : .014],
    [.869, .0088, .0096], [.882, .007, .005], [.894, .009, .001]
  ]
  const noseRows = nose.map(([y, width, rise]) => [-1, -.54, 0, .54, 1].map(k =>
    vertex(face(k * width, y, .0004 + (1 - k * k) * rise), paint.skin)))
  for (let j = 1; j < noseRows.length; j++) {
    for (let i = 0; i < 4; i++) {
      const a = noseRows[j - 1], b = noseRows[j]
      indices.push(a[i], a[i + 1], b[i], a[i + 1], b[i + 1], b[i])
    }
  }
  const smile = female ? .8434 : .8425
  const mouth = [[-.018, smile - .0007, smile], [-.010, .8394, .8412], [-.004, .8384, .8419],
    [0, .8383, .8408], [.004, .8384, .8419], [.010, .8394, .8412], [.018, smile - .0007, smile]]
  ribbon(mouth.map(([x, lo]) => [x, lo - .0027 * (1 - Math.abs(x) / .018), lo + .0002]), face, paint.lowerLip, .0010)
  ribbon(mouth, face, paint.lip, .0013)

  // 发际线依次贴合额角、鬓角、耳上和后颈。顶面的偏分从额头转向发旋。
  const hair = [
    section(.845, .060, .062, 0, .008), section(.863, .071, .072, 0, .005),
    section(.894, .076, .077, 0, .002), section(.926, .077, .076, 0, .000),
    section(.948, .075, .074, -.001, -.001), section(.966, female ? .069 : .072, .072, -.004, -.002),
    section(.981, female ? .052 : .060, .059, -.010, -.004), section(.992, female ? .030 : .039, .037, -.014, -.006),
    section(1, .0018, .002, -.016, -.008)
  ].map(s => ({ ...s, width: s.width * fw, x: female ? -s.x * .45 : s.x }))
  const hairline = female
    ? [[0, .949], [.44, .947], [.85, .928], [1.18, .904], [1.33, .878], [1.52, .893], [1.78, .899], [2.22, .870], [Math.PI, .857]]
    : [[0, .934], [.44, .937], [.86, .927], [1.15, .918], [1.32, .874], [1.49, .890], [1.76, .895], [2.26, .869], [Math.PI, .854]]
  // 发束的起伏与明暗直接刻进头发表面，侧面和逆光下都保持连续的轮廓。
  const hairTones = [0x342e2d, 0x393130, 0x3e3330, 0x443832, 0x4a3c35, 0x514039, 0x55433b]
  function strandAt(theta, t) {
    const part = female ? -.28 : .49
    const flow = Math.tanh((part - theta) * 2.6)
    const sweep = flow * (female ? .52 : .75) * Math.sin(t * 1.7) * Math.max(.22, 1 - Math.abs(theta) / 3)
    const u = theta - sweep
    return (.5 + .5 * Math.cos(11 * u + .72 * Math.sin(3 * u + t))) ** 1.35
  }
  function hairAt(angle, t) {
    const theta = Math.atan2(Math.sin(angle), Math.cos(angle))
    const a = Math.abs(theta)
    let i = 1
    while (i < hairline.length - 1 && a > hairline[i][0]) i++
    const [ax, ay] = hairline[i - 1], [bx, by] = hairline[i]
    const sweep = (female ? -.009 : .010) * Math.sin(theta * 2.4) * Math.max(0, 1 - a / 1.6)
    const base = ay + (by - ay) * (a - ax) / (bx - ax) + sweep
    const y = base + (1 - base) * Math.sin(t * Math.PI / 2)
    const point = ringPoint(atHeight(hair, y), theta, .96)
    const lift = .0022 * strandAt(theta, t) * Math.sin(Math.PI * t)
    point[0] += lift * Math.sin(theta)
    point[1] += lift * t * .40
    point[2] += lift * Math.cos(theta)
    return point
  }
  const hairSegments = 48
  const levels = [0, .11, .25, .43, .62, .81, 1]
  const scalp = levels.map(t =>
    Array.from({ length: hairSegments }, (_, i) => hairAt(i * circle / hairSegments, t)))
  // 下沿收进头部以贴住皮肤；顶部小面闭合发旋。
  const roots = scalp[0].map(([x, y, z]) => [x * .94, y + .001, z * .94])
  shell([roots, ...scalp], (j, i) => {
    const t = levels[Math.max(0, j - 1)]
    const angle = i * circle / hairSegments
    const theta = Math.atan2(Math.sin(angle), Math.cos(angle))
    const light = .17 + .57 * strandAt(theta, t) * Math.sin(Math.PI * t) + .16 * t
    return hairTones[Math.round((hairTones.length - 1) * light)]
  })

  // 额前发束从分缝展开，发梢落在皮肤上；短发向一侧扫，扎发从额头向耳后收。
  const hairFront = surface(hair, .96)
  const forelocks = female
    ? [
        [[-.030,.970,.976],[-.012,.955,.972],[.006,.946,.966],[.027,.934,.955],[.044,.921,.941],[.057,.906,.923],[.063,.894,.897]],
        [[-.058,.917,.922],[-.048,.931,.947],[-.039,.944,.958],[-.031,.958,.969],[-.028,.969,.972]]
      ]
    : [
        [[-.057,.914,.918],[-.047,.917,.932],[-.032,.924,.943],[-.014,.935,.960],[.006,.943,.971],[.026,.955,.973],[.036,.965,.967]],
        [[-.051,.912,.914],[-.040,.916,.928],[-.026,.921,.937],[-.011,.931,.946],[.005,.940,.950],[.019,.949,.951]]
      ]
  for (const strand of forelocks) {
    ribbon(strand.map(([x, lo, hi]) => [x * fw, lo, hi]), hairFront, paint.hair, .0016)
  }
  if (female) {
    for (const sign of [-1, 1]) {
      const bottom = sign > 0 ? .855 : .876
      loft([section(bottom, .002, .002, sign * .068 * fw, .033),
        section(bottom + .011, .005, .006, sign * .069 * fw, .035),
        section(.900, .008, .009, sign * .069 * fw, .034),
        section(.919, .009, .011, sign * .065 * fw, .038),
        section(.934, .006, .010, sign * .061 * fw, .039)], paint.hair, 10)
    }
    // 在后颈扎拢，马尾自然垂到衣领一侧，从街区头像与跟拍背面都能辨认。
    loft([
      section(.761, .005, .008, .067, -.083), section(.776, .017, .018, .066, -.097),
      section(.802, .025, .024, .059, -.109), section(.832, .028, .030, .047, -.115),
      section(.855, .021, .023, .032, -.110), section(.869, .016, .020, .023, -.097)
    ], paint.hair, 12)
    loft([section(.860, .019, .021, .025, -.105), section(.871, .021, .023, .021, -.098)],
      paint.hairTie, 12)
    loft([section(.869, .017, .022, .021, -.099), section(.884, .031, .034, .014, -.086),
      section(.904, .030, .031, .007, -.073), section(.918, .014, .018, .006, -.066)], paint.hair, 12)
  }

  const geometry = new BufferGeometry()
  geometry.setIndex(indices)
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new Uint8BufferAttribute(colors, 3, true))
  geometry.setAttribute('aStaffSurface', new Uint8BufferAttribute(surfaces, 2))
  geometry.computeVertexNormals()
  const normal = geometry.getAttribute('normal')
  for (const [index, v] of panelNormals) normal.setXYZ(index, v.x, v.y, v.z)
  geometry.computeBoundingBox()
  geometry.boundingBox.min.z = Math.min(geometry.boundingBox.min.z, -.17)
  geometry.boundingBox.max.z = Math.max(geometry.boundingBox.max.z, .20)
  geometry.computeBoundingSphere()
  geometry.boundingSphere.radius += .025
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
  varying vec3 vVestPrint;

  // xy = 竖向抬升和前后摆幅，zw = 两项对原始顶点高度的导数，用于同步修正光照法线。
  vec4 staffStrideOffset(vec3 p) {
    #ifdef USE_INSTANCING
      if (aStridePhase >= 0.0 && aStaffSurface.x > 0.5) {
        bool leg = aStaffSurface.x < 1.5;
        float side = sign(p.x);
        float phase = side * sin(aStridePhase);
        float swingFoot = max(0.0, side * cos(aStridePhase));
        float span = leg ? 0.405 : 0.283;
        float reach = clamp(((leg ? 0.464 : 0.733) - p.y) / span, 0.0, 1.0);
        float slope = reach > 0.0 && reach < 1.0 ? -1.0 / span : 0.0;
        float sweep = leg ? phase * 0.078 - side * 0.036 : side * 0.036 - phase * 0.060;
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
  // 背心印字由男女实例共用，随衣料受光并通过 mipmap 在远处自然消失。
  const label = document.createElement('canvas')
  label.width = 192
  label.height = 64
  const ink = label.getContext('2d')
  ink.font = '600 50px "PingFang SC", "Microsoft YaHei", sans-serif'
  ink.textAlign = 'center'
  ink.textBaseline = 'middle'
  ink.fillStyle = '#fff'
  ink.fillText('网格员', label.width / 2, label.height / 2)
  const vestPrint = new CanvasTexture(label)
  material.addEventListener('dispose', () => vestPrint.dispose())
  const uLift = { value: 0.12 }
  material.userData.uLift = uLift
  material.onBeforeCompile = shader => {
    shader.uniforms.uStaffLift = uLift
    shader.uniforms.uVestPrint = { value: vestPrint }
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
        vStaffLightResponse = aStaffSurface.y / 255.0;
        vVestPrint = vec3(0.5 - position.x / 0.206, 0.5 + (position.y - 0.645) / 0.065,
          step(position.z, -0.025) * (1.0 - step(0.5, aStaffSurface.x)));`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.yz += stride.xy;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uStaffLift;
        uniform sampler2D uVestPrint;
        varying vec3 vVestPrint;
        varying float vStaffLightResponse;
        varying vec2 vStaffFade;
        float staffBayer2(vec2 p) {
          vec2 bit = mod(floor(p), 2.0);
          return 2.0 * bit.x + 3.0 * bit.y - 4.0 * bit.x * bit.y;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vVestPrint.z > 0.5 && all(lessThan(abs(vVestPrint.xy - 0.5), vec2(0.5)))) {
          float ink = texture2D(uVestPrint, vVestPrint.xy).a;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72, 0.78, 0.77), 0.88 * ink);
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
