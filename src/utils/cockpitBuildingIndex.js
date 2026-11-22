import amapPolyData from './changheAmapPolygons.json'
import realBuildingLabels from './changheRealBuildingLabels.json'
import { CHANGHE_COMMUNITY_GEO } from './changheGeo'
import { latLngToWorldXZ, CHANGHE_HQ_LATLNG } from './cityModelCache'
import { COMMUNITIES } from '../store/appStore'

// 1 Three.js 单位 = 10 米；5 单位 = 50 米空间哈希桶
const GRID_CELL = 5

export const COMMUNITY_ESTATES = {
  德馨社区: ['金辰云河赋', '崇德公馆', '齐庄小区', '中石化输油站小区'],
  八里庄社区: ['八里庄盛世华园', '绿城百合花园', '双馨苑', '德州职业技术学院生活区'],
  杨庄社区: ['东建·德州花园', '杨庄小区', '虹桥小区', '中盛大厦'],
  堤口社区: ['嘉诚·尚东', '蔚来城', '格瑞德公寓', '悦城创意文化园'],
  星凯社区: ['星凯国际广场', '华腾御城·澜湾', '华腾御城·倚翠园', '堤口新居'],
  尚德社区: ['中茂家园', '高地·世纪城北区', '长河公园东区', '气象局家属院'],
  赵辛社区: ['康博公馆', '新城市花园', '赵辛中天府社区', '东海天玉铭城'],
  泰和社区: ['泰和·名仕馨港', '世纪花城', '高地·世纪城', '东海·国风上院'],
  锦绣社区: ['簸箕刘·盛和景园', '小申新村', '新城市花园北区', '盛和景园B区'],
  明德社区: ['德州壹号院', '杏园新苑', '沟盘河小区', '双河家园'],
  岳庄社区: ['岳庄新村', '翠湖庄园', '中正天和园', '人力资源服务产业园'],
  郭家庵社区: ['外海·江南水郡', '田园小区', '十二里庄小区', '玫瑰公馆'],
  华嬉社区: ['宋官屯小区', '金华茶城', '利安大厦', '东汇大厦'],
  芦李府社区: ['德州汽配城', '金鼎公馆', '地勘局水文家园', '百佳花园小区']
}

const COMMUNITY_STAFF_SEEDS = {
  德馨社区: { name: '李敏', phone: '13853418801', grid: '第一网格', task: '高层楼道隐患排查与独居老人入户核验' },
  八里庄社区: { name: '王琪', phone: '13853418802', grid: '第一网格', task: '工地裸土扬尘巡检与农贸市场秩序维护' },
  杨庄社区: { name: '赵磊', phone: '13853418803', grid: '第二网格', task: '住宅小区物业巡查与反诈宣传入户' },
  堤口社区: { name: '张强', phone: '13853418804', grid: '第二网格', task: '沿街九小燃气复检与岔河低洼点排查' },
  星凯社区: { name: '刘洋', phone: '13853418805', grid: '商务网格', task: '星凯商务楼宇企业走访与充电棚复查' },
  尚德社区: { name: '马芳', phone: '13853418806', grid: '第一网格', task: '老旧小区飞线整治与双拥优抚走访' },
  赵辛社区: { name: '高翔', phone: '13853418807', grid: '第三网格', task: '林缘防火巡防与回迁区消防通道排查' },
  泰和社区: { name: '张伟', phone: '13853418808', grid: '商圈网格', task: '东风东路沿街商铺燃气与门前三包巡查' },
  锦绣社区: { name: '郑涛', phone: '13853418809', grid: '第二网格', task: '岔河沿岸巡河及高层住宅消防闭门器排查' },
  明德社区: { name: '韩雪', phone: '13853418810', grid: '第一网格', task: '校园周边秩序值守与居民诉求回访' },
  岳庄社区: { name: '曹明', phone: '13853418811', grid: '第二网格', task: '安置小区物业协同与林缘防火点巡查' },
  郭家庵社区: { name: '郭亮', phone: '13853418812', grid: '第一网格', task: '减河水系巡堤与农居人居环境整治' },
  华嬉社区: { name: '沈佳', phone: '13853418813', grid: '第二网格', task: '文创园区安全检查与青少年阵地保障' },
  芦李府社区: { name: '芦飞', phone: '13853418814', grid: '第一网格', task: '林地防火卡口巡护与易涝沟渠清淤检查' }
}

