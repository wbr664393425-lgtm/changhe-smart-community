<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { MapPin, Clock, User, Maximize2, X } from 'lucide-vue-next'

const props = defineProps({
  src: { type: String, required: true },
  alt: { type: String, default: '现场纪实影像' },
  badge: { type: String, default: '' },
  tone: { type: String, default: 'before' }, // before | after | visit | militia | double | edu | neutral
  title: { type: String, default: '' },
  location: { type: String, default: '' },
  time: { type: String, default: '' },
  person: { type: String, default: '' },
  compact: { type: Boolean, default: false },
  previewable: { type: Boolean, default: true },
  priority: { type: String, default: 'normal' } // high | normal | lazy
})

const lightboxOpen = ref(false)
const resolvedSrc = computed(() =>
  typeof props.src === 'string'
    ? props.src.replace(/(\/photos\/[^?#]+)\.jpg$/i, '$1.webp')
    : ''
)

const badgeLabel = computed(() => {
  if (props.badge) return props.badge
  const map = {
    before: '整改前现场照',
    after: '整改后验收照',
    visit: '党管武装走访',
    militia: '民兵参建实景',
    double: '双拥共建纪实',
    edu: '国防教育实景',
    neutral: '现场留痕'
  }
  return map[props.tone] || ''
})

function openLightbox() {
  if (!props.previewable) return
  lightboxOpen.value = true
}

function onKeyDown(e) {
  if (e.key === 'Escape' && lightboxOpen.value) {
    lightboxOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeyDown)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <div
    class="ev-photo-frame"
    :class="['tone-' + tone, { compact, previewable }]"
    :role="previewable ? 'button' : undefined"
    :tabindex="previewable ? 0 : undefined"
    :aria-label="previewable ? `点击放大查看：${title || alt}` : undefined"
    @click="openLightbox"
    @keydown.enter.prevent="openLightbox"
    @keydown.space.prevent="openLightbox"
  >
    <img
      :src="resolvedSrc"
      :alt="alt || title"
      class="ev-photo-img"
      :loading="priority === 'lazy' ? 'lazy' : undefined"
      :fetchpriority="priority === 'high' ? 'high' : undefined"
      decoding="async"
    />

    <span v-if="badgeLabel" class="ev-photo-badge">{{ badgeLabel }}</span>

    <span v-if="previewable" class="ev-zoom-hint" aria-hidden="true">
      <Maximize2 :size="12" />
      <span>查看大图</span>
    </span>

    <div v-if="location || time || person" class="ev-photo-wm">
      <div v-if="location" class="ev-wm-loc">
        <MapPin :size="11" />
        <span>{{ location }}</span>
      </div>
      <div v-if="time || person" class="ev-wm-meta">
        <span v-if="time" class="num"><Clock :size="10" /> {{ time }}</span>
        <span v-if="person"><User :size="10" /> {{ person }}</span>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="lightboxOpen"
        class="ev-lightbox-backdrop"
        role="dialog"
        aria-modal="true"
        :aria-label="title || alt"
        @click.self="lightboxOpen = false"
      >
        <div class="ev-lightbox-sheet">
          <div class="ev-lb-head">
            <div class="ev-lb-title">
              <span v-if="badgeLabel" class="ev-lb-pill" :class="'tone-' + tone">{{ badgeLabel }}</span>
              <strong>{{ title || alt }}</strong>
            </div>
            <button type="button" class="ev-lb-close" aria-label="关闭大图预览" @click="lightboxOpen = false">
              <X :size="16" />
            </button>
          </div>

          <div class="ev-lb-stage">
            <img :src="resolvedSrc" :alt="title || alt" />
          </div>

          <div v-if="location || time || person" class="ev-lb-foot">
            <span v-if="location"><MapPin :size="13" /> 拍摄地点：{{ location }}</span>
            <span v-if="time" class="num"><Clock :size="13" /> 拍摄时间：{{ time }}</span>
            <span v-if="person"><User :size="13" /> 经办人员：{{ person }}</span>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.ev-photo-frame {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  background: #141c2b;
  display: block;
  user-select: none;
}

.ev-photo-frame.previewable {
  cursor: zoom-in;
}

.ev-photo-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.28s ease;
}

.ev-photo-frame.previewable:hover .ev-photo-img {
  transform: scale(1.03);
}

.ev-photo-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  color: #ffffff;
  background: #b81c28;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.32);
  letter-spacing: 0.02em;
}
.ev-photo-frame.tone-after .ev-photo-badge { background: #15803d; }
.ev-photo-frame.tone-visit .ev-photo-badge { background: #b91c1c; }
.ev-photo-frame.tone-militia .ev-photo-badge { background: #1d6945; }
.ev-photo-frame.tone-double .ev-photo-badge { background: #c2410c; }
.ev-photo-frame.tone-edu .ev-photo-badge { background: #0f6b75; }
.ev-photo-frame.tone-neutral .ev-photo-badge { background: #1d4ed8; }

.ev-zoom-hint {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 4px;
  background: rgba(12, 18, 30, 0.76);
  color: #f8fafc;
  font-size: 10.5px;
  font-weight: 600;
  opacity: 0;
  transition: opacity 0.18s ease;
  pointer-events: none;
}
.ev-photo-frame.previewable:hover .ev-zoom-hint,
.ev-photo-frame.previewable:focus-visible .ev-zoom-hint {
  opacity: 1;
}

.ev-photo-wm {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  padding: 18px 10px 7px;
  background: linear-gradient(to top, rgba(9, 15, 28, 0.92) 0%, rgba(9, 15, 28, 0.62) 66%, transparent 100%);
  color: #f8fafc;
  display: flex;
  flex-direction: column;
  gap: 2px;
  pointer-events: none;
}

.ev-wm-loc {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: #ffffff;
  line-height: 1.3;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55);
}
.ev-wm-loc span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ev-wm-loc svg {
  flex-shrink: 0;
  color: #fbbf24;
}

.ev-wm-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 10px;
  color: #cbd5e1;
  line-height: 1.25;
}
.ev-wm-meta span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ev-photo-frame.compact .ev-photo-badge {
  top: 6px;
  left: 6px;
  padding: 1.5px 6px;
  font-size: 10px;
}
.ev-photo-frame.compact .ev-photo-wm {
  padding: 14px 8px 5px;
}
.ev-photo-frame.compact .ev-wm-loc {
  font-size: 10.5px;
}
.ev-photo-frame.compact .ev-wm-meta {
  font-size: 9.5px;
}

/* 顶层 100% 不透明实底高清灯箱 */
.ev-lightbox-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(8, 13, 24, 0.78);
  display: grid;
  place-items: center;
  padding: 24px;
}

.ev-lightbox-sheet {
  width: min(860px, 94vw);
  max-height: 90dvh;
  background: #ffffff;
  color: #1a1718;
  border-radius: 10px;
  border: 1px solid #d5dbe4;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.ev-lb-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.ev-lb-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.ev-lb-title strong {
  font-size: 14.5px;
  font-weight: 700;
  color: #111827;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ev-lb-pill {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  color: #ffffff;
  background: #b81c28;
}
.ev-lb-pill.tone-after { background: #15803d; }
.ev-lb-pill.tone-visit { background: #b91c1c; }
.ev-lb-pill.tone-militia { background: #1d6945; }
.ev-lb-pill.tone-double { background: #c2410c; }
.ev-lb-pill.tone-edu { background: #0f6b75; }
.ev-lb-pill.tone-neutral { background: #1d4ed8; }

.ev-lb-close {
  width: 30px;
  height: 30px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.ev-lb-close:hover {
  background: #f1f5f9;
  color: #0f172a;
}

.ev-lb-stage {
  background: #0f172a;
  display: grid;
  place-items: center;
  overflow: hidden;
}
.ev-lb-stage img {
  width: 100%;
  max-height: 68dvh;
  object-fit: contain;
  display: block;
}

.ev-lb-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 11px 16px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
  font-size: 12.5px;
  color: #334155;
}
.ev-lb-foot span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
</style>
