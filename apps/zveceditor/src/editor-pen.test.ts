import { describe, expect, it } from "vitest";
import { type Point, type Viewport, equals, screenToWorld, strokeWorldPoints, sub, toNumber, worldToScreen } from "@eurekanvas/engine";
import { DEFAULT_PEN, Editor, type Pen } from "./editor";

const viewport: Viewport = { width: 1280, height: 720 };

/** An editor with the drawing key (²) held, so that the primary button draws. */
function drawingEditor(): Editor {
  const editor = new Editor(viewport);
  editor.setDrawKeyHeld(true);
  return editor;
}

/** A rope of fixed length, or the raw pen for a length of 0. */
function ropePen(length: number): Pen {
  return length === 0 ? { ...DEFAULT_PEN, kind: "raw" } : { ...DEFAULT_PEN, kind: "fixed", length };
}

function samePoint(a: Point, b: Point): boolean {
  return equals(a.x, b.x) && equals(a.y, b.y);
}

/** The points of the first stroke of the editor, in the world. */
function worldPointsOfFirstStroke(editor: Editor): Point[] {
  const stroke = editor.scene.strokes[0];
  if (!stroke) throw new Error("no stroke");
  return strokeWorldPoints(stroke);
}

describe("moving the view while drawing", () => {
  it("pauses the stroke, moves the view, and goes on from the end of the stroke", () => {
    const editor = drawingEditor();
    editor.pointerDown({ x: 400, y: 300 }, "primary");
    editor.pointerMove({ x: 500, y: 300 });
    const pointsBefore = editor.stats.points;
    const tip = screenToWorld(editor.camera, viewport, { x: 500, y: 300 });

    // press the secondary button while the primary one is still down, and drag the view by (100, 50)
    editor.pointerDown({ x: 500, y: 300 }, "secondary");
    editor.pointerMove({ x: 560, y: 330 });
    editor.pointerMove({ x: 600, y: 350 });
    editor.pointerUp("secondary");

    expect(editor.isDrawing).toBe(true);
    expect(editor.isMovingView).toBe(false);
    expect(editor.stats.points).toBe(pointsBefore); // nothing was drawn while the view moved
    const shown = worldToScreen(editor.camera, viewport, tip); // the end of the stroke followed the pointer
    expect(shown.x).toBeCloseTo(600, 9);
    expect(shown.y).toBeCloseTo(350, 9);

    editor.pointerMove({ x: 650, y: 350 }); // drawing goes on from there
    editor.pointerUp();
    expect(editor.stats).toEqual({ strokes: 1, sections: 1, points: 3 });
    const [, second, third] = worldPointsOfFirstStroke(editor);
    if (!second || !third) throw new Error("missing points");
    expect(samePoint(second, tip)).toBe(true); // no jump: the stroke goes on from its own end
    expect(toNumber(sub(third.x, second.x))).toBeCloseTo(50, 9); // exactly what the pointer moved after the pause
    expect(toNumber(sub(third.y, second.y))).toBeCloseTo(0, 9);
  });

  it("works with the middle button too", () => {
    const editor = drawingEditor();
    editor.pointerDown({ x: 100, y: 100 }, "primary");
    editor.pointerMove({ x: 150, y: 100 });
    editor.pointerDown({ x: 150, y: 100 }, "middle");
    editor.pointerMove({ x: 250, y: 140 });
    editor.pointerUp("middle");
    editor.pointerMove({ x: 300, y: 140 });
    editor.pointerUp();
    expect(editor.stats).toEqual({ strokes: 1, sections: 1, points: 3 });
  });

  it("ignores the primary button pressed while the view is moving", () => {
    const editor = drawingEditor();
    editor.pointerDown({ x: 100, y: 100 }, "secondary");
    editor.pointerDown({ x: 100, y: 100 }, "primary");
    editor.pointerMove({ x: 160, y: 130 });
    editor.pointerUp("primary");
    editor.pointerUp("secondary");
    expect(editor.stats.strokes).toBe(0);
    expect(editor.isDrawing).toBe(false);
  });

  it("ends the stroke when the primary button is released, and the view keeps following the pointer", () => {
    const editor = drawingEditor();
    editor.pointerDown({ x: 400, y: 300 }, "primary");
    editor.pointerMove({ x: 450, y: 300 });
    editor.pointerDown({ x: 450, y: 300 }, "secondary");
    editor.pointerUp("primary");
    expect(editor.stats.strokes).toBe(1);
    expect(editor.isDrawing).toBe(false);
    expect(editor.isMovingView).toBe(true);
    const world = screenToWorld(editor.camera, viewport, { x: 450, y: 300 });
    editor.pointerMove({ x: 500, y: 320 });
    editor.pointerUp("secondary");
    const shown = worldToScreen(editor.camera, viewport, world);
    expect(shown.x).toBeCloseTo(500, 9);
    expect(shown.y).toBeCloseTo(320, 9);
    expect(editor.stats.points).toBe(2); // the stroke did not grow
  });

  it("does not forget a button when two are pressed", () => {
    const editor = drawingEditor();
    editor.pointerDown({ x: 10, y: 10 }, "secondary");
    editor.pointerDown({ x: 10, y: 10 }, "middle");
    editor.pointerUp("secondary");
    expect(editor.isMovingView).toBe(true); // the middle button is still down
    editor.pointerUp("middle");
    expect(editor.isMovingView).toBe(false);
  });
});

