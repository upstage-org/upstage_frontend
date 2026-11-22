import { describe, expect, it, vi } from "vitest";
import { numberedSlug, slugifyStageName, suggestStageUrl } from "./stageUrl";

/** #1576: a default URL for a new stage, made from the stage name. */

const VALID = /^[a-zA-Z0-9-_]*$/; // the URL field's own rule (General.vue)

describe("slugifyStageName", () => {
  it("gives the examples from the request", () => {
    expect(slugifyStageName("bunnies")).toBe("bunnies");
    expect(slugifyStageName("Helen's Bunnies")).toBe("helens-bunnies");
  });

  it("drops apostrophes of every kind and turns other punctuation into single dashes", () => {
    expect(slugifyStageName("Helen’s  Bunnies!")).toBe("helens-bunnies");
    expect(slugifyStageName("Act 1: Scene_2 / final")).toBe("act-1-scene-2-final");
    expect(slugifyStageName("  --Hello,   World--  ")).toBe("hello-world");
  });

  it("removes accents instead of dropping the letters", () => {
    expect(slugifyStageName("Café Señor Ünïcode")).toBe("cafe-senor-unicode");
  });

  it("never exceeds the URL field's 20 characters and never ends in a dash", () => {
    const slug = slugifyStageName("The Quick Brown Fox Jumps Over");
    expect(slug.length).toBeLessThanOrEqual(20);
    expect(slug).toBe("the-quick-brown-fox");
    expect(slugifyStageName("abcdefghijklmnopqrs tuv")).toBe("abcdefghijklmnopqrs");
  });

  it("gives nothing for a name with no usable characters", () => {
    expect(slugifyStageName("")).toBe("");
    expect(slugifyStageName(null)).toBe("");
    expect(slugifyStageName("  !!! ")).toBe("");
    expect(slugifyStageName("舞台")).toBe("");
  });

  it("always passes the URL field's validation", () => {
    for (const name of ["Helen's Bunnies", "Ünï çødé 99", "a/b\\c?d#e", "x".repeat(60), "1 2 3"]) {
      expect(slugifyStageName(name)).toMatch(VALID);
    }
  });
});

describe("numberedSlug", () => {
  it("appends the number, shortening the base to stay within the limit", () => {
    expect(numberedSlug("bunnies", 2)).toBe("bunnies-2");
    expect(numberedSlug("abcdefghijklmnopqrst", 2)).toBe("abcdefghijklmnopqr-2");
    expect(numberedSlug("abcdefghijklmnopqrst", 12)).toBe("abcdefghijklmnopq-12");
    expect(numberedSlug("abcdefghijklmnopq-st", 12)).toBe("abcdefghijklmnopq-12");
  });
});

describe("suggestStageUrl", () => {
  const takenSet = (...urls: string[]) => vi.fn(async (url: string) => urls.includes(url));

  it("offers the plain slug when it is free", async () => {
    const isTaken = takenSet();
    expect(await suggestStageUrl("Helen's Bunnies", isTaken)).toBe("helens-bunnies");
    expect(isTaken).toHaveBeenCalledTimes(1);
  });

  it("offers bunnies-2 when /bunnies exists, bunnies-3 when that exists too", async () => {
    expect(await suggestStageUrl("bunnies", takenSet("bunnies"))).toBe("bunnies-2");
    expect(await suggestStageUrl("bunnies", takenSet("bunnies", "bunnies-2"))).toBe("bunnies-3");
  });

  it("never offers a reserved application path", async () => {
    const isTaken = takenSet();
    expect(await suggestStageUrl("Studio", isTaken, { reserved: ["studio", "login"] })).toBe(
      "studio-2",
    );
    expect(isTaken).not.toHaveBeenCalledWith("studio");
  });

  it("offers nothing (and asks nothing) for an unusable name", async () => {
    const isTaken = takenSet();
    expect(await suggestStageUrl("!!!", isTaken)).toBe("");
    expect(isTaken).not.toHaveBeenCalled();
  });

  it("gives up after the configured number of attempts instead of looping", async () => {
    const isTaken = vi.fn(async () => true);
    expect(await suggestStageUrl("bunnies", isTaken, { attempts: 5 })).toBe("");
    expect(isTaken).toHaveBeenCalledTimes(5);
  });
});
