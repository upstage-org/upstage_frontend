import { describe, expect, it } from "vitest";
import { uploadDefault } from "models/studio";
import { isWithinUploadLimit, resolveUploadLimit, whoamiFromQueryResult } from "./uploadLimit";

const MIB = 1024 * 1024;
const SERVER_MAX = 500 * MIB; // backend OTHER_MEDIA_MAX_SIZE == nginx client_max_body_size 500M
const ONE_POINT_TWO_MB = Math.round(1.2 * MIB);

/** What the SPA's Dropzone does with a drop: resolve whoami -> limit -> gate. */
const gate = (queryResult: unknown, fileSize: number) =>
  isWithinUploadLimit(fileSize, resolveUploadLimit(whoamiFromQueryResult(queryResult)));

describe("whoamiFromQueryResult", () => {
  it("reads the bare data object that useLazyQuery().load() resolves with on the first drop", () => {
    expect(whoamiFromQueryResult({ whoami: { uploadLimit: 2 * MIB } })).toEqual({
      uploadLimit: 2 * MIB,
    });
  });

  it("reads the ApolloQueryResult that refetch() resolves with on later drops", () => {
    // Regression: the old `(profile?.data || profile?.whoami)?.uploadLimit`
    // read `.uploadLimit` off `data` itself here and got undefined.
    expect(
      whoamiFromQueryResult({ data: { whoami: { uploadLimit: 2 * MIB } }, loading: false }),
    ).toEqual({ uploadLimit: 2 * MIB });
  });

  it("returns null when the profile is missing or malformed", () => {
    expect(whoamiFromQueryResult(undefined)).toBeNull();
    expect(whoamiFromQueryResult(false)).toBeNull();
    expect(whoamiFromQueryResult({ data: null })).toBeNull();
    expect(whoamiFromQueryResult({ data: { whoami: null } })).toBeNull();
  });
});

describe("resolveUploadLimit", () => {
  it("prefers the backend-computed effective limit over the stored one", () => {
    expect(resolveUploadLimit({ uploadLimit: MIB, effectiveUploadLimit: SERVER_MAX })).toBe(
      SERVER_MAX,
    );
  });

  it("falls back to the stored per-user value when no effective limit is present", () => {
    expect(resolveUploadLimit({ uploadLimit: 300 * MIB })).toBe(300 * MIB);
  });

  it("uses the 1 MB default when nothing usable is known", () => {
    expect(uploadDefault).toBe(MIB);
    expect(resolveUploadLimit(null)).toBe(MIB);
    expect(resolveUploadLimit({})).toBe(MIB);
    expect(resolveUploadLimit({ uploadLimit: null, effectiveUploadLimit: null })).toBe(MIB);
    expect(resolveUploadLimit({ uploadLimit: 0 })).toBe(MIB);
    expect(resolveUploadLimit({ uploadLimit: Number.NaN })).toBe(MIB);
  });
});

describe("upload gate scenarios", () => {
  it("admin / super admin: 1.2 MB and anything up to the 500 MB server max, on first and later drops", () => {
    const admin = { uploadLimit: MIB, effectiveUploadLimit: SERVER_MAX }; // stored value untouched
    for (const size of [ONE_POINT_TWO_MB, 300 * MIB, SERVER_MAX]) {
      expect(gate({ whoami: admin }, size)).toBe(true);
      expect(gate({ data: { whoami: admin } }, size)).toBe(true);
    }
    expect(gate({ data: { whoami: admin } }, SERVER_MAX + 1)).toBe(false);
  });

  it("player, no change: default 1 MB refuses 1.2 MB but accepts 946 KiB", () => {
    const player = { uploadLimit: MIB, effectiveUploadLimit: MIB };
    expect(gate({ whoami: player }, 946 * 1024)).toBe(true);
    expect(gate({ whoami: player }, ONE_POINT_TWO_MB)).toBe(false);
    expect(gate({ data: { whoami: player } }, ONE_POINT_TWO_MB)).toBe(false);
  });

  it("player: an admin raising the limit to 2 MB takes effect on the very next drop, lowering it too", () => {
    const later = (limit: number) => ({
      data: { whoami: { uploadLimit: limit, effectiveUploadLimit: limit } },
    });
    expect(gate(later(MIB), ONE_POINT_TWO_MB)).toBe(false); // no change
    expect(gate(later(2 * MIB), ONE_POINT_TWO_MB)).toBe(true); // increased
    expect(gate(later(MIB), ONE_POINT_TWO_MB)).toBe(false); // decreased again
  });
});
