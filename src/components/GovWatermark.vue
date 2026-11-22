<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

defineProps({
  userName: { type: String, default: '' },
  dept: { type: String, default: '' }
})

const nowTick = ref(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
let timer = null

onMounted(() => {
  timer = setInterval(() => {
    nowTick.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  }, 1000)
})

onBeforeUnmount(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
})
</script>

<template>
  <div class="gov-watermark" aria-hidden="true">
    <span v-for="i in 9" :key="i">{{ userName }} · {{ dept }} · {{ nowTick }}</span>
  </div>
</template>
