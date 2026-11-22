<script setup>
import { ref, computed } from 'vue'
import {
  Search, Shield, Flag, Users, Compass, BookOpen, FileText, Image as ImageIcon,
  Plus, ChevronLeft, ChevronRight, Lock
} from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import AppSelect from '../components/AppSelect.vue'
import GeoMap from '../components/GeoMap.vue'
import ChangheCity3D from '../components/ChangheCity3D.vue'
import EvidencePhoto from '../components/EvidencePhoto.vue'
import NativeDrawer from '../components/NativeDrawer.vue'
import DrilldownDrawer from '../components/DrilldownDrawer.vue'
import {
  store, COMMUNITIES, getCurrentRole, getEffectiveCommunity, getVisibleCommunities, addAuditLog, showToast, nowStr
} from '../store/appStore'
import { buildMilitiaRosterDrill } from '../utils/drilldownData'
import { maskValue } from '../utils/validators'
import { buildScenePhoto } from '../utils/sampleImages'

const role = computed(() => getCurrentRole())
const scope = computed(() => getEffectiveCommunity())

const activeTopic = ref('party') // party | militia | recruit | mobilize | education
const armedMapView = ref('city3d') // city3d | flat
const searchComm = ref('')
const planFilter = ref('全部')
const militiaTab = ref('民兵整组')
const recruitStageKey = ref('兵役登记')
const mobilizeLayer = ref('both') // both | rally | veteran
const eduPhotoTab = ref('教育现场')

// 民兵连点旗验兵抽屉
const militiaDrawerComm = ref(null)
// 全街道基干民兵分队花名册下钻
const militiaDrill = ref({ open: false, title: '', subtitle: '', summary: '', filters: [], columns: [], rows: [], exportName: '' })

function openMilitiaRoster(initialSquad = '') {
  const payload = buildMilitiaRosterDrill(getVisibleCommunities(), scope.value, role.value.canViewArmedRoster, initialSquad)
  militiaDrill.value = { open: true, ...payload }
  addAuditLog(`查阅数字武装「${payload.title}」${initialSquad ? `（${initialSquad}）` : ''}`, role.value.canViewArmedRoster ? '授权查阅' : '名册脱敏拦截')
}
// 国防教育阵地名片
const selectedEduPlace = ref(store.armedForces.education.places[0])

// 共用多形态资料阅览器（支持同栏目上一份/下一份无缝切换）
const viewer = ref({ open: false, colTitle: '', list: [], idx: 0 })

// 授权管理员资料维护抽屉（R7）
const manageOpen = ref(false)
const uploadForm = ref({
  topic: 'party',
  subCol: '党工委专题会议',
  community: '德馨社区',
  title: '',
  kind: 'redhead',
  content: ''
})

const TOPICS = [
  { id: 'party', label: '党管武装', color: '#b91c1c', icon: Shield },
  { id: 'militia', label: '民兵工作', color: '#2d5a3c', icon: Flag },
  { id: 'recruit', label: '征兵工作', color: '#1a4b8c', icon: Users },
  { id: 'mobilize', label: '国防动员', color: '#c2410c', icon: Compass },
  { id: 'education', label: '国防教育', color: '#0f6b75', icon: BookOpen }
]

const matchedComms = computed(() => {
  const q = searchComm.value.trim()
  if (!q) return []
  return COMMUNITIES.filter((c) => c.name.includes(q))
})

const activeTopicColor = computed(() => TOPICS.find((t) => t.id === activeTopic.value)?.color || '#1a4b8c')

const filteredPlans = computed(() => {
  const list = store.armedForces.party.plans
  if (planFilter.value === '全部') return list
  return list.filter((p) => p.status === planFilter.value)
})

const currentRecruitStage = computed(() =>
  store.armedForces.recruit.funnel.find((f) => f.key === recruitStageKey.value) || store.armedForces.recruit.funnel[0]
)

const filteredEduPhotos = computed(() =>
  store.armedForces.education.photos.filter((p) => p.category === eduPhotoTab.value)
)

function locateCommunity(name) {
  store.selectedCommunity = name
  searchComm.value = name
  showToast(`已定位至「${name}」武装专题阵地`)
}

function resetLocation() {
  if (role.value.scope === '全街道') store.selectedCommunity = '全街道'
  searchComm.value = ''
}

function openDocViewer(colTitle, list, startIdx = 0) {
  if (!list || !list.length) return
  viewer.value = { open: true, colTitle, list, idx: startIdx }
  addAuditLog(`在数字武装查阅栏目资料「${colTitle} · ${list[startIdx].title}」`, '留痕调阅')
}

function handleMapPointClick(pt) {
  if (activeTopic.value === 'militia') {
    militiaDrawerComm.value = pt
    addAuditLog(`点选民兵连旗标查阅「${pt.name}民兵连」编成`, role.value.canViewArmedRoster ? '授权查阅' : '名册脱敏拦截')
  } else if (activeTopic.value === 'education') {
    selectedEduPlace.value = pt
  } else if (pt?.name) {
    showToast(`已聚焦「${pt.name}」专题阵地`)
  }
}

