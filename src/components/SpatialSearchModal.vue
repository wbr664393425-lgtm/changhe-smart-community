<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { Search, X, MapPin, Building2, Users, AlertTriangle, Compass, CornerDownLeft } from 'lucide-vue-next'
import { COMMUNITIES, store, getCurrentRole } from '../store/appStore'

const props = defineProps({
  open: { type: Boolean, default: false },
  dark: { type: Boolean, default: false },
  loadBldgIdx: { type: Function, required: true },
  liveStaff: { type: Array, default: () => [] }
})

const emit = defineEmits(['close', 'select'])

const inputEl = ref(null)
const query = ref('')
const activeTab = ref('all') // all | community | building | staff | event | camera
const activeIdx = ref(0)
const indexMod = ref(null)
const entitiesCache = ref(null)

const TABS = [
  { key: 'all', label: '全部' },
  { key: 'community', label: '社区' },
  { key: 'building', label: '小区楼栋' },
  { key: 'staff', label: '网格员' },
  { key: 'event', label: '治理事项' },
  { key: 'camera', label: '实景视角' }
]

const CAMERA_SHORTCUTS = [
  { id: 'cam-bridge', kind: 'camera', preset: 'bridge', title: '岔河实景桥景', sub: '东方红路桥面与岔河实时倒影', badge: '低空机位' },
  { id: 'cam-park', kind: 'camera', preset: 'park', title: '长河公园大湖', sub: '滨河湖面与环湖生态林木群落', badge: '生态机位' },
  { id: 'cam-xingkai', kind: 'camera', preset: 'xingkai', title: '星凯商圈楼群', sub: '星凯国际广场与核心商务区', badge: '经济机位' },
  { id: 'cam-hero', kind: 'camera', preset: 'hero', title: '长河街道全景鸟瞰', sub: '全境十四社区与指挥中心总览', badge: '全景机位' }
]

const roleScope = computed(() => getCurrentRole().scope || '全街道')

watch(
  () => props.open,
  async (val) => {
    if (!val) return
    query.value = ''
    activeTab.value = 'all'
    activeIdx.value = 0
    await nextTick()
    inputEl.value?.focus()
    if (!indexMod.value) {
      const mod = await props.loadBldgIdx()
      indexMod.value = mod
      entitiesCache.value = mod.buildCockpitEntities(store)
    } else if (!entitiesCache.value) {
      entitiesCache.value = indexMod.value.buildCockpitEntities(store)
    }
  }
)

