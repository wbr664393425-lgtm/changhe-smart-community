import { COMMUNITIES } from '../store/appStore'
import { CHANGHE_COMMUNITY_GEO } from './changheGeo'
import {
  ORIGIN_LAT,
  ORIGIN_LNG,
  METERS_PER_DEG_LAT,
  METERS_PER_DEG_LNG,
  WORLD_DIV,
  CHANGHE_HQ_LATLNG,
  latLngToWorldXZ
} from './cityModelCache'
import { COMMUNITY_STAFF_SEEDS, COMMUNITY_ESTATES, getStaffGender } from './cockpitBuildingIndex'
import { createPatrolGroundRouter, createPatrolGroundRouterAsync } from './cockpitPatrolGround'

export const TRAIL_LEN = 8

const ROAD_SEEDS = [
  { name: '天衢东路', coords: [[37.4547, 116.326], [37.4526, 116.3494], [37.4519, 116.382]] },
  { name: '三八东路', coords: [[37.4504, 116.326], [37.4474, 116.3493], [37.4462, 116.382]] },
  { name: '东方红东路', coords: [[37.4465, 116.324], [37.4406, 116.3492], [37.4374, 116.382]] },
  { name: '东风东路', coords: [[37.4310, 116.318], [37.4304, 116.3493], [37.4300, 116.382]] },
  { name: '长河大道', coords: [[37.4660, 116.3494], [37.4474, 116.3493], [37.4160, 116.3488]] },
  { name: '大学东路', coords: [[37.4642, 116.326], [37.4622, 116.3494], [37.4606, 116.382]] },
  { name: '新河东路', coords: [[37.4235, 116.316], [37.4186, 116.3487], [37.4182, 116.382]] },
  { name: '岔河东大道', coords: [[37.4660, 116.3385], [37.4504, 116.3294], [37.4350, 116.3215], [37.4220, 116.3180]] },
  { name: '康博大道', coords: [[37.4650, 116.3584], [37.4400, 116.3580], [37.4160, 116.3578]] },
  { name: '晶华大道', coords: [[37.4640, 116.3730], [37.4400, 116.3725], [37.4150, 116.3718]] }
]

const ROADS_XZ = ROAD_SEEDS.map((r) => ({
  name: r.name,
  pts: r.coords.map(([lat, lng]) => latLngToWorldXZ(lat, lng))
}))

const SURNAMES = [
  '李', '王', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴',
  '徐', '孙', '马', '朱', '胡', '郭', '林', '何', '高', '郑',
  '梁', '谢', '宋', '唐', '韩', '曹', '许', '邓', '冯', '沈'
]
// 固定顺序保留演示副岗姓名。性别与名字在生成这条本地样例时一同选取。
const DEMO_GIVEN_PROFILES = [
  ['敏', 'female'], ['琪', 'female'], ['磊', 'male'], ['强', 'male'], ['洋', 'male'],
  ['芳', 'female'], ['翔', 'male'], ['伟', 'male'], ['涛', 'male'], ['雪', 'female'],
  ['明', 'male'], ['亮', 'male'], ['佳', 'female'], ['飞', 'female'], ['静', 'female'],
  ['婷', 'female'], ['杰', 'male'], ['超', 'male'], ['丹', 'female'], ['欣', 'female'],
  ['鹏', 'male'], ['斌', 'male'], ['峰', 'male'], ['颖', 'female'], ['晨', 'female'],
  ['浩', 'male'], ['宇', 'female'], ['琳', 'female'], ['辉', 'male'], ['燕', 'female'],
  ['博', 'male'], ['娜', 'female'], ['刚', 'male'], ['军', 'male'], ['红', 'female'],
  ['梅', 'female'], ['松', 'male'], ['宁', 'female'], ['凯', 'male'], ['洁', 'female']
]
const GRID_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
const TASK_TEMPLATES = [
  '高层楼道消防通道畅通巡查',
  '沿街九小场所燃气报警器复核',
  '独居高龄长者敲门入户探访',
  '小区电动自行车充电棚安全巡检',
  '背街小巷环境秩序与市政设施巡查',
  '重点监管企业安全生产台账核验',
  '滨水河道防汛排涝点位日常巡护',
  '辖区网格民情诉求上门回访核实',
  '在建工地裸土扬尘覆盖情况复查'
]

