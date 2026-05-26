<script lang="jsx">
import { provide } from "vue";
import { useJitsi } from "./composable";
import { useLocalStreamPublisher } from "./localStreamPublisher";

export default {
  setup(_, { slots }) {
    const [jitsi, joined] = useJitsi();
    provide("jitsi", jitsi);
    provide("joined", joined);

    // The publisher MUST live at the same provide-tree level as
    // `jitsi`/`joined` so every descendant (Board → Jitsi.vue tiles AND
    // StageToolbox → Meeting → Yourself.vue) can `inject` it. The
    // previous sibling-component design provided the API from a leaf
    // node — siblings could not see it — so Yourself.vue#join() was a
    // no-op and tracks were never published to the conference.
    const publisher = useLocalStreamPublisher(jitsi, joined);
    provide("localStreamPublisher", publisher);

    return () => slots.default();
  },
};
</script>
