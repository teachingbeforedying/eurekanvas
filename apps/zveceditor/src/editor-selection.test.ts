import { describe, expect, it } from "vitest";
import { type Item, type ScreenPoint, type Viewport, type WorldBounds, boundsOf, isGroup, itemStrokes, placedSections, worldRectangle } from "@eurekanvas/engine";
import { Editor, type Modifiers } from "./editor";

// With the starting view, world point (x, y) is at screen (640 + x, 360 + y).
const viewport: Viewport = { width: 1280, height: 720 };

/** Draws one object: `strokes` straight strokes, 50 pixels long, from (x, y), 60 pixels apart, during one hold of `²`. */
function drawObject(editor: Editor, x: number, y: number, strokes = 1): Item {
  editor.setDrawKeyHeld(true);
  for (let i = 0; i < strokes; i++) {
    editor.pointerDown({ x: x + 60 * i, y }, "primary");
    editor.pointerMove({ x: x + 60 * i + 25, y });
    editor.pointerMove({ x: x + 60 * i + 50, y });
    editor.pointerUp();
  }
  editor.setDrawKeyHeld(false);
  return editor.items[editor.items.length - 1] as Item;
}

function click(editor: Editor, p: ScreenPoint, modifiers: Modifiers = {}): void {
  editor.pointerDown(p, "primary", 0, modifiers);
  editor.pointerUp();
}