function submitMaterial() {
  const f = uploadForm.value
  if (!f.title.trim()) return
  const id = 'doc-' + Date.now()
  if (f.kind === 'photo') {
    const newPhoto = {
      id,
      title: f.title.trim(),
      community: f.community,
      date: nowStr().slice(0, 10),
      desc: f.content.trim() || '武装部后台新上传的活动纪实影像资料。',
      category: '国防教育讲堂',
      src: buildScenePhoto({ scene: f.topic === 'party' ? 'visit' : f.topic === 'militia' ? 'militia' : f.topic === 'mobilize' ? 'double' : 'edu', title: f.title.trim(), location: `${f.community}活动阵地`, time: nowStr(), person: role.value.userName })
    }
    if (f.topic === 'party') store.armedForces.party.photos.unshift(newPhoto)
    else if (f.topic === 'militia') store.armedForces.militia.photos.unshift(newPhoto)
    else if (f.topic === 'mobilize') store.armedForces.mobilize.photos.unshift(newPhoto)
    else store.armedForces.education.photos.unshift(newPhoto)
  } else {
    const newDoc = {
      id,
      title: f.title.trim(),
      docNo: `长武装〔2026〕${Math.floor(Math.random() * 20) + 10} 号`,
      date: nowStr().slice(0, 10),
      unit: '长河街道人民武装部',
      type: f.kind,
      content: f.content.trim() || '经授权管理员审核上传至长河街道独立达梦信创库归档。'
    }
    if (f.topic === 'party') {
      const col = store.armedForces.party.columns.find((c) => c.name === f.subCol) || store.armedForces.party.columns[0]
      col.docs.unshift(newDoc)
    } else if (f.topic === 'militia') {
      store.armedForces.militia.tabs['民兵整组'].unshift(newDoc)
    } else if (f.topic === 'recruit') {
      store.armedForces.recruit.funnel[0].docs.unshift(newDoc)
    } else if (f.topic === 'mobilize') {
      store.armedForces.mobilize.veteranDocs.unshift(newDoc)
    } else {
      store.armedForces.education.courses.unshift({ ...newDoc, pages: '18 页', updated: newDoc.date })
    }
  }
  addAuditLog(`管理员上传维护数字武装资料「${f.title.trim()}」`, '后台维护')
  showToast('资料已上传归档，专题前台与预览画廊已实时生效')
  uploadForm.value.title = ''
  uploadForm.value.content = ''
  manageOpen.value = false
}
</script>

