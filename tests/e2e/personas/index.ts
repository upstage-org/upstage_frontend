export type House = "capulet" | "montague" | "prince" | "civic";

/**
 * meSpeak voice configuration. Field names match what `placeObjectOnStage` in
 * `src/store/modules/stage/index.ts` expects on `object.voice` and what
 * `avatarSpeak` in `src/services/speech/index.ts` reads. The outer `voice` is
 * the locale code from `src/services/speech/voice.ts` (`en/en`, `en/en-us`,
 * `en/en-rp`, `en/en-sc`, …); `variant` is one of `m1..m7` / `f1..f5` /
 * `croak` / `klatt*` / `whisper*`. Pitch tops out at 50, speed at 175,
 * amplitude at 100 (see `VoiceParameters.vue`).
 *
 * IMPORTANT: `avatarSpeak` short-circuits unless the placed avatar has a
 * truthy `avatar.voice.voice`. Personas without `voice` set will produce a
 * silent bubble — fine for headless CI, but no audio when watching a headed
 * run. To make every line audible we set a distinct voice per persona below.
 */
export interface AvatarVoice {
  voice: string;
  variant?: string;
  pitch?: number;
  speed?: number;
  amplitude?: number;
}

export interface Persona {
  username: string;
  displayName: string;
  password: string;
  email: string;
  avatar: string; // filename in assets/portraits
  house: House;
  voice?: AvatarVoice;
}

const PLAYER_PASSWORD = process.env.E2E_PLAYER_PASSWORD ?? "e2e-pw";

// Per-house accents (locale dial) so the two factions sound different even
// before per-persona variant/pitch/speed tweaks land. Civic/Prince roles get
// "received pronunciation" for an institutional flavor.
const ACCENT_BY_HOUSE: Record<House, string> = {
  capulet: "en/en-us",
  montague: "en/en",
  prince: "en/en-rp",
  civic: "en/en-rp",
};

export const ADMIN = {
  username: "admin",
  password: process.env.E2E_ADMIN_PASSWORD ?? "12345678",
} as const;

export const PERSONAS: Persona[] = [
  {
    username: "sampson",
    displayName: "Sampson",
    password: PLAYER_PASSWORD,
    email: "sampson@upstage-e2e.com",
    avatar: "sampson.png",
    house: "capulet",
    voice: { voice: ACCENT_BY_HOUSE.capulet, variant: "m2", pitch: 18, speed: 165, amplitude: 100 },
  },
  {
    username: "gregory",
    displayName: "Gregory",
    password: PLAYER_PASSWORD,
    email: "gregory@upstage-e2e.com",
    avatar: "gregory.png",
    house: "capulet",
    voice: { voice: ACCENT_BY_HOUSE.capulet, variant: "m3", pitch: 22, speed: 170, amplitude: 100 },
  },
  {
    username: "abram",
    displayName: "Abram",
    password: PLAYER_PASSWORD,
    email: "abram@upstage-e2e.com",
    avatar: "abram.png",
    house: "montague",
    voice: {
      voice: ACCENT_BY_HOUSE.montague,
      variant: "m4",
      pitch: 25,
      speed: 165,
      amplitude: 100,
    },
  },
  {
    username: "balthasar",
    displayName: "Balthasar",
    password: PLAYER_PASSWORD,
    email: "balthasar@upstage-e2e.com",
    avatar: "balthasar.png",
    house: "montague",
    voice: {
      voice: ACCENT_BY_HOUSE.montague,
      variant: "m1",
      pitch: 12,
      speed: 160,
      amplitude: 100,
    },
  },
  {
    username: "benvolio",
    displayName: "Benvolio",
    password: PLAYER_PASSWORD,
    email: "benvolio@upstage-e2e.com",
    avatar: "benvolio.png",
    house: "montague",
    voice: {
      voice: ACCENT_BY_HOUSE.montague,
      variant: "m5",
      pitch: 30,
      speed: 155,
      amplitude: 100,
    },
  },
  {
    username: "tybalt",
    displayName: "Tybalt",
    password: PLAYER_PASSWORD,
    email: "tybalt@upstage-e2e.com",
    avatar: "tybalt.png",
    house: "capulet",
    voice: { voice: ACCENT_BY_HOUSE.capulet, variant: "m2", pitch: 35, speed: 175, amplitude: 100 },
  },
  {
    username: "officer",
    displayName: "Officer",
    password: PLAYER_PASSWORD,
    email: "officer@upstage-e2e.com",
    avatar: "officer.png",
    house: "civic",
    voice: { voice: ACCENT_BY_HOUSE.civic, variant: "m6", pitch: 14, speed: 150, amplitude: 100 },
  },
  {
    username: "capulet",
    displayName: "Capulet",
    password: PLAYER_PASSWORD,
    email: "capulet@upstage-e2e.com",
    avatar: "capulet.png",
    house: "capulet",
    voice: { voice: ACCENT_BY_HOUSE.capulet, variant: "m1", pitch: 8, speed: 140, amplitude: 100 },
  },
  {
    username: "ladycapulet",
    displayName: "Lady Capulet",
    password: PLAYER_PASSWORD,
    email: "ladycapulet@upstage-e2e.com",
    avatar: "ladycapulet.png",
    house: "capulet",
    voice: { voice: ACCENT_BY_HOUSE.capulet, variant: "f3", pitch: 38, speed: 155, amplitude: 100 },
  },
  {
    username: "montague",
    displayName: "Montague",
    password: PLAYER_PASSWORD,
    email: "montague@upstage-e2e.com",
    avatar: "montague.png",
    house: "montague",
    voice: {
      voice: ACCENT_BY_HOUSE.montague,
      variant: "m1",
      pitch: 10,
      speed: 145,
      amplitude: 100,
    },
  },
  {
    username: "ladymontague",
    displayName: "Lady Montague",
    password: PLAYER_PASSWORD,
    email: "ladymontague@upstage-e2e.com",
    avatar: "ladymontague.png",
    house: "montague",
    voice: {
      voice: ACCENT_BY_HOUSE.montague,
      variant: "f4",
      pitch: 40,
      speed: 150,
      amplitude: 100,
    },
  },
  {
    username: "prince",
    displayName: "Prince Escalus",
    password: PLAYER_PASSWORD,
    email: "prince@upstage-e2e.com",
    avatar: "prince.png",
    house: "prince",
    voice: { voice: ACCENT_BY_HOUSE.prince, variant: "m1", pitch: 5, speed: 130, amplitude: 100 },
  },
  {
    username: "romeo",
    displayName: "Romeo",
    password: PLAYER_PASSWORD,
    email: "romeo@upstage-e2e.com",
    avatar: "romeo.png",
    house: "montague",
    voice: {
      voice: ACCENT_BY_HOUSE.montague,
      variant: "m3",
      pitch: 32,
      speed: 165,
      amplitude: 100,
    },
  },
];

export const findPersona = (username: string): Persona => {
  const found = PERSONAS.find((p) => p.username === username);
  if (!found) throw new Error(`Persona not found: ${username}`);
  return found;
};
