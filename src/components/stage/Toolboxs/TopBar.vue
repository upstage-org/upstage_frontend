<script>
/*
 * Top tool panel that opens when a player clicks an icon in the left
 * #toolbox strip. As of this change the panel is:
 *
 *   * Draggable via a small drag-handle in a new header strip. Position
 *     is stored in the Pinia stage store (`topbarPosition`) so it
 *     survives switching between tools within a single stage session,
 *     and is wiped by CLEAN_STAGE on stage re-entry. No persistence to
 *     localStorage / server / MQTT - matches Vicki's "default at each
 *     stage re-entry" expectation and keeps every player's layout local
 *     to their own browser tab.
 *
 *   * Collapsible via a chevron in the header. Collapsed = only the
 *     header strip is shown; expanding restores the same tool because
 *     the injected `tool` ref is untouched.
 *
 *   * Resettable (header `reset` button) - clears `topbarPosition` and
 *     `topbarCollapsed` so the panel snaps back to the centred default.
 *
 *   * Closable (header `X`) - calls injected `changeTool(null)` which
 *     un-toggles the active tool icon in the left strip (same effect
 *     as clicking the active tool icon again).
 *
 * The audience never sees this; it only mounts behind `canPlay` in
 * [views/live/Layout.vue].
 */
import { computed, inject, onUnmounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { useStageStore } from "@stores/pinia/stage";
import { useDraggablePanel } from "composables/index";
import Icon from "components/Icon.vue";
import Avatars from "./tools/Avatars.vue";
import Backdrops from "./tools/Backdrops.vue";
import Props from "./tools/Props.vue";
// Aliased: "Audio" and "Text" are reserved HTML element names
// (vue/no-reserved-component-names). The companion <PanelItem name="..."> in
// stage/Toolboxs/index.vue is updated to "AudioTool"/"TextTool" so the
// dynamic <component :is="tool"> lookup still resolves.
import AudioTool from "./tools/Audio.vue";
import Draw from "./tools/Draw/index.vue";
import Whiteboard from "./tools/WhiteboardTools.vue";
import Streams from "./tools/Streams/index.vue";
import Meeting from "./tools/Meeting/index.vue";
import TextTool from "./tools/TextTool.vue";
import Settings from "./tools/Settings.vue";
import Depth from "./tools/Depth.vue";
import Curtain from "./tools/CurtainTool.vue";
import Scenes from "./tools/Scenes/index.vue";

export default {
  components: {
    Icon,
    Avatars,
    Backdrops,
    Props,
    AudioTool,
    Draw,
    Streams,
    Meeting,
    TextTool,
    Settings,
    Depth,
    Curtain,
    Scenes,
    Whiteboard,
  },
  props: { tool: String },
  setup(props) {
    const bar = ref();
    const panel = ref();
    const stageStore = useStageStore();
    const changeTool = inject("changeTool");

    const horizontalScroll = (e) => {
      bar.value.scrollLeft += e.deltaY * 10;
      bar.value.scrollLeft += e.deltaX;
    };

    const compact = ref(false);

    const toggleCompact = (e) => {
      if (!e) e = window.event;
      if (e.shiftKey) {
        compact.value = true;
      } else {
        compact.value = false;
      }
    };
    window.addEventListener("keydown", toggleCompact);
    window.addEventListener("keyup", toggleCompact);

    onUnmounted(() => {
      window.removeEventListener("keydown", toggleCompact);
      window.removeEventListener("keyup", toggleCompact);
    });

    const { topbarPosition: position, topbarCollapsed: collapsed } = storeToRefs(stageStore);

    const { startDrag } = useDraggablePanel({
      panelEl: panel,
      setPosition: (pos) => stageStore.setTopbarPosition(pos),
    });

    const toggleCollapsed = () => stageStore.setTopbarCollapsed(!collapsed.value);
    const resetLayout = () => {
      stageStore.setTopbarPosition(null);
      stageStore.setTopbarCollapsed(false);
    };
    const closePanel = () => {
      if (typeof changeTool === "function") changeTool(null);
    };

    /** Header title mirrors the toolbox icon labels (#toolbox PanelItem labels). */
    const toolPanelTitles = {
      Streams: "Video",
      AudioTool: "Audio",
      TextTool: "Text",
      Meeting: "Streams",
      Backdrops: "Backdrops",
      Avatars: "Avatars",
      Props: "Props",
      Whiteboard: "Live drawing",
      Draw: "Object drawing",
      Depth: "Depth",
      Curtain: "Curtain",
      Scenes: "Scenes",
      Settings: "Settings",
    };
    const panelTitle = computed(() => {
      const key = props.tool;
      const t = key ? toolPanelTitles[key] : undefined;
      return t ?? props.tool ?? "";
    });

    // When a position has been set we drop the default centred CSS
    // (top: safe inset; left/right: 0; margin: auto) by forcing
    // `right: auto; margin: 0`. The :style binding then takes over.
    const dynamicStyle = computed(() => {
      if (!position.value) return {};
      return {
        left: `${position.value.x}px`,
        top: `${position.value.y}px`,
        right: "auto",
        margin: 0,
      };
    });

    return {
      horizontalScroll,
      bar,
      panel,
      compact,
      position,
      collapsed,
      panelTitle,
      dynamicStyle,
      startDrag,
      toggleCollapsed,
      resetLayout,
      closePanel,
    };
  },
};
</script>

<template>
  <div
    v-if="tool"
    id="topbar"
    ref="panel"
    class="card is-light"
    :class="{ 'is-positioned': position, 'is-collapsed': collapsed }"
    :style="dynamicStyle"
  >
    <!--
      Header strip with the four drag / collapse / reset / close
      buttons. Always rendered (even when collapsed) so the player
      can still drag a collapsed panel and re-expand it.
    -->
    <div class="topbar-header">
      <a-tooltip :title="$t('drag_panel') || 'Drag panel'">
        <button
          type="button"
          class="topbar-btn drag-handle"
          @mousedown.prevent="startDrag"
          @touchstart.prevent="startDrag"
        >
          <Icon src="movement-slider.svg" size="16" />
        </button>
      </a-tooltip>
      <span class="topbar-title">{{ panelTitle }}</span>
      <div class="topbar-actions">
        <a-tooltip
          :title="
            collapsed
              ? $t('expand_panel') || 'Expand panel'
              : $t('collapse_panel') || 'Collapse panel'
          "
        >
          <button type="button" class="topbar-btn" @click="toggleCollapsed">
            <Icon :src="collapsed ? 'maximise.svg' : 'minimise.svg'" size="16" />
          </button>
        </a-tooltip>
        <a-tooltip :title="$t('reset_panel_position') || 'Reset position'">
          <button type="button" class="topbar-btn" @click="resetLayout">
            <Icon src="refresh.svg" size="14" />
          </button>
        </a-tooltip>
        <a-tooltip :title="$t('close_panel') || 'Close panel'">
          <button type="button" class="topbar-btn topbar-close" @click="closePanel">
            <Icon src="close.svg" size="14" />
          </button>
        </a-tooltip>
      </div>
    </div>
    <div
      v-show="!collapsed"
      :id="tool + 'tool'"
      ref="bar"
      class="card-content"
      :class="{ 'is-compact': compact }"
      @wheel="horizontalScroll"
    >
      <!-- Keep the Meeting panel UI alive while switching toolbox tabs.
           Local WebRTC tracks are owned by useLocalStreamPublisher() in
           Shell.vue (session-scoped, providered alongside `jitsi` so
           Yourself.vue can inject it), not by this panel — so closing
           the topbar or switching to Audio/Props does not dispose camera
           tracks while jitsi tiles remain on the board. -->
      <keep-alive include="Meeting">
        <component :is="tool" />
      </keep-alive>
    </div>
  </div>
</template>

<style lang="scss">
#topbar {
  display: flex;
  flex-direction: column;
  position: fixed;
  max-width: 80vw;
  max-height: calc(100vh - 16px);
  height: auto;
  /* Keep the whole panel (header + controls) inside the viewport — a negative
     top was clipping tool headers and breaking slider hit targets. */
  top: max(8px, env(safe-area-inset-top, 0px));
  left: 0;
  right: 0;
  margin: auto;
  text-align: center;
  width: fit-content;
  overflow-x: auto;
  overflow-y: auto;
  z-index: 5;

  /* Dragged panels use explicit left/top via :style (margin: 0). */
  &.is-positioned {
    margin: 0;
  }

  &.is-collapsed {
    height: auto;
    overflow: visible;
  }

  .topbar-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background-color: #ececec;
    border-bottom: 1px solid #d0d0d0;
    user-select: none;
    /* Ensure the header always stays above the inner card-content
       horizontal scroller and any tool's own content. */
    position: relative;
    z-index: 1;
  }

  .topbar-title {
    flex: 1 1 auto;
    font-size: 12px;
    font-weight: 600;
    color: #444;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .topbar-actions {
    display: flex;
    gap: 2px;
  }

  .topbar-btn {
    background: transparent;
    border: none;
    padding: 2px 4px;
    cursor: pointer;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;

    &:hover {
      background-color: rgba(0, 0, 0, 0.08);
    }
  }

  .drag-handle {
    cursor: grab;
    &:active {
      cursor: grabbing;
    }
  }

  .card-content {
    display: flex;
    padding: 0;
    padding-top: 12px;
    min-height: min-content;
    white-space: nowrap;

    &.is-compact {
      width: 100%;
    }

    /* When a tool only has a single thumbnail (e.g. one audio clip) the
       panel's `width: fit-content` is driven by the wider header strip,
       leaving the lone tile flush-left. `margin: 0 auto` on a single
       flex-row child distributes the slack on both sides and centres
       it; the rule self-disables as soon as a second tile arrives. */
    > div:only-child {
      margin: 0 auto;
    }

    > div {
      position: relative;
      width: 100px;
      height: 100px;
      min-width: 100px;
      min-height: 100px;
      max-height: 100px;
      flex-shrink: 0;
      overflow: hidden;
      background: #f5f5f5;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      border-radius: 8px;

      .skeleton {
        flex: 1 1 0;
        min-width: 0;
        min-height: 0;
        width: 100%;
        max-height: 100%;
        align-self: stretch;
      }

      > div {
        padding: 12px;
      }

      &:first-child {
        float: left;
      }

      .tag {
        height: 1.5em;
        padding: 0;
        box-shadow: none;
      }

      &:hover {
        cursor: pointer;
      }

      /* Hover affordance only where hover is real: on touch screens :hover
         sticks to the last-tapped tile, which made the erase toggle's state
         unreadable (hover and .active looked identical). */
      @media (hover: hover) {
        &:hover {
          filter: brightness(1.2);
          background-color: lightgray;
          img {
            -webkit-filter: drop-shadow(5px 5px 5px #f5f5f5);
            filter: drop-shadow(5px 5px 5px #f5f5f5);
          }
          .tag {
            background-color: transparent;
          }
        }
      }

      /* Selected/toggled tiles (erase mode, current backdrop/curtain, text
         bold/italic/underline) must read differently from hover on every
         input type. Inset outline: no layout shift, visible over thumbnails. */
      &.active {
        background-color: #d8d8d8;
        outline: 3px solid #007011;
        outline-offset: -3px;
        .tag {
          background-color: transparent;
        }
      }
    }

    /* The Text tool's control tiles host pop-out UI (font dropdown menu,
       colour picker) that must escape the 100px tile box; the generic
       `overflow: hidden` above (needed to crop media thumbnails) was
       clipping the font dropdown so it looked dead. Control tiles have
       no thumbnail to crop, so visible overflow is safe here. */
    > div.text-tool {
      overflow: visible;
    }
  }
}
</style>
