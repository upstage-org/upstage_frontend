/**
 * Frame shapes for live stream tiles (jitsi + RTMP).
 *
 * Single source of truth for the right-click "Shape" row
 * (Avatar/ContextMenuAvatar.vue) and the tile rendering (Object.vue applies
 * the style to the `.object` wrapper, which clips the <video> and any
 * placeholder/loading overlay together).
 *
 * Every shape must be expressed as a border-radius or a %-coordinate
 * clip-path so it stretches with the freely-resizable frame — never px
 * units or `path()` (fixed-size, would not follow the tile).
 *
 * Stored `shape` values ride the board object through MQTT unchanged.
 * Legacy values in old broadcasts/archives: `null`/absent (per-kind default
 * look) and `"circle"` (kept as the circle/oval id; border-radius 50% is
 * visually identical to the old 100%). Unknown ids — e.g. a new shape
 * arriving at an old client, or vice versa — fold into the per-kind default.
 */

export type FrameShapeId =
  | "rect"
  | "rounded"
  | "circle"
  | "diamond"
  | "hexagon"
  | "triangle"
  | "star"
  | "heart"
  | "arch";

export type FrameKind = "jitsi" | "rtmp";

type FrameShapeStyle = { borderRadius?: string; clipPath?: string };

export interface FrameShapeDef {
  id: FrameShapeId;
  /** Tooltip label (plain English, like the other tooltips in the menu). */
  title: string;
  /** Style applied to the tile wrapper. */
  style: FrameShapeStyle;
  /**
   * Override for the tiny menu swatch when the real style doesn't read at
   * swatch size (12px radius on an 18×14 swatch looks like a circle).
   */
  swatchStyle?: FrameShapeStyle;
}

export const FRAME_SHAPES: FrameShapeDef[] = [
  { id: "rect", title: "Rectangle", style: { borderRadius: "0" } },
  {
    id: "rounded",
    title: "Rounded",
    style: { borderRadius: "12px" },
    swatchStyle: { borderRadius: "4px" },
  },
  { id: "circle", title: "Circle / Oval", style: { borderRadius: "50%" } },
  {
    id: "diamond",
    title: "Diamond",
    style: { clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)" },
  },
  {
    id: "hexagon",
    title: "Hexagon",
    style: { clipPath: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)" },
  },
  {
    id: "triangle",
    title: "Triangle",
    style: { clipPath: "polygon(50% 0%, 100% 100%, 0% 100%)" },
  },
  {
    id: "star",
    title: "Star",
    style: {
      clipPath:
        "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
    },
  },
  {
    id: "heart",
    title: "Heart",
    style: {
      clipPath:
        "polygon(50% 100%, 16% 68%, 4% 48%, 2% 32%, 8% 16%, 22% 6%, 36% 7%, 46% 15%, 50% 24%, 54% 15%, 64% 7%, 78% 6%, 92% 16%, 98% 32%, 96% 48%, 84% 68%)",
    },
  },
  { id: "arch", title: "Arch", style: { borderRadius: "50% 50% 0 0" } },
];

const SHAPES_BY_ID = new Map(FRAME_SHAPES.map((s) => [s.id, s]));

/**
 * Per-kind default for `null`/absent/unknown: jitsi tiles have always been
 * 12px-rounded, RTMP tiles sharp — keeping those defaults means untouched
 * tiles (and replayed archives) look exactly as before.
 */
function defaultShapeId(kind: FrameKind): FrameShapeId {
  return kind === "jitsi" ? "rounded" : "rect";
}

/** Effective shape id for a stored `shape` value (drives the menu highlight). */
export function effectiveFrameShapeId(shape: unknown, kind: FrameKind): FrameShapeId {
  if (typeof shape === "string" && SHAPES_BY_ID.has(shape as FrameShapeId)) {
    return shape as FrameShapeId;
  }
  return defaultShapeId(kind);
}

/** Wrapper style for a tile's stored `shape` value. */
export function frameShapeStyle(shape: unknown, kind: FrameKind): FrameShapeStyle {
  const def = SHAPES_BY_ID.get(effectiveFrameShapeId(shape, kind));
  return def ? { ...def.style } : {};
}