const ECO_RISK_SEEDS = [
  { id: 'eco-flood-1', kind: 'flood', name: '堤口岔河低洼易涝点', community: '堤口社区', lat: 37.4472, lng: 116.3376, level: '红牌重点', owner: '孙雅琴 · 市政养护二组', gear: '移动抽水泵 2 台 · 防汛沙袋 180 袋', status: '汛前清淤完成，雨量计在线' },
  { id: 'eco-flood-2', kind: 'flood', name: '锦绣岔河东大道下穿积水口', community: '锦绣社区', lat: 37.4328, lng: 116.3318, level: '重点关注', owner: '郑海燕 · 市政排涝一组', gear: '移动泵车备勤 · 警示围挡 12 组', status: '雨水箅子畅通，水位正常' },
  { id: 'eco-flood-3', kind: 'flood', name: '长河公园南岸调蓄泄水口', community: '明德社区', lat: 37.4342, lng: 116.3482, level: '常规盯防', owner: '韩立军 · 河湖巡护队', gear: '救生圈 8 副 · 防汛沙袋 100 袋', status: '液位监测正常，每日两巡' },
  { id: 'eco-flood-4', kind: 'flood', name: '八里庄北侧在建地块排水沟', community: '八里庄社区', lat: 37.4596, lng: 116.3435, level: '重点关注', owner: '林晓梅 · 工地联动组', gear: '应急抽水泵 1 台 · 导流管 40 米', status: '裸土防尘网整改中，同步疏通明沟' },
  { id: 'eco-fire-1', kind: 'fire', name: '赵辛东侧林缘防火瞭望点', community: '赵辛社区', lat: 37.4414, lng: 116.3692, level: '重点关注', owner: '高建平 · 护林联防班', gear: '风力灭火机 4 台 · 干粉灭火器 20 具', status: '秋冬干燥期每日三次巡山' },
  { id: 'eco-fire-2', kind: 'fire', name: '岳庄东南林地防火卡口', community: '岳庄社区', lat: 37.4242, lng: 116.3645, level: '重点关注', owner: '曹国栋 · 护林联防班', gear: '高压细水雾 2 套 · 防火铁扫把 30 把', status: '严控野外用火，卡口值守正常' },
  { id: 'eco-fire-3', kind: 'fire', name: '芦李府南片林缘农田交界点', community: '芦李府社区', lat: 37.4205, lng: 116.3578, level: '红牌重点', owner: '芦建明 · 应急扑火分队', gear: '水带 200 米 · 灭火器 24 具 · 巡逻车 1 辆', status: '重点盯防秸秆禁烧与林缘火源' },
  { id: 'eco-fire-4', kind: 'fire', name: '郭家庵减河防护林防火点', community: '郭家庵社区', lat: 37.4222, lng: 116.3698, level: '常规盯防', owner: '郭秀莲 · 河林协管员', gear: '背负式灭火器 6 具 · 宣传广播 2 套', status: '值班巡护正常' }
]

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

function polyAreaXZ(pts) {
  let sum = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    sum += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1])
  }
  return Math.abs(sum) * 0.5
}

function hashInt(n) {
  let x = (n + 1) * 2654435761
  x = ((x >>> 16) ^ x) * 0x45d9f3b
  return ((x >>> 16) ^ x) >>> 0
}

let cachedIndex = null
let cachedIndexPromise = null

