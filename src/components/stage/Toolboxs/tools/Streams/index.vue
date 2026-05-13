<script>
import { computed } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import Skeleton from "../../Skeleton.vue";

export default {
  components: {
    Skeleton,
  },
  setup: () => {
    const stageStore = useStageStore();

    const videos = computed(() => {
      const res = [...(stageStore.tools?.videos || [])];
      return res;
    });

    return { videos };
  },
};
</script>

<template>
  <div v-for="video in videos" :key="video">
    <img class="overlay" src="/img/videoloading.gif" />
    <div style="z-index: 1">
      <Skeleton :data="video">
        <!--
          Performer-side stream thumbnail. Earlier iterations tried to
          rely on the browser's "poster frame" behaviour (showing the
          first decoded frame of a `preload="metadata"` video), but that
          is unreliable: Firefox renders black until clicked, and recent
          Brave / Chromium media-policy tightening shows the same black
          rectangle plus the `controls` play-bar overlay. The current
          approach plays the video itself, silently and in a loop, so
          the toolbox always shows actual moving content rather than a
          dead-looking placeholder.
            - `muted` + `playsinline` + `autoplay` + `loop` is the
              cross-browser autoplay-allowed combination on every major
              engine, including iOS Safari (no fullscreen takeover).
            - No `controls` so the thumbnail doesn't sport a player
              UI; this is a preview, not a media player.
            - `preload="auto"` because the loop needs the full file
              anyway; metadata-only preload combined with autoplay
              triggers re-fetch when the first loop completes.
            - `disablePictureInPicture` keeps Chromium from offering
              its PiP button on hover; the toolbox is too small for it
              to be useful.
        -->
        <video
          :src="video.url"
          :muted.attr="true"
          playsinline
          autoplay
          loop
          preload="auto"
          disablePictureInPicture
        ></video>
      </Skeleton>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@mixin gradientText($from, $to) {
  background: linear-gradient(to top, $from, $to);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.fas.fa-plus {
  @include gradientText(#30ac45, #6fb1fc);
}

video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.centered {
  margin: auto;
}

.pending-stream {
  cursor: not-allowed;
}
.overlay {
  position: absolute;
  width: 40%;
  left: 30%;
  top: 45%;
  -webkit-transform: translateY(-50%);
  -moz-transform: translateY(-50%);
  -ms-transform: translateY(-50%);
  transform: translateY(-50%);
}
</style>