<template>
  <AppShell title="数字武装" subtitle="党管武装、民兵组织、征兵工作、国防动员与国防教育五专题">
    <!-- 顶部共用：五专题切换 + 14社区中文检索 + 管理员维护入口 -->
    <section class="armed-bar">
      <div class="ab-topics">
        <button
          v-for="t in TOPICS"
          :key="t.id"
          type="button"
          class="ab-tab"
          :class="{ active: activeTopic === t.id }"
          :style="activeTopic === t.id ? { borderBottom: `2.5px solid ${t.color}`, color: t.color, background: 'var(--sunken)' } : {}"
          @click="activeTopic = t.id"
        >
          <component :is="t.icon" :size="15" />
          <span>{{ t.label }}</span>
        </button>
      </div>

      <div class="ab-tools">
        <div class="ui-tabs" style="padding: 2px">
          <button type="button" :class="{ active: armedMapView === 'city3d' }" @click="armedMapView = 'city3d'">三维实景</button>
          <button type="button" :class="{ active: armedMapView === 'flat' }" @click="armedMapView = 'flat'">平面沙盘</button>
        </div>
        <div class="comm-search-wrap">
          <Search :size="14" />
          <input
            v-model="searchComm"
            type="search"
            class="field-input"
            placeholder="搜社区名定位（如：泰和）"
          />
          <div v-if="matchedComms.length && searchComm !== scope" class="search-suggest">
            <button v-for="c in matchedComms" :key="c.id" type="button" @click="locateCommunity(c.name)">
              {{ c.name }}（定位地图）
            </button>
          </div>
        </div>
        <button v-if="scope !== '全街道' && role.scope === '全街道'" type="button" class="btn sm" @click="resetLocation">
          返回全街道
        </button>
        <button v-if="role.canManageArmedDocs" type="button" class="btn sm primary" @click="manageOpen = true">
          <Plus :size="14" />
          <span>资料与影像维护</span>
        </button>
      </div>
    </section>

    <!-- ==================== 专题一：党管武装（政味、履职标尺、红头公文柜） ==================== -->
    <template v-if="activeTopic === 'party'">
      <section class="panel">
        <div class="panel-head">
          <h2>年度党管武装履职进度标尺</h2>
          <span class="tag st-party">党工委议武述职全周期留痕</span>
        </div>
        <div class="panel-body party-ruler">
          <div v-for="st in store.armedForces.party.steps" :key="st.name" class="pr-step" :class="{ done: st.status === '已完成' }">
            <div class="pr-dot"></div>
            <strong>{{ st.name }}</strong>
            <small>{{ st.date }} · {{ st.owner }}</small>
          </div>
        </div>
      </section>

      <div class="party-3col">
        <section class="panel">
          <div class="panel-head"><h2>红头公文与议武卷宗柜</h2><small>5 大法定栏目</small></div>
          <div class="panel-body folder-list">
            <button
              v-for="col in store.armedForces.party.columns"
              :key="col.id"
              type="button"
              class="folder-card"
              @click="openDocViewer(col.name, col.docs, 0)"
            >
              <div class="fc-head">
                <FileText :size="16" style="color: var(--party-red)" />
                <strong>{{ col.name }}</strong>
                <span class="tag st-party num">{{ col.docs.length }} 份</span>
              </div>
              <small>{{ col.docs[0]?.title }}</small>
            </button>
          </div>
        </section>

        <section class="panel map-mid-panel">
          <div class="panel-head"><h2>书记调研与走访慰问足迹图</h2><small>14 社区红星覆盖</small></div>
          <div class="armed-map-box">
            <ChangheCity3D
              v-if="armedMapView === 'city3d'"
              mode="armed"
              armed-topic="party"
              :compact="true"
              :selected-community="scope"
              @select-community="locateCommunity"
              @webgl-fallback="armedMapView = 'flat'"
            />
            <GeoMap v-else mode="armed" armed-topic="party" :selected-community="scope" @select-community="locateCommunity" />
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>年度重点工作计划</h2>
            <div style="display: flex; gap: 4px">
              <button v-for="st in ['全部', '进行中', '已完成']" :key="st" type="button" class="btn sm" :class="{ primary: planFilter === st }" @click="planFilter = st">{{ st }}</button>
            </div>
          </div>
          <div class="panel-body plan-list">
            <div v-for="pl in filteredPlans" :key="pl.id" class="plan-item">
              <div class="pi-top">
                <strong>{{ pl.title }}</strong>
                <span class="tag" :class="pl.status === '已完成' ? 'st-ok' : 'st-run'">{{ pl.status }}</span>
              </div>
              <small>责任人：{{ pl.owner }} · 节点：{{ pl.deadline }}</small>
              <div class="progress-track" style="margin-top: 6px"><div class="progress-fill ok" :style="{ width: pl.progress + '%' }"></div></div>
            </div>
          </div>
        </section>
      </div>

      <section class="panel">
        <div class="panel-head"><h2>走访慰问纪实画廊</h2><small>点击大图翻阅</small></div>
        <div class="panel-body photo-strip cols-3">
          <button
            v-for="(ph, idx) in store.armedForces.party.photos"
            :key="ph.id"
            type="button"
            class="photo-thumb"
            @click="openDocViewer('党管武装 · 走访慰问画廊', store.armedForces.party.photos.map((x) => ({ ...x, type: 'photo', tone: 'visit' })), idx)"
          >
            <EvidencePhoto
              :src="ph.src"
              :title="ph.title"
              tone="visit"
              :location="ph.community"
              :time="ph.date"
              :compact="true"
              :previewable="false"
              priority="lazy"
            />
            <span class="pt-cap">{{ ph.title }}</span>
          </button>
        </div>
      </section>
    </template>

    <!-- ==================== 专题二：民兵工作（军味、旗标地图C位、点旗验兵） ==================== -->
    <template v-else-if="activeTopic === 'militia'">
      <section class="panel">
        <div class="panel-body squad-bar">
          <button type="button" class="sb-total sb-btn" title="点击查看全街道基干民兵花名册" @click="openMilitiaRoster('')">
            <span>全街道基干民兵在编（点击查名册）</span>
            <strong class="num" style="color: var(--army-green)">336 <small>人 / 14 社区民兵连</small></strong>
          </button>
          <div class="sb-items">
            <button
              v-for="sq in store.armedForces.militia.squadStructure"
              :key="sq.name"
              type="button"
              class="sq-chip sq-btn"
              :title="`点击查看${sq.name}编成人员明细`"
              @click="openMilitiaRoster(sq.name)"
            >
              <span>{{ sq.name }}</span>
              <strong class="num">{{ sq.count }} 人（{{ sq.pct }}%）</strong>
            </button>
          </div>
        </div>
      </section>

      <div class="militia-2col">
        <section class="panel map-mid-panel">
          <div class="panel-head">
            <h2>14 个社区民兵连旗标分布图</h2>
            <span class="tag st-army">点击任意旗标「点旗验兵」查看编成与授权花名册</span>
          </div>
          <div class="armed-map-box tall">
            <ChangheCity3D
              v-if="armedMapView === 'city3d'"
              mode="armed"
              armed-topic="militia"
              :compact="true"
              :selected-community="scope"
              @select-point="handleMapPointClick"
              @webgl-fallback="armedMapView = 'flat'"
            />
            <GeoMap
              v-else
              mode="armed"
              armed-topic="militia"
              :selected-community="scope"
              @select-point="handleMapPointClick"
            />
          </div>
        </section>

        <div style="display: grid; gap: 14px">
          <section class="panel">
            <div class="panel-head"><h2>整组点验与练兵档案</h2></div>
            <div class="panel-body">
              <div class="sub-pills">
                <button
                  v-for="tab in Object.keys(store.armedForces.militia.tabs)"
                  :key="tab"
                  type="button"
                  class="btn sm"
                  :class="{ primary: militiaTab === tab }"
                  @click="militiaTab = tab"
                >
                  {{ tab }}
                </button>
              </div>
              <div class="folder-list" style="margin-top: 10px">
                <button
                  v-for="(doc, idx) in store.armedForces.militia.tabs[militiaTab]"
                  :key="doc.id"
                  type="button"
                  class="folder-card"
                  @click="openDocViewer(`民兵工作 · ${militiaTab}`, store.armedForces.militia.tabs[militiaTab], idx)"
                >
                  <div class="fc-head">
                    <strong>{{ doc.title }}</strong>
                    <span class="num" style="font-size: 11.5px; color: var(--ink-soft)">{{ doc.date }}</span>
                  </div>
                  <small>{{ doc.unit }} · 点击调阅正文</small>
                </button>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h2>参建参治风采墙</h2><small>实战演练与平安联勤</small></div>
            <div class="panel-body photo-strip cols-2">
              <button
                v-for="(ph, idx) in store.armedForces.militia.photos"
                :key="ph.id"
                type="button"
                class="photo-thumb"
                @click="openDocViewer('民兵参建参治风采', store.armedForces.militia.photos.map((x) => ({ ...x, type: 'photo', tone: 'militia' })), idx)"
              >
                <EvidencePhoto
                  :src="ph.src"
                  :title="ph.title"
                  tone="militia"
                  :location="ph.community"
                  :time="ph.date"
                  :compact="true"
                  :previewable="false"
                  priority="lazy"
                />
                <span class="pt-cap">{{ ph.title }}</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </template>

    <!-- ==================== 专题三：征兵工作（六环节推进漏斗 + 登记热标 + 五年质效图） ==================== -->
    <template v-else-if="activeTopic === 'recruit'">
      <section class="panel">
        <div class="panel-head">
          <h2>征兵工作六环节全链路漏斗（点击任一环节联动查阅该环节全部资料）</h2>
          <span class="tag st-run">2026 年度征兵周期</span>
        </div>
        <div class="panel-body funnel-row">
          <button
            v-for="st in store.armedForces.recruit.funnel"
            :key="st.key"
            type="button"
            class="funnel-card"
            :class="{ active: recruitStageKey === st.key }"
            @click="recruitStageKey = st.key"
          >
            <span class="fn-name">{{ st.label }}</span>
            <strong class="num">{{ st.count }} <small>人</small></strong>
            <small>归档资料 {{ st.docs.length }} 份</small>
          </button>
        </div>
      </section>

      <div class="grid-2">
        <section class="panel map-mid-panel">
          <div class="panel-head"><h2>14 个社区兵役登记服务处人数热标图</h2><small>绿达标 / 蓝稳步 / 橙督导</small></div>
          <div class="armed-map-box">
            <ChangheCity3D
              v-if="armedMapView === 'city3d'"
              mode="armed"
              armed-topic="recruit"
              :compact="true"
              :selected-community="scope"
              @select-community="locateCommunity"
              @webgl-fallback="armedMapView = 'flat'"
            />
            <GeoMap v-else mode="armed" armed-topic="recruit" :selected-community="scope" @select-community="locateCommunity" />
          </div>
        </section>

        <div style="display: grid; gap: 14px">
          <section class="panel">
            <div class="panel-head"><h2>近五年征兵入伍总数与大学生兵源占比</h2><small>兵源质量连年攀升</small></div>
            <div class="panel-body trend-bars">
              <div v-for="row in store.armedForces.recruit.fiveYearTrend" :key="row.year" class="tb-col">
                <span class="num tb-pct">大学生 {{ row.collegePct }}%</span>
                <div class="tb-bar-wrap">
                  <div class="tb-bar" :style="{ height: Math.round((row.total / 65) * 100) + '%' }">
                    <b class="num">{{ row.total }}</b>
                  </div>
                </div>
                <span class="num tb-year">{{ row.year }}年</span>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <h2>「{{ currentRecruitStage.label }}」专题资料与工作记录</h2>
              <span class="tag st-run">{{ currentRecruitStage.count }} 人</span>
            </div>
            <div class="panel-body">
              <div class="folder-list" style="margin-bottom: 12px">
                <button
                  v-for="(doc, idx) in currentRecruitStage.docs"
                  :key="doc.id"
                  type="button"
                  class="folder-card"
                  @click="openDocViewer(`征兵工作 · ${currentRecruitStage.label}`, currentRecruitStage.docs, idx)"
                >
                  <div class="fc-head"><strong>{{ doc.title }}</strong><span class="tag st-run">调阅</span></div>
                  <small>{{ doc.unit }} · {{ doc.date }}</small>
                </button>
              </div>
              <div class="log-mini">
                <div v-for="(lg, i) in store.armedForces.recruit.workLogs" :key="i" class="lm-row">
                  <span class="num">{{ lg.date }}</span>
                  <b>{{ lg.community }}</b>
                  <span>{{ lg.text }}</span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </template>

    <!-- ==================== 专题四：国防动员（指挥架构 + 三大预案 + 平战双图层 + 双拥） ==================== -->
    <template v-else-if="activeTopic === 'mobilize'">
      <div class="party-3col">
        <div style="display: grid; gap: 14px">
          <section class="panel">
            <div class="panel-head"><h2>国防动员领导小组架构</h2></div>
            <div class="panel-body leader-tree">
              <div v-for="ld in store.armedForces.mobilize.leaders" :key="ld.name" class="lt-node">
                <div class="lt-top">
                  <span class="tag st-bad">{{ ld.role }}</span>
                  <strong>{{ ld.name }}</strong>
                </div>
                <small>{{ ld.title }} · {{ ld.duty }}</small>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h2>三大战备预案一键启阅</h2></div>
            <div class="panel-body folder-list">
              <button
                v-for="(pl, idx) in store.armedForces.mobilize.plans"
                :key="pl.id"
                type="button"
                class="folder-card mobilize-card"
                @click="openDocViewer('国防动员 · 战备与收拢预案', store.armedForces.mobilize.plans.map((x) => ({ ...x, title: x.name })), idx)"
              >
                <div class="fc-head"><strong>{{ pl.name }}</strong><span class="tag st-warn">{{ pl.response }}</span></div>
                <small>修订：{{ pl.updated }} · 覆盖：{{ pl.points }}</small>
              </button>
            </div>
          </section>
        </div>

        <section class="panel map-mid-panel">
          <div class="panel-head">
            <h2>平战结合双图层专题地图</h2>
            <div style="display: flex; gap: 4px">
              <button type="button" class="btn sm" :class="{ primary: mobilizeLayer === 'both' }" @click="mobilizeLayer = 'both'">叠加视图</button>
              <button type="button" class="btn sm" :class="{ primary: mobilizeLayer === 'rally' }" @click="mobilizeLayer = 'rally'">应急收拢点</button>
              <button type="button" class="btn sm" :class="{ primary: mobilizeLayer === 'veteran' }" @click="mobilizeLayer = 'veteran'">退役军人服务</button>
            </div>
          </div>
          <div class="armed-map-box tall">
            <ChangheCity3D
              v-if="armedMapView === 'city3d'"
              mode="armed"
              armed-topic="mobilize"
              :mobilize-layer="mobilizeLayer"
              :compact="true"
              :selected-community="scope"
              @select-community="locateCommunity"
              @webgl-fallback="armedMapView = 'flat'"
            />
            <GeoMap v-else mode="armed" armed-topic="mobilize" :mobilize-layer="mobilizeLayer" :selected-community="scope" @select-community="locateCommunity" />
          </div>
        </section>

        <div style="display: grid; gap: 14px">
          <section class="panel">
            <div class="panel-head"><h2>退役军人服务政策与台账</h2></div>
            <div class="panel-body folder-list">
              <button
                v-for="(doc, idx) in store.armedForces.mobilize.veteranDocs"
                :key="doc.id"
                type="button"
                class="folder-card"
                @click="openDocViewer('退役军人服务专栏', store.armedForces.mobilize.veteranDocs, idx)"
              >
                <div class="fc-head"><strong>{{ doc.title }}</strong><span class="tag st-neutral">翻阅</span></div>
                <small>{{ doc.unit }} · {{ doc.date }}</small>
              </button>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h2>双拥共建温情画廊</h2></div>
            <div class="panel-body photo-strip">
              <button
                v-for="(ph, idx) in store.armedForces.mobilize.photos"
                :key="ph.id"
                type="button"
                class="photo-thumb"
                @click="openDocViewer('国防动员 · 双拥共建画廊', store.armedForces.mobilize.photos.map((x) => ({ ...x, type: 'photo', tone: 'double' })), idx)"
              >
                <EvidencePhoto
                  :src="ph.src"
                  :title="ph.title"
                  tone="double"
                  :location="ph.community"
                  :time="ph.date"
                  :compact="true"
                  :previewable="false"
                  priority="lazy"
                />
                <span class="pt-cap">{{ ph.title }}</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </template>

    <!-- ==================== 专题五：国防教育（阵地打卡图 + 活跃度统计 + 精品课件书架 + 讲堂影廊） ==================== -->
    <template v-else>
      <div class="grid-2">
        <section class="panel map-mid-panel">
          <div class="panel-head"><h2>辖区国防教育阵地打卡地图</h2><small>点击场馆查看阵地名片</small></div>
          <div class="armed-map-box">
            <ChangheCity3D
              v-if="armedMapView === 'city3d'"
              mode="armed"
              armed-topic="education"
              :armed-places="store.armedForces.education.places"
              :compact="true"
              :selected-community="scope"
              @select-point="handleMapPointClick"
              @webgl-fallback="armedMapView = 'flat'"
            />
            <GeoMap
              v-else
              mode="armed"
              armed-topic="education"
              :armed-places="store.armedForces.education.places"
              :selected-community="scope"
              @select-point="handleMapPointClick"
            />
          </div>
          <div v-if="selectedEduPlace" class="place-card">
            <div>
              <strong>{{ selectedEduPlace.name }}</strong>
              <small>{{ selectedEduPlace.address }} · 容纳 {{ selectedEduPlace.capacity }} 人 · 近期：{{ selectedEduPlace.latest }}</small>
            </div>
            <div class="pc-nums num">
              <span><b>{{ selectedEduPlace.count }}</b> 场</span>
              <span><b>{{ selectedEduPlace.people }}</b> 人次</span>
            </div>
          </div>
        </section>

        <div style="display: grid; gap: 14px">
          <section class="panel">
            <div class="panel-head"><h2>各月份国防教育活动场次与受众人数</h2></div>
            <div class="panel-body trend-bars">
              <div v-for="m in store.armedForces.education.monthlyTrend" :key="m.month" class="tb-col">
                <span class="num tb-pct">{{ m.people }}人次</span>
                <div class="tb-bar-wrap">
                  <div class="tb-bar teal" :style="{ height: Math.round((m.count / 18) * 100) + '%' }">
                    <b class="num">{{ m.count }}场</b>
                  </div>
                </div>
                <span class="num tb-year">{{ m.month }}</span>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head"><h2>国防教育精品课程书架</h2><small>点击在线翻页</small></div>
            <div class="panel-body folder-list">
              <button
                v-for="(cs, idx) in store.armedForces.education.courses"
                :key="cs.id"
                type="button"
                class="folder-card"
                @click="openDocViewer('国防教育精品课件库', store.armedForces.education.courses, idx)"
              >
                <div class="fc-head"><strong>{{ cs.title }}</strong><span class="tag st-run">{{ cs.pages }}</span></div>
                <small>{{ cs.unit }} · 更新于 {{ cs.updated }}</small>
              </button>
            </div>
          </section>
        </div>
      </div>

      <section class="panel">
        <div class="panel-head">
          <h2>国防教育现场与讲堂实景双通道影廊</h2>
          <div style="display: flex; gap: 6px">
            <button type="button" class="btn sm" :class="{ primary: eduPhotoTab === '教育现场' }" @click="eduPhotoTab = '教育现场'">国防教育现场</button>
            <button type="button" class="btn sm" :class="{ primary: eduPhotoTab === '国防教育讲堂' }" @click="eduPhotoTab = '国防教育讲堂'">国防教育讲堂</button>
          </div>
        </div>
        <div class="panel-body photo-strip cols-3">
          <button
            v-for="(ph, idx) in filteredEduPhotos"
            :key="ph.id"
            type="button"
            class="photo-thumb"
            @click="openDocViewer(`国防教育 · ${eduPhotoTab}`, filteredEduPhotos.map((x) => ({ ...x, type: 'photo', tone: 'edu' })), idx)"
          >
            <EvidencePhoto
              :src="ph.src"
              :title="ph.title"
              tone="edu"
              :location="ph.community"
              :time="ph.date"
              :compact="true"
              :previewable="false"
              priority="lazy"
            />
            <span class="pt-cap">{{ ph.title }}（{{ ph.community }} · {{ ph.date }}）</span>
          </button>
        </div>
      </section>
    </template>

    <!-- 民兵连点旗验兵授权名册抽屉（R9） -->
    <NativeDrawer
      :open="!!militiaDrawerComm"
      :title="militiaDrawerComm ? `${militiaDrawerComm.name}民兵连 · 编成与授权花名册` : ''"
      subtitle="点旗验兵 · 敏感联系方式严格按登录角色权限控制"
      @close="militiaDrawerComm = null"
    >
      <template v-if="militiaDrawerComm">
        <div class="grid-3" style="margin-bottom: 14px">
          <div class="panel panel-body"><small>民兵连长</small><div style="font-size: 16px; font-weight: 700; margin-top: 4px">{{ militiaDrawerComm.armed.militiaCap }}</div></div>
          <div class="panel panel-body"><small>在编基干民兵</small><div class="num" style="font-size: 18px; font-weight: 700; color: var(--army-green); margin-top: 4px">{{ militiaDrawerComm.armed.militia }} 人</div></div>
          <div class="panel panel-body"><small>指导员（社区书记）</small><div style="font-size: 16px; font-weight: 700; margin-top: 4px">{{ militiaDrawerComm.lead }}</div></div>
        </div>

        <div v-if="role.canViewArmedRoster" class="panel">
          <div class="panel-head"><h3>授权可查阅基干民兵花名册（联系方式已国密脱敏）</h3></div>
          <div class="table-wrapper" tabindex="0" role="region" aria-label="民兵连花名册">
            <table class="data-table">
              <thead>
                <tr>
                  <th scope="col">姓名</th>
                  <th scope="col">所属分队</th>
                  <th scope="col">职务</th>
                  <th scope="col">专业特长</th>
                  <th scope="col">脱敏联系电话</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="m in store.armedForces.militia.rosterSample.filter((x) => !militiaDrawerComm || x.community === militiaDrawerComm.name).length
                    ? store.armedForces.militia.rosterSample.filter((x) => !militiaDrawerComm || x.community === militiaDrawerComm.name)
                    : store.armedForces.militia.rosterSample.slice(0, 2)"
                  :key="m.name"
                >
                  <th scope="row">{{ m.name }}</th>
                  <td>{{ m.squad }}</td>
                  <td>{{ m.role }}</td>
                  <td>{{ m.skill }}</td>
                  <td class="num">{{ maskValue('phone', m.phone) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div v-else class="panel panel-body" style="text-align: center; padding: 32px">
          <Lock :size="28" style="color: var(--bad); margin-bottom: 8px" />
          <div style="font-weight: 700; margin-bottom: 6px">当前账号未获民兵花名册查阅授权</div>
          <small style="color: var(--ink-soft)">普通岗位仅可见民兵连汇总人数，人员花名册已按政务内网分级权限保护。</small>
        </div>
      </template>
    </NativeDrawer>

    <!-- 共用多形态阅览器（红头公文 / 课件翻页 / 纪实画廊 + 上一份下一份切换，R7） -->
    <NativeDrawer
      :open="viewer.open"
      :title="viewer.colTitle"
      :subtitle="`同栏目共 ${viewer.list.length} 份资料 · 当前第 ${viewer.idx + 1} 份`"
      variant="wide"
      @close="viewer.open = false"
    >
      <template v-if="viewer.list[viewer.idx]">
        <div class="viewer-nav">
          <button type="button" class="btn sm" :disabled="viewer.idx <= 0" @click="viewer.idx--">
            <ChevronLeft :size="14" /> 上一份资料
          </button>
          <span class="num">第 {{ viewer.idx + 1 }} / {{ viewer.list.length }} 份</span>
          <button type="button" class="btn sm" :disabled="viewer.idx >= viewer.list.length - 1" @click="viewer.idx++">
            下一份资料 <ChevronRight :size="14" />
          </button>
        </div>

        <!-- 形态一：红头公文电子红章视图 -->
        <article v-if="viewer.list[viewer.idx].type === 'redhead'" class="redhead-paper">
          <div class="rh-org">中共德州市天衢新区长河街道工作委员会文件</div>
          <div class="rh-docno">{{ viewer.list[viewer.idx].docNo || '长党武〔2026〕8 号' }}</div>
          <div class="rh-line"></div>
          <h3>{{ viewer.list[viewer.idx].title }}</h3>
          <p class="rh-content">{{ viewer.list[viewer.idx].content }}</p>
          <div class="rh-sign">
            <div>{{ viewer.list[viewer.idx].unit }}</div>
            <div class="num">{{ viewer.list[viewer.idx].date }}</div>
            <div class="rh-seal">长河街道<br />武装专用章</div>
          </div>
        </article>

        <!-- 形态二：纪实影像画廊视图 -->
        <div v-else-if="viewer.list[viewer.idx].type === 'photo'" class="photo-viewer">
          <EvidencePhoto
            :src="viewer.list[viewer.idx].src"
            :title="viewer.list[viewer.idx].title"
            :tone="viewer.list[viewer.idx].tone || 'neutral'"
            :location="viewer.list[viewer.idx].community"
            :time="viewer.list[viewer.idx].date"
            :previewable="false"
          />
          <h3>{{ viewer.list[viewer.idx].title }}</h3>
          <p>{{ viewer.list[viewer.idx].community }} · {{ viewer.list[viewer.idx].date }} · {{ viewer.list[viewer.idx].desc }}</p>
        </div>

        <!-- 形态三：规章课件翻页视图 -->
        <article v-else class="course-paper">
          <div class="cp-badge">武装业务教材与台账归档</div>
          <h3>{{ viewer.list[viewer.idx].title }}</h3>
          <div class="cp-meta">编制单位：{{ viewer.list[viewer.idx].unit }} · 归档日期：{{ viewer.list[viewer.idx].date || viewer.list[viewer.idx].updated }}</div>
          <p>{{ viewer.list[viewer.idx].content }}</p>
        </article>
      </template>
    </NativeDrawer>

    <!-- 授权管理员后台资料与图片上传维护抽屉（R7） -->
    <NativeDrawer
      :open="manageOpen"
      title="数字武装栏目资料与活动影像维护"
      subtitle="仅对武装部管理员与街道管理员开放 · 保存后即时同步至专题前台"
      @close="manageOpen = false"
    >
      <form class="upload-form" @submit.prevent="submitMaterial">
        <div class="form-field">
          <label>归属专题</label>
          <AppSelect
            v-model="uploadForm.topic"
            :options="[
              { value: 'party', label: '党管武装' },
              { value: 'militia', label: '民兵工作' },
              { value: 'recruit', label: '征兵工作' },
              { value: 'mobilize', label: '国防动员' },
              { value: 'education', label: '国防教育' }
            ]"
          />
        </div>
        <div class="form-field">
          <label>资料形态</label>
          <AppSelect
            v-model="uploadForm.kind"
            :options="[
              { value: 'redhead', label: '红头公文 / 会议纪要' },
              { value: 'course', label: '业务台账 / 宣讲课件' },
              { value: 'photo', label: '活动现场纪实图片' }
            ]"
          />
        </div>
        <div class="form-field">
          <label>关联社区</label>
          <AppSelect v-model="uploadForm.community" :options="COMMUNITIES.map((c) => c.name)" />
        </div>
        <div class="form-field">
          <label for="arm-title">资料或图片标题</label>
          <input id="arm-title" v-model="uploadForm.title" class="field-input" required placeholder="例如：2026年第四季度德馨社区议武专题记录" />
        </div>
        <div class="form-field">
          <label for="arm-content">正文摘要或活动说明</label>
          <textarea id="arm-content" v-model="uploadForm.content" class="field-textarea" placeholder="输入会议要点、预案内容或现场活动说明"></textarea>
        </div>
        <button type="submit" class="btn primary">保存并发布至前台专题</button>
      </form>
    </NativeDrawer>

    <DrilldownDrawer
      :open="militiaDrill.open"
      :title="militiaDrill.title"
      :subtitle="militiaDrill.subtitle"
      :summary-text="militiaDrill.summary"
      :filters="militiaDrill.filters"
      :columns="militiaDrill.columns"
      :rows="militiaDrill.rows"
      :export-name="militiaDrill.exportName"
      @close="militiaDrill.open = false"
    />
  </AppShell>
