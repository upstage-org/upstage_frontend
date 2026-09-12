<script>
import { useStageStore } from "@stores/pinia/stage";
import { useUserStore } from "@stores/pinia/user";
import { storeToRefs } from "pinia";
import { computed, inject, onMounted, onUnmounted, provide, reactive, ref, watch } from "vue";
import {
  isHoldableBoardObject,
  isJitsiBoardType,
  isLocalHoldOfBoardObject,
  isStreamPlaybackBoardType,
} from "@utils/common";
import { autoplayStartFrame } from "@utils/frameAnimation";
import { containedPictureBox, effectiveFrameFitId, frameShapeStyle } from "./frameShapes";
// Aliased: "Image" is a reserved HTML element name (vue/no-reserved-component-names).
import AppImage from "components/Image.vue";
import ContextMenu from "components/ContextMenu.vue";
import LiveStreamPlayer from "./LiveStream/LiveStreamPlayer.vue";
import OpacitySlider from "./OpacitySlider.vue";
import QuickAction from "./QuickAction.vue";
import Topping from "./Topping.vue";
import Moveable from "./Moveable.vue";

export default {
  components: {
    AppImage,
    ContextMenu,
    LiveStreamPlayer,
    OpacitySlider,
    QuickAction,
    Topping,
    Moveable,
  },
  props: { object: Object },
  emits: ["dblclick"],
  setup(props) {
    const el = ref();
    const video = ref();
    const stageStore = useStageStore();
    const replaying = inject("replaying", false);
    const { stageSize, canPlay: storeCanPlay } = storeToRefs(stageStore);

    const userStore = useUserStore();
    const active = ref(false);
    const sliderMode = ref("opacity");
    const beforeDragPosition = ref();
    const isHolding = computed(() =>
      canPlay.value
        ? isLocalHoldOfBoardObject(props.object, {
            localAvatarId: userStore.avatarId,
            localSessionId: stageStore.session,
            holder: props.object.holder,
          })
        : false,
    );
    const holdable = computed(() => isHoldableBoardObject(props.object));
    const canPlay = computed(() => storeCanPlay.value && !replaying);
    const controlable = computed(() => {
      if (replaying) return false;
      return holdable.value ? isHolding.value : canPlay.value && !props.object.wornBy;
    });
    provide("holdable", holdable);

    const deleteObject = () => {
      if (controlable.value) {
        //stageStore.deleteObject(props.object);
      }
    };

    const frameAnimation = reactive({
      interval: null,
      currentFrame: null,
    });
    // Plain local, not reactive: holds Image objects only to keep the
    // frame files warm in the browser cache while autoplay runs, so a
    // no-cache media server can't leave a frame swap waiting on the
    // network mid-animation.
    let _warmFrames = null;
    if (props.object.multi) {
      watch(
        () => [props.object.autoplayFrames, props.object.frameLoop],
        () => {
          const { autoplayFrames, frames, src } = props.object;
          clearInterval(frameAnimation.interval);
          frameAnimation.interval = null;
          _warmFrames = null;
          if (autoplayFrames) {
            frameAnimation.currentFrame = src ?? frames?.[0] ?? null;
            const intervalMs = parseFloat(String(autoplayFrames)) * 1000;
            if (!(intervalMs > 0) || !frames?.length) return;
            // Rewind only once the run is actually starting (guards above),
            // so an invalid speed can't jump the displayed frame.
            frameAnimation.currentFrame = autoplayStartFrame(
              frames,
              frameAnimation.currentFrame,
              props.object.frameLoop,
            );
            _warmFrames = frames.map((frame) => {
              const img = new Image();
              img.src = frame;
              return img;
            });
            frameAnimation.interval = setInterval(() => {
              const fr = props.object.frames;
              if (!fr?.length) return;
              const idx = fr.indexOf(frameAnimation.currentFrame);
              let next = idx + 1;
              if (next >= fr.length) {
                if (props.object.frameLoop !== false) {
                  next = 0;
                } else {
                  clearInterval(frameAnimation.interval);
                  frameAnimation.interval = null;
                  _warmFrames = null;
                  stageStore.toggleAutoplayFrames({
                    ...props.object,
                    autoplayFrames: null,
                    lastAutoplayFrames: props.object.autoplayFrames,
                    src: frameAnimation.currentFrame ?? fr[fr.length - 1],
                  });
                  return;
                }
              }
              frameAnimation.currentFrame = fr[next];
            }, intervalMs);
          }
        },
        {
          immediate: true,
        },
      );
      onUnmounted(() => {
        clearInterval(frameAnimation.interval);
        frameAnimation.interval = null;
        _warmFrames = null;
      });
    }
    const src = computed(() => {
      if (props.object.autoplayFrames && props.object.multi) {
        return frameAnimation.currentFrame;
      } else {
        return props.object.src;
      }
    });

    const hold = () => {
      if (replaying) return;
      if (holdable.value && canPlay.value && !props.object.holder) {
        useUserStore().setAvatarId(props.object.id);
      }
    };
    const activeMovable = computed(() => stageStore.activeMovable === props.object.id);

    // Which frame-shape/fit family this object belongs to: stream tiles
    // (jitsi + RTMP) and video assets have one; everything else (images,
    // text, drawings) renders exactly as before, with no extra wrapper.
    const frameKind = computed(() => {
      const jitsi = isJitsiBoardType(props.object.type);
      const rtmp = props.object.isRTMP === true;
      const video =
        !jitsi &&
        !rtmp &&
        (isStreamPlaybackBoardType(props.object.type) ||
          isStreamPlaybackBoardType(props.object.assetType?.name));
      if (!jitsi && !rtmp && !video) return null;
      return jitsi ? "jitsi" : rtmp ? "rtmp" : "video";
    });

    // Fit/crop/stretch choice on the sized `.object` wrapper; the <video>
    // reads it via object-fit: var(--stream-fit, …) in Jitsi.vue /
    // LiveStreamPlayer.vue / .the-object-video below. A pure style binding
    // on an existing div: the Board key is object.id, so this can never
    // remount the player or touch srcObject.
    const frameFit = computed(() =>
      frameKind.value ? effectiveFrameFitId(props.object.fit, frameKind.value) : null,
    );
    const frameStyle = computed(() => (frameFit.value ? { "--stream-fit": frameFit.value } : {}));

    // Intrinsic width / height of the picture the tile is showing, learnt
    // from the <video> element's own media events. They don't bubble, so
    // the `.object` div listens in the capture phase (see the template) —
    // one place that covers Jitsi.vue's slot <video>, LiveStreamPlayer's
    // and the video-asset <video> below without touching any of them.
    // `resize` (not the window one — that never passes through this div)
    // fires when a MediaStream's first frame reveals its dimensions and
    // when a live encoder changes canvas size; `emptied` fires when the
    // source is dropped (RTMP teardown), so the placeholder gets the full
    // frame again.
    const pictureRatio = ref(null);
    const onVideoDimensions = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLVideoElement)) return;
      const { videoWidth, videoHeight } = target;
      pictureRatio.value = videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : null;
    };

    // Laid-out size of the frame. Moveable writes the element's width /
    // height directly during a resize drag and only publishes w / h on
    // release, so object.w / object.h lag the picture mid-gesture; a
    // ResizeObserver on the `.object` div (100% of the frame) tracks the
    // real box live instead.
    const frameSize = ref(null);
    let frameObserver = null;
    onMounted(() => {
      if (!el.value || typeof ResizeObserver !== "function") return;
      frameObserver = new ResizeObserver((entries) => {
        const rect = entries[entries.length - 1]?.contentRect;
        if (rect) frameSize.value = { width: rect.width, height: rect.height };
      });
      frameObserver.observe(el.value);
    });
    onUnmounted(() => {
      frameObserver?.disconnect();
      frameObserver = null;
    });

    // Frame shape for stream tiles (jitsi + RTMP) and video assets. Applied
    // to the `.picture-box` wrapper inside `.object`, which clips the
    // <video> AND the RTMP "waiting" / jitsi loading overlays together, and
    // whose %-based shape stretches live while the frame is resized.
    //
    // The box IS the frame ("cover" / "fill", the jitsi and video-asset
    // defaults) — except with "contain" (the RTMP default): there the
    // letterboxed picture is narrower or shorter than the frame, and a
    // shape clipped on the frame would cut the picture's edges instead of
    // following its outline (a circle on a wide RTMP frame lost its
    // left/right sides). So with "contain" the box shrinks to the picture's
    // own rectangle, centred, and the shape hugs the picture exactly as it
    // does on a cropped jitsi tile. Until the picture's dimensions are
    // known (connecting / waiting placeholder) the box stays the full frame.
    const pictureBoxStyle = computed(() => {
      if (!frameKind.value) return {};
      const shape = frameShapeStyle(props.object.shape, frameKind.value);
      const box =
        frameFit.value === "contain" && frameSize.value && pictureRatio.value
          ? containedPictureBox(frameSize.value.width, frameSize.value.height, pictureRatio.value)
          : null;
      if (!box) return { ...shape, width: "100%", height: "100%" };
      return {
        ...shape,
        position: "relative",
        left: `${box.left}%`,
        top: `${box.top}%`,
        width: `${box.width}%`,
        height: `${box.height}%`,
      };
    });

    const isWearing = computed(
      () => props.object.wornBy && stageStore.currentAvatar?.id === props.object.wornBy,
    );
    provide("isWearing", isWearing);

    const hasLink = computed(() => !canPlay.value && props.object.link && props.object.link.url);
    const openLink = () => {
      if (hasLink.value) {
        const { url, blank } = props.object.link;
        window.open(url, blank ? "_blank" : "_self").focus();
      }
    };

    const synchronize = () => {
      if (props.object.isPlaying && video.value) {
        const playPromise = video.value.play();
        // play() returns a Promise that the browser rejects if its
        // autoplay policy refuses the request (typically when the
        // gesture activation token has expired and the video has audio).
        // Without a catch the rejection surfaces as an unhandled promise
        // error. Log it so it's at least observable; the user can still
        // start playback manually via the context menu's Play action.
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch((err) => {
            console.warn(
              "[stage] video.play() was blocked; right-click the object and choose Play to start it:",
              err?.message ?? err,
            );
          });
        }
      } else {
        video.value && video.value.pause();
      }
    };
    watch(
      () => props.object,
      () => {
        synchronize();
      },
    );
    watch(
      () => props.object.replayed,
      () => {
        // Live RTMP tiles render via LiveStreamPlayer and never set this
        // ref; a live feed has no seekable timeline to restart anyway.
        if (video.value) video.value.currentTime = 0;
      },
    );
    const loadeddata = () => {
      synchronize();
    };

    // IDL-property mirror of the `disablePictureInPicture` attribute
    // set in the template. Closes the Vue-3-property-patching window
    // where the attribute is reflected in markup but not in the
    // element's IDL property. Same belt-and-braces pattern as
    // Yourself.vue / Jitsi.vue. See those files for the
    // per-browser rationale.
    watch(
      video,
      (el) => {
        if (el) el.disablePictureInPicture = true;
      },
      { immediate: true },
    );

    return {
      el,
      print,
      active,
      beforeDragPosition,
      deleteObject,
      src,
      stageSize,
      hold,
      isHolding,
      holdable,
      controlable,
      sliderMode,
      activeMovable,
      frameKind,
      frameStyle,
      pictureBoxStyle,
      onVideoDimensions,
      isWearing,
      hasLink,
      openLink,
      loadeddata,
      video,
      isStreamPlaybackBoardType,
    };
  },
};
</script>

