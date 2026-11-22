<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, Download, Users, Building2, Home, Trees, ChevronRight } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import DrilldownDrawer from '../components/DrilldownDrawer.vue'
import { getEffectiveCommunity, getVisibleCommunities, addAuditLog, showToast } from '../store/appStore'
import { exportRealCsv } from '../utils/exportFile'
import {
  buildGridStaffDrill,
  buildCommitteesDrill,
  buildPublicPostDrill,
  buildPartyBranchDrill,
  buildGridPopulationDrill,
  buildElderlyDrill,
  buildStudentsDrill,
  buildUnitResourceDrill,
  buildHousingDrill,
  buildEnvironmentDrill
} from '../utils/drilldownData'

const router = useRouter()
const activeTopic = ref('population') // population | unit | housing | environment
const envSeason = ref('all') // all | flood | fire | dust
const highlightedCol = ref('')
const hoveredComm = ref('')

const scope = computed(() => getEffectiveCommunity())
const list = computed(() => getVisibleCommunities())

const drill = ref({
  open: false,
  title: '',
  subtitle: '',
  summary: '',
  filters: [],
  columns: [],
  rows: [],
  exportName: ''
})

const TOPICS = [
  { id: 'population', label: '人口结构专题', icon: Users },
  { id: 'unit', label: '单位资源专题', icon: Building2 },
  { id: 'housing', label: '住宅信息专题', icon: Home },
  { id: 'environment', label: '环境治理专题', icon: Trees }
]

const sum = (fn) => list.value.reduce((a, c) => a + fn(c), 0)

const popBars = computed(() => [
  { key: 'pop', label: '常住人口', value: sum((c) => c.pop), unit: '人', color: '#1a4b8c' },
  { key: 'hukou', label: '户籍人口', value: sum((c) => c.hukou), unit: '人', color: '#2563eb' },
  { key: 'elderly', label: '60岁以上老年人', value: sum((c) => c.elderly), unit: '人', color: '#d97706' },
  { key: 'students', label: '在校学生', value: sum((c) => c.students), unit: '人', color: '#0f6b75' },
  { key: 'party', label: '在册党员', value: sum((c) => c.party), unit: '名', color: '#b91c1c' },
  { key: 'publicPost', label: '公益岗人员', value: sum((c) => c.publicPost), unit: '名', color: '#137345' },
  { key: 'committees', label: '社区两委', value: sum((c) => c.committees), unit: '名', color: '#475569' },
  { key: 'gridStaff', label: '专职网格员', value: sum((c) => c.gridStaff), unit: '名', color: '#1d5fc4' }
])

const unitBars = computed(() => [
  { key: 'large', label: '大型企业', value: sum((c) => c.biz.large), unit: '家', group: '经营主体' },
  { key: 'small', label: '小微企业', value: sum((c) => c.biz.small), unit: '家', group: '经营主体' },
  { key: 'self', label: '个体工商户', value: sum((c) => c.biz.self), unit: '户', group: '经营主体' },
  { key: 'school', label: '学校及其他机构', value: sum((c) => c.biz.school), unit: '所', group: '公共与共建' },
  { key: 'coBuild', label: '共驻共建单位', value: sum((c) => c.biz.coBuild), unit: '家', group: '公共与共建' },
  { key: 'residentUnit', label: '驻地企事业单位', value: sum((c) => c.biz.residentUnit), unit: '家', group: '公共与共建' }
])

const housingBars = computed(() => [
  { key: 'commercial', label: '商品房小区', value: sum((c) => c.housing.commercial), unit: '个' },
  { key: 'resettle', label: '回迁安置小区', value: sum((c) => c.housing.resettle), unit: '个' },
  { key: 'old', label: '老旧小区', value: sum((c) => c.housing.old), unit: '个' },
  { key: 'buildings', label: '住宅楼栋总数', value: sum((c) => c.housing.buildings), unit: '栋' },
  { key: 'units', label: '住宅单元总数', value: sum((c) => c.housing.units), unit: '个' },
  { key: 'homes', label: '实有总户数', value: sum((c) => c.housing.homes), unit: '户' },
  { key: 'garages', label: '地下车库', value: sum((c) => c.housing.garages), unit: '处' },
  { key: 'rooms', label: '配套用房', value: sum((c) => c.housing.rooms), unit: '处' }
])

