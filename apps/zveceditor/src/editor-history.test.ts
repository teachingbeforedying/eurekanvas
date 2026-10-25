import { describe, expect, it } from "vitest";
import {
  type Drawing,
  type Item,
  type Viewport,
  createCamera,
  drawingFromJSON,
  drawingToJSON,
  fromNumber,
  isGroup,
  itemStrokes,
} from "@eurekanvas/engine";
import { Editor } from "./editor";

const viewport: Viewport = { width: 1280, height: 720 };

/** Draws a straight stroke from (x, 100) to (x + 50, 100) with the raw pen. The drawing key must be held. */
function drawStroke(editor: Editor, x: number): void {
  editor.pointerDown({ x, y: 100 }, "primary");
  editor.pointerMove({ x: x + 25, y: 100 });
  editor.pointerMove({ x: x + 50, y: 100 });
  editor.pointerUp();
}

/** Draws one object: `strokes` strokes during one hold of the drawing key. */
function drawObject(editor: Editor, x: number, strokes = 1): void {
  editor.setDrawKeyHeld(true);
  for (let i = 0; i < strokes; i++) drawStroke(editor, x + 60 * i);
  editor.setDrawKeyHeld(false);
}

/** A drawing of `count` objects made in another editor, seen from a view far from the starting one. */
function savedDrawing(count: number): Drawing {
  const other = new Editor(viewport);
  for (let i = 0; i < count; i++) drawObject(other, 100 * i);
  const view = createCamera({ center: { x: fromNumber(5000), y: fromNumber(-300) }, zLevel: 40, factor: 1.25 });
  return drawingFromJSON(JSON.parse(JSON.stringify(drawingToJSON({ items: other.items, view }))));
}

function strokeCount(items: readonly Item[]): number {
  return items.flatMap(itemStrokes).length;
}

describe("the drawing key (²)", () => {
  it("is needed to draw: without it, the primary button draws nothing", () => {
    const editor = new Editor(viewport);
    drawStroke(editor, 100);
    expect(editor.items).toEqual([]);
    expect(editor.isDrawing).toBe(false);
  });

  it("must be held before the press: held afterwards, it does not start a stroke", () => {
    const editor = new Editor(viewport);
    editor.pointerDown({ x: 100, y: 100 }, "primary");
    editor.setDrawKeyHeld(true);
    editor.pointerMove({ x: 150, y: 100 });
    editor.pointerUp();
    expect(editor.items).toEqual([]);
  });

  it("makes one stroke an object of its own", () => {
    const editor = new Editor(viewport);
    drawObject(editor, 100, 1);
    expect(editor.items).toHaveLength(1);
    expect(isGroup(editor.items[0] as Item)).toBe(false);
  });

  it("makes one group of the strokes drawn while it stays held, the button released in between", () => {
    const editor = new Editor(viewport);
    drawObject(editor, 100, 3);
    expect(editor.items).toHaveLength(1);
    const group = editor.items[0] as Item;
    expect(isGroup(group)).toBe(true);
    expect(itemStrokes(group)).toHaveLength(3);
    drawObject(editor, 400, 2);
    expect(editor.items).toHaveLength(2);
    expect(editor.scene.strokes).toHaveLength(5);
  });

  it("lets the stroke go on when released before the button, and puts that stroke in the group", () => {
    const editor = new Editor(viewport);
    editor.setDrawKeyHeld(true);
    drawStroke(editor, 100);
    editor.pointerDown({ x: 300, y: 100 }, "primary");
    editor.setDrawKeyHeld(false); // released in the middle of the second stroke
    editor.pointerMove({ x: 350, y: 120 });
    expect(editor.isDrawing).toBe(true);
    expect(editor.items).toHaveLength(1); // the hold is not over yet
    editor.pointerUp();
    expect(editor.items).toHaveLength(1);
    expect(itemStrokes(editor.items[0] as Item)).toHaveLength(2);
    expect(editor.stats.points).toBe(3 + 2);
  });

  it("undoes stroke by stroke while held, then the whole object once released", () => {
    const editor = new Editor(viewport);
    drawObject(editor, 0, 2); // an earlier object, to see that it stays
    editor.setDrawKeyHeld(true);
    drawStroke(editor, 100);
    drawStroke(editor, 200);
    drawStroke(editor, 300);
    editor.undo(); // while held: the last stroke only
    expect(strokeCount(editor.items)).toBe(2 + 2);
    drawStroke(editor, 400);
    editor.setDrawKeyHeld(false);
    expect(editor.items).toHaveLength(2);
    expect(itemStrokes(editor.items[1] as Item)).toHaveLength(3);
    editor.undo(); // released: the whole object
    expect(editor.items).toHaveLength(1);
    expect(strokeCount(editor.items)).toBe(2);
    editor.undo();
    expect(editor.items).toEqual([]);
  });

  it("keeps a single stroke when the others of the hold were undone", () => {
    const editor = new Editor(viewport);
    editor.setDrawKeyHeld(true);
    drawStroke(editor, 100);
    drawStroke(editor, 200);
    editor.undo();
    editor.setDrawKeyHeld(false);
    expect(editor.items).toHaveLength(1);
    expect(isGroup(editor.items[0] as Item)).toBe(false);
  });

  it("ends the hold before another action, so that the action can be undone on its own", () => {
    const editor = new Editor(viewport);
    editor.setDrawKeyHeld(true);
    drawStroke(editor, 100);
    drawStroke(editor, 200);
    editor.clear(); // K while ² is still held
    expect(editor.items).toEqual([]);
    drawStroke(editor, 300);
    editor.setDrawKeyHeld(false);
    expect(editor.items).toHaveLength(1);
    editor.undo(); // the stroke drawn after the clear
    expect(editor.items).toEqual([]);
    editor.undo(); // the clear: the group of the first two strokes comes back
    expect(editor.items).toHaveLength(1);
    expect(itemStrokes(editor.items[0] as Item)).toHaveLength(2);
  });
});

