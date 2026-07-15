# Stream audio: who hears what, and why the publisher hears nothing

This documents the default audio behaviour of live stream tiles (individual
jitsi streams and RTMP feeds) — in particular why **the person playing a
stream never hears their own stream**, without pressing Mute anywhere.

## The publisher's own tile is silent by design

Every stage tile renders media through two elements (`MeetingObject/Jitsi.vue`):

- a `<video>` that is **always muted** (`:muted.attr="true"`) — for everyone,
  publisher and viewers alike. Video elements never produce sound in UpStage.
- a sibling `<audio>` element that is the only thing that ever produces sound.

The audio track is attached to that `<audio>` element in `loadTrack()` under
this guard:

```js
if (audioTrack.value && !audioTrack.value.isLocal() && audioEl.value && ...) {
  audioTrack.value.attach(audioEl.value);
}
```

`isLocal()` is lib-jitsi-meet's "this track was captured in THIS browser"
test. For the performer who started the stream, their own tile's audio track
is a local track, so **the attach never happens: their `<audio>` element has
no source at all**. This is not a muted-by-default flag — the publisher's
browser simply never wires their own microphone back into their own speakers.
That is the echo/feedback protection: without it, the mic would pick up its
own playback and howl.

Everyone else in the conference receives that track as a _remote_ track
(`isLocal()` false), so the attach happens and they hear the stream from the
first packet (with a Safari autoplay retry on first user gesture).

The floating self-preview (`MeetingObject/Yourself.vue`) plays video only,
explicitly `{ muted: true }` — same reason.

## RTMP feeds

An RTMP publisher (OBS etc.) is not in the browser, so there is no local
track and no self-mute question: `LiveStreamPlayer.vue` plays audio for every
viewer, subject to the same local controls below.

## Local, never-broadcast audio controls on top

Viewers (and the publisher, for _other_ people's streams) can adjust each
tile via right-click → **Mute locally** / **Volume setting**. These write to
the stage store's `_streamLocalAudio` map (`streamLocalMuted` /
`streamLocalVolume`, defaults: unmuted, volume 100) and bind to the tile's
`<audio>`/`<video>` element (`:muted="localMuted"`, `element.volume`).

They are deliberately **local to that browser and never broadcast**: several
performers sharing one physical room can each silence their own playback
without turning the stream off for the audience.

## Summary table

| Listener                    | Hears the stream? | Mechanism                                                                             |
| --------------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| Publisher (same browser)    | No, always        | local track never attached to `<audio>` (`!isLocal()` guard in `Jitsi.vue loadTrack`) |
| Other performers / audience | Yes, by default   | remote track attached to `<audio>`, unmuted, volume 100                               |
| Anyone using "Mute locally" | No, until unmuted | `_streamLocalAudio` in the stage store, per-browser, never broadcast                  |
