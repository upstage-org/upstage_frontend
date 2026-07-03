// @ts-nocheck
import { computed, onMounted, reactive, ref, watch } from "vue";
import * as canvasUtil from "utils/canvas";

const eraseDot = (ctx, { x, y, size }) => {
  ctx.globalCompositeOperation = "destination-out";
  // Erase is always full alpha (destination-out semantics): drawDot would
  // otherwise respect the current globalAlpha and produce partial erases,
  // which doesn't match how the eraser is supposed to behave.
  const previousAlpha = ctx.globalAlpha;
  ctx.globalAlpha = 1;
  drawDot(ctx, { x, y, size, color: "white" });
  ctx.globalAlpha = previousAlpha;
  ctx.globalCompositeOperation = "source-over";
};

const drawDot = (ctx, { x, y, size, color, alpha }) => {
  const previousAlpha = ctx.globalAlpha;
  if (alpha !== undefined && alpha !== null) {
    ctx.globalAlpha = alpha;
  }
  ctx.beginPath();
  ctx.arc(x, y, size / 2, 0, Math.PI * 2, true);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = previousAlpha;
};

const draw = (ctx, { fromX, fromY, x, y, size, color, alpha }) => {
  const previousAlpha = ctx.globalAlpha;
  if (alpha !== undefined && alpha !== null) {
    ctx.globalAlpha = alpha;
  }
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(x, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.stroke();
  ctx.closePath();
  // Pass alpha through to drawDot for the rounded line cap; it manages its
  // own save/restore of globalAlpha.
  drawDot(ctx, { x: fromX, y: fromY, size, color, alpha });
  ctx.globalAlpha = previousAlpha;
};

const wait = (milisecond) => new Promise((res) => setTimeout(res, milisecond));

// Delay between line segments when replaying a saved drawing for the audience.
// Tuned so a typical stroke reads as a live pen rather than an instant flicker.
const STROKE_SEGMENT_DELAY_MS = 25;

const execute = async (ctx, command, animate) => {
  const { type, size, color, alpha, lines } = command;
  if (lines && lines.length) {
    if (type === "draw") {
      for (let i = 0; i < lines.length; i++) {
        const { fromX, fromY, x, y } = lines[i];
        draw(ctx, {
          fromX,
          fromY,
          x,
          y,
          size,
          color,
          alpha,
        });
        if (animate) {
          await wait(STROKE_SEGMENT_DELAY_MS);
        }
      }
    } else {
      lines.forEach(({ x, y }) =>
        eraseDot(ctx, {
          x,
          y,
          size,
        }),
      );
    }
  } else {
    if (type === "draw") {
      if (command.fromX && command.fromY) {
        draw(ctx, command);
      } else {
        drawDot(ctx, command);
      }
    } else {
      eraseDot(ctx, command);
    }
  }
};

export const useDrawable = () => {
  const color = ref("#000");
  const size = ref(10);
  // Per-stroke alpha for live drawing. Default 1 = today's behavior. Sampled
  // at stroke-build time the same way size/color are, so the slider only
  // affects the NEXT stroke, not in-flight ones — matches the size/color
  // mental model.
  const alpha = ref(1);
  const mode = ref("draw");
  const el = ref(null);

  const data = reactive({
    lines: [],
  });

  const history = reactive([]);

  const cropImageFromCanvas = () => {
    return canvasUtil.cropImageFromCanvas(el.value);
  };

  const getDrawedArea = () => {
    return canvasUtil.clipDrawedArea(el.value);
  };

  const findxy = (res, e) => {
    const { value: canvas } = el;
    const ctx = canvas.getContext("2d");
    const { left, top } = canvas.getBoundingClientRect();
    if (res == "down") {
      data.prevX = data.currX;
      data.prevY = data.currY;
      data.currX = e.clientX - left;
      data.currY = e.clientY - top;

      data.lines = [];
      data.flag = true;
      data.dot_flag = true;

      let command = {
        type: mode.value,
        x: data.currX,
        y: data.currY,
        size: size.value,
        color: color.value,
        alpha: alpha.value,
      };
      execute(ctx, command);
    }
    if (res == "up") {
      data.flag = false;
      history.push({
        type: mode.value,
        size: size.value,
        color: color.value,
        alpha: alpha.value,
        lines: data.lines,
        x: data.currX,
        y: data.currY,
      });
    }
    if (res == "move") {
      if (data.flag) {
        data.prevX = data.currX;
        data.prevY = data.currY;
        data.currX = e.clientX - left;
        data.currY = e.clientY - top;
        const coords = {
          x: data.currX,
          y: data.currY,
          fromX: data.prevX,
          fromY: data.prevY,
        };
        let command = {
          type: mode.value,
          size: size.value,
          color: color.value,
          alpha: alpha.value,
          ...coords,
        };
        execute(ctx, command);
        data.lines.push(coords);
      }
    }
  };

  /*
   * Pointer events unify mouse, touch, and pen input on every modern
   * browser. The previous mouse-only listener set produced "only dots,
   * not lines" on tablets because browsers no longer synthesize
   * `mousemove` from `touchmove` — unhandled touch drags are eaten by
   * the browser's scroll/pinch/pan gestures.
   *
   * Two pieces that have to go together:
   *   - `touch-action: none` on the canvas via the consuming
   *     templates (see Whiteboard / Draw / WhiteboardTools .vue)
   *     so the browser doesn't intercept the first touchmove.
   *   - `setPointerCapture(pointerId)` on pointerdown so the
   *     pointermove / pointerup pair keeps firing if the finger
   *     drifts off the canvas (replaces the old `mouseout` cleanup).
   *
   * Pen-pressure (`e.pressure`) is intentionally NOT consumed yet —
   * leaving the existing fixed `size` UX in place. Easy to add later.
   */
  const attachEventLinsteners = () => {
    const { value: canvas } = el;
    if (!canvas) return;
    history.length = 0;

    // Belt-and-braces: ensure touch-action is set on the element
    // itself, even if a consuming template forgot. Without this,
    // iOS Safari's default page-pan kicks in on the very first
    // touchmove regardless of pointer handlers.
    canvas.style.touchAction = "none";

    // Real-device hardening (emulated touch never hits this): several
    // WebKit builds (iPadOS Safari in particular) still hand the touch to
    // the native scroll/zoom/system-gesture recognizer even with
    // `touch-action: none`, which fires `pointercancel` after the first
    // point — the reported "dots, not lines" on tablets. Explicitly
    // consuming the raw touch events (non-passive, so preventDefault is
    // honoured) stops the native gesture pipeline before it can steal the
    // stroke; pointer events still fire normally and drive the drawing.
    const stopNativeTouch = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
    };
    canvas.addEventListener("touchstart", stopNativeTouch, { passive: false });
    canvas.addEventListener("touchmove", stopNativeTouch, { passive: false });

    canvas.addEventListener("pointerdown", (e) => {
      // Only respond to the primary contact. Multi-touch (e.g. a
      // second finger landing mid-stroke) is ignored to avoid the
      // stroke jumping between fingers.
      if (!e.isPrimary) return;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // setPointerCapture is allowed to throw if the pointer
        // is no longer active by the time we get here (race during
        // synthetic events). Swallow — the rest still works.
      }
      findxy("down", e);
    });

    canvas.addEventListener("pointermove", (e) => {
      if (!e.isPrimary) return;
      findxy("move", e);
    });

    const endStroke = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
      findxy("up", e);
    };

    canvas.addEventListener("pointerup", endStroke);
    // pointercancel fires when the OS / browser yanks the pointer
    // (e.g. system gesture, app switch). Treat it like pointerup so
    // we don't leave `data.flag` stuck on, which would replay the
    // first move of the next gesture as a giant line from wherever
    // the previous stroke ended.
    canvas.addEventListener("pointercancel", endStroke);
  };

  onMounted(attachEventLinsteners);

  const clearCanvas = (clearHistory) => {
    const { value: canvas } = el;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (clearHistory) {
      history.length = 0;
    }
    return ctx;
  };

  const undo = () => {
    const ctx = clearCanvas();
    history.pop();
    history.forEach((command) => execute(ctx, command));
    return ctx;
  };

  const cursor = computed(() => {
    const canvas = document.createElement("canvas");
    canvas.width = size.value;
    canvas.height = size.value;
    const ctx = canvas.getContext("2d");
    ctx.beginPath();
    const r = size.value / 2;
    ctx.arc(r, r, r, 0, Math.PI * 2, true);
    ctx.closePath();
    if (mode.value === "draw") {
      ctx.fillStyle = color.value;
    } else if (mode.value === "erase") {
      ctx.fillStyle = "white";
    }
    ctx.fill();
    return `url(${canvas.toDataURL()}) ${r} ${r}, pointer`;
  });

  const toggleErase = () => {
    if (mode.value === "erase") {
      mode.value = "draw";
    } else {
      mode.value = "erase";
    }
  };

  return {
    el,
    cursor,
    color,
    size,
    alpha,
    mode,
    history,
    cropImageFromCanvas,
    getDrawedArea,
    clearCanvas,
    undo,
    toggleErase,
  };
};

