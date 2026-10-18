import { describe, expect, it } from "vitest";
import {
  type Point,
  type ScreenPoint,
  type Viewport,
  createCamera,
  equals,
  log2Scale,
  screenToWorld,
  shift,
  strokeWorldPoints,
  sub,
  toNumber,
  worldToScreen,
} from "@eurekanvas/engine";
import { Editor, STROKE_WIDTH_PIXELS, WHEEL_STEP, wheelZoomFactor } from "./editor";

const viewport: Viewport = { width: 1280, height: 720 };

function samePoint(a: Point, b: Point): boolean {
  return equals(a.x, b.x) && equals(a.y, b.y);
}

/** A pointer going round a circle of 200 pixels, 10 pixels per event. */
function onCircle(i: number): ScreenPoint {
  return { x: 640 + 200 * Math.cos(i * 0.05), y: 360 + 200 * Math.sin(i * 0.05) };
}

describe("wheelZoomFactor", () => {
  it("is the formula of the previous version: a notch is a factor of 1.2 or 0.8", () => {
    expect(WHEEL_STEP).toBe(1 / 500);
    expect(wheelZoomFactor(-100)).toBeCloseTo(1.2, 12);
    expect(wheelZoomFactor(100)).toBeCloseTo(0.8, 12);
    expect(wheelZoomFactor(0)).toBe(1);
  });

  it("is bounded, so that one event cannot flip or freeze the zoom", () => {
    expect(wheelZoomFactor(-100000)).toBeCloseTo(1.99, 12);
    expect(wheelZoomFactor(100000)).toBeCloseTo(0.01, 12);
  });
});

describe("drawing", () => {
  it("draws a stroke with the pointer, and shows it while it is being drawn", () => {
    const editor = new Editor(viewport);
    editor.pointerDown({ x: 100, y: 100 }, "primary");
    editor.pointerMove({ x: 150, y: 120 });
    expect(editor.isDrawing).toBe(true);
    expect(editor.scene.strokes).toHaveLength(1); // the stroke in progress is part of the scene
    editor.pointerMove({ x: 200, y: 100 });
    editor.pointerUp();
    expect(editor.isDrawing).toBe(false);
    expect(editor.scene.strokes).toHaveLength(1);
    expect(editor.stats).toEqual({ strokes: 1, sections: 1, points: 3 });
  });

  it("makes a dot from a click without movement", () => {
    const editor = new Editor(viewport);
    editor.pointerDown({ x: 300, y: 300 }, "primary");
    editor.pointerUp();
    expect(editor.stats).toEqual({ strokes: 1, sections: 1, points: 1 });
  });

  it("draws nothing when the pointer moves with no button down", () => {
    const editor = new Editor(viewport);
    editor.pointerMove({ x: 10, y: 10 });
    editor.pointerMove({ x: 20, y: 20 });
    editor.pointerUp();
    expect(editor.stats.strokes).toBe(0);
  });

  it("ignores a second button press while one is already down", () => {
    const editor = new Editor(viewport);
    editor.pointerDown({ x: 100, y: 100 }, "primary");
    editor.pointerDown({ x: 400, y: 400 }, "primary");
    editor.pointerMove({ x: 150, y: 150 });
    editor.pointerUp();
    expect(editor.stats).toEqual({ strokes: 1, sections: 1, points: 2 });
  });

  it("makes the stroke the same thickness on the screen as the pen setting", () => {
    const editor = new Editor(viewport);
    editor.pointerDown({ x: 100, y: 100 }, "primary");
    editor.pointerMove({ x: 150, y: 120 });
    editor.pointerUp();
    const section = editor.scene.strokes[0]?.sections[0];
    expect(section?.points.map((p) => p.width)).toEqual([STROKE_WIDTH_PIXELS, STROKE_WIDTH_PIXELS]);
  });
});

describe("zoom", () => {
  it("zooms around the pointer: the world point under it does not move", () => {
    const editor = new Editor(viewport);
    const pointer = { x: 913.5, y: 207.25 };
    const before = screenToWorld(editor.camera, viewport, pointer);
    editor.wheel(pointer, -100);
    expect(samePoint(screenToWorld(editor.camera, viewport, pointer), before)).toBe(true);
    expect(log2Scale(editor.camera)).toBeCloseTo(Math.log2(1.2), 12);
    editor.wheel(pointer, 100);
    expect(samePoint(screenToWorld(editor.camera, viewport, pointer), before)).toBe(true);
  });

  it("does not draw anything when the button is not down", () => {
    const editor = new Editor(viewport);
    editor.wheel({ x: 500, y: 300 }, -300);
    expect(editor.stats.strokes).toBe(0);
  });
});

