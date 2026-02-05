<template>
    <div v-if="hasMeetingOrJitsi" id="reload-stream">
        <a-tooltip v-if="hasMeeting" :title="$t('refresh_meeting_tooltip')">
            <button class="button is-small refresh-icon clickable" @mousedown="onRefreshMeeting" :aria-label="$t('refresh_meeting')">
                <i class="fas fa-video" title="Refresh meeting"></i>
            </button>
        </a-tooltip>
        <a-tooltip v-if="hasJitsi" title="Refresh streams">
            <button class="button is-small refresh-icon clickable" @mousedown="onReload" aria-label="Refresh streams">
                <i class="fas fa-sync"></i>
            </button>
        </a-tooltip>
    </div>
</template>

<script>
import { useStore } from "vuex";
import { computed } from "vue";

export default {
    components: {},
    setup: () => {
        const store = useStore();
        const objects = computed(() => store.getters["stage/objects"]);
        const hasMeeting = computed(() => objects.value.some((el) => el.type === "meeting"));
        const hasJitsi = computed(() => objects.value.some((el) => el.type === "jitsi"));
        const hasMeetingOrJitsi = computed(() => hasMeeting.value || hasJitsi.value);
        const onReload = () => store.dispatch("stage/reloadStreams");
        const onRefreshMeeting = () => store.dispatch("stage/refreshMeeting");
        return {
            objects,
            hasMeeting,
            hasJitsi,
            hasMeetingOrJitsi,
            onReload,
            onRefreshMeeting,
        };
    },
};
</script>

<style scoped lang="scss">
#reload-stream {
    display: inline-block;
    margin-right: 10px;

    @media screen and (max-width: 767px) {
        right: unset;
        top: 8px;
        left: 0;
    }
}

.refresh-icon {
    width: 24px;
    height: 24px;
    padding: 0px;
    border-radius: 4px;

    &:hover {
        transform: scale(1.2);
    }
}
</style>