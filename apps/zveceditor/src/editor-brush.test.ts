import { describe, expect, it } from "vitest";
import { type Item, type ScreenPoint, type Section, type Stroke, type Viewport, createCamera } from "@eurekanvas/engine";
import { DEFAULT_BRUSH_WIDTH, Editor, MAX_BRUSH_WIDTH, MIN_BRUSH_WIDTH, wheelZoomFactor } from "./editor";

const viewport: Viewport = { width: 1280, height: 720 };
const here: ScreenPoint = { x: 300, y: 300 };
const TOWARDS = 100; // a notch of the wheel pulled towards the user: as when zooming out, the brush grows
const AWAY = -100;

/** The thickness of each point of the object, in the units of its section (at level 0, factor 1: pixels). */
function widths(item: Item): number[] {
  return (item as Stroke).sections.flatMap((section: Section) => section.points.map((p) => p.width));
}

/** Draws a stroke through the given abscissas, during one hold of `²`, and returns it. */
function stroke(editor: Editor, xs: readonly number[]): Item {
  editor.setDrawKeyHeld(true);
  editor.pointerDown({ x: xs[0] as number, y: 300 }, "primary");
  for (const x of xs.slice(1)) editor.pointerMove({ x, y: 300 });
  editor.pointerUp();
  editor.setDrawKeyHeld(false);
  return editor.items[editor.items.length - 1] as Item;
}

describe("changing the thickness of the brush with B and the wheel", () => {
  it("changes it as a zoom would, thicker towards the user, with the drawing key held, and leaves the view alone", () => {
    const editor = new Editor(viewport);
    const camera = editor.camera;
    editor.setDrawKeyHeld(true);
    editor.setWidthKeyHeld(true);
    editor.wheel(here, TOWARDS);
    expect(editor.brushWidth).toBeCloseTo(DEFAULT_BRUSH_WIDTH / 0.8, 9);
    editor.wheel(here, AWAY);
    expect(editor.brushWidth).toBeCloseTo(DEFAULT_BRUSH_WIDTH / 0.8 / 1.2, 9);
    editor.wheel(here, 50); // the size of the movement counts, as for the zoom
    expect(editor.brushWidth).toBeCloseTo(DEFAULT_BRUSH_WIDTH / 0.8 / 1.2 / wheelZoomFactor(50), 9);
    expect(editor.camera).toBe(camera);
    const width = editor.brushWidth;
    editor.wheel(here, 0); // no notch: nothing
    expect(editor.brushWidth).toBe(width);
    editor.setWidthKeyHeld(false);
    editor.setDrawKeyHeld(false);
  });

  it("zooms without the drawing key, as usual", () => {
    const editor = new Editor(viewport);
    const camera = editor.camera;
    editor.setWidthKeyHeld(true);
    editor.wheel(here, TOWARDS);
    expect(editor.brushWidth).toBe(DEFAULT_BRUSH_WIDTH);
    expect(editor.camera).not.toBe(camera);
  });

  it("zooms without the width key", () => {
    const editor = new Editor(viewport);
    const camera = editor.camera;
    editor.setDrawKeyHeld(true);
    editor.wheel(here, TOWARDS);
    expect(editor.brushWidth).toBe(DEFAULT_BRUSH_WIDTH);
    expect(editor.camera).not.toBe(camera);
  });

  it("stays within its limits", () => {
    const editor = new Editor(viewport);
    editor.setDrawKeyHeld(true);
    editor.setWidthKeyHeld(true);
    for (let i = 0; i < 60; i++) editor.wheel(here, TOWARDS);
    expect(editor.brushWidth).toBe(128);
    expect(editor.brushWidth).toBe(MAX_BRUSH_WIDTH);
    for (let i = 0; i < 80; i++) editor.wheel(here, AWAY);
    expect(editor.brushWidth).toBe(MIN_BRUSH_WIDTH);
    editor.setBrushWidth(1e9);
    expect(editor.brushWidth).toBe(MAX_BRUSH_WIDTH);
    expect(() => editor.setBrushWidth(Number.NaN)).toThrow(RangeError);
  });

  it("draws the next strokes with it", () => {
    const editor = new Editor(viewport);
    editor.setBrushWidth(10);
    expect(widths(stroke(editor, [100, 150, 200]))).toEqual([10, 10, 10]);
  });

  it("keeps its thickness on the screen while zooming", () => {
    const editor = new Editor(viewport);
    editor.setBrushWidth(10);
    editor.restore({ items: [], view: createCamera({ factor: 1.25 }) });
    expect(widths(stroke(editor, [100, 150]))).toEqual([8, 8]); // 10 pixels, at 1.25 pixel per unit
  });
});

