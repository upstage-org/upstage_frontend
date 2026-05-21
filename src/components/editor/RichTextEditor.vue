<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

/** Minimal typing for self-hosted TinyMCE loaded from `/public/js/tinymce`. */
type TinyEditor = {
  getContent: () => string;
  setContent: (html: string, args?: { format?: string }) => void;
  on: (name: string, callback: () => void) => void;
  mode?: { set: (mode: string) => void };
  setMode?: (mode: string) => void;
};

type TinyMCEGlobal = {
  init: (config: Record<string, unknown>) => Promise<TinyEditor[]>;
  remove: (editor: TinyEditor) => void;
};

declare global {
  interface Window {
    tinymce?: TinyMCEGlobal;
  }
}

let tinymceLoader: Promise<void> | null = null;

function loadTinyMCE(scriptUrl: string): Promise<void> {
  if (window.tinymce) return Promise.resolve();
  if (!tinymceLoader) {
    tinymceLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = scriptUrl;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load TinyMCE from ${scriptUrl}`));
      document.head.appendChild(script);
    });
  }
  return tinymceLoader;
}

function assetPrefix(): string {
  const raw = import.meta.env.BASE_URL;
  return raw.endsWith("/") ? raw : `${raw}/`;
}

function tinymceRootUrl(): string {
  return `${assetPrefix()}js/tinymce`.replace(/\/+$/, "");
}

function tinymceScriptUrl(): string {
  return `${assetPrefix()}js/tinymce/tinymce.min.js`;
}

function setEditorMode(editor: TinyEditor, readonly: boolean) {
  const mode = readonly ? "readonly" : "design";
  editor.mode?.set(mode);
  editor.setMode?.(mode);
}

const PLUGINS = [
  "advlist",
  "autolink",
  "lists",
  "link",
  "image",
  "charmap",
  "preview",
  "anchor",
  "searchreplace",
  "visualblocks",
  "code",
  "fullscreen",
  "insertdatetime",
  "media",
  "table",
  "help",
  "wordcount",
  "textcolor",
  "paste",
  "directionality",
  "hr",
].join(" ");

const FULL_TOOLBAR =
  "undo redo | formatselect fontselect fontsizeselect | bold italic underline strikethrough | forecolor backcolor | alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | removeformat | link table image code charmap hr | fullscreen preview help";

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    readonly?: boolean;
    placeholder?: string;
  }>(),
  {
    modelValue: "",
    readonly: false,
    placeholder: "Write something...",
  },
);

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

const textareaRef = ref<HTMLTextAreaElement | null>(null);
let editorInstance: TinyEditor | null = null;
let alive = false;

function bindChangeHandlers(editor: TinyEditor) {
  const emitHtml = () => {
    emit("update:modelValue", editor.getContent());
  };
  editor.on("change", emitHtml);
  editor.on("keyup", emitHtml);
  editor.on("Undo", emitHtml);
  editor.on("Redo", emitHtml);
  editor.on("ExecCommand", emitHtml);
}

onMounted(async () => {
  alive = true;
  await loadTinyMCE(tinymceScriptUrl());
  await nextTick();

  const tinymce = window.tinymce;
  const ta = textareaRef.value;
  if (!alive || !tinymce || !ta) return;

  ta.value = props.modelValue ?? "";

  const editors = await tinymce.init({
    target: ta,
    base_url: tinymceRootUrl(),
    suffix: ".min",
    height: 420,
    width: "100%",
    menubar: false,
    branding: true,
    plugins: PLUGINS,
    toolbar: FULL_TOOLBAR,
    readonly: props.readonly,
    placeholder: props.placeholder,
    paste_data_images: true,
    relative_urls: false,
    convert_urls: false,
    browser_spellcheck: true,
    content_style:
      "body { font-family: system-ui,-apple-system,sans-serif; font-size:14px; margin:12px } img { max-width:100%; height:auto }",
    setup: (editor: TinyEditor) => {
      bindChangeHandlers(editor);
    },
  });

  if (!alive) {
    const created = editors[0];
    if (created) tinymce.remove(created);
    return;
  }

  editorInstance = editors[0] ?? null;
});

watch(
  () => props.modelValue,
  (val) => {
    const ed = editorInstance;
    if (!ed) return;
    const next = val ?? "";
    if (next === ed.getContent()) return;
    ed.setContent(next, { format: "html" });
  },
);

watch(
  () => props.readonly,
  (ro) => {
    const ed = editorInstance;
    if (!ed) return;
    setEditorMode(ed, ro);
  },
);

onBeforeUnmount(() => {
  alive = false;
  const tinymce = window.tinymce;
  const ed = editorInstance;
  if (tinymce && ed) {
    tinymce.remove(ed);
  }
  editorInstance = null;
});
</script>

<template>
  <div class="rich-text-editor min-w-0 w-full flex-1">
    <textarea
      ref="textareaRef"
      class="tinymce-textarea-fallback box-border min-h-[220px] w-full rounded border border-neutral-300 p-2 font-mono text-sm"
      rows="12"
    />
  </div>
</template>

<style scoped>
.rich-text-editor :deep(.tox-tinymce) {
  width: 100% !important;
}
</style>
