import { reactive, watch } from 'vue'
import { buildScenePhoto, isLegacySvgPhoto } from '../utils/sampleImages'
import { evaluateFormula } from '../utils/validators'
import { CHANGHE_COMMUNITY_GEO } from '../utils/changheGeo'

const STORAGE_KEY = 'changhe-smart-community-v3'

export function nowStr() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const PRESETS = [
  { id: 'vermilion-seal', label: '宣瓷墨印', sw1: '#b81c28', sw2: '#b58d42' },
  { id: 'cloud-portal', label: '移动云智', sw1: '#1464e6', sw2: '#3b9ef8' },
  { id: 'pearl-glass', label: '珍珠玻璃', sw1: '#236de9', sw2: '#82dd2d' },
  { id: 'civic-trust', label: '政务端庄', sw1: '#1a56b8', sw2: '#17703a' },
  { id: 'jade-emerald', label: '翠松玉青', sw1: '#0f766e', sw2: '#f59e0b' },
  { id: 'command-dark', label: '星曜深色', sw1: '#0e1726', sw2: '#4fd3f2' }
]

export const ROLES = [
  {
    id: 'street_admin',
    name: '街道管理员',
    userName: '张志国',
    dept: '长河街道党政综合办',
    scope: '全街道',
    landingMode: 'leader',
    desc: '全街道 14 社区全局统筹、跨条线派单、复核销号、宽表清理与信创运维',
    allowedRoutes: ['/portal', '/cockpit', '/data-hub', '/think-tank', '/armed-forces', '/grid', '/data-direct', '/mobile', '/xinchuang'],
    canDispatch: true,
    canCloseEvent: true,
    canReturnEvent: true,
    canDeleteLedgerRow: true,
    canManageArmedDocs: true,
    canViewArmedRoster: true,
    canViewSensitiveSpecial: true,
    rowIsolationOnlySelf: false
  },
  {
    id: 'armed_minister',
    name: '武装部部长',
    userName: '赵卫军',
    dept: '长河街道人民武装部',
    scope: '全街道',
    landingMode: 'leader',
    desc: '全街道数字武装五专题管理、民兵连编成与退役军人授权查阅、资料维护',
    allowedRoutes: ['/portal', '/cockpit', '/data-hub', '/think-tank', '/armed-forces', '/xinchuang'],
    canDispatch: false,
    canCloseEvent: false,
    canReturnEvent: false,
    canDeleteLedgerRow: false,
    canManageArmedDocs: true,
    canViewArmedRoster: true,
    canViewSensitiveSpecial: true,
    rowIsolationOnlySelf: false
  },
  {
    id: 'community_admin',
    name: '德馨社区管理员',
    userName: '周建国',
    dept: '德馨社区党总支',
    scope: '德馨社区',
    landingMode: 'staff',
    desc: '本社区事件受理、退回补充、楼栋台账维护、宽表核查初审',
    allowedRoutes: ['/portal', '/cockpit', '/data-hub', '/think-tank', '/armed-forces', '/grid', '/data-direct', '/mobile'],
    canDispatch: true,
    canCloseEvent: false,
    canReturnEvent: true,
    canDeleteLedgerRow: false,
    canManageArmedDocs: false,
    canViewArmedRoster: true,
    canViewSensitiveSpecial: true,
    rowIsolationOnlySelf: false
  },
  {
    id: 'grid_staff',
    name: '专职网格员·李敏',
    userName: '李敏',
    dept: '德馨社区第一网格',
    scope: '德馨社区',
    landingMode: 'staff',
    desc: '一线巡查上报、入户核验、数据直达本人填报（严格行级隔离、无派单销号及运维权限）',
    allowedRoutes: ['/portal', '/grid', '/data-direct', '/mobile'],
    canDispatch: false,
    canCloseEvent: false,
    canReturnEvent: false,
    canDeleteLedgerRow: false,
    canManageArmedDocs: false,
    canViewArmedRoster: false,
    canViewSensitiveSpecial: false,
    rowIsolationOnlySelf: true
  }
]

function getCommunityGeo(name, fallbackLat, fallbackLng) {
  const hit = CHANGHE_COMMUNITY_GEO[name]
  if (hit) return hit
  return {
    center: [fallbackLat, fallbackLng],
    polygon: [
      [fallbackLat + 0.004, fallbackLng - 0.005],
      [fallbackLat + 0.004, fallbackLng + 0.005],
      [fallbackLat - 0.004, fallbackLng + 0.005],
      [fallbackLat - 0.004, fallbackLng - 0.005]
    ]
  }
}

const RAW_COMMUNITIES = [
  { name: '德馨社区', center: [37.4632, 116.3532], lead: '周建国', phone: '0534-2681001', grids: 8, health: 'ok', pop: 9680, hukou: 7420, party: 214, committees: 9, gridStaff: 8, publicPost: 14, students: 1240, elderly: 1860, malePct: 50.4, special: { elderAlone: 54, lowIncome: 22, disabled: 36, veteran: 48 }, honors: ['山东省和谐示范社区', '德州市红领物业标杆社区'], biz: { large: 14, small: 112, self: 318, school: 6, coBuild: 8, residentUnit: 12, revenue: 18.6, employees: 4120 }, safety: { keyObj: 42, regEnt: 126, hazards: 22, fixed: 21, coverage: 98.4 }, housing: { commercial: 5, resettle: 2, old: 1, buildings: 68, units: 196, homes: 3620, propertyRate: 97, garages: 11, rooms: 14, selfLive: 2540, rent: 820, vacant: 260 }, env: { sites: 2, bareSoil: 1850, farmland: 120, forest: 45, wetland: 18, rivers: 2.1, roads: 8.6, floodPts: 1, firePts: 1 }, gov: { points: 34, passRate: 97.1, aidStation: { wheelchair: 6, crutch: 10, medkit: 8, toolbox: 12, umbrella: 30 } }, armed: { militia: 28, militiaCap: '王大勇', recruitReg: 86, recruitApply: 28, recruitPass: 14, veterans: 112, eduPlaces: 2, eduCount: 9, eduPeople: 480 } },
  { name: '八里庄社区', center: [37.4608, 116.3652], lead: '林晓梅', phone: '0534-2681002', grids: 7, health: 'warn', pop: 8420, hukou: 6840, party: 176, committees: 8, gridStaff: 7, publicPost: 12, students: 980, elderly: 1710, malePct: 51.1, special: { elderAlone: 48, lowIncome: 28, disabled: 31, veteran: 42 }, honors: ['天衢新区基层党建先进单位'], biz: { large: 9, small: 84, self: 264, school: 4, coBuild: 5, residentUnit: 9, revenue: 12.4, employees: 2890 }, safety: { keyObj: 36, regEnt: 93, hazards: 26, fixed: 23, coverage: 94.2 }, housing: { commercial: 3, resettle: 3, old: 1, buildings: 56, units: 164, homes: 3120, propertyRate: 91, garages: 8, rooms: 11, selfLive: 2120, rent: 780, vacant: 220 }, env: { sites: 3, bareSoil: 4200, farmland: 310, forest: 68, wetland: 24, rivers: 1.8, roads: 7.4, floodPts: 2, firePts: 2 }, gov: { points: 28, passRate: 92.9, aidStation: { wheelchair: 4, crutch: 8, medkit: 6, toolbox: 10, umbrella: 24 } }, armed: { militia: 24, militiaCap: '刘振华', recruitReg: 72, recruitApply: 22, recruitPass: 11, veterans: 96, eduPlaces: 1, eduCount: 6, eduPeople: 320 } },
  { name: '杨庄社区', center: [37.4552, 116.3602], lead: '赵明远', phone: '0534-2681003', grids: 6, health: 'ok', pop: 7260, hukou: 5910, party: 158, committees: 7, gridStaff: 6, publicPost: 10, students: 840, elderly: 1490, malePct: 50.8, special: { elderAlone: 39, lowIncome: 19, disabled: 26, veteran: 37 }, honors: ['德州市平安建设示范社区'], biz: { large: 8, small: 76, self: 215, school: 4, coBuild: 5, residentUnit: 7, revenue: 10.8, employees: 2340 }, safety: { keyObj: 29, regEnt: 84, hazards: 17, fixed: 17, coverage: 97.6 }, housing: { commercial: 3, resettle: 2, old: 1, buildings: 48, units: 142, homes: 2680, propertyRate: 93, garages: 7, rooms: 9, selfLive: 1860, rent: 610, vacant: 210 }, env: { sites: 1, bareSoil: 1400, farmland: 260, forest: 52, wetland: 16, rivers: 1.4, roads: 6.2, floodPts: 1, firePts: 1 }, gov: { points: 25, passRate: 96.0, aidStation: { wheelchair: 5, crutch: 6, medkit: 6, toolbox: 8, umbrella: 20 } }, armed: { militia: 22, militiaCap: '杨志刚', recruitReg: 65, recruitApply: 19, recruitPass: 10, veterans: 84, eduPlaces: 1, eduCount: 7, eduPeople: 340 } },
  { name: '堤口社区', center: [37.4488, 116.3418], lead: '孙雅琴', phone: '0534-2681004', grids: 7, health: 'bad', pop: 8940, hukou: 6620, party: 184, committees: 8, gridStaff: 7, publicPost: 13, students: 1020, elderly: 1790, malePct: 50.2, special: { elderAlone: 52, lowIncome: 25, disabled: 33, veteran: 44 }, honors: ['德州市巾帼文明示范社区'], biz: { large: 11, small: 98, self: 292, school: 5, coBuild: 6, residentUnit: 10, revenue: 14.9, employees: 3360 }, safety: { keyObj: 44, regEnt: 109, hazards: 31, fixed: 27, coverage: 91.7 }, housing: { commercial: 4, resettle: 2, old: 2, buildings: 62, units: 178, homes: 3280, propertyRate: 89, garages: 9, rooms: 12, selfLive: 2190, rent: 860, vacant: 230 }, env: { sites: 3, bareSoil: 3650, farmland: 90, forest: 38, wetland: 26, rivers: 3.4, roads: 8.1, floodPts: 3, firePts: 2 }, gov: { points: 32, passRate: 90.6, aidStation: { wheelchair: 6, crutch: 9, medkit: 8, toolbox: 11, umbrella: 28 } }, armed: { militia: 26, militiaCap: '陈国强', recruitReg: 78, recruitApply: 25, recruitPass: 12, veterans: 98, eduPlaces: 1, eduCount: 8, eduPeople: 410 } },
  { name: '星凯社区', center: [37.4465, 116.3515], lead: '吴志强', phone: '0534-2681005', grids: 9, health: 'ok', pop: 11420, hukou: 7980, party: 246, committees: 10, gridStaff: 9, publicPost: 15, students: 1460, elderly: 1920, malePct: 49.8, special: { elderAlone: 46, lowIncome: 16, disabled: 28, veteran: 51 }, honors: ['山东省数字社区建设标杆', '德州市营商环境先锋社区'], biz: { large: 26, small: 168, self: 426, school: 7, coBuild: 12, residentUnit: 18, revenue: 36.2, employees: 7450 }, safety: { keyObj: 58, regEnt: 194, hazards: 24, fixed: 24, coverage: 99.0 }, housing: { commercial: 8, resettle: 1, old: 0, buildings: 76, units: 224, homes: 4280, propertyRate: 99, garages: 16, rooms: 18, selfLive: 2890, rent: 1140, vacant: 250 }, env: { sites: 2, bareSoil: 1200, farmland: 0, forest: 28, wetland: 12, rivers: 1.2, roads: 11.4, floodPts: 1, firePts: 1 }, gov: { points: 40, passRate: 97.5, aidStation: { wheelchair: 8, crutch: 12, medkit: 10, toolbox: 14, umbrella: 40 } }, armed: { militia: 32, militiaCap: '郭胜利', recruitReg: 94, recruitApply: 34, recruitPass: 18, veterans: 126, eduPlaces: 2, eduCount: 12, eduPeople: 680 } },
  { name: '尚德社区', center: [37.4418, 116.3585], lead: '马淑芬', phone: '0534-2681006', grids: 7, health: 'ok', pop: 8860, hukou: 6950, party: 192, committees: 8, gridStaff: 7, publicPost: 11, students: 1120, elderly: 1680, malePct: 49.6, special: { elderAlone: 44, lowIncome: 18, disabled: 25, veteran: 46 }, honors: ['德州市双拥模范社区'], biz: { large: 12, small: 104, self: 278, school: 5, coBuild: 8, residentUnit: 11, revenue: 16.5, employees: 3620 }, safety: { keyObj: 35, regEnt: 116, hazards: 19, fixed: 18, coverage: 96.8 }, housing: { commercial: 5, resettle: 1, old: 1, buildings: 58, units: 172, homes: 3340, propertyRate: 96, garages: 10, rooms: 13, selfLive: 2380, rent: 740, vacant: 220 }, env: { sites: 1, bareSoil: 960, farmland: 40, forest: 34, wetland: 14, rivers: 1.6, roads: 7.9, floodPts: 1, firePts: 1 }, gov: { points: 30, passRate: 96.7, aidStation: { wheelchair: 5, crutch: 8, medkit: 7, toolbox: 10, umbrella: 26 } }, armed: { militia: 25, militiaCap: '徐海军', recruitReg: 74, recruitApply: 24, recruitPass: 13, veterans: 118, eduPlaces: 1, eduCount: 9, eduPeople: 440 } },
  { name: '赵辛社区', center: [37.4402, 116.3672], lead: '高建平', phone: '0534-2681007', grids: 6, health: 'warn', pop: 6940, hukou: 5720, party: 142, committees: 7, gridStaff: 6, publicPost: 9, students: 790, elderly: 1460, malePct: 51.3, special: { elderAlone: 41, lowIncome: 24, disabled: 29, veteran: 34 }, honors: ['天衢新区生态宜居社区'], biz: { large: 6, small: 68, self: 194, school: 3, coBuild: 4, residentUnit: 6, revenue: 8.9, employees: 1980 }, safety: { keyObj: 26, regEnt: 74, hazards: 21, fixed: 18, coverage: 93.2 }, housing: { commercial: 2, resettle: 3, old: 1, buildings: 44, units: 132, homes: 2540, propertyRate: 90, garages: 6, rooms: 8, selfLive: 1780, rent: 560, vacant: 200 }, env: { sites: 2, bareSoil: 3800, farmland: 420, forest: 84, wetland: 32, rivers: 2.3, roads: 6.8, floodPts: 2, firePts: 3 }, gov: { points: 24, passRate: 91.7, aidStation: { wheelchair: 4, crutch: 6, medkit: 5, toolbox: 8, umbrella: 18 } }, armed: { militia: 20, militiaCap: '赵铁柱', recruitReg: 60, recruitApply: 18, recruitPass: 9, veterans: 76, eduPlaces: 1, eduCount: 5, eduPeople: 260 } },
  { name: '泰和社区', center: [37.4352, 116.3592], lead: '李文博', phone: '0534-2681008', grids: 8, health: 'ok', pop: 10240, hukou: 8120, party: 228, committees: 9, gridStaff: 8, publicPost: 14, students: 1340, elderly: 1980, malePct: 50.1, special: { elderAlone: 51, lowIncome: 20, disabled: 32, veteran: 56 }, honors: ['全国综合减灾示范社区', '德州市国防教育示范阵地'], biz: { large: 16, small: 124, self: 342, school: 6, coBuild: 9, residentUnit: 14, revenue: 22.1, employees: 4860 }, safety: { keyObj: 46, regEnt: 140, hazards: 20, fixed: 20, coverage: 98.6 }, housing: { commercial: 6, resettle: 2, old: 0, buildings: 70, units: 208, homes: 3840, propertyRate: 97, garages: 13, rooms: 15, selfLive: 2740, rent: 860, vacant: 240 }, env: { sites: 1, bareSoil: 1100, farmland: 60, forest: 48, wetland: 20, rivers: 1.9, roads: 9.2, floodPts: 1, firePts: 1 }, gov: { points: 36, passRate: 97.2, aidStation: { wheelchair: 7, crutch: 11, medkit: 9, toolbox: 12, umbrella: 34 } }, armed: { militia: 30, militiaCap: '孙立新', recruitReg: 82, recruitApply: 29, recruitPass: 15, veterans: 132, eduPlaces: 2, eduCount: 11, eduPeople: 620 } },
  { name: '锦绣社区', center: [37.4322, 116.3392], lead: '郑海燕', phone: '0534-2681009', grids: 8, health: 'ok', pop: 9860, hukou: 7740, party: 218, committees: 9, gridStaff: 8, publicPost: 13, students: 1280, elderly: 1840, malePct: 49.9, special: { elderAlone: 49, lowIncome: 19, disabled: 30, veteran: 49 }, honors: ['山东省志愿服务先进社区'], biz: { large: 15, small: 118, self: 308, school: 6, coBuild: 8, residentUnit: 13, revenue: 20.4, employees: 4380 }, safety: { keyObj: 41, regEnt: 133, hazards: 18, fixed: 17, coverage: 97.4 }, housing: { commercial: 6, resettle: 1, old: 1, buildings: 66, units: 194, homes: 3690, propertyRate: 96, garages: 12, rooms: 14, selfLive: 2620, rent: 830, vacant: 240 }, env: { sites: 2, bareSoil: 1620, farmland: 30, forest: 42, wetland: 18, rivers: 2.6, roads: 8.8, floodPts: 1, firePts: 1 }, gov: { points: 34, passRate: 97.1, aidStation: { wheelchair: 6, crutch: 10, medkit: 8, toolbox: 11, umbrella: 32 } }, armed: { militia: 28, militiaCap: '钱永刚', recruitReg: 79, recruitApply: 27, recruitPass: 14, veterans: 108, eduPlaces: 2, eduCount: 10, eduPeople: 560 } },
  { name: '明德社区', center: [37.4285, 116.3482], lead: '韩立军', phone: '0534-2681010', grids: 6, health: 'ok', pop: 7680, hukou: 6240, party: 164, committees: 7, gridStaff: 6, publicPost: 10, students: 920, elderly: 1520, malePct: 50.5, special: { elderAlone: 37, lowIncome: 17, disabled: 24, veteran: 41 }, honors: ['德州市文明实践样板社区'], biz: { large: 10, small: 86, self: 232, school: 4, coBuild: 6, residentUnit: 9, revenue: 13.7, employees: 2940 }, safety: { keyObj: 31, regEnt: 96, hazards: 15, fixed: 15, coverage: 98.0 }, housing: { commercial: 4, resettle: 1, old: 1, buildings: 52, units: 152, homes: 2860, propertyRate: 95, garages: 8, rooms: 10, selfLive: 2040, rent: 620, vacant: 200 }, env: { sites: 1, bareSoil: 1150, farmland: 80, forest: 36, wetland: 12, rivers: 1.3, roads: 6.9, floodPts: 1, firePts: 1 }, gov: { points: 26, passRate: 96.2, aidStation: { wheelchair: 5, crutch: 7, medkit: 6, toolbox: 9, umbrella: 22 } }, armed: { militia: 22, militiaCap: '韩志勇', recruitReg: 64, recruitApply: 20, recruitPass: 11, veterans: 92, eduPlaces: 1, eduCount: 7, eduPeople: 350 } },
  { name: '岳庄社区', center: [37.4215, 116.3592], lead: '曹国栋', phone: '0534-2681011', grids: 6, health: 'warn', pop: 6420, hukou: 5480, party: 136, committees: 7, gridStaff: 6, publicPost: 9, students: 710, elderly: 1420, malePct: 51.4, special: { elderAlone: 42, lowIncome: 26, disabled: 28, veteran: 33 }, honors: ['天衢新区乡风文明示范点'], biz: { large: 5, small: 62, self: 182, school: 3, coBuild: 4, residentUnit: 5, revenue: 7.6, employees: 1720 }, safety: { keyObj: 24, regEnt: 67, hazards: 19, fixed: 16, coverage: 92.5 }, housing: { commercial: 1, resettle: 3, old: 2, buildings: 42, units: 122, homes: 2380, propertyRate: 86, garages: 5, rooms: 8, selfLive: 1680, rent: 510, vacant: 190 }, env: { sites: 2, bareSoil: 3200, farmland: 540, forest: 96, wetland: 34, rivers: 2.4, roads: 6.1, floodPts: 2, firePts: 3 }, gov: { points: 22, passRate: 90.9, aidStation: { wheelchair: 4, crutch: 6, medkit: 5, toolbox: 8, umbrella: 18 } }, armed: { militia: 20, militiaCap: '岳明强', recruitReg: 56, recruitApply: 16, recruitPass: 8, veterans: 72, eduPlaces: 1, eduCount: 5, eduPeople: 240 } },
  { name: '郭家庵社区', center: [37.4192, 116.3765], lead: '郭秀莲', phone: '0534-2681012', grids: 5, health: 'ok', pop: 5680, hukou: 4920, party: 124, committees: 6, gridStaff: 5, publicPost: 8, students: 620, elderly: 1280, malePct: 51.0, special: { elderAlone: 38, lowIncome: 23, disabled: 24, veteran: 31 }, honors: ['德州市农村人居环境示范片区'], biz: { large: 4, small: 54, self: 158, school: 2, coBuild: 4, residentUnit: 4, revenue: 6.4, employees: 1460 }, safety: { keyObj: 21, regEnt: 58, hazards: 14, fixed: 14, coverage: 96.5 }, housing: { commercial: 1, resettle: 3, old: 1, buildings: 38, units: 112, homes: 2140, propertyRate: 88, garages: 4, rooms: 7, selfLive: 1540, rent: 420, vacant: 180 }, env: { sites: 1, bareSoil: 2400, farmland: 680, forest: 112, wetland: 42, rivers: 3.1, roads: 5.8, floodPts: 2, firePts: 3 }, gov: { points: 20, passRate: 95.0, aidStation: { wheelchair: 4, crutch: 5, medkit: 5, toolbox: 7, umbrella: 16 } }, armed: { militia: 18, militiaCap: '郭振国', recruitReg: 52, recruitApply: 15, recruitPass: 7, veterans: 68, eduPlaces: 1, eduCount: 4, eduPeople: 210 } },
  { name: '华嬉社区', center: [37.4085, 116.3542], lead: '沈丽华', phone: '0534-2681013', grids: 6, health: 'ok', pop: 7420, hukou: 5980, party: 152, committees: 7, gridStaff: 6, publicPost: 10, students: 960, elderly: 1380, malePct: 50.0, special: { elderAlone: 35, lowIncome: 16, disabled: 22, veteran: 38 }, honors: ['天衢新区青少年科普教育基地'], biz: { large: 11, small: 82, self: 224, school: 5, coBuild: 6, residentUnit: 8, revenue: 15.2, employees: 3180 }, safety: { keyObj: 30, regEnt: 93, hazards: 16, fixed: 16, coverage: 97.8 }, housing: { commercial: 4, resettle: 2, old: 0, buildings: 50, units: 148, homes: 2790, propertyRate: 95, garages: 9, rooms: 11, selfLive: 1960, rent: 640, vacant: 190 }, env: { sites: 2, bareSoil: 1750, farmland: 220, forest: 64, wetland: 28, rivers: 1.7, roads: 7.2, floodPts: 1, firePts: 2 }, gov: { points: 26, passRate: 96.2, aidStation: { wheelchair: 5, crutch: 7, medkit: 6, toolbox: 9, umbrella: 24 } }, armed: { militia: 22, militiaCap: '沈建军', recruitReg: 63, recruitApply: 21, recruitPass: 10, veterans: 82, eduPlaces: 2, eduCount: 8, eduPeople: 460 } },
  { name: '芦李府社区', center: [37.3945, 116.3612], lead: '芦建明', phone: '0534-2681014', grids: 5, health: 'warn', pop: 5340, hukou: 4680, party: 118, committees: 6, gridStaff: 5, publicPost: 8, students: 580, elderly: 1210, malePct: 51.2, special: { elderAlone: 36, lowIncome: 22, disabled: 23, veteran: 29 }, honors: ['德州市基层武装规范达标点'], biz: { large: 4, small: 48, self: 146, school: 2, coBuild: 3, residentUnit: 4, revenue: 5.8, employees: 1320 }, safety: { keyObj: 19, regEnt: 52, hazards: 16, fixed: 14, coverage: 93.8 }, housing: { commercial: 1, resettle: 2, old: 2, buildings: 34, units: 102, homes: 1980, propertyRate: 85, garages: 4, rooms: 6, selfLive: 1420, rent: 390, vacant: 170 }, env: { sites: 1, bareSoil: 2900, farmland: 760, forest: 128, wetland: 48, rivers: 2.8, roads: 5.4, floodPts: 2, firePts: 4 }, gov: { points: 18, passRate: 91.2, aidStation: { wheelchair: 3, crutch: 5, medkit: 4, toolbox: 7, umbrella: 14 } }, armed: { militia: 19, militiaCap: '芦海波', recruitReg: 48, recruitApply: 14, recruitPass: 7, veterans: 64, eduPlaces: 1, eduCount: 5, eduPeople: 230 } }
]

