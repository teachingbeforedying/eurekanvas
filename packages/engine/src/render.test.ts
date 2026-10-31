import { describe, expect, it } from "vitest";
import { type Point, type Viewport, createCamera } from "./camera";
import { fromNumber } from "./dyadic";
import { DEFAULT_MAX_LEVEL_GAP, selectDrawableSections } from "./render";
import { type Stroke, StrokeRecorder, pointWorld, projectSection } from "./stroke";
import { at } from "./test-utils";

// With the default camera (level 0, centre at the world origin), world point (x, y) is at screen (640 + x, 360 + y).
const viewport: Viewport = { width: 1280, height: 720 };

function pt(x: number, y: number): Point {
  return { x: fromNumber(x), y: fromNumber(y) };
}

function stroke(points: readonly (readonly [number, number])[], zLevel = 0, width = 1): Stroke {
  const recorder = new StrokeRecorder();
  for (const [x, y] of points) recorder.addPoint(pt(x, y), zLevel, width);
  return recorder.stroke;
}

describe("selectDrawableSections", () => {
  const camera = createCamera();

  it("keeps a section on the screen, with its projection", () => {
    const visible = stroke([[0, 0], [50, 20]]);
    const drawable = selectDrawableSections([visible], camera, viewport);
    expect(drawable).toHaveLength(1);
    expect(at(drawable, 0).section).toBe(at(visible.sections, 0));
    expect(at(drawable, 0).projection).toEqual(projectSection(at(visible.sections, 0), camera, viewport));
  });

  it("leaves out a section that is entirely off the screen, and keeps one that is partly on it", () => {
    expect(selectDrawableSections([stroke([[5000, 5000], [5100, 5000]])], camera, viewport)).toEqual([]);
    expect(selectDrawableSections([stroke([[-2000, 0], [0, 0]])], camera, viewport)).toHaveLength(1);
  });

  it("counts the thickness of the stroke: a thick stroke just off the screen can reach into it", () => {
    // the screen ends at x = 640 in world units; this dot is centred 30 units beyond
    expect(selectDrawableSections([stroke([[670, 0]], 0, 100)], camera, viewport)).toHaveLength(1); // reaches 620
    expect(selectDrawableSections([stroke([[670, 0]], 0, 10)], camera, viewport)).toEqual([]); // reaches 665
  });

  it("leaves out sections that are too small to see, unless asked not to", () => {
    // at level 10 a world unit is 1024 local units: this section is 0.25 world unit long, and the camera
    // at level 0 shows a local unit as 2^-10 pixel, so it is a quarter of a pixel
    const tiny = stroke([[0, 0], [0.25, 0]], 10);
    expect(selectDrawableSections([tiny], camera, viewport)).toEqual([]);
    expect(selectDrawableSections([tiny], camera, viewport, { minPixels: 0 })).toHaveLength(1);
    const small = stroke([[0, 0], [1, 0]], 10); // one pixel
    expect(selectDrawableSections([small], camera, viewport)).toHaveLength(1);
  });

  it("stops drawing a section when the camera is too many levels deeper than it", () => {
    const section = at(stroke([[0, 0], [10, 0]]).sections, 0);
    const wide: Stroke = { sections: [section] };
    const centre = pointWorld(section, 0);
    const atGap = (gap: number) => createCamera({ center: centre, zLevel: gap });
    const anyReach = { maxReachPixels: Infinity }; // this test is about the level gap only
    expect(selectDrawableSections([wide], atGap(DEFAULT_MAX_LEVEL_GAP), viewport, anyReach)).toHaveLength(1);
    expect(selectDrawableSections([wide], atGap(DEFAULT_MAX_LEVEL_GAP + 1), viewport, anyReach)).toEqual([]);
    expect(selectDrawableSections([wide], atGap(DEFAULT_MAX_LEVEL_GAP + 1), viewport, { ...anyReach, maxLevelGap: 30 })).toHaveLength(1);
    expect(selectDrawableSections([wide], atGap(10), viewport, { ...anyReach, maxLevelGap: 5 })).toEqual([]);
  });

  it("leaves out a section that reaches too far from where it is placed for the canvas to draw it precisely", () => {
    // 1000 local units long: seen 14 levels deeper it reaches 1000 * 2^14 = 16 million pixels
    const long = stroke([[0, 0], [1000, 0]]);
    const centre = pointWorld(at(long.sections, 0), 1);
    const at14 = createCamera({ center: centre, zLevel: 14 });
    const at6 = createCamera({ center: centre, zLevel: 6 });
    expect(selectDrawableSections([long], at14, viewport)).toEqual([]);
    expect(selectDrawableSections([long], at6, viewport)).toHaveLength(1); // 64 thousand pixels
    expect(selectDrawableSections([long], at14, viewport, { maxReachPixels: 1e9 })).toHaveLength(1);
    // a short section can be seen from deeper: 10 local units at 18 levels is 2.6 million pixels
    const short = stroke([[0, 0], [10, 0]]);
    const shortCentre = pointWorld(at(short.sections, 0), 1);
    expect(selectDrawableSections([short], createCamera({ center: shortCentre, zLevel: 18 }), viewport)).toHaveLength(1);
  });

  it("finds what a turned view brings onto the screen", () => {
    const below = stroke([[0, 400], [0, 500]]); // below the screen in a straight view
    expect(selectDrawableSections([below], camera, viewport)).toEqual([]);
    const quarter = createCamera({ angle: 90 }); // the world's y axis points to the left: from x = 240 to 140
    expect(selectDrawableSections([below], quarter, viewport)).toHaveLength(1);
    // a box of 0.45 pixel: too small straight, but its turned box is 0.64 pixel wide
    const speck = stroke([[0, 0], [0.35, 0.35]], 0, 0.1);
    expect(selectDrawableSections([speck], camera, viewport)).toEqual([]);
    expect(selectDrawableSections([speck], createCamera({ angle: 45 }), viewport)).toHaveLength(1);
  });

  it("leaves out sections that cannot be placed, instead of failing", () => {
    const far = stroke([[0, 0], [10, 0]]);
    expect(selectDrawableSections([far], createCamera({ zLevel: 1100 }), viewport, { maxLevelGap: 5000 })).toEqual([]);
    expect(selectDrawableSections([far], createCamera({ zLevel: -1100 }), viewport)).toEqual([]);
  });

  it("keeps the drawing order across strokes and sections", () => {
    const first = stroke([[0, 0], [10, 0], [20, 0]]);
    const second = stroke([[0, 5], [10, 5]], 0);
    // a stroke that goes through two levels has two sections
    const recorder = new StrokeRecorder();
    recorder.addPoint(pt(0, 10), 0);
    recorder.addPoint(pt(10, 10), 0);
    recorder.addPoint(pt(20, 10), 1);
    const third = recorder.stroke;
    expect(third.sections).toHaveLength(2);

    const drawable = selectDrawableSections([first, second, third], camera, viewport);
    expect(drawable.map((d) => d.section)).toEqual([
      ...first.sections,
      ...second.sections,
      ...third.sections,
    ]);
  });

  it("gives the same answer when asked again, and handles an empty scene", () => {
    const strokes = [stroke([[0, 0], [30, 30]])];
    const once = selectDrawableSections(strokes, camera, viewport);
    expect(selectDrawableSections(strokes, camera, viewport)).toEqual(once);
    expect(selectDrawableSections([], camera, viewport)).toEqual([]);
    expect(selectDrawableSections([{ sections: [] }], camera, viewport)).toEqual([]);
  });
});