const pool = computed(() => {
  const sc = roleScope.value
  const allowComm = (cName) => sc === '全街道' || cName === sc
  const items = []

  // 1. 社区
  COMMUNITIES.forEach((c) => {
    if (!allowComm(c.name)) return
    const openHz = c.safety.hazards - c.safety.fixed
    const badge = openHz > 0 ? `待销 ${openHz}` : (c.health === 'bad' ? '督办' : c.safety.coverage >= 98 ? '标杆' : '平稳')
    items.push({
      id: `comm-${c.id}`,
      kind: 'community',
      title: c.name,
      sub: `网格 ${c.grids} 个 · 党员 ${c.party} 名 · 常住 ${c.pop.toLocaleString()} 人`,
      badge,
      tone: c.health === 'bad' ? 'bad' : openHz > 0 ? 'warn' : 'ok',
      searchText: `${c.name} ${c.name.replace('社区', '')} ${c.lead} 社区`,
      priority: c.health === 'bad' ? 95 : 80,
      payload: c.name
    })
  })

  // 2. 在办与近期治理事项
  ;(store.events || []).forEach((ev) => {
    if (!allowComm(ev.community)) return
    const isOpen = ev.stage !== '已办结'
    items.push({
      id: `ev-${ev.id}`,
      kind: 'event',
      title: ev.title,
      sub: `${ev.community} · ${ev.category} · ${ev.owner || '待派单'}`,
      badge: ev.stage,
      tone: isOpen ? (Number(ev.elapsedHours) > Number(ev.deadlineHours) ? 'bad' : 'warn') : 'ok',
      searchText: `${ev.title} ${ev.community} ${ev.category} ${ev.address || ''} ${ev.owner || ''}`,
      priority: isOpen ? 92 : 45,
      payload: ev
    })
  })

  // 3. 在岗网格员与重点点位
  const staffPool = props.liveStaff?.length ? props.liveStaff : entitiesCache.value?.gridStaff
  if (staffPool?.length) {
    staffPool.forEach((st) => {
      if (!allowComm(st.community)) return
      const subText = st.roadLabel ? `${st.grid} · ${st.roadLabel} · ${st.task}` : `${st.grid} · ${st.task}`
      const isAlert = st.status === '滞留提醒'
      items.push({
        id: `st-${st.id}`,
        kind: 'staff',
        title: `${st.name}（${st.community}）`,
        sub: subText,
        badge: isAlert && st.stayMinutes ? `滞留${st.stayMinutes}分` : st.status,
        tone: isAlert ? 'warn' : st.status === '在办处置' ? 'accent' : 'info',
        searchText: `${st.name} ${st.community} ${st.grid} ${st.task} ${st.roadLabel || ''} ${st.status} 网格员`,
        priority: isAlert ? 88 : 76,
        payload: st
      })
    })
  }
  if (entitiesCache.value) {
    entitiesCache.value.aidStations.forEach((aid) => {
      if (!allowComm(aid.community)) return
      items.push({
        id: `aid-${aid.id}`,
        kind: 'staff',
        title: aid.name,
        sub: `${aid.community} · 共享辅助站物资调拨`,
        badge: '辅助站',
        tone: 'ok',
        searchText: `${aid.name} ${aid.community} 辅助站 轮椅 急救箱`,
        priority: 62,
        payload: aid
      })
    })
    entitiesCache.value.ecoRisks.forEach((pt) => {
      if (!allowComm(pt.community)) return
      items.push({
        id: `eco-${pt.id}`,
        kind: 'staff',
        title: pt.name,
        sub: `${pt.community} · ${pt.status}`,
        badge: pt.kind === 'flood' ? '易涝点' : '防火点',
        tone: pt.kind === 'flood' ? 'info' : 'warn',
        searchText: `${pt.name} ${pt.community} ${pt.kind === 'flood' ? '易涝 积水 防汛' : '防火 林缘'}`,
        priority: 64,
        payload: pt
      })
    })
  }

  // 4. 标杆示范楼、小区中心楼与全街道 4,205 栋可命名建筑
  if (indexMod.value) {
    const idx = indexMod.value.getCockpitBuildingIndex()
    const seenBldg = new Set()
    ;(idx.landmarks || []).forEach((b) => {
      if (!allowComm(b.community)) return
      seenBldg.add(b.index)
      items.push({
        id: `lm-${b.index}`,
        kind: 'building',
        title: b.name,
        sub: `${b.community}${b.estate ? ' · ' + b.estate : ''} · 示范实景楼栋`,
        badge: '重点楼栋',
        tone: 'accent',
        searchText: `${b.name} ${b.estate || ''} ${b.community} ${b.gridName || ''}`,
        priority: 96,
        payload: b
      })
    })
    ;(idx.estateLandmarks || []).forEach((est) => {
      if (!allowComm(est.community) || seenBldg.has(est.buildingIndex)) return
      const b = idx.buildings[est.buildingIndex]
      if (!b) return
      seenBldg.add(b.index)
      items.push({
        id: `est-${est.id}`,
        kind: 'building',
        title: est.name,
        sub: `${est.community} · 共 ${est.count} 栋建筑群`,
        badge: '小区园区',
        tone: 'neutral',
        searchText: `${est.name} ${est.community} ${b.name}`,
        priority: 82,
        payload: b
      })
    })
    ;(idx.buildings || []).forEach((b) => {
      if (!b || !b.isInner || seenBldg.has(b.index) || !allowComm(b.community)) return
      items.push({
        id: `b-${b.index}`,
        kind: 'building',
        title: b.name,
        sub: `${b.community}${b.estate ? ' · ' + b.estate : ''} · ${b.gridName || '网格'}`,
        badge: b.baseHazard ? '重点核查' : '一楼一档',
        tone: b.baseHazard ? 'warn' : 'neutral',
        searchText: `${b.name} ${b.estate || ''} ${b.community}`,
        priority: b.baseHazard ? 68 : 40,
        payload: b
      })
    })
  }

  // 5. 实景视角
  if (sc === '全街道') {
    CAMERA_SHORTCUTS.forEach((cam) => {
      items.push({
        ...cam,
        tone: 'info',
        searchText: `${cam.title} ${cam.sub} 视角 机位`,
        priority: 72,
        payload: cam.preset
      })
    })
  }

  return items
})

