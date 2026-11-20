<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  LayoutDashboard, Database, BookOpen, Shield, Layers, Table2,
  Smartphone, Server, ArrowRight, AlertTriangle, Bell, Box, Map as MapIcon
} from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import ChangheCity3D from '../components/ChangheCity3D.vue'
import GeoMap from '../components/GeoMap.vue'
import {
  store, COMMUNITIES, getCurrentRole, getEffectiveCommunity, getVisibleCommunities
} from '../store/appStore'

const router = useRouter()
const role = computed(() => getCurrentRole())
const scope = computed(() => getEffectiveCommunity())
const visibleComms = computed(() => getVisibleCommunities())

const portalMapMode = ref('city3d') // city3d | gov
const portalSlice = ref('safety')
const PORTAL_SLICES = [
  { id: 'safety', label: '治理体检' },
  { id: 'party', label: '党建引领' },
  { id: 'economy', label: '经济脉动' },
  { id: 'eco', label: '生态防汛' },
  { id: 'aid', label: '民情关怀' }
]

const activeCommDetail = computed(() => {
  if (scope.value === '全街道') return null
  return COMMUNITIES.find((c) => c.name === scope.value) || null
})

function togglePortalComm(name) {
  if (role.value.scope !== '全街道' && name !== role.value.scope) return
  store.selectedCommunity = store.selectedCommunity === name ? '全街道' : name
}

const totals = computed(() => {
  const list = visibleComms.value
  const pop = list.reduce((a, c) => a + c.pop, 0)
  const homes = list.reduce((a, c) => a + c.housing.homes, 0)
  const ent = list.reduce((a, c) => a + c.biz.large + c.biz.small + c.biz.self, 0)
  const hazardsOpen = list.reduce((a, c) => a + (c.safety.hazards - c.safety.fixed), 0)
  const gridStaff = list.reduce((a, c) => a + c.gridStaff, 0)
  const events = store.events.filter((e) => scope.value === '全街道' || e.community === scope.value)
  const openEvents = events.filter((e) => e.stage !== '已办结')
  const returnedEvents = events.filter((e) => e.stage === '待补充')
  const doneRate = events.length ? ((events.filter((e) => e.stage === '已办结').length / events.length) * 100).toFixed(1) : '100.0'
  return { pop, homes, ent, hazardsOpen, gridStaff, events, openEvents, returnedEvents, doneRate }
})

const myTasks = computed(() => {
  const sc = scope.value
  return store.dataDirect.tasks.filter((t) => !t.expiredLocked && (sc === '全街道' || t.assignees.includes(sc)))
})

const moduleCards = computed(() => {
  const allowed = role.value.allowedRoutes
  const all = [
    { path: '/cockpit', title: '综合治理驾驶舱', desc: '一屏双态全域态势、五章汇报叙事与 14 社区地图穿透', metric: `${visibleComms.value.length} 个社区实时`, icon: LayoutDashboard, colorVar: 'var(--primary)' },
    { path: '/data-hub', title: '数据中枢', desc: '社区影像联动、党建荣誉与人房企核心指标下钻', metric: `${totals.value.ent.toLocaleString()} 家主体`, icon: Database, colorVar: 'var(--chart-1)' },
    { path: '/think-tank', title: '数据智库', desc: '人口、单位、住宅、环境治理四本底账统计对账', metric: `${totals.value.pop.toLocaleString()} 常住人口`, icon: BookOpen, colorVar: 'var(--chart-5)' },
    { path: '/armed-forces', title: '数字武装', desc: '党管武装、民兵旗标、征兵漏斗、动员与教育五专题', metric: `${visibleComms.value.length} 个民兵连`, icon: Shield, colorVar: 'var(--status-bad)' },
    { path: '/grid', title: '网格治理业务', desc: '一张图框选、立体楼栋房态、权责派单与轨迹督办', metric: `${totals.value.openEvents.length} 件在办`, icon: Layers, colorVar: 'var(--chart-3)' },
    { path: '/data-direct', title: '数据直达减负', desc: '分色活页宽表、字段规则校验、红绿核查与多表导出', metric: `${myTasks.value.length} 项任务`, icon: Table2, colorVar: 'var(--chart-2)' },
    { path: '/mobile', title: '掌上网格协同', desc: '政务微信现场快报、走访合规拦截与端云实时回执', metric: `${totals.value.gridStaff} 名网格员`, icon: Smartphone, colorVar: 'var(--chart-4)' },
    { path: '/xinchuang', title: '信创安全底座', desc: '内网离线矢量兜底、角色权限隔离与达梦库对账', metric: '达梦主备正常', icon: Server, colorVar: 'var(--chart-6)' }
  ]
  return all.filter((c) => allowed.includes(c.path))
})

