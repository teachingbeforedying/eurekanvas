import { describe, expect, it } from "vitest";
import {
  type Drawing,
  type Group,
  type Item,
  type Point,
  type ScreenPoint,
  type Viewport,
  applyTransform,
  drawingFromJSON,
  drawingToJSON,
  isGroup,
  itemFrame,
  rectangleCenter,
  rectangleOnScreen,
  screenToWorld,
  worldToScreen,
} from "@eurekanvas/engine";
import { Editor, PASTE_OFFSET_PIXELS, type Modifiers } from "./editor";

const viewport: Viewport = { width: 1280, height: 720 };

function line(editor: Editor, x: number, y: number): Item {
  editor.setDrawKeyHeld(true);
  editor.pointerDown({ x, y }, "primary");
  editor.pointerMove({ x: x + 50, y });
  editor.pointerMove({ x: x + 100, y });
  editor.pointerUp();
  editor.setDrawKeyHeld(false);
  return editor.items[editor.items.length - 1] as Item;
}

/** Two strokes during one hold of `²`: a group. */
function syllable(editor: Editor, x: number): void {
  editor.setDrawKeyHeld(true);
  for (const y of [100, 130]) {
    editor.pointerDown({ x, y }, "primary");
    editor.pointerMove({ x: x + 50, y });
    editor.pointerMove({ x: x + 100, y });
    editor.pointerUp();
  }
  editor.setDrawKeyHeld(false);
}

function drawName(editor: Editor): Group {
  syllable(editor, 100);
  syllable(editor, 300);
  editor.selectAll();
  editor.groupSelection();
  editor.cancel();
  return editor.items[0] as Group;
}

const inFirst: ScreenPoint = { x: 150, y: 100 };

function press(editor: Editor, p: ScreenPoint, modifiers: Modifiers = {}): void {
  editor.pointerDown(p, "primary", 0, modifiers);
  editor.pointerUp();
}

function alt(editor: Editor, p: ScreenPoint): void {
  press(editor, p, { alt: true });
}

function centerOnScreen(editor: Editor, item: Item): ScreenPoint {
  const frame = itemFrame(item);
  if (frame === null) throw new Error("a frame expected");
  return worldToScreen(editor.camera, viewport, rectangleCenter(frame));
}

function widthOnScreen(editor: Editor, item: Item): number {
  const frame = itemFrame(item);
  if (frame === null) throw new Error("a frame expected");
  return rectangleOnScreen(editor.camera, viewport, frame).width;
}

function only(editor: Editor): Item {
  expect(editor.selection.size).toBe(1);
  return [...editor.selection][0] as Item;
}

function close(a: ScreenPoint, b: ScreenPoint): void {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
}

/** Where an object's transform puts a world point, on the screen. */
function seenAt(editor: Editor, item: Item, world: Point): ScreenPoint {
  const t = item.transform;
  if (t === undefined) throw new Error("a transform expected");
  return worldToScreen(editor.camera, viewport, applyTransform(t, world));
}

const shifted = (p: ScreenPoint, n: number): ScreenPoint => ({ x: p.x + n * PASTE_OFFSET_PIXELS, y: p.y + n * PASTE_OFFSET_PIXELS });

describe("copying", () => {
  it("gives the selection in drawing order, with its view", () => {
    const editor = new Editor(viewport);
    const a = line(editor, 100, 100);
    const b = line(editor, 100, 200);
    press(editor, { x: 150, y: 200 });
    press(editor, { x: 150, y: 100 }, { shift: true }); // selected in the other order
    const copy = editor.copySelection();
    expect(copy?.items).toEqual([a, b]);
    expect(copy?.view).toBe(editor.camera);
    expect(editor.items).toEqual([a, b]);
  });

  it("does nothing with nothing selected, or while drawing", () => {
    const editor = new Editor(viewport);
    line(editor, 100, 100);
    expect(editor.copySelection()).toBeNull();
    expect(editor.cutSelection()).toBeNull();
    editor.selectAll();
    editor.setDrawKeyHeld(true);
    editor.pointerDown({ x: 400, y: 400 }, "primary");
    expect(editor.copySelection()).toBeNull();
    expect(editor.cutSelection()).toBeNull();
    editor.pointerUp();
    editor.setDrawKeyHeld(false);
    expect(editor.items).toHaveLength(2);
  });

  it("takes a part out of its groups", () => {
    const editor = new Editor(viewport);
    drawName(editor);
    alt(editor, inFirst);
    const part = editor.selectedPart;
    expect(editor.copySelection()?.items).toEqual([part?.placed]);
  });
});

