<script setup>
/**
 * Video strip cell for the live-stage Streams / "Video" toolbox.
 * Posters are preferred (`*.poster.jpg`); on error or slow load we fall back to
 * a metadata-only <video> peek so the UI is not grey for minutes when the
 * poster 404s or the connection hangs.
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { posterJpgForVideoUrl } from "utils/common";

/** Give up on the poster and try <video> if nothing arrives (load or error). */
const POSTER_ATTEMPT_MS = 6000;

const props = defineProps({
  video: {
    type: Object,
    required: true,
  },
});

const posterFailed = ref(false);

const posterSrc = computed(() => posterJpgForVideoUrl(props.video?.url ?? ""));

const peekSrc = computed(() => {
  const url = props.video?.url ?? "";
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

function armPosterTimer() {
  clearPosterTimer();
  posterTimer = window.setTimeout(() => {
    if (!posterFailed.value) {
      posterFailed.value = true;
    }
    posterTimer = null;
  }, POSTER_ATTEMPT_MS);
}

function onPosterLoad() {
  clearPosterTimer();
}

function onPosterError() {
  clearPosterTimer();
  posterFailed.value = true;
}

onMounted(() => {
  if (props.video?.url && posterSrc.value) {
    armPosterTimer();
  } else {
    posterFailed.value = true;
  }
});

onBeforeUnmount(clearPosterTimer);
</script>

<template>
  <!--
    Live RTMP feed (isRTMP): there is no poster and no VoD URL to peek at
    (both would 404 against /resources/<stream key>), so render a static
    tile. Uploaded clips keep the poster/peek behavior below unchanged.
  -->
  <div v-if="video.isRTMP" class="live-feed-thumb">
    <i class="fas fa-broadcast-tower" aria-hidden="true"></i>
    <span>LIVE</span>
  </div>
  <img
    v-else-if="video.url && !posterFailed"
    class="thumb-preview"
    loading="eager"
    decoding="async"
    :src="posterSrc"
    alt=""
    @load="onPosterLoad"
    @error="onPosterError"
  />
  <video
    v-else-if="video.url"
    class="thumb-preview"
    :src="peekSrc"
    muted
    playsinline
    preload="metadata"
    disablePictureInPicture
  />
</template>

<style lang="scss" scoped>
.thumb-preview {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.live-feed-thumb {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  background: #1d1d1d;
  color: #e0e0e0;
  font-size: 10px;
  letter-spacing: 1px;
}
</style>
