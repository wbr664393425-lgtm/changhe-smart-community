<script setup>
import { ref, computed } from 'vue'
import { Award, ShieldCheck, Building2, Siren, HeartHandshake, Map } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import GeoMap from '../components/GeoMap.vue'
import ChangheCity3D from '../components/ChangheCity3D.vue'
import DrilldownDrawer from '../components/DrilldownDrawer.vue'
import {
  store, COMMUNITIES, getCurrentRole, getEffectiveCommunity, getVisibleCommunities, addAuditLog
} from '../store/appStore'
import {
  buildPartyBranchDrill,
  buildSpecialGroupDrill,
  buildElderlyDrill,
  buildStudentsDrill,
  buildUnitResourceDrill,
  buildSafetyHazardsDrill
} from '../utils/drilldownData'

const role = computed(() => getCurrentRole())
const scope = computed(() => getEffectiveCommunity())
const visibleComms = computed(() => getVisibleCommunities())
const mapBase = ref('city3d')
const hoveredAlertComm = ref('')

const drill = ref({ open: false, title: '', subtitle: '', summary: '', filters: [], columns: [], rows: [], exportName: '' })

const hub = computed(() => {
  const list = visibleComms.value
  const pop = list.reduce((a, c) => a + c.pop, 0)
  const party = list.reduce((a, c) => a + c.party, 0)
  const honors = list.flatMap((c) => c.honors.map((h) => ({ community: c.name, honor: h })))
  const elderly = list.reduce((a, c) => a + c.elderly, 0)
  const students = list.reduce((a, c) => a + c.students, 0)
  const youth = Math.max(0, pop - elderly - students)
  const malePct = list.length ? +(list.reduce((a, c) => a + c.malePct, 0) / list.length).toFixed(1) : 50.4
  const special = {
    elderAlone: list.reduce((a, c) => a + c.special.elderAlone, 0),
    lowIncome: list.reduce((a, c) => a + c.special.lowIncome, 0),
    disabled: list.reduce((a, c) => a + c.special.disabled, 0),
    veteran: list.reduce((a, c) => a + c.special.veteran, 0)
  }
  const keyObj = list.reduce((a, c) => a + c.safety.keyObj, 0)
  const regEnt = list.reduce((a, c) => a + c.safety.regEnt, 0)
  const hazards = list.reduce((a, c) => a + c.safety.hazards, 0)
  const fixed = list.reduce((a, c) => a + c.safety.fixed, 0)
  const coverage = list.length ? (list.reduce((a, c) => a + c.safety.coverage, 0) / list.length).toFixed(1) : '98.0'
  const fixRate = hazards ? ((fixed / hazards) * 100).toFixed(1) : '100.0'
  const totalEnt = list.reduce((a, c) => a + c.biz.large + c.biz.small + c.biz.self, 0)
  const largeEnt = list.reduce((a, c) => a + c.biz.large, 0)
  const smallEnt = list.reduce((a, c) => a + c.biz.small, 0)
  const selfEnt = list.reduce((a, c) => a + c.biz.self, 0)
  const revenue = list.reduce((a, c) => a + c.biz.revenue, 0).toFixed(1)
  const employees = list.reduce((a, c) => a + c.biz.employees, 0)

  const govPoints = list.reduce((a, c) => a + c.gov.points, 0)
  const govPass = list.length ? (list.reduce((a, c) => a + c.gov.passRate, 0) / list.length).toFixed(1) : '96.0'
  const aid = {
    wheelchair: list.reduce((a, c) => a + c.gov.aidStation.wheelchair, 0),
    crutch: list.reduce((a, c) => a + c.gov.aidStation.crutch, 0),
    medkit: list.reduce((a, c) => a + c.gov.aidStation.medkit, 0),
    toolbox: list.reduce((a, c) => a + c.gov.aidStation.toolbox, 0),
    umbrella: list.reduce((a, c) => a + c.gov.aidStation.umbrella, 0)
  }
  const evs = store.events.filter((e) => scope.value === '全街道' || e.community === scope.value)
  const closeRate = evs.length ? ((evs.filter((e) => e.stage === '已办结').length / evs.length) * 100).toFixed(1) : '100.0'
  const alerts = store.policeAlerts.filter((a) => scope.value === '全街道' || a.community === scope.value)
  return {
    pop, party, honors, elderly, students, youth, malePct, special,
    keyObj, regEnt, hazards, fixed, coverage, fixRate,
    totalEnt, largeEnt, smallEnt, selfEnt, revenue, employees,
    govPoints, govPass, aid, evs, closeRate, alerts
  }
})