function createBuildingIndexBuilder() {
  // 1. 预计算 14 社区 XZ 多边形与质心
  const commPolys = COMMUNITIES.map((c) => {
    const geo = CHANGHE_COMMUNITY_GEO[c.name]
    const polyXZ = (geo ? geo.polygon : c.polygon).map(([lat, lng]) => latLngToWorldXZ(lat, lng))
    const centerXZ = latLngToWorldXZ(c.center[0], c.center[1])
    return { community: c, name: c.name, polyXZ, centerXZ }
  })

  const buildings = []
  const spatialGrid = new Map() // "gx,gz" -> number[]
  const commCounters = {}
  COMMUNITIES.forEach((c) => { commCounters[c.name] = 0 })

  const addCell = (gx, gz, idx) => {
    const key = `${gx},${gz}`
    let arr = spatialGrid.get(key)
    if (!arr) {
      arr = []
      spatialGrid.set(key, arr)
    }
    arr.push(idx)
  }

  const rawList = amapPolyData.buildings

  function processOne(idx) {
    const [pts, height, isInner] = rawList[idx]
    if (!pts || pts.length < 3) {
      buildings.push(null)
      return
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
    let sx = 0, sz = 0
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
      sx += x
      sz += z
    }
    const cx = sx / pts.length
    const cz = sz / pts.length
    const areaUnits = polyAreaXZ(pts)
    const areaM2 = Math.max(120, Math.round(areaUnits * 100)) // 1 unit² = 100 m²
    const floors = Math.max(2, Math.min(32, Math.round(height * 2.6)))

    // 归属社区（仅对辖区内建筑精确落区）
    let commName = ''
    let commObj = null
    if (isInner) {
      for (let i = 0; i < commPolys.length; i++) {
        if (pointInPolyXZ(cx, cz, commPolys[i].polyXZ)) {
          commName = commPolys[i].name
          commObj = commPolys[i].community
          break
        }
      }
      if (!commObj) {
        let bestD = Infinity
        for (let i = 0; i < commPolys.length; i++) {
          const d = Math.hypot(cx - commPolys[i].centerXZ[0], cz - commPolys[i].centerXZ[1])
          if (d < bestD) {
            bestD = d
            commName = commPolys[i].name
            commObj = commPolys[i].community
          }
        }
      }
    }

    const hSeed = hashInt(idx)
    const realEntry = isInner ? realBuildingLabels[String(idx)] : null
    const realName = realEntry ? realEntry[0] : ''
    const realEstate = realEntry ? realEntry[1] : ''

    let category = 'residential' // residential | commercial | district | public
    if (isInner) {
      const checkStr = `${realName} ${realEstate}`
      if (/广场|大厦|写字楼|商务|科技园|产业园|创业园|汽配城|中心/.test(checkStr) && !/社区|服务|生活区|学生公寓/.test(checkStr)) {
        category = height <= 2.5 ? 'district' : 'commercial'
      } else if (/学院|学校|中学|小学|幼儿园|医院|派出所|政府|法院|检察院|局|综合服务用房|文化|党群/.test(checkStr) && !/学生公寓|生活区|家属院|宿舍/.test(checkStr)) {
        category = 'public'
      } else if (/商铺|商业|商街|市场|门市/.test(checkStr) || (height <= 2.3 && areaM2 >= 650 && hSeed % 3 === 0)) {
        category = 'district'
      } else {
        const isBizHub = commName === '星凯社区' || commName === '泰和社区' || commName === '德馨社区'
        if (!realName && areaM2 >= 1800 && height >= 4.2 && (isBizHub || hSeed % 7 === 0)) {
          category = 'commercial'
        } else if (!realName && areaM2 >= 2400 && height <= 4.5 && hSeed % 5 === 0) {
          category = 'public'
        }
      }
    }

    let name = '周边片区建筑'
    let estate = realEstate
    let gridName = ''
    let households = 0
    let estimatedPop = 0
    let elderAloneCount = 0
    let careTotal = 0
    let partyMembers = 0
    let revenueYi = 0
    let baseHazard = false
    let floodNear = false

    if (isInner && commObj) {
      const seq = ++commCounters[commName]
      if (realName) {
        name = realName
        estate = realEstate || realName.replace(/(?:[A-Z]?\d+\s*(?:号楼|幢|栋|座)|综合服务用房|配套\d+号楼)$/, '')
      } else {
        const estates = COMMUNITY_ESTATES[commName] || [commName.replace('社区', '') + '小区']
        estate = category === 'commercial'
          ? (commName === '星凯社区' ? '星凯国际广场' : `${commName.replace('社区', '')}商务中心`)
          : category === 'district'
            ? estates[3] || `${commName.replace('社区', '')}沿街商铺`
            : category === 'public'
              ? `${commName.replace('社区', '')}公共服务配套`
              : estates[seq % 3]
        const bldgNo = (seq % 28) + 1
        name = category === 'commercial'
          ? `${estate}${['A', 'B', 'C', 'D'][seq % 4]}座`
          : category === 'district'
            ? `${estate}${bldgNo}号楼`
            : `${estate}${bldgNo}号楼`
      }

      const gridIdx = (seq % commObj.grids) + 1
      gridName = `第${['一', '二', '三', '四', '五', '六', '七', '八', '九'][gridIdx - 1] || gridIdx}网格`

      const unitsPerFloor = areaM2 >= 900 ? 4 : 2
      households = category === 'residential' ? floors * unitsPerFloor : Math.max(4, Math.round(floors * 1.5))
      estimatedPop = category === 'residential' ? Math.round(households * 2.45) : Math.round(households * 9.5)

      // 确定性分配重点关怀与经济/安全特征，让五章专题着色有真实的空间集聚层次
      const elderSeed = hSeed % 100
      elderAloneCount = category === 'residential'
        ? (elderSeed < 14 ? 3 + (hSeed % 4) : elderSeed < 32 ? 1 + (hSeed % 2) : 0)
        : 0
      careTotal = elderAloneCount + (category === 'residential' && elderSeed < 28 ? 1 + (hSeed % 3) : 0)
      partyMembers = Math.max(1, Math.round((commObj.party / 140) * (1 + (hSeed % 4))))
      revenueYi = category === 'commercial'
        ? +(1.2 + ((hSeed % 48) / 10)).toFixed(1)
        : category === 'district'
          ? +(0.3 + ((hSeed % 12) / 10)).toFixed(1)
          : 0

      // 少量楼栋自带基础安全关注（与社区健康度联动）
      const hzProb = commObj.health === 'bad' ? 9 : commObj.health === 'warn' ? 5 : 2
      baseHazard = (hSeed % 100) < hzProb
      floodNear = commObj.env.floodPts >= 2 && (hSeed % 100) < 18
    }

    const meta = {
      index: idx,
      pts,
      height,
      isInner: Boolean(isInner),
      cx,
      cz,
      minX,
      maxX,
      minZ,
      maxZ,
      areaM2,
      floors,
      community: commName,
      estate,
      gridName,
      category,
      name,
      households,
      estimatedPop,
      elderAloneCount,
      careTotal,
      partyMembers,
      revenueYi,
      baseHazard,
      floodNear,
      profileKey: null, // 'residential' | 'commercial' | 'district' | null
      isLandmark: false,
      landmarkShort: ''
    }
    buildings.push(meta)

    if (isInner) {
      const gx0 = Math.floor(minX / GRID_CELL)
      const gx1 = Math.floor(maxX / GRID_CELL)
      const gz0 = Math.floor(minZ / GRID_CELL)
      const gz1 = Math.floor(maxZ / GRID_CELL)
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gz = gz0; gz <= gz1; gz++) {
          addCell(gx, gz, idx)
        }
      }
    }
  }

  function finalize() {

  // 2. 将 4 处核心标杆楼精准锚定到对应社区真实多边形建筑上
  function anchorLandmark({ commName, targetLatLng, preferHigh, preferLow, profileKey, name, landmarkShort, category }) {
    const [tx, tz] = latLngToWorldXZ(targetLatLng[0], targetLatLng[1])
    let best = null
    let bestScore = Infinity
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i]
      if (!b || !b.isInner || b.isLandmark) continue
      if (commName && b.community !== commName) continue
      const d = Math.hypot(b.cx - tx, b.cz - tz)
      let penalty = d
      if (preferHigh) penalty -= b.height * 6
      if (preferLow) penalty += b.height * 5
      if (penalty < bestScore) {
        bestScore = penalty
        best = b
      }
    }
    if (best) {
      if (!best.name || best.name === '周边片区建筑') {
        best.name = name
      }
      best.landmarkShort = best.name || landmarkShort
      best.profileKey = profileKey
      best.isLandmark = true
      best.category = category
      if (profileKey === 'residential') {
        best.floors = 18
        best.households = 72
        best.estimatedPop = 184
        best.elderAloneCount = 6
        best.careTotal = 12
        best.baseHazard = true
      } else if (profileKey === 'commercial') {
        best.floors = 18
        best.households = 26
        best.estimatedPop = 886
        best.revenueYi = 27.8
        best.baseHazard = true
      } else if (profileKey === 'district') {
        best.floors = 3
        best.households = 16
        best.estimatedPop = 92
        best.revenueYi = 4.6
        best.baseHazard = true
      }
    }
    return best
  }

  const lmRes = anchorLandmark({
    commName: '八里庄社区',
    targetLatLng: [37.4568, 116.3532],
    preferHigh: true,
    profileKey: 'residential',
    name: '八里庄盛世华园3号楼',
    landmarkShort: '八里庄盛世华园3号楼',
    category: 'residential'
  })

  const lmBiz = anchorLandmark({
    commName: '星凯社区',
    targetLatLng: [37.4425, 116.3422],
    preferHigh: true,
    profileKey: 'commercial',
    name: '星凯国际广场11栋',
    landmarkShort: '星凯国际广场',
    category: 'commercial'
  })

  const lmDist = anchorLandmark({
    commName: '泰和社区',
    targetLatLng: [37.4372, 116.3385],
    preferLow: true,
    profileKey: 'district',
    name: '泰和·名仕馨港商业街',
    landmarkShort: '泰和·名仕馨港',
    category: 'district'
  })

  const lmHazard = anchorLandmark({
    commName: '堤口社区',
    targetLatLng: [37.4508, 116.3408],
    preferLow: true,
    profileKey: null,
    name: '嘉诚·尚东A区8号楼',
    landmarkShort: '嘉诚·尚东A区',
    category: 'district'
  })
  if (lmHazard) {
    lmHazard.baseHazard = true
    lmHazard.elderAloneCount = 4
    lmHazard.careTotal = 8
  }

  const landmarks = [lmRes, lmBiz, lmDist, lmHazard].filter(Boolean)

  // 2.5 聚合全街道真实小区/园区中心点与代表主楼（用于在 3D 地图上对应显示每个小区的标题铭牌）
  const estateMap = new Map()
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i]
    if (!b || !b.isInner || !b.estate) continue
    const baseEst = b.estate.replace(/(?:[A-G]区|[一二三四五1-5]期|北区|南区|东区|西区)$/, '').trim()
    const key = baseEst.length >= 2 ? baseEst : b.estate
    let grp = estateMap.get(key)
    if (!grp) {
      grp = { name: key, sx: 0, sz: 0, count: 0, maxH: 0, community: b.community, category: b.category, members: [] }
      estateMap.set(key, grp)
    }
    grp.sx += b.cx
    grp.sz += b.cz
    grp.count++
    if (b.height > grp.maxH) grp.maxH = b.height
    grp.members.push(b)
  }

  const lmNames = new Set(landmarks.map((b) => (b.estate || b.landmarkShort || b.name || '').replace(/(?:[A-G]区|[一二三四五1-5]期|北区|南区|东区|西区)$/, '').trim()))
  const estateLandmarks = []
  Array.from(estateMap.values())
    .filter((g) => (g.count >= 5 || /利安大厦|东汇大厦|中盛大厦/.test(g.name)) && !lmNames.has(g.name))
    .sort((a, b) => b.count - a.count)
    .slice(0, 48)
    .forEach((g) => {
      const cx = g.sx / g.count
      const cz = g.sz / g.count
      // 选距离小区中心最近的主楼作为该小区的代表锚点楼
      let lead = g.members[0]
      let bestD = Infinity
      for (let k = 0; k < g.members.length; k++) {
        const m = g.members[k]
        const d = Math.hypot(m.cx - cx, m.cz - cz) - m.height * 0.6
        if (d < bestD) {
          bestD = d
          lead = m
        }
      }
      estateLandmarks.push({
        id: `est-${lead.index}`,
        entityType: 'estate',
        buildingIndex: lead.index,
        name: g.name,
        shortLabel: g.name,
        community: lead.community,
        category: lead.category,
        count: g.count,
        x: cx,
        y: Math.min(14, Math.max(6, g.maxH + 1.8)),
        z: cz
      })
    })

  // 3. O(1) 格网拾取函数
  function pickBuildingAtXZ(x, z) {
    const gx = Math.floor(x / GRID_CELL)
    const gz = Math.floor(z / GRID_CELL)
    const visited = new Set()
    let nearest = null
    let nearestDist = 2.6 // 26 米吸附容差（便于高空斜视准确点中）

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const arr = spatialGrid.get(`${gx + dx},${gz + dz}`)
        if (!arr) continue
        for (let k = 0; k < arr.length; k++) {
          const idx = arr[k]
          if (visited.has(idx)) continue
          visited.add(idx)
          const b = buildings[idx]
          if (!b || !b.isInner) continue
          if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) {
            if (pointInPolyXZ(x, z, b.pts)) {
              return b
            }
          }
          const d = Math.hypot(x - b.cx, z - b.cz)
          if (d < nearestDist) {
            nearestDist = d
            nearest = b
          }
        }
      }
    }
    return nearest
  }

  // 查找给定经纬度或 XZ 坐标最近的辖区真实建筑（用于事件落楼）
  function findNearestBuildingXZ(x, z, communityName = '') {
    const direct = pickBuildingAtXZ(x, z)
    if (direct && (!communityName || direct.community === communityName)) return direct

    let best = null
    let bestD = Infinity
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i]
      if (!b || !b.isInner) continue
      if (communityName && b.community !== communityName) continue
      const d = Math.hypot(b.cx - x, b.cz - z)
      if (d < bestD) {
        bestD = d
        best = b
      }
    }
    return best
  }

  const careBuildingsList = buildings.filter((b) => b && b.isInner && b.elderAloneCount > 0)

  cachedIndex = {
    buildings,
    landmarks,
    estateLandmarks,
    careBuildingsList,
    totalCount: buildings.length,
    pickBuildingAtXZ,
    findNearestBuildingXZ
  }
  return cachedIndex
  }

  return { total: rawList.length, processOne, finalize }
}

