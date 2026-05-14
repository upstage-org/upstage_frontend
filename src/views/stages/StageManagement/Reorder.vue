<script setup>
import { computed } from "vue";
import Icon from "components/Icon.vue";
import Asset from "components/Asset.vue";
import VideoFirstFrameThumb from "components/media/VideoFirstFrameThumb.vue";

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

const types = computed(() => [...new Set(props.modelValue.map((m) => assetTypeName(m)).filter(Boolean))]);

const mediaGroups = computed(() => {
  const res = {};
  props.modelValue.forEach((item) => {
    const key = assetTypeName(item) || "unknown";
    res[key] = (res[key] ?? []).concat(item);
  });
  return res;
});

const dragstart = (e) => {
  e.target.classList.add("dragging");
  e.dataTransfer.setDragImage(e.target, 0, 0);
  e.dataTransfer.setData("text/plain", e.target.id);
};

const dragend = (e) => {
  e.target.classList.remove("dragging");
};

const dragover = (e) => {
  e.target.classList.add("dropzone");
};

const dragleave = (e) => {
  e.target.classList.remove("dropzone");
};

const drop = (e) => {
  e.target.classList.remove("dropzone");
  const fromId = e.dataTransfer.getData("text/plain");
  const toId = e.target.id;
  const fromIndex = props.modelValue.findIndex((t) => t.id === fromId);
  const toIndex = props.modelValue.findIndex((t) => t.id === toId);
  if (fromIndex > -1 && toIndex > -1) {
    // Clone first; splice() on props.modelValue would mutate the parent's
    // array (vue/no-mutating-props). The new ordering is communicated via
    // update:modelValue below — the parent owns the canonical array.
    const next = props.modelValue.slice();
    const media = next.splice(fromIndex, 1)[0];
    emit(
      "update:modelValue",
      next.slice(0, toIndex).concat(media).concat(next.slice(toIndex)),
    );
  }
};
</script>

<template>
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
              <div v-if="assetType === 'audio'">
                <Icon src="audio.svg" />
                <br />
                <b>{{ item.name }}</b>
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
      transition-duration: 0.25s;
    }
    &:hover {
      img {
        -webkit-filter: drop-shadow(0 0 4px #f5f5f5);
        filter: drop-shadow(0 0 4px #f5f5f5);
      }
    }
  }
  .dropzone {
    background: repeating-radial-gradient(circle, green, green 10px, #007011 10px, #007011 20px);
    > * {
      transform: translateX(50%) !important;
    }
  }
  .dragging {
    opacity: 0.5;
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
