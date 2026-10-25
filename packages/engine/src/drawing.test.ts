import { describe, expect, it } from "vitest";
import { type Viewport, createCamera, zoomAt } from "./camera";
import { type Drawing, drawingFromJSON, drawingToJSON } from "./drawing";
import { dyadic, fromNumber } from "./dyadic";
import { type Stroke, StrokeRecorder } from "./stroke";

const viewport: Viewport = { width: 1280, height: 720 };

/** A short stroke across two levels. */
function small(): Stroke {
  const recorder = new StrokeRecorder();
  recorder.addPoint({ x: fromNumber(0), y: fromNumber(0) }, 0);
  recorder.addPoint({ x: fromNumber(1), y: fromNumber(0) }, 0);
  recorder.addPoint({ x: fromNumber(1.5), y: fromNumber(0) }, 1);
  return recorder.stroke;
}

/** A stroke drawn while zooming in about 600 levels, and the view at the end of it. */
function deep(): Drawing {
  const recorder = new StrokeRecorder();
  let camera = createCamera();
  for (let i = 0; i < 3000; i++) {
    const p = { x: 640 + 200 * Math.cos(i * 0.05), y: 360 + 200 * Math.sin(i * 0.05) };
    camera = zoomAt(camera, viewport, p, 1.15);
    recorder.addScreenPoint(camera, viewport, p, 3);
  }
  return { strokes: [small(), recorder.stroke], view: camera };
}

/** A fresh, mutable copy of the valid JSON form of a small drawing. */
function valid() {
  const drawing: Drawing = { strokes: [small()], view: createCamera({ center: { x: dyadic(3n, 4), y: dyadic(-5n, 700) }, zLevel: 12, factor: 1.5 }) };
  return JSON.parse(JSON.stringify(drawingToJSON(drawing))) as {
    format: unknown;
    version: unknown;
    view: { center: { x: unknown; y: unknown }; zLevel: unknown; factor: unknown };
    strokes: unknown[];
    [extra: string]: unknown;
  };
}

describe("drawing JSON form", () => {
  it("has the documented shape", () => {
    expect(drawingToJSON({ strokes: [], view: createCamera() })).toEqual({
      format: "eurekanvas/drawing",
      version: 1,
      view: { center: { x: "0/2^0", y: "0/2^0" }, zLevel: 0, factor: 1 },
      strokes: [],
    });
  });

  it("round-trips the strokes and the view of a drawing 600 levels deep, exactly, through real JSON text", () => {
    const drawing = deep();
    expect(drawing.view.zLevel).toBeGreaterThan(590);
    const text = JSON.stringify(drawingToJSON(drawing)); // would throw if a BigInt slipped in
    expect(drawingFromJSON(JSON.parse(text))).toEqual(drawing);
  });

  it("accepts unknown extra fields, and a factor outside [1, 2) that it brings back into it", () => {
    const json = valid();
    json["author"] = "someone";
    Object.assign(json.view, { rotation: 0 });
    expect(drawingFromJSON(json)).toEqual(drawingFromJSON(valid()));
    json.view.factor = 3; // 3 x 2^12 is 1.5 x 2^13
    json.view.zLevel = 12;
    const view = drawingFromJSON(json).view;
    expect(view.factor).toBe(1.5);
    expect(view.zLevel).toBe(13);
  });

  it("rejects anything that does not match the format", () => {
    const rejected: Record<string, (json: ReturnType<typeof valid>) => void> = {
      "wrong format": (j) => void (j.format = "eurekanvas/stroke"),
      "unknown version": (j) => void (j.version = 2),
      "no view": (j) => void delete (j as { view?: unknown }).view,
      "center that is not text": (j) => void (j.view.center.x = 3),
      "center that is not a dyadic": (j) => void (j.view.center.y = "abc"),
      "non-integer zLevel": (j) => void (j.view.zLevel = 1.5),
      "zLevel that is not a number": (j) => void (j.view.zLevel = "12"),
      "factor of zero": (j) => void (j.view.factor = 0),
      "negative factor": (j) => void (j.view.factor = -1.5),
      "factor that is not finite": (j) => void (j.view.factor = Number.POSITIVE_INFINITY),
      "factor that is not a number": (j) => void (j.view.factor = "1.5"),
      "strokes is not an array": (j) => void (j.strokes = {} as never),
      "a stroke that is not valid": (j) => void (j.strokes = [{ format: "eurekanvas/stroke", version: 1, sections: {} }]),
    };
    for (const [name, corrupt] of Object.entries(rejected)) {
      const json = valid();
      corrupt(json);
      expect(() => drawingFromJSON(json), name).toThrow(SyntaxError);
    }
    for (const notAnObject of [null, 5, "text", [], undefined]) {
      expect(() => drawingFromJSON(notAnObject)).toThrow(SyntaxError);
    }
  });

  it("says which stroke is not valid", () => {
    const json = valid();
    json.strokes.push({ format: "eurekanvas/stroke", version: 7, sections: [] });
    expect(() => drawingFromJSON(json)).toThrow(/stroke 1: .*version 7/);
  });
});
