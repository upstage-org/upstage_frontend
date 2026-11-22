import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { beginStroke, isTranslucent, setCanvasFactory } from "./strokeLayer";

/**
 * #981: a translucent stroke is drawn opaque on a scratch layer and blended
 * onto the target once, so overlapping segments do not show as dots.
 * jsdom has no 2D canvas, so the canvases here record what is done to them.
 */

type Op = { op: string; alpha: number; composite: string; source?: unknown };

function fakeCanvas(width = 0, height = 0) {
  const ops: Op[] = [];
  const canvas = { width, height, ops } as unknown as HTMLCanvasElement & { ops: Op[] };
  const ctx = {
    canvas,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    stack: [] as { a: number; c: string }[],
    save() {
      this.stack.push({ a: this.globalAlpha, c: this.globalCompositeOperation });
    },
    restore() {
      const s = this.stack.pop()!;
      this.globalAlpha = s.a;
      this.globalCompositeOperation = s.c;
    },
    setTransform() {},
    clearRect() {
      ops.push({ op: "clear", alpha: this.globalAlpha, composite: this.globalCompositeOperation });
    },
    drawImage(source: unknown) {
      ops.push({
        op: "drawImage",
        alpha: this.globalAlpha,
        composite: this.globalCompositeOperation,
        source,
      });
    },
  };
  (canvas as unknown as { getContext: () => unknown }).getContext = () => ctx;
  return { canvas, ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

let made: ReturnType<typeof fakeCanvas>[] = [];
let restoreFactory: () => HTMLCanvasElement;

beforeEach(() => {
  made = [];
  restoreFactory = setCanvasFactory(() => {
    const c = fakeCanvas();
    made.push(c);
    return c.canvas;
  });
});
afterEach(() => {
  setCanvasFactory(restoreFactory);
});

describe("isTranslucent", () => {
  it("is true only for a numeric opacity below 1", () => {
    expect(isTranslucent(0.4)).toBe(true);
    expect(isTranslucent(0)).toBe(true);
    expect(isTranslucent(1)).toBe(false);
    expect(isTranslucent(undefined)).toBe(false); // drawings made before the slider
    expect(isTranslucent(null)).toBe(false);
    expect(isTranslucent("0.5")).toBe(false);
    expect(isTranslucent(NaN)).toBe(false);
  });
});

describe("beginStroke", () => {
  it("gives a scratch layer the size of the target to draw the stroke on", () => {
    const target = fakeCanvas(800, 450);
    const stroke = beginStroke(target.ctx, 0.4)!;
    expect(stroke).not.toBeNull();
    const layer = made[0];
    expect(stroke.ctx.canvas).toBe(layer.canvas);
    expect([layer.canvas.width, layer.canvas.height]).toEqual([800, 450]);
    // nothing touches the target until the stroke is presented
    expect(target.ops).toEqual([]);
  });

  it("a finished stroke is laid over the target once, at its opacity", () => {
    const target = fakeCanvas(800, 450);
    const stroke = beginStroke(target.ctx, 0.4)!;
    stroke.present();
    expect(target.ops).toEqual([
      { op: "drawImage", alpha: 0.4, composite: "source-over", source: made[0].canvas },
    ]);
    // and the target's own state is left as it was
    expect(target.ctx.globalAlpha).toBe(1);
  });

  it("a growing stroke repaints what was there before plus the stroke so far", () => {
    const target = fakeCanvas(800, 450);
    const stroke = beginStroke(target.ctx, 0.25, { incremental: true })!;
    const [layer, base] = made;
    // the target was snapshotted before the stroke started
    expect(base.ops).toEqual([
      { op: "drawImage", alpha: 1, composite: "source-over", source: target.canvas },
    ]);
    stroke.present();
    stroke.present();
    const once = [
      { op: "clear", alpha: 1, composite: "source-over" },
      { op: "drawImage", alpha: 1, composite: "source-over", source: base.canvas },
      { op: "drawImage", alpha: 0.25, composite: "source-over", source: layer.canvas },
    ];
    // every present starts again from the snapshot: the stroke never
    // accumulates on top of itself
    expect(target.ops).toEqual([...once, ...once]);
  });

  it("reuses one pair of scratch canvases per target, cleared for each stroke", () => {
    const target = fakeCanvas(300, 200);
    beginStroke(target.ctx, 0.5, { incremental: true });
    beginStroke(target.ctx, 0.5, { incremental: true });
    beginStroke(target.ctx, 0.5);
    expect(made).toHaveLength(2);
    const other = fakeCanvas(300, 200);
    beginStroke(other.ctx, 0.5);
    expect(made).toHaveLength(4);
  });

  it("follows a target that changed size", () => {
    const target = fakeCanvas(300, 200);
    beginStroke(target.ctx, 0.5);
    target.canvas.width = 640;
    target.canvas.height = 360;
    beginStroke(target.ctx, 0.5);
    expect([made[0].canvas.width, made[0].canvas.height]).toEqual([640, 360]);
  });

  it("declines (so the caller paints the old way) when no layer can be made", () => {
    expect(beginStroke(fakeCanvas(0, 0).ctx, 0.5)).toBeNull();
    expect(beginStroke({} as CanvasRenderingContext2D, 0.5)).toBeNull();
    setCanvasFactory(
      () => ({ width: 0, height: 0, getContext: () => null }) as unknown as HTMLCanvasElement,
    );
    expect(beginStroke(fakeCanvas(100, 100).ctx, 0.5)).toBeNull();
  });
});