describe("zooming while drawing", () => {
  /** Draws a spiral by moving on a circle and turning the wheel at every event; returns what was under the pointer. */
  function spiral(editor: Editor, events: number, deltaY: number) {
    const exact: Point[] = [];
    const levels: number[] = [];
    const factors: number[] = [];
    editor.pointerDown(onCircle(0), "primary");
    for (let i = 1; i <= events; i++) {
      const p = onCircle(i);
      exact.push(screenToWorld(editor.camera, viewport, p));
      levels.push(editor.camera.zLevel);
      factors.push(editor.camera.factor);
      editor.pointerMove(p);
      editor.wheel(p, deltaY);
    }
    editor.pointerUp();
    return { exact, levels, factors };
  }

  it("continues the same stroke across 100 levels of zoom, with no gap", () => {
    const editor = new Editor(viewport);
    const drawing = spiral(editor, 800, -60); // a factor of 1.12 per event
    expect(editor.camera.zLevel).toBeGreaterThan(100);
    expect(editor.stats.strokes).toBe(1);

    const stroke = editor.scene.strokes[0];
    if (!stroke) throw new Error("no stroke");
    // one section per level, from level 0 up to where the camera ended
    expect(stroke.sections.map((s) => s.zLevel)).toEqual(Array.from({ length: stroke.sections.length }, (_, i) => i));
    expect(stroke.sections.length).toBeGreaterThan(100);

    // every point is exactly where the pointer was, in the world (the first point is the one at the first click)
    const rebuilt = strokeWorldPoints(stroke);
    expect(rebuilt).toHaveLength(drawing.exact.length + 1);
    drawing.exact.forEach((world, i) => {
      const point = rebuilt[i + 1];
      const level = drawing.levels[i];
      if (!point || level === undefined) throw new Error("missing point");
      const errorX = toNumber(shift(sub(point.x, world.x), level));
      const errorY = toNumber(shift(sub(point.y, world.y), level));
      expect(Math.max(Math.abs(errorX), Math.abs(errorY))).toBeLessThan(1e-9);
    });
  });

  it("keeps the pen thickness constant on the screen at every point", () => {
    const editor = new Editor(viewport);
    const drawing = spiral(editor, 400, -60);
    const stroke = editor.scene.strokes[0];
    if (!stroke) throw new Error("no stroke");
    // the points in drawing order, each junction once (as in `strokeWorldPoints`)
    const widths = stroke.sections.flatMap((section, i) => section.points.slice(i === 0 ? 0 : 1).map((p) => p.width));
    expect(widths).toHaveLength(drawing.exact.length + 1);
    drawing.factors.forEach((factor, i) => {
      // widths[0] is the first click; the event `i` is point `i + 1`
      expect(Math.abs((widths[i + 1] ?? NaN) * factor - STROKE_WIDTH_PIXELS)).toBeLessThan(1e-9);
    });
  });

  it("does not add a point when only the wheel turns", () => {
    const editor = new Editor(viewport);
    editor.pointerDown({ x: 400, y: 300 }, "primary");
    editor.pointerMove({ x: 450, y: 320 });
    const before = editor.stats.points;
    editor.wheel({ x: 450, y: 320 }, -100);
    editor.wheel({ x: 450, y: 320 }, -100);
    expect(editor.stats.points).toBe(before);
    editor.pointerMove({ x: 460, y: 320 });
    expect(editor.stats.points).toBe(before + 1);
  });

  it("zooms out while drawing too", () => {
    const editor = new Editor(viewport);
    for (let i = 0; i < 300; i++) editor.wheel({ x: 640, y: 360 }, -60); // go deep first
    expect(editor.camera.zLevel).toBeGreaterThan(30);
    const startLevel = editor.camera.zLevel;
    spiral(editor, 300, 60);
    expect(editor.camera.zLevel).toBeLessThan(startLevel - 30);
    expect(editor.stats.strokes).toBe(1);
  });
});

