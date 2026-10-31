import { describe, expect, it } from "vitest";
import {
  type Item,
  type ScreenPoint,
  type Section,
  type Stroke,
  type Viewport,
  pointWorld,
  screenToWorld,
  worldToScreen,
} from "@eurekanvas/engine";
import { DEFAULT_ROPE_LENGTH, Editor } from "./editor";

// The middle of the screen, around which the view turns, is at (640, 360).
const viewport: Viewport = { width: 1280, height: 720 };

/** With the turning key held, moves the pointer through the given points. */
function turnWith(editor: Editor, points: readonly ScreenPoint[], shift = false): void {
  editor.setTurnKeyHeld(true);
  for (const p of points) editor.pointerMove(p, 0, { shift });
  editor.setTurnKeyHeld(false);
}

/** A point at `radius` pixels from the middle, at `degrees` clockwise from the right. */
function around(degrees: number, radius = 200): ScreenPoint {
  const radians = (degrees * Math.PI) / 180;
  return { x: 640 + radius * Math.cos(radians), y: 360 + radius * Math.sin(radians) };
}

/** Points sweeping from `from` to `to` degrees around the middle, every `step` degrees. */
function sweep(from: number, to: number, step = 5): ScreenPoint[] {
  const points: ScreenPoint[] = [];
  const direction = Math.sign(to - from);
  for (let a = from; direction * (to - a) >= 0; a += direction * step) points.push(around(a));
  return points;
}

describe("turning the view with R", () => {
  it("turns it by the angle the pointer sweeps around the middle of the screen, clockwise", () => {
    const editor = new Editor(viewport);
    editor.pointerMove(around(0));
    turnWith(editor, sweep(0, 50));
    expect(editor.camera.angle).toBeCloseTo(50, 9);
    turnWith(editor, sweep(50, -20)); // 70° back: -20°
    expect(editor.camera.angle).toBeCloseTo(340, 9);
  });

  it("keeps the middle of the screen on the same point of the world", () => {
    const editor = new Editor(viewport);
    const before = screenToWorld(editor.camera, viewport, { x: 640, y: 360 });
    editor.pointerMove(around(0));
    turnWith(editor, sweep(0, 133, 7));
    const shown = worldToScreen(editor.camera, viewport, before);
    expect(shown.x).toBeCloseTo(640, 9);
    expect(shown.y).toBeCloseTo(360, 9);
  });

  it("goes by steps of 15° with Shift, even when the pointer moves slowly", () => {
    const editor = new Editor(viewport);
    editor.pointerMove(around(0));
    turnWith(editor, sweep(0, 50, 1), true);
    expect(editor.camera.angle).toBe(45);
    turnWith(editor, sweep(50, 59, 1), true); // 45 + 9: rounds to 60
    expect(editor.camera.angle).toBe(60);
  });

  it("does nothing without the key, or close to the middle where the angle is unsteady", () => {
    const editor = new Editor(viewport);
    for (const p of sweep(0, 90)) editor.pointerMove(p);
    expect(editor.camera.angle).toBe(0);
    editor.pointerMove({ x: 642, y: 360 });
    turnWith(editor, [{ x: 640, y: 362 }, { x: 638, y: 360 }, { x: 640, y: 358 }]);
    expect(editor.camera.angle).toBe(0);
  });

  it("makes exact quarter turns, and turns back straight", () => {
    const editor = new Editor(viewport);
    const start = editor.camera;
    editor.turnView(90);
    expect(editor.camera.angle).toBe(90);
    for (let i = 0; i < 3; i++) editor.turnView(90);
    expect(editor.camera).toEqual(start);
    editor.pointerMove(around(0));
    turnWith(editor, sweep(0, 200));
    expect(editor.camera.angle).toBeCloseTo(200, 9);
    editor.straightenView(); // the shortest way: -200 is +160
    expect(editor.camera.angle).toBe(0);
  });

  it("starts again from a quarter turn made while the key is held", () => {
    const editor = new Editor(viewport);
    editor.pointerMove(around(0));
    editor.setTurnKeyHeld(true);
    for (const p of sweep(0, 30)) editor.pointerMove(p, 0, { shift: true });
    editor.turnView(90);
    for (const p of sweep(30, 45)) editor.pointerMove(p, 0, { shift: true });
    editor.setTurnKeyHeld(false);
    expect(editor.camera.angle).toBe(135); // 30 + 90 + 15, not back to 45
  });

  it("does not select with the primary button while the key is held", () => {
    const editor = new Editor(viewport);
    editor.setDrawKeyHeld(true);
    editor.pointerDown({ x: 600, y: 360 }, "primary");
    editor.pointerMove({ x: 700, y: 360 });
    editor.pointerUp();
    editor.setDrawKeyHeld(false);
    editor.selectAll();
    editor.setTurnKeyHeld(true);
    editor.pointerDown({ x: 900, y: 600 }, "primary"); // would deselect, on empty space
    editor.pointerMove({ x: 950, y: 600 });
    editor.pointerUp();
    expect(editor.selection.size).toBe(1);
  });
});

