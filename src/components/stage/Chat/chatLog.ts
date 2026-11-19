import dayjs from "@utils/dayjs";

/**
 * Chat timestamps (#1567). Every chat line carries `at` (ms since epoch, the
 * sender's clock). The chat panel shows it as a relative time in the
 * right-click menu; when a viewer turns timestamps on, every line gets the
 * clock time as well, and the downloaded log can carry a full date-time —
 * the only record of when something was said once the chat is cleared.
 */

/** Clock time for the chat panel: `14:32`, or `3 Nov 14:32` on another day. */
// `dayjs(undefined)` is "now": a line without a time must not get one.
const parse = (at: unknown) =>
  at == null || at === "" ? null : dayjs(at as string | number | Date);

export function chatClockTime(at: unknown, now: number = Date.now()): string {
  const time = parse(at);
  if (!time || !time.isValid()) return "";
  return time.isSame(dayjs(now), "day") ? time.format("HH:mm") : time.format("D MMM HH:mm");
}

/** Full stamp for the downloaded log. */
export function chatLogStamp(at: unknown): string {
  const time = parse(at);
  return time && time.isValid() ? time.format("YYYY-MM-DD HH:mm:ss") : "";
}

export interface ChatLogItem {
  user?: string;
  message?: string;
  at?: unknown;
  clear?: boolean;
  clearPlayerChat?: boolean;
}

/** One line of the downloaded log (without the line break). */
export function chatLogLine(item: ChatLogItem, withTimestamps: boolean): string {
  const stamp = withTimestamps ? chatLogStamp(item.at) : "";
  const prefix = stamp ? `[${stamp}] ` : "";
  if (item.clear || item.clearPlayerChat) {
    return `---------------- Clear Chat${stamp ? ` (${stamp})` : ""} ----------------`;
  }
  return `${prefix}${item.user ?? ""}: ${item.message ?? ""}`;
}
