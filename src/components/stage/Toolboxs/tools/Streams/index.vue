<script>
import { computed } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import Icon from "components/Icon.vue";
import Skeleton from "../../Skeleton.vue";
import StreamToolboxThumb from "./StreamToolboxThumb.vue";

export default {
  components: {
    Icon,
    Skeleton,
    StreamToolboxThumb,
  },
  setup: () => {
    const stageStore = useStageStore();

    const videos = computed(() => {
      // Live RTMP feeds render in the Streams (Meeting) tab instead — hide
      // them here to avoid duplicates. But when RTMP streaming is off (tab
      // hidden entirely, or streaming mode is Jitsi-only) keep the feeds in
      // this strip as the fallback rather than making them unreachable.
      const res = (stageStore.tools?.videos || []).filter(
        (v) => !(v.isRTMP && stageStore.rtmpStreamingEnabled),
      );
      return res;
    });

    // Removes every placed video-clip object from the stage (live RTMP
    // tiles belong to the Streams tab's clear instead).
    const clearAll = () => stageStore.clearStageObjectsOfKind("video");

    return {
      videos,
      clearAll,
    };
  },
};
</script>

<template>
  <div @click="clearAll">
    <div class="icon is-large">
      <Icon size="36" src="clear.svg" />
    </div>
    <span class="tag is-light is-block">{{ $t("clear") }}</span>
  </div>
  <div v-for="video in videos" :key="video.id ?? video.url">
    <Skeleton :data="video">
      <StreamToolboxThumb :video="video" />
    </Skeleton>
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

.centered {
  margin: auto;
}

.pending-stream {
  cursor: not-allowed;
}
</style>
