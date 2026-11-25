import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './styles/rui-original.css'
import './styles/bridge.css'
import { applyPreset, store } from './store/appStore'

// 静态资源分包更新后，长开标签页触发异步分片加载失败时自动防抖刷新一次
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  try {
    const key = 'changhe-chunk-reload-ts'
    const now = Date.now()
    const prev = Number(sessionStorage.getItem(key) || 0)
    if (now - prev > 15000) {
      sessionStorage.setItem(key, String(now))
      window.location.reload()
    }
  } catch {
    window.location.reload()
  }
})

applyPreset(store.preset || 'vermilion-seal')
createApp(App).use(router).mount('#app')