const results = computed(() => {
  const kw = query.value.trim().toLowerCase()
  let list = pool.value
  if (activeTab.value !== 'all') {
    list = list.filter((it) => it.kind === activeTab.value)
  }

  if (!kw) {
    // 无关键词：精选高频直达项，保持简洁有序
    const curated = []
    const take = (fn, max) => {
      list.filter(fn).sort((a, b) => b.priority - a.priority).slice(0, max).forEach((x) => curated.push(x))
    }
    if (activeTab.value === 'all') {
      take((x) => x.kind === 'building' && x.priority >= 90, 3)
      take((x) => x.kind === 'event' && x.priority >= 90, 3)
      take((x) => x.kind === 'community', 3)
      take((x) => x.kind === 'camera', 3)
      return curated
    }
    return [...list].sort((a, b) => b.priority - a.priority).slice(0, 14)
  }

  const tokens = kw.split(/\s+/).filter(Boolean)
  const matched = []
  for (let i = 0; i < list.length; i++) {
    const it = list[i]
    const hay = it.searchText.toLowerCase()
    let ok = true
    for (let k = 0; k < tokens.length; k++) {
      if (!hay.includes(tokens[k])) {
        ok = false
        break
      }
    }
    if (!ok) continue
    const titleHit = it.title.toLowerCase().includes(kw) ? 30 : 0
    matched.push({ ...it, score: it.priority + titleHit })
    if (matched.length >= 60) break
  }
  return matched.sort((a, b) => b.score - a.score).slice(0, 14)
})

watch(results, () => {
  activeIdx.value = 0
})

function iconOf(kind) {
  if (kind === 'community') return MapPin
  if (kind === 'building') return Building2
  if (kind === 'staff') return Users
  if (kind === 'event') return AlertTriangle
  return Compass
}

function choose(item) {
  if (!item) return
  emit('select', item)
  emit('close')
}

function onInputKeydown(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (results.value.length) {
      activeIdx.value = (activeIdx.value + 1) % results.value.length
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (results.value.length) {
      activeIdx.value = (activeIdx.value - 1 + results.value.length) % results.value.length
    }
  } else if (e.key === 'Enter') {
    e.preventDefault()
    choose(results.value[activeIdx.value])
  } else if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ck-pop">
      <div
        v-if="open"
        class="sp-backdrop"
        :class="{ 'is-dark': dark }"
        @click="emit('close')"
      >
        <section
          class="sp-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="驾驶舱空间寻址检索"
          @click.stop
        >
          <div class="sp-input-row">
            <Search :size="16" class="sp-search-ico" />
            <input
              ref="inputEl"
              v-model="query"
              type="text"
              class="sp-input"
              placeholder="搜索社区、小区、楼栋名称、在岗网格员或治理事项…"
              @keydown="onInputKeydown"
            />
            <button v-if="query" type="button" class="sp-clear-btn" aria-label="清空" @click="query = ''">
              <X :size="14" />
            </button>
            <button type="button" class="sp-close-btn" aria-label="关闭检索" @click="emit('close')">
              关闭
            </button>
          </div>

          <div class="sp-tabs" role="tablist" aria-label="检索范围">
            <button
              v-for="tb in TABS"
              :key="tb.key"
              type="button"
              role="tab"
              :aria-selected="activeTab === tb.key"
              :class="{ active: activeTab === tb.key }"
              @click="activeTab = tb.key"
            >
              {{ tb.label }}
            </button>
          </div>

          <div class="sp-list-head">
            <span>{{ query.trim() ? `匹配结果（${results.length}）` : '汇报高频直达' }}</span>
            <span>点击或回车即刻飞抵定位</span>
          </div>

          <div class="sp-results">
            <button
              v-for="(item, idx) in results"
              :key="item.id"
              type="button"
              class="sp-row"
              :class="{ active: idx === activeIdx }"
              @mouseenter="activeIdx = idx"
              @click="choose(item)"
            >
              <span class="sp-row-ico"><component :is="iconOf(item.kind)" :size="14" /></span>
              <span class="sp-row-main">
                <strong>{{ item.title }}</strong>
                <small>{{ item.sub }}</small>
              </span>
              <em class="sp-row-badge" :class="'t-' + item.tone">{{ item.badge }}</em>
              <CornerDownLeft :size="13" class="sp-row-enter" />
            </button>
            <div v-if="!results.length" class="sp-empty">
              未找到匹配的社区、楼栋或事项，请尝试更换关键词
            </div>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 3200;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 88px 16px 24px;
  background: rgba(12, 16, 24, 0.42);
}

