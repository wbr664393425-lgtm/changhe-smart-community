<script setup>
import { RouterView } from 'vue-router'
import { toastMessage } from './store/appStore'
</script>

<template>
  <div class="grain-layer" aria-hidden="true"></div>
  <RouterView />
  <div id="toast-root" aria-live="polite">
    <div v-if="toastMessage" class="ui-toast" role="status">{{ toastMessage }}</div>
  </div>
</template>
