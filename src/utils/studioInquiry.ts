/** Default stage-list access filter (stages the user can work on, not guest-only). */
export const DEFAULT_STAGE_ACCESS = ["owner", "editor", "player"] as const;

export const ALL_STAGE_ACCESS = ["owner", "editor", "player", "audience"] as const;

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