export const useRelativeCommands = (drawing) =>
  computed(() => {
    if (!drawing.value.commands) {
      return [];
    }
    const { commands, original, w, h } = drawing.value;
    const ratio = Math.min(w / original.w, h / original.h);
    return commands.map((command) => ({
      ...command,
      size: command.size * ratio,
      x: (command.x - original.x) * ratio,
      y: (command.y - original.y) * ratio,
      lines: command.lines.map((line) => ({
        x: (line.x - original.x) * ratio,
        y: (line.y - original.y) * ratio,
        fromX: (line.fromX - original.x) * ratio,
        fromY: (line.fromY - original.y) * ratio,
      })),
    }));
  });

export const useDrawing = (drawing) => {
  const el = ref(null);
  const commands = useRelativeCommands(drawing);

  const draw = async (newDrawing, oldDrawing) => {
    if (!drawing.value) return;
    const { value: canvas } = el;
    canvas.width = drawing.value.w;
    canvas.height = drawing.value.h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < commands.value.length; i++) {
      const command = commands.value[i];
      let shouldAnimate = true;
      if (newDrawing && oldDrawing && oldDrawing.commands) {
        if (i < oldDrawing.commands.length) {
          shouldAnimate = false;
        }
      }
      await execute(ctx, command, shouldAnimate);
    }
    return ctx;
  };

  watch(drawing, draw);
  onMounted(draw);

  return { el };
};
