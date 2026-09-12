import { describe, expect, it } from "vitest";
import {
  FRAME_FITS,
  FRAME_SHAPES,
  containedPictureBox,
  effectiveFrameFitId,
  effectiveFrameShapeId,
  frameShapeStyle,
} from "./frameShapes";

describe("frameShapes registry", () => {
  it("offers the full preset set", () => {
    expect(FRAME_SHAPES.map((s) => s.id)).toEqual([
      "rect",
      "rounded",
      "circle",
      "diamond",
      "hexagon",
      "triangle",
      "star",
      "heart",
      "arch",
    ]);
  });

  // The tiles resize freely in any direction; a shape expressed in px
  // coordinates or path() would not stretch with the frame.
  it("uses only border-radius or %-coordinate clip-paths", () => {
    for (const s of FRAME_SHAPES) {
      const { borderRadius, clipPath } = s.style;
      expect(borderRadius || clipPath, s.id).toBeTruthy();
      if (clipPath) {
        expect(clipPath, s.id).toMatch(/^polygon\(/);
        expect(clipPath, s.id).not.toMatch(/px|path\(/);
      }
    }
  });
});

describe("frameShapeStyle legacy/default contract", () => {
  it("keeps the per-kind default look for null/absent shapes", () => {
    // Untouched jitsi tiles have always been 12px-rounded...
    expect(frameShapeStyle(null, "jitsi")).toEqual({ borderRadius: "12px" });
    expect(frameShapeStyle(undefined, "jitsi")).toEqual({ borderRadius: "12px" });
    // ...and untouched RTMP tiles sharp (no clip).
    expect(frameShapeStyle(null, "rtmp")).toEqual({ borderRadius: "0" });
    expect(frameShapeStyle(null, "rtmp").clipPath).toBeUndefined();
  });

  it("renders legacy 'circle' broadcasts round for both kinds", () => {
    expect(frameShapeStyle("circle", "jitsi")).toEqual({ borderRadius: "50%" });
    expect(frameShapeStyle("circle", "rtmp")).toEqual({ borderRadius: "50%" });
  });

  it("folds unknown ids into the per-kind default (forward compat)", () => {
    expect(frameShapeStyle("dodecahedron", "jitsi")).toEqual({ borderRadius: "12px" });
    expect(frameShapeStyle("dodecahedron", "rtmp")).toEqual({ borderRadius: "0" });
    expect(frameShapeStyle(42, "rtmp")).toEqual({ borderRadius: "0" });
  });

  it("resolves known ids to their registry style", () => {
    expect(frameShapeStyle("hexagon", "rtmp").clipPath).toMatch(/^polygon\(/);
    expect(frameShapeStyle("arch", "jitsi")).toEqual({ borderRadius: "50% 50% 0 0" });
  });

  it("renders explicit 'rounded' proportional to the tile, not the legacy 12px", () => {
    // A fixed 12px radius is invisible on a stage-sized tile — the shape
    // must scale with the frame (capped so wide tiles stay circular).
    const rtmp = frameShapeStyle("rounded", "rtmp");
    const jitsi = frameShapeStyle("rounded", "jitsi");
    expect(rtmp).toEqual(jitsi);
    expect(rtmp.borderRadius).toMatch(/%/);
    expect(rtmp.borderRadius).not.toBe("12px");
    // ...while the untouched-jitsi default stays the historical subtle look.
    expect(frameShapeStyle(null, "jitsi")).toEqual({ borderRadius: "12px" });
  });
});

describe("effectiveFrameShapeId", () => {
  it("maps legacy values onto registry ids", () => {
    expect(effectiveFrameShapeId(null, "jitsi")).toBe("rounded");
    expect(effectiveFrameShapeId(null, "rtmp")).toBe("rect");
    expect(effectiveFrameShapeId("circle", "jitsi")).toBe("circle");
    expect(effectiveFrameShapeId("star", "rtmp")).toBe("star");
    expect(effectiveFrameShapeId("nope", "jitsi")).toBe("rounded");
  });
});

describe("effectiveFrameFitId (fit vs crop vs stretch)", () => {
  it("offers exactly the fit, crop and stretch choices", () => {
    expect(FRAME_FITS.map((f) => f.id)).toEqual(["contain", "cover", "fill"]);
  });

  it("defaults absent/legacy/unknown values per kind", () => {
    // RTMP feeds default to "contain": an encoder canvas (OBS) rarely
    // matches the frame ratio, and cropping made the stream look wrong no
    // matter how the frame was resized. Jitsi webcams keep the crop default.
    for (const legacy of [undefined, null, "nope"]) {
      expect(effectiveFrameFitId(legacy, "rtmp")).toBe("contain");
      expect(effectiveFrameFitId(legacy, "jitsi")).toBe("cover");
    }
  });

  it("honours explicit choices on both kinds", () => {
    for (const kind of ["rtmp", "jitsi"] as const) {
      expect(effectiveFrameFitId("contain", kind)).toBe("contain");
      expect(effectiveFrameFitId("cover", kind)).toBe("cover");
      expect(effectiveFrameFitId("fill", kind)).toBe("fill");
    }
  });
});

// The letterboxed ("contain") picture's rectangle inside the frame, in
// percentages — Object.vue shapes this box instead of the whole frame so a
// circle on a wide RTMP tile hugs the picture rather than cutting its sides.
describe("containedPictureBox", () => {
  it("pillarboxes a picture narrower than the frame (bars left/right)", () => {
    // 2:1 frame, 4:3 picture → picture is 2/3 of the frame's width, centred.
    const box = containedPictureBox(400, 200, 4 / 3);
    expect(box).not.toBeNull();
    expect(box!.height).toBe(100);
    expect(box!.top).toBe(0);
    expect(box!.width).toBeCloseTo(66.6667, 3);
    expect(box!.left).toBeCloseTo(16.6667, 3);
  });

  it("letterboxes a picture wider than the frame (bars above/below)", () => {
    // 1:1 frame, 16:9 picture → picture is 9/16 of the frame's height, centred.
    const box = containedPictureBox(300, 300, 16 / 9);
    expect(box).toEqual({ left: 0, top: 21.875, width: 100, height: 56.25 });
  });

  it("is the full frame when the ratios already match", () => {
    expect(containedPictureBox(1280, 720, 16 / 9)).toEqual({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    });
  });

  it("is independent of the frame's absolute size (stage scaling)", () => {
    expect(containedPictureBox(400, 200, 4 / 3)).toEqual(containedPictureBox(40, 20, 4 / 3));
  });

  it("always stays inside the frame and centred", () => {
    for (const [w, h, r] of [
      [1000, 100, 1],
      [100, 1000, 1],
      [640, 480, 21 / 9],
      [480, 640, 9 / 21],
      [333, 777, 1.7777],
    ] as const) {
      const box = containedPictureBox(w, h, r)!;
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.left + box.width).toBeCloseTo(100 - box.left, 6);
      expect(box.top + box.height).toBeCloseTo(100 - box.top, 6);
      // The box has the picture's own proportions.
      expect(((box.width / 100) * w) / ((box.height / 100) * h)).toBeCloseTo(r, 6);
    }
  });

  it("returns null when the frame or picture size is unusable", () => {
    // Frame not laid out yet / picture not decoded yet (videoWidth 0 → ratio NaN or 0).
    expect(containedPictureBox(0, 200, 4 / 3)).toBeNull();
    expect(containedPictureBox(400, 0, 4 / 3)).toBeNull();
    expect(containedPictureBox(400, 200, 0)).toBeNull();
    expect(containedPictureBox(400, 200, NaN)).toBeNull();
    expect(containedPictureBox(400, 200, Infinity)).toBeNull();
    expect(containedPictureBox(-400, 200, 1)).toBeNull();
  });
});
