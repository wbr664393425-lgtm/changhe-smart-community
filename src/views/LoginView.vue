<script setup>
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { QrCode, KeyRound, User, Lock, Eye, EyeOff, LoaderCircle } from 'lucide-vue-next'
import AppSelect from '../components/AppSelect.vue'
import BrandLogo from '../components/BrandLogo.vue'
import {
  store, ROLES, PRESETS, COMMUNITIES, switchRole, applyPreset, addAuditLog, showToast
} from '../store/appStore'
import loginBg from '../assets/login-bg.webp'

const router = useRouter()
const loginTab = ref('account') // account | wechat
const selectedRoleId = ref(store.roleId || 'street_admin')
const showPwd = ref(false)
const submitting = ref(false)

const ROLE_ACCOUNTS = {
  street_admin: 'changhe_admin',
  armed_minister: 'wuzhuang_zhaowj',
  community_admin: 'dexin_zhoujg',
  grid_staff: 'grid_limin'
}

const username = ref(ROLE_ACCOUNTS[selectedRoleId.value] || 'changhe_admin')
const password = ref('Changhe@2026')

watch(selectedRoleId, (id) => {
  if (ROLE_ACCOUNTS[id]) username.value = ROLE_ACCOUNTS[id]
})

const roleOptions = ROLES.map((r) => ({ value: r.id, label: r.name }))

// 快捷入口显示短名称
const quickName = (r) => r.name.replace(/·.*$/, '')

function doLogin(roleId = selectedRoleId.value) {
  if (submitting.value) return
  selectedRoleId.value = roleId
  submitting.value = true
  setTimeout(() => {
    store.loggedIn = true
    switchRole(roleId)
    addAuditLog('通过政务统一身份认证平台登录系统', '会话签发')
    router.push('/portal')
  }, 450)
}

function forgotPwd() {
  showToast('请联系街道党政综合办信息管理员重置登录口令')
}

const totals = computed(() => ({
  communities: COMMUNITIES.length,
  grids: COMMUNITIES.reduce((a, c) => a + (c.grids || 0), 0),
  popWan: (COMMUNITIES.reduce((a, c) => a + (c.pop || 0), 0) / 10000).toFixed(1)
}))
</script>

