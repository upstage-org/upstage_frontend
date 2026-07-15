<script>
import { computed } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import Icon from "components/Icon.vue";
import { isIOS, isJitsiBoardType } from "utils/common";
import {
  FRAME_FITS,
  FRAME_SHAPES,
  effectiveFrameFitId,
  effectiveFrameShapeId,
} from "./frameShapes";

/**
 * The ONE context menu for live stream tiles — individual jitsi streams and
 * RTMP feeds share it, so both kinds of tile behave identically on stage:
 *
 *   Shape · Mute locally · Volume setting · Bring forward / Send back ·
 *   Slider (opacity + move speed) · Flip · Remove
 *
 * Mute and volume are LOCAL to this browser (stage store `_streamLocalAudio`,
 * never broadcast): several performers in one physical room each silence
 * their own playback without turning the stream off for the audience.
 * Everything else (shape, flip, depth, opacity, speed) rides the normal
 * shapeObject broadcast. A live tile has no timeline, so none of the video
 * transport controls (play/pause/restart/loop) appear here.
 */
export default {
  components: { Icon },
  props: {
    object: Object,
    closeMenu: Function,
    sliderMode: String,
    setSliderMode: Function,
    keepActive: Function,
  },
  setup: (props) => {
    const stageStore = useStageStore();

    // `shapeObject`, `bringToFront`, `sendToBack`, `deleteObject` and
    // `openSettingPopup` are synchronous (the MQTT publish isn't awaited),
    // so the `closeMenu` continuations run inline.

    const activeShapeId = computed(() =>
      effectiveFrameShapeId(
        props.object.shape,
        isJitsiBoardType(props.object.type) ? "jitsi" : "rtmp",
      ),
    );
    // Menu stays open so several shapes can be tried in place.
    const setFrameShape = (shape) => {
      stageStore.shapeObject({
        ...props.object,
        shape,
      });
    };

    // Stretch (fill, the historical default) vs crop (cover) when the frame
    // is resized. Pure CSS on the wrapper (--stream-fit) — the <video> and
    // its audio pipeline are never touched. Menu stays open for A/B checks.
    const activeFitId = computed(() => effectiveFrameFitId(props.object.fit));
    const setFrameFit = (fit) => {
      stageStore.shapeObject({
        ...props.object,
        fit,
      });
    };

    const localMuted = computed(() => stageStore.streamLocalMuted(props.object.id));
    // Menu stays open: muting is often an A/B check, same as trying shapes.
    const toggleMuted = () => {
      stageStore.toggleStreamLocalMuted(props.object.id);
    };

    // iOS / iPadOS: HTMLMediaElement.volume is read-only, so a per-stream
    // volume control would silently do nothing. Hide it there (the `muted`
    // property still works, so Mute locally stays).
    const supportsPerStreamVolume = !isIOS();
    const openVolumePopup = () => {
      stageStore.openSettingPopup({
        type: "VolumeParameters",
      });
      props.closeMenu();
    };

    const bringToFront = () => {
      stageStore.bringToFront(props.object);
      props.closeMenu();
    };

    const sendToBack = () => {
      stageStore.sendToBack(props.object);
      props.closeMenu();
    };

    const changeSliderMode = (mode) => {
      props.setSliderMode(mode);
      props.keepActive(true);
    };

    const flipHorizontal = () => {
      const scaleX = -1 * (props.object.scaleX ?? 1);
      stageStore.shapeObject({
        ...props.object,
        scaleX,
      });
    };

    const flipVertical = () => {
      const scaleY = -1 * (props.object.scaleY ?? 1);
      stageStore.shapeObject({
        ...props.object,
        scaleY,
      });
    };

    const deleteObject = () => {
      stageStore.deleteObject(props.object);
      props.closeMenu();
    };

    return {
      FRAME_SHAPES,
      activeShapeId,
      setFrameShape,
      FRAME_FITS,
      activeFitId,
      setFrameFit,
      localMuted,
      toggleMuted,
      supportsPerStreamVolume,
      openVolumePopup,
      bringToFront,
      sendToBack,
      changeSliderMode,
      flipHorizontal,
      flipVertical,
      deleteObject,
    };
  },
};
</script>

