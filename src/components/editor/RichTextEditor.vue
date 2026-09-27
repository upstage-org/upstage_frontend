<script setup lang="ts">
import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  BgColorsOutlined,
  BoldOutlined,
  ClearOutlined,
  CodeOutlined,
  DeleteColumnOutlined,
  DeleteOutlined,
  DeleteRowOutlined,
  FontColorsOutlined,
  InsertRowBelowOutlined,
  InsertRowRightOutlined,
  ItalicOutlined,
  LineOutlined,
  LinkOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  MenuUnfoldOutlined,
  OrderedListOutlined,
  PictureOutlined,
  RedoOutlined,
  StrikethroughOutlined,
  TableOutlined,
  UnderlineOutlined,
  UndoOutlined,
  UnorderedListOutlined,
  UploadOutlined,
} from "@ant-design/icons-vue";
import { EditorContent, useEditor } from "@tiptap/vue-3";
import Placeholder from "@tiptap/extension-placeholder";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  FONT_FAMILIES,
  FONT_SIZES,
  createExtensions,
  findLostMarkup,
  prepareHtml,
} from "./richText";

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

/** Last value this editor produced itself; the parent echoing it back is not new content. */
let lastEmitted: string | null = null;
/** Bumped on every transaction so the toolbar re-reads the active marks. */
const revision = ref(0);
/** Formatting in the loaded text that the editor cannot keep (see `findLostMarkup`). */
const lostMarkup = ref<string[]>([]);
const sourceMode = ref(false);
const source = ref("");
const fileInput = ref<HTMLInputElement | null>(null);

const publish = (html: string) => {
  lastEmitted = html;
  emit("update:modelValue", html);
};

const insertImageFiles = (files: File[]): boolean => {
  const images = files.filter((file) => file.type.startsWith("image/"));
  if (!images.length) return false;
  for (const file of images) {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      editor.value?.chain().focus().setImage({ src: reader.result, alt: file.name }).run();
    };
    reader.readAsDataURL(file);
  }
  return true;
};

const editor = useEditor({
  extensions: [...createExtensions(), Placeholder.configure({ placeholder: props.placeholder })],
  content: prepareHtml(props.modelValue ?? ""),
  editable: !props.readonly,
  editorProps: {
    attributes: { class: "rich-text-content", spellcheck: "true" },
    handlePaste: (_view, event) => insertImageFiles(Array.from(event.clipboardData?.files ?? [])),
    handleDrop: (_view, event) =>
      insertImageFiles(Array.from((event as DragEvent).dataTransfer?.files ?? [])),
  },
  onCreate: ({ editor: created }) => {
    lostMarkup.value = findLostMarkup(props.modelValue ?? "", created.getHTML());
  },
  onTransaction: () => {
    revision.value += 1;
  },
  // Fires for edits only: loading text never rewrites what is stored.
  onUpdate: ({ editor: updated }) => {
    publish(updated.isEmpty ? "" : updated.getHTML());
  },
});

const load = (html: string) => {
  const instance = editor.value;
  if (!instance) return;
  instance.commands.setContent(prepareHtml(html), { emitUpdate: false });
  lostMarkup.value = findLostMarkup(html, instance.getHTML());
};

watch(
  () => props.modelValue,
  (value) => {
    const next = value ?? "";
    if (next === lastEmitted) return;
    lastEmitted = null;
    if (sourceMode.value) {
      source.value = next;
      return;
    }
    load(next);
  },
);

watch(
  () => props.readonly,
  (readonly) => {
    editor.value?.setEditable(!readonly, false);
    if (readonly) sourceMode.value = false;
  },
);

onBeforeUnmount(() => {
  editor.value?.destroy();
});

const toggleSource = () => {
  if (sourceMode.value) {
    sourceMode.value = false;
    load(source.value);
    return;
  }
  // The stored text as it is, not the editor's rendering of it.
  source.value = props.modelValue ?? "";
  sourceMode.value = true;
};

const onSourceInput = (event: Event) => {
  source.value = (event.target as HTMLTextAreaElement).value;
  publish(source.value);
};

/**
 * A button press must not take the caret out of the text: the editor would
 * refocus a frame later and drop the pending format and the next keystrokes.
 */
const keepCaret = (event: MouseEvent) => {
  if (!(event.target as HTMLElement).closest("select, input, label")) event.preventDefault();
};

const disabled = computed(() => props.readonly || sourceMode.value || !editor.value);

const active = (name: string | Record<string, unknown>, attributes?: Record<string, unknown>) => {
  void revision.value;
  const instance = editor.value;
  if (!instance) return false;
  return typeof name === "string" ? instance.isActive(name, attributes) : instance.isActive(name);
};

const run = () => editor.value!.chain().focus();

