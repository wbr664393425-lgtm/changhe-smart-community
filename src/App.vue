<script setup>
import { RouterView } from 'vue-router'
import { store } from './store/appStore'
</script>

<template>
  <div class="grain-layer" aria-hidden="true"></div>
  <RouterView />
  <div id="toast-root" aria-live="polite">
    <div v-if="store.toastMessage" class="ui-toast" role="status">{{ store.toastMessage }}</div>
  </div>
</template>
