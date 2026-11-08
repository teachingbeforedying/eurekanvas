import { describe, expect, it } from "vitest";
import {
  type Group,
  type Item,
  type Point,
  type ScreenPoint,
  type Viewport,
  applyTransform,
  isGroup,
  itemFrame,
  rectangleCenter,
  rectangleOnScreen,
  screenToWorld,
  worldToScreen,
} from "@eurekanvas/engine";
import { Editor, type Modifiers } from "./editor";

const viewport: Viewport = { width: 1280, height: 720 };

/** Draws two strokes during one hold of `²`: a group, at (x, 100) and (x, 130), 100 pixels long. */
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

/** A name: a group of two syllables, the first one at x = 100, the second one at x = 300. */
function drawName(editor: Editor): Group {
  syllable(editor, 100);
  syllable(editor, 300);
  editor.selectAll();
  editor.groupSelection();
  editor.cancel();
  return editor.items[0] as Group;
}

const firstStroke: ScreenPoint = { x: 150, y: 100 }; // the top stroke of the first syllable
const otherStroke: ScreenPoint = { x: 150, y: 130 }; // its bottom stroke
const inSecond: ScreenPoint = { x: 350, y: 100 };

function press(editor: Editor, p: ScreenPoint, modifiers: Modifiers = {}): void {
  editor.pointerDown(p, "primary", 0, modifiers);
  editor.pointerUp();
}

function alt(editor: Editor, p: ScreenPoint): void {
  press(editor, p, { alt: true });
}

function up(editor: Editor, p: ScreenPoint): void {
  press(editor, p, { alt: true, shift: true });
}

function drag(editor: Editor, from: ScreenPoint, to: ScreenPoint, modifiers: Modifiers = {}): void {
  editor.pointerDown(from, "primary", 0, modifiers);
  editor.pointerMove(to);
  editor.pointerUp();
}

/** Where the center of a placed object is on the screen. */
function centerOnScreen(editor: Editor, placed: Item): ScreenPoint {
  const frame = itemFrame(placed);
  if (frame === null) throw new Error("a frame expected");
  return worldToScreen(editor.camera, viewport, rectangleCenter(frame));
}

function partCenter(editor: Editor): ScreenPoint {
  const part = editor.selectedPart;
  if (part === null) throw new Error("a part expected");
  return centerOnScreen(editor, part.placed);
}

function partWidth(editor: Editor): number {
  const part = editor.selectedPart;
  const frame = part === null ? null : itemFrame(part.placed);
  if (frame === null || frame === undefined) throw new Error("a frame expected");
  return rectangleOnScreen(editor.camera, viewport, frame).width;
}

function close(a: ScreenPoint, b: ScreenPoint): void {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
}

describe("going down into a group with Alt", () => {
  it("takes the first level inside at the first click, then one level per click, and stays at the bottom", () => {
    const editor = new Editor(viewport);
    const root = drawName(editor);
    alt(editor, firstStroke);
    expect(editor.selectedPart?.path).toEqual([0]);
    expect(editor.depth).toEqual({ level: 2, levels: 3 });
    expect(editor.selection.size).toBe(1);
    expect([...editor.selection][0]).toBe(root);
    alt(editor, firstStroke);
    expect(editor.selectedPart?.path).toEqual([0, 0]);
    expect(editor.depth).toEqual({ level: 3, levels: 3 });
    alt(editor, firstStroke);
    expect(editor.selectedPart?.path).toEqual([0, 0]);
  });

  it("follows the stroke under the pointer", () => {
    const editor = new Editor(viewport);
    drawName(editor);
    alt(editor, otherStroke);
    alt(editor, otherStroke);
    expect(editor.selectedPart?.path).toEqual([0, 1]);
    alt(editor, inSecond); // somewhere else: from the first level inside again
    expect(editor.selectedPart?.path).toEqual([1]);
  });

  it("starts again from the first level on another branch of the same syllable", () => {
    const editor = new Editor(viewport);
    drawName(editor);
    alt(editor, firstStroke);
    alt(editor, firstStroke); // [0, 0]
    alt(editor, otherStroke); // [0, 1] is not under [0, 0]: back to the first level inside
    expect(editor.selectedPart?.path).toEqual([0]);
  });

  it("goes one level up with Shift + Alt, up to the whole object", () => {
    const editor = new Editor(viewport);
    const root = drawName(editor);
    alt(editor, firstStroke);
    alt(editor, firstStroke);
    up(editor, firstStroke);
    expect(editor.selectedPart?.path).toEqual([0]);
    up(editor, firstStroke);
    expect(editor.selectedPart).toBeNull();
    expect([...editor.selection][0]).toBe(root);
    expect(editor.depth).toEqual({ level: 1, levels: 3 });
    up(editor, firstStroke);
    expect(editor.selectedPart).toBeNull();
    expect(editor.selection.size).toBe(1);
  });

  it("does what a click does on a stroke alone, and says nothing about levels away from the ink", () => {
    const editor = new Editor(viewport);
    editor.setDrawKeyHeld(true);
    editor.pointerDown({ x: 100, y: 100 }, "primary");
    editor.pointerMove({ x: 200, y: 100 });
    editor.pointerUp();
    editor.setDrawKeyHeld(false);
    alt(editor, { x: 150, y: 100 });
    expect(editor.selectedPart).toBeNull();
    expect(editor.selection.size).toBe(1);
    expect(editor.depth).toEqual({ level: 1, levels: 1 });
    const named = new Editor(viewport);
    drawName(named);
    alt(named, firstStroke);
    alt(named, { x: 900, y: 600 });
    expect(named.depth.levels).toBe(1);
    expect(named.selection.size).toBe(0); // a click on empty space
  });

  it("shows the part in blue with its frame, and the frames of its groups", () => {
    const editor = new Editor(viewport);
    const root = drawName(editor);
    expect(editor.scene.parentFrames).toEqual([]);
    alt(editor, firstStroke);
    expect(editor.scene.selectedSections?.size).toBe(2);
    expect(editor.scene.parentFrames).toEqual([itemFrame(root)]);
    expect(editor.scene.selectionFrame).toEqual(itemFrame(root.items[0] as Item));
    alt(editor, firstStroke);
    expect(editor.scene.selectedSections?.size).toBe(1);
    expect(editor.scene.parentFrames).toEqual([itemFrame(root), itemFrame(root.items[0] as Item)]);
    editor.cancel();
    expect(editor.scene.parentFrames).toEqual([]);
    expect(editor.selectedPart).toBeNull();
    expect(editor.selection.size).toBe(0);
  });
});

