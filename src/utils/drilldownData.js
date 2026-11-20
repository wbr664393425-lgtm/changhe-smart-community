import { COMMUNITIES } from '../store/appStore'
import { maskValue } from './validators'

const SURNAMES = [
  '张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴',
  '徐', '孙', '胡', '朱', '高', '林', '何', '郭', '马', '罗',
  '梁', '宋', '郑', '谢', '韩', '唐', '冯', '于', '董', '萧',
  '程', '曹', '袁', '邓', '许', '傅', '沈', '曾', '彭', '吕'
]

const GIVEN_NAMES = [
  '伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '军', '洋',
  '勇', '艳', '杰', '娟', '涛', '明', '超', '霞', '平', '刚',
  '桂英', '建国', '秀兰', '建华', '志强', '海燕', '文博', '晓梅', '淑芬', '国栋',
  '振华', '立军', '玉梅', '海波', '晓东', '春梅', '建明', '丽华', '宏伟', '秀英',
  '永刚', '亚男', '志勇', '丹丹', '明远', '雅琴', '建平', '红霞', '国强', '思雨'
]

const GRID_NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']

function pick(arr, seed) {
  return arr[Math.abs(seed) % arr.length]
}

function makeName(seed) {
  return pick(SURNAMES, seed * 7 + 3) + pick(GIVEN_NAMES, seed * 13 + 5)
}

function makePhone(seed) {
  const prefixes = ['138', '139', '150', '151', '158', '159', '186', '188', '135', '137']
  const mid = String(1000 + ((seed * 397) % 9000))
  const tail = String(1000 + ((seed * 733) % 9000))
  return maskValue('phone', `${pick(prefixes, seed)}${mid}${tail}`)
}

function splitExact(total, count, seedBase) {
  if (count <= 0) return []
  const weights = Array.from({ length: count }, (_, i) => 70 + (((seedBase + i * 19) * 37) % 60))
  const wSum = weights.reduce((a, b) => a + b, 0)
  const parts = weights.map((w) => Math.max(1, Math.floor((total * w) / wSum)))
  let diff = total - parts.reduce((a, b) => a + b, 0)
  let idx = 0
  while (diff > 0) {
    parts[idx % count] += 1
    diff -= 1
    idx += 1
  }
  while (diff < 0) {
    if (parts[idx % count] > 1) {
      parts[idx % count] -= 1
      diff += 1
    }
    idx += 1
  }
  return parts
}

function communityFilterConfig(communities, initialCommunity = '') {
  if (communities.length <= 1) return []
  return [
    {
      key: 'community',
      label: '所属社区',
      allLabel: '全部社区',
      options: communities.map((c) => c.name),
      defaultValue: initialCommunity || ''
    }
  ]
}

// 1. 专职网格员花名册（与 COMMUNITIES.gridStaff 100% 同源，全街道精确 94 名）
export function buildGridStaffDrill(communities, scope, initialCommunity = '') {
  const politicsList = ['中共党员', '中共党员', '预备党员', '共青团员', '群众', '群众']
  const eduList = ['本科', '本科', '大专', '大专', '大专', '高中/中专']
  const statusList = ['在岗巡查', '在岗巡查', '入户走访', '在岗巡查', '窗口值守', '入户走访', '外出培训']
  const ratingList = ['优秀', '良好', '良好', '优秀', '合格', '良好']
  const areaTags = ['住宅小区片区', '沿街商铺带', '学校周边片区', '回迁安置区', '农贸与便民区', '楼宇经济片区']

  const rows = []
  communities.forEach((c, cIdx) => {
    const gridHomes = splitExact(c.housing.homes, c.gridStaff, cIdx * 31 + 7)
    for (let i = 0; i < c.gridStaff; i++) {
      const seed = cIdx * 53 + i * 17 + 11
      const isLiMin = c.name === '德馨社区' && i === 0
      const name = isLiMin ? '李敏' : makeName(seed)
      const gridName = `第${GRID_NUMS[i] || i + 1}网格`
      const years = isLiMin ? 5 : 1 + (seed % 7)
      rows.push({
        name,
        community: c.name,
        grid: gridName,
        politics: isLiMin ? '中共党员' : pick(politicsList, seed),
        education: isLiMin ? '本科' : pick(eduList, seed + 2),
        years: `${years} 年`,
        households: `${gridHomes[i]} 户`,
        status: isLiMin ? '在岗巡查' : pick(statusList, seed + 3),
        rating: isLiMin ? '优秀' : pick(ratingList, seed + 5),
        phone: makePhone(seed + 101),
        remark: `包保${c.name}${gridName}（${pick(areaTags, seed)}），负责日常隐患巡查、入户核验与民情直报。`
      })
    }
  })

  return {
    title: '专职网格员名册与在岗态势明细',
    subtitle: `口径范围：${scope} · 与社区网格编制 100% 同源`,
    summary: `当前范围内共有专职网格员 ${rows.length} 名，其中在岗巡查 ${rows.filter((r) => r.status === '在岗巡查').length} 名、入户走访 ${rows.filter((r) => r.status === '入户走访').length} 名`,
    exportName: '数据智库_专职网格员名册',
    filters: [
      ...communityFilterConfig(communities, initialCommunity),
      { key: 'politics', label: '政治面貌', allLabel: '全部面貌', options: ['中共党员', '预备党员', '共青团员', '群众'] },
      { key: 'education', label: '文化程度', allLabel: '全部学历', options: ['本科', '大专', '高中/中专'] },
      { key: 'status', label: '在岗状态', type: 'chips', allLabel: '全部状态', options: ['在岗巡查', '入户走访', '窗口值守', '外出培训'] },
      { key: 'rating', label: '考核等次', allLabel: '全部等次', options: ['优秀', '良好', '合格'] }
    ],
    columns: [
      { key: 'name', label: '姓名' },
      { key: 'community', label: '所属社区' },
      { key: 'grid', label: '负责网格' },
      { key: 'politics', label: '政治面貌' },
      { key: 'education', label: '文化程度' },
      { key: 'years', label: '网格工龄', numeric: true },
      { key: 'households', label: '包保户数', numeric: true },
      {
        key: 'status',
        label: '当前状态',
        badgeMap: {
          '在岗巡查': 'st-ok',
          '入户走访': 'st-run',
          '窗口值守': 'st-neutral',
          '外出培训': 'st-warn'
        }
      },
      {
        key: 'rating',
        label: '年度考核',
        badgeMap: { '优秀': 'st-ok', '良好': 'st-run', '合格': 'st-neutral' }
      },
      { key: 'phone', label: '联系电话' }
    ],
    rows
  }
}

// 2. 社区两委班子名册（精确匹配 COMMUNITIES.committees，全街道 108 名）
export function buildCommitteesDrill(communities, scope, initialCommunity = '') {
  const duties = [
    { role: '党总支书记', line: '全面工作' },
    { role: '居委会主任', line: '社区政务与民生' },
    { role: '党总支副书记', line: '党建与宣传' },
    { role: '居委会副主任', line: '物业与环境治理' },
    { role: '组织委员', line: '党员发展与共建' },
    { role: '综治委员', line: '平安建设与调解' },
    { role: '民政委员', line: '养老救助与帮扶' },
    { role: '妇联主席', line: '妇儿权益与志愿' },
    { role: '武装干事', line: '民兵整组与双拥' },
    { role: '纪检委员', line: '居务监督与清廉' }
  ]
  const terms = ['连任两届及以上', '本届在任', '连任两届及以上', '本届在任']

  const rows = []
  communities.forEach((c, cIdx) => {
    for (let i = 0; i < c.committees; i++) {
      const seed = cIdx * 47 + i * 19 + 5
      const duty = duties[i % duties.length]
      rows.push({
        name: i === 0 ? c.lead : makeName(seed),
        community: c.name,
        role: duty.role,
        line: duty.line,
        politics: i < 5 ? '中共党员' : (seed % 3 === 0 ? '预备党员' : '中共党员'),
        term: pick(terms, seed),
        phone: i === 0 ? c.phone : makePhone(seed + 211),
        remark: `${c.name}${duty.role}，分管${duty.line}，牵头对接街道对应业务科室。`
      })
    }
  })

  return {
    title: '社区两委班子成员名册',
    subtitle: `口径范围：${scope} · 含社区党总支与居委会成员`,
    summary: `当前范围内社区两委成员共 ${rows.length} 名，覆盖 ${communities.length} 个社区党总支及居委会`,
    exportName: '数据智库_社区两委名册',
    filters: [
      ...communityFilterConfig(communities, initialCommunity),
      { key: 'role', label: '现任职务', allLabel: '全部职务' },
      { key: 'term', label: '任职情况', type: 'chips', allLabel: '全部届次', options: ['连任两届及以上', '本届在任'] }
    ],
    columns: [
      { key: 'name', label: '姓名' },
      { key: 'community', label: '所属社区' },
      { key: 'role', label: '现任职务' },
      { key: 'line', label: '分管条线' },
      { key: 'politics', label: '政治面貌', badgeMap: { '中共党员': 'st-party', '预备党员': 'st-run' } },
      { key: 'term', label: '任职情况' },
      { key: 'phone', label: '办公/联系电话' }
    ],
    rows
  }
}

