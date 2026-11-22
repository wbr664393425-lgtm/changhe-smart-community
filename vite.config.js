import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/three/')) return 'vendor-three'
          if (id.includes('/leaflet/')) return 'vendor-leaflet'
          if (id.includes('/vue/') || id.includes('/@vue/') || id.includes('/vue-router/')) return 'vendor-vue'
          if (id.includes('/lucide-vue-next/')) return 'vendor-icons'
        }
      }
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5188
  }
})