describe("the object below, now with Ctrl", () => {
  it("is not a level inside a group", () => {
    const editor = new Editor(viewport);
    drawName(editor);
    press(editor, firstStroke, { ctrl: true });
    expect(editor.selectedPart).toBeNull();
    expect(editor.selection.size).toBe(1);
  });

  it("leaves a part for the whole object", () => {
    const editor = new Editor(viewport);
    drawName(editor);
    alt(editor, firstStroke);
    press(editor, firstStroke, { ctrl: true });
    expect(editor.selectedPart).toBeNull();
    alt(editor, firstStroke);
    press(editor, firstStroke, { shift: true });
    expect(editor.selectedPart).toBeNull();
  });
});

describe("moving a part", () => {
  it("moves the syllable alone with Alt and a drag, and the group stays whole, as one action", () => {
    const editor = new Editor(viewport);
    const root = drawName(editor);
    const second = root.items[1];
    alt(editor, firstStroke);
    const center = partCenter(editor);
    editor.cancel();
    drag(editor, firstStroke, { x: 150, y: 160 }, { alt: true });
    const changed = editor.items[0] as Group;
    expect(editor.items).toHaveLength(1);
    expect(isGroup(changed)).toBe(true);
    expect(changed.items).toHaveLength(2);
    expect(changed.items[1]).toBe(second);
    expect(editor.selectedPart?.path).toEqual([0]);
    close(partCenter(editor), { x: center.x, y: center.y + 60 });
    expect(editor.pointsAtObject({ x: 150, y: 160 })).toBe(true);
    expect(editor.pointsAtObject(firstStroke)).toBe(false);
    expect(editor.pointsAtObject(inSecond)).toBe(true);
    editor.undo();
    expect(editor.items).toEqual([root]);
    expect(editor.selectedPart).toBeNull(); // the object it belonged to is gone
  });

  it("moves the part when pressed on it again, and the whole object when pressed elsewhere", () => {
    const editor = new Editor(viewport);
    const root = drawName(editor);
    alt(editor, firstStroke);
    const center = partCenter(editor);
    drag(editor, firstStroke, { x: 170, y: 100 });
    expect(editor.selectedPart?.path).toEqual([0]);
    close(partCenter(editor), { x: center.x + 20, y: center.y });
    const before = (editor.items[0] as Group).items[1];
    expect(before).toBe(root.items[1]);
    drag(editor, inSecond, { x: 350, y: 140 });
    expect(editor.selectedPart).toBeNull();
    expect(editor.pointsAtObject({ x: 350, y: 140 })).toBe(true); // the second syllable moved with the whole
    expect(editor.pointsAtObject({ x: 170, y: 140 })).toBe(true); // and the first one too
  });

  it("keeps the part selected after a click on it, and takes the whole object after a click elsewhere in it", () => {
    const editor = new Editor(viewport);
    const root = drawName(editor);
    alt(editor, firstStroke);
    press(editor, firstStroke);
    expect(editor.selectedPart?.path).toEqual([0]);
    press(editor, inSecond);
    expect(editor.selectedPart).toBeNull();
    expect([...editor.selection][0]).toBe(root);
  });

  it("takes another object pressed on, even at the same path inside it", () => {
    const editor = new Editor(viewport);
    syllable(editor, 100);
    syllable(editor, 500);
    const other = editor.items[1] as Item;
    alt(editor, firstStroke); // the first syllable has two strokes: the part is its stroke at path [0]
    expect(editor.selectedPart?.path).toEqual([0]);
    press(editor, { x: 550, y: 100 }); // [0] in the other object too
    expect(editor.selectedPart).toBeNull();
    expect([...editor.selection][0]).toBe(other);
  });

  it("deselects with a click on empty space", () => {
    const editor = new Editor(viewport);
    drawName(editor);
    alt(editor, firstStroke);
    press(editor, { x: 900, y: 600 });
    expect(editor.selectedPart).toBeNull();
    expect(editor.selection.size).toBe(0);
  });

  it("follows the screen inside a turned, mirrored and scaled group, the rest staying where it is", () => {
    const editor = new Editor(viewport);
    drawName(editor);
    const worldPoint = screenToWorld(editor.camera, viewport, firstStroke);
    editor.selectAll();
    editor.turnSelection(90);
    editor.mirrorSelection("leftRight");
    editor.setCraneKeyHeld(true);
    editor.wheel(firstStroke, -100);
    editor.setCraneKeyHeld(false);
    editor.cancel();
    const placedRoot = editor.items[0] as Group;
    const transform = placedRoot.transform;
    if (transform === undefined) throw new Error("a transform expected");
    const seen = worldToScreen(editor.camera, viewport, applyTransform(transform, worldPoint));
    alt(editor, seen);
    expect(editor.selectedPart?.path).toEqual([0]);
    const center = partCenter(editor);
    const parentCenter = centerOnScreen(editor, placedRoot.items[1] as Item);
    drag(editor, seen, { x: seen.x + 30, y: seen.y + 40 });
    close(partCenter(editor), { x: center.x + 30, y: center.y + 40 });
    const after = editor.items[0] as Group;
    expect(after.transform).toBe(transform);
    expect(after.items[1]).toBe(placedRoot.items[1]);
    expect(parentCenter).toEqual(centerOnScreen(editor, after.items[1] as Item));
  });

  it("puts everything back with Escape, the part staying selected", () => {
    const editor = new Editor(viewport);
    const root = drawName(editor);
    alt(editor, firstStroke);
    const part = editor.selectedPart;
    const camera = editor.camera;
    editor.pointerDown(firstStroke, "primary");
    editor.pointerMove({ x: 170, y: 170 });
    editor.wheel({ x: 170, y: 170 }, -100);
    editor.cancel();
    editor.pointerUp();
    expect(editor.items).toEqual([root]);
    expect(editor.selectedPart).toBe(part);
    expect(editor.camera).toBe(camera);
    expect(editor.scene.parentFrames).toHaveLength(1);
  });
});

