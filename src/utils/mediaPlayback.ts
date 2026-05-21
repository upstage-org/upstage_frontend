/**
 * Cross-browser helpers for HTMLMediaElement autoplay (Safari / iOS focus).
 */

export interface PlayMediaOptions {
  /** Set muted attribute + IDL property (required for autoplay on Safari). */
  muted?: boolean;
  /** Set playsinline on &lt;video&gt; (required on iOS Safari). */
  inline?: boolean;
}

/** Mirror attributes Safari gates on before `play()` resolves. */
export function prepareMediaElement(
  el: HTMLMediaElement | null | undefined,
  opts: PlayMediaOptions = {},
): void {
  if (!el) return;
  if (opts.muted) {
    el.setAttribute("muted", "");
    el.muted = true;
  }
  if (opts.inline && el instanceof HTMLVideoElement) {
    el.setAttribute("playsinline", "");
    el.playsInline = true;
  }
}

/**
 * Call `play()` and surface rejections without throwing. Returns the
 * native promise (or a resolved one when `el` is missing).
 */
export function playMediaElement(
  el: HTMLMediaElement | null | undefined,
  opts: PlayMediaOptions = {},
): Promise<void> {
  if (!el) return Promise.resolve();
  prepareMediaElement(el, opts);
  const playPromise = el.play();
  if (playPromise && typeof playPromise.catch === "function") {
    return playPromise.catch((err: unknown) => {
      console.warn("Media autoplay was blocked:", err);
      throw err;
    });
  }
  return Promise.resolve();
}

/**
 * Re-attempt `play()` on the next user gesture when autoplay was blocked.
 */
export function retryPlayOnUserGesture(el: HTMLMediaElement | null | undefined): void {
  if (!el) return;
  const retry = () => {
    el.play().catch(() => {});
    window.removeEventListener("pointerdown", retry);
    window.removeEventListener("keydown", retry);
  };
  window.addEventListener("pointerdown", retry, { once: true });
  window.addEventListener("keydown", retry, { once: true });
}