<template>
  <div class="login-page" :data-theme="store.preset" :style="{ '--lg-photo': `url(${loginBg})` }">
    <div class="lg-photo" aria-hidden="true"></div>
    <div class="lg-wash" aria-hidden="true"></div>

    <header class="lg-head">
      <div class="lg-brand">
        <BrandLogo :size="44" />
        <span class="lg-org">德州市天衢新区长河街道</span>
      </div>
      <div class="preset-bar" role="group" aria-label="界面配色">
        <button
          v-for="p in PRESETS"
          :key="p.id"
          type="button"
          class="preset-chip"
          :class="{ active: store.preset === p.id }"
          :title="p.label"
          :aria-label="`切换为${p.label}配色`"
          @click="applyPreset(p.id, $event)"
        >
          <span class="p-dot" :style="{ background: `linear-gradient(135deg,${p.sw1} 50%,${p.sw2} 50%)` }"></span>
        </button>
      </div>
    </header>

    <main class="lg-main">
      <section class="lg-intro">
        <h1>长河街道智慧社区<br />综合治理平台</h1>
        <span class="lg-rule" aria-hidden="true"></span>
        <p class="lg-slogan">人房企底数一图统览 · 网格事件闭环处置 · 基层报表一表通办</p>
        <dl class="lg-stats">
          <div>
            <dt>社区</dt>
            <dd><strong>{{ totals.communities }}</strong>个社区</dd>
          </div>
          <div>
            <dt>网格</dt>
            <dd><strong>{{ totals.grids }}</strong>个网格</dd>
          </div>
          <div>
            <dt>常住人口</dt>
            <dd><strong>{{ totals.popWan }}</strong>万常住人口</dd>
          </div>
        </dl>
      </section>

      <section class="auth-card" aria-label="用户登录">
        <h2>用户登录</h2>

        <div class="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            :aria-selected="loginTab === 'account'"
            :class="{ active: loginTab === 'account' }"
            @click="loginTab = 'account'"
          >
            <KeyRound :size="15" />
            <span>账号登录</span>
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="loginTab === 'wechat'"
            :class="{ active: loginTab === 'wechat' }"
            @click="loginTab = 'wechat'"
          >
            <QrCode :size="15" />
            <span>政务微信扫码</span>
          </button>
        </div>

        <form v-if="loginTab === 'account'" class="auth-form" @submit.prevent="doLogin()">
          <div class="input-icon-wrap">
            <User :size="17" class="in-ico" />
            <input
              v-model="username"
              class="field-input with-ico"
              aria-label="账号"
              autocomplete="username"
              required
              placeholder="请输入政务统一账号"
            />
          </div>

          <div class="input-icon-wrap">
            <Lock :size="17" class="in-ico" />
            <input
              v-model="password"
              :type="showPwd ? 'text' : 'password'"
              class="field-input with-ico with-right"
              aria-label="口令"
              autocomplete="current-password"
              required
              placeholder="请输入登录口令"
            />
            <button
              type="button"
              class="pwd-toggle"
              :aria-label="showPwd ? '隐藏口令' : '显示口令'"
              @click="showPwd = !showPwd"
            >
              <EyeOff v-if="showPwd" :size="17" />
              <Eye v-else :size="17" />
            </button>
          </div>

          <div class="role-row">
            <span class="role-label">登录岗位</span>
            <AppSelect v-model="selectedRoleId" class="role-select" aria-label="登录岗位" :options="roleOptions" />
          </div>

          <div class="form-extra">
            <button type="button" class="link-btn" @click="forgotPwd">忘记口令</button>
          </div>

          <button type="submit" class="btn primary submit-btn" :disabled="submitting">
            <LoaderCircle v-if="submitting" :size="17" class="spin" />
            <span>{{ submitting ? '正在登录' : '登 录' }}</span>
          </button>
        </form>

        <div v-else class="qr-panel">
          <div class="qr-frame" aria-label="政务微信登录二维码">
            <QrCode :size="120" stroke-width="1.15" />
          </div>
          <p>请使用政务微信扫一扫登录</p>
          <button type="button" class="btn primary submit-btn" :disabled="submitting" @click="doLogin()">
            <LoaderCircle v-if="submitting" :size="17" class="spin" />
            <span>{{ submitting ? '正在登录' : '已在手机端确认' }}</span>
          </button>
        </div>

        <div class="quick">
          <div class="quick-head"><span>按岗位快速进入</span></div>
          <div class="quick-grid">
            <button
              v-for="r in ROLES"
              :key="r.id"
              type="button"
              class="quick-item"
              :class="{ current: selectedRoleId === r.id }"
              :title="`${r.userName} · ${r.dept}`"
              :disabled="submitting"
              @click="doLogin(r.id)"
            >
              {{ quickName(r) }}
            </button>
          </div>
        </div>
      </section>
    </main>

    <footer class="lg-foot">
      <span>主办单位：德州市天衢新区长河街道办事处</span>
      <span>技术支持：中国移动通信集团山东有限公司德州分公司</span>
    </footer>
  </div>
</template>

<style scoped>
.login-page {
  /* 左侧压暗色，跟随预设 */
  --lg-wash: 32, 10, 12;
  --lg-gold: #e6c78f;
  --lg-seal: #b81c28;

  position: relative;
  height: 100dvh;
  min-height: 640px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  color: #ffffff;
  background: rgb(var(--lg-wash));
  isolation: isolate;
}

.login-page[data-theme="cloud-portal"],
.login-page[data-theme="pearl-glass"] { --lg-wash: 8, 26, 58; --lg-gold: #b9d4ff; --lg-seal: #1464e6; }
.login-page[data-theme="civic-trust"] { --lg-wash: 10, 28, 60; --lg-gold: #d9c08a; --lg-seal: #1a56b8; }
.login-page[data-theme="jade-emerald"] { --lg-wash: 6, 34, 31; --lg-gold: #e8cf98; --lg-seal: #0f766e; }
.login-page[data-theme="command-dark"] { --lg-wash: 6, 13, 26; --lg-gold: #9fdcf0; --lg-seal: #0e5fa8; }

.lg-photo {
  position: absolute;
  inset: 0;
  z-index: -2;
  background: var(--lg-photo) center right / cover no-repeat;
}

.lg-wash {
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    linear-gradient(90deg,
      rgba(var(--lg-wash), 0.94) 0%,
      rgba(var(--lg-wash), 0.74) 26%,
      rgba(var(--lg-wash), 0.28) 46%,
      rgba(var(--lg-wash), 0) 64%,
      rgba(var(--lg-wash), 0) 100%),
    linear-gradient(0deg, rgba(var(--lg-wash), 0.55) 0%, rgba(var(--lg-wash), 0) 18%),
    linear-gradient(180deg, rgba(var(--lg-wash), 0.35) 0%, rgba(var(--lg-wash), 0) 16%);
}

/* ── 顶部 ── */
.lg-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28px clamp(28px, 6.5%, 128px) 0;
}

.lg-brand {
  display: flex;
  align-items: center;
  gap: 14px;
}

.lg-seal {
  width: 42px;
  height: 42px;
  border-radius: 6px;
  background: var(--lg-seal);
  display: grid;
  place-items: center;
  font-family: var(--font-ceremony, serif);
  font-size: 15px;
  font-weight: 700;
  color: #ffffff;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.28), 0 4px 12px rgba(0, 0, 0, 0.25);
}

.lg-org {
  font-family: var(--font-ceremony, serif);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.3);
}

.preset-bar {
  display: flex;
  gap: 2px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.16);
}

.preset-chip {
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  display: grid;
  place-items: center;
  cursor: pointer;
}

.preset-chip:hover { background: rgba(255, 255, 255, 0.14); }
.preset-chip.active { box-shadow: inset 0 0 0 1.5px #ffffff; }

.p-dot {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.45);
}

/* ── 主体 ── */
.lg-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 48px;
  padding: 0 clamp(28px, 9%, 190px) 0 clamp(28px, 6.5%, 128px);
  min-height: 0;
}