describe("drawing while the view turns", () => {
  it("pauses the stroke, and goes on from where its end was on the drawing", () => {
    const editor = new Editor(viewport);
    editor.setPen({ kind: "fixed", length: DEFAULT_ROPE_LENGTH, lag: 50 });
    editor.setDrawKeyHeld(true);
    editor.pointerDown({ x: 800, y: 360 }, "primary");
    editor.pointerMove({ x: 900, y: 360 }); // the brush is pulled to (884, 360)
    const points = editor.stats.points;
    // a quarter turn, the pointer going round with the drawing: from (900, 360) to (640, 620)
    turnWith(editor, sweep(0, 90).map((p) => ({ x: 640 + (p.x - 640) * 1.3, y: 360 + (p.y - 360) * 1.3 })));
    expect(editor.camera.angle).toBeCloseTo(90, 9);
    expect(editor.stats.points).toBe(points); // nothing drawn while turning
    // the end of the stroke, (884, 360) before, is now at (640, 604), and the brush with it: pulled towards the
    // pointer at (640, 640), it stops 16 pixels before it, at (640, 624)
    editor.pointerMove({ x: 640, y: 640 });
    const stroke = editor.scene.strokes[editor.scene.strokes.length - 1] as Stroke;
    const section = stroke.sections[stroke.sections.length - 1] as Section;
    const end = worldToScreen(editor.camera, viewport, pointWorld(section, section.points.length - 1));
    expect(end.x).toBeCloseTo(640, 6);
    expect(end.y).toBeCloseTo(624, 6);
    editor.pointerUp();
  });
});

describe("selecting in a turned view", () => {
  it("takes the rectangle as it is on the screen", () => {
    const editor = new Editor(viewport);
    editor.turnView(45);
    editor.setDrawKeyHeld(true);
    editor.pointerDown({ x: 600, y: 300 }, "primary");
    editor.pointerMove({ x: 650, y: 300 });
    editor.pointerMove({ x: 700, y: 300 }); // horizontal on the screen, diagonal in the world
    editor.pointerUp();
    editor.setDrawKeyHeld(false);
    // a thin rectangle around it on the screen: its box in the world would stick out of it
    editor.pointerDown({ x: 590, y: 290 }, "primary");
    editor.pointerMove({ x: 650, y: 300 });
    editor.pointerMove({ x: 710, y: 310 });
    expect(editor.pointerUp()).toEqual({ count: 1, notVisible: 0 });
  });

  it("selects what touches the turned screen, not what is only in its box in the world", () => {
    const editor = new Editor(viewport);
    const dash = (x: number, y: number): Item => {
      editor.setDrawKeyHeld(true);
      editor.pointerDown({ x, y }, "primary");
      editor.pointerMove({ x: x + 5, y });
      editor.pointerUp();
      editor.setDrawKeyHeld(false);
      return editor.items[editor.items.length - 1] as Item;
    };
    // world points: (200, 200) and (0, 500), and (650, 650), drawn from the straight view
    const near = dash(840, 560);
    const below = dash(640, 860); // off the straight screen; turned by 45°, at (290, 714)
    dash(1290, 1010); // turned by 45°, inside the box of the screen in the world, but below the screen
    expect(editor.selectOnScreen().count).toBe(1);
    editor.turnView(45);
    expect(editor.selectOnScreen().count).toBe(2);
    expect([...editor.selection]).toEqual([near, below]);
  });
});
