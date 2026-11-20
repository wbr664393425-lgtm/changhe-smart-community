<script setup>
import { ref, watch, onMounted, onBeforeUnmount, useId } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  variant: { type: String, default: 'drawer' } // drawer | wide | center
})

const emit = defineEmits(['close'])
const dlgRef = ref(null)
const titleId = useId()

let pressedOutside = false
function isOutside(e, dialog) {
  const r = dialog.getBoundingClientRect()
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom
}

function onPointerDown(e) {
  if (!dlgRef.value) return
  pressedOutside = isOutside(e, dlgRef.value)
}

function onPointerUp(e) {
  if (!dlgRef.value) return
  if (pressedOutside && isOutside(e, dlgRef.value)) {
    dlgRef.value.close()
  }
}

function onDialogClose() {
  if (dlgRef.value) dlgRef.value.returnValue = ''
  if (props.open) emit('close')
}

watch(
  () => props.open,
  (val) => {
    const dlg = dlgRef.value
    if (!dlg) return
    if (val && !dlg.open) dlg.showModal()
    else if (!val && dlg.open) dlg.close()
  }
)

onMounted(() => {
  const dlg = dlgRef.value
  if (!dlg) return
  if (props.open && !dlg.open) dlg.showModal()
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    dlg.addEventListener('pointerdown', onPointerDown)
    dlg.addEventListener('pointerup', onPointerUp)
  }
})

onBeforeUnmount(() => {
  const dlg = dlgRef.value
  if (!dlg) return
  dlg.removeEventListener('pointerdown', onPointerDown)
  dlg.removeEventListener('pointerup', onPointerUp)
})
</script>

<template>
  <dialog
    ref="dlgRef"
    class="native-drawer"
    :class="{ wide: variant === 'wide', center: variant === 'center' }"
    closedby="any"
    :aria-labelledby="titleId"
    @close="onDialogClose"
  >
    <header class="dlg-head">
      <div>
        <h2 :id="titleId">{{ title }}</h2>
        <div v-if="subtitle" style="font-size: 12px; color: var(--ink-soft); margin-top: 2px">{{ subtitle }}</div>
      </div>
      <button type="button" class="dlg-close" aria-label="关闭弹窗" @click="dlgRef?.close()">×</button>
    </header>
    <div class="dlg-body">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="dlg-foot">
      <slot name="footer" />
    </footer>
  </dialog>
</template>
