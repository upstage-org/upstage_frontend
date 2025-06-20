<template>
  <div class="card-header">
    <span class="card-header-title">{{ $t("create_new_meeting_room") }}</span>
  </div>
  <div class="card-content voice-parameters">
    <form @submit.prevent="createRoom">
      <HorizontalField title="Room name">
        <Field v-model="form.name" required required-message="Room name is required" pattern="^[^?&:&quot;'%#]+$"
          title="Meeting name should not contain any of these characters: ?, &, :, ', &quot;, %, #.">
        </Field>
      </HorizontalField>
      <SaveButton :disabled="!form.name.trim()">{{
        $t("create_room")
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
const stageSize = computed(() => stageStore.stageSize);

const form = reactive({ name: "" });

const createRoom = async () => {
  stageStore.createRoom({
    type: "meeting",
    name: form.name,
    description: "",
    w: stageSize.value.width / 2,
    h: stageSize.value.height / 2,
  });
  emit("close");
};
</script>

<style></style>
