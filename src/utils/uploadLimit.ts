import { uploadDefault } from "models/studio";

/** The slice of `User` the upload gate cares about. */
export interface UploadLimitProfile {
  /** Stored per-user value (`upstage_user.upload_limit`); may be NULL. */
  uploadLimit?: number | null;
  /**
   * What the backend will actually enforce for this user: the per-user cap
   * for players, the server-wide maximum for admins / super admins.
   */
  effectiveUploadLimit?: number | null;
}

/**
 * Extract `whoami` from whatever @vue/apollo-composable hands back.
 *
 * `useLazyQuery().load()` resolves with the BARE data object (`{ whoami }`)
 * on its first call and returns `false` afterwards, so callers fall back to
 * `refetch()`, which resolves with a full ApolloQueryResult
 * (`{ data: { whoami } }`). Dropzone.vue used to read
 * `(profile?.data || profile?.whoami)?.uploadLimit`, which on the refetch
 * path looked for `.uploadLimit` on `data` itself, got `undefined`, and
 * silently fell back to the 1 MB default from the second drop onward —
 * whatever the player's real limit was (2026-09-05 report).
 */
export function whoamiFromQueryResult(result: unknown): UploadLimitProfile | null {
  if (!result || typeof result !== "object") return null;
  const wrapper = result as { data?: unknown; whoami?: unknown };
  const data =
    wrapper.data && typeof wrapper.data === "object"
      ? (wrapper.data as { whoami?: unknown })
      : wrapper;
  const whoami = data.whoami;
  return whoami && typeof whoami === "object" ? (whoami as UploadLimitProfile) : null;
}

const isUsableLimit = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * The byte limit to gate a drop against. Prefers the backend-computed
 * effective limit, then the stored per-user value, then the 1 MB default
 * (also used when the profile could not be loaded at all).
 */
export function resolveUploadLimit(
  profile: UploadLimitProfile | null | undefined,
  fallback: number = uploadDefault,
): number {
  if (profile) {
    if (isUsableLimit(profile.effectiveUploadLimit)) return profile.effectiveUploadLimit;
    if (isUsableLimit(profile.uploadLimit)) return profile.uploadLimit;
  }
  return fallback;
}

export function isWithinUploadLimit(fileSize: number, limit: number): boolean {
  return fileSize <= limit;
}
