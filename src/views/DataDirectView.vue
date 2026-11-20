<script setup>
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  Table2, Wrench, FileSpreadsheet, GitCompare, History, FileOutput,
  Lock, ShieldAlert, Plus, Upload, Download, CheckCircle2, Trash2, Bell, Pause, Play
} from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import AppSelect from '../components/AppSelect.vue'
import NativeDrawer from '../components/NativeDrawer.vue'
import {
  store, COMMUNITIES, ROLES, getCurrentRole, getEffectiveCommunity,
  switchRole, addAuditLog, showToast, nowStr, recalculateLedgerRecord
} from '../store/appStore'
import {
  validateIdCard, validatePhone, maskValue, isSensitiveCollisionQuery, evaluateFormula
} from '../utils/validators'
import { exportRealCsv, exportMultiSheetExcel } from '../utils/exportFile'

const route = useRoute()
const role = computed(() => getCurrentRole())
const scope = computed(() => getEffectiveCommunity())
const dd = store.dataDirect

const activeTab = ref(String(route.query.tab || 'overview')) // overview | model | fill | verify | query | report
watch(() => route.query.tab, (t) => {
  if (t) activeTab.value = String(t)
})
const entLedger = computed(() => dd.ledgers[0])

// ==================== 1. 任务与分色活页宽表总览（R28/R29） ====================
const selectedTaskId = ref(dd.tasks[0].id)
const pulsedUid = ref('')
const activeTask = computed(() => dd.tasks.find((t) => t.id === selectedTaskId.value) || dd.tasks[0])

function togglePauseTask(tk) {
  tk.paused = !tk.paused
  addAuditLog(`${tk.paused ? '暂停' : '恢复'}采集任务「${tk.name}」`, '任务状态变更')
  showToast(tk.paused ? '任务已暂停，基层暂不可提交' : '任务已恢复采集')
}

function appendAssignee(tk) {
  const next = COMMUNITIES.find((c) => !tk.assignees.includes(c.name))
  if (!next) {
    showToast('已覆盖全街道 14 个社区')
    return
  }
  tk.assignees.push(next.name)
  tk.totalTarget += 3
  addAuditLog(`向采集任务「${tk.name}」追加填报社区：${next.name}`, '口经稳定')
  showToast(`已追加「${next.name}」，原有社区已采数据口径纹丝不动`)
}

function appendFieldToTask(tk) {
  if (!tk.fieldKeys.includes('promiseFile')) {
    tk.fieldKeys.push('promiseFile')
    showToast('已补充下发「安全承诺书附件」字段，历史已采字段完整保留')
  } else {
    showToast('本次补充字段已下发完毕')
  }
}

function sendTaskRemind(tk) {
  tk.remindedAt = nowStr()
  addAuditLog(`向「${tk.name}」未完成社区发送站内待办与内网邮件提醒`, '已发送')
  showToast('已向未完成填报网格员推送待办提醒（支持内网邮件扩展）')
}

// 演示核心杀手锏：市监所仅补填 3 列，提交后在「长河便民连锁超市」同一行合并！
const quickMarketShopUid = ref('UID-ENT-001')
const quickFoodLicense = ref('有效期内')
const quickHealthCerts = ref(6)
const quickColdChain = ref(['冷链台账齐全', '进货票据规范'])

function submitIncrementalMerge() {
  const rec = dd.records.find((r) => r.uid === quickMarketShopUid.value)
  if (!rec) return
  rec.values.foodLicense = quickFoodLicense.value
  rec.values.healthCerts = Number(quickHealthCerts.value) || 0
  rec.values.coldChain = [...quickColdChain.value]
  rec.values.reporter = role.value.userName
  rec.values.reportTime = nowStr()
  rec.mergedTasksCount = Math.max(2, rec.mergedTasksCount + 1)
  rec.history.unshift({
    time: nowStr(),
    operator: role.value.userName,
    action: '跨科室任务增量归并',
    taskName: '市监所 · 沿街商铺食品安全专项补充采集',
    changes: [
      { field: '食品经营许可', oldVal: '空', newVal: quickFoodLicense.value },
      { field: '持健康证人数', oldVal: '空', newVal: String(quickHealthCerts.value) }
    ]
  })
  const tk = dd.tasks.find((t) => t.id === 'tk-market')
  if (tk && tk.doneCount < tk.totalTarget) tk.doneCount += 1
  pulsedUid.value = rec.uid
  setTimeout(() => { pulsedUid.value = '' }, 2600)
  addAuditLog(`按业务主键「${rec.values.creditCode}」增量归并「${rec.values.shopName}」市监字段`, '同行归并')
  showToast(`已按主键归并至「${rec.values.shopName}」同一行！应急办历史消防字段完整保留`)
}

// ==================== 2. 宽表建模与 15 类字段仿真（R25/R26） ====================
const parsedTemplateMsg = ref('')
const simForm = ref({
  shopName: '德馨便民五金店',
  idCard: '371402198506123319', // 故意错末位演示交互后校验
  phone: '13853492011',
  requiredExt: 6,
  actualExt: 4
})
const simTouched = ref({ idCard: false, phone: false })
const simIdCheck = computed(() => validateIdCard(simForm.value.idCard))
const simPhoneCheck = computed(() => validatePhone(simForm.value.phone))
const simGapFormula = computed(() => evaluateFormula('{requiredExt} - {actualExt}', simForm.value))

function loadSmartTemplate() {
  parsedTemplateMsg.value = '已从标准表格《九小场所综合排查模板.xlsx》自动解析 18 列字段：自动匹配「身份证号/手机号」国密脱敏、自动抽取「燃气报警器/食品许可」下拉项、自动启用系统唯一记录标识与统一社会信用代码主键归并。'
  showToast('标准表格模板解析成功，已自动识别字段类型与脱敏规则')
}

// ==================== 3. 基层三态填报与错行批导诊断（R27/R30） ====================
const fillMode = ref('single') // single | batch | import
const singleForm = ref({
  creditCode: '91371400MA3CH0999A',
  shopName: '杨庄利民烘焙坊',
  community: '德馨社区',
  ownerName: '周晓明',
  idCard: '371402198804152815',
  phone: '13853418820',
  requiredExt: 4,
  actualExt: 3,
  gasAlarm: '已加装并通过测试',
  foodLicense: '有效期内',
  healthCerts: 4
})
const singleErrors = ref({ idCard: '', phone: '' })

function submitSingleRecord() {
  const idRes = validateIdCard(singleForm.value.idCard)
  const phRes = validatePhone(singleForm.value.phone)
  singleErrors.value = { idCard: idRes.message, phone: phRes.message }
  if (!idRes.valid || !phRes.valid) {
    showToast('表单存在格式校验错误，请修正标红项后再提交')
    return
  }
  const existing = dd.records.find((r) => r.values.creditCode === singleForm.value.creditCode)
  const calcValues = recalculateLedgerRecord(entLedger.value, {
    ...singleForm.value,
    cycleDate: nowStr().slice(0, 10),
    reporter: role.value.userName,
    reportTime: nowStr()
  })
  if (existing) {
    Object.assign(existing.values, calcValues)
    existing.mergedTasksCount += 1
    showToast('命中同一业务主键，已自动归并更新存量记录行')
  } else {
    dd.records.unshift({
      uid: 'UID-ENT-' + Date.now(),
      ledgerId: 'lg-ent',
      createdBy: role.value.userName,
      community: singleForm.value.community,
      period: '2026年11月',
      mergedTasksCount: 1,
      deleted: false,
      values: calcValues,
      history: [{ time: nowStr(), operator: role.value.userName, action: '单条表单采集入库', taskName: activeTask.value.name, changes: [{ field: '新建主体', oldVal: '空', newVal: singleForm.value.shopName }] }]
    })
    showToast('单条填报校验通过并写入宽表')
  }
  addAuditLog(`通过数据直达单条填报提交「${singleForm.value.shopName}」`, '入库成功')
}

