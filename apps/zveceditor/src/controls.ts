import { type Button, DEFAULT_ROPE_LENGTH, ROPE_LENGTHS } from "./editor";

export interface ButtonChange {
  readonly button: Button;
  /** `true` when the button was pressed, `false` when it was released. */
  readonly pressed: boolean;
}

/** The bits of `PointerEvent.buttons`: 1 is the primary button, 2 the secondary one, 4 the middle one. */
const BUTTON_BITS: readonly (readonly [number, Button])[] = [
  [1, "primary"],
  [2, "secondary"],
  [4, "middle"],
];

/**
 * What changed between two values of `PointerEvent.buttons`.
 *
 * It has to be read from the mask, not from `PointerEvent.button`: when a second mouse button is pressed
 * while another one is down, the browser sends no new `pointerdown`, only a `pointermove` whose `buttons`
 * has one more bit (and the same when only one of the two is released).
 */
export function buttonChanges(before: number, after: number): ButtonChange[] {
  const changes: ButtonChange[] = [];
  for (const [bit, button] of BUTTON_BITS) {
    const wasDown = (before & bit) !== 0;
    const isDown = (after & bit) !== 0;
    if (wasDown !== isDown) changes.push({ button, pressed: isDown });
  }
  return changes;
}

/** The next rope length when stepping to a shorter (`-1`) or longer (`1`) one. The raw pen (0) stays raw. */
export function stepRope(current: number, direction: -1 | 1): number {
  if (current === 0) return 0;
  const lengths: readonly number[] = ROPE_LENGTHS;
  const index = lengths.indexOf(current);
  if (index < 0) return DEFAULT_ROPE_LENGTH;
  const next = Math.min(lengths.length - 1, Math.max(0, index + direction));
  return lengths[next] ?? DEFAULT_ROPE_LENGTH;
}

/** Switches between the raw pen and the smooth one, coming back to the last smooth rope length. */
export function toggleRope(current: number, lastSmooth: number): number {
  return current > 0 ? 0 : lastSmooth;
}

/** Reads a rope length that was stored as text. Anything unexpected gives the default. */
export function parseStoredRope(stored: string | null): number {
  if (stored === null || stored.trim() === "") return DEFAULT_ROPE_LENGTH; // `Number("")` would be 0
  const value = Number(stored);
  const lengths: readonly number[] = ROPE_LENGTHS;
  return value === 0 || lengths.includes(value) ? value : DEFAULT_ROPE_LENGTH;
}

/** What the box at the top left says about the pen. */
export function describePen(ropeLength: number): string {
  return ropeLength > 0 ? `pen: smooth, rope of ${ropeLength} px   (S: raw pen, [ ]: shorter or longer rope)` : `pen: raw   (S: smooth pen)`;
}
