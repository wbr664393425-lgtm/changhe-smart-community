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
  let count = 0, width, height, obstacles

  function reset(w, h, blocks) {
    width = w
    height = h
    obstacles = blocks
    count = 0
  }

  function place(location, size, weight, smoothing) {
    const radius = size * 0.44
    const x = location.anchorX
    const y = location.anchorY - size / 2
    let best = offsets[0], bestCost = Infinity
    if (weight > 0.005) {
      for (const offset of offsets) {
        const cx = x + offset[0] * weight, cy = y + offset[1] * weight
        if (cx < radius || cx > width - radius || cy < radius || cy > height - radius) continue
        let cost = 0
        for (const box of obstacles) {
          const ew = Math.min(cx + radius, box.right) - Math.max(cx - radius, box.left)
          const eh = Math.min(cy + radius, box.bottom) - Math.max(cy - radius, box.top)
          if (ew > 0 && eh > 0) cost += ew * eh * 2
        }
        for (let i = 0; i < count && cost < bestCost; i += 3) {
          const dx = cx - occupied[i], dy = cy - occupied[i + 1]
          const separation = radius + occupied[i + 2] + 1
          cost += Math.max(0, separation * separation - dx * dx - dy * dy)
        }
        if (cost < bestCost) {
          best = offset
          bestCost = cost
        }
        if (!cost) break
      }
      occupied[count++] = x + best[0] * weight
      occupied[count++] = y + best[1] * weight
      occupied[count++] = radius
    }
    // 保存未乘缩放权重的方位，避免拉近时残留上一帧的屏幕偏移。
    const t = location.wasVisible ? smoothing : 1
    location.dx += (best[0] - location.dx) * t
    location.dy += (best[1] - location.dy) * t
    location.x = location.anchorX + location.dx * weight
    location.y = location.anchorY + location.dy * weight
  }

  return { reset, place }
}