function drag(editor: Editor, from: ScreenPoint, to: ScreenPoint, modifiers: Modifiers = {}) {
  editor.pointerDown(from, "primary", 0, modifiers);
  editor.pointerMove({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
  editor.pointerMove(to);
  return editor.pointerUp();
}

/** Moves the view by (dx, dy) pixels with the secondary button. */
function moveView(editor: Editor, dx: number, dy: number): void {
  editor.pointerDown({ x: 0, y: 0 }, "secondary");
  editor.pointerMove({ x: dx, y: dy });
  editor.pointerUp("secondary");
}

function selected(editor: Editor): Item[] {
  return [...editor.selection];
}

describe("a click", () => {
  it("takes the object under the pointer, and deselects on empty space", () => {
    const editor = new Editor(viewport);
    const a = drawObject(editor, 100, 100);
    const b = drawObject(editor, 100, 200);
    click(editor, { x: 125, y: 100 });
    expect(selected(editor)).toEqual([a]);
    click(editor, { x: 125, y: 200 });
    expect(selected(editor)).toEqual([b]);
    click(editor, { x: 600, y: 600 });
    expect(selected(editor)).toEqual([]);
  });

  it("takes a stroke up to 4 pixels from the edge of its ink", () => {
    const editor = new Editor(viewport);
    const a = drawObject(editor, 100, 100); // 3 pixels thick: its edge is 1.5 pixels from its middle
    click(editor, { x: 125, y: 105.5 });
    expect(selected(editor)).toEqual([a]);
    click(editor, { x: 125, y: 105.6 });
    expect(selected(editor)).toEqual([]);
  });

  it("on a stroke of a group takes the whole group", () => {
    const editor = new Editor(viewport);
    const group = drawObject(editor, 100, 100, 2);
    click(editor, { x: 185, y: 100 }); // on the second stroke
    expect(selected(editor)).toEqual([group]);
  });

  it("with Shift adds or removes an object, and keeps the selection on empty space", () => {
    const editor = new Editor(viewport);
    const a = drawObject(editor, 100, 100);
    const b = drawObject(editor, 100, 200);
    click(editor, { x: 125, y: 100 });
    click(editor, { x: 125, y: 200 }, { shift: true });
    expect(selected(editor)).toEqual([a, b]);
    click(editor, { x: 600, y: 600 }, { shift: true });
    expect(selected(editor)).toEqual([a, b]);
    click(editor, { x: 125, y: 100 }, { shift: true });
    expect(selected(editor)).toEqual([b]);
  });

  it("with Alt takes the object below, then further down, then the top again", () => {
    const editor = new Editor(viewport);
    // three different strokes (so that `toEqual` tells them apart) that all go through `here`
    const [a, b, c] = [drawObject(editor, 100, 100), drawObject(editor, 95, 100), drawObject(editor, 90, 100)];
    const here = { x: 125, y: 100 };
    click(editor, here, { alt: true }); // nothing selected: the one below the topmost
    expect(selected(editor)).toEqual([b]);
    click(editor, here);
    expect(selected(editor)).toEqual([c]);
    click(editor, here, { alt: true });
    expect(selected(editor)).toEqual([b]);
    click(editor, here, { alt: true });
    expect(selected(editor)).toEqual([a]);
    click(editor, here, { alt: true });
    expect(selected(editor)).toEqual([c]);
    click(editor, here, { alt: true, shift: true }); // and with Shift, adds the one below
    click(editor, here, { alt: true, shift: true });
    expect(selected(editor)).toEqual([c, b, a]);
  });

  it("is not made while the drawing key is held: the button draws, and what is drawn is not selected", () => {
    const editor = new Editor(viewport);
    const a = drawObject(editor, 100, 100);
    click(editor, { x: 125, y: 100 });
    expect(editor.pointsAtObject({ x: 125, y: 100 })).toBe(true);
    expect(editor.pointsAtObject({ x: 125, y: 150 })).toBe(false);
    editor.setDrawKeyHeld(true);
    expect(editor.pointsAtObject({ x: 125, y: 100 })).toBe(false);
    editor.setDrawKeyHeld(false);
    drawObject(editor, 100, 300);
    expect(editor.items).toHaveLength(2);
    expect(selected(editor)).toEqual([a]);
  });
});

describe("the rectangle", () => {
  it("from left to right takes what is entirely inside, from right to left what it touches", () => {
    const editor = new Editor(viewport);
    const a = drawObject(editor, 100, 100); // from x = 100 to 150
    const b = drawObject(editor, 140, 200); // from x = 140 to 190
    expect(drag(editor, { x: 90, y: 80 }, { x: 160, y: 220 })).toEqual({ count: 1, notVisible: 0 });
    expect(selected(editor)).toEqual([a]);
    expect(drag(editor, { x: 160, y: 220 }, { x: 90, y: 80 })).toEqual({ count: 2, notVisible: 0 });
    expect(selected(editor)).toEqual([a, b]);
    drag(editor, { x: 500, y: 500 }, { x: 600, y: 600 });
    expect(selected(editor)).toEqual([]);
  });

  it("with Shift adds what it takes", () => {
    const editor = new Editor(viewport);
    const a = drawObject(editor, 100, 100);
    const b = drawObject(editor, 100, 200);
    click(editor, { x: 125, y: 200 });
    drag(editor, { x: 90, y: 80 }, { x: 160, y: 120 }, { shift: true });
    expect(selected(editor)).toEqual([b, a]);
  });

  it("is shown while it is dragged, with its mode", () => {
    const editor = new Editor(viewport);
    editor.pointerDown({ x: 300, y: 300 }, "primary");
    editor.pointerMove({ x: 303, y: 302 }); // not far enough yet
    expect(editor.band).toBeNull();
    editor.pointerMove({ x: 400, y: 350 });
    expect(editor.band).toEqual({ from: { x: 300, y: 300 }, to: { x: 400, y: 350 }, mode: "inside" });
    expect(editor.scene.band).toEqual(editor.band);
    editor.pointerMove({ x: 250, y: 350 });
    expect(editor.band?.mode).toBe("touching");
    editor.pointerUp();
    expect(editor.band).toBeNull();
  });

  it("stays a click when the pointer barely moves, and is never started on an object", () => {
    const editor = new Editor(viewport);
    const a = drawObject(editor, 100, 100);
    drawObject(editor, 100, 200);
    click(editor, { x: 125, y: 200 });
    expect(drag(editor, { x: 300, y: 300 }, { x: 303, y: 302 })).toBeNull(); // a click on empty space
    expect(selected(editor)).toEqual([]);
    expect(drag(editor, { x: 125, y: 100 }, { x: 400, y: 400 })).toBeNull(); // pressed on a: a click on a
    expect(editor.band).toBeNull();
    expect(selected(editor)).toEqual([a]);
  });

  it("stays on the drawing while zooming, and takes objects too small to be seen", () => {
    const editor = new Editor(viewport);
    const a = drawObject(editor, 100, 100);
    editor.pointerDown({ x: 90, y: 90 }, "primary");
    editor.pointerMove({ x: 95, y: 95 });
    for (let i = 0; i < 3; i++) editor.wheel({ x: 95, y: 95 }, 495); // zooms out a million times
    editor.pointerMove({ x: 200, y: 200 });
    expect(editor.pointerUp()).toEqual({ count: 1, notVisible: 1 });
    expect(selected(editor)).toEqual([a]);
  });

  it("is dropped by Escape, which otherwise deselects", () => {
    const editor = new Editor(viewport);
    const a = drawObject(editor, 100, 100);
    click(editor, { x: 125, y: 100 });
    editor.pointerDown({ x: 90, y: 80 }, "primary");
    editor.pointerMove({ x: 300, y: 300 });
    editor.cancel();
    expect(editor.band).toBeNull();
    expect(editor.pointerUp()).toBeNull();
    expect(selected(editor)).toEqual([a]);
    editor.cancel();
    expect(selected(editor)).toEqual([]);
  });
});

describe("selecting with keys", () => {
  it("selects every object with Ctrl+A, and tells how many are not on the screen", () => {
    const editor = new Editor(viewport);
    const a = drawObject(editor, 100, 100);
    moveView(editor, 2000, 0); // a is now off the screen
    const b = drawObject(editor, 100, 100);
    expect(editor.selectAll()).toEqual({ count: 2, notVisible: 1 });
    expect(selected(editor)).toEqual([a, b]);
  });

  it("selects what touches the screen, objects too small to be seen included", () => {
    const editor = new Editor(viewport);
    for (let i = 0; i < 20; i++) editor.wheel({ x: 640, y: 360 }, -495); // zooms in about a million times
    const tiny = drawObject(editor, 600, 360); // too small to be seen from the starting view
    editor.resetView();
    moveView(editor, -2000, 0);
    drawObject(editor, 100, 100); // off the screen of the starting view
    editor.resetView();
    const across = drawObject(editor, 1250, 100); // reaches beyond the right side of the screen
    expect(editor.selectOnScreen()).toEqual({ count: 2, notVisible: 1 });
    expect(selected(editor)).toEqual([tiny, across]);
  });
});

describe("deleting and grouping", () => {
  it("deletes the selection as one action, which Ctrl+Z undoes", () => {
    const editor = new Editor(viewport);
    const a = drawObject(editor, 100, 100);
    const b = drawObject(editor, 100, 200);
    expect(editor.deleteSelection()).toBe(0);
    click(editor, { x: 125, y: 100 });
    expect(editor.deleteSelection()).toBe(1);
    expect(editor.items).toEqual([b]);
    expect(selected(editor)).toEqual([]);
    editor.undo();
    expect(editor.items).toEqual([a, b]);
  });

  it("keeps in the selection, after Ctrl+Z, only the objects still there", () => {
    const editor = new Editor(viewport);
    const a = drawObject(editor, 100, 100);
    drawObject(editor, 100, 200);
    editor.selectAll();
    editor.undo(); // the second object is removed
    expect(editor.items).toEqual([a]);
    expect(selected(editor)).toEqual([a]);
  });

  it("groups the selection with Shift+G, at the place of its topmost object, and selects the group", () => {
    const editor = new Editor(viewport);
    const [a, b, c, d] = [100, 200, 300, 400].map((y) => drawObject(editor, 100, y)) as [Item, Item, Item, Item];
    click(editor, { x: 125, y: 100 });
    expect(editor.groupSelection()).toBe(0); // one object: nothing to group
    expect(editor.items).toEqual([a, b, c, d]);
    click(editor, { x: 125, y: 300 }, { shift: true });
    expect(editor.groupSelection()).toBe(2);
    const group = editor.items[1] as Item;
    expect(editor.items).toEqual([b, group, d]);
    expect(group).toEqual({ items: [a, c] });
    expect(selected(editor)).toEqual([group]);
    editor.undo();
    expect(editor.items).toEqual([a, b, c, d]);
    expect(selected(editor)).toEqual([]);
  });

  it("nests groups, and Shift+B undoes one level, selecting what it frees", () => {
    const editor = new Editor(viewport);
    const [a, b, c] = [100, 200, 300].map((y) => drawObject(editor, 100, y)) as [Item, Item, Item];
    editor.selectAll();
    click(editor, { x: 125, y: 300 }, { shift: true }); // a and b
    editor.groupSelection();
    const inner = selected(editor)[0] as Item;
    editor.selectAll();
    editor.groupSelection();
    const outer = editor.items[0] as Item;
    expect(outer).toEqual({ items: [inner, c] });
    expect(editor.scene.strokes).toHaveLength(3);

    expect(editor.ungroupSelection()).toBe(1);
    expect(editor.items).toEqual([inner, c]);
    expect(selected(editor)).toEqual([inner, c]);
    expect(editor.ungroupSelection()).toBe(1);
    expect(editor.items).toEqual([a, b, c]);
    expect(selected(editor)).toEqual([a, b, c]);
    expect(editor.ungroupSelection()).toBe(0);
    editor.undo();
    expect(editor.items).toEqual([inner, c]);
  });

  it("ends the hold of the drawing key first: its strokes become their object", () => {
    const editor = new Editor(viewport);
    const a = drawObject(editor, 100, 100);
    click(editor, { x: 125, y: 100 });
    editor.setDrawKeyHeld(true);
    for (const y of [300, 400]) {
      editor.pointerDown({ x: 100, y }, "primary");
      editor.pointerMove({ x: 150, y });
      editor.pointerUp();
    }
    expect(editor.deleteSelection()).toBe(1);
    editor.setDrawKeyHeld(false);
    expect(editor.items).toHaveLength(1);
    const group = editor.items[0] as Item;
    expect(isGroup(group)).toBe(true);
    editor.undo(); // the deletion
    expect(editor.items).toEqual([a, group]);
    editor.undo(); // the group
    expect(editor.items).toEqual([a]);
  });

  it.each(["delete", "group", "ungroup"] as const)("ends the hold of ² before %s, so that Ctrl+Z goes back one action at a time", (action) => {
    const editor = new Editor(viewport);
    drawObject(editor, 100, 100);
    drawObject(editor, 100, 200);
    editor.selectAll();
    if (action === "ungroup") editor.groupSelection();
    const start = editor.items;
    editor.setDrawKeyHeld(true);
    for (const y of [300, 400]) {
      editor.pointerDown({ x: 100, y }, "primary");
      editor.pointerMove({ x: 150, y });
      editor.pointerUp();
    }
    const done = action === "delete" ? editor.deleteSelection() : action === "group" ? editor.groupSelection() : editor.ungroupSelection();
    expect(done).toBeGreaterThan(0);
    editor.setDrawKeyHeld(false);
    const hold = editor.items[editor.items.length - 1] as Item;
    expect(itemStrokes(hold)).toHaveLength(2);
    editor.undo(); // the action
    expect(editor.items).toEqual([...start, hold]);
    editor.undo(); // the strokes of the hold
    expect(editor.items).toEqual(start);
  });

  it("does nothing while a stroke is drawn", () => {
    const editor = new Editor(viewport);
    drawObject(editor, 100, 100);
    editor.selectAll();
    editor.setDrawKeyHeld(true);
    editor.pointerDown({ x: 100, y: 300 }, "primary");
    expect(editor.deleteSelection()).toBe(0);
    expect(editor.groupSelection()).toBe(0);
    expect(editor.ungroupSelection()).toBe(0);
    editor.pointerUp();
    expect(editor.items).toHaveLength(2);
  });
});

describe("the scene", () => {
  it("has the sections of the selection and its exact frame", () => {
    const editor = new Editor(viewport);
    const a = drawObject(editor, 100, 100, 2);
    drawObject(editor, 100, 200);
    expect(editor.scene.selectedSections?.size).toBe(0);
    expect(editor.scene.selectionFrame).toBeNull();
    click(editor, { x: 125, y: 100 });
    expect([...(editor.scene.selectedSections ?? [])]).toEqual(placedSections(a));
    expect(editor.scene.selectionFrame).toEqual(worldRectangle(boundsOf([a]) as WorldBounds));
    expect(editor.scene.band).toBeNull();
    expect(itemStrokes(a)).toHaveLength(2);
    editor.clear();
    expect(editor.scene.selectionFrame).toBeNull();
  });
});
