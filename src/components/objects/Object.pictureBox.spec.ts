// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

/**
 * Frame-shape / picture-box contract of the shared object wrapper
 * (Object.vue) — GitHub issue #1561 "difference in frame behaviour of rtmp
 * and individual jitsi streams".
 *
 * A jitsi tile crops its picture to the frame ("cover"), so the frame shape
 * (circle, hexagon…) always hugs the picture. An RTMP tile letterboxes by
 * default ("contain"): the picture is narrower or shorter than the frame,
 * and a shape clipped on the whole frame cut the picture's straight edges
 * instead of following its outline — a circle on a wide frame lost its
 * left and right sides. The wrapper now shapes a `.picture-box` that, with
 * "contain", shrinks to the picture's own rectangle once the <video> reports
 * its dimensions; with "cover" / "fill" (and before any picture is decoded)
 * the box is the full frame, exactly the old behaviour.
 */

// Object.vue → @utils/common pulls in config / ant-design-vue at import time.
vi.mock("config", () => ({ default: { STATIC_ASSETS_ENDPOINT: "" } }));
vi.mock("ant-design-vue", () => ({ message: { error: vi.fn() } }));

vi.mock("@stores/pinia/stage", async () => {
  const { reactive, ref } = await import("vue");
  // storeToRefs() (used by Object.vue) walks every raw member reading
  // `.effect` (so no nulls) and only picks up ref / reactive ones, so the
  // two it destructures are explicit refs here.
  const store = reactive({
    stageSize: ref({ left: 0, top: 0, width: 1000, height: 600 }),
    canPlay: ref(true),
    activeMovable: ref<string | null>(null),
    session: "session-1",
    currentAvatar: ref(null),
    shapeObject: vi.fn(),
    toggleAutoplayFrames: vi.fn(),
    streamLocalMuted: () => false,
    streamLocalVolume: () => 100,
    forceReloadStreams: ref(null),
  });
  return { useStageStore: () => store };
});
vi.mock("@stores/pinia/user", () => ({
  useUserStore: () => ({ avatarId: null, setAvatarId: vi.fn() }),
}));

import AppObject from "./Object.vue";

// The wrapper observes its own `.object` div with a ResizeObserver so the
// picture box follows Moveable's live resize drag (which only publishes
// object.w / h on release). jsdom lays nothing out, so this fake records
// the callback and lets each test report a frame size.
type ResizeCallback = (entries: Array<{ contentRect: { width: number; height: number } }>) => void;
const observers: Array<{ callback: ResizeCallback; targets: Element[] }> = [];
class FakeResizeObserver {
  callback: ResizeCallback;
  targets: Element[] = [];
  constructor(callback: ResizeCallback) {
    this.callback = callback;
    observers.push(this);
  }
  observe(target: Element) {
    this.targets.push(target);
  }
  unobserve() {}
  disconnect() {
    this.targets = [];
  }
}

const reportFrameSize = async (width: number, height: number) => {
  for (const o of observers) o.callback([{ contentRect: { width, height } }]);
  await nextTick();
};

// A live feed reveals its dimensions through the <video>'s own (non-bubbling)
// media events; the wrapper listens in the capture phase.
const reportVideoSize = async (video: HTMLVideoElement, w: number, h: number, type: string) => {
  Object.defineProperty(video, "videoWidth", { value: w, configurable: true });
  Object.defineProperty(video, "videoHeight", { value: h, configurable: true });
  video.dispatchEvent(new Event(type, { bubbles: false }));
  await nextTick();
};

const RTMP_OBJECT = {
  id: "feed-1",
  type: "stream",
  isRTMP: true,
  fileLocation: "mykey",
  x: 10,
  y: 10,
  w: 400,
  h: 200,
  rotate: 0,
  opacity: 1,
};

const mounted: Array<{ unmount: () => void }> = [];
function mountObject(object: Record<string, unknown>, slots: Record<string, string> = {}) {
  const w = mount(AppObject, {
    props: { object },
    slots,
    global: {
      stubs: {
        ContextMenu: { template: "<div><slot name='trigger' /></div>" },
        Moveable: { template: "<div class='moveable-stub'><slot /></div>" },
        OpacitySlider: true,
        QuickAction: true,
        Topping: true,
        AppImage: { template: "<img class='the-object' />" },
        // The real player negotiates WebRTC/HLS; the contract under test only
        // needs the <video> it renders inside the wrapper.
        LiveStreamPlayer: {
          template: "<div class='live-stream-tile'><video class='the-object-video'></video></div>",
        },
      },
    },
  });
  mounted.push(w);
  return w;
}

