# Browser support

UpStage targets **desktop Safari 15+**, **iOS/iPadOS Safari 15+**, and current Chromium / Firefox releases with the same behaviour and styling. Browser-specific widgets (native color pickers, file inputs) may differ visually.

## Automated checks

- Unit: `pnpm test` — `src/utils/browser.spec.ts` (iOS / Safari / WebKit detection, `coerceNumber`).
- E2E: `pnpm e2e:webkit` — Playwright **Desktop Safari** smoke (`tests/e2e/stage.spec.ts`).

## Manual QA checklist

### Desktop Safari

- [ ] Login and studio stage list load
- [ ] Live stage: toolbox tab switch, stream tile, chat send
- [ ] Replay: scrub bar thumb/track styling, loop toggle persists after refresh
- [ ] Stage management tables and modals (z-index / overflow)

### iOS / iPadOS Safari

- [ ] Chat input does not zoom the page (16px inputs in standalone chat)
- [ ] Drag avatar / prop onto board (mobile-drag-drop hold-to-drag)
- [ ] Performer local camera preview after permission prompt
- [ ] Audience Jitsi tile plays after returning from background
- [ ] Replay preloader tap-to-start

### Known limitations (out of scope)

- Safari &lt; 15
- Codec gaps in lib-jitsi-meet / flv.js where the browser cannot decode the container
- Per-stream volume sliders on iOS (hardware volume only; UI hidden)