// 3. 公益岗人员名册（精确匹配 COMMUNITIES.publicPost，全街道 156 名）
export function buildPublicPostDrill(communities, scope, initialCommunity = '') {
  const postTypes = ['环卫保洁', '治安巡防', '助老帮扶', '绿化养护', '便民引导']
  const statuses = ['正常在岗', '正常在岗', '正常在岗', '轮休调班', '正常在岗']
  const rows = []
  communities.forEach((c, cIdx) => {
    for (let i = 0; i < c.publicPost; i++) {
      const seed = cIdx * 61 + i * 13 + 9
      const post = pick(postTypes, seed)
      rows.push({
        name: makeName(seed + 400),
        community: c.name,
        post,
        area: `${c.name}第${GRID_NUMS[i % c.grids] || 1}网格片区`,
        year: `${2021 + (seed % 6)} 年`,
        status: pick(statuses, seed + 1),
        phone: makePhone(seed + 401),
        remark: `城乡公益性岗位人员，承担${c.name}${post}一线日常保障。`
      })
    }
  })

  return {
    title: '公益性岗位人员台账明细',
    subtitle: `口径范围：${scope} · 城乡公益岗实名在册台账`,
    summary: `当前范围内共有公益岗人员 ${rows.length} 名，覆盖环卫保洁、治安巡防、助老帮扶等 5 类岗位`,
    exportName: '数据智库_公益岗人员名册',
    filters: [
      ...communityFilterConfig(communities, initialCommunity),
      { key: 'post', label: '岗位类别', type: 'chips', allLabel: '全部岗位', options: postTypes },
      { key: 'status', label: '在岗状态', allLabel: '全部状态', options: ['正常在岗', '轮休调班'] }
    ],
    columns: [
      { key: 'name', label: '姓名' },
      { key: 'community', label: '所属社区' },
      { key: 'post', label: '岗位类别' },
      { key: 'area', label: '服务片区' },
      { key: 'year', label: '上岗年份', numeric: true },
      { key: 'status', label: '在岗状态', badgeMap: { '正常在岗': 'st-ok', '轮休调班': 'st-neutral' } },
      { key: 'phone', label: '联系电话' }
    ],
    rows
  }
}

// 4. 在册党员（基层党支部台账，精确 42 个支部，合计 100% 等于在册党员总数）
export function buildPartyBranchDrill(communities, scope, initialCommunity = '') {
  const rows = communities.flatMap((c) =>
    c.branches.map((b) => {
      const branchType = b.name.includes('两新') ? '两新组织联合党支部' : '社区网格党支部'
      const scale = b.members >= 70 ? '70名以上' : b.members >= 50 ? '50-69名' : '50名以下'
      return {
        branch: b.name,
        community: c.name,
        branchType,
        members: b.members,
        scale,
        secretary: b.secretary,
        area: b.area,
        remark: `${b.name}隶属${c.name}党总支，覆盖${b.area}，常态化开展“三会一课”与网格亮身份服务。`
      }
    })
  )
  const totalMembers = rows.reduce((a, r) => a + r.members, 0)

  return {
    title: '基层党支部与在册党员分布台账',
    subtitle: `口径范围：${scope} · 社区党总支及下属支部明细`,
    summary: `当前范围在册党员合计 ${totalMembers.toLocaleString()} 名，分属 ${rows.length} 个基层党支部`,
    exportName: '数据智库_党支部与党员明细',
    filters: [
      ...communityFilterConfig(communities, initialCommunity),
      { key: 'branchType', label: '支部类别', type: 'chips', allLabel: '全部支部', options: ['社区网格党支部', '两新组织联合党支部'] },
      { key: 'scale', label: '党员规模', allLabel: '全部规模', options: ['70名以上', '50-69名', '50名以下'] }
    ],
    columns: [
      { key: 'branch', label: '党支部名称' },
      { key: 'community', label: '所属社区总支' },
      { key: 'branchType', label: '支部类别', badgeMap: { '社区网格党支部': 'st-party', '两新组织联合党支部': 'st-run' } },
      { key: 'members', label: '在册党员(名)', numeric: true },
      { key: 'secretary', label: '支部书记' },
      { key: 'area', label: '覆盖片区' }
    ],
    rows
  }
}

// 5. 常住人口 / 户籍人口（按全街道 94 个责任网格分网格台账，合计 100% 精确相等）
export function buildGridPopulationDrill(communities, scope, mode = 'pop', initialCommunity = '') {
  const rows = []
  communities.forEach((c, cIdx) => {
    const pops = splitExact(c.pop, c.grids, cIdx * 29 + 3)
    const hukous = splitExact(c.hukou, c.grids, cIdx * 37 + 11)
    const buildings = splitExact(c.housing.buildings, c.grids, cIdx * 19 + 5)
    for (let i = 0; i < c.grids; i++) {
      const p = pops[i]
      const h = Math.min(p, hukous[i])
      const flow = p - h
      const hukouRate = +((h / Math.max(1, p)) * 100).toFixed(1)
      const density = p >= 1300 ? '高密度网格' : p >= 1050 ? '中密度网格' : '常规网格'
      const rateTier = hukouRate >= 80 ? '80%以上' : hukouRate >= 72 ? '72%-80%' : '72%以下'
      const gridName = `第${GRID_NUMS[i] || i + 1}网格`
      const staff = c.name === '德馨社区' && i === 0 ? '李敏' : makeName(cIdx * 53 + i * 17 + 11)
      rows.push({
        gridTitle: `${c.name}${gridName}`,
        community: c.name,
        pop: p,
        hukou: h,
        flow,
        hukouRate: `${hukouRate}%`,
        buildings: `${buildings[i]} 栋`,
        density,
        rateTier,
        staff,
        remark: `${c.name}${gridName}实有人口 ${p.toLocaleString()} 人（户籍 ${h.toLocaleString()} 人、流动人口 ${flow.toLocaleString()} 人），包保网格员：${staff}。`
      })
    }
  })

  const totalPop = rows.reduce((a, r) => a + r.pop, 0)
  const totalHukou = rows.reduce((a, r) => a + r.hukou, 0)

  if (mode === 'hukou') {
    return {
      title: '分网格户籍人口与户籍占比明细台账',
      subtitle: `口径范围：${scope} · 覆盖 ${rows.length} 个责任网格`,
      summary: `当前范围户籍人口合计 ${totalHukou.toLocaleString()} 人，占常住人口 ${((totalHukou / Math.max(1, totalPop)) * 100).toFixed(1)}%`,
      exportName: '数据智库_分网格户籍人口明细',
      filters: [
        ...communityFilterConfig(communities, initialCommunity),
        { key: 'rateTier', label: '户籍占比档次', type: 'chips', allLabel: '全部占比', options: ['80%以上', '72%-80%', '72%以下'] }
      ],
      columns: [
        { key: 'gridTitle', label: '责任网格' },
        { key: 'community', label: '所属社区' },
        { key: 'hukou', label: '户籍人口(人)', numeric: true },
        { key: 'flow', label: '流动人口(人)', numeric: true },
        { key: 'hukouRate', label: '户籍占比', numeric: true },
        { key: 'buildings', label: '楼栋数', numeric: true },
        { key: 'staff', label: '包保网格员' }
      ],
      rows
    }
  }

  return {
    title: '分网格常住人口与流动人口底数台账',
    subtitle: `口径范围：${scope} · 覆盖 ${rows.length} 个责任网格`,
    summary: `当前范围常住人口合计 ${totalPop.toLocaleString()} 人，其中户籍 ${totalHukou.toLocaleString()} 人、流动人口 ${(totalPop - totalHukou).toLocaleString()} 人`,
    exportName: '数据智库_分网格常住人口明细',
    filters: [
      ...communityFilterConfig(communities, initialCommunity),
      { key: 'density', label: '人口密度档次', type: 'chips', allLabel: '全部密度', options: ['高密度网格', '中密度网格', '常规网格'] }
    ],
    columns: [
      { key: 'gridTitle', label: '责任网格' },
      { key: 'community', label: '所属社区' },
      { key: 'pop', label: '常住人口(人)', numeric: true },
      { key: 'hukou', label: '户籍人口(人)', numeric: true },
      { key: 'flow', label: '流动人口(人)', numeric: true },
      { key: 'density', label: '密度档次', badgeMap: { '高密度网格': 'st-warn', '中密度网格': 'st-run', '常规网格': 'st-ok' } },
      { key: 'staff', label: '包保网格员' }
    ],
    rows
  }
}

