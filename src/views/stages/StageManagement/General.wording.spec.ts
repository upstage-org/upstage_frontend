import { describe, expect, it } from "vitest";

import source from "./General.vue?raw";

/**
 * Wording pins for the Stage Management "General" tab. The stage owner
 * re-reads this screen against the user manual; text here changes only on
 * request (#1577, 2026-11-24: people who use a stage are "players").
 */
describe("Stage Management General — wording", () => {
  it('the "Assign owner" help text speaks of a player, not a user', () => {
    expect(source).toContain("Select the player who will own and manage this stage.");
    expect(source).not.toContain("Select the user who will own");
  });
});
