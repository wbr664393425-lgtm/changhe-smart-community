<script setup>
import { ref, computed, watch } from 'vue'
import {
  X, Maximize2, Radio, Send, PlusCircle, Building2, ShieldAlert,
  Users, Phone, Package, Flame, Droplets, CheckCircle2, MapPin
} from 'lucide-vue-next'
import NativeDrawer from './NativeDrawer.vue'

const props = defineProps({
  buildingDetail: { type: Object, default: null },
  entityDetail: { type: Object, default: null },
  emergencyInfo: { type: Object, default: null },
  radiusActive: { type: Boolean, default: false }
})

const emit = defineEmits([
  'close',
  'toggle-radius',
  'dispatch-staff',
  'create-inspection',
  'borrow-aid',
  'select-building-index',
  'select-event'
])

const drawerOpen = ref(false)
const activeUnit = ref('一单元')
const selectedRoomKey = ref('')
const selectedFloorIdx = ref(0)
const showCreateForm = ref(false)
const inspectCategory = ref('安全生产')
const inspectTitle = ref('')
const inspectDesc = ref('')

// 切换楼栋时自动预选重点户（有隐患或独居关怀优先），减少一次点击
watch(
  () => props.buildingDetail?.bldg?.index,
  () => {
    showCreateForm.value = false
    inspectTitle.value = ''
    inspectDesc.value = ''
    selectedFloorIdx.value = 0
    if (props.buildingDetail?.mode === 'residential-full') {
      activeUnit.value = '一单元'
      const rooms = props.buildingDetail.profile?.rooms || {}
      const hitKey =
        Object.keys(rooms).find((k) => rooms[k].hazard) ||
        Object.keys(rooms).find((k) => rooms[k].careTags?.length) ||
        Object.keys(rooms)[0] ||
        ''
      selectedRoomKey.value = hitKey
    } else if (props.buildingDetail?.mode === 'residential-lite') {
      const fls = props.buildingDetail.generatedFloors || []
      let hit = ''
      for (const fl of fls) {
        const h = fl.rooms.find((r) => r.hazard || r.careTags?.length)
        if (h) { hit = h.room; break }
      }
      selectedRoomKey.value = hit || fls[0]?.rooms?.[0]?.room || ''
    } else {
      selectedRoomKey.value = ''
    }
  },
  { immediate: true }
)

// 右轨紧凑住宅视图：展示前 6 层代表楼层（含隐患/关怀层优先），完整 18 层在宽抽屉铺开
const compactResFloors = computed(() => {
  const d = props.buildingDetail
  if (!d) return []
  if (d.mode === 'residential-full') {
    const prof = d.profile
    const unit = activeUnit.value
    const list = (prof.floors || []).map((fl) => {
      const r01 = prof.rooms[`${unit}-${fl}01`]
      const r02 = prof.rooms[`${unit}-${fl}02`]
      return {
        floor: fl,
        rooms: [
          r01 ? { key: `${unit}-${fl}01`, ...r01 } : null,
          r02 ? { key: `${unit}-${fl}02`, ...r02 } : null
        ].filter(Boolean)
      }
    })
    // 右轨优先呈现有隐患/关怀的楼层与低层，最多 6 行保持一屏清爽
    const priority = list.filter((row) => row.rooms.some((r) => r.hazard || r.careTags?.length))
    const rest = list.filter((row) => !priority.includes(row))
    return [...priority.slice(0, 4), ...rest.slice(0, Math.max(2, 6 - priority.length))]
      .slice(0, 6)
      .sort((a, b) => b.floor - a.floor)
  }
  if (d.mode === 'residential-lite') {
    return (d.generatedFloors || []).slice(0, 5)
  }
  return []
})

// 宽抽屉全量楼层矩阵
const fullResFloors = computed(() => {
  const d = props.buildingDetail
  if (!d || d.mode !== 'residential-full') return []
  const prof = d.profile
  return (prof.floors || []).map((fl) => ({
    floor: fl,
    u1: [
      prof.rooms[`一单元-${fl}01`] ? { key: `一单元-${fl}01`, unit: '一单元', ...prof.rooms[`一单元-${fl}01`] } : null,
      prof.rooms[`一单元-${fl}02`] ? { key: `一单元-${fl}02`, unit: '一单元', ...prof.rooms[`一单元-${fl}02`] } : null
    ].filter(Boolean),
    u2: [
      prof.rooms[`二单元-${fl}01`] ? { key: `二单元-${fl}01`, unit: '二单元', ...prof.rooms[`二单元-${fl}01`] } : null,
      prof.rooms[`二单元-${fl}02`] ? { key: `二单元-${fl}02`, unit: '二单元', ...prof.rooms[`二单元-${fl}02`] } : null
    ].filter(Boolean)
  }))
})

const selectedRoomObj = computed(() => {
  const d = props.buildingDetail
  if (!d || !selectedRoomKey.value) return null
  if (d.mode === 'residential-full') {
    const r = d.profile?.rooms?.[selectedRoomKey.value]
    return r ? { key: selectedRoomKey.value, ...r } : null
  }
  if (d.mode === 'residential-lite') {
    for (const fl of d.generatedFloors || []) {
      const hit = fl.rooms.find((r) => r.room === selectedRoomKey.value)
      if (hit) return hit
    }
  }
  return null
})

function roomTone(r) {
  if (r.hazard) return 'is-hazard'
  if (r.careTags?.length) return 'is-care'
  if (r.status === '出租') return 'is-rent'
  if (r.status === '空置') return 'is-vacant'
  return 'is-self'
}

function openQuickCreate(prefillRoom = '') {
  const d = props.buildingDetail
  const ent = props.entityDetail
  showCreateForm.value = true
  if (d) {
    inspectCategory.value = d.bldg.category === 'commercial' ? '安全生产' : '安全生产'
    const roomSuffix = prefillRoom ? ` ${prefillRoom} 室` : ''
    inspectTitle.value = `${d.title}${roomSuffix}专项隐患复核排查`
    inspectDesc.value = `驾驶舱三维定位发现关注项，请网格员到场核验消防设施、楼道畅通及重点人员安全并回传现场照片。`
  } else if (ent?.entityType === 'eco') {
    inspectCategory.value = '生态环保'
    inspectTitle.value = `${ent.name}应急巡防值守核查`
    inspectDesc.value = `驾驶舱下发${ent.kind === 'flood' ? '汛期排涝设施' : '林缘防火卡口'}现场核查任务，请确认装备到位并反馈现场照片。`
  }
}

function submitInspection() {
  const title = inspectTitle.value.trim()
  if (!title) return
  const d = props.buildingDetail
  const ent = props.entityDetail
  const nearestStaff = props.emergencyInfo?.nearbyStaff?.[0]
  emit('create-inspection', {
    title,
    category: inspectCategory.value,
    description: inspectDesc.value.trim() || '驾驶舱三维空间定位下发专项现场核查。',
    community: d ? d.community : ent?.community || '德馨社区',
    grid: d ? d.bldg.gridName || '第一网格' : ent?.grid || '第一网格',
    address: d ? `${d.community} · ${d.title}` : `${ent?.community || ''} · ${ent?.name || ''}`,
    buildingIndex: d ? d.bldg.index : undefined,
    lat: ent?.lat,
    lng: ent?.lng,
    assignee: nearestStaff ? `${nearestStaff.name}（${nearestStaff.community}${nearestStaff.grid}）` : (d?.gridStaff || '网格处置组')
  })
  showCreateForm.value = false
  inspectTitle.value = ''
  inspectDesc.value = ''
}

const AID_ITEM_META = [
  { key: 'wheelchair', label: '便民轮椅', unit: '辆' },
  { key: 'crutch', label: '助行拐杖', unit: '副' },
  { key: 'medkit', label: '应急药箱', unit: '套' },
  { key: 'toolbox', label: '维修工具箱', unit: '套' },
  { key: 'umbrella', label: '便民爱心伞', unit: '把' }
]
</script>