function openEvent(ev) {
  router.push({ path: '/grid', query: { tab: 'triage', eventId: ev.id } })
}
</script>

<template>
  <AppShell title="门户工作台" :subtitle="`${role.name} · ${scope}运行总览`">
    <!-- 场景一：街道领导/部长视图 —— 晨报主视觉带 + 4×2 满格模块矩阵 + 底部对称双栏 -->
    <template v-if="role.landingMode === 'leader'">
      <section class="morning-brief">
        <div class="mb-left">
          <div class="mb-kicker">今日长河运行简报 · {{ scope }}（{{ visibleComms.length }} 个社区）</div>
          <p class="mb-summary">
            当前在办治理事项 <strong class="num">{{ totals.openEvents.length }}</strong> 件（办结率 <strong class="num">{{ totals.doneRate }}%</strong>），
            未销号安全生产隐患 <strong class="num">{{ totals.hazardsOpen }}</strong> 处，
            近期警网联勤通报 <strong class="num">{{ store.policeAlerts.length }}</strong> 条，
            「数据直达」宽表采集进行中 <strong class="num">{{ myTasks.length }}</strong> 项。
          </p>
        </div>
        <button
          v-if="role.allowedRoutes.includes('/cockpit')"
          type="button"
          class="btn primary mb-cta"
          @click="router.push('/cockpit')"
        >
          <LayoutDashboard :size="16" />
          <span>进入综合治理驾驶舱</span>
          <ArrowRight :size="15" />
        </button>
      </section>

      <!-- 门户首屏视觉核心：14 社区三维数字孪生沙盘视窗 + 实时态势速览 -->
      <section class="portal-3d-hero">
        <div class="p3d-stage-card">
          <div class="p3d-head">
            <div class="p3d-title">
              <Box :size="16" class="p3d-ico" />
              <strong>长河街道十四社区 · 三维立体态势沙盘</strong>
              <span class="p3d-scope">{{ scope }}</span>
            </div>
            <div class="p3d-actions">
              <div class="p3d-slice-seg" role="group" aria-label="切换沙盘专题">
                <button
                  v-for="sl in PORTAL_SLICES"
                  :key="sl.id"
                  type="button"
                  :class="{ active: portalSlice === sl.id }"
                  @click="portalSlice = sl.id"
                >
                  {{ sl.label }}
                </button>
              </div>
              <div class="p3d-mode-seg" role="group" aria-label="切换三维与平面视图">
                <button type="button" :class="{ active: portalMapMode === 'city3d' }" @click="portalMapMode = 'city3d'">
                  <Box :size="12" /> 三维建模
                </button>
                <button type="button" :class="{ active: portalMapMode === 'gov' }" @click="portalMapMode = 'gov'">
                  <MapIcon :size="12" /> 政务沙盘
                </button>
              </div>
            </div>
          </div>

          <div class="p3d-canvas-wrap">
            <ChangheCity3D
              v-if="portalMapMode === 'city3d'"
              mode="portal"
              :dark="false"
              :compact="true"
              :selected-community="scope"
              :slice="portalSlice"
              :events="totals.events"
              @select-community="togglePortalComm"
              @select-event="openEvent"
              @webgl-fallback="portalMapMode = 'gov'"
            />
            <GeoMap
              v-else
              mode="hub"
              base-mode="gov"
              :dark="false"
              :show-base-switch="false"
              :selected-community="scope"
              :slice="portalSlice"
              :events="totals.events"
              @select-community="togglePortalComm"
              @select-event="openEvent"
            />
          </div>
        </div>

        <aside class="panel p3d-side-panel">
          <div class="panel-head">
            <h2>{{ activeCommDetail ? `${activeCommDetail.name} · 实时画像` : '辖区核心实数与急办直达' }}</h2>
            <button
              v-if="activeCommDetail && role.scope === '全街道'"
              type="button"
              class="btn sm ghost"
              @click="store.selectedCommunity = '全街道'"
            >
              返回全街道
            </button>
            <button v-else type="button" class="btn sm ghost" @click="router.push('/cockpit')">全屏驾驶舱 ›</button>
          </div>
          <div class="panel-body p3d-side-body">
            <div class="p3d-kpi-4">
              <div class="p3d-kpi">
                <span>常住人口</span>
                <strong class="num">{{ totals.pop.toLocaleString() }}<small>人</small></strong>
              </div>
              <div class="p3d-kpi">
                <span>实有房屋</span>
                <strong class="num">{{ totals.homes.toLocaleString() }}<small>户</small></strong>
              </div>
              <div class="p3d-kpi">
                <span>市场主体</span>
                <strong class="num">{{ totals.ent.toLocaleString() }}<small>家</small></strong>
              </div>
              <div class="p3d-kpi">
                <span>未销号隐患</span>
                <strong class="num" style="color: var(--bad)">{{ totals.hazardsOpen }}<small>处</small></strong>
              </div>
            </div>

            <div v-if="activeCommDetail" class="p3d-comm-meta">
              <div><span>包靠负责人</span><strong>{{ activeCommDetail.lead }} · {{ activeCommDetail.phone }}</strong></div>
              <div><span>规上企业产值</span><strong class="num">{{ activeCommDetail.biz.revenue }} 亿元（规上 {{ activeCommDetail.biz.large }} 家）</strong></div>
              <div><span>社区网格力量</span><strong class="num">{{ activeCommDetail.grids }} 网格 · {{ activeCommDetail.gridStaff }} 名网格员</strong></div>
            </div>

            <div class="p3d-sub-head">
              <span>急难愁盼在办事项（{{ totals.openEvents.length }} 件）</span>
              <button type="button" class="btn sm ghost" @click="router.push({ path: '/grid', query: { tab: 'triage' } })">全部 ›</button>
            </div>
            <div class="brief-list p3d-ev-list">
              <button
                v-for="ev in totals.openEvents.slice(0, 3)"
                :key="ev.id"
                type="button"
                class="brief-row clickable"
                :class="{ 'is-returned': ev.stage === '待补充' }"
                @click="openEvent(ev)"
              >
                <div class="br-top">
                  <strong :title="ev.title">{{ ev.title }}</strong>
                  <span class="tag" :class="ev.stage === '待受理' || ev.stage === '待补充' ? 'st-bad' : 'st-warn'">{{ ev.stage }}</span>
                </div>
                <small>{{ ev.community }} · {{ ev.category }} · {{ ev.createdAt }}</small>
              </button>
            </div>
          </div>
        </aside>
      </section>

      <section class="portal-cards">
        <button
          v-for="m in moduleCards"
          :key="m.path"
          type="button"
          class="portal-card"
          @click="router.push(m.path)"
        >
          <div class="pc-head">
            <span class="pc-ico" :style="{ '--ico-color': m.colorVar }">
              <component :is="m.icon" :size="18" />
            </span>
            <strong class="pc-title">{{ m.title }}</strong>
            <span class="pc-metric num">{{ m.metric }}</span>
          </div>
          <p class="pc-desc">{{ m.desc }}</p>
        </button>
      </section>

      <div class="grid-2">
        <section class="panel">
          <div class="panel-head">
            <h2>{{ visibleComms.length }} 社区治理态势快览</h2>
            <button type="button" class="btn sm ghost" @click="router.push('/data-hub')">进入数据中枢 ›</button>
          </div>
          <div class="table-wrapper" tabindex="0" role="region" aria-label="社区运行速览">
            <table class="data-table">
              <thead>
                <tr>
                  <th scope="col">社区名称</th>
                  <th scope="col" class="num">常住人口</th>
                  <th scope="col" class="num">市场主体</th>
                  <th scope="col" class="num">未销号隐患</th>
                  <th scope="col">运行态势</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in visibleComms" :key="c.id">
                  <th scope="row">{{ c.name }}</th>
                  <td class="num">{{ c.pop.toLocaleString() }} <span class="u">人</span></td>
                  <td class="num">{{ (c.biz.large + c.biz.small + c.biz.self).toLocaleString() }} <span class="u">家</span></td>
                  <td class="num">{{ c.safety.hazards - c.safety.fixed }} <span class="u">处</span></td>
                  <td>
                    <span class="tag" :class="c.health === 'ok' ? 'st-ok' : c.health === 'warn' ? 'st-warn' : 'st-bad'">
                      {{ c.health === 'ok' ? '平稳受控' : c.health === 'warn' ? '重点关注' : '督办预警' }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>急难愁盼待办与警网通报</h2>
            <button type="button" class="btn sm ghost" @click="router.push({ path: '/grid', query: { tab: 'triage' } })">全部事件 ›</button>
          </div>
          <div class="panel-body brief-list">
            <button
              v-for="ev in totals.openEvents.slice(0, 4)"
              :key="ev.id"
              type="button"
              class="brief-row clickable"
              :class="{ 'is-returned': ev.stage === '待补充' }"
              @click="openEvent(ev)"
            >
              <div class="br-top">
                <strong :title="ev.title">{{ ev.title }}</strong>
                <span class="tag" :class="ev.stage === '待受理' || ev.stage === '待补充' ? 'st-bad' : 'st-warn'">{{ ev.stage }}</span>
              </div>
              <small>{{ ev.community }} · {{ ev.category }} · {{ ev.createdAt }}</small>
            </button>
            <div v-for="pa in store.policeAlerts.slice(0, 2)" :key="pa.id" class="brief-row alert-row">
              <div class="br-top">
                <strong>【警情通报·{{ pa.type }}】{{ pa.community }}</strong>
                <span class="tag st-ok">{{ pa.status }}</span>
              </div>
              <small>{{ pa.summary }}</small>
            </div>
          </div>
        </section>
      </div>
    </template>

    <!-- 场景二：社区管理员 / 专职网格员视图 —— 今日待办直达作业区 -->
    <template v-else>
      <section class="staff-banner">
        <div>
          <div class="sb-title">{{ role.userName }}（{{ role.dept }}）· 今日高频待办直达</div>
          <div class="sb-sub">当前作业辖区：{{ scope }} · 已同步最新事件与采集任务</div>
        </div>
        <div class="sb-kpis">
          <div class="sb-kpi">
            <strong class="num" style="color: var(--bad)">{{ totals.returnedEvents.length }}</strong>
            <span>退回待补充</span>
          </div>
          <div class="sb-kpi">
            <strong class="num" style="color: var(--warn)">{{ totals.openEvents.length }}</strong>
            <span>本社区在办</span>
          </div>
          <div class="sb-kpi">
            <strong class="num" style="color: var(--ok)">{{ myTasks.length }}</strong>
            <span>宽表待填</span>
          </div>
        </div>
      </section>

      <div class="grid-2">
        <section class="panel">
          <div class="panel-head">
            <h2><AlertTriangle :size="15" style="color: var(--bad)" /> 我的待办与退回补充事项</h2>
            <button type="button" class="btn sm primary" @click="router.push('/mobile')">掌上快报 ›</button>
          </div>
          <div class="panel-body brief-list">
            <div
              v-for="ev in totals.openEvents"
              :key="ev.id"
              class="brief-row"
              :class="{ 'is-returned': ev.stage === '待补充' }"
            >
              <div class="br-top">
                <strong>{{ ev.title }}</strong>
                <span class="tag" :class="ev.stage === '待补充' ? 'st-bad' : 'st-warn'">{{ ev.stage }}</span>
              </div>
              <small v-if="ev.returnReason" style="color: var(--bad)">退回意见：{{ ev.returnReason }}</small>
              <small v-else>{{ ev.community }} · {{ ev.grid }} · 责任方：{{ ev.owner }}</small>
              <div style="margin-top: 8px; display: flex; justify-content: flex-end">
                <button type="button" class="btn sm primary" @click="openEvent(ev)">立即进入办理</button>
              </div>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2><Bell :size="15" style="color: var(--primary)" /> 我的数据直达采集任务</h2>
            <button type="button" class="btn sm" @click="router.push('/data-direct')">三态填报台 ›</button>
          </div>
          <div class="panel-body brief-list">
            <div v-for="tk in myTasks" :key="tk.id" class="brief-row">
              <div class="br-top">
                <strong>{{ tk.name }}</strong>
                <span class="tag st-run">{{ tk.dept }}</span>
              </div>
              <small>截止时间：{{ tk.deadline }} · 已完成 {{ tk.doneCount }}/{{ tk.totalTarget }} 份</small>
              <div class="progress-track" style="margin: 8px 0">
                <div class="progress-fill ok" :style="{ width: Math.round((tk.doneCount / tk.totalTarget) * 100) + '%' }"></div>
              </div>
              <div style="display: flex; justify-content: flex-end">
                <button type="button" class="btn sm" @click="router.push({ path: '/data-direct', query: { tab: 'fill' } })">前往在线填报</button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section class="portal-cards">
        <button
          v-for="m in moduleCards"
          :key="m.path"
          type="button"
          class="portal-card"
          @click="router.push(m.path)"
        >
          <div class="pc-head">
            <span class="pc-ico" :style="{ '--ico-color': m.colorVar }">
              <component :is="m.icon" :size="18" />
            </span>
            <strong class="pc-title">{{ m.title }}</strong>
            <span class="pc-metric num">{{ m.metric }}</span>
          </div>
          <p class="pc-desc">{{ m.desc }}</p>
        </button>
      </section>
    </template>
  </AppShell>
</template>

<style scoped>
.morning-brief {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 22px;
  border-radius: var(--r-card);
  background: var(--cta-bg);
  color: var(--cta-ink);
  box-shadow: var(--e-dark);
}

.mb-kicker {
  font-size: 12px;
  color: var(--cta-sub);
  font-weight: 600;
  margin-bottom: 5px;
}

.mb-summary {
  margin: 0;
  font-size: 14px;
  line-height: 1.65;
}

.mb-summary strong {
  color: var(--accent-dot, var(--dot-ok));
  font-size: 16.5px;
  margin: 0 2px;
}

.mb-cta {
  height: 38px;
  padding: 0 18px;
  flex-shrink: 0;
}

/* 门户 3D 数字孪生沙盘视觉核心区 */
.portal-3d-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.68fr) minmax(320px, 1fr);
  gap: 14px;
  align-items: stretch;
}

