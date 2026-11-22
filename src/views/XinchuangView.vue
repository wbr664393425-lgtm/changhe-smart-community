<script setup>
import { ref, computed } from 'vue'
import { Wifi, WifiOff, ShieldCheck, RefreshCw, Database, Eye, Lock } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import GeoMap from '../components/GeoMap.vue'
import ChangheCity3D from '../components/ChangheCity3D.vue'
import { store, ROLES, getCurrentRole, switchRole, addAuditLog, showToast, nowStr } from '../store/appStore'

const role = computed(() => getCurrentRole())
const xc = store.xinchuang
const xcMapView = ref('city3d') // city3d | flat

function toggleOfflineTest() {
  xc.offlineSimulated = !xc.offlineSimulated
  addAuditLog(
    xc.offlineSimulated ? '切换至政务内网纯离线模式，本地信创矢量底图无缝接管' : '恢复政务在线影像底图模式',
    '离线兜底正常'
  )
  showToast(xc.offlineSimulated ? '已切换至纯内网离线态，本地信创矢量底图已无缝接管' : '已恢复在线影像底图模式')
}

function toggleWatermark() {
  xc.watermarkEnabled = !xc.watermarkEnabled
  addAuditLog(`${xc.watermarkEnabled ? '开启' : '关闭'}全屏实名动态防拍水印`, '安全策略变更')
}

function runSyncReconcile() {
  const delta = Math.floor(Math.random() * 18) + 12
  xc.lastSyncTime = nowStr()
  xc.lastSyncCount += delta
  xc.syncChannels[0].todayCount += delta
  addAuditLog(`手动执行与天衢新区大数据局双向对账校验，新增无差错同步 ${delta} 条`, '零差错通过')
  showToast(`对账校验完成！新增同步 ${delta} 条增量数据，异常待复核 0 条`)
}
</script>

