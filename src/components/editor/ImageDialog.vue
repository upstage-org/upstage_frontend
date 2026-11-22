<script setup lang="ts">
/**
 * Image properties for `RichTextEditor`: address or file, alternative text,
 * and size in pixels with proportions kept, the way TinyMCE's image dialog
 * worked. Used both to insert a new image and to change a selected one.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  IMAGE_TOO_LARGE_MESSAGE,
  MIN_IMAGE_SIZE,
  imageFileTooLarge,
  type ImageAttributes,
  claimFocus,
} from "./richText";

const props = defineProps<{
  /** The selected image's attributes, or `null` to insert a new one. */
  image: ImageAttributes | null;
}>();

const emit = defineEmits<{
  (e: "save", value: ImageAttributes): void;
  (e: "cancel"): void;
}>();

const src = ref(props.image?.src ?? "");
const alt = ref(props.image?.alt ?? "");
const width = ref<string>(props.image?.width ? String(props.image.width) : "");
const height = ref<string>(props.image?.height ? String(props.image.height) : "");
const constrain = ref(true);
/** Natural size of the picture at `src`, once it has loaded. */
const natural = ref<{ width: number; height: number } | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const fileError = ref("");
const srcInput = ref<HTMLInputElement | null>(null);

const editing = computed(() => props.image !== null);
/**
 * Width ÷ height that "Keep proportions" holds on to: the size the dialog
 * opened with, else the picture's own, re-taken whenever the box is ticked.
 */
const lockedRatio = ref<number | null>(null);
const currentRatio = (): number | null => {
  const w = Number(width.value);
  const h = Number(height.value);
  if (w > 0 && h > 0) return w / h;
  if (natural.value?.width && natural.value.height) {
    return natural.value.width / natural.value.height;
  }
  return null;
};
const lockRatio = () => {
  lockedRatio.value = currentRatio();
};
watch(constrain, (on) => on && lockRatio());

let probe: HTMLImageElement | null = null;
let probeTimer: ReturnType<typeof setTimeout> | null = null;
/** The address did not load as a picture (shown under the field). */
const loadFailed = ref(false);
const dropProbe = () => {
  if (probe) {
    probe.onload = null;
    probe.onerror = null;
    probe = null;
  }
};
/** Read the picture's own size; fills in empty width/height once it is known. */
const probeSize = () => {
  const address = src.value.trim();
  natural.value = null;
  loadFailed.value = false;
  dropProbe();
  if (!address) return;
  probe = new Image();
  probe.onload = () => {
    if (!probe || src.value.trim() !== address) return;
    natural.value = { width: probe.naturalWidth, height: probe.naturalHeight };
    // Pre-fill the size only when it is one the fields accept. A picture
    // smaller than the minimum (an icon, a spacer) used to be filled in with
    // its own size, which the fields then rejected as too small: Insert did
    // nothing, with no message. Left empty, the picture keeps its own size.
    if (
      !width.value &&
      !height.value &&
      natural.value.width >= MIN_IMAGE_SIZE &&
      natural.value.height >= MIN_IMAGE_SIZE
    ) {
      width.value = String(natural.value.width);
      height.value = String(natural.value.height);
    }
    if (!lockedRatio.value) lockRatio();
  };
  probe.onerror = () => {
    if (src.value.trim() === address) loadFailed.value = true;
  };
  probe.src = address;
};
/** Typing an address probes it once the typing pauses, not on every key. */
const PROBE_DELAY_MS = 300;
watch(src, () => {
  if (probeTimer) clearTimeout(probeTimer);
  probeTimer = setTimeout(probeSize, PROBE_DELAY_MS);
});
onMounted(() => {
  lockRatio();
  probeSize();
  claimFocus(srcInput.value);
});
onBeforeUnmount(() => {
  if (probeTimer) clearTimeout(probeTimer);
  dropProbe();
});

const onWidthInput = () => {
  if (!constrain.value || !lockedRatio.value) return;
  const w = Number(width.value);
  height.value = w > 0 ? String(Math.max(1, Math.round(w / lockedRatio.value))) : "";
};

const onHeightInput = () => {
  if (!constrain.value || !lockedRatio.value) return;
  const h = Number(height.value);
  width.value = h > 0 ? String(Math.max(1, Math.round(h * lockedRatio.value))) : "";
};

const onFilePicked = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !file.type.startsWith("image/")) return;
  if (imageFileTooLarge(file)) {
    fileError.value = IMAGE_TOO_LARGE_MESSAGE;
    return;
  }
  fileError.value = "";
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result !== "string") return;
    width.value = "";
    height.value = "";
    lockedRatio.value = null;
    src.value = reader.result;
    if (!alt.value) alt.value = file.name.replace(/\.[^.]+$/, "");
  };
  reader.readAsDataURL(file);
};

