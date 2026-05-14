<script>
import { computed } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import Skeleton from "../../Skeleton.vue";
import StreamToolboxThumb from "./StreamToolboxThumb.vue";

export default {
  components: {
    Skeleton,
    StreamToolboxThumb,
  },
  setup: () => {
    const stageStore = useStageStore();

    const videos = computed(() => {
      const res = [...(stageStore.tools?.videos || [])];
      return res;
    });

    return {
      videos,
    };
  },
};
</script>

<template>
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
