import { describe, expect, it } from "vitest";
import {
  type Item,
  type Point,
  type ScreenPoint,
  type Section,
  type Stroke,
  type Viewport,
  itemFrame,
  pointWorld,
  rectangleCenter,
  screenToWorld,
  sub,
  toNumber,
  worldToScreen,
} from "@eurekanvas/engine";
import { DEFAULT_ROPE_LENGTH, Editor } from "./editor";

// The middle of the screen, around which the view is mirrored, is at (640, 360).
const viewport: Viewport = { width: 1280, height: 720 };

/** Draws one object through the given points of the screen, during one hold of `²`. */
function draw(editor: Editor, points: readonly ScreenPoint[]): Item {
  editor.setDrawKeyHeld(true);
  editor.pointerDown(points[0] as ScreenPoint, "primary");
  for (const p of points.slice(1)) editor.pointerMove(p);
  editor.pointerUp();
  editor.setDrawKeyHeld(false);
  return editor.items[editor.items.length - 1] as Item;
}

/** An L: right along the top from (600, 300) to (700, 300), then down the right side to (700, 400). */
function drawL(editor: Editor): Item {
  return draw(editor, [{ x: 600, y: 300 }, { x: 650, y: 300 }, { x: 700, y: 300 }, { x: 700, y: 350 }, { x: 700, y: 400 }]);
}

/** Whether a click at `p` takes an object. The selection is kept as it was. */
function hits(editor: Editor, p: ScreenPoint): boolean {
  return editor.pointsAtObject(p);
}

function only(editor: Editor): Item {
  expect(editor.selection.size).toBe(1);
  return [...editor.selection][0] as Item;
}

function centerOf(item: Item): Point {
  const frame = itemFrame(item);
  if (frame === null) throw new Error("a frame expected");
  return rectangleCenter(frame);
}

function distance(a: Point, b: Point): number {
  return Math.hypot(toNumber(sub(a.x, b.x)), toNumber(sub(a.y, b.y)));
}