const blockFormat = computed(() => {
  void revision.value;
  const instance = editor.value;
  if (!instance) return "paragraph";
  for (let level = 1; level <= 6; level += 1) {
    if (instance.isActive("heading", { level })) return `h${level}`;
  }
  return instance.isActive("codeBlock") ? "pre" : "paragraph";
});

const setBlockFormat = (event: Event) => {
  const value = (event.target as HTMLSelectElement).value;
  if (value === "paragraph") run().setParagraph().run();
  else if (value === "pre") run().setCodeBlock().run();
  else
    run()
      .setHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6 })
      .run();
};

const textStyle = (attribute: "fontFamily" | "fontSize" | "color" | "backgroundColor") => {
  void revision.value;
  return (editor.value?.getAttributes("textStyle")[attribute] as string | undefined) ?? "";
};

const setFontFamily = (event: Event) => {
  const value = (event.target as HTMLSelectElement).value;
  if (value) run().setFontFamily(value).run();
  else run().unsetFontFamily().run();
};

const setFontSize = (event: Event) => {
  const value = (event.target as HTMLSelectElement).value;
  if (value) run().setFontSize(value).run();
  else run().unsetFontSize().run();
};

const setColor = (event: Event) =>
  run()
    .setColor((event.target as HTMLInputElement).value)
    .run();

const setBackgroundColor = (event: Event) =>
  run()
    .setBackgroundColor((event.target as HTMLInputElement).value)
    .run();

const clearFormatting = () => run().unsetAllMarks().clearNodes().unsetTextAlign().run();

const inList = () => active("bulletList") || active("orderedList");

const indent = () => {
  if (inList()) run().sinkListItem("listItem").run();
  else run().indent().run();
};

const outdent = () => {
  if (inList()) run().liftListItem("listItem").run();
  else run().outdent().run();
};

const editLink = () => {
  const current = (editor.value?.getAttributes("link").href as string | undefined) ?? "";
  const href = window.prompt("Link address (leave empty to remove the link)", current);
  if (href === null) return;
  if (!href.trim()) {
    run().extendMarkRange("link").unsetLink().run();
    return;
  }
  run().extendMarkRange("link").setLink({ href: href.trim() }).run();
};

const insertImageFromUrl = () => {
  const src = window.prompt("Image address");
  if (src?.trim()) run().setImage({ src: src.trim() }).run();
};

const onFilesPicked = (event: Event) => {
  const input = event.target as HTMLInputElement;
  insertImageFiles(Array.from(input.files ?? []));
  input.value = "";
};
</script>

