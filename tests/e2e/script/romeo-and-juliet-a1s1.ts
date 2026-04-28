/**
 * Romeo and Juliet, Act I, Scene I — beat-by-beat condensation of the public
 * domain Folger Shakespeare Library text, lightly trimmed where line-by-line
 * fidelity isn't worth the test runtime. Every speaking part of the canonical
 * 13-actor cast appears at least once. Lines marked `smoke: true` form the
 * 5-beat slice driven by `pnpm e2e:smoke`.
 */

export type BeatKind = "speak" | "shout" | "think" | "move" | "enter" | "exit" | "backdrop";

export interface Beat {
  speaker: string; // persona username; empty for backdrop/scene actions.
  kind: BeatKind;
  line?: string;
  to?: { x: number; y: number };
  backdrop?: string;
  smoke?: true;
  /** Free-form description used in step titles. */
  note?: string;
}

const VERONA = "verona-street";
const GATE = "capulet-gate";

export const BEATS: Beat[] = [
  { speaker: "", kind: "backdrop", backdrop: VERONA, note: "Open on Verona", smoke: true },
  { speaker: "sampson", kind: "enter", to: { x: 200, y: 280 }, note: "Sampson arrives" },
  { speaker: "gregory", kind: "enter", to: { x: 280, y: 280 }, note: "Gregory arrives" },

  { speaker: "sampson", kind: "speak", line: "Gregory, on my word, we'll not carry coals.", smoke: true },
  { speaker: "gregory", kind: "speak", line: "No, for then we should be colliers." },
  { speaker: "sampson", kind: "speak", line: "I mean, an we be in choler, we'll draw." },
  { speaker: "gregory", kind: "speak", line: "Ay, while you live, draw your neck out of collar." },
  { speaker: "sampson", kind: "speak", line: "I strike quickly, being moved." },
  { speaker: "gregory", kind: "speak", line: "But thou art not quickly moved to strike." },
  { speaker: "sampson", kind: "speak", line: "A dog of the house of Montague moves me." },
  { speaker: "gregory", kind: "speak", line: "To move is to stir, and to be valiant is to stand." },
  { speaker: "sampson", kind: "speak", line: "I will take the wall of any man or maid of Montague's." },
  { speaker: "gregory", kind: "speak", line: "That shows thee a weak slave; the weakest goes to the wall." },
  { speaker: "sampson", kind: "speak", line: "True, and therefore women, being the weaker vessels, are ever thrust to the wall." },
  { speaker: "gregory", kind: "speak", line: "The quarrel is between our masters and us their men." },
  { speaker: "sampson", kind: "speak", line: "'Tis all one. I will show myself a tyrant." },
  { speaker: "gregory", kind: "speak", line: "Draw thy tool. Here comes of the house of Montagues." },

  { speaker: "abram", kind: "enter", to: { x: 760, y: 280 }, note: "Abram enters" },
  { speaker: "balthasar", kind: "enter", to: { x: 840, y: 280 } },

  { speaker: "sampson", kind: "speak", line: "My naked weapon is out. Quarrel; I will back thee.", smoke: true },
  { speaker: "gregory", kind: "speak", line: "How? Turn thy back and run?" },
  { speaker: "sampson", kind: "speak", line: "Fear me not." },
  { speaker: "gregory", kind: "speak", line: "No, marry, I fear thee." },
  { speaker: "sampson", kind: "think", line: "I will bite my thumb at them, which is disgrace if they bear it." },
  { speaker: "sampson", kind: "move", to: { x: 480, y: 320 } },
  { speaker: "abram", kind: "speak", line: "Do you bite your thumb at us, sir?" },
  { speaker: "sampson", kind: "speak", line: "I do bite my thumb, sir." },
  { speaker: "abram", kind: "speak", line: "Do you bite your thumb at us, sir?" },
  { speaker: "sampson", kind: "speak", line: "Is the law of our side if I say ay?" },
  { speaker: "gregory", kind: "speak", line: "No." },
  { speaker: "sampson", kind: "speak", line: "No, sir, I do not bite my thumb at you, sir, but I bite my thumb, sir." },
  { speaker: "gregory", kind: "speak", line: "Do you quarrel, sir?" },
  { speaker: "abram", kind: "speak", line: "Quarrel, sir? No, sir." },
  { speaker: "sampson", kind: "speak", line: "But if you do, sir, I am for you. I serve as good a man as you." },
  { speaker: "abram", kind: "speak", line: "No better." },
  { speaker: "sampson", kind: "speak", line: "Well, sir." },

  { speaker: "benvolio", kind: "enter", to: { x: 600, y: 240 }, note: "Benvolio breaks in" },
  { speaker: "gregory", kind: "think", line: "Say 'better.' Here comes one of my master's kinsmen." },
  { speaker: "sampson", kind: "speak", line: "Yes, better, sir." },
  { speaker: "abram", kind: "speak", line: "You lie." },
  { speaker: "sampson", kind: "shout", line: "Draw, if you be men!" },

  { speaker: "benvolio", kind: "shout", line: "Part, fools! Put up your swords. You know not what you do." },
  { speaker: "tybalt", kind: "enter", to: { x: 540, y: 240 } },
  { speaker: "tybalt", kind: "speak", line: "What, art thou drawn among these heartless hinds?" },
  { speaker: "tybalt", kind: "speak", line: "Turn thee, Benvolio. Look upon thy death." },
  { speaker: "benvolio", kind: "speak", line: "I do but keep the peace. Put up thy sword, or manage it to part these men with me." },
  { speaker: "tybalt", kind: "shout", line: "What, drawn, and talk of peace? I hate the word as I hate hell, all Montagues, and thee." },
  { speaker: "tybalt", kind: "shout", line: "Have at thee, coward!" },

  { speaker: "officer", kind: "enter", to: { x: 100, y: 200 } },
  { speaker: "officer", kind: "shout", line: "Clubs, bills, and partisans! Strike! Beat them down!" },
  { speaker: "officer", kind: "shout", line: "Down with the Capulets! Down with the Montagues!" },

  { speaker: "capulet", kind: "enter", to: { x: 360, y: 360 } },
  { speaker: "ladycapulet", kind: "enter", to: { x: 420, y: 360 } },
  { speaker: "capulet", kind: "speak", line: "What noise is this? Give me my long sword, ho!" },
  { speaker: "ladycapulet", kind: "speak", line: "A crutch, a crutch! Why call you for a sword?" },
  { speaker: "capulet", kind: "shout", line: "My sword, I say! Old Montague is come and flourishes his blade in spite of me." },

  { speaker: "montague", kind: "enter", to: { x: 700, y: 360 } },
  { speaker: "ladymontague", kind: "enter", to: { x: 760, y: 360 } },
  { speaker: "montague", kind: "shout", line: "Thou villain Capulet! Hold me not. Let me go." },
  { speaker: "ladymontague", kind: "speak", line: "Thou shalt not stir one foot to seek a foe." },

  { speaker: "", kind: "backdrop", backdrop: GATE, note: "Prince arrives at the gate" },
  { speaker: "prince", kind: "enter", to: { x: 512, y: 120 } },
  { speaker: "prince", kind: "shout", line: "Rebellious subjects, enemies to peace, profaners of this neighbor-stained steel!" },
  { speaker: "prince", kind: "shout", line: "On pain of torture, from those bloody hands throw your mistempered weapons to the ground!" },
  { speaker: "prince", kind: "speak", line: "Three civil brawls, bred of an airy word by thee, old Capulet, and Montague, have thrice disturbed the quiet of our streets." },
  { speaker: "prince", kind: "speak", line: "If ever you disturb our streets again, your lives shall pay the forfeit of the peace." },

  { speaker: "", kind: "backdrop", backdrop: VERONA, note: "Crowd disperses" },
  { speaker: "montague", kind: "speak", line: "Who set this ancient quarrel new abroach? Speak, nephew, were you by when it began?" },
  { speaker: "benvolio", kind: "speak", line: "Here were the servants of your adversary and yours, close fighting ere I did approach." },
  { speaker: "benvolio", kind: "speak", line: "I drew to part them. In the instant came the fiery Tybalt, with his sword prepared." },
  { speaker: "ladymontague", kind: "speak", line: "O, where is Romeo? Saw you him today? Right glad I am he was not at this fray." },
  { speaker: "benvolio", kind: "speak", line: "Madam, an hour before the worshipped sun peered forth the golden window of the east, a troubled mind drove me to walk abroad." },
  { speaker: "benvolio", kind: "speak", line: "Where, underneath the grove of sycamore that westward rooteth from this city's side, so early walking did I see your son." },
  { speaker: "montague", kind: "speak", line: "Many a morning hath he there been seen, with tears augmenting the fresh morning's dew, adding to clouds more clouds with his deep sighs." },

  { speaker: "romeo", kind: "enter", to: { x: 640, y: 320 }, note: "Romeo finally appears" },
  { speaker: "benvolio", kind: "speak", line: "See where he comes. So please you, step aside; I'll know his grievance, or be much denied." },
  { speaker: "montague", kind: "speak", line: "I would thou wert so happy by thy stay to hear true shrift. Come, madam, let's away." },
  { speaker: "montague", kind: "exit" },
  { speaker: "ladymontague", kind: "exit" },

  { speaker: "benvolio", kind: "speak", line: "Good morrow, cousin." },
  { speaker: "romeo", kind: "speak", line: "Is the day so young?" },
  { speaker: "benvolio", kind: "speak", line: "But new struck nine." },
  { speaker: "romeo", kind: "speak", line: "Ay me, sad hours seem long.", smoke: true },
  { speaker: "benvolio", kind: "speak", line: "What sadness lengthens Romeo's hours?" },
  { speaker: "romeo", kind: "speak", line: "Not having that which, having, makes them short." },
  { speaker: "benvolio", kind: "speak", line: "In love?" },
  { speaker: "romeo", kind: "speak", line: "Out — of her favor where I am in love." },
  { speaker: "benvolio", kind: "speak", line: "Alas that love, so gentle in his view, should be so tyrannous and rough in proof!" },
  { speaker: "romeo", kind: "think", line: "Here's much to do with hate, but more with love." },
  { speaker: "romeo", kind: "speak", line: "Farewell, my coz." },
  { speaker: "benvolio", kind: "speak", line: "Soft, I will go along; an if you leave me so, you do me wrong." },
  { speaker: "romeo", kind: "speak", line: "Tut, I have lost myself; I am not here. This is not Romeo, he's some other where." },
];

export const SMOKE_BEATS: Beat[] = BEATS.filter((b) => b.smoke);