@media (max-width: 1180px) {
  .portal-3d-hero {
    grid-template-columns: 1fr;
  }
}

.p3d-stage-card {
  display: flex;
  flex-direction: column;
  border-radius: var(--r-card);
  overflow: hidden;
  border: 1px solid rgba(232, 204, 154, 0.24);
  background: #0d0b11;
  box-shadow: var(--e2);
  min-height: 430px;
}

.p3d-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: linear-gradient(90deg, rgba(24, 18, 22, 0.96), rgba(16, 20, 30, 0.96));
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.p3d-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #f6f1e8;
  font-size: 13.5px;
}

.p3d-ico {
  color: #f0c97a;
}

.p3d-scope {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(240, 201, 122, 0.16);
  border: 1px solid rgba(240, 201, 122, 0.34);
  color: #f5d693;
  font-size: 11px;
  font-weight: 650;
}

.p3d-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.p3d-slice-seg,
.p3d-mode-seg {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.p3d-slice-seg button,
.p3d-mode-seg button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: rgba(235, 228, 218, 0.72);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.p3d-slice-seg button:hover,
.p3d-mode-seg button:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.1);
}

.p3d-slice-seg button.active,
.p3d-mode-seg button.active {
  background: var(--primary, #b81c28);
  color: #ffffff;
}

.p3d-canvas-wrap {
  flex: 1;
  min-height: 378px;
  position: relative;
}

.p3d-side-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.p3d-side-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.p3d-kpi-4 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.p3d-kpi {
  padding: 10px 12px;
  border-radius: var(--r-control);
  border: 1px solid var(--line);
  background: var(--sunken);
}

.p3d-kpi span {
  display: block;
  font-size: 11.5px;
  color: var(--ink-soft);
}

.p3d-kpi strong {
  display: block;
  margin-top: 3px;
  font-size: 20px;
  line-height: 1.15;
  color: var(--ink);
}

.p3d-kpi strong small {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--ink-muted);
  margin-left: 2px;
}