// 6. 60岁以上老年人重点关爱建档名册（精确匹配独居高龄建档数，且标明 60岁以上总口径）
export function buildElderlyDrill(communities, scope, initialCommunity = '') {
  const ageGroups = ['60-69岁', '70-79岁', '80岁以上高龄']
  const livingTypes = ['独居长者', '空巢老人', '独居长者', '高龄失能照护']
  const healthList = ['生活自理', '慢性病随访', '半失能需帮扶', '生活自理']
  const visitCycles = ['每周入户2次', '每周入户1次', '每日电话+隔日入户']
  const rows = []
  const totalElderly = communities.reduce((a, c) => a + c.elderly, 0)

  communities.forEach((c, cIdx) => {
    const cnt = c.special.elderAlone
    for (let i = 0; i < cnt; i++) {
      const seed = cIdx * 79 + i * 23 + 17
      const ageBand = pick(ageGroups, seed)
      const living = pick(livingTypes, seed + 1)
      const health = pick(healthList, seed + 2)
      const gridIdx = i % c.grids
      const staff = c.name === '德馨社区' && gridIdx === 0 ? '李敏' : makeName(cIdx * 53 + gridIdx * 17 + 11)
      rows.push({
        name: makeName(seed + 800),
        community: c.name,
        ageBand,
        living,
        health,
        visitCycle: health === '半失能需帮扶' ? '每日电话+隔日入户' : pick(visitCycles, seed),
        staff,
        phone: makePhone(seed + 801),
        remark: `${c.name}第${GRID_NUMS[gridIdx] || 1}网格重点关爱长者，已纳入社区助老随访清单，包保网格员：${staff}。`
      })
    }
  })

  return {
    title: '60岁以上重点关爱长者建档名册',
    subtitle: `口径范围：${scope} · 辖区 60 岁以上长者共 ${totalElderly.toLocaleString()} 人`,
    summary: `已纳入社区重点入户关爱建档 ${rows.length} 人（80岁以上高龄 ${rows.filter((r) => r.ageBand === '80岁以上高龄').length} 人）`,
    exportName: '数据智库_重点关爱长者名册',
    filters: [
      ...communityFilterConfig(communities, initialCommunity),
      { key: 'ageBand', label: '年龄段', type: 'chips', allLabel: '全部年龄', options: ageGroups },
      { key: 'living', label: '居住状况', allLabel: '全部状况', options: ['独居长者', '空巢老人', '高龄失能照护'] },
      { key: 'health', label: '健康随访', allLabel: '全部状态', options: ['生活自理', '慢性病随访', '半失能需帮扶'] }
    ],
    columns: [
      { key: 'name', label: '姓名' },
      { key: 'community', label: '所属社区' },
      { key: 'ageBand', label: '年龄段' },
      { key: 'living', label: '居住状况' },
      {
        key: 'health',
        label: '健康随访',
        badgeMap: { '生活自理': 'st-ok', '慢性病随访': 'st-run', '半失能需帮扶': 'st-warn' }
      },
      { key: 'visitCycle', label: '探访频次' },
      { key: 'staff', label: '包保网格员' },
      { key: 'phone', label: '紧急联络' }
    ],
    rows
  }
}

// 7. 特殊人群分类建档名册（用于数据中枢 / 驾驶舱：独居高龄 / 低保特困 / 持证残障 / 重点优抚）
export function buildSpecialGroupDrill(communities, scope, initialCategory = '', initialCommunity = '') {
  const categories = [
    { key: 'elderAlone', label: '独居高龄', measure: '每周网格员入户探访 + 助餐对接' },
    { key: 'lowIncome', label: '低保特困', measure: '按月低保核查 + 临时救助绿色通道' },
    { key: 'disabled', label: '持证残障', measure: '康复辅具适配 + 无障碍改造随访' },
    { key: 'veteran', label: '重点优抚', measure: '退役军人服务站建档 + 节日走访慰问' }
  ]
  const levels = ['一级重点关爱', '二级常态随访', '二级常态随访']
  const rows = []

  communities.forEach((c, cIdx) => {
    categories.forEach((cat, kIdx) => {
      const count = c.special[cat.key] || 0
      for (let i = 0; i < count; i++) {
        const seed = cIdx * 97 + kIdx * 41 + i * 13 + 7
        const gridIdx = i % c.grids
        const staff = c.name === '德馨社区' && gridIdx === 0 ? '李敏' : makeName(cIdx * 53 + gridIdx * 17 + 11)
        rows.push({
          name: makeName(seed + 1200),
          community: c.name,
          category: cat.label,
          level: pick(levels, seed),
          grid: `第${GRID_NUMS[gridIdx] || 1}网格`,
          staff,
          measure: cat.measure,
          phone: makePhone(seed + 1201),
          remark: `${c.name}${cat.label}重点服务对象，落实“${cat.measure}”。`
        })
      }
    })
  })

  return {
    title: '特殊人群重点关爱建档名册',
    subtitle: `口径范围：${scope} · 仅限授权岗位核查使用`,
    summary: `当前范围建档重点关怀对象合计 ${rows.length.toLocaleString()} 人（独居高龄/低保特困/持证残障/重点优抚）`,
    exportName: '长河街道_特殊人群建档名册',
    filters: [
      ...communityFilterConfig(communities, initialCommunity),
      { key: 'category', label: '人群分类', type: 'chips', allLabel: '全部分类', options: categories.map((x) => x.label), defaultValue: initialCategory || '' },
      { key: 'level', label: '关爱等级', allLabel: '全部等级', options: ['一级重点关爱', '二级常态随访'] }
    ],
    columns: [
      { key: 'name', label: '姓名' },
      { key: 'community', label: '所属社区' },
      {
        key: 'category',
        label: '人群分类',
        badgeMap: { '独居高龄': 'st-warn', '低保特困': 'st-bad', '持证残障': 'st-run', '重点优抚': 'st-party' }
      },
      { key: 'level', label: '关爱等级' },
      { key: 'grid', label: '所属网格' },
      { key: 'staff', label: '包保网格员' },
      { key: 'measure', label: '落实帮扶举措' }
    ],
    rows
  }
}

