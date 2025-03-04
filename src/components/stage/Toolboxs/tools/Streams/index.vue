<template>
  <div
    v-for="video in videos"
    :key="video"
  >
    <Skeleton :data="video">
      <video :src="video.url"></video>
    </Skeleton>
  </div>
</template>

<script>
import { computed, onMounted } from "vue";
import { useStore } from "vuex";
import Skeleton from "../../Skeleton.vue";
import Icon from "components/Icon.vue";
import Loading from "components/Loading.vue";

export default {
  components: {
    Skeleton,
    Icon,
    Loading,
  },
  setup: () => {
    const store = useStore();

    const videos = computed(() => {
      const res = [...store.state.stage.tools.videos];
      return res;
    });

    return { videos };
  },
};
</script>

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
</style>
