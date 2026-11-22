<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  Camera, MapPin, ShieldAlert, CheckCircle2, Bell, Navigation, ClipboardCheck, Send
} from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import AppSelect from '../components/AppSelect.vue'
import EvidencePhoto from '../components/EvidencePhoto.vue'
import {
  store, COMMUNITIES, EVENT_CATEGORIES, getCurrentRole, getEffectiveCommunity,
  addAuditLog, showToast, nowStr
} from '../store/appStore'
import { buildScenePhoto } from '../utils/sampleImages'

const router = useRouter()
const role = computed(() => getCurrentRole())
const scope = computed(() => getEffectiveCommunity())

const mTab = ref('todo') // todo | report | verify | patrol
const checkedIn = ref(true)
const sensitiveAlertOpen = ref(false)

// 15 秒现场直报表单（R45）
const reportForm = ref({
  category: '安全生产',
  title: '',
  community: '德馨社区',
  address: '德馨社区 · 锦绣家园 3 号楼 2 单元门口（定位自动反推）',
  description: '现场巡查发现消防通道堆放杂物，已拍照留痕并初步劝导。',
  photoAttached: true
})

// 走访核验记录（R46）
const visitChange = ref('居住状态无变化')
const visitNote = ref('入户探访独居长者王秀兰，身体状况良好，燃气烟感正常在线。')

// 退回工单补报（R47）
const supplementNote = ref('已补核涉及业主联系方式并联动小区物业上门送达整改告知书。')

const myReturnedEvents = computed(() =>
  store.events.filter((e) => e.stage === '待补充' && (scope.value === '全街道' || e.community === scope.value))
)
const myActiveEvents = computed(() =>
  store.events.filter((e) => e.stage !== '已办结' && (scope.value === '全街道' || e.community === scope.value))
)
const currentPatrol = computed(() =>
  store.patrolRecords.find((p) => p.staff === role.value.userName) ||
  store.patrolRecords.find((p) => scope.value === '全街道' || p.community === scope.value) ||
  store.patrolRecords[0]
)
const myPendingSupervise = computed(() =>
  store.patrolRecords.find(
    (p) =>
      p.superviseStatus === '已发督办' &&
      (role.value.scope === '全街道' || p.staff === role.value.userName || p.community === scope.value)
  )
)

const matchedRuleTip = computed(() =>
  store.eventRules.find((r) => r.category === reportForm.value.category) || store.eventRules[0]
)

function submitMobileReport() {
  const title = reportForm.value.title.trim() || `${reportForm.value.community}${reportForm.value.category}现场排查隐患`
  const targetComm = COMMUNITIES.find((c) => c.name === reportForm.value.community) || COMMUNITIES[0]
  const newEv = {
    id: 'ev-m-' + Date.now(),
    title,
    category: reportForm.value.category,
    subType: matchedRuleTip.value.subType,
    community: targetComm.name,
    grid: '第一网格',
    address: reportForm.value.address,
    lat: +(targetComm.center[0] + (Math.random() - 0.5) * 0.002).toFixed(5),
    lng: +(targetComm.center[1] + (Math.random() - 0.5) * 0.002).toFixed(5),
    reporter: role.value.userName,
    owner: '待分派',
    stage: '待受理',
    urgency: '紧急',
    deadlineHours: matchedRuleTip.value.deadlineHours,
    elapsedHours: 0.1,
    createdAt: nowStr(),
    description: reportForm.value.description,
    beforePhoto: buildScenePhoto({ scene: 'before', title, location: reportForm.value.address, time: nowStr(), person: `掌上网格 ${role.value.userName}` }),
    afterPhoto: '',
    returnReason: '',
    reminded: false,
    history: [
      { node: '掌上网格 15 秒现场直报', operator: `${role.value.userName}（政务微信端）`, detail: `已自动定位所属网格并附水印现场照，建议派单：${matchedRuleTip.value.dispatchOwner}`, time: nowStr() }
    ]
  }
  store.events.unshift(newEv)
  addAuditLog(`掌上网格直报「${title}」，已同步推送街道事件研判中心与驾驶舱`, '端云同步')
  showToast('现场直报成功！右侧云端回执台、事件办理中心与驾驶舱已毫秒级同步')
  reportForm.value.title = ''
  mTab.value = 'todo'
}

function submitSupplement(ev) {
  ev.stage = '待受理'
  ev.returnReason = ''
  ev.history.push({
    node: '掌上网格补充材料回传',
    operator: `${role.value.userName}（政务微信端）`,
    detail: supplementNote.value,
    time: nowStr()
  })
  addAuditLog(`掌上网格补报退回工单「${ev.title}」`, '重入受理')
  showToast('补充材料与现场照已回传社区综治端')
}

