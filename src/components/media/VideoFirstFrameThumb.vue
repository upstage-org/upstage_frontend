<script setup>
/**
 * Lightweight first-frame thumbnail for catalogue / toolbox use.
 * Prefer server-generated `<video-url>.poster.jpg` when present; otherwise
 * use a muted metadata preload + `#t=` seek hint (matches Streams toolbox).
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { absolutePath, posterJpgForVideoUrl } from "utils/common";

/** Fall back to <video> when poster never finishes (hang / very slow CDN). */
const POSTER_ATTEMPT_MS = 6000;

const props = defineProps({
  media: {
    type: Object,
    required: true,
  },
});

const posterFailed = ref(false);

const resolvedUrl = computed(() => {
  const raw = props.media?.fileLocation ?? props.media?.src ?? "";
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return "";
  return absolutePath(s);
});

const posterJpgUrl = computed(() => posterJpgForVideoUrl(resolvedUrl.value));

const peekSrc = computed(() => {
  const url = resolvedUrl.value;
  if (!url) return "";
  if (/#t=/i.test(url)) return url;
  return url.includes("#") ? url : `${url}#t=0.01`;
});

let posterTimer = null;

function clearPosterTimer() {
  if (posterTimer != null) {
    clearTimeout(posterTimer);
    posterTimer = null;
  }
}

function onPosterLoad() {
  clearPosterTimer();
}

function onPosterError() {
  clearPosterTimer();
  posterFailed.value = true;
}

onMounted(() => {
  if (!resolvedUrl.value || !posterJpgUrl.value) {
    posterFailed.value = true;
    return;
  }
  posterTimer = window.setTimeout(() => {
    if (!posterFailed.value) {
      posterFailed.value = true;
    }
    posterTimer = null;
  }, POSTER_ATTEMPT_MS);
});

onBeforeUnmount(clearPosterTimer);
</script>

<template>
  <div
    v-if="resolvedUrl"
    class="video-first-frame-thumb"
    role="img"
    :aria-label="media?.name ?? 'Video'"
  >
    <img
      v-if="!posterFailed"
      class="thumb"
      loading="lazy"
      decoding="async"
      :src="posterJpgUrl"
      alt=""
      @load="onPosterLoad"
      @error="onPosterError"
    />
    <video
      v-else
      class="thumb"
      :src="peekSrc"
      muted
      playsinline
      preload="metadata"
      disablePictureInPicture
    />
  </div>
</template>

<style scoped lang="scss">
.video-first-frame-thumb {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1a1a;
  overflow: hidden;
}

.thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