/**
 * 将 Three.js 世界坐标 (x, z) 逆投影为真实经纬度
 */
export function worldXZToLatLng(x, z) {
  return [
    ORIGIN_LAT - (z * WORLD_DIV) / METERS_PER_DEG_LAT,
    ORIGIN_LNG + (x * WORLD_DIV) / METERS_PER_DEG_LNG
  ]
}

function hashInt(n) {
  let x = (n + 11) * 2654435761
  x = ((x >>> 16) ^ x) * 0x45d9f3b
  return ((x >>> 16) ^ x) >>> 0
}

function pointInPolyXZ(x, z, polyXZ) {
  let inside = false
  for (let i = 0, j = polyXZ.length - 1; i < polyXZ.length; j = i++) {
    const xi = polyXZ[i][0], zi = polyXZ[i][1]
    const xj = polyXZ[j][0], zj = polyXZ[j][1]
    const hit = (zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-9) + xi
    if (hit) inside = !inside
  }
  return inside
}

function distPointToSegSq(px, pz, ax, az, bx, bz) {
  const vx = bx - ax
  const vz = bz - az
  const lenSq = vx * vx + vz * vz
  if (lenSq < 1e-8) return (px - ax) * (px - ax) + (pz - az) * (pz - az)
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / lenSq))
  const cx = ax + t * vx
  const cz = az + t * vz
  return (px - cx) * (px - cx) + (pz - cz) * (pz - cz)
}

function findNearestRoadName(x, z) {
  let bestName = '辖区支路'
  let bestD2 = Infinity
  for (let i = 0; i < ROADS_XZ.length; i++) {
    const r = ROADS_XZ[i]
    for (let j = 0; j < r.pts.length - 1; j++) {
      const [ax, az] = r.pts[j]
      const [bx, bz] = r.pts[j + 1]
      const d2 = distPointToSegSq(x, z, ax, az, bx, bz)
      if (d2 < bestD2) {
        bestD2 = d2
        bestName = r.name
      }
    }
  }
  return bestName
}

function buildLoopCumulativeLengths(pts) {
  const cum = [0]
  let total = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    total += Math.hypot(b[0] - a[0], b[1] - a[1])
    cum.push(total)
  }
  return { cum, total: Math.max(1e-3, total) }
}

function sampleLoopAtDistance(pts, cum, total, dist) {
  const d = ((dist % total) + total) % total
  let low = 0, high = pts.length - 1
  while (low < high) {
    const mid = (low + high) >>> 1
    if (d <= cum[mid + 1]) high = mid
    else low = mid + 1
  }
  const a = pts[low], b = pts[(low + 1) % pts.length]
  const segmentLength = Math.max(1e-4, cum[low + 1] - cum[low])
  const t = Math.max(0, Math.min(1, (d - cum[low]) / segmentLength))
  return {
    x: a[0] + (b[0] - a[0]) * t,
    z: a[1] + (b[1] - a[1]) * t,
    heading: Math.atan2(b[0] - a[0], b[1] - a[1])
  }
}

function lerpAngle(a, b, t) {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI
  if (diff < -Math.PI) diff += Math.PI * 2
  return a + diff * t
}

