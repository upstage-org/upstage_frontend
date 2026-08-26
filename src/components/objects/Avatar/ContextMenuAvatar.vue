<script>
import { useStageStore } from "@stores/pinia/stage";
import { useUserStore } from "@stores/pinia/user";
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Icon from "components/Icon.vue";
import {
  coerceNumber,
  isIOS,
  isLocalHoldOfBoardObject,
  isStreamPlaybackBoardType,
} from "utils/common";
import {
  FRAME_FITS,
  FRAME_SHAPES,
  effectiveFrameFitId,
  effectiveFrameShapeId,
} from "../frameShapes";

// `shapeObject`, `bringToFront`, `sendToBack`, `deleteObject`,
// `switchFrame`, `toggleAutoplayFrames`, `openSettingPopup` are all
// synchronous (the underlying MQTT publish isn't awaited), so the
// `props.closeMenu` / `emit('update:active', true)` continuations
// below can run inline rather than chaining off a Promise.
export default {
  components: { Icon },
  props: {
    object: Object,
    closeMenu: Function,
    active: Boolean,
    sliderMode: String,
    setSliderMode: Function,
    keepActive: Function,
  },
  emits: ["update:active", "hold"],
  setup: (props, { emit }) => {
    const stageStore = useStageStore();
    const userStore = useUserStore();

    const holdAvatar = () => {
      userStore.setAvatarId(props.object.id);
      props.closeMenu();
    };

    const releaseAvatar = () => {
      userStore.setAvatarId(null);
      props.closeMenu();
    };

    const deleteObject = () => {
      stageStore.deleteObject(props.object);
      props.closeMenu();
    };

    const switchFrame = (frame) => {
      stageStore.switchFrame({
        ...props.object,
        src: frame,
      });
    };

    const flipHorizontal = () => {
      const scaleX = -1 * (props.object.scaleX ?? 1);
      stageStore.shapeObject({
        ...props.object,
        scaleX,
      });
      props.closeMenu();
    };

    const flipVertical = () => {
      const scaleY = -1 * (props.object.scaleY ?? 1);
      stageStore.shapeObject({
        ...props.object,
        scaleY,
      });
      props.closeMenu();
    };

    const toggleAutoplayFrames = () => {
      stageStore.toggleAutoplayFrames({
        ...props.object,
        ...(props.object.autoplayFrames
          ? {
              autoplayFrames: null,
              lastAutoplayFrames: props.object.autoplayFrames,
            }
          : {
              // A number typed in the speed field but not yet committed
              // with Enter ("armed") wins — pressing ▶ right after typing
              // must not silently replay the OLD speed.
              autoplayFrames: armedAnimationSpeed() || props.object.lastAutoplayFrames || 1,
            }),
      });
      emit("update:active", true);
    };

    const toggleFrameLoop = () => {
      const nowLooping = props.object.frameLoop !== false;
      stageStore.shapeObject({
        ...props.object,
        frameLoop: !nowLooping,
      });
      emit("update:active", true);
    };

    const changeNickname = () => {
      stageStore.openSettingPopup({
        type: "ChatParameters",
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
      emit("update:active", true);
      props.keepActive(true);
      // The slider itself lives on the selected object, not in this menu —
      // close the menu so it isn't covering the stage while sliding
      // (keepActive above preserves the selection frame + slider).
      props.closeMenu();
    };

    const holdable = inject("holdable") ?? ref();
    const isHolding = computed(() =>
      stageStore.canPlay
        ? isLocalHoldOfBoardObject(props.object, {
            localAvatarId: userStore.avatarId,
            localSessionId: stageStore.session,
            holder: props.object.holder,
          })
        : false,
    );

    const openVoiceSetting = () => {
      stageStore.openSettingPopup({
        type: "VoiceParameters",
      });
      props.closeMenu();
    };

    const openExitSetting = () => {
      stageStore.openSettingPopup({
        type: "ExitParameters",
      });
      props.closeMenu();
    };

    const isWearing = inject("isWearing");
    const currentAvatar = computed(() => stageStore.currentAvatar);

    const wearCostume = () => {
      if (currentAvatar.value) {
        stageStore.shapeObject({
          ...props.object,
          rotate: 0,
          wornBy: currentAvatar.value.id,
        });
        props.closeMenu();
      }
    };

    const takeOffCostume = () => {
      if (isWearing.value) {
        stageStore.shapeObject({
          ...props.object,
          wornBy: null,
        });
        props.closeMenu();
      }
    };

    const deletePermanently = () => {
      if (props.object.drawingId) {
        stageStore.deleteObject(props.object);
        props.closeMenu();
        stageStore.POP_DRAWING(props.object.drawingId);
      }
      if (props.object.textId) {
        stageStore.deleteObject(props.object);
        props.closeMenu();
        stageStore.POP_TEXT(props.object.textId);
      }
    };

    const hasLink = computed(() => props.object.link && props.object.link.url);
    const openLink = () => {
      const { url, blank } = props.object.link;
      window.open(url, blank ? "_blank" : "_self").focus();
    };

    // The speed field is LOCAL until committed with Enter (user request
    // 2026-08-27, "wait for a cue"): a player types the seconds, waits, and
    // starts the animation on Enter. It used to preview live on @input
    // (shapeObject per keystroke), which meant the animation started on the
    // first keystroke — and with Loop off the play-once run it had started
    // finished a few seconds later, cleared `autoplayFrames`, and the
    // store-computed :value wiped the field while the player was still
    // waiting. The spinner arrows arm the value the same way; nothing
    // starts until Enter.
    const animationSpeed = ref(props.object.autoplayFrames || "");
    watch(
      () => props.object.autoplayFrames,
      (speed) => {
        // Reflect real speed changes (another player, the ▶ button); a
        // clearing (pause, or a play-once run finishing) keeps the typed
        // number in place so it can be committed on cue.
        if (speed) animationSpeed.value = speed;
      },
    );
    const handleInputAnimationSpeed = (e) => {
      animationSpeed.value = e.target.value;
    };
    // Coerce so Firefox / Safari behave like Chromium: the raw value is a
    // string, may contain non-numeric characters in Firefox, and the input
    // doesn't honour `step="0.5"` until blur.
    const armedAnimationSpeed = () => coerceNumber(animationSpeed.value, { min: 0, step: 0.5 });
    const commitAnimationSpeed = () => {
      stageStore.shapeObject({
        ...props.object,
        autoplayFrames: armedAnimationSpeed() ?? 0,
      });
      props.closeMenu();
    };
    // Enter closes the menu from anywhere (user request 2026-08-27: switch
    // frames a few times, then Enter to dismiss). Inside the speed field
    // Enter also COMMITS the armed value — that is what starts the
    // animation now. Document-level (capture) rather than a root @keydown:
    // Safari doesn't focus <button>s on click, so after a thumbnail pick
    // the keystroke may land on <body> and would never bubble through the
    // menu. Text-entry targets outside the menu (chat box, text objects)
    // keep their Enter.
    const onDocumentEnterKey = (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(".avatar-context-menu")) {
        // Also swallows the default re-click of a focused thumbnail button.
        e.preventDefault();
        if (target.classList.contains("anmation-input")) {
          commitAnimationSpeed();
        } else {
          props.closeMenu();
        }
      } else if (
        target &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) &&
        !target.isContentEditable
      ) {
        props.closeMenu();
      }
    };
    onMounted(() => document.addEventListener("keydown", onDocumentEnterKey, true));
    onBeforeUnmount(() => document.removeEventListener("keydown", onDocumentEnterKey, true));

    const pauseVideo = () => {
      stageStore.shapeObject({
        ...props.object,
        isPlaying: false,
      });
      props.closeMenu();
    };
    const playVideo = () => {
      stageStore.shapeObject({
        ...props.object,
        isPlaying: true,
      });
      props.closeMenu();
    };
    const openVolumePopup = () => {
      stageStore.openSettingPopup({
        type: "VolumeParameters",
      });
      props.closeMenu();
    };
    const toggleVideoLoop = () => {
      stageStore.shapeObject({
        ...props.object,
        loop: !props.object.loop,
      });
      props.closeMenu();
    };
    const restartVideo = () => {
      stageStore.shapeObject({
        ...props.object,
        replayed: (props.object.replayed || 0) + 1,
      });
      props.closeMenu();
    };
    // iOS / iPadOS HTMLMediaElement.volume is read-only; suppress the
    // per-stream volume UI on those devices so performers don't see a
    // control that silently does nothing.
    const supportsPerStreamVolume = !isIOS();

    // Stream-playback video files (mp4/webm media). Live stream tiles
    // (jitsi + RTMP) never reach this menu — they use the standardised
    // ContextMenuStream instead (see Avatar/index.vue and Jitsi.vue).
    const isStreamBoardObject = computed(
      () =>
        isStreamPlaybackBoardType(props.object.type) ||
        isStreamPlaybackBoardType(props.object.assetType?.name),
    );

    // Shaped frame + fit rows for video assets — same registry and behaviour
    // as ContextMenuStream (closes on pick, user request 2026-08-14).
    const activeShapeId = computed(() => effectiveFrameShapeId(props.object.shape, "video"));
    const setFrameShape = (shape) => {
      stageStore.shapeObject({
        ...props.object,
        shape,
      });
      props.closeMenu();
    };
    const activeFitId = computed(() => effectiveFrameFitId(props.object.fit, "video"));
    const setFrameFit = (fit) => {
      stageStore.shapeObject({
        ...props.object,
        fit,
      });
      props.closeMenu();
    };

    return {
      switchFrame,
      holdAvatar,
      releaseAvatar,
      deleteObject,
      changeNickname,
      bringToFront,
      sendToBack,
      toggleAutoplayFrames,
      toggleFrameLoop,
      changeSliderMode,
      openVoiceSetting,
      openExitSetting,
      wearCostume,
      takeOffCostume,
      currentAvatar,
      isWearing,
      isHolding,
      holdable,
      deletePermanently,
      flipHorizontal,
      flipVertical,
      hasLink,
      openLink,

      animationSpeed,
      handleInputAnimationSpeed,
      pauseVideo,
      playVideo,
      openVolumePopup,
      toggleVideoLoop,
      restartVideo,
      supportsPerStreamVolume,
      isStreamBoardObject,
      FRAME_SHAPES,
      activeShapeId,
      setFrameShape,
      FRAME_FITS,
      activeFitId,
      setFrameFit,
    };
  },
};
</script>

