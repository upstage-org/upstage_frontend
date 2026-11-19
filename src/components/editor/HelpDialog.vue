<script setup lang="ts">
/** Keyboard shortcuts of `RichTextEditor`, in place of TinyMCE's Help dialog. */
const emit = defineEmits<{ (e: "cancel"): void }>();

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl";
const alt = isMac ? "⌥" : "Alt";

const SHORTCUTS: Array<[string, string]> = [
  ["Bold", `${mod}+B`],
  ["Italic", `${mod}+I`],
  ["Underline", `${mod}+U`],
  ["Strikethrough", `${mod}+Shift+S`],
  ["Heading 1 … 6", `${mod}+${alt}+1 … 6`],
  ["Paragraph", `${mod}+${alt}+0`],
  ["Bullet list", `${mod}+Shift+8`],
  ["Numbered list", `${mod}+Shift+7`],
  ["Code block", `${mod}+${alt}+C`],
  ["Horizontal line", "--- then Enter"],
  ["Undo / Redo", `${mod}+Z / ${mod}+Shift+Z`],
  ["Select all", `${mod}+A`],
  ["Line break", "Shift+Enter"],
  ["Next / previous table cell", "Tab / Shift+Tab"],
  ["Leave fullscreen or close a dialog", "Esc"],
];
</script>

<template>
  <div class="rich-text-dialog-backdrop" @mousedown.self="emit('cancel')">
    <div
      class="rich-text-dialog rich-text-help"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rich-text-help-title"
      tabindex="-1"
      @keydown.esc.prevent="emit('cancel')"
    >
      <h3 id="rich-text-help-title">Editor help</h3>
      <table>
        <thead>
          <tr>
            <th>Action</th>
            <th>Shortcut</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="[action, keys] in SHORTCUTS" :key="action">
            <td>{{ action }}</td>
            <td>
              <kbd>{{ keys }}</kbd>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="note">
        Images: select one to drag its corner handles, or double-click / right-click it for the
        properties. Text is stored as HTML and may contain any Unicode character; “Edit as HTML”
        shows exactly what is stored.
      </p>
      <div class="actions">
        <button type="button" class="secondary cancel" @click="emit('cancel')">Close</button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.rich-text-help {
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;

    th,
    td {
      padding: 4px 6px;
      border-bottom: 1px solid #eee;
      text-align: left;
    }

    th {
      font-weight: 600;
    }
  }

  kbd {
    padding: 1px 5px;
    border: 1px solid #d9d9d9;
    border-radius: 3px;
    background: #fafafa;
    font-family: ui-monospace, monospace;
    font-size: 12px;
  }

  .note {
    margin: 10px 0 0;
    color: #555;
    font-size: 12px;
  }

  .actions {
    margin-top: 12px;
  }
}
</style>
