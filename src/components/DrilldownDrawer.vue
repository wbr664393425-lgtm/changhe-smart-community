<script setup>
import { ref, computed, watch } from 'vue'
import { ArrowUpDown, Download, Search, RotateCcw, SlidersHorizontal, X } from 'lucide-vue-next'
import NativeDrawer from './NativeDrawer.vue'
import AppSelect from './AppSelect.vue'
import { exportRealCsv } from '../utils/exportFile'
import { addAuditLog, showToast } from '../store/appStore'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '指标授权明细下钻' },
  subtitle: { type: String, default: '' },
  summaryText: { type: String, default: '' },
  columns: { type: Array, default: () => [] }, // [{ key, label, numeric?, align?, badgeMap? }]
  rows: { type: Array, default: () => [] },
  filters: { type: Array, default: () => [] }, // [{ key, label, type?: 'select'|'chips', allLabel?, options?, defaultValue? }]
  exportName: { type: String, default: '长河街道指标明细下钻' }
})

const emit = defineEmits(['close'])

const keyword = ref('')
const sortKey = ref('')
const sortAsc = ref(false)
const page = ref(1)
const pageSize = ref(10)
const filterValues = ref({})
const selectedRow = ref(null)

const PAGE_SIZE_OPTIONS = [
  { value: 10, label: '10 条/页' },
  { value: 20, label: '20 条/页' },
  { value: 50, label: '50 条/页' }
]

const normalizedFilters = computed(() =>
  (props.filters || []).map((f) => {
    const rawOpts = Array.isArray(f.options) && f.options.length
      ? f.options
      : [...new Set(props.rows.map((r) => r[f.key]).filter((v) => v !== undefined && v !== null && v !== ''))]
    return {
      ...f,
      type: f.type || 'select',
      allLabel: f.allLabel || `全部${f.label}`,
      options: rawOpts
    }
  })
)

const selectFilters = computed(() => normalizedFilters.value.filter((f) => f.type !== 'chips'))
const chipFilters = computed(() => normalizedFilters.value.filter((f) => f.type === 'chips'))

function initFilters() {
  const next = {}
  for (const f of props.filters || []) {
    next[f.key] = f.defaultValue || ''
  }
  filterValues.value = next
}

watch(
  () => [props.open, props.title, props.filters],
  ([isOpen]) => {
    if (isOpen) {
      keyword.value = ''
      sortKey.value = ''
      sortAsc.value = false
      page.value = 1
      selectedRow.value = null
      initFilters()
    }
  },
  { immediate: true }
)

const hasActiveFilters = computed(() => {
  if (keyword.value.trim()) return true
  return Object.values(filterValues.value).some((v) => v !== '' && v !== undefined && v !== null)
})

function resetFilters() {
  keyword.value = ''
  const next = {}
  for (const f of props.filters || []) {
    next[f.key] = ''
  }
  filterValues.value = next
  page.value = 1
  selectedRow.value = null
}

function setFilterValue(key, val) {
  filterValues.value = { ...filterValues.value, [key]: val }
  page.value = 1
  selectedRow.value = null
}

const filteredRows = computed(() => {
  const q = keyword.value.trim()
  let list = props.rows.filter((r) => {
    for (const [k, val] of Object.entries(filterValues.value)) {
      if (val !== '' && val !== undefined && val !== null && String(r[k] ?? '') !== String(val)) {
        return false
      }
    }
    if (!q) return true
    const matchCols = props.columns.some((c) => String(r[c.key] ?? '').includes(q))
    if (matchCols) return true
    return r.remark ? String(r.remark).includes(q) : false
  })
  if (sortKey.value) {
    const col = props.columns.find((c) => c.key === sortKey.value)
    list = [...list].sort((a, b) => {
      const va = a[sortKey.value]
      const vb = b[sortKey.value]
      const cmp = col?.numeric
        ? Number(String(va).replace(/[^\d.-]/g, '')) - Number(String(vb).replace(/[^\d.-]/g, ''))
        : String(va ?? '').localeCompare(String(vb ?? ''), 'zh-CN')
      return sortAsc.value ? cmp : -cmp
    })
  }
  return list
})

const totalPages = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / pageSize.value)))
const safePage = computed(() => Math.min(Math.max(1, page.value), totalPages.value))

const pagedRows = computed(() => {
  const start = (safePage.value - 1) * pageSize.value
  return filteredRows.value.slice(start, start + pageSize.value)
})

const rangeText = computed(() => {
  const total = filteredRows.value.length
  if (!total) return '共 0 条记录'
  const start = (safePage.value - 1) * pageSize.value + 1
  const end = Math.min(total, safePage.value * pageSize.value)
  return `显示第 ${start}-${end} 条，共 ${total.toLocaleString()} 条`
})

const pageNumbers = computed(() => {
  const total = totalPages.value
  const cur = safePage.value
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = [1]
  if (cur > 3) pages.push('…')
  const start = Math.max(2, cur - 1)
  const end = Math.min(total - 1, cur + 1)
  for (let i = start; i <= end; i++) pages.push(i)
  if (cur < total - 2) pages.push('…')
  pages.push(total)
  return pages
})