// 8. 在校学生（按辖区学校及托幼机构在籍生源台账，精确匹配 COMMUNITIES.biz.school 与 COMMUNITIES.students）
export function buildStudentsDrill(communities, scope, initialCommunity = '') {
  const stageTypes = ['小学', '幼儿园', '初级中学', '幼儿园', '九年一贯制学校', '职业/高中']
  const guardStatus = ['警网护学岗全覆盖', '社区志愿护学', '警网护学岗全覆盖']
  const rows = []

  communities.forEach((c, cIdx) => {
    const shortName = c.name.replace('社区', '')
    const schoolCnt = Math.max(1, c.biz.school)
    const studentSplit = splitExact(c.students, schoolCnt, cIdx * 43 + 9)
    for (let i = 0; i < schoolCnt; i++) {
      const seed = cIdx * 37 + i * 11 + 3
      const stage = pick(stageTypes, seed)
      const suffix = stage === '幼儿园' ? ['中心幼儿园', '实验幼儿园', '普惠幼儿园'][i % 3]
        : stage === '小学' ? ['实验小学', '第一小学', '第二小学'][i % 3]
          : stage === '初级中学' ? '实验中学'
            : stage === '九年一贯制学校' ? '长河学校' : '职业技术学校'
      rows.push({
        schoolName: `天衢新区${shortName}${suffix}`,
        community: c.name,
        stage,
        students: studentSplit[i],
        guard: pick(guardStatus, seed + 1),
        grid: `第${GRID_NUMS[i % c.grids] || 1}网格`,
        contact: makeName(seed + 600),
        remark: `${c.name}辖区${stage}，在籍学生 ${studentSplit[i]} 人，上下学高峰由社区网格与派出所联合执勤护学。`
      })
    }
  })

  const totalStudents = rows.reduce((a, r) => a + r.students, 0)
  return {
    title: '辖区中小学及托幼机构在籍生源台账',
    subtitle: `口径范围：${scope} · 覆盖 ${rows.length} 所学校及幼教机构`,
    summary: `当前范围在校学生合计 ${totalStudents.toLocaleString()} 人，分布于 ${rows.length} 所中小学及托幼机构`,
    exportName: '数据智库_在校学生生源台账',
    filters: [
      ...communityFilterConfig(communities, initialCommunity),
      { key: 'stage', label: '学段类别', type: 'chips', allLabel: '全部学段', options: ['幼儿园', '小学', '初级中学', '九年一贯制学校', '职业/高中'] },
      { key: 'guard', label: '护学岗状态', allLabel: '全部状态', options: ['警网护学岗全覆盖', '社区志愿护学'] }
    ],
    columns: [
      { key: 'schoolName', label: '学校/机构名称' },
      { key: 'community', label: '所属社区' },
      { key: 'stage', label: '学段类别' },
      { key: 'students', label: '在校生数(人)', numeric: true },
      { key: 'guard', label: '护学岗配置', badgeMap: { '警网护学岗全覆盖': 'st-ok', '社区志愿护学': 'st-run' } },
      { key: 'grid', label: '包保网格' },
      { key: 'contact', label: '校园安全联络员' }
    ],
    rows
  }
}

// 9. 单位资源六类主体明细（大型企业/小微企业/个体工商户/学校机构/共驻共建/驻地企事业 — 全部 100% 精确数量）
export function buildUnitResourceDrill(communities, scope, kind = 'large', initialCommunity = '') {
  const industries = ['装备制造', '商贸物流', '现代服务', '生物医药', '建筑建材', '数字科技']
  const selfTypes = ['餐饮服务', '百货零售', '便民维修', '美容美发', '药店诊所', '文体培训']
  const orgTypes = ['机关单位', '国有企业', '金融机构', '医院院校', '社会组织']
  const residentTypes = ['行政事业单位', '驻区国企', '金融机构', '科研院所']
  const corpWords = ['鲁北', '天衢', '长河', '德兴', '齐鲁', '华盛', '鑫源', '恒通', '嘉泰', '瑞丰', '中德', '宏达', '博远', '润德']
  const corpTypes = ['智能装备有限公司', '供应链管理有限公司', '科技发展有限公司', '商贸实业有限公司', '生物科技有限公司', '建设工程有限公司']
  const shopWords = ['老味', '惠民', '顺丰', '康泰', '明珠', '诚兴', '好邻居', '百味', '佳美', '便民', '春晖', '鑫隆']
  const shopSuffix = ['面馆', '生鲜超市', '五金日杂店', '大药房', '图文快印', '理发工作室', '母婴生活馆', '家电维修部', '家常菜馆', '果蔬粮油店']

  const rows = []

  if (kind === 'large') {
    communities.forEach((c, cIdx) => {
      const revs = splitExact(Math.round(c.biz.revenue * 10), c.biz.large, cIdx * 23 + 3)
      const emps = splitExact(Math.round(c.biz.employees * 0.62), c.biz.large, cIdx * 31 + 7)
      for (let i = 0; i < c.biz.large; i++) {
        const seed = cIdx * 67 + i * 19 + 5
        const ind = pick(industries, seed)
        const safetyGrade = seed % 9 === 0 ? '重点关注' : seed % 3 === 0 ? '二级达标' : '一级达标'
        rows.push({
          name: `德州${pick(corpWords, seed)}${pick(corpWords, seed + 5)}${pick(corpTypes, seed + 2)}`,
          community: c.name,
          industry: ind,
          revenue: `${(revs[i] / 10).toFixed(1)} 亿元`,
          employees: emps[i],
          safetyGrade,
          contact: makeName(seed + 300),
          phone: makePhone(seed + 301),
          remark: `${c.name}重点纳统大型企业，所属${ind}行业，已签订年度安全生产责任书。`
        })
      }
    })
    return {
      title: '大型规上企业名录与产值安全台账',
      subtitle: `口径范围：${scope} · 与辖区经济运行口径 100% 一致`,
      summary: `当前范围共有大型规上企业 ${rows.length} 家，安全生产一级达标 ${rows.filter((r) => r.safetyGrade === '一级达标').length} 家`,
      exportName: '数据智库_大型企业名录',
      filters: [
        ...communityFilterConfig(communities, initialCommunity),
        { key: 'industry', label: '所属行业', allLabel: '全部行业', options: industries },
        { key: 'safetyGrade', label: '安全等级', type: 'chips', allLabel: '全部等级', options: ['一级达标', '二级达标', '重点关注'] }
      ],
      columns: [
        { key: 'name', label: '企业名称' },
        { key: 'community', label: '所属社区' },
        { key: 'industry', label: '所属行业' },
        { key: 'revenue', label: '年营收规模', numeric: true },
        { key: 'employees', label: '从业人数', numeric: true },
        {
          key: 'safetyGrade',
          label: '安全等级',
          badgeMap: { '一级达标': 'st-ok', '二级达标': 'st-run', '重点关注': 'st-warn' }
        },
        { key: 'contact', label: '企业联络人' },
        { key: 'phone', label: '联系电话' }
      ],
      rows
    }
  }

  if (kind === 'small') {
    communities.forEach((c, cIdx) => {
      for (let i = 0; i < c.biz.small; i++) {
        const seed = cIdx * 131 + i * 17 + 7
        const ind = pick(industries, seed)
        const bizState = seed % 11 === 0 ? '待回访核查' : seed % 5 === 0 ? '新注册纳统' : '正常经营'
        const fireCheck = seed % 13 === 0 ? '限期复查' : '已达标'
        rows.push({
          name: `德州${pick(corpWords, seed + i)}${c.name.replace('社区', '')}${['商贸', '机电', '信息', '物流', '装饰', '科技'][seed % 6]}有限公司`,
          community: c.name,
          industry: ind,
          employees: 6 + (seed % 42),
          bizState,
          fireCheck,
          grid: `第${GRID_NUMS[i % c.grids] || 1}网格`,
          remark: `${c.name}辖区小微企业，已纳入九小场所及网格季度走访名录。`
        })
      }
    })
    return {
      title: '小微企业名录与安全巡查台账',
      subtitle: `口径范围：${scope} · 全量小微经营主体明细`,
      summary: `当前范围共有小微企业 ${rows.length.toLocaleString()} 家，消防巡查已达标 ${rows.filter((r) => r.fireCheck === '已达标').length.toLocaleString()} 家`,
      exportName: '数据智库_小微企业名录',
      filters: [
        ...communityFilterConfig(communities, initialCommunity),
        { key: 'industry', label: '所属行业', allLabel: '全部行业', options: industries },
        { key: 'bizState', label: '经营状态', type: 'chips', allLabel: '全部状态', options: ['正常经营', '新注册纳统', '待回访核查'] },
        { key: 'fireCheck', label: '消防巡查', allLabel: '全部状态', options: ['已达标', '限期复查'] }
      ],
      columns: [
        { key: 'name', label: '企业名称' },
        { key: 'community', label: '所属社区' },
        { key: 'industry', label: '所属行业' },
        { key: 'employees', label: '从业人数', numeric: true },
        { key: 'bizState', label: '经营状态', badgeMap: { '正常经营': 'st-ok', '新注册纳统': 'st-run', '待回访核查': 'st-warn' } },
        { key: 'fireCheck', label: '消防巡查', badgeMap: { '已达标': 'st-ok', '限期复查': 'st-bad' } },
        { key: 'grid', label: '包保网格' }
      ],
      rows
    }
  }

  if (kind === 'self') {
    communities.forEach((c, cIdx) => {
      const short = c.name.replace('社区', '')
      for (let i = 0; i < c.biz.self; i++) {
        const seed = cIdx * 211 + i * 29 + 13
        const bizType = pick(selfTypes, seed)
        const license = seed % 14 === 0 ? '证照临期提醒' : '证照齐全'
        const gasCheck = bizType === '餐饮服务' ? (seed % 9 === 0 ? '待复查报警器' : '燃气检查合格') : '常规消防合格'
        rows.push({
          name: `${short}${pick(shopWords, seed + i)}${pick(shopSuffix, seed + 3)}`,
          community: c.name,
          bizType,
          owner: makeName(seed + 1500),
          license,
          gasCheck,
          grid: `第${GRID_NUMS[i % c.grids] || 1}网格`,
          remark: `${c.name}沿街商铺（${bizType}），纳入九小场所常态网格巡查。`
        })
      }
    })
    return {
      title: '个体工商户与沿街商铺台账',
      subtitle: `口径范围：${scope} · 全量个体工商户明细`,
      summary: `当前范围共有个体工商户 ${rows.length.toLocaleString()} 户，其中餐饮服务 ${rows.filter((r) => r.bizType === '餐饮服务').length.toLocaleString()} 户`,
      exportName: '数据智库_个体工商户台账',
      filters: [
        ...communityFilterConfig(communities, initialCommunity),
        { key: 'bizType', label: '经营业态', type: 'chips', allLabel: '全部业态', options: selfTypes },
        { key: 'license', label: '证照状态', allLabel: '全部证照', options: ['证照齐全', '证照临期提醒'] },
        { key: 'gasCheck', label: '安全检查', allLabel: '全部检查', options: ['燃气检查合格', '常规消防合格', '待复查报警器'] }
      ],
      columns: [
        { key: 'name', label: '商户名称' },
        { key: 'community', label: '所属社区' },
        { key: 'bizType', label: '经营业态' },
        { key: 'owner', label: '经营者' },
        { key: 'license', label: '证照状态', badgeMap: { '证照齐全': 'st-ok', '证照临期提醒': 'st-warn' } },
        { key: 'gasCheck', label: '燃气/消防检查', badgeMap: { '燃气检查合格': 'st-ok', '常规消防合格': 'st-ok', '待复查报警器': 'st-bad' } },
        { key: 'grid', label: '所属网格' }
      ],
      rows
    }
  }

  if (kind === 'school') {
    return buildStudentsDrill(communities, scope, initialCommunity)
  }

  if (kind === 'coBuild') {
    const projects = ['红领物业共建', '义诊便民进小区', '困难家庭结对帮扶', '法治宣传进网格', '党员双报到志愿服务']
    communities.forEach((c, cIdx) => {
      for (let i = 0; i < c.biz.coBuild; i++) {
        const seed = cIdx * 43 + i * 17 + 9
        const orgType = pick(orgTypes, seed)
        const state = seed % 5 === 0 ? '季度推进中' : '履约良好'
        rows.push({
          name: `天衢新区${pick(corpWords, seed)}${orgType === '金融机构' ? '银行长河支行' : orgType === '医院院校' ? '社区卫生服务中心' : orgType === '机关单位' ? '政务服务共建组' : '共驻共建单位'}`,
          community: c.name,
          orgType,
          project: pick(projects, seed + 2),
          state,
          contact: makeName(seed + 500),
          phone: makePhone(seed + 501),
          remark: `与${c.name}党总支签订共驻共建协议，年度落地「${pick(projects, seed + 2)}」项目。`
        })
      }
    })
    return {
      title: '共驻共建单位资源台账',
      subtitle: `口径范围：${scope} · 街道社区党建联建资源清单`,
      summary: `当前范围共驻共建单位 ${rows.length} 家，履约良好 ${rows.filter((r) => r.state === '履约良好').length} 家`,
      exportName: '数据智库_共驻共建单位台账',
      filters: [
        ...communityFilterConfig(communities, initialCommunity),
        { key: 'orgType', label: '单位性质', type: 'chips', allLabel: '全部性质', options: orgTypes },
        { key: 'state', label: '履约状态', allLabel: '全部状态', options: ['履约良好', '季度推进中'] }
      ],
      columns: [
        { key: 'name', label: '共建单位名称' },
        { key: 'community', label: '结对社区' },
        { key: 'orgType', label: '单位性质' },
        { key: 'project', label: '认领共建项目' },
        { key: 'state', label: '履约状态', badgeMap: { '履约良好': 'st-ok', '季度推进中': 'st-run' } },
        { key: 'contact', label: '联络人' },
        { key: 'phone', label: '联系电话' }
      ],
      rows
    }
  }

  // residentUnit
  communities.forEach((c, cIdx) => {
    for (let i = 0; i < c.biz.residentUnit; i++) {
      const seed = cIdx * 59 + i * 19 + 3
      const uType = pick(residentTypes, seed)
      const mech = seed % 4 === 0 ? '常态联络' : '已建联席机制'
      rows.push({
        name: `德州市${pick(corpWords, seed + 4)}${uType === '行政事业单位' ? '管理服务中心' : uType === '金融机构' ? '金融服务网点' : uType === '科研院所' ? '技术研究院' : '产业运营分公司'}`,
        community: c.name,
        uType,
        mech,
        contact: makeName(seed + 700),
        phone: makePhone(seed + 701),
        remark: `驻${c.name}辖区${uType}，纳入街道政企/单位联席服务保障清单。`
      })
    }
  })
  return {
    title: '驻地企事业单位联络台账',
    subtitle: `口径范围：${scope} · 辖区驻地单位全量名录`,
    summary: `当前范围驻地企事业单位共 ${rows.length} 家，已建立联席机制 ${rows.filter((r) => r.mech === '已建联席机制').length} 家`,
    exportName: '数据智库_驻地企事业单位台账',
    filters: [
      ...communityFilterConfig(communities, initialCommunity),
      { key: 'uType', label: '单位类型', type: 'chips', allLabel: '全部类型', options: residentTypes },
      { key: 'mech', label: '联络机制', allLabel: '全部机制', options: ['已建联席机制', '常态联络'] }
    ],
    columns: [
      { key: 'name', label: '单位名称' },
      { key: 'community', label: '所属社区' },
      { key: 'uType', label: '单位类型' },
      { key: 'mech', label: '联络机制', badgeMap: { '已建联席机制': 'st-ok', '常态联络': 'st-run' } },
      { key: 'contact', label: '对接负责人' },
      { key: 'phone', label: '联系电话' }
    ],
    rows
  }
}

