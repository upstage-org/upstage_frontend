import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import utc from "dayjs/plugin/utc";
import localizedFormat from "dayjs/plugin/localizedFormat";
import duration from "dayjs/plugin/duration";

/**
 * Central dayjs setup. Import the default export from this module instead of
 * `dayjs` directly so all plugins are consistently registered. This replaces
 * the moment.js dependency across the codebase.
 */
dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(localizedFormat);
dayjs.extend(duration);

export default dayjs;
export type { Dayjs } from "dayjs";