function submitVisitLog() {
  const room = store.buildingProfiles.residential.rooms['一单元-301']
  if (room) {
    room.lastVerify = nowStr().slice(0, 10)
    if (visitChange.value === '房屋转为空置') {
      room.status = '空置'
      room.peopleCount = 0
    } else if (visitChange.value === '新迁入流动租户') {
      room.status = '出租'
      room.peopleCount = Math.max(room.peopleCount || 0, 2)
    }
    room.careLogs.unshift({
      time: nowStr(),
      operator: `${role.value.userName}（掌上网格）`,
      action: `入户走访核验：${visitChange.value}`,
      reason: visitNote.value
    })
  }
  addAuditLog(`掌上网格登记锦绣家园 3 号楼 301 室入户走访核验记录`, '台账同步')
  showToast('入户走访与房态变更已同步至楼栋一户一档')
}

function triggerSensitiveIntercept() {
  sensitiveAlertOpen.value = true
  addAuditLog('移动端尝试查阅居民完整身份证号及高敏档案，触发安全边界拦截引导至授权电脑端', '合规拦截')
}

function doPatrolCheckin() {
  checkedIn.value = true
  const pt = currentPatrol.value
  if (pt) {
    pt.km = +(pt.km + 0.4).toFixed(1)
    pt.signInTime = nowStr().slice(11)
  }
  addAuditLog(`${pt?.staff || role.value.userName} 通过掌上网格执行北斗定位巡查签到与必到点打卡`, '轨迹同步')
  showToast('定位签到成功，轨迹点已回传巡查监管台')
}

function replyPatrolSupervise(pt) {
  pt.superviseStatus = '已回传待认'
  pt.staffReply = '现场协助处理楼道漏水邻里协商，已附现场调解照片回传。'
  addAuditLog(`网格员 ${pt.staff} 通过掌上端回传停留异常核查说明与现场照`, '督办回传')
  showToast('核查说明与现场照片已回传街道巡查督办台')
}
</script>