<template>
  <!--
    Identity attributes (data-testid, data-object-id, data-object-type), keyboard
    focus (tabindex), and primary pointer handlers live on the `.object` div
    inside <Moveable>'s slot. That div fills 100% of Moveable's wrapper, which
    is sized to object.w × object.h, so it's a real, visible, interactive
    target.

    Previously these attributes lived on an outer wrapper around <ContextMenu>,
    but that wrapper had no intrinsic size: both of its visible children
    (the overlay-UI div and <Moveable>) are position: absolute, so the wrapper
    collapsed to 0×0. That made:
      - Playwright `[data-testid="object-*"]` lookups not "visible"
      - `tabindex="0"` focusable but with no focus ring / hit area
    Moving them onto the sized `.object` div fixes both without changing the
    pointer event path (clicks on the visible asset already bubble to .object).
  -->
  <ContextMenu
    :pad-left="-stageSize.left"
    :pad-top="-stageSize.top"
    :pad-right="250"
    :opacity="0.8"
    :disabled="replaying"
  >
    <template #trigger>
      <!--
        While this object is selected (green Moveable frame showing), its
        control overlay (lightbulb / X buttons, sliders) must float above
        every other object on the board — `.object` divs carry z-index 10,
        so without the raise a neighbouring object rendered later buries
        the buttons even though the frame (drawn on document.body) stays
        visible. pointer-events:none keeps the transparent wrapper from
        stealing the object's own drag/click hits; the controls re-enable
        their own pointer events in their scoped styles.
      -->
      <div
        :style="{
          position: 'absolute',
          left: object.x + 'px',
          top: object.y + 'px',
          width: object.w + 'px',
          height: object.h + 'px',
          transform: `rotate(${object.rotate}deg)`,
          ...(activeMovable ? { zIndex: 100, pointerEvents: 'none' } : {}),
        }"
      >
        <OpacitySlider v-model:active="active" v-model:slider-mode="sliderMode" :object="object" />
        <QuickAction v-model:active="active" :object="object" />
        <Topping v-model:active="active" :object="object" />
      </div>
      <Moveable v-model:active="active" :controlable="controlable" :object="object">
        <div
          ref="el"
          tabindex="0"
          :data-testid="object?.name ? `object-${object.name}` : undefined"
          :data-object-id="object?.id"
          :data-object-type="object?.type"
          :data-exit-animation="object?.exitAnimation || undefined"
          :data-exit-speed="object?.exitSpeed || undefined"
          class="object"
          :class="{ 'link-hover-effect': hasLink && object.link.effect }"
          :style="{
            width: '100%',
            height: '100%',
            cursor: controlable ? 'grab' : object.link && object.link.url ? 'pointer' : 'normal',
            ...(activeMovable ? { position: 'relative', 'z-index': 1 } : {}),
            ...frameStyle,
          }"
          @keyup.delete="deleteObject"
          @dblclick="hold"
          @click="openLink"
          @dragstart.prevent
          @loadedmetadata.capture="onVideoDimensions"
          @resize.capture="onVideoDimensions"
          @emptied.capture="onVideoDimensions"
        >
          <!--
            Stream tiles (jitsi + RTMP) and video assets render inside a
            `.picture-box` that carries the frame shape (see pictureBoxStyle);
            everything else keeps the slot directly under `.object` — Text.vue
            pins its parent's scroll offset, so its parent must stay this div.
            The <slot> appears in both branches; only one ever renders and an
            object never changes kind, so nothing remounts.
          -->
          <div v-if="frameKind" class="picture-box" :style="pictureBoxStyle">
            <slot name="render">
              <!--
                The @ended handler writes to object.isPlaying directly.
                The stage store holds the canonical isPlaying state, but
                this in-place mutation has been the load-bearing "video
                stopped naturally" signal for a long time. Reshaping it
                into a store action is a separate, behaviour-affecting
                change; suppress the rule on this template line for now.
              -->
              <!--
                Audience-facing video asset (mp4/webm dropped onto the
                stage as a media item). Same PiP / controls hardening
                as Jitsi.vue's remote-peer <video>: see the comment
                block there for the per-browser rationale. We mirror
                `disablePictureInPicture` as an IDL property via the
                `video` ref watcher below so Vue 3's property-only
                patching of HTMLMediaElement doesn't leave the
                attribute set in the DOM but unread by the engine.
              -->
              <!--
                Live RTMP feed (stream asset with a bare MediaMTX key —
                `isRTMP` is only ever set for those, so every pre-existing
                object type falls through to the branches below unchanged).
              -->
              <LiveStreamPlayer v-if="object.isRTMP" :object="object" />
              <!-- eslint-disable-next-line vue/no-mutating-props -->
              <video
                v-else-if="
                  isStreamPlaybackBoardType(object.type) ||
                  isStreamPlaybackBoardType(object.assetType?.name)
                "
                :id="'video' + object.id"
                ref="video"
                class="the-object-video"
                :src="object.url"
                preload="auto"
                :loop="object.loop"
                playsinline
                disablePictureInPicture
                controlslist="nodownload nofullscreen noremoteplayback"
                @ended="
                  /* eslint-disable-next-line vue/no-mutating-props -- intentional: object.isPlaying is a load-bearing signal mutated in-place by parent contract */
                  object.isPlaying = false
                "
                @loadeddata="loadeddata"
              ></video>
              <AppImage v-else class="the-object" :src="src" />
            </slot>
          </div>
          <slot v-else name="render">
            <AppImage class="the-object" :src="src" />
          </slot>
        </div>
      </Moveable>
    </template>
    <template #context="slotProps">
      <div v-if="isWearing || controlable">
        <slot
          name="menu"
          v-bind="slotProps"
          :slider-mode="sliderMode"
          :set-slider-mode="(mode) => (sliderMode = mode)"
          :keep-active="() => (active = true)"
        />
      </div>
    </template>
  </ContextMenu>
</template>

<style lang="scss">
div[tabindex] {
  outline: none;
}

.object {
  z-index: 10;
  overflow: hidden;

  &.link-hover-effect {
    transition: transform v-bind(transition);
  }

  &.link-hover-effect:hover {
    transform: scale(1.2) !important;
  }
}

// Shaped wrapper for stream tiles and video assets (pictureBoxStyle sets
// the border-radius / clip-path and, with "contain", the picture's own
// rectangle). overflow: hidden is what makes border-radius clip the
// <video> and overlays inside.
.picture-box {
  overflow: hidden;
}

.the-object-video {
  width: 100%;
  height: 100%;
  // "fill" mirrors the element's historical default look; the wrapper's
  // frameStyle overrides the var when a fit is chosen in the context menu.
  object-fit: var(--stream-fit, fill);
}

/*
  Hide Chromium's hover-rendered picture-in-picture toggle button.
  See Jitsi.vue / Yourself.vue for the per-engine rationale; Firefox
  reads the `disablePictureInPicture` attribute (mirrored via JS in
  the watcher above) and Chromium reads this CSS rule.
*/
.the-object-video::-webkit-media-controls-picture-in-picture-button {
  display: none !important;
}
</style>
