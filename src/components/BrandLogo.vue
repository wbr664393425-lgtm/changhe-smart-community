<script setup>
import { computed, watchEffect } from 'vue'
import { store } from '../store/appStore'
import smartCityLogo from '../assets/smart-city-map-logo.png'

const props = defineProps({
  size: {
    type: [Number, String],
    default: 40
  },
  preset: {
    type: String,
    default: ''
  }
})

const widthPx = computed(() => {
  const n = Number(props.size)
  return Number.isFinite(n) ? Math.round(n * 1.48) : props.size
})

const SHADOW_MAP = {
  'vermilion-seal': 'rgba(130, 18, 22, 0.22)',
  'cloud-portal': 'rgba(130, 18, 22, 0.20)',
  'pearl-glass': 'rgba(130, 18, 22, 0.20)',
  'civic-trust': 'rgba(130, 18, 22, 0.20)',
  'jade-emerald': 'rgba(130, 18, 22, 0.20)',
  'command-dark': 'rgba(4, 10, 22, 0.45)'
}

const activePreset = computed(() => props.preset || store.preset || 'vermilion-seal')
const logoSrc = computed(() => smartCityLogo)
const dropShadow = computed(
  () => `drop-shadow(0 2px 6px ${SHADOW_MAP[activePreset.value] || SHADOW_MAP['vermilion-seal']})`
)

watchEffect(() => {
  if (typeof document === 'undefined' || props.preset) return
  const link = document.querySelector('link[rel="icon"]')
  if (link && link.getAttribute('href') !== logoSrc.value) {
    link.setAttribute('href', logoSrc.value)
  }
})
</script>

<template>
  <img
    :src="logoSrc"
    :width="widthPx"
    :height="size"
    :style="{ filter: dropShadow, width: `${widthPx}px`, height: `${size}px` }"
    alt="长河街道智慧社区标识"
    class="changhe-brand-logo"
    draggable="false"
  />
</template>

<style scoped>
.changhe-brand-logo {
  display: block;
  flex-shrink: 0;
  object-fit: contain;
  user-select: none;
}
</style>
