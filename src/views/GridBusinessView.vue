<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import {
  Inbox, Map, Building, GitBranch, Navigation, BarChart3, Play, Pause,
  Square, RotateCcw, CheckCircle2, AlertTriangle, Download, Plus, Bell,
  Search, ShieldAlert, HeartHandshake, Store, Car, Layers
} from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import AppSelect from '../components/AppSelect.vue'
import GeoMap from '../components/GeoMap.vue'
import ChangheCity3D from '../components/ChangheCity3D.vue'
import EvidencePhoto from '../components/EvidencePhoto.vue'
import {
  store, COMMUNITIES, EVENT_CATEGORIES, getCurrentRole, getEffectiveCommunity,
  addAuditLog, showToast, nowStr
} from '../store/appStore'
import { maskValue } from '../utils/validators'
import { exportRealCsv } from '../utils/exportFile'
import { buildScenePhoto } from '../utils/sampleImages'

const route = useRoute()
const role = computed(() => getCurrentRole())
const scope = computed(() => getEffectiveCommunity())

const activeTab = ref(String(route.query.tab || 'triage')) // triage | onemap | building | rules | patrol | analysis
const evStatusFilter = ref('全部')
const evKeyword = ref('')
const selectedEvId = ref(String(route.query.eventId || store.events[0]?.id || ''))
const oneMapView = ref('city3d') // city3d | flat
const singleMapView = ref('city3d') // city3d | flat
const patrolMapView = ref('city3d') // city3d | flat

function toggleBoxSelect() {
  if (!boxActive.value) {
    oneMapView.value = 'flat'
    boxActive.value = true
  } else {
    boxActive.value = false
  }
}

watch(() => route.query.tab, (t) => {
  if (t) activeTab.value = String(t)
})
watch(() => route.query.eventId, (id) => {
  if (id) {
    activeTab.value = 'triage'
    evStatusFilter.value = '全部'
    evKeyword.value = ''
    selectedEvId.value = String(id)
  }
})

// ==================== 1. 事件办理中心 ====================
const returnReasonInput = ref('')
const showReturnBox = ref(false)
const actionNote = ref('已按权责清单核实现场坐标与责任归属，请限期整改并回传带水印验收照片。')

const visibleEvents = computed(() =>
  store.events.filter((e) => {
    if (scope.value !== '全街道' && e.community !== scope.value) return false
    if (evStatusFilter.value !== '全部' && e.stage !== evStatusFilter.value) return false
    if (evKeyword.value.trim() && !`${e.title}${e.community}${e.address}${e.owner}`.includes(evKeyword.value.trim())) return false
    return true
  })
)

const activeEv = computed(() => visibleEvents.value.find((e) => e.id === selectedEvId.value) || visibleEvents.value[0] || null)

const matchedRule = computed(() => {
  if (!activeEv.value) return null
  return store.eventRules.find((r) => r.subType === activeEv.value.subType || r.category === activeEv.value.category) || store.eventRules[0]
})

function doAcceptEvent(ev) {
  if (!role.value.canReturnEvent) {
    showToast('当前网格员岗位无受理审核权限')
    return
  }
  ev.stage = '待派单'
  ev.history.push({ node: '审核受理通过', operator: `${role.value.userName}（${role.value.name}）`, detail: '核验现场照片清晰、坐标准确，转入权责派单', time: nowStr() })
  addAuditLog(`受理审核事件「${ev.title}」`, '流转至待派单')
  showToast('已受理审核，系统已自动匹配权责处置单位')
}

function doReturnSupplement(ev) {
  if (!returnReasonInput.value.trim()) {
    showToast('请填写退回补充或退回重办原因')
    return
  }
  const isReviewReturn = ev.stage === '待复核'
  ev.stage = isReviewReturn ? '处置中' : '待补充'
  ev.returnReason = returnReasonInput.value.trim()
  ev.history.push({
    node: isReviewReturn ? '复核退回重办' : '受理退回补充',
    operator: `${role.value.userName}（${role.value.name}）`,
    detail: `退回意见：${ev.returnReason}`,
    time: nowStr()
  })
  addAuditLog(`退回事件「${ev.title}」：${ev.returnReason}`, isReviewReturn ? '退回重办' : '退回补充')
  showToast(isReviewReturn ? '已退回原处置单位重新整改' : '已退回补充，网格员掌上端顶部红条已即时同步')
  returnReasonInput.value = ''
  showReturnBox.value = false
}

function doAutoDispatch(ev) {
  if (!role.value.canDispatch) {
    showToast('当前岗位无派单权限')
    return
  }
  const targetOwner = matchedRule.value?.dispatchOwner || '街道应急管理办'
  ev.owner = targetOwner
  ev.deadlineHours = matchedRule.value?.deadlineHours || 24
  ev.stage = '处置中'
  ev.history.push({
    node: '按权责清单自动派单',
    operator: `${role.value.userName}（${role.value.name}）`,
    detail: `自动分拨至「${targetOwner}」，办结时限 ${ev.deadlineHours} 小时 · ${actionNote.value}`,
    time: nowStr()
  })
  addAuditLog(`按权责清单派单「${ev.title}」至 ${targetOwner}`, '已派单')
  showToast(`已一键派发至「${targetOwner}」`)
}

function doUploadRectifyPhoto(ev) {
  ev.afterPhoto = buildScenePhoto({
    scene: 'after',
    title: `${ev.title.slice(0, 12)} · 已整改验收`,
    location: ev.address,
    time: nowStr(),
    person: `${ev.owner} 经办人`
  })
  ev.stage = '待复核'
  ev.history.push({
    node: '处置完成回传凭证',
    operator: ev.owner || role.value.userName,
    detail: '已完成现场整改并回传带时间地点水印的整改后照片，提请街道复核销号',
    time: nowStr()
  })
  addAuditLog(`回传「${ev.title}」整改后水印验收照`, '待复核')
  showToast('已回传整改后水印照，请左右对比双图后复核销号')
}

function doCloseEvent(ev) {
  if (!role.value.canCloseEvent) {
    showToast('仅街道管理员具备最终复核销号权限')
    return
  }
  if (!ev.afterPhoto) {
    showToast('未上传整改后现场照片，禁止口头销号')
    return
  }
  ev.stage = '已办结'
  ev.history.push({
    node: '双图比对通过·销号归档',
    operator: `${role.value.userName}（街道管理员）`,
    detail: '整改前后水印照片核验一致，归档至长河街道独立达梦信创库',
    time: nowStr()
  })
  addAuditLog(`双图核验通过并销号归档事件「${ev.title}」`, '已办结')
  showToast('复核通过并归档办结')
}

// ==================== 2. 治理一张图框选即统计（R36） ====================
const boxActive = ref(false)
const boxedComms = ref([])
const mapCatFilter = ref('全部类别')

const mapFilteredEvents = computed(() =>
  store.events.filter((e) => {
    if (boxedComms.value.length && !boxedComms.value.includes(e.community)) return false
    if (!boxedComms.value.length && scope.value !== '全街道' && e.community !== scope.value) return false
    if (mapCatFilter.value !== '全部类别' && e.category !== mapCatFilter.value) return false
    return true
  })
)

const boxStats = computed(() => {
  const names = boxedComms.value.length ? boxedComms.value : (scope.value === '全街道' ? COMMUNITIES.map((c) => c.name) : [scope.value])
  const list = COMMUNITIES.filter((c) => names.includes(c.name))
  return {
    count: list.length,
    names,
    pop: list.reduce((a, c) => a + c.pop, 0),
    homes: list.reduce((a, c) => a + c.housing.homes, 0),
    ent: list.reduce((a, c) => a + c.biz.large + c.biz.small + c.biz.self, 0),
    grids: list.reduce((a, c) => a + c.grids, 0)
  }
})

// ==================== 3. 立体楼栋房态剖面图（R38 + R37） ====================
const gridTypeTab = ref('residential') // residential | commercial | district
const selectedRoomKey = ref('一单元-301')
const selectedTargetType = ref('room') // room | shop | basement
const selectedShopId = ref('shop-1')
const roomFilter = ref('全部') // 全部 | 自住 | 出租 | 空置 | 重点关怀 | 消防隐患
const zoneFilter = ref('全部') // 全部 | 高区 | 中区 | 低区
const roomKeyword = ref('')
const highlightedFloor = ref(null)
const bldgScrollRef = ref(null)
const newCareTag = ref('独居高龄')
const newCareReason = ref('')

const resProfile = computed(() => store.buildingProfiles.residential)
const activeRoom = computed(() => resProfile.value.rooms[selectedRoomKey.value])
const activeShop = computed(() => resProfile.value.shops.find((s) => s.id === selectedShopId.value) || resProfile.value.shops[0])

const resStats = computed(() => {
  const list = Object.values(resProfile.value.rooms || {})
  return {
    totalRooms: list.length,
    totalPeople: list.reduce((acc, r) => acc + (r.peopleCount || 0), 0),
    selfCount: list.filter((r) => r.status === '自住').length,
    rentCount: list.filter((r) => r.status === '出租').length,
    vacCount: list.filter((r) => r.status === '空置').length,
    careCount: list.filter((r) => r.careTags && r.careTags.length > 0).length,
    hazardCount: list.filter((r) => Boolean(r.hazard)).length
  }
})

function getFloorZone(fl) {
  if (fl >= 13) return '高区'
  if (fl >= 7) return '中区'
  return '低区'
}

function getFloorSummary(fl) {
  let hasHazard = false
  let hasCare = false
  for (const u of resProfile.value.units) {
    for (const rm of ['01', '02']) {
      const r = resProfile.value.rooms[`${u}-${fl}${rm}`]
      if (!r) continue
      if (r.hazard) hasHazard = true
      if (r.careTags && r.careTags.length) hasCare = true
    }
  }
  return { hasHazard, hasCare }
}

function isRoomMatched(room) {
  if (!room) return false
  if (roomFilter.value === '自住' && room.status !== '自住') return false
  if (roomFilter.value === '出租' && room.status !== '出租') return false
  if (roomFilter.value === '空置' && room.status !== '空置') return false
  if (roomFilter.value === '重点关怀' && !(room.careTags && room.careTags.length)) return false
  if (roomFilter.value === '消防隐患' && !room.hazard) return false
  const kw = roomKeyword.value.trim()
  if (kw && !`${room.room}${room.owner}${room.tenant || ''}${(room.careTags || []).join('')}${room.hazard || ''}`.includes(kw)) {
    return false
  }
  return true
}