describe("mirroring the view", () => {
  it("swaps left and right, or top and bottom, around the middle of the screen", () => {
    const editor = new Editor(viewport);
    drawL(editor);
    editor.mirrorView("leftRight"); // its side is now on the left, at x = 580
    expect(hits(editor, { x: 580, y: 350 })).toBe(true);
    expect(hits(editor, { x: 700, y: 350 })).toBe(false);
    expect(editor.camera).toMatchObject({ angle: 180, mirror: true }); // its top still at the top
    editor.mirrorView("topBottom"); // both: a half turn, its top along the bottom at y = 420
    expect(hits(editor, { x: 620, y: 420 })).toBe(true);
    expect(editor.camera).toMatchObject({ angle: 180, mirror: false });
  });

  it("gives back the same view, exactly, when mirrored twice the same way, and is not undone", () => {
    const editor = new Editor(viewport);
    drawL(editor);
    editor.turnView(30);
    editor.wheel({ x: 100, y: 200 }, -300);
    const start = editor.camera;
    editor.mirrorView("topBottom");
    editor.mirrorView("topBottom");
    expect(editor.camera).toEqual(start);
    editor.mirrorView("leftRight");
    editor.undo(); // the stroke goes, the view stays
    expect(editor.items).toEqual([]);
    expect(editor.camera.mirror).toBe(true);
  });

  it("keeps the gestures as they look on the screen", () => {
    const editor = new Editor(viewport);
    editor.mirrorView("leftRight");
    drawL(editor);
    editor.selectAll();
    editor.mirrorSelection("leftRight"); // as on the screen: the side goes to the left
    expect(hits(editor, { x: 600, y: 350 })).toBe(true);
    expect(hits(editor, { x: 700, y: 350 })).toBe(false);
    const line = draw(editor, [{ x: 600, y: 500 }, { x: 650, y: 500 }, { x: 700, y: 500 }]);
    editor.cancel();
    editor.pointerDown({ x: 650, y: 500 }, "primary");
    editor.pointerUp();
    expect(only(editor)).toBe(line);
    editor.turnSelection(30); // clockwise on the screen: the right end goes down
    const right = { x: 650 + 40 * Math.cos(Math.PI / 6), y: 500 + 40 * Math.sin(Math.PI / 6) };
    expect(hits(editor, right)).toBe(true);
    expect(hits(editor, { x: right.x, y: 500 - 40 * Math.sin(Math.PI / 6) })).toBe(false);
  });

  it("mirrors the selection as on the screen in a mirrored, turned view", () => {
    const editor = new Editor(viewport);
    editor.turnView(30);
    editor.mirrorView("leftRight"); // a mirrored view at 150°: no line of the screen is a line of the world's axes
    // the frame follows the axes of the drawing, turned on the screen: its center is not the middle of the L there
    const c = worldToScreen(editor.camera, viewport, centerOf(drawL(editor)));
    editor.selectAll();
    editor.mirrorSelection("leftRight"); // around c: the side, at x = 700, goes to 2 c.x - 700
    expect(hits(editor, { x: 2 * c.x - 700, y: 350 })).toBe(true);
    expect(hits(editor, { x: 700, y: 350 })).toBe(false);
    editor.mirrorSelection("topBottom"); // the middle of the top, (650, 300), goes to (2 c.x - 650, 2 c.y - 300)
    expect(hits(editor, { x: 2 * c.x - 650, y: 2 * c.y - 300 })).toBe(true);
    expect(hits(editor, { x: 2 * c.x - 650, y: 300 })).toBe(false);
  });

  it("turns the selection with R and the primary button the way the pointer goes on the screen", () => {
    const editor = new Editor(viewport);
    editor.mirrorView("topBottom");
    draw(editor, [{ x: 600, y: 300 }, { x: 650, y: 300 }, { x: 700, y: 300 }]);
    editor.selectAll();
    // the pointer sweeps 30° clockwise around the middle of the line, at (650, 300)
    const at = (degrees: number): ScreenPoint => ({
      x: 650 + 150 * Math.cos((degrees * Math.PI) / 180),
      y: 300 + 150 * Math.sin((degrees * Math.PI) / 180),
    });
    editor.setTurnKeyHeld(true);
    editor.pointerDown(at(0), "primary");
    for (let a = 1; a <= 30; a++) editor.pointerMove(at(a));
    editor.pointerUp();
    editor.setTurnKeyHeld(false);
    editor.cancel();
    expect(hits(editor, { x: 650 + 40 * Math.cos(Math.PI / 6), y: 300 + 40 * Math.sin(Math.PI / 6) })).toBe(true);
    expect(hits(editor, { x: 650 + 40 * Math.cos(Math.PI / 6), y: 300 - 40 * Math.sin(Math.PI / 6) })).toBe(false);
  });

  it("selects the rectangle as it is on the screen", () => {
    const editor = new Editor(viewport);
    editor.turnView(45);
    editor.mirrorView("leftRight");
    draw(editor, [{ x: 600, y: 300 }, { x: 650, y: 300 }, { x: 700, y: 300 }]);
    // a thin rectangle around it on the screen
    editor.pointerDown({ x: 590, y: 290 }, "primary");
    editor.pointerMove({ x: 650, y: 300 });
    editor.pointerMove({ x: 710, y: 310 });
    expect(editor.pointerUp()).toEqual({ count: 1, notVisible: 0 });
  });
});

describe("putting the view back the right way, with F + Space", () => {
  it("takes the mirror away and turns it straight, the middle of the screen staying where it is", () => {
    const editor = new Editor(viewport);
    editor.turnView(30);
    editor.mirrorView("topBottom");
    editor.turnView(17);
    const middle = screenToWorld(editor.camera, viewport, { x: 640, y: 360 });
    editor.uprightView();
    expect(editor.camera).toMatchObject({ angle: 0, mirror: false });
    const shown = worldToScreen(editor.camera, viewport, middle);
    expect(shown.x).toBeCloseTo(640, 9);
    expect(shown.y).toBeCloseTo(360, 9);
    editor.turnView(30); // without a mirror: straight, as with R + Space
    editor.uprightView();
    expect(editor.camera).toMatchObject({ angle: 0, mirror: false });
  });

  it("is different from R + Space, which keeps the mirror and puts the top at the top", () => {
    const editor = new Editor(viewport);
    editor.mirrorView("leftRight");
    editor.turnView(20);
    editor.straightenView();
    expect(editor.camera).toMatchObject({ angle: 180, mirror: true });
  });
});