<template>
  <!-- 情形一：单栋 3D 楼房「一楼一档」穿透卡 -->
  <div v-if="buildingDetail" class="bp-wrap">
    <div class="bp-head">
      <div class="bp-head-text">
        <span class="bp-title" :title="buildingDetail.title">{{ buildingDetail.title }}</span>
        <span class="bp-sub" :title="`${buildingDetail.community}${buildingDetail.estate ? ' · ' + buildingDetail.estate : ''} · ${buildingDetail.typeLabel}`">
          {{ buildingDetail.community }}{{ buildingDetail.estate ? ' · ' + buildingDetail.estate : '' }} · {{ buildingDetail.typeLabel }}
        </span>
      </div>
      <div class="bp-head-ops">
        <button
          type="button"
          class="bp-icon-btn"
          title="展开完整立体剖面"
          aria-label="展开完整立体剖面"
          @click="drawerOpen = true"
        >
          <Maximize2 :size="13" />
        </button>
        <button
          type="button"
          class="bp-icon-btn"
          title="返回综合闭环看板"
          aria-label="返回综合闭环看板"
          @click="emit('close')"
        >
          <X :size="14" />
        </button>
      </div>
    </div>

    <!-- 楼栋核心底数 4 格 + 网格责任人条 -->
    <section class="bp-sec">
      <div class="bp-quad-strip">
        <div class="bp-quad-cell">
          <span>楼层数</span>
          <strong class="num">{{ buildingDetail.floorsCount }}<small>层</small></strong>
        </div>
        <div class="bp-quad-cell">
          <span>{{ buildingDetail.mode.startsWith('commercial') ? '入驻企/户' : '实有户数' }}</span>
          <strong class="num">{{ buildingDetail.households }}<small>户</small></strong>
        </div>
        <div class="bp-quad-cell" :class="{ 'is-care': buildingDetail.careCount > 0 }">
          <span>重点关怀</span>
          <strong class="num">{{ buildingDetail.careCount }}</strong>
        </div>
        <div class="bp-quad-cell" :class="buildingDetail.hazardCount > 0 ? 'is-danger' : 'is-safe'">
          <span>关注隐患</span>
          <strong class="num">{{ buildingDetail.hazardCount }}</strong>
        </div>
      </div>

      <div class="bp-owner-bar">
        <span class="bp-owner-names" :title="`网格长 ${buildingDetail.gridLead} · 专职网格员 ${buildingDetail.gridStaff}`">
          <Users :size="11" />
          <span>网格长 {{ buildingDetail.gridLead }} · {{ buildingDetail.gridStaff }}</span>
        </span>
        <span class="bp-owner-tel num"><Phone :size="10" /> {{ buildingDetail.staffPhone }}</span>
      </div>
    </section>

    <!-- 紧凑楼层 / 企业 / 商铺交互格栅（发起工单表单打开时自动收起腾出完整表单空间） -->
    <section v-show="!showCreateForm" class="bp-sec bp-scroll-sec">
      <!-- 住宅楼层格栅 -->
      <template v-if="buildingDetail.mode === 'residential-full' || buildingDetail.mode === 'residential-lite'">
        <div class="bp-sec-head">
          <span class="bp-sec-label">楼层房态快查</span>
          <div v-if="buildingDetail.mode === 'residential-full'" class="bp-seg-tabs" role="tablist" aria-label="选择单元">
            <button type="button" :class="{ active: activeUnit === '一单元' }" @click="activeUnit = '一单元'">一单元</button>
            <button type="button" :class="{ active: activeUnit === '二单元' }" @click="activeUnit = '二单元'">二单元</button>
          </div>
          <button v-else type="button" class="bp-action-pill" @click="drawerOpen = true">完整剖面 ›</button>
        </div>

        <div class="bp-floor-grid">
          <div v-for="row in compactResFloors" :key="row.floor" class="bp-floor-row">
            <span class="bp-fl-no num">{{ row.floor }}层</span>
            <div class="bp-room-pair">
              <button
                v-for="rm in row.rooms"
                :key="rm.key || rm.room"
                type="button"
                class="bp-room-cell"
                :class="[roomTone(rm), { active: selectedRoomKey === (rm.key || rm.room) }]"
                @click="selectedRoomKey = rm.key || rm.room"
              >
                <strong class="num">{{ rm.room }}</strong>
                <span class="bp-rm-state">{{ rm.hazard ? '隐患' : rm.careTags?.length ? rm.careTags[0].slice(0, 2) : rm.status }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 当前选中房间「一户一档」详情微卡 -->
        <div v-if="selectedRoomObj" class="bp-room-detail">
          <div class="bp-rd-top">
            <strong class="num">{{ selectedRoomObj.room }} 室 · {{ selectedRoomObj.owner }}</strong>
            <span
              class="tag bp-sm-tag"
              :class="selectedRoomObj.hazard ? 'st-bad' : selectedRoomObj.careTags?.length ? 'st-wait' : selectedRoomObj.status === '空置' ? 'st-neutral' : selectedRoomObj.status === '出租' ? 'st-run' : 'st-ok'"
            >
              {{ selectedRoomObj.hazard ? '有隐患' : selectedRoomObj.status }}
            </span>
          </div>
          <div class="bp-rd-meta">
            <span>常住 <b class="num">{{ selectedRoomObj.peopleCount }}</b> 人</span>
            <span class="num"><Phone :size="10" style="vertical-align: -1px; margin-right: 3px" />{{ selectedRoomObj.phone }}</span>
          </div>
          <div v-if="selectedRoomObj.careTags?.length || selectedRoomObj.hazard" class="bp-rd-tags">
            <span v-for="tg in selectedRoomObj.careTags" :key="tg" class="bp-pill care">{{ tg }}</span>
            <span v-if="selectedRoomObj.hazard" class="bp-pill hazard">{{ selectedRoomObj.hazard }}</span>
          </div>
        </div>
      </template>

      <!-- 商务写字楼分层企业 -->
      <template v-else-if="buildingDetail.mode === 'commercial-full' || buildingDetail.mode === 'commercial-lite'">
        <div class="bp-sec-head">
          <span class="bp-sec-label">楼宇企业分层台账</span>
          <span class="bp-sec-note num">{{ buildingDetail.revenueLabel || '重点税源楼' }}</span>
        </div>
        <div class="bp-biz-list">
          <div
            v-for="(fl, idx) in (buildingDetail.mode === 'commercial-full' ? buildingDetail.profile.floors : buildingDetail.generatedFloors).slice(0, 5)"
            :key="fl.floor + idx"
            class="bp-biz-item"
            :class="{ warn: fl.safety && fl.safety !== '达标' }"
          >
            <div class="bp-biz-top">
              <strong class="num">{{ fl.floor }}</strong>
              <span class="bp-biz-co">{{ fl.company }}</span>
              <b class="num">{{ fl.revenue }}</b>
            </div>
            <div class="bp-biz-sub">
              <span>{{ fl.industry }} · {{ fl.employees }}人</span>
              <em :class="fl.safety !== '达标' ? 'is-warn' : 'is-ok'">{{ fl.safety }}</em>
            </div>
          </div>
        </div>
      </template>

      <!-- 沿街商圈九小场所 -->
      <template v-else-if="buildingDetail.mode === 'district-full'">
        <div class="bp-sec-head">
          <span class="bp-sec-label">沿街商铺与燃气消防</span>
          <button type="button" class="bp-action-pill" @click="drawerOpen = true">全段台账 ›</button>
        </div>
        <div class="bp-biz-list">
          <div
            v-for="sp in [...buildingDetail.profile.northShops, ...buildingDetail.profile.southShops].slice(0, 5)"
            :key="sp.door"
            class="bp-biz-item"
            :class="{ warn: sp.safety.includes('重点') || sp.events > 0 }"
          >
            <div class="bp-biz-top">
              <strong>{{ sp.door }}</strong>
              <span class="bp-biz-co">{{ sp.name }}</span>
              <b>{{ sp.type }}</b>
            </div>
            <div class="bp-biz-sub">
              <span>{{ sp.safety }}</span>
            </div>
          </div>
        </div>
      </template>
    </section>

    <!-- 关联在办事件（如有） -->
    <section v-if="buildingDetail.openEvents.length && !showCreateForm" class="bp-sec">
      <div class="bp-sec-head">
        <span class="bp-sec-label">本楼在办事项</span>
        <span class="bp-sec-badge-bad num">{{ buildingDetail.openEvents.length }} 件</span>
      </div>
      <div class="bp-ev-list">
        <button
          v-for="ev in buildingDetail.openEvents.slice(0, 2)"
          :key="ev.id"
          type="button"
          class="bp-ev-row"
          @click="emit('select-event', ev)"
        >
          <ShieldAlert :size="12" style="color: var(--ck-danger); flex-shrink: 0" />
          <span class="bp-ev-title" :title="ev.title">{{ ev.title }}</span>
          <span class="tag st-bad bp-sm-tag">{{ ev.stage }}</span>
        </button>
      </div>
    </section>

    <!-- 300 米周边应急力量联动区 -->
    <section v-if="emergencyInfo && !showCreateForm" class="bp-sec">
      <div class="bp-sec-head">
        <span class="bp-sec-label">300 米空间联动资源</span>
        <button type="button" class="bp-action-pill" @click="emit('toggle-radius')">
          {{ radiusActive ? '收起联动圈' : '展开300米圈' }}
        </button>
      </div>
      <div class="bp-emg-strip">
        <div v-if="emergencyInfo.nearbyStaff[0]" class="bp-emg-row">
          <div class="bp-emg-info">
            <strong>最近网格员 · {{ emergencyInfo.nearbyStaff[0].name }}</strong>
            <span class="num">距 {{ emergencyInfo.nearbyStaff[0].distMeters }} 米 · {{ emergencyInfo.nearbyStaff[0].status }}</span>
          </div>
          <button
            type="button"
            class="bp-mini-act"
            @click="emit('dispatch-staff', { staff: emergencyInfo.nearbyStaff[0], building: buildingDetail })"
          >
            <Send :size="11" /> 派单
          </button>
        </div>
        <div v-if="emergencyInfo.nearbyAids[0]" class="bp-emg-row">
          <div class="bp-emg-info">
            <strong>{{ emergencyInfo.nearbyAids[0].name }}</strong>
            <span class="num">距 {{ emergencyInfo.nearbyAids[0].distMeters }} 米 · 急救箱 {{ emergencyInfo.nearbyAids[0].items.medkit }} / 轮椅 {{ emergencyInfo.nearbyAids[0].items.wheelchair }}</span>
          </div>
        </div>
        <div v-if="emergencyInfo.careBuildingsTotal > 0" class="bp-emg-note">
          <span>300 米内涉及独居高龄重点楼 <b class="num">{{ emergencyInfo.careBuildingsTotal }}</b> 栋（共 <b class="num">{{ emergencyInfo.careElderSum }}</b> 户）</span>
        </div>
      </div>
    </section>

    <!-- 快捷发起该楼排查工单内联表单 -->
    <section v-if="showCreateForm" class="bp-sec bp-create-box">
      <div class="bp-sec-head">
        <span class="bp-sec-label">发起本楼排查工单</span>
        <button type="button" class="bp-action-pill" @click="showCreateForm = false">取消返回</button>
      </div>
      <div class="bp-field-label">处置条线分类</div>
      <div class="bp-cat-pills">
        <button
          v-for="cat in ['安全生产', '物业服务', '矛盾纠纷', '生态环保']"
          :key="cat"
          type="button"
          :class="{ active: inspectCategory === cat }"
          @click="inspectCategory = cat"
        >
          {{ cat }}
        </button>
      </div>
      <div class="bp-field-label">排查事项标题</div>
      <input v-model="inspectTitle" type="text" class="bp-input" placeholder="输入排查事项标题" />
      <div class="bp-field-label">现场核查要求</div>
      <textarea v-model="inspectDesc" rows="3" class="bp-input" placeholder="简要说明现场核查要求"></textarea>
      <div class="bp-create-hint">
        派发后将实时推送至就近网格员并同步标红该建筑模型
      </div>
      <div class="bp-create-foot">
        <button type="button" class="ck-btn" @click="showCreateForm = false">取消</button>
        <button type="button" class="ck-btn primary" style="flex: 1.6" @click="submitInspection">
          <Send :size="12" /> 确认派发排查工单
        </button>
      </div>
    </section>

    <!-- 底部业务操作栏 -->
    <div v-else class="bp-foot-actions">
      <button type="button" class="ck-btn" :class="{ active: radiusActive }" @click="emit('toggle-radius')">
        <Radio :size="12" /> {{ radiusActive ? '隐藏联动圈' : '300米联动' }}
      </button>
      <button type="button" class="ck-btn primary" @click="openQuickCreate(selectedRoomObj?.room || '')">
        <PlusCircle :size="12" /> 发起排查
      </button>
      <button type="button" class="ck-btn" @click="drawerOpen = true">
        <Building2 :size="12" /> 立体剖面
      </button>
    </div>
  </div>

  <!-- 情形二：3D 治理实体点位调度卡（在岗网格员 / 共享辅助站 / 易涝防火点） -->
  <div v-else-if="entityDetail" class="bp-wrap">
    <div class="bp-head">
      <div class="bp-head-text">
        <span class="bp-title">{{ entityDetail.name }}</span>
        <span class="bp-sub">
          {{ entityDetail.entityType === 'staff' ? `${entityDetail.community} · ${entityDetail.grid}` : entityDetail.entityType === 'aid' ? entityDetail.address : `${entityDetail.community} · ${entityDetail.level}` }}
        </span>
      </div>
      <button type="button" class="bp-icon-btn" title="返回综合闭环看板" aria-label="返回综合闭环看板" @click="emit('close')">
        <X :size="14" />
      </button>
    </div>

    <!-- 在岗网格员卡片 -->
    <template v-if="entityDetail.entityType === 'staff'">
      <section class="bp-sec">
        <div class="bp-trio-strip">
          <div class="bp-trio-cell is-safe">
            <span>执勤状态</span>
            <strong><i class="bp-live-dot"></i>{{ entityDetail.status }}</strong>
          </div>
          <div class="bp-trio-cell">
            <span>今日巡查</span>
            <strong class="num">{{ entityDetail.km }}<small>公里</small></strong>
          </div>
          <div class="bp-trio-cell">
            <span>必到打卡</span>
            <strong class="num">{{ entityDetail.mustPoints }}</strong>
          </div>
        </div>
        <div class="bp-owner-bar">
          <span class="bp-owner-names"><Users :size="11" /> 社区网格长 {{ entityDetail.lead }}</span>
          <span class="bp-owner-tel num"><Phone :size="10" /> {{ entityDetail.phone }}</span>
        </div>
        <div class="bp-task-card">
          <span class="bp-task-label">当前在办网格任务</span>
          <p class="bp-desc">{{ entityDetail.task }}</p>
        </div>
      </section>

      <section v-if="emergencyInfo?.careBuildings?.length" class="bp-sec bp-scroll-sec">
        <div class="bp-sec-head">
          <span class="bp-sec-label">周边 300 米关怀楼栋</span>
          <span class="bp-sec-note num">{{ emergencyInfo.careBuildingsTotal }} 栋</span>
        </div>
        <div class="bp-biz-list">
          <button
            v-for="cb in emergencyInfo.careBuildings.slice(0, 5)"
            :key="cb.index"
            type="button"
            class="bp-biz-item is-btn"
            @click="emit('select-building-index', cb.index)"
          >
            <div class="bp-biz-top">
              <MapPin :size="11" style="color: var(--ck-accent); flex-shrink: 0" />
              <span class="bp-biz-co">{{ cb.name }}</span>
              <b class="num">独居 {{ cb.elderAloneCount }} 户 · {{ cb.distMeters }}米</b>
            </div>
          </button>
        </div>
      </section>

      <div class="bp-foot-actions">
        <button type="button" class="ck-btn" :class="{ active: radiusActive }" @click="emit('toggle-radius')">
          <Radio :size="12" /> {{ radiusActive ? '隐藏范围' : '300米覆盖' }}
        </button>
        <button
          type="button"
          class="ck-btn primary"
          style="flex: 1.5"
          @click="emit('dispatch-staff', { staff: entityDetail })"
        >
          <Send :size="12" /> 一键派发就近任务
        </button>
      </div>
    </template>

    <!-- 共享辅助站物资库存与实时调拨 -->
    <template v-else-if="entityDetail.entityType === 'aid'">
      <section class="bp-sec bp-scroll-sec">
        <div class="bp-owner-bar">
          <span class="bp-owner-names"><Package :size="11" /> 站长 {{ entityDetail.lead }}</span>
          <span class="bp-owner-tel num"><Phone :size="10" /> {{ entityDetail.phone }}</span>
        </div>
        <div class="bp-sec-head" style="margin-top: 2px">
          <span class="bp-sec-label">便民物资实时库存</span>
          <span class="bp-sec-note">点击即可登记调拨</span>
        </div>
        <div class="bp-aid-rows">
          <div v-for="m in AID_ITEM_META" :key="m.key" class="bp-aid-row">
            <div class="bp-aid-name">
              <span>{{ m.label }}</span>
              <strong class="num">{{ entityDetail.items[m.key] }} <small>{{ m.unit }}</small></strong>
            </div>
            <button
              type="button"
              class="bp-mini-act"
              :disabled="entityDetail.items[m.key] <= 0"
              @click="emit('borrow-aid', { community: entityDetail.community, itemKey: m.key, itemLabel: m.label })"
            >
              调拨 1 {{ m.unit }}
            </button>
          </div>
        </div>
        <p class="bp-desc" style="margin-top: 4px">调拨后立即扣减该站点实时库存，并同步记入社区共享辅助站借用流水与审计日志。</p>
      </section>
    </template>

    <!-- 易涝积水 / 林缘防火点 -->
    <template v-else-if="entityDetail.entityType === 'eco'">
      <section class="bp-sec">
        <div class="bp-eco-badge" :class="entityDetail.kind">
          <component :is="entityDetail.kind === 'flood' ? Droplets : Flame" :size="14" />
          <strong>{{ entityDetail.kind === 'flood' ? '易涝积水监测点' : '林缘防火盯防点' }} · {{ entityDetail.level }}</strong>
        </div>
        <div class="bp-owner-bar">
          <span class="bp-owner-names">责任值守：{{ entityDetail.owner }}</span>
        </div>
        <div class="bp-task-card">
          <span class="bp-task-label">应急装备配备</span>
          <p class="bp-desc">{{ entityDetail.gear }}</p>
        </div>
        <div class="bp-task-card">
          <span class="bp-task-label">当前监测工况</span>
          <p class="bp-desc">{{ entityDetail.status }}</p>
        </div>
      </section>

      <section v-if="showCreateForm" class="bp-sec bp-create-box">
        <div class="bp-sec-head">
          <span class="bp-sec-label">下发专项巡防工单</span>
          <button type="button" class="bp-action-pill" @click="showCreateForm = false">取消返回</button>
        </div>
        <div class="bp-field-label">核查事项标题</div>
        <input v-model="inspectTitle" type="text" class="bp-input" placeholder="输入核查事项标题" />
        <div class="bp-field-label">现场处置要求</div>
        <textarea v-model="inspectDesc" rows="3" class="bp-input" placeholder="输入现场核查要求"></textarea>
        <div class="bp-create-foot">
          <button type="button" class="ck-btn" @click="showCreateForm = false">取消</button>
          <button type="button" class="ck-btn primary" style="flex: 1.6" @click="submitInspection">
            <Send :size="12" /> 确认派发巡防工单
          </button>
        </div>
      </section>

      <div v-else class="bp-foot-actions">
        <button type="button" class="ck-btn" :class="{ active: radiusActive }" @click="emit('toggle-radius')">
          <Radio :size="12" /> {{ radiusActive ? '隐藏联动圈' : '波及范围' }}
        </button>
        <button type="button" class="ck-btn primary" style="flex: 1.5" @click="openQuickCreate()">
          <Send :size="12" /> 下发应急核查单
        </button>
      </div>
    </template>
  </div>

  <!-- 顶层原生 Dialog 宽抽屉：完整立体剖面（18层72户 + B1车库 + 底商 / 商务楼分层企业） -->
  <NativeDrawer
    :open="drawerOpen && !!buildingDetail"
    variant="wide"
    :title="buildingDetail ? `${buildingDetail.title} · 立体楼栋档案` : ''"
    :subtitle="buildingDetail ? `${buildingDetail.gridName} · 网格长 ${buildingDetail.gridLead} · 专职网格员 ${buildingDetail.gridStaff}（${buildingDetail.staffPhone}）` : ''"
    @close="drawerOpen = false"
  >
    <div v-if="buildingDetail" class="bpd-body">
      <!-- 18 层完整高层住宅立体剖面 -->
      <template v-if="buildingDetail.mode === 'residential-full'">
        <div class="bpd-legend">
          <span><i class="dot self"></i>自住</span>
          <span><i class="dot rent"></i>出租</span>
          <span><i class="dot vacant"></i>空置</span>
          <span><i class="dot care"></i>重点关怀（独居/优抚/残障）</span>
          <span><i class="dot hazard"></i>存在安全隐患</span>
        </div>

        <div class="bpd-split">
          <div class="bpd-matrix-col">
            <div class="bpd-unit-head">
              <span>楼层</span>
              <span>一单元（01 / 02 室）</span>
              <span>二单元（01 / 02 室）</span>
            </div>
            <div class="bpd-matrix-rows">
              <div v-for="row in fullResFloors" :key="row.floor" class="bpd-m-row">
                <strong class="bpd-m-fl num">{{ row.floor }} 层</strong>
                <div class="bpd-m-unit">
                  <button
                    v-for="rm in row.u1"
                    :key="rm.key"
                    type="button"
                    class="bpd-cell"
                    :class="[roomTone(rm), { active: selectedRoomKey === rm.key }]"
                    @click="selectedRoomKey = rm.key"
                  >
                    <b class="num">{{ rm.room }}</b>
                    <span>{{ rm.owner }}</span>
                    <em v-if="rm.hazard">隐患</em>
                    <em v-else-if="rm.careTags?.length">{{ rm.careTags[0].slice(0, 2) }}</em>
                  </button>
                </div>
                <div class="bpd-m-unit">
                  <button
                    v-for="rm in row.u2"
                    :key="rm.key"
                    type="button"
                    class="bpd-cell"
                    :class="[roomTone(rm), { active: selectedRoomKey === rm.key }]"
                    @click="selectedRoomKey = rm.key"
                  >
                    <b class="num">{{ rm.room }}</b>
                    <span>{{ rm.owner }}</span>
                    <em v-if="rm.hazard">隐患</em>
                    <em v-else-if="rm.careTags?.length">{{ rm.careTags[0].slice(0, 2) }}</em>
                  </button>
                </div>
              </div>
            </div>

            <!-- 底商与 B1 地下车库 -->
            <div v-if="buildingDetail.profile.shops?.length" class="bpd-sub-sec">
              <h4>一层沿街底商（燃气与消防巡查）</h4>
              <div class="bpd-shop-grid">
                <div v-for="sh in buildingDetail.profile.shops" :key="sh.id" class="bpd-shop-card" :class="{ warn: sh.hazard }">
                  <strong>{{ sh.door }} · {{ sh.name }}</strong>
                  <span>负责人 {{ sh.owner }} · {{ sh.phone }}</span>
                  <em>{{ sh.hazard || sh.gasAlarm }}</em>
                </div>
              </div>
            </div>

            <div v-if="buildingDetail.profile.basement" class="bpd-sub-sec">
              <h4>{{ buildingDetail.profile.basement.name }}</h4>
              <div class="bpd-b1-row num">
                <span>车位总数：<b>{{ buildingDetail.profile.basement.parkingTotal }}</b></span>
                <span>集中充电口：<b>{{ buildingDetail.profile.basement.chargingPorts }}</b></span>
                <span>消防管网水压：<b>{{ buildingDetail.profile.basement.firePressure }}</b></span>
                <span>烟感物联：<b>{{ buildingDetail.profile.basement.smokeSensors }}</b></span>
              </div>
            </div>
          </div>

          <aside class="bpd-detail-col">
            <template v-if="selectedRoomObj">
              <div class="bpd-d-head">
                <h4>{{ selectedRoomObj.key || `${selectedRoomObj.room}室` }}</h4>
                <span class="tag" :class="selectedRoomObj.hazard ? 'st-bad' : 'st-ok'">{{ selectedRoomObj.status }}</span>
              </div>
              <dl class="bpd-kv">
                <div><dt>户主姓名</dt><dd>{{ selectedRoomObj.owner }}</dd></div>
                <div><dt>联系电话</dt><dd class="num">{{ selectedRoomObj.phone }}</dd></div>
                <div><dt>常住人口</dt><dd class="num">{{ selectedRoomObj.peopleCount }} 人</dd></div>
                <div v-if="selectedRoomObj.tenant"><dt>租住人员</dt><dd>{{ selectedRoomObj.tenant }}</dd></div>
                <div><dt>最近核验</dt><dd class="num">{{ selectedRoomObj.lastVerify || '2026-11-18' }}（{{ selectedRoomObj.verifier || buildingDetail.gridStaff }}）</dd></div>
              </dl>
              <div v-if="selectedRoomObj.careTags?.length" class="bpd-tags">
                <span v-for="tg in selectedRoomObj.careTags" :key="tg" class="bp-pill care">{{ tg }}</span>
              </div>
              <div v-if="selectedRoomObj.hazard" class="bpd-alert-box">
                <ShieldAlert :size="14" />
                <span>现存隐患：{{ selectedRoomObj.hazard }}</span>
              </div>
              <div v-if="selectedRoomObj.careLogs?.length" class="bpd-logs">
                <h5>入户核验与关怀台账</h5>
                <div v-for="(lg, idx) in selectedRoomObj.careLogs" :key="idx" class="bpd-log-item">
                  <div class="num">{{ lg.time }} · {{ lg.operator }}</div>
                  <strong>{{ lg.action }}</strong>
                  <p>{{ lg.reason }}</p>
                </div>
              </div>
              <button
                type="button"
                class="btn primary"
                style="width: 100%; margin-top: 12px; justify-content: center"
                @click="drawerOpen = false; openQuickCreate(selectedRoomObj.room)"
              >
                <PlusCircle :size="14" /> 针对该户发起专项核查单
              </button>
            </template>
            <div v-else class="bpd-empty">点击左侧任意房号查阅“以房管人”明细与核验记录</div>
          </aside>
        </div>
      </template>

      <!-- 商务写字楼分层完整台账（直接复用系统宣瓷三线表 .table-wrapper） -->
      <template v-else-if="buildingDetail.mode === 'commercial-full' || buildingDetail.mode === 'commercial-lite'">
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>楼层</th>
                <th>入驻企业 / 载体名称</th>
                <th>所属行业</th>
                <th style="text-align: right">员工数</th>
                <th style="text-align: right">年度产值</th>
                <th>安全体检</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(fl, idx) in (buildingDetail.mode === 'commercial-full' ? buildingDetail.profile.floors : buildingDetail.generatedFloors)"
                :key="idx"
              >
                <td class="num"><strong>{{ fl.floor }}</strong></td>
                <td>{{ fl.company }}</td>
                <td>{{ fl.industry }}</td>
                <td class="num" style="text-align: right">{{ fl.employees }} 人</td>
                <td class="num" style="text-align: right"><strong>{{ fl.revenue }}</strong></td>
                <td>
                  <span class="tag" :class="fl.safety !== '达标' ? 'st-bad' : 'st-ok'">{{ fl.safety }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- 沿街商圈九小场所全段台账 -->
      <template v-else-if="buildingDetail.mode === 'district-full'">
        <div class="bpd-shop-grid two-col">
          <div
            v-for="sp in [...buildingDetail.profile.northShops, ...buildingDetail.profile.southShops]"
            :key="sp.door"
            class="bpd-shop-card"
            :class="{ warn: sp.safety.includes('重点') || sp.events > 0 }"
          >
            <div class="bpd-shop-top">
              <strong>{{ sp.door }} · {{ sp.name }}</strong>
              <span class="tag" :class="sp.safety.includes('重点') || sp.events > 0 ? 'st-wait' : 'st-ok'">{{ sp.type }}</span>
            </div>
            <span>经营状态：{{ sp.status }}</span>
            <em>{{ sp.safety }}</em>
          </div>
        </div>
      </template>

      <!-- 普通住宅楼栋自动建档剖面 -->
      <template v-else>
        <div class="bpd-legend">
          <span><i class="dot self"></i>自住</span>
          <span><i class="dot rent"></i>出租</span>
          <span><i class="dot vacant"></i>空置</span>
          <span><i class="dot care"></i>重点关怀</span>
          <span><i class="dot hazard"></i>安全关注</span>
        </div>
        <div class="bpd-matrix-rows">
          <div v-for="row in buildingDetail.generatedFloors" :key="row.floor" class="bpd-m-row simple">
            <strong class="bpd-m-fl num">{{ row.floor }} 层</strong>
            <div class="bpd-m-unit">
              <div v-for="rm in row.rooms" :key="rm.room" class="bpd-cell" :class="roomTone(rm)">
                <b class="num">{{ rm.room }}</b>
                <span>{{ rm.owner }}（{{ rm.peopleCount }}人）</span>
                <em v-if="rm.hazard" class="em-bad">{{ rm.hazard }}</em>
                <em v-else-if="rm.careTags?.length" class="em-care">{{ rm.careTags[0] }}</em>
                <em v-else class="em-plain">{{ rm.status }}</em>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <template #footer>
      <div class="bpd-foot">
        <span class="bpd-foot-note">
          <CheckCircle2 :size="13" style="vertical-align: -2px; margin-right: 4px; color: var(--status-ok)" />
          数据源自街道国产信创独立人口房屋库 · 实时联动网格处置台
        </span>
        <div style="display: inline-flex; gap: 8px">
          <button type="button" class="btn" @click="drawerOpen = false">关闭</button>
          <button type="button" class="btn primary" @click="drawerOpen = false; openQuickCreate()">
            发起本楼排查工单
          </button>
        </div>
      </div>
    </template>
  </NativeDrawer>
</template>

<style scoped>
.bp-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--ck-ink);
}

