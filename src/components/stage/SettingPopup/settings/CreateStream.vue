<script>
import Field from "components/form/Field.vue";
import SaveButton from "components/form/SaveButton.vue";
import { useStageStore } from "@stores/pinia/stage";
import { useUserStore } from "@stores/pinia/user";
import { reactive, computed } from "vue";
import HorizontalField from "components/form/HorizontalField.vue";
export default {
  components: { Field, SaveButton, HorizontalField },
  emits: ["close"],
  setup: (_, { emit }) => {
    const stageStore = useStageStore();
    const userStore = useUserStore();
    const stageSize = computed(() => stageStore.stageSize);

    const form = reactive({ name: "" });
    const createRoom = async () => {
      // Note: `store.state.user.user?.email` worked by accident — the
      // Vuex root store no longer has a `user` module (it was migrated
      // to Pinia), so the read returned undefined under a swallowed
      // error. Reading from the Pinia user store directly is correct.
      stageStore.CREATE_STREAM({
        type: "stream",
        jitsi: true,
        name: form.name,
        description: userStore.user?.email,
        w: stageSize.value.width / 2,
        h: stageSize.value.height / 2,
      });
      emit("close");
    };

    return { form, createRoom };
  },
};
</script>

<template>
  <div class="card-header">
    <span class="card-header-title">{{ $t("new_stream") }}</span>
  </div>
  <div class="card-content voice-parameters">
    <form @submit.prevent="createRoom">
      <HorizontalField title="Name">
        <Field
          v-model="form.name"
          required
          required-message="Stream name is required"
          pattern="^[^?&:&quot;'%#]+$"
          title="Meeting name should not contain any of these characters: ?, &, :, ', &quot;, %, #."
        >
        </Field>
      </HorizontalField>
      <SaveButton :disabled="!form.name.trim()">{{ $t("new_stream") }}</SaveButton>
    </form>
  </div>
</template>

<style></style>
