<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { humanFileSize } from "utils/common";
import { useConfigStore } from "@stores/pinia/config";
import { useUserStore } from "@stores/pinia/user";
import { storeToRefs } from "pinia";
import { imageExtensions, audioExtensions, videoExtensions } from "utils/constants";

const props = defineProps<{
  modelValue?: string;
  id?: string;
  initialFile?: File;
  type?: string;
  preview?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string | ArrayBuffer | null): void;
  (e: "change", file: File | null, type?: string | null): void;
}>();

const { uploadLimit: nginxLimit } = storeToRefs(useConfigStore());
const { user: currentUser } = storeToRefs(useUserStore());
const mediaLimit = computed(() => currentUser.value?.uploadLimit || nginxLimit.value);
const file = ref<File | null | undefined>(props.initialFile);

const accept = computed(() => {
  const extensions = [];
  if (props.type === "image" || !props.type) {
    extensions.push(imageExtensions);
  }
  if (props.type === "audio" || !props.type) {
    extensions.push(audioExtensions);
  }
  if (props.type === "video" || !props.type) {
    extensions.push(videoExtensions);
  }
  return extensions.join(",");
});

const valid = computed(() => {
  if (file.value) {
    return file.value.size <= mediaLimit.value;
  }
  return true;
});

const fileType = computed(() => {
  if (file.value) {
    const parts = file.value.name.split(".");
    const extension = parts[parts.length - 1];
    if (imageExtensions.includes(extension)) {
      return "image";
    }
    if (audioExtensions.includes(extension)) {
      return "audio";
    }
    if (videoExtensions.includes(extension)) {
      return "video";
    }
  }
  return null;
});

watch(
  () => props.modelValue,
  (value) => {
    if (!value) {
      file.value = null;
    }
  },
);

watch(mediaLimit, () => {
  if (!valid.value) {
    emit("change", null);
  }
});

const handleInputFile = (e: Event) => {
  const picked = (e.target as HTMLInputElement).files?.[0];
  if (!picked) return;
  const reader = new FileReader();
  reader.readAsDataURL(picked);
  reader.onload = () => {
    file.value = picked;
    if (valid.value) {
      emit("update:modelValue", reader.result);
      emit("change", file.value, fileType.value);
    } else {
      emit("change", null);
    }
  };
};

const isImage = computed(() => file.value?.type?.startsWith("image"));
const tooltip = computed(
  () =>
    `Permitted file formats are ${
      accept.value
    }. Maximum file size is ${humanFileSize(mediaLimit.value)}`,
);
</script>

<template>
  <div class="file">
    <a-tooltip :title="tooltip">
      <label class="file-label has-tooltip-right">
        <input
          :id="id"
          class="file-input"
          type="file"
          name="resume"
          :accept="accept"
          @input="handleInputFile"
        />
        <span class="file-cta">
          <slot>
            <span class="file-icon">
              <i class="fas fa-file"></i>
            </span>
            <span class="file-label">Choose a file…</span>
          </slot>
        </span>
        <div v-if="!valid" class="mt-2 mx-2 has-text-danger">
          <span>Maximum file size: {{ humanFileSize(mediaLimit) }}&nbsp;</span>
          <i class="fas fa-times"></i>
          (current size: {{ file ? humanFileSize(file.size) : "" }})
        </div>
      </label>
    </a-tooltip>
  </div>

  <template v-if="preview && file">
    <img v-if="isImage" :src="modelValue" alt="Preview" />
    <div v-else class="box has-text-centered">
      <i class="fas fa-file"></i>
      <b>{{ file.name }} ({{ humanFileSize(file.size) }})</b>
    </div>
  </template>
</template>

<style></style>