.lg-intro {
  max-width: 660px;
  padding-bottom: 24px;
}

.lg-intro h1 {
  margin: 0;
  font-family: var(--font-ceremony, serif);
  font-size: 60px;
  line-height: 1.28;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-shadow: 0 2px 18px rgba(0, 0, 0, 0.32);
}

.lg-rule {
  display: block;
  width: 100%;
  max-width: 560px;
  height: 2px;
  margin: 30px 0 22px;
  background: linear-gradient(90deg, var(--lg-gold) 0%, color-mix(in srgb, var(--lg-gold) 40%, transparent) 70%, transparent 100%);
}

.lg-slogan {
  margin: 0;
  font-size: 19px;
  letter-spacing: 0.04em;
  color: var(--lg-gold);
}

.lg-stats {
  display: flex;
  margin: 40px 0 0;
}

.lg-stats > div {
  padding: 0 34px;
  border-left: 1px solid rgba(255, 255, 255, 0.26);
}

.lg-stats > div:first-child {
  padding-left: 0;
  border-left: 0;
}

.lg-stats dt {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.lg-stats dd {
  margin: 0;
  font-size: 16px;
  color: rgba(255, 255, 255, 0.82);
  white-space: nowrap;
}

.lg-stats strong {
  margin-right: 6px;
  font-size: 36px;
  font-weight: 600;
  color: #ffffff;
  font-variant-numeric: tabular-nums;
}

/* ── 登录卡 ── */
.auth-card {
  flex: none;
  width: 420px;
  padding: 34px 36px 30px;
  border-radius: 14px;
  background: var(--surface);
  color: var(--ink);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12), 0 28px 60px rgba(0, 0, 0, 0.28);
}

.auth-card h2 {
  margin: 0 0 20px;
  font-size: 24px;
  font-weight: 700;
  color: var(--ink);
}

.auth-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-bottom: 1px solid var(--line-strong);
  margin-bottom: 22px;
}

.auth-tabs button {
  position: relative;
  height: 42px;
  border: 0;
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-size: 15px;
  color: var(--ink-soft);
  cursor: pointer;
}

.auth-tabs button:hover { color: var(--ink); }

.auth-tabs button.active {
  color: var(--brand-text);
  font-weight: 700;
}

.auth-tabs button.active::after {
  content: '';
  position: absolute;
  left: 18%;
  right: 18%;
  bottom: -1px;
  height: 2px;
  border-radius: 2px;
  background: var(--primary);
}

.auth-form {
  display: grid;
  gap: 16px;
}

.input-icon-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.input-icon-wrap .field-input {
  height: 46px;
  font-size: 15px;
  border-radius: 8px;
}

.in-ico {
  position: absolute;
  left: 14px;
  color: var(--ink-faint);
  pointer-events: none;
}

.input-icon-wrap .field-input.with-ico { padding-left: 42px; }
.input-icon-wrap .field-input.with-right { padding-right: 44px; }

.pwd-toggle {
  position: absolute;
  right: 9px;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ink-soft);
  display: grid;
  place-items: center;
  cursor: pointer;
}

.pwd-toggle:hover {
  color: var(--ink);
  background: var(--state-hover);
}

.role-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}

.role-label {
  font-size: 14px;
  color: var(--ink-muted);
  white-space: nowrap;
}

.role-select :deep(.rui-select-trigger) {
  height: 46px;
  font-size: 15px;
  border-radius: 8px;
}