function prepareStaffEngineContext(store, buildingIndex) {
  const estatesByComm = new Map()
  ;(buildingIndex?.estateLandmarks || []).forEach((est) => {
    let arr = estatesByComm.get(est.community)
    if (!arr) {
      arr = []
      estatesByComm.set(est.community, arr)
    }
    arr.push(est)
  })

  const [hqX, hqZ] = latLngToWorldXZ(CHANGHE_HQ_LATLNG[0], CHANGHE_HQ_LATLNG[1])
  const patrolMap = new Map()
  ;(store?.patrolRecords || []).forEach((p) => {
    patrolMap.set(p.community, p)
  })

  // 额外指定 3 个关注社区的 1 名副岗网格员处于滞留提醒状态，连同堤口·张强共 4 名可演示督办闭环
  const extraAnomalyComms = new Set(['八里庄社区', '赵辛社区', '岳庄社区'])
  const usedNames = new Set(Object.values(COMMUNITY_STAFF_SEEDS).map((s) => s.name))
  return { estatesByComm, hqX, hqZ, patrolMap, extraAnomalyComms, usedNames, list: [] }
}

function createCommunityBuilder(ctx, comm, commIdx) {
  const geo = CHANGHE_COMMUNITY_GEO[comm.name]
  const polyLatLng = geo ? geo.polygon : comm.polygon
  const polyXZ = polyLatLng.map(([lat, lng]) => latLngToWorldXZ(lat, lng))
  const centerXZ = latLngToWorldXZ(comm.center[0], comm.center[1])
  const inCommunity = (x, z) => pointInPolyXZ(x, z, polyXZ)

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  polyXZ.forEach(([x, z]) => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  })
  const spanX = Math.max(12, maxX - minX)
  const spanZ = Math.max(12, maxZ - minZ)

  const commCount = Math.max(1, Number(comm.gridStaff) || 5)
  const seed = COMMUNITY_STAFF_SEEDS[comm.name] || {
    name: `${comm.lead.slice(0, 1)}明`,
    phone: comm.phone,
    grid: '第一网格',
    task: '日常网格入户走访与安全巡查'
  }
  const patrol = ctx.patrolMap.get(comm.name)
  const commEstates = COMMUNITY_ESTATES[comm.name] || [`${comm.name.replace('社区', '')}小区`]
  const commEstCoords = ctx.estatesByComm.get(comm.name) || []

  function addSlot(slot, store, buildGroundLoop) {
    const h = hashInt(commIdx * 100 + slot + 17)
    const isPrimary = slot === 0
    let name = seed.name
    let gender = getStaffGender(seed)
    if (!isPrimary) {
      let pickAttempt = 0
      do {
        const sn = SURNAMES[(h + pickAttempt * 7) % SURNAMES.length]
        const profileIndex = (Math.floor(h / 13) + pickAttempt * 5 + slot) % DEMO_GIVEN_PROFILES.length
        const [givenName, demoGender] = DEMO_GIVEN_PROFILES[profileIndex]
        name = sn + givenName
        gender = demoGender
        pickAttempt++
      } while (ctx.usedNames.has(name) && pickAttempt < 30)
      ctx.usedNames.add(name)
    }

    const id = isPrimary ? `staff-${comm.id}` : `staff-${comm.id}-${slot + 1}`
    const gridNo = isPrimary ? (patrol?.grid || seed.grid) : `第${GRID_CN[slot % Math.min(comm.grids, GRID_CN.length)] || (slot + 1)}网格`
    const phone = isPrimary
      ? seed.phone
      : `13${5 + (h % 4)}534${String(1000 + ((h % 8999) + slot * 37) % 8999).padStart(4, '0')}`

    const openAssigned = (store?.events || []).filter(
      (e) => e.stage !== '已办结' && (e.owner?.includes(name) || e.reporter === name)
    ).length

    let status = '在岗巡查'
    let stayMinutes = 10 + (h % 16)
    if (isPrimary && patrol && patrol.stayMinutes > 30) {
      status = '滞留提醒'
      stayMinutes = patrol.stayMinutes
    } else if (!isPrimary && slot === 1 && ctx.extraAnomalyComms.has(comm.name)) {
      status = '滞留提醒'
      stayMinutes = 34 + (h % 14)
    } else if (openAssigned > 0 || h % 7 === 0) {
      status = '在办处置'
    }

    // 构建社区内防穿楼闭合巡防环路
    let rawLoop = []
    const recorded = isPrimary && Array.isArray(patrol?.track)
      ? patrol.track.filter(pt => Number.isFinite(pt?.lat) && Number.isFinite(pt?.lng))
      : null
    if (recorded?.length >= 3) {
      rawLoop = recorded.map(pt => latLngToWorldXZ(pt.lat, pt.lng))
    } else {
      const subAngle = ((slot / commCount) * Math.PI * 2) + (h % 100) * 0.02
      const subRadiusX = spanX * (0.18 + ((slot % 3) * 0.08))
      const subRadiusZ = spanZ * (0.18 + (((slot + 1) % 3) * 0.08))
      const anchorX = centerXZ[0] + Math.cos(subAngle) * (spanX * 0.16)
      const anchorZ = centerXZ[1] + Math.sin(subAngle) * (spanZ * 0.16)
      const countPts = 5
      for (let k = 0; k < countPts; k++) {
        const ang = subAngle + (k / countPts) * Math.PI * 2
        let wx = anchorX + Math.cos(ang) * (subRadiusX * (0.65 + (k % 2) * 0.25))
        let wz = anchorZ + Math.sin(ang) * (subRadiusZ * (0.65 + ((k + 1) % 2) * 0.25))
        if (!pointInPolyXZ(wx, wz, polyXZ)) {
          wx = centerXZ[0] + (wx - centerXZ[0]) * 0.45
          wz = centerXZ[1] + (wz - centerXZ[1]) * 0.45
        }
        rawLoop.push([wx, wz])
      }
    }

    const pathXZ = buildGroundLoop(rawLoop, inCommunity)
    if (!pathXZ.length) return
    const { cum, total } = buildLoopCumulativeLengths(pathXZ)
    let startDist = ((h % 1000) / 1000) * total
    if (isPrimary && status === '滞留提醒' && patrol.stayCoord?.length === 2) {
      const [stayX, stayZ] = latLngToWorldXZ(...patrol.stayCoord)
      let nearest = Infinity
      pathXZ.forEach(([x, z], i) => {
        const distance = (x - stayX) ** 2 + (z - stayZ) ** 2
        if (distance < nearest) {
          nearest = distance
          startDist = cum[i]
        }
      })
    }
    const sample0 = sampleLoopAtDistance(pathXZ, cum, total, startDist)
    const [lat, lng] = worldXZToLatLng(sample0.x, sample0.z)

    const nearEst = commEstCoords.length
      ? commEstCoords.reduce((best, cur) => {
          const d = Math.hypot(cur.x - sample0.x, cur.z - sample0.z)
          return !best || d < best.d ? { item: cur, d } : best
        }, null)?.item?.name
      : commEstates[slot % commEstates.length]

    const roadName = findNearestRoadName(sample0.x, sample0.z)
    const roadLabel = nearEst ? `${roadName}沿线 · 近${nearEst}` : `${roadName}沿线`

    const speed = status === '滞留提醒' ? 0 : status === '在办处置' ? 0.68 : 0.44 + (h % 5) * 0.055
    const mustTotal = patrol?.mustPointsTotal || 8
    const mustDone = isPrimary && patrol
      ? patrol.mustPointsDone
      : status === '滞留提醒'
        ? 4 + (h % 3)
        : Math.min(mustTotal, 5 + (h % 4))
    const km = isPrimary && patrol ? patrol.km : +(2.6 + (h % 28) * 0.1).toFixed(1)
    const task = isPrimary && patrol?.stayPlace
      ? patrol.stayPlace
      : isPrimary
        ? seed.task
        : TASK_TEMPLATES[(h + slot) % TASK_TEMPLATES.length]

    // 初始化最近一小段足迹，首次选中移动人员就能看到行进方向。
    const trail = []
    const stepBack = status === '滞留提醒' ? 0.04 : 1.05
    for (let ti = TRAIL_LEN - 1; ti >= 0; ti--) {
      const sBack = sampleLoopAtDistance(pathXZ, cum, total, startDist - ti * stepBack)
      trail.push([sBack.x, sBack.z])
    }

    ctx.list.push({
      idx: ctx.list.length,
      id,
      entityType: 'staff',
      isPrimary,
      name,
      gender,
      shortLabel: isPrimary ? `网格员·${name}` : name,
      community: comm.name,
      grid: gridNo,
      phone,
      lead: comm.lead,
      task,
      km,
      mustPoints: `${mustDone}/${mustTotal}`,
      status,
      stayMinutes,
      openAssigned,
      roadLabel,
      speedKmh: status === '滞留提醒' ? 0 : +(speed * 3.6 * 1.4).toFixed(1),
      x: sample0.x,
      z: sample0.z,
      lat,
      lng,
      heading: sample0.heading,
      distFromHq: Math.hypot(sample0.x - ctx.hqX, sample0.z - ctx.hqZ),
      trail,
      _pathXZ: pathXZ,
      _cum: cum,
      _total: total,
      _dist: startDist,
      _speed: speed,
      _trailAccum: 0,
      _roadCheckAccum: (h % 10) * 0.12
    })
  }

  return { commCount, addSlot }
}

