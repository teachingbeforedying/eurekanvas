import { describe, expect, it } from "vitest";
import {
  type Item,
  type Point,
  type ScreenPoint,
  type Viewport,
  add,
  createCamera,
  equals,
  fromNumber,
  itemFrame,
  rectangleCenter,
  rectangleOnScreen,
  shift,
  sub,
  worldOffset,
  worldToScreen,
} from "@eurekanvas/engine";
import { Editor, type Modifiers } from "./editor";

// With the starting view, world point (x, y) is at screen (640 + x, 360 + y).
const viewport: Viewport = { width: 1280, height: 720 };

/** Draws one object: a straight stroke from `from` to `to`, during one hold of `²`. */
function drawLine(editor: Editor, from: ScreenPoint, to: ScreenPoint): Item {
  editor.setDrawKeyHeld(true);
  editor.pointerDown(from, "primary");
  editor.pointerMove({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
  editor.pointerMove(to);
  editor.pointerUp();
  editor.setDrawKeyHeld(false);
  return editor.items[editor.items.length - 1] as Item;
}

function click(editor: Editor, p: ScreenPoint, modifiers: Modifiers = {}): void {
  editor.pointerDown(p, "primary", 0, modifiers);
  editor.pointerUp();
}

function drag(editor: Editor, from: ScreenPoint, to: ScreenPoint, modifiers: Modifiers = {}): void {
  editor.pointerDown(from, "primary", 0, modifiers);
  editor.pointerMove(to);
  editor.pointerUp();
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

function onScreen(editor: Editor, item: Item): ScreenPoint {
  return worldToScreen(editor.camera, viewport, centerOf(item));
}

function widthOnScreen(editor: Editor, item: Item): number {
  const frame = itemFrame(item);
  if (frame === null) throw new Error("a frame expected");
  return rectangleOnScreen(editor.camera, viewport, frame).width;
}

function samePoint(a: Point, b: Point): boolean {
  return equals(a.x, b.x) && equals(a.y, b.y);
}

function moved(p: Point, dx: number, dy: number): Point {
  return { x: add(p.x, fromNumber(dx)), y: add(p.y, fromNumber(dy)) };
}

function expectClose(a: ScreenPoint, b: ScreenPoint, digits = 6): void {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
}

/** A line of 100 pixels whose middle, where it is pressed, is at (650, 300). */
function line(editor: Editor): Item {
  return drawLine(editor, { x: 600, y: 300 }, { x: 700, y: 300 });
}

const onLine: ScreenPoint = { x: 650, y: 300 };

describe("dragging an object", () => {
  it("moves it exactly with the pointer, as one action", () => {
    const editor = new Editor(viewport);
    const start = line(editor);
    const center = centerOf(start);
    drag(editor, onLine, { x: 680, y: 340 });
    expect(samePoint(centerOf(only(editor)), moved(center, 30, 40))).toBe(true);
    expect(editor.pointsAtObject({ x: 680, y: 340 })).toBe(true);
    expect(editor.pointsAtObject(onLine)).toBe(false);
    editor.undo();
    expect(editor.items).toEqual([start]);
    editor.undo();
    expect(editor.items).toEqual([]); // the move was one action, the stroke another
  });

  it("stays a click within 4 pixels, then catches up with the pointer", () => {
    const editor = new Editor(viewport);
    const start = line(editor);
    const center = centerOf(start);
    editor.pointerDown(onLine, "primary");
    editor.pointerMove({ x: 653, y: 300 });
    expect(editor.items).toEqual([start]);
    expect(editor.isCarrying).toBe(false);
    editor.pointerMove({ x: 655, y: 300 });
    expect(editor.isCarrying).toBe(true);
    expect(samePoint(centerOf(only(editor)), moved(center, 5, 0))).toBe(true); // all 5 pixels, no lag
    editor.pointerUp();
    click(editor, { x: 655, y: 300 });
    expect(only(editor).transform).toBeDefined();
    editor.undo();
    expect(editor.items).toEqual([start]); // the click recorded nothing
  });

  it("follows the screen in a turned, mirrored view, and is exact deep down", () => {
    const editor = new Editor(viewport);
    editor.turnView(30);
    editor.mirrorView("topBottom");
    const item = line(editor);
    const before = onScreen(editor, item);
    drag(editor, onLine, { x: 680, y: 340 });
    expectClose(onScreen(editor, only(editor)), { x: before.x + 30, y: before.y + 40 });

    const deep = new Editor(viewport);
    deep.restore({ items: [], view: createCamera({ center: { x: add(fromNumber(1), shift(fromNumber(3), -650)), y: fromNumber(1) }, zLevel: 600 }) });
    const center = centerOf(line(deep));
    drag(deep, onLine, { x: 680, y: 340 });
    const offset = worldOffset(deep.camera, 30, 40);
    expect(samePoint(centerOf(only(deep)), { x: add(center.x, offset.x), y: add(center.y, offset.y) })).toBe(true);
  });

  it("takes an object outside the selection alone, and moves it alone", () => {
    const editor = new Editor(viewport);
    const a = drawLine(editor, { x: 100, y: 100 }, { x: 200, y: 100 });
    const b = drawLine(editor, { x: 100, y: 200 }, { x: 200, y: 200 });
    click(editor, { x: 150, y: 100 });
    drag(editor, { x: 150, y: 200 }, { x: 150, y: 300 });
    expect(editor.items[0]).toBe(a);
    expect(editor.items[1]).not.toBe(b);
    expect(only(editor)).toBe(editor.items[1]);
  });

  it("moves the whole selection from any of its objects; a click without a move keeps only that one", () => {
    const editor = new Editor(viewport);
    const a = drawLine(editor, { x: 100, y: 100 }, { x: 200, y: 100 });
    const b = drawLine(editor, { x: 100, y: 200 }, { x: 200, y: 200 });
    const centers = [centerOf(a), centerOf(b)] as const;
    editor.selectAll();
    drag(editor, { x: 150, y: 200 }, { x: 170, y: 230 });
    expect(editor.selection.size).toBe(2);
    expect(samePoint(centerOf(editor.items[0] as Item), moved(centers[0], 20, 30))).toBe(true);
    expect(samePoint(centerOf(editor.items[1] as Item), moved(centers[1], 20, 30))).toBe(true);
    click(editor, { x: 170, y: 230 });
    expect(only(editor)).toBe(editor.items[1]);
  });

  it("with Shift, adds the object at the press and moves everything; a click on a selected one removes it", () => {
    const editor = new Editor(viewport);
    const a = drawLine(editor, { x: 100, y: 100 }, { x: 200, y: 100 });
    const b = drawLine(editor, { x: 100, y: 200 }, { x: 200, y: 200 });
    const centers = [centerOf(a), centerOf(b)] as const;
    click(editor, { x: 150, y: 100 });
    drag(editor, { x: 150, y: 200 }, { x: 170, y: 230 }, { shift: true });
    expect(editor.selection.size).toBe(2);
    expect(samePoint(centerOf(editor.items[0] as Item), moved(centers[0], 20, 30))).toBe(true);
    expect(samePoint(centerOf(editor.items[1] as Item), moved(centers[1], 20, 30))).toBe(true);
    click(editor, { x: 170, y: 230 }, { shift: true }); // no move, on a selected one: removed
    expect(only(editor)).toBe(editor.items[0]);
    click(editor, { x: 170, y: 230 }, { shift: true }); // no move, on another one: added, and it stays
    expect(editor.selection.size).toBe(2);
  });

  it("with Ctrl, takes the object below at the press and moves it alone", () => {
    const editor = new Editor(viewport);
    const below = drawLine(editor, { x: 100, y: 100 }, { x: 200, y: 100 });
    const above = drawLine(editor, { x: 110, y: 100 }, { x: 190, y: 100 });
    const center = centerOf(below);
    drag(editor, { x: 150, y: 100 }, { x: 150, y: 200 }, { ctrl: true });
    expect(editor.items[1]).toBe(above);
    expect(samePoint(centerOf(editor.items[0] as Item), moved(center, 0, 100))).toBe(true);
    expect(only(editor)).toBe(editor.items[0]);
  });

  it("with Ctrl, moves that object alone even when everything is selected", () => {
    const editor = new Editor(viewport);
    const below = drawLine(editor, { x: 100, y: 100 }, { x: 200, y: 100 });
    drawLine(editor, { x: 110, y: 100 }, { x: 190, y: 100 });
    editor.selectAll();
    drag(editor, { x: 150, y: 100 }, { x: 150, y: 200 }, { ctrl: true }); // below the deepest selected one: the top one again
    expect(editor.items[0]).toBe(below);
    expect(only(editor)).toBe(editor.items[1]);
    expect(editor.items[1]?.transform).toBeDefined();
  });

  it("does not grab inside the frame, off the ink", () => {
    const editor = new Editor(viewport);
    const diagonal = drawLine(editor, { x: 100, y: 100 }, { x: 300, y: 300 });
    editor.selectAll();
    drag(editor, { x: 280, y: 120 }, { x: 290, y: 130 }); // in the frame, far from the stroke: a small rectangle
    expect(editor.items).toEqual([diagonal]);
    expect(editor.selection.size).toBe(0);
  });

  it("does nothing else to the objects while they are held", () => {
    const editor = new Editor(viewport);
    const other = drawLine(editor, { x: 100, y: 100 }, { x: 200, y: 100 });
    line(editor);
    editor.pointerDown(onLine, "primary");
    editor.pointerMove({ x: 700, y: 400 });
    const held = only(editor);
    expect(editor.deleteSelection()).toBe(0);
    expect(editor.groupSelection()).toBe(0);
    expect(editor.turnSelection(90)).toBe(0);
    expect(editor.moveSelection(1, 0)).toBe(0);
    expect(editor.clear()).toBe(false);
    expect(editor.addDrawing({ items: [], view: createCamera() })).toBe(false);
    editor.undo();
    expect(editor.selectAll().count).toBe(1);
    expect(editor.selectOnScreen().count).toBe(1);
    expect(only(editor)).toBe(held);
    expect(editor.items).toEqual([other, held]);
    editor.pointerUp();
  });
});

describe("Escape while holding", () => {
  it("puts everything back as it was at the press, the view too", () => {
    const editor = new Editor(viewport);
    const start = line(editor);
    click(editor, onLine);
    const camera = editor.camera;
    editor.pointerDown(onLine, "primary");
    editor.pointerMove({ x: 700, y: 400 });
    editor.wheel({ x: 700, y: 400 }, -300);
    editor.mirrorView("leftRight");
    editor.cancel();
    expect(editor.items).toEqual([start]);
    expect(only(editor)).toBe(start);
    expect(editor.camera).toBe(camera);
    editor.pointerMove({ x: 800, y: 500 }); // the button is still down: nothing follows it any more
    editor.pointerUp();
    expect(editor.items).toEqual([start]);
    editor.undo();
    expect(editor.items).toEqual([]); // nothing was recorded: this undoes the stroke
  });

  it("forgets a press that has not moved, and leaves the selection as it is", () => {
    const editor = new Editor(viewport);
    drawLine(editor, { x: 100, y: 100 }, { x: 200, y: 100 });
    drawLine(editor, { x: 100, y: 200 }, { x: 200, y: 200 });
    editor.selectAll();
    editor.pointerDown({ x: 150, y: 100 }, "primary"); // released without a move, it would keep only this one
    editor.cancel();
    editor.pointerUp();
    expect(editor.selection.size).toBe(2);
  });
});

describe("carrying what is held while the view changes", () => {
  it("keeps its place and its size on the screen while zooming, without any move of the pointer", () => {
    const editor = new Editor(viewport);
    const start = line(editor);
    const center = onScreen(editor, start);
    const width = widthOnScreen(editor, start);
    editor.pointerDown({ x: 670, y: 300 }, "primary");
    for (let i = 0; i < 40; i++) editor.wheel({ x: 670, y: 300 }, -100);
    expect(editor.camera.zLevel).toBeGreaterThan(9);
    const held = only(editor);
    expectClose(onScreen(editor, held), center);
    expect(widthOnScreen(editor, held)).toBeCloseTo(width, 6);
    expect(editor.pointsAtObject({ x: 670, y: 300 })).toBe(true);
    editor.pointerUp();
    editor.undo();
    expect(editor.items).toEqual([start]); // one action, whatever the number of notches
  });

  it("stays under the pointer when the view moves and zooms along the way", () => {
    const editor = new Editor(viewport);
    const start = line(editor);
    const center = onScreen(editor, start);
    editor.pointerDown(onLine, "primary");
    editor.pointerDown({ x: 650, y: 300 }, "secondary"); // moves the view while the object is held
    editor.pointerMove({ x: 700, y: 350 });
    expect(editor.camera.center).not.toEqual(createCamera().center);
    expectClose(onScreen(editor, only(editor)), { x: center.x + 50, y: center.y + 50 });
    editor.pointerUp("secondary");
    editor.wheel({ x: 700, y: 350 }, -100);
    editor.pointerMove({ x: 720, y: 360 });
    expectClose(onScreen(editor, only(editor)), { x: center.x + 70, y: center.y + 60 });
    editor.pointerUp();
  });

  it("stays on the screen when the view turns with R, then goes back under the pointer", () => {
    const editor = new Editor(viewport);
    const start = line(editor);
    const center = onScreen(editor, start);
    editor.pointerDown(onLine, "primary");
    editor.pointerMove({ x: 900, y: 360 });
    expectClose(onScreen(editor, only(editor)), { x: center.x + 250, y: center.y + 60 });
    editor.setTurnKeyHeld(true);
    for (let a = 1; a <= 40; a++) {
      const radians = (a * Math.PI) / 180;
      editor.pointerMove({ x: 640 + 260 * Math.cos(radians), y: 360 + 260 * Math.sin(radians) });
    }
    expect(editor.camera.angle).toBeCloseTo(40, 6);
    expectClose(onScreen(editor, only(editor)), { x: center.x + 250, y: center.y + 60 });
    expect(only(editor).transform?.angle).toBeCloseTo(320, 6);
    editor.setTurnKeyHeld(false);
    editor.pointerMove({ x: 700, y: 500 });
    expectClose(onScreen(editor, only(editor)), { x: center.x + 50, y: center.y + 200 });
    editor.pointerUp();
  });

  it("is carried by the view moving under it, however small the move of the pointer", () => {
    const editor = new Editor(viewport);
    const start = line(editor);
    const center = onScreen(editor, start);
    editor.pointerDown(onLine, "primary");
    editor.pointerDown(onLine, "secondary");
    editor.pointerMove({ x: 652, y: 301 });
    expect(editor.isCarrying).toBe(true);
    expectClose(onScreen(editor, only(editor)), { x: center.x + 2, y: center.y + 1 });
    editor.pointerUp("secondary");
    editor.pointerUp();
  });

  it("looks the same when the view goes back to the start with 0", () => {
    const editor = new Editor(viewport);
    editor.wheel({ x: 200, y: 200 }, -300);
    const start = line(editor);
    const center = onScreen(editor, start);
    editor.pointerDown(onLine, "primary");
    editor.resetView();
    expect(editor.isCarrying).toBe(true);
    expectClose(onScreen(editor, only(editor)), center);
    editor.pointerUp();
  });

  it("looks the same when the view is mirrored meanwhile", () => {
    const editor = new Editor(viewport);
    const start = line(editor);
    const center = onScreen(editor, start);
    editor.pointerDown(onLine, "primary");
    editor.mirrorView("leftRight");
    expect(editor.isCarrying).toBe(true);
    expectClose(onScreen(editor, only(editor)), center);
    expect(only(editor).transform?.mirror).toBe(true);
    editor.pointerUp();
  });

  it("with Shift, keeps the scale a whole power of 2 from the press, and what is under the pointer there", () => {
    const editor = new Editor(viewport);
    const start = line(editor);
    const width = widthOnScreen(editor, start);
    const center = onScreen(editor, start);
    const here = { x: 670, y: 300 };
    // it grows on the screen around the pointer
    const expectedCenter = (size: number): ScreenPoint => ({ x: here.x + size * (center.x - here.x), y: here.y + size * (center.y - here.y) });
    editor.pointerDown(here, "primary");
    editor.wheel(here, -100, { shift: true }); // ×1.2: closest to no level at all
    expect(only(editor).transform).toMatchObject({ zLevel: 0, factor: 1 });
    expect(widthOnScreen(editor, only(editor))).toBeCloseTo(width * 1.2, 6);
    expectClose(onScreen(editor, only(editor)), expectedCenter(1.2));
    editor.wheel(here, -100, { shift: true });
    editor.wheel(here, -100, { shift: true }); // ×1.73: already closer to one level than to none
    expect(only(editor).transform).toMatchObject({ zLevel: -1, factor: 1 });
    expect(widthOnScreen(editor, only(editor))).toBeCloseTo((width * 1.2 ** 3) / 2, 6);
    editor.wheel(here, -100, { shift: true }); // ×2.07: still one level, exactly
    expect(only(editor).transform).toMatchObject({ zLevel: -1, factor: 1 });
    expect(widthOnScreen(editor, only(editor))).toBeCloseTo((width * 1.2 ** 4) / 2, 6);
    expectClose(onScreen(editor, only(editor)), expectedCenter(1.2 ** 4 / 2));
    expect(editor.pointsAtObject(here)).toBe(true);
    const sized = widthOnScreen(editor, only(editor));
    editor.wheel(here, -100); // without Shift: the size it has now stays
    expect(widthOnScreen(editor, only(editor))).toBeCloseTo(sized, 6);
    expect(editor.pointsAtObject(here)).toBe(true);
    editor.pointerUp();
  });
});

describe("the arrows", () => {
  it("move the selection along the screen, a run being one action", () => {
    const editor = new Editor(viewport);
    editor.turnView(90);
    const start = line(editor);
    const before = onScreen(editor, start);
    click(editor, onLine);
    expect(editor.moveSelection(10, 0)).toBe(1);
    editor.moveSelection(0, 1);
    editor.moveSelection(0, 1);
    expectClose(onScreen(editor, only(editor)), { x: before.x + 10, y: before.y + 2 });
    editor.undo();
    expect(editor.items).toEqual([start]);
  });

  it("start a new action after anything else", () => {
    const editor = new Editor(viewport);
    line(editor);
    click(editor, onLine);
    editor.moveSelection(1, 0);
    const first = only(editor);
    editor.turnSelection(90);
    editor.moveSelection(1, 0);
    editor.undo();
    expect(editor.items[0]?.transform?.angle).toBe(90);
    editor.undo();
    expect(editor.items).toEqual([first]);

    editor.selectAll(); // a new selection: a new run
    editor.moveSelection(1, 0);
    const second = editor.items[0];
    click(editor, { x: 652, y: 300 }); // and a click too
    editor.moveSelection(1, 0);
    editor.undo();
    expect(editor.items[0]).toBe(second);
  });

  it("start a new action after a stroke drawn in between, with the selection unchanged", () => {
    const editor = new Editor(viewport);
    line(editor);
    click(editor, onLine);
    editor.moveSelection(1, 0);
    const first = only(editor);
    drawLine(editor, { x: 100, y: 100 }, { x: 200, y: 100 }); // not selected: the selection stays the same
    editor.moveSelection(1, 0);
    editor.undo();
    expect(editor.items).toHaveLength(2);
    expect(editor.items[0]).toBe(first);
  });

  it("move the camera with nothing selected: the drawing goes the other way, and it is not undone", () => {
    const editor = new Editor(viewport);
    const start = line(editor);
    const before = onScreen(editor, start);
    editor.moveCamera(10, -3);
    expectClose(onScreen(editor, start), { x: before.x - 10, y: before.y + 3 });
    expect(editor.items).toEqual([start]);
    editor.undo();
    expect(editor.items).toEqual([]);
    expect(editor.camera.center).not.toEqual(createCamera().center);
  });

  it("keep the end of a stroke on the drawing when the camera moves", () => {
    const editor = new Editor(viewport);
    editor.setPen({ kind: "fixed", length: 16, lag: 50 });
    editor.setDrawKeyHeld(true);
    editor.pointerDown({ x: 300, y: 300 }, "primary");
    editor.pointerMove({ x: 400, y: 300 }); // the brush is pulled to (384, 300)
    const points = editor.stats.points;
    editor.moveCamera(0, 100); // on the drawing, the brush is now at (384, 200)
    editor.pointerMove({ x: 384, y: 210 }); // within the rope
    expect(editor.stats.points).toBe(points);
    editor.pointerUp();
  });
});

describe("changing the scale of the selection with 1 and the wheel", () => {
  it("scales it around its center by a wheel step, the view staying where it is", () => {
    const editor = new Editor(viewport);
    const start = line(editor);
    const center = centerOf(start);
    const width = widthOnScreen(editor, start);
    click(editor, onLine);
    const camera = editor.camera;
    editor.setCraneKeyHeld(true);
    editor.wheel({ x: 100, y: 100 }, -100);
    expect(editor.camera).toBe(camera);
    expect(only(editor).transform).toMatchObject({ zLevel: 0, factor: 1.2 });
    expect(samePoint(centerOf(only(editor)), center)).toBe(true);
    expect(widthOnScreen(editor, only(editor))).toBeCloseTo(width * 1.2, 6);
    editor.wheel({ x: 100, y: 100 }, 100); // ×0.8
    expect(widthOnScreen(editor, only(editor))).toBeCloseTo(width * 0.96, 6);
  });

  it("goes by exactly 2 with Shift, and scales several objects as one block", () => {
    const editor = new Editor(viewport);
    const a = drawLine(editor, { x: 100, y: 100 }, { x: 200, y: 100 });
    const b = drawLine(editor, { x: 300, y: 100 }, { x: 400, y: 100 });
    editor.selectAll();
    const frame = editor.scene.selectionFrame;
    if (!frame) throw new Error("a frame expected");
    const center = rectangleCenter(frame); // at (250, 100) on the screen
    editor.setCraneKeyHeld(true);
    editor.wheel({ x: 0, y: 0 }, -100, { shift: true });
    const [left, right] = editor.items as [Item, Item];
    expect(left.transform).toMatchObject({ zLevel: 1, factor: 1 });
    const centerA = centerOf(a);
    // twice as far from the center of the block: center + 2 · (a − center)
    expect(samePoint(centerOf(left), { x: sub(shift(centerA.x, 1), center.x), y: sub(shift(centerA.y, 1), center.y) })).toBe(true);
    expect(onScreen(editor, right).x).toBeCloseTo(250 + 2 * 100, 6);
    editor.wheel({ x: 0, y: 0 }, 100, { shift: true });
    expect(editor.items[0]?.transform).toMatchObject({ zLevel: 0, factor: 1 });
    expect(samePoint(centerOf(editor.items[0] as Item), centerA)).toBe(true);
    expect(samePoint(centerOf(editor.items[1] as Item), centerOf(b))).toBe(true);
  });

  it("is one action while the key stays held, and another once it was released", () => {
    const editor = new Editor(viewport);
    const start = line(editor);
    click(editor, onLine);
    editor.setCraneKeyHeld(true);
    editor.wheel(onLine, -100);
    editor.wheel(onLine, -100);
    editor.setCraneKeyHeld(false);
    const firstRun = only(editor);
    editor.setCraneKeyHeld(true);
    editor.wheel(onLine, -100);
    editor.setCraneKeyHeld(false);
    editor.undo();
    expect(editor.items[0]).toBe(firstRun);
    editor.undo();
    expect(editor.items).toEqual([start]);
  });

  it("does nothing without a selection, and leaves the zoom of a stroke alone", () => {
    const editor = new Editor(viewport);
    line(editor);
    const camera = editor.camera;
    editor.setCraneKeyHeld(true);
    editor.wheel(onLine, -100);
    expect(editor.camera).toBe(camera);
    expect(editor.items[0]?.transform).toBeUndefined();
    editor.setDrawKeyHeld(true);
    editor.pointerDown({ x: 100, y: 100 }, "primary");
    editor.wheel({ x: 100, y: 100 }, -100); // zooming while drawing goes on
    expect(editor.camera).not.toBe(camera);
    editor.pointerUp();
  });
});