<template>
  <AppShell title="掌上网格协同" subtitle="政务微信现场作业端与街道指挥中枢实时回执">
    <div class="mobile-showcase">
      <!-- 左侧：完整沿用原版 44px 圆角掌上网格真机外壳（R44-R48） -->
      <section class="staff-device" aria-label="掌上网格政务微信端">
        <div class="staff-header">
          <div>
            <h2>掌上网格</h2>
            <small>{{ role.userName }} · {{ scope }}第一网格 · {{ checkedIn ? '巡查在岗' : '未签到' }}</small>
          </div>
          <span class="tag st-ok">已接入</span>
        </div>

        <div class="location-line">
          <span>北斗定位已同步 · 锦绣家园 3 号楼周边（精度 ±6米）</span>
        </div>

        <div class="staff-body">
          <!-- Tab 1: 待办与退回红条置顶（R44/R47） -->
          <template v-if="mTab === 'todo'">
            <div v-for="ev in myReturnedEvents" :key="ev.id" class="m-return-bar">
              <div class="mrb-head"><strong>【退回补充】{{ ev.title }}</strong></div>
              <small>退回意见：{{ ev.returnReason }}</small>
              <textarea v-model="supplementNote" class="field-textarea" rows="2" style="margin: 6px 0"></textarea>
              <button type="button" class="btn sm bad-soft" style="width: 100%" @click="submitSupplement(ev)">
                一键补传材料与清晰现场照
              </button>
            </div>

            <div class="m-sec-title">我的待处置与上报进度（{{ myActiveEvents.length }} 件）</div>
            <div v-for="ev in myActiveEvents.slice(0, 4)" :key="ev.id" class="m-card">
              <div class="mc-top">
                <span class="tag st-warn">{{ ev.stage }}</span>
                <span class="num" style="font-size: 11px; color: var(--ink-soft)">{{ ev.createdAt.slice(5) }}</span>
              </div>
              <strong>{{ ev.title }}</strong>
              <small>{{ ev.community }} · 责任方：{{ ev.owner }}</small>
            </div>
          </template>

          <!-- Tab 2: 15秒极简现场直报（R45） -->
          <form v-else-if="mTab === 'report'" class="m-form" @submit.prevent="submitMobileReport">
            <div class="m-sec-title">第一步：九宫格选四大事件条线</div>
            <div class="cat-4grid">
              <button
                v-for="cat in EVENT_CATEGORIES"
                :key="cat"
                type="button"
                class="cat-btn"
                :class="{ active: reportForm.category === cat }"
                @click="reportForm.category = cat"
              >
                {{ cat }}
              </button>
            </div>
            <div class="m-auto-tip">
              预计自动派单：<strong>{{ matchedRuleTip.dispatchOwner }}</strong>（时限 {{ matchedRuleTip.deadlineHours }} 小时）
            </div>

            <div class="form-field">
              <label>所属社区</label>
              <AppSelect v-model="reportForm.community" :options="COMMUNITIES.map((c) => c.name)" />
            </div>
            <div class="form-field">
              <label>现场问题简述</label>
              <input v-model="reportForm.title" class="field-input" placeholder="如：锦绣家园 2 号楼单元门前飞线充电" />
            </div>
            <div class="m-photo-preview">
              <div class="m-photo-head">
                <Camera :size="14" />
                <span>现场水印照已就绪（自动压印位置与时间）</span>
              </div>
              <EvidencePhoto
                :src="buildScenePhoto({ scene: 'before', title: reportForm.title || reportForm.category })"
                :title="reportForm.title || '现场排查隐患照'"
                tone="before"
                :location="reportForm.address"
                :time="nowStr()"
                :person="`掌上网格 ${role.userName}`"
                :compact="true"
              />
            </div>
            <button type="submit" class="btn primary" style="width: 100%">
              <Send :size="14" /> 立即提交并同步街道指挥中枢
            </button>
          </form>

          <!-- Tab 3: 入户走访与敏感信息合规边界拦截（R46） -->
          <div v-else-if="mTab === 'verify'" class="m-form">
            <div class="m-card">
              <div class="mc-top"><strong>锦绣家园 3 号楼 301 室 · 王秀兰</strong><span class="tag st-warn">独居高龄</span></div>
              <small>基础信息已由共享库自动预填免填，入户仅勾选变化项</small>
            </div>
            <div class="form-field">
              <label>本次核验变化情况</label>
              <AppSelect
                v-model="visitChange"
                :options="['居住状态无变化', '新迁入流动租户', '沿街商铺更换经营者', '房屋转为空置']"
              />
            </div>
            <div class="form-field">
              <label>巡查走访记录</label>
              <textarea v-model="visitNote" class="field-textarea" rows="2"></textarea>
            </div>
            <button type="button" class="btn ok" style="width: 100%" @click="submitVisitLog">
              <ClipboardCheck :size="14" /> 提交入户走访核验
            </button>

            <button type="button" class="btn bad-soft sm" style="width: 100%; margin-top: 4px" @click="triggerSensitiveIntercept">
              <ShieldAlert :size="14" /> 尝试查看/修改居民完整身份证与高敏档案
            </button>

            <div v-if="sensitiveAlertOpen" class="m-return-bar">
              <strong>政务数据安全边界拦截：</strong>
              <small>该项涉及居民高敏个人隐私，依据长河街道分级授权规范，移动端仅展示脱敏摘要，请前往社区综治中心授权电脑端办理。</small>
            </div>
          </div>

          <!-- Tab 4: 巡查签到与轨迹督办回复 -->
          <div v-else class="m-form">
            <div class="m-card" style="text-align: center; padding: 16px">
              <button type="button" class="checkin-circle" @click="doPatrolCheckin">
                <Navigation :size="22" />
                <strong>巡查打卡</strong>
                <small>实时上报轨迹</small>
              </button>
              <div style="margin-top: 10px; font-size: 12px; color: var(--ink-muted)">
                今日里程 <b class="num">{{ currentPatrol?.km ?? 0 }} 公里</b> · 必到点 <b class="num">{{ currentPatrol?.checkpoints || '8/8' }}</b>
              </div>
            </div>

            <div v-if="myPendingSupervise" class="m-return-bar">
              <strong><Bell :size="13" /> 收到街道停留超时核查督办单</strong>
              <small>{{ myPendingSupervise.superviseNote }}</small>
              <button type="button" class="btn sm primary" style="width: 100%; margin-top: 6px" @click="replyPatrolSupervise(myPendingSupervise)">
                上传现场调解照并回传核查说明
              </button>
            </div>
          </div>
        </div>

        <nav class="staff-bottom-nav" aria-label="移动端导航">
          <button type="button" :class="{ active: mTab === 'todo' }" @click="mTab = 'todo'">待办 ({{ myActiveEvents.length }})</button>
          <button type="button" :class="{ active: mTab === 'report' }" @click="mTab = 'report'">快报</button>
          <button type="button" :class="{ active: mTab === 'verify' }" @click="mTab = 'verify'">走访核验</button>
          <button type="button" :class="{ active: mTab === 'patrol' }" @click="mTab = 'patrol'">巡查签到</button>
        </nav>
      </section>

      <!-- 右侧：端云同屏实时回执监控台 -->
      <div style="display: flex; flex-direction: column; gap: 14px">
        <section class="panel">
          <div class="panel-head">
            <h2>街道指挥中枢 · 端云实时同步监控台</h2>
            <span class="tag st-ok">政务移动接入区实时在线</span>
          </div>
          <div class="panel-body">
            <p style="margin: 0 0 12px; color: var(--ink-muted); font-size: 13px">
              在左侧掌上网格发起任意 15 秒现场直报、补传退回材料、登记入户走访或巡查打卡，右侧街道后台、事件研判台与综合治理驾驶舱将实时落库刷新。
            </p>
            <div style="display: flex; gap: 8px; flex-wrap: wrap">
              <button type="button" class="btn sm primary" @click="router.push('/grid')">前往事件办理中心验收 ›</button>
              <button type="button" class="btn sm" @click="router.push('/cockpit')">前往驾驶舱大屏查看 ›</button>
              <button type="button" class="btn sm" @click="router.push('/xinchuang')">查看安全审计留痕 ›</button>
            </div>
          </div>
        </section>

        <section class="panel" style="flex: 1; display: flex; flex-direction: column">
          <div class="panel-head">
            <h2>实时端云双向作业回执流水</h2>
            <span class="num">{{ store.xinchuang.auditLogs.length }} 条</span>
          </div>
          <div class="table-wrapper" tabindex="0" role="region" aria-label="端云实时同步日志">
            <table class="data-table">
              <thead>
                <tr>
                  <th scope="col">同步时间</th>
                  <th scope="col">经办人</th>
                  <th scope="col">端云同步动态</th>
                  <th scope="col">结果</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(lg, idx) in store.xinchuang.auditLogs.slice(0, 10)" :key="idx">
                  <th scope="row" class="num">{{ lg.time.slice(5) }}</th>
                  <td>{{ lg.operator }}</td>
                  <td>{{ lg.action }}</td>
                  <td><span class="tag" :class="lg.result.includes('拦截') ? 'st-bad' : 'st-ok'">{{ lg.result }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  </AppShell>
</template>

<style scoped>
.mobile-2col {
  display: grid;
  grid-template-columns: 380px minmax(0, 1fr);
  gap: 18px;
  align-items: stretch;
}

@media (max-width: 1024px) {
  .mobile-2col { grid-template-columns: 1fr; }
}

.phone-frame {
  border: 6px solid #1e293b;
  border-radius: 26px;
  background: var(--canvas);
  overflow: hidden;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  height: 640px;
}

.pf-top {
  background: var(--brand);
  color: #ffffff;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pf-top strong { display: block; font-size: 14px; }
.pf-top small { display: block; font-size: 11px; color: var(--cta-sub); margin-top: 2px; }

.pf-gps {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  background: var(--primary-soft);
  color: var(--brand-text);
  font-size: 11.5px;
  font-weight: 600;
  border-bottom: 1px solid var(--line);
}

.pf-body {
  flex: 1;
  overflow: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.m-return-bar {
  padding: 10px 12px;
  border-radius: var(--r-sm);
  background: var(--status-bad-soft);
  border: 1px solid var(--status-bad);
  color: var(--status-bad);
  font-size: 12px;
}

.m-return-bar small {
  display: block;
  margin-top: 3px;
  color: var(--status-bad);
}

.m-sec-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-muted);
}

.m-card {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--surface);
  border: 1px solid var(--line);
}

