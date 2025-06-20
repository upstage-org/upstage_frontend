<template>
    <div v-if="hasJitsiStream" id="reload-stream">
        <a-tooltip title="Refresh streams">
            <button class="button is-small refresh-icon clickable" @mousedown="onReload">
                <i class="fas fa-sync"></i>
            </button>
        </a-tooltip>
    </div>
</template>

<script setup lang="ts">
import { useStageStore } from 'store/modules/stage';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';

interface StageObject {
    type: string;
    [key: string]: any;
}

const stageStore = useStageStore();
const { objects } = storeToRefs(stageStore);

const hasJitsiStream = computed(() => objects.value.some((obj: StageObject) => obj.type === 'jitsi'));
const onReload = () => stageStore.reloadStreams();
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