import { shallowReactive } from "vue";
import type { Dayjs } from "@utils/dayjs";
import { DEFAULT_STAGE_ACCESS } from "utils/studioInquiry";

// Module-scope so the Stages list filters survive navigating to
// StageManagement and back (the routes are siblings, so the view fully
// remounts). Same per-tab lifetime as the shared `inquiryVar`. Shallow:
// the widgets replace these values wholesale, and dayjs instances must not
// be wrapped in proxies.
export const stageListFilters = shallowReactive<{
  name: string;
  owners: string[];
  access: string[];
  dates?: [Dayjs, Dayjs];
}>({
  name: "",
  owners: [],
  access: [...DEFAULT_STAGE_ACCESS],
  dates: undefined,
});
