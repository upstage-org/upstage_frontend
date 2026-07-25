import type { Dayjs } from "@utils/dayjs";

/** Default stage-list access filter (stages the user can work on, not guest-only). */
export const DEFAULT_STAGE_ACCESS = ["owner", "editor", "player"] as const;

export const ALL_STAGE_ACCESS = ["owner", "editor", "player", "audience"] as const;

/**
 * Map the Stages-page filter widgets to the shared inquiryVar keys. An empty
 * access selection means "all access levels" — clearing the filter widens the
 * search instead of silently snapping back to the default three.
 */
export function buildStageInquiry(filters: {
  name: string;
  owners: string[];
  access: string[];
  dates?: [Dayjs, Dayjs];
}) {
  return {
    name: filters.name,
    owners: [...filters.owners],
    access: filters.access.length ? [...filters.access] : [...ALL_STAGE_ACCESS],
    createdBetween: filters.dates
      ? [filters.dates[0]?.format("YYYY-MM-DD"), filters.dates[1]?.format("YYYY-MM-DD")]
      : undefined,
  };
}

/**
 * Empty `access` in the shared Apollo `inquiryVar` means "match nothing" on the
 * API and yields a blank table. Treat missing/empty as the studio default.
 */
export function normalizeStageAccess(access: string[] | undefined | null): string[] {
  if (!access?.length) {
    return [...DEFAULT_STAGE_ACCESS];
  }
  return access;
}