/* ── 顶部楼栋 / 实体名片头（与左侧驾驶舱同源朱印竖标与红金渐隐底线） ── */
.bp-head {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 0 9px 10px;
}
.bp-head::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  width: 3px;
  height: 18px;
  border-radius: 1.5px;
  background: linear-gradient(180deg, var(--ck-subhead-anchor, var(--primary)), var(--primary));
}
.bp-head::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1.5px;
  background: linear-gradient(
    90deg,
    var(--ck-plaque-rule-a, var(--primary)) 0%,
    var(--ck-plaque-rule-b, var(--ck-line)) 62%,
    transparent 100%
  );
  pointer-events: none;
}
.bp-head-text {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.bp-title {
  font-size: 14.5px;
  font-weight: 720;
  color: var(--ck-ink);
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bp-sub {
  font-size: 11px;
  font-weight: 500;
  color: var(--ck-muted);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bp-head-ops {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.bp-icon-btn {
  width: 26px;
  height: 26px;
  border-radius: var(--r-xs);
  border: var(--hair) solid var(--ck-line);
  background: rgba(128, 148, 170, 0.08);
  color: var(--ck-muted);
  display: inline-grid;
  place-items: center;
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}
.bp-icon-btn:hover {
  color: var(--ck-ink);
  border-color: color-mix(in srgb, var(--primary) 45%, var(--ck-border));
  background: rgba(128, 148, 170, 0.15);
}

/* ── 统一内容区块容器与标题条 ── */
.bp-sec {
  padding: 9px 0;
  border-top: var(--hair) solid var(--ck-line);
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}
.bp-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 22px;
}
.bp-sec-label {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ck-ink);
  white-space: nowrap;
}
.bp-sec-note {
  font-size: 11px;
  font-weight: 600;
  color: var(--ck-muted);
  white-space: nowrap;
}
.bp-sec-badge-bad {
  font-size: 11px;
  font-weight: 700;
  color: var(--ck-danger);
  white-space: nowrap;
}

/* 精工幽灵胶囊操作按钮（彻底替代未应用样式的原生按钮） */
.bp-action-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: 22px;
  padding: 0 8px;
  border-radius: var(--r-xs);
  border: var(--hair) solid color-mix(in srgb, var(--primary) 26%, var(--ck-line));
  background: color-mix(in srgb, var(--primary) 8%, transparent);
  color: var(--brand-text, var(--primary));
  font-size: 11px;
  font-weight: 650;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.14s ease, border-color 0.14s ease, color 0.14s ease;
}
.bp-action-pill:hover {
  background: color-mix(in srgb, var(--primary) 14%, transparent);
  border-color: color-mix(in srgb, var(--primary) 46%, var(--ck-line));
}

/* 精工分段切换器（一单元 / 二单元） */
.bp-seg-tabs {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: var(--r-xs);
  border: var(--hair) solid var(--ck-line);
  background: rgba(128, 148, 170, 0.10);
}
.bp-seg-tabs button {
  height: 20px;
  padding: 0 8px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--ck-muted);
  font-size: 11px;
  font-weight: 650;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease;
}
.bp-seg-tabs button:hover:not(.active) {
  color: var(--ck-ink);
}
.bp-seg-tabs button.active {
  background: var(--primary);
  color: var(--on-primary);
}

