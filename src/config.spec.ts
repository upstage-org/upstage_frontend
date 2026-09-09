// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import configs, {
  normaliseEndpointOrigin,
  parseEndpointList,
  rtmpIngestEndpointFor,
} from "./config";

/**
 * Multi-server streaming: the server lists are derived from the legacy
 * singular env var plus an optional comma-separated plural one. Entry 0 must
 * always be the singular value (single-server installs keep today's default
 * byte-for-byte), duplicates collapse, and junk entries are dropped.
 */
describe("parseEndpointList", () => {
  it("keeps the singular value as entry 0 and appends the plural list", () => {
    expect(
      parseEndpointList("https://a.example.org", "https://b.example.org,https://c.example.org"),
    ).toEqual(["https://a.example.org", "https://b.example.org", "https://c.example.org"]);
  });

  it("de-duplicates (the singular value usually reappears in the plural list)", () => {
    expect(
      parseEndpointList(
        "https://a.example.org/",
        " https://a.example.org , https://b.example.org/ ",
      ),
    ).toEqual(["https://a.example.org", "https://b.example.org"]);
  });

  it("strips trailing slashes and whitespace from plural entries", () => {
    expect(
      parseEndpointList(undefined, "https://b.example.org///, http://c.example.org:8000/"),
    ).toEqual(["https://b.example.org", "http://c.example.org:8000"]);
  });

  it("drops entries that are not bare http(s) origins", () => {
    expect(
      parseEndpointList(
        "https://a.example.org",
        "not a url,ftp://x.example.org,https://p.example.org/path,https://q.example.org?x=1,,",
      ),
    ).toEqual(["https://a.example.org"]);
  });

  it("returns an empty list when nothing is configured", () => {
    expect(parseEndpointList(undefined, undefined)).toEqual([]);
    expect(parseEndpointList("", "")).toEqual([]);
  });

  it("only strips a single trailing slash from the legacy singular value (unchanged behaviour)", () => {
    expect(parseEndpointList("http://localhost/", undefined)).toEqual(["http://localhost"]);
  });
});

describe("normaliseEndpointOrigin", () => {
  it("accepts http(s) origins with optional port", () => {
    expect(normaliseEndpointOrigin("https://s.example.org")).toBe("https://s.example.org");
    expect(normaliseEndpointOrigin("http://localhost:8000/")).toBe("http://localhost:8000");
  });
  it("rejects paths, queries, other schemes and non-strings", () => {
    expect(normaliseEndpointOrigin("https://s.example.org/live")).toBeNull();
    expect(normaliseEndpointOrigin("wss://s.example.org")).toBeNull();
    expect(normaliseEndpointOrigin(42)).toBeNull();
    expect(normaliseEndpointOrigin("   ")).toBeNull();
  });
});

describe("rtmpIngestEndpointFor", () => {
  it("derives the OBS server URL from a playback origin", () => {
    expect(rtmpIngestEndpointFor("https://streaming2.example.org")).toBe(
      "rtmp://streaming2.example.org/live",
    );
  });
  it("is empty for a missing or malformed origin", () => {
    expect(rtmpIngestEndpointFor("")).toBe("");
    expect(rtmpIngestEndpointFor(undefined)).toBe("");
    expect(rtmpIngestEndpointFor("nope")).toBe("");
  });
});

describe("configs (multi-server invariants)", () => {
  it("keeps the singular endpoints as entry 0 of the lists", () => {
    expect(configs.JITSI_ENDPOINTS[0]).toBe(configs.JITSI_ENDPOINT);
    expect(configs.JITSI_SERVER_COUNT).toBe(configs.JITSI_ENDPOINTS.length);
    expect(configs.JITSI_SERVER_COUNT).toBeGreaterThanOrEqual(1);
    expect(configs.RTMP_ENDPOINTS[0] ?? "").toBe(configs.RTMP_ENDPOINT);
    expect(configs.RTMP_SERVER_COUNT).toBe(configs.RTMP_ENDPOINTS.length);
  });
  it("derives RTMP_INGEST_ENDPOINT from the default RTMP origin", () => {
    expect(configs.RTMP_INGEST_ENDPOINT).toBe(rtmpIngestEndpointFor(configs.RTMP_ENDPOINT));
  });
});