describe("changing a part in place", () => {
  it("applies the arrows to it, as one run", () => {
    const editor = new Editor(viewport);
    const root = drawName(editor);
    alt(editor, firstStroke);
    const center = partCenter(editor);
    expect(editor.moveSelection(10, 0)).toBe(1);
    editor.moveSelection(0, 5);
    close(partCenter(editor), { x: center.x + 10, y: center.y + 5 });
    expect((editor.items[0] as Group).items[1]).toBe(root.items[1]);
    editor.undo();
    expect(editor.items).toEqual([root]);
  });

  it("turns and mirrors it around its own frame, and leaves the rest", () => {
    const editor = new Editor(viewport);
    const root = drawName(editor);
    alt(editor, firstStroke);
    const center = partCenter(editor);
    expect(editor.turnSelection(90)).toBe(1);
    expect(editor.selectedPart?.placed.transform?.angle).toBe(90);
    close(partCenter(editor), center);
    expect(editor.mirrorSelection("leftRight")).toBe(1);
    expect(editor.selectedPart?.placed.transform?.mirror).toBe(true);
    close(partCenter(editor), center);
    expect((editor.items[0] as Group).items[1]).toBe(root.items[1]);
    expect(editor.alignSelection()).toBe(1);
    expect(editor.uprightSelection()).toBe(1);
    expect(editor.selectedPart?.placed.transform?.mirror).toBe(false);
  });

  it("turns it with R and the primary button, and Escape puts it back selected", () => {
    const editor = new Editor(viewport);
    const root = drawName(editor);
    alt(editor, firstStroke);
    const center = partCenter(editor);
    const part = editor.selectedPart;
    const at = (degrees: number): ScreenPoint => ({
      x: center.x + 150 * Math.cos((degrees * Math.PI) / 180),
      y: center.y + 150 * Math.sin((degrees * Math.PI) / 180),
    });
    editor.setTurnKeyHeld(true);
    editor.pointerDown(at(0), "primary");
    for (let a = 1; a <= 30; a++) editor.pointerMove(at(a));
    expect(editor.selectedPart?.placed.transform?.angle).toBeCloseTo(30, 9);
    expect((editor.items[0] as Group).items[1]).toBe(root.items[1]);
    editor.cancel();
    editor.pointerUp();
    editor.setTurnKeyHeld(false);
    expect(editor.items).toEqual([root]);
    expect(editor.selectedPart).toBe(part);
  });

  it("changes its scale with 1 and the wheel, around its own center", () => {
    const editor = new Editor(viewport);
    const root = drawName(editor);
    alt(editor, firstStroke);
    const center = partCenter(editor);
    const width = partWidth(editor);
    const camera = editor.camera;
    editor.setCraneKeyHeld(true);
    editor.wheel(firstStroke, -100, { shift: true });
    editor.setCraneKeyHeld(false);
    expect(editor.camera).toBe(camera);
    expect(partWidth(editor)).toBeCloseTo(2 * width, 6);
    close(partCenter(editor), center);
    expect((editor.items[0] as Group).items[1]).toBe(root.items[1]);
  });

  it("carries it in depth with the wheel, the rest staying in the drawing", () => {
    const editor = new Editor(viewport);
    drawName(editor);
    alt(editor, firstStroke);
    const center = partCenter(editor);
    const width = partWidth(editor);
    editor.pointerDown(firstStroke, "primary");
    for (let i = 0; i < 10; i++) editor.wheel(firstStroke, -100);
    close(partCenter(editor), center);
    expect(partWidth(editor)).toBeCloseTo(width, 6);
    editor.pointerUp();
    expect(editor.selectedPart?.path).toEqual([0]);
  });

  it("deletes a stroke, then the group left empty, and the object when nothing is left", () => {
    const editor = new Editor(viewport);
    const root = drawName(editor);
    alt(editor, firstStroke);
    alt(editor, firstStroke);
    expect(editor.deleteSelection()).toBe(1);
    expect(editor.selection.size).toBe(0);
    expect(editor.selectedPart).toBeNull();
    let current = editor.items[0] as Group;
    expect((current.items[0] as Group).items).toHaveLength(1);
    expect(current.items[1]).toBe(root.items[1]);
    alt(editor, otherStroke);
    alt(editor, otherStroke); // the last stroke of the first syllable
    editor.deleteSelection();
    current = editor.items[0] as Group;
    expect(current.items).toEqual([root.items[1]]);
    alt(editor, inSecond);
    editor.deleteSelection(); // the second syllable: nothing is left of the name
    expect(editor.items).toEqual([]);
    editor.undo();
    editor.undo();
    editor.undo();
    expect(editor.items).toEqual([root]);
  });

  it("does not ungroup or group from a part", () => {
    const editor = new Editor(viewport);
    const root = drawName(editor);
    alt(editor, firstStroke);
    expect(editor.ungroupSelection()).toBe(0);
    expect(editor.groupSelection()).toBe(0);
    expect(editor.items).toEqual([root]);
    expect(editor.selectedPart?.path).toEqual([0]);
  });

  it("leaves the part when everything is selected", () => {
    const editor = new Editor(viewport);
    drawName(editor);
    alt(editor, firstStroke);
    editor.selectAll();
    expect(editor.selectedPart).toBeNull();
  });
});

describe("a part and a point of the world", () => {
  it("stays exact when moved without any transform around it", () => {
    const editor = new Editor(viewport);
    drawName(editor);
    alt(editor, firstStroke);
    const frame = itemFrame((editor.selectedPart as NonNullable<typeof editor.selectedPart>).placed);
    if (frame === null) throw new Error("a frame expected");
    const before: Point = rectangleCenter(frame);
    drag(editor, firstStroke, { x: 180, y: 140 });
    const after = itemFrame((editor.selectedPart as NonNullable<typeof editor.selectedPart>).placed);
    if (after === null) throw new Error("a frame expected");
    const center = rectangleCenter(after);
    const moved = worldToScreen(editor.camera, viewport, center);
    const was = worldToScreen(editor.camera, viewport, before);
    expect(moved).toEqual({ x: was.x + 30, y: was.y + 40 });
  });
});