function selectComm(name) {
  if (role.value.scope !== '全街道' && name !== role.value.scope) return
  store.selectedCommunity = store.selectedCommunity === name ? '全街道' : name
}

function openDrill(kind, extra = '') {
  const list = visibleComms.value
  const sc = scope.value
  if (kind === 'party') {
    drill.value = { open: true, ...buildPartyBranchDrill(list, sc) }
  } else if (kind === 'special') {
    drill.value = { open: true, ...buildSpecialGroupDrill(list, sc, extra) }
  } else if (kind === 'elderly') {
    drill.value = { open: true, ...buildElderlyDrill(list, sc) }
  } else if (kind === 'students') {
    drill.value = { open: true, ...buildStudentsDrill(list, sc) }
  } else if (kind === 'economy' || kind === 'large' || kind === 'small' || kind === 'self') {
    drill.value = { open: true, ...buildUnitResourceDrill(list, sc, kind === 'economy' ? 'large' : kind) }
  } else if (kind === 'safety') {
    drill.value = { open: true, ...buildSafetyHazardsDrill(list, sc, extra) }
  } else {
    const rows = list.map((c) => ({
      community: c.name,
      wheelchair: c.gov.aidStation.wheelchair,
      crutch: c.gov.aidStation.crutch,
      medkit: c.gov.aidStation.medkit,
      toolbox: c.gov.aidStation.toolbox,
      umbrella: c.gov.aidStation.umbrella,
      status: c.gov.aidStation.wheelchair >= 5 ? '物资充足' : '常规储备',
      remark: `${c.name}共享辅助站免费向辖区居民提供轮椅、拐杖、药箱、工具箱与雨具借用服务。`
    }))
    drill.value = {
      open: true,
      title: '共享辅助站便民物资社区明细',
      subtitle: `口径范围：${sc}`,
      summary: `覆盖 ${list.length} 个社区共享辅助站`,
      filters: [
        ...(list.length > 1 ? [{ key: 'community', label: '所属社区', allLabel: '全部社区', options: list.map((c) => c.name) }] : []),
        { key: 'status', label: '储备状态', type: 'chips', allLabel: '全部状态', options: ['物资充足', '常规储备'] }
      ],
      columns: [
        { key: 'community', label: '社区服务站' },
        { key: 'wheelchair', label: '便民轮椅', numeric: true },
        { key: 'crutch', label: '助行拐杖', numeric: true },
        { key: 'medkit', label: '应急药箱', numeric: true },
        { key: 'toolbox', label: '维修工具箱', numeric: true },
        { key: 'umbrella', label: '爱心雨具', numeric: true },
        { key: 'status', label: '储备状态', badgeMap: { '物资充足': 'st-ok', '常规储备': 'st-run' } }
      ],
      rows,
      exportName: '数据中枢_共享辅助站物资明细'
    }
  }
  addAuditLog(`在数据中枢下钻查阅「${drill.value.title}」`, '明细下钻')
}
</script>

