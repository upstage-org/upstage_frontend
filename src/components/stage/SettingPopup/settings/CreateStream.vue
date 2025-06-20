<template>
  <div class="card-header">
    <span class="card-header-title">{{ $t("new_stream") }}</span>
  </div>
  <div class="card-content voice-parameters">
    <form @submit.prevent="createRoom">
      <HorizontalField title="Name">
        <Field v-model="form.name" required required-message="Stream name is required" pattern="^[^?&:&quot;'%#]+$"
          title="Meeting name should not contain any of these characters: ?, &, :, ', &quot;, %, #.">
        </Field>
      </HorizontalField>
      <SaveButton :disabled="!form.name.trim()">{{
        $t("new_stream")
        }}</SaveButton>
    </form>
  </div>
</template>

<script setup lang="ts">
import Field from "components/form/Field.vue";
import SaveButton from "components/form/SaveButton.vue";
import HorizontalField from "components/form/HorizontalField.vue";
import { useStageStore } from 'store';
import { reactive, computed } from 'vue';

const emit = defineEmits(['close']);
const stageStore = useStageStore();

const form = reactive({ name: "" });

const createRoom = async () => {
  const streamConfig = {
    type: "stream",
    jitsi: true,
    name: form.name,
    description: '', // You might want to get this from a user store
    w: stageStore.stageSize.width / 2,
    h: stageStore.stageSize.height / 2,
  };

  stageStore.createStream(streamConfig);
  emit("close");
};
</script>

<style></style>