/**
 * 构建 4,205 栋建筑的语义目录与 50m 空间格网哈希索引（单例缓存）
 */
export function getCockpitBuildingIndex() {
  if (cachedIndex) return cachedIndex
  const builder = createBuildingIndexBuilder()
  for (let i = 0; i < builder.total; i++) {
    builder.processOne(i)
  }
  return builder.finalize()
}

/**
 * 分片异步构建 4,205 栋建筑空间索引，每片控制在 ~3.2ms，确保加载幕布 60fps 不掉帧
 */
export function getCockpitBuildingIndexAsync(yieldFn) {
  if (cachedIndex) return Promise.resolve(cachedIndex)
  if (cachedIndexPromise) return cachedIndexPromise
  cachedIndexPromise = (async () => {
    const builder = createBuildingIndexBuilder()
    let idx = 0
    while (idx < builder.total) {
      const t0 = performance.now()
      let cnt = 0
      while (idx < builder.total && (cnt < 30 || performance.now() - t0 < 3.2)) {
        builder.processOne(idx++)
        cnt++
      }
      if (idx < builder.total && yieldFn) await yieldFn()
    }
    if (yieldFn) await yieldFn()
    return builder.finalize()
  })().finally(() => {
    cachedIndexPromise = null
  })
  return cachedIndexPromise
}

