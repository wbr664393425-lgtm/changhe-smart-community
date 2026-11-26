import { WORLD_DIV } from './cityModelCache'

// 模型由鞋底 0 建到发顶 1。街区按初版沙盘标记的投影高度切换细节。
export const STAFF_MAP_HEIGHT = 2.65
export const STAFF_GROUND_Y = 0.025 / WORLD_DIV
export const STAFF_AIM_Y = 1.55
export const STAFF_MIN_VIEW_DISTANCE = 3.5
export const STREET_ZOOM = 0.76
const streetTilt = 0.085

const staffViews = {
  inspect: [65, 27],
  low: [52, 38],
  mid: [104, 88]
}

export function getStaffFraming(view, viewportHeight) {
  const [distance, height] = staffViews[view]
  const screenScale = Math.max(0.45, Math.min(1.15, (viewportHeight || 900) / 900))
  return { distance: distance * screenScale, height: STAFF_AIM_Y + (height - STAFF_AIM_Y) * screenScale }
}

const maxPitch = Math.PI / 2 - 0.17 // 留在 OrbitControls 的可用范围内
const shoulderWidth = 1.3
const angles = [0]
for (let i = 1; i <= 16; i++) {
  angles.push(i * Math.PI / 16)
  if (i < 16) angles.push(-i * Math.PI / 16)
}

function angleGap(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
}

function contains(x, z, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j], [bx, bz] = ring[i]
    if ((az > z) !== (bz > z) && x < ax + (bx - ax) * (z - az) / (bz - az)) inside = !inside
  }
  return inside
}

function nearbyRoofs(buildings, person, distance, height) {
  const result = []
  const slope = Math.max(0.01, (height - STAFF_AIM_Y) / distance)
  for (const b of buildings) {
    if (!b || b.pts.length < 3) continue
    const midX = (b.minX + b.maxX) / 2 - person.x, midZ = (b.minZ + b.maxZ) / 2 - person.z
    const halfX = (b.maxX - b.minX) / 2, halfZ = (b.maxZ - b.minZ) / 2
    const dx = Math.max(0, Math.abs(midX) - halfX), dz = Math.max(0, Math.abs(midZ) - halfZ)
    const roof = b.height + 0.05
    const reach = Math.min(distance, roof / slope) + shoulderWidth
    if (dx * dx + dz * dz > reach * reach) continue
    result.push({
      ring: b.pts, midX, midZ, halfX, halfZ, roof,
      coversTarget: dx === 0 && dz === 0 && contains(person.x, person.z, b.pts)
    })
  }
  return result
}

// 从双脚或双肩到相机的整束视线，在地面投影为三角形。楼高将可能遮挡的部分裁成梯形。
function bandVisible(nearby, person, sin, cos, distance, height, halfWidth, targetY) {
  for (const b of nearby) {
    if (b.roof < targetY) continue
    const limit = Math.min(distance, distance * (b.roof - targetY) / (height - targetY))
    const forward = b.midX * sin + b.midZ * cos, side = b.midX * cos - b.midZ * sin
    const depthRadius = Math.abs(sin) * b.halfX + Math.abs(cos) * b.halfZ
    const sideRadius = Math.abs(cos) * b.halfX + Math.abs(sin) * b.halfZ
    if (forward - depthRadius > limit || forward + depthRadius < 0 || Math.abs(side) > sideRadius + halfWidth) continue
    if (b.coversTarget) return false

    const ring = b.ring
    let x = ring[ring.length - 1][0] - person.x, z = ring[ring.length - 1][1] - person.z
    let d0 = x * sin + z * cos, u0 = x * cos - z * sin
    for (const vertex of ring) {
      x = vertex[0] - person.x
      z = vertex[1] - person.z
      const d1 = x * sin + z * cos, u1 = x * cos - z * sin
      if (Math.min(d0, d1) <= limit && Math.max(d0, d1) >= 0) {
        let t0 = 0, t1 = 1
        const dd = d1 - d0
        if (Math.abs(dd) > 1e-8) {
          const enter = -d0 / dd, leave = (limit - d0) / dd
          t0 = Math.max(0, Math.min(enter, leave))
          t1 = Math.min(1, Math.max(enter, leave))
        }
        const left = u0 + (u1 - u0) * t0, right = u0 + (u1 - u0) * t1
        const w0 = halfWidth * (1 - (d0 + dd * t0) / distance)
        const w1 = halfWidth * (1 - (d0 + dd * t1) / distance)
        if (!(left > w0 && right > w1 || left < -w0 && right < -w1)) return false
      }
      d0 = d1
      u0 = u1
    }
  }
  return true
}