describe("cutting", () => {
  it("removes the selection, as one action, and pasting puts it back in place", () => {
    const editor = new Editor(viewport);
    const start = line(editor, 100, 100);
    const before = centerOnScreen(editor, start);
    editor.selectAll();
    const copy = editor.cutSelection() as Drawing;
    expect(copy.items).toEqual([start]);
    expect(editor.items).toEqual([]);
    expect(editor.selection.size).toBe(0);
    editor.pasteDrawing(copy);
    close(centerOnScreen(editor, only(editor)), before); // nothing is there any more: no shift
    editor.undo();
    expect(editor.items).toEqual([]);
    editor.undo();
    expect(editor.items).toEqual([start]);
  });

  it("removes a part from its group, and the group stays", () => {
    const editor = new Editor(viewport);
    const root = drawName(editor);
    alt(editor, inFirst);
    editor.cutSelection();
    expect(editor.items).toHaveLength(1);
    expect((editor.items[0] as Group).items).toEqual([root.items[1]]);
  });
});

describe("pasting", () => {
  it("adds what was copied and selects it, as one action, moved away from what it would exactly cover", () => {
    const editor = new Editor(viewport);
    const start = line(editor, 100, 100);
    editor.selectAll();
    const copy = editor.copySelection() as Drawing;
    expect(editor.pasteDrawing(copy)).toBe(1);
    const first = only(editor);
    expect(editor.items).toEqual([start, first]);
    close(centerOnScreen(editor, first), shifted(centerOnScreen(editor, start), 1));
    editor.undo();
    expect(editor.items).toEqual([start]);
  });

  it("goes on in a cascade, each paste moving away from the ones already there", () => {
    const editor = new Editor(viewport);
    const start = line(editor, 100, 100);
    editor.selectAll();
    const copy = editor.copySelection() as Drawing;
    for (let n = 1; n <= 3; n++) {
      editor.pasteDrawing(copy);
      close(centerOnScreen(editor, only(editor)), shifted(centerOnScreen(editor, start), n));
    }
    expect(editor.items).toHaveLength(4);
    expect(PASTE_OFFSET_PIXELS).toBe(20);
  });

  it("does not move away from an original that has moved", () => {
    const editor = new Editor(viewport);
    const start = line(editor, 100, 100);
    const at = centerOnScreen(editor, start);
    editor.selectAll();
    const copy = editor.copySelection() as Drawing;
    editor.moveSelection(0, 50);
    editor.pasteDrawing(copy);
    close(centerOnScreen(editor, only(editor)), at);
  });

  it("goes through the text of the clipboard unchanged", () => {
    const editor = new Editor(viewport);
    const start = line(editor, 100, 100);
    editor.selectAll();
    const copy = editor.copySelection() as Drawing;
    editor.pasteDrawing(drawingFromJSON(JSON.parse(JSON.stringify(drawingToJSON(copy)))));
    close(centerOnScreen(editor, only(editor)), shifted(centerOnScreen(editor, start), 1)); // still recognized as covering it
  });

  it("looks on the screen as it did at the copy, after a zoom, a move, a turn and a mirror of the view", () => {
    const editor = new Editor(viewport);
    const start = line(editor, 100, 100);
    editor.selectAll();
    const center = centerOnScreen(editor, start);
    const width = widthOnScreen(editor, start);
    const world = screenToWorld(editor.camera, viewport, { x: 110, y: 100 });
    const copy = editor.copySelection() as Drawing;
    editor.wheel({ x: 500, y: 500 }, -300);
    editor.moveCamera(35, -12);
    editor.turnView(30);
    editor.mirrorView("topBottom");
    editor.pasteDrawing(copy);
    const pasted = only(editor);
    close(centerOnScreen(editor, pasted), center);
    expect(widthOnScreen(editor, pasted)).toBeCloseTo(width, 6);
    close(seenAt(editor, pasted, world), { x: 110, y: 100 }); // the same end of the line: same angle, same mirror
  });

  it("gives a free object from a part, its groups untouched, moved away from the original", () => {
    const editor = new Editor(viewport);
    const root = drawName(editor);
    alt(editor, inFirst);
    const before = centerOnScreen(editor, (editor.selectedPart as NonNullable<typeof editor.selectedPart>).placed);
    const copy = editor.copySelection() as Drawing;
    expect(editor.pasteDrawing(copy)).toBe(1);
    expect(editor.items).toHaveLength(2);
    expect(editor.items[0]).toBe(root);
    expect(editor.selectedPart).toBeNull();
    close(centerOnScreen(editor, only(editor)), shifted(before, 1));
  });

  it("does nothing while drawing, or without objects", () => {
    const editor = new Editor(viewport);
    line(editor, 100, 100);
    editor.selectAll();
    const copy = editor.copySelection() as Drawing;
    expect(editor.pasteDrawing({ items: [], view: copy.view })).toBe(0);
    expect(editor.selection.size).toBe(1); // nothing happened: the selection stays
    editor.setDrawKeyHeld(true);
    editor.pointerDown({ x: 400, y: 400 }, "primary");
    expect(editor.pasteDrawing(copy)).toBe(0);
    editor.pointerUp();
    editor.setDrawKeyHeld(false);
    expect(editor.items).toHaveLength(2);
  });
});

