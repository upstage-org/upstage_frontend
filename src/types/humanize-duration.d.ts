declare module "humanize-duration" {
  function humanizeDuration(ms: number, options?: Record<string, unknown>): string;
  export default humanizeDuration;
}
