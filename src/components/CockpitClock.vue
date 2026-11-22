<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const clockTime = ref('')
const clockDate = ref('')
let timer = null

function tick() {
  const now = new Date()
  const p = (n) => String(n).padStart(2, '0')
  clockTime.value = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`
  clockDate.value = `${now.getFullYear()}年${p(now.getMonth() + 1)}月${p(now.getDate())}日`
}

onMounted(() => {
  tick()
  timer = setInterval(tick, 1000)
})

onBeforeUnmount(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
})
</script>

<template>
  <div class="ck-clock" aria-label="系统时钟">
    <strong class="num">{{ clockTime }}</strong>
    <span class="num">{{ clockDate }}</span>
  </div>
</template>