function createEngineHandle(list, estatesByComm) {
  function refreshRoadLabel(st) {
    const roadName = findNearestRoadName(st.x, st.z)
    const estList = estatesByComm.get(st.community)
    let nearEst = ''
    if (estList?.length) {
      let bestD = Infinity
      for (let i = 0; i < estList.length; i++) {
        const d = Math.hypot(estList[i].x - st.x, estList[i].z - st.z)
        if (d < bestD) {
          bestD = d
          nearEst = estList[i].name
        }
      }
    } else {
      const seeds = COMMUNITY_ESTATES[st.community]
      nearEst = seeds ? seeds[st.idx % seeds.length] : ''
    }
    st.roadLabel = nearEst ? `${roadName}沿线 · 近${nearEst}` : `${roadName}沿线`
  }

  function step(dt, maxDelta = 0.05) {
    if (!(dt > 0) || !(maxDelta > 0)) return
    const clampedDt = Math.min(maxDelta, dt)
    for (let i = 0; i < list.length; i++) {
      const st = list[i]
      if (st.status === '滞留提醒' || st._speed <= 0) {
        continue
      }
      st._dist = (st._dist + st._speed * clampedDt) % st._total
      const s = sampleLoopAtDistance(st._pathXZ, st._cum, st._total, st._dist)
      st.x = s.x
      st.z = s.z
      st.heading = lerpAngle(st.heading, s.heading, Math.min(1, clampedDt * 5.2))

      // 复用最近八个位置。只有当前选中人员会提交轨迹几何。
      st._trailAccum += st._speed * clampedDt
      let head = st.trail[st.trail.length - 1]
      if (st._trailAccum >= 0.90) {
        st._trailAccum = 0
        head = st.trail.shift()
        st.trail.push(head)
      }
      head[0] = st.x
      head[1] = st.z

      st._roadCheckAccum += clampedDt
      if (st._roadCheckAccum >= 1.8) {
        st._roadCheckAccum = 0
        const [lat, lng] = worldXZToLatLng(st.x, st.z)
        st.lat = lat
        st.lng = lng
        refreshRoadLabel(st)
      }
    }
  }

  function toSnapshot(st) {
    const [lat, lng] = worldXZToLatLng(st.x, st.z)
    return {
      idx: st.idx,
      id: st.id,
      entityType: 'staff',
      isPrimary: st.isPrimary,
      name: st.name,
      gender: st.gender,
      shortLabel: st.shortLabel,
      community: st.community,
      grid: st.grid,
      phone: st.phone,
      lead: st.lead,
      task: st.task,
      km: st.km,
      mustPoints: st.mustPoints,
      status: st.status,
      stayMinutes: st.stayMinutes,
      openAssigned: st.openAssigned,
      roadLabel: st.roadLabel,
      speedKmh: st.speedKmh,
      x: st.x,
      z: st.z,
      lat,
      lng
    }
  }

  function getAll() {
    return list.map(toSnapshot)
  }

  function getById(id) {
    const hit = list.find((s) => s.id === id)
    return hit ? toSnapshot(hit) : null
  }

  function getRawById(id) {
    return list.find((s) => s.id === id) || null
  }

  function getSummary(scope = '全街道') {
    let total = 0
    let patrol = 0
    let handling = 0
    let alert = 0
    for (let i = 0; i < list.length; i++) {
      const s = list[i]
      if (scope !== '全街道' && s.community !== scope) continue
      total++
      if (s.status === '滞留提醒') alert++
      else if (s.status === '在办处置') handling++
      else patrol++
    }
    return { total, patrol, handling, alert }
  }

  function setStatus(id, nextStatus, extra = {}) {
    const st = list.find((s) => s.id === id)
    if (!st) return null
    st.status = nextStatus
    if (extra.task) st.task = extra.task
    if (nextStatus === '滞留提醒') {
      st._speed = 0
      st.speedKmh = 0
    } else if (nextStatus === '在办处置') {
      st._speed = 0.72
      st.speedKmh = 3.6
      st.openAssigned = Math.max(1, st.openAssigned + 1)
    } else {
      st._speed = 0.52
      st.speedKmh = 2.6
      st.stayMinutes = 0
    }
    return toSnapshot(st)
  }

  /**
   * 预留外部实时定位遥测（GPS / WebSocket）无痛接入口
   */
  function pushLiveTelemetry(updates = []) {
    if (!Array.isArray(updates)) return
    updates.forEach((u) => {
      const st = list.find((s) => s.id === u.id)
      if (!st) return
      if (typeof u.lat === 'number' && typeof u.lng === 'number') {
        const [nx, nz] = latLngToWorldXZ(u.lat, u.lng)
        st.heading = Math.atan2(nx - st.x, nz - st.z)
        st.x = nx
        st.z = nz
        st.lat = u.lat
        st.lng = u.lng
        st.trail.shift()
        st.trail.push([nx, nz])
        refreshRoadLabel(st)
      }
      if (u.status) st.status = u.status
    })
  }

  return {
    list,
    step,
    getAll,
    getById,
    getRawById,
    getSummary,
    setStatus,
    pushLiveTelemetry
  }
}