describe("moving the view", () => {
  it("makes the content follow the pointer when dragging with the middle button", () => {
    const editor = new Editor(viewport);
    editor.wheel({ x: 300, y: 200 }, -100); // an arbitrary zoom, so that the test is not trivial
    const start = { x: 400, y: 300 };
    const world = screenToWorld(editor.camera, viewport, start);
    editor.pointerDown(start, "middle");
    editor.pointerMove({ x: 430, y: 280 });
    editor.pointerMove({ x: 450, y: 250 });
    editor.pointerUp("middle");
    const shown = worldToScreen(editor.camera, viewport, world);
    expect(Math.abs(shown.x - 450)).toBeLessThan(1e-9);
    expect(Math.abs(shown.y - 250)).toBeLessThan(1e-9);
    expect(editor.stats.strokes).toBe(0);
  });

  it("does the same with the secondary button", () => {
    const editor = new Editor(viewport);
    const world = screenToWorld(editor.camera, viewport, { x: 100, y: 100 });
    editor.pointerDown({ x: 100, y: 100 }, "secondary");
    editor.pointerMove({ x: 160, y: 140 });
    editor.pointerUp("secondary");
    const shown = worldToScreen(editor.camera, viewport, world);
    expect(shown.x).toBeCloseTo(160, 9);
    expect(shown.y).toBeCloseTo(140, 9);
    expect(editor.stats.strokes).toBe(0);
  });

  it("moves the view with the primary button while Space is held, and draws again once it is released", () => {
    const editor = new Editor(viewport);
    editor.setSpaceHeld(true);
    editor.pointerDown({ x: 100, y: 100 }, "primary");
    editor.pointerMove({ x: 130, y: 100 });
    editor.pointerUp();
    expect(editor.stats.strokes).toBe(0);
    editor.setSpaceHeld(false);
    editor.pointerDown({ x: 100, y: 100 }, "primary");
    editor.pointerMove({ x: 130, y: 100 });
    editor.pointerUp();
    expect(editor.stats.strokes).toBe(1);
  });

  it("keeps the drawing under the pointer while zooming during a drag", () => {
    const editor = new Editor(viewport);
    const world = screenToWorld(editor.camera, viewport, { x: 640, y: 360 });
    editor.pointerDown({ x: 640, y: 360 }, "middle");
    editor.wheel({ x: 640, y: 360 }, -100);
    editor.pointerMove({ x: 700, y: 400 });
    editor.pointerUp("middle");
    const shown = worldToScreen(editor.camera, viewport, world);
    expect(shown.x).toBeCloseTo(700, 9);
    expect(shown.y).toBeCloseTo(400, 9);
  });
});

describe("undo, reset and resize", () => {
  function drawTwoStrokes(editor: Editor): void {
    for (const y of [100, 200]) {
      editor.pointerDown({ x: 100, y }, "primary");
      editor.pointerMove({ x: 200, y });
      editor.pointerUp();
    }
  }

  it("undoes the last stroke, one at a time", () => {
    const editor = new Editor(viewport);
    drawTwoStrokes(editor);
    expect(editor.stats.strokes).toBe(2);
    editor.undo();
    expect(editor.stats.strokes).toBe(1);
    editor.undo();
    editor.undo(); // nothing left: no error
    expect(editor.stats.strokes).toBe(0);
  });

  it("does not undo while a stroke is being drawn", () => {
    const editor = new Editor(viewport);
    drawTwoStrokes(editor);
    editor.pointerDown({ x: 100, y: 300 }, "primary");
    editor.pointerMove({ x: 200, y: 300 });
    editor.undo();
    expect(editor.stats.strokes).toBe(3);
    editor.pointerUp();
    expect(editor.stats.strokes).toBe(3);
  });

  it("goes back to the starting view and keeps the strokes", () => {
    const editor = new Editor(viewport);
    drawTwoStrokes(editor);
    editor.wheel({ x: 300, y: 300 }, -400);
    editor.pointerDown({ x: 10, y: 10 }, "middle");
    editor.pointerMove({ x: 90, y: 50 });
    editor.pointerUp("middle");
    expect(editor.camera).not.toEqual(createCamera());
    editor.resetView();
    expect(editor.camera).toEqual(createCamera());
    expect(editor.stats.strokes).toBe(2);
  });

  it("keeps the same world point at the middle of the screen when the window is resized", () => {
    const editor = new Editor(viewport);
    editor.wheel({ x: 200, y: 100 }, -300);
    const centre = editor.camera.center;
    editor.resize({ width: 800, height: 500 });
    expect(editor.viewport).toEqual({ width: 800, height: 500 });
    expect(editor.scene.viewport).toEqual({ width: 800, height: 500 });
    expect(samePoint(editor.camera.center, centre)).toBe(true);
  });
});