import { COMMUNITY_ESTATES } from './cockpitBuildingIndex'

// 10. 住宅信息专题：小区名录、楼栋户数、地下车库、配套用房（全部 100% 精确数量）
export function buildHousingDrill(communities, scope, kind = 'all', initialCommunity = '') {
  const propCompanies = ['长河红领物业', '德州润华物业', '天衢安居物业', '星凯智慧物业', '社区物业代管中心', '业主自治委员会']
  const compoundPrefix = ['华庭', '雅苑', '嘉园', '康居', '馨苑', '新居', '明珠', '御景']

  if (kind === 'garages') {
    const rows = []
    communities.forEach((c, cIdx) => {
      const realEsts = COMMUNITY_ESTATES[c.name] || [c.name.replace('社区', '') + '小区']
      for (let i = 0; i < c.housing.garages; i++) {
        const seed = cIdx * 47 + i * 13 + 7
        const estName = realEsts[i % realEsts.length]
        const charger = seed % 4 === 0 ? '待增补充电位' : '已配建充电桩'
        const floodGate = seed % 6 === 0 ? '需补充挡水板' : '防汛设施齐全'
        const fireStatus = seed % 9 === 0 ? '待复查喷淋' : '消防巡检合格'
        rows.push({
          name: `${estName} ${Math.floor(i / realEsts.length) + 1} 号地下车库`,
          community: c.name,
          slots: 120 + (seed % 260),
          charger,
          floodGate,
          fireStatus,
          remark: `${c.name} · ${estName}地下车库点位，规划车位 ${120 + (seed % 260)} 个，纳入汛期防倒灌与消防安全重点巡查。`
        })
      }
    })
    return {
      title: '地下车库防汛与消防巡检台账',
      subtitle: `口径范围：${scope} · 精确覆盖 ${rows.length} 处地下车库`,
      summary: `当前范围共有地下车库 ${rows.length} 处，防汛挡水设施齐全 ${rows.filter((r) => r.floodGate === '防汛设施齐全').length} 处`,
      exportName: '数据智库_地下车库台账',
      filters: [
        ...communityFilterConfig(communities, initialCommunity),
        { key: 'charger', label: '充电桩配置', type: 'chips', allLabel: '全部配置', options: ['已配建充电桩', '待增补充电位'] },
        { key: 'floodGate', label: '防汛挡水', allLabel: '全部防汛', options: ['防汛设施齐全', '需补充挡水板'] },
        { key: 'fireStatus', label: '消防巡检', allLabel: '全部巡检', options: ['消防巡检合格', '待复查喷淋'] }
      ],
      columns: [
        { key: 'name', label: '车库点位名称' },
        { key: 'community', label: '所属社区' },
        { key: 'slots', label: '规划车位(个)', numeric: true },
        { key: 'charger', label: '充电桩配置', badgeMap: { '已配建充电桩': 'st-ok', '待增补充电位': 'st-warn' } },
        { key: 'floodGate', label: '防汛设施', badgeMap: { '防汛设施齐全': 'st-ok', '需补充挡水板': 'st-bad' } },
        { key: 'fireStatus', label: '消防巡检', badgeMap: { '消防巡检合格': 'st-ok', '待复查喷淋': 'st-warn' } }
      ],
      rows
    }
  }

  if (kind === 'rooms') {
    const roomUses = ['党群服务站', '物业服务用房', '养老助餐点', '文体活动室', '社区卫生服务室', '社区警务室']
    const opStates = ['正常开放运营', '正常开放运营', '正常开放运营', '升级改造中']
    const rows = []
    communities.forEach((c, cIdx) => {
      const realEsts = COMMUNITY_ESTATES[c.name] || [c.name.replace('社区', '') + '小区']
      for (let i = 0; i < c.housing.rooms; i++) {
        const seed = cIdx * 53 + i * 19 + 5
        const estName = realEsts[i % realEsts.length]
        const useType = pick(roomUses, seed)
        const opState = pick(opStates, seed + 2)
        rows.push({
          name: `${estName}${useType}`,
          community: c.name,
          useType,
          area: `${80 + (seed % 340)} ㎡`,
          opState,
          manager: useType === '物业服务用房' ? `${estName}物业中心` : `${c.name}居委会`,
          remark: `${c.name} · ${estName}住宅配套公共用房，现用于${useType}，产权清晰并向居民规范开放。`
        })
      }
    })
    return {
      title: '住宅配套公共用房运营台账',
      subtitle: `口径范围：${scope} · 精确覆盖 ${rows.length} 处配套用房`,
      summary: `当前范围共有住宅配套用房 ${rows.length} 处，正常开放运营 ${rows.filter((r) => r.opState === '正常开放运营').length} 处`,
      exportName: '数据智库_配套用房台账',
      filters: [
        ...communityFilterConfig(communities, initialCommunity),
        { key: 'useType', label: '用途类别', type: 'chips', allLabel: '全部用途', options: roomUses },
        { key: 'opState', label: '运营状态', allLabel: '全部状态', options: ['正常开放运营', '升级改造中'] }
      ],
      columns: [
        { key: 'name', label: '配套用房名称' },
        { key: 'community', label: '所属社区' },
        { key: 'useType', label: '用途类别' },
        { key: 'area', label: '建筑面积', numeric: true },
        { key: 'opState', label: '运营状态', badgeMap: { '正常开放运营': 'st-ok', '升级改造中': 'st-warn' } },
        { key: 'manager', label: '管理主体' }
      ],
      rows
    }
  }

  // 小区全量台账（commercial / resettle / old / buildings / units / homes / all）
  const initialCategory = kind === 'commercial' ? '商品房小区'
    : kind === 'resettle' ? '回迁安置小区'
      : kind === 'old' ? '老旧小区' : ''

  const rows = []
  communities.forEach((c, cIdx) => {
    const short = c.name.replace('社区', '')
    const types = [
      ...Array(c.housing.commercial).fill('商品房小区'),
      ...Array(c.housing.resettle).fill('回迁安置小区'),
      ...Array(c.housing.old).fill('老旧小区')
    ]
    const totalCompounds = Math.max(1, types.length)
    const bSplit = splitExact(c.housing.buildings, totalCompounds, cIdx * 29 + 3)
    const uSplit = splitExact(c.housing.units, totalCompounds, cIdx * 31 + 5)
    const hSplit = splitExact(c.housing.homes, totalCompounds, cIdx * 37 + 11)

    types.forEach((cat, i) => {
      const seed = cIdx * 71 + i * 17 + 5
      const realEsts = COMMUNITY_ESTATES[c.name] || []
      const suffix = cat === '商品房小区' ? '花园' : cat === '回迁安置小区' ? '新居' : '家属院'
      const estName = i < realEsts.length
        ? realEsts[i]
        : `${realEsts[i % Math.max(1, realEsts.length)] || short}${['北区', '南区', '东区', '二期'][i % 4]}`
      const propMode = cat === '老旧小区' ? (seed % 2 === 0 ? '社区物业代管' : '业主自治') : '专业物业服务'
      const builtYear = cat === '老旧小区' ? 1996 + (seed % 10) : cat === '回迁安置小区' ? 2012 + (seed % 8) : 2016 + (seed % 9)
      const rate = cat === '老旧小区' ? Math.max(76, c.housing.propertyRate - 10) : Math.min(100, c.housing.propertyRate + 1)
      rows.push({
        name: estName || `${short}${pick(compoundPrefix, seed + i)}${suffix}`,
        community: c.name,
        category: cat,
        buildings: bSplit[i],
        units: uSplit[i],
        homes: hSplit[i],
        propMode,
        propertyName: propMode === '专业物业服务' ? `${estName}物业服务中心` : propMode === '社区物业代管' ? '社区物业代管中心' : '业主自治委员会',
        builtYear: `${builtYear} 年`,
        propertyRate: `${rate}%`,
        remark: `${c.name} · ${estName}（${cat}），建于${builtYear}年，共 ${bSplit[i]} 栋 ${uSplit[i]} 个单元 ${hSplit[i]} 户，当前实行${propMode}。`
      })
    })
  })

  return {
    title: '住宅小区分类、楼栋体量与物业覆盖明细',
    subtitle: `口径范围：${scope} · 覆盖全部 ${rows.length} 个住宅小区`,
    summary: `当前范围合计 ${rows.length} 个小区（商品房 ${rows.filter((r) => r.category === '商品房小区').length}、回迁安置 ${rows.filter((r) => r.category === '回迁安置小区').length}、老旧小区 ${rows.filter((r) => r.category === '老旧小区').length}）`,
    exportName: '数据智库_住宅小区明细台账',
    filters: [
      ...communityFilterConfig(communities, initialCommunity),
      { key: 'category', label: '小区类别', type: 'chips', allLabel: '全部小区', options: ['商品房小区', '回迁安置小区', '老旧小区'], defaultValue: initialCategory },
      { key: 'propMode', label: '物业模式', allLabel: '全部物业', options: ['专业物业服务', '社区物业代管', '业主自治'] }
    ],
    columns: [
      { key: 'name', label: '小区名称' },
      { key: 'community', label: '所属社区' },
      {
        key: 'category',
        label: '小区类别',
        badgeMap: { '商品房小区': 'st-ok', '回迁安置小区': 'st-run', '老旧小区': 'st-warn' }
      },
      { key: 'buildings', label: '楼栋(栋)', numeric: true },
      { key: 'units', label: '单元(个)', numeric: true },
      { key: 'homes', label: '总户数(户)', numeric: true },
      { key: 'propMode', label: '物业模式' },
      { key: 'builtYear', label: '建成年份', numeric: true },
      { key: 'propertyRate', label: '物业覆盖率', numeric: true }
    ],
    rows
  }
}