.p3d-comm-meta {
  display: grid;
  gap: 6px;
  padding: 9px 11px;
  border-radius: var(--r-control);
  border: 1px solid var(--primary-soft);
  background: var(--primary-soft);
  font-size: 12px;
}

.p3d-comm-meta > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.p3d-comm-meta span {
  color: var(--ink-soft);
}

.p3d-comm-meta strong {
  color: var(--ink);
  font-weight: 650;
}

.p3d-sub-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
  padding-top: 4px;
  border-top: 1px solid var(--line);
}

.p3d-ev-list {
  gap: 8px;
}

/* 4×2 满格对称卡片矩阵 */
.portal-cards {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 1240px) {
  .portal-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.portal-card {
  text-align: left;
  padding: 14px 16px;
  border-radius: var(--r-card);
  border: var(--hair) solid var(--line-strong);
  background: var(--surface-grad);
  box-shadow: var(--e1), var(--edge-strong);
  cursor: pointer;
  transition: transform var(--d-hover) var(--ease-premium), border-color var(--d-fade) ease, box-shadow var(--d-fade) ease;
}

.portal-card:hover {
  transform: translateY(-2px);
  border-color: var(--primary);
  box-shadow: var(--e2), var(--edge-strong);
}

.pc-head {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 8px;
}

.pc-ico {
  width: 32px;
  height: 32px;
  border-radius: var(--r-control);
  color: var(--ico-color);
  background: color-mix(in srgb, var(--ico-color) 11%, transparent);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.pc-title {
  font-size: 14px;
  font-weight: 650;
  color: var(--ink);
  white-space: nowrap;
}

.pc-metric {
  margin-left: auto;
  font-size: 11.5px;
  font-weight: 650;
  color: var(--brand-text);
  background: var(--primary-soft);
  padding: 2px 7px;
  border-radius: var(--r-tag);
  white-space: nowrap;
}

.pc-desc {
  margin: 0;
  font-size: 12.5px;
  color: var(--ink-soft);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.u {
  font-size: 11.5px;
  color: var(--ink-soft);
  font-weight: 400;
}

.brief-list {
  display: grid;
  gap: 10px;
}

.brief-row {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  overflow: hidden;
  text-align: left;
  padding: 10px 12px;
  border-radius: var(--r-control);
  border: 1px solid var(--line);
  background: var(--sunken);
  transition: border-color 0.14s ease, background-color 0.14s ease;
}

.brief-row.clickable {
  cursor: pointer;
}

.brief-row.clickable:hover {
  border-color: var(--primary);
  background: var(--surface);
}

.brief-row.is-returned {
  background: var(--status-bad-soft);
  border-color: rgba(191, 50, 24, 0.28);
}

.brief-row.alert-row {
  background: var(--status-run-soft);
  border-color: rgba(21, 91, 132, 0.18);
  cursor: default;
}

.br-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  margin-bottom: 4px;
}

.br-top strong {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.br-top .tag {
  flex-shrink: 0;
}

.brief-row small {
  display: block;
  font-size: 12px;
  color: var(--ink-muted);
}

.staff-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border-radius: var(--r-card);
  background: var(--surface);
  border: 1px solid var(--line-strong);
}

.sb-title {
  font-size: 15.5px;
  font-weight: 700;
  color: var(--ink);
}

.sb-sub {
  font-size: 12.5px;
  color: var(--ink-soft);
  margin-top: 3px;
}

.sb-kpis {
  display: flex;
  gap: 18px;
}

.sb-kpi {
  text-align: center;
  min-width: 74px;
}

.sb-kpi strong {
  display: block;
  font-size: 22px;
  line-height: 1.2;
}

.sb-kpi span {
  font-size: 11.5px;
  color: var(--ink-soft);
}
</style>
