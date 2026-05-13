import { onBeforeUnmount, ref, type Ref } from "vue";

/**
 * Mouse + touch drag for a fixed-position panel element. Used by the
 * on-stage tool panel ([components/stage/Toolboxs/TopBar.vue]) and the
 * public chat card ([components/stage/Chat/index.vue]) to let logged-in
 * players reposition their palettes; PlayerChat keeps its own
 * Moveable.js-based drag because it also needs resize.
 *
 * Position is stored externally (typically in the Pinia stage store so
 * it survives tool switches but resets on stage re-entry via
 * CLEAN_STAGE — matching the "restore default at each stage re-entry"
 * UX request). The composable only owns the transient mouse/touch
 * tracking; it calls `setPosition(null)` is *not* part of the public
 * API — call sites trigger the reset themselves via their own UI.
 *
 * Viewport clamping uses the panel's getBoundingClientRect() at
 * pointer-down time, so a panel with width: fit-content is clamped
 * against its actual rendered width (matches the existing PlayerChat
 * approach in [components/stage/Chat/PlayerChat.vue]).
 */
export function useDraggablePanel(opts: {
  panelEl: Ref<HTMLElement | null | undefined>;
  setPosition: (pos: { x: number; y: number }) => void;
  /**
   * Optional: skip dragging entirely (e.g. when a panel is rendered
   * inside the standalone /chat/<stage> view, where the host browser
   * window IS the panel). When this returns true the startDrag
   * handler short-circuits with no event listeners installed.
   */
  disabled?: () => boolean;
}) {
  const isDragging = ref<boolean>(false);

  let mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  let mouseUpHandler: (() => void) | null = null;
  let touchMoveHandler: ((e: TouchEvent) => void) | null = null;
  let touchEndHandler: (() => void) | null = null;

  const cleanup = () => {
    if (mouseMoveHandler) document.removeEventListener("mousemove", mouseMoveHandler);
    if (mouseUpHandler) document.removeEventListener("mouseup", mouseUpHandler);
    if (touchMoveHandler) document.removeEventListener("touchmove", touchMoveHandler);
    if (touchEndHandler) document.removeEventListener("touchend", touchEndHandler);
    mouseMoveHandler = mouseUpHandler = null;
    touchMoveHandler = touchEndHandler = null;
    isDragging.value = false;
  };

  const clamp = (
    clientX: number,
    clientY: number,
    offsetX: number,
    offsetY: number,
    rectWidth: number,
    rectHeight: number,
  ) => {
    const newX = clientX - offsetX;
    const newY = clientY - offsetY;
    const ww = window.innerWidth;
    const wh = window.innerHeight;
    return {
      x: Math.max(0, Math.min(newX, ww - rectWidth)),
      y: Math.max(0, Math.min(newY, wh - rectHeight)),
    };
  };

  const startDrag = (e: MouseEvent | TouchEvent) => {
    if (opts.disabled?.()) return;
    const el = opts.panelEl.value;
    if (!el) return;

    e.preventDefault();

    const rect = el.getBoundingClientRect();
    const isTouch = "touches" in e;
    const startClientX = isTouch ? e.touches[0].clientX : (e as MouseEvent).clientX;
    const startClientY = isTouch ? e.touches[0].clientY : (e as MouseEvent).clientY;
    const offsetX = startClientX - rect.left;
    const offsetY = startClientY - rect.top;

    isDragging.value = true;

    if (isTouch) {
      touchMoveHandler = (ev: TouchEvent) => {
        if (!ev.touches[0]) return;
        const pos = clamp(
          ev.touches[0].clientX,
          ev.touches[0].clientY,
          offsetX,
          offsetY,
          rect.width,
          rect.height,
        );
        opts.setPosition(pos);
      };
      touchEndHandler = cleanup;
      document.addEventListener("touchmove", touchMoveHandler, { passive: false });
      document.addEventListener("touchend", touchEndHandler);
    } else {
      mouseMoveHandler = (ev: MouseEvent) => {
        const pos = clamp(
          ev.clientX,
          ev.clientY,
          offsetX,
          offsetY,
          rect.width,
          rect.height,
        );
        opts.setPosition(pos);
      };
      mouseUpHandler = cleanup;
      document.addEventListener("mousemove", mouseMoveHandler);
      document.addEventListener("mouseup", mouseUpHandler);
    }
  };

  onBeforeUnmount(cleanup);

  return { startDrag, isDragging };
}