let cachedEventMapSig = ''
let cachedEventMapResult = null

/**
 * 将全站治理事件映射到对应真实 3D 建筑索引（按关键字段签名缓存，避免多处重复计算）
 */
export function buildEventBuildingMap(events) {
  const listIn = events || []
  let sig = ''
  for (let i = 0; i < listIn.length; i++) {
    const ev = listIn[i]
    sig += `${ev.id}:${ev.stage}:${ev.buildingIndex ?? ''}:${ev.lat ?? ''}:${ev.lng ?? ''}:${ev.community ?? ''}|`
  }
  if (cachedEventMapResult && sig === cachedEventMapSig) {
    return cachedEventMapResult
  }

  const index = getCockpitBuildingIndex()
  const map = new Map() // buildingIndex -> event[]
  const eventToBldg = new Map() // eventId -> buildingMeta

  listIn.forEach((ev) => {
    let b = null
    if (typeof ev.buildingIndex === 'number' && index.buildings[ev.buildingIndex]) {
      b = index.buildings[ev.buildingIndex]
    } else if (ev.title?.includes('锦绣家园 3 号楼')) {
      b = index.landmarks.find((l) => l.profileKey === 'residential') || null
    } else if (ev.title?.includes('星凯')) {
      b = index.landmarks.find((l) => l.profileKey === 'commercial') || null
    } else if (ev.title?.includes('堤口东路')) {
      b = index.landmarks.find((l) => l.community === '堤口社区') || null
    }
    if (!b && typeof ev.lat === 'number' && typeof ev.lng === 'number') {
      const [ex, ez] = latLngToWorldXZ(ev.lat, ev.lng)
      b = index.findNearestBuildingXZ(ex, ez, ev.community)
    }
    if (!b) return
    eventToBldg.set(ev.id, b)
    let list = map.get(b.index)
    if (!list) {
      list = []
      map.set(b.index, list)
    }
    list.push(ev)
  })

  cachedEventMapSig = sig
  cachedEventMapResult = { bldgToEvents: map, eventToBldg }
  return cachedEventMapResult
}

/**
 * 生成四类 3D 治理实体点位（与 COMMUNITIES 与 store 实时同步）
 */