// R23 环境治理严格 9 类法定计量要素 + 季节场景滤镜
const envMetrics = computed(() => {
  const all = [
    { key: 'sites', label: '建筑工地', value: sum((c) => c.env.sites), unit: '个', season: 'dust', color: '#b4690e' },
    { key: 'bareSoil', label: '裸土面积', value: sum((c) => c.env.bareSoil), unit: '平方米', season: 'dust', color: '#d97706' },
    { key: 'farmland', label: '耕地面积', value: sum((c) => c.env.farmland), unit: '亩', season: 'fire', color: '#15803d' },
    { key: 'forest', label: '林地面积', value: sum((c) => c.env.forest), unit: '亩', season: 'fire', color: '#166534' },
    { key: 'wetland', label: '湿地面积', value: sum((c) => c.env.wetland), unit: '亩', season: 'flood', color: '#0f6b75' },
    { key: 'rivers', label: '河湖水系长度', value: +sum((c) => c.env.rivers).toFixed(1), unit: '公里', season: 'flood', color: '#0284c7' },
    { key: 'roads', label: '辖区道路里程', value: +sum((c) => c.env.roads).toFixed(1), unit: '公里', season: 'dust', color: '#475569' },
    { key: 'floodPts', label: '易涝积水点', value: sum((c) => c.env.floodPts), unit: '处', season: 'flood', color: '#c53030' },
    { key: 'firePts', label: '防火隐患点', value: sum((c) => c.env.firePts), unit: '处', season: 'fire', color: '#dc2626' }
  ]
  if (envSeason.value === 'all') return all
  return all.filter((m) => m.season === envSeason.value)
})

function openTopicDrill(topic, metricKey, initialCommunity = '') {
  highlightedCol.value = metricKey
  const comms = list.value
  const sc = scope.value
  let payload = null

  if (topic === 'population') {
    if (metricKey === 'gridStaff') payload = buildGridStaffDrill(comms, sc, initialCommunity)
    else if (metricKey === 'committees') payload = buildCommitteesDrill(comms, sc, initialCommunity)
    else if (metricKey === 'publicPost') payload = buildPublicPostDrill(comms, sc, initialCommunity)
    else if (metricKey === 'party') payload = buildPartyBranchDrill(comms, sc, initialCommunity)
    else if (metricKey === 'elderly') payload = buildElderlyDrill(comms, sc, initialCommunity)
    else if (metricKey === 'students') payload = buildStudentsDrill(comms, sc, initialCommunity)
    else if (metricKey === 'hukou') payload = buildGridPopulationDrill(comms, sc, 'hukou', initialCommunity)
    else payload = buildGridPopulationDrill(comms, sc, 'pop', initialCommunity)
  } else if (topic === 'unit') {
    payload = buildUnitResourceDrill(comms, sc, metricKey, initialCommunity)
  } else if (topic === 'housing') {
    payload = buildHousingDrill(comms, sc, metricKey, initialCommunity)
  } else {
    payload = buildEnvironmentDrill(comms, sc, metricKey, initialCommunity)
  }

  if (!payload) return
  drill.value = { open: true, ...payload }
  addAuditLog(`在数据智库穿透查阅「${payload.title}」${initialCommunity ? `（${initialCommunity}）` : ''}`, '明细下钻')
}

function exportCurrentTopic() {
  if (activeTopic.value === 'population') {
    exportRealCsv(
      '数据智库_人口结构明细',
      ['社区名称', '常住人口(人)', '户籍人口(人)', '党员(名)', '社区两委(名)', '网格员(名)', '公益岗(名)', '学生(人)', '老年人(人)'],
      list.value.map((c) => [c.name, c.pop, c.hukou, c.party, c.committees, c.gridStaff, c.publicPost, c.students, c.elderly])
    )
  } else if (activeTopic.value === 'unit') {
    exportRealCsv(
      '数据智库_单位资源明细',
      ['社区名称', '大型企业(家)', '小微企业(家)', '个体工商户(户)', '学校及其他机构(所)', '共驻共建单位(家)', '驻地企事业单位(家)'],
      list.value.map((c) => [c.name, c.biz.large, c.biz.small, c.biz.self, c.biz.school, c.biz.coBuild, c.biz.residentUnit])
    )
  } else if (activeTopic.value === 'housing') {
    exportRealCsv(
      '数据智库_住宅信息明细',
      ['社区名称', '商品房小区', '回迁小区', '老旧小区', '楼栋(栋)', '单元(个)', '户数(户)', '物业覆盖率(%)', '地下车库(处)', '配套用房(处)'],
      list.value.map((c) => [c.name, c.housing.commercial, c.housing.resettle, c.housing.old, c.housing.buildings, c.housing.units, c.housing.homes, c.housing.propertyRate, c.housing.garages, c.housing.rooms])
    )
  } else {
    exportRealCsv(
      '数据智库_环境治理法定要素明细',
      ['社区名称', '建筑工地(个)', '裸土(平方米)', '耕地(亩)', '林地(亩)', '湿地(亩)', '河湖(公里)', '道路(公里)', '易涝积水点(处)', '防火隐患点(处)'],
      list.value.map((c) => [c.name, c.env.sites, c.env.bareSoil, c.env.farmland, c.env.forest, c.env.wetland, c.env.rivers, c.env.roads, c.env.floodPts, c.env.firePts])
    )
  }
  addAuditLog(`导出数据智库「${TOPICS.find((t) => t.id === activeTopic.value)?.label}」同口径明细表`, '授权导出')
  showToast('已按当前专题与辖区口径导出明细表格')
}
</script>

