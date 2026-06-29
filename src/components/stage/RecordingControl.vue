<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStageStore } from "@stores/pinia/stage";
import { useMutation } from "services/graphql/composable";
import { stageGraph } from "services/graphql";
import CustomConfirm from "components/CustomConfirm.vue";
import Field from "components/form/Field.vue";
import Switch from "components/form/Switch.vue";
import Loading from "components/Loading.vue";
import dayjs from "@utils/dayjs";
import humanizeDuration from "humanize-duration";
import { COLORS } from "utils/constants";
import { useClearStage } from "./composable";

const { t } = useI18n();
const stageStore = useStageStore();
const model = computed(() => stageStore.model);
const activeRecording = computed(() => model.value?.activeRecording ?? null);

const form = reactive({ name: "" });
const clearOnStart = ref(true);
const loading = ref(false);
const saving = ref(false);

const { save: startMutation } = useMutation(stageGraph.startRecording);
const { save: saveMutation } = useMutation(stageGraph.saveRecording);
const { loading: deleting, save: deleteMutation } = useMutation(stageGraph.deletePerformance);

const now = ref(dayjs());
const tick = setInterval(() => {
  now.value = dayjs();
}, 1000);
onUnmounted(() => clearInterval(tick));

const durationLabel = computed(() => {
  const rec = activeRecording.value;
  if (!rec?.createdOn) return "";
  const from = dayjs.utc(rec.createdOn);
  const duration = humanizeDuration(now.value.diff(from, "milliseconds"), { round: true });
  return `${rec.name ?? t("recording_in_progress")} — ${duration}`;
});

const startRecording = async (complete: () => void) => {
  if (!model.value?.id || !form.name.trim() || !model.value.fileLocation) return;
  loading.value = true;
  try {
    if (clearOnStart.value) {
      const clearStage = useClearStage(model.value.fileLocation, COLORS.DEFAULT_BACKDROP);
      await clearStage();
    }
    await startMutation(t("recording_started"), model.value.id, form.name.trim());
    await stageStore.loadStage({ url: model.value.fileLocation! });
    stageStore.refreshLiveStatus();
    complete();
  } finally {
    loading.value = false;
  }
};

const saveRecording = async () => {
  const rec = activeRecording.value;
  if (!rec?.id) return;
  saving.value = true;
  try {
    await saveMutation(t("recording_saved"), Number(rec.id));
    const loc = model.value?.fileLocation;
    if (loc) {
      await stageStore.loadStage({ url: loc });
      stageStore.refreshLiveStatus();
    }
  } finally {
    saving.value = false;
  }
};

const discardRecording = async (complete: () => void) => {
  const rec = activeRecording.value;
  if (!rec?.id) return;
  await deleteMutation(t("recording_discarded"), Number(rec.id));
  const loc = model.value?.fileLocation;
  if (loc) {
    await stageStore.loadStage({ url: loc });
    stageStore.refreshLiveStatus();
  }
  complete();
};
</script>

<template>
  <div v-if="activeRecording" class="recording-control field has-addons">
    <p class="control">
      <a-tooltip :title="$t('recording_stop_save')">
        <button
          class="button is-small is-light is-danger"
          type="button"
          :disabled="saving"
          @click="saveRecording"
        >
          <Loading v-if="saving" height="20px" />
          <span v-else class="icon is-small"><i class="fas fa-stop"></i></span>
          <span>{{ durationLabel }}</span>
        </button>
      </a-tooltip>
    </p>
    <p class="control">
      <CustomConfirm :loading="deleting" @confirm="discardRecording">
        <template #trigger>
          <button type="button" class="button is-small is-light">
            <span class="icon is-small"><i class="fas fa-times"></i></span>
          </button>
        </template>
        <div class="has-text-centered">{{ $t("recording_discard_confirm") }}</div>
      </CustomConfirm>
    </p>
  </div>
  <CustomConfirm v-else :loading="loading" @confirm="startRecording">
    <Field
      v-model="form.name"
      :label="$t('trim_replay_new_name')"
      :placeholder="$t('trim_replay_new_name')"
      required
    />
    <Switch v-model="clearOnStart" :label="$t('recording_clear_stage_on_start')" />
    <p v-if="clearOnStart" class="is-size-7 mt-2">
      <i class="fas fa-exclamation-triangle has-text-warning"></i>
      {{ $t("recording_start_clears_stage") }}
    </p>
    <template #yes>
      <i class="fas fa-video has-text-primary"></i>
      {{ $t("start_recording") }}
    </template>
    <template #trigger>
      <a-tooltip :title="$t('start_recording')">
        <button type="button" class="button is-small is-light record-icon">
          <i class="fas fa-video has-text-primary"></i>
        </button>
      </a-tooltip>
    </template>
  </CustomConfirm>
</template>

<style scoped>
.recording-control {
  margin: 0;
  flex-shrink: 0;
}
.has-addons {
  flex-wrap: nowrap;
}
/* Match the 24x24 sizing of the ReloadStream refresh icons so the start
   recording control lines up at the same height as the other icons. */
.record-icon {
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 4px;
}
.record-icon:hover {
  transform: scale(1.2);
}
</style>
