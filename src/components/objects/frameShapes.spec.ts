import { describe, expect, it } from "vitest";
import {
  FRAME_FITS,
  FRAME_SHAPES,
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