function toggleSort(key) {
  if (sortKey.value === key) {
    sortAsc.value = !sortAsc.value
  } else {
    sortKey.value = key
    sortAsc.value = false
  }
  page.value = 1
}

function getBadgeClass(col, val) {
  if (!col.badgeMap) return ''
  return col.badgeMap[val] || 'st-neutral'
}

function toggleRowDetail(row) {
  selectedRow.value = selectedRow.value === row ? null : row
}

function handleExport() {
  exportRealCsv(
    props.exportName,
    props.columns.map((c) => c.label),
    filteredRows.value.map((r) => props.columns.map((c) => r[c.key] ?? ''))
  )
  addAuditLog(`导出下钻明细「${props.title}」（${filteredRows.value.length} 条）`, '授权导出')
  showToast(`已按当前授权与筛选条件导出 ${filteredRows.value.length.toLocaleString()} 条明细`)
}
</script>

<template>
  <NativeDrawer :open="open" :title="title" :subtitle="subtitle" variant="wide" @close="emit('close')">
    <div class="dd-summary" v-if="summaryText">
      <span>{{ summaryText }}</span>
      <span class="num dd-hit-badge">
        当前命中 {{ filteredRows.length.toLocaleString() }} / {{ rows.length.toLocaleString() }} 条
      </span>
    </div>

    <!-- 检索与操作顶栏 -->
    <div class="dd-toolbar">
      <div class="dd-search-box">
        <Search :size="15" />
        <input
          v-model="keyword"
          type="search"
          class="field-input"
          placeholder="输入姓名、社区、单位、网格或关键字快速检索…"
          @input="page = 1"
        />
      </div>

      <div class="dd-actions">
        <button
          v-if="hasActiveFilters"
          type="button"
          class="btn sm"
          @click="resetFilters"
        >
          <RotateCcw :size="13" />
          <span>重置筛选</span>
        </button>
        <button type="button" class="btn sm primary" @click="handleExport">
          <Download :size="14" />
          <span>导出当前明细</span>
        </button>
      </div>
    </div>

    <!-- 多维细节筛选区（下拉筛选 + 快捷状态胶囊） -->
    <div v-if="normalizedFilters.length" class="dd-filter-panel">
      <div v-if="selectFilters.length" class="dd-select-row">
        <span class="dd-filter-tag">
          <SlidersHorizontal :size="13" />
          <span>精细筛选</span>
        </span>
        <div v-for="f in selectFilters" :key="f.key" class="dd-filter-item">
          <label class="dd-filter-label">{{ f.label }}</label>
          <AppSelect
            size="sm"
            :model-value="filterValues[f.key] ?? ''"
            :options="[{ value: '', label: f.allLabel }, ...f.options.map((o) => ({ value: o, label: o }))]"
            @update:model-value="(val) => setFilterValue(f.key, val)"
          />
        </div>
      </div>

      <div v-for="cf in chipFilters" :key="cf.key" class="dd-chip-row">
        <span class="dd-filter-label">{{ cf.label }}：</span>
        <div class="dd-chip-list">
          <button
            type="button"
            class="dd-chip"
            :class="{ active: !filterValues[cf.key] }"
            @click="setFilterValue(cf.key, '')"
          >
            {{ cf.allLabel }}
          </button>
          <button
            v-for="opt in cf.options"
            :key="opt"
            type="button"
            class="dd-chip"
            :class="{ active: filterValues[cf.key] === opt }"
            @click="setFilterValue(cf.key, filterValues[cf.key] === opt ? '' : opt)"
          >
            {{ opt }}
          </button>
        </div>
      </div>
    </div>

    <!-- 选中行档案速览卡片 -->
    <div v-if="selectedRow" class="dd-detail-card">
      <div class="dd-detail-head">
        <strong>档案详情速览 · {{ selectedRow[columns[0]?.key] }}</strong>
        <button type="button" class="dd-detail-close" aria-label="收起详情" @click="selectedRow = null">
          <X :size="14" />
        </button>
      </div>
      <div class="dd-detail-grid">
        <div v-for="col in columns" :key="col.key" class="dd-detail-cell">
          <span>{{ col.label }}</span>
          <strong :class="{ num: col.numeric }">{{ selectedRow[col.key] ?? '—' }}</strong>
        </div>
      </div>
      <p v-if="selectedRow.remark" class="dd-detail-remark">{{ selectedRow.remark }}</p>
    </div>

    <!-- 数据明细表 -->
    <div class="panel dd-table-panel">
      <div class="table-wrapper" tabindex="0" role="region" :aria-label="title">
        <table class="data-table">
          <thead>
            <tr>
              <th v-for="col in columns" :key="col.key" scope="col">
                <button type="button" class="sort-head-btn" @click="toggleSort(col.key)">
                  <span>{{ col.label }}</span>
                  <ArrowUpDown :size="12" :class="{ active: sortKey === col.key }" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, idx) in pagedRows"
              :key="idx"
              class="dd-data-row"
              :class="{ selected: selectedRow === row }"
              title="点击查看该条完整档案说明"
              @click="toggleRowDetail(row)"
            >
              <template v-for="(col, cIdx) in columns" :key="col.key">
                <th v-if="cIdx === 0" scope="row">{{ row[col.key] }}</th>
                <td v-else :class="{ num: col.numeric }">
                  <span v-if="col.badgeMap" class="tag" :class="getBadgeClass(col, row[col.key])">
                    {{ row[col.key] }}
                  </span>
                  <template v-else>{{ row[col.key] }}</template>
                </td>
              </template>
            </tr>
            <tr v-if="!pagedRows.length">
              <td :colspan="columns.length" style="text-align: center; padding: 32px; color: var(--ink-soft)">
                未检索到匹配的明细记录，可尝试调整或重置上方筛选条件
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 增强分页条 -->
    <div class="dd-pager">
      <div class="dd-pager-left">
        <span class="num">{{ rangeText }}</span>
        <div class="dd-pagesize">
          <AppSelect
            size="sm"
            :model-value="pageSize"
            :options="PAGE_SIZE_OPTIONS"
            @update:model-value="(val) => { pageSize = Number(val); page = 1 }"
          />
        </div>
      </div>

      <div class="dd-pager-right">
        <button type="button" class="btn sm" :disabled="safePage <= 1" @click="page = safePage - 1">上一页</button>
        <template v-for="(p, i) in pageNumbers" :key="`${p}-${i}`">
          <span v-if="p === '…'" class="dd-ellipsis">…</span>
          <button
            v-else
            type="button"
            class="btn sm num dd-page-num"
            :class="{ primary: p === safePage }"
            @click="page = p"
          >
            {{ p }}
          </button>
        </template>
        <button type="button" class="btn sm" :disabled="safePage >= totalPages" @click="page = safePage + 1">下一页</button>
      </div>
    </div>
  </NativeDrawer>