describe("changing the thickness during a stroke", () => {
  function expectWidths(item: Item, expected: readonly number[]): void {
    const actual = widths(item);
    expect(actual).toHaveLength(expected.length);
    expected.forEach((width, i) => expect(actual[i]).toBeCloseTo(width, 9));
  }

  it("glides to the new thickness over 30 pixels of stroke, and adds nothing by itself", () => {
    const editor = new Editor(viewport);
    editor.setDrawKeyHeld(true);
    editor.pointerDown({ x: 100, y: 300 }, "primary");
    editor.pointerMove({ x: 150, y: 300 });
    const points = editor.stats.points;
    editor.setWidthKeyHeld(true);
    editor.wheel({ x: 150, y: 300 }, TOWARDS); // from 3 to 3.75
    editor.setWidthKeyHeld(false);
    expect(editor.stats.points).toBe(points);
    for (const x of [160, 170, 190, 200]) editor.pointerMove({ x, y: 300 });
    editor.pointerUp();
    editor.setDrawKeyHeld(false);
    expectWidths(editor.items[0] as Item, [3, 3, 3.25, 3.5, 3.75, 3.75]);
    expect(editor.brushWidth).toBe(3 / 0.8); // it stays for the next strokes
  });

  it("glides over 30 pixels for a thin brush, and 3 times the brush beyond 10 pixels", () => {
    const glide = (width: number, moves: readonly number[]): number[] => {
      const editor = new Editor(viewport);
      editor.setBrushWidth(width);
      editor.setDrawKeyHeld(true);
      editor.setWidthKeyHeld(true);
      editor.pointerDown({ x: 100, y: 300 }, "primary");
      editor.pointerMove({ x: 110, y: 300 });
      editor.wheel({ x: 110, y: 300 }, TOWARDS);
      for (const x of moves) editor.pointerMove({ x, y: 300 });
      editor.pointerUp();
      editor.setWidthKeyHeld(false);
      editor.setDrawKeyHeld(false);
      return widths(editor.items[0] as Item);
    };
    const expectList = (actual: readonly number[], expected: readonly number[]): void => {
      expect(actual).toHaveLength(expected.length);
      expected.forEach((width, i) => expect(actual[i]).toBeCloseTo(width, 9));
    };
    expectList(glide(4, [125, 140]), [4, 4, 4.5, 5]); // towards 5: over 30 pixels, not 15
    expectList(glide(40, [140, 260]), [40, 40, 42, 50]); // towards 50: over 150 pixels
  });

  it("gives a zoom during a stroke the same distance for a thick brush", () => {
    const editor = new Editor(viewport);
    editor.setBrushWidth(40);
    editor.setDrawKeyHeld(true);
    editor.pointerDown({ x: 100, y: 300 }, "primary");
    editor.pointerMove({ x: 110, y: 300 });
    editor.wheel({ x: 110, y: 300 }, AWAY); // ×1.2: its end now looks 48 pixels thick, and it must go back to 40 over 120 pixels
    editor.pointerMove({ x: 170, y: 300 });
    editor.pointerMove({ x: 230, y: 300 });
    editor.pointerUp();
    editor.setDrawKeyHeld(false);
    const points = widths(editor.items[0] as Item);
    expect(points).toHaveLength(4);
    [40, 40, 44 / 1.2, 40 / 1.2].forEach((width, i) => expect(points[i]).toBeCloseTo(width, 9));
  });

  it("starts the 30 pixels again from where it is at each new notch", () => {
    const editor = new Editor(viewport);
    editor.setDrawKeyHeld(true);
    editor.setWidthKeyHeld(true);
    editor.pointerDown({ x: 100, y: 300 }, "primary");
    editor.pointerMove({ x: 150, y: 300 });
    editor.wheel({ x: 150, y: 300 }, TOWARDS); // towards 3.75
    editor.pointerMove({ x: 160, y: 300 }); // 3.25
    editor.wheel({ x: 160, y: 300 }, 0); // no notch: it does not start again
    editor.pointerMove({ x: 170, y: 300 }); // 3.5
    editor.wheel({ x: 170, y: 300 }, TOWARDS); // towards 4.6875
    editor.pointerMove({ x: 185, y: 300 }); // halfway from 3.5
    editor.pointerUp();
    editor.setWidthKeyHeld(false);
    editor.setDrawKeyHeld(false);
    expectWidths(editor.items[0] as Item, [3, 3, 3.25, 3.5, 4.09375]);
  });

  it("counts the pixels of the stroke, not those of the pointer: a rope holds the brush back", () => {
    const editor = new Editor(viewport);
    editor.setPen({ kind: "fixed", length: 16, lag: 50 });
    editor.setDrawKeyHeld(true);
    editor.setWidthKeyHeld(true);
    editor.pointerDown({ x: 100, y: 300 }, "primary");
    editor.pointerMove({ x: 200, y: 300 }); // the brush is pulled to 184
    editor.wheel({ x: 200, y: 300 }, TOWARDS);
    editor.pointerMove({ x: 210, y: 300 }); // the brush goes to 194: 10 pixels, whatever the pointer did before
    editor.pointerUp();
    editor.setWidthKeyHeld(false);
    editor.setDrawKeyHeld(false);
    expectWidths(editor.items[0] as Item, [3, 3, 3.25]);
  });

  it("gives the same thickness on the drawing as the same notch of zoom", () => {
    const moves = [10, 25, 40, 90];
    const end = (notch: (editor: Editor, p: ScreenPoint) => void): number[] => {
      const editor = new Editor(viewport);
      editor.setDrawKeyHeld(true);
      editor.pointerDown({ x: 100, y: 300 }, "primary");
      editor.pointerMove({ x: 150, y: 300 });
      notch(editor, { x: 150, y: 300 });
      for (const m of moves) editor.pointerMove({ x: 150 + m, y: 300 });
      editor.pointerUp();
      editor.setWidthKeyHeld(false);
      editor.setDrawKeyHeld(false);
      return widths(editor.items[0] as Item);
    };
    const zoomed = end((editor, p) => editor.wheel(p, AWAY)); // the view zooms in by 1.2
    const brushed = end((editor, p) => {
      editor.setWidthKeyHeld(true);
      editor.wheel(p, AWAY); // the brush is divided by 1.2
    });
    expect(zoomed).toHaveLength(brushed.length);
    brushed.forEach((width, i) => expect(zoomed[i]).toBeCloseTo(width, 9));
  });

  it("is exactly the brush once the glide is over", () => {
    const editor = new Editor(viewport);
    editor.setDrawKeyHeld(true);
    editor.setWidthKeyHeld(true);
    editor.pointerDown({ x: 100, y: 300 }, "primary");
    editor.wheel({ x: 100, y: 300 }, AWAY);
    for (const x of [110, 120, 130, 140, 150]) editor.pointerMove({ x, y: 300 });
    editor.pointerUp();
    editor.setWidthKeyHeld(false);
    editor.setDrawKeyHeld(false);
    expect(widths(editor.items[0] as Item).at(-1)).toBe(editor.brushWidth);
  });

  it("starts each stroke at the brush, without any glide left over", () => {
    const editor = new Editor(viewport);
    editor.setDrawKeyHeld(true);
    editor.pointerDown({ x: 100, y: 300 }, "primary");
    editor.pointerMove({ x: 110, y: 300 });
    editor.wheel({ x: 110, y: 300 }, AWAY); // a glide begins, and the stroke ends in the middle of it
    editor.pointerUp();
    editor.setDrawKeyHeld(false);
    expect(widths(stroke(editor, [100, 150]))).toEqual([2.5, 2.5]); // 3 pixels, at 1.2 pixel per unit
  });

  it("works when the drawing key was released during the stroke", () => {
    const editor = new Editor(viewport);
    editor.setDrawKeyHeld(true);
    editor.pointerDown({ x: 100, y: 300 }, "primary");
    editor.setDrawKeyHeld(false);
    editor.setWidthKeyHeld(true);
    const camera = editor.camera;
    editor.wheel({ x: 100, y: 300 }, TOWARDS);
    expect(editor.brushWidth).toBe(3.75);
    expect(editor.camera).toBe(camera);
    editor.pointerUp();
  });
});

