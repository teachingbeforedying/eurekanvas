import { type Camera, createCamera } from "./camera";
import { dyadicFromString, dyadicToString } from "./dyadic";
import { type Stroke, type StrokeJSON, strokeFromJSON, strokeToJSON } from "./stroke";

export const DRAWING_FORMAT = "eurekanvas/drawing";
export const DRAWING_FORMAT_VERSION = 1;

/** A whole drawing: its strokes, in drawing order, and the view it was saved with. */
export interface Drawing {
  readonly strokes: readonly Stroke[];
  readonly view: Camera;
}

/** The plain-data form of a drawing, ready for `JSON.stringify`. Specified in docs/drawing-format.md. */
export interface DrawingJSON {
  readonly format: typeof DRAWING_FORMAT;
  readonly version: typeof DRAWING_FORMAT_VERSION;
  readonly view: {
    readonly center: { readonly x: string; readonly y: string };
    readonly zLevel: number;
    readonly factor: number;
  };
  readonly strokes: readonly StrokeJSON[];
}

export function drawingToJSON(drawing: Drawing): DrawingJSON {
  const { center, zLevel, factor } = drawing.view;
  return {
    format: DRAWING_FORMAT,
    version: DRAWING_FORMAT_VERSION,
    view: { center: { x: dyadicToString(center.x), y: dyadicToString(center.y) }, zLevel, factor },
    strokes: drawing.strokes.map(strokeToJSON),
  };
}

function fail(message: string): never {
  throw new SyntaxError(`invalid drawing: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the plain-data form (for instance the result of `JSON.parse`). Strict: anything that does not
 * match the format throws a `SyntaxError`. Unknown extra fields are ignored.
 */
export function drawingFromJSON(json: unknown): Drawing {
  if (!isRecord(json)) fail("expected an object");
  if (json["format"] !== DRAWING_FORMAT) fail(`format must be "${DRAWING_FORMAT}"`);
  if (json["version"] !== DRAWING_FORMAT_VERSION) fail(`unsupported version ${String(json["version"])}`);

  const view = json["view"];
  if (!isRecord(view)) fail("view must be an object");
  const center = view["center"];
  if (!isRecord(center) || typeof center["x"] !== "string" || typeof center["y"] !== "string") {
    fail("the view needs a center with text coordinates x and y");
  }
  const zLevel = view["zLevel"];
  if (typeof zLevel !== "number" || !Number.isInteger(zLevel)) fail("the view needs an integer zLevel");
  const factor = view["factor"];
  if (typeof factor !== "number" || !(Number.isFinite(factor) && factor > 0)) fail("the view needs a positive, finite factor");

  const rawStrokes = json["strokes"];
  if (!Array.isArray(rawStrokes)) fail("strokes must be an array");
  const strokes = (rawStrokes as unknown[]).map((raw, index) => {
    try {
      return strokeFromJSON(raw);
    } catch (error) {
      return fail(`stroke ${index}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  const exactCenter = { x: dyadicFromString(center["x"]), y: dyadicFromString(center["y"]) };
  return { strokes, view: createCamera({ center: exactCenter, zLevel, factor }) }; // brings the factor into [1, 2)
}