export function buildCockpitEntities(store) {
  const index = getCockpitBuildingIndex()
  const patrolMap = new Map()
  ;(store.patrolRecords || []).forEach((p) => {
    patrolMap.set(p.community, p)
  })

  // 1. 14 名在岗专职网格员
  const gridStaff = COMMUNITIES.map((c, idx) => {
    const seed = COMMUNITY_STAFF_SEEDS[c.name] || {
      name: `${c.lead.slice(0, 1)}明`,
      phone: c.phone,
      grid: '第一网格',
      task: '日常网格入户走访与安全巡查'
    }
    const patrol = patrolMap.get(c.name)
    let lat = c.center[0] + (idx % 2 === 0 ? 0.0011 : -0.0012)
    let lng = c.center[1] + (idx % 3 === 0 ? -0.0014 : 0.0015)
    if (patrol?.track?.length) {
      const last = patrol.track[patrol.track.length - 1]
      lat = last.lat
      lng = last.lng
    }
    const [x, z] = latLngToWorldXZ(lat, lng)
    const openAssigned = (store.events || []).filter(
      (e) => e.stage !== '已办结' && (e.owner?.includes(seed.name) || e.reporter === seed.name)
    ).length
    const isAnom = patrol ? patrol.stayMinutes > 30 : false
    return {
      id: `staff-${c.id}`,
      entityType: 'staff',
      name: seed.name,
      shortLabel: `网格员·${seed.name}`,
      community: c.name,
      grid: patrol?.grid || seed.grid,
      phone: seed.phone,
      lead: c.lead,
      task: patrol?.stayPlace || seed.task,
      km: patrol?.km || +(3.2 + (idx % 5) * 0.4).toFixed(1),
      mustPoints: patrol ? `${patrol.mustPointsDone}/${patrol.mustPointsTotal}` : '6/8',
      status: isAnom ? '滞留提醒' : openAssigned > 0 ? '在办处置' : '在岗巡查',
      openAssigned,
      lat,
      lng,
      x,
      z
    }
  })

  // 2. 14 处共享辅助站（实时读 c.gov.aidStation 库存）
  const aidStations = COMMUNITIES.map((c, idx) => {
    const lat = c.center[0] + (idx % 2 === 0 ? -0.0009 : 0.0009)
    const lng = c.center[1] + (idx % 2 === 0 ? -0.0012 : 0.0012)
    const [x, z] = latLngToWorldXZ(lat, lng)
    const st = c.gov.aidStation
    const totalItems = st.wheelchair + st.crutch + st.medkit + st.toolbox + st.umbrella
    return {
      id: `aid-${c.id}`,
      entityType: 'aid',
      name: `${c.name}共享辅助站`,
      shortLabel: `${c.name.replace('社区', '')}辅助站`,
      community: c.name,
      lead: c.lead,
      phone: c.phone,
      address: `${c.name}党群服务中心一楼便民驿站`,
      items: st,
      totalItems,
      lat,
      lng,
      x,
      z
    }
  })

  // 3. 8 处易涝积水与林缘防火盯防点
  const ecoRisks = ECO_RISK_SEEDS.map((pt) => {
    const [x, z] = latLngToWorldXZ(pt.lat, pt.lng)
    return {
      ...pt,
      entityType: 'eco',
      shortLabel: pt.kind === 'flood' ? `易涝·${pt.community.replace('社区', '')}` : `防火·${pt.community.replace('社区', '')}`,
      x,
      z
    }
  })

  // 4. 重点标杆楼宇地标 + 全街道真实小区标题铭牌
  const landmarks = index.landmarks.map((b) => ({
    id: `lm-${b.index}`,
    entityType: 'landmark',
    buildingIndex: b.index,
    name: b.name,
    shortLabel: b. estate || b.landmarkShort || b.name,
    community: b.community,
    category: b.category,
    isCoreLandmark: true,
    x: b.cx,
    y: b.height + 1.8,
    z: b.cz
  }))

  const estates = index.estateLandmarks || []

  return { gridStaff, aidStations, ecoRisks, landmarks, estates }
}

/**
 * 计算单栋建筑的完整「一楼一档」视图数据（标杆楼挂接 store.buildingProfiles，普通楼按真实属性动态生成，绝无空楼）
 */