describe("the elastic brush, after a tap on 1", () => {
  function tap(editor: Editor): void {
    editor.setCraneKeyHeld(true);
    editor.setCraneKeyHeld(false);
  }

  it("makes the wheel change the brush during the stroke, without B, and comes back at the release", () => {
    const editor = new Editor(viewport);
    editor.setBrushWidth(8);
    const camera = editor.camera;
    editor.setDrawKeyHeld(true);
    editor.pointerDown({ x: 100, y: 300 }, "primary");
    editor.pointerMove({ x: 150, y: 300 });
    tap(editor);
    editor.wheel({ x: 150, y: 300 }, TOWARDS);
    expect(editor.brushWidth).toBe(10);
    expect(editor.settledBrushWidth).toBe(8);
    expect(editor.camera).toBe(camera);
    editor.pointerMove({ x: 200, y: 300 });
    editor.pointerUp();
    editor.setDrawKeyHeld(false);
    expect(widths(editor.items[0] as Item)).toEqual([8, 8, 10]);
    expect(editor.brushWidth).toBe(8);
    expect(editor.settledBrushWidth).toBe(8);
    editor.wheel(here, TOWARDS); // the wheel zooms again
    expect(editor.camera).not.toBe(camera);
  });

  it("also starts with the drawing key held, before the stroke, and keeps the first width to come back to", () => {
    const editor = new Editor(viewport);
    editor.setDrawKeyHeld(true);
    tap(editor);
    editor.wheel(here, TOWARDS);
    tap(editor); // a second tap does not forget where to come back to
    editor.wheel(here, TOWARDS);
    editor.pointerDown({ x: 100, y: 300 }, "primary");
    editor.pointerUp();
    expect(editor.brushWidth).toBe(DEFAULT_BRUSH_WIDTH);
    editor.setDrawKeyHeld(false);
  });

  it("ends when the drawing key is released without a stroke", () => {
    const editor = new Editor(viewport);
    editor.setDrawKeyHeld(true);
    tap(editor);
    editor.wheel(here, TOWARDS);
    editor.setDrawKeyHeld(false);
    expect(editor.brushWidth).toBe(DEFAULT_BRUSH_WIDTH);
    const camera = editor.camera;
    editor.setDrawKeyHeld(true);
    editor.wheel(here, TOWARDS); // no tap this time
    expect(editor.camera).not.toBe(camera);
  });

  it("does not start out of drawing mode", () => {
    const editor = new Editor(viewport);
    tap(editor);
    const camera = editor.camera;
    editor.setDrawKeyHeld(true);
    editor.wheel(here, TOWARDS);
    expect(editor.brushWidth).toBe(DEFAULT_BRUSH_WIDTH);
    expect(editor.camera).not.toBe(camera);
  });

  it("needs the key to have been pressed: losing the focus during a stroke is not a tap", () => {
    const editor = new Editor(viewport);
    const camera = editor.camera;
    editor.setDrawKeyHeld(true);
    editor.pointerDown({ x: 100, y: 300 }, "primary");
    editor.setCraneKeyHeld(false); // what the page does when it loses the focus
    editor.wheel({ x: 100, y: 300 }, TOWARDS);
    expect(editor.brushWidth).toBe(DEFAULT_BRUSH_WIDTH);
    expect(editor.camera).not.toBe(camera);
    editor.pointerUp();
  });

  it("is not the scale of the selection: in drawing mode, 1 held leaves the selection alone", () => {
    const editor = new Editor(viewport);
    const item = stroke(editor, [100, 150, 200]);
    editor.selectAll();
    editor.setDrawKeyHeld(true);
    editor.setCraneKeyHeld(true);
    const camera = editor.camera;
    editor.wheel(here, TOWARDS); // 1 is held, not tapped yet: the wheel zooms
    expect(editor.camera).not.toBe(camera);
    expect(editor.items).toEqual([item]);
    editor.setCraneKeyHeld(false);
    editor.setDrawKeyHeld(false);
  });
});