<template>
  <AppShell title="数据中枢" :subtitle="`${scope}实时运行监测 · 正射俯拍影像联动 · 带虚线指标均支持授权明细下钻`">
    <!-- 顶部 14 社区速选联动条（R13） -->
    <section class="comm-filter-strip">
      <button
        type="button"
        class="cf-pill"
        :class="{ active: scope === '全街道' }"
        :disabled="role.scope !== '全街道'"
        @click="store.selectedCommunity = '全街道'"
      >
        全街道（14社区）
      </button>
      <button
        v-for="c in COMMUNITIES"
        :key="c.id"
        type="button"
        class="cf-pill"
        :class="{ active: scope === c.name }"
        :disabled="role.scope !== '全街道' && role.scope !== c.name"
        @click="selectComm(c.name)"
      >
        {{ c.name.replace('社区', '') }}
      </button>
    </section>

    <!-- 三栏核心中枢骨架：左党建人口 + 中俯拍影像图 + 右安监经济 -->
    <div class="hub-grid">
      <!-- 左侧：党建园地与人口统计（R14 + R16） -->
      <div class="hub-col">
        <section class="panel">
          <div class="panel-head">
            <h2><Award :size="15" style="color: var(--party-red)" /> 党建园地与获得荣誉</h2>
            <span class="tag st-party num">{{ hub.honors.length }} 项表彰</span>
          </div>
          <div class="panel-body">
            <div class="hub-stat-pair">
              <div class="hsp-box">
                <span>在册党员人数（可下钻）</span>
                <strong class="num drillable" style="color: var(--party-red)" @click="openDrill('party')">
                  {{ hub.party.toLocaleString() }}<small>名</small>
                </strong>
              </div>
              <div class="hsp-box">
                <span>基层党支部数</span>
                <strong class="num drillable" @click="openDrill('party')">{{ visibleComms.length * 3 }}<small>个</small></strong>
              </div>
            </div>
            <div class="honor-strip">
              <span v-for="(h, idx) in hub.honors.slice(0, 6)" :key="idx" class="honor-chip">
                {{ h.honor }}（{{ h.community.replace('社区', '') }}）
              </span>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>人口结构与特殊人群</h2>
            <span class="num" style="font-weight: 700">{{ hub.pop.toLocaleString() }} 人</span>
          </div>
          <div class="panel-body">
            <div class="bar-list">
              <div class="bar-item" title="中青年人口占比">
                <div class="bi-head"><span>中青年群体</span><b class="num">{{ hub.youth.toLocaleString() }} 人（{{ Math.round((hub.youth / hub.pop) * 100) }}%）</b></div>
                <div class="progress-track"><div class="progress-fill" :style="{ width: Math.round((hub.youth / hub.pop) * 100) + '%' }"></div></div>
              </div>
              <div class="bar-item clickable-bar" title="点击查看 60 岁以上重点关爱长者名册" @click="openDrill('elderly')">
                <div class="bi-head"><span>60 岁以上长者</span><b class="num">{{ hub.elderly.toLocaleString() }} 人（{{ Math.round((hub.elderly / hub.pop) * 100) }}%）</b></div>
                <div class="progress-track"><div class="progress-fill warn" :style="{ width: Math.round((hub.elderly / hub.pop) * 100) + '%' }"></div></div>
              </div>
              <div class="bar-item clickable-bar" title="点击查看辖区学校及在校生源台账" @click="openDrill('students')">
                <div class="bi-head"><span>在校学生群体</span><b class="num">{{ hub.students.toLocaleString() }} 人（{{ Math.round((hub.students / hub.pop) * 100) }}%）</b></div>
                <div class="progress-track"><div class="progress-fill ok" :style="{ width: Math.round((hub.students / hub.pop) * 100) + '%' }"></div></div>
              </div>
            </div>

            <div class="gender-bar">
              <div class="gb-head">
                <span>男性 {{ hub.malePct }}%</span>
                <span>性别比例</span>
                <span>女性 {{ (100 - hub.malePct).toFixed(1) }}%</span>
              </div>
              <div class="gb-track">
                <div class="gb-m" :style="{ width: hub.malePct + '%' }"></div>
                <div class="gb-f" :style="{ width: (100 - hub.malePct).toFixed(1) + '%' }"></div>
              </div>
            </div>

            <div class="special-grid" v-if="role.canViewSensitiveSpecial">
              <button type="button" class="sp-cell clickable-sp" @click="openDrill('special', '独居高龄')"><span>独居高龄</span><strong class="num">{{ hub.special.elderAlone }} 户</strong></button>
              <button type="button" class="sp-cell clickable-sp" @click="openDrill('special', '低保特困')"><span>低保特困</span><strong class="num">{{ hub.special.lowIncome }} 户</strong></button>
              <button type="button" class="sp-cell clickable-sp" @click="openDrill('special', '持证残障')"><span>持证残障</span><strong class="num">{{ hub.special.disabled }} 人</strong></button>
              <button type="button" class="sp-cell clickable-sp" @click="openDrill('special', '重点优抚')"><span>重点优抚</span><strong class="num">{{ hub.special.veteran }} 人</strong></button>
            </div>
            <div v-else class="perm-note">当前岗位未获特殊人群敏感分类授权，已按权限自动隐蔽</div>
          </div>
        </section>
      </div>

      <section class="panel hub-map-panel">
        <div class="panel-head">
          <h2><Map :size="15" /> 长河街道三维沙盘与实景底图联动</h2>
          <div class="ui-tabs" style="padding: 3px">
            <button type="button" :class="{ active: mapBase === 'city3d' }" @click="mapBase = 'city3d'">三维沙盘</button>
            <button type="button" :class="{ active: mapBase === 'gov' }" @click="mapBase = 'gov'">政务图</button>
            <button type="button" :class="{ active: mapBase === 'aerial' }" @click="mapBase = 'aerial'">卫星影像</button>
            <button type="button" :class="{ active: mapBase === 'street' }" @click="mapBase = 'street'">电子路网</button>
          </div>
        </div>
        <div class="hub-map-wrap">
          <ChangheCity3D
            v-if="mapBase === 'city3d'"
            mode="hub"
            :dark="false"
            :compact="true"
            :selected-community="scope"
            :hovered-community="hoveredAlertComm"
            slice="safety"
            :events="hub.evs"
            @select-community="selectComm"
            @webgl-fallback="mapBase = 'gov'"
          />
          <GeoMap
            v-else
            mode="hub"
            :base-mode="mapBase"
            :show-base-switch="false"
            :selected-community="scope"
            :hovered-community="hoveredAlertComm"
            :events="hub.evs"
            @select-community="selectComm"
          />
        </div>
      </section>

      <!-- 右侧：安全生产与经济分析（R15 + R16） -->
      <div class="hub-col">
        <section class="panel">
          <div class="panel-head">
            <h2><ShieldCheck :size="15" style="color: var(--ok)" /> 安全生产双率监测</h2>
            <button type="button" class="btn sm ghost" @click="openDrill('safety')">下钻台账 ›</button>
          </div>
          <div class="panel-body">
            <div class="hub-stat-pair">
              <div class="hsp-box">
                <span>重点监管对象</span>
                <strong class="num drillable" @click="openDrill('safety')">{{ hub.keyObj }}<small>处</small></strong>
              </div>
              <div class="hsp-box">
                <span>纳管监管企业</span>
                <strong class="num drillable" @click="openDrill('safety')">{{ hub.regEnt }}<small>家</small></strong>
              </div>
            </div>
            <div class="dual-rate">
              <div class="dr-item">
                <div class="bi-head"><span>安全检查覆盖率</span><strong class="num" style="color: var(--brand-2)">{{ hub.coverage }}%</strong></div>
                <div class="progress-track"><div class="progress-fill" :style="{ width: hub.coverage + '%' }"></div></div>
              </div>
              <div class="dr-item">
                <div class="bi-head"><span>隐患闭环整改率（{{ hub.fixed }}/{{ hub.hazards }}）</span><strong class="num" style="color: var(--ok)">{{ hub.fixRate }}%</strong></div>
                <div class="progress-track"><div class="progress-fill ok" :style="{ width: hub.fixRate + '%' }"></div></div>
              </div>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2><Building2 :size="15" style="color: var(--brand-2)" /> 辖区经济分析（营收与用工）</h2>
            <button type="button" class="btn sm ghost" @click="openDrill('economy')">下钻明细 ›</button>
          </div>
          <div class="panel-body">
            <div class="hub-stat-pair">
              <div class="hsp-box">
                <span>重点企业营业收入</span>
                <strong class="num drillable" @click="openDrill('economy')">{{ hub.revenue }}<small>亿元</small></strong>
              </div>
              <div class="hsp-box">
                <span>企业员工规模</span>
                <strong class="num drillable" @click="openDrill('economy')">{{ hub.employees.toLocaleString() }}<small>人</small></strong>
              </div>
            </div>
            <div class="bar-list" style="margin-top: 10px">
              <div class="bar-item clickable-bar" title="点击查看大型规上企业名录" @click="openDrill('large')">
                <div class="bi-head"><span>大型规上企业</span><b class="num">{{ hub.largeEnt }} 家</b></div>
                <div class="progress-track"><div class="progress-fill" :style="{ width: Math.min(100, Math.round((hub.largeEnt / Math.max(1, hub.totalEnt)) * 450)) + '%' }"></div></div>
              </div>
              <div class="bar-item clickable-bar" title="点击查看小微成长企业名录" @click="openDrill('small')">
                <div class="bi-head"><span>小微成长企业</span><b class="num">{{ hub.smallEnt.toLocaleString() }} 家</b></div>
                <div class="progress-track"><div class="progress-fill ok" :style="{ width: Math.round((hub.smallEnt / Math.max(1, hub.totalEnt)) * 100) + '%' }"></div></div>
              </div>
              <div class="bar-item clickable-bar" title="点击查看沿街个体工商户台账" @click="openDrill('self')">
                <div class="bi-head"><span>沿街个体工商户</span><b class="num">{{ hub.selfEnt.toLocaleString() }} 户</b></div>
                <div class="progress-track"><div class="progress-fill warn" :style="{ width: Math.round((hub.selfEnt / Math.max(1, hub.totalEnt)) * 100) + '%' }"></div></div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>

    <!-- 下半区：社会治理、共享辅助站物资与警情通报（R18） -->
    <div class="grid-2">
      <section class="panel">
        <div class="panel-head">
          <h2><HeartHandshake :size="15" style="color: var(--edu-teal)" /> 社会治理态势与共享辅助站便民物资</h2>
          <button type="button" class="btn sm ghost" @click="openDrill('aid')">物资下钻 ›</button>
        </div>
        <div class="panel-body">
          <div class="gov-kpi-row">
            <div class="gk-item"><span>治理点位</span><strong class="num">{{ hub.govPoints }} 处</strong></div>
            <div class="gk-item"><span>点位合格率</span><strong class="num" style="color: var(--ok)">{{ hub.govPass }}%</strong></div>
            <div class="gk-item"><span>受理事件</span><strong class="num">{{ hub.evs.length }} 件</strong></div>
            <div class="gk-item"><span>综合结案率</span><strong class="num" style="color: var(--brand-2)">{{ hub.closeRate }}%</strong></div>
          </div>
          <div class="aid-grid">
            <div class="aid-card" @click="openDrill('aid')"><span>便民轮椅</span><strong class="num">{{ hub.aid.wheelchair }} 辆</strong></div>
            <div class="aid-card" @click="openDrill('aid')"><span>助行拐杖</span><strong class="num">{{ hub.aid.crutch }} 副</strong></div>
            <div class="aid-card" @click="openDrill('aid')"><span>应急药箱</span><strong class="num">{{ hub.aid.medkit }} 套</strong></div>
            <div class="aid-card" @click="openDrill('aid')"><span>维修工具箱</span><strong class="num">{{ hub.aid.toolbox }} 套</strong></div>
            <div class="aid-card" @click="openDrill('aid')"><span>爱心雨具</span><strong class="num">{{ hub.aid.umbrella }} 把</strong></div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2><Siren :size="15" style="color: var(--bad)" /> 警情通报联动列表</h2>
          <small style="color: var(--ink-soft)">悬停通报自动高亮地图对应社区</small>
        </div>
        <div class="panel-body alert-list">
          <div
            v-for="al in hub.alerts"
            :key="al.id"
            class="alert-item"
            @mouseenter="hoveredAlertComm = al.community"
            @mouseleave="hoveredAlertComm = ''"
          >
            <div class="ai-head">
              <span class="tag st-bad">{{ al.type }}</span>
              <strong>{{ al.community }}</strong>
              <span class="ai-time num">{{ al.time }}</span>
              <span class="tag st-ok" style="margin-left: auto">{{ al.status }}</span>
            </div>
            <p>{{ al.summary }}</p>
          </div>
        </div>
      </section>
    </div>

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
.comm-filter-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 14px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
}