const visibleResFloors = computed(() => {
  return resProfile.value.floors.filter((fl) => {
    if (zoneFilter.value === '高区' && fl < 13) return false
    if (zoneFilter.value === '中区' && (fl < 7 || fl > 12)) return false
    if (zoneFilter.value === '低区' && fl > 6) return false
    if (roomFilter.value !== '全部' || roomKeyword.value.trim()) {
      for (const u of resProfile.value.units) {
        for (const rm of ['01', '02']) {
          if (isRoomMatched(resProfile.value.rooms[`${u}-${fl}${rm}`])) return true
        }
      }
      return false
    }
    return true
  })
})

function selectRoom(key) {
  selectedRoomKey.value = key
  selectedTargetType.value = 'room'
}

function selectShop(shopId) {
  selectedShopId.value = shopId
  selectedTargetType.value = 'shop'
}

function selectBasement() {
  selectedTargetType.value = 'basement'
}

function scrollToFloor(fl) {
  if (zoneFilter.value !== '全部' && getFloorZone(fl) !== zoneFilter.value) {
    zoneFilter.value = '全部'
  }
  if (roomFilter.value !== '全部') {
    roomFilter.value = '全部'
  }
  highlightedFloor.value = fl
  requestAnimationFrame(() => {
    const container = bldgScrollRef.value
    if (!container) return
    const el = container.querySelector(`[data-floor="${fl}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })
  setTimeout(() => {
    if (highlightedFloor.value === fl) highlightedFloor.value = null
  }, 1500)
}

function updateRoomStatus(nextStatus) {
  if (!activeRoom.value || activeRoom.value.status === nextStatus) return
  const prev = activeRoom.value.status
  activeRoom.value.status = nextStatus
  if (nextStatus === '空置') {
    activeRoom.value.peopleCount = 0
    activeRoom.value.tenant = ''
  } else if (activeRoom.value.peopleCount === 0) {
    activeRoom.value.peopleCount = 2
  }
  activeRoom.value.lastVerify = nowStr().slice(0, 10)
  activeRoom.value.careLogs.unshift({
    time: nowStr(),
    operator: `${role.value.userName}（${role.value.name}）`,
    action: `房态变更：${prev} → ${nextStatus}`,
    reason: '网格员入户动态核验同步更新'
  })
  addAuditLog(`更新 ${resProfile.value.buildingName} ${selectedRoomKey.value} 房态为「${nextStatus}」`, '房态变更')
  showToast(`已将 ${selectedRoomKey.value} 房态更新为「${nextStatus}」`)
}

function dispatchShopRecheck(shop) {
  addAuditLog(`对 ${resProfile.value.buildingName} ${shop.door}（${shop.name}）下发九小场所复检任务`, '专项复检')
  showToast(`已向网格员 ${resProfile.value.gridStaff} 派发「${shop.name}」安全复检工单`)
}

// 商业楼宇选中态与筛选
const bizZoneFilter = ref('全部')
const selectedBizFloorNo = ref(store.buildingProfiles.commercial.floors[0]?.floor || '18层')
const visibleBizFloors = computed(() =>
  store.buildingProfiles.commercial.floors.filter((f) => bizZoneFilter.value === '全部' || f.zone.includes(bizZoneFilter.value))
)
const activeBizFloor = computed(
  () => store.buildingProfiles.commercial.floors.find((f) => f.floor === selectedBizFloorNo.value) || store.buildingProfiles.commercial.floors[0]
)

function dispatchBizNotice(fl) {
  addAuditLog(`向 ${store.buildingProfiles.commercial.buildingName} ${fl.floor} ${fl.company} 发送楼宇安全整改提示`, '楼宇督办')
  showToast(`已向「${fl.company}」发送安全复查通知`)
}

// 沿街商圈选中态
const selectedDistrictShop = ref(store.buildingProfiles.district.northShops[0])

function addCareTagToRoom() {
  if (!activeRoom.value) return
  if (!newCareReason.value.trim()) {
    showToast('维护关怀对象标签必须填写核实依据')
    return
  }
  if (!activeRoom.value.careTags.includes(newCareTag.value)) {
    activeRoom.value.careTags.push(newCareTag.value)
  }
  activeRoom.value.careLogs.unshift({
    time: nowStr(),
    operator: `${role.value.userName}（${role.value.name}）`,
    action: `新增「${newCareTag.value}」关怀标签`,
    reason: newCareReason.value.trim()
  })
  addAuditLog(`为 ${resProfile.value.buildingName} ${selectedRoomKey.value} 新增「${newCareTag.value}」标签`, '留痕更新')
  newCareReason.value = ''
  showToast('关怀标签及变更依据已写入不可篡改履历')
}

// ==================== 4. 权责清单规则试算（R39） ====================
const simCategory = ref('安全生产')
const simRuleMatch = computed(() => store.eventRules.find((r) => r.category === simCategory.value) || store.eventRules[0])

// ==================== 5. 巡查轨迹回放与防挂机督办（R42） ====================
const selectedPatrolId = ref('pt-2') // 默认聚焦有 42 分钟停留异常的张强
const patrolStep = ref(2)
const patrolPlaying = ref(false)
const superviseInput = ref('请说明 10:12–10:54 原地静止 42 分钟的具体原因，并回传现场工作照片。')
let patrolTimer = null

const activePatrol = computed(() => store.patrolRecords.find((p) => p.id === selectedPatrolId.value) || store.patrolRecords[0])
const isPatrolAnomaly = computed(() => activePatrol.value && activePatrol.value.stayMinutes > store.patrolThreshold)

function togglePatrolPlay() {
  if (patrolPlaying.value) {
    clearInterval(patrolTimer)
    patrolPlaying.value = false
    return
  }
  patrolPlaying.value = true
  patrolStep.value = 0
  patrolTimer = setInterval(() => {
    if (!activePatrol.value) return
    if (patrolStep.value >= activePatrol.value.track.length - 1) {
      clearInterval(patrolTimer)
      patrolPlaying.value = false
      return
    }
    patrolStep.value += 1
  }, 1100)
}

function sendPatrolSupervise() {
  if (!activePatrol.value) return
  activePatrol.value.superviseStatus = '已发督办'
  activePatrol.value.superviseNote = superviseInput.value.trim()
  addAuditLog(`向网格员 ${activePatrol.value.staff} 下发停留超时（${activePatrol.value.stayMinutes}分钟）核查督办单`, '已推掌上端')
  showToast(`已向「${activePatrol.value.staff}」掌上网格推送红色核查督办单`)
}

function resolvePatrolSupervise(verdict) {
  if (!activePatrol.value) return
  activePatrol.value.superviseStatus = verdict
  activePatrol.value.staffReply = verdict === '豁免正常' ? '已核实系现场协助居民调解漏水纠纷并附调解照片' : '核查无正当理由脱岗，记入月度考核扣分'
  addAuditLog(`完成网格员 ${activePatrol.value.staff} 停留异常核查认定：${verdict}`, '闭环归档')
  showToast(`核查认定完成：${verdict}，已同步月度考核统计`)
}

// ==================== 6. 事件分析与真实导出（R35/R41/R43） ====================
const analysisPeriod = ref('本月（2026年11月）')
function exportEventsReal() {
  exportRealCsv(
    `长河街道网格事件汇总_${scope.value}`,
    ['事项标题', '事件条线', '所属社区', '责任网格', '处置单位', '当前状态', '上报时间'],
    visibleEvents.value.map((e) => [e.title, e.category, e.community, e.grid, e.owner, e.stage, e.createdAt])
  )
  addAuditLog(`按周期「${analysisPeriod.value}」导出网格事件台账（${visibleEvents.value.length} 条）`, '授权导出')
  showToast(`已真实导出当前筛选下的 ${visibleEvents.value.length} 条网格事件`)
}

onBeforeUnmount(() => clearInterval(patrolTimer))
</script>

<template>
  <AppShell title="网格治理业务" :subtitle="`${scope}实战工作台 · 立体房态 · 权责自动分拨 · 双图核验 · 轨迹防挂机`">
    <!-- 顶部 6 大实战工作台槽式胶囊页签 -->
    <nav class="ui-tabs">
      <button type="button" :class="{ active: activeTab === 'triage' }" @click="activeTab = 'triage'"><Inbox :size="15" /> 事件办理中心</button>
      <button type="button" :class="{ active: activeTab === 'onemap' }" @click="activeTab = 'onemap'"><Map :size="15" /> 治理一张图·框选统计</button>
      <button type="button" :class="{ active: activeTab === 'building' }" @click="activeTab = 'building'"><Building :size="15" /> 立体楼栋房态台账</button>
      <button type="button" :class="{ active: activeTab === 'rules' }" @click="activeTab = 'rules'"><GitBranch :size="15" /> 权责分拨规则</button>
      <button type="button" :class="{ active: activeTab === 'patrol' }" @click="activeTab = 'patrol'"><Navigation :size="15" /> 巡查轨迹与督办</button>
      <button type="button" :class="{ active: activeTab === 'analysis' }" @click="activeTab = 'analysis'"><BarChart3 :size="15" /> 分析导出与绩效</button>
    </nav>

    <!-- ==================== 1. 事件办理中心（三栏研判 + 退回补充 + 双图水印核验，R40） ==================== -->
    <div v-if="activeTab === 'triage'" class="triage-grid">
      <section class="panel">
        <div class="panel-head">
          <h2>事件收件箱</h2>
          <span class="num">{{ visibleEvents.length }} 件</span>
        </div>
        <div class="panel-body" style="padding-bottom: 8px">
          <input v-model="evKeyword" type="search" class="field-input" placeholder="搜索事项、社区或处置单位" style="margin-bottom: 8px" />
          <div style="display: flex; gap: 4px; flex-wrap: wrap">
            <button
              v-for="st in ['全部', '待受理', '待补充', '待派单', '处置中', '待复核', '已办结']"
              :key="st"
              type="button"
              class="btn sm"
              :class="{ primary: evStatusFilter === st }"
              @click="evStatusFilter = st"
            >
              {{ st }}
            </button>
          </div>
        </div>
        <div class="inbox-list">
          <button
            v-for="e in visibleEvents"
            :key="e.id"
            type="button"
            class="inbox-item"
            :class="{ active: activeEv?.id === e.id }"
            @click="selectedEvId = e.id; showReturnBox = false"
          >
            <div class="ii-top">
              <span class="tag" :class="e.stage === '已办结' ? 'st-ok' : (e.stage === '待受理' || e.stage === '待补充') ? 'st-bad' : 'st-warn'">{{ e.stage }}</span>
              <span v-if="e.elapsedHours > e.deadlineHours && e.stage !== '已办结'" class="tag st-bad">已超时红牌</span>
              <span class="num" style="margin-left: auto; font-size: 11px; color: var(--ink-soft)">{{ e.createdAt.slice(5) }}</span>
            </div>
            <strong>{{ e.title }}</strong>
            <small>{{ e.community }} · {{ e.category }} · {{ e.owner }}</small>
          </button>
        </div>
      </section>

      <section v-if="activeEv" class="panel">
        <div class="panel-head">
          <h2>事件全景卷宗与双图核验</h2>
          <span class="tag" :class="activeEv.stage === '已办结' ? 'st-ok' : 'st-warn'">{{ activeEv.stage }}</span>
        </div>
        <div class="panel-body">
          <h3 style="margin: 0 0 6px; font-size: 16px">{{ activeEv.title }}</h3>
          <p style="margin: 0 0 12px; color: var(--ink-muted)">{{ activeEv.description }}</p>

          <div v-if="activeEv.returnReason" class="return-alert">
            <strong>退回补充 / 重办意见：</strong>{{ activeEv.returnReason }}
          </div>

          <!-- 整改前 / 整改后双图水印并排核验器 -->
          <div class="dual-photo-box">
            <div class="dp-card">
              <div class="dp-label">
                <span>上报现场水印照（整改前）</span>
                <small>点击查看大图</small>
              </div>
              <EvidencePhoto
                :src="activeEv.beforePhoto"
                :title="activeEv.title"
                tone="before"
                :location="activeEv.address || `${activeEv.community} · ${activeEv.grid}`"
                :time="activeEv.createdAt"
                :person="`网格员 ${activeEv.reporter}`"
                priority="high"
              />
            </div>
            <div class="dp-card">
              <div class="dp-label">
                <span>处置回传水印照（整改后）</span>
                <small v-if="activeEv.afterPhoto">点击查看大图</small>
              </div>
              <EvidencePhoto
                v-if="activeEv.afterPhoto"
                :src="activeEv.afterPhoto"
                :title="`${activeEv.title} · 整改验收`"
                tone="after"
                :location="activeEv.address || `${activeEv.community} · ${activeEv.grid}`"
                :time="activeEv.history[activeEv.history.length - 1]?.time || activeEv.createdAt"
                :person="activeEv.owner || '街道处置组'"
              />
              <div v-else class="dp-empty">
                <span>尚未回传整改验收照（未传照禁止销号）</span>
                <button v-if="activeEv.stage === '处置中'" type="button" class="btn sm ok-soft" @click="doUploadRectifyPhoto(activeEv)">
                  回传处置整改验收照
                </button>
              </div>
            </div>
          </div>

          <div class="fact-4">
            <div><span>社区与网格</span><strong>{{ activeEv.community }} · {{ activeEv.grid }}</strong></div>
            <div><span>事件条线</span><strong>{{ activeEv.category }}</strong></div>
            <div><span>上报人</span><strong>{{ activeEv.reporter }}</strong></div>
            <div><span>办结时限</span><strong class="num">{{ activeEv.elapsedHours }} / {{ activeEv.deadlineHours }} 小时</strong></div>
          </div>

          <div class="single-map-card">
            <div class="sm-head">
              <strong>事件三维实景定位</strong>
              <div class="ui-tabs" style="padding: 2px">
                <button type="button" :class="{ active: singleMapView === 'city3d' }" @click="singleMapView = 'city3d'">三维实景</button>
                <button type="button" :class="{ active: singleMapView === 'flat' }" @click="singleMapView = 'flat'">平面定位</button>
              </div>
            </div>
            <div class="sm-body">
              <ChangheCity3D
                v-if="singleMapView === 'city3d'"
                mode="single"
                :dark="false"
                :compact="true"
                :single-event="activeEv"
                @webgl-fallback="singleMapView = 'flat'"
              />
              <GeoMap v-else mode="single" :single-event="activeEv" />
            </div>
          </div>
        </div>
      </section>

      <section v-if="activeEv" class="panel">
        <div class="panel-head">
          <h2>权责调度与岗位控权</h2>
          <span class="tag st-neutral">{{ role.name }}</span>
        </div>
        <div class="panel-body">
          <div class="rule-hint" v-if="matchedRule && activeEv.stage !== '已办结'">
            <div><strong>权责清单自动匹配：</strong>{{ matchedRule.dispatchOwner }}</div>
            <small>标准办结时限 {{ matchedRule.deadlineHours }} 小时 · 复核权限：{{ matchedRule.reviewRole }}</small>
          </div>

          <div class="action-box" v-if="activeEv.stage !== '已办结'">
            <div class="form-field" style="margin-bottom: 10px">
              <label>调度批示 / 经办意见</label>
              <textarea v-model="actionNote" class="field-textarea" rows="2"></textarea>
            </div>

            <div class="action-btns">
              <button v-if="activeEv.stage === '待受理'" type="button" class="btn primary" :disabled="!role.canReturnEvent" @click="doAcceptEvent(activeEv)">
                审核受理通过
              </button>
              <button v-if="activeEv.stage === '待派单'" type="button" class="btn primary" :disabled="!role.canDispatch" @click="doAutoDispatch(activeEv)">
                一键按责自动派单
              </button>
              <button v-if="activeEv.stage === '处置中'" type="button" class="btn ok" @click="doUploadRectifyPhoto(activeEv)">
                回传整改后水印照并提请复核
              </button>
              <button v-if="activeEv.stage === '待复核'" type="button" class="btn ok" :disabled="!role.canCloseEvent || !activeEv.afterPhoto" @click="doCloseEvent(activeEv)">
                双图核验通过并销号归档
              </button>
              <button
                v-if="(activeEv.stage === '待受理' || activeEv.stage === '待复核') && role.canReturnEvent"
                type="button"
                class="btn bad-soft"
                @click="showReturnBox = !showReturnBox"
              >
                {{ activeEv.stage === '待复核' ? '退回重办' : '退回补充材料' }}
              </button>
            </div>

            <div v-if="!role.canCloseEvent && activeEv.stage === '待复核'" class="perm-warn">
              当前角色「{{ role.name }}」无最终销号权限，仅街道管理员可执行复核归档。
            </div>

            <div v-if="showReturnBox" class="return-form">
              <textarea v-model="returnReasonInput" class="field-textarea" rows="2" placeholder="输入退回意见（如：现场照片模糊，请补充具体楼层门牌）"></textarea>
              <button type="button" class="btn bad-soft sm" @click="doReturnSupplement(activeEv)">确认退回并推送经办人</button>
            </div>
          </div>

          <div v-else class="done-box">
            <CheckCircle2 :size="16" /> 该事项已完成双图核验并归档至达梦信创库。
          </div>

          <div class="tl-head">办理流转时间轴</div>
          <div class="tl-list">
            <div v-for="(h, i) in activeEv.history" :key="i" class="tl-item">
              <strong>{{ h.node }}</strong>
              <small>{{ h.operator }} · {{ h.time }}</small>
              <p>{{ h.detail }}</p>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- ==================== 2. 治理一张图·框选即统计（R34/R36） ==================== -->
    <div v-else-if="activeTab === 'onemap'" class="onemap-grid">
      <section class="panel" style="display: flex; flex-direction: column">
        <div class="panel-head">
          <h2>网格治理一张图（三维态势穿透 · 矩形框选实时出数）</h2>
          <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center">
            <div class="ui-tabs" style="padding: 2px">
              <button type="button" :class="{ active: oneMapView === 'city3d' }" @click="oneMapView = 'city3d'; boxActive = false">三维沙盘</button>
              <button type="button" :class="{ active: oneMapView === 'flat' }" @click="oneMapView = 'flat'">框选平面图</button>
            </div>
            <AppSelect
              v-model="mapCatFilter"
              size="sm"
              style="width: 124px"
              :options="[{ value: '全部类别', label: '全部条线' }, ...EVENT_CATEGORIES.map((c) => ({ value: c, label: c }))]"
            />
            <button type="button" class="btn sm" :class="{ primary: boxActive }" @click="toggleBoxSelect">
              <Square :size="13" /> {{ boxActive ? '框选中（在图上拖拽）' : '矩形框选统计' }}
            </button>
            <button v-if="boxedComms.length" type="button" class="btn sm" @click="boxedComms = []; boxActive = false">
              <RotateCcw :size="13" /> 清除选区
            </button>
          </div>
        </div>
        <div style="height: 520px">
          <ChangheCity3D
            v-if="oneMapView === 'city3d'"
            mode="grid"
            :dark="false"
            :compact="true"
            :selected-community="scope"
            slice="safety"
            :events="mapFilteredEvents"
            @select-community="(name) => { if (role.scope === '全街道' || name === role.scope) store.selectedCommunity = store.selectedCommunity === name ? '全街道' : name }"
            @select-event="(ev) => { selectedEvId = ev.id; activeTab = 'triage' }"
            @webgl-fallback="oneMapView = 'flat'"
          />
          <GeoMap
            v-else
            mode="grid"
            :selected-community="scope"
            :events="mapFilteredEvents"
            :box-select-active="boxActive"
            @box-selected="(arr) => { boxedComms = arr; boxActive = false; showToast(`已框选命中 ${arr.length} 个社区，右侧统计已实时联动`) }"
            @select-event="(ev) => { selectedEvId = ev.id; activeTab = 'triage' }"
          />
        </div>
      </section>

      <aside class="panel">
        <div class="panel-head">
          <h2>{{ boxedComms.length ? '当前框选区域专项速览' : `${scope}治理底数总览` }}</h2>
          <span class="tag st-run num">{{ boxStats.count }} 社区</span>
        </div>
        <div class="panel-body">
          <div v-if="boxedComms.length" style="margin-bottom: 10px; font-size: 12px; color: var(--brand-2)">
            命中社区：{{ boxedComms.join('、') }}
          </div>
          <div class="grid-2" style="margin-bottom: 12px">
            <div class="stat-mini"><span>实有人口</span><strong class="num">{{ boxStats.pop.toLocaleString() }} 人</strong></div>
            <div class="stat-mini"><span>实有房屋</span><strong class="num">{{ boxStats.homes.toLocaleString() }} 户</strong></div>
            <div class="stat-mini"><span>市场主体</span><strong class="num">{{ boxStats.ent.toLocaleString() }} 家</strong></div>
            <div class="stat-mini"><span>责任网格</span><strong class="num">{{ boxStats.grids }} 个</strong></div>
          </div>

          <button type="button" class="btn primary" style="width: 100%; margin-bottom: 14px" @click="activeTab = 'building'">
            直达选区「立体楼栋房态剖面图」 ›
          </button>

          <div class="tl-head">选区在办治理事项（{{ mapFilteredEvents.length }} 件）</div>
          <div class="inbox-list" style="max-height: 280px">
            <button v-for="e in mapFilteredEvents" :key="e.id" type="button" class="inbox-item" @click="selectedEvId = e.id; activeTab = 'triage'">
              <div class="ii-top"><span class="tag st-warn">{{ e.stage }}</span><small>{{ e.community }}</small></div>
              <strong>{{ e.title }}</strong>
            </button>
          </div>
        </div>
      </aside>
    </div>

    <!-- ==================== 3. 立体楼栋房态剖面图（以房管人、以楼聚企，R38+R37） ==================== -->
    <template v-else-if="activeTab === 'building'">
      <div class="bldg-top-bar">
        <div class="grid-type-bar">
          <button type="button" class="btn sm" :class="{ primary: gridTypeTab === 'residential' }" @click="gridTypeTab = 'residential'">住宅区网格（锦绣家园 3 号楼）</button>
          <button type="button" class="btn sm" :class="{ primary: gridTypeTab === 'commercial' }" @click="gridTypeTab = 'commercial'">商业楼宇网格（星凯国际商务广场）</button>
          <button type="button" class="btn sm" :class="{ primary: gridTypeTab === 'district' }" @click="gridTypeTab = 'district'">沿街商圈网格（东风东路商业段）</button>
        </div>

        <div v-if="gridTypeTab === 'residential'" class="bldg-kpi-strip">
          <span>总户数 <strong class="num">{{ resStats.totalRooms }}</strong> 户</span>
          <span>实住人口 <strong class="num">{{ resStats.totalPeople }}</strong> 人</span>
          <span>自住 <strong class="num">{{ resStats.selfCount }}</strong></span>
          <span>出租 <strong class="num">{{ resStats.rentCount }}</strong></span>
          <span>空置 <strong class="num">{{ resStats.vacCount }}</strong></span>
          <span class="kpi-care">关怀 <strong class="num">{{ resStats.careCount }}</strong></span>
          <span class="kpi-haz">隐患 <strong class="num">{{ resStats.hazardCount }}</strong></span>
        </div>
      </div>

      <!-- 形态一：住宅区立体楼栋剖面（固定视口高度，内部平滑滚动 + 电梯速达尺） -->
      <div v-if="gridTypeTab === 'residential'" class="building-2col">
        <section class="panel bldg-main-panel">
          <div class="panel-head bldg-compact-head">
            <div class="bldg-head-title">
              <h2>{{ resProfile.buildingName }} · 立体房态剖面</h2>
              <span class="bldg-type-badge">18层 · 两梯两户</span>
            </div>
            <div class="legend-row">
              <span><i class="lg-sq self"></i>自住</span>
              <span><i class="lg-sq rent"></i>出租</span>
              <span><i class="lg-sq vac"></i>空置</span>
              <span><i class="lg-dot care"></i>关怀</span>
              <span><i class="lg-dot haz"></i>隐患</span>
            </div>
          </div>

          <!-- 紧凑筛选与分区工具栏（单行高密度布局） -->
          <div class="bldg-toolbar">
            <div class="bldg-filter-group">
              <div class="seg-pills" role="group" aria-label="楼层区段筛选">
                <button
                  v-for="z in ['全部', '高区', '中区', '低区']"
                  :key="z"
                  type="button"
                  :title="z === '全部' ? '全楼 18 层' : z === '高区' ? '13–18 层' : z === '中区' ? '7–12 层' : '1–6 层'"
                  :class="{ active: zoneFilter === z }"
                  @click="zoneFilter = z"
                >
                  {{ z === '全部' ? '全楼' : z }}
                </button>
              </div>

              <div class="seg-pills" role="group" aria-label="房态筛选">
                <button
                  v-for="f in ['全部', '自住', '出租', '空置', '重点关怀', '消防隐患']"
                  :key="f"
                  type="button"
                  :class="{ active: roomFilter === f }"
                  @click="roomFilter = f"
                >
                  {{ f === '重点关怀' ? '关怀' : f === '消防隐患' ? '隐患' : f }}
                </button>
              </div>
            </div>

            <div class="bldg-search-box">
              <Search :size="12" />
              <input v-model="roomKeyword" type="text" placeholder="房号 / 户主" />
            </div>
          </div>

          <!-- 固定高度建筑剖面舞台：左侧电梯速达尺 + 右侧可滚动真实建筑立面 -->
          <div class="bldg-stage">
            <nav class="floor-rail" aria-label="楼层快捷定位">
              <span class="rail-cap">楼层</span>
              <div class="rail-list">
                <button
                  v-for="fl in resProfile.floors"
                  :key="fl"
                  type="button"
                  class="rail-btn"
                  :class="{
                    active: highlightedFloor === fl || (selectedTargetType === 'room' && selectedRoomKey.includes(`-${fl}`)),
                    dim: !visibleResFloors.includes(fl)
                  }"
                  :title="`${fl}层（${getFloorZone(fl)}）`"
                  @click="scrollToFloor(fl)"
                >
                  <span class="num">{{ fl }}</span>
                  <i v-if="getFloorSummary(fl).hasHazard" class="rail-dot haz"></i>
                  <i v-else-if="getFloorSummary(fl).hasCare" class="rail-dot care"></i>
                </button>
              </div>
            </nav>

            <div ref="bldgScrollRef" class="bldg-scroll-viewport">
              <!-- 建筑女儿墙 / 屋顶天际线 -->
              <div class="bldg-roof">
                <div class="roof-parapet"></div>
                <div class="roof-info">
                  <strong>{{ resProfile.buildingName }}</strong>
                  <span>{{ resProfile.propertyOrg }} · 网格长 {{ resProfile.gridLead }} / 网格员 {{ resProfile.gridStaff }}</span>
                </div>
              </div>

              <!-- 吸顶单元标头 -->
              <div class="bldg-unit-header">
                <div class="buh-unit">一单元 <small>01 户 · 02 户</small></div>
                <div class="buh-shaft"><Layers :size="13" /> 电梯井</div>
                <div class="buh-unit">二单元 <small>01 户 · 02 户</small></div>
              </div>

              <!-- 真实 18 层建筑立面剖面 -->
              <div class="bldg-elevation-body">
                <template v-for="fl in visibleResFloors" :key="fl">
                  <div v-if="fl === 18 || fl === 12 || fl === 6" class="zone-divider-band">
                    <span>{{ fl === 18 ? '高区住宅层（13–18 层 · 高区直达梯）' : fl === 12 ? '中区住宅层（7–12 层 · 常态巡查区）' : '低区住宅层（1–6 层 · 适老关怀重点区）' }}</span>
                  </div>

                  <div
                    class="elevation-floor-row"
                    :class="{ pulse: highlightedFloor === fl }"
                    :data-floor="fl"
                  >
                    <!-- 一单元两户 -->
                    <div class="unit-pair">
                      <button
                        v-for="rm in ['01', '02']"
                        :key="`u1-${fl}${rm}`"
                        type="button"
                        class="room-cell"
                        :class="[
                          resProfile.rooms[`一单元-${fl}${rm}`].status === '自住'
                            ? 'st-self'
                            : resProfile.rooms[`一单元-${fl}${rm}`].status === '出租'
                              ? 'st-rent'
                              : 'st-vac',
                          {
                            selected: selectedTargetType === 'room' && selectedRoomKey === `一单元-${fl}${rm}`,
                            muted: (roomFilter !== '全部' || roomKeyword.trim()) && !isRoomMatched(resProfile.rooms[`一单元-${fl}${rm}`]),
                            'has-haz': Boolean(resProfile.rooms[`一单元-${fl}${rm}`].hazard)
                          }
                        ]"
                        @click="selectRoom(`一单元-${fl}${rm}`)"
                      >
                        <div class="rc-top">
                          <strong class="num">{{ fl }}{{ rm }}</strong>
                          <span class="rc-dots">
                            <i v-if="resProfile.rooms[`一单元-${fl}${rm}`].hazard" class="lg-dot haz" :title="resProfile.rooms[`一单元-${fl}${rm}`].hazard"></i>
                            <i v-if="resProfile.rooms[`一单元-${fl}${rm}`].careTags.length" class="lg-dot care" :title="resProfile.rooms[`一单元-${fl}${rm}`].careTags.join('、')"></i>
                          </span>
                        </div>
                        <div class="rc-sub">
                          <span class="rc-owner">{{ resProfile.rooms[`一单元-${fl}${rm}`].owner }}</span>
                          <span class="rc-cnt num">{{ resProfile.rooms[`一单元-${fl}${rm}`].peopleCount }}人</span>
                        </div>
                      </button>
                    </div>

                    <!-- 中央电梯井楼层标尺 -->
                    <div class="shaft-cell" :class="`z-${getFloorZone(fl) === '高区' ? 'hi' : getFloorZone(fl) === '中区' ? 'mid' : 'lo'}`">
                      <strong class="num">{{ fl }}层</strong>
                    </div>

                    <!-- 二单元两户 -->
                    <div class="unit-pair">
                      <button
                        v-for="rm in ['01', '02']"
                        :key="`u2-${fl}${rm}`"
                        type="button"
                        class="room-cell"
                        :class="[
                          resProfile.rooms[`二单元-${fl}${rm}`].status === '自住'
                            ? 'st-self'
                            : resProfile.rooms[`二单元-${fl}${rm}`].status === '出租'
                              ? 'st-rent'
                              : 'st-vac',
                          {
                            selected: selectedTargetType === 'room' && selectedRoomKey === `二单元-${fl}${rm}`,
                            muted: (roomFilter !== '全部' || roomKeyword.trim()) && !isRoomMatched(resProfile.rooms[`二单元-${fl}${rm}`]),
                            'has-haz': Boolean(resProfile.rooms[`二单元-${fl}${rm}`].hazard)
                          }
                        ]"
                        @click="selectRoom(`二单元-${fl}${rm}`)"
                      >
                        <div class="rc-top">
                          <strong class="num">{{ fl }}{{ rm }}</strong>
                          <span class="rc-dots">
                            <i v-if="resProfile.rooms[`二单元-${fl}${rm}`].hazard" class="lg-dot haz" :title="resProfile.rooms[`二单元-${fl}${rm}`].hazard"></i>
                            <i v-if="resProfile.rooms[`二单元-${fl}${rm}`].careTags.length" class="lg-dot care" :title="resProfile.rooms[`二单元-${fl}${rm}`].careTags.join('、')"></i>
                          </span>
                        </div>
                        <div class="rc-sub">
                          <span class="rc-owner">{{ resProfile.rooms[`二单元-${fl}${rm}`].owner }}</span>
                          <span class="rc-cnt num">{{ resProfile.rooms[`二单元-${fl}${rm}`].peopleCount }}人</span>
                        </div>
                      </button>
                    </div>
                  </div>
                </template>

                <div v-if="!visibleResFloors.length" class="bldg-empty">
                  当前筛选条件下暂无匹配房户，请切换筛选条件查看。
                </div>

                <!-- 建筑裙房底座：一层沿街底商 + 地下一层人防车库 -->
                <div class="bldg-podium">
                  <div class="podium-head">
                    <span><Store :size="13" /> 一层沿街底商 / 九小场所</span>
                    <small>点击商铺在右侧查看安全台账</small>
                  </div>
                  <div class="podium-shops-grid">
                    <button
                      v-for="sh in resProfile.shops"
                      :key="sh.id"
                      type="button"
                      class="shop-cell"
                      :class="{ warn: sh.hazard, selected: selectedTargetType === 'shop' && selectedShopId === sh.id }"
                      @click="selectShop(sh.id)"
                    >
                      <div class="sc-top">
                        <strong>{{ sh.door }}</strong>
                        <span class="sc-badge" :class="sh.hazard ? 'bad' : 'ok'">{{ sh.hazard ? '待复检' : '正常' }}</span>
                      </div>
                      <div class="sc-name">{{ sh.name }}</div>
                      <small>{{ sh.owner }} · {{ sh.gasAlarm }}</small>
                    </button>
                  </div>

                  <button
                    v-if="resProfile.basement"
                    type="button"
                    class="basement-bar"
                    :class="{ selected: selectedTargetType === 'basement' }"
                    @click="selectBasement"
                  >
                    <span class="bs-tag">地下一层</span>
                    <span class="bs-name"><Car :size="13" /> {{ resProfile.basement.name.replace('B1 ', '') }}</span>
                    <span class="bs-meta num">车位 {{ resProfile.basement.parkingTotal }} · 充电口 {{ resProfile.basement.chargingPorts }} · 烟感 {{ resProfile.basement.smokeSensors }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- 右侧等高档案面板：支持住宅一户一档 / 底商档案 / 地下设施台账 -->
        <aside class="panel bldg-detail-panel">
          <!-- 视图 A：住宅一户一档 -->
          <template v-if="selectedTargetType === 'room' && activeRoom">
            <div class="panel-head">
              <div>
                <h2>一户一档 · {{ selectedRoomKey }}</h2>
                <small class="detail-sub">锦绣家园 3 号楼 · {{ getFloorZone(parseInt(activeRoom.room.slice(0, -2), 10)) }} · 核验人：{{ activeRoom.verifier }}</small>
              </div>
              <span
                class="tag"
                :class="activeRoom.status === '自住' ? 'st-ok' : activeRoom.status === '出租' ? 'st-run' : 'st-neutral'"
              >{{ activeRoom.status }}</span>
            </div>
            <div class="panel-body detail-scroll-body">
              <div class="fact-4" style="grid-template-columns: 1fr 1fr">
                <div><span>户主姓名</span><strong>{{ activeRoom.owner }}</strong></div>
                <div><span>居住人数</span><strong class="num">{{ activeRoom.peopleCount }} 人</strong></div>
                <div><span>脱敏手机号</span><strong class="num">{{ maskValue('phone', activeRoom.phone) }}</strong></div>
                <div><span>脱敏身份证</span><strong class="num">{{ maskValue('idcard', activeRoom.idCard) }}</strong></div>
              </div>

              <div class="status-switch-row">
                <span class="sw-label">房态核验切换</span>
                <div class="seg-pills">
                  <button
                    v-for="st in ['自住', '出租', '空置']"
                    :key="st"
                    type="button"
                    :class="{ active: activeRoom.status === st }"
                    @click="updateRoomStatus(st)"
                  >{{ st }}</button>
                </div>
              </div>

              <div v-if="activeRoom.tenant" class="tenant-box">租户信息：{{ activeRoom.tenant }}</div>
              <div v-if="activeRoom.hazard" class="return-alert" style="margin-top: 8px">
                <ShieldAlert :size="14" style="vertical-align: -2px; margin-right: 4px" />
                当前关联隐患：{{ activeRoom.hazard }}
              </div>

              <div class="tl-head" style="margin-top: 14px">
                <HeartHandshake :size="13" style="vertical-align: -2px; margin-right: 4px" />
                重点关怀对象标签管理
              </div>
              <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px">
                <span v-for="tg in activeRoom.careTags" :key="tg" class="tag st-warn">{{ tg }}</span>
                <span v-if="!activeRoom.careTags.length" style="font-size: 12px; color: var(--ink-soft)">暂无关怀标签</span>
              </div>

              <div class="care-add-box">
                <AppSelect
                  v-model="newCareTag"
                  :options="['独居高龄', '低保特困', '重度残障', '退役优抚', '孕产妇关怀']"
                />
                <input v-model="newCareReason" class="field-input" placeholder="必填：填写关怀标签变更依据（如入户走访核实）" />
                <button type="button" class="btn sm primary" @click="addCareTagToRoom">添加标签并写入履历</button>
              </div>

              <div class="tl-head" style="margin-top: 14px">关怀标签与入户核验履历（最近：{{ activeRoom.lastVerify }}）</div>
              <div class="tl-list">
                <div v-for="(lg, idx) in activeRoom.careLogs" :key="idx" class="tl-item">
                  <strong>{{ lg.action }}</strong>
                  <small>{{ lg.operator }} · {{ lg.time }}</small>
                  <p>依据：{{ lg.reason }}</p>
                </div>
                <div v-if="!activeRoom.careLogs.length" style="font-size: 12px; color: var(--ink-soft)">暂无标签变更记录</div>
              </div>
            </div>
          </template>

          <!-- 视图 B：一层底商 / 九小场所档案 -->
          <template v-else-if="selectedTargetType === 'shop' && activeShop">
            <div class="panel-head">
              <div>
                <h2>九小场所档案 · {{ activeShop.door }}</h2>
                <small class="detail-sub">{{ activeShop.name }}</small>
              </div>
              <span class="tag" :class="activeShop.hazard ? 'st-bad' : 'st-ok'">{{ activeShop.hazard ? '存在隐患' : '巡检合格' }}</span>
            </div>
            <div class="panel-body detail-scroll-body">
              <div class="fact-4" style="grid-template-columns: 1fr 1fr">
                <div><span>经营主体</span><strong>{{ activeShop.name }}</strong></div>
                <div><span>法定代表人</span><strong>{{ activeShop.owner }}</strong></div>
                <div><span>脱敏联系电话</span><strong class="num">{{ maskValue('phone', activeShop.phone) }}</strong></div>
                <div><span>证照状态</span><strong>{{ activeShop.license }}</strong></div>
              </div>
              <div class="tenant-box">燃气与消防核验：{{ activeShop.gasAlarm }}</div>
              <div v-if="activeShop.hazard" class="return-alert" style="margin-top: 10px">
                当前待闭环隐患：{{ activeShop.hazard }}
              </div>
              <div style="margin-top: 14px; display: flex; gap: 8px">
                <button type="button" class="btn sm primary" style="flex: 1" @click="dispatchShopRecheck(activeShop)">派发九小场所复检任务</button>
                <button type="button" class="btn sm" @click="selectedTargetType = 'room'">返回住宅户档</button>
              </div>
            </div>
          </template>

          <!-- 视图 C：地下一层人防车库与充电设施台账 -->
          <template v-else-if="resProfile.basement">
            <div class="panel-head">
              <div>
                <h2>楼宇地下设施台账</h2>
                <small class="detail-sub">锦绣家园 3 号楼 · 地下一层人防与消防</small>
              </div>
              <span class="tag st-ok">物联在线</span>
            </div>
            <div class="panel-body detail-scroll-body">
              <div class="fact-4" style="grid-template-columns: 1fr 1fr">
                <div><span>规划机动车位</span><strong class="num">{{ resProfile.basement.parkingTotal }} 个</strong></div>
                <div><span>非机动车充电口</span><strong class="num">{{ resProfile.basement.chargingPorts }} 路</strong></div>
                <div><span>消防管网水压</span><strong class="num">{{ resProfile.basement.firePressure }}</strong></div>
                <div><span>消防烟感温感</span><strong>{{ resProfile.basement.smokeSensors }}</strong></div>
              </div>
              <div class="tenant-box">巡查要点：每日早晚高峰核验电动自行车集中充电区温感联动状态，严禁飞线充电与人防通道堆物。</div>
              <div style="margin-top: 14px">
                <button type="button" class="btn sm" style="width: 100%" @click="selectedTargetType = 'room'">返回住宅一户一档</button>
              </div>
            </div>
          </template>
        </aside>
      </div>

      <!-- 形态二：商业楼宇网格（以楼聚企，同样限高双栏） -->
      <div v-else-if="gridTypeTab === 'commercial'" class="building-2col">
        <section class="panel bldg-main-panel">
          <div class="panel-head">
            <div class="bldg-head-title">
              <h2>{{ store.buildingProfiles.commercial.buildingName }} · 楼宇企业剖面</h2>
              <span class="bldg-type-badge">以楼聚企 · 专属网格</span>
            </div>
            <small>网格长：{{ store.buildingProfiles.commercial.gridLead }} · 专职网格员：{{ store.buildingProfiles.commercial.gridStaff }}</small>
          </div>

          <div class="bldg-toolbar">
            <div class="seg-pills">
              <button
                v-for="z in ['全部', '高区', '中区', '低区', '裙房']"
                :key="z"
                type="button"
                :class="{ active: bizZoneFilter === z }"
                @click="bizZoneFilter = z"
              >{{ z === '全部' ? '全部楼层' : z }}</button>
            </div>
            <span style="font-size: 12px; color: var(--ink-muted)">共入驻重点载体 <strong class="num">{{ store.buildingProfiles.commercial.floors.length }}</strong> 层</span>
          </div>

          <div class="biz-scroll-body">
            <button
              v-for="fl in visibleBizFloors"
              :key="fl.floor"
              type="button"
              class="biz-floor"
              :class="{ selected: activeBizFloor && activeBizFloor.floor === fl.floor, warn: fl.safety !== '达标' }"
              @click="selectedBizFloorNo = fl.floor"
            >
              <span class="bf-no num">{{ fl.floor }}</span>
              <span class="bf-zone">{{ fl.zone }}</span>
              <div class="bf-main">
                <strong>{{ fl.company }}</strong>
                <small>{{ fl.industry }} · 员工 {{ fl.employees }} 人 · 年营收 {{ fl.revenue }}</small>
              </div>
              <span class="tag" :class="fl.safety === '达标' ? 'st-ok' : 'st-warn'">{{ fl.safety }}</span>
            </button>
          </div>
        </section>

        <aside v-if="activeBizFloor" class="panel bldg-detail-panel">
          <div class="panel-head">
            <div>
              <h2>一企一档 · {{ activeBizFloor.floor }}</h2>
              <small class="detail-sub">{{ activeBizFloor.zone }} · {{ activeBizFloor.industry }}</small>
            </div>
            <span class="tag" :class="activeBizFloor.safety === '达标' ? 'st-ok' : 'st-warn'">{{ activeBizFloor.safety }}</span>
          </div>
          <div class="panel-body detail-scroll-body">
            <div style="font-size: 15px; font-weight: 700; margin-bottom: 10px; color: var(--ink)">{{ activeBizFloor.company }}</div>
            <div class="fact-4" style="grid-template-columns: 1fr 1fr">
              <div><span>所属行业</span><strong>{{ activeBizFloor.industry }}</strong></div>
              <div><span>在岗员工</span><strong class="num">{{ activeBizFloor.employees }} 人</strong></div>
              <div><span>年营收规模</span><strong class="num">{{ activeBizFloor.revenue }}</strong></div>
              <div><span>楼宇联系人</span><strong>{{ activeBizFloor.contact }}</strong></div>
            </div>
            <div v-if="activeBizFloor.safety !== '达标'" class="return-alert" style="margin-top: 10px">
              安全生产待整改事项：{{ activeBizFloor.safety }}
            </div>
            <div class="tenant-box" style="margin-top: 10px">
              网格包保服务：楼宇专职网格员 {{ store.buildingProfiles.commercial.gridStaff }} 按月对接企业用工、惠企政策与消防安检。
            </div>
            <button type="button" class="btn sm primary" style="width: 100%; margin-top: 14px" @click="dispatchBizNotice(activeBizFloor)">
              下发楼宇安全复查 / 助企走访单
            </button>
          </div>
        </aside>
      </div>

      <!-- 形态三：沿街商圈网格 -->
      <section v-else class="panel">
        <div class="panel-head">
          <h2>{{ store.buildingProfiles.district.streetName }}（沿街商圈双侧门面铺位图）</h2>
          <small>网格长：{{ store.buildingProfiles.district.gridLead }} · 专职网格员：{{ store.buildingProfiles.district.gridStaff }}</small>
        </div>
        <div class="panel-body">
          <div class="street-side-label">路北沿街商铺</div>
          <div class="grid-4">
            <button
              v-for="sh in store.buildingProfiles.district.northShops"
              :key="sh.door"
              type="button"
              class="shop-cell"
              :class="{ warn: sh.events > 0, selected: selectedDistrictShop && selectedDistrictShop.door === sh.door }"
              @click="selectedDistrictShop = sh"
            >
              <div class="sc-top">
                <strong>{{ sh.door }}</strong>
                <span class="sc-badge" :class="sh.events > 0 ? 'bad' : 'ok'">{{ sh.events > 0 ? '重点关注' : '达标' }}</span>
              </div>
              <div class="sc-name">{{ sh.name }}</div>
              <small>{{ sh.type }} · {{ sh.safety }}</small>
            </button>
          </div>
          <div class="road-divider">━━━ 东风东路便民示范商业轴（东西双向通行） ━━━</div>
          <div class="street-side-label">路南沿街商铺</div>
          <div class="grid-4">
            <button
              v-for="sh in store.buildingProfiles.district.southShops"
              :key="sh.door"
              type="button"
              class="shop-cell"
              :class="{ warn: sh.events > 0, selected: selectedDistrictShop && selectedDistrictShop.door === sh.door }"
              @click="selectedDistrictShop = sh"
            >
              <div class="sc-top">
                <strong>{{ sh.door }}</strong>
                <span class="sc-badge" :class="sh.events > 0 ? 'bad' : 'ok'">{{ sh.events > 0 ? '重点关注' : '达标' }}</span>
              </div>
              <div class="sc-name">{{ sh.name }}</div>
              <small>{{ sh.type }} · {{ sh.safety }}</small>
            </button>
          </div>

          <div v-if="selectedDistrictShop" class="district-selected-bar">
            <div>
              <strong>{{ selectedDistrictShop.door }} · {{ selectedDistrictShop.name }}</strong>
              <small>业态：{{ selectedDistrictShop.type }} · 经营状态：{{ selectedDistrictShop.status }} · 安全核验：{{ selectedDistrictShop.safety }}</small>
            </div>
            <span class="tag" :class="selectedDistrictShop.events > 0 ? 'st-warn' : 'st-ok'">近 30 日事件 {{ selectedDistrictShop.events }} 起</span>
          </div>
        </div>
      </section>
    </template>

    <!-- ==================== 4. 权责清单自动分拨规则（R39，补齐缺失模块） ==================== -->
    <template v-else-if="activeTab === 'rules'">
      <section class="panel">
        <div class="panel-head">
          <h2>派单路由试算验证器</h2>
          <div style="display: flex; align-items: center; gap: 8px">
            <AppSelect v-model="simCategory" size="sm" style="width: 132px" :options="EVENT_CATEGORIES" />
            <span class="tag st-run">自动分拨：{{ simRuleMatch.dispatchOwner }} · 时限 {{ simRuleMatch.deadlineHours }} 小时 · 复核：{{ simRuleMatch.reviewRole }}</span>
          </div>
        </div>
      </section>

      <div class="grid-2">
        <section v-for="r in store.eventRules" :key="r.id" class="panel panel-body rule-card">
          <div class="rc-head">
            <span class="tag st-run">{{ r.category }}</span>
            <strong>{{ r.subType }}</strong>
            <span class="tag" :class="r.urgency === '紧急' ? 'st-bad' : 'st-neutral'" style="margin-left: auto">{{ r.urgency }}</span>
          </div>
          <div class="rule-flow">
            <span>① 受理：{{ r.acceptRole }}</span>
            <span>→ ② 自动派单：<b>{{ r.dispatchOwner }}</b></span>
            <span>→ ③ 限时：<b class="num">{{ r.deadlineHours }} 小时</b>（{{ r.yellowPct }}% 黄牌）</span>
            <span>→ ④ 复核：{{ r.reviewRole }}</span>
          </div>
        </section>
      </div>
    </template>

    <!-- ==================== 5. 巡查轨迹回放与防挂机停留异常督办（R42） ==================== -->
    <div v-else-if="activeTab === 'patrol'" class="triage-grid">
      <section class="panel">
        <div class="panel-head">
          <h2>今日在岗巡查榜</h2>
          <AppSelect
            v-model="store.patrolThreshold"
            size="sm"
            style="width: 128px"
            :options="[
              { value: 20, label: '阈值 20 分钟' },
              { value: 30, label: '阈值 30 分钟' },
              { value: 45, label: '阈值 45 分钟' }
            ]"
          />
        </div>
        <div class="inbox-list">
          <button
            v-for="p in store.patrolRecords"
            :key="p.id"
            type="button"
            class="inbox-item"
            :class="{ active: activePatrol?.id === p.id }"
            @click="selectedPatrolId = p.id; patrolStep = p.track.length - 1"
          >
            <div class="ii-top">
              <strong>{{ p.staff }}（{{ p.community }}）</strong>
              <span class="tag" :class="p.stayMinutes > store.patrolThreshold && p.superviseStatus !== '豁免正常' ? 'st-bad' : 'st-ok'">
                {{ p.superviseStatus === '豁免正常' ? '豁免正常' : p.stayMinutes > store.patrolThreshold ? `停留异常 ${p.stayMinutes}分` : '巡查正常' }}
              </span>
            </div>
            <small>签到 {{ p.signInTime }} · 里程 {{ p.km }} 公里 · 必到点 {{ p.mustPointsDone }}/{{ p.mustPointsTotal }}</small>
          </button>
        </div>
      </section>

      <section class="panel" style="display: flex; flex-direction: column">
        <div class="panel-head">
          <h2>{{ activePatrol.staff }} · 三维实景轨迹动态回放</h2>
          <div style="display: flex; gap: 6px; align-items: center">
            <div class="ui-tabs" style="padding: 2px">
              <button type="button" :class="{ active: patrolMapView === 'city3d' }" @click="patrolMapView = 'city3d'">三维沙盘</button>
              <button type="button" :class="{ active: patrolMapView === 'flat' }" @click="patrolMapView = 'flat'">平面轨迹</button>
            </div>
            <button type="button" class="btn sm primary" @click="togglePatrolPlay">
              <component :is="patrolPlaying ? Pause : Play" :size="13" />
              <span>{{ patrolPlaying ? '暂停回放' : '回放轨迹' }}</span>
            </button>
            <span class="num" style="font-size: 12px">{{ activePatrol.track[patrolStep]?.time }}</span>
          </div>
        </div>
        <div style="height: 410px">
          <ChangheCity3D
            v-if="patrolMapView === 'city3d'"
            mode="patrol"
            :dark="false"
            :compact="true"
            :patrol-record="activePatrol"
            :patrol-step-idx="patrolStep"
            :patrol-threshold="store.patrolThreshold"
            @select-patrol-step="(idx) => { patrolStep = idx }"
            @webgl-fallback="patrolMapView = 'flat'"
          />
          <GeoMap
            v-else
            mode="patrol"
            :patrol-record="activePatrol"
            :patrol-step-idx="patrolStep"
            :patrol-threshold="store.patrolThreshold"
          />
        </div>
        <div class="panel-body" style="border-top: 1px solid var(--line)">
          <input
            v-model.number="patrolStep"
            type="range"
            min="0"
            :max="activePatrol.track.length - 1"
            style="width: 100%"
          />
          <div style="font-size: 12.5px; color: var(--ink-muted); margin-top: 4px">
            当前回放节点：<strong>{{ activePatrol.track[patrolStep]?.time }}</strong> · {{ activePatrol.track[patrolStep]?.note }}
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>停留超时异常核查与督办</h2>
          <span class="tag" :class="isPatrolAnomaly ? 'st-bad' : 'st-ok'">{{ activePatrol.superviseStatus }}</span>
        </div>
        <div class="panel-body">
          <div v-if="isPatrolAnomaly" class="return-alert">
            <strong><AlertTriangle :size="14" /> 触发防挂机异常告警：</strong>
            {{ activePatrol.staff }} 在「{{ activePatrol.stayPlace }}」连续停留 {{ activePatrol.stayMinutes }} 分钟，超出街道阈值（{{ store.patrolThreshold }} 分钟）。
          </div>
          <div v-else class="done-box">当前阈值（{{ store.patrolThreshold }} 分钟）下该网格员无超时滞留异常。</div>

          <div class="form-field" style="margin: 12px 0">
            <label>异常核查督办要求</label>
            <textarea v-model="superviseInput" class="field-textarea" rows="3"></textarea>
          </div>
          <div style="display: grid; gap: 8px">
            <button type="button" class="btn primary" :disabled="!isPatrolAnomaly" @click="sendPatrolSupervise">
              <Bell :size="14" /> 发送异常核查督办单至掌上端
            </button>
            <div style="display: flex; gap: 8px">
              <button type="button" class="btn sm ok-soft" style="flex: 1" @click="resolvePatrolSupervise('豁免正常')">核查属实·豁免</button>
              <button type="button" class="btn sm bad-soft" style="flex: 1" @click="resolvePatrolSupervise('违规扣分')">确认脱岗·扣分</button>
            </div>
          </div>
          <div v-if="activePatrol.staffReply" class="tenant-box" style="margin-top: 12px">
            核查归档结论：{{ activePatrol.staffReply }}
          </div>
        </div>
      </section>
    </div>

    <!-- ==================== 6. 事件分析导出与月度考核（R35/R41/R43） ==================== -->
    <template v-else>
      <section class="panel">
        <div class="panel-head">
          <h2>事件统计分析与周期授权导出（与看板 100% 同源口径）</h2>
          <div style="display: flex; gap: 8px; align-items: center">
            <AppSelect
              v-model="analysisPeriod"
              size="sm"
              style="width: 168px"
              :options="['本月（2026年11月）', '近七日', '2026年第四季度']"
            />
            <button type="button" class="btn sm primary" @click="exportEventsReal">
              <Download :size="14" /> 导出周期事件汇总表
            </button>
          </div>
        </div>
        <div class="table-wrapper" tabindex="0" role="region" aria-label="网格员月度工作量考核统计">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">网格员</th>
                <th scope="col">所属社区与网格</th>
                <th scope="col">上报事件</th>
                <th scope="col">巡查里程</th>
                <th scope="col">必到点完成</th>
                <th scope="col">停留异常核查</th>
                <th scope="col">月度考核得分</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in store.patrolRecords" :key="p.id">
                <th scope="row">{{ p.staff }}</th>
                <td>{{ p.community }} · {{ p.grid }}</td>
                <td class="num">{{ store.events.filter((e) => e.reporter === p.staff).length }} 件</td>
                <td class="num">{{ p.km }} 公里</td>
                <td class="num">{{ p.mustPointsDone }}/{{ p.mustPointsTotal }}</td>
                <td>
                  <span class="tag" :class="p.superviseStatus === '违规扣分' ? 'st-bad' : p.stayMinutes > store.patrolThreshold ? 'st-warn' : 'st-ok'">
                    {{ p.superviseStatus }}
                  </span>
                </td>
                <td class="num">
                  <strong>{{ p.superviseStatus === '违规扣分' ? 82 : p.mustPointsDone === p.mustPointsTotal ? 98 : 91 }} 分</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </AppShell>
</template>

<style scoped>
.grid-subnav {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.grid-subnav button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 13px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--surface);
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-muted);
}

.grid-subnav button.active {
  background: var(--brand);
  border-color: var(--brand);
  color: #ffffff;
}

.triage-grid {
  display: grid;
  grid-template-columns: 300px minmax(0, 1.35fr) 320px;
  gap: 14px;
  align-items: stretch;
}

.triage-grid > .panel,
.onemap-grid > .panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.triage-grid > .panel > .panel-body,
.onemap-grid > .panel > .panel-body {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.onemap-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) 360px;
  gap: 14px;
  align-items: stretch;
}

.building-2col {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) 370px;
  gap: 14px;
  align-items: stretch;
  height: clamp(600px, calc(100vh - 210px), 740px);
}

@media (max-width: 1240px) {
  .triage-grid, .onemap-grid, .building-2col {
    grid-template-columns: 1fr;
  }
  .building-2col {
    height: auto;
  }
  .bldg-main-panel {
    height: 620px;
  }
  .bldg-detail-panel {
    max-height: 540px;
  }
}

.inbox-list {
  display: grid;
  max-height: 520px;
  overflow: auto;
}

.inbox-item {
  text-align: left;
  padding: 10px 14px;
  border: none;
  border-bottom: 1px solid var(--line);
  background: transparent;
}

.inbox-item:hover { background: var(--sunken); }
.inbox-item.active { background: var(--brand-soft); }

.ii-top {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.inbox-item strong {
  display: block;
  font-size: 13px;
  margin-bottom: 2px;
}

.inbox-item small {
  color: var(--ink-soft);
  font-size: 11.5px;
}

.dual-photo-box {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 12px;
}

.dp-card {
  border: 1px solid var(--line);
  border-radius: 6px;
  overflow: hidden;
  background: var(--sunken);
}

.dp-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 650;
  background: var(--sunken);
  border-bottom: 1px solid var(--line);
}
.dp-label small {
  font-size: 10.5px;
  font-weight: 500;
  color: var(--ink-soft);
}

.dp-empty {
  aspect-ratio: 16 / 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  text-align: center;
  font-size: 12px;
  color: var(--ink-soft);
}

.single-map-card {
  margin-top: 12px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--line);
  background: var(--surface);
  display: flex;
  flex-direction: column;
}

.sm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  background: var(--sunken);
  border-bottom: 1px solid var(--line);
}

.sm-head strong {
  font-size: 12px;
  font-weight: 650;
  color: var(--ink);
}

.sm-body {
  height: 224px;
}

.fact-4 {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.fact-4 > div {
  padding: 8px 10px;
  border-radius: 5px;
  background: var(--sunken);
}

.fact-4 span {
  display: block;
  font-size: 11px;
  color: var(--ink-soft);
}

.fact-4 strong {
  font-size: 12.5px;
}

.rule-hint {
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--brand-soft);
  color: var(--brand);
  font-size: 12.5px;
  margin-bottom: 12px;
}

.rule-hint small {
  display: block;
  margin-top: 2px;
  color: var(--ink-muted);
}

.action-btns {
  display: grid;
  gap: 8px;
}

.return-alert {
  padding: 9px 12px;
  border-radius: 6px;
  background: var(--bad-soft);
  color: var(--bad);
  font-size: 12.5px;
  margin-bottom: 10px;
}

.return-form {
  margin-top: 10px;
  display: grid;
  gap: 8px;
}

.perm-warn {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 5px;
  background: var(--warn-soft);
  color: var(--warn);
  font-size: 12px;
}

.done-box {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--ok-soft);
  color: var(--ok);
  font-weight: 600;
  font-size: 12.5px;
}

.tl-head {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
  margin: 14px 0 8px;
}

.tl-list {
  display: grid;
  gap: 8px;
}

.tl-item {
  padding: 8px 10px;
  border-left: 2.5px solid var(--brand-2);
  background: var(--sunken);
  border-radius: 0 5px 5px 0;
}

.tl-item strong { display: block; font-size: 12.5px; }
.tl-item small { color: var(--ink-soft); font-size: 11px; }
.tl-item p { margin: 3px 0 0; font-size: 12px; color: var(--ink-muted); }

.stat-mini {
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--sunken);
}
.stat-mini span { display: block; font-size: 11.5px; color: var(--ink-soft); }
.stat-mini strong { font-size: 18px; }

/* 立体楼栋房态图（限高建筑立面工作台） */
.bldg-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.grid-type-bar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.bldg-kpi-strip {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 6px 12px;
  border-radius: var(--r-sm);
  background: var(--surface);
  border: 1px solid var(--line);
  font-size: 12px;
  color: var(--ink-muted);
}

.bldg-kpi-strip strong {
  color: var(--ink);
  font-weight: 700;
  margin-left: 2px;
}

.bldg-kpi-strip .kpi-care strong { color: var(--status-wait); }
.bldg-kpi-strip .kpi-haz strong { color: var(--status-bad); }

.bldg-main-panel,
.bldg-detail-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.bldg-head-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.bldg-type-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--r-tag);
  background: var(--sunken);
  border: 1px solid var(--line);
  color: var(--ink-muted);
  white-space: nowrap;
}

.legend-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--ink-muted);
  flex-wrap: wrap;
}

.lg-sq {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  margin-right: 4px;
  vertical-align: middle;
}
.lg-sq.self { background: var(--surface); border: 1px solid var(--control-line); }
.lg-sq.rent { background: var(--status-run-soft); border: 1px solid var(--dot-run); }
.lg-sq.vac { background: var(--sunken); border: 1px dashed var(--control-line); }

.lg-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.lg-dot.care { background: var(--dot-wait); }
.lg-dot.haz { background: var(--dot-bad); }

.bldg-compact-head {
  padding: 10px 14px;
  gap: 8px;
}

.bldg-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
  padding: 6px 12px;
  border-bottom: 1px solid var(--line);
  background: var(--sunken);
  flex-shrink: 0;
}

.bldg-filter-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.seg-pills {
  display: inline-flex;
  align-items: center;
  padding: 2px;
  border-radius: 7px;
  background: var(--surface);
  border: 1px solid var(--line);
  gap: 1px;
}

.seg-pills button {
  border: none;
  background: transparent;
  color: var(--ink-muted);
  font-size: 11px;
  font-weight: 500;
  padding: 3px 6px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease;
  white-space: nowrap;
}

.seg-pills button:hover {
  background: var(--state-hover);
  color: var(--ink);
}

.seg-pills button.active {
  background: var(--primary);
  color: var(--on-primary);
  font-weight: 600;
}

.bldg-search-box {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  height: 25px;
  border-radius: 7px;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  color: var(--ink-soft);
  width: 118px;
  flex-shrink: 0;
}

.bldg-search-box input {
  border: none;
  outline: none;
  background: transparent;
  color: var(--ink);
  font-size: 11.5px;
  width: 100%;
}

/* 建筑立面主舞台（左侧电梯速达尺 + 右侧可滚动楼层剖面） */
.bldg-stage {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  overflow: hidden;
  background: var(--frame);
}

.floor-rail {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--line);
  background: var(--surface);
  overflow: hidden;
}

.rail-cap {
  font-size: 10px;
  font-weight: 600;
  color: var(--ink-soft);
  text-align: center;
  padding: 5px 2px 4px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}

.rail-list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 3px 2px;
  overflow-y: auto;
  scrollbar-width: none;
}

.rail-list::-webkit-scrollbar { display: none; }

.rail-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 21px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--ink-muted);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease;
}

.rail-btn:hover {
  background: var(--state-hover);
  color: var(--ink);
}

.rail-btn.active {
  background: var(--primary);
  color: var(--on-primary);
}

.rail-btn.dim {
  opacity: 0.35;
}

.rail-dot {
  position: absolute;
  right: 2px;
  top: 2px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
}

.rail-dot.haz { background: var(--dot-bad); }
.rail-dot.care { background: var(--dot-wait); }

.bldg-scroll-viewport {
  height: 100%;
  overflow-y: auto;
  padding: 8px 10px 12px;
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
}

/* 建筑屋顶女儿墙 */
.bldg-roof {
  border-radius: var(--r-sm) var(--r-sm) 0 0;
  border: 1px solid var(--line-strong);
  border-bottom: none;
  background: var(--surface);
  overflow: hidden;
}

.roof-parapet {
  height: 4px;
  background: linear-gradient(90deg, var(--primary), var(--inverse-surface) 50%, var(--primary));
  opacity: 0.85;
}

.roof-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 10px;
  font-size: 11px;
  color: var(--ink-muted);
  white-space: nowrap;
  overflow: hidden;
}

.roof-info strong {
  font-size: 12.5px;
  color: var(--ink);
  flex-shrink: 0;
}

.roof-info span {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 吸顶单元标头 */
.bldg-unit-header {
  position: sticky;
  top: -8px;
  z-index: 4;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 68px minmax(0, 1fr);
  background: var(--inverse-surface);
  color: var(--inverse-ink);
  border-left: 1px solid var(--line-strong);
  border-right: 1px solid var(--line-strong);
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.08);
}

.buh-unit {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 8px;
  font-size: 12px;
  font-weight: 700;
}

.buh-unit small {
  font-size: 10.5px;
  font-weight: 400;
  opacity: 0.72;
}

.buh-shaft {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-size: 10.5px;
  font-weight: 600;
  border-left: 1px solid rgba(255, 255, 255, 0.14);
  border-right: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
}

.bldg-elevation-body {
  border: 1px solid var(--line-strong);
  border-top: none;
  border-radius: 0 0 var(--r-sm) var(--r-sm);
  background: var(--surface);
  overflow: hidden;
}

.zone-divider-band {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 10px;
  background: var(--sunken);
  border-bottom: 1px solid var(--line);
  font-size: 10.5px;
  font-weight: 600;
  color: var(--ink-soft);
}

.elevation-floor-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 68px minmax(0, 1fr);
  align-items: stretch;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
  transition: background 0.22s ease;
}

.elevation-floor-row:hover {
  background: var(--sunken);
}

.elevation-floor-row.pulse {
  background: var(--primary-soft);
}

.unit-pair {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding: 5px 7px;
}

.shaft-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  border-left: 1px solid var(--line);
  border-right: 1px solid var(--line);
  background: var(--sunken);
  font-size: 11.5px;
  color: var(--ink-muted);
}

.shaft-cell.z-hi strong { color: var(--primary); }
.shaft-cell.z-mid strong { color: var(--ink); }
.shaft-cell.z-lo strong { color: var(--status-wait); }

.room-cell {
  position: relative;
  text-align: left;
  padding: 5px 8px 5px 10px;
  border-radius: 7px;
  border: 1px solid var(--line-strong);
  border-left: 3px solid var(--control-line);
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
  transition: border-color 0.16s ease, box-shadow 0.16s ease, opacity 0.16s ease, background 0.16s ease;
}

.room-cell:hover {
  border-color: var(--primary);
  box-shadow: 0 2px 8px rgba(var(--shade), 0.08);
}

.room-cell.st-self { border-left-color: var(--dot-ok); }
.room-cell.st-rent { background: var(--status-run-soft); border-color: rgba(20, 179, 199, 0.35); border-left-color: var(--dot-run); }
.room-cell.st-vac { background: var(--sunken); border-style: dashed; border-left-style: solid; border-left-color: var(--dot-off); color: var(--ink-soft); }
.room-cell.has-haz { border-left-color: var(--dot-bad); }
.room-cell.selected {
  outline: 2px solid var(--primary);
  outline-offset: -1px;
  border-color: var(--primary);
  box-shadow: 0 3px 10px rgba(var(--shade), 0.12);
}
.room-cell.muted {
  opacity: 0.28;
}

.rc-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  line-height: 1.2;
}

.rc-top strong {
  font-size: 12.5px;
}

.rc-dots {
  display: inline-flex;
  gap: 4px;
}

.rc-sub {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  margin-top: 2px;
  font-size: 11px;
  color: var(--ink-muted);
}

.rc-owner {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rc-cnt {
  flex-shrink: 0;
  color: var(--ink-soft);
}

.bldg-empty {
  padding: 28px 16px;
  text-align: center;
  font-size: 12.5px;
  color: var(--ink-soft);
}

/* 裙房底座：一层沿街底商 + 地下一层 */
.bldg-podium {
  padding: 10px 10px 12px;
  background: var(--sunken);
  border-top: 2px solid var(--line-strong);
}

.podium-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--ink);
}

.podium-head span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.podium-head small {
  font-weight: 400;
  color: var(--ink-soft);
}

.podium-shops-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

@media (max-width: 960px) {
  .podium-shops-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.shop-cell {
  text-align: left;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  cursor: pointer;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}

.shop-cell:hover {
  border-color: var(--primary);
}

.shop-cell.warn {
  border-color: var(--status-bad);
  background: var(--status-bad-soft);
}

.shop-cell.selected {
  outline: 2px solid var(--primary);
  outline-offset: -1px;
}

.sc-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  margin-bottom: 3px;
}

.sc-top strong {
  font-size: 11.5px;
  color: var(--ink-muted);
}

.sc-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 999px;
}

.sc-badge.ok { background: var(--status-ok-soft); color: var(--status-ok); }
.sc-badge.bad { background: var(--status-bad-soft); color: var(--status-bad); }

.sc-name {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.shop-cell small {
  display: block;
  font-size: 11px;
  color: var(--ink-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.basement-bar {
  margin-top: 8px;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px dashed var(--line-strong);
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
  text-align: left;
  transition: border-color 0.16s ease;
}

.basement-bar:hover,
.basement-bar.selected {
  border-style: solid;
  border-color: var(--primary);
}

.bs-tag {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 5px;
  background: var(--inverse-surface);
  color: var(--inverse-ink);
}

.bs-name {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
}

.bs-meta {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--ink-muted);
}

/* 右侧档案滚动区 */
.detail-sub {
  display: block;
  font-size: 11.5px;
  color: var(--ink-soft);
  margin-top: 2px;
}

.detail-scroll-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
}

.status-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--sunken);
  border: 1px solid var(--line);
}

.sw-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-muted);
}

.tenant-box {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  background: var(--primary-soft);
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink);
}

.care-add-box {
  display: grid;
  gap: 7px;
  padding: 10px;
  border-radius: 8px;
  background: var(--sunken);
  border: 1px solid var(--line);
}

/* 商业楼宇限高滚动列表 */
.biz-scroll-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px;
  display: grid;
  gap: 8px;
  align-content: start;
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
}

.biz-floor {
  width: 100%;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--surface);
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease;
}

.biz-floor:hover {
  background: var(--sunken);
  border-color: var(--line-strong);
}

.biz-floor.selected {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.biz-floor.warn {
  border-left: 3px solid var(--dot-bad);
}

.bf-no {
  width: 48px;
  height: 32px;
  border-radius: 6px;
  background: var(--primary);
  color: var(--on-primary);
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 12.5px;
  flex-shrink: 0;
}

.bf-zone {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--sunken);
  color: var(--ink-muted);
  border: 1px solid var(--line);
  flex-shrink: 0;
}

.bf-main { flex: 1; min-width: 0; }
.bf-main strong { display: block; font-size: 13.5px; color: var(--ink); }
.bf-main small { color: var(--ink-muted); font-size: 11.5px; }

.street-side-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-muted);
  margin-bottom: 8px;
}

.road-divider {
  text-align: center;
  padding: 10px;
  margin: 12px 0;
  background: var(--sunken);
  color: var(--ink-muted);
  font-weight: 600;
  font-size: 12.5px;
  border-radius: var(--r-sm);
  border: 1px dashed var(--line-strong);
}

.district-selected-bar {
  margin-top: 12px;
  padding: 10px 14px;
  border-radius: var(--r-sm);
  background: var(--sunken);
  border: 1px solid var(--line-strong);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.district-selected-bar strong {
  display: block;
  font-size: 13.5px;
  color: var(--ink);
}

.district-selected-bar small {
  font-size: 12px;
  color: var(--ink-muted);
}

.rule-card {
  display: grid;
  gap: 10px;
}

.rc-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rule-flow {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 9px 12px;
  border-radius: 5px;
  background: var(--sunken);
  font-size: 12.5px;
}

@media (max-width: 768px) {
  .inbox-list {
    max-height: 280px;
  }
  .dual-photo-box {
    grid-template-columns: 1fr;
  }
  .bldg-main-panel {
    height: 520px;
  }
  .bldg-detail-panel {
    max-height: none;
  }
  .bldg-scroll-viewport {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .bldg-roof,
  .bldg-unit-header,
  .bldg-elevation-body {
    min-width: 500px;
  }
  .bldg-toolbar,
  .bldg-legend-bar,
  .status-switch-row,
  .rc-head {
    flex-wrap: wrap;
    gap: 6px;
  }
  .biz-floor {
    flex-wrap: wrap;
    gap: 8px;
  }
  .bs-meta {
    margin-left: 0;
    width: 100%;
  }
  .district-selected-bar {
    flex-direction: column;
    align-items: stretch;
  }
}

@media (max-width: 460px) {
  .podium-shops-grid {
    grid-template-columns: 1fr;
  }
}
</style>