<template>
  <AppShell title="数据智库" :subtitle="`${scope}四本法定家底 · 图表与 14 社区明细表同口径联动`">
    <template #top-extra>
      <button type="button" class="btn sm" @click="router.push('/portal')">
        <ArrowLeft :size="14" />
        <span>返回首页</span>
      </button>
      <button type="button" class="btn sm primary" @click="exportCurrentTopic">
        <Download :size="14" />
        <span>导出同口径明细</span>
      </button>
    </template>

    <!-- 四专题切换顶栏（R19） -->
    <div class="tt-tabs">
      <button
        v-for="t in TOPICS"
        :key="t.id"
        type="button"
        class="tt-tab"
        :class="{ active: activeTopic === t.id }"
        @click="activeTopic = t.id; highlightedCol = ''"
      >
        <component :is="t.icon" :size="15" />
        <span>{{ t.label }}</span>
      </button>
    </div>

    <!-- 专题一：人口结构（R20） -->
    <template v-if="activeTopic === 'population'">
      <section class="panel">
        <div class="panel-head">
          <h2>人口结构与基层治理力量分类汇总</h2>
          <small style="color: var(--ink-soft)">点击任意指标卡片或下方社区数值，弹窗穿透明细台账并支持多维筛选与分页</small>
        </div>
        <div class="panel-body">
          <div class="chart-cards-4">
            <button
              v-for="b in popBars"
              :key="b.key"
              type="button"
              class="metric-card"
              :class="{ selected: highlightedCol === b.key }"
              :title="`点击查看${b.label}明细台账（${b.value.toLocaleString()} ${b.unit}）`"
              @click="openTopicDrill('population', b.key)"
            >
              <div class="mc-top">
                <span>{{ b.label }}</span>
                <span class="mc-hint">明细<ChevronRight :size="12" /></span>
              </div>
              <strong class="num" :style="{ color: b.color }">{{ b.value.toLocaleString() }}<small>{{ b.unit }}</small></strong>
            </button>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>分社区人口结构同口径明细对账表</h2>
          <span class="tag st-ok">与上方图表 100% 同源口径</span>
        </div>
        <div class="table-wrapper" tabindex="0" role="region" aria-label="人口结构明细表">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">社区名称</th>
                <th scope="col" :class="{ colhi: highlightedCol === 'pop' }">常住人口(人)</th>
                <th scope="col" :class="{ colhi: highlightedCol === 'hukou' }">户籍人口(人)</th>
                <th scope="col" :class="{ colhi: highlightedCol === 'party' }">党员(名)</th>
                <th scope="col" :class="{ colhi: highlightedCol === 'committees' }">社区两委(名)</th>
                <th scope="col" :class="{ colhi: highlightedCol === 'gridStaff' }">网格员(名)</th>
                <th scope="col" :class="{ colhi: highlightedCol === 'publicPost' }">公益岗(名)</th>
                <th scope="col" :class="{ colhi: highlightedCol === 'students' }">学生(人)</th>
                <th scope="col" :class="{ colhi: highlightedCol === 'elderly' }">老年人(人)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in list" :key="c.id" :class="{ 'row-highlight': hoveredComm === c.name }" @mouseenter="hoveredComm = c.name" @mouseleave="hoveredComm = ''">
                <th scope="row">{{ c.name }}</th>
                <td class="num cell-drill" :class="{ colhi: highlightedCol === 'pop' }" @click="openTopicDrill('population', 'pop', c.name)">{{ c.pop.toLocaleString() }}</td>
                <td class="num cell-drill" :class="{ colhi: highlightedCol === 'hukou' }" @click="openTopicDrill('population', 'hukou', c.name)">{{ c.hukou.toLocaleString() }}</td>
                <td class="num cell-drill" :class="{ colhi: highlightedCol === 'party' }" @click="openTopicDrill('population', 'party', c.name)">{{ c.party }}</td>
                <td class="num cell-drill" :class="{ colhi: highlightedCol === 'committees' }" @click="openTopicDrill('population', 'committees', c.name)">{{ c.committees }}</td>
                <td class="num cell-drill" :class="{ colhi: highlightedCol === 'gridStaff' }" @click="openTopicDrill('population', 'gridStaff', c.name)">{{ c.gridStaff }}</td>
                <td class="num cell-drill" :class="{ colhi: highlightedCol === 'publicPost' }" @click="openTopicDrill('population', 'publicPost', c.name)">{{ c.publicPost }}</td>
                <td class="num cell-drill" :class="{ colhi: highlightedCol === 'students' }" @click="openTopicDrill('population', 'students', c.name)">{{ c.students.toLocaleString() }}</td>
                <td class="num cell-drill" :class="{ colhi: highlightedCol === 'elderly' }" @click="openTopicDrill('population', 'elderly', c.name)">{{ c.elderly.toLocaleString() }}</td>
              </tr>
              <tr class="sum-row">
                <th scope="row">当前范围合计</th>
                <td class="num cell-drill" @click="openTopicDrill('population', 'pop')">{{ sum((c) => c.pop).toLocaleString() }}</td>
                <td class="num cell-drill" @click="openTopicDrill('population', 'hukou')">{{ sum((c) => c.hukou).toLocaleString() }}</td>
                <td class="num cell-drill" @click="openTopicDrill('population', 'party')">{{ sum((c) => c.party).toLocaleString() }}</td>
                <td class="num cell-drill" @click="openTopicDrill('population', 'committees')">{{ sum((c) => c.committees) }}</td>
                <td class="num cell-drill" @click="openTopicDrill('population', 'gridStaff')">{{ sum((c) => c.gridStaff) }}</td>
                <td class="num cell-drill" @click="openTopicDrill('population', 'publicPost')">{{ sum((c) => c.publicPost) }}</td>
                <td class="num cell-drill" @click="openTopicDrill('population', 'students')">{{ sum((c) => c.students).toLocaleString() }}</td>
                <td class="num cell-drill" @click="openTopicDrill('population', 'elderly')">{{ sum((c) => c.elderly).toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <!-- 专题二：单位资源（R21） -->
    <template v-else-if="activeTopic === 'unit'">
      <div class="grid-2">
        <section class="panel">
          <div class="panel-head"><h2>经营主体分类汇总</h2><small>点击任一项穿透主体名录</small></div>
          <div class="panel-body">
            <div class="bar-chart-v">
              <div
                v-for="u in unitBars.slice(0, 3)"
                :key="u.key"
                class="bc-row"
                :class="{ selected: highlightedCol === u.key }"
                @click="openTopicDrill('unit', u.key)"
              >
                <div class="bc-head">
                  <span>{{ u.label }}</span>
                  <span class="bc-val-wrap">
                    <strong class="num">{{ u.value.toLocaleString() }} {{ u.unit }}</strong>
                    <ChevronRight :size="13" class="bc-chev" />
                  </span>
                </div>
                <div class="progress-track"><div class="progress-fill" :style="{ width: Math.max(12, Math.round((u.value / Math.max(1, unitBars[2].value)) * 100)) + '%' }"></div></div>
              </div>
            </div>
          </div>
        </section>
        <section class="panel">
          <div class="panel-head"><h2>公共机构与共驻共建资源</h2><small>点击任一项穿透单位台账</small></div>
          <div class="panel-body">
            <div class="bar-chart-v">
              <div
                v-for="u in unitBars.slice(3)"
                :key="u.key"
                class="bc-row"
                :class="{ selected: highlightedCol === u.key }"
                @click="openTopicDrill('unit', u.key)"
              >
                <div class="bc-head">
                  <span>{{ u.label }}</span>
                  <span class="bc-val-wrap">
                    <strong class="num">{{ u.value.toLocaleString() }} {{ u.unit }}</strong>
                    <ChevronRight :size="13" class="bc-chev" />
                  </span>
                </div>
                <div class="progress-track"><div class="progress-fill ok" :style="{ width: Math.max(18, Math.round((u.value / Math.max(1, unitBars[5].value)) * 100)) + '%' }"></div></div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section class="panel">
        <div class="panel-head"><h2>分社区单位资源与共驻共建同口径明细表</h2></div>
        <div class="table-wrapper" tabindex="0" role="region" aria-label="单位资源明细表">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">社区名称</th>
                <th scope="col" :class="{ colhi: highlightedCol === 'large' }">大型企业(家)</th>
                <th scope="col" :class="{ colhi: highlightedCol === 'small' }">小微企业(家)</th>
                <th scope="col" :class="{ colhi: highlightedCol === 'self' }">个体工商户(户)</th>
                <th scope="col" :class="{ colhi: highlightedCol === 'school' }">学校及其他机构(所)</th>
                <th scope="col" :class="{ colhi: highlightedCol === 'coBuild' }">共驻共建单位(家)</th>
                <th scope="col" :class="{ colhi: highlightedCol === 'residentUnit' }">驻地企事业单位(家)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in list" :key="c.id">
                <th scope="row">{{ c.name }}</th>
                <td class="num cell-drill" :class="{ colhi: highlightedCol === 'large' }" @click="openTopicDrill('unit', 'large', c.name)">{{ c.biz.large }}</td>
                <td class="num cell-drill" :class="{ colhi: highlightedCol === 'small' }" @click="openTopicDrill('unit', 'small', c.name)">{{ c.biz.small }}</td>
                <td class="num cell-drill" :class="{ colhi: highlightedCol === 'self' }" @click="openTopicDrill('unit', 'self', c.name)">{{ c.biz.self }}</td>
                <td class="num cell-drill" :class="{ colhi: highlightedCol === 'school' }" @click="openTopicDrill('unit', 'school', c.name)">{{ c.biz.school }}</td>
                <td class="num cell-drill" :class="{ colhi: highlightedCol === 'coBuild' }" @click="openTopicDrill('unit', 'coBuild', c.name)">{{ c.biz.coBuild }}</td>
                <td class="num cell-drill" :class="{ colhi: highlightedCol === 'residentUnit' }" @click="openTopicDrill('unit', 'residentUnit', c.name)">{{ c.biz.residentUnit }}</td>
              </tr>
              <tr class="sum-row">
                <th scope="row">当前范围合计</th>
                <td class="num cell-drill" @click="openTopicDrill('unit', 'large')">{{ sum((c) => c.biz.large) }}</td>
                <td class="num cell-drill" @click="openTopicDrill('unit', 'small')">{{ sum((c) => c.biz.small).toLocaleString() }}</td>
                <td class="num cell-drill" @click="openTopicDrill('unit', 'self')">{{ sum((c) => c.biz.self).toLocaleString() }}</td>
                <td class="num cell-drill" @click="openTopicDrill('unit', 'school')">{{ sum((c) => c.biz.school) }}</td>
                <td class="num cell-drill" @click="openTopicDrill('unit', 'coBuild')">{{ sum((c) => c.biz.coBuild) }}</td>
                <td class="num cell-drill" @click="openTopicDrill('unit', 'residentUnit')">{{ sum((c) => c.biz.residentUnit) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <!-- 专题三：住宅信息（R22） -->
    <template v-else-if="activeTopic === 'housing'">
      <section class="panel">
        <div class="panel-head">
          <h2>住宅体量、物业覆盖与配套设施汇总</h2>
          <small>自住 {{ sum((c) => c.housing.selfLive).toLocaleString() }} 户 · 租住 {{ sum((c) => c.housing.rent).toLocaleString() }} 户 · 空置 {{ sum((c) => c.housing.vacant).toLocaleString() }} 户</small>
        </div>
        <div class="panel-body">
          <div class="chart-cards-4">
            <button
              v-for="h in housingBars"
              :key="h.key"
              type="button"
              class="metric-card"
              :class="{ selected: highlightedCol === h.key }"
              @click="openTopicDrill('housing', h.key)"
            >
              <div class="mc-top">
                <span>{{ h.label }}</span>
                <span class="mc-hint">明细<ChevronRight :size="12" /></span>
              </div>
              <strong class="num">{{ h.value.toLocaleString() }}<small>{{ h.unit }}</small></strong>
            </button>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>分社区小区分类、楼栋单元与配套用房明细表</h2></div>
        <div class="table-wrapper" tabindex="0" role="region" aria-label="住宅信息明细表">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">社区名称</th>
                <th scope="col">商品/回迁/老旧小区</th>
                <th scope="col" :class="{ colhi: highlightedCol === 'buildings' }">楼栋(栋)</th>
                <th scope="col" :class="{ colhi: highlightedCol === 'units' }">单元(个)</th>
                <th scope="col" :class="{ colhi: highlightedCol === 'homes' }">总户数(户)</th>
                <th scope="col">物业覆盖率</th>
                <th scope="col" :class="{ colhi: highlightedCol === 'garages' }">地下车库(处)</th>
                <th scope="col" :class="{ colhi: highlightedCol === 'rooms' }">配套用房(处)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in list" :key="c.id">
                <th scope="row">{{ c.name }}</th>
                <td class="num cell-drill" @click="openTopicDrill('housing', 'all', c.name)">{{ c.housing.commercial }} / {{ c.housing.resettle }} / {{ c.housing.old }}</td>
                <td class="num cell-drill" :class="{ colhi: highlightedCol === 'buildings' }" @click="openTopicDrill('housing', 'buildings', c.name)">{{ c.housing.buildings }}</td>
                <td class="num cell-drill" :class="{ colhi: highlightedCol === 'units' }" @click="openTopicDrill('housing', 'units', c.name)">{{ c.housing.units }}</td>
                <td class="num cell-drill" :class="{ colhi: highlightedCol === 'homes' }" @click="openTopicDrill('housing', 'homes', c.name)">{{ c.housing.homes.toLocaleString() }}</td>
                <td class="num cell-drill" @click="openTopicDrill('housing', 'all', c.name)"><span class="tag" :class="c.housing.propertyRate >= 93 ? 'st-ok' : 'st-warn'">{{ c.housing.propertyRate }}%</span></td>
                <td class="num cell-drill" :class="{ colhi: highlightedCol === 'garages' }" @click="openTopicDrill('housing', 'garages', c.name)">{{ c.housing.garages }}</td>
                <td class="num cell-drill" :class="{ colhi: highlightedCol === 'rooms' }" @click="openTopicDrill('housing', 'rooms', c.name)">{{ c.housing.rooms }}</td>
              </tr>
              <tr class="sum-row">
                <th scope="row">当前范围合计</th>
                <td class="num cell-drill" @click="openTopicDrill('housing', 'all')">{{ sum((c) => c.housing.commercial) }} / {{ sum((c) => c.housing.resettle) }} / {{ sum((c) => c.housing.old) }}</td>
                <td class="num cell-drill" @click="openTopicDrill('housing', 'buildings')">{{ sum((c) => c.housing.buildings) }}</td>
                <td class="num cell-drill" @click="openTopicDrill('housing', 'units')">{{ sum((c) => c.housing.units).toLocaleString() }}</td>
                <td class="num cell-drill" @click="openTopicDrill('housing', 'homes')">{{ sum((c) => c.housing.homes).toLocaleString() }}</td>
                <td class="num">{{ Math.round(sum((c) => c.housing.propertyRate) / Math.max(1, list.length)) }}%</td>
                <td class="num cell-drill" @click="openTopicDrill('housing', 'garages')">{{ sum((c) => c.housing.garages) }}</td>
                <td class="num cell-drill" @click="openTopicDrill('housing', 'rooms')">{{ sum((c) => c.housing.rooms) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <!-- 专题四：环境治理（R23 彻底纠偏：9 类法定计量要素 + 季节场景滤镜） -->
    <template v-else>
      <section class="panel">
        <div class="panel-head">
          <h2>自然生态与环境防控一张账（9 类法定要素 · 严守法定计量单位）</h2>
          <div class="season-filters">
            <button type="button" class="btn sm" :class="{ primary: envSeason === 'all' }" @click="envSeason = 'all'">全域总览（9类）</button>
            <button type="button" class="btn sm" :class="{ primary: envSeason === 'flood' }" @click="envSeason = 'flood'">汛期防涝聚焦</button>
            <button type="button" class="btn sm" :class="{ primary: envSeason === 'fire' }" @click="envSeason = 'fire'">秋冬防火聚焦</button>
            <button type="button" class="btn sm" :class="{ primary: envSeason === 'dust' }" @click="envSeason = 'dust'">施工扬尘管控</button>
          </div>
        </div>
        <div class="panel-body">
          <div class="env-card-grid">
            <button
              v-for="m in envMetrics"
              :key="m.key"
              type="button"
              class="metric-card"
              :class="{ selected: highlightedCol === m.key }"
              @click="openTopicDrill('environment', m.key)"
            >
              <div class="mc-top">
                <span>{{ m.label }}</span>
                <span class="mc-hint">台账<ChevronRight :size="12" /></span>
              </div>
              <strong class="num" :style="{ color: m.color }">{{ m.value.toLocaleString() }}<small>{{ m.unit }}</small></strong>
            </button>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>分社区环境治理 9 类法定要素明细对账表</h2>
          <span class="tag st-run">已按场景滤镜同步高亮关键防汛/防火/扬尘列</span>
        </div>
        <div class="table-wrapper" tabindex="0" role="region" aria-label="环境治理法定要素明细表">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">社区名称</th>
                <th scope="col" :class="{ colhi: envSeason === 'dust' || highlightedCol === 'sites' }">建筑工地(个)</th>
                <th scope="col" :class="{ colhi: envSeason === 'dust' || highlightedCol === 'bareSoil' }">裸土(平方米)</th>
                <th scope="col" :class="{ colhi: envSeason === 'fire' || highlightedCol === 'farmland' }">耕地(亩)</th>
                <th scope="col" :class="{ colhi: envSeason === 'fire' || highlightedCol === 'forest' }">林地(亩)</th>
                <th scope="col" :class="{ colhi: envSeason === 'flood' || highlightedCol === 'wetland' }">湿地(亩)</th>
                <th scope="col" :class="{ colhi: envSeason === 'flood' || highlightedCol === 'rivers' }">河湖(公里)</th>
                <th scope="col" :class="{ colhi: envSeason === 'dust' || highlightedCol === 'roads' }">道路(公里)</th>
                <th scope="col" :class="{ colhi: envSeason === 'flood' || highlightedCol === 'floodPts' }">易涝积水点(处)</th>
                <th scope="col" :class="{ colhi: envSeason === 'fire' || highlightedCol === 'firePts' }">防火隐患点(处)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in list" :key="c.id">
                <th scope="row">{{ c.name }}</th>
                <td class="num cell-drill" :class="{ colhi: envSeason === 'dust' || highlightedCol === 'sites' }" @click="openTopicDrill('environment', 'sites', c.name)">{{ c.env.sites }}</td>
                <td class="num cell-drill" :class="{ colhi: envSeason === 'dust' || highlightedCol === 'bareSoil' }" @click="openTopicDrill('environment', 'bareSoil', c.name)">{{ c.env.bareSoil.toLocaleString() }}</td>
                <td class="num cell-drill" :class="{ colhi: envSeason === 'fire' || highlightedCol === 'farmland' }" @click="openTopicDrill('environment', 'farmland', c.name)">{{ c.env.farmland }}</td>
                <td class="num cell-drill" :class="{ colhi: envSeason === 'fire' || highlightedCol === 'forest' }" @click="openTopicDrill('environment', 'forest', c.name)">{{ c.env.forest }}</td>
                <td class="num cell-drill" :class="{ colhi: envSeason === 'flood' || highlightedCol === 'wetland' }" @click="openTopicDrill('environment', 'wetland', c.name)">{{ c.env.wetland }}</td>
                <td class="num cell-drill" :class="{ colhi: envSeason === 'flood' || highlightedCol === 'rivers' }" @click="openTopicDrill('environment', 'rivers', c.name)">{{ c.env.rivers }}</td>
                <td class="num cell-drill" :class="{ colhi: envSeason === 'dust' || highlightedCol === 'roads' }" @click="openTopicDrill('environment', 'roads', c.name)">{{ c.env.roads }}</td>
                <td class="num cell-drill" :class="{ colhi: envSeason === 'flood' || highlightedCol === 'floodPts' }" @click="openTopicDrill('environment', 'floodPts', c.name)">
                  <span class="tag" :class="c.env.floodPts >= 2 ? 'st-bad' : 'st-neutral'">{{ c.env.floodPts }} 处</span>
                </td>
                <td class="num cell-drill" :class="{ colhi: envSeason === 'fire' || highlightedCol === 'firePts' }" @click="openTopicDrill('environment', 'firePts', c.name)">
                  <span class="tag" :class="c.env.firePts >= 3 ? 'st-bad' : 'st-warn'">{{ c.env.firePts }} 处</span>
                </td>
              </tr>
              <tr class="sum-row">
                <th scope="row">当前范围合计</th>
                <td class="num cell-drill" @click="openTopicDrill('environment', 'sites')">{{ sum((c) => c.env.sites) }} 个</td>
                <td class="num cell-drill" @click="openTopicDrill('environment', 'bareSoil')">{{ sum((c) => c.env.bareSoil).toLocaleString() }} ㎡</td>
                <td class="num cell-drill" @click="openTopicDrill('environment', 'farmland')">{{ sum((c) => c.env.farmland).toLocaleString() }} 亩</td>
                <td class="num cell-drill" @click="openTopicDrill('environment', 'forest')">{{ sum((c) => c.env.forest).toLocaleString() }} 亩</td>
                <td class="num cell-drill" @click="openTopicDrill('environment', 'wetland')">{{ sum((c) => c.env.wetland) }} 亩</td>
                <td class="num cell-drill" @click="openTopicDrill('environment', 'rivers')">{{ sum((c) => c.env.rivers).toFixed(1) }} 公里</td>
                <td class="num cell-drill" @click="openTopicDrill('environment', 'roads')">{{ sum((c) => c.env.roads).toFixed(1) }} 公里</td>
                <td class="num cell-drill" @click="openTopicDrill('environment', 'floodPts')">{{ sum((c) => c.env.floodPts) }} 处</td>
                <td class="num cell-drill" @click="openTopicDrill('environment', 'firePts')">{{ sum((c) => c.env.firePts) }} 处</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <DrilldownDrawer
      :open="drill.open"
      :title="drill.title"
      :subtitle="drill.subtitle"
      :summary-text="drill.summary"
      :filters="drill.filters"
      :columns="drill.columns"
      :rows="drill.rows"
      :export-name="drill.exportName"
      @close="drill.open = false"
    />
  </AppShell>
</template>

<style scoped>
.tt-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tt-tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 36px;
  padding: 0 16px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--surface);
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink-muted);
}

.tt-tab.active {
  background: var(--brand);
  border-color: var(--brand);
  color: #ffffff;
}

.chart-cards-4 {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.env-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 10px;
}

.metric-card {
  text-align: left;
  padding: 12px 14px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--sunken);
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.metric-card:hover {
  border-color: var(--brand-2);
}

.metric-card.selected {
  background: var(--brand-soft);
  border-color: var(--brand-2);
}

.mc-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 4px;
}

.mc-top > span:first-child {
  font-size: 12px;
  color: var(--ink-soft);
}

.mc-hint {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  font-size: 11px;
  color: var(--brand-2);
  opacity: 0.72;
  transition: opacity 0.15s ease;
}

.metric-card:hover .mc-hint,
.metric-card.selected .mc-hint {
  opacity: 1;
}

.metric-card strong {
  font-size: 21px;
}

.metric-card strong small {
  font-size: 11.5px;
  font-weight: 500;
  margin-left: 3px;
  color: var(--ink-muted);
}

.bar-chart-v {
  display: grid;
  gap: 12px;
}

.bc-row {
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}

.bc-row:hover {
  background: var(--sunken);
  border-color: var(--line);
}

.bc-row.selected {
  background: var(--brand-soft);
  border-color: var(--brand-2);
}

.bc-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  margin-bottom: 5px;
}

.bc-val-wrap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.bc-chev {
  color: var(--ink-soft);
}

.season-filters {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.colhi {
  background: var(--primary-soft);
  color: var(--ink);
  font-weight: 650;
}

.cell-drill {
  cursor: pointer;
}

.cell-drill:hover {
  color: var(--brand-2);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.sum-row th,
.sum-row td {
  background: var(--sunken);
  font-weight: 700;
  border-top: 2px solid var(--line-strong);
}

@media (max-width: 768px) {
  .tt-tabs {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 2px;
  }
  .tt-tabs::-webkit-scrollbar {
    display: none;
  }
  .tt-tab {
    flex: 0 0 auto;
    height: 34px;
    padding: 0 12px;
    font-size: 12.5px;
  }
  .chart-cards-4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .env-card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .metric-card {
    padding: 10px;
  }
  .metric-card strong {
    font-size: 18px;
  }
}

@media (max-width: 400px) {
  .env-card-grid {
    grid-template-columns: 1fr;
  }
}
</style>