.cf-pill {
  height: 28px;
  padding: 0 11px;
  border-radius: 4px;
  border: 1px solid var(--line);
  background: var(--sunken);
  font-size: 12.5px;
  font-weight: 500;
}

.cf-pill.active {
  background: var(--brand-2);
  border-color: var(--brand-2);
  color: #ffffff;
}

.hub-grid {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr) 340px;
  gap: 14px;
  align-items: stretch;
}

@media (max-width: 1280px) {
  .hub-grid {
    grid-template-columns: 1fr;
  }
}

.hub-col {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.hub-col > .panel:last-child {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.hub-col > .panel:last-child > .panel-body {
  flex: 1;
}

.hub-map-panel {
  display: flex;
  flex-direction: column;
  min-height: 460px;
}

.hub-map-wrap {
  flex: 1;
  min-height: 420px;
}

.hub-stat-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.hsp-box {
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--sunken);
  border: 1px solid var(--line);
}

.hsp-box span {
  display: block;
  font-size: 11.5px;
  color: var(--ink-soft);
  margin-bottom: 4px;
}

.hsp-box strong {
  font-size: 20px;
}

.hsp-box strong small {
  font-size: 11.5px;
  font-weight: 500;
  margin-left: 2px;
}

.honor-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.honor-chip {
  font-size: 11.5px;
  padding: 3px 8px;
  border-radius: 4px;
  background: #fef4e5;
  color: #9a5204;
  border: 1px solid #f5d8a8;
}

.bar-list {
  display: grid;
  gap: 9px;
}

.bi-head {
  display: flex;
  justify-content: space-between;
  font-size: 12.5px;
  margin-bottom: 4px;
}

.gender-bar {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.gb-head {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--ink-muted);
  margin-bottom: 5px;
}

.gb-track {
  display: flex;
  height: 8px;
  border-radius: 999px;
  overflow: hidden;
  gap: 2px;
}

.gb-m { background: #1d5fc4; }
.gb-f { background: #d97706; }

.special-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  margin-top: 12px;
}

.sp-cell {
  text-align: center;
  padding: 7px 4px;
  border-radius: 5px;
  background: var(--sunken);
  border: 1px solid var(--line);
}

.sp-cell span {
  display: block;
  font-size: 11px;
  color: var(--ink-soft);
}

.sp-cell strong {
  font-size: 13.5px;
}

.perm-note {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 5px;
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 12px;
}

.dual-rate {
  display: grid;
  gap: 10px;
  margin-top: 12px;
}

.gov-kpi-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}

.gk-item {
  padding: 9px 10px;
  border-radius: 6px;
  background: var(--sunken);
  text-align: center;
}

.gk-item span {
  display: block;
  font-size: 11.5px;
  color: var(--ink-soft);
}

.gk-item strong {
  font-size: 17px;
}

.aid-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.aid-card {
  padding: 9px 8px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: #f0f9ff;
  text-align: center;
  cursor: pointer;
}

.aid-card:hover {
  border-color: var(--brand-2);
}

.aid-card span {
  display: block;
  font-size: 11.5px;
  color: var(--ink-muted);
}

.aid-card strong {
  font-size: 14.5px;
  color: var(--brand);
}

.alert-list {
  display: grid;
  gap: 8px;
}

.alert-item {
  padding: 9px 12px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--sunken);
}

.alert-item:hover {
  border-color: var(--brand-2);
  background: #f5f9ff;
}

.ai-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.ai-time {
  font-size: 11.5px;
  color: var(--ink-soft);
}

.alert-item p {
  margin: 0;
  font-size: 12.5px;
  color: var(--ink-muted);
}

.clickable-bar {
  cursor: pointer;
  padding: 4px 6px;
  margin: -4px -6px;
  border-radius: 6px;
  transition: background-color 0.15s ease;
}

.clickable-bar:hover {
  background: var(--sunken);
}

.clickable-sp {
  cursor: pointer;
  text-align: left;
  width: 100%;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.clickable-sp:hover {
  border-color: var(--brand-2);
  background: var(--brand-soft);
}
</style>