<template>
  <div class="rich-text-editor min-w-0 w-full flex-1" :class="{ 'is-readonly': readonly }">
    <div
      class="rich-text-toolbar"
      role="toolbar"
      aria-label="Text formatting"
      @mousedown="keepCaret"
    >
      <span class="group">
        <button type="button" title="Undo" :disabled="disabled" @click="run().undo().run()">
          <UndoOutlined />
        </button>
        <button type="button" title="Redo" :disabled="disabled" @click="run().redo().run()">
          <RedoOutlined />
        </button>
      </span>
      <span class="group">
        <select
          title="Paragraph format"
          :value="blockFormat"
          :disabled="disabled"
          @change="setBlockFormat"
        >
          <option value="paragraph">Paragraph</option>
          <option v-for="level in 6" :key="level" :value="`h${level}`">Heading {{ level }}</option>
          <option value="pre">Preformatted</option>
        </select>
        <select
          title="Font"
          :value="textStyle('fontFamily')"
          :disabled="disabled"
          @change="setFontFamily"
        >
          <option value="">Font</option>
          <option
            v-if="
              textStyle('fontFamily') &&
              !FONT_FAMILIES.some((font) => font.value === textStyle('fontFamily'))
            "
            :value="textStyle('fontFamily')"
          >
            {{ textStyle("fontFamily") }}
          </option>
          <option v-for="font in FONT_FAMILIES" :key="font.value" :value="font.value">
            {{ font.label }}
          </option>
        </select>
        <select
          title="Font size"
          :value="textStyle('fontSize')"
          :disabled="disabled"
          @change="setFontSize"
        >
          <option value="">Size</option>
          <option
            v-if="textStyle('fontSize') && !FONT_SIZES.includes(textStyle('fontSize'))"
            :value="textStyle('fontSize')"
          >
            {{ textStyle("fontSize") }}
          </option>
          <option v-for="size in FONT_SIZES" :key="size" :value="size">{{ size }}</option>
        </select>
      </span>
      <span class="group">
        <button
          type="button"
          title="Bold"
          :class="{ active: active('bold') }"
          :disabled="disabled"
          @click="run().toggleBold().run()"
        >
          <BoldOutlined />
        </button>
        <button
          type="button"
          title="Italic"
          :class="{ active: active('italic') }"
          :disabled="disabled"
          @click="run().toggleItalic().run()"
        >
          <ItalicOutlined />
        </button>
        <button
          type="button"
          title="Underline"
          :class="{ active: active('underline') }"
          :disabled="disabled"
          @click="run().toggleUnderline().run()"
        >
          <UnderlineOutlined />
        </button>
        <button
          type="button"
          title="Strikethrough"
          :class="{ active: active('strike') }"
          :disabled="disabled"
          @click="run().toggleStrike().run()"
        >
          <StrikethroughOutlined />
        </button>
      </span>
      <span class="group">
        <label class="color" title="Text colour" :class="{ disabled }">
          <FontColorsOutlined />
          <input
            type="color"
            :value="textStyle('color') || '#000000'"
            :disabled="disabled"
            @input="setColor"
          />
        </label>
        <label class="color" title="Background colour" :class="{ disabled }">
          <BgColorsOutlined />
          <input
            type="color"
            :value="textStyle('backgroundColor') || '#ffffff'"
            :disabled="disabled"
            @input="setBackgroundColor"
          />
        </label>
      </span>
      <span class="group">
        <button
          type="button"
          title="Align left"
          :class="{ active: active({ textAlign: 'left' }) }"
          :disabled="disabled"
          @click="run().setTextAlign('left').run()"
        >
          <AlignLeftOutlined />
        </button>
        <button
          type="button"
          title="Align centre"
          :class="{ active: active({ textAlign: 'center' }) }"
          :disabled="disabled"
          @click="run().setTextAlign('center').run()"
        >
          <AlignCenterOutlined />
        </button>
        <button
          type="button"
          title="Align right"
          :class="{ active: active({ textAlign: 'right' }) }"
          :disabled="disabled"
          @click="run().setTextAlign('right').run()"
        >
          <AlignRightOutlined />
        </button>
        <button
          type="button"
          title="Justify"
          :class="{ active: active({ textAlign: 'justify' }) }"
          :disabled="disabled"
          @click="run().setTextAlign('justify').run()"
        >
          <MenuOutlined />
        </button>
      </span>
      <span class="group">
        <button
          type="button"
          title="Bullet list"
          :class="{ active: active('bulletList') }"
          :disabled="disabled"
          @click="run().toggleBulletList().run()"
        >
          <UnorderedListOutlined />
        </button>
        <button
          type="button"
          title="Numbered list"
          :class="{ active: active('orderedList') }"
          :disabled="disabled"
          @click="run().toggleOrderedList().run()"
        >
          <OrderedListOutlined />
        </button>
        <button type="button" title="Decrease indent" :disabled="disabled" @click="outdent">
          <MenuFoldOutlined />
        </button>
        <button type="button" title="Increase indent" :disabled="disabled" @click="indent">
          <MenuUnfoldOutlined />
        </button>
      </span>
      <span class="group">
        <button
          type="button"
          title="Clear formatting"
          :disabled="disabled"
          @click="clearFormatting"
        >
          <ClearOutlined />
        </button>
      </span>
      <span class="group">
        <button
          type="button"
          title="Link"
          :class="{ active: active('link') }"
          :disabled="disabled"
          @click="editLink"
        >
          <LinkOutlined />
        </button>
        <button
          type="button"
          title="Insert table"
          :disabled="disabled"
          @click="run().insertTable({ rows: 3, cols: 3, withHeaderRow: false }).run()"
        >
          <TableOutlined />
        </button>
        <button
          type="button"
          title="Insert image from address"
          :disabled="disabled"
          @click="insertImageFromUrl"
        >
          <PictureOutlined />
        </button>
        <button
          type="button"
          title="Insert image from file"
          :disabled="disabled"
          @click="fileInput?.click()"
        >
          <UploadOutlined />
        </button>
        <button
          type="button"
          title="Horizontal line"
          :disabled="disabled"
          @click="run().setHorizontalRule().run()"
        >
          <LineOutlined />
        </button>
      </span>
      <span v-if="active('table')" class="group">
        <button
          type="button"
          title="Add row below"
          :disabled="disabled"
          @click="run().addRowAfter().run()"
        >
          <InsertRowBelowOutlined />
        </button>
        <button
          type="button"
          title="Add column to the right"
          :disabled="disabled"
          @click="run().addColumnAfter().run()"
        >
          <InsertRowRightOutlined />
        </button>
        <button
          type="button"
          title="Delete row"
          :disabled="disabled"
          @click="run().deleteRow().run()"
        >
          <DeleteRowOutlined />
        </button>
        <button
          type="button"
          title="Delete column"
          :disabled="disabled"
          @click="run().deleteColumn().run()"
        >
          <DeleteColumnOutlined />
        </button>
        <button
          type="button"
          title="Delete table"
          :disabled="disabled"
          @click="run().deleteTable().run()"
        >
          <DeleteOutlined />
        </button>
      </span>
      <span class="group">
        <button
          type="button"
          title="Edit as HTML"
          :class="{ active: sourceMode }"
          :disabled="readonly || !editor"
          @click="toggleSource"
        >
          <CodeOutlined />
        </button>
      </span>
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        @change="onFilesPicked"
      />
    </div>
    <p v-if="lostMarkup.length && !readonly && !sourceMode" class="rich-text-warning" role="status">
      This text has formatting the editor cannot keep ({{ lostMarkup.join(", ") }}). It stays as
      long as you change nothing here, and is dropped when you save a change. Use “Edit as HTML” to
      change the text and keep it.
    </p>
    <textarea
      v-if="sourceMode"
      class="rich-text-source"
      :value="source"
      spellcheck="false"
      aria-label="HTML source"
      @input="onSourceInput"
    />
    <EditorContent v-else :editor="editor" class="rich-text-body" />
  </div>
