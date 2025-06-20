<template>
  <div class="file">
    <a-tooltip :title="tooltip">
      <label class="file-label has-tooltip-right">
        <input :id="id" class="file-input" type="file" name="resume" :accept="accept" @input="handleInputFile" />
        <span class="file-cta">
          <slot>
            <span class="file-icon">
              <i class="fas fa-file"></i>
            </span>
            <span class="file-label">Choose a file…</span>
          </slot>
        </span>
        <div v-if="!valid && file" class="mt-2 mx-2 has-text-danger">
          <span>Maximum file size: {{ humanFileSize(mediaLimit) }}&nbsp;</span>
          <i class="fas fa-times"></i>
          (current size: {{ humanFileSize(file.size) }})
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

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { humanFileSize } from "utils/common";
import { useUserStore } from "store/modules/user";
import { useConfigStore } from "store/modules/config";
import {
  imageExtensions,
  audioExtensions,
  videoExtensions,
} from "constants/index";

interface Props {
  modelValue?: string;
  id?: string;
  initialFile?: File;
  type?: string;
  preview?: boolean;
  acceptVideo?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  id: '',
  initialFile: undefined,
  type: '',
  preview: false,
  acceptVideo: false
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'change', file: File | null, type: string | null): void;
}>();

const userStore = useUserStore();
const configStore = useConfigStore();

const nginxLimit = computed(() => configStore.uploadLimit);
const mediaLimit = computed(() => {
  let limit = userStore.whoami?.uploadLimit;
  if (!limit || props.acceptVideo) {
    limit = nginxLimit.value;
  }
  return limit;
});

const file = ref<File | null>(props.initialFile || null);

const accept = computed(() => {
  let extensions = [];
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

const type = computed(() => {
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
    emit("change", null, null);
  }
});

const handleInputFile = (e: Event) => {
  const target = e.target as HTMLInputElement;
  if (!target.files?.length) return;

  const reader = new FileReader();
  reader.readAsDataURL(target.files[0]);
  reader.onload = () => {
    file.value = target.files![0];
    if (valid.value) {
      emit("update:modelValue", reader.result as string);
      emit("change", file.value, type.value);
    } else {
      emit("change", null, null);
    }
  };
};

const isImage = computed(() => file.value?.type?.startsWith("image"));
const tooltip = computed(
  () =>
    `Permitted file formats are ${accept.value
    }. Maximum file size is ${humanFileSize(mediaLimit.value)}`,
);
</script>

<style></style>
