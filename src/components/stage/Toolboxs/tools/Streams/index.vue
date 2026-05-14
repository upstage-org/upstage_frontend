<script>
import { computed, reactive } from "vue";
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

    /** When server-side `.poster.jpg` exists, `<img>` is cheaper than probing the mux. */
    const posterUrl = (videoUrl) => (videoUrl ? `${videoUrl}.poster.jpg` : "");

    const posterFailedForUrl = reactive({});

    const thumbKey = (video) => String(video?.id ?? video?.url ?? "");

    const posterLoadFailed = (video) =>
      Boolean(posterFailedForUrl[thumbKey(video)]);

    const onPosterImgError = (video) => {
      posterFailedForUrl[thumbKey(video)] = true;
    };

    /** Seek hint so browsers that support media fragments paint a decoded still for metadata preload. */
    const firstFramePeekSrc = (url) => {
      if (!url) return "";
      if (/#t=/i.test(url)) return url;
      return url.includes("#") ? url : `${url}#t=0.01`;
    };

    return {
      videos,
      posterUrl,
      posterLoadFailed,
      onPosterImgError,
      firstFramePeekSrc,
    };
  },
};
</script>

<template>
  <div v-for="video in videos" :key="video.id ?? video.url">
    <Skeleton :data="video">
      <!--
        Primary: JPEG poster sibling (`<video>.poster.jpg`).
        Fallback: muted metadata preload + `#t=` so a first-frame still appears
        when the poster extractor has not run (dev upload, migration gap).
      -->
      <img
        v-if="!posterLoadFailed(video)"
        class="thumb-preview"
        loading="lazy"
        :src="posterUrl(video.url)"
        alt=""
        @error="onPosterImgError(video)"
      />
      <video
        v-else
        class="thumb-preview"
        :src="firstFramePeekSrc(video.url)"
        :muted.attr="true"
        playsinline
        preload="metadata"
        disablePictureInPicture
      ></video>
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

.thumb-preview {
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
</style>