// 在线表格批量录入
const batchGridRows = ref([
  { creditCode: '91371400MA3DX1011A', shopName: '德馨晨光文具店', community: '德馨社区', phone: '13853411122', requiredExt: 3, actualExt: 3 },
  { creditCode: '91371400MA3DX1012B', shopName: '星凯快捷打印社', community: '星凯社区', phone: '13953422233', requiredExt: 4, actualExt: 2 }
])

function commitBatchGrid() {
  const validRows = batchGridRows.value.filter((row) => row.shopName?.trim() && validatePhone(row.phone).valid)
  if (validRows.length < batchGridRows.value.length) {
    showToast('批量表中存在空商铺名或无效手机号，请补正后再提交')
    return
  }
  validRows.forEach((row) => {
    const vals = recalculateLedgerRecord(entLedger.value, {
      ...row,
      ownerName: row.ownerName || '社区核录负责人',
      idCard: '371402198501012817',
      gasAlarm: '不涉燃气',
      foodLicense: '不涉食品',
      healthCerts: 0,
      cycleDate: nowStr().slice(0, 10),
      reporter: role.value.userName,
      reportTime: nowStr()
    })
    const existing = dd.records.find((r) => !r.deleted && r.values.creditCode === row.creditCode)
    if (existing) {
      Object.assign(existing.values, vals)
    } else {
      dd.records.unshift({
        uid: 'UID-BATCH-' + Math.random().toString(36).slice(2, 7),
        ledgerId: 'lg-ent',
        createdBy: role.value.userName,
        community: row.community,
        period: '2026年11月',
        mergedTasksCount: 1,
        deleted: false,
        values: vals,
        history: [{ time: nowStr(), operator: role.value.userName, action: '在线表格批量录入', taskName: activeTask.value.name, changes: [{ field: '批量入库', oldVal: '空', newVal: row.shopName }] }]
      })
    }
  })
  showToast(`在线表格批量校验并入库 ${validRows.length} 条记录`)
}

// 模板导入行级错行诊断
const importDiag = ref({
  loaded: false,
  passed: 9,
  errors: [
    { rowNo: 4, shopName: '老味面馆', colName: '法人身份证号', value: '371402198506123319', reason: '第 18 位校验码不符（应为 1）', fixedValue: '371402198506123311', fixed: false },
    { rowNo: 7, shopName: '锦绣文具店', colName: '联系电话', value: '138534920', reason: '手机号位数不足 11 位', fixedValue: '13853492018', fixed: false },
    { rowNo: 11, shopName: '星光托管班', colName: '实配灭火器(具)', value: '-2', reason: '数值须在 0 至 500 之间', fixedValue: '4', fixed: false }
  ]
})

function exportOnlyErrorRows() {
  exportRealCsv(
    '数据直达导入错行返修表',
    ['原表行号', '商铺名称', '出错列名', '原错误值', '错误原因与修正指引'],
    importDiag.value.errors.filter((e) => !e.fixed).map((e) => [e.rowNo, e.shopName, e.colName, e.value, e.reason])
  )
  showToast('已仅导出 3 条错误行（附批注修正指引）')
}

function fixAllImportErrors() {
  importDiag.value.errors.forEach((e, idx) => {
    e.value = e.fixedValue
    e.fixed = true
    const code = `91371400MA3IMP00${idx + 1}X`
    if (!dd.records.some((r) => r.values.creditCode === code)) {
      const vals = recalculateLedgerRecord(entLedger.value, {
        creditCode: code,
        shopName: e.shopName,
        community: scope.value === '全街道' ? '德馨社区' : scope.value,
        ownerName: '模板导入负责人',
        idCard: idx === 0 ? e.fixedValue : '371402198506123311',
        phone: idx === 1 ? e.fixedValue : '13853492018',
        requiredExt: 4,
        actualExt: idx === 2 ? Number(e.fixedValue) : 4,
        gasAlarm: '已加装并通过测试',
        foodLicense: '有效期内',
        healthCerts: 2,
        cycleDate: nowStr().slice(0, 10),
        reporter: role.value.userName,
        reportTime: nowStr()
      })
      dd.records.unshift({
        uid: 'UID-IMP-' + Date.now() + '-' + idx,
        ledgerId: 'lg-ent',
        createdBy: role.value.userName,
        community: vals.community,
        period: '2026年11月',
        mergedTasksCount: 1,
        deleted: false,
        values: vals,
        history: [{ time: nowStr(), operator: role.value.userName, action: '模板导入修正入库', taskName: activeTask.value.name, changes: [{ field: e.colName, oldVal: '异常值', newVal: e.fixedValue }] }]
      })
    }
  })
  importDiag.value.passed = 12
  addAuditLog('批量导入行级在线修正 3 条异常记录并写入主宽表', '全部通过')
  showToast('3 处错误已在线修正并写入主宽表')
}

// ==================== 4. 存量复合核查红绿修订回写（R32） ====================
function commitVerifyBatch() {
  const batch = dd.verifyBatch
  if (batch.committed) return
  let updatedCnt = 0
  let deletedCnt = 0
  batch.items.forEach((item) => {
    if (!item.selected) return
    const target = dd.records.find((r) => r.uid === item.uid)
    if (!target) return
    if (item.op === '标记删除') {
      if (role.value.canDeleteLedgerRow && item.confirmedDelete) {
        target.deleted = true
        target.history.unshift({
          time: nowStr(),
          operator: role.value.userName,
          action: '存量复合核查·授权清理无效记录',
          taskName: batch.title,
          changes: [{ field: '记录状态', oldVal: '在库有效', newVal: `已清理（${item.reason}）` }]
        })
        deletedCnt++
      }
    } else {
      item.changes.forEach((ch) => {
        target.values[ch.key] = ch.newVal
      })
      target.history.unshift({
        time: nowStr(),
        operator: role.value.userName,
        action: '存量复合核查·红绿比对回写',
        taskName: batch.title,
        changes: item.changes.map((c) => ({ field: c.label, oldVal: String(c.oldVal), newVal: String(c.newVal) }))
      })
      updatedCnt++
    }
  })
  batch.committed = true
  addAuditLog(`完成存量复合核查批次「${batch.title}」回写（修订 ${updatedCnt} 条、授权清理 ${deletedCnt} 条）`, '核查回写')
  showToast(`已精准回写 ${updatedCnt} 条修订记录、授权清理 ${deletedCnt} 条无效记录，字段级履历已落库`)
}

