import { describe, expect, it } from "vitest";
import { buttonChanges, describePen, drawingFileName, nextPen, parseStoredPen, stepPen } from "./controls";
import { DEFAULT_LAG, DEFAULT_PEN, DEFAULT_ROPE_LENGTH, LAG_TIMES, type Pen, ROPE_LENGTHS } from "./editor";

describe("buttonChanges", () => {
  it("sees nothing when the buttons did not change", () => {
    expect(buttonChanges(0, 0)).toEqual([]);
    expect(buttonChanges(3, 3)).toEqual([]);
  });

  it("sees the first button pressed, then released", () => {
    expect(buttonChanges(0, 1)).toEqual([{ button: "primary", pressed: true }]);
    expect(buttonChanges(1, 0)).toEqual([{ button: "primary", pressed: false }]);
  });

  it("sees a second button pressed while the first stays down (the browser sends no pointerdown for it)", () => {
    expect(buttonChanges(1, 3)).toEqual([{ button: "secondary", pressed: true }]);
    expect(buttonChanges(1, 5)).toEqual([{ button: "middle", pressed: true }]);
  });

  it("sees one of two buttons released while the other stays down", () => {
    expect(buttonChanges(3, 1)).toEqual([{ button: "secondary", pressed: false }]);
    expect(buttonChanges(3, 2)).toEqual([{ button: "primary", pressed: false }]);
  });

  it("sees every change when several happen at once", () => {
    expect(buttonChanges(0, 7)).toEqual([
      { button: "primary", pressed: true },
      { button: "secondary", pressed: true },
      { button: "middle", pressed: true },
    ]);
    expect(buttonChanges(7, 0)).toHaveLength(3);
    expect(buttonChanges(1, 2)).toEqual([
      { button: "primary", pressed: false },
      { button: "secondary", pressed: true },
    ]);
  });
});

describe("pen controls", () => {
  const fixed: Pen = { kind: "fixed", length: 16, lag: 50 };
  const speed: Pen = { kind: "speed", length: 16, lag: 50 };
  const raw: Pen = { kind: "raw", length: 16, lag: 50 };

  it("goes from the raw pen to the fixed rope, then to the rope that follows the speed, then back, keeping the settings", () => {
    const custom: Pen = { kind: "raw", length: 64, lag: 200 };
    expect(nextPen(custom)).toEqual({ kind: "fixed", length: 64, lag: 200 });
    expect(nextPen(nextPen(custom))).toEqual({ kind: "speed", length: 64, lag: 200 });
    expect(nextPen(nextPen(nextPen(custom)))).toEqual(custom);
  });

  it("steps through the rope lengths of the fixed rope, and stops at both ends", () => {
    expect(stepPen(fixed, 1)).toEqual({ ...fixed, length: 32 });
    expect(stepPen(fixed, -1)).toEqual({ ...fixed, length: 8 });
    const longest = ROPE_LENGTHS[ROPE_LENGTHS.length - 1] as number;
    expect(stepPen({ ...fixed, length: longest }, 1).length).toBe(longest);
    expect(stepPen({ ...fixed, length: ROPE_LENGTHS[0] }, -1).length).toBe(ROPE_LENGTHS[0]);
    expect(stepPen({ ...fixed, length: 17 }, 1).length).toBe(DEFAULT_ROPE_LENGTH);
  });

  it("steps through the lags of the rope that follows the speed, and stops at both ends", () => {
    expect(stepPen(speed, 1)).toEqual({ ...speed, lag: 100 });
    expect(stepPen(speed, -1)).toEqual({ ...speed, lag: 25 });
    const longest = LAG_TIMES[LAG_TIMES.length - 1] as number;
    expect(stepPen({ ...speed, lag: longest }, 1).lag).toBe(longest);
    expect(stepPen({ ...speed, lag: LAG_TIMES[0] }, -1).lag).toBe(LAG_TIMES[0]);
    expect(stepPen({ ...speed, lag: 33 }, 1).lag).toBe(DEFAULT_LAG);
  });

  it("leaves the raw pen alone", () => {
    expect(stepPen(raw, 1)).toEqual(raw);
    expect(stepPen(raw, -1)).toEqual(raw);
  });

  it("reads a stored pen, field by field, and falls back to the defaults for anything else", () => {
    expect(parseStoredPen(JSON.stringify({ kind: "fixed", length: 32, lag: 200 }))).toEqual({ kind: "fixed", length: 32, lag: 200 });
    expect(parseStoredPen(JSON.stringify({ kind: "raw", length: 17, lag: -1 }))).toEqual({ ...DEFAULT_PEN, kind: "raw" });
    expect(parseStoredPen(JSON.stringify({ kind: "wobbly", length: 64 }))).toEqual({ ...DEFAULT_PEN, length: 64 });
    expect(parseStoredPen(JSON.stringify({ kind: "fixed", length: "32" })).length).toBe(DEFAULT_PEN.length);
    for (const stored of [null, "", "  ", "16", "smooth", "[1, 2]", "null", "{"]) expect(parseStoredPen(stored)).toEqual(DEFAULT_PEN);
  });

  it("describes the pen", () => {
    expect(describePen(raw)).toContain("raw");
    expect(describePen(fixed)).toContain("rope of 16 px");
    expect(describePen(speed)).toContain("50 ms of lag");
    expect(describePen(speed)).not.toContain("now");
    expect(describePen(speed, 23.4)).toContain("now 23 px");
  });
});

describe("drawingFileName", () => {
  it("names a saved drawing with the local date and time, with leading zeros", () => {
    expect(drawingFileName(new Date(2026, 9, 25, 15, 30))).toBe("drawing-2026-10-25-1530.zvec.json");
    expect(drawingFileName(new Date(2027, 0, 5, 7, 4))).toBe("drawing-2027-01-05-0704.zvec.json");
  });
});
