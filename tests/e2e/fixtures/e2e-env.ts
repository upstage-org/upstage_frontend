/** True when `E2E_FORCE_FRESH_SETUP` requests a new authoring run (ignore `runtime.json`). */
export function forceFreshSetup(): boolean {
  const v = process.env.E2E_FORCE_FRESH_SETUP;
  if (!v) return false;
  const x = v.trim().toLowerCase();
  return x !== "0" && x !== "false" && x !== "no" && x !== "off";
}