export function chooseStaffView(buildingIndex, person, bearing, distance, height, preferred = 0) {
  const current = { offset: preferred, distance, height }
  if (!buildingIndex?.buildings?.length || !person || !(distance > 0) || !(height > STAFF_GROUND_Y + STAFF_MAP_HEIGHT)) return current
  const nearby = nearbyRoofs(buildingIndex.buildings, person, distance, height)
  if (!nearby.length) return current
  const offsets = [preferred, ...angles.filter(offset => angleGap(offset, preferred) > 0.015)]
  const basePitch = Math.atan2(height - STAFF_AIM_Y, distance)
  const radius = Math.hypot(distance, height - STAFF_AIM_Y)
  let best = current, bestQuality = -1, bestCost = Infinity
  for (const extra of [0, 0.13, 0.28, 0.47, 0.70, 0.98, Math.PI / 2]) {
    const pitch = Math.min(maxPitch, basePitch + extra)
    const reach = extra === 0 ? distance : radius * Math.cos(pitch)
    const altitude = extra === 0 ? height : STAFF_AIM_Y + radius * Math.sin(pitch)
    for (const offset of offsets) {
      const cost = (pitch - basePitch) * 2.2 + angleGap(offset, preferred) * 0.37 + angleGap(offset, 0) * 0.06
      if (bestQuality === 3 && cost >= bestCost) continue
      const yaw = bearing + offset, sin = Math.sin(yaw), cos = Math.cos(yaw)
      const feet = bandVisible(nearby, person, sin, cos, reach, altitude, 0.60, STAFF_GROUND_Y)
      const torso = bandVisible(nearby, person, sin, cos, reach, altitude, shoulderWidth, 1.15)
      // 街缝过窄时，先争取完整的上半身，最后才退到胸口附近的窄视线。
      let quality = 2
      if (feet && torso) quality = 3
      else if (!torso) quality = bandVisible(nearby, person, sin, cos, reach, altitude, 0.30, 1.60) ? 1 : 0
      if (quality > bestQuality || quality === bestQuality && cost < bestCost) {
        bestQuality = quality
        bestCost = cost
        best = { offset, distance: reach, height: altitude }
        if (quality === 3 && extra === 0 && offset === preferred) return best
      }
    }
    if (pitch >= maxPitch) break
  }
  return best
}

// 街面进出时先越过实际相交楼宇的屋顶，再在已验通的摇臂末端下降。
export function createStreetCameraGlide(buildingIndex, eye, target, startTime) {
  const from = eye.clone(), fromLook = target.clone()
  let flight
  const smooth = t => t * t * (3 - 2 * t)
  const easeHeight = (a, b, t) => Math.exp(Math.log(a + 1) + Math.log((b + 1) / (a + 1)) * t) - 1
  return (now, endEye, endLook, position, look) => {
    if (!flight) {
      const dx = endEye.x - from.x, dz = endEye.z - from.z, length = Math.hypot(dx, dz)
      const mx = (from.x + endEye.x) / 2, mz = (from.z + endEye.z) / 2
      let safe = 0
      for (const b of buildingIndex?.buildings || []) {
        if (!b || b.height + 0.55 <= safe) continue
        const bx = (b.minX + b.maxX) / 2 - mx, bz = (b.minZ + b.maxZ) / 2 - mz
        const rx = (b.maxX - b.minX) / 2 + 0.6, rz = (b.maxZ - b.minZ) / 2 + 0.6
        if (Math.abs(bx) <= rx + Math.abs(dx) / 2 && Math.abs(bz) <= rz + Math.abs(dz) / 2 &&
            Math.abs(bx * dz - bz * dx) <= rx * Math.abs(dz) + rz * Math.abs(dx)) safe = b.height + 0.55
      }
      const lift = safe > from.y ? 0.36 + 0.07 * Math.log1p(safe - from.y) : 0
      const travel = 0.66 + Math.min(1, Math.log1p(length) * 0.15)
      const land = safe > endEye.y ? 0.48 + 0.12 * Math.log1p(safe - endEye.y) : 0
      const sum = lift + travel + land
      flight = { safe, lift: lift / sum, arrive: (lift + travel) / sum, duration: Math.min(2500, 530 + sum * 620) }
    }
    const { safe, lift, arrive, duration } = flight
    const t = Math.min(1, Math.max(0, (now - startTime) / duration))
    const travel = smooth(Math.max(0, Math.min(1, (t - lift) / (arrive - lift))))
    position.lerpVectors(from, endEye, travel)
    look.lerpVectors(fromLook, endLook, travel)
    if (t < lift) position.y = easeHeight(from.y, safe, smooth(t / lift))
    else if (t > arrive) position.y = easeHeight(safe, endEye.y, smooth((t - arrive) / (1 - arrive)))
    else position.y = easeHeight(Math.max(from.y, safe), Math.max(endEye.y, safe), travel)

    // 让轨道控制器只校正注视点，不会把已经避开屋檐的相机推回楼体。
    const dx = look.x - position.x, dz = look.z - position.z, dy = position.y - look.y
    const flat = Math.hypot(dx, dz), pitch = Math.atan2(dy, flat)
    const clamped = Math.min(Math.PI / 2 - 0.165, Math.max(-Math.atan(streetTilt), pitch))
    const radius = Math.max(STAFF_MIN_VIEW_DISTANCE + 0.01, Math.hypot(flat, dy))
    if (clamped !== pitch || Math.hypot(flat, dy) < STAFF_MIN_VIEW_DISTANCE + 0.01) {
      const yaw = flat > 1e-5 ? Math.atan2(dx, dz) : Math.atan2(endLook.x - endEye.x, endLook.z - endEye.z)
      const ground = radius * Math.cos(clamped)
      look.set(position.x + Math.sin(yaw) * ground, position.y - radius * Math.sin(clamped), position.z + Math.cos(yaw) * ground)
    }
    return t >= 1
  }
}