</template>

<style scoped>
.armed-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
}

.ab-topics, .ab-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.ab-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 13px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--sunken);
  font-size: 13px;
  font-weight: 600;
}

.comm-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  width: 240px;
}

.comm-search-wrap svg {
  position: absolute;
  left: 9px;
  color: var(--ink-soft);
}

.comm-search-wrap input {
  padding-left: 30px;
  min-height: 30px;
}

.search-suggest {
  position: absolute;
  top: 38px;
  left: 0;
  right: 0;
  z-index: 800;
  background: var(--surface);
  color: var(--ink);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  box-shadow: var(--e3);
  padding: 4px;
  display: grid;
}

.search-suggest button {
  padding: 7px 10px;
  border: none;
  border-radius: var(--r-xs);
  background: transparent;
  color: inherit;
  text-align: left;
  font-size: 12.5px;
}

.search-suggest button:hover {
  background: var(--primary-soft);
  color: var(--brand-text);
}

.party-ruler {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}

.pr-step {
  padding: 10px 12px;
  border-radius: var(--r-sm);
  background: var(--sunken);
  border-left: 3px solid var(--line-strong);
}

.pr-step.done {
  background: var(--primary-soft);
  border-left-color: var(--primary);
}

.pr-step strong {
  display: block;
  font-size: 13px;
}

