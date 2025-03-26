<template>
    <div v-if="objects.find(el => el.type == 'jitsi')" id="reload-stream">
        <a-tooltip title="Refresh streams">
            <button class="button is-small refresh-icon clickable" @mousedown="onReload">
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
        const onReload = () => store.dispatch("stage/reloadStreams");
        return {
            objects,
            onReload
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