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

    // Poster URLs are derived by string-append of `.poster.jpg` to the
    // video URL. The backend's `upstage_backend.files.video_poster`
    // module writes posters next to the source video using the same
    // convention, so we don't need a separate GraphQL field — keeping
    // the schema unchanged. If the poster file is missing on disk
    // (extractor failed or operator hasn't run the backfill script
    // yet) the browser silently falls back to rendering nothing, which
    // looks bad but doesn't break anything. The cure for that is the
    // `scripts/backfill_video_posters.py` one-shot.
    const posterUrl = (videoUrl) => (videoUrl ? `${videoUrl}.poster.jpg` : "");

    return { videos, posterUrl };
  },
};
</script>

<template>
  <div v-for="video in videos" :key="video.id ?? video.url">
    <Skeleton :data="video">
      <!--
        Performer-side video thumbnail. We use a server-extracted
        first-frame JPG (`<video>.poster.jpg`, written by
        upstage_backend.files.video_poster at upload time and by the
        backfill script for legacy uploads). With a real poster in
        place the browser shows a true static thumbnail in every
        engine — no more silent autoplay loop, no Firefox/Chromium
        black-rectangle quirks.

          - `preload="none"`  : we never actually want the toolbox to
                                stream the video; we only need the
                                poster. This keeps the toolbox cheap
                                no matter how many videos a stage has.
          - `muted` + `playsinline` + `disablePictureInPicture`:
                                future-proofs in case any browser
                                decides to auto-render frames; we
                                won't suddenly start playing audio or
                                offering a PiP toggle on hover.
          - No `autoplay`/`loop`/`controls`: this is purely a still
                                thumbnail; clicking is handled by the
                                surrounding Skeleton drag affordance,
                                not by the native media UI.
      -->
      <video
        :src="video.url"
        :poster="posterUrl(video.url)"
        :muted.attr="true"
        playsinline
        preload="none"
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
</style>
