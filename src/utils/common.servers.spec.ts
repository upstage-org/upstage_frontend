import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("config", () => ({
  default: {
    STATIC_ASSETS_ENDPOINT: "/resources/",
    JITSI_ENDPOINT: "https://j1.example.org",
    JITSI_ENDPOINTS: ["https://j1.example.org", "https://j2.example.org"],
    JITSI_SERVER_COUNT: 2,
    RTMP_ENDPOINT: "https://r1.example.org",
    RTMP_ENDPOINTS: ["https://r1.example.org", "https://r2.example.org"],
    RTMP_SERVER_COUNT: 2,
  },
}));

import {
  endpointHostLabel,
  resolveJitsiOrigin,
  resolveRtmpOrigin,
  rtmpEndpointFromDescription,
} from "./common";

describe("rtmpEndpointFromDescription", () => {
  it("reads the origin stored next to isRTMP", () => {
    expect(
      rtmpEndpointFromDescription(
        JSON.stringify({ isRTMP: true, rtmpEndpoint: "https://r2.example.org/" }),
      ),
    ).toBe("https://r2.example.org");
  });
  it("is undefined for legacy feeds and junk", () => {
    expect(rtmpEndpointFromDescription(JSON.stringify({ isRTMP: true }))).toBeUndefined();
    expect(rtmpEndpointFromDescription(JSON.stringify({ rtmpEndpoint: 7 }))).toBeUndefined();
    expect(rtmpEndpointFromDescription("")).toBeUndefined();
    expect(rtmpEndpointFromDescription(undefined)).toBeUndefined();
    expect(rtmpEndpointFromDescription("{not json")).toBeUndefined();
  });
});

describe("resolveRtmpOrigin / resolveJitsiOrigin", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns a configured origin unchanged", () => {
    expect(resolveRtmpOrigin("https://r2.example.org")).toBe("https://r2.example.org");
    expect(resolveJitsiOrigin("https://j2.example.org/")).toBe("https://j2.example.org");
  });
  it("falls back to the default for missing values (legacy tiles / feeds)", () => {
    expect(resolveRtmpOrigin(undefined)).toBe("https://r1.example.org");
    expect(resolveRtmpOrigin(null)).toBe("https://r1.example.org");
    expect(resolveJitsiOrigin("")).toBe("https://j1.example.org");
  });
  it("falls back to the default (with a warning) when the stored server was removed", () => {
    expect(resolveRtmpOrigin("https://gone.example.org")).toBe("https://r1.example.org");
    expect(resolveJitsiOrigin("https://gone.example.org")).toBe("https://j1.example.org");
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("endpointHostLabel", () => {
  it("labels a server by its host", () => {
    expect(endpointHostLabel("https://streaming3.example.org")).toBe("streaming3.example.org");
    expect(endpointHostLabel("http://localhost:8000")).toBe("localhost:8000");
    expect(endpointHostLabel("")).toBe("");
    expect(endpointHostLabel("weird")).toBe("weird");
  });
});
