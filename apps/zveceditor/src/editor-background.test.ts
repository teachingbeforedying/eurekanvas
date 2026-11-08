import { describe, expect, it } from "vitest";
import { type Item, type Point, type ScreenPoint, type Viewport, createCamera, fromNumber } from "@eurekanvas/engine";
import { Editor } from "./editor";

// With the starting view, world point (x, y) is at screen (640 + x, 360 + y). The screen is 720 pixels high.
const viewport: Viewport = { width: 1280, height: 720 };
const middle: ScreenPoint = { x: 640, y: 360 };

function drawLine(editor: Editor, from: ScreenPoint, to: ScreenPoint): Item {
  editor.setDrawKeyHeld(true);
  editor.pointerDown(from, "primary");
  editor.pointerMove({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
  editor.pointerMove(to);
  editor.pointerUp();
  editor.setDrawKeyHeld(false);
  return editor.items[editor.items.length - 1] as Item;
}

const inLine: Point = { x: fromNumber(10), y: fromNumber(-60) }; // the middle of a line from (600, 300) to (700, 300), in the world

/** An editor showing, at this zoom level, the middle of a line 3 pixels thick when it was drawn at level 0. */
function zoomedInto(level: number): { editor: Editor; line: Item } {
  const first = new Editor(viewport);
  const line = drawLine(first, { x: 600, y: 300 }, { x: 700, y: 300 });
  const editor = new Editor(viewport);
  editor.restore({ items: [line], view: createCamera({ center: inLine, zLevel: level }) });
  return { editor, line };
}

function drag(editor: Editor, from: ScreenPoint, to: ScreenPoint): ReturnType<Editor["pointerUp"]> {
  editor.pointerDown(from, "primary");
  editor.pointerMove({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
  editor.pointerMove(to);
  return editor.pointerUp();
}

describe("a stroke that has become a background", () => {
  it("is an object as long as it is thinner than the screen", () => {
    const { editor, line } = zoomedInto(7); // 384 pixels thick
    expect(editor.pointsAtObject(middle)).toBe(true);
    editor.pointerDown(middle, "primary");
    editor.pointerUp();
    expect([...editor.selection]).toEqual([line]);
    editor.cancel();
    expect(editor.selectAll().count).toBe(1);
    editor.cancel();
    expect(editor.selectOnScreen().count).toBe(1);
  });

  it("cannot be clicked, and a press on it does not hold it", () => {
    const { editor, line } = zoomedInto(9); // 1536 pixels thick
    expect(editor.pointsAtObject(middle)).toBe(false);
    editor.pointerDown(middle, "primary");
    editor.pointerMove({ x: 700, y: 400 });
    editor.pointerUp();
    expect(editor.selection.size).toBe(0);
    expect(editor.items).toEqual([line]);
  });

  it("is not taken by a rectangle, in either direction", () => {
    const { editor } = zoomedInto(9);
    expect(drag(editor, { x: 100, y: 100 }, { x: 900, y: 600 })).toEqual({ count: 0, notVisible: 0 });
    expect(drag(editor, { x: 900, y: 600 }, { x: 100, y: 100 })).toEqual({ count: 0, notVisible: 0 });
    expect(editor.selection.size).toBe(0);
  });

  it("is not taken by Ctrl+A, nor by Space + Ctrl+A", () => {
    const { editor } = zoomedInto(9);
    expect(editor.selectAll().count).toBe(0);
    expect(editor.selectOnScreen().count).toBe(0);
  });

  it("lets what is drawn over it be taken", () => {
    const { editor } = zoomedInto(9);
    const small = drawLine(editor, { x: 600, y: 300 }, { x: 700, y: 300 });
    editor.pointerDown({ x: 650, y: 300 }, "primary");
    editor.pointerUp();
    expect([...editor.selection]).toEqual([small]);
    editor.cancel();
    editor.selectAll();
    expect([...editor.selection]).toEqual([small]);
    editor.cancel();
    expect(editor.selectOnScreen().count).toBe(1);
    expect([...editor.selection]).toEqual([small]);
  });

  it("is an object again after zooming out", () => {
    const { editor, line } = zoomedInto(9);
    editor.wheel(middle, 400); // × 0.2: 307 pixels thick
    expect(editor.camera.zLevel).toBeLessThan(9);
    expect(editor.pointsAtObject(middle)).toBe(true);
    editor.pointerDown(middle, "primary");
    editor.pointerUp();
    expect([...editor.selection]).toEqual([line]);
  });

  it("is a background at this thickness, whatever the factor of the zoom, right at the edge of the screen", () => {
    // 3 pixels at level 0: 720 pixels needs a scale of 240, that is level 7 and a factor of 1.875
    const editor = new Editor(viewport);
    const line = drawLine(editor, { x: 600, y: 300 }, { x: 700, y: 300 });
    const fresh = new Editor(viewport);
    fresh.restore({ items: [line], view: createCamera({ center: inLine, zLevel: 7, factor: 1.875 }) });
    expect(fresh.pointsAtObject(middle)).toBe(false);
    const below = new Editor(viewport);
    below.restore({ items: [line], view: createCamera({ center: inLine, zLevel: 7, factor: 1.87 }) });
    expect(below.pointsAtObject(middle)).toBe(true);
  });
});
