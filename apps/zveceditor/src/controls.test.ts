import { describe, expect, it } from "vitest";
import { buttonChanges, describePen, parseStoredRope, stepRope, toggleRope } from "./controls";
import { DEFAULT_ROPE_LENGTH, ROPE_LENGTHS } from "./editor";

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

describe("rope length controls", () => {
  it("steps through the lengths, and stops at both ends", () => {
    expect(stepRope(16, 1)).toBe(32);
    expect(stepRope(16, -1)).toBe(8);
    expect(stepRope(ROPE_LENGTHS[ROPE_LENGTHS.length - 1] as number, 1)).toBe(ROPE_LENGTHS[ROPE_LENGTHS.length - 1]);
    expect(stepRope(ROPE_LENGTHS[0], -1)).toBe(ROPE_LENGTHS[0]);
  });

  it("leaves the raw pen alone, and replaces an unknown length by the default", () => {
    expect(stepRope(0, 1)).toBe(0);
    expect(stepRope(0, -1)).toBe(0);
    expect(stepRope(17, 1)).toBe(DEFAULT_ROPE_LENGTH);
  });

  it("switches between the raw pen and the last smooth one", () => {
    expect(toggleRope(16, 16)).toBe(0);
    expect(toggleRope(64, 16)).toBe(0);
    expect(toggleRope(0, 64)).toBe(64);
  });

  it("reads a stored length, and falls back to the default for anything else", () => {
    expect(parseStoredRope("32")).toBe(32);
    expect(parseStoredRope("0")).toBe(0);
    expect(parseStoredRope(null)).toBe(DEFAULT_ROPE_LENGTH);
    expect(parseStoredRope("17")).toBe(DEFAULT_ROPE_LENGTH);
    expect(parseStoredRope("smooth")).toBe(DEFAULT_ROPE_LENGTH);
    expect(parseStoredRope("")).toBe(DEFAULT_ROPE_LENGTH);
    expect(parseStoredRope("  ")).toBe(DEFAULT_ROPE_LENGTH);
  });

  it("describes the pen", () => {
    expect(describePen(0)).toContain("raw");
    expect(describePen(16)).toContain("smooth");
    expect(describePen(16)).toContain("16 px");
  });
});
