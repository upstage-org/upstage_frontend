import { describe, expect, it } from "vitest";
import { chatClockTime, chatLogLine, chatLogStamp } from "./chatLog";

const at = new Date(2026, 10, 20, 14, 32, 5).getTime(); // local time

describe("chat timestamps (#1567)", () => {
  it("shows the clock time on the same day and the date on another day", () => {
    expect(chatClockTime(at, new Date(2026, 10, 20, 18, 0).getTime())).toBe("14:32");
    expect(chatClockTime(at, new Date(2026, 10, 22, 9, 0).getTime())).toBe("20 Nov 14:32");
    expect(chatClockTime(undefined)).toBe("");
    expect(chatClockTime("not a date")).toBe("");
  });

  it("formats a full stamp for the downloaded log", () => {
    expect(chatLogStamp(at)).toBe("2026-11-20 14:32:05");
    expect(chatLogStamp(null)).toBe("");
  });

  it("builds log lines with and without timestamps", () => {
    const item = { user: "helen", message: "hello", at };
    expect(chatLogLine(item, false)).toBe("helen: hello");
    expect(chatLogLine(item, true)).toBe("[2026-11-20 14:32:05] helen: hello");
    expect(chatLogLine({ clear: true, at }, false)).toBe(
      "---------------- Clear Chat ----------------",
    );
    expect(chatLogLine({ clearPlayerChat: true, at }, true)).toBe(
      "---------------- Clear Chat (2026-11-20 14:32:05) ----------------",
    );
    // A line without a usable time falls back to the plain format.
    expect(chatLogLine({ user: "a", message: "b" }, true)).toBe("a: b");
  });
});
