<script>
import Field from "components/form/Field.vue";
import SaveButton from "components/form/SaveButton.vue";
import { useStageStore } from "@stores/pinia/stage";
import { reactive, computed } from "vue";
import HorizontalField from "components/form/HorizontalField.vue";
import Dropdown from "components/form/Dropdown.vue";
import configs from "config";
import { endpointHostLabel } from "utils/common";
export default {
  components: { Field, SaveButton, HorizontalField, Dropdown },
  emits: ["close"],
  setup: (_, { emit }) => {
    const stageStore = useStageStore();
    const stageSize = computed(() => stageStore.stageSize);

    // Multi-server streaming: a meeting room lives on one Jitsi server,
    // picked per room here (streams pick theirs per tile in the Streams
    // tab). Default = the first configured server.
    const showServerPicker = (configs.JITSI_SERVER_COUNT ?? 1) > 1;
    const serverOptions = (configs.JITSI_ENDPOINTS ?? []).map((origin) => ({
      value: origin,
      label: endpointHostLabel(origin),
    }));

    const form = reactive({
      name: "",
      jitsiServer: configs.JITSI_ENDPOINT,
    });
    const createRoom = async () => {
      stageStore.CREATE_ROOM({
        type: "meeting",
        name: form.name,
        description: "",
        w: stageSize.value.width / 2,
        h: stageSize.value.height / 2,
        // Only written with several servers so single-server rooms are
        // byte-identical to before.
        ...(showServerPicker ? { jitsiServer: form.jitsiServer } : {}),
      });
      emit("close");
    };

    return { form, createRoom, showServerPicker, serverOptions };
  },
};
</script>

<template>
  <div class="card-header">
    <span class="card-header-title">{{ $t("create_new_meeting_room") }}</span>
  </div>
  <div class="card-content voice-parameters">
    <form @submit.prevent="createRoom">
      <HorizontalField title="Room name">
        <Field
          v-model="form.name"
          required
          required-message="Room name is required"
          pattern="^[^?&:&quot;'%#]+$"
          title="Meeting name should not contain any of these characters: ?, &, :, ', &quot;, %, #."
        >
        </Field>
      </HorizontalField>
      <HorizontalField v-if="showServerPicker" :title="$t('streaming_server')">
        <Dropdown
          v-model="form.jitsiServer"
          :data="serverOptions"
          :render-value="(item) => item.value"
          :render-label="(item) => item.label"
        />
      </HorizontalField>
      <SaveButton :disabled="!form.name.trim()">{{ $t("create_room") }}</SaveButton>
    </form>
  </div>
</template>

<style></style>
