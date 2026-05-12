<script lang="jsx">
import { onMounted, onUnmounted, ref } from "vue";

export default {
  props: {
    track: Object,
  },
  setup(props) {
    const el = ref();
    onMounted(() => {
      // Vue 3 routes `muted` through patchDOMProp (because it's a member
      // of HTMLMediaElement.prototype), which sets only the IDL property
      // and never calls setAttribute. Safari (desktop + iOS) and several
      // ad/content blockers gate autoplay on the *attribute* being
      // present in the rendered HTML, not on the IDL property — so we
      // mirror it by hand here, the JSX equivalent of the
      // `:muted.attr="true"` modifier used in the .vue templates.
      if (props.track.getType() === "video" && el.value) {
        el.value.setAttribute("muted", "");
      }
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
      // (The `muted` HTML attribute is also force-mirrored in onMounted
      // above; see comment there for the Vue 3 quirk this works around.)
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