// 11. 环境治理专题：建筑工地 / 易涝积水点 / 防火隐患点 / 生态管护点位
export function buildEnvironmentDrill(communities, scope, kind = 'sites', initialCommunity = '') {
  if (kind === 'sites') {
    const stages = ['土方开挖', '主体施工', '装饰装修', '收尾验收']
    const dustStatus = ['扬尘防控达标', '扬尘防控达标', '重点督办整改']
    const rows = []
    communities.forEach((c, cIdx) => {
      const short = c.name.replace('社区', '')
      const bareSplit = splitExact(c.env.bareSoil, Math.max(1, c.env.sites), cIdx * 17 + 3)
      for (let i = 0; i < c.env.sites; i++) {
        const seed = cIdx * 37 + i * 19 + 5
        const status = pick(dustStatus, seed)
        rows.push({
          name: `${short}片区${['新建住宅', '市政道路提升', '商业配套', '学校扩建'][seed % 4]}工程工地`,
          community: c.name,
          stage: pick(stages, seed + 1),
          bareSoil: `${bareSplit[i].toLocaleString()} ㎡`,
          coverRate: status === '重点督办整改' ? '78%' : `${95 + (seed % 5)}%`,
          status,
          owner: makeName(seed + 900),
          remark: `${c.name}在建工地，执行施工扬尘六个百分之百监管要求。`
        })
      }
    })
    return {
      title: '在建建筑工地与扬尘防控台账',
      subtitle: `口径范围：${scope} · 精确覆盖 ${rows.length} 个在建工地`,
      summary: `当前范围在建建筑工地 ${rows.length} 个，扬尘防控重点督办 ${rows.filter((r) => r.status === '重点督办整改').length} 个`,
      exportName: '数据智库_建筑工地扬尘台账',
      filters: [
        ...communityFilterConfig(communities, initialCommunity),
        { key: 'stage', label: '施工阶段', allLabel: '全部阶段', options: stages },
        { key: 'status', label: '扬尘达标', type: 'chips', allLabel: '全部状态', options: ['扬尘防控达标', '重点督办整改'] }
      ],
      columns: [
        { key: 'name', label: '工地项目名称' },
        { key: 'community', label: '所属社区' },
        { key: 'stage', label: '施工阶段' },
        { key: 'bareSoil', label: '关联裸土面积', numeric: true },
        { key: 'coverRate', label: '防尘网覆盖率', numeric: true },
        { key: 'status', label: '防控状态', badgeMap: { '扬尘防控达标': 'st-ok', '重点督办整改': 'st-bad' } },
        { key: 'owner', label: '现场包保员' }
      ],
      rows
    }
  }

  if (kind === 'floodPts') {
    const risks = ['高风险盯防', '中风险关注', '一般关注']
    const drainStates = ['排涝设施正常', '排涝设施正常', '待清淤疏通']
    const spotNames = ['下穿涵洞口', '老旧低洼路口', '河岸雨水排口', '背街排水渠段', '地下车库坡道口']
    const rows = []
    communities.forEach((c, cIdx) => {
      const short = c.name.replace('社区', '')
      for (let i = 0; i < c.env.floodPts; i++) {
        const seed = cIdx * 41 + i * 17 + 7
        const risk = c.env.floodPts >= 2 && i === 0 ? '高风险盯防' : pick(risks, seed)
        rows.push({
          name: `${short}${pick(spotNames, seed)}`,
          community: c.name,
          risk,
          drainState: risk === '高风险盯防' ? '待清淤疏通' : pick(drainStates, seed + 1),
          pump: risk === '高风险盯防' ? '已前置移动抽水泵 2 台' : '配备沙袋及警示牌',
          owner: c.lead,
          remark: `${c.name}汛期易涝积水重点点位，实行雨前清掏、雨中值守、雨后快排责任制。`
        })
      }
    })
    return {
      title: '汛期易涝积水点包保防控台账',
      subtitle: `口径范围：${scope} · 精确覆盖 ${rows.length} 处易涝积水点`,
      summary: `当前范围共有易涝积水点 ${rows.length} 处，高风险盯防 ${rows.filter((r) => r.risk === '高风险盯防').length} 处`,
      exportName: '数据智库_易涝积水点台账',
      filters: [
        ...communityFilterConfig(communities, initialCommunity),
        { key: 'risk', label: '风险等级', type: 'chips', allLabel: '全部等级', options: risks },
        { key: 'drainState', label: '排涝状态', allLabel: '全部状态', options: ['排涝设施正常', '待清淤疏通'] }
      ],
      columns: [
        { key: 'name', label: '积水点位名称' },
        { key: 'community', label: '所属社区' },
        { key: 'risk', label: '风险等级', badgeMap: { '高风险盯防': 'st-bad', '中风险关注': 'st-warn', '一般关注': 'st-run' } },
        { key: 'drainState', label: '设施状态', badgeMap: { '排涝设施正常': 'st-ok', '待清淤疏通': 'st-warn' } },
        { key: 'pump', label: '应急物资前置' },
        { key: 'owner', label: '第一包保人' }
      ],
      rows
    }
  }

  if (kind === 'firePts') {
    const types = ['林缘草地火险', '农田秸秆禁烧点', '废品堆场隐患', '老旧沿街线路']
    const levels = ['一级盯防', '二级巡查']
    const states = ['常态巡防中', '已增配灭火器', '限期清理中']
    const rows = []
    communities.forEach((c, cIdx) => {
      const short = c.name.replace('社区', '')
      for (let i = 0; i < c.env.firePts; i++) {
        const seed = cIdx * 53 + i * 23 + 3
        const fType = pick(types, seed)
        const level = c.env.firePts >= 3 && i === 0 ? '一级盯防' : pick(levels, seed + 1)
        rows.push({
          name: `${short}${fType}第${GRID_NUMS[i] || i + 1}点位`,
          community: c.name,
          fType,
          level,
          state: level === '一级盯防' ? '限期清理中' : pick(states, seed + 2),
          owner: makeName(seed + 950),
          remark: `${c.name}秋冬防火重点盯防点位，网格员每日开展禁烧与易燃物清理巡查。`
        })
      }
    })
    return {
      title: '秋冬防火隐患点包保盯防台账',
      subtitle: `口径范围：${scope} · 精确覆盖 ${rows.length} 处防火隐患点`,
      summary: `当前范围共有防火隐患点 ${rows.length} 处，一级盯防 ${rows.filter((r) => r.level === '一级盯防').length} 处`,
      exportName: '数据智库_防火隐患点台账',
      filters: [
        ...communityFilterConfig(communities, initialCommunity),
        { key: 'fType', label: '隐患类型', allLabel: '全部类型', options: types },
        { key: 'level', label: '管控等级', type: 'chips', allLabel: '全部等级', options: levels },
        { key: 'state', label: '整治状态', allLabel: '全部状态', options: states }
      ],
      columns: [
        { key: 'name', label: '隐患点位名称' },
        { key: 'community', label: '所属社区' },
        { key: 'fType', label: '隐患类型' },
        { key: 'level', label: '管控等级', badgeMap: { '一级盯防': 'st-bad', '二级巡查': 'st-warn' } },
        { key: 'state', label: '处置状态', badgeMap: { '已增配灭火器': 'st-ok', '常态巡防中': 'st-run', '限期清理中': 'st-bad' } },
        { key: 'owner', label: '网格巡防员' }
      ],
      rows
    }
  }

  // 生态要素通用（裸土/耕地/林地/湿地/河湖/道路）
  const metaMap = {
    bareSoil: { label: '裸土防尘管控', unit: '平方米', season: '施工扬尘', fn: (c) => c.env.bareSoil, duty: '环保网格长' },
    farmland: { label: '基本耕地保护', unit: '亩', season: '秋冬防火', fn: (c) => c.env.farmland, duty: '田长联络员' },
    forest: { label: '林地资源管护', unit: '亩', season: '秋冬防火', fn: (c) => c.env.forest, duty: '社区林长' },
    wetland: { label: '生态湿地管护', unit: '亩', season: '汛期防涝', fn: (c) => c.env.wetland, duty: '湿地巡护员' },
    rivers: { label: '河湖水系巡防', unit: '公里', season: '汛期防涝', fn: (c) => c.env.rivers, duty: '社区河长' },
    roads: { label: '辖区道路保洁巡护', unit: '公里', season: '施工扬尘', fn: (c) => c.env.roads, duty: '社区路长' }
  }
  const meta = metaMap[kind] || metaMap.bareSoil
  const rows = communities.map((c, idx) => {
    const val = meta.fn(c)
    const state = val > 0 && idx % 4 === 1 ? '重点巡护' : '常态达标'
    return {
      community: c.name,
      element: meta.label,
      value: `${Number(val).toLocaleString()} ${meta.unit}`,
      season: meta.season,
      dutyRole: meta.duty,
      owner: c.lead,
      state,
      remark: `${c.name}${meta.label}法定计量底数 ${Number(val).toLocaleString()} ${meta.unit}，由${meta.duty}牵头落实日常巡护。`
    }
  })

  return {
    title: `${meta.label}分社区法定要素管护台账`,
    subtitle: `口径范围：${scope} · 严守法定计量单位（${meta.unit}）`,
    summary: `当前范围覆盖 ${rows.length} 个社区，重点巡护 ${rows.filter((r) => r.state === '重点巡护').length} 个社区`,
    exportName: `数据智库_${meta.label}台账`,
    filters: [
      ...communityFilterConfig(communities, initialCommunity),
      { key: 'state', label: '管护状态', type: 'chips', allLabel: '全部状态', options: ['常态达标', '重点巡护'] }
    ],
    columns: [
      { key: 'community', label: '社区名称' },
      { key: 'element', label: '法定要素' },
      { key: 'value', label: `法定底数(${meta.unit})`, numeric: true },
      { key: 'season', label: '防控场景' },
      { key: 'dutyRole', label: '责任体系' },
      { key: 'owner', label: '包保负责人' },
      { key: 'state', label: '管护状态', badgeMap: { '常态达标': 'st-ok', '重点巡护': 'st-warn' } }
    ],
    rows
  }
}

