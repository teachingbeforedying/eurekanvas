import {
  type Button,
  DEFAULT_LAG,
  DEFAULT_PEN,
  DEFAULT_ROPE_LENGTH,
  LAG_TIMES,
  type Pen,
  type PenKind,
  ROPE_LENGTHS,
  SPEED_ROPE_MAX,
} from "./editor";
import { MIN_SPEED_ROPE } from "./rope";

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

/** The order in which `S` goes through the kinds of pen. */
const PEN_KINDS: readonly PenKind[] = ["raw", "fixed", "speed"];

/** The next value of `values` when stepping down (`-1`) or up (`1`), stopping at both ends. An unknown value gives `fallback`. */
function step(values: readonly number[], current: number, direction: -1 | 1, fallback: number): number {
  const index = values.indexOf(current);
  if (index < 0) return fallback;
  return values[Math.min(values.length - 1, Math.max(0, index + direction))] ?? fallback;
}

/** The pen after `[` (`-1`) or `]` (`1`): a shorter or longer rope, or a shorter or longer lag. The raw pen stays as it is. */
export function stepPen(pen: Pen, direction: -1 | 1): Pen {
  if (pen.kind === "fixed") return { ...pen, length: step(ROPE_LENGTHS, pen.length, direction, DEFAULT_ROPE_LENGTH) };
  if (pen.kind === "speed") return { ...pen, lag: step(LAG_TIMES, pen.lag, direction, DEFAULT_LAG) };
  return pen;
}

/** The pen after `S`: raw, then the rope of fixed length, then the rope that follows the speed, then raw again. */
export function nextPen(pen: Pen): Pen {
  return { ...pen, kind: PEN_KINDS[(PEN_KINDS.indexOf(pen.kind) + 1) % PEN_KINDS.length] ?? DEFAULT_PEN.kind };
}

/** Reads a pen that was stored as JSON. A missing or unexpected field gets its default value. */
export function parseStoredPen(stored: string | null): Pen {
  let value: unknown = null;
  try {
    if (stored !== null) value = JSON.parse(stored);
  } catch {
    // not JSON: the defaults
  }
  const fields = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const one = <T>(values: readonly T[], field: unknown, fallback: T): T => values.find((each) => each === field) ?? fallback;
  return {
    kind: one(PEN_KINDS, fields.kind, DEFAULT_PEN.kind),
    length: one<number>(ROPE_LENGTHS, fields.length, DEFAULT_PEN.length),
    lag: one<number>(LAG_TIMES, fields.lag, DEFAULT_PEN.lag),
  };
}

export const DRAWING_FILE_EXTENSION = ".zvec.json";

/** The name of a saved drawing, with the local date and time: `drawing-2026-10-25-1530.zvec.json`. */
export function drawingFileName(date: Date): string {
  const two = (n: number): string => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  return `drawing-${day}-${two(date.getHours())}${two(date.getMinutes())}${DRAWING_FILE_EXTENSION}`;
}

/** What the box at the top left says about the pen. `ropeNow` is the length of the rope while a stroke is drawn. */
export function describePen(pen: Pen, ropeNow: number | null = null): string {
  switch (pen.kind) {
    case "raw":
      return `pen: raw   (S: next pen)`;
    case "fixed":
      return `pen: smooth, rope of ${pen.length} px   (S: next pen, [ ]: shorter or longer rope)`;
    case "speed": {
      const now = ropeNow === null ? "" : `, now ${Math.round(ropeNow)} px`;
      return `pen: smooth, rope follows the speed: ${pen.lag} ms of lag, ${MIN_SPEED_ROPE} to ${SPEED_ROPE_MAX} px${now}   (S: next pen, [ ]: shorter or longer lag)`;
    }
  }
}
