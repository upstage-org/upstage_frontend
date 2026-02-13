// @ts-nocheck
import { computed, onMounted, reactive, ref, watch } from "vue";
import * as canvasUtil from "utils/canvas";

const eraseDot = (ctx, { x, y, size }) => {
  ctx.globalCompositeOperation = "destination-out";
  drawDot(ctx, { x, y, size, color: "white" });
  ctx.globalCompositeOperation = "source-over";
};

const drawDot = (ctx, { x, y, size, color }) => {
  ctx.beginPath();
  ctx.arc(x, y, size / 2, 0, Math.PI * 2, true);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
};

const draw = (ctx, { fromX, fromY, x, y, size, color }) => {
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(x, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.stroke();
  ctx.closePath();
  drawDot(ctx, { x: fromX, y: fromY, size, color });
};

const wait = (milisecond) => new Promise((res) => setTimeout(res, milisecond));

const DEFAULT_STROKE_COLOR = "#000000";

const execute = async (ctx, command, animate, onAfterSegment) => {
  const color = command.color ?? DEFAULT_STROKE_COLOR;
  const { type, size, lines } = command;
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
        });
        if (animate) {
          onAfterSegment?.(ctx.canvas);
          await wait(10);
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
      if (command.fromX != null && command.fromY != null) {
        draw(ctx, { ...command, color });
      } else {
        drawDot(ctx, { ...command, color });
      }
    } else {
      eraseDot(ctx, command);
    }
  }
};

export const useDrawable = (options = {}) => {
  const { onStrokeEnd } = options;
  const color = ref("#000");
  const size = ref(10);
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
      };
      execute(ctx, command);
    }
    if (res == "up") {
      const hadStrokeInProgress = data.flag;
      data.flag = false;
      // Only end a stroke if we actually started one (mousedown was received).
      // Some browsers (e.g. Brave) can fire a spurious mouseup from the color widget without mousedown.
      if (!hadStrokeInProgress) return;
      const lines = data.lines || [];
      const snapshot = {
        type: mode.value,
        size: size.value,
        color: color.value,
        lines: lines.map((l) => ({ ...l })),
        x: data.currX,
        y: data.currY,
      };
      history.push(snapshot);
      if (lines.length > 0) {
        onStrokeEnd?.(snapshot);
      }
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
          ...coords,
        };
        execute(ctx, command);
        data.lines.push(coords);
      }
    }
  };

  const attachEventLinsteners = () => {
    const { value: canvas } = el;
    if (canvas) {
      history.length = 0;
      canvas.addEventListener(
        "mousemove",
        (e) => {
          findxy("move", e);
        },
        false,
      );
      canvas.addEventListener(
        "mousedown",
        (e) => {
          findxy("down", e);
        },
        false,
      );
      canvas.addEventListener(
        "mouseup",
        (e) => {
          findxy("up", e);
        },
        false,
      );
      canvas.addEventListener(
        "mouseout",
        (e) => {
          findxy("out", e);
        },
        false,
      );
    }
  };

  onMounted(attachEventLinsteners);

  const clearCanvas = (clearHistory) => {
    const { value: canvas } = el;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (clearHistory) {
      history.length = 0;
      data.lines = [];
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
      color: command.color ?? DEFAULT_STROKE_COLOR,
      size: command.size * ratio,
      x: (command.x - original.x) * ratio,
      y: (command.y - original.y) * ratio,
      lines: (command.lines || []).map((line) => ({
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
    const w = drawing.value.w;
    const h = drawing.value.h;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    // Draw to offscreen first so we never show an empty canvas (avoids white flash when redrawing)
    const offscreen = document.createElement("canvas");
    offscreen.width = w;
    offscreen.height = h;
    const offCtx = offscreen.getContext("2d");
    offCtx.clearRect(0, 0, w, h);
    // After each animated segment, blit offscreen to visible so the audience sees the stroke being drawn
    const blitToVisible = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(offscreen, 0, 0);
    };
    for (let i = 0; i < commands.value.length; i++) {
      const command = commands.value[i];
      let shouldAnimate = true;
      if (newDrawing && oldDrawing && oldDrawing.commands) {
        if (i < oldDrawing.commands.length) {
          shouldAnimate = false;
        }
      }
      if (shouldAnimate) {
        blitToVisible();
      }
      await execute(
        offCtx,
        command,
        shouldAnimate,
        shouldAnimate ? blitToVisible : undefined,
      );
    }
    blitToVisible();
    return ctx;
  };

  watch(drawing, draw);
  onMounted(draw);

  return { el };
};
