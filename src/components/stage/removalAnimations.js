import { animate } from "animejs";

// Removal effects for stage objects, set per stage assignment (the
// stage<->media link). Single source of truth: the assignment editors
// render these options and Board.vue's leave hook dispatches on the
// same values. "fade" at medium speed is the default when nothing is set.
export const DEFAULT_EXIT_ANIMATION = "fade";

// Exit speed is a continuous slow<->fast slider (see ExitSettings.vue):
// slider value is 1000/duration in [0.1, 1], i.e. durations of 1-10s.
export const DEFAULT_EXIT_SPEED = 3000;

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

const POP_SVG = `
<svg viewBox="0 0 120 120" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
  <polygon fill="#ffe14d" stroke="#ff8c00" stroke-width="3" stroke-linejoin="round"
    points="118,60 89,67.8 110.2,89 81.2,81.2 89,110.2 67.8,89 60,118 52.2,89
            31,110.2 38.8,81.2 9.8,89 31,67.8 2,60 31,52.2 9.8,31 38.8,38.8
            31,9.8 52.2,31 60,2 67.8,31 89,9.8 81.2,38.8 110.2,31 89,52.2"/>
  <text x="60" y="70" text-anchor="middle"
    font-family="'Comic Sans MS','Chalkboard SE',cursive" font-size="28"
    font-weight="bold" fill="#d42a2a" transform="rotate(-6 60 62)">POP!</text>
</svg>`;

