import { CanvasTexture, SRGBColorSpace } from 'three'

// 全景仅需一张 192×64 图集。巡查是人形，处置手持工单，滞留有外圈和叹号。
export function createStaffStatusTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 192
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  const paper = '#fffaf0'
  for (const [col, tone] of ['#1d7267', '#2e67a5', '#b0392c'].entries()) {
    ctx.save()
    ctx.translate(col * 64, 0)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    if (col === 2) {
      ctx.fillStyle = paper
      ctx.strokeStyle = paper
      ctx.lineWidth = 8
      ctx.beginPath()
      ctx.arc(32, 32, 26, 0, 2 * Math.PI)
      ctx.fill()
      ctx.stroke()
      ctx.lineWidth = 4
      ctx.strokeStyle = tone
      ctx.stroke()
      ctx.translate(8, 8)
      ctx.scale(0.75, 0.75)
    }
    if (col === 1) ctx.translate(-3, 0)
    ctx.fillStyle = tone
    ctx.strokeStyle = paper
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.arc(32, 16, 10, 0, 2 * Math.PI)
    ctx.stroke()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(10, 54)
    ctx.quadraticCurveTo(11, 34, 26, 31)
    ctx.quadraticCurveTo(32, 35, 38, 31)
    ctx.quadraticCurveTo(53, 34, 54, 54)
    ctx.quadraticCurveTo(32, 61, 10, 54)
    ctx.closePath()
    ctx.stroke()
    ctx.fill()
    if (col === 1) {
      ctx.lineWidth = 5
      ctx.strokeRect(41, 35, 18, 21)
      ctx.fillRect(41, 35, 18, 21)
      ctx.fillStyle = paper
      ctx.fillRect(45, 41, 10, 3)
      ctx.fillRect(45, 47, 7, 3)
    }
    if (col === 2) {
      ctx.strokeStyle = paper
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.moveTo(32, 37)
      ctx.lineTo(32, 46)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(32, 52, 2.1, 0, 2 * Math.PI)
      ctx.fillStyle = paper
      ctx.fill()
    }
    ctx.restore()
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

const offsets = [[0, 0]]
for (const radius of [10, 19, 29, 38]) {
  for (let i = 0; i < 8; i++) {
    const angle = (i - 2) * Math.PI / 4
    offsets.push([Math.round(Math.cos(angle) * radius), Math.round(Math.sin(angle) * radius)])
  }
}

// 优先尝试地面实点。需要移开时，短引线仍然落在实际坐标；连续缩放时偏移也连续收回。
export function createStaffScreenLayout(capacity) {
  const occupied = new Float32Array(capacity * 3)
  let count = 0, width = 0, height = 0, obstacles = []
  let revision = 0, lastWeight = -1, lastCount = 0, replan = false

  function prepare(locations, w, h, blocks, weight) {
    if (weight <= 0.005) {
      lastWeight = -1
      replan = false
      return
    }
    // 每帧投影真实位置。只有人或铭牌明显挪动时才重新安排避让位置。
    replan = w !== width || h !== height || Math.abs(weight - lastWeight) > 0.08 ||
      locations.length !== lastCount || blocks.length !== obstacles.length ||
      locations.some(loc => loc.plan !== revision || loc.priority !== loc.planPriority ||
        Math.abs(loc.anchorX - loc.planX) >= 5 || Math.abs(loc.anchorY - loc.planY) >= 5) ||
      blocks.some((b, i) => Math.abs(b.left - obstacles[i].left) >= 4 || Math.abs(b.right - obstacles[i].right) >= 4 ||
        Math.abs(b.top - obstacles[i].top) >= 4 || Math.abs(b.bottom - obstacles[i].bottom) >= 4)
    if (!replan) return
    revision++
    width = w
    height = h
    obstacles = blocks
    lastCount = locations.length
    lastWeight = weight
    count = 0
  }

  function collisionCost(cx, cy, radius) {
    if (cx < radius || cx > width - radius || cy < radius || cy > height - radius) return Infinity
    let cost = 0
    for (const box of obstacles) {
      const ew = Math.min(cx + radius, box.right) - Math.max(cx - radius, box.left)
      const eh = Math.min(cy + radius, box.bottom) - Math.max(cy - radius, box.top)
      if (ew > 0 && eh > 0) cost += ew * eh * 2
    }
    for (let i = 0; i < count; i += 3) {
      const dx = cx - occupied[i], dy = cy - occupied[i + 1]
      const separation = radius + occupied[i + 2] + 2
      cost += Math.max(0, separation * separation - dx * dx - dy * dy)
    }
    return cost
  }

  function assign(location, size, weight) {
    const radius = size * 0.44
    const x = location.anchorX
    const y = location.anchorY - size / 2
    const previous = location.slot || offsets[0]
    let best = previous
    let bestCost = collisionCost(x + previous[0] * weight, y + previous[1] * weight, radius)
    const movedAway = location.slot && Math.hypot(x - location.slotX, y - location.slotY) >= size * 1.5
    if (previous !== offsets[0] && movedAway && collisionCost(x, y, radius) === 0) {
      best = offsets[0]
    } else if (bestCost > 6) {
      for (const offset of offsets) {
        const cx = x + offset[0] * weight, cy = y + offset[1] * weight
        const dx = offset[0] - previous[0], dy = offset[1] - previous[1]
        const cost = collisionCost(cx, cy, radius) + 0.025 * (dx * dx + dy * dy)
        if (cost < bestCost) {
          best = offset
          bestCost = cost
        }
      }
    }
    occupied[count++] = x + best[0] * weight
    occupied[count++] = y + best[1] * weight
    occupied[count++] = radius
    if (best !== location.slot) {
      location.slot = best
      location.slotX = x
      location.slotY = y
    }
    location.plan = revision
    location.planPriority = location.priority
    location.planX = location.anchorX
    location.planY = location.anchorY
  }

  function place(location, size, weight, maxStep) {
    if (replan) assign(location, size, weight)
    const target = location.slot || offsets[0]
    const dx = target[0] - location.dx, dy = target[1] - location.dy
    const distance = Math.hypot(dx, dy)
    if (distance > 0) {
      const anchorMove = location.wasVisible ? Math.hypot(location.anchorX - location.lastX, location.anchorY - location.lastY) : 0
      const t = location.wasVisible ? Math.min(1, (maxStep + anchorMove * 0.5) / distance) : 1
      location.dx += dx * t
      location.dy += dy * t
    }
    location.lastX = location.anchorX
    location.lastY = location.anchorY
    location.x = location.anchorX + location.dx * weight
    location.y = location.anchorY + location.dy * weight
  }

  return { prepare, place }
}
