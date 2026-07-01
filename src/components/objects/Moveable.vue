<script>
import { ref, inject } from "vue";
import { computed, onMounted, onUnmounted, watch } from "vue";
import Moveable from "moveable";
import { useStageStore } from "@stores/pinia/stage";
import { animate } from "animejs";

export default {
  props: {
    object: Object,
    controlable: Boolean,
    active: Boolean,
  },
  emits: ["update:active"],
  setup: (props, { emit }) => {
    const el = ref();
    const isDragging = ref(false);

    const stageStore = useStageStore();
    const replaying = inject("replaying", false);
    const canPlay = computed(() => stageStore.canPlay && !replaying);
    const config = stageStore.config;
    const moveable = new Moveable(document.body, {
      draggable: true,
      resizable: true,
      rotatable: true,
      origin: false,
    });

    let animation;

    const sendMovement = (target, { left, top }) => {
      target.style.left = `${props.object.x}px`;
      target.style.top = `${props.object.y}px`;
      stageStore.shapeObject({
        ...props.object,
        x: left,
        y: top,
      });
    };
    moveable
      .on("dragStart", () => {
        isDragging.value = true;
        if (animation) {
          animation.pause(true);
        }
      })
      .on("drag", ({ target, left, top }) => {
        target.style.left = `${left}px`;
        target.style.top = `${top}px`;
      })
      .on("dragEnd", ({ lastEvent, target }) => {
        if (lastEvent) {
          sendMovement(target, lastEvent);
        }
        isDragging.value = false;
      });

    const sendResize = (target, { width, height, left, top }) => {
      stageStore.shapeObject({
        ...props.object,
        x: left,
        y: top,
        w: width,
        h: height,
      });
    };
    moveable
      .on("resizeStart", () => {
        isDragging.value = true;
        if (animation) {
          animation.pause(true);
        }
      })
      .on("resize", ({ target, width, height, drag: { left, top } }) => {
        target.style.width = `${width}px`;
        target.style.height = `${height}px`;
        target.style.left = `${left}px`;
        target.style.top = `${top}px`;
      })
      .on(
        "resizeEnd",
        ({
          target,
          lastEvent: {
            width,
            height,
            drag: { left, top },
          },
        }) => {
          sendResize(target, { left, top, width, height });
          isDragging.value = false;
        },
      );

    const sendRotation = (target, rotate) => {
      target.style.transform = `rotate(${props.object.rotate}deg)`;
      stageStore.shapeObject({
        ...props.object,
        rotate,
      });
    };
    moveable
      .on("rotateStart", (e) => {
        e.set(props.object.rotate ?? 0);
        isDragging.value = true;
        if (animation) {
          animation.pause(true);
        }
      })
      .on("rotate", ({ target, rotate }) => {
        target.style.transform = `rotate(${rotate}deg)`;
      })
      .on("rotateEnd", ({ target, lastEvent: { rotate } }) => {
        sendRotation(target, rotate);
        isDragging.value = false;
      });

    const showControls = (isShowing, e) => {
      if (moveable) {
        if (isShowing) {
          moveable.setState(
            {
              target: el.value,
              keepRatio: !["text", "meeting"].includes(props.object.type),
            },
            () => {
              if (e && props.object.type !== "text") {
                moveable.dragStart(e);
              }
            },
          );
          emit("update:active", true);
        } else {
          moveable.setState(
            {
              target: null,
            },
            () => {
              emit("update:active", false);
            },
          );
        }
      }
    };

    const activeMovable = computed(() => stageStore.activeMovable === props.object.id);

    const clickInside = (e) => {
      if (replaying) return;
      if (props.controlable && canPlay.value) {
        showControls(true, e);
        stageStore.SET_ACTIVE_MOVABLE(props.object.id);
      }
    };

    const clickOutside = (e) => {
      if (replaying) return;
      if ((!e || e.target.id === "board") && props.controlable && canPlay.value) {
        // Clicking the empty stage only DESELECTS (hides the frame/tools). It
        // must NOT release an avatar hold: a player keeps their avatar (and
        // keeps speaking as it) while moving props etc., and only lets go by
        // holding a different avatar (double-click) or the context-menu
        // "Release". Releasing here caused the whole "needs a double-click"
        // regression, because every empty-stage click dropped the hold.
        stageStore.SET_ACTIVE_MOVABLE(null);
      }
    };
    // NB: not `immediate` — on first render the immediate callback fires during
    // setup, before `el` is mounted, so `showControls(true)` would target
    // `undefined` and the frame would never appear for a freshly-dropped object
    // that is auto-focused on drop (the QuickAction buttons key off the global
    // `activeMovable` and still showed, hence "buttons but no green frame").
    // The initial state is applied in onMounted below once `el` exists.
    watch(activeMovable, (val) => {
      showControls(val);
    });

    watch(
      () => props.object,
      () => {
        if (!el.value) {
          return;
        }
        const x = props.object;
        const {
          x: left,
          y: top,
          w: width,
          h: height,
          rotate,
          moveSpeed,
          opacity,
          scaleX,
          scaleY,
        } = x;
        if (animation) {
          animation.pause(true);
        }
        animation = animate(el.value, {
          left,
          top,
          width,
          height,
          rotate,
          opacity,
          scaleX,
          scaleY,
          ...(moveSpeed > 1000 ? { easing: "linear" } : {}),
          duration: moveSpeed ?? config.animateDuration,
          onUpdate: () => {
            try {
              moveable.updateRect();
            } catch {
              // pass
            }
          },
        });
      },
      { deep: true },
    );

    onMounted(() => {
      const { x, y, w, h, rotate } = props.object;
      el.value.style.width = `${w}px`;
      el.value.style.height = `${h}px`;
      el.value.style.left = `${x}px`;
      el.value.style.top = `${y}px`;
      el.value.style.transform = `rotate(${rotate}deg)`;
      // If this object mounted already-selected (e.g. auto-focused right after
      // being dropped on the stage), show its resize frame now that `el` exists.
      if (activeMovable.value) {
        showControls(true);
      }
    });

    onUnmounted(() => {
      moveable.destroy();
    });

    const transformOrigin = computed(() => {
      const wearer = stageStore.board.objects.find((a) => a.id === props.object.wornBy);
      if (wearer) {
        return `${wearer.x + wearer.w / 2 - props.object.x}px ${
          wearer.y + wearer.h / 2 - props.object.y
        }px`;
      } else {
        return "center";
      }
    });

    return { el, isDragging, clickInside, clickOutside, transformOrigin };
  },
};
</script>

<template>
  <div
    ref="el"
    v-click-outside="clickOutside"
    :style="{
      position: 'absolute',
      opacity: object.opacity * (isDragging ? 0.5 : 1),
      filter: `grayscale(${object.liveAction === false ? 1 : 0})`,
      'transform-origin': transformOrigin,
    }"
    @mousedown="clickInside"
    @touchstart="clickInside"
  >
    <slot />
  </div>
  <div
    v-if="isDragging"
    :style="{
      position: 'absolute',
      left: object.x + 'px',
      top: object.y + 'px',
      width: object.w + 'px',
      height: object.h + 'px',
      transform: `rotate(${object.rotate}deg)`,
      opacity: object.opacity,
      filter: `grayscale(${object.liveAction === false ? 1 : 0})`,
    }"
  >
    <slot />
  </div>
</template>

<style></style>
