<script setup>
import { computed } from "vue";
import Icon from "components/Icon.vue";
import Asset from "components/Asset.vue";
import VideoFirstFrameThumb from "@components/media/VideoFirstFrameThumb.vue";

const props = defineProps({
  modelValue: {
    type: Array,
    required: true,
  },
});

const emit = defineEmits(["update:modelValue"]);

/** GraphQL returns `assetType: { name }`; older code may still use a string. */
function assetTypeName(media) {
  const t = media?.assetType;
  if (t && typeof t === "object") return t.name ?? "";
  return t ?? "";
}

// Fixed row order for the type groups. Deriving it from first appearance in
// the flat list made whole rows jump around after a drag (moving an item can
// change which type appears first in the flat array).
const TYPE_ROW_ORDER = ["avatar", "prop", "backdrop", "curtain", "audio", "video", "stream"];

const types = computed(() => {
  const present = [...new Set(props.modelValue.map((m) => assetTypeName(m)).filter(Boolean))];
  return present.sort((a, b) => {
    const ia = TYPE_ROW_ORDER.indexOf(a);
    const ib = TYPE_ROW_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
});

const mediaGroups = computed(() => {
  const res = {};
  props.modelValue.forEach((item) => {
    const key = assetTypeName(item) || "unknown";
    res[key] = (res[key] ?? []).concat(item);
  });
  return res;
});

// Asset type of the tile being dragged; drops are only valid within the same
// type group (each on-stage tool bar orders one type — a cross-type drop would
// silently interleave the flat list without any visible effect in the grid).
let draggedType = null;

const typeOfTileId = (id) =>
  assetTypeName(props.modelValue.find((t) => String(t.id) === String(id)));

const dragstart = (e) => {
  e.target.classList.add("dragging");
  draggedType = typeOfTileId(e.target.id);
  e.dataTransfer.setDragImage(e.target, 0, 0);
  e.dataTransfer.setData("text/plain", e.target.id);
};

const clearDragMarkers = (root) => {
  root
    ?.closest(".reorder-grid")
    ?.querySelectorAll(".dropzone, .dragging")
    .forEach((el) => el.classList.remove("dropzone", "dragging"));
};

const dragend = (e) => {
  draggedType = null;
  e.target.classList.remove("dragging");
  // dragleave is unreliable when a drag is cancelled or dropped outside a
  // tile; sweep any leftover markers so no tile stays highlighted.
  clearDragMarkers(e.target);
};

const dragover = (e) => {
  if (draggedType && typeOfTileId(e.target.id) === draggedType) {
    e.target.classList.add("dropzone");
  }
};

const dragleave = (e) => {
  e.target.classList.remove("dropzone");
};

const drop = (e) => {
  e.target.classList.remove("dropzone");
  const fromId = e.dataTransfer.getData("text/plain");
  const toId = e.target.id;
  // DOM ids are always strings; media ids may arrive as numbers.
  const fromIndex = props.modelValue.findIndex((t) => String(t.id) === fromId);
  const toIndex = props.modelValue.findIndex((t) => String(t.id) === toId);
  if (
    fromIndex > -1 &&
    toIndex > -1 &&
    assetTypeName(props.modelValue[fromIndex]) === assetTypeName(props.modelValue[toIndex])
  ) {
    // Clone first; splice() on props.modelValue would mutate the parent's
    // array (vue/no-mutating-props). The new ordering is communicated via
    // update:modelValue below — the parent owns the canonical array.
    const next = props.modelValue.slice();
    const media = next.splice(fromIndex, 1)[0];
    emit("update:modelValue", next.slice(0, toIndex).concat(media).concat(next.slice(toIndex)));
  }
};
</script>

<template>
  <div class="reorder-grid">
    <div v-for="assetType in types" :key="assetType" class="columns is-vcentered is-mobile">
      <div class="column is-narrow has-text-left media-type-label-col">
        <h4 class="subtitle">
          <Icon :src="assetType + '.svg'" style="height: 20px; width: 20px" />
          <span class="type-caption">{{ assetType }} ({{ mediaGroups[assetType]?.length }})</span>
        </h4>
      </div>
      <div class="column">
        <div class="toolbox">
          <div class="scroller">
            <div
              v-for="item in mediaGroups[assetType]"
              :id="item.id"
              :key="item.id"
              class="media-preview"
              draggable="true"
              @dragstart="dragstart"
              @dragend="dragend"
              @dragenter.prevent
              @dragover.prevent="dragover"
              @dragleave.prevent="dragleave"
              @drop.prevent="drop"
            >
              <div style="pointer-events: none">
                <!-- Audio and RTMP streams have no meaningful thumbnail: show
                   just the name, centred (an icon only misaligns tiles, and
                   a stream's fileLocation is a bare key — not an image). -->
                <div v-if="assetType === 'audio' || assetType === 'stream'" class="name-only-cell">
                  <b class="name-only-label">{{ item.name }}</b>
                </div>
                <div v-else-if="assetType === 'video'" class="video-reorder-cell">
                  <div class="video-reorder-thumb">
                    <VideoFirstFrameThumb :media="item" />
                  </div>
                  <b class="video-reorder-name">{{ item.name }}</b>
                </div>
                <Asset v-else :asset="item" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.media-type-label-col {
  /* was Bulma `is-1` (~8%); too narrow → mid-word wraps. */
  flex: none;
  min-width: 11rem;

  &.column {
    width: auto;
  }
}

.subtitle {
  text-transform: capitalize;
  margin-bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
}

.type-caption {
  display: block;
  font-size: 0.925em;
  line-height: 1.25;
  white-space: nowrap;
}

.toolbox {
  background-color: #fdedf6;
  border-radius: 8px;
  width: 100%;
  max-width: max-content;
  overflow-x: auto;
  margin-bottom: 6px;
  .scroller {
    width: max-content;
    cursor: grab;
  }
  .media-preview {
    float: left;
    width: 100px;
    height: 100px;
    padding: 8px;
    overflow: hidden;

    > div {
      width: 100%;
      height: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    &:hover {
      img {
        -webkit-filter: drop-shadow(0 0 4px #f5f5f5);
        filter: drop-shadow(0 0 4px #f5f5f5);
      }
    }
  }
  // Drop-target cue: a quiet inset outline. (The previous radial-gradient +
  // translateX(50%) treatment made the target tile look like a rendering
  // glitch mid-drag.)
  .dropzone {
    background: #d9f2df;
    box-shadow: inset 0 0 0 3px #007011;
    border-radius: 8px;
  }
  .dragging {
    opacity: 0.5;
  }

  .name-only-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    text-align: center;
  }

  .name-only-label {
    font-size: 12px;
    line-height: 1.2;
    word-break: break-word;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    line-clamp: 4;
    -webkit-line-clamp: 4;
    overflow: hidden;
  }

  .video-reorder-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    width: 100%;
    height: 100%;
    gap: 4px;
    text-align: center;
  }

  .video-reorder-thumb {
    flex: 1 1 auto;
    width: 100%;
    min-height: 0;
    max-height: 58px;
    border-radius: 4px;
    overflow: hidden;
    background: #1a1a1a;
  }

  .video-reorder-name {
    flex: 0 0 auto;
    font-size: 11px;
    line-height: 1.15;
    word-break: break-word;
    max-height: 2.6em;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    line-clamp: 2;
    -webkit-line-clamp: 2;
  }
}
</style>
