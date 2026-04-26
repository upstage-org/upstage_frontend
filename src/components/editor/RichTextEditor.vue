<template>
  <div class="rich-text-editor border rounded">
    <div v-if="!readonly && editor" class="toolbar flex flex-wrap gap-1 p-2 border-b">
      <button
        type="button"
        class="btn-tool"
        :class="{ 'is-active': editor.isActive('bold') }"
        @click="editor.chain().focus().toggleBold().run()"
      >
        <b>B</b>
      </button>
      <button
        type="button"
        class="btn-tool"
        :class="{ 'is-active': editor.isActive('italic') }"
        @click="editor.chain().focus().toggleItalic().run()"
      >
        <i>I</i>
      </button>
      <button
        type="button"
        class="btn-tool"
        :class="{ 'is-active': editor.isActive('strike') }"
        @click="editor.chain().focus().toggleStrike().run()"
      >
        <s>S</s>
      </button>
      <button
        type="button"
        class="btn-tool"
        :class="{ 'is-active': editor.isActive('heading', { level: 2 }) }"
        @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
      >
        H2
      </button>
      <button
        type="button"
        class="btn-tool"
        :class="{ 'is-active': editor.isActive('bulletList') }"
        @click="editor.chain().focus().toggleBulletList().run()"
      >
        &bull; List
      </button>
      <button
        type="button"
        class="btn-tool"
        :class="{ 'is-active': editor.isActive('orderedList') }"
        @click="editor.chain().focus().toggleOrderedList().run()"
      >
        1. List
      </button>
      <button type="button" class="btn-tool" @click="addLink">Link</button>
      <button type="button" class="btn-tool" @click="addImage">Image</button>
      <button type="button" class="btn-tool" @click="editor.chain().focus().undo().run()">
        Undo
      </button>
      <button type="button" class="btn-tool" @click="editor.chain().focus().redo().run()">
        Redo
      </button>
    </div>
    <EditorContent class="prose max-w-none p-2" :editor="editor" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, watch } from "vue";
import { Editor, EditorContent, useEditor } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";

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

const editor = useEditor({
  content: props.modelValue,
  editable: !props.readonly,
  extensions: [
    StarterKit,
    Link.configure({ openOnClick: false }),
    Image,
    Placeholder.configure({ placeholder: props.placeholder }),
  ],
  onUpdate: ({ editor: e }) => {
    emit("update:modelValue", e.getHTML());
  },
});

watch(
  () => props.modelValue,
  (val) => {
    if (!editor.value) return;
    if (val === editor.value.getHTML()) return;
    editor.value.commands.setContent(val ?? "", false);
  },
);

watch(
  () => props.readonly,
  (val) => {
    editor.value?.setEditable(!val);
  },
);

const addLink = () => {
  if (!editor.value) return;
  const url = window.prompt("URL");
  if (url) {
    editor.value.chain().focus().setLink({ href: url }).run();
  }
};

const addImage = () => {
  if (!editor.value) return;
  const url = window.prompt("Image URL");
  if (url) {
    editor.value.chain().focus().setImage({ src: url }).run();
  }
};

onBeforeUnmount(() => {
  editor.value?.destroy();
});
</script>

<style scoped>
.btn-tool {
  padding: 2px 8px;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}
.btn-tool:hover {
  background: #f5f5f5;
}
.btn-tool.is-active {
  background: #007011;
  color: #fff;
  border-color: #007011;
}
</style>
