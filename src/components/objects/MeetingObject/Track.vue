<script lang="jsx">
import { onMounted, onUnmounted, ref } from "vue";

export default {
  props: {
    track: Object,
  },
  setup(props) {
    const el = ref();
    onMounted(() => {
      props.track.attach(el.value);
    });
    onUnmounted(() => {
      props.track.detach();
    });
    if (props.track.getType() === "video") {
      // `muted` + `playsinline` are required for cross-browser autoplay of
      // a <video> bound to a Jitsi MediaStream:
      //  - Safari blocks autoplay if the stream carries any unmuted audio
      //    track (even when audio is routed elsewhere).
      //  - iOS Safari forces fullscreen on first play without
      //    `playsinline`, breaking any in-page video tile.
      // Audio for these tracks is rendered via a sibling <audio> element
      // pattern (see Jitsi.vue), so muting the <video> is correct.
      return () => <video autoplay muted playsinline ref={el}></video>;
    } else {
      return () => <audio autoplay ref={el}></audio>;
    }
  },
};
</script>

<style scoped>
video {
  width: 200px;
  border-radius: 12px;
}
</style>