/* ── 核心底数 4 格 & 在岗网格员 3 格（宣瓷/曜石高秩序网格） ── */
.bp-quad-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 5px;
}
.bp-quad-cell {
  position: relative;
  overflow: hidden;
  border: var(--hair) solid var(--ck-line);
  border-radius: var(--r-xs);
  background: rgba(128, 148, 170, 0.075);
  padding: 6px 4px 5px;
  text-align: center;
  color: var(--ck-ink);
  transition: border-color 0.14s ease, background-color 0.14s ease;
}
.bp-quad-cell span {
  display: block;
  font-size: 10px;
  font-weight: 500;
  color: var(--ck-muted);
  white-space: nowrap;
  line-height: 1.2;
}
.bp-quad-cell strong {
  display: block;
  font-size: 15px;
  font-weight: 720;
  color: var(--ck-ink);
  margin-top: 3px;
  line-height: 1.1;
}
.bp-quad-cell strong small {
  font-size: 10px;
  font-weight: 500;
  color: var(--ck-muted);
  margin-left: 1px;
}
.bp-quad-cell.is-care {
  border-color: color-mix(in srgb, var(--ck-accent) 28%, var(--ck-line));
  background: color-mix(in srgb, var(--ck-accent) 7%, rgba(128, 148, 170, 0.05));
}
.bp-quad-cell.is-care strong {
  color: var(--ck-accent);
}
.bp-quad-cell.is-danger {
  border-color: color-mix(in srgb, var(--ck-danger) 36%, var(--ck-line));
  background: color-mix(in srgb, var(--ck-danger) 9%, rgba(128, 148, 170, 0.04));
}
.bp-quad-cell.is-danger::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 2px;
  background: var(--ck-danger);
}
.bp-quad-cell.is-danger strong {
  color: var(--ck-danger);
}
.bp-quad-cell.is-safe strong {
  color: var(--ck-ok);
}

