import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './styles/rui-original.css'
import './styles/bridge.css'
import { applyPreset, store } from './store/appStore'

applyPreset(store.preset || 'vermilion-seal')
createApp(App).use(router).mount('#app')
