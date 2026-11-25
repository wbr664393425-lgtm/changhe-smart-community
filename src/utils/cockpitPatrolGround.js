import atlas from './changheAmapPolygons.json'
import waterfront from './changheWaterfront.json'
import { latLngToWorldXZ } from './cityModelCache'

const cellSize = 1.2 // 12 米。路线经过整格可通行的地面，人物坐标在航点间连续插值。
const { north, south, west, east } = atlas.baseBounds
const [westX, northZ] = latLngToWorldXZ(north, west)
const [eastX, southZ] = latLngToWorldXZ(south, east)
const columns = Math.ceil((eastX - westX) / cellSize) + 2
const rows = Math.ceil((southZ - northZ) / cellSize) + 2
const originX = westX - cellSize
const originZ = northZ - cellSize
const cellCount = columns * rows
const waterRings = waterfront.water.map(polygon => polygon.map(ring => ring.map(([px, py]) => [
  westX + (px + 0.5) * (eastX - westX) / waterfront.size[0],
  northZ + (py + 0.5) * (southZ - northZ) / waterfront.size[1]
])))

function cellCenter(id) {
  return [
    originX + (id % columns + 0.5) * cellSize,
    originZ + (Math.floor(id / columns) + 0.5) * cellSize
  ]
}

// 填充多边形内部及边缘经过的整格。水域内环保留为陆地，岸边留出圆角模型的误差。
function markObstacle(blocked, rings, clearance) {
  let minZ = Infinity, maxZ = -Infinity
  for (const [, z] of rings[0]) {
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  const first = Math.max(0, Math.floor((minZ - clearance - originZ) / cellSize))
  const last = Math.min(rows - 1, Math.floor((maxZ + clearance - originZ) / cellSize))
  function markSpan(row, left, right) {
    const low = Math.max(0, Math.floor((left - originX) / cellSize))
    const high = Math.min(columns - 1, Math.floor((right - originX) / cellSize))
    if (low <= high) blocked.fill(1, row * columns + low, row * columns + high + 1)
  }
  for (let row = first; row <= last; row++) {
    const top = originZ + row * cellSize
    const center = top + cellSize / 2
    const crossings = []
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, az] = ring[j], [bx, bz] = ring[i]
        if (Math.max(az, bz) < top - clearance || Math.min(az, bz) > top + cellSize + clearance) continue
        let left = ax, right = bx
        if (az !== bz) {
          const slope = (bx - ax) / (bz - az)
          const z0 = Math.max(Math.min(az, bz), top - clearance)
          const z1 = Math.min(Math.max(az, bz), top + cellSize + clearance)
          left = ax + (z0 - az) * slope
          right = ax + (z1 - az) * slope
          if ((az > center) !== (bz > center)) crossings.push(ax + (center - az) * slope)
        }
        markSpan(row, Math.min(left, right) - clearance, Math.max(left, right) + clearance)
      }
    }
    crossings.sort((a, b) => a - b)
    for (let i = 1; i < crossings.length; i += 2) markSpan(row, crossings[i - 1], crossings[i])
  }
}