describe("objects straight on the screen", () => {
  it("leaves a mirrored object alone with R + Space: its top is already at the top", () => {
    const editor = new Editor(viewport);
    drawL(editor);
    editor.selectAll();
    editor.mirrorSelection("leftRight");
    expect(editor.alignSelection()).toBe(0);
    editor.turnSelection(30);
    expect(editor.alignSelection()).toBe(1);
    expect(only(editor).transform).toMatchObject({ mirror: true });
    expect(only(editor).transform?.angle).toBeCloseTo(180, 9);
    expect(hits(editor, { x: 600, y: 350 })).toBe(true); // the side on the left, as mirrored
  });

  it("in a mirrored view, turns them as they look on the screen", () => {
    const editor = new Editor(viewport);
    editor.mirrorView("leftRight");
    drawL(editor);
    editor.selectAll();
    expect(editor.alignSelection()).toBe(0); // drawn in this view: it looks straight
    editor.turnSelection(30);
    expect(editor.alignSelection()).toBe(1);
    expect(hits(editor, { x: 700, y: 350 })).toBe(true);
    expect(hits(editor, { x: 650, y: 300 })).toBe(true);
  });

  it("puts each object the right way and straight with F + Space, around its own center", () => {
    const editor = new Editor(viewport);
    drawL(editor);
    editor.selectAll();
    const center = centerOf(only(editor));
    editor.mirrorSelection("leftRight");
    editor.turnSelection(30);
    expect(editor.uprightSelection()).toBe(1);
    const back = only(editor);
    expect(back.transform?.mirror).toBe(false);
    expect(Math.abs(((back.transform?.angle ?? 0) + 180) % 360 - 180)).toBeLessThan(1e-9);
    expect(distance(centerOf(back), center)).toBeLessThan(1e-9);
    expect(hits(editor, { x: 700, y: 350 })).toBe(true); // the L as it was drawn
    expect(hits(editor, { x: 600, y: 350 })).toBe(false);
    expect(editor.uprightSelection()).toBe(0); // nothing to do: nothing to undo
    editor.turnSelection(30);
    expect(editor.uprightSelection()).toBe(1); // not mirrored, but turned: straightened
    expect(hits(editor, { x: 700, y: 350 })).toBe(true);
  });

  it("in a mirrored view, mirrors what looks mirrored on the screen", () => {
    const editor = new Editor(viewport);
    drawL(editor); // drawn in the straight view: in the mirrored view, its side is on the left
    editor.mirrorView("leftRight");
    expect(hits(editor, { x: 580, y: 350 })).toBe(true);
    editor.selectAll();
    expect(editor.uprightSelection()).toBe(1);
    expect(only(editor).transform?.mirror).toBe(true);
    expect(hits(editor, { x: 680, y: 350 })).toBe(true); // around its own center: its side on the right on the screen
    expect(hits(editor, { x: 580, y: 350 })).toBe(false);
  });

  it("in a mirrored view, straightens what looks the right way but turned", () => {
    const editor = new Editor(viewport);
    drawL(editor);
    editor.selectAll();
    editor.mirrorSelection("leftRight"); // its side on the left, at x = 600
    editor.mirrorView("leftRight"); // two mirrors: the right way again, its side at x = 680, its top from 580 to 680
    editor.turnSelection(30);
    expect(editor.uprightSelection()).toBe(1);
    expect(only(editor).transform?.mirror).toBe(true);
    expect(hits(editor, { x: 680, y: 350 })).toBe(true);
    expect(hits(editor, { x: 630, y: 300 })).toBe(true);
  });
});

describe("drawing while the view is mirrored", () => {
  it("pauses the stroke while F is held, and goes on from where its end was on the drawing", () => {
    const editor = new Editor(viewport);
    editor.setPen({ kind: "fixed", length: DEFAULT_ROPE_LENGTH, lag: 50 });
    editor.setDrawKeyHeld(true);
    editor.pointerDown({ x: 800, y: 360 }, "primary");
    editor.pointerMove({ x: 900, y: 360 }); // the brush is pulled to (884, 360)
    const points = editor.stats.points;
    editor.setMirrorKeyHeld(true);
    editor.pointerMove({ x: 500, y: 200 });
    editor.mirrorView("leftRight");
    editor.pointerMove({ x: 300, y: 300 });
    expect(editor.stats.points).toBe(points); // nothing drawn while F is held
    editor.setMirrorKeyHeld(false);
    // the end of the stroke, (884, 360) before, is now at (396, 360), and the brush with it: pulled towards the
    // pointer at (396, 400), it stops 16 pixels before it, at (396, 384)
    editor.pointerMove({ x: 396, y: 400 });
    const stroke = editor.scene.strokes[editor.scene.strokes.length - 1] as Stroke;
    const section = stroke.sections[stroke.sections.length - 1] as Section;
    const end = worldToScreen(editor.camera, viewport, pointWorld(section, section.points.length - 1));
    expect(end.x).toBeCloseTo(396, 6);
    expect(end.y).toBeCloseTo(384, 6);
    editor.pointerUp();
  });
});
