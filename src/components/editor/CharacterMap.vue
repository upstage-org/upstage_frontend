<script setup lang="ts">
/**
 * "Special character" picker for `RichTextEditor`: TinyMCE's groups, a search
 * box that matches the character or its name, and a grid of buttons.
 */
import { computed, onMounted, ref } from "vue";
import { SPECIAL_CHARACTERS, charFromCodePoint } from "./specialCharacters";

const emit = defineEmits<{
  (e: "insert", character: string): void;
  (e: "cancel"): void;
}>();

const query = ref("");
const group = ref(SPECIAL_CHARACTERS[0]?.name ?? "");
const searchInput = ref<HTMLInputElement | null>(null);

interface Entry {
  character: string;
  name: string;
  codePoint: number;
}

const toEntry = ([codePoint, name]: [number, string]): Entry => ({
  character: charFromCodePoint(codePoint),
  name,
  codePoint,
});

const shown = computed<Entry[]>(() => {
  const needle = query.value.trim().toLocaleLowerCase();
  if (needle) {
    return SPECIAL_CHARACTERS.flatMap((g) => g.characters.map(toEntry)).filter(
      (entry) =>
        entry.character === needle ||
        entry.name.toLocaleLowerCase().includes(needle) ||
        `u+${entry.codePoint.toString(16)}` === needle,
    );
  }
  const current = SPECIAL_CHARACTERS.find((g) => g.name === group.value);
  return (current?.characters ?? []).map(toEntry);
});

onMounted(() => searchInput.value?.focus());
</script>

<template>
  <div class="rich-text-dialog-backdrop" @mousedown.self="emit('cancel')">
    <div
      class="rich-text-dialog rich-text-charmap"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rich-text-charmap-title"
      @keydown.esc.prevent="emit('cancel')"
    >
      <h3 id="rich-text-charmap-title">Special character</h3>
      <input
        ref="searchInput"
        v-model="query"
        type="search"
        name="search"
        placeholder="Search by name, e.g. “euro” or “dash”"
        aria-label="Search characters"
        autocomplete="off"
      />
      <div v-if="!query.trim()" class="groups" role="tablist">
        <button
          v-for="g in SPECIAL_CHARACTERS"
          :key="g.name"
          type="button"
          role="tab"
          :aria-selected="g.name === group"
          :class="{ active: g.name === group }"
          @click="group = g.name"
        >
          {{ g.name }}
        </button>
      </div>
      <div class="grid" role="listbox" aria-label="Characters">
        <button
          v-for="entry in shown"
          :key="entry.codePoint"
          type="button"
          role="option"
          :title="`${entry.name} (U+${entry.codePoint.toString(16).toUpperCase()})`"
          :data-character="entry.character"
          @click="emit('insert', entry.character)"
        >
          {{ entry.character }}
        </button>
        <p v-if="!shown.length" class="empty">No character matches.</p>
      </div>
      <div class="actions">
        <button type="button" class="secondary cancel" @click="emit('cancel')">Close</button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
// Backdrop and dialog chrome are shared with ImageDialog (global styles below).
.rich-text-charmap {
  max-width: 560px;

  input[type="search"] {
    box-sizing: border-box;
    width: 100%;
    height: 30px;
    margin-bottom: 10px;
    padding: 0 8px;
    border: 1px solid #d9d9d9;
    border-radius: 4px;
    font-size: 14px;
  }

  .groups {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 10px;

    button {
      height: 26px;
      padding: 0 10px;
      border: 1px solid #d9d9d9;
      border-radius: 13px;
      background: #fff;
      color: #000;
      font-size: 12px;

      &.active {
        border-color: #007011;
        background: #e6f4e7;
        color: #007011;
      }
    }
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));
    gap: 4px;
    max-height: 300px;
    overflow-y: auto;
    padding: 2px;

    button {
      height: 36px;
      padding: 0;
      border: 1px solid #e8e8e8;
      border-radius: 4px;
      background: #fff;
      color: #000;
      font-size: 18px;
      line-height: 1;

      &:hover {
        border-color: #007011;
        background: #e6f4e7;
      }
    }

    .empty {
      grid-column: 1 / -1;
      margin: 8px 0;
      color: #555;
      font-size: 13px;
    }
  }

  .actions {
    margin-top: 12px;
  }
}
</style>

<style lang="less">
// Shared by every editor dialog (image, special character, help).
.rich-text-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.45);
}

.rich-text-dialog {
  box-sizing: border-box;
  width: 100%;
  max-width: 460px;
  max-height: 100%;
  overflow-y: auto;
  padding: 16px 20px;
  border-radius: 8px;
  background: #fff;
  color: #000;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  text-align: left;

  h3 {
    margin: 0 0 12px;
    font-size: 16px;
    font-weight: 600;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;

    button {
      height: 30px;
      padding: 0 14px;
      border: 1px solid #007011;
      border-radius: 4px;
      background: #007011;
      color: #fff;
      cursor: pointer;

      &.secondary {
        background: #fff;
        color: #007011;
      }

      &:disabled {
        opacity: 0.5;
        cursor: default;
      }
    }
  }
}
</style>
