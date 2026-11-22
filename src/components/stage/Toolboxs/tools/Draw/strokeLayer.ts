/**
 * Smooth translucent strokes (#981).
 *
 * A stroke is drawn as a chain of short segments, each with a round dot at
 * its start for the rounded join. Painting every one of those with the
 * stroke's opacity made each overlap twice as dark as the rest — the line
 * came out as a string of dots. The stroke has to be blended ONCE:
 * its segments are drawn fully opaque on a scratch layer the size of the
 * target canvas, and that layer is then laid over the target at the stroke's
 * opacity. Where the stroke crosses itself it stays one even colour; a
 * second stroke over it still darkens, as paint would.
 *
 * Opaque strokes (opacity 1, or none recorded — every drawing made before
 * the opacity slider existed) never come through here and are painted
 * exactly as before.
 */

type Ctx = CanvasRenderingContext2D;
type Canvas = HTMLCanvasElement;

/** A stroke that needs blending as a whole: an opacity below 1. */
export function isTranslucent(alpha: unknown): alpha is number {
  return typeof alpha === "number" && Number.isFinite(alpha) && alpha < 1;
}

export interface StrokeLayer {
  /** Draw this stroke's dots and segments here, fully opaque. */
  ctx: Ctx;
  /** Show the stroke so far on the target, at the stroke's opacity. */
  present(): void;
}

interface Scratch {
  layer: Canvas;
  base: Canvas;
}

// One pair of scratch canvases per target, reused for every stroke: mobile
// Safari caps total canvas memory, so allocating a pair per stroke of a long
// drawing would run it out before the collector gets to them.
const scratchOf = new WeakMap<Canvas, Scratch>();

let createCanvas = (): Canvas => document.createElement("canvas");

/** Test seam: jsdom has no 2D canvas. Returns the previous factory. */
export function setCanvasFactory(factory: () => Canvas): () => Canvas {
  const previous = createCanvas;
  createCanvas = factory;
  return previous;
}

/**
 * Start a translucent stroke on `target`.
 *
 * `incremental`: the stroke will be shown while it grows (live drawing, or a
 * replay animated for the audience). The target is then snapshotted first,
 * and every `present()` repaints snapshot + stroke-so-far. Without it,
 * `present()` is called once when the stroke is complete and simply lays it
 * on top.
 *
 * Returns null when a layer cannot be made (zero-sized canvas, no 2D
 * context); the caller then paints the old way.
 */
export function beginStroke(
  target: Ctx,
  alpha: number,
  { incremental = false }: { incremental?: boolean } = {},
): StrokeLayer | null {
  const canvas = target?.canvas;
  if (!canvas || !canvas.width || !canvas.height) return null;
  let scratch = scratchOf.get(canvas);
  if (!scratch) {
    scratch = { layer: createCanvas(), base: createCanvas() };
    scratchOf.set(canvas, scratch);
  }
  const { layer, base } = scratch;
  const layerCtx = layer.getContext("2d");
  if (!layerCtx) return null;
  // Assigning the size also clears the canvas.
  layer.width = canvas.width;
  layer.height = canvas.height;
  if (incremental) {
    const baseCtx = base.getContext("2d");
    if (!baseCtx) return null;
    base.width = canvas.width;
    base.height = canvas.height;
    baseCtx.drawImage(canvas, 0, 0);
  }
  const opacity = Math.max(0, alpha);
  return {
    ctx: layerCtx,
    present() {
      target.save();
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.globalCompositeOperation = "source-over";
      if (incremental) {
        target.globalAlpha = 1;
        target.clearRect(0, 0, canvas.width, canvas.height);
        target.drawImage(base, 0, 0);
      }
      target.globalAlpha = opacity;
      target.drawImage(layer, 0, 0);
      target.restore();
    },
  };
}
