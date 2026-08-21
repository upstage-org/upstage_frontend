<script lang="ts" setup>
import { PropType, computed, ref } from "vue";
import { Media, MediaAttributes } from "models/studio";
import { absolutePath } from "utils/common";
import VideoFirstFrameThumb from "./VideoFirstFrameThumb.vue";

const props = defineProps({
  media: {
    type: Object as PropType<Media>,
    required: true,
  },
});

// Video playback preview. The list shows a cheap first-frame thumbnail
// (VideoFirstFrameThumb); clicking it opens a modal with a playable
// <video controls>, mirroring how images enlarge on click and audio plays
// inline. The modal is destroyed on close so playback stops.
const videoPreviewOpen = ref(false);
const videoSrc = computed(() => absolutePath(props.media.fileLocation));

const attributes = computed<MediaAttributes>(() => {
  return JSON.parse(props.media.description || "{}");
});
</script>

<template>
  <audio v-if="props.media.assetType.name === 'audio'" controls class="w-48">
    <source :src="absolutePath(props.media.fileLocation)" />
    Your browser does not support the audio element.
  </audio>
  <template v-else-if="props.media.assetType.name === 'video'">
    <button
      type="button"
      class="video-preview-frame video-preview-trigger"
      :title="$t('preview')"
      :aria-label="`${$t('preview')}: ${props.media.name}`"
      data-testid="video-preview-trigger"
      @click="videoPreviewOpen = true"
    >
      <VideoFirstFrameThumb :media="props.media" />
      <span class="video-preview-play" aria-hidden="true">
        <i class="fas fa-play"></i>
      </span>
    </button>
    <a-modal
      v-model:open="videoPreviewOpen"
      :title="props.media.name"
      :footer="null"
      :width="720"
      destroy-on-close
      wrap-class-name="video-preview-modal"
    >
      <video
        class="video-preview-player"
        controls
        autoplay
        playsinline
        preload="metadata"
        data-testid="video-preview-player"
        :src="videoSrc"
      >
        Your browser does not support the video tag.
      </video>
    </a-modal>
  </template>
  <!-- RTMP feeds: fileLocation is the stream KEY, not an image — an <img>
       would render the browser's broken-image icon. Same camera-on-dark
       placeholder as an offline live tile (LiveStreamPlayer.vue). -->
  <div v-else-if="props.media.assetType.name === 'stream'" class="stream-preview-frame">
    <i class="fas fa-video" aria-hidden="true"></i>
  </div>
  <template v-else>
    <a-image :src="absolutePath(props.media.fileLocation)" class="w-24 max-h-24 object-contain" />
    <a-popover v-if="attributes.multi" placement="right">
      <template #title>
        <b>{{ $t("multiframes") }}</b>
        <br />
        <span>Total frames: {{ attributes.frames.length }}</span>
      </template>
      <template #content>
        <div class="flex p-2 w-96">
          <div v-for="frame in attributes.frames" :key="frame" class="m-1">
            <a-image :src="absolutePath(frame)" />
          </div>
        </div>
      </template>
      <img src="assets/multi-frame.svg" alt="Multiframe" class="absolute left-4 bottom-4" />
    </a-popover>
  </template>
</template>

<style scoped>
.video-preview-frame {
  width: 192px;
  height: 96px;
  border-radius: 4px;
  overflow: hidden;
  background: #1a1a1a;
}

.video-preview-trigger {
  position: relative;
  display: block;
  padding: 0;
  border: 0;
  cursor: pointer;
}

.video-preview-play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.85);
  font-size: 28px;
  text-shadow: 0 0 6px rgba(0, 0, 0, 0.8);
  pointer-events: none;
}

.video-preview-player {
  display: block;
  width: 100%;
  max-height: 70vh;
  background: #000;
}

.stream-preview-frame {
  width: 96px;
  height: 96px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1a1a;
  color: rgba(255, 255, 255, 0.65);
  font-size: 28px;
}

.ant-carousel :deep(.slick-dots) {
  position: relative;
  height: auto;
}
.ant-carousel :deep(.slick-slide img) {
  border: 5px solid #fff;
  display: block;
  margin: auto;
  max-width: 80%;
}
.ant-carousel :deep(.slick-arrow) {
  display: none !important;
}
.ant-carousel :deep(.slick-thumb) {
  bottom: 0px;
  display: flex;
}
.ant-carousel :deep(.slick-thumb li) {
  width: 45px;
}
.ant-carousel :deep(.slick-thumb li img) {
  width: 100%;
  height: 100%;
  transform: scale(0.8);
}
.ant-carousel :deep(.slick-thumb li.slick-active img) {
  transform: scale(1);
}
</style>