.bp-trio-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.bp-trio-cell {
  border: var(--hair) solid var(--ck-line);
  border-radius: var(--r-xs);
  background: rgba(128, 148, 170, 0.075);
  padding: 6px 7px;
  text-align: left;
  color: var(--ck-ink);
  min-width: 0;
}
.bp-trio-cell span {
  display: block;
  font-size: 10px;
  color: var(--ck-muted);
  white-space: nowrap;
}
.bp-trio-cell strong {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13.5px;
  font-weight: 720;
  color: var(--ck-ink);
  margin-top: 3px;
  line-height: 1.15;
  white-space: nowrap;
}
.bp-trio-cell strong small {
  font-size: 10px;
  font-weight: 500;
  color: var(--ck-muted);
  margin-left: 1px;
}
.bp-trio-cell.is-safe strong {
  font-size: 12.5px;
  color: var(--ck-ok);
}
.bp-live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ck-ok);
  flex-shrink: 0;
}

/* ── 网格责任人信息条 ── */
.bp-owner-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 8px;
  border-radius: var(--r-xs);
  border: var(--hair) solid var(--ck-line);
  background: rgba(128, 148, 170, 0.06);
  font-size: 10.5px;
  color: var(--ck-muted);
  min-width: 0;
}
.bp-owner-names {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bp-owner-names > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bp-owner-tel {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  white-space: nowrap;
  color: var(--ck-ink);
  font-weight: 600;
}

.bp-task-card {
  padding: 7px 9px;
  border-radius: var(--r-xs);
  border: var(--hair) solid var(--ck-line);
  background: rgba(128, 148, 170, 0.06);
  display: grid;
  gap: 3px;
}
.bp-task-label {
  font-size: 10px;
  font-weight: 650;
  color: var(--ck-faint);
}

.bp-scroll-sec {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
}
.bp-scroll-sec::-webkit-scrollbar {
  display: none;
}

/* ── 楼层房态快查（宣瓷克制美学：素面卡片 + 微状态芯片 + 左侧 3px 朱印落印选中态） ── */
.bp-floor-grid {
  display: grid;
  gap: 5px;
}
.bp-floor-row {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
}
.bp-fl-no {
  font-size: 10.5px;
  font-weight: 650;
  color: var(--ck-faint);
  text-align: right;
  white-space: nowrap;
}
.bp-room-pair {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
}
.bp-room-cell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  height: 29px;
  padding: 0 7px 0 8px;
  border-radius: var(--r-xs);
  border: var(--hair) solid var(--ck-line);
  background: var(--ck-panel-solid);
  color: var(--ck-ink);
  font-size: 11px;
  cursor: pointer;
  transition: border-color 0.14s ease, background-color 0.14s ease, box-shadow 0.14s ease;
}
.bp-room-cell:hover {
  border-color: color-mix(in srgb, var(--primary) 38%, var(--ck-border));
}
.bp-room-cell strong {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--ck-ink);
}
.bp-rm-state {
  font-size: 9.5px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  background: rgba(128, 148, 170, 0.11);
  color: var(--ck-muted);
  line-height: 1.3;
  white-space: nowrap;
}
.bp-room-cell.is-vacant {
  background: rgba(128, 148, 170, 0.055);
  border-style: dashed;
}
.bp-room-cell.is-vacant strong {
  color: var(--ck-muted);
}
.bp-room-cell.is-rent strong {
  color: var(--ck-run);
}
.bp-room-cell.is-rent .bp-rm-state {
  background: color-mix(in srgb, var(--ck-run) 12%, transparent);
  color: var(--ck-run);
}
.bp-room-cell.is-care {
  border-left: 2.5px solid var(--ck-warn);
}
.bp-room-cell.is-care .bp-rm-state {
  background: color-mix(in srgb, var(--ck-warn) 14%, transparent);
  color: var(--ck-warn);
  font-weight: 650;
}
.bp-room-cell.is-hazard {
  border-left: 2.5px solid var(--ck-danger);
  background: color-mix(in srgb, var(--ck-danger) 7%, var(--ck-panel-solid));
}
.bp-room-cell.is-hazard .bp-rm-state {
  background: color-mix(in srgb, var(--ck-danger) 15%, transparent);
  color: var(--ck-danger);
  font-weight: 700;
}
/* 选中态：温润雪瓷高光底 + 左侧 3px 朱印落印 + 柔和外边，告别生硬大红双框 */
.bp-room-cell.active {
  border-style: solid;
  border-color: color-mix(in srgb, var(--primary) 52%, var(--ck-border));
  background: color-mix(in srgb, var(--primary) 7%, var(--ck-panel-solid));
  box-shadow: inset 3px 0 0 var(--primary), 0 2px 6px rgba(24, 20, 18, 0.06);
}
.bp-room-cell.active strong {
  color: var(--brand-text, var(--primary));
}