.mc-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.m-card strong { display: block; font-size: 13px; margin-bottom: 3px; }
.m-card small { font-size: 11.5px; color: var(--ink-soft); }

.m-form {
  display: grid;
  gap: 10px;
}

.cat-4grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.cat-btn {
  height: 36px;
  border-radius: 6px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  font-weight: 600;
  font-size: 13px;
}

.cat-btn.active {
  background: var(--brand-2);
  border-color: var(--brand-2);
  color: #ffffff;
}

.m-auto-tip {
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--brand-soft);
  color: var(--brand);
  font-size: 12px;
}

.m-photo-preview {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--line);
  background: var(--surface);
}

.m-photo-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--ok-soft);
  color: var(--ok);
  font-size: 11.5px;
  font-weight: 600;
  border-bottom: 1px solid var(--line);
}

.checkin-circle {
  width: 112px;
  height: 112px;
  border-radius: 50%;
  border: 4px solid #bbf7d0;
  background: var(--ok);
  color: #ffffff;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.checkin-circle strong { font-size: 14px; }
.checkin-circle small { font-size: 11px; opacity: 0.9; }

.pf-nav {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border-top: 1px solid var(--line);
  background: var(--surface);
}

.pf-nav button {
  height: 44px;
  border: none;
  background: transparent;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-muted);
}

.pf-nav button.active {
  color: var(--brand-2);
  background: var(--brand-soft);
}

@media (max-width: 640px) {
  .phone-frame {
    width: 100%;
    max-width: 100%;
    height: auto;
    min-height: 460px;
    border: var(--hair) solid var(--line-strong);
    border-radius: var(--r-card);
    box-shadow: var(--e1);
  }
  .pf-body {
    overflow: visible;
  }
  .pf-nav {
    position: sticky;
    bottom: 0;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
}
</style>