const TRAPDOOR_SVG = `
<svg viewBox="0 0 140 90" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="70" cy="70" rx="60" ry="16" fill="#141414" stroke="#000" stroke-width="2"/>
  <g class="trapdoor-lid">
    <ellipse cx="70" cy="70" rx="60" ry="16" fill="#a9743d" stroke="#6b4519" stroke-width="2.5"/>
    <path d="M14 66 Q70 84 126 66" stroke="#6b4519" stroke-width="2" fill="none"/>
    <path d="M22 62 Q70 78 118 62" stroke="#6b4519" stroke-width="1.5" fill="none"/>
    <circle cx="112" cy="70" r="3.5" fill="#4a2f10"/>
  </g>
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

  fall: ({ target, duration, complete, board }) => {
    const rect = target.getBoundingClientRect();
    if (!board) {
      // No overlay host: keep the plain drop off the stage.
      const bottom = boardEdge("bottom", window.innerHeight);
      animate(target, {
        translateY: bottom - rect.top + rect.height,
        rotate: 6,
        duration,
        ease: "inQuad",
        onComplete: complete,
      });
      return;
    }

    // Cartoon trapdoor at the object's feet: the hole pops open (lid
    // standing up), the object hops and plunges through — clipped at the
    // hole line so it vanishes into the floor — then the lid slams shut
    // and the whole thing fades away.
    const boardRect = board.getBoundingClientRect();
    const open = duration * 0.18;
    const drop = duration * 0.55;
    const slam = duration * 0.27;
    const holeW = Math.min(rect.width * 1.35 + 20, 520);
    // Container is taller than the hole so the open lid fits above it; the
    // ellipse centre sits at 78% of the SVG's height (cy 70 of 90).
    const holeH = holeW * (90 / 140);
    const hole = document.createElement("div");
    hole.setAttribute("aria-hidden", "true");
    hole.style.cssText =
      "position:absolute;pointer-events:none;z-index:30;" +
      `left:${rect.left - boardRect.left + rect.width / 2 - holeW / 2}px;` +
      `top:${rect.bottom - boardRect.top - holeH * 0.78}px;` +
      `width:${holeW}px;height:${holeH}px;transform-origin:50% 78%;`;
    hole.innerHTML = TRAPDOOR_SVG;
    board.appendChild(hole);
    const lid = hole.querySelector(".trapdoor-lid");
    lid.style.transformBox = "fill-box";
    lid.style.transformOrigin = "left center";
    lid.style.transform = "rotate(-75deg)";
    animate(hole, { scale: [0, 1], duration: open, ease: "outBack" });

    const fallDist = Math.round(rect.height + holeH * 0.25);
    // The clip's bottom inset tracks translateY so everything below the
    // hole line hides as the object descends ("under the stage"). Generous
    // negative insets on the other sides keep the anticipation hop and any
    // frame shape from being clipped early. 3-value inset() form throughout
    // — browsers serialize to it, and anime pairs the numbers positionally.
    target.style.clipPath = "inset(-200px -200px 0px)";
    animate(target, {
      translateY: [
        { to: -rect.height * 0.06, duration: open, ease: "outQuad" },
        { to: fallDist, duration: drop, ease: "inQuad" },
      ],
      clipPath: [
        { to: "inset(-200px -200px 0px)", duration: open },
        { to: `inset(-200px -200px ${fallDist}px)`, duration: drop, ease: "inQuad" },
      ],
      duration: open + drop,
      onComplete: () => {
        complete();
        animate(lid, { rotate: [-75, 0], duration: slam * 0.45, ease: "inQuad" });
        animate(hole, {
          opacity: [
            { to: 1, duration: slam * 0.65 },
            { to: 0, duration: slam * 0.35, ease: "outQuad" },
          ],
          duration: slam,
          onComplete: () => hole.remove(),
        });
      },
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

  tvoff: ({ target, duration, complete, board }) => {
    // Measure before the squash so the overlay line lands on the picture.
    const rect = target.getBoundingClientRect();
    const squash = duration * 0.55;
    const collapse = duration * 0.2;
    animate(target, {
      scaleY: [{ to: 0.01, duration: squash, ease: "inOutQuad" }],
      scaleX: [
        { to: 1.15, duration: squash, ease: "inOutQuad" },
        { to: 0, duration: collapse, ease: "inQuad" },
      ],
      filter: ["brightness(1)", "brightness(3)"],
      duration: squash + collapse,
      onComplete: complete,
    });

    // The squashed picture alone barely reads (a transparent PNG becomes a
    // faint smear), so draw the classic bright CRT line on the board
    // overlay: it lights up as the picture squashes, collapses to a dot,
    // flashes and blinks out after the object is gone.
    if (!board) return;
    const boardRect = board.getBoundingClientRect();
    const width = rect.width * 1.15;
    const afterglow = duration - squash - collapse;
    const line = document.createElement("div");
    line.setAttribute("aria-hidden", "true");
    line.style.cssText =
      "position:absolute;pointer-events:none;z-index:30;border-radius:3px;background:#fff;" +
      "box-shadow:0 0 14px 4px rgba(255,255,255,0.95),0 0 40px 8px rgba(180,220,255,0.6);" +
      `left:${rect.left - boardRect.left + rect.width / 2 - width / 2}px;` +
      `top:${rect.top - boardRect.top + rect.height / 2 - 2}px;` +
      `width:${width}px;height:4px;opacity:0;`;
    board.appendChild(line);
    animate(line, {
      opacity: [
        { to: 0.15, duration: squash * 0.6, ease: "inQuad" },
        { to: 1, duration: squash * 0.4 },
        { to: 1, duration: collapse },
        { to: 0, duration: afterglow, ease: "outQuad" },
      ],
      scaleX: [
        { to: 1, duration: squash },
        { to: 0.05, duration: collapse, ease: "inQuad" },
        { to: 0.05, duration: afterglow },
      ],
      scaleY: [
        { to: 1, duration: squash + collapse },
        { to: 4, duration: afterglow * 0.4, ease: "outQuad" },
        { to: 0.2, duration: afterglow * 0.6, ease: "inQuad" },
      ],
      duration,
      onComplete: () => line.remove(),
    });
  },

  pop: ({ target, duration, complete, board }) => {
    // Measure before inflating so the burst lands on the bubble's centre.
    const rect = target.getBoundingClientRect();
    const inflate = duration * 0.72;
    animate(target, {
      // Wobbling over-inflation — clearly a bubble about to burst.
      scale: [
        { to: 1.18, duration: inflate * 0.3, ease: "outQuad" },
        { to: 1.12, duration: inflate * 0.15, ease: "inOutQuad" },
        { to: 1.38, duration: inflate * 0.25, ease: "outQuad" },
        { to: 1.3, duration: inflate * 0.12, ease: "inOutQuad" },
        { to: 1.62, duration: inflate * 0.18, ease: "outQuad" },
      ],
      duration: inflate,
      onComplete: () => {
        // Bang: the bubble blinks out...
        animate(target, {
          scale: 0,
          opacity: 0,
          duration: Math.min(90, duration * 0.06),
          ease: "inQuad",
          onComplete: complete,
        });

        // ...replaced by a comic POP! starburst and a spray of droplets on
        // the board overlay, which clean themselves up independently.
        if (!board) return;
        const boardRect = board.getBoundingClientRect();
        const cx = rect.left - boardRect.left + rect.width / 2;
        const cy = rect.top - boardRect.top + rect.height / 2;
        const size = Math.min(Math.max(90, Math.max(rect.width, rect.height) * 1.6), 420);
        const bang = document.createElement("div");
        bang.setAttribute("aria-hidden", "true");
        bang.style.cssText =
          "position:absolute;pointer-events:none;z-index:30;" +
          `left:${cx - size / 2}px;top:${cy - size / 2}px;` +
          `width:${size}px;height:${size}px;`;
        bang.innerHTML = POP_SVG;
        board.appendChild(bang);
        animate(bang, {
          scale: [0.25, 1.1],
          rotate: [-10, 4],
          opacity: [
            { to: 1, duration: duration * 0.16 },
            { to: 0, duration: duration * 0.12, ease: "inQuad" },
          ],
          duration: duration * 0.28,
          ease: "outBack",
          onComplete: () => bang.remove(),
        });
        const reach = size * 0.75;
        for (let i = 0; i < 10; i++) {
          const dotSize = 5 + Math.random() * 5;
          const dot = document.createElement("div");
          dot.setAttribute("aria-hidden", "true");
          dot.style.cssText =
            "position:absolute;pointer-events:none;z-index:30;border-radius:50%;" +
            "background:#dff3ff;box-shadow:0 0 6px 2px rgba(170,220,255,0.9);" +
            `left:${cx - dotSize / 2}px;top:${cy - dotSize / 2}px;` +
            `width:${dotSize}px;height:${dotSize}px;`;
          board.appendChild(dot);
          const angle = (i / 10) * Math.PI * 2 + Math.random() * 0.6;
          const dist = reach * (0.6 + Math.random() * 0.6);
          animate(dot, {
            translateX: Math.cos(angle) * dist,
            translateY: Math.sin(angle) * dist,
            opacity: [1, 0],
            scale: [1, 0.3],
            duration: duration * (0.2 + Math.random() * 0.15),
            ease: "outCubic",
            onComplete: () => dot.remove(),
          });
        }
      },
    });
  },

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
