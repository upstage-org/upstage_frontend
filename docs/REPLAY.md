# Replay recordings

## What a recording is

A **recording** (Performance) is a saved **event log**: MQTT messages the stage archived during a performance window (`topic`, `payload`, `mqttTimestamp`). Replay rebuilds the board and chat by replaying those events on a timer — not by re-running the live MQTT connection.

## Share a recording

Each saved performance has its own URL:

`/replay/<stage-file-location>/<performance-id>`

Use **Copy replay link** in Studio → Archive or on the replay page header.

Automated check (requires e2e setup + archived performance): `pnpm e2e:replay-studio`.

## Studio (Archive tab)

- **Archive performance** (Sweep) creates a new recording from activity since the last archive.
- **Trim idle gaps** creates a **new** performance with long silences shortened; the original log is kept.
- **Delete** removes the performance and its replay/chat archive (cannot be undone).
- **Download chat** exports text logs; this is separate from chat lines that appear during replay (only messages stored as `chat` events in the log replay in the viewer).

## Replay viewer

- Press **Play** after the preloader; use the scrub bar, skip ±10s, and speed controls.
- **Loop** (exhibition): enable the loop toggle to restart automatically when the recording ends.
- **Markers** (browser-local): add labels at the current time on the scrub bar; click a marker to jump. Stored in this browser only until server-side markers exist.
- **Hide controls**: minimise button or `Esc`.
- Player/audience counts during replay reflect **`counter` events** in the log. If counts stay at zero, the archive may not include session presence events.

## Audience view

Replay is watch-only: no performer toolbox, no avatar teardrop holder marks, no dragging objects.

## On-stage recording (performers)

Owners/editors/players see a **camera** control near the live status counter to start/stop a named recording without leaving the stage. Starting a recording clears the stage (same as Studio copy warns).
