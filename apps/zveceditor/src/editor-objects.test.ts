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
  shift,
  isGroup,
  isIdentity,
  itemFrame,
  placedSections,
  rectangleCenter,
  toNumber,
  sub,
  worldToScreen,
} from "@eurekanvas/engine";
import { Editor } from "./editor";

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

function click(editor: Editor, p: ScreenPoint): void {
  editor.pointerDown(p, "primary");
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

function samePoint(a: Point, b: Point): boolean {
  return equals(a.x, b.x) && equals(a.y, b.y);
}

function distance(a: Point, b: Point): number {
  return Math.hypot(toNumber(sub(a.x, b.x)), toNumber(sub(a.y, b.y)));
}

/** With the turning key and the primary button, sweeps the pointer around `center` from `from` to `to` degrees. */
function turnByHand(editor: Editor, center: ScreenPoint, from: number, to: number, shift = false): void {
  const at = (degrees: number): ScreenPoint => ({
    x: center.x + 150 * Math.cos((degrees * Math.PI) / 180),
    y: center.y + 150 * Math.sin((degrees * Math.PI) / 180),
  });
  editor.setTurnKeyHeld(true);
  editor.pointerDown(at(from), "primary");
  const step = Math.sign(to - from);
  for (let a = from + step; step * (to - a) >= 0; a += step) editor.pointerMove(at(a), 0, { shift });
}

describe("turning the selection by quarter turns", () => {
  it("turns it around the center of its frame, exactly, and four quarter turns bring it back", () => {
    const editor = new Editor(viewport);
    const line = drawLine(editor, { x: 600, y: 300 }, { x: 700, y: 300 });
    click(editor, { x: 650, y: 300 });
    const center = centerOf(line);
    expect(editor.turnSelection(90)).toBe(1);
    const turned = only(editor);
    expect(turned.transform?.angle).toBe(90);
    expect(samePoint(centerOf(turned), center)).toBe(true);
    click(editor, { x: 650, y: 250 }); // now vertical: it is found there
    expect(only(editor)).toBe(turned);
    for (let i = 0; i < 3; i++) editor.turnSelection(90);
    const back = only(editor);
    expect(back.transform !== undefined && isIdentity(back.transform)).toBe(true);
    editor.undo();
    expect(editor.items[0]?.transform?.angle).toBe(270); // each quarter turn is one action
  });

  it("turns several objects as one block", () => {
    const editor = new Editor(viewport);
    drawLine(editor, { x: 500, y: 300 }, { x: 540, y: 300 });
    drawLine(editor, { x: 700, y: 300 }, { x: 740, y: 300 });
    editor.selectAll(); // a frame from (500, 300) to (740, 300): its center is at (620, 300)
    editor.turnSelection(90);
    const [left, right] = editor.items as [Item, Item];
    // the right one was 100 to the right of the center: it is now 100 below it
    const shown = worldToScreen(editor.camera, viewport, centerOf(right));
    expect(shown.x).toBeCloseTo(620, 6);
    expect(shown.y).toBeCloseTo(300 + 100, 6);
    expect(worldToScreen(editor.camera, viewport, centerOf(left)).y).toBeCloseTo(300 - 100, 6);
  });

  it("turns an object 600 levels deep by any angle without moving its center", () => {
    const editor = new Editor(viewport);
    const deep = { x: add(fromNumber(1), shift(fromNumber(3), -650)), y: fromNumber(1) };
    editor.restore({ items: [], view: createCamera({ center: deep, zLevel: 600 }) });
    drawLine(editor, { x: 600, y: 300 }, { x: 700, y: 300 }); // 100 pixels: 100 units of level 600
    editor.selectAll();
    const before = centerOf(only(editor));
    editor.turnSelection(37);
    editor.turnSelection(-37); // the second turn starts from an angle: its pivot must be near the object
    editor.turnSelection(37);
    const after = centerOf(only(editor));
    // in pixels of the view, 600 levels deep
    const dx = toNumber(shift(sub(after.x, before.x), 600));
    const dy = toNumber(shift(sub(after.y, before.y), 600));
    expect(Math.hypot(dx, dy)).toBeLessThan(1e-6);
    click(editor, { x: 650 + 40 * Math.cos((37 * Math.PI) / 180), y: 300 + 40 * Math.sin((37 * Math.PI) / 180) });
    expect(editor.selection.size).toBe(1);
  });

  it("does nothing without a selection, or while drawing", () => {
    const editor = new Editor(viewport);
    drawLine(editor, { x: 600, y: 300 }, { x: 700, y: 300 });
    expect(editor.turnSelection(90)).toBe(0);
    editor.selectAll();
    editor.setDrawKeyHeld(true);
    editor.pointerDown({ x: 100, y: 100 }, "primary");
    expect(editor.turnSelection(90)).toBe(0);
    expect(editor.mirrorSelection("leftRight")).toBe(0);
    expect(editor.alignSelection()).toBe(0);
  });
});

describe("turning the selection with R and the primary button", () => {
  it("turns it by the angle the pointer sweeps around its center, as one action", () => {
    const editor = new Editor(viewport);
    drawLine(editor, { x: 600, y: 300 }, { x: 700, y: 300 });
    editor.selectAll();
    turnByHand(editor, { x: 650, y: 300 }, 0, 40);
    editor.pointerUp();
    editor.setTurnKeyHeld(false);
    expect(only(editor).transform?.angle).toBeCloseTo(40, 9);
    expect(editor.camera.angle).toBe(0); // the view does not turn meanwhile
    editor.undo();
    expect(editor.items).toHaveLength(1); // the turn is undone, not the stroke
    expect(editor.items[0]?.transform).toBeUndefined();
  });

  it("goes by steps of 15° of the turn made, with Shift", () => {
    const editor = new Editor(viewport);
    drawLine(editor, { x: 600, y: 300 }, { x: 700, y: 300 });
    editor.selectAll();
    turnByHand(editor, { x: 650, y: 300 }, 0, 10);
    editor.pointerUp();
    turnByHand(editor, { x: 650, y: 300 }, 0, 40, true); // 40° rounds to 45°: from 10° to 55°
    editor.pointerUp();
    editor.setTurnKeyHeld(false);
    expect(only(editor).transform?.angle).toBeCloseTo(55, 9);
  });

  it("puts everything back with Escape", () => {
    const editor = new Editor(viewport);
    const line = drawLine(editor, { x: 600, y: 300 }, { x: 700, y: 300 });
    editor.selectAll();
    turnByHand(editor, { x: 650, y: 300 }, 0, 60);
    editor.cancel();
    editor.pointerUp();
    editor.setTurnKeyHeld(false);
    expect(editor.items).toEqual([line]);
    expect(only(editor)).toBe(line);
    editor.undo(); // nothing was recorded: this undoes the stroke
    expect(editor.items).toEqual([]);
  });
});

describe("mirroring the selection", () => {
  it("from left to right and from top to bottom, as seen on the screen", () => {
    const editor = new Editor(viewport);
    drawLine(editor, { x: 600, y: 300 }, { x: 700, y: 400 }); // going down to the right
    editor.selectAll();
    editor.mirrorSelection("leftRight"); // now going down to the left, in the same box
    click(editor, { x: 625, y: 375 });
    expect(editor.selection.size).toBe(1);
    click(editor, { x: 625, y: 325 });
    expect(editor.selection.size).toBe(0);
    editor.selectAll();
    editor.mirrorSelection("topBottom"); // going up to the left: down to the right again
    click(editor, { x: 625, y: 325 });
    expect(editor.selection.size).toBe(1);
    expect(only(editor).transform?.mirror).toBe(false);
  });

  it("follows the screen in a turned view", () => {
    const editor = new Editor(viewport);
    editor.turnView(90);
    // an L: right along the top, then down the right side; mirrored from left to right, its side is on the left
    editor.setDrawKeyHeld(true);
    editor.pointerDown({ x: 600, y: 300 }, "primary");
    for (const p of [{ x: 650, y: 300 }, { x: 700, y: 300 }, { x: 700, y: 350 }, { x: 700, y: 400 }]) editor.pointerMove(p);
    editor.pointerUp();
    editor.setDrawKeyHeld(false);
    editor.selectAll();
    editor.mirrorSelection("leftRight");
    editor.cancel();
    click(editor, { x: 600, y: 350 });
    expect(editor.selection.size).toBe(1);
    editor.cancel();
    click(editor, { x: 700, y: 350 });
    expect(editor.selection.size).toBe(0);
  });
});

describe("making the selection look straight", () => {
  it("turns each object around its own center, until it looks straight on the screen", () => {
    const editor = new Editor(viewport);
    const a = drawLine(editor, { x: 400, y: 300 }, { x: 500, y: 300 });
    const b = drawLine(editor, { x: 700, y: 300 }, { x: 800, y: 300 });
    click(editor, { x: 450, y: 300 });
    editor.turnSelection(90);
    click(editor, { x: 750, y: 300 });
    turnByHand(editor, { x: 750, y: 300 }, 0, 20);
    editor.pointerUp();
    editor.setTurnKeyHeld(false);
    editor.selectAll();
    const centers = [centerOf(editor.items[0] as Item), centerOf(editor.items[1] as Item)];
    expect(editor.alignSelection()).toBe(2);
    const [straightA, straightB] = editor.items as [Item, Item];
    expect(straightA.transform?.angle).toBe(0);
    expect(straightB.transform?.angle).toBeCloseTo(0, 9);
    expect(distance(centerOf(straightA), centers[0] as Point)).toBeLessThan(1e-9);
    expect(distance(centerOf(straightB), centers[1] as Point)).toBeLessThan(1e-9);
    expect(editor.alignSelection()).toBe(0); // already straight: nothing to undo
    expect([a, b]).toHaveLength(2);
  });

  it("in a turned view, turns them against the view", () => {
    const editor = new Editor(viewport);
    drawLine(editor, { x: 600, y: 300 }, { x: 700, y: 300 });
    editor.turnView(30);
    editor.selectAll();
    editor.alignSelection();
    expect(only(editor).transform?.angle).toBe(330);
  });
});

describe("groups of turned objects", () => {
  it("keep their objects where they are, and give them back placed when undone", () => {
    const editor = new Editor(viewport);
    drawLine(editor, { x: 500, y: 300 }, { x: 600, y: 300 });
    drawLine(editor, { x: 650, y: 350 }, { x: 750, y: 350 });
    click(editor, { x: 550, y: 300 });
    editor.turnSelection(-90); // the first one is turned on its own before
    editor.selectAll();
    editor.groupSelection();
    editor.turnSelection(90);
    const group = only(editor);
    expect(isGroup(group) && group.transform?.angle === 90).toBe(true);
    const placed = placedSections(group).map((p) => p.anchor);
    editor.ungroupSelection();
    expect(editor.selection.size).toBe(2);
    const opened = editor.items.flatMap((item) => placedSections(item).map((p) => p.anchor));
    expect(opened).toHaveLength(placed.length);
    expect(opened.every((anchor, i) => samePoint(anchor, placed[i] as Point))).toBe(true);
    expect(editor.items.map((item) => item.transform?.angle)).toEqual([0, 90]);
  });

  it("show the frame of one turned object along its angle", () => {
    const editor = new Editor(viewport);
    drawLine(editor, { x: 600, y: 300 }, { x: 700, y: 300 });
    editor.selectAll();
    turnByHand(editor, { x: 650, y: 300 }, 0, 30);
    editor.pointerUp();
    editor.setTurnKeyHeld(false);
    expect(editor.scene.selectionFrame?.angle).toBeCloseTo(330, 9);
    drawLine(editor, { x: 100, y: 100 }, { x: 200, y: 100 });
    editor.selectAll();
    expect(editor.scene.selectionFrame?.angle).toBe(0);
  });
});
