<script>
import { ref, inject } from "vue";
import { computed, onMounted, onUnmounted, watch } from "vue";
import Moveable from "moveable";
import { isJitsiBoardType, throttle } from "@utils/common";
import { useStageStore } from "@stores/pinia/stage";
import { animate } from "animejs";

// Real-time movement: while the performer drags, the object's position is
// published every LIVE_MOVE_INTERVAL_MS (see the "Real-time movement" block
// in the stage store). Receivers tween each live position over
// LIVE_MOVE_TWEEN_MS — a touch longer than the interval so consecutive
// updates chain into continuous motion instead of stop-start steps.
export const LIVE_MOVE_INTERVAL_MS = 100;
export const LIVE_MOVE_TWEEN_MS = 150;

export default {
  props: {
    object: Object,
    controlable: Boolean,
    active: Boolean,
  },
  emits: ["update:active"],
  setup: (props, { emit }) => {
    const el = ref();
    // Any moveable gesture in flight (drag / resize / rotate).
    const isDragging = ref(false);
    // A gesture whose intermediate states are published live (drag-move and
    // rotate). The element under the pointer IS the object everyone else is
    // watching: no ghost copy at the "old" state and no half-opacity
    // preview. Resize still publishes on release and keeps the ghost.
    const liveDragging = ref(false);
    const ghosting = computed(() => isDragging.value && !liveDragging.value);

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
    // Leading-edge throttle: the first move publishes at once, later ones
    // at most every LIVE_MOVE_INTERVAL_MS. Whatever falls inside the last
    // window is covered by dragEnd's final (non-live) sendMovement.
    const sendLiveMovement = throttle((left, top) => {
      stageStore.shapeObject(
        {
          ...props.object,
          x: left,
          y: top,
        },
        { live: true },
      );
    }, LIVE_MOVE_INTERVAL_MS);
    moveable
      .on("dragStart", () => {
        isDragging.value = true;
        liveDragging.value = true;
        if (animation) {
          animation.pause(true);
        }
      })
      .on("drag", ({ target, left, top }) => {
        target.style.left = `${left}px`;
        target.style.top = `${top}px`;
        sendLiveMovement(left, top);
      })
      .on("dragEnd", ({ lastEvent, target }) => {
        if (lastEvent) {
          sendMovement(target, lastEvent);
        }
        isDragging.value = false;
        liveDragging.value = false;
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
    // Same leading-edge throttle as drag-move: the tilt handle publishes the
    // angle while it is held so everyone watches the object tip over as it
    // happens (the red bulb state exists for objects that must be posed
    // before they are shown). rotateEnd's final (non-live) sendRotation
    // covers whatever fell inside the last throttle window.
    const sendLiveRotation = throttle((rotate) => {
      stageStore.shapeObject(
        {
          ...props.object,
          rotate,
        },
        { live: true },
      );
    }, LIVE_MOVE_INTERVAL_MS);
    moveable
      .on("rotateStart", (e) => {
        e.set(props.object.rotate ?? 0);
        isDragging.value = true;
        liveDragging.value = true;
        if (animation) {
          animation.pause(true);
        }
      })
      .on("rotate", ({ target, rotate }) => {
        target.style.transform = `rotate(${rotate}deg)`;
        sendLiveRotation(rotate);
      })
      .on("rotateEnd", ({ target, lastEvent }) => {
        if (lastEvent) {
          sendRotation(target, lastEvent.rotate);
        }
        isDragging.value = false;
        liveDragging.value = false;
      });

    const showControls = (isShowing, e) => {
      if (moveable) {
        if (isShowing) {
          moveable.setState(
            {
              target: el.value,
              // Live stream tiles (jitsi + RTMP) resize freely: the frame
              // stretches in any direction and the picture fills it
              // (object-fit via --stream-fit in Jitsi.vue /
              // LiveStreamPlayer.vue: crop by default, stretch opt-in) —
              // superseding the old "reshape in OBS, keep proportions on
              // stage" rule. Avatars, props, images and VoD clips stay
              // ratio-locked.
              keepRatio:
                !["text", "meeting"].includes(props.object.type) &&
                !isJitsiBoardType(props.object.type) &&
                props.object.isRTMP !== true,
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
        // Our own live publishes come straight back as store updates; the
        // drag/rotate handler already owns the element's position or angle,
        // and tweening it toward a (slightly older) published value would
        // fight the pointer. Resize doesn't publish mid-gesture, so it keeps
        // reacting to remote updates as before.
        if (liveDragging.value) {
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
        // Another performer is dragging this object live (or its wearer):
        // follow at the publish cadence, linearly, so the path they trace
        // is what the audience sees — `moveSpeed` applies to the release
        // move and every other move, not to the drag itself.
        const liveMove = stageStore.isLiveMoving(x.id);
        animation = animate(el.value, {
          left,
          top,
          width,
          height,
          rotate,
          opacity,
          scaleX,
          scaleY,
          // Slow, deliberate moves travel at constant speed; quick ones keep
          // animejs's default decelerating `out(2)`. animejs v4 reads
          // `ease` — the v3 `easing` key this used to carry was silently
          // ignored since the v4 upgrade, so every slow glide coasted.
          ...(moveSpeed > 1000 ? { ease: "linear" } : {}),
          ...(liveMove ? { ease: "linear" } : {}),
          // While a text object is in editing mode its frame is grown by
          // fitFrameToText on every keystroke; tweening that growth over
          // moveSpeed leaves the just-typed line clipped for seconds (the
          // box may not be scrolled to reveal it — Text.vue pins the
          // clip-box scroll at 0). Track the text instantly instead.
          // `editing` only ever exists on text objects.
          duration: x.editing
            ? 0
            : liveMove
              ? LIVE_MOVE_TWEEN_MS
              : (moveSpeed ?? config.animateDuration),
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

    return { el, ghosting, clickInside, clickOutside, transformOrigin, activeMovable };
  },
};
</script>

<template>
  <div
    ref="el"
    v-click-outside="clickOutside"
    :style="{
      position: 'absolute',
      opacity: object.opacity * (ghosting ? 0.5 : 1),
      filter: `grayscale(${object.liveAction === false ? 1 : 0})`,
      'transform-origin': transformOrigin,
      /* Players drag objects with a finger: without this the browser claims
         the gesture and pans the page instead. Audience (not controlable)
         keeps default scrolling. */
      'touch-action': controlable ? 'none' : 'auto',
      /* Selected object (green frame) is raised LOCALLY so a Depth-bar
         rollover makes a buried object clickable/draggable through the
         objects stacked over it — the whole point of the Depth tool. The
         raise must live on THIS wrapper: the always-set `filter` above (and
         `opacity` < 1) makes the wrapper a stacking context, so the old
         z-index raise on the inner `.object` (Object.vue) could never
         escape it and clicks kept landing on the covering object. Local
         render state only — depth order on the board (and for everyone
         else) is untouched. 30 stays under the object's own control overlay
         (z-index 100 in Object.vue). */
      ...(activeMovable ? { zIndex: 30 } : {}),
    }"
    @mousedown="clickInside"
    @touchstart="clickInside"
  >
    <slot />
  </div>
  <div
    v-if="ghosting"
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
