<script>
import { computed, onUnmounted, reactive, watch } from "vue";
import { useStageStore } from "@stores/pinia/stage";
import {
  BACKGROUND_RUN,
  createFrameCycle,
  isOpacityOnlyChange,
  layerCycleMs,
} from "@utils/frameAnimation";
// Aliased: "Image" is a reserved HTML element name (vue/no-reserved-component-names).
import AppImage from "../Image.vue";

export default {
  components: { AppImage },
  setup: () => {
    const stageStore = useStageStore();
    const background = computed(() => stageStore.background);
    const backgroundOpacity = computed(() => stageStore.background?.opacity ?? 1);
    const transitionDuration = computed(() => (stageStore.background?.speed || 0) * 1000);

    const frameAnimation = reactive({
      currentFrame: null,
    });
    const src = computed(() => {
      if (!background.value) {
        return null;
      }
      if (background.value.multi && background.value.speed > 0) {
        return frameAnimation.currentFrame;
      } else {
        return background.value.currentFrame ?? background.value.src;
      }
    });

    // The frame is worked out from how long ago the cycle started
    // (`stageStore.frameRuns`, see FrameRun in @utils/frameAnimation), so
    // everyone on the stage — including whoever joins later — is on the
    // same frame and changes at the same moment, and nothing but a real
    // change to the backdrop restarts it (#1582). The store decides what
    // counts as a restart (`syncBackgroundFrameRun`): anything except an
    // opacity-only update, exactly as before.
    //
    // Total per-frame cycle = fade (`speed`) + hold (`dwell`): with the
    // interval at just `speed` the next fade would kick off the instant the
    // previous one finished, and the image would never be seen at full
    // opacity. `dwell` defaults to 0 for media that has not set it.
    let localRun = null;
    const isAnimating = (bg) =>
      Boolean(bg?.frames?.length) && parseFloat(bg.speed || 0) > 0 && layerCycleMs(bg) > 0;
    const currentRun = () => {
      const bg = background.value;
      if (!isAnimating(bg)) return null;
      const shared = stageStore.frameRuns?.[BACKGROUND_RUN];
      if (shared) return shared;
      // No record in the store (it always has one): start when first seen,
      // from the picked frame, else the picture already on screen.
      if (!localRun) {
        let fromFrame = bg.currentFrame || frameAnimation.currentFrame;
        if (!bg.frames.includes(fromFrame)) fromFrame = bg.src ?? bg.frames[0] ?? null;
        localRun = { key: "local", token: -1, startedAt: Date.now(), fromFrame };
      }
      return localRun;
    };
    const cycle = createFrameCycle({
      getState: () => {
        const run = currentRun();
        if (!run) return null;
        const bg = background.value;
        return {
          frames: bg.frames,
          frameLoop: bg.frameLoop,
          intervalMs: layerCycleMs(bg),
          startedAt: run.startedAt,
          fromFrame: run.fromFrame,
        };
      },
      onFrame: (frame) => {
        frameAnimation.currentFrame = frame;
      },
      onFinished: (frame) => {
        const bg = stageStore.background;
        if (!bg?.frames?.length) return;
        stageStore.setBackground({
          ...bg,
          speed: 0,
          lastSpeed: bg.lastSpeed ?? bg.speed ?? 0.5,
          currentFrame: frame ?? bg.frames[bg.frames.length - 1],
        });
      },
    });

    watch(
      [background, () => stageStore.frameRuns?.[BACKGROUND_RUN]?.token],
      ([value, token], [previous, previousToken] = []) => {
        if (!value) {
          cycle.stop();
          localRun = null;
          return;
        }
        if (!isAnimating(value)) {
          cycle.stop();
          localRun = null;
          if (value.currentFrame) frameAnimation.currentFrame = value.currentFrame;
          return;
        }
        // Without a store record, an opacity-only update must not restart
        // the local run; any other change does.
        if (
          token == null &&
          !(cycle.running() && previousToken == null && isOpacityOnlyChange(previous, value))
        ) {
          localRun = null;
        }
        cycle.sync();
      },
      { immediate: true },
    );
    // Timers are slowed or paused in a hidden tab; catch up at once when the
    // stage is looked at again.
    const onVisible = () => {
      if (!document.hidden && cycle.running()) cycle.sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    onUnmounted(() => {
      document.removeEventListener("visibilitychange", onVisible);
      cycle.stop();
    });

    return { backgroundOpacity, transitionDuration, src };
  },
};
</script>

<template>
  <!--
    #stage-backdrop is the layer the store fades (SET_BACKGROUND animates
    its opacity 0 -> 1 on a backdrop change). It has to be a wrapper: the
    <img> inside is re-keyed per src by AppImage and carries the user's own
    opacity binding, and fading #board instead took every object on the
    stage down with the backdrop. The wrapper is always present (so the
    fade also plays for "no backdrop -> backdrop") and lets pointer events
    through, while the image itself stays a hit target exactly as before.
  -->
  <div id="stage-backdrop" class="backdrop-layer">
    <AppImage
      v-if="src"
      class="background-image"
      :src="src"
      :style="{
        opacity: backgroundOpacity,
      }"
      :transition="transitionDuration"
      :no-fallback="true"
      fit="cover"
    />
  </div>
</template>

<style scoped>
.backdrop-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.background-image {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  object-position: top;
  pointer-events: auto;
}
</style>