<template>
  <AppShell title="安全与信创保障中心" subtitle="外网断联矢量兜底 · 越权隔离加水印 · 独立达梦库与新区对账">
    <!-- 顶部全栈信创体检带（沿用原版 sit-card 珍珠卡） -->
    <div class="grid-4 xc-kpi-grid" style="margin-bottom: 0">
      <div class="sit-card">
        <span>街道独立信创数据库</span>
        <strong style="font-size: 20px">达梦主备集群</strong>
        <span class="tag st-ok">已替代原公网云库</span>
      </div>
      <div class="sit-card">
        <span>国产系统与浏览器适配</span>
        <strong style="font-size: 20px">银河麒麟·统信</strong>
        <span class="tag st-ok">全栈兼容通过</span>
      </div>
      <div class="sit-card">
        <span>无独立显卡云桌面适配</span>
        <strong style="font-size: 20px">轻量矢量引擎</strong>
        <span class="tag st-run">流畅零卡顿</span>
      </div>
      <div class="sit-card">
        <span>政务数据主权与同步</span>
        <strong style="font-size: 20px">新区双向互联</strong>
        <span class="tag st-ok">异常待复核 0 条</span>
      </div>
    </div>

    <!-- 信任锚点一 + 信任锚点三（双栏合理占比，零列裁切） -->
    <div class="grid-2" style="margin-bottom: 0">
      <section class="panel" style="display: flex; flex-direction: column">
        <div class="panel-head">
          <h2>政务内网离线底图应急切换</h2>
          <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap">
            <div class="ui-tabs" style="padding: 2px">
              <button type="button" :class="{ active: xcMapView === 'city3d' }" @click="xcMapView = 'city3d'">本地三维</button>
              <button type="button" :class="{ active: xcMapView === 'flat' }" @click="xcMapView = 'flat'">平面矢量</button>
            </div>
            <button
              type="button"
              class="btn sm"
              :class="xc.offlineSimulated ? 'bad-soft' : 'primary'"
              @click="toggleOfflineTest"
            >
              <component :is="xc.offlineSimulated ? Wifi : WifiOff" :size="14" />
              <span>{{ xc.offlineSimulated ? '恢复在线影像底图' : '切换纯内网离线底图' }}</span>
            </button>
          </div>
        </div>
        <div class="xc-map-box">
          <ChangheCity3D
            v-if="xcMapView === 'city3d'"
            mode="hub"
            :dark="false"
            :compact="true"
            :events="store.events"
            @webgl-fallback="xcMapView = 'flat'"
          />
          <GeoMap v-else mode="hub" :base-mode="xc.offlineSimulated ? 'gov' : 'aerial'" />
        </div>
        <div class="panel-body" style="border-top: var(--hair) solid var(--line); font-size: 12.5px; color: var(--ink-muted)">
          当前运行态：{{ xc.offlineSimulated ? '纯内网离线模式运行中，本地 4,205 栋三维白模与信创矢量底图零外网依赖无缝接管。' : '政务常态运行中，本地离线三维白模与在线影像均可一键切换，保障政务内网断联不中断。' }}
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2><Database :size="15" /> 存量数据回迁与信创库对账</h2>
          <span class="tag st-ok">原公网库已停写</span>
        </div>
        <div class="table-wrapper" tabindex="0" role="region" aria-label="存量数据迁移对账表">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">存量数据域</th>
                <th scope="col" class="num">原公网库</th>
                <th scope="col" class="num">清洗</th>
                <th scope="col" class="num">达梦入库</th>
                <th scope="col">结论</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in xc.migrationTables" :key="m.domain">
                <th scope="row">{{ m.domain }}</th>
                <td class="num">{{ m.oldCount.toLocaleString() }}</td>
                <td class="num">{{ m.cleaned }}</td>
                <td class="num"><strong>{{ m.newCount.toLocaleString() }}</strong></td>
                <td><span class="tag st-ok">{{ m.status }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <!-- 信任锚点二：通栏完整展示 4 角色权限矩阵（彻底杜绝右侧列裁切！） -->
    <section class="panel">
      <div class="panel-head">
        <h2>角色权限边界与实名防拍水印管控</h2>
        <div style="display: flex; gap: 6px; flex-wrap: wrap">
          <button
            v-for="r in ROLES"
            :key="r.id"
            type="button"
            class="btn sm"
            :class="{ primary: store.roleId === r.id }"
            @click="switchRole(r.id)"
          >
            切换：{{ r.name }}
          </button>
          <button type="button" class="btn sm" :class="{ 'ok-soft': xc.watermarkEnabled }" @click="toggleWatermark">
            <Eye :size="14" /> {{ xc.watermarkEnabled ? '防拍水印已开启' : '开启防拍水印' }}
          </button>
        </div>
      </div>
      <div class="table-wrapper" tabindex="0" role="region" aria-label="细粒度岗位权限矩阵">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">业务能力与敏感域</th>
              <th scope="col">街道管理员</th>
              <th scope="col">武装部部长</th>
              <th scope="col">社区管理员</th>
              <th scope="col">专职网格员·李敏</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">数字武装民兵花名册</th>
              <td><span class="tag st-ok">全街脱敏查阅</span></td>
              <td><span class="tag st-ok">全街维护导出</span></td>
              <td><span class="tag st-run">仅本社区</span></td>
              <td><span class="tag st-bad">菜单隐蔽拦截</span></td>
            </tr>
            <tr>
              <th scope="row">数据直达行级隔离</th>
              <td><span class="tag st-ok">授权全量+清理</span></td>
              <td><span class="tag st-neutral">不开放</span></td>
              <td><span class="tag st-run">本社区初审</span></td>
              <td><span class="tag st-wait">仅见本人填报</span></td>
            </tr>
            <tr>
              <th scope="row">网格事件派单与销号</th>
              <td><span class="tag st-ok">派单+最终销号</span></td>
              <td><span class="tag st-neutral">不开放</span></td>
              <td><span class="tag st-run">受理/退回/派单</span></td>
              <td><span class="tag st-wait">仅上报/补报</span></td>
            </tr>
            <tr>
              <th scope="row">信创底座与安全审计</th>
              <td><span class="tag st-ok">完全管控</span></td>
              <td><span class="tag st-run">只读核验</span></td>
              <td><span class="tag st-bad">隐藏无权限</span></td>
              <td><span class="tag st-bad">隐藏无权限</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 天衢新区大数据局双向同步实况 -->
    <section class="panel">
      <div class="panel-head">
        <h2><ShieldCheck :size="15" /> 天衢新区大数据局双向同步实况</h2>
        <button type="button" class="btn sm primary" @click="runSyncReconcile">
          <RefreshCw :size="13" /> 立即执行一次对账校验
        </button>
      </div>
      <div class="panel-body" style="padding-bottom: 8px; font-size: 12.5px; color: var(--brand-text)">
        最近同步：<strong>{{ xc.lastSyncTime }}</strong> · 本日累计无差错同步 <strong class="num">{{ xc.lastSyncCount }}</strong> 条 · 异常 0 条
      </div>
      <div class="table-wrapper" tabindex="0" role="region" aria-label="区大数据局同步通道">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">共享数据通道</th>
              <th scope="col">流向</th>
              <th scope="col">今日增量</th>
              <th scope="col">基层减负成效</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ch in xc.syncChannels" :key="ch.name">
              <th scope="row">{{ ch.name }}</th>
              <td>{{ ch.direction }}</td>
              <td class="num">{{ ch.todayCount }} 条</td>
              <td><span class="tag st-ok">{{ ch.exemptItems }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 关键操作不可篡改安全审计台账（R49） -->
    <section class="panel">
      <div class="panel-head">
        <h2><Lock :size="15" /> 全系统关键操作国密安全审计台账</h2>
        <span class="num">实时记录 {{ xc.auditLogs.length }} 条</span>
      </div>
      <div class="table-wrapper" tabindex="0" role="region" aria-label="安全审计日志">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">操作时间</th>
              <th scope="col">操作人与角色</th>
              <th scope="col">辖区范围</th>
              <th scope="col">操作事项明细</th>
              <th scope="col">审计结果</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(lg, idx) in xc.auditLogs" :key="idx">
              <th scope="row" class="num">{{ lg.time }}</th>
              <td>{{ lg.operator }}（{{ lg.role }}）</td>
              <td>{{ lg.scope }}</td>
              <td>{{ lg.action }}</td>
              <td><span class="tag" :class="lg.result.includes('拦截') ? 'st-bad' : 'st-ok'">{{ lg.result }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </AppShell>
</template>

<style scoped>
.xc-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.xc-card > span:first-child {
  font-size: 12px;
  color: var(--ink-soft);
}

.xc-card strong {
  font-size: 15px;
  color: var(--ink);
}

.xc-map-box {
  height: 330px;
  overflow: hidden;
  flex-shrink: 0;
}

:deep(.data-table th),
:deep(.data-table td) {
  padding: 8px 9px;
  font-size: 12.5px;
}

@media (max-width: 768px) {
  .xc-kpi-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .xc-kpi-grid .sit-card strong {
    font-size: 16px !important;
  }
  .xc-map-box {
    height: 260px;
  }
}
</style>