.pr-step small {
  color: var(--ink-soft);
  font-size: 11.5px;
}

.party-3col {
  display: grid;
  grid-template-columns: 310px minmax(0, 1fr) 320px;
  gap: 14px;
  align-items: stretch;
}

.militia-2col {
  display: grid;
  grid-template-columns: 1.45fr 1fr;
  gap: 14px;
  align-items: stretch;
}

.party-3col > .panel,
.militia-2col > .panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.party-3col > .panel > .panel-body,
.militia-2col > .panel > .panel-body {
  flex: 1;
}

@media (max-width: 1240px) {
  .party-3col, .militia-2col {
    grid-template-columns: 1fr;
  }
}

.map-mid-panel {
  display: flex;
  flex-direction: column;
}

.armed-map-box {
  flex: 1;
  min-height: 410px;
}

.armed-map-box.tall {
  flex: 1;
  min-height: 490px;
}

.folder-list {
  display: grid;
  gap: 8px;
}

.folder-card {
  text-align: left;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--sunken);
}

.folder-card:hover {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.mobilize-card {
  border-left: 3px solid var(--mobilize-orange);
}

.fc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.folder-card small {
  display: block;
  font-size: 12px;
  color: var(--ink-soft);
}

.plan-list {
  display: grid;
  gap: 10px;
}

.plan-item {
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--sunken);
}