describe("opening a file", () => {
  it("selects what it adds, ready to be placed", () => {
    const editor = new Editor(viewport);
    const start = line(editor, 100, 100);
    editor.selectAll();
    const file: Drawing = { items: [start], view: editor.camera };
    press(editor, { x: 900, y: 600 });
    expect(editor.selection.size).toBe(0);
    expect(editor.addDrawing(file)).toBe(true);
    expect([...editor.selection]).toEqual([start]);
    press(editor, { x: 900, y: 600 });
    editor.addDrawing({ items: [], view: editor.camera });
    expect(editor.selection.size).toBe(0);
  });
});

describe("pasting into a group", () => {
  it("needs something copied, and a part or a group selected", () => {
    const editor = new Editor(viewport);
    const start = line(editor, 100, 100);
    expect(editor.pasteIntoGroup()).toBe("nothingCopied");
    editor.selectAll();
    editor.copySelection();
    expect(editor.pasteIntoGroup()).toBe("noGroup"); // a stroke alone
    editor.cancel();
    expect(editor.pasteIntoGroup()).toBe("noGroup"); // nothing
    expect(editor.items).toEqual([start]);
  });

  it("refuses several objects selected, and does nothing while drawing", () => {
    const editor = new Editor(viewport);
    drawName(editor);
    syllable(editor, 500);
    editor.selectAll();
    editor.copySelection();
    expect(editor.pasteIntoGroup()).toBe("noGroup");
    editor.setDrawKeyHeld(true);
    editor.pointerDown({ x: 400, y: 400 }, "primary");
    expect(editor.pasteIntoGroup()).toBe(0);
    editor.pointerUp();
    editor.setDrawKeyHeld(false);
  });

  it("puts the copy of a part right after it, and selects the copy, as one action", () => {
    const editor = new Editor(viewport);
    const root = drawName(editor);
    alt(editor, inFirst);
    const before = centerOnScreen(editor, (editor.selectedPart as NonNullable<typeof editor.selectedPart>).placed);
    editor.copySelection();
    expect(editor.pasteIntoGroup()).toBe(1);
    const changed = editor.items[0] as Group;
    expect(editor.items).toHaveLength(1);
    expect(changed.items).toHaveLength(3);
    expect(changed.items[0]).toBe(root.items[0]);
    expect(changed.items[2]).toBe(root.items[1]);
    expect(editor.selectedPart?.path).toEqual([1]);
    close(centerOnScreen(editor, (editor.selectedPart as NonNullable<typeof editor.selectedPart>).placed), shifted(before, 1));
    editor.undo();
    expect(editor.items).toEqual([root]);
  });

  it("goes on in a cascade inside the group", () => {
    const editor = new Editor(viewport);
    drawName(editor);
    alt(editor, inFirst);
    const before = centerOnScreen(editor, (editor.selectedPart as NonNullable<typeof editor.selectedPart>).placed);
    editor.copySelection();
    editor.pasteIntoGroup();
    editor.pasteIntoGroup();
    expect(editor.selectedPart?.path).toEqual([2]);
    close(centerOnScreen(editor, (editor.selectedPart as NonNullable<typeof editor.selectedPart>).placed), shifted(before, 2));
    expect((editor.items[0] as Group).items).toHaveLength(4);
  });

  it("puts it at the end of a whole selected group, in another group than the copied one", () => {
    const editor = new Editor(viewport);
    const start = line(editor, 100, 300);
    syllable(editor, 500);
    const group = editor.items[1] as Group;
    press(editor, { x: 150, y: 300 });
    editor.copySelection();
    press(editor, { x: 550, y: 100 });
    expect(editor.pasteIntoGroup()).toBe(1);
    const changed = editor.items[1] as Group;
    expect(editor.items[0]).toBe(start);
    expect(changed.items).toHaveLength(3);
    expect(changed.items.slice(0, 2)).toEqual(group.items);
    expect(editor.selectedPart?.path).toEqual([2]);
  });

  it("stays where it looks, inside a turned and scaled group", () => {
    const editor = new Editor(viewport);
    drawName(editor);
    const copyOf = line(editor, 700, 400);
    press(editor, { x: 750, y: 400 });
    const at = centerOnScreen(editor, copyOf);
    editor.copySelection();
    press(editor, inFirst);
    editor.turnSelection(90);
    editor.setCraneKeyHeld(true);
    editor.wheel(inFirst, -100);
    editor.setCraneKeyHeld(false);
    const outer = (editor.items[0] as Group).transform;
    expect(outer).toBeDefined();
    expect(editor.pasteIntoGroup()).toBe(1);
    const part = editor.selectedPart;
    if (part === null) throw new Error("a part expected");
    expect((editor.items[0] as Group).transform).toBe(outer);
    close(centerOnScreen(editor, part.placed), shifted(at, 1)); // the copied line is still there: moved away from it
  });

  it("selects the group when several objects are pasted", () => {
    const editor = new Editor(viewport);
    drawName(editor);
    const a = line(editor, 700, 400);
    const b = line(editor, 700, 500);
    press(editor, { x: 750, y: 400 });
    press(editor, { x: 750, y: 500 }, { shift: true });
    expect(editor.copySelection()?.items).toEqual([a, b]);
    alt(editor, inFirst);
    alt(editor, inFirst); // a stroke: the copies go into its syllable
    expect(editor.pasteIntoGroup()).toBe(2);
    expect(editor.selectedPart?.path).toEqual([0]);
    expect(((editor.items[0] as Group).items[0] as Group).items).toHaveLength(4);
    expect(isGroup(editor.items[0] as Item)).toBe(true);
    press(editor, inFirst);
    editor.selectAll();
    editor.cancel();
    press(editor, inFirst);
    editor.copySelection();
    expect(editor.pasteIntoGroup()).toBe(1); // into the whole name, which is selected
    expect((editor.items[0] as Group).items).toHaveLength(3);
  });

  it("selects the whole object when several objects are pasted right into it", () => {
    const editor = new Editor(viewport);
    drawName(editor);
    line(editor, 700, 400);
    line(editor, 700, 500);
    press(editor, { x: 750, y: 400 });
    press(editor, { x: 750, y: 500 }, { shift: true });
    editor.copySelection();
    alt(editor, inFirst); // a syllable: the copies go next to it, right in the name
    expect(editor.pasteIntoGroup()).toBe(2);
    expect(editor.selectedPart).toBeNull();
    expect(only(editor)).toBe(editor.items[0]);
    expect((editor.items[0] as Group).items).toHaveLength(4);
  });
});
