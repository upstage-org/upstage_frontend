// @vitest-environment jsdom
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import configs, {
  normaliseEndpointOrigin,
  parseEndpointList,
  rtmpIngestEndpointFor,
} from "./config";

/**
 * Streaming server lists. The `.env` has ONE variable per kind
 * (`VITE_JITSI_ENDPOINTS` / `VITE_RTMP_ENDPOINTS`): one or more URLs,
 * comma-separated, first URL = default server. Duplicates collapse and junk
 * entries are dropped. The pre-2026-09 singular variables are not read at all.
 */
describe("parseEndpointList", () => {
  it("reads a single URL", () => {
    expect(parseEndpointList("https://a.example.org")).toEqual(["https://a.example.org"]);
    // `VITE_X_ENDPOINTS=http://localhost/` — the template default.
    expect(parseEndpointList("http://localhost/")).toEqual(["http://localhost"]);
  });

  it("reads several comma-separated URLs in order; the first is the default", () => {
    expect(
      parseEndpointList("https://a.example.org,https://b.example.org,https://c.example.org"),
    ).toEqual(["https://a.example.org", "https://b.example.org", "https://c.example.org"]);
  });

  it("de-duplicates different spellings of one server", () => {
    expect(
      parseEndpointList("https://a.example.org/, https://a.example.org , https://b.example.org/"),
    ).toEqual(["https://a.example.org", "https://b.example.org"]);
  });

  it("strips trailing slashes and whitespace", () => {
    expect(parseEndpointList("https://b.example.org///, http://c.example.org:8000/")).toEqual([
      "https://b.example.org",
      "http://c.example.org:8000",
    ]);
  });

  it("drops entries that are not bare http(s) origins", () => {
    expect(
      parseEndpointList(
        "https://a.example.org,not a url,ftp://x.example.org,https://p.example.org/path,https://q.example.org?x=1,,",
      ),
    ).toEqual(["https://a.example.org"]);
  });

  it("returns an empty list when nothing is configured", () => {
    expect(parseEndpointList(undefined)).toEqual([]);
    expect(parseEndpointList("")).toEqual([]);
    expect(parseEndpointList(42)).toEqual([]);
  });

  it("takes exactly one argument — there is no singular-variable fallback", () => {
    expect(parseEndpointList.length).toBe(1);
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

describe("config.ts reads only the plural variables", () => {
  const source = readFileSync(resolve(__dirname, "config.ts"), "utf8");
  const typings = readFileSync(resolve(__dirname, "env.d.ts"), "utf8");
  // `VITE_JITSI_ENDPOINT` not followed by `S` — outside comments.
  const code = (text: string) =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");

  it.each(["VITE_JITSI_ENDPOINT", "VITE_RTMP_ENDPOINT"])(
    "%s is neither read nor declared",
    (name) => {
      const singular = new RegExp(`${name}(?!S)`);
      expect(code(source)).not.toMatch(singular);
      expect(code(typings)).not.toMatch(singular);
    },
  );

  it("still reads the plural ones", () => {
    expect(code(source)).toMatch(/VITE_JITSI_ENDPOINTS/);
    expect(code(source)).toMatch(/VITE_RTMP_ENDPOINTS/);
  });
});

describe("configs (multi-server invariants)", () => {
  it("exposes the default server as entry 0 of each list", () => {
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

/**
 * The env files themselves: streaming servers are configured through the
 * plural variables only. A singular `VITE_JITSI_ENDPOINT=` / `VITE_RTMP_ENDPOINT=`
 * line would now be silently IGNORED by the app — so it must not appear.
 */
describe("env files use the consolidated *_ENDPOINTS variables", () => {
  const root = resolve(__dirname, "..");
  // Templates are committed; `.env` / `env_backup_dev` exist only on a deploy host.
  const files = ["env.template", "dotenv_template", ".env.example", ".env", "env_backup_dev"]
    .map((name) => ({ name, path: resolve(root, name) }))
    .filter(({ path }) => existsSync(path));

  const assignments = (path: string) =>
    readFileSync(path, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("=")[0].trim());

  it("finds the committed templates", () => {
    expect(files.map((f) => f.name)).toEqual(
      expect.arrayContaining(["env.template", "dotenv_template", ".env.example"]),
    );
  });

  it.each(files)("$name sets no singular streaming variable", ({ path }) => {
    const keys = assignments(path);
    expect(keys).not.toContain("VITE_JITSI_ENDPOINT");
    expect(keys).not.toContain("VITE_RTMP_ENDPOINT");
  });

  it.each(files)("$name defines each plural variable at most once", ({ path }) => {
    const keys = assignments(path);
    expect(keys.filter((k) => k === "VITE_JITSI_ENDPOINTS").length).toBeLessThanOrEqual(1);
    expect(keys.filter((k) => k === "VITE_RTMP_ENDPOINTS").length).toBeLessThanOrEqual(1);
  });

  it.each(files)("$name documents that several URLs are comma-separated", ({ path }) => {
    expect(readFileSync(path, "utf8")).toMatch(/comma-separated/);
  });
});