// ==================== 5. 台账查询、行级隔离、脱敏防反查与履历（R24/R31） ====================
const queryKeyword = ref('')
const queryMinGap = ref('')
const queryHistoryRec = ref(null)

const collisionBlocked = computed(() => isSensitiveCollisionQuery(queryKeyword.value))

const isolatedRecords = computed(() => {
  if (collisionBlocked.value) return []
  return dd.records.filter((r) => {
    if (r.deleted) return false
    // R24 严格行级隔离：填报人仅见本人填报记录！
    if (role.value.rowIsolationOnlySelf && r.createdBy !== role.value.userName) return false
    if (!role.value.rowIsolationOnlySelf && scope.value !== '全街道' && r.community !== scope.value) return false
    if (queryMinGap.value !== '' && Number(r.values.extGap) < Number(queryMinGap.value)) return false
    if (queryKeyword.value.trim()) {
      const q = queryKeyword.value.trim()
      // 严禁搜索手机号与身份证明文
      if (!`${r.values.shopName}${r.values.community}${r.values.ownerName}${r.values.creditCode}`.includes(q)) return false
    }
    return true
  })
})

function exportIsolatedCsv() {
  exportRealCsv(
    `数据直达台账明细_${role.value.name}`,
    ['主体名称', '统一社会信用代码', '所属社区', '负责人', '脱敏手机号', '应配/实配灭火器', '缺口(公式)', '燃气报警器', '食品许可', '受控附件链接'],
    isolatedRecords.value.map((r) => [
      r.values.shopName,
      r.values.creditCode,
      r.values.community,
      r.values.ownerName,
      maskValue('phone', r.values.phone),
      `${r.values.requiredExt}/${r.values.actualExt}`,
      r.values.extGap,
      r.values.gasAlarm,
      r.values.foodLicense || '待补充',
      r.values.promiseFile ? `内网受控链接://attachment/${r.uid}` : '无'
    ])
  )
  addAuditLog(`按「${role.value.name}」权限受控导出宽表 ${isolatedRecords.value.length} 条（已脱敏过滤越权列）`, '受控导出')
  showToast(`已按当前权限受控导出 ${isolatedRecords.value.length} 条记录（脱敏掩码生效）`)
}

// ==================== 6. 多级合并表头多工作表报表 & 一键成套向导（R33） ====================
const activeReport = computed(() => dd.reports[0])
const previewSheetIdx = ref(0)
const wizardOpen = ref(false)
const wizardStep = ref(1)
const wizardForm = ref({
  ledgerName: '冬季供暖与独居老人隐患排查宽表',
  taskName: '2026年11月冬季供暖专项一表通采集',
  reportName: '冬季供暖与特殊群体月度合并表头汇总表'
})

function exportRealMultiSheetReport() {
  const rpt = activeReport.value
  const visibleRows = isolatedRecords.value
  const sheet1Rows = visibleRows.map((r) => [
    r.values.shopName,
    r.values.community,
    r.values.ownerName,
    maskValue('phone', r.values.phone),
    r.values.requiredExt,
    r.values.actualExt,
    r.values.extGap,
    r.values.gasAlarm,
    r.values.foodLicense || '待补充',
    r.values.healthCerts === '' ? '-' : r.values.healthCerts
  ])
  const commSummaryRows = COMMUNITIES.slice(0, 6).map((c) => {
    const matched = visibleRows.filter((r) => r.community === c.name)
    return [c.name, matched.length, matched.reduce((a, b) => a + Number(b.values.extGap || 0), 0), matched.filter((b) => b.values.gasAlarm === '已加装并通过测试').length]
  })
  const deletedRows = dd.records.filter((r) => r.deleted).map((r) => [r.values.shopName, r.community, '已授权清理', r.history[0]?.time || ''])

  exportMultiSheetExcel(rpt.name, [
    {
      name: '九小场所综合明细表',
      title: rpt.name,
      subtitle: `导出视角：${role.value.name}（${role.value.userName}） · 导出时间：${nowStr()} · 脱敏策略：国密掩码已生效`,
      startRow: rpt.startRow,
      startCol: rpt.startCol,
      groups: rpt.sheets[0].groups,
      headers: ['商铺名称', '所属社区', '负责人', '脱敏手机', '应配灭火器', '实配灭火器', '缺口(公式)', '燃气报警器', '食品许可', '健康证人数'],
      rows: sheet1Rows
    },
    {
      name: '分社区隐患整改汇总表',
      title: '分社区九小场所隐患汇总统计',
      startRow: 2,
      startCol: 1,
      headers: ['社区名称', '纳管样本数', '灭火器缺口合计', '已装报警器户数'],
      rows: commSummaryRows
    },
    {
      name: '本月标记清理记录清册',
      title: '授权清理无效存量记录清册',
      startRow: 2,
      startCol: 1,
      headers: ['原主体名称', '所属社区', '清理状态', '清理时间'],
      rows: deletedRows.length ? deletedRows : [['暂无已清理记录', '-', '-', '-']]
    }
  ])
  addAuditLog(`导出多工作表合并表头标准报表「${rpt.name}」（3 个工作表）`, '标准导出')
  showToast('已生成并导出含双层合并表头与 3 个工作表的标准电子表格（.xls）')
}

function finishWizard() {
  dd.tasks.unshift({
    id: 'tk-wiz-' + Date.now(),
    name: wizardForm.value.taskName,
    ledgerId: 'lg-ent',
    dept: role.value.dept,
    cycle: '月度循环',
    currentPeriod: '2026年11月',
    deadline: '2026-11-30 18:00',
    paused: false,
    assignees: ['德馨社区', '泰和社区', '星凯社区'],
    fieldKeys: ['creditCode', 'shopName', 'gasAlarm', 'foodLicense'],
    totalTarget: 10,
    doneCount: 0,
    remindedAt: ''
  })
  addAuditLog(`通过一键成套向导同步创建「${wizardForm.value.ledgerName} + 任务 + 报表」`, '成套发布')
  showToast('已 3 秒同步生成宽表台账、下发采集任务并绑定明细报表')
  wizardOpen.value = false
  wizardStep.value = 1
  activeTab.value = 'overview'
}
</script>