.pi-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
  margin-bottom: 3px;
}

.photo-strip {
  display: grid;
  gap: 10px;
}

.photo-strip.cols-2 { grid-template-columns: 1fr 1fr; }
.photo-strip.cols-3 { grid-template-columns: repeat(3, 1fr); }

.photo-thumb {
  text-align: left;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 6px;
  overflow: hidden;
  background: var(--surface);
}

.photo-thumb .pt-cap {
  display: block;
  padding: 7px 9px;
  font-size: 12px;
  font-weight: 500;
  color: var(--ink);
}

.squad-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.sb-total span {
  display: block;
  font-size: 12px;
  color: var(--ink-soft);
}

.sb-total strong {
  font-size: 22px;
}

.sb-items {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.sq-chip {
  padding: 8px 12px;
  border-radius: 6px;
  background: #edf5f0;
  border: 1px solid #c3decb;
}

.sq-chip span {
  display: block;
  font-size: 11.5px;
  color: var(--ink-muted);
}

.sq-chip strong {
  font-size: 13.5px;
  color: var(--army-green);
}

.sub-pills {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.funnel-row {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
}

.funnel-card {
  text-align: left;
  padding: 11px 12px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--sunken);
}

.funnel-card.active {
  background: var(--recruit-blue);
  border-color: var(--recruit-blue);
  color: #ffffff;
}

.funnel-card .fn-name {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
}

.funnel-card strong {
  display: block;
  font-size: 20px;
  margin: 3px 0;
}

.funnel-card.active small {
  color: #dbeafe;
}

.trend-bars {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(66px, 1fr));
  gap: 10px;
  align-items: end;
  height: 180px;
}

