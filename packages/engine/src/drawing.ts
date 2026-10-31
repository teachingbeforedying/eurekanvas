import { type Camera, type Point, createCamera } from "./camera";
import { dyadicFromString, dyadicToString } from "./dyadic";
import { STROKE_FORMAT, type Stroke, type StrokeJSON, strokeFromJSON, strokeToJSON } from "./stroke";
import { type Transform, createTransform } from "./transform";

export const DRAWING_FORMAT = "eurekanvas/drawing";
export const DRAWING_FORMAT_VERSION = 3;

/** Objects handled as one: a group has at least one object, and groups can be nested. */
export interface Group {
  readonly items: readonly Item[];
  /** Where the group puts its objects (see `Transform`); without one, they stay where they are. */
  readonly transform?: Transform;
}

/** A stroke as an object of a drawing: it keeps the coordinates it was drawn with, and its transform places it. */
export type PlacedStroke = Stroke & { readonly transform?: Transform };

/** An object of a drawing: a stroke, or a group of objects. */
export type Item = PlacedStroke | Group;

export function isGroup(item: Item): item is Group {
  return "items" in item;
}

/** The same object with another transform; `undefined` leaves it where it was drawn. */
export function withTransform<T extends Item>(item: T, transform: Transform | undefined): T {
  return { ...item, transform };
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

/** The plain-data form of a transform: exact points as text, as in a stroke. */
export interface TransformJSON {
  readonly origin: { readonly x: string; readonly y: string };
  readonly position: { readonly x: string; readonly y: string };
  readonly zLevel: number;
  readonly factor: number;
  readonly angle: number;
  readonly mirror: boolean;
}

/** The plain-data form of an object: a stroke document, or a group, either with an optional transform. */
export type ItemJSON = (StrokeJSON | { readonly group: readonly ItemJSON[] }) & { readonly transform?: TransformJSON };

/** The plain-data form of a drawing, ready for `JSON.stringify`. Specified in docs/drawing-format.md. */
export interface DrawingJSON {
  readonly format: typeof DRAWING_FORMAT;
  readonly version: typeof DRAWING_FORMAT_VERSION;
  readonly view: {
    readonly center: { readonly x: string; readonly y: string };
    readonly zLevel: number;
    readonly factor: number;
    /** Degrees in [0, 360). Optional when read: 0 by default. */
    readonly angle: number;
  };
  readonly items: readonly ItemJSON[];
}

function pointToJSON(p: Point): { x: string; y: string } {
  return { x: dyadicToString(p.x), y: dyadicToString(p.y) };
}

function itemToJSON(item: Item): ItemJSON {
  const json: ItemJSON = isGroup(item) ? { group: item.items.map(itemToJSON) } : strokeToJSON(item);
  const t = item.transform;
  if (t === undefined) return json;
  const { zLevel, factor, angle, mirror } = t;
  return { ...json, transform: { origin: pointToJSON(t.origin), position: pointToJSON(t.position), zLevel, factor, angle, mirror } };
}

export function drawingToJSON(drawing: Drawing): DrawingJSON {
  const { center, zLevel, factor, angle } = drawing.view;
  return {
    format: DRAWING_FORMAT,
    version: DRAWING_FORMAT_VERSION,
    view: { center: { x: dyadicToString(center.x), y: dyadicToString(center.y) }, zLevel, factor, angle },
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

function readPoint(raw: unknown, name: string): Point {
  if (!isRecord(raw) || typeof raw["x"] !== "string" || typeof raw["y"] !== "string") fail(`${name} needs text coordinates x and y`);
  return { x: dyadicFromString(raw["x"]), y: dyadicFromString(raw["y"]) };
}

function readTransform(raw: unknown, name: string): Transform {
  if (!isRecord(raw)) fail(`the transform of ${name} must be an object`);
  const origin = readPoint(raw["origin"], `the origin of the transform of ${name}`);
  const position = readPoint(raw["position"], `the position of the transform of ${name}`);
  const { zLevel, factor, angle, mirror } = raw;
  if (typeof zLevel !== "number" || !Number.isInteger(zLevel)) fail(`the transform of ${name} needs an integer zLevel`);
  if (typeof factor !== "number" || !(Number.isFinite(factor) && factor > 0)) fail(`the transform of ${name} needs a positive, finite factor`);
  if (typeof angle !== "number" || !Number.isFinite(angle)) fail(`the transform of ${name} needs a finite angle`);
  if (typeof mirror !== "boolean") fail(`the transform of ${name} needs a mirror that is true or false`);
  return createTransform({ origin, position, zLevel, factor, angle, mirror }); // brings the factor into [1, 2), the angle into [0, 360)
}

/** A stroke document has a `format`; a group has a `group` and no `format`. Either may have a `transform`. */
function readItem(raw: unknown, name: string): Item {
  let item: Item;
  if (!isRecord(raw) || raw["format"] === STROKE_FORMAT || !("group" in raw)) {
    item = readStroke(raw, name);
  } else {
    const members = raw["group"];
    if (!Array.isArray(members) || members.length === 0) fail(`${name} must be a group of at least one object`);
    item = { items: (members as unknown[]).map((member, index) => readItem(member, `${name}.${index}`)) };
  }
  return isRecord(raw) && raw["transform"] !== undefined ? withTransform(item, readTransform(raw["transform"], name)) : item;
}

/**
 * Reads the plain-data form (for instance the result of `JSON.parse`), in version 3, 2 (without transforms) or
 * 1, whose strokes become objects of their own. Strict: anything that does not match the format throws a
 * `SyntaxError`. Unknown extra fields are ignored.
 */
export function drawingFromJSON(json: unknown): Drawing {
  if (!isRecord(json)) fail("expected an object");
  if (json["format"] !== DRAWING_FORMAT) fail(`format must be "${DRAWING_FORMAT}"`);
  const version = json["version"];
  if (version !== 1 && version !== 2 && version !== 3) fail(`unsupported version ${String(version)}`);

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
  const angle = view["angle"] ?? 0;
  if (typeof angle !== "number" || !Number.isFinite(angle)) fail("the angle of the view must be a finite number");

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
  return { items, view: createCamera({ center: exactCenter, zLevel, factor, angle }) }; // brings the factor into [1, 2), the angle into [0, 360)
}
