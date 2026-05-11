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
        <video :src="video.url"></video>
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
  height: 100%;
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
