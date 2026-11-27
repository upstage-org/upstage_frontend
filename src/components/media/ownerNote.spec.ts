import { describe, expect, it } from "vitest";
import { ownerNote } from "./ownerNote";

describe("ownerNote", () => {
  it("reads the note out of the attribute blob", () => {
    expect(ownerNote({ description: JSON.stringify({ note: " Credit: Gloria " }) })).toBe(
      "Credit: Gloria",
    );
  });

  it("is empty without a note, without a blob, or with a broken blob", () => {
    expect(ownerNote({ description: JSON.stringify({ frames: [] }) })).toBe("");
    expect(ownerNote({ description: JSON.stringify({ note: 7 }) })).toBe("");
    expect(ownerNote({ description: "" })).toBe("");
    expect(ownerNote({ description: "{not json" })).toBe("");
    expect(ownerNote(null)).toBe("");
  });
});