</template>

<style scoped lang="less">
.rich-text-editor {
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  background: #fff;
  color: #000;
  text-align: left;
}

.rich-text-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  padding: 6px 8px;
  border-bottom: 1px solid #d9d9d9;
  background: #fafafa;
  border-radius: 6px 6px 0 0;

  .group {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  button,
  .color {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    height: 28px;
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    cursor: pointer;

    &:hover:not(:disabled):not(.disabled) {
      background: #e6f4e7;
    }

    &.active {
      border-color: #007011;
      color: #007011;
      background: #e6f4e7;
    }

    &:disabled,
    &.disabled {
      cursor: default;
      opacity: 0.4;
    }
  }

  .color {
    position: relative;

    input {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      padding: 0;
      border: 0;
      opacity: 0;
      cursor: inherit;
    }
  }

  select {
    height: 28px;
    max-width: 130px;
    padding: 0 4px;
    border: 1px solid #d9d9d9;
    border-radius: 4px;
    background: #fff;

    &:disabled {
      opacity: 0.4;
    }
  }
}

.rich-text-warning {
  margin: 0;
  padding: 6px 10px;
  border-bottom: 1px solid #ffe58f;
  background: #fffbe6;
  font-size: 12px;
}

.rich-text-source {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-height: 220px;
  padding: 12px;
  border: 0;
  border-radius: 0 0 6px 6px;
  font-family: ui-monospace, monospace;
  font-size: 13px;
  resize: vertical;
}

.rich-text-body {
  max-height: 420px;
  overflow-y: auto;
}

// Tailwind preflight resets headings, lists and tables; give the text the
// look it has where it is shown (foyer, e-mail clients).
.rich-text-body :deep(.rich-text-content) {
  min-height: 220px;
  padding: 12px;
  outline: none;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
  font-size: 14px;
  line-height: 1.5;

  p,
  h1,
  h2,
  h3,
  h4,
  h5,
  h6,
  ul,
  ol,
  pre,
  blockquote,
  table {
    margin: 0 0 0.6em;
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    font-weight: 600;
    line-height: 1.25;
  }

  h1 {
    font-size: 2em;
  }

  h2 {
    font-size: 1.5em;
  }

  h3 {
    font-size: 1.17em;
  }

  h4 {
    font-size: 1em;
  }

  h5 {
    font-size: 0.83em;
  }

  h6 {
    font-size: 0.67em;
  }

  ul,
  ol {
    padding-left: 1.6em;
  }

  ul {
    list-style: disc;
  }

  ol {
    list-style: decimal;
  }

  li > p {
    margin: 0;
  }

  a {
    color: #007011;
    text-decoration: underline;
  }

  blockquote {
    padding-left: 1em;
    border-left: 3px solid #d9d9d9;
  }

  pre {
    padding: 8px 10px;
    border-radius: 4px;
    background: #f5f5f5;
    font-family: ui-monospace, monospace;
    white-space: pre-wrap;
  }

  hr {
    margin: 1em 0;
    border: 0;
    border-top: 1px solid #bfbfbf;
  }

  img {
    display: inline-block;
    max-width: 100%;
    height: auto;

    &.ProseMirror-selectednode {
      outline: 2px solid #007011;
    }
  }

  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;

    td,
    th {
      position: relative;
      padding: 4px 8px;
      border: 1px solid #bfbfbf;
      vertical-align: top;

      > p {
        margin: 0;
      }
    }

    th {
      background: #f5f5f5;
      font-weight: 600;
    }

    .selectedCell {
      background: #e6f4e7;
    }
  }

  p.is-editor-empty:first-child::before {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    color: #bfbfbf;
    pointer-events: none;
  }
}
</style>
