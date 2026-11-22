/**
 * Default URL for a new stage, made from its name (#1576) — the way a CMS
 * proposes a slug for a post title: "Helen's Bunnies" → "helens-bunnies",
 * and "bunnies" → "bunnies-2" when /bunnies is already a stage.
 */

/** The URL field's own limit (`maxlength` in General.vue). */
export const STAGE_URL_MAX_LENGTH = 20;

/**
 * Lower-case, accents removed, apostrophes dropped ("Helen's" → "helens"),
 * every other run of non-alphanumerics becomes one dash. A name with nothing
 * usable in it (e.g. only non-Latin script) gives "" — no suggestion.
 */
export function slugifyStageName(name: string | null | undefined, max = STAGE_URL_MAX_LENGTH) {
  const slug = `${name ?? ""}`
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’‘`´]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, max).replace(/-+$/, "");
}

/** `base-n`, shortening `base` so the whole thing still fits in `max`. */
export function numberedSlug(base: string, n: number, max = STAGE_URL_MAX_LENGTH) {
  const suffix = `-${n}`;
  return `${base.slice(0, Math.max(1, max - suffix.length)).replace(/-+$/, "")}${suffix}`;
}

export interface SuggestStageUrlOptions {
  /** URLs that can never be a stage (app routes). */
  reserved?: readonly string[];
  max?: number;
  /** How many numbered variants to try before giving up. */
  attempts?: number;
}

/**
 * First free URL for `name`: its slug, else slug-2, slug-3, … `isTaken`
 * answers whether a stage already lives at a URL. "" when the name has no
 * usable characters or nothing free was found.
 */
export async function suggestStageUrl(
  name: string | null | undefined,
  isTaken: (url: string) => Promise<boolean>,
  { reserved = [], max = STAGE_URL_MAX_LENGTH, attempts = 30 }: SuggestStageUrlOptions = {},
): Promise<string> {
  const base = slugifyStageName(name, max);
  if (!base) return "";
  for (let n = 1; n <= attempts; n++) {
    const candidate = n === 1 ? base : numberedSlug(base, n, max);
    if (reserved.includes(candidate)) continue;
    if (!(await isTaken(candidate))) return candidate;
  }
  return "";
}