export function buildBuildingDetail(bldg, store) {
  if (!bldg) return null
  const comm = COMMUNITIES.find((c) => c.name === bldg.community) || COMMUNITIES[0]
  const staffSeed = COMMUNITY_STAFF_SEEDS[comm.name] || { name: '网格专干', phone: comm.phone, grid: '第一网格' }
  const { bldgToEvents } = buildEventBuildingMap(store.events)
  const linkedEvents = bldgToEvents.get(bldg.index) || []
  const openEvents = linkedEvents.filter((e) => e.stage !== '已办结')

  const categoryLabels = {
    residential: '高层/多层住宅楼',
    commercial: '重点商务办公楼宇',
    district: '沿街商业与九小场所',
    public: '社区公共服务配套'
  }

  // 标杆楼直接读取 store.buildingProfiles 实时数据
  if (bldg.profileKey === 'residential' && store.buildingProfiles?.residential) {
    const prof = store.buildingProfiles.residential
    const rooms = Object.entries(prof.rooms || {}).map(([key, r]) => ({ key, ...r }))
    const hazardRooms = rooms.filter((r) => r.hazard)
    const careRooms = rooms.filter((r) => r.careTags?.length)
    return {
      bldg,
      mode: 'residential-full',
      title: bldg.name || prof.buildingName,
      estate: bldg.estate || '',
      typeLabel: prof.buildingType || '18 层两梯两户高层住宅',
      community: bldg.community,
      gridName: `${bldg.community} · ${bldg.gridName}`,
      propertyOrg: `${bldg.estate || bldg.community.replace('社区', '')}物业服务中心`,
      gridLead: prof.gridLead || comm.lead,
      leadPhone: comm.phone,
      gridStaff: prof.gridStaff || staffSeed.name,
      staffPhone: staffSeed.phone,
      floorsCount: prof.floors.length,
      households: rooms.length,
      estimatedPop: rooms.reduce((a, r) => a + Number(r.peopleCount || 0), 0),
      careCount: careRooms.length,
      hazardCount: hazardRooms.length + openEvents.length,
      linkedEvents,
      openEvents,
      profile: prof
    }
  }

  if (bldg.profileKey === 'commercial' && store.buildingProfiles?.commercial) {
    const prof = store.buildingProfiles.commercial
    const hazardFloors = (prof.floors || []).filter((f) => f.safety && f.safety !== '达标')
    return {
      bldg,
      mode: 'commercial-full',
      title: bldg.name || prof.buildingName,
      estate: bldg.estate || '',
      typeLabel: '重点商务办公楼宇（规上企业集聚）',
      community: bldg.community,
      gridName: `${bldg.community} · 商务专属网格`,
      propertyOrg: `${bldg.estate || '星凯国际广场'}物业服务中心`,
      gridLead: prof.gridLead || comm.lead,
      leadPhone: comm.phone,
      gridStaff: prof.gridStaff || staffSeed.name,
      staffPhone: staffSeed.phone,
      floorsCount: 18,
      households: prof.floors.length,
      estimatedPop: prof.floors.reduce((a, f) => a + Number(f.employees || 0), 0),
      careCount: 0,
      hazardCount: hazardFloors.length + openEvents.length,
      revenueLabel: '27.8 亿元',
      linkedEvents,
      openEvents,
      profile: prof
    }
  }

  if (bldg.profileKey === 'district' && store.buildingProfiles?.district) {
    const prof = store.buildingProfiles.district
    const allShops = [...(prof.northShops || []), ...(prof.southShops || [])]
    const warnShops = allShops.filter((s) => s.safety?.includes('重点') || s.events > 0)
    return {
      bldg,
      mode: 'district-full',
      title: bldg.name,
      estate: bldg.estate || '',
      typeLabel: '沿街商业与九小场所示范段',
      community: bldg.community,
      gridName: prof.gridName || `${bldg.community} · 沿街商圈网格`,
      propertyOrg: '街道综合执法与商圈自治协会',
      gridLead: prof.gridLead || comm.lead,
      leadPhone: comm.phone,
      gridStaff: prof.gridStaff || staffSeed.name,
      staffPhone: staffSeed.phone,
      floorsCount: 3,
      households: allShops.length,
      estimatedPop: allShops.length * 11,
      careCount: 0,
      hazardCount: warnShops.length + openEvents.length,
      linkedEvents,
      openEvents,
      profile: prof
    }
  }

  // 普通辖区建筑（2,195 栋）：按真实高度、面积、社区底数与事件实时生成完整可查楼层简图，绝无空楼
  const floorTotal = Math.min(18, Math.max(3, bldg.floors))
  const seed = hashInt(bldg.index)
  const surnames = ['张', '王', '李', '赵', '刘', '陈', '杨', '周', '吴', '郑', '孙', '马', '高', '韩']
  const givenNames = ['建国', '秀兰', '志强', '桂芳', '明远', '海燕', '国强', '淑芬', '文涛', '丽华', '晓东', '德明']

  const generatedFloors = []
  let careCount = 0
  let hazardCount = openEvents.length

  if (bldg.category === 'commercial') {
    const industries = ['智能制造', '数字经济', '现代服务', '商贸物流', '科技研发', '金融咨询']
    const count = Math.min(8, Math.max(4, Math.round(floorTotal / 2)))
    for (let i = 0; i < count; i++) {
      const fl = floorTotal - i * 2
      if (fl < 1) break
      const isWarn = bldg.baseHazard && i === 1
      if (isWarn) hazardCount++
      const ind = industries[(seed + i) % industries.length]
      generatedFloors.push({
        floor: `${fl}层`,
        company: `${bldg.community.replace('社区', '')}${['智联', '华通', '鲁北', '天衢', '宏达', '盛泰'][(seed + i) % 6]}${ind}有限公司`,
        industry: ind,
        employees: 18 + ((seed + i * 13) % 65),
        revenue: `${(0.6 + ((seed + i * 7) % 34) / 10).toFixed(1)} 亿元`,
        safety: isWarn ? '待复查（配电间巡检提醒）' : '达标'
      })
    }
  } else {
    const showFloors = Math.min(floorTotal, 8)
    for (let i = 0; i < showFloors; i++) {
      const fl = floorTotal - i
      const rooms = ['01', '02'].map((rm, rIdx) => {
        const rs = hashInt(bldg.index * 31 + fl * 7 + rIdx)
        const status = rs % 10 === 9 ? '空置' : (rs % 5 === 1 ? '出租' : '自住')
        const careTags = []
        if (bldg.elderAloneCount > 0 && i === 1 && rIdx === 0) careTags.push('独居高龄')
        else if (bldg.careTotal > 1 && i === 2 && rIdx === 1) careTags.push('退役优抚')
        if (careTags.length) careCount++
        const hazard = (bldg.baseHazard && i === 0 && rIdx === 0) ? '消防通道堆物待清理' : ''
        if (hazard) hazardCount++
        const owner = surnames[rs % surnames.length] + givenNames[(rs >>> 4) % givenNames.length]
        return {
          room: `${fl}${rm}`,
          status,
          peopleCount: status === '空置' ? 0 : (rs % 3) + 1,
          owner,
          phone: `13${5 + (rs % 4)}534${String(10000 + (rs % 89999)).slice(0, 5)}`,
          careTags,
          hazard
        }
      })
      generatedFloors.push({ floor: fl, rooms })
    }
  }

  return {
    bldg,
    mode: bldg.category === 'commercial' ? 'commercial-lite' : 'residential-lite',
    title: bldg.name,
    estate: bldg.estate || '',
    typeLabel: categoryLabels[bldg.category] || '社区建筑',
    community: bldg.community,
    gridName: `${bldg.community} · ${bldg.gridName}`,
    propertyOrg: `${bldg.estate || bldg.community.replace('社区', '')}物业服务中心`,
    gridLead: comm.lead,
    leadPhone: comm.phone,
    gridStaff: staffSeed.name,
    staffPhone: staffSeed.phone,
    floorsCount: bldg.floors,
    households: bldg.households,
    estimatedPop: bldg.estimatedPop,
    careCount: Math.max(careCount, bldg.careTotal),
    hazardCount,
    revenueLabel: bldg.revenueYi ? `${bldg.revenueYi} 亿元` : '',
    linkedEvents,
    openEvents,
    generatedFloors
  }
}