/* ── 当前选中房间「一户一档」微卡 ── */
.bp-room-detail {
  margin-top: 3px;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  border: var(--hair) solid color-mix(in srgb, var(--primary) 22%, var(--ck-line));
  background: linear-gradient(180deg, color-mix(in srgb, var(--primary) 4%, var(--ck-panel-solid)), var(--ck-panel-solid));
  display: grid;
  gap: 5px;
}
.bp-rd-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 12px;
  color: var(--ck-ink);
}
.bp-rd-top strong {
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bp-rd-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--ck-muted);
}
.bp-rd-meta b {
  color: var(--ck-ink);
  font-weight: 650;
}
.bp-rd-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding-top: 2px;
}
.bp-sm-tag {
  flex-shrink: 0;
  font-size: 10px !important;
  padding: 1.5px 6px !important;
  line-height: 1.35 !important;
}
.bp-pill {
  padding: 2px 7px;
  border-radius: var(--r-tag);
  font-size: 10px;
  font-weight: 650;
}
.bp-pill.care {
  background: color-mix(in srgb, var(--ck-accent) 14%, transparent);
  color: var(--ck-accent);
}
.bp-pill.hazard {
  background: color-mix(in srgb, var(--ck-danger) 14%, transparent);
  color: var(--ck-danger);
}

