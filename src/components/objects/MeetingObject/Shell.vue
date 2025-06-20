<script lang="jsx">
import { provide } from "vue";
import { useJitsi } from "./composable";
import { useMeetingStore } from "store/modules/meeting";

export default {
  setup(_, { slots }) {
    const meetingStore = useMeetingStore();
    const [jitsi, joined] = useJitsi();

    provide("jitsi", jitsi);
    provide("joined", joined);

    return () => slots.default();
  },
};
</script>