/**
 * 构建驾驶舱实时网格巡防引擎（全街道 14 社区全量专职网格员，纯 JS 运行时状态，无 Vue 响应式开销）
 */
export function createStaffLiveEngine(store, buildingIndex) {
  let buildGroundLoop = createPatrolGroundRouter(buildingIndex?.buildings || [])
  const ctx = prepareStaffEngineContext(store, buildingIndex)
  COMMUNITIES.forEach((comm, commIdx) => {
    const cb = createCommunityBuilder(ctx, comm, commIdx)
    for (let slot = 0; slot < cb.commCount; slot++) {
      cb.addSlot(slot, store, buildGroundLoop)
    }
  })
  // 运行期仅保留每人的折线，释放初始化共用的寻路数组。
  buildGroundLoop = null
  return createEngineHandle(ctx.list, ctx.estatesByComm)
}

/**
 * 时间分片异步构建驾驶舱实时网格巡防引擎（每片 <= 2.8ms），消除加载幕掉帧
 */
export async function createStaffLiveEngineAsync(store, buildingIndex, yieldFn) {
  let buildGroundLoop = await createPatrolGroundRouterAsync(buildingIndex?.buildings || [], yieldFn)
  const ctx = prepareStaffEngineContext(store, buildingIndex)
  let sliceStart = performance.now()
  for (let commIdx = 0; commIdx < COMMUNITIES.length; commIdx++) {
    const cb = createCommunityBuilder(ctx, COMMUNITIES[commIdx], commIdx)
    for (let slot = 0; slot < cb.commCount; slot++) {
      cb.addSlot(slot, store, buildGroundLoop)
      if (yieldFn && performance.now() - sliceStart >= 2.8) {
        await yieldFn()
        sliceStart = performance.now()
      }
    }
  }
  buildGroundLoop = null
  return createEngineHandle(ctx.list, ctx.estatesByComm)
}