const objectDiv = (w: ReturnType<typeof mountObject>) => w.find(".object");
const pictureBox = (w: ReturnType<typeof mountObject>) => w.find(".picture-box");
const boxStyle = (w: ReturnType<typeof mountObject>) =>
  (pictureBox(w).element as HTMLElement).style;

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});
afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount());
  vi.unstubAllGlobals();
});

describe("RTMP tile with the default Fit (contain) mode", () => {
  it("carries the shape on the picture box, not on the frame, and starts as the full frame", () => {
    const w = mountObject({ ...RTMP_OBJECT, shape: "circle" });
    expect(pictureBox(w).exists()).toBe(true);
    expect(pictureBox(w).find("video").exists()).toBe(true);
    expect(boxStyle(w).borderRadius).toBe("50%");
    expect(boxStyle(w).width).toBe("100%");
    expect(boxStyle(w).height).toBe("100%");
    expect(boxStyle(w).position).toBe("");
    // The frame itself is no longer shaped (it used to be), but still hands
    // the fit down to the <video> through the CSS variable.
    const frame = objectDiv(w).element as HTMLElement;
    expect(frame.style.borderRadius).toBe("");
    expect(frame.style.getPropertyValue("--stream-fit")).toBe("contain");
    // The wrapper watches its own frame for live resizes.
    expect(observers).toHaveLength(1);
    expect(observers[0].targets).toEqual([frame]);
  });

  it("shrinks the shaped box to the letterboxed picture once the video reports its size", async () => {
    const w = mountObject({ ...RTMP_OBJECT, shape: "circle" });
    await reportFrameSize(400, 200);
    // Still the full frame: no picture decoded yet.
    expect(boxStyle(w).width).toBe("100%");

    // 4:3 picture in a 2:1 frame → pillarboxed to 2/3 of the width, centred.
    await reportVideoSize(
      pictureBox(w).find("video").element as HTMLVideoElement,
      640,
      480,
      "loadedmetadata",
    );
    expect(boxStyle(w).borderRadius).toBe("50%");
    expect(boxStyle(w).position).toBe("relative");
    expect(parseFloat(boxStyle(w).width)).toBeCloseTo(66.6667, 3);
    expect(parseFloat(boxStyle(w).left)).toBeCloseTo(16.6667, 3);
    expect(boxStyle(w).height).toBe("100%");
    expect(boxStyle(w).top).toBe("0%");
  });

  it("follows the frame live while it is resized (ResizeObserver, not object.w/h)", async () => {
    const w = mountObject({ ...RTMP_OBJECT, shape: "circle" });
    const video = pictureBox(w).find("video").element as HTMLVideoElement;
    await reportVideoSize(video, 640, 480, "loadedmetadata");
    await reportFrameSize(400, 200);
    expect(parseFloat(boxStyle(w).width)).toBeCloseTo(66.6667, 3);

    // Dragged taller than the picture's ratio → letterboxed top/bottom instead.
    await reportFrameSize(200, 400);
    expect(boxStyle(w).width).toBe("100%");
    expect(boxStyle(w).left).toBe("0%");
    expect(parseFloat(boxStyle(w).height)).toBeCloseTo(37.5, 3);
    expect(parseFloat(boxStyle(w).top)).toBeCloseTo(31.25, 3);

    // Dragged to exactly the picture's ratio → the box is the whole frame again.
    await reportFrameSize(800, 600);
    expect(boxStyle(w).width).toBe("100%");
    expect(boxStyle(w).height).toBe("100%");
  });

  it("tracks a MediaStream's late/changed dimensions via the video 'resize' event", async () => {
    const w = mountObject({ ...RTMP_OBJECT, shape: "hexagon" });
    await reportFrameSize(400, 200);
    const video = pictureBox(w).find("video").element as HTMLVideoElement;
    // WebRTC: loadedmetadata may fire before the first frame, with 0×0.
    await reportVideoSize(video, 0, 0, "loadedmetadata");
    expect(boxStyle(w).width).toBe("100%");
    // First decoded frame reveals the size.
    await reportVideoSize(video, 1920, 1080, "resize");
    expect(boxStyle(w).clipPath).toMatch(/^polygon\(/);
    expect(parseFloat(boxStyle(w).width)).toBeCloseTo(88.8889, 3);
    // Encoder switches to a square canvas mid-stream.
    await reportVideoSize(video, 1080, 1080, "resize");
    expect(parseFloat(boxStyle(w).width)).toBeCloseTo(50, 3);
    expect(parseFloat(boxStyle(w).left)).toBeCloseTo(25, 3);
  });

  it("returns to the full frame when the source is dropped (waiting placeholder)", async () => {
    const w = mountObject({ ...RTMP_OBJECT, shape: "circle" });
    await reportFrameSize(400, 200);
    const video = pictureBox(w).find("video").element as HTMLVideoElement;
    await reportVideoSize(video, 640, 480, "loadedmetadata");
    expect(boxStyle(w).width).not.toBe("100%");
    // LiveStreamPlayer's teardown clears srcObject/src → the element empties.
    await reportVideoSize(video, 0, 0, "emptied");
    expect(boxStyle(w).width).toBe("100%");
    expect(boxStyle(w).height).toBe("100%");
    expect(boxStyle(w).position).toBe("");
    expect(boxStyle(w).borderRadius).toBe("50%");
  });

  it("ignores media events from elements that are not <video> (jitsi's <audio>)", async () => {
    const w = mountObject({ ...RTMP_OBJECT, shape: "circle" });
    await reportFrameSize(400, 200);
    const audio = document.createElement("audio");
    pictureBox(w).element.appendChild(audio);
    audio.dispatchEvent(new Event("loadedmetadata"));
    await nextTick();
    expect(boxStyle(w).width).toBe("100%");
  });
});

describe("Crop (cover) and Stretch (fill) modes", () => {
  it("keeps the shaped box as the whole frame even when the picture ratio is known", async () => {
    for (const fit of ["cover", "fill"]) {
      const w = mountObject({ ...RTMP_OBJECT, id: `feed-${fit}`, shape: "circle", fit });
      await reportFrameSize(400, 200);
      await reportVideoSize(
        pictureBox(w).find("video").element as HTMLVideoElement,
        640,
        480,
        "loadedmetadata",
      );
      expect(boxStyle(w).width, fit).toBe("100%");
      expect(boxStyle(w).height, fit).toBe("100%");
      expect(boxStyle(w).position, fit).toBe("");
      expect(boxStyle(w).borderRadius, fit).toBe("50%");
      expect(
        (objectDiv(w).element as HTMLElement).style.getPropertyValue("--stream-fit"),
        fit,
      ).toBe(fit);
    }
  });
});

describe("jitsi tile (default Crop)", () => {
  const JITSI_OBJECT = {
    ...RTMP_OBJECT,
    id: "tile-1",
    type: "jitsi",
    isRTMP: undefined,
    participantId: "p1",
  };

  it("wraps the tile's slot content in a full-frame box with the legacy 12px corners", async () => {
    const w = mountObject(JITSI_OBJECT, {
      render: "<video class='jitsi-video'></video><audio></audio>",
    });
    expect(pictureBox(w).find("video.jitsi-video").exists()).toBe(true);
    expect(boxStyle(w).borderRadius).toBe("12px");
    expect(boxStyle(w).width).toBe("100%");
    expect((objectDiv(w).element as HTMLElement).style.getPropertyValue("--stream-fit")).toBe(
      "cover",
    );
    // Cropped: the picture is the frame, so the ratio changes nothing.
    await reportFrameSize(400, 200);
    await reportVideoSize(
      pictureBox(w).find("video").element as HTMLVideoElement,
      640,
      480,
      "resize",
    );
    expect(boxStyle(w).width).toBe("100%");
    expect(boxStyle(w).position).toBe("");
  });

  it("hugs the letterboxed picture too when Fit is chosen on a jitsi tile", async () => {
    const w = mountObject(
      { ...JITSI_OBJECT, shape: "circle", fit: "contain" },
      {
        render: "<video></video>",
      },
    );
    await reportFrameSize(400, 200);
    await reportVideoSize(
      pictureBox(w).find("video").element as HTMLVideoElement,
      640,
      480,
      "resize",
    );
    expect(boxStyle(w).borderRadius).toBe("50%");
    expect(parseFloat(boxStyle(w).width)).toBeCloseTo(66.6667, 3);
  });
});

describe("objects without a frame shape (images, text, drawings)", () => {
  it("renders the slot directly under .object with no picture box or media listeners at work", async () => {
    const w = mountObject({
      ...RTMP_OBJECT,
      id: "img-1",
      type: "prop",
      isRTMP: undefined,
      src: "/a.png",
    });
    expect(pictureBox(w).exists()).toBe(false);
    const frame = objectDiv(w).element as HTMLElement;
    expect(frame.querySelector(":scope > img.the-object")).not.toBeNull();
    expect(frame.style.getPropertyValue("--stream-fit")).toBe("");
    expect(frame.style.borderRadius).toBe("");
  });

  it("keeps a text object's content as a direct child of .object (Text.vue pins its parent's scroll)", () => {
    const w = mountObject(
      { ...RTMP_OBJECT, id: "t-1", type: "text", isRTMP: undefined },
      {
        render: "<div class='text-content'>hello</div>",
      },
    );
    expect(pictureBox(w).exists()).toBe(false);
    expect(w.find(".text-content").element.parentElement).toBe(objectDiv(w).element);
  });
});
