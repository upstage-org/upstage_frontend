import { animate } from "animejs";

// Removal effects for stage objects, set per stage assignment (the
// stage<->media link). Single source of truth: the assignment editors
// render these options and Board.vue's leave hook dispatches on the
// same values. "fade" at medium speed is the default when nothing is set.
export const DEFAULT_EXIT_ANIMATION = "fade";

// Discrete speed choices shown wherever exit settings are edited, as
// durations in ms. Fast keeps the old slider's fast endpoint; Slow stays
// under the slider's former 10s ceiling, which dragged too long.
export const EXIT_SPEED_OPTIONS = [
  { value: 8000, label: "Slow" },
  { value: 3000, label: "Medium" },
  { value: 1000, label: "Fast" },
];
export const DEFAULT_EXIT_SPEED = 3000;

// Stored speeds predating the discrete options can be any ms value from
// the old slider; snap them to the closest option (ratio-wise, since the
// steps are logarithmic) so the picker always has a selection.
export const nearestExitSpeed = (speed) => {
  const duration = Number(speed);
  if (!Number.isFinite(duration) || duration <= 0) return DEFAULT_EXIT_SPEED;
  return EXIT_SPEED_OPTIONS.reduce((best, option) =>
    Math.abs(Math.log(duration / option.value)) < Math.abs(Math.log(duration / best.value))
      ? option
      : best,
  ).value;
};

// Only these media types render on the board and run a removal animation,
// so only they get exit settings in the assignment editors. (Streams fold
// to "video" on the board — see SET_MODEL — so they exit too. Audio,
// backdrops and curtains never leave the board as objects.)
export const EXIT_ANIMATED_TYPES = ["avatar", "prop", "video", "stream"];

export const REMOVAL_ANIMATION_OPTIONS = [
  { value: "vanish", label: "Disappear (instant)" },
  { value: "spiral", label: "Spiral (classic)" },
  { value: "poof", label: "Poof! (cartoon smoke cloud)" },
  { value: "fade", label: "Fade out" },
  { value: "fall", label: "Trapdoor (drops off the stage)" },
  { value: "flyaway", label: "Fly away (floats off the top)" },
  { value: "tvoff", label: "TV off (squashes to a line)" },
  { value: "pop", label: "Bubble pop" },
  { value: "genie", label: "Genie (sucked away)" },
  { value: "ghost", label: "Ghost (drifts up and fades)" },
  { value: "sparkle", label: "Sparkle (dissolves into glitter)" },
];

const boardElement = () => document.getElementById("board");

const boardEdge = (edge, fallback) => {
  const board = boardElement();
  return board ? board.getBoundingClientRect()[edge] : fallback;
};

const POOF_SVG = `
<svg viewBox="0 0 120 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
  <g fill="#f5f5f5" stroke="#c8c8c8" stroke-width="2" stroke-linejoin="round">
    <circle cx="34" cy="56" r="23"/>
    <circle cx="60" cy="40" r="27"/>
    <circle cx="87" cy="56" r="21"/>
    <circle cx="47" cy="70" r="19"/>
    <circle cx="73" cy="70" r="19"/>
  </g>
  <text x="60" y="62" text-anchor="middle"
    font-family="'Comic Sans MS','Chalkboard SE',cursive" font-size="24"
    font-weight="bold" fill="#555" transform="rotate(-8 60 62)">poof!</text>
</svg>`;

