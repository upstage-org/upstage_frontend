import { describe, expect, it } from "vitest";
import dayjs from "@utils/dayjs";
import {
  ALL_STAGE_ACCESS,
  DEFAULT_STAGE_ACCESS,
  buildStageInquiry,
  normalizeStageAccess,
} from "./studioInquiry";

describe("buildStageInquiry", () => {
  it("passes name and owners through", () => {
    const inquiry = buildStageInquiry({
      name: "presentation",
      owners: ["helen"],
      access: ["owner"],
    });
    expect(inquiry.name).toBe("presentation");
    expect(inquiry.owners).toEqual(["helen"]);
    expect(inquiry.access).toEqual(["owner"]);
  });

  it("widens an empty access selection to all access levels", () => {
    const inquiry = buildStageInquiry({ name: "", owners: [], access: [] });
    expect(inquiry.access).toEqual([...ALL_STAGE_ACCESS]);
  });

  it("copies arrays instead of aliasing the filter refs", () => {
    const owners = ["helen"];
    const access = ["owner", "editor"];
    const inquiry = buildStageInquiry({ name: "", owners, access });
    expect(inquiry.owners).not.toBe(owners);
    expect(inquiry.access).not.toBe(access);
  });

  it("formats a date range as YYYY-MM-DD pairs", () => {
    const inquiry = buildStageInquiry({
      name: "",
      owners: [],
      access: [],
      dates: [dayjs("2026-04-01"), dayjs("2026-04-29")],
    });
    expect(inquiry.createdBetween).toEqual(["2026-04-01", "2026-04-29"]);
  });

  it("sends createdBetween: undefined when no dates are picked", () => {
    const inquiry = buildStageInquiry({ name: "", owners: [], access: [] });
    expect(inquiry.createdBetween).toBeUndefined();
  });
});

describe("normalizeStageAccess", () => {
  it("treats missing or empty access as the studio default", () => {
    expect(normalizeStageAccess(undefined)).toEqual([...DEFAULT_STAGE_ACCESS]);
    expect(normalizeStageAccess(null)).toEqual([...DEFAULT_STAGE_ACCESS]);
    expect(normalizeStageAccess([])).toEqual([...DEFAULT_STAGE_ACCESS]);
  });

  it("passes a non-empty selection through", () => {
    expect(normalizeStageAccess(["audience"])).toEqual(["audience"]);
  });
});