<template>
  <AppShell title="数据直达" subtitle="分色宽表跨科合行 · 公式防改 · 错行批导 · 红绿核查">
    <template #top-extra>
      <button type="button" class="btn sm primary" @click="wizardOpen = true">
        <Plus :size="14" />
        <span>台账·任务·报表一键成套</span>
      </button>
    </template>

    <!-- 顶部原版 rui-design 减负横幅 -->
    <section class="burden-banner" style="margin-bottom: 0">
      <div class="burden-col"><span>传统多部门重复报送</span><strong class="num">14 张表 · 186 字段</strong></div>
      <div class="burden-arrow">→</div>
      <div class="burden-col"><span>长河分色活页一表通</span><strong class="num">1 张宽表 · 本次仅补 3 列</strong></div>
      <div class="burden-pill"><strong class="num">-78%</strong><span>主键同行归并减负</span></div>
    </section>

    <!-- 6 大减负工坊槽式胶囊页签 -->
    <nav class="ui-tabs">
      <button type="button" :class="{ active: activeTab === 'overview' }" @click="activeTab = 'overview'"><Table2 :size="15" /> 任务与分色宽表归并</button>
      <button type="button" :class="{ active: activeTab === 'model' }" @click="activeTab = 'model'"><Wrench :size="15" /> 宽表建模与15类字段</button>
      <button type="button" :class="{ active: activeTab === 'fill' }" @click="activeTab = 'fill'"><FileSpreadsheet :size="15" /> 基层三态填报与纠错</button>
      <button type="button" :class="{ active: activeTab === 'verify' }" @click="activeTab = 'verify'"><GitCompare :size="15" /> 存量红绿核查回写</button>
      <button type="button" :class="{ active: activeTab === 'query' }" @click="activeTab = 'query'"><History :size="15" /> 台账隔离防反查与履历</button>
      <button type="button" :class="{ active: activeTab === 'report' }" @click="activeTab = 'report'"><FileOutput :size="15" /> 合并表头报表与授权</button>
    </nav>

    <!-- ==================== 1. 任务运行与跨科只采增量合行透视（R28/R29） ==================== -->
    <template v-if="activeTab === 'overview'">
      <div class="grid-2">
        <section class="panel">
          <div class="panel-head"><h2>多科室采集任务控制台</h2><small>周期循环 / 时限锁定 / 动态追加</small></div>
          <div class="panel-body" style="display: grid; gap: 10px">
            <div
              v-for="tk in dd.tasks"
              :key="tk.id"
              class="task-card"
              :class="{ active: selectedTaskId === tk.id, locked: tk.expiredLocked }"
              @click="selectedTaskId = tk.id"
            >
              <div class="tc-top">
                <strong>{{ tk.name }}</strong>
                <span class="tag" :class="tk.expiredLocked ? 'st-neutral' : tk.paused ? 'st-warn' : 'st-ok'">
                  {{ tk.expiredLocked ? '编辑时限已锁定' : tk.paused ? '已暂停' : '采集中' }}
                </span>
              </div>
              <small>{{ tk.dept }} · {{ tk.cycle }}（{{ tk.currentPeriod }}）· 截止 {{ tk.deadline }} · 覆盖 {{ tk.assignees.length }} 社区</small>
              <div class="progress-track" style="margin: 7px 0"><div class="progress-fill ok" :style="{ width: Math.round((tk.doneCount / tk.totalTarget) * 100) + '%' }"></div></div>
              <div class="tc-actions" v-if="!tk.expiredLocked">
                <button type="button" class="btn sm" @click.stop="togglePauseTask(tk)">
                  <component :is="tk.paused ? Play : Pause" :size="12" /> {{ tk.paused ? '恢复' : '暂停' }}
                </button>
                <button type="button" class="btn sm" @click.stop="appendAssignee(tk)">+ 追加社区</button>
                <button type="button" class="btn sm" @click.stop="appendFieldToTask(tk)">+ 补字段</button>
                <button type="button" class="btn sm ok-soft" @click.stop="sendTaskRemind(tk)"><Bell :size="12" /> 催办提醒</button>
              </div>
              <div v-else style="display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--ink-soft)">
                <Lock :size="12" /> 已过编辑截止时间，自动只读锁定防止越期篡改
              </div>
            </div>
          </div>
        </section>

        <!-- 跨科室只采增量同行归并填报卡 -->
        <section class="panel">
          <div class="panel-head">
            <h2>双科室接力“只采增量 · 同行归并”填报</h2>
            <span class="tag st-warn">市场监管所补充采集</span>
          </div>
          <div class="panel-body">
            <p class="tip-box">
              <strong>跨科室增量采集说明：</strong>应急办已采集「长河便民连锁超市」基础底盘与消防 4 列，市场监管所仅补采 <strong>3 项食品安全字段</strong>，社区专干免填既有信息，提交后按「统一社会信用代码」自动归并至<strong>同一记录行尾</strong>。
            </p>
            <div class="grid-2" style="margin: 12px 0">
              <div class="form-field">
                <label>自动预填只读主体（主键匹配）</label>
                <AppSelect
                  v-model="quickMarketShopUid"
                  :options="dd.records.filter((x) => !x.deleted).map((r) => ({ value: r.uid, label: `${r.values.shopName}（${r.values.creditCode}）` }))"
                />
              </div>
              <div class="form-field">
                <label>食品经营许可（本次增量列）</label>
                <AppSelect
                  v-model="quickFoodLicense"
                  :options="['有效期内', '临期需换证', '不涉食品']"
                />
              </div>
              <div class="form-field">
                <label>持健康证人数（本次增量列）</label>
                <input v-model.number="quickHealthCerts" type="number" min="0" max="200" class="field-input" />
              </div>
              <div class="form-field">
                <label>历史应急消防列（自动保护不覆盖）</label>
                <input value="应急办 4 列已锁保护 · 纹丝不动" disabled class="field-input" />
              </div>
            </div>
            <button type="button" class="btn primary" style="width: 100%" @click="submitIncrementalMerge">
              提交市监所 3 列增量并归并至综合宽表
            </button>
          </div>
        </section>
      </div>

      <!-- 下半区：分色活页宽表实时透视 -->
      <section class="panel">
        <div class="panel-head">
          <h2>「企业（九小场所）综合宽表」分色活页实时透视</h2>
          <div style="display: flex; gap: 10px; font-size: 12px">
            <span class="blk-tag blk-base">浅灰：主键底盘</span>
            <span class="blk-tag blk-fire">蓝区：应急办消防段</span>
            <span class="blk-tag blk-market">琥珀：市监所食安段</span>
          </div>
        </div>
        <div class="table-wrapper" tabindex="0" role="region" aria-label="分色活页宽表">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col" class="th-base">商铺名称（主键归并）</th>
                <th scope="col" class="th-base">社区</th>
                <th scope="col" class="th-fire">应配/实配灭火器</th>
                <th scope="col" class="th-fire">缺口(公式锁死)</th>
                <th scope="col" class="th-fire">燃气报警器</th>
                <th scope="col" class="th-market">食品经营许可</th>
                <th scope="col" class="th-market">健康证人数</th>
                <th scope="col">归并状态</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="r in dd.records.filter((x) => !x.deleted)"
                :key="r.uid"
                :class="{ 'row-pulse': pulsedUid === r.uid }"
              >
                <th scope="row">{{ r.values.shopName }}</th>
                <td>{{ r.community }}</td>
                <td class="num td-fire">{{ r.values.requiredExt }} / {{ r.values.actualExt }} 具</td>
                <td class="num td-fire">
                  <span class="formula-pill"><Lock :size="11" /> {{ r.values.extGap }}</span>
                </td>
                <td class="td-fire">{{ r.values.gasAlarm }}</td>
                <td class="td-market">
                  <span v-if="r.values.foodLicense" class="tag st-ok">{{ r.values.foodLicense }}</span>
                  <span v-else class="tag st-warn">待市监补填</span>
                </td>
                <td class="num td-market">{{ r.values.healthCerts === '' ? '—' : `${r.values.healthCerts} 人` }}</td>
                <td><span class="tag st-run">已归并 {{ r.mergedTasksCount }} 科室</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <!-- ==================== 2. 宽表建模与 15 类字段活体仿真（R25/R26） ==================== -->
    <div v-else-if="activeTab === 'model'" class="model-2col">
      <section class="panel">
        <div class="panel-head">
          <h2>{{ entLedger.name }} · 15 类全量字段结构与业务主键</h2>
          <button type="button" class="btn sm primary" @click="loadSmartTemplate">
            <Upload :size="13" /> 一键载入标准表格模板建宽表
          </button>
        </div>
        <div class="panel-body">
          <div v-if="parsedTemplateMsg" class="done-banner">{{ parsedTemplateMsg }}</div>
          <div class="pk-banner">
            <strong>业务主键归并规则：</strong>{{ entLedger.primaryKeyLabel }} · 底层已启用系统唯一记录标识
          </div>
          <div class="table-wrapper" tabindex="0" role="region" aria-label="15类字段定义表">
            <table class="data-table">
              <thead>
                <tr>
                  <th scope="col">字段名称</th>
                  <th scope="col">所属科室区块</th>
                  <th scope="col">字段类型</th>
                  <th scope="col">预填与安全规则</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="f in entLedger.fields" :key="f.key">
                  <th scope="row">{{ f.label }}</th>
                  <td>{{ f.blockName }}</td>
                  <td><span class="tag st-neutral">{{ f.type === 'formula' ? '自动计算公式' : f.type === 'idcard' ? '身份证号' : f.type === 'phone' ? '手机号' : f.type === 'cycle_date' ? '周期日' : f.type === 'reporter' ? '填报人' : f.type === 'report_time' ? '填报时间' : f.type === 'radio' ? '单选' : f.type === 'checkbox' ? '多选' : f.type === 'select' ? '下拉' : f.type === 'image' ? '图片' : f.type === 'attachment' ? '附件' : f.type === 'number' ? '数字' : f.type === 'name' ? '姓名' : '文本' }}</span></td>
                  <td>
                    <span v-if="f.formula" class="tag st-run"><Lock :size="11" /> {{ f.formula }}（防篡改）</span>
                    <span v-else-if="f.masked" class="tag st-bad">加密存储 · 脱敏掩码</span>
                    <span v-else-if="f.prefill === 'last'" class="tag st-ok">自动带出上次填报值</span>
                    <span v-else-if="f.prefill === 'today'" class="tag st-ok">默认带出当天日期</span>
                    <span v-else-if="f.locked" class="tag st-neutral">系统自动写入只读</span>
                    <span v-else style="color: var(--ink-soft)">手工核填</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- 右侧：活体填报与公式防篡改仿真器 -->
      <aside class="panel">
        <div class="panel-head"><h2>活体规则仿真器（实时校验 & 公式锁死）</h2></div>
        <div class="panel-body" style="display: grid; gap: 12px">
          <div class="form-field">
            <label for="sim-id">法人身份证号（国标 18 位自动校验）</label>
            <span class="field-hint">当前预设末位错码「9」，失焦后自动拦截并告知正确校验码</span>
            <input
              id="sim-id"
              v-model="simForm.idCard"
              class="field-input"
              :class="{ 'user-invalid-fallback': simTouched.idCard && !simIdCheck.valid }"
              @blur="simTouched.idCard = true"
            />
            <div class="field-error" :class="{ visible: simTouched.idCard && !simIdCheck.valid }">{{ simIdCheck.message }}</div>
          </div>

          <div class="form-field">
            <label for="sim-phone">负责人手机号（脱敏实时预览）</label>
            <input
              id="sim-phone"
              v-model="simForm.phone"
              class="field-input"
              :class="{ 'user-invalid-fallback': simTouched.phone && !simPhoneCheck.valid }"
              @blur="simTouched.phone = true"
            />
            <div class="field-error" :class="{ visible: simTouched.phone && !simPhoneCheck.valid }">{{ simPhoneCheck.message }}</div>
            <small v-if="simPhoneCheck.valid" style="color: var(--ok)">校验通过 · 列表自动脱敏展示：{{ maskValue('phone', simForm.phone) }}</small>
          </div>

          <div class="grid-2">
            <div class="form-field">
              <label>应配灭火器(具)</label>
              <input v-model.number="simForm.requiredExt" type="number" min="0" class="field-input" />
            </div>
            <div class="form-field">
              <label>实配灭火器(具)</label>
              <input v-model.number="simForm.actualExt" type="number" min="0" class="field-input" />
            </div>
          </div>

          <div class="form-field">
            <label><Lock :size="12" /> 灭火器缺口（公式自动计算 · 禁止人工篡改）</label>
            <input :value="`${simGapFormula} 具`" readonly class="field-input" @click="showToast('该字段为系统自动计算公式，已锁定防止人工篡改')" />
          </div>
        </div>
      </aside>
    </div>

    <!-- ==================== 3. 基层三态填报与错行批导返修（R27/R30） ==================== -->
    <section v-else-if="activeTab === 'fill'" class="panel">
      <div class="panel-head">
        <h2>基层三态填报台（单条 / 在线批量表格 / 模板导入错行诊断）</h2>
        <div style="display: flex; gap: 6px">
          <button type="button" class="btn sm" :class="{ primary: fillMode === 'single' }" @click="fillMode = 'single'">单条表单填报</button>
          <button type="button" class="btn sm" :class="{ primary: fillMode === 'batch' }" @click="fillMode = 'batch'">在线表格批量录入</button>
          <button type="button" class="btn sm" :class="{ primary: fillMode === 'import' }" @click="fillMode = 'import'">表格模板批量导入</button>
        </div>
      </div>

      <div class="panel-body">
        <!-- 形态一：单条表单 -->
        <form v-if="fillMode === 'single'" class="grid-3" @submit.prevent="submitSingleRecord">
          <div class="form-field"><label>统一社会信用代码（主键）</label><input v-model="singleForm.creditCode" class="field-input" required /></div>
          <div class="form-field"><label>商铺/企业名称</label><input v-model="singleForm.shopName" class="field-input" required /></div>
          <div class="form-field"><label>所属社区</label><AppSelect v-model="singleForm.community" :options="COMMUNITIES.map((c) => c.name)" /></div>
          <div class="form-field"><label>负责人姓名</label><input v-model="singleForm.ownerName" class="field-input" required /></div>
          <div class="form-field">
            <label>法人身份证号（15/18位实时校验）</label>
            <input v-model="singleForm.idCard" class="field-input" :class="{ 'user-invalid-fallback': !!singleErrors.idCard }" />
            <div class="field-error" :class="{ visible: !!singleErrors.idCard }">{{ singleErrors.idCard }}</div>
          </div>
          <div class="form-field">
            <label>联系电话（11位校验）</label>
            <input v-model="singleForm.phone" class="field-input" :class="{ 'user-invalid-fallback': !!singleErrors.phone }" />
            <div class="field-error" :class="{ visible: !!singleErrors.phone }">{{ singleErrors.phone }}</div>
          </div>
          <div class="form-field"><label>应配灭火器(具)</label><input v-model.number="singleForm.requiredExt" type="number" min="0" class="field-input" /></div>
          <div class="form-field"><label>实配灭火器(具)</label><input v-model.number="singleForm.actualExt" type="number" min="0" class="field-input" /></div>
          <div class="form-field"><label>缺口数（公式只读）</label><input :value="evaluateFormula('{requiredExt}-{actualExt}', singleForm)" readonly class="field-input" /></div>
          <div style="grid-column: 1 / -1; display: flex; justify-content: flex-end">
            <button type="submit" class="btn primary">校验并提交入宽表（命中主键自动归并）</button>
          </div>
        </form>

        <!-- 形态二：在线表格批量录入 -->
        <div v-else-if="fillMode === 'batch'">
          <div class="table-wrapper" tabindex="0" role="region" aria-label="在线表格批量录入">
            <table class="data-table">
              <thead>
                <tr>
                  <th scope="col">统一社会信用代码</th>
                  <th scope="col">商铺名称</th>
                  <th scope="col">所属社区</th>
                  <th scope="col">联系电话</th>
                  <th scope="col">应配灭火器</th>
                  <th scope="col">实配灭火器</th>
                  <th scope="col">缺口（公式实时算）</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, idx) in batchGridRows" :key="idx">
                  <td><input v-model="r.creditCode" class="field-input" /></td>
                  <td><input v-model="r.shopName" class="field-input" /></td>
                  <td><AppSelect v-model="r.community" size="sm" :options="COMMUNITIES.map((c) => c.name)" /></td>
                  <td><input v-model="r.phone" class="field-input" /></td>
                  <td><input v-model.number="r.requiredExt" type="number" class="field-input" style="width: 80px" /></td>
                  <td><input v-model.number="r.actualExt" type="number" class="field-input" style="width: 80px" /></td>
                  <td class="num"><span class="formula-pill"><Lock :size="11" /> {{ Math.max(0, r.requiredExt - r.actualExt) }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style="margin-top: 12px; display: flex; justify-content: space-between">
            <button type="button" class="btn sm" @click="batchGridRows.push({ creditCode: '91371400MA3NEW' + batchGridRows.length, shopName: '', community: '德馨社区', phone: '', requiredExt: 2, actualExt: 2 })">+ 新增一行</button>
            <button type="button" class="btn primary" @click="commitBatchGrid">一键校验并批量入库</button>
          </div>
        </div>

        <!-- 形态三：表格模板导入 + 精准行级错行诊断 -->
        <div v-else>
          <div style="display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap">
            <button type="button" class="btn primary" @click="importDiag.loaded = true">
              <Upload :size="14" /> 导入九小场所批量排查表（自动预检校验）
            </button>
            <button v-if="importDiag.loaded" type="button" class="btn bad-soft" @click="exportOnlyErrorRows">
              <Download :size="14" /> 仅导出 3 条错误行（附批注返修）
            </button>
            <button v-if="importDiag.loaded" type="button" class="btn ok" @click="fixAllImportErrors">
              <CheckCircle2 :size="14" /> 在线一键改绿并全部入库
            </button>
          </div>

          <div v-if="importDiag.loaded">
            <div class="diag-bar">
              <span>总计解析 <b>12</b> 行</span>
              <span style="color: var(--ok)">校验通过 <b>{{ importDiag.passed }}</b> 行</span>
              <span style="color: var(--bad)">精准拦截异常 <b>{{ importDiag.errors.filter((e) => !e.fixed).length }}</b> 行</span>
            </div>
            <div class="table-wrapper" tabindex="0" role="region" aria-label="行级校验诊断台">
              <table class="data-table">
                <thead>
                  <tr>
                    <th scope="col">原表行号</th>
                    <th scope="col">主体名称</th>
                    <th scope="col">出错列名</th>
                    <th scope="col">单元格值（可在线修正）</th>
                    <th scope="col">精准校验诊断指引</th>
                    <th scope="col">状态</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="err in importDiag.errors" :key="err.rowNo">
                    <th scope="row" class="num">第 {{ err.rowNo }} 行</th>
                    <td>{{ err.shopName }}</td>
                    <td>{{ err.colName }}</td>
                    <td><input v-model="err.value" class="field-input" :class="{ 'user-invalid-fallback': !err.fixed }" /></td>
                    <td style="color: var(--bad)">{{ err.fixed ? '已修正通过' : err.reason }}</td>
                    <td><span class="tag" :class="err.fixed ? 'st-ok' : 'st-bad'">{{ err.fixed ? '已改绿通过' : '拦截待修' }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ==================== 4. 存量复合核查红绿修订对比回写（R32） ==================== -->
    <section v-else-if="activeTab === 'verify'" class="panel">
      <div class="panel-head">
        <div>
          <h2>{{ dd.verifyBatch.title }}</h2>
          <small style="color: var(--ink-soft)">上传来源：{{ dd.verifyBatch.submittedBy }} · {{ dd.verifyBatch.submittedAt }}</small>
        </div>
        <button type="button" class="btn primary" :disabled="dd.verifyBatch.committed" @click="commitVerifyBatch">
          <CheckCircle2 :size="14" />
          <span>{{ dd.verifyBatch.committed ? '本批次已校验回写完成' : '确认批量校验回写至主宽表' }}</span>
        </button>
      </div>
      <div class="panel-body" style="display: grid; gap: 12px">
        <div v-for="item in dd.verifyBatch.items" :key="item.uid" class="diff-card" :class="{ del: item.op === '标记删除' }">
          <div class="dc-head">
            <label style="display: inline-flex; align-items: center; gap: 7px; font-weight: 700">
              <input v-model="item.selected" type="checkbox" :disabled="dd.verifyBatch.committed" />
              <span>{{ item.shopName }}</span>
            </label>
            <span class="tag st-neutral">{{ item.community }}</span>
            <span class="tag" :class="item.op === '标记删除' ? 'st-bad' : 'st-run'">{{ item.op }}</span>
          </div>
          <p class="dc-reason">核查修订说明：{{ item.reason }}</p>

          <!-- 红绿修订对比块 -->
          <div v-if="item.changes.length" class="diff-grid">
            <div v-for="ch in item.changes" :key="ch.key" class="diff-row">
              <span class="df-name">{{ ch.label }}</span>
              <span class="df-old">{{ ch.masked ? maskValue('phone', ch.oldVal) : ch.oldVal }}</span>
              <span>→</span>
              <span class="df-new">{{ ch.masked ? maskValue('phone', ch.newVal) : ch.newVal }}</span>
            </div>
          </div>

          <!-- 标记删除二次授权确认 -->
          <div v-if="item.op === '标记删除'" class="del-confirm">
            <template v-if="role.canDeleteLedgerRow">
              <label style="display: inline-flex; align-items: center; gap: 6px; color: var(--bad); font-weight: 600">
                <input v-model="item.confirmedDelete" type="checkbox" :disabled="dd.verifyBatch.committed" />
                <Trash2 :size="14" /> 二次确认：按街道授权规则清理该已停业注销记录（历史履历永久留存可查）
              </label>
            </template>
            <div v-else style="color: var(--warn); font-size: 12.5px">
              <Lock :size="13" /> 当前角色「{{ role.name }}」无存量记录清理授权，仅街道管理员可确认删除。
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ==================== 5. 台账查询、行级隔离、脱敏防反查与字段级履历（R24/R31） ==================== -->
    <template v-else-if="activeTab === 'query'">
      <section class="panel panel-body verify-identity-bar">
        <span><strong>当前行级权限策略：</strong>专职网格员仅可查阅本人经办记录，社区及街道管理员按辖区授权范围查阅</span>
        <div style="display: flex; gap: 6px; flex-wrap: wrap">
          <button
            v-for="r in ROLES"
            :key="r.id"
            type="button"
            class="btn sm"
            :class="{ primary: store.roleId === r.id }"
            @click="switchRole(r.id)"
          >
            {{ r.name }}
          </button>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>台账隔离检索与字段级变更履历（当前可见 {{ isolatedRecords.length }} 条）</h2>
          <button type="button" class="btn sm primary" @click="exportIsolatedCsv">
            <Download :size="13" /> 按当前权限受控导出
          </button>
        </div>
        <div class="panel-body">
          <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px">
            <input
              v-model="queryKeyword"
              type="search"
              class="field-input"
              style="max-width: 340px"
              placeholder="搜主体/社区（试输 138 触发脱敏防反查拦截）"
            />
            <input
              v-model="queryMinGap"
              type="number"
              min="0"
              class="field-input"
              style="width: 170px"
              placeholder="筛选灭火器缺口 ≥"
            />
          </div>

          <div v-if="collisionBlocked" class="collision-banner">
            <ShieldAlert :size="16" />
            <span><strong>安全拦截：</strong>身份证号、手机号等敏感个人信息已加密脱敏，不开放明文检索以防撞库反查，请改按商铺名称或所属社区检索。</span>
          </div>

          <div v-else class="table-wrapper" tabindex="0" role="region" aria-label="宽表查询明细">
            <table class="data-table">
              <thead>
                <tr>
                  <th scope="col">主体名称</th>
                  <th scope="col">所属社区</th>
                  <th scope="col">填报人（行级隔离字段）</th>
                  <th scope="col">脱敏手机号</th>
                  <th scope="col">脱敏身份证</th>
                  <th scope="col">缺口(公式)</th>
                  <th scope="col">变更履历</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in isolatedRecords" :key="r.uid">
                  <th scope="row">{{ r.values.shopName }}</th>
                  <td>{{ r.community }}</td>
                  <td><span class="tag st-neutral">{{ r.createdBy }}</span></td>
                  <td class="num">{{ maskValue('phone', r.values.phone) }}</td>
                  <td class="num">{{ maskValue('idcard', r.values.idCard) }}</td>
                  <td class="num">{{ r.values.extGap }} 具</td>
                  <td>
                    <button type="button" class="btn sm ghost" @click="queryHistoryRec = r">
                      查看 {{ r.history.length }} 条履历 ›
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <NativeDrawer
        :open="!!queryHistoryRec"
        :title="queryHistoryRec ? `${queryHistoryRec.values.shopName} · 字段级变更履历` : ''"
        subtitle="记录首次采集、跨科增量归并与存量核查回写的全部字段演变"
        @close="queryHistoryRec = null"
      >
        <div v-if="queryHistoryRec" style="display: grid; gap: 10px">
          <div v-for="(h, i) in queryHistoryRec.history" :key="i" class="panel panel-body">
            <div style="display: flex; justify-content: space-between; margin-bottom: 5px">
              <strong>{{ h.action }}</strong>
              <span class="num" style="font-size: 12px; color: var(--ink-soft)">{{ h.time }}</span>
            </div>
            <div style="font-size: 12px; color: var(--ink-muted); margin-bottom: 6px">经办人：{{ h.operator }} · 来源任务：{{ h.taskName }}</div>
            <div v-for="(c, ci) in h.changes" :key="ci" class="diff-row">
              <span class="df-name">{{ c.field }}</span>
              <span class="df-old">{{ c.oldVal }}</span>
              <span>→</span>
              <span class="df-new">{{ c.newVal }}</span>
            </div>
          </div>
        </div>
      </NativeDrawer>
    </template>

    <!-- ==================== 6. 多级合并表头多工作表报表与用户组授权（R33/R24） ==================== -->
    <div v-else class="grid-2">
      <section class="panel">
        <div class="panel-head">
          <h2>明细报表样式与用户组授权</h2>
          <button type="button" class="btn sm primary" @click="exportRealMultiSheetReport">
            <Download :size="14" /> 导出多工作表合并表头报表（.xls）
          </button>
        </div>
        <div class="panel-body" style="display: grid; gap: 12px">
          <div class="grid-2">
            <div class="form-field">
              <label>起始行定位</label>
              <input v-model.number="activeReport.startRow" type="number" min="1" max="10" class="field-input" />
            </div>
            <div class="form-field">
              <label>起始列定位</label>
              <input v-model.number="activeReport.startCol" type="number" min="1" max="5" class="field-input" />
            </div>
          </div>

          <div class="tl-head" style="margin: 4px 0">科室 / 社区 / 网格用户组数据授权矩阵</div>
          <div class="table-wrapper" tabindex="0" role="region" aria-label="用户组授权矩阵">
            <table class="data-table">
              <thead>
                <tr>
                  <th scope="col">用户组</th>
                  <th scope="col">权限级别</th>
                  <th scope="col">成员</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="ug in dd.userGroups" :key="ug.id">
                  <th scope="row">{{ ug.name }}</th>
                  <td><span class="tag" :class="ug.role.includes('管理员') ? 'st-ok' : 'st-run'">{{ ug.role }}</span></td>
                  <td>{{ ug.members.join('、') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2>仿电子表格实时预览（合并表头 × 多工作表）</h2>
          <div style="display: flex; gap: 4px">
            <button
              v-for="(sh, idx) in activeReport.sheets"
              :key="sh.id"
              type="button"
              class="btn sm"
              :class="{ primary: previewSheetIdx === idx }"
              @click="previewSheetIdx = idx"
            >
              {{ sh.name }}
            </button>
          </div>
        </div>
        <div class="panel-body">
          <div class="excel-preview">
            <div class="ep-title">{{ activeReport.name }}</div>
            <div class="ep-sub">起始定位：第 {{ activeReport.startRow }} 行第 {{ activeReport.startCol }} 列 · 当前权限可见 {{ isolatedRecords.length }} 条真实记录</div>
            <table v-if="previewSheetIdx === 0" class="ep-table">
              <thead>
                <tr>
                  <th colspan="4" class="ep-g1">基础主体信息</th>
                  <th colspan="3" class="ep-g2">消防安全核查（应急办）</th>
                  <th colspan="2" class="ep-g3">市场监管核验</th>
                </tr>
                <tr>
                  <th>商铺名称</th><th>社区</th><th>负责人</th><th>脱敏手机</th>
                  <th>应配/实配</th><th>缺口(公式)</th><th>报警器</th>
                  <th>食品许可</th><th>健康证</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in isolatedRecords" :key="r.uid">
                  <td>{{ r.values.shopName }}</td>
                  <td>{{ r.community }}</td>
                  <td>{{ r.values.ownerName }}</td>
                  <td class="num">{{ maskValue('phone', r.values.phone) }}</td>
                  <td class="num">{{ r.values.requiredExt }}/{{ r.values.actualExt }}</td>
                  <td class="num">{{ r.values.extGap }}</td>
                  <td>{{ r.values.gasAlarm }}</td>
                  <td>{{ r.values.foodLicense || '待补充' }}</td>
                  <td class="num">{{ r.values.healthCerts === '' ? '—' : r.values.healthCerts }}</td>
                </tr>
              </tbody>
            </table>
            <div v-else style="padding: 20px; text-align: center; color: var(--ink-muted)">
              工作表「{{ activeReport.sheets[previewSheetIdx]?.name }}」已绑定实时宽表聚合引擎，点击左侧导出按钮将随主表一并生成多页签标准表格文件。
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 「台账 + 任务 + 报表」一键成套向导抽屉（R33） -->
    <NativeDrawer
      :open="wizardOpen"
      title="台账 + 任务 + 报表 一键成套向导"
      subtitle="三步同步创建宽表结构、发布周期采集任务并绑定合并表头报表"
      @close="wizardOpen = false"
    >
      <div class="wiz-steps">
        <span :class="{ active: wizardStep === 1 }">选定台账结构</span>
        <span>→</span>
        <span :class="{ active: wizardStep === 2 }">下发采集任务</span>
        <span>→</span>
        <span :class="{ active: wizardStep === 3 }">配好汇总报表</span>
      </div>
      <div class="panel panel-body" style="display: grid; gap: 12px">
        <div v-if="wizardStep === 1" class="form-field">
          <label>新建宽表台账名称（自动继承主键归并与公式防改规则）</label>
          <input v-model="wizardForm.ledgerName" class="field-input" />
        </div>
        <div v-else-if="wizardStep === 2" class="form-field">
          <label>同步发布的采集任务名称（仅下发社区增量核填字段）</label>
          <input v-model="wizardForm.taskName" class="field-input" />
        </div>
        <div v-else class="form-field">
          <label>同步生成的合并表头标准明细报表名称</label>
          <input v-model="wizardForm.reportName" class="field-input" />
        </div>
      </div>
      <template #footer>
        <button v-if="wizardStep > 1" type="button" class="btn" @click="wizardStep--">上一步</button>
        <button v-if="wizardStep < 3" type="button" class="btn primary" @click="wizardStep++">下一步</button>
        <button v-else type="button" class="btn ok" @click="finishWizard">一键成套生成并发布</button>
      </template>
    </NativeDrawer>
  </AppShell>
</template>

<style scoped>
.burden-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 12px 18px;
  border-radius: 8px;
  background: var(--surface);
  border: 1px solid var(--line);
}

.bs-cell span { display: block; font-size: 11.5px; color: var(--ink-soft); }
.bs-cell strong { font-size: 17px; }
.bs-arrow { font-size: 20px; color: var(--brand-2); font-weight: 700; }

.bs-pill {
  padding: 7px 14px;
  border-radius: 6px;
  background: var(--ok-soft);
  color: var(--ok);
  display: flex;
  align-items: center;
  gap: 10px;
}

.bs-pill strong { font-size: 15px; }
.bs-pill span { font-size: 12px; }

.dd-subnav {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.dd-subnav button {
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

.dd-subnav button.active {
  background: var(--brand);
  border-color: var(--brand);
  color: #ffffff;
}

.task-card {
  padding: 11px 13px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--sunken);
  cursor: pointer;
}

.task-card.active {
  border-color: var(--primary);
  background: var(--primary-soft);
  box-shadow: var(--e1);
}
.task-card.locked { opacity: 0.78; }

.tc-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.tc-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.tip-box {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--r-sm);
  background: var(--status-wait-soft);
  border: 1px solid var(--line-strong);
  font-size: 12.5px;
  color: var(--ink);
  line-height: 1.6;
}

.blk-tag {
  padding: 2px 8px;
  border-radius: var(--r-tag);
  font-weight: 600;
}
.blk-base { background: var(--status-neutral-soft); color: var(--status-neutral); }
.blk-fire { background: var(--status-run-soft); color: var(--status-run); }
.blk-market { background: var(--status-wait-soft); color: var(--status-wait); }

.th-base { background: var(--sunken) !important; }
.th-fire { background: var(--status-run-soft) !important; color: var(--status-run) !important; }
.th-market { background: var(--status-wait-soft) !important; color: var(--status-wait) !important; }
.td-fire { background: var(--surface); }
.td-market { background: var(--surface); }

.row-pulse td, .row-pulse th {
  background: var(--status-ok-soft) !important;
  transition: background-color 0.4s ease;
}

.formula-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border-radius: var(--r-tag);
  background: var(--sunken);
  color: var(--ink);
  border: 1px solid var(--line-strong);
  font-weight: 650;
  font-size: 12px;
}

.model-2col {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) 360px;
  gap: 14px;
  align-items: stretch;
}

.model-2col > .panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

@media (max-width: 1200px) {
  .model-2col { grid-template-columns: 1fr; }
}

.done-banner {
  padding: 9px 12px;
  border-radius: 6px;
  background: var(--ok-soft);
  color: var(--ok);
  font-size: 12.5px;
  margin-bottom: 10px;
}

.pk-banner {
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--brand-soft);
  color: var(--brand);
  font-size: 12.5px;
  margin-bottom: 12px;
}

