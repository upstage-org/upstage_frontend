/**
 * Starting frame for a multiframe autoplay run (board objects, backdrops,
 * curtains — Object.vue / Backdrop.vue / Curtain.vue all seed their
 * setInterval cycle through this).
 *
 * A play-once run (`frameLoop === false`) that would begin ON the final
 * frame has nowhere to advance: its first tick lands on `next >= length`
 * and stops the run before a single frame change. Since a finished
 * play-once run parks the displayed frame on the last one, every replay
 * after the first looked completely dead. Rewind exactly that case to
 * the first frame; looping runs (and mid-strip starts) keep their frame.
 */
export function autoplayStartFrame<T>(
  frames: readonly T[] | null | undefined,
  startFrame: T | null,
  frameLoop: boolean | undefined,
): T | null {
  if (frameLoop !== false) return startFrame;
  if (!frames?.length) return startFrame;
  return frames.indexOf(startFrame as T) === frames.length - 1 ? frames[0] : startFrame;
}