/* ── 商务楼宇 / 商铺 / 周边关怀楼列表 ── */
.bp-biz-list {
  display: grid;
  gap: 5px;
}
.bp-biz-item {
  width: 100%;
  padding: 6px 8px;
  border-radius: var(--r-xs);
  border: var(--hair) solid var(--ck-line);
  background: rgba(128, 148, 170, 0.065);
  display: grid;
  gap: 2px;
  text-align: left;
  color: var(--ck-ink);
  transition: border-color 0.14s ease, background-color 0.14s ease;
}
.bp-biz-item.is-btn { cursor: pointer; }
.bp-biz-item.is-btn:hover {
  border-color: color-mix(in srgb, var(--primary) 42%, var(--ck-line));
  background: rgba(128, 148, 170, 0.12);
}
.bp-biz-item.warn {
  border-left: 2.5px solid var(--ck-danger);
}
.bp-biz-top {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  min-width: 0;
}
.bp-biz-top strong {
  color: var(--ck-accent);
  flex-shrink: 0;
  font-weight: 700;
}
.bp-biz-co {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
}
.bp-biz-top b {
  font-size: 10.5px;
  color: var(--ck-muted);
  flex-shrink: 0;
}
.bp-biz-sub {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--ck-muted);
}
.bp-biz-sub em { font-style: normal; font-weight: 600; }
.bp-biz-sub em.is-ok { color: var(--ck-ok); }
.bp-biz-sub em.is-warn { color: var(--ck-danger); }

/* ── 本楼在办事项（严格防右边界溢出裁切） ── */
.bp-ev-list {
  display: grid;
  gap: 5px;
  min-width: 0;
}
.bp-ev-row {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--r-xs);
  border: var(--hair) solid color-mix(in srgb, var(--ck-danger) 34%, var(--ck-line));
  background: color-mix(in srgb, var(--ck-danger) 7%, transparent);
  color: var(--ck-ink);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.14s ease, border-color 0.14s ease;
}
.bp-ev-row:hover {
  background: color-mix(in srgb, var(--ck-danger) 12%, transparent);
}
.bp-ev-title {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
}

/* ── 300 米应急联动区 ── */
.bp-emg-strip {
  display: grid;
  gap: 5px;
}
.bp-emg-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--r-xs);
  border: var(--hair) solid var(--ck-line);
  background: rgba(128, 148, 170, 0.065);
  min-width: 0;
}
.bp-emg-info {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 1px;
}
.bp-emg-info strong {
  font-size: 11px;
  font-weight: 650;
  color: var(--ck-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bp-emg-info span {
  font-size: 10px;
  color: var(--ck-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bp-emg-note {
  font-size: 10.5px;
  color: var(--ck-muted);
  padding: 3px 7px;
  border-left: 2px solid var(--ck-accent);
  background: rgba(128, 148, 170, 0.045);
  border-radius: 0 var(--r-xs) var(--r-xs) 0;
}
.bp-emg-note b { color: var(--ck-ink); }

.bp-mini-act {
  flex-shrink: 0;
  height: 24px;
  padding: 0 9px;
  border-radius: var(--r-xs);
  border: var(--hair) solid color-mix(in srgb, var(--primary) 55%, transparent);
  background: var(--primary-soft);
  color: var(--brand-text, var(--primary));
  font-size: 10.5px;
  font-weight: 650;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}
.bp-mini-act:hover:not(:disabled) {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary);
}
.bp-mini-act:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ── 底部业务操作栏 ── */
.bp-foot-actions {
  display: flex;
  gap: 6px;
  padding-top: 9px;
  margin-top: auto;
  border-top: var(--hair) solid var(--ck-line);
}
.bp-foot-actions .ck-btn {
  flex: 1;
  height: 32px;
  padding: 0 6px;
  font-size: 11.5px;
  justify-content: center;
  white-space: nowrap;
}

/* ── 快捷发起排查工单内联表单（独占中部呼吸空间，杜绝挤压裁切） ── */
.bp-create-box {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
  gap: 8px;
}
.bp-create-box::-webkit-scrollbar {
  display: none;
}
.bp-field-label {
  font-size: 10.5px;
  font-weight: 650;
  color: var(--ck-muted);
  margin-bottom: -3px;
}
.bp-cat-pills {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 5px;
}
.bp-cat-pills button {
  height: 26px;
  border-radius: var(--r-xs);
  border: var(--hair) solid var(--ck-line);
  background: rgba(128, 148, 170, 0.075);
  color: var(--ck-muted);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}
.bp-cat-pills button:hover:not(.active) {
  color: var(--ck-ink);
  border-color: var(--ck-border);
}
.bp-cat-pills button.active {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary);
}
.bp-input {
  width: 100%;
  box-sizing: border-box;
  border-radius: var(--r-xs);
  border: var(--hair) solid var(--ck-border);
  background: var(--ck-panel-solid);
  color: var(--ck-ink);
  font-size: 12px;
  padding: 7px 9px;
  font-family: inherit;
  line-height: 1.45;
  resize: none;
}
.bp-input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--primary-soft);
}
.bp-create-hint {
  font-size: 10.5px;
  color: var(--ck-faint);
  line-height: 1.45;
  padding: 5px 8px;
  border-radius: var(--r-xs);
  background: rgba(128, 148, 170, 0.06);
  border-left: 2px solid var(--ck-accent);
}
.bp-create-foot {
  display: flex;
  gap: 6px;
  margin-top: auto;
  padding-top: 6px;
}
.bp-create-foot .ck-btn {
  flex: 1;
  height: 34px;
  padding: 0 10px;
  font-size: 12px;
  white-space: nowrap;
}

.bp-desc {
  font-size: 11.5px;
  color: var(--ck-muted);
  line-height: 1.5;
  margin: 0;
}

.bp-aid-rows {
  display: grid;
  gap: 6px;
}
.bp-aid-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 9px;
  border-radius: var(--r-xs);
  border: var(--hair) solid var(--ck-line);
  background: rgba(128, 148, 170, 0.065);
}
.bp-aid-name {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  color: var(--ck-ink);
}
.bp-aid-name strong { font-size: 14.5px; font-weight: 700; }
.bp-aid-name small { font-size: 10.5px; color: var(--ck-muted); font-weight: 500; }

.bp-eco-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-radius: var(--r-xs);
  font-size: 12px;
}
.bp-eco-badge.flood {
  background: color-mix(in srgb, var(--ck-run) 14%, transparent);
  color: var(--ck-run);
}
.bp-eco-badge.fire {
  background: color-mix(in srgb, var(--ck-warn) 14%, transparent);
  color: var(--ck-warn);
}

/* ── 深色大屏（曜石暖金 & command-dark）精修适配 ── */
:global(body.cockpit-dark) .bp-quad-cell,
:global(body.cockpit-dark) .bp-trio-cell,
:global(body.cockpit-dark) .bp-owner-bar,
:global(body.cockpit-dark) .bp-task-card,
:global(body.cockpit-dark) .bp-biz-item,
:global(body.cockpit-dark) .bp-emg-row,
:global(body.cockpit-dark) .bp-aid-row,
:global(html[data-preset="command-dark"]) .bp-quad-cell,
:global(html[data-preset="command-dark"]) .bp-trio-cell,
:global(html[data-preset="command-dark"]) .bp-owner-bar,
:global(html[data-preset="command-dark"]) .bp-task-card,
:global(html[data-preset="command-dark"]) .bp-biz-item,
:global(html[data-preset="command-dark"]) .bp-emg-row,
:global(html[data-preset="command-dark"]) .bp-aid-row {
  background: rgba(255, 255, 255, 0.048);
}
:global(body.cockpit-dark) .bp-room-cell,
:global(html[data-preset="command-dark"]) .bp-room-cell {
  background: rgba(255, 255, 255, 0.045);
}
:global(body.cockpit-dark) .bp-room-cell.is-vacant,
:global(html[data-preset="command-dark"]) .bp-room-cell.is-vacant {
  background: rgba(255, 255, 255, 0.02);
}
:global(body.cockpit-dark) .bp-room-cell.active,
:global(html[data-preset="command-dark"]) .bp-room-cell.active {
  border-color: rgba(232, 204, 154, 0.52);
  background: rgba(200, 30, 43, 0.20);
  box-shadow: inset 3px 0 0 #e8c484, 0 2px 8px rgba(0, 0, 0, 0.28);
}
:global(body.cockpit-dark) .bp-room-cell.active strong,
:global(html[data-preset="command-dark"]) .bp-room-cell.active strong {
  color: #fde8c2;
}
:global(body.cockpit-dark) .bp-room-detail,
:global(html[data-preset="command-dark"]) .bp-room-detail {
  background: rgba(255, 255, 255, 0.055);
  border-color: rgba(232, 204, 154, 0.22);
}
:global(body.cockpit-dark) .bp-action-pill,
:global(html[data-preset="command-dark"]) .bp-action-pill {
  background: rgba(232, 204, 154, 0.10);
  border-color: rgba(232, 204, 154, 0.28);
  color: #f3d7a0;
}
:global(body.cockpit-dark) .bp-action-pill:hover,
:global(html[data-preset="command-dark"]) .bp-action-pill:hover {
  background: rgba(232, 204, 154, 0.18);
  border-color: rgba(232, 204, 154, 0.48);
}
:global(body.cockpit-dark) .bp-mini-act,
:global(html[data-preset="command-dark"]) .bp-mini-act {
  color: #fde8c2;
  border-color: rgba(243, 215, 160, 0.55);
  background: rgba(200, 30, 43, 0.34);
}
:global(body.cockpit-dark) .bp-mini-act:hover:not(:disabled),
:global(html[data-preset="command-dark"]) .bp-mini-act:hover:not(:disabled) {
  background: var(--primary);
  border-color: var(--primary);
  color: #ffffff;
}

