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
import { BACKGROUND_ACTIONS, COLORS } from "utils/constants";

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
    await startMutation(t("recording_started"), model.value.id, form.name.trim());
    // Both branches publish INSIDE the recording window (i.e. after the
    // mutation) so the replay's first events establish its opening state.
    // Previously the "clear" ran before the mutation (outside the window)
    // and only reset the backdrop colour — the stage was never actually
    // cleared, and the replay always began blank regardless of the toggle.
    if (clearOnStart.value) {
      // Genuinely clear the live stage: empty board (BLANK_SCENE), reset
      // the backdrop colour (BLANK_SCENE alone keeps the current colour
      // when the stage has no configured default), and raise any curtain.
      // The replay opens on the same cleared stage the live audience sees.
      stageStore.blankScene();
      stageStore.setBackdropColor(stageStore.config?.defaultcolor || COLORS.DEFAULT_BACKDROP);
      stageStore.drawCurtain(null);
    } else {
      // Keep the stage as-is: snapshot the current state (objects, texts,
      // drawings, background colour, curtain…) into the event stream so
      // the replay opens on exactly what was on stage.
      stageStore.publishRecordingSnapshot();
    }
    await stageStore.loadStage({ url: model.value.fileLocation! });
    if (clearOnStart.value) {
      // loadStage rebuilds local state from ARCHIVED events; the blank/
      // curtain broadcasts above may not be archived yet, which would
      // resurrect the pre-clear stage on the recorder's own screen (other
      // players clear fine via the broker echo). Re-apply the clear
      // locally — identical to receiving the echo, and idempotent with it.
      stageStore.handleBackgroundMessage({ message: { type: BACKGROUND_ACTIONS.BLANK_SCENE } });
      stageStore.handleBackgroundMessage({
        message: {
          type: BACKGROUND_ACTIONS.SET_BACKDROP_COLOR,
          color: stageStore.config?.defaultcolor || COLORS.DEFAULT_BACKDROP,
        },
      });
      stageStore.handleBackgroundMessage({
        message: { type: BACKGROUND_ACTIONS.DRAW_CURTAIN, curtain: null },
      });
    }
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