.tb-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
  justify-content: flex-end;
  gap: 4px;
}

.tb-pct {
  font-size: 11px;
  color: var(--ink-soft);
}

.tb-bar-wrap {
  width: 34px;
  flex: 1;
  display: flex;
  align-items: flex-end;
}

.tb-bar {
  width: 100%;
  background: var(--recruit-blue);
  border-radius: 4px 4px 0 0;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 4px;
  color: #ffffff;
  font-size: 11px;
}

.tb-bar.teal {
  background: var(--edu-teal);
}

.tb-year {
  font-size: 12px;
  font-weight: 600;
}

.log-mini {
  display: grid;
  gap: 6px;
  font-size: 12.5px;
}

.lm-row {
  display: flex;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  background: var(--sunken);
}

.leader-tree {
  display: grid;
  gap: 8px;
}

.lt-node {
  padding: 9px 11px;
  border-radius: 6px;
  background: var(--sunken);
  border-left: 3px solid var(--party-red);
}

.lt-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}

.lt-node small {
  display: block;
  font-size: 12px;
  color: var(--ink-soft);
}

.place-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--line);
  background: #f0f9ff;
}

.place-card strong {
  display: block;
  font-size: 14px;
}

.place-card small {
  color: var(--ink-muted);
  font-size: 12px;
}