export const COMMUNITIES = RAW_COMMUNITIES.map((c, idx) => {
  const geo = getCommunityGeo(c.name, c.center[0], c.center[1])
  return {
    ...c,
    id: `comm-${idx + 1}`,
    center: geo.center,
    polygon: geo.polygon,
    branches: [
      { name: `${c.name}第一网格党支部`, members: Math.round(c.party * 0.36), area: `${c.name}北区住宅与商业片区`, secretary: c.lead },
      { name: `${c.name}第二网格党支部`, members: Math.round(c.party * 0.34), area: `${c.name}中区回迁与公共配套区`, secretary: ['王明', '李芳', '赵军', '孙丽'][idx % 4] },
      { name: `${c.name}两新组织联合党支部`, members: c.party - Math.round(c.party * 0.36) - Math.round(c.party * 0.34), area: `${c.name}沿街商铺与楼宇经济带`, secretary: ['周鹏', '吴梅', '郑伟', '陈敏'][idx % 4] }
    ]
  }
})

// 按社区真实质心微调事件与点位坐标，落在社区边界内同时自然避开中心社区铭牌
function snapEventCoords(events) {
  const offsets = [
    [-0.0017, 0.0022],
    [0.0018, -0.0024],
    [-0.0016, -0.0022],
    [0.0017, 0.0024],
    [-0.0021, 0.0008]
  ]
  return events.map((ev, idx) => {
    const geo = CHANGHE_COMMUNITY_GEO[ev.community]
    if (!geo) return ev
    const [dLat, dLng] = offsets[idx % offsets.length]
    return {
      ...ev,
      lat: +(geo.center[0] + dLat).toFixed(5),
      lng: +(geo.center[1] + dLng).toFixed(5)
    }
  })
}

export const EVENT_CATEGORIES = ['矛盾纠纷', '安全生产', '生态环保', '物业服务']
export const EVENT_STAGES = ['待受理', '待补充', '待派单', '处置中', '待复核', '已办结']