describe("the history of actions", () => {
  it("undoes a clear: every object comes back", () => {
    const editor = new Editor(viewport);
    drawObject(editor, 100);
    drawObject(editor, 300, 2);
    const before = editor.items;
    expect(editor.clear()).toBe(true);
    expect(editor.items).toEqual([]);
    editor.undo();
    expect(editor.items).toEqual(before);
  });

  it("adds the objects of a drawing after the others, shows its view, and undoes the whole addition at once", () => {
    const editor = new Editor(viewport);
    drawObject(editor, 100);
    const own = editor.items;
    const saved = savedDrawing(3);
    expect(editor.addDrawing(saved)).toBe(true);
    expect(editor.items).toEqual([...own, ...saved.items]);
    expect(editor.camera).toEqual(saved.view);
    editor.undo();
    expect(editor.items).toEqual(own);
    expect(editor.camera).toEqual(saved.view); // undoing does not move the view
  });

  it("undoes the actions one by one, in the reverse order", () => {
    const editor = new Editor(viewport);
    drawObject(editor, 100);
    const afterStroke = editor.items;
    editor.addDrawing(savedDrawing(2));
    const afterAdd = editor.items;
    editor.clear();
    editor.undo();
    expect(editor.items).toEqual(afterAdd);
    editor.undo();
    expect(editor.items).toEqual(afterStroke);
    editor.undo();
    expect(editor.items).toEqual([]);
    editor.undo(); // nothing left to undo
    expect(editor.items).toEqual([]);
  });

  it("leaves nothing to undo after a clear of an empty drawing or the addition of an empty one", () => {
    const editor = new Editor(viewport);
    drawObject(editor, 100);
    const own = editor.items;
    const elsewhere = createCamera({ zLevel: 7 });
    editor.addDrawing({ items: [], view: elsewhere });
    expect(editor.camera).toEqual(elsewhere); // the view of the file is shown all the same
    editor.clear();
    editor.clear();
    editor.undo(); // undoes the clear that removed something, not the empty ones
    expect(editor.items).toEqual(own);
  });

  it("restores a saved drawing with its view and nothing to undo, keeping objects drawn before it came back", () => {
    const editor = new Editor(viewport);
    drawObject(editor, 100); // drawn while the saved drawing was loading
    const early = editor.items;
    const saved = savedDrawing(2);
    editor.restore(saved);
    expect(editor.items).toEqual([...saved.items, ...early]);
    expect(editor.camera).toEqual(saved.view);
    editor.undo();
    expect(editor.items).toEqual([...saved.items, ...early]);
  });

  it("restores the objects but not the view while a stroke is being drawn", () => {
    const editor = new Editor(viewport);
    editor.setDrawKeyHeld(true);
    editor.pointerDown({ x: 100, y: 100 }, "primary");
    const saved = savedDrawing(1);
    editor.restore(saved);
    expect(editor.items).toEqual(saved.items);
    expect(editor.camera).toEqual(createCamera());
    editor.pointerMove({ x: 150, y: 100 });
    editor.pointerUp();
    expect(editor.items).toHaveLength(2);
  });

  it("does not clear nor add a drawing while a stroke is being drawn", () => {
    const editor = new Editor(viewport);
    drawObject(editor, 100);
    const own = editor.items;
    editor.setDrawKeyHeld(true);
    editor.pointerDown({ x: 400, y: 100 }, "primary");
    expect(editor.clear()).toBe(false);
    expect(editor.addDrawing(savedDrawing(1))).toBe(false);
    expect(editor.items).toEqual(own);
    expect(editor.camera).toEqual(createCamera());
  });
});