/** A small seeded generator, so that the tremor in the tests is always the same. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draws a horizontal line at y = 300 with a tremor of +-3 pixels, and returns the editor. */
function drawShakyLine(ropeLength: number): Editor {
  const random = seeded(5);
  const editor = drawingEditor();
  editor.setPen(ropePen(ropeLength));
  editor.pointerDown({ x: 100, y: 300 }, "primary");
  for (let x = 104; x <= 700; x += 4) editor.pointerMove({ x, y: 300 + (random() - 0.5) * 6 });
  editor.pointerUp();
  return editor;
}

describe("the rope", () => {
  it("is the raw pen by default: every pointer position goes into the stroke", () => {
    expect(new Editor(viewport).pen.kind).toBe("raw");
    const editor = drawShakyLine(0);
    expect(editor.stats.points).toBe(1 + (700 - 100) / 4);
  });

  it("makes a much smoother stroke than the raw pen for the same shaky hand", () => {
    // distance of the points to the line, in pixels: the camera has not moved, so the world is the screen
    // shifted by the centre of the view
    const deviation = (editor: Editor): number => {
      const ys = worldPointsOfFirstStroke(editor).map((p) => toNumber(p.y) + 360 - 300);
      return Math.sqrt(ys.reduce((sum, y) => sum + y * y, 0) / ys.length);
    };
    const raw = drawShakyLine(0);
    const smooth = drawShakyLine(32);
    expect(deviation(smooth)).toBeLessThan(deviation(raw) / 3);
    // The rope removes the tremor, not the points: while the pointer keeps moving, so does the brush.
  });

  it("starts the stroke at the press and ends it at the brush, one rope length behind the release", () => {
    const editor = drawingEditor();
    editor.setPen(ropePen(16));
    const start = screenToWorld(editor.camera, viewport, { x: 100, y: 300 });
    editor.pointerDown({ x: 100, y: 300 }, "primary");
    editor.pointerMove({ x: 300, y: 300 });
    editor.pointerUp();
    const points = worldPointsOfFirstStroke(editor);
    expect(points).toHaveLength(2); // the press, the brush pulled by the rope: nothing at the release
    expect(samePoint(points[0] as Point, start)).toBe(true);
    const pulled = worldToScreen(editor.camera, viewport, points[1] as Point);
    expect(pulled.x).toBeCloseTo(300 - 16, 9); // one rope length behind the pointer
    expect(pulled.y).toBeCloseTo(300, 9);
  });

  it("adds nothing when the stroke ends: what was visible is what is kept, with either rope", () => {
    for (const pen of [ropePen(32), { ...DEFAULT_PEN, kind: "speed", lag: 50 } as const]) {
      const editor = drawingEditor();
      editor.setPen(pen);
      const at = (i: number) => ({ x: 640 + 200 * Math.cos(i / 100), y: 360 + 200 * Math.sin(i / 100) });
      editor.pointerDown(at(0), "primary", 0);
      for (let i = 1; i <= 300; i++) editor.pointerMove(at(i), i * 4);
      const visible = worldPointsOfFirstStroke(editor);
      editor.pointerUp();
      const kept = worldPointsOfFirstStroke(editor);
      expect(kept.length, pen.kind).toBe(visible.length);
      kept.forEach((p, i) => expect(samePoint(p, visible[i] as Point), pen.kind).toBe(true));
      const end = worldToScreen(editor.camera, viewport, kept.at(-1) as Point);
      expect(Math.hypot(end.x - at(300).x, end.y - at(300).y), pen.kind).toBeGreaterThan(10); // the pointer was far ahead
    }
  });

  it("leaves a dot for a gesture shorter than the rope", () => {
    const editor = drawingEditor();
    editor.setPen(ropePen(16));
    editor.pointerDown({ x: 100, y: 100 }, "primary");
    editor.pointerMove({ x: 110, y: 100 });
    editor.pointerUp();
    expect(editor.stats).toEqual({ strokes: 1, sections: 1, points: 1 });
  });

  it("absorbs a tremor smaller than the rope", () => {
    const editor = drawingEditor();
    editor.setPen(ropePen(16));
    editor.pointerDown({ x: 100, y: 100 }, "primary");
    for (const p of [{ x: 104, y: 97 }, { x: 96, y: 105 }, { x: 110, y: 108 }, { x: 99, y: 90 }]) editor.pointerMove(p);
    expect(editor.stats.points).toBe(1); // nothing but the press
  });

  it("changes the pen for the next stroke only, and refuses an invalid length or lag", () => {
    const editor = drawingEditor();
    editor.setPen(ropePen(16));
    editor.pointerDown({ x: 100, y: 100 }, "primary");
    editor.setPen(ropePen(64)); // ignored while drawing
    expect(editor.pen).toEqual(ropePen(16));
    editor.pointerUp();
    editor.setPen(ropePen(64));
    expect(editor.pen).toEqual(ropePen(64));
    expect(() => editor.setPen({ ...ropePen(64), length: -5 })).toThrow(RangeError);
    expect(() => editor.setPen({ ...ropePen(64), length: Number.NaN })).toThrow(RangeError);
    expect(() => editor.setPen({ ...DEFAULT_PEN, lag: -1 })).toThrow(RangeError);
    expect(() => editor.setPen({ ...ropePen(0), lag: Infinity })).toThrow(RangeError); // even for a pen that does not use it
    expect(editor.pen).toEqual(ropePen(64));
  });

  it("keeps the end of the stroke on the drawing when the wheel zooms", () => {
    const editor = drawingEditor();
    editor.setPen(ropePen(40));
    editor.pointerDown({ x: 100, y: 300 }, "primary");
    editor.pointerMove({ x: 500, y: 300 }); // the brush is 40 px behind: at x = 460
    const tip = screenToWorld(editor.camera, viewport, { x: 460, y: 300 });
    editor.wheel({ x: 500, y: 300 }, -100); // zoom by 1.2 around the pointer
    const shown = worldToScreen(editor.camera, viewport, tip);
    expect(shown.x).toBeCloseTo(500 - 40 * 1.2, 9); // the end of the stroke moved with the drawing
    editor.pointerMove({ x: 500, y: 300 }); // 48 px away: the rope pulls the brush back to 40 px
    const points = strokeWorldPoints(editor.scene.strokes[0] ?? { sections: [] });
    const last = worldToScreen(editor.camera, viewport, points[points.length - 1] as Point);
    expect(last.x).toBeCloseTo(460, 9);
    expect(last.y).toBeCloseTo(300, 9);
  });

  it("keeps the end of the stroke on the drawing when the view moves", () => {
    const editor = drawingEditor();
    editor.setPen(ropePen(40));
    editor.pointerDown({ x: 100, y: 300 }, "primary");
    editor.pointerMove({ x: 500, y: 300 }); // the brush is at x = 460
    const tip = screenToWorld(editor.camera, viewport, { x: 460, y: 300 });
    editor.pointerDown({ x: 500, y: 300 }, "secondary");
    editor.pointerMove({ x: 600, y: 300 });
    editor.pointerUp("secondary");
    expect(worldToScreen(editor.camera, viewport, tip).x).toBeCloseTo(560, 9); // moved by 100 with the view
    // The pointer goes off the line: the brush is at (560, 300), the pointer at (590, 340), 50 px away, so the
    // rope pulls the brush towards it until it is 40 px from the pointer: at (566, 308). If the brush had been
    // forgotten at (460, 300) while the view moved, it would end up somewhere else.
    editor.pointerMove({ x: 590, y: 340 });
    const points = strokeWorldPoints(editor.scene.strokes[0] ?? { sections: [] });
    const last = worldToScreen(editor.camera, viewport, points[points.length - 1] as Point);
    expect(last.x).toBeCloseTo(566, 9);
    expect(last.y).toBeCloseTo(308, 9);
  });
});