export function createInitialState() {
  const defaultRules = [
    { id: 'rule-1', category: '安全生产', subType: '高层楼道消防通道占用', urgency: '紧急', acceptRole: '社区综治专干', dispatchOwner: '街道应急管理办 + 物业联动组', deadlineHours: 12, reviewRole: '街道综治中心', yellowPct: 70 },
    { id: 'rule-2', category: '安全生产', subType: '九小场所燃气与消防隐患', urgency: '紧急', acceptRole: '社区综治专干', dispatchOwner: '街道应急管理办', deadlineHours: 24, reviewRole: '街道综治中心', yellowPct: 70 },
    { id: 'rule-3', category: '矛盾纠纷', subType: '邻里噪声与公共空间争议', urgency: '一般', acceptRole: '社区网格长', dispatchOwner: '社区人民调解委员会 + 社区民警', deadlineHours: 48, reviewRole: '社区党总支', yellowPct: 75 },
    { id: 'rule-4', category: '生态环保', subType: '工地裸土扬尘与餐饮油烟', urgency: '一般', acceptRole: '社区生态环保员', dispatchOwner: '街道生态环境办 + 综合执法队', deadlineHours: 24, reviewRole: '街道综治中心', yellowPct: 70 },
    { id: 'rule-5', category: '生态环保', subType: '河湖漂浮物与易涝口淤堵', urgency: '紧急', acceptRole: '社区河长联络员', dispatchOwner: '街道市政水利养护队', deadlineHours: 12, reviewRole: '街道综治中心', yellowPct: 70 },
    { id: 'rule-6', category: '物业服务', subType: '小区电梯停运/路灯照明故障', urgency: '一般', acceptRole: '社区物业专干', dispatchOwner: '街道物业监管办 + 小区物业处', deadlineHours: 36, reviewRole: '社区网格长', yellowPct: 75 }
  ]

  const seedEvents = [
    {
      id: 'ev-1',
      title: '金辰云河赋 3 号楼 2 单元消防通道堆积杂物',
      category: '安全生产',
      subType: '高层楼道消防通道占用',
      community: '德馨社区',
      grid: '第一网格',
      address: '德馨社区 · 金辰云河赋 3 号楼 2 单元 4 楼连廊',
      lat: 37.4638,
      lng: 116.3526,
      reporter: '李敏',
      owner: '待分派',
      stage: '待受理',
      urgency: '紧急',
      deadlineHours: 12,
      elapsedHours: 3.5,
      createdAt: '2026-11-19 09:24',
      description: '一线入户巡查发现 4 楼消防连廊堆放废旧纸箱及电动车配件，阻塞疏散通道，已现场劝导并拍照留痕。',
      beforePhoto: buildScenePhoto({ scene: 'before', title: '金辰云河赋3号楼消防通道占用', location: '德馨社区 · 金辰云河赋3号楼2单元', time: '2026-11-19 09:24', person: '网格员 李敏' }),
      afterPhoto: '',
      returnReason: '',
      reminded: false,
      history: [
        { node: '掌上网格现场直报', operator: '李敏（德馨社区第一网格）', detail: '已自动定位并上传水印现场隐患照', time: '2026-11-19 09:24' }
      ]
    },
    {
      id: 'ev-2',
      title: '堤口东路沿街餐饮后厨燃气软管老化未装报警器',
      category: '安全生产',
      subType: '九小场所燃气与消防隐患',
      community: '堤口社区',
      grid: '第二网格',
      address: '堤口社区 · 堤口东路临街商铺 16 号老味面馆',
      lat: 37.4494,
      lng: 116.3428,
      reporter: '王琪',
      owner: '街道应急管理办',
      stage: '待复核',
      urgency: '紧急',
      deadlineHours: 24,
      elapsedHours: 18.2,
      createdAt: '2026-11-18 15:10',
      description: '巡查九小场所发现液化气软管老化开裂，责令限期更换金属波纹管并加装独立式燃气报警器。',
      beforePhoto: buildScenePhoto({ scene: 'before', title: '餐饮后厨燃气软管隐患排查', location: '堤口社区 · 堤口东路16号', time: '2026-11-18 15:10', person: '网格员 王琪' }),
      afterPhoto: buildScenePhoto({ scene: 'after', title: '已更换金属波纹管并装报警器', location: '堤口社区 · 堤口东路16号', time: '2026-11-19 08:45', person: '应急办 陈明' }),
      returnReason: '',
      reminded: false,
      history: [
        { node: '现场直报', operator: '王琪', detail: '上传后厨燃气隐患照并同步坐标', time: '2026-11-18 15:10' },
        { node: '按权责清单派单', operator: '张志国（街道管理员）', detail: '自动匹配派发至街道应急管理办，时限 24 小时', time: '2026-11-18 15:32' },
        { node: '整改反馈待复核', operator: '陈明（街道应急管理办）', detail: '已完成金属波纹管更换与报警器通电测试，回传整改后验收照', time: '2026-11-19 08:45' }
      ]
    },
    {
      id: 'ev-3',
      title: '八里庄北侧在建工地裸土防尘网破损扬尘',
      category: '生态环保',
      subType: '工地裸土扬尘与餐饮油烟',
      community: '八里庄社区',
      grid: '第三网格',
      address: '八里庄社区 · 天衢东路北侧待建地块东角',
      lat: 37.4614,
      lng: 116.3665,
      reporter: '陈晓',
      owner: '街道生态环境办 + 综合执法队',
      stage: '处置中',
      urgency: '一般',
      deadlineHours: 24,
      elapsedHours: 26.5,
      createdAt: '2026-11-18 09:05',
      description: '大风天气导致施工区域约 420 平方米裸土防尘网掀翻，存在扬尘污染风险。',
      beforePhoto: buildScenePhoto({ scene: 'before', title: '工地裸土防尘网破损', location: '八里庄社区 · 天衢东路北侧', time: '2026-11-18 09:05', person: '网格员 陈晓' }),
      afterPhoto: '',
      returnReason: '',
      reminded: true,
      history: [
        { node: '现场直报', operator: '陈晓', detail: '定位标注裸土位置并上传照片', time: '2026-11-18 09:05' },
        { node: '权责自动派单', operator: '张志国', detail: '派发至街道生态环境办与综合执法队联合处置', time: '2026-11-18 09:30' },
        { node: '红牌超时督办', operator: '系统自动预警', detail: '已超出 24 小时办结时限，自动亮红牌推送街道值班领导', time: '2026-11-19 09:30' }
      ]
    },
    {
      id: 'ev-4',
      title: '德馨社区华庭小区夜间装修噪声邻里纠纷',
      category: '矛盾纠纷',
      subType: '邻里噪声与公共空间争议',
      community: '德馨社区',
      grid: '第一网格',
      address: '德馨社区 · 崇德公馆 5 号楼 1 单元 302 室',
      lat: 37.4622,
      lng: 116.3544,
      reporter: '李敏',
      owner: '待分派',
      stage: '待补充',
      urgency: '一般',
      deadlineHours: 48,
      elapsedHours: 5.0,
      createdAt: '2026-11-19 07:40',
      description: '楼下居民反映昨晚 22:30 仍有敲击施工声影响老人休息，希望社区联合调解。',
      beforePhoto: buildScenePhoto({ scene: 'before', title: '居民反映夜间装修扰民', location: '德馨社区 · 崇德公馆5号楼', time: '2026-11-19 07:40', person: '网格员 李敏' }),
      afterPhoto: '',
      returnReason: '请补充核实涉及业主联系方式及物业已告知情况说明，便于调解员同步介入。',
      reminded: false,
      history: [
        { node: '现场直报', operator: '李敏', detail: '登记居民反映情况', time: '2026-11-19 07:40' },
        { node: '受理退回补充', operator: '周建国（德馨社区管理员）', detail: '退回意见：请补充核实涉及业主联系方式及物业已告知情况说明', time: '2026-11-19 08:15' }
      ]
    },
    {
      id: 'ev-5',
      title: '星凯国际广场西侧非机动车棚夜间照明故障',
      category: '物业服务',
      subType: '小区电梯停运/路灯照明故障',
      community: '星凯社区',
      grid: '第二网格',
      address: '星凯社区 · 星凯国际广场西侧集中充电棚',
      lat: 37.4468,
      lng: 116.3502,
      reporter: '刘洋',
      owner: '街道物业监管办 + 小区物业处',
      stage: '已办结',
      urgency: '一般',
      deadlineHours: 36,
      elapsedHours: 6.4,
      createdAt: '2026-11-17 19:20',
      description: '集中充电棚 3 盏照明灯熄灭，夜间居民充电存取不便。',
      beforePhoto: buildScenePhoto({ scene: 'before', title: '充电棚照明熄灭', location: '星凯社区 · 星凯国际广场', time: '2026-11-17 19:20', person: '网格员 刘洋' }),
      afterPhoto: buildScenePhoto({ scene: 'after', title: '照明电路修复亮灯验收', location: '星凯社区 · 星凯国际广场', time: '2026-11-18 09:40', person: '星凯物业电工组' }),
      returnReason: '',
      reminded: false,
      history: [
        { node: '现场直报', operator: '刘洋', detail: '晚间巡查发现照明熄灭', time: '2026-11-17 19:20' },
        { node: '按责派单', operator: '张志国', detail: '派发至星凯物业工程部限时检修', time: '2026-11-17 19:45' },
        { node: '整改完成回传', operator: '星凯物业处', detail: '更换损坏空气开关与灯管 3 组', time: '2026-11-18 09:40' },
        { node: '复核通过归档', operator: '张志国（街道管理员）', detail: '双图水印比对合格，已归档入达梦信创库', time: '2026-11-18 10:15' }
      ]
    },
    {
      id: 'ev-6',
      title: '堤口片区低洼路段雨水箅子落叶淤堵隐患',
      category: '生态环保',
      subType: '河湖漂浮物与易涝口淤堵',
      community: '堤口社区',
      grid: '第一网格',
      address: '堤口社区 · 岔河东大道与三八东路交口低洼点',
      lat: 37.4479,
      lng: 116.3404,
      reporter: '王琪',
      owner: '街道市政水利养护队',
      stage: '待派单',
      urgency: '紧急',
      deadlineHours: 12,
      elapsedHours: 2.1,
      createdAt: '2026-11-19 10:12',
      description: '易涝积水监测点周边雨水箅子被落叶杂物覆盖，需雨前完成清掏疏通。',
      beforePhoto: buildScenePhoto({ scene: 'before', title: '易涝点雨水箅子淤堵', location: '堤口社区 · 岔河东大道交口', time: '2026-11-19 10:12', person: '网格员 王琪' }),
      afterPhoto: '',
      returnReason: '',
      reminded: false,
      history: [
        { node: '现场直报', operator: '王琪', detail: '巡查易涝点位上报', time: '2026-11-19 10:12' },
        { node: '社区审核受理', operator: '孙雅琴', detail: '核实属实，提请街道统筹派单', time: '2026-11-19 10:28' }
      ]
    },
    {
      id: 'ev-7',
      title: '泰和·名仕馨港东门沿街商铺门前占道堆物劝导',
      category: '矛盾纠纷',
      subType: '邻里噪声与公共空间争议',
      community: '泰和社区',
      grid: '第二网格',
      address: '泰和社区 · 泰和·名仕馨港东门商业街 8 号',
      lat: 37.4358,
      lng: 116.3586,
      reporter: '张伟',
      owner: '社区综合治理组',
      stage: '已办结',
      urgency: '一般',
      deadlineHours: 48,
      elapsedHours: 4.5,
      createdAt: '2026-11-17 14:15',
      description: '建材商铺在盲道堆放瓷砖影响通行，经网格员联合劝导已完成清运。',
      beforePhoto: buildScenePhoto({ scene: 'before', title: '商铺占压盲道堆放建材', location: '泰和社区 · 泰和·名仕馨港东门', time: '2026-11-17 14:15', person: '网格员 张伟' }),
      afterPhoto: buildScenePhoto({ scene: 'after', title: '盲道清空恢复通行', location: '泰和社区 · 泰和·名仕馨港东门', time: '2026-11-17 18:10', person: '泰和社区治理组' }),
      returnReason: '',
      reminded: false,
      history: [
        { node: '现场直报', operator: '张伟', detail: '巡查上报占道堆物', time: '2026-11-17 14:15' },
        { node: '复核通过归档', operator: '张志国', detail: '已清理完毕并归档', time: '2026-11-17 18:45' }
      ]
    },
    {
      id: 'ev-8',
      title: '岳庄林地边缘杂草枯枝防火隐患点清理',
      category: '安全生产',
      subType: '九小场所燃气与消防隐患',
      community: '岳庄社区',
      grid: '第一网格',
      address: '岳庄社区 · 东侧防护林带防火隐患点',
      lat: 37.4222,
      lng: 116.3604,
      reporter: '赵磊',
      owner: '街道应急管理办',
      stage: '处置中',
      urgency: '紧急',
      deadlineHours: 24,
      elapsedHours: 17.5,
      createdAt: '2026-11-18 16:40',
      description: '秋冬风干物燥，林缘堆积枯枝杂草，存在野外用火引燃隐患，已组织清运。',
      beforePhoto: buildScenePhoto({ scene: 'before', title: '林缘枯枝杂草防火隐患', location: '岳庄社区 · 东侧防护林带', time: '2026-11-18 16:40', person: '网格员 赵磊' }),
      afterPhoto: '',
      returnReason: '',
      reminded: false,
      history: [
        { node: '现场直报', operator: '赵磊', detail: '秋冬防火专项巡查发现', time: '2026-11-18 16:40' },
        { node: '权责派单', operator: '张志国', detail: '派发街道应急管理办与岳庄社区联勤清运', time: '2026-11-18 17:02' }
      ]
    },
    {
      id: 'ev-9',
      title: '芦李府社区老旧片区单元门禁损坏维修',
      category: '物业服务',
      subType: '小区电梯停运/路灯照明故障',
      community: '芦李府社区',
      grid: '第一网格',
      address: '芦李府社区 · 安居苑 2 号楼 1 单元',
      lat: 37.3952,
      lng: 116.3618,
      reporter: '孙涛',
      owner: '街道物业监管办 + 托底物业',
      stage: '已办结',
      urgency: '一般',
      deadlineHours: 36,
      elapsedHours: 11.2,
      createdAt: '2026-11-16 10:15',
      description: '单元门闭门器松动无法自动闭合，已维修加固。',
      beforePhoto: buildScenePhoto({ scene: 'before', title: '单元门禁闭门器松动', location: '芦李府社区 · 安居苑2号楼', time: '2026-11-16 10:15', person: '网格员 孙涛' }),
      afterPhoto: buildScenePhoto({ scene: 'after', title: '闭门器更换修复', location: '芦李府社区 · 安居苑2号楼', time: '2026-11-16 20:50', person: '托底物业维修班' }),
      returnReason: '',
      reminded: false,
      history: [
        { node: '现场直报', operator: '孙涛', detail: '巡查上报门禁故障', time: '2026-11-16 10:15' },
        { node: '复核通过归档', operator: '张志国', detail: '已验收结案', time: '2026-11-16 21:20' }
      ]
    },
    {
      id: 'ev-10',
      title: '赵辛社区农田灌溉沟渠漂浮物集中打捞',
      category: '生态环保',
      subType: '河湖漂浮物与易涝口淤堵',
      community: '赵辛社区',
      grid: '第二网格',
      address: '赵辛社区 · 减河支渠西岸段',
      lat: 37.4408,
      lng: 116.3681,
      reporter: '陈晓',
      owner: '街道市政水利养护队',
      stage: '已办结',
      urgency: '一般',
      deadlineHours: 24,
      elapsedHours: 8.0,
      createdAt: '2026-11-16 08:30',
      description: '支渠水面聚集塑料袋与枯苇，已完成打捞清运。',
      beforePhoto: buildScenePhoto({ scene: 'before', title: '支渠水面漂浮物', location: '赵辛社区 · 减河支渠', time: '2026-11-16 08:30', person: '网格员 陈晓' }),
      afterPhoto: buildScenePhoto({ scene: 'after', title: '水面打捞洁净验收', location: '赵辛社区 · 减河支渠', time: '2026-11-16 16:05', person: '市政养护队' }),
      returnReason: '',
      reminded: false,
      history: [
        { node: '现场直报', operator: '陈晓', detail: '河长制巡查上报', time: '2026-11-16 08:30' },
        { node: '复核通过归档', operator: '张志国', detail: '验收通过归档', time: '2026-11-16 16:30' }
      ]
    }
  ]

  // 本月已闭环归档典型事件（覆盖全街道 14 个真实社区，保证驾驶舱办结率与各社区下钻口径真实饱满）
  const archivedClosedSeed = [
    ['ev-11', '德馨社区金辰云河赋南门非机动车充电棚线路老化整治', '安全生产', '九小场所燃气与消防隐患', '德馨社区', '第二网格', 37.4628, 116.3518, '李敏', '街道应急管理办', 5.2, '2026-11-15 10:12'],
    ['ev-12', '德馨社区沿街早餐店油烟净化滤网清洗核验', '生态环保', '工地裸土扬尘与餐饮油烟', '德馨社区', '第一网格', 37.4641, 116.3540, '李敏', '街道生态环境办', 7.4, '2026-11-14 08:50'],
    ['ev-13', '崇德公馆 2 号楼地下车库排水泵异响检修闭环', '物业服务', '小区电梯停运/路灯照明故障', '德馨社区', '第三网格', 37.4619, 116.3522, '周鹏', '街道物业监管办', 9.1, '2026-11-13 14:20'],
    ['ev-14', '八里庄社区商贸街消防栓水压不足联合维保', '安全生产', '高层楼道消防通道占用', '八里庄社区', '第一网格', 37.4601, 116.3645, '陈晓', '街道应急管理办', 6.8, '2026-11-15 09:40'],
    ['ev-15', '八里庄盛世华园楼下商铺装卸货噪声调处', '矛盾纠纷', '邻里噪声与公共空间争议', '八里庄社区', '第二网格', 37.4615, 116.3638, '陈晓', '社区人民调解委员会', 11.5, '2026-11-12 16:05'],
    ['ev-16', '杨庄社区老年活动室配电箱漏保升级整改', '安全生产', '九小场所燃气与消防隐患', '杨庄社区', '第一网格', 37.4556, 116.3608, '杨波', '街道应急管理办', 4.6, '2026-11-15 15:10'],
    ['ev-17', '杨庄社区北侧绿化带枯枝清运及补植修复', '生态环保', '工地裸土扬尘与餐饮油烟', '杨庄社区', '第二网格', 37.4548, 116.3596, '杨波', '街道生态环境办', 8.3, '2026-11-11 10:30'],
    ['ev-18', '堤口社区岔河西路临街汽修店危废暂存规范整改', '生态环保', '工地裸土扬尘与餐饮油烟', '堤口社区', '第二网格', 37.4485, 116.3409, '王琪', '街道生态环境办', 10.2, '2026-11-14 11:15'],
    ['ev-19', '嘉诚·尚东 7 号楼老人上下楼无障碍扶手加装协调', '矛盾纠纷', '邻里噪声与公共空间争议', '堤口社区', '第一网格', 37.4498, 116.3422, '王琪', '社区综合治理组', 14.0, '2026-11-10 09:00'],
    ['ev-20', '星凯国际写字楼 B 座客梯维保告警现场复核', '物业服务', '小区电梯停运/路灯照明故障', '星凯社区', '第一网格', 37.4461, 116.3524, '刘洋', '街道物业监管办', 3.8, '2026-11-16 13:45'],
    ['ev-21', '星凯商圈夜市摊点燃气瓶合规减压阀全量排查', '安全生产', '九小场所燃气与消防隐患', '星凯社区', '第三网格', 37.4472, 116.3508, '刘洋', '街道应急管理办', 6.5, '2026-11-14 19:10'],
    ['ev-22', '尚德社区双拥路沿线非机动车停车线施划疏导', '物业服务', '小区电梯停运/路灯照明故障', '尚德社区', '第一网格', 37.4422, 116.3589, '马琳', '街道市政养护队', 7.9, '2026-11-15 08:25'],
    ['ev-23', '尚德社区邻里渗水维修费用分摊人民调解结案', '矛盾纠纷', '邻里噪声与公共空间争议', '尚德社区', '第二网格', 37.4414, 116.3578, '马琳', '社区人民调解委员会', 16.4, '2026-11-11 14:40'],
    ['ev-24', '赵辛社区东侧排灌渠垃圾拦截网清淤维护', '生态环保', '河湖漂浮物与易涝口淤堵', '赵辛社区', '第一网格', 37.4398, 116.3665, '赵刚', '街道市政水利养护队', 6.1, '2026-11-13 09:20'],
    ['ev-25', '泰和·名仕馨港 11 号楼电动车入户充电隐患劝改闭环', '安全生产', '高层楼道消防通道占用', '泰和社区', '第一网格', 37.4349, 116.3596, '张伟', '街道应急管理办', 4.2, '2026-11-16 17:30'],
    ['ev-26', '锦绣社区党群服务中心东侧路灯断电抢修亮灯', '物业服务', '小区电梯停运/路灯照明故障', '锦绣社区', '第二网格', 37.4326, 116.3398, '郑凯', '街道物业监管办', 5.5, '2026-11-15 18:40'],
    ['ev-27', '明德社区小学放学时段占道流动摊点联合劝离', '矛盾纠纷', '邻里噪声与公共空间争议', '明德社区', '第一网格', 37.4288, 116.3486, '韩静', '综合执法队', 3.2, '2026-11-16 16:50'],
    ['ev-28', '岳庄社区村居快递驿站灭火器过期更换验收', '安全生产', '九小场所燃气与消防隐患', '岳庄社区', '第二网格', 37.4212, 116.3585, '赵磊', '街道应急管理办', 7.0, '2026-11-14 10:15'],
    ['ev-29', '郭家庵社区农田秸秆禁烧巡查及清运归档', '生态环保', '工地裸土扬尘与餐饮油烟', '郭家庵社区', '第一网格', 37.4195, 116.3758, '郭敏', '街道生态环境办', 6.4, '2026-11-13 15:00'],
    ['ev-30', '华嬉社区文体广场健身器材松动加固修复', '物业服务', '小区电梯停运/路灯照明故障', '华嬉社区', '第一网格', 37.4088, 116.3546, '沈洁', '街道物业监管办', 8.2, '2026-11-12 11:30']
  ].map(([id, title, category, subType, community, grid, lat, lng, reporter, owner, elapsedHours, createdAt]) => ({
    id,
    title,
    category,
    subType,
    community,
    grid,
    address: `${community} · ${grid}责任片区`,
    lat,
    lng,
    reporter,
    owner,
    stage: '已办结',
    urgency: category === '安全生产' ? '紧急' : '一般',
    deadlineHours: category === '安全生产' ? 24 : 36,
    elapsedHours,
    createdAt,
    description: `网格员 ${reporter} 常规巡查发现并现场留痕上报，经 ${owner} 按权责清单限期处置，已完成双图验收归档。`,
    beforePhoto: buildScenePhoto({ scene: 'before', title, location: `${community} · ${grid}`, time: createdAt, person: `网格员 ${reporter}` }),
    afterPhoto: buildScenePhoto({ scene: 'after', title: `已整改验收：${title}`, location: `${community} · ${grid}`, time: createdAt, person: owner }),
    returnReason: '',
    reminded: false,
    history: [
      { node: '掌上网格直报', operator: reporter, detail: '巡查发现并同步现场水印定位照', time: createdAt },
      { node: '按责派单处置', operator: owner, detail: '限期完成现场整治并回传验收凭证', time: createdAt },
      { node: '复核通过归档', operator: '张志国（街道管理员）', detail: '双图比对验收合格，归档入达梦信创库', time: createdAt }
    ]
  }))

  seedEvents.push(...archivedClosedSeed)

  // 立体楼栋房态剖面数据（18 层真实高层住宅 72 户 + B1 车库 + 18 层商务写字楼 + 沿街商圈）
  const baseSixRooms = {
    '一单元-601': { room: '601', status: '自住', peopleCount: 3, owner: '张志远', phone: '13853412641', idCard: '371402197804152816', tenant: '', careTags: [], hazard: '', lastVerify: '2026-11-15', verifier: '李敏', careLogs: [{ time: '2026-11-15 10:10', operator: '李敏', action: '入户核验无变动', reason: '月度常态走访' }] },
    '一单元-602': { room: '602', status: '出租', peopleCount: 2, owner: '刘建华', phone: '13953429918', idCard: '371402198902113421', tenant: '赵小鹏、孙丽（务工租住）', careTags: [], hazard: '', lastVerify: '2026-11-12', verifier: '李敏', careLogs: [{ time: '2026-11-12 15:20', operator: '李敏', action: '登记新迁入租户 2 人', reason: '租房核验更新' }] },
    '一单元-501': { room: '501', status: '自住', peopleCount: 2, owner: '赵德明', phone: '18653413319', idCard: '371402195209180412', tenant: '', careTags: ['退役优抚'], hazard: '', lastVerify: '2026-11-18', verifier: '李敏', careLogs: [{ time: '2026-11-18 14:20', operator: '周建国', action: '复核确认「退役优抚」标签', reason: '武装部双拥台账比对一致' }] },
    '一单元-502': { room: '502', status: '空置', peopleCount: 0, owner: '孙启明', phone: '15053487721', idCard: '371402198305221933', tenant: '', careTags: [], hazard: '', lastVerify: '2026-11-05', verifier: '李敏', careLogs: [] },
    '一单元-401': { room: '401', status: '自住', peopleCount: 4, owner: '周文涛', phone: '13753464132', idCard: '371402198506123318', tenant: '', careTags: [], hazard: '楼道堆放纸箱', lastVerify: '2026-11-19', verifier: '李敏', careLogs: [{ time: '2026-11-19 09:24', operator: '李敏', action: '标记消防通道占用隐患', reason: '现场巡查发现已上报事件' }] },
    '一单元-402': { room: '402', status: '出租', peopleCount: 3, owner: '吴梅', phone: '13553466028', idCard: '371402199008142110', tenant: '高飞等 3 人（合租待复核）', careTags: [], hazard: '', lastVerify: '2026-11-10', verifier: '李敏', careLogs: [] },
    '一单元-301': { room: '301', status: '自住', peopleCount: 1, owner: '王秀兰', phone: '13953417820', idCard: '371402194311082426', tenant: '', careTags: ['独居高龄', '低保特困'], hazard: '', lastVerify: '2026-11-18', verifier: '李敏', careLogs: [{ time: '2026-11-18 15:20', operator: '周建国', action: '新增「独居高龄」关怀标签', reason: '社区入户确认子女外地工作，纳入每周 2 次包保探访' }, { time: '2026-10-09 09:40', operator: '李敏', action: '常规探访无异常', reason: '已安装独立烟感报警器' }] },
    '一单元-302': { room: '302', status: '自住', peopleCount: 3, owner: '陈国强', phone: '13653415190', idCard: '371402197503211019', tenant: '', careTags: [], hazard: '', lastVerify: '2026-11-14', verifier: '李敏', careLogs: [] },
    '一单元-201': { room: '201', status: '自住', peopleCount: 2, owner: '马桂芳', phone: '15853417741', idCard: '371402195607043025', tenant: '', careTags: ['重度残障'], hazard: '', lastVerify: '2026-11-16', verifier: '李敏', careLogs: [{ time: '2026-11-16 11:05', operator: '周建国', action: '同步残联无障碍帮扶标签', reason: '民政残联共享库核对通过' }] },
    '一单元-202': { room: '202', status: '出租', peopleCount: 2, owner: '郭强', phone: '13853492210', idCard: '371402198812194213', tenant: '林晓、陈静', careTags: [], hazard: '', lastVerify: '2026-11-11', verifier: '李敏', careLogs: [] },
    '一单元-101': { room: '101', status: '自住', peopleCount: 2, owner: '李明德', phone: '13953444418', idCard: '371402194805190817', tenant: '', careTags: ['独居高龄'], hazard: '', lastVerify: '2026-11-17', verifier: '李敏', careLogs: [] },
    '一单元-102': { room: '102', status: '自住', peopleCount: 3, owner: '郑海波', phone: '13753431188', idCard: '371402198201251614', tenant: '', careTags: [], hazard: '', lastVerify: '2026-11-13', verifier: '李敏', careLogs: [] },
    '二单元-601': { room: '601', status: '自住', peopleCount: 2, owner: '胡伟', phone: '13853461102', idCard: '371402198109123115', tenant: '', careTags: [], hazard: '', lastVerify: '2026-11-14', verifier: '李敏', careLogs: [] },
    '二单元-602': { room: '602', status: '空置', peopleCount: 0, owner: '梁红', phone: '13953462203', idCard: '371402197903152224', tenant: '', careTags: [], hazard: '', lastVerify: '2026-11-08', verifier: '李敏', careLogs: [] },
    '二单元-501': { room: '501', status: '出租', peopleCount: 3, owner: '宋军', phone: '13553463304', idCard: '371402198611021518', tenant: '张鹏等 3 人', careTags: [], hazard: '', lastVerify: '2026-11-12', verifier: '李敏', careLogs: [] },
    '二单元-502': { room: '502', status: '自住', peopleCount: 3, owner: '徐丽', phone: '15053464405', idCard: '371402198407282627', tenant: '', careTags: [], hazard: '', lastVerify: '2026-11-15', verifier: '李敏', careLogs: [] },
    '二单元-401': { room: '401', status: '自住', peopleCount: 2, owner: '董建军', phone: '18653465506', idCard: '371402196004101316', tenant: '', careTags: ['退役优抚'], hazard: '', lastVerify: '2026-11-17', verifier: '李敏', careLogs: [] },
    '二单元-402': { room: '402', status: '自住', peopleCount: 4, owner: '袁芳', phone: '13753466607', idCard: '371402198702193729', tenant: '', careTags: [], hazard: '楼道杂物占用', lastVerify: '2026-11-19', verifier: '李敏', careLogs: [] },
    '二单元-301': { room: '301', status: '自住', peopleCount: 2, owner: '曹勇', phone: '13653467708', idCard: '371402197610051112', tenant: '', careTags: [], hazard: '', lastVerify: '2026-11-13', verifier: '李敏', careLogs: [] },
    '二单元-302': { room: '302', status: '出租', peopleCount: 2, owner: '田甜', phone: '15853468809', idCard: '371402199105144120', tenant: '周凯、吴婷', careTags: [], hazard: '', lastVerify: '2026-11-11', verifier: '李敏', careLogs: [] },
    '二单元-201': { room: '201', status: '自住', peopleCount: 1, owner: '周桂芬', phone: '13953469910', idCard: '371402194508230921', tenant: '', careTags: ['独居高龄'], hazard: '', lastVerify: '2026-11-18', verifier: '李敏', careLogs: [] },
    '二单元-202': { room: '202', status: '自住', peopleCount: 3, owner: '谢明', phone: '13853470011', idCard: '371402198012011819', tenant: '', careTags: [], hazard: '', lastVerify: '2026-11-16', verifier: '李敏', careLogs: [] },
    '二单元-101': { room: '101', status: '自住', peopleCount: 2, owner: '冯国梁', phone: '13953471112', idCard: '371402195403290510', tenant: '', careTags: [], hazard: '', lastVerify: '2026-11-14', verifier: '李敏', careLogs: [] },
    '二单元-102': { room: '102', status: '空置', peopleCount: 0, owner: '邓超群', phone: '13753472213', idCard: '371402198306172914', tenant: '', careTags: [], hazard: '', lastVerify: '2026-11-04', verifier: '李敏', careLogs: [] }
  }

  // 自动补齐 7–18 层 48 户真实高层数据（共 18 层 72 户）
  const upperOwners = [
    '林建国', '韩晓东', '魏淑华', '孙志强', '杨春梅', '杜鹏飞', '姜伟民', '吕秀英',
    '范永刚', '任海燕', '方明远', '谭国栋', '邹静文', '熊立军', '陆桂兰', '孟庆华',
    '郝志刚', '崔建华', '康玉梅', '毛胜利', '邱文博', '秦晓峰', '江丽萍', '史振华',
    '顾明德', '侯艳红', '邵国平', '龙志远', '万海涛', '段秀珍', '雷建军', '钱立新',
    '汤小红', '尹志勇', '黎玉芳', '易国强', '常文静', '武建平', '乔丽华', '贺振国',
    '赖明珠', '龚志华', '文晓梅', '庞立伟', '樊淑兰', '兰建明', '殷春燕', '施国梁'
  ]
  const upperTenants = ['李明、张婷（园区白领）', '王凯（单身租住）', '赵强一家 3 口', '孙浩、周敏（双职工）', '陈磊（企业外派）']
  let upperIdx = 0
  for (let fl = 7; fl <= 18; fl++) {
    for (const u of ['一单元', '二单元']) {
      for (const rm of ['01', '02']) {
        const key = `${u}-${fl}${rm}`
        const seed = upperIdx++
        const owner = upperOwners[seed % upperOwners.length]
        const mod = seed % 10
        const status = mod === 3 || mod === 8 ? '出租' : mod === 9 ? '空置' : '自住'
        const peopleCount = status === '空置' ? 0 : (status === '出租' ? 2 : (seed % 3) + 2)
        const careTags = []
        if (fl === 8 && u === '一单元' && rm === '01') careTags.push('独居高龄')
        if (fl === 11 && u === '二单元' && rm === '01') careTags.push('退役优抚')
        if (fl === 14 && u === '一单元' && rm === '02') careTags.push('独居高龄')
        if (fl === 16 && u === '二单元' && rm === '02') careTags.push('退役优抚')
        if (fl === 9 && u === '二单元' && rm === '01') careTags.push('孕产妇关怀')
        let hazard = ''
        if (fl === 12 && u === '一单元' && rm === '02') hazard = '阳台外挂杂物松动'
        if (fl === 15 && u === '二单元' && rm === '01') hazard = '防火门闭门器未复位'
        baseSixRooms[key] = {
          room: `${fl}${rm}`,
          status,
          peopleCount,
          owner,
          phone: `13${(5 + (seed % 4))}534${String(12000 + seed * 173).slice(0, 5)}`,
          idCard: `37140219${String(52 + (seed % 42))}0${(seed % 8) + 1}${String(11 + (seed % 16))}${String(1120 + seed * 37).slice(0, 4)}`,
          tenant: status === '出租' ? upperTenants[seed % upperTenants.length] : '',
          careTags,
          hazard,
          lastVerify: `2026-11-${String(10 + (seed % 9)).padStart(2, '0')}`,
          verifier: u === '一单元' ? '李敏' : '周鹏',
          careLogs: careTags.length
            ? [{ time: '2026-11-16 10:30', operator: '李敏', action: `核验确认「${careTags[0]}」重点关怀建档`, reason: '月度入户走访复核' }]
            : hazard
              ? [{ time: '2026-11-19 08:40', operator: '李敏', action: `登记安全隐患：${hazard}`, reason: '高层消防专项巡查发现' }]
              : [{ time: '2026-11-14 15:10', operator: '李敏', action: '常规入户核验无异常', reason: '基础信息常态更新' }]
        }
      }
    }
  }

  const buildingProfiles = {
    residential: {
      gridName: '八里庄社区 · 第一住宅网格',
      buildingName: '八里庄盛世华园A区3号楼',
      buildingType: '18 层两梯两户高层住宅',
      propertyOrg: '八里庄盛世华园物业服务中心',
      community: '八里庄社区',
      gridLead: '周建国',
      gridStaff: '李敏',
      units: ['一单元', '二单元'],
      floors: [18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
      rooms: baseSixRooms,
      basement: {
        name: 'B1 地下人防车库与非机动车集中充电棚',
        parkingTotal: 112,
        chargingPorts: 36,
        firePressure: '0.42 MPa（正常）',
        smokeSensors: '28 路烟感温感在线'
      },
      shops: [
        { id: 'shop-1', door: '底商 101', name: '长河便民连锁超市', owner: '陈建华', phone: '13753414132', license: '正常在营', gasAlarm: '不涉燃气 · 灭火器齐备', hazard: '' },
        { id: 'shop-2', door: '底商 102', name: '德味牛肉面馆', owner: '马志强', phone: '13553426028', license: '正常在营', gasAlarm: '已装独立报警器（待复检）', hazard: '燃气软管需复核' },
        { id: 'shop-3', door: '底商 103', name: '锦绣便民大药房', owner: '刘淑梅', phone: '15053439912', license: '正常在营', gasAlarm: '不涉燃气 · 消防达标', hazard: '' },
        { id: 'shop-4', door: '底商 104', name: '启智少儿书法工作室', owner: '张晓雯', phone: '18653445519', license: '正常在营', gasAlarm: '不涉燃气 · 通道畅通', hazard: '' }
      ]
    },
    commercial: {
      gridName: '星凯社区 · 商务楼宇专属网格',
      buildingName: '星凯国际商务广场 A 座',
      community: '星凯社区',
      gridLead: '吴志强',
      gridStaff: '刘洋',
      floors: [
        { floor: '18层', zone: '高区总部', company: '天衢数字经济产业总部基地', industry: '数字经济', employees: 168, revenue: '6.8 亿元', safety: '达标', contact: '张明远 138****5102' },
        { floor: '16层', zone: '高区总部', company: '齐鲁智造工业互联网研究院', industry: '智能制造', employees: 124, revenue: '4.5 亿元', safety: '达标', contact: '刘志鹏 139****3318' },
        { floor: '14层', zone: '高区总部', company: '德州智联软件研发中心', industry: '信息技术', employees: 146, revenue: '4.2 亿元', safety: '达标', contact: '王海涛 138****9021' },
        { floor: '12层', zone: '中区科研', company: '鲁北新能源工程设计院', industry: '科技研发', employees: 92, revenue: '2.8 亿元', safety: '达标', contact: '李静 139****4120' },
        { floor: '10层', zone: '中区科研', company: '德州现代物流数字调度中心', industry: '智慧物流', employees: 84, revenue: '3.6 亿元', safety: '达标', contact: '马建国 150****2198' },
        { floor: '8层', zone: '中区服务', company: '天衢跨境电商综合服务中心', industry: '现代服务', employees: 78, revenue: '1.9 亿元', safety: '达标', contact: '孙鹏 186****7732' },
        { floor: '6层', zone: '低区商贸', company: '华宇供应链区域结算中心', industry: '仓储物流', employees: 64, revenue: '3.1 亿元', safety: '待复查（配电间堆物）', contact: '周勇 137****6619' },
        { floor: '3层', zone: '低区双创', company: '星凯人才科创孵化器（入驻 18 家小微）', industry: '双创载体', employees: 112, revenue: '0.9 亿元', safety: '达标', contact: '赵敏 150****8821' },
        { floor: '1层', zone: '裙房大堂', company: '星凯楼宇党群驿站 · 政务自助服务厅', industry: '公共服务', employees: 18, revenue: '公益阵地', safety: '达标', contact: '吴志强 0534-2681005' }
      ]
    },
    district: {
      gridName: '泰和社区 · 沿街商圈专项网格',
      streetName: '东风东路便民商业示范段（长河大道—晶华大道）',
      community: '泰和社区',
      gridLead: '李文博',
      gridStaff: '张伟',
      northShops: [
        { door: '路北 11 号', name: '德州老味道餐饮馆', type: '餐饮住宿', status: '在营', safety: '燃气报警器正常', events: 0 },
        { door: '路北 13 号', name: '泰和五金机电建材行', type: '商贸零售', status: '在营', safety: '曾有门前堆物（已整改）', events: 1 },
        { door: '路北 15 号', name: '康乐社区连锁超市', type: '商贸零售', status: '在营', safety: '消防巡检合格', events: 0 },
        { door: '路北 17 号', name: '星光托育服务中心', type: '教育托管', status: '在营', safety: '应急通道畅通', events: 0 }
      ],
      southShops: [
        { door: '路南 12 号', name: '齐鲁鲜果生鲜驿站', type: '便民零售', status: '在营', safety: '消防合格', events: 0 },
        { door: '路南 14 号', name: '顺捷电动车维修销售部', type: '维修服务', status: '在营', safety: '重点监管（禁止室内充电）', events: 1 },
        { door: '路南 16 号', name: '暖心家政便民服务站', type: '生活服务', status: '在营', safety: '达标', events: 0 },
        { door: '路南 18 号', name: '泰和百货便利店', type: '商贸零售', status: '在营', safety: '达标', events: 0 }
      ]
    }
  }

  // 巡查监管与轨迹回放数据（含停留超时防挂机告警）
  const patrolRecords = [
    {
      id: 'pt-1',
      staff: '李敏',
      community: '德馨社区',
      grid: '第一网格',
      signInTime: '08:28',
      km: 4.8,
      mustPointsDone: 8,
      mustPointsTotal: 8,
      stayMinutes: 12,
      stayPlace: '金辰云河赋 3 号楼（上报消防隐患）',
      stayCoord: [37.4638, 116.3526],
      superviseStatus: '正常',
      superviseNote: '',
      staffReply: '',
      track: [
        { lat: 37.4618, lng: 116.3502, time: '08:28', note: '社区党群服务中心签到出发', isCheckpoint: true },
        { lat: 37.4628, lng: 116.3514, time: '08:52', note: '德馨北路沿街商铺九小排查', isCheckpoint: true },
        { lat: 37.4638, lng: 116.3526, time: '09:24', note: '金辰云河赋 3 号楼现场上报消防通道占用', isCheckpoint: true, eventTag: '上报事件' },
        { lat: 37.4644, lng: 116.3548, time: '10:05', note: '入户探访独居老人王秀兰并核验台账', isCheckpoint: true, eventTag: '走访核验' },
        { lat: 37.4626, lng: 116.3558, time: '10:48', note: '德馨口袋公园市政设施巡检', isCheckpoint: true }
      ]
    },
    {
      id: 'pt-2',
      staff: '张强',
      community: '堤口社区',
      grid: '第二网格',
      signInTime: '08:35',
      km: 2.3,
      mustPointsDone: 5,
      mustPointsTotal: 8,
      stayMinutes: 42,
      stayPlace: '堤口南路某棋牌茶室周边（连续静止 42 分钟）',
      stayCoord: [37.4481, 116.3436],
      superviseStatus: '待督办',
      superviseNote: '',
      staffReply: '',
      track: [
        { lat: 37.4502, lng: 116.3404, time: '08:35', note: '堤口社区服务站签到出发', isCheckpoint: true },
        { lat: 37.4494, lng: 116.3422, time: '09:10', note: '堤口东路九小商铺巡检', isCheckpoint: true },
        { lat: 37.4481, lng: 116.3436, time: '10:12', note: '原地静止滞留起点（至 10:54 共 42 分钟）', isCheckpoint: false, isStayAnomaly: true },
        { lat: 37.4475, lng: 116.3418, time: '11:15', note: '恢复移动至岔河东大道低洼点', isCheckpoint: true }
      ]
    },
    {
      id: 'pt-3',
      staff: '王琪',
      community: '八里庄社区',
      grid: '第一网格',
      signInTime: '08:22',
      km: 4.4,
      mustPointsDone: 7,
      mustPointsTotal: 8,
      stayMinutes: 24,
      stayPlace: '八里庄农贸市场调解点（现场劝导占道摊贩）',
      stayCoord: [37.4602, 116.3646],
      superviseStatus: '正常',
      superviseNote: '',
      staffReply: '',
      track: [
        { lat: 37.4596, lng: 116.3624, time: '08:22', note: '八里庄党群服务站签到', isCheckpoint: true },
        { lat: 37.4602, lng: 116.3646, time: '09:18', note: '农贸市场周边停留 24 分钟协同劝导', isCheckpoint: true },
        { lat: 37.4614, lng: 116.3665, time: '10:25', note: '复核工地裸土防尘网覆盖情况', isCheckpoint: true }
      ]
    },
    {
      id: 'pt-4',
      staff: '刘洋',
      community: '星凯社区',
      grid: '商务网格',
      signInTime: '08:30',
      km: 5.1,
      mustPointsDone: 8,
      mustPointsTotal: 8,
      stayMinutes: 15,
      stayPlace: '星凯国际广场楼宇党群驿站',
      stayCoord: [37.4465, 116.3515],
      superviseStatus: '正常',
      superviseNote: '',
      staffReply: '',
      track: [
        { lat: 37.4452, lng: 116.3498, time: '08:30', note: '星凯商务区签到', isCheckpoint: true },
        { lat: 37.4465, lng: 116.3515, time: '09:40', note: '星凯国际 A 座企业走访核验', isCheckpoint: true, eventTag: '走访核验' },
        { lat: 37.4478, lng: 116.3532, time: '10:55', note: '西侧集中充电棚复查', isCheckpoint: true }
      ]
    }
  ]

  // 数据直达全功能引擎（覆盖 R24-R33）
  const dataDirect = {
    userGroups: [
      { id: 'ug-1', name: '街道应急管理办', type: '职能科室', role: '管理员（授权全量）', members: ['张志国', '陈明'], ledgers: ['企业综合宽表'], reports: ['九小场所综合排查明细报表'] },
      { id: 'ug-2', name: '街道市场监管所', type: '职能科室', role: '管理员（授权全量）', members: ['韩立峰', '周雪'], ledgers: ['企业综合宽表'], reports: ['九小场所综合排查明细报表'] },
      { id: 'ug-3', name: '街道民政与关怀办', type: '职能科室', role: '管理员（授权全量）', members: ['孙慧', '张志国'], ledgers: ['独居长者关怀宽表'], reports: ['重点关怀对象月度核验报表'] },
      { id: 'ug-4', name: '德馨社区网格填报组', type: '社区网格', role: '填报人（仅见本人）', members: ['李敏', '周建国'], ledgers: ['企业综合宽表', '独居长者关怀宽表'], reports: ['九小场所综合排查明细报表'] },
      { id: 'ug-5', name: '堤口与八里庄填报组', type: '社区网格', role: '填报人（仅见本人）', members: ['王琪', '陈晓'], ledgers: ['企业综合宽表', '独居长者关怀宽表'], reports: ['九小场所综合排查明细报表'] }
    ],
    ledgers: [
      {
        id: 'lg-ent',
        name: '企业（九小场所）综合宽表',
        dbName: '市场主体业务库',
        primaryKeys: ['creditCode'],
        primaryKeyLabel: '统一社会信用代码（单一主键自动归并）',
        fields: [
          { key: 'creditCode', label: '统一社会信用代码', type: 'text', block: 'base', blockName: '主体底盘（免填主键）', prefill: 'last', required: true, minLen: 10, maxLen: 18 },
          { key: 'shopName', label: '商铺/企业名称', type: 'text', block: 'base', blockName: '主体底盘（免填主键）', prefill: 'last', required: true, minLen: 2, maxLen: 40 },
          { key: 'community', label: '所属社区', type: 'select', block: 'base', blockName: '主体底盘（免填主键）', prefill: 'last', options: COMMUNITIES.map((c) => c.name), required: true },
          { key: 'ownerName', label: '负责人姓名', type: 'name', block: 'base', blockName: '主体底盘（免填主键）', prefill: 'last', required: true },
          { key: 'idCard', label: '法人身份证号', type: 'idcard', block: 'base', blockName: '主体底盘（免填主键）', prefill: 'last', masked: true, required: true },
          { key: 'phone', label: '联系电话', type: 'phone', block: 'base', blockName: '主体底盘（免填主键）', prefill: 'last', masked: true, required: true },
          { key: 'requiredExt', label: '应配灭火器(具)', type: 'number', block: 'fire', blockName: '应急办·消防段', prefill: 'last', min: 0, max: 500 },
          { key: 'actualExt', label: '实配灭火器(具)', type: 'number', block: 'fire', blockName: '应急办·消防段', prefill: 'none', min: 0, max: 500 },
          { key: 'extGap', label: '灭火器缺口(自动计算)', type: 'formula', block: 'fire', blockName: '应急办·消防段', formula: '{requiredExt} - {actualExt}', locked: true },
          { key: 'gasAlarm', label: '燃气报警器状态', type: 'radio', block: 'fire', blockName: '应急办·消防段', options: ['已加装并通过测试', '未安装', '不涉燃气'], prefill: 'last' },
          { key: 'foodLicense', label: '食品经营许可', type: 'select', block: 'market', blockName: '市监所·食安段', options: ['有效期内', '临期需换证', '不涉食品'], prefill: 'none' },
          { key: 'healthCerts', label: '持健康证人数', type: 'number', block: 'market', blockName: '市监所·食安段', min: 0, max: 200, prefill: 'none' },
          { key: 'coldChain', label: '重点核查项(多选)', type: 'checkbox', block: 'market', blockName: '市监所·食安段', options: ['冷链台账齐全', '进货票据规范', '后厨明厨亮灶'], prefill: 'none' },
          { key: 'sitePhoto', label: '现场排查照片', type: 'image', block: 'market', blockName: '市监所·食安段', prefill: 'none' },
          { key: 'promiseFile', label: '安全承诺书附件', type: 'attachment', block: 'market', blockName: '市监所·食安段', prefill: 'none' },
          { key: 'cycleDate', label: '统计周期日', type: 'cycle_date', block: 'sys', blockName: '系统留痕字段', prefill: 'today', locked: true },
          { key: 'reporter', label: '最近填报人', type: 'reporter', block: 'sys', blockName: '系统留痕字段', locked: true },
          { key: 'reportTime', label: '最近填报时间', type: 'report_time', block: 'sys', blockName: '系统留痕字段', locked: true }
        ]
      },
      {
        id: 'lg-care',
        name: '独居长者月度关怀宽表',
        dbName: '特殊关怀业务库',
        primaryKeys: ['community', 'idCard'],
        primaryKeyLabel: '所属社区 + 身份证号（组合主键自动归并）',
        fields: [
          { key: 'elderName', label: '长者姓名', type: 'name', block: 'base', blockName: '基础底盘', prefill: 'last', required: true },
          { key: 'community', label: '所属社区', type: 'select', block: 'base', blockName: '基础底盘', prefill: 'last', options: COMMUNITIES.map((c) => c.name), required: true },
          { key: 'idCard', label: '身份证号', type: 'idcard', block: 'base', blockName: '基础底盘', prefill: 'last', masked: true, required: true },
          { key: 'phone', label: '紧急联系人电话', type: 'phone', block: 'base', blockName: '基础底盘', prefill: 'last', masked: true, required: true },
          { key: 'visitDate', label: '入户探访时间', type: 'datetime', block: 'livelihood', blockName: '民政办·月度关怀段', prefill: 'today' },
          { key: 'healthStatus', label: '本月健康状况', type: 'radio', block: 'livelihood', blockName: '民政办·月度关怀段', options: ['平稳良好', '需慢病送药', '需重点陪护'], prefill: 'none' }
        ]
      }
    ],
    tasks: [
      {
        id: 'tk-market',
        name: '市监所 · 沿街商铺食品安全专项补充采集（仅采增量 3 列）',
        ledgerId: 'lg-ent',
        dept: '街道市场监管所',
        cycle: '月度循环',
        currentPeriod: '2026年11月',
        deadline: '2026-11-28 18:00',
        paused: false,
        assignees: ['德馨社区', '堤口社区', '星凯社区', '泰和社区'],
        fieldKeys: ['creditCode', 'shopName', 'foodLicense', 'healthCerts', 'coldChain', 'sitePhoto'],
        totalTarget: 12,
        doneCount: 8,
        remindedAt: ''
      },
      {
        id: 'tk-fire',
        name: '应急办 · 九小场所消防与燃气安全月度排查',
        ledgerId: 'lg-ent',
        dept: '街道应急管理办',
        cycle: '月度循环',
        currentPeriod: '2026年11月',
        deadline: '2026-11-25 18:00',
        paused: false,
        assignees: ['德馨社区', '堤口社区', '八里庄社区', '锦绣社区'],
        fieldKeys: ['creditCode', 'shopName', 'community', 'ownerName', 'idCard', 'phone', 'requiredExt', 'actualExt', 'extGap', 'gasAlarm'],
        totalTarget: 15,
        doneCount: 14,
        remindedAt: '2026-11-18 17:10'
      },
      {
        id: 'tk-care-oct',
        name: '民政办 · 独居高龄长者入户走访（10月已截止周期）',
        ledgerId: 'lg-care',
        dept: '街道民政与关怀办',
        cycle: '月度循环',
        currentPeriod: '2026年10月',
        deadline: '2026-10-31 18:00',
        paused: false,
        expiredLocked: true,
        assignees: ['德馨社区', '泰和社区'],
        fieldKeys: ['elderName', 'community', 'idCard', 'phone', 'visitDate', 'healthStatus'],
        totalTarget: 10,
        doneCount: 10,
        remindedAt: ''
      }
    ],
    records: [
      {
        uid: 'UID-ENT-001',
        ledgerId: 'lg-ent',
        createdBy: '李敏',
        community: '德馨社区',
        period: '2026年11月',
        mergedTasksCount: 1,
        deleted: false,
        values: {
          creditCode: '91371400MA3CH0018X',
          shopName: '长河便民连锁超市',
          community: '德馨社区',
          ownerName: '陈建华',
          idCard: '371402198205142815',
          phone: '13753414132',
          requiredExt: 6,
          actualExt: 4,
          extGap: 2,
          gasAlarm: '未安装',
          foodLicense: '',
          healthCerts: '',
          coldChain: [],
          sitePhoto: buildScenePhoto({ scene: 'after', title: '超市灭火器台账留痕', location: '德馨社区 · 底商101', time: '2026-11-12 09:30', person: '李敏' }),
          promiseFile: '长河便民连锁超市_安全生产承诺书.pdf',
          cycleDate: '2026-11-12',
          reporter: '李敏',
          reportTime: '2026-11-12 09:30'
        },
        history: [
          { time: '2026-11-12 09:30', operator: '李敏', action: '首次采集入库', taskName: '应急办 · 九小场所消防与燃气安全月度排查', changes: [{ field: '应配/实配灭火器', oldVal: '空', newVal: '6 / 4（缺口自动算 2）' }, { field: '燃气报警器状态', oldVal: '空', newVal: '未安装' }] }
        ]
      },
      {
        uid: 'UID-ENT-002',
        ledgerId: 'lg-ent',
        createdBy: '王琪',
        community: '堤口社区',
        period: '2026年11月',
        mergedTasksCount: 2,
        deleted: false,
        values: {
          creditCode: '91371400MA3TK0092K',
          shopName: '堤口东路老味面馆',
          community: '堤口社区',
          ownerName: '马志强',
          idCard: '371402197909223414',
          phone: '13553426028',
          requiredExt: 4,
          actualExt: 4,
          extGap: 0,
          gasAlarm: '已加装并通过测试',
          foodLicense: '有效期内',
          healthCerts: 5,
          coldChain: ['进货票据规范', '后厨明厨亮灶'],
          sitePhoto: buildScenePhoto({ scene: 'after', title: '老味面馆后厨明厨亮灶留痕', location: '堤口社区 · 堤口东路16号', time: '2026-11-18 16:05', person: '王琪' }),
          promiseFile: '老味面馆_燃气及食安承诺书.pdf',
          cycleDate: '2026-11-18',
          reporter: '王琪',
          reportTime: '2026-11-18 16:05'
        },
        history: [
          { time: '2026-11-18 16:05', operator: '王琪', action: '任务增量归并', taskName: '市监所 · 食品安全专项补充采集', changes: [{ field: '食品经营许可', oldVal: '空', newVal: '有效期内' }, { field: '持健康证人数', oldVal: '空', newVal: '5' }] },
          { time: '2026-11-10 11:20', operator: '王琪', action: '首次采集入库', taskName: '应急办 · 九小场所消防排查', changes: [{ field: '实配灭火器', oldVal: '空', newVal: '4' }] }
        ]
      },
      {
        uid: 'UID-ENT-003',
        ledgerId: 'lg-ent',
        createdBy: '李敏',
        community: '德馨社区',
        period: '2026年11月',
        mergedTasksCount: 2,
        deleted: false,
        values: {
          creditCode: '91371400MA3DX0145M',
          shopName: '锦绣便民大药房',
          community: '德馨社区',
          ownerName: '刘淑梅',
          idCard: '371402198511031926',
          phone: '15053439912',
          requiredExt: 4,
          actualExt: 4,
          extGap: 0,
          gasAlarm: '不涉燃气',
          foodLicense: '有效期内',
          healthCerts: 3,
          coldChain: ['冷链台账齐全', '进货票据规范'],
          sitePhoto: buildScenePhoto({ scene: 'after', title: '药房冷链台账核查照', location: '德馨社区 · 底商103', time: '2026-11-16 14:40', person: '李敏' }),
          promiseFile: '锦绣便民大药房_药品安全承诺书.pdf',
          cycleDate: '2026-11-16',
          reporter: '李敏',
          reportTime: '2026-11-16 14:40'
        },
        history: [
          { time: '2026-11-16 14:40', operator: '李敏', action: '任务增量归并', taskName: '市监所 · 食品安全专项补充采集', changes: [{ field: '食品经营许可', oldVal: '空', newVal: '有效期内' }] }
        ]
      },
      {
        uid: 'UID-ENT-004',
        ledgerId: 'lg-ent',
        createdBy: '刘洋',
        community: '星凯社区',
        period: '2026年11月',
        mergedTasksCount: 2,
        deleted: false,
        values: {
          creditCode: '91371400MA3XK0281Q',
          shopName: '德州星凯快捷酒店',
          community: '星凯社区',
          ownerName: '周明远',
          idCard: '371402197603182213',
          phone: '15853417741',
          requiredExt: 16,
          actualExt: 15,
          extGap: 1,
          gasAlarm: '已加装并通过测试',
          foodLicense: '有效期内',
          healthCerts: 12,
          coldChain: ['进货票据规范'],
          sitePhoto: buildScenePhoto({ scene: 'after', title: '星凯酒店消防巡检留痕', location: '星凯社区 · 长河大道中段', time: '2026-11-17 16:30', person: '刘洋' }),
          promiseFile: '星凯快捷酒店_消防责任书.pdf',
          cycleDate: '2026-11-17',
          reporter: '刘洋',
          reportTime: '2026-11-17 16:30'
        },
        history: [
          { time: '2026-11-17 16:30', operator: '刘洋', action: '首次采集入库', taskName: '应急办 · 九小场所消防排查', changes: [{ field: '应配/实配灭火器', oldVal: '空', newVal: '16 / 15（缺口 1）' }] }
        ]
      },
      {
        uid: 'UID-ENT-005',
        ledgerId: 'lg-ent',
        createdBy: '张伟',
        community: '泰和社区',
        period: '2026年11月',
        mergedTasksCount: 1,
        deleted: false,
        values: {
          creditCode: '91371400MA3TH0317B',
          shopName: '泰和老街早餐铺（已停业待核清）',
          community: '泰和社区',
          ownerName: '吴老三',
          idCard: '371402197108091512',
          phone: '13653488201',
          requiredExt: 2,
          actualExt: 2,
          extGap: 0,
          gasAlarm: '未安装',
          foodLicense: '临期需换证',
          healthCerts: 2,
          coldChain: [],
          sitePhoto: '',
          promiseFile: '',
          cycleDate: '2026-10-18',
          reporter: '张伟',
          reportTime: '2026-10-18 10:15'
        },
        history: [
          { time: '2026-10-18 10:15', operator: '张伟', action: '首次采集入库', taskName: '应急办 · 九小场所消防排查', changes: [{ field: '基础建档', oldVal: '空', newVal: '已建档' }] }
        ]
      }
    ],
    verifyBatch: {
      id: 'vb-1',
      title: '11 月九小场所存量台账复合核查回传包（社区已修订上传）',
      ledgerId: 'lg-ent',
      submittedBy: '德馨社区 · 李敏 / 泰和社区 · 张伟',
      submittedAt: '2026-11-19 14:18',
      committed: false,
      items: [
        {
          uid: 'UID-ENT-001',
          shopName: '长河便民连锁超市',
          community: '德馨社区',
          op: '修订',
          selected: true,
          reason: '已补齐 2 具灭火器并加装独立式燃气报警器，同步更新负责人新手机号',
          changes: [
            { key: 'actualExt', label: '实配灭火器(具)', oldVal: 4, newVal: 6 },
            { key: 'extGap', label: '灭火器缺口(公式重算)', oldVal: 2, newVal: 0, isFormula: true },
            { key: 'gasAlarm', label: '燃气报警器状态', oldVal: '未安装', newVal: '已加装并通过测试' },
            { key: 'phone', label: '联系电话', oldVal: '13753414132', newVal: '13953488805', masked: true }
          ]
        },
        {
          uid: 'UID-ENT-004',
          shopName: '德州星凯快捷酒店',
          community: '星凯社区',
          op: '修订',
          selected: true,
          reason: '大厅新补配 1 具干粉灭火器，缺口清零',
          changes: [
            { key: 'actualExt', label: '实配灭火器(具)', oldVal: 15, newVal: 16 },
            { key: 'extGap', label: '灭火器缺口(公式重算)', oldVal: 1, newVal: 0, isFormula: true }
          ]
        },
        {
          uid: 'UID-ENT-005',
          shopName: '泰和老街早餐铺（已停业待核清）',
          community: '泰和社区',
          op: '标记删除',
          selected: true,
          confirmedDelete: false,
          reason: '现场走访确认门面已退租搬迁并办理营业执照注销，申请清理该无效存量记录',
          changes: []
        }
      ]
    },
    reports: [
      {
        id: 'rpt-1',
        name: '长河街道九小场所“一表通”综合排查明细报表',
        ledgerId: 'lg-ent',
        startRow: 3,
        startCol: 1,
        authorizedGroups: ['街道应急管理办', '街道市场监管所', '德馨社区网格填报组'],
        sheets: [
          {
            id: 'sh-1',
            name: '九小场所综合明细表',
            groups: [
              { label: '基础主体信息', span: 4 },
              { label: '消防安全核查（应急办）', span: 4 },
              { label: '市场监管核验（市监所）', span: 2 }
            ],
            fieldKeys: ['shopName', 'community', 'ownerName', 'phone', 'requiredExt', 'actualExt', 'extGap', 'gasAlarm', 'foodLicense', 'healthCerts']
          },
          {
            id: 'sh-2',
            name: '分社区隐患整改汇总表',
            isSummary: true
          },
          {
            id: 'sh-3',
            name: '本月标记清理记录清册',
            isDeletedList: true
          }
        ]
      }
    ]
  }

  // 数字武装 5 专题差异化数据（支持管理员后台上传与维护）
  const armedForces = {
    party: {
      steps: [
        { name: '年初武装工作部署', date: '2026-02', status: '已完成', owner: '街道党工委' },
        { name: '季度党工委专题会', date: '2026-04', status: '已完成', owner: '街道人武部' },
        { name: '半年度议武会研究', date: '2026-07', status: '已完成', owner: '党工委书记主持' },
        { name: '民兵整组与检查评比', date: '2026-09', status: '已完成', owner: '区人武部联合督导' },
        { name: '年底书记党管武装述职', date: '2026-11', status: '推进中', owner: '党工委办公室' }
      ],
      columns: [
        {
          id: 'col-party-1',
          name: '党工委专题会议',
          docs: [
            { id: 'd-p1', title: '关于召开长河街道 2026 年度党管武装专题工作会议的纪要', docNo: '长党工纪〔2026〕4 号', date: '2026-02-18', unit: '长河街道党工委办公室', type: 'redhead', content: '会议听取了街道人民武装部关于年度民兵整组、春季征兵和基层武装部规范化建设情况汇报。会议强调，要把党管武装工作纳入街道党工委重要议事日程，确保全街道 14 个社区武装工作责任清单逐项落地。' },
            { id: 'd-p2', title: '长河街道第二季度党管武装推进与经费保障专题会纪要', docNo: '长党工纪〔2026〕11 号', date: '2026-05-12', unit: '长河街道党工委办公室', type: 'redhead', content: '会议研究通过了基层民兵连装备器材更新计划及社区国防教育讲堂提质改造经费，明确由德馨、泰和、锦绣社区先行打造示范阵地。' }
          ]
        },
        {
          id: 'col-party-2',
          name: '议武会',
          docs: [
            { id: 'd-p3', title: '长河街道 2026 年上半年度党工委议武会会议纪要', docNo: '长党议武〔2026〕2 号', date: '2026-07-16', unit: '长河街道党工委', type: 'redhead', content: '议武会围绕防汛抢险民兵应急排实战拉动、秋季大学毕业生精准征兵动员、退役军人双拥优抚三项核心议题作出专题决议，建立挂图作战台账。' }
          ]
        },
        {
          id: 'col-party-3',
          name: '党工委会',
          docs: [
            { id: 'd-p4', title: '长河街道党工委会传达学习上级国防动员工作会议精神记录', docNo: '长党委会〔2026〕19 号', date: '2026-08-22', unit: '长河街道党工委', type: 'redhead', content: '传达落实德州市及天衢新区国防动员部署，审定街道国防动员领导小组人员调整方案。' }
          ]
        },
        {
          id: 'col-party-4',
          name: '书记工作述职',
          docs: [
            { id: 'd-p5', title: '长河街道党工委书记 2026 年度党管武装工作述职报告（审定稿）', docNo: '长党述〔2026〕1 号', date: '2026-11-10', unit: '长河街道党工委', type: 'redhead', content: '全年累计主持召开党管武装专题会与议武会 4 次，全街道 14 个社区民兵连建制率 100%，高质量完成春秋两季征兵任务，大学毕业生入伍占比连续三年稳步提升。' }
          ]
        },
        {
          id: 'col-party-5',
          name: '检查评比',
          docs: [
            { id: 'd-p6', title: '2026 年度全街道 14 社区武装工作规范化检查评比通报', docNo: '长武装通〔2026〕6 号', date: '2026-10-25', unit: '长河街道人民武装部', type: 'redhead', content: '经资料核查与现场点验，德馨社区、泰和社区、星凯社区、锦绣社区获评年度武装工作优秀示范社区。' }
          ]
        }
      ],
      plans: [
        { id: 'pl-1', title: '全街道 14 个社区武装工作责任清单动态更新', owner: '赵卫军', deadline: '2026-03-30', progress: 100, status: '已完成' },
        { id: 'pl-2', title: '八一建军节重点优抚与抗美援朝老兵全覆盖走访', owner: '人武部 + 14 社区', deadline: '2026-08-01', progress: 100, status: '已完成' },
        { id: 'pl-3', title: '秋季高校毕业生精准征兵政考与欢送仪式', owner: '征兵工作专班', deadline: '2026-09-18', progress: 100, status: '已完成' },
        { id: 'pl-4', title: '年度书记党管武装述职考核及资料归档验收', owner: '党政综合办', deadline: '2026-12-10', progress: 82, status: '进行中' }
      ],
      photos: [
        { id: 'ph-p1', title: '八一建军节慰问德馨社区抗美援朝老兵', community: '德馨社区', date: '2026-07-31', desc: '街道党工委书记带队上门送去慰问品与节日祝福。', src: buildScenePhoto({ scene: 'visit', title: '八一走访慰问抗美援朝老兵', location: '德馨社区 · 金辰云河赋', time: '2026-07-31 10:20', person: '街道党工委慰问组' }) },
        { id: 'ph-p2', title: '为泰和社区荣立三等功现役军人家属送喜报', community: '泰和社区', date: '2026-05-19', desc: '敲锣打鼓送喜报，增强军人军属荣誉感。', src: buildScenePhoto({ scene: 'visit', title: '送立功喜报进社区仪式', location: '泰和社区 · 泰和·名仕馨港', time: '2026-05-19 09:40', person: '街道人武部' }) },
        { id: 'ph-p3', title: '郭家庵社区困难退役老兵冬日暖心回访', community: '郭家庵社区', date: '2026-11-08', desc: '核查冬季取暖保障并落实帮扶物资。', src: buildScenePhoto({ scene: 'visit', title: '冬季暖心走访退役老兵', location: '郭家庵社区', time: '2026-11-08 15:10', person: '社区武装干事' }) }
      ]
    },
    militia: {
      squadStructure: [
        { name: '综合应急排', count: 148, pct: 44 },
        { name: '防汛抢险分队', count: 86, pct: 26 },
        { name: '信息通信与无人机分队', count: 54, pct: 16 },
        { name: '卫生救护与后勤保障分队', count: 48, pct: 14 }
      ],
      rosterSample: [
        { name: '王大勇', squad: '应急排一班', role: '班长', skill: '工程抢险/冲锋舟操作', phone: '13853411209', community: '德馨社区' },
        { name: '张晓峰', squad: '信息通信分队', role: '骨干', skill: '应急电台/无人机巡航', phone: '13953422310', community: '德馨社区' },
        { name: '李建军', squad: '防汛抢险分队', role: '队员', skill: '排涝泵站维护', phone: '15053433421', community: '德馨社区' },
        { name: '孙立新', squad: '应急排二班', role: '排长', skill: '消防救援/秩序维护', phone: '18653444532', community: '泰和社区' },
        { name: '郭胜利', squad: '应急排三班', role: '班长', skill: '医疗急救/疏散引导', phone: '13753455643', community: '星凯社区' }
      ],
      tabs: {
        民兵整组: [
          { id: 'm-1', title: '长河街道 2026 年度基干民兵组织整顿编成批复', date: '2026-04-12', unit: '天衢新区人武部', type: 'redhead', docNo: '天武整〔2026〕5 号', content: '批复同意长河街道编建 14 个社区民兵连、共计 336 名基干民兵，专业对口率达 91.6%，党员比例达 42.8%。' },
          { id: 'm-2', title: '14 个社区民兵连连长及指导员任职名册', date: '2026-04-20', unit: '长河街道人武部', type: 'course', content: '全街道 14 个社区均由社区党组织副书记兼任民兵连指导员，选优配强退役军人骨干担任连长。' }
        ],
        集合点验: [
          { id: 'm-3', title: '2026 年度长河街道基干民兵整组点验大会实录', date: '2026-05-26', unit: '长河街道人武部', type: 'redhead', docNo: '长武点〔2026〕3 号', content: '应到基干民兵 336 人，实到 336 人，到点率 100%；现场宣读任职命令、集体宣誓并开展应急装备展示。' }
        ],
        政治学习: [
          { id: 'm-4', title: '民兵政治教育“每月一课”学习纪要汇编', date: '2026-10-15', unit: '长河街道人武部', type: 'course', content: '围绕国防法规、应急处突纪律及基层平安共建开展专题授课 10 场，累计参训 1,240 人次。' }
        ],
        军事训练: [
          { id: 'm-5', title: '2026 年防汛抢险与消防救援基干民兵实兵演练考核表', date: '2026-07-08', unit: '长河街道人武部', type: 'course', content: '在岔河东岸组织沙袋筑堤、排涝泵架设、夜间照明搭建等实战课目演练，考核优良率 94%。' }
        ]
      },
      photos: [
        { id: 'ph-m1', title: '岔河沿岸民兵应急排防汛抢险实战演练', community: '堤口社区', date: '2026-07-08', desc: '35 分钟完成防汛沙袋筑堤与应急排涝设备架设。', src: buildScenePhoto({ scene: 'militia', title: '岔河沿岸防汛抢险实战演练', location: '堤口社区 · 岔河东岸', time: '2026-07-08 09:30', person: '民兵应急排' }) },
        { id: 'ph-m2', title: '星凯商圈民兵连参与冬季消防安全联勤巡查', community: '星凯社区', date: '2026-11-04', desc: '协助网格员排查九小场所消防通道与充电设施。', src: buildScenePhoto({ scene: 'militia', title: '民兵参建参治消防联勤巡查', location: '星凯社区 · 商务广场', time: '2026-11-04 14:20', person: '星凯社区民兵连' }) }
      ]
    },
    recruit: {
      funnel: [
        { key: '兵役登记', label: '兵役登记', count: 998, pct: 100, docs: [{ id: 'r-1', title: '2026 年长河街道年满 18 周岁适龄青年兵役登记名册汇总', date: '2026-06-30', unit: '街道征兵办', type: 'redhead', docNo: '长征〔2026〕1 号', content: '全街道 14 个社区兵役登记率达 100%，建立一人一档动态跟进库。' }] },
        { key: '登记提醒', label: '登记提醒', count: 146, pct: 15, docs: [{ id: 'r-2', title: '面向返乡大学生的兵役登记提醒函及入户通知记录', date: '2026-07-12', unit: '街道征兵办', type: 'course', content: '通过社区网格微信群与入户宣讲累计提醒未登记适龄青年 146 人，已全部补登完成。' }] },
        { key: '应征报名查询', label: '应征报名查询', count: 308, pct: 31, docs: [{ id: 'r-3', title: '2026 年春秋两季全国征兵网长河街道报名核验清册', date: '2026-08-05', unit: '街道征兵办', type: 'course', content: '全年网上应征报名 308 人，其中高校毕业生 196 人，占比 63.6%。' }] },
        { key: '预征管理', label: '预征管理', count: 192, pct: 19, docs: [{ id: 'r-4', title: '长河街道 2026 年度重点预征对象“一对一”结对跟踪台账', date: '2026-08-12', unit: '街道征兵办', type: 'course', content: '为 192 名预征青年配备专武干事结对服务，精准答疑学费补偿与优待金政策。' }] },
        { key: '初检初审', label: '初检初审', count: 164, pct: 16, docs: [{ id: 'r-5', title: '长河街道应征青年初检初审与政治考核初筛报告', date: '2026-08-20', unit: '街道征兵办', type: 'redhead', docNo: '长征〔2026〕6 号', content: '联合街道卫生服务中心及派出所完成 164 名青年视力、血压、学历与政考初审。' }] },
        { key: '体格检查', label: '体格检查', count: 156, pct: 16, docs: [{ id: 'r-6', title: '上站体格检查合格及预定新兵役前教育送兵档案', date: '2026-09-06', unit: '街道征兵办', type: 'redhead', docNo: '长征〔2026〕9 号', content: '顺利输送高素质新兵，大学毕业生比例创近五年新高。' }] }
      ],
      fiveYearTrend: [
        { year: '2022', total: 42, collegePct: 68 },
        { year: '2023', total: 46, collegePct: 74 },
        { year: '2024', total: 51, collegePct: 79 },
        { year: '2025', total: 54, collegePct: 85 },
        { year: '2026', total: 58, collegePct: 91 }
      ],
      workLogs: [
        { date: '2026-09-15', community: '德馨社区', text: '举办 2026 年秋季新兵入伍欢送座谈会，发放拥军纪念册。' },
        { date: '2026-08-22', community: '星凯社区', text: '联合派出所完成 28 名大学毕业生政考入户走访。' },
        { date: '2026-08-10', community: '泰和社区', text: '组织应征青年集中参加街道初检初审与视力复核。' },
        { date: '2026-07-18', community: '杨庄社区', text: '开展返乡高校毕业生征兵政策面对面宣讲咨询会。' }
      ]
    },
    mobilize: {
      leaders: [
        { role: '组长', name: '李振国', title: '长河街道党工委书记', duty: '统筹全街道国防动员与战备应急最高指挥决策' },
        { role: '副组长', name: '赵卫军', title: '街道党工委委员、人武部部长', duty: '负责动员预案组织实施、民兵收拢与兵员调度' },
        { role: '副组长', name: '张志国', title: '街道办事处副主任', duty: '统筹后勤物资储备、交通保障与双拥服务协同' },
        { role: '成员单位', name: '14 个社区党组织书记及应急、民政、卫健科室负责人', title: '一线动员联络与保障单元', duty: '落实社区点位集结、退役军人服务站值守与物资调拨' }
      ],
      plans: [
        { id: 'mob-1', name: '长河街道国防动员综合实施方案', updated: '2026-06-15', response: '30 分钟启动响应', points: '14 个社区联络点', type: 'redhead', docNo: '长国动〔2026〕1 号', content: '明确平战转换机制、人员动员编组、车辆及工程机械征用储备名录，确保指令下达后 30 分钟内指挥部全员到位。' },
        { id: 'mob-2', name: '基干民兵应急快速收拢方案', updated: '2026-07-02', response: '45 分钟完成集结', points: '3 处街道级集结广场', type: 'redhead', docNo: '长国动〔2026〕2 号', content: '划定泰和双拥广场、德馨文体中心、星凯西广场三处主集结点，明确各社区民兵连机动路线与防断网应急通联方式。' },
        { id: 'mob-3', name: '突发防汛抢险与公共安全应急处置预案', updated: '2026-07-20', response: '15 分钟先遣出动', points: '12 处重点防汛防火点', type: 'redhead', docNo: '长国动〔2026〕4 号', content: '针对堤口、郭家庵、芦李府等易涝与林缘防火点位，预置编织袋 8,000 条、移动排涝泵 14 台及应急照明设备。' }
      ],
      veteranDocs: [
        { id: 'vet-1', title: '退役军人优待证申领与就业创业扶持政策指引', date: '2026-09-12', unit: '街道退役军人服务站', type: 'course', content: '汇总省市级退役军人职业技能培训补贴、创业担保贴息贷款及优待目录清单。' },
        { id: 'vet-2', title: '长河街道困难退役军人常态化帮扶援助实施办法', date: '2026-10-08', unit: '街道退役军人服务站', type: 'redhead', docNo: '长退服〔2026〕3 号', content: '建立社区网格员月度回访与紧急医疗救助绿色通道。' }
      ],
      photos: [
        { id: 'ph-d1', title: '尚德社区“崇军商户”集中授牌双拥共建活动', community: '尚德社区', date: '2026-08-01', desc: '联合 24 家辖区爱心商户为退役军人提供专属优待折扣。', src: buildScenePhoto({ scene: 'double', title: '尚德社区崇军商户授牌仪式', location: '尚德社区党群中心', time: '2026-08-01 10:00', person: '双拥办' }) },
        { id: 'ph-d2', title: '退役军人志愿服务队开展重阳敬老义剪', community: '泰和社区', date: '2026-10-18', desc: '“戎耀长河”老兵志愿队服务高龄居民 120 余人次。', src: buildScenePhoto({ scene: 'double', title: '戎耀长河老兵志愿服务行', location: '泰和社区广场', time: '2026-10-18 09:15', person: '退役军人志愿队' }) }
      ]
    },
    education: {
      places: [
        { id: 'ed-1', name: '泰和社区双拥主题国防广场', community: '泰和社区', coord: [37.4352, 116.3592], address: '泰和·名仕馨港东侧文化广场', capacity: 400, count: 11, people: 620, latest: '全民国防教育日大型主题展板巡展' },
        { id: 'ed-2', name: '锦绣社区国防教育讲堂', community: '锦绣社区', coord: [37.4322, 116.3392], address: '锦绣社区党群服务中心三楼', capacity: 160, count: 10, people: 560, latest: '参战老兵进社区讲述红色家风故事' },
        { id: 'ed-3', name: '星凯社区新时代文明实践国防角', community: '星凯社区', coord: [37.4465, 116.3515], address: '星凯国际广场二楼共享阵地', capacity: 180, count: 12, people: 680, latest: '两新企业青年国防安全与保密宣讲' },
        { id: 'ed-4', name: '华嬉社区青少年国防科普馆', community: '华嬉社区', coord: [37.4085, 116.3542], address: '华嬉社区文体活动中心一楼', capacity: 120, count: 8, people: 460, latest: '中小学生国防模型制作与人防避险演练' },
        { id: 'ed-5', name: '德馨社区红色记忆展厅', community: '德馨社区', coord: [37.4632, 116.3532], address: '德馨社区党群服务中心二楼', capacity: 140, count: 9, people: 480, latest: '社区党员与民兵骨干国防法规专题课' }
      ],
      monthlyTrend: [
        { month: '6月', count: 7, people: 380 },
        { month: '7月', count: 11, people: 640 },
        { month: '8月', count: 14, people: 890 },
        { month: '9月', count: 16, people: 1120 },
        { month: '10月', count: 10, people: 580 },
        { month: '11月', count: 9, people: 520 }
      ],
      courses: [
        { id: 'cs-1', title: '《全民国防教育法》新修订要点社区宣讲课件', pages: '28 页', updated: '2026-09-01', type: 'course', unit: '长河街道人武部', content: '第一部分：修订背景与核心原则；第二部分：街道与社区基层国防教育职责；第三部分：典型案例与社区实践指引。' },
        { id: 'cs-2', title: '青少年国防安全与人民防空应急避险第一课', pages: '22 页', updated: '2026-09-14', type: 'course', unit: '华嬉社区科普馆', content: '涵盖防空警报识别、家庭应急包配置、人防工程疏散标志辨识等互动教学内容。' },
        { id: 'cs-3', title: '国家安全与基层涉密数据防护警示微课', pages: '16 页', updated: '2026-10-20', type: 'course', unit: '街道武装与保密专班', content: '结合基层工作实际讲解手机拍照防泄密、内网专网规范用网与涉军信息保护。' }
      ],
      photos: [
        { id: 'ph-e1', category: '教育现场', title: '全民国防教育日大型广场宣传与模拟体验', community: '泰和社区', date: '2026-09-21', desc: '现场发放宣传手册 800 余份，组织社区居民体验防空应急救护。', src: buildScenePhoto({ scene: 'edu', title: '全民国防教育日现场宣教', location: '泰和社区双拥主题广场', time: '2026-09-21 09:30', person: '街道国防教育办' }) },
        { id: 'ph-e2', category: '国防教育讲堂', title: '锦绣社区国防教育讲堂：老兵讲述保家卫国故事', community: '锦绣社区', date: '2026-10-12', desc: '邀请退伍老兵面对面为 140 余名青少年和居民授课。', src: buildScenePhoto({ scene: 'edu', title: '老兵进社区国防教育讲堂', location: '锦绣社区党群三楼讲堂', time: '2026-10-12 14:30', person: '锦绣社区讲堂' }) },
        { id: 'ph-e3', category: '教育现场', title: '华嬉社区青少年国防科普研学实践营', community: '华嬉社区', date: '2026-11-02', desc: '辖区小学 60 名学生走进国防科普馆开展沉浸式学习。', src: buildScenePhoto({ scene: 'edu', title: '青少年国防科普实践营', location: '华嬉社区科普馆', time: '2026-11-02 10:00', person: '华嬉社区' }) }
      ]
    }
  }

  // 警情通报（数据中枢 R18）
  const policeAlerts = [
    { id: 'pa-1', type: '反诈预警', community: '德馨社区', time: '2026-11-19 11:05', summary: '辖区居民接到冒充客服退款电话，社区民警联合网格员 12 分钟上门劝阻成功止损 3.8 万元。', status: '已止损闭环' },
    { id: 'pa-2', type: '治安联勤', community: '星凯社区', time: '2026-11-18 22:15', summary: '商务广场周边夜间车辆违停堵塞消防通道，警网联动现场疏导清障。', status: '已处置完毕' },
    { id: 'pa-3', type: '纠纷调处', community: '堤口社区', time: '2026-11-18 16:40', summary: '沿街两家商户因排烟管道安装产生口角，派出所与社区调解员联合促成和解。', status: '已签署协议' },
    { id: 'pa-4', type: '护学联防', community: '泰和社区', time: '2026-11-18 07:50', summary: '辖区小学早高峰护学岗协同执勤，校园周边交通与治安秩序平稳。', status: '常态值守' },
    { id: 'pa-5', type: '防火警示', community: '岳庄社区', time: '2026-11-17 15:20', summary: '提醒林缘及农田周边严禁焚烧秸秆枯草，警网巡查车开展语音播报宣传。', status: '持续巡防' }
  ]

  // 信创安全底座（覆盖 R49-R56）
  const xinchuang = {
    offlineSimulated: false,
    watermarkEnabled: true,
    lastSyncTime: '2026-11-19 18:40',
    lastSyncCount: 128,
    migrationTables: [
      { domain: '实有人口与重点关怀库', oldCount: 115940, cleaned: 412, newCount: 115528, status: '百分百吻合' },
      { domain: '住宅房屋与楼栋关联库', oldCount: 42580, cleaned: 96, newCount: 42484, status: '百分百吻合' },
      { domain: '市场主体与九小场所库', oldCount: 5053, cleaned: 38, newCount: 5015, status: '百分百吻合' },
      { domain: '网格事件全周期卷宗库', oldCount: 3842, cleaned: 0, newCount: 3842, status: '百分百吻合' },
      { domain: '数字武装专题与档案库', oldCount: 1428, cleaned: 14, newCount: 1414, status: '百分百吻合' }
    ],
    syncChannels: [
      { name: '实有人口与民政关怀宽表', direction: '新区大数据局 → 长河信创库', todayCount: 84, exemptItems: '免基层重复填报 6 类', status: '校验一致' },
      { name: '市场主体与特种监管库', direction: '新区大数据局 → 长河信创库', todayCount: 29, exemptItems: '免基层重复填报 5 类', status: '校验一致' },
      { name: '网格事件办结归档回传', direction: '长河信创库 → 新区大数据局', todayCount: 15, exemptItems: '自动汇聚免二次报送 3 类', status: '回传成功' }
    ],
    auditLogs: [
      { time: '2026-11-19 18:40', operator: '系统自动任务', role: '政务内网同步引擎', action: '完成与天衢新区大数据局增量对账同步 128 条', scope: '全街道 14 社区', result: '校验通过' },
      { time: '2026-11-19 14:18', operator: '李敏', role: '专职网格员', action: '上传 11 月九小场所存量复合核查修订批次', scope: '德馨社区', result: '国密留痕' },
      { time: '2026-11-19 10:28', operator: '孙雅琴', role: '社区管理员', action: '审核受理堤口社区易涝点淤堵事件', scope: '堤口社区', result: '合规放行' },
      { time: '2026-11-19 09:24', operator: '李敏', role: '专职网格员', action: '掌上网格现场直报金辰云河赋 3 号楼消防通道占用', scope: '德馨社区', result: '端云同步' }
    ]
  }

  return {
    loggedIn: true,
    preset: 'vermilion-seal',
    sidebarCollapsed: false,
    roleId: 'street_admin',
    selectedCommunity: '全街道',
    cockpitTheme: 'light',
    patrolThreshold: 30,
    eventRules: defaultRules,
    events: snapEventCoords(seedEvents),
    buildingProfiles,
    patrolRecords,
    dataDirect,
    armedForces,
    policeAlerts,
    xinchuang,
    toastMessage: ''
  }
}

const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const ID_CHECKS = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
function fixIdCardChecksum(id) {
  const s = String(id || '').trim().toUpperCase()
  if (!/^\d{17}[\dX]$/.test(s)) return s
  let sum = 0
  for (let i = 0; i < 17; i++) sum += Number(s[i]) * ID_WEIGHTS[i]
  return s.slice(0, 17) + ID_CHECKS[sum % 11]
}

function syncCanonicalMetrics(state) {
  if (!state) return state
  const totalPop = COMMUNITIES.reduce((a, c) => a + c.pop, 0)
  const totalHouse = COMMUNITIES.reduce((a, c) => a + c.housing.homes, 0)
  const totalEnt = COMMUNITIES.reduce((a, c) => a + c.biz.large + c.biz.small + c.biz.self, 0)
  const totalReg = COMMUNITIES.reduce((a, c) => a + c.armed.recruitReg, 0)
  const totalApply = COMMUNITIES.reduce((a, c) => a + c.armed.recruitApply, 0)
  const totalPass = COMMUNITIES.reduce((a, c) => a + c.armed.recruitPass, 0)

  if (state.armedForces?.militia?.squadStructure?.[3]) {
    state.armedForces.militia.squadStructure[3].count = 48
  }
  if (state.armedForces?.recruit?.funnel?.length >= 6) {
    const f = state.armedForces.recruit.funnel
    f[0].count = totalReg
    f[0].pct = 100
    f[2].count = totalApply
    f[2].pct = Math.round((totalApply / totalReg) * 100)
    f[5].count = totalPass
    f[5].pct = Math.round((totalPass / totalReg) * 100)
  }
  if (state.xinchuang?.migrationTables?.length >= 3) {
    const mt = state.xinchuang.migrationTables
    mt[0].newCount = totalPop
    mt[0].oldCount = totalPop + mt[0].cleaned
    mt[1].newCount = totalHouse
    mt[1].oldCount = totalHouse + mt[1].cleaned
    mt[2].newCount = totalEnt
    mt[2].oldCount = totalEnt + mt[2].cleaned
  }
  if (Array.isArray(state.dataDirect?.records)) {
    state.dataDirect.records.forEach((r) => {
      if (r.idCard) r.idCard = fixIdCardChecksum(r.idCard)
    })
  }
  return state
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.events) && parsed.dataDirect && parsed.armedForces) {
        if (!localStorage.getItem('changhe-vermilion-defaulted')) {
          parsed.preset = 'vermilion-seal'
          localStorage.setItem('changhe-vermilion-defaulted', '1')
        }
        if (!localStorage.getItem('changhe-cockpit-light-defaulted')) {
          parsed.cockpitTheme = 'light'
          localStorage.setItem('changhe-cockpit-light-defaulted', '1')
        }
        // 每次加载默认恢复真实在线地图（仅在信创底座手动演练时临时断网），并清理旧版缓存日志措辞
        if (parsed.xinchuang) {
          parsed.xinchuang.offlineSimulated = false
          if (Array.isArray(parsed.xinchuang.auditLogs)) {
            parsed.xinchuang.auditLogs = parsed.xinchuang.auditLogs.map((log) => ({
              ...log,
              action: String(log.action || '').replace('启动【模拟外网断开】实测，地图 1 秒无感切换至街道本地信创矢量底图', '切换至政务内网纯离线模式，本地信创矢量底图无缝接管')
            }))
          }
        }
        // 补齐 14 社区完整闭环归档事件底数并自动对齐真实社区路网质心
        if (parsed.events.length < 24) {
          const fresh = createInitialState()
          const existingIds = new Set(parsed.events.map((e) => e.id))
          parsed.events.push(...fresh.events.filter((e) => !existingIds.has(e.id)))
        }
        parsed.events = snapEventCoords(parsed.events)
        // 自动升级 6 层旧缓存楼栋为 18 层真实高层立体房态（保留已有住户编辑）
        if (!parsed.buildingProfiles?.residential?.floors || parsed.buildingProfiles.residential.floors.length < 18) {
          const freshB = createInitialState().buildingProfiles
          parsed.buildingProfiles = {
            ...freshB,
            residential: {
              ...freshB.residential,
              rooms: { ...freshB.residential.rooms, ...(parsed.buildingProfiles?.residential?.rooms || {}) }
            }
          }
        }
        // 自动升级旧缓存中的内联 SVG 示意占位图为本地高清纪实实景照片
        parsed.events = parsed.events.map((ev) => ({
          ...ev,
          beforePhoto: isLegacySvgPhoto(ev.beforePhoto)
            ? buildScenePhoto({ scene: 'before', title: ev.title, location: ev.address || ev.community })
            : ev.beforePhoto,
          afterPhoto: isLegacySvgPhoto(ev.afterPhoto)
            ? buildScenePhoto({ scene: 'after', title: ev.title, location: ev.address || ev.community })
            : ev.afterPhoto
        }))
        const armedPhotoGroups = [
          ['party', 'visit'],
          ['militia', 'militia'],
          ['mobilize', 'double'],
          ['education', 'edu']
        ]
        armedPhotoGroups.forEach(([topicKey, scene]) => {
          const list = parsed.armedForces?.[topicKey]?.photos
          if (Array.isArray(list)) {
            list.forEach((ph) => {
              if (isLegacySvgPhoto(ph.src)) {
                ph.src = buildScenePhoto({ scene, title: ph.title, location: ph.community })
              }
            })
          }
        })
        if (Array.isArray(parsed.dataDirect?.records)) {
          parsed.dataDirect.records.forEach((rec) => {
            if (rec.values && isLegacySvgPhoto(rec.values.sitePhoto)) {
              rec.values.sitePhoto = buildScenePhoto({
                scene: 'after',
                title: rec.values.shopName || '现场核查照',
                location: rec.community || ''
              })
            }
          })
        }
        return syncCanonicalMetrics(parsed)
      }
    }
  } catch {
    // ignore corrupted cache
  }
  return syncCanonicalMetrics(createInitialState())
}

