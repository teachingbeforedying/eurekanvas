import { describe, expect, it } from "vitest";
import { type Drawing, type Stroke, type Viewport, createCamera, drawingFromJSON, drawingToJSON, fromNumber } from "@eurekanvas/engine";
import { Editor } from "./editor";

const viewport: Viewport = { width: 1280, height: 720 };

/** Draws a straight stroke from (x, 100) to (x + 50, 100) with the raw pen. */
function drawStroke(editor: Editor, x: number): void {
  editor.pointerDown({ x, y: 100 }, "primary");
  editor.pointerMove({ x: x + 25, y: 100 });
  editor.pointerMove({ x: x + 50, y: 100 });
  editor.pointerUp();
}

/** A drawing of `count` strokes made in another editor, seen from a view far from the starting one. */
function savedDrawing(count: number): Drawing {
  const other = new Editor(viewport);
  for (let i = 0; i < count; i++) drawStroke(other, 100 * i);
  const view = createCamera({ center: { x: fromNumber(5000), y: fromNumber(-300) }, zLevel: 40, factor: 1.25 });
  return drawingFromJSON(JSON.parse(JSON.stringify(drawingToJSON({ strokes: other.strokes, view }))));
}

describe("the history of actions", () => {
  it("undoes a clear: every stroke comes back", () => {
    const editor = new Editor(viewport);
    drawStroke(editor, 100);
    drawStroke(editor, 300);
    const before = editor.strokes;
    expect(editor.clear()).toBe(true);
    expect(editor.strokes).toEqual([]);
    editor.undo();
    expect(editor.strokes).toEqual(before);
  });

  it("adds the strokes of a drawing after the others, shows its view, and undoes the whole addition at once", () => {
    const editor = new Editor(viewport);
    drawStroke(editor, 100);
    const own: readonly Stroke[] = editor.strokes;
    const saved = savedDrawing(3);
    expect(editor.addDrawing(saved)).toBe(true);
    expect(editor.strokes).toEqual([...own, ...saved.strokes]);
    expect(editor.camera).toEqual(saved.view);
    editor.undo();
    expect(editor.strokes).toEqual(own);
    expect(editor.camera).toEqual(saved.view); // undoing does not move the view
  });

  it("undoes the actions one by one, in the reverse order", () => {
    const editor = new Editor(viewport);
    drawStroke(editor, 100);
    const afterStroke = editor.strokes;
    editor.addDrawing(savedDrawing(2));
    const afterAdd = editor.strokes;
    editor.clear();
    editor.undo();
    expect(editor.strokes).toEqual(afterAdd);
    editor.undo();
    expect(editor.strokes).toEqual(afterStroke);
    editor.undo();
    expect(editor.strokes).toEqual([]);
    editor.undo(); // nothing left to undo
    expect(editor.strokes).toEqual([]);
  });

  it("leaves nothing to undo after a clear of an empty drawing or the addition of an empty one", () => {
    const editor = new Editor(viewport);
    drawStroke(editor, 100);
    const own = editor.strokes;
    const elsewhere = createCamera({ zLevel: 7 });
    editor.addDrawing({ strokes: [], view: elsewhere });
    expect(editor.camera).toEqual(elsewhere); // the view of the file is shown all the same
    editor.clear();
    editor.clear();
    editor.undo(); // undoes the clear that removed something, not the empty ones
    expect(editor.strokes).toEqual(own);
  });

  it("restores a saved drawing with its view and nothing to undo, keeping strokes drawn before it came back", () => {
    const editor = new Editor(viewport);
    drawStroke(editor, 100); // drawn while the saved drawing was loading
    const early = editor.strokes;
    const saved = savedDrawing(2);
    editor.restore(saved);
    expect(editor.strokes).toEqual([...saved.strokes, ...early]);
    expect(editor.camera).toEqual(saved.view);
    editor.undo();
    expect(editor.strokes).toEqual([...saved.strokes, ...early]);
  });

  it("restores the strokes but not the view while a stroke is being drawn", () => {
    const editor = new Editor(viewport);
    editor.pointerDown({ x: 100, y: 100 }, "primary");
    const saved = savedDrawing(1);
    editor.restore(saved);
    expect(editor.strokes).toEqual(saved.strokes);
    expect(editor.camera).toEqual(createCamera());
    editor.pointerMove({ x: 150, y: 100 });
    editor.pointerUp();
    expect(editor.strokes).toHaveLength(2);
  });

  it("does not clear nor add a drawing while a stroke is being drawn", () => {
    const editor = new Editor(viewport);
    drawStroke(editor, 100);
    const own = editor.strokes;
    editor.pointerDown({ x: 400, y: 100 }, "primary");
    expect(editor.clear()).toBe(false);
    expect(editor.addDrawing(savedDrawing(1))).toBe(false);
    expect(editor.strokes).toEqual(own);
    expect(editor.camera).toEqual(createCamera());
  });
});