// 以脚下的注视点为轨道中心，按比例改变视距，绕最短方位角转向。终点可随巡查人员移动。
export function createStaffCameraGlide(eye, target, startTime) {
  const origin = target.clone()
  const startOffset = eye.clone().sub(origin)
  const startRadius = Math.max(1, startOffset.length())
  const startYaw = Math.atan2(startOffset.x, startOffset.z)
  const startPitch = Math.asin(startOffset.y / startRadius)
  let duration = 0
  let yawChange = 0

  return (now, endEye, endTarget, cameraPosition, lookAt) => {
    const dx = endEye.x - endTarget.x, dy = endEye.y - endTarget.y, dz = endEye.z - endTarget.z
    const endRadius = Math.max(1, Math.hypot(dx, dy, dz))
    const logDistance = Math.log(endRadius / startRadius)
    const angle = Math.atan2(dx, dz) - startYaw - yawChange
    yawChange += Math.atan2(Math.sin(angle), Math.cos(angle))
    if (!duration) {
      duration = Math.min(2150, 540 + 340 * Math.abs(logDistance) + 0.7 * origin.distanceTo(endTarget) + 80 * Math.abs(yawChange))
    }
    const t = Math.max(0, Math.min(1, (now - startTime) / duration))
    const ease = t * t * (3 - 2 * t)
    const radius = startRadius * Math.exp(logDistance * ease)
    const yaw = startYaw + yawChange * ease
    const pitch = startPitch + (Math.asin(dy / endRadius) - startPitch) * ease
    const reach = radius * Math.cos(pitch)
    lookAt.lerpVectors(origin, endTarget, ease)
    cameraPosition.set(Math.sin(yaw) * reach, Math.sin(pitch) * radius, Math.cos(yaw) * reach).add(lookAt)
    return t >= 1
  }
}

// 按地名牌的实际锚点适配两侧业务栏之间的窗口；开关人员图层共用同一城市场景构图。
export function fitCommunityPanorama(pos, look, communities, width, height, fov, frame) {
  if (frame.right <= frame.left || frame.bottom <= frame.top) return
  const back = pos.clone().sub(look).normalize()
  const right = pos.clone().set(back.z, 0, -back.x).normalize()
  const up = back.clone().cross(right)
  const focal = height / (2 * Math.tan(fov * Math.PI / 360))
  const leftSlope = (frame.left - width / 2) / focal, rightSlope = (frame.right - width / 2) / focal
  const lowSlope = (height / 2 - frame.bottom) / focal, highSlope = (height / 2 - frame.top) / focal
  let minRight = -Infinity, maxLeft = Infinity, minUp = -Infinity, maxDown = Infinity
  const point = look.clone()
  for (const { centerXZ: [x, z] } of communities) {
    point.set(x, 11, z).sub(look)
    const depth = point.dot(back), sx = point.dot(right), sy = point.dot(up)
    minRight = Math.max(minRight, sx + rightSlope * depth)
    maxLeft = Math.min(maxLeft, sx + leftSlope * depth)
    minUp = Math.max(minUp, sy + highSlope * depth)
    maxDown = Math.min(maxDown, sy + lowSlope * depth)
  }
  const radius = Math.max(pos.distanceTo(look),
    (minRight - maxLeft) / (rightSlope - leftSlope), (minUp - maxDown) / (highSlope - lowSlope))
  const shiftX = Math.max(minRight - rightSlope * radius, Math.min(0, maxLeft - leftSlope * radius))
  const shiftY = Math.max(minUp - highSlope * radius, Math.min(0, maxDown - lowSlope * radius))
  const groundY = look.y
  look.addScaledVector(right, shiftX).addScaledVector(up, shiftY)
  pos.copy(look).addScaledVector(back, radius)
  look.addScaledVector(back, (groundY - look.y) / back.y)
}
