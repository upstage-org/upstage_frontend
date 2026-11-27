import { describe, expect, it } from "vitest";

import source from "./General.vue?raw";

/**
 * Wording pins for the Stage Management "General" tab. The stage owner
 * re-reads this screen against the user manual; text here changes only on
 * request (#1577, 2026-11-24: people who use a stage are "players"; #1576,
 * 2026-11-25: the URL tip).
 */
describe("Stage Management General — wording", () => {
  it('the "Assign owner" help text speaks of a player, not a user', () => {
    expect(source).toContain("Select the player who will own and manage this stage.");
    expect(source).not.toContain("Select the user who will own");
  });

  // #1576 (Helen, 2026-11-25): the URL is now proposed from the stage name,
  // so the tip under the empty URL field explains that order instead of
  // warning about typos.
  it("the URL tip tells the player to enter the name first, then edit the URL", () => {
    expect(source).toContain(
      "Enter your stage name first then edit the URL if you want to (no spaces or special characters allowed).",
    );
    expect(source).not.toContain("URL must be unique and can't be changed");
    expect(source).not.toContain("unnecessarily long urls");
  });
});