/* ── 宽抽屉立体剖面样式（100% 对齐 rui-original.css 宣瓷素雅与曜石暖金组件库令牌） ── */
.bpd-body {
  display: grid;
  gap: 16px;
}
.bpd-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 8px 12px;
  border-radius: var(--r-md);
  background: var(--sunken);
  border: 1px solid var(--line);
  font-size: 12px;
  color: var(--ink-muted);
}
.bpd-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.bpd-legend .dot {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  display: inline-block;
  border: 1px solid var(--line-strong);
}
.bpd-legend .dot.self { background: var(--surface); }
.bpd-legend .dot.rent { background: var(--surface); border-color: var(--status-run); }
.bpd-legend .dot.vacant { background: var(--sunken); border-style: dashed; }
.bpd-legend .dot.care { background: var(--status-wait-soft); border-left: 3px solid var(--status-wait); }
.bpd-legend .dot.hazard { background: var(--status-bad-soft); border-left: 3px solid var(--status-bad); }

.bpd-split {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) 292px;
  gap: 16px;
  align-items: start;
}
.bpd-matrix-col {
  display: grid;
  gap: 12px;
}
.bpd-unit-head {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-muted);
  padding: 8px 6px;
  background: var(--sunken);
  border-top: 1.5px solid var(--ink);
  border-bottom: 1px solid var(--line-strong);
}
.bpd-matrix-rows {
  display: grid;
  gap: 6px;
  max-height: 430px;
  overflow-y: auto;
  padding-right: 4px;
}
.bpd-m-row {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}
.bpd-m-row.simple {
  grid-template-columns: 54px minmax(0, 1fr);
}
.bpd-m-fl {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-soft);
  padding-left: 4px;
}
.bpd-m-unit {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
/* 克制素瓷房格：红只落印不刷墙，仅关怀与隐患户施以左侧 3px 语义色条 */
.bpd-cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 9px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--ink);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.14s ease, background-color 0.14s ease, box-shadow 0.14s ease;
}
.bpd-cell:hover {
  border-color: var(--primary);
  background: var(--state-hover);
}
.bpd-cell b {
  font-weight: 700;
  color: var(--ink);
  flex-shrink: 0;
}
.bpd-cell span {
  flex: 1;
  color: var(--ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bpd-cell em {
  font-style: normal;
  font-size: 10.5px;
  font-weight: 650;
  padding: 1px 6px;
  border-radius: var(--r-tag);
  white-space: nowrap;
  flex-shrink: 0;
}
.bpd-cell.is-rent b {
  color: var(--status-run);
}
.bpd-cell.is-vacant {
  background: var(--sunken);
  border-style: dashed;
  color: var(--ink-faint);
}
.bpd-cell.is-vacant b,
.bpd-cell.is-vacant span {
  color: var(--ink-faint);
}
.bpd-cell.is-care {
  border-left: 3px solid var(--status-wait);
}
.bpd-cell.is-care em,
.bpd-cell .em-care {
  background: color-mix(in srgb, var(--status-wait) 16%, var(--surface));
  color: var(--status-wait);
}
.bpd-cell.is-hazard {
  border-left: 3px solid var(--status-bad);
  background: color-mix(in srgb, var(--status-bad) 9%, var(--surface));
}
.bpd-cell.is-hazard em,
.bpd-cell .em-bad {
  background: color-mix(in srgb, var(--status-bad) 16%, var(--surface));
  color: var(--status-bad);
}
.bpd-cell .em-plain {
  background: var(--sunken);
  color: var(--ink-soft);
}
.bpd-cell.active {
  border-color: var(--primary);
  background: var(--primary-soft);
  box-shadow: inset 0 0 0 1px var(--primary);
}

.bpd-sub-sec {
  padding-top: 12px;
  border-top: 1px solid var(--line);
  display: grid;
  gap: 8px;
}
.bpd-sub-sec h4 {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
}
.bpd-shop-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.bpd-shop-card {
  padding: 10px 12px;
  border-radius: var(--r-md);
  border: 1px solid var(--line-strong);
  background: var(--sunken);
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--ink);
}
.bpd-shop-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.bpd-shop-card.warn {
  border-left: 3px solid var(--status-bad);
}
.bpd-shop-card span {
  font-size: 11.5px;
  color: var(--ink-soft);
}
.bpd-shop-card em {
  font-style: normal;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink-muted);
}

.bpd-b1-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  padding: 10px 14px;
  border-radius: var(--r-md);
  background: var(--sunken);
  border: 1px solid var(--line-strong);
  font-size: 12px;
  color: var(--ink-soft);
}
.bpd-b1-row b {
  color: var(--ink);
  font-weight: 650;
}

.bpd-detail-col {
  padding: 14px 16px;
  border-radius: var(--r-card);
  border: 1px solid var(--line-strong);
  background: var(--sunken);
  position: sticky;
  top: 0;
}
.bpd-d-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 10px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--line);
}
.bpd-d-head h4 {
  font-size: 14.5px;
  font-weight: 700;
  color: var(--ink);
}
.bpd-kv {
  display: grid;
  gap: 7px;
  font-size: 12.5px;
}
.bpd-kv > div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--line);
}
.bpd-kv dt {
  color: var(--ink-soft);
  flex-shrink: 0;
}
.bpd-kv dd {
  font-weight: 600;
  color: var(--ink);
  text-align: right;
}
.bpd-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.bpd-alert-box {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  border: 1px solid color-mix(in srgb, var(--status-bad) 30%, transparent);
  background: var(--status-bad-soft);
  color: var(--status-bad);
  font-size: 12px;
  font-weight: 650;
  display: flex;
  align-items: center;
  gap: 6px;
}
.bpd-logs {
  margin-top: 12px;
  display: grid;
  gap: 6px;
}
.bpd-logs h5 {
  font-size: 12px;
  font-weight: 700;
  color: var(--ink-muted);
}
.bpd-log-item {
  padding: 8px 10px;
  border-radius: var(--r-sm);
  background: var(--surface);
  border: 1px solid var(--line);
  font-size: 11.5px;
  display: grid;
  gap: 3px;
  color: var(--ink);
}
.bpd-log-item div {
  font-size: 10.5px;
  color: var(--ink-faint);
}
.bpd-log-item p {
  color: var(--ink-soft);
}
.bpd-empty {
  font-size: 12px;
  color: var(--ink-soft);
  padding: 28px 10px;
  text-align: center;
}

.bpd-foot {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.bpd-foot-note {
  font-size: 12px;
  color: var(--ink-soft);
}

@media (max-width: 768px) {
  .bpd-split {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .bpd-detail-col {
    position: static;
    padding: 12px;
  }
  .bpd-matrix-col {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .bpd-unit-head,
  .bpd-m-row:not(.simple) {
    min-width: 480px;
  }
  .bpd-matrix-rows {
    max-height: 360px;
  }
  .bpd-shop-grid {
    grid-template-columns: 1fr;
  }
  .bpd-foot {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .bp-quad-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .bp-cat-pills {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