const ANIMATIONS = {
  spiral: ({ target, duration, complete }) =>
    animate(target, {
      scale: 0,
      rotate: 180,
      duration,
      ease: "inOutQuad",
      onComplete: complete,
    }),

  fade: ({ target, duration, complete }) =>
    animate(target, {
      opacity: 0,
      duration,
      ease: "outQuad",
      onComplete: complete,
    }),

  vanish: ({ complete }) => complete(),

  fall: ({ target, duration, complete }) => {
    const rect = target.getBoundingClientRect();
    const bottom = boardEdge("bottom", window.innerHeight);
    animate(target, {
      translateY: bottom - rect.top + rect.height,
      rotate: 6,
      duration,
      ease: "inQuad",
      onComplete: complete,
    });
  },

  flyaway: ({ target, duration, complete }) => {
    const rect = target.getBoundingClientRect();
    const top = boardEdge("top", 0);
    animate(target, {
      translateY: -(rect.bottom - top + 40),
      scale: 0.4,
      duration,
      ease: "inSine",
      onComplete: complete,
    });
  },

  tvoff: ({ target, duration, complete }) =>
    animate(target, {
      scaleY: [{ to: 0.01, duration: duration * 0.6, ease: "inOutQuad" }],
      scaleX: [
        { to: 1.15, duration: duration * 0.6, ease: "inOutQuad" },
        { to: 0, duration: duration * 0.4, ease: "inQuad" },
      ],
      filter: ["brightness(1)", "brightness(3)"],
      duration,
      onComplete: complete,
    }),

  pop: ({ target, duration, complete }) =>
    animate(target, {
      scale: [
        { to: 1.2, duration: duration * 0.7, ease: "outQuad" },
        { to: 0, duration: duration * 0.15, ease: "inQuad" },
      ],
      opacity: [
        { to: 1, duration: duration * 0.7 },
        { to: 0, duration: duration * 0.15 },
      ],
      onComplete: complete,
    }),

  genie: ({ target, duration, complete }) => {
    target.style.transformOrigin = "50% 100%";
    animate(target, {
      scaleY: [
        { to: 1.35, duration: duration * 0.4, ease: "outQuad" },
        { to: 0, duration: duration * 0.6, ease: "inQuad" },
      ],
      scaleX: [
        { to: 0.55, duration: duration * 0.4 },
        { to: 0, duration: duration * 0.6, ease: "inQuad" },
      ],
      skewX: [
        { to: 12, duration: duration * 0.4 },
        { to: -10, duration: duration * 0.6 },
      ],
      opacity: { to: 0, duration, ease: "inCubic" },
      onComplete: complete,
    });
  },

  ghost: ({ target, duration, complete }) => {
    // Seed a concrete filter so anime can interpolate (computed "none" won't).
    target.style.filter = "grayscale(0) brightness(1)";
    animate(target, {
      filter: "grayscale(1) brightness(1.8)",
      translateY: -120,
      opacity: [
        { to: 0.65, duration: duration * 0.3 },
        { to: 0, duration: duration * 1.2 },
      ],
      duration: duration * 1.5, // a ghost takes its time
      ease: "outSine",
      onComplete: complete,
    });
  },

  sparkle: ({ target, duration, complete, board }) => {
    // Measure before complete() — Vue removes the element the moment it fires.
    const rect = target.getBoundingClientRect();

    animate(target, {
      opacity: 0,
      scale: 0.9,
      duration,
      ease: "outQuad",
      onComplete: complete,
    });

    // Glitter burst on the board overlay (never on the leaving element),
    // each dot cleaning itself up independently of the object's removal.
    if (!board) return;
    const boardRect = board.getBoundingClientRect();
    const cx = rect.left - boardRect.left + rect.width / 2;
    const cy = rect.top - boardRect.top + rect.height / 2;
    const reach = Math.max(rect.width, rect.height) * 0.7 + 30;
    const count = 14;
    for (let i = 0; i < count; i++) {
      const size = 4 + Math.random() * 5;
      const dot = document.createElement("div");
      dot.setAttribute("aria-hidden", "true");
      dot.style.cssText =
        "position:absolute;pointer-events:none;z-index:30;border-radius:50%;" +
        "background:#fff;box-shadow:0 0 6px 2px rgba(255,235,150,0.9);" +
        `left:${cx - size / 2}px;top:${cy - size / 2}px;` +
        `width:${size}px;height:${size}px;`;
      board.appendChild(dot);
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.8;
      const dist = reach * (0.5 + Math.random() * 0.7);
      animate(dot, {
        translateX: Math.cos(angle) * dist,
        translateY: Math.sin(angle) * dist - 20, // slight upward drift
        opacity: [1, 0],
        scale: [1, 0.3],
        duration: duration * (0.6 + Math.random() * 0.6),
        delay: Math.random() * duration * 0.25,
        ease: "outCubic",
        onComplete: () => dot.remove(),
      });
    }
  },

  poof: ({ target, duration, complete, board }) => {
    // Measure before complete() — Vue removes the element the moment it fires.
    const rect = target.getBoundingClientRect();

    animate(target, {
      scale: 0,
      duration: Math.min(150, duration * 0.15),
      ease: "inQuad",
      onComplete: complete,
    });

    // The cloud lives on the board overlay (never on the leaving element)
    // and cleans itself up independently of the object's removal.
    if (!board) return;
    const boardRect = board.getBoundingClientRect();
    const size = Math.min(Math.max(80, Math.max(rect.width, rect.height) * 1.1), 400);
    const cloud = document.createElement("div");
    cloud.setAttribute("aria-hidden", "true");
    cloud.style.cssText =
      "position:absolute;pointer-events:none;z-index:30;" +
      `left:${rect.left - boardRect.left + rect.width / 2 - size / 2}px;` +
      `top:${rect.top - boardRect.top + rect.height / 2 - size / 2}px;` +
      `width:${size}px;height:${size}px;`;
    cloud.innerHTML = POOF_SVG;
    board.appendChild(cloud);
    animate(cloud, {
      scale: [0.35, 1.15],
      opacity: [
        { to: 1, duration: duration * 0.5 },
        { to: 0, duration: duration * 0.5 },
      ],
      filter: ["blur(0px)", "blur(5px)"],
      rotate: [-4, 4],
      duration,
      ease: "outCubic",
      onComplete: () => cloud.remove(),
    });
  },
};

/**
 * @param {string} name
 * @param {Element} el wrapper containing the `.object` div to animate
 * @param {() => void} complete
 * @param {{ duration?: number, board?: Element | null }} [options]
 */
export function runRemovalAnimation(name, el, complete, { duration = 1000, board } = {}) {
  const target = el.querySelector(".object");
  // Never strand Vue's leave hook: no target means nothing to animate, but
  // complete() must still fire or the element ghosts in the DOM forever.
  if (!target) return complete();
  // `board` hosts the detached overlays (poof cloud, sparkle glitter). On
  // stage that's #board; the studio media-form preview passes its own box.
  (ANIMATIONS[name] || ANIMATIONS[DEFAULT_EXIT_ANIMATION])({
    target,
    duration,
    complete,
    board: board ?? boardElement(),
  });
}