.form-extra {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin-top: -4px;
  font-size: 13px;
  color: var(--ink-faint);
}

.link-btn {
  border: 0;
  padding: 0;
  background: transparent;
  font-size: 13px;
  color: var(--brand-text);
  cursor: pointer;
}

.link-btn:hover { text-decoration: underline; }

.submit-btn {
  width: 100%;
  height: 48px;
  justify-content: center;
  gap: 8px;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.spin { animation: lg-spin 0.9s linear infinite; }
@keyframes lg-spin { to { transform: rotate(360deg); } }

.qr-panel { text-align: center; }

.qr-frame {
  width: 176px;
  height: 176px;
  margin: 4px auto 14px;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  background: #ffffff;
  color: #1a1a1a;
  display: grid;
  place-items: center;
}

.qr-panel p {
  margin: 0 0 18px;
  font-size: 14px;
  color: var(--ink-muted);
}

.quick { margin-top: 26px; }

.quick-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
  font-size: 13px;
  color: var(--ink-faint);
}

.quick-head::before,
.quick-head::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--line-strong);
}

.quick-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.quick-item {
  height: 40px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--sunken);
  font-size: 14px;
  color: var(--ink);
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.quick-item:hover:not(:disabled) {
  background: var(--primary-soft);
  border-color: color-mix(in srgb, var(--primary) 35%, transparent);
  color: var(--brand-text);
}

.quick-item.current {
  border-color: color-mix(in srgb, var(--primary) 35%, transparent);
  color: var(--brand-text);
  font-weight: 600;
}

.quick-item:disabled { cursor: progress; opacity: 0.7; }

/* ── 底部 ── */
.lg-foot {
  display: flex;
  justify-content: center;
  gap: 36px;
  padding: 0 24px 22px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.66);
  white-space: nowrap;
}

/* ── 适配 ── */
@media (max-width: 1440px) {
  .lg-intro h1 { font-size: 48px; }
  .lg-slogan { font-size: 16px; }
  .lg-stats strong { font-size: 30px; }
  .lg-stats > div { padding: 0 24px; }
  .lg-main { padding-right: clamp(28px, 6%, 120px); }
}

@media (max-height: 800px) {
  .lg-head { padding-top: 20px; }
  .auth-card { padding: 26px 30px 24px; }
  .auth-card h2 { margin-bottom: 14px; font-size: 22px; }
  .auth-tabs { margin-bottom: 16px; }
  .auth-form { gap: 12px; }
  .input-icon-wrap .field-input,
  .role-select :deep(.rui-select-trigger) { height: 42px; }
  .submit-btn { height: 44px; }
  .quick { margin-top: 18px; }
  .quick-head { margin-bottom: 10px; }
  .quick-item { height: 36px; }
  .lg-rule { margin: 22px 0 16px; }
  .lg-stats { margin-top: 28px; }
  .lg-foot { padding-bottom: 14px; }
}

@media (max-width: 1100px) {
  .login-page { height: auto; min-height: 100dvh; overflow: auto; }
  .lg-main { flex-direction: column; justify-content: center; padding: 32px 24px; }
  .lg-intro { text-align: center; padding: 0; }
  .lg-intro h1 { font-size: 36px; }
  .lg-rule, .lg-slogan, .lg-stats { display: none; }
  .lg-wash { background: rgba(var(--lg-wash), 0.72); }
  .auth-card { width: min(420px, 100%); }
  .lg-foot { flex-wrap: wrap; gap: 4px 20px; white-space: normal; text-align: center; }
}

@media (max-width: 640px) {
  .lg-head {
    flex-wrap: wrap;
    gap: 10px;
    padding: calc(16px + env(safe-area-inset-top, 0px)) 16px 0;
  }
  .lg-brand {
    gap: 10px;
  }
  .lg-seal {
    width: 34px;
    height: 34px;
    font-size: 13px;
  }
  .lg-org {
    font-size: 16px;
    white-space: nowrap;
  }
  .lg-main {
    padding: 18px 14px 20px;
    gap: 16px;
  }
  .lg-intro h1 {
    font-size: 26px;
    line-height: 1.25;
  }
  .auth-card {
    padding: 20px 16px 18px;
    border-radius: var(--r-lg, 14px);
  }
  .auth-card h2 {
    font-size: 19px;
    margin-bottom: 12px;
  }
  .quick-grid {
    gap: 8px;
  }
  .quick-item {
    font-size: 13px;
    height: 38px;
  }
  .lg-foot {
    padding: 0 14px calc(18px + env(safe-area-inset-bottom, 0px));
    font-size: 12px;
  }
}
</style>
