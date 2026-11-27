import type { Media } from "models/studio";

/**
 * The owner's permission note on a media item (#1570): "who to credit, how
 * it may be used". It is typed on the Permissions tab and stored in the
 * item's attribute blob, and it is for the OTHER players: it has to be in
 * front of them when they assign the item to a stage, acknowledge its use or
 * ask for permission — whatever the copyright level. The "Assign to stage"
 * pop-up used to show it only for "Use with acknowledgement" (level 1), so
 * a "Use with permission" item's note was never seen by the players it was
 * written for, and a "Copyright free" credit line was dropped too.
 */
export function ownerNote(media: Pick<Media, "description"> | null | undefined): string {
  const raw = media?.description;
  if (!raw) return "";
  try {
    const attributes = JSON.parse(raw) as { note?: unknown } | null;
    const note = attributes?.note;
    return typeof note === "string" ? note.trim() : "";
  } catch {
    return "";
  }
}