export const store = reactive(loadState())

let toastTimer = null
let switchFallbackTimer = null
let activeViewTransition = null

export function applyPreset(id, event) {
  const valid = PRESETS.some((p) => p.id === id) ? id : 'vermilion-seal'
  const root = document.documentElement
  const prev = root.dataset.preset

  const commit = () => {
    store.preset = valid
    root.dataset.preset = valid
    root.dataset.contrast = 'aa'
    if (valid === 'command-dark') {
      store.cockpitTheme = 'dark'
    } else if (prev === 'command-dark') {
      store.cockpitTheme = 'light'
    }
  }

  // 初始化或重复点击当前主题、或用户开启减少动态效果：直接切换
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (!prev || prev === valid || !event || reducedMotion) {
    commit()
    return
  }

  // 现代浏览器：使用 View Transitions API 从点击坐标做 60fps 径向涟漪平滑扩散
  if (typeof document.startViewTransition === 'function') {
    const rect = event.currentTarget?.getBoundingClientRect?.()
    const x = typeof event.clientX === 'number' && event.clientX > 0
      ? event.clientX
      : rect
        ? rect.left + rect.width / 2
        : window.innerWidth / 2
    const y = typeof event.clientY === 'number' && event.clientY > 0
      ? event.clientY
      : rect
        ? rect.top + rect.height / 2
        : 36
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    )

    if (activeViewTransition) {
      try { activeViewTransition.skipTransition() } catch { /* noop */ }
    }

    root.classList.add('theme-vt-active')
    const transition = document.startViewTransition(() => {
      commit()
    })
    activeViewTransition = transition

    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`
            ]
          },
          {
            duration: 460,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            pseudoElement: '::view-transition-new(root)'
          }
        )
      })
      .catch(() => {})

    transition.finished.finally(() => {
      root.classList.remove('theme-vt-active')
      if (activeViewTransition === transition) activeViewTransition = null
    })
    return
  }

  // 不支持 View Transitions 的浏览器：临时启用关键容器色彩柔滑过渡
  root.classList.add('theme-switching')
  commit()
  clearTimeout(switchFallbackTimer)
  switchFallbackTimer = setTimeout(() => {
    root.classList.remove('theme-switching')
  }, 340)
}

export function showToast(msg) {
  store.toastMessage = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    store.toastMessage = ''
  }, 3200)
}

export function getCurrentRole() {
  return ROLES.find((r) => r.id === store.roleId) || ROLES[0]
}

export function getEffectiveCommunity() {
  const role = getCurrentRole()
  return role.scope === '全街道' ? store.selectedCommunity : role.scope
}

export function getVisibleCommunities() {
  const sc = getEffectiveCommunity()
  return sc === '全街道' ? COMMUNITIES : COMMUNITIES.filter((c) => c.name === sc)
}

export function addAuditLog(action, result = '合规放行') {
  const role = getCurrentRole()
  store.xinchuang.auditLogs.unshift({
    time: nowStr(),
    operator: role.userName,
    role: role.name,
    action,
    scope: getEffectiveCommunity(),
    result
  })
  store.xinchuang.auditLogs = store.xinchuang.auditLogs.slice(0, 40)
}

export function switchRole(roleId) {
  const target = ROLES.find((r) => r.id === roleId)
  if (!target) return
  store.roleId = roleId
  store.selectedCommunity = target.scope === '全街道' ? '全街道' : target.scope
  addAuditLog(`切换工作身份视角至「${target.name}（${target.userName}）」`, '权限即时生效')
  showToast(`已切换为「${target.name}」，菜单与数据权限已同步收口`)
}

export function resetDemoData() {
  const fresh = createInitialState()
  Object.keys(fresh).forEach((k) => {
    store[k] = fresh[k]
  })
  localStorage.removeItem(STORAGE_KEY)
  showToast('业务数据已恢复至初始基准状态')
}

export function recalculateLedgerRecord(ledger, values) {
  const next = { ...values }
  ledger.fields.forEach((f) => {
    if (f.type === 'formula' && f.formula) {
      next[f.key] = evaluateFormula(f.formula, next)
    }
  })
  return next
}

watch(
  () => store,
  (val) => {
    try {
      const copy = { ...val, toastMessage: '' }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(copy))
    } catch {
      // ignore storage quota error
    }
  },
  { deep: true }
)