</template>

<style scoped>
.dd-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 10px 14px;
  margin-bottom: 12px;
  border-radius: var(--r-sm);
  background: var(--brand-soft);
  color: var(--brand);
  font-size: 13px;
  font-weight: 500;
}

.dd-hit-badge {
  font-weight: 700;
  white-space: nowrap;
}

.dd-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 10px;
}

.dd-search-box {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 240px;
  max-width: 400px;
}

.dd-search-box svg {
  position: absolute;
  left: 10px;
  color: var(--ink-soft);
  pointer-events: none;
}

.dd-search-box input {
  padding-left: 32px;
}

.dd-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dd-filter-panel {
  display: grid;
  gap: 9px;
  padding: 10px 12px;
  margin-bottom: 12px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line);
  background: var(--sunken);
}

.dd-select-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
}

.dd-filter-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-muted);
  padding-right: 4px;
}

.dd-filter-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.dd-filter-label {
  font-size: 12px;
  color: var(--ink-soft);
  white-space: nowrap;
}

.dd-filter-item :deep(.rui-select) {
  min-width: 124px;
}

.dd-chip-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.dd-chip-list {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.dd-chip {
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink-muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease;
}

.dd-chip:hover {
  border-color: var(--brand-2);
  color: var(--ink);
}

.dd-chip.active {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary, #ffffff);
  font-weight: 600;
}

.dd-detail-card {
  margin-bottom: 12px;
  padding: 12px 14px;
  border-radius: var(--r-sm);
  border: 1px solid var(--brand-2);
  background: var(--brand-soft);
}

.dd-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--ink);
}

.dd-detail-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink-muted);
  cursor: pointer;
}

.dd-detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px 12px;
}

.dd-detail-cell span {
  display: block;
  font-size: 11px;
  color: var(--ink-soft);
}

.dd-detail-cell strong {
  font-size: 12.5px;
  color: var(--ink);
}

.dd-detail-remark {
  margin: 8px 0 0;
  padding-top: 8px;
  border-top: 1px dashed var(--line-strong);
  font-size: 12.5px;
  color: var(--ink-muted);
  line-height: 1.5;
}

.dd-data-row {
  cursor: pointer;
}

.dd-table-panel :deep(.data-table th),
.dd-table-panel :deep(.data-table td) {
  white-space: nowrap;
  padding: 9px 10px;
}

.dd-data-row.selected th,
.dd-data-row.selected td {
  background: var(--brand-soft);
}

.sort-head-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  padding: 0;
  font-weight: 600;
  color: inherit;
  cursor: pointer;
}

.sort-head-btn svg {
  opacity: 0.45;
}

.sort-head-btn svg.active {
  opacity: 1;
  color: var(--brand-2);
}

.dd-pager {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
  font-size: 12.5px;
  color: var(--ink-muted);
}

.dd-pager-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dd-pagesize :deep(.rui-select) {
  min-width: 96px;
}

.dd-pager-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.dd-page-num {
  min-width: 30px;
  justify-content: center;
  padding: 0 8px;
}

.dd-ellipsis {
  padding: 0 4px;
  color: var(--ink-soft);
}
</style>