const toPixels = (value: string): number | null => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= MIN_IMAGE_SIZE ? n : null;
};

const valid = computed(() => src.value.trim().length > 0);

const save = () => {
  if (!valid.value) return;
  emit("save", {
    src: src.value.trim(),
    alt: alt.value.trim() || null,
    width: toPixels(width.value),
    height: toPixels(height.value),
  });
};
</script>

<template>
  <div class="rich-text-dialog-backdrop" @mousedown.self="emit('cancel')">
    <form
      class="rich-text-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rich-text-image-title"
      @submit.prevent="save"
      @keydown.esc.prevent="emit('cancel')"
    >
      <h3 id="rich-text-image-title">{{ editing ? "Image properties" : "Insert image" }}</h3>
      <label>
        <span>Address</span>
        <span class="row">
          <input
            ref="srcInput"
            v-model="src"
            type="text"
            name="src"
            placeholder="https://…"
            autocomplete="off"
            spellcheck="false"
          />
          <button type="button" class="secondary" @click="fileInput?.click()">Choose file…</button>
        </span>
      </label>
      <input
        ref="fileInput"
        type="file"
        name="file"
        accept="image/*"
        class="hidden"
        @change="onFilePicked"
      />
      <label>
        <span>Alternative text</span>
        <input v-model="alt" type="text" name="alt" placeholder="Describes the picture" />
      </label>
      <div class="size">
        <label>
          <span>Width</span>
          <input
            v-model="width"
            type="number"
            name="width"
            :min="MIN_IMAGE_SIZE"
            step="1"
            inputmode="numeric"
            @input="onWidthInput"
          />
        </label>
        <label>
          <span>Height</span>
          <input
            v-model="height"
            type="number"
            name="height"
            :min="MIN_IMAGE_SIZE"
            step="1"
            inputmode="numeric"
            @input="onHeightInput"
          />
        </label>
        <label class="check">
          <input v-model="constrain" type="checkbox" name="constrain" />
          <span>Keep proportions</span>
        </label>
      </div>
      <p v-if="fileError" class="hint error" data-testid="file-error">{{ fileError }}</p>
      <p v-else-if="loadFailed" class="hint error" data-testid="load-error">
        This address did not load as a picture.
      </p>
      <p v-if="natural" class="hint">
        Original size {{ natural.width }} × {{ natural.height }} px. Leave width and height empty to
        use it.
      </p>
      <p v-if="natural" class="preview">
        <img :src="src.trim()" :alt="alt || 'Preview'" />
      </p>
      <div class="actions">
        <button type="button" class="secondary cancel" @click="emit('cancel')">Cancel</button>
        <button type="submit" :disabled="!valid">{{ editing ? "Save" : "Insert" }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped lang="less">
// Backdrop and dialog chrome come from the shared styles in CharacterMap.vue.
.rich-text-dialog {
  label {
    display: block;
    margin-bottom: 10px;

    > span:first-child {
      display: block;
      margin-bottom: 2px;
      font-size: 12px;
      color: #555;
    }
  }

  input[type="text"],
  input[type="number"] {
    box-sizing: border-box;
    width: 100%;
    height: 30px;
    padding: 0 8px;
    border: 1px solid #d9d9d9;
    border-radius: 4px;
    font-size: 14px;
  }

  .row {
    display: flex;
    gap: 6px;

    input {
      flex: 1;
      min-width: 0;
    }

    button {
      height: 30px;
      padding: 0 12px;
      border: 1px solid #007011;
      border-radius: 4px;
      background: #fff;
      color: #007011;
      cursor: pointer;
      white-space: nowrap;
    }
  }

  .size {
    display: flex;
    gap: 10px;
    align-items: flex-end;

    label {
      flex: 1;
    }

    .check {
      flex: 1.4;
      display: flex;
      align-items: center;
      gap: 6px;
      height: 30px;
      margin-bottom: 10px;

      > span {
        margin: 0;
        font-size: 13px;
        color: #000;
      }
    }
  }

  .hint {
    margin: 0 0 8px;
    font-size: 12px;
    color: #555;

    &.error {
      color: #b00020;
    }
  }

  .preview {
    margin: 0 0 12px;
    padding: 8px;
    border: 1px dashed #d9d9d9;
    border-radius: 4px;
    text-align: center;

    img {
      max-width: 100%;
      max-height: 160px;
    }
  }
}
</style>