/**
 * 300 米应急空间联动查询（radiusUnits = 30，对应 300 米）
 */
export function queryEmergencyRadius(cx, cz, radiusUnits = 30, store) {
  const index = getCockpitBuildingIndex()
  const entities = buildCockpitEntities(store)

  // 1. 周边网格员（优先 300 米内，同时保证返回最近的 3 名供一键派单）
  const staffSorted = entities.gridStaff
    .map((s) => {
      const d = Math.hypot(s.x - cx, s.z - cz)
      return { ...s, distUnits: d, distMeters: Math.round(d * 10) }
    })
    .sort((a, b) => a.distUnits - b.distUnits)
  const staffInRadius = staffSorted.filter((s) => s.distUnits <= radiusUnits)
  const nearbyStaff = staffInRadius.length ? staffInRadius.slice(0, 3) : staffSorted.slice(0, 2)

  // 2. 周边共享辅助站（300 米内优先，兜底返回最近 1 处）
  const aidSorted = entities.aidStations
    .map((a) => {
      const d = Math.hypot(a.x - cx, a.z - cz)
      return { ...a, distUnits: d, distMeters: Math.round(d * 10) }
    })
    .sort((a, b) => a.distUnits - b.distUnits)
  const aidInRadius = aidSorted.filter((a) => a.distUnits <= radiusUnits)
  const nearbyAids = aidInRadius.length ? aidInRadius.slice(0, 2) : aidSorted.slice(0, 1)

  // 3. 300 米内独居高龄重点关怀楼栋（仅遍历预过滤的关怀楼栋列表）
  const careBuildings = []
  const careList = index.careBuildingsList || index.buildings
  for (let i = 0; i < careList.length; i++) {
    const b = careList[i]
    const d = Math.hypot(b.cx - cx, b.cz - cz)
    if (d <= radiusUnits && d > 0.2) {
      careBuildings.push({
        index: b.index,
        name: b.name,
        community: b.community,
        elderAloneCount: b.elderAloneCount,
        cx: b.cx,
        cz: b.cz,
        distMeters: Math.round(d * 10)
      })
    }
  }
  careBuildings.sort((a, b) => a.distMeters - b.distMeters)

  // 4. 300 米内防汛防火盯防点
  const nearbyEco = entities.ecoRisks
    .map((p) => {
      const d = Math.hypot(p.x - cx, p.z - cz)
      return { ...p, distUnits: d, distMeters: Math.round(d * 10) }
    })
    .filter((p) => p.distUnits <= radiusUnits * 1.4)
    .sort((a, b) => a.distUnits - b.distUnits)
    .slice(0, 2)

  return {
    center: { x: cx, z: cz },
    radiusUnits,
    radiusMeters: Math.round(radiusUnits * 10),
    nearbyStaff,
    nearbyAids,
    careBuildings: careBuildings.slice(0, 6),
    careBuildingsTotal: careBuildings.length,
    careElderSum: careBuildings.reduce((a, b) => a + b.elderAloneCount, 0),
    nearbyEco
  }
}

export { CHANGHE_HQ_LATLNG }