<template>
  <div class="avatar-context-menu card-content p-0">
    <template v-if="holdable">
      <a v-if="isHolding" class="panel-block" @click.stop="releaseAvatar">
        <span class="panel-icon">
          <Icon src="clear.svg" />
        </span>
        <span>{{ $t("release") }}</span>
      </a>
      <a v-else class="panel-block" @click="holdAvatar">
        <span class="panel-icon">
          <Icon src="set-as-avatar.svg" />
        </span>
        <span>{{ $t("hold_this_avatar") }}</span>
      </a>
    </template>
    <template v-else>
      <a v-if="isWearing" class="panel-block" @click="takeOffCostume">
        <span class="panel-icon">
          <Icon src="clear.svg" />
        </span>
        <span>{{ $t("remove_from_avatar") }}</span>
      </a>
      <a v-else-if="currentAvatar && !isStreamBoardObject" class="panel-block" @click="wearCostume">
        <span class="panel-icon">
          <Icon src="prop.svg" />
        </span>
        <span>{{ $t("add_to_avatar") }}</span>
      </a>
    </template>
    <div v-if="isStreamBoardObject">
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
      <a v-if="object.isPlaying" class="panel-block" @click="pauseVideo(slotProps)">
        <span class="panel-icon">
          <i class="fas fa-pause"></i>
        </span>
        <span>{{ $t("pause") }}</span>
      </a>
      <a v-else class="panel-block" @click="playVideo(slotProps)">
        <span class="panel-icon">
          <i class="fas fa-play"></i>
        </span>
        <span>{{ $t("play") }}</span>
      </a>
      <a class="panel-block" @click="restartVideo">
        <span class="panel-icon">
          <i class="fas fa-sync"></i>
        </span>
        <span>{{ $t("restart") }}</span>
      </a>
      <a v-if="supportsPerStreamVolume" class="panel-block" @click="openVolumePopup(slotProps)">
        <span class="panel-icon">
          <Icon src="voice-setting.svg" />
        </span>
        <span>{{ $t("volumn_setting") }}</span>
      </a>
      <a class="panel-block" @click="toggleVideoLoop">
        <span class="panel-icon">
          <i v-if="object.loop" class="fas fa-infinity"></i>
          <b v-else>1</b>
        </span>
        <span v-if="object.loop">{{ $t("loop.on") }}</span>
        <span v-else>{{ $t("loop.off") }}</span>
      </a>
    </div>
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
    <a v-if="holdable" class="panel-block" @click="changeNickname">
      <span class="panel-icon">
        <Icon src="change-nickname.svg" />
      </span>
      <span>{{ $t("avatar_name") }}</span>
    </a>
    <a v-if="holdable" class="panel-block" @click="openVoiceSetting">
      <span class="panel-icon">
        <Icon src="voice-setting.svg" />
      </span>
      <span>{{ $t("voice_setting") }}</span>
    </a>
    <div v-if="object.multi" class="field has-addons menu-group">
      <span class="panel-block">
        <span class="panel-icon">
          <Icon src="animation-slider.svg" />
        </span>
        <span>{{ "Animation speed" }}</span>
      </span>
      <!-- Typing / spinner clicks only ARM the value; Enter commits it
           (starts the animation) and closes the menu — handled by the
           document-level keydown listener in setup. No @change: a blur
           commit would start the animation off-cue when the player clicks
           elsewhere after typing. -->
      <input
        class="input anmation-input"
        type="number"
        inputmode="decimal"
        step="0.5"
        min="0"
        :value="animationSpeed"
        placeholder="seconds"
        :title="$t('animation_speed_tooltip')"
        @input="handleInputAnimationSpeed"
      />
    </div>

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
    <template v-if="hasLink">
      <a-tooltip :title="object.link.url" placement="bottom">
        <a class="panel-block" @click="openLink">
          <span class="panel-icon">
            <i class="fas fa-link"></i>
          </span>
          <span>{{ $t("open_link") }}</span>
        </a>
      </a-tooltip>
    </template>

    <a class="panel-block" @click="openExitSetting">
      <span class="panel-icon">
        <Icon src="clear.svg" />
      </span>
      <span>{{ $t("exit_setting") }}</span>
    </a>
    <a class="panel-block has-text-danger" @click="deleteObject">
      <span class="panel-icon">
        <Icon src="remove.svg" />
      </span>
      <span>{{ $t("remove") }}</span>
    </a>
    <a
      v-if="object.drawingId || object.textId"
      class="panel-block has-text-danger"
      @click="deletePermanently"
    >
      <span class="panel-icon">
        <Icon src="remove.svg" />
      </span>
      <span>{{ $t("delete_permanently") }}</span>
    </a>
    <div v-if="object.multi" class="field has-addons menu-group">
      <p class="control menu-group-item" @click="toggleAutoplayFrames()">
        <button type="button" class="button is-light">
          <Icon :src="object.autoplayFrames > 0 ? 'pause.svg' : 'play.svg'" size="24" />
        </button>
      </p>
      <p class="control menu-group-item" @click="toggleFrameLoop">
        <button type="button" class="button is-light" :title="$t('multiframe_loop_tooltip')">
          <Icon
            size="24"
            src="loop.svg"
            :style="object.frameLoop === false ? { filter: 'grayscale(1)', opacity: 0.55 } : {}"
          />
        </button>
      </p>
      <p
        v-for="frame in object.frames"
        :key="frame"
        class="control menu-group-item"
        @click="switchFrame(frame)"
      >
        <button type="button" class="button is-light">
          <img :src="frame" style="height: 100%" />
        </button>
      </p>
    </div>
    <a class="panel-block" data-testid="close-context-menu" @click="closeMenu()">
      <span class="panel-icon">
        <i class="fas fa-times"></i>
      </span>
      <span>{{ $t("close_menu") }}</span>
    </a>
  </div>
</template>

<style scoped lang="scss">
.avatar-context-menu {
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

      > button {
        justify-content: start;
        padding-left: 12px;
      }
    }

    .menu-group-item {
      flex: auto;
    }

    button {
      width: 100%;
    }

    .anmation-input {
      max-width: 85px;
      background-color: white;
      margin: 4px 4px 4px auto;
      padding-top: 2px;
      padding-bottom: 2px;
      height: 28px;
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
