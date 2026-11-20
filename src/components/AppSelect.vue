<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useAttrs, useId } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
  required: { type: Boolean, default: false },
  placeholder: { type: String, default: '请选择' },
  size: { type: String, default: 'md' } // md (36px) | sm (30px)
})

const emit = defineEmits(['update:modelValue', 'change'])
const attrs = useAttrs()

const rootAttrs = computed(() => ({ class: attrs.class, style: attrs.style }))
const triggerAttrs = computed(() =>
  Object.fromEntries(Object.entries(attrs).filter(([k]) => k !== 'class' && k !== 'style'))
)

const uid = `rui-sel-${useId().replace(/:/g, '')}`
const items = computed(() =>
  props.options.map((o) =>
    o !== null && typeof o === 'object' ? o : { value: o, label: String(o) }
  )
)
const index = computed(() => items.value.findIndex((o) => o.value === props.modelValue))
const current = computed(() => items.value[index.value])

const open = ref(false)
const active = ref(-1)
const trigger = ref(null)
const panel = ref(null)
const place = ref({})
const teleportTarget = ref('body')

function position() {
  if (!trigger.value) return
  const hostDialog = trigger.value.closest('dialog[open]')
  teleportTarget.value = hostDialog || 'body'
  const r = trigger.value.getBoundingClientRect()
  const estH = Math.min(280, items.value.length * 36 + 12)
  const flipUp = window.innerHeight - r.bottom < estH + 14 && r.top > estH + 14
  const maxW = Math.min(460, window.innerWidth - 16)
  place.value = {
    left: `${Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 160) - 8))}px`,
    top: `${flipUp ? Math.max(8, r.top - estH - 6) : r.bottom + 6}px`,
    minWidth: `${r.width}px`,
    maxWidth: `${maxW}px`
  }
}

function scrollActive() {
  nextTick(() => {
    const p = panel.value
    if (!p) return
    if (typeof p.showPopover === 'function' && !p.matches(':popover-open')) {
      try { p.showPopover() } catch { /* ignore */ }
    }
    const pr = p.getBoundingClientRect()
    if (pr.right > window.innerWidth - 8) {
      p.style.left = `${Math.max(8, window.innerWidth - pr.width - 8)}px`
    }
    const act = p.querySelector('.active')
    if (act) {
      if (act.offsetTop < p.scrollTop) p.scrollTop = act.offsetTop - 4
      else if (act.offsetTop + act.offsetHeight > p.scrollTop + p.clientHeight) {
        p.scrollTop = act.offsetTop + act.offsetHeight - p.clientHeight + 4
      }
    }
  })
}

function show() {
  if (props.disabled || open.value) return
  window.dispatchEvent(new CustomEvent('rui:close-popovers', { detail: { source: uid } }))
  position()
  nextTick(() => {
    open.value = true
    active.value = Math.max(index.value, 0)
    scrollActive()
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    document.addEventListener('pointerdown', outside, true)
  })
}

function onGlobalClose(e) {
  if (e?.detail?.source !== uid && open.value) close()
}

onMounted(() => window.addEventListener('rui:close-popovers', onGlobalClose))

function close(e) {
  if (e?.type === 'scroll' && panel.value?.contains(e.target)) return
  if (panel.value && typeof panel.value.hidePopover === 'function' && panel.value.matches(':popover-open')) {
    try { panel.value.hidePopover() } catch { /* ignore */ }
  }
  open.value = false
  window.removeEventListener('scroll', close, true)
  window.removeEventListener('resize', close)
  document.removeEventListener('pointerdown', outside, true)
}

function outside(e) {
  if (!trigger.value?.contains(e.target) && !panel.value?.contains(e.target)) close()
}

function choose(i) {
  const o = items.value[i]
  if (!o || o.disabled) return
  close()
  trigger.value?.focus()
  if (o.value === props.modelValue) return
  emit('update:modelValue', o.value)
  nextTick(() => emit('change', o.value))
}

function move(step) {
  const n = items.value.length
  if (!n) return
  let i = active.value
  for (let k = 0; k < n; k++) {
    i = (i + step + n) % n
    if (!items.value[i].disabled) break
  }
  active.value = i
  scrollActive()
}

function onKey(e) {
  if (props.disabled) return
  const k = e.key
  if (!open.value) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(k)) {
      e.preventDefault()
      show()
    }
    return
  }
  if (k === 'ArrowDown' || k === 'ArrowUp') {
    e.preventDefault()
    move(k === 'ArrowDown' ? 1 : -1)
  } else if (k === 'Home' || k === 'End') {
    e.preventDefault()
    active.value = k === 'Home' ? 0 : items.value.length - 1
    scrollActive()
  } else if (k === 'Enter' || k === ' ') {
    e.preventDefault()
    choose(active.value)
  } else if (k === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    close()
  } else if (k === 'Tab') {
    close()
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('rui:close-popovers', onGlobalClose)
  close()
})
</script>

<template>
  <div class="rui-select" :class="[`sz-${size}`, { open, disabled }]" v-bind="rootAttrs">
    <button
      ref="trigger"
      type="button"
      role="combobox"
      class="rui-select-trigger"
      v-bind="triggerAttrs"
      :disabled="disabled"
      :title="current ? current.label : placeholder"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="uid"
      :aria-activedescendant="open && active >= 0 ? `${uid}-${active}` : undefined"
      @click.prevent="open ? close() : show()"
      @keydown="onKey"
    >
      <span class="rui-select-text" :class="{ placeholder: !current || current.value === '' }">
        {{ current ? current.label : placeholder }}
      </span>
      <svg class="rui-select-chev" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>

    <input
      v-if="required"
      class="rui-select-required"
      tabindex="-1"
      aria-hidden="true"
      :value="modelValue"
      required
    />

    <Teleport :to="teleportTarget">
      <ul
        v-if="open"
        :id="uid"
        ref="panel"
        popover="manual"
        role="listbox"
        class="rui-select-panel"
        :style="place"
        @click.prevent
        @mousedown.prevent
      >
        <li
          v-for="(o, i) in items"
          :id="`${uid}-${i}`"
          :key="String(o.value)"
          role="option"
          :aria-selected="o.value === modelValue"
          :aria-disabled="o.disabled || undefined"
          :class="{ active: i === active, selected: o.value === modelValue, placeholder: o.value === '' }"
          @mousemove="active = i"
          @click="choose(i)"
        >
          <span class="rui-opt-label">{{ o.label }}</span>
          <svg v-if="o.value === modelValue" class="rui-opt-check" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 13l4 4L19 7" />
          </svg>
        </li>
        <li v-if="!items.length" class="rui-select-empty" aria-disabled="true">暂无选项</li>
      </ul>
    </Teleport>
  </div>
</template>