.pc-nums {
  display: flex;
  gap: 12px;
  font-size: 13px;
  color: var(--edu-teal);
  white-space: nowrap;
  flex-shrink: 0;
}

.pc-nums b {
  font-size: 18px;
}

/* 阅览器 */
.viewer-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.redhead-paper {
  position: relative;
  background: #ffffff;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  padding: 28px 34px;
}

.rh-org {
  text-align: center;
  color: #c53030;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 2px;
}

.rh-docno {
  text-align: center;
  margin: 8px 0 12px;
  font-size: 13px;
  color: var(--ink-muted);
}

.rh-line {
  height: 3px;
  background: #c53030;
  margin-bottom: 20px;
}

.redhead-paper h3 {
  text-align: center;
  font-size: 17px;
  margin: 0 0 18px;
}

.rh-content {
  font-size: 14.5px;
  line-height: 1.9;
  text-indent: 2em;
  color: #1f2937;
}

.rh-sign {
  margin-top: 34px;
  text-align: right;
  position: relative;
  padding-right: 16px;
  line-height: 1.8;
}

.rh-seal {
  position: absolute;
  right: 12px;
  top: -18px;
  width: 78px;
  height: 78px;
  border-radius: 50%;
  border: 3px solid rgba(197, 48, 48, 0.72);
  color: rgba(197, 48, 48, 0.78);
  font-size: 11px;
  font-weight: 700;
  display: grid;
  place-items: center;
  text-align: center;
  transform: rotate(-14deg);
  pointer-events: none;
}

.photo-viewer {
  background: #ffffff;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 16px;
  text-align: center;
}

.photo-viewer img {
  width: 100%;
  max-height: 340px;
  object-fit: contain;
  border-radius: 6px;
}

.course-paper {
  background: #ffffff;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 24px 28px;
}

.cp-badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 4px;
  background: var(--brand-soft);
  color: var(--brand-2);
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 10px;
}

.cp-meta {
  font-size: 12.5px;
  color: var(--ink-soft);
  margin-bottom: 14px;
}

.upload-form {
  display: grid;
  gap: 12px;
  background: #ffffff;
  padding: 16px;
  border-radius: 8px;
  border: 1px solid var(--line);
}

.sb-btn {
  border: none;
  background: transparent;
  padding: 4px 8px;
  margin: -4px -8px;
  border-radius: 6px;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.sb-btn:hover {
  background: var(--sunken);
}

.sq-btn {
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.sq-btn:hover {
  border-color: var(--army-green);
  background: var(--brand-soft);
}

@media (max-width: 768px) {
  .comm-search-wrap {
    width: 100%;
  }
  .party-ruler {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .funnel-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .armed-map-box,
  .armed-map-box.tall {
    min-height: 290px;
    height: 300px;
  }
  .photo-strip.cols-3 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .place-card {
    flex-direction: column;
    align-items: flex-start;
    padding: 10px 12px;
  }
  .pc-nums {
    flex-wrap: wrap;
    gap: 8px 12px;
  }
  .redhead-paper,
  .course-paper {
    padding: 18px 14px;
  }
  .rh-org {
    font-size: 16px;
    letter-spacing: 1px;
  }
  .rh-content {
    font-size: 13.5px;
    line-height: 1.75;
  }
  .rh-seal {
    width: 64px;
    height: 64px;
    font-size: 9.5px;
    right: 4px;
  }
  .viewer-nav {
    flex-wrap: wrap;
    gap: 8px;
  }
  .lm-row {
    flex-wrap: wrap;
  }
}

@media (max-width: 440px) {
  .photo-strip.cols-2,
  .photo-strip.cols-3 {
    grid-template-columns: 1fr;
  }
}
</style>