.sp-dialog {
  width: min(640px, 100%);
  max-height: min(540px, calc(100vh - 124px));
  display: flex;
  flex-direction: column;
  border-radius: var(--r-card, 12px);
  border: var(--hair, 1px) solid var(--ck-border, rgba(60, 48, 42, 0.22));
  border-top: 2px solid var(--primary, #b81c28);
  background: var(--ck-panel-solid, #ffffff);
  color: var(--ck-ink, #1c1818);
  box-shadow: var(--e3, 0 20px 48px rgba(0, 0, 0, 0.28));
  overflow: hidden;
  font-family: var(--font-sans, inherit);
}

.sp-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: var(--hair, 1px) solid var(--ck-line, rgba(60, 48, 42, 0.14));
}
.sp-search-ico {
  color: var(--primary, #b81c28);
  flex-shrink: 0;
}
.sp-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--ck-ink, #1c1818);
  font-size: 14px;
  font-weight: 560;
}
.sp-input::placeholder {
  color: var(--ck-faint, #8c827c);
}
.sp-clear-btn,
.sp-close-btn {
  border: var(--hair, 1px) solid var(--ck-line, rgba(60, 48, 42, 0.14));
  background: rgba(128, 148, 170, 0.08);
  color: var(--ck-muted, #5c524c);
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease;
}
.sp-clear-btn {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
}
.sp-close-btn {
  height: 26px;
  padding: 0 9px;
  font-size: 11.5px;
  font-weight: 600;
}
.sp-clear-btn:hover,
.sp-close-btn:hover {
  color: var(--ck-ink);
  background: rgba(128, 148, 170, 0.18);
}

.sp-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 14px;
  border-bottom: var(--hair, 1px) solid var(--ck-line, rgba(60, 48, 42, 0.12));
  overflow-x: auto;
  scrollbar-width: none;
}
.sp-tabs button {
  height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid transparent;
  background: rgba(128, 148, 170, 0.10);
  color: var(--ck-muted, #5c524c);
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.14s ease, color 0.14s ease;
}
.sp-tabs button.active {
  background: var(--primary, #b81c28);
  color: var(--on-primary, #ffffff);
}

.sp-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 14px 4px;
  font-size: 11px;
  color: var(--ck-faint, #8c827c);
}

.sp-results {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sp-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto 16px;
  align-items: center;
  gap: 8px;
  padding: 8px 8px;
  border-radius: 7px;
  border: 1px solid transparent;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease;
}
.sp-row.active,
.sp-row:hover {
  background: rgba(128, 148, 170, 0.12);
  border-color: color-mix(in srgb, var(--primary, #b81c28) 28%, var(--ck-line));
}
.sp-row-ico {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  background: var(--primary-soft, rgba(184, 28, 40, 0.10));
  color: var(--primary, #b81c28);
}
.sp-row-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sp-row-main strong {
  font-size: 12.5px;
  font-weight: 680;
  color: var(--ck-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sp-row-main small {
  font-size: 11px;
  color: var(--ck-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sp-row-badge {
  font-style: normal;
  font-size: 10.5px;
  font-weight: 650;
  padding: 2px 7px;
  border-radius: 4px;
  background: rgba(128, 148, 170, 0.14);
  color: var(--ck-muted);
  white-space: nowrap;
}
.sp-row-badge.t-bad { background: rgba(220, 38, 38, 0.14); color: var(--ck-danger, #dc2626); }
.sp-row-badge.t-warn { background: rgba(217, 119, 6, 0.14); color: var(--ck-warn, #d97706); }
.sp-row-badge.t-ok { background: rgba(22, 163, 74, 0.14); color: var(--ck-ok, #16a34a); }
.sp-row-badge.t-accent { background: var(--primary-soft); color: var(--primary); }
.sp-backdrop.is-dark .sp-row-badge.t-accent { background: rgba(220, 56, 68, 0.24); color: #fda4af; }
.sp-row-badge.t-info { background: rgba(14, 165, 233, 0.14); color: #0284c7; }
.sp-row-enter {
  color: var(--ck-faint);
  opacity: 0;
  transition: opacity 0.12s ease;
}
.sp-row.active .sp-row-enter {
  opacity: 1;
}

.sp-empty {
  padding: 28px 12px;
  text-align: center;
  font-size: 12px;
  color: var(--ck-faint);
}
</style>