describe("the outline of the brush", () => {
  it("is around the pointer, as wide as the brush, while the drawing key or the width key is held", () => {
    const editor = new Editor(viewport);
    editor.setBrushWidth(20);
    editor.pointerMove(here);
    expect(editor.brushOutline).toBeNull();
    expect(editor.scene.brushOutline).toBeNull();
    editor.setDrawKeyHeld(true);
    expect(editor.scene.brushOutline).toEqual({ center: here, radius: 10 });
    editor.setDrawKeyHeld(false);
    expect(editor.brushOutline).toBeNull();
    editor.setWidthKeyHeld(true);
    expect(editor.brushOutline).toEqual({ center: here, radius: 10 });
    editor.pointerMove({ x: 400, y: 200 });
    expect(editor.brushOutline?.center).toEqual({ x: 400, y: 200 });
  });

  it("is not shown during a stroke, or with the pointer away", () => {
    const editor = new Editor(viewport);
    editor.setDrawKeyHeld(true);
    expect(editor.brushOutline).toBeNull(); // the pointer has not come yet
    editor.pointerMove(here);
    expect(editor.brushOutline).not.toBeNull();
    editor.pointerDown(here, "primary");
    expect(editor.brushOutline).toBeNull();
    editor.pointerUp();
    expect(editor.brushOutline).not.toBeNull();
    editor.pointerLeft();
    expect(editor.brushOutline).toBeNull();
  });
});
