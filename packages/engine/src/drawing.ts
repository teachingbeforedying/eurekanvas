import { type Camera, createCamera } from "./camera";
import { dyadicFromString, dyadicToString } from "./dyadic";
import { STROKE_FORMAT, type Stroke, type StrokeJSON, strokeFromJSON, strokeToJSON } from "./stroke";

export const DRAWING_FORMAT = "eurekanvas/drawing";
export const DRAWING_FORMAT_VERSION = 2;

/** Objects handled as one: a group has at least one object, and groups can be nested. */
export interface Group {
  readonly items: readonly Item[];
}

/** An object of a drawing: a stroke, or a group of objects. */
export type Item = Stroke | Group;

export function isGroup(item: Item): item is Group {
  return "items" in item;
}

/** The strokes of an object, in drawing order. */
export function itemStrokes(item: Item): Stroke[] {
  return isGroup(item) ? item.items.flatMap(itemStrokes) : [item];
}

/** A whole drawing: its objects, in drawing order, and the view it was saved with. */
export interface Drawing {
  readonly items: readonly Item[];
  readonly view: Camera;
}

/** The plain-data form of an object: a stroke document, or a group. */
export type ItemJSON = StrokeJSON | { readonly group: readonly ItemJSON[] };

/** The plain-data form of a drawing, ready for `JSON.stringify`. Specified in docs/drawing-format.md. */
export interface DrawingJSON {
  readonly format: typeof DRAWING_FORMAT;
  readonly version: typeof DRAWING_FORMAT_VERSION;
  readonly view: {
    readonly center: { readonly x: string; readonly y: string };
    readonly zLevel: number;
    readonly factor: number;
  };
  readonly items: readonly ItemJSON[];
}

function itemToJSON(item: Item): ItemJSON {
  return isGroup(item) ? { group: item.items.map(itemToJSON) } : strokeToJSON(item);
}

export function drawingToJSON(drawing: Drawing): DrawingJSON {
  const { center, zLevel, factor } = drawing.view;
  return {
    format: DRAWING_FORMAT,
    version: DRAWING_FORMAT_VERSION,
    view: { center: { x: dyadicToString(center.x), y: dyadicToString(center.y) }, zLevel, factor },
    items: drawing.items.map(itemToJSON),
  };
}

function fail(message: string): never {
  throw new SyntaxError(`invalid drawing: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStroke(raw: unknown, name: string): Stroke {
  try {
    return strokeFromJSON(raw);
  } catch (error) {
    return fail(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** A stroke document has a `format`; a group has a `group` and no `format`. */
function readItem(raw: unknown, name: string): Item {
  if (!isRecord(raw) || raw["format"] === STROKE_FORMAT || !("group" in raw)) return readStroke(raw, name);
  const members = raw["group"];
  if (!Array.isArray(members) || members.length === 0) fail(`${name} must be a group of at least one object`);
  return { items: (members as unknown[]).map((member, index) => readItem(member, `${name}.${index}`)) };
}

/**
 * Reads the plain-data form (for instance the result of `JSON.parse`), in version 2 or in version 1, whose
 * strokes become objects of their own. Strict: anything that does not match the format throws a
 * `SyntaxError`. Unknown extra fields are ignored.
 */
export function drawingFromJSON(json: unknown): Drawing {
  if (!isRecord(json)) fail("expected an object");
  if (json["format"] !== DRAWING_FORMAT) fail(`format must be "${DRAWING_FORMAT}"`);
  const version = json["version"];
  if (version !== 1 && version !== 2) fail(`unsupported version ${String(version)}`);

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

  let items: Item[];
  if (version === 1) {
    const rawStrokes = json["strokes"];
    if (!Array.isArray(rawStrokes)) fail("strokes must be an array");
    items = (rawStrokes as unknown[]).map((raw, index) => readStroke(raw, `stroke ${index}`));
  } else {
    const rawItems = json["items"];
    if (!Array.isArray(rawItems)) fail("items must be an array");
    items = (rawItems as unknown[]).map((raw, index) => readItem(raw, `item ${index}`));
  }

  const exactCenter = { x: dyadicFromString(center["x"]), y: dyadicFromString(center["y"]) };
  return { items, view: createCamera({ center: exactCenter, zLevel, factor }) }; // brings the factor into [1, 2)
}
