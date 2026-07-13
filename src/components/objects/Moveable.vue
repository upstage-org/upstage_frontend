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
      .on("resizeEnd", ({ target, lastEvent }) => {
        // lastEvent is undefined when a handle is grabbed and released
        // without moving (easy to do on touch) — same guard dragEnd has.
        if (lastEvent) {
          const {
            width,
            height,
            drag: { left, top },
          } = lastEvent;
          sendResize(target, { left, top, width, height });
        }
        isDragging.value = false;
      });

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
      .on("rotateEnd", ({ target, lastEvent }) => {
        if (lastEvent) {
          sendRotation(target, lastEvent.rotate);
        }
        isDragging.value = false;
      });

    const showControls = (isShowing, e) => {
      if (moveable) {
        if (isShowing) {
          moveable.setState(
            {
              target: el.value,
              // Live RTMP tiles keep their proportions like every other
              // media object (jitsi philosophy: the <video> uses
              // object-fit: cover, so the picture is never distorted —
              // performers reshape the picture in OBS, not on stage).
              keepRatio: !["text", "meeting"].includes(props.object.type),
            },
            () => {
              // Adopt the in-flight gesture so a single mousedown both
              // selects and drags. MOUSE ONLY: gesto cannot adopt an
              // in-flight touch (the stored touchstart is stale by the time
              // this async callback runs) and the attempt corrupts its state
              // — every later touchmove then throws "Cannot set properties
              // of null (setting 'dist')" and the object never moves. On
              // touch the first tap selects; moveable's own listeners on the
              // now-set target handle the next touch gesture natively.
              if (e && props.object.type !== "text" && !("touches" in e)) {
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

    // Timestamp of the last touch on this object, to recognise the
    // compatibility mouse events (mousedown/mouseup/click) the browser
    // synthesises right after every tap.
    let lastTouchAt = 0;

    const clickInside = (e) => {
      if (replaying) return;
      if (props.controlable && canPlay.value) {
        if ("touches" in e) {
          lastTouchAt = Date.now();
          // Touch on an ALREADY-selected object: moveable's own listeners
          // on the target are handling this very gesture. Re-running
          // setState here re-renders moveable mid-gesture, which wipes its
          // internal state.dragInfo — every subsequent move then throws
          // ("Cannot set properties of null (setting 'dist')") and the
          // object never moves.
          if (stageStore.activeMovable === props.object.id) {
            return;
          }
        } else if (Date.now() - lastTouchAt < 800) {
          // Compatibility mousedown synthesised after a tap. The touchstart
          // branch above already selected the object; letting this through
          // would call moveable.dragStart() on a gesture that is already
          // over, corrupting gesto's drag state so the next real touch drag
          // does nothing.
          return;
        }
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
      /* Players drag objects with a finger: without this the browser claims
         the gesture and pans the page instead. Audience (not controlable)
         keeps default scrolling. */
      'touch-action': controlable ? 'none' : 'auto',
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
