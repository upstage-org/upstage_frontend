<script>
import { useStageStore } from "@stores/pinia/stage";
import { useUserStore } from "@stores/pinia/user";
import { computed, provide, reactive, ref, watch } from "vue";
import { isStreamPlaybackBoardType } from "@utils/common";
// Aliased: "Image" is a reserved HTML element name (vue/no-reserved-component-names).
import AppImage from "components/Image.vue";
import ContextMenu from "components/ContextMenu.vue";
import OpacitySlider from "./OpacitySlider.vue";
import QuickAction from "./QuickAction.vue";
import Topping from "./Topping.vue";
import Moveable from "./Moveable.vue";

export default {
  components: {
    AppImage,
    ContextMenu,
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
    const stageSize = computed(() => stageStore.stageSize);

    const active = ref(false);
    const sliderMode = ref("opacity");
    const beforeDragPosition = ref();
    const isHolding = computed(() => props.object.holder?.id === stageStore.session);
    const holdable = computed(() => ["avatar"].includes(props.object.type));
    const canPlay = computed(() => stageStore.canPlay);
    const controlable = computed(() => {
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
    if (props.object.multi) {
      watch(
        () => [props.object.autoplayFrames, props.object.frameLoop],
        () => {
          const { autoplayFrames, frames, src } = props.object;
          clearInterval(frameAnimation.interval);
          frameAnimation.interval = null;
          if (autoplayFrames) {
            frameAnimation.currentFrame = src;
            const intervalMs = parseFloat(String(autoplayFrames)) * 1000;
            if (!(intervalMs > 0) || !frames?.length) return;
            frameAnimation.interval = setInterval(
              () => {
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
              },
              intervalMs,
            );
          }
        },
        {
          immediate: true,
        },
      );
    }
    const src = computed(() => {
      if (props.object.autoplayFrames && props.object.multi) {
        return frameAnimation.currentFrame;
      } else {
        return props.object.src;
      }
    });

    const hold = () => {
      if (holdable.value && canPlay.value && !props.object.holder) {
        useUserStore().setAvatarId(props.object.id);
      }
    };
    const activeMovable = computed(() => stageStore.activeMovable === props.object.id);

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
        video.value.currentTime = 0;
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
  >
    <template #trigger>
      <div
        :style="{
          position: 'absolute',
          left: object.x + 'px',
          top: object.y + 'px',
          width: object.w + 'px',
          height: object.h + 'px',
          transform: `rotate(${object.rotate}deg)`,
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
          class="object"
          :class="{ 'link-hover-effect': hasLink && object.link.effect }"
          :style="{
            width: '100%',
            height: '100%',
            cursor: controlable ? 'grab' : object.link && object.link.url ? 'pointer' : 'normal',
            ...(activeMovable ? { position: 'relative', 'z-index': 1 } : {}),
          }"
          @keyup.delete="deleteObject"
          @dblclick="hold"
          @click="openLink"
          @dragstart.prevent
        >
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
            <!-- eslint-disable-next-line vue/no-mutating-props -->
            <video
              v-if="
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

.the-object-video {
  width: 100%;
  height: 100%;
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