.diag-bar {
  display: flex;
  gap: 20px;
  padding: 9px 14px;
  background: var(--sunken);
  border-radius: 6px;
  margin-bottom: 10px;
  font-size: 13px;
}

.diff-card {
  padding: 13px 15px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--sunken);
}

.diff-card.del {
  border-color: var(--status-bad);
  background: var(--status-bad-soft);
}

.dc-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.dc-reason {
  margin: 0 0 10px;
  font-size: 12.5px;
  color: var(--ink-muted);
}

.diff-grid {
  display: grid;
  gap: 6px;
}

.diff-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  flex-wrap: wrap;
}

.df-name {
  min-width: 140px;
  font-weight: 600;
  color: var(--ink-muted);
}

.df-old {
  padding: 2px 7px;
  border-radius: var(--r-xs);
  background: var(--status-bad-soft);
  color: var(--status-bad);
  text-decoration: line-through;
}

.df-new {
  padding: 2px 7px;
  border-radius: var(--r-xs);
  background: var(--status-ok-soft);
  color: var(--status-ok);
  font-weight: 650;
}

.del-confirm {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--line-strong);
}

.verify-identity-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  background: var(--primary-soft);
}

.collision-banner {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 14px 16px;
  border-radius: var(--r-sm);
  background: var(--status-bad-soft);
  border: 1px solid var(--status-bad);
  color: var(--status-bad);
  font-size: 13px;
}

.excel-preview {
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  overflow: auto;
  background: var(--surface);
}

.ep-title {
  text-align: center;
  font-weight: 700;
  font-size: 15px;
  padding: 10px;
  border-bottom: 1px solid var(--line);
}

.ep-sub {
  font-size: 11.5px;
  color: var(--ink-soft);
  padding: 5px 10px;
  background: var(--sunken);
  border-bottom: 1px solid var(--line);
}

.ep-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.ep-table th, .ep-table td {
  border: 1px solid var(--line);
  padding: 6px 8px;
  white-space: nowrap;
}

.ep-g1 { background: var(--inverse-surface); color: var(--inverse-ink); }
.ep-g2 { background: var(--primary); color: var(--on-primary); }
.ep-g3 { background: #b4690e; color: #ffffff; }

.wiz-steps {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 14px;
  font-size: 13px;
  color: var(--ink-soft);
}

.wiz-steps span.active {
  color: var(--brand-2);
  font-weight: 700;
}
</style>
