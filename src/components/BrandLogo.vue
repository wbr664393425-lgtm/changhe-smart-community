<script setup>
import { computed } from 'vue'
import { store } from '../store/appStore'
import smartCityLogo from '../assets/smart-city-map-logo.webp'

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
  'cloud-portal': 'rgba(20, 74, 158, 0.16)',
  'pearl-glass': 'rgba(24, 78, 162, 0.16)',
  'civic-trust': 'rgba(22, 64, 134, 0.16)',
  'jade-emerald': 'rgba(15, 92, 84, 0.16)',
  'command-dark': 'rgba(4, 10, 22, 0.45)'
}

const activePreset = computed(() => props.preset || store.preset || 'vermilion-seal')
const logoSrc = computed(() => smartCityLogo)
const dropShadow = computed(
  () => `drop-shadow(0 2px 6px ${SHADOW_MAP[activePreset.value] || SHADOW_MAP['vermilion-seal']})`
)
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