// 12. 安全生产隐患排查整改明细台账（用于数据中枢 & 综合驾驶舱，精确匹配 hazards / fixed）
export function buildSafetyHazardsDrill(communities, scope, initialStatus = '', initialCommunity = '') {
  const hazardTypes = ['消防通道占用', '燃气软管老化', '电动自行车违规充电', '灭火器临期失效', '配电箱无防护盖', '安全出口锁闭']
  const rows = []
  communities.forEach((c, cIdx) => {
    const short = c.name.replace('社区', '')
    const openCount = Math.max(0, c.safety.hazards - c.safety.fixed)
    for (let i = 0; i < c.safety.hazards; i++) {
      const seed = cIdx * 73 + i * 19 + 11
      const isOpen = i < openCount
      const hType = pick(hazardTypes, seed)
      const riskLevel = isOpen ? '重点督办' : (seed % 3 === 0 ? '中风险' : '一般隐患')
      rows.push({
        place: `${short}${['沿街商铺', '工业园区', '住宅小区', '九小场所'][seed % 4]}${i + 1}号点位`,
        community: c.name,
        hType,
        riskLevel,
        status: isOpen ? '待销号整改' : '已闭环销号',
        inspector: makeName(seed + 1100),
        deadline: isOpen ? '限期 24 小时内复查' : '已验收归档',
        remark: `${c.name}安全生产排查发现「${hType}」，当前状态：${isOpen ? '待销号整改，已下发整改通知书' : '已完成整改并复核销号'}。`
      })
    }
  })

  return {
    title: '安全生产隐患排查与整改销号明细台账',
    subtitle: `口径范围：${scope} · 与安监双率监测 100% 同源`,
    summary: `累计排查隐患 ${rows.length} 处，已闭环销号 ${rows.filter((r) => r.status === '已闭环销号').length} 处，待销号整改 ${rows.filter((r) => r.status === '待销号整改').length} 处`,
    exportName: '长河街道_安全生产隐患明细台账',
    filters: [
      ...communityFilterConfig(communities, initialCommunity),
      { key: 'status', label: '整改状态', type: 'chips', allLabel: '全部状态', options: ['待销号整改', '已闭环销号'], defaultValue: initialStatus || '' },
      { key: 'hType', label: '隐患类别', allLabel: '全部类别', options: hazardTypes },
      { key: 'riskLevel', label: '风险等级', allLabel: '全部等级', options: ['重点督办', '中风险', '一般隐患'] }
    ],
    columns: [
      { key: 'place', label: '排查点位/场所' },
      { key: 'community', label: '所属社区' },
      { key: 'hType', label: '隐患类别' },
      { key: 'riskLevel', label: '风险等级', badgeMap: { '重点督办': 'st-bad', '中风险': 'st-warn', '一般隐患': 'st-neutral' } },
      { key: 'status', label: '整改状态', badgeMap: { '待销号整改': 'st-bad', '已闭环销号': 'st-ok' } },
      { key: 'inspector', label: '排查人员' },
      { key: 'deadline', label: '处置时限' }
    ],
    rows
  }
}

