export type House = "capulet" | "montague" | "prince" | "civic";

export interface Persona {
  username: string;
  displayName: string;
  password: string;
  email: string;
  avatar: string; // filename in assets/portraits
  house: House;
}

const PLAYER_PASSWORD = process.env.E2E_PLAYER_PASSWORD ?? "e2e-pw";

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
  },
  {
    username: "gregory",
    displayName: "Gregory",
    password: PLAYER_PASSWORD,
    email: "gregory@upstage-e2e.com",
    avatar: "gregory.png",
    house: "capulet",
  },
  {
    username: "abram",
    displayName: "Abram",
    password: PLAYER_PASSWORD,
    email: "abram@upstage-e2e.com",
    avatar: "abram.png",
    house: "montague",
  },
  {
    username: "balthasar",
    displayName: "Balthasar",
    password: PLAYER_PASSWORD,
    email: "balthasar@upstage-e2e.com",
    avatar: "balthasar.png",
    house: "montague",
  },
  {
    username: "benvolio",
    displayName: "Benvolio",
    password: PLAYER_PASSWORD,
    email: "benvolio@upstage-e2e.com",
    avatar: "benvolio.png",
    house: "montague",
  },
  {
    username: "tybalt",
    displayName: "Tybalt",
    password: PLAYER_PASSWORD,
    email: "tybalt@upstage-e2e.com",
    avatar: "tybalt.png",
    house: "capulet",
  },
  {
    username: "officer",
    displayName: "Officer",
    password: PLAYER_PASSWORD,
    email: "officer@upstage-e2e.com",
    avatar: "officer.png",
    house: "civic",
  },
  {
    username: "capulet",
    displayName: "Capulet",
    password: PLAYER_PASSWORD,
    email: "capulet@upstage-e2e.com",
    avatar: "capulet.png",
    house: "capulet",
  },
  {
    username: "ladycapulet",
    displayName: "Lady Capulet",
    password: PLAYER_PASSWORD,
    email: "ladycapulet@upstage-e2e.com",
    avatar: "ladycapulet.png",
    house: "capulet",
  },
  {
    username: "montague",
    displayName: "Montague",
    password: PLAYER_PASSWORD,
    email: "montague@upstage-e2e.com",
    avatar: "montague.png",
    house: "montague",
  },
  {
    username: "ladymontague",
    displayName: "Lady Montague",
    password: PLAYER_PASSWORD,
    email: "ladymontague@upstage-e2e.com",
    avatar: "ladymontague.png",
    house: "montague",
  },
  {
    username: "prince",
    displayName: "Prince Escalus",
    password: PLAYER_PASSWORD,
    email: "prince@upstage-e2e.com",
    avatar: "prince.png",
    house: "prince",
  },
  {
    username: "romeo",
    displayName: "Romeo",
    password: PLAYER_PASSWORD,
    email: "romeo@upstage-e2e.com",
    avatar: "romeo.png",
    house: "montague",
  },
];

export const findPersona = (username: string): Persona => {
  const found = PERSONAS.find((p) => p.username === username);
  if (!found) throw new Error(`Persona not found: ${username}`);
  return found;
};
