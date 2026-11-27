# Meetings: what the audience can do (audience tools)

Issue #1580. Written 2026-11-28, verified against `streaming.upstage.live`
(Jitsi Meet web 9644).

## For players

A **meeting** on the stage is a Jitsi Meet room shown inside a frame. Players
always get the full Jitsi toolbar in it. The audience, by default, only
watches: no toolbar, and their browser will not give the meeting their camera
or microphone.

To let the audience take part, right-click the meeting and choose under
**Audience tools**:

| Choice                  | The audience gets                                                   |
| ----------------------- | ------------------------------------------------------------------- |
| **Off (watch only)**    | Nothing. This is the default and how every meeting behaved before.  |
| **Microphone**          | A microphone button, "raise hand" and the tile/speaker view switch. |
| **Microphone + camera** | The same, plus a camera button.                                     |

- To open the menu, right-click the green bar at the top of the meeting (or
  anywhere on it while it is selected).
- Any player can change it, at any time, and it applies to everyone at once.
  The tick in the menu shows the choice in force.
- Nobody is unmuted by it. Everyone still joins muted; a person's browser asks
  them for permission the first time they press the button.
- When you change the choice, each audience member's meeting reloads (a
  second or two) and they rejoin muted. Choosing **Off** therefore closes
  every audience microphone and camera immediately.
- Players' meetings are never reloaded by this.
- The audience never gets: hang up, settings, invite, chat, screen sharing,
  fullscreen, or any control over other people.
- A newly placed meeting always starts at **Off**.

### Showing one person to everyone ("pinning")

Clicking a person in Jitsi only changes your own view. To make everyone see
the same person large, with the others at the side, the meeting's
**moderator** switches on Jitsi's own _Everyone follows me_:

1. In the meeting's toolbar open **More actions (⋯) → Settings → Moderator**.
2. Tick **Everyone follows me**, press OK.
3. Click a person.

The menu entry **Show one person to everyone…** shows these steps on stage.

The moderator is the **first person who joined the room**. Put the meeting on
the stage and let it load before you publish it (lightbulb), and that is you.
If the moderator leaves or reloads the page, Jitsi hands the role to someone
else in the room, which can be an audience member (they get no controls for
it). To get it back, take the meeting off the stage and place it again once
the room is empty.

### What Jitsi itself does not allow

A moderator can mute other people but **cannot unmute** them — that is a
privacy rule of Jitsi. With audience tools on, ask people to unmute
themselves.

## For developers

### Where it lives

| File                                                          | Role                                                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/components/objects/MeetingObject/audienceTools.ts`       | The rules: levels, who they apply to, what each level adds. Pure functions.            |
| `src/components/objects/MeetingObject/index.vue`              | Applies a level to the audience's iframe (script only; template and styles untouched). |
| `src/components/objects/MeetingObject/ContextMenuMeeting.vue` | The menu entries.                                                                      |
| `BoardObject.audienceTools` (`stage.types.ts`)                | `"mic"`, `"mic-camera"`; absent or anything else = off.                                |

No stage-store code was added. The setting is a field of the meeting's board
object and rides the existing `shapeObject` → MQTT → `UPDATE_OBJECT` path, so
it is published only for a live object, only by a player (the store's publish
gate), is archived with the stage's events and reaches late joiners.

### How a level reaches the audience

Jitsi reads its `config.*` overrides from the iframe address, and the browser
reads the iframe's `allow` attribute, **only when the iframe loads**. So a
change of level reloads the audience's iframe (`remountIframe`, the same
reload "Refresh streams" already gives an audience member).

An open level changes exactly three settings of the watch-only set and the
permission:

|                                   | Off        | Microphone                        | Microphone + camera                       |
| --------------------------------- | ---------- | --------------------------------- | ----------------------------------------- |
| `config.toolbarButtons`           | `[]`       | `microphone, raisehand, tileview` | `microphone, camera, raisehand, tileview` |
| `interfaceConfig.TOOLBAR_BUTTONS` | `[]`       | same list                         | same list                                 |
| `config.disableSelfView`          | `true`     | `false`                           | `false`                                   |
| iframe `allow`                    | `autoplay` | `microphone; autoplay`            | `camera; microphone; autoplay`            |

`allow` is the part that binds: with a microphone button but without the
permission, pressing the button does nothing (verified). `disableSelfView` is
lifted because a person who can speak can be put on screen for everyone; with
the self view off they would be looking at a black picture.

### What must never change (and what guards it)

- **A performer's meeting is never affected.** The level is forced to `none`
  when the viewer can play, when the iframe was loaded for a performer (so
  also while they preview as audience), and in a replay
  (`effectiveAudienceTools`). `none` contributes empty objects, so the address
  and permissions are built from exactly the same values as before, and the
  reload watcher never fires for them.
- **Off is the old behaviour, to the character.**
  `index.frozen.spec.ts` pins the full iframe address for performer and
  audience, the `allow` / fullscreen / referrer attributes, the rendered
  markup and the component's template and stylesheet source. It was written
  and passed against the code _before_ this feature.
- **Only a real change of level reloads.** The store rebuilds board objects
  constantly; the same level arriving again, a move, a resize — none of them
  reload anyone (`index.audienceTools.spec.ts`).
- **A replay never opens a microphone.**

### Tests

Unit (Vitest), in `src/components/objects/MeetingObject/` unless noted:

- `index.frozen.spec.ts` — the pre-existing behaviour, frozen.
- `audienceTools.spec.ts` — the rules.
- `index.audienceTools.spec.ts` — audience / performer / masquerade / login /
  replay behaviour of the tile.
- `ContextMenuMeeting.spec.ts` — the menu.
- `src/store/pinia/stage.meetingAudienceTools.spec.ts` — the setting travels,
  only players can send it, stream tiles are untouched.

Browser (Playwright, `tests/e2e/streaming.spec.ts`, block "meeting audience
tools (#1580)"):

- contract test with a stubbed Jitsi page (always runs);
- `@live` test against the real Jitsi server (`JITSI_E2E_LIVE=1`): an audience
  member can speak only while allowed, the performer stays in the meeting as
  the same participant, and an individual stream next to the meeting keeps
  playing in the same `<video>` element.

The Jitsi server only lets the UpStage sites embed it (CSP
`frame-ancestors`), so the live test serves the working-tree app under one of
those addresses _inside the test browser_ (`aliasAppOrigin`,
`E2E_JITSI_FRAME_ORIGIN`, default `https://dev.upstage.live`). Nothing is
sent to the real site.

### Limits

- Watch-only is a safeguard in our own client, not access control. The Jitsi
  room is not password-protected and its name is in the page; someone
  determined can open the room directly. Real control needs authentication on
  the Jitsi server.
- Likewise, all sessions share one broker login, so "only players can send
  it" holds for our client, not for a hand-made one.
- UpStage cannot switch "Everyone follows me" on from outside the frame, or
  choose the moderator. Both would need Jitsi's iframe API or server-side
  authentication; neither is in place.