// 13. 基干民兵编成花名册（数字武装模块拓展，精确 336 人，分队口径与 squadStructure 100% 一致，遵循权限脱敏）
export function buildMilitiaRosterDrill(communities, scope, canViewRoster = true, initialSquad = '', initialCommunity = '') {
  const squads = ['综合应急排', '防汛抢险分队', '信息通信与无人机分队', '卫生救护与后勤保障分队']
  const squadQuotas = [148, 86, 54, 48] // 合计 336 人，与全街道民兵分队统计 100% 一致
  const specialties = {
    '综合应急排': ['工程抢险', '秩序维护', '应急处突'],
    '防汛抢险分队': ['冲锋舟操作', '防汛排涝', '堤坝巡查'],
    '信息通信与无人机分队': ['无人机侦察', '应急电台通联', '视频图传'],
    '卫生救护与后勤保障分队': ['战伤救护', '医疗转运', '物资保障']
  }
  const trainStates = ['年度点验合格', '年度点验合格', '年度点验合格', '复训待考核']

  // 按全局序列精确分配 148 / 86 / 54 / 48 个分队席位，并均匀分布到各社区
  const globalSquadPool = []
  let remain = [...squadQuotas]
  while (globalSquadPool.length < 336) {
    for (let s = 0; s < squads.length; s++) {
      const batch = s === 0 ? 3 : s === 1 ? 2 : 1
      for (let b = 0; b < batch && remain[s] > 0; b++) {
        globalSquadPool.push(squads[s])
        remain[s] -= 1
      }
    }
  }

  const rows = []
  let globalIdx = 0
  COMMUNITIES.forEach((c, cIdx) => {
    const visible = communities.some((vc) => vc.name === c.name)
    for (let i = 0; i < c.armed.militia; i++) {
      const squad = globalSquadPool[globalIdx % globalSquadPool.length]
      globalIdx += 1
      if (!visible) continue
      const seed = cIdx * 83 + i * 17 + 5
      const rawName = i === 0 ? c.armed.militiaCap : makeName(seed + 1700)
      const spec = pick(specialties[squad], seed)
      rows.push({
        name: canViewRoster ? rawName : `${rawName[0]}**（已脱敏）`,
        community: c.name,
        squad,
        duty: i === 0 ? '民兵连长' : i < 3 ? '排长/班长' : '基干民兵',
        specialty: spec,
        politics: seed % 2 === 0 ? '中共党员' : (seed % 3 === 0 ? '退役军人' : '共青团员'),
        trainState: pick(trainStates, seed + 1),
        phone: canViewRoster ? makePhone(seed + 1701) : '无权查看',
        remark: canViewRoster
          ? `${c.name}民兵连${squad}骨干，专业方向：${spec}。`
          : '当前角色未获武装敏感名册明文授权，姓名与联系方式已自动脱敏。'
      })
    }
  })

  return {
    title: '基干民兵编成与点验花名册',
    subtitle: `口径范围：${scope} · ${canViewRoster ? '已通过授权核验' : '敏感字段已按权限自动脱敏'}`,
    summary: `当前范围在编基干民兵 ${rows.length} 人，年度点验合格 ${rows.filter((r) => r.trainState === '年度点验合格').length} 人`,
    exportName: '数字武装_基干民兵编成花名册',
    filters: [
      ...communityFilterConfig(communities, initialCommunity),
      { key: 'squad', label: '编成分队', type: 'chips', allLabel: '全部分队', options: squads, defaultValue: initialSquad || '' },
      { key: 'specialty', label: '专业特长', allLabel: '全部专业' },
      { key: 'trainState', label: '点验状态', allLabel: '全部状态', options: ['年度点验合格', '复训待考核'] }
    ],
    columns: [
      { key: 'name', label: '姓名' },
      { key: 'community', label: '所属社区民兵连' },
      {
        key: 'squad',
        label: '编成分队',
        badgeMap: {
          '综合应急排': 'st-bad',
          '防汛抢险分队': 'st-run',
          '信息通信与无人机分队': 'st-ok',
          '卫生救护与后勤保障分队': 'st-neutral'
        }
      },
      { key: 'duty', label: '编成职务' },
      { key: 'specialty', label: '专业方向' },
      { key: 'politics', label: '身份/面貌' },
      { key: 'trainState', label: '点验状态', badgeMap: { '年度点验合格': 'st-ok', '复训待考核': 'st-warn' } },
      { key: 'phone', label: '联络方式' }
    ],
    rows
  }
}

export function getAllCommunities() {
  return COMMUNITIES
}