describe("the rope that follows the speed of the hand", () => {
  const speedPen: Pen = { ...DEFAULT_PEN, kind: "speed", lag: 50 };

  it("is long when the hand is fast and short when it is slow", () => {
    const editor = drawingEditor();
    editor.setPen(speedPen);
    expect(editor.ropeNow).toBeNull();
    editor.pointerDown({ x: 100, y: 300 }, "primary", 1000);
    let x = 100;
    for (let t = 1004; t <= 1200; t += 4) editor.pointerMove({ x: (x += 4), y: 300 }, t); // 1 000 px/s
    expect(editor.ropeNow).toBeCloseTo(50, 9);
    const fastEnd = worldToScreen(editor.camera, viewport, worldPointsOfFirstStroke(editor).at(-1) as Point);
    expect(x - fastEnd.x).toBeCloseTo(50, 9);
    for (let t = 1204; t <= 1600; t += 4) editor.pointerMove({ x: (x += 0.4), y: 300 }, t); // 100 px/s
    expect(editor.ropeNow).toBeCloseTo(5, 9);
    const slowEnd = worldToScreen(editor.camera, viewport, worldPointsOfFirstStroke(editor).at(-1) as Point);
    expect(x - slowEnd.x).toBeCloseTo(5, 9);
    editor.pointerUp();
    expect(editor.ropeNow).toBeNull();
  });

  it("does not jump when drawing goes on after the view moved", () => {
    const editor = drawingEditor();
    editor.setPen(speedPen);
    editor.pointerDown({ x: 100, y: 300 }, "primary", 0);
    for (let t = 4; t <= 200; t += 4) editor.pointerMove({ x: 100 + t, y: 300 }, t);
    const length = editor.ropeNow;
    expect(length).toBeCloseTo(50, 9);
    editor.pointerDown({ x: 300, y: 300 }, "secondary", 200);
    for (let t = 204; t <= 700; t += 4) editor.pointerMove({ x: 300, y: 300 - (t - 200) / 4 }, t); // the view moves up
    editor.pointerUp("secondary");
    const points = editor.stats.points;
    editor.pointerMove({ x: 301, y: 176 }, 704); // drawing goes on, slowly
    expect(editor.ropeNow).toBe(length);
    expect(editor.stats.points).toBe(points + 1);
    const end = worldToScreen(editor.camera, viewport, worldPointsOfFirstStroke(editor).at(-1) as Point);
    expect(Math.hypot(301 - end.x, 176 - end.y)).toBeCloseTo(50, 9); // pulled 1 px, not to the pointer
  });
});
