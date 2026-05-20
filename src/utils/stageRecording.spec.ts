import { describe, expect, it } from "vitest";
import { deriveActiveRecording } from "./stageRecording";

describe("deriveActiveRecording", () => {
  it("picks the performance with recording true", () => {
    const stage = {
      id: "1",
      performances: [
        { id: 10, name: "Saved", recording: false, createdOn: "2020-01-01" },
        { id: 11, name: "Live take", recording: true, createdOn: "2020-01-02" },
      ],
    };
    const out = deriveActiveRecording(stage);
    expect(out.activeRecording).toEqual({
      id: 11,
      name: "Live take",
      createdOn: "2020-01-02",
    });
  });

  it("returns null when no in-progress recording", () => {
    const stage = {
      performances: [{ id: 1, recording: false }],
    };
    expect(deriveActiveRecording(stage).activeRecording).toBeNull();
  });
});