// 基于已填充障碍栅格构造地面巡防寻路器
function createRouterFromBlocked(blocked) {
  const queue = new Int32Array(cellCount)
  const parent = new Int32Array(cellCount)
  const visited = new Uint32Array(cellCount)
  let searchId = 0

  function nearestGround([worldX, worldZ], inCommunity) {
    const cx = Math.max(0, Math.min(columns - 1, Math.floor((worldX - originX) / cellSize)))
    const cz = Math.max(0, Math.min(rows - 1, Math.floor((worldZ - originZ) / cellSize)))
    const center = cz * columns + cx
    if (!blocked[center]) return center
    let nearest = -1, bestDistance = Infinity
    for (let radius = 1; radius < Math.max(rows, columns); radius++) {
      let local = -1, localDistance = Infinity
      for (let z = Math.max(0, cz - radius); z <= Math.min(rows - 1, cz + radius); z++) {
        const left = Math.max(0, cx - radius), right = Math.min(columns - 1, cx + radius)
        for (let x = left; x <= right; x++) {
          if (Math.max(Math.abs(x - cx), Math.abs(z - cz)) !== radius) continue
          const cell = z * columns + x
          if (blocked[cell]) continue
          const [px, pz] = cellCenter(cell)
          const distance = (px - worldX) ** 2 + (pz - worldZ) ** 2
          if (distance < bestDistance) { nearest = cell; bestDistance = distance }
          if (distance < localDistance && inCommunity(px, pz)) { local = cell; localDistance = distance }
        }
      }
      if (local >= 0) return local
      if (nearest >= 0 && radius * cellSize >= 10) return nearest
    }
    return -1
  }

  // 精确枚举经过的网格。穿过格角时同时检查两侧，简化航点也无法抄近路穿墙。
  function clearLine(a, b) {
    const dx = b % columns - a % columns, dz = Math.floor(b / columns) - Math.floor(a / columns)
    const nx = Math.abs(dx), nz = Math.abs(dz)
    const stepX = Math.sign(dx), stepZ = Math.sign(dz) * columns
    let ix = 0, iz = 0, cell = a
    while (cell !== b) {
      const compare = (2 * ix + 1) * nz - (2 * iz + 1) * nx
      if (compare === 0 && (blocked[cell + stepX] || blocked[cell + stepZ])) return false
      if (compare <= 0) { cell += stepX; ix++ }
      if (compare >= 0) { cell += stepZ; iz++ }
      if (blocked[cell]) return false
    }
    return true
  }

  function connect(from, to) {
    if (clearLine(from, to)) return [to]
    const ax = from % columns, az = Math.floor(from / columns)
    const bx = to % columns, bz = Math.floor(to / columns)
    // 保持本地巡查的尺度。对岸孤立点无需绕行到社区以外。
    const margin = Math.max(9, Math.min(32, Math.ceil(Math.hypot(bx - ax, bz - az) * 0.5)))
    const left = Math.max(0, Math.min(ax, bx) - margin), right = Math.min(columns - 1, Math.max(ax, bx) + margin)
    const top = Math.max(0, Math.min(az, bz) - margin), bottom = Math.min(rows - 1, Math.max(az, bz) + margin)
    const stepX = bx >= ax ? 1 : -1, stepZ = bz >= az ? columns : -columns
    const directions = [stepX, stepZ, -stepX, -stepZ]
    let read = 0, write = 1
    searchId++
    queue[0] = from
    visited[from] = searchId
    while (read < write && visited[to] !== searchId) {
      const current = queue[read++], x = current % columns, z = Math.floor(current / columns)
      for (const dir of directions) {
        if (dir === -1 && x === left || dir === 1 && x === right ||
            dir === -columns && z === top || dir === columns && z === bottom) continue
        const next = current + dir
        if (blocked[next] || visited[next] === searchId) continue
        visited[next] = searchId
        parent[next] = current
        queue[write++] = next
      }
    }
    if (visited[to] !== searchId) return []
    const chain = []
    for (let id = to; id !== from; id = parent[id]) chain.push(id)
    chain.reverse()
    const route = []
    let anchor = from
    for (let i = 1; i < chain.length; i++) {
      if (!clearLine(anchor, chain[i])) {
        anchor = chain[i - 1]
        route.push(anchor)
      }
    }
    route.push(to)
    return route
  }

  return function buildLoop(waypoints, inCommunity) {
    const anchors = waypoints.map(point => nearestGround(point, inCommunity)).filter(cell => cell >= 0)
    if (!anchors.length) return []
    // 报到点可能在封闭院落中；保留同一可达片区内最多的原巡查点。
    let route = [anchors[0]], bestVisits = 1
    for (let start = 0; start < anchors.length && bestVisits < anchors.length; start++) {
      const candidate = [anchors[start]]
      let visits = 1
      for (let i = 1; i < anchors.length; i++) {
        const last = candidate[candidate.length - 1], next = anchors[(start + i) % anchors.length]
        if (last === next) continue
        const leg = connect(last, next)
        if (leg.length) {
          candidate.push(...leg)
          visits++
        }
      }
      if (visits > bestVisits) {
        route = candidate
        bestVisits = visits
      }
    }
    if (route.length > 1) {
      const last = route[route.length - 1], first = route[0]
      if (last === first) route.pop()
      else {
        const home = connect(last, first)
        route.push(...(home.length ? home.slice(0, -1) : route.slice(1, -1).reverse()))
      }
    }
    return route.map(cellCenter)
  }
}

// 仅在生成巡查线路时使用，寻路缓存不会随人物逐帧计算。
export function createPatrolGroundRouter(buildings) {
  const blocked = new Uint8Array(cellCount)
  for (const rings of waterRings) markObstacle(blocked, rings, 0.65)
  for (const building of buildings) {
    if (building?.pts?.length >= 3) markObstacle(blocked, [building.pts], 0.18)
  }
  return createRouterFromBlocked(blocked)
}

/** 时间分片异步构建巡防寻路栅格（每片 <= 2.8ms），避免加载幕期间掉帧 */
export async function createPatrolGroundRouterAsync(buildings, yieldFn) {
  const blocked = new Uint8Array(cellCount)
  let sliceStart = performance.now()
  for (const rings of waterRings) {
    markObstacle(blocked, rings, 0.65)
    if (yieldFn && performance.now() - sliceStart >= 2.8) {
      await yieldFn()
      sliceStart = performance.now()
    }
  }
  for (const building of buildings) {
    if (building?.pts?.length >= 3) markObstacle(blocked, [building.pts], 0.18)
    if (yieldFn && performance.now() - sliceStart >= 2.8) {
      await yieldFn()
      sliceStart = performance.now()
    }
  }
  return createRouterFromBlocked(blocked)
}