<template>
  <div class="stream-context-menu card-content p-0">
    <div class="field has-addons menu-group shape-group">
      <p class="control menu-group-title">
        <span>{{ $t("shape") }}</span>
      </p>
      <p v-for="s in FRAME_SHAPES" :key="s.id" class="control menu-group-item">
        <a-tooltip :title="s.title" placement="bottom">
          <button
            class="button is-light"
            :class="{ 'has-background-primary-light': activeShapeId === s.id }"
            :data-testid="`shape-${s.id}`"
            @click="setFrameShape(s.id)"
          >
            <!-- The swatch IS the shape: the registry's border-radius /
                 clip-path applied to a small solid span. -->
            <span class="shape-swatch" :style="s.swatchStyle ?? s.style"></span>
          </button>
        </a-tooltip>
      </p>
    </div>
    <div class="field has-addons menu-group">
      <p class="control menu-group-title">
        <span>{{ $t("resize") }}</span>
      </p>
      <p v-for="f in FRAME_FITS" :key="f.id" class="control menu-group-item">
        <a-tooltip :title="f.title" placement="bottom">
          <button
            class="button is-light"
            :class="{ 'has-background-primary-light': activeFitId === f.id }"
            :data-testid="`fit-${f.id}`"
            @click="setFrameFit(f.id)"
          >
            <span class="mt-1">{{ $t(f.labelKey) }}</span>
          </button>
        </a-tooltip>
      </p>
    </div>
    <a class="panel-block" data-testid="stream-mute-locally" @click="toggleMuted">
      <span class="panel-icon">
        <i v-if="localMuted" class="fas fa-volume-mute has-text-danger"></i>
        <i v-else class="fas fa-volume-up has-text-primary"></i>
      </span>
      <span>{{ localMuted ? $t("unmute_locally") : $t("mute_locally") }}</span>
    </a>
    <a v-if="supportsPerStreamVolume" class="panel-block" @click="openVolumePopup">
      <span class="panel-icon">
        <Icon src="voice-setting.svg" />
      </span>
      <span>{{ $t("volumn_setting") }}</span>
    </a>
    <a class="panel-block" @click="bringToFront">
      <span class="panel-icon">
        <Icon src="bring-to-front.svg" />
      </span>
      <span>{{ $t("bring_forward") }}</span>
    </a>
    <a class="panel-block" @click="sendToBack">
      <span class="panel-icon">
        <Icon src="send-to-back.svg" />
      </span>
      <span>{{ $t("send_back") }}</span>
    </a>
    <div class="field has-addons menu-group">
      <p class="control menu-group-title">
        <span class="panel-icon pt-1">
          <Icon src="rotation-slider.svg" />
        </span>
        <span>{{ $t("slider") }}</span>
      </p>
      <p class="control menu-group-item">
        <a-tooltip title="Opacity slider" placement="bottom">
          <button
            class="button is-light"
            :class="{
              'has-background-primary-light': sliderMode === 'opacity',
            }"
            @click="changeSliderMode('opacity')"
          >
            <span class="mt-1">
              <Icon src="opacity-slider.svg" style="width: 16px; height: 16px" />
            </span>
          </button>
        </a-tooltip>
      </p>
      <p class="control menu-group-item">
        <a-tooltip title="Move speed" placement="bottom">
          <button
            class="button is-light"
            :class="{
              'has-background-danger-light': sliderMode === 'speed',
            }"
            @click="changeSliderMode('speed')"
          >
            <span class="mt-1">
              <Icon src="movement-slider.svg" style="width: 16px; height: 16px" />
            </span>
          </button>
        </a-tooltip>
      </p>
    </div>
    <div class="field has-addons menu-group">
      <p class="control menu-group-title">
        <span class="panel-icon pt-1">
          <Icon src="rotation-slider.svg" />
        </span>
        <span>{{ $t("flip") }}</span>
      </p>
      <p class="control menu-group-item">
        <a-tooltip title="Flip Horizontal" placement="bottom">
          <button
            class="button is-light"
            :class="{
              'has-background-primary-light': object.scaleX === -1,
            }"
            @click="flipHorizontal"
          >
            <span class="mt-1">{{ $t("horizontal") }}</span>
          </button>
        </a-tooltip>
      </p>
      <p class="control menu-group-item">
        <a-tooltip title="Flip Vertical" placement="bottom">
          <button
            class="button is-light"
            :class="{
              'has-background-primary-light': object.scaleY === -1,
            }"
            @click="flipVertical"
          >
            <span class="mt-1">{{ $t("vertical") }}</span>
          </button>
        </a-tooltip>
      </p>
    </div>
    <a class="panel-block has-text-danger" @click="deleteObject">
      <span class="panel-icon">
        <Icon src="remove.svg" />
      </span>
      <span>{{ $t("remove") }}</span>
    </a>
    <a class="panel-block" data-testid="close-context-menu" @click="closeMenu()">
      <span class="panel-icon">
        <i class="fas fa-times"></i>
      </span>
      <span>{{ $t("close_menu") }}</span>
    </a>
  </div>
</template>

<style scoped lang="scss">
// Same look and metrics as ContextMenuAvatar so both menus feel like one UI.
.stream-context-menu {
  * {
    font-size: 14px;
  }

  .panel-block {
    &:hover {
      z-index: 100;
      position: relative;
      font-size: 14px;
    }
  }

  .menu-group {
    width: 100%;
    display: flex;
    margin-bottom: 0;

    .menu-group-title {
      flex: none;
      padding: 6px 12px;
      width: 100px;
      white-space: nowrap;
    }

    .menu-group-item {
      flex: auto;
    }

    button {
      width: 100%;
    }

    // Shape row: 9 swatch buttons don't fit beside the title in the 250px
    // menu, so they wrap onto extra lines instead of shrinking to slivers.
    &.shape-group {
      flex-wrap: wrap;

      .menu-group-item {
        flex: 0 0 auto;
      }

      button {
        width: 34px;
        padding-left: 0;
        padding-right: 0;
      }

      .shape-swatch {
        display: inline-block;
        width: 18px;
        height: 14px;
        background: currentColor;
      }
    }
  }
}
</style>
