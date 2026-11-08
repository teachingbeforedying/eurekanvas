import { describe, expect, it } from "vitest";
import { type Point, type Viewport, createCamera } from "./camera";
import { type Group, type Item, isGroup, withTransform } from "./drawing";
import { equals, fromNumber, sub, toNumber } from "./dyadic";
import { placeSection, placedAlone, placedSections, samePlace } from "./placement";
import { insertedIn, partOf, pathAt, replacedPart } from "./part";
import { type Stroke, StrokeRecorder } from "./stroke";
import { applyTransform, composeTransforms, createTransform, inverseTransform, movedBy } from "./transform";
import { createRandom } from "./test-utils";

// With the default camera, world point (x, y) is at screen (640 + x, 360 + y).
const viewport: Viewport = { width: 1280, height: 720 };
const camera = createCamera();

function pt(x: number, y: number): Point {
  return { x: fromNumber(x), y: fromNumber(y) };
}

function same(a: Point, b: Point): boolean {
  return equals(a.x, b.x) && equals(a.y, b.y);
}

function line(x: number, y: number, length = 10): Stroke {
  const recorder = new StrokeRecorder();
  recorder.addPoint(pt(x, y), 0, 2);
  recorder.addPoint(pt(x + length, y), 0, 2);
  return recorder.stroke;
}

function gap(a: Point, b: Point): number {
  return Math.hypot(toNumber(sub(a.x, b.x)), toNumber(sub(a.y, b.y)));
}

// a name: two syllables of two strokes each
const [a0, a1, b0, b1] = [line(0, 0), line(0, 20), line(100, 0), line(100, 20)] as const;
const syllableA: Group = { items: [a0, a1] };
const syllableB: Group = { items: [b0, b1] };
const name: Group = { items: [syllableA, syllableB] };

describe("inverseTransform", () => {
  it("undoes a transform, whatever its angle, scale and mirror", () => {
    const random = createRandom(41);
    for (let i = 0; i < 200; i++) {
      const t = createTransform({
        origin: pt(random.next() * 100, random.next() * 100),
        position: pt(random.next() * 100, random.next() * 100),
        zLevel: random.int(8) - 4,
        factor: 1 + random.next(),
        angle: random.next() * 360,
        mirror: random.next() < 0.5,
      });
      const p = pt(random.next() * 100, random.next() * 100);
      expect(gap(applyTransform(inverseTransform(t), applyTransform(t, p)), p)).toBeLessThan(1e-9);
      expect(gap(applyTransform(t, applyTransform(inverseTransform(t), p)), p)).toBeLessThan(1e-9);
    }
  });

  it("is exact for quarter turns and powers of two", () => {
    const t = createTransform({ origin: pt(1, 2), position: pt(30, 40), zLevel: 3, angle: 90, mirror: true });
    const p = pt(7, -5);
    expect(same(applyTransform(inverseTransform(t), applyTransform(t, p)), p)).toBe(true);
    expect(inverseTransform(t)).toMatchObject({ zLevel: -3, factor: 1, angle: 90, mirror: true });
    expect(inverseTransform(createTransform({ angle: 90 })).angle).toBe(270);
  });
});

describe("partOf", () => {
  it("names a part by its path, and knows its sections in the whole object", () => {
    const part = partOf(name, [1, 0]);
    expect(part.root).toBe(name);
    expect(part.path).toEqual([1, 0]);
    expect((part.placed as Stroke).sections).toEqual(b0.sections);
    expect(part.outer).toBeUndefined();
    expect(part.parents.map((parent) => (parent as Group).items)).toEqual([name.items, syllableB.items]);
    expect([part.start, part.end]).toEqual([2, 3]);
    expect([partOf(name, [1]).start, partOf(name, [1]).end]).toEqual([2, 4]);
    expect([partOf(name, [0, 1]).start, partOf(name, [0, 1]).end]).toEqual([1, 2]);
    expect(placedSections(name).slice(2, 3)[0]?.section).toBe(b0.sections[0]);
  });

  it("places it through the transforms of its groups", () => {
    const outer = createTransform({ origin: pt(0, 0), position: pt(5, 0), angle: 90 });
    const inner = createTransform({ origin: pt(0, 0), position: pt(0, 7) });
    const own = createTransform({ origin: pt(0, 0), position: pt(1, 0) });
    const root: Item = withTransform({ items: [withTransform({ items: [withTransform(a0, own)] }, inner)] }, outer);
    const part = partOf(root, [0, 0]);
    expect(part.outer).toEqual(composeTransforms(outer, inner));
    expect(part.placed.transform).toEqual(composeTransforms(composeTransforms(outer, inner), own));
    expect(part.parents[0]?.transform).toEqual(outer);
    expect(part.parents[1]?.transform).toEqual(composeTransforms(outer, inner));
  });

  it("refuses a path that does not lead to a part", () => {
    expect(() => partOf(name, [])).toThrow(RangeError);
    expect(() => partOf(name, [0, 0, 0])).toThrow(RangeError);
    expect(() => partOf(name, [5])).toThrow(RangeError);
  });
});

describe("replacedPart", () => {
  it("changes the part, and nothing else in the object", () => {
    const part = partOf(name, [0]);
    const moved = withTransform(part.placed, createTransform({ origin: pt(0, 0), position: pt(3, 4) }));
    const root = replacedPart(part, moved) as Group;
    expect(root.items[1]).toBe(syllableB);
    expect(root.items[0]?.transform).toEqual(moved.transform);
    expect(isGroup(root.items[0] as Item)).toBe(true);
  });

  it("puts the part back through the inverse of its groups, so that it lands where it was given", () => {
    const outer = createTransform({ origin: pt(50, 0), position: pt(500, 300), angle: 37, zLevel: 1, factor: 1.25, mirror: true });
    const root: Item = withTransform(name, outer);
    const part = partOf(root, [0, 1]);
    const given = movedBy(part.placed.transform as ReturnType<typeof createTransform>, pt(11, 13));
    const changed = replacedPart(part, withTransform(part.placed, given)) as Group;
    expect(changed.transform).toBe(outer);
    expect(changed.items[1]).toBe(syllableB);
    const again = partOf(changed, [0, 1]).placed.transform;
    if (again === undefined) throw new Error("a transform expected");
    expect(gap(again.position, given.position)).toBeLessThan(1e-9);
    expect(again.angle).toBeCloseTo(given.angle, 9);
    expect(again.mirror).toBe(given.mirror);
    expect(again.zLevel + Math.log2(again.factor)).toBeCloseTo(given.zLevel + Math.log2(given.factor), 9);
  });

  it("removes the part, and the groups left empty", () => {
    const fewer = replacedPart(partOf(name, [0, 1]), null) as Group;
    expect((fewer.items[0] as Group).items).toEqual([a0]);
    expect(fewer.items[1]).toBe(syllableB);
    const gone = replacedPart(partOf(fewer, [0, 0]), null) as Group; // syllable A has nothing left
    expect(gone.items).toEqual([syllableB]);
    const only: Group = { items: [{ items: [a0] }] };
    expect(replacedPart(partOf(only, [0, 0]), null)).toBeNull();
  });

  it("keeps the groups' transforms when removing", () => {
    const outer = createTransform({ origin: pt(0, 0), position: pt(5, 5) });
    const root: Item = withTransform(name, outer);
    expect((replacedPart(partOf(root, [0]), null) as Group).transform).toBe(outer);
  });
});

describe("insertedIn", () => {
  it("adds objects at an index of a group, nested or not, and leaves the rest alone", () => {
    const extra = line(500, 500);
    const nested = insertedIn(name, [0], 1, [extra]) as Group;
    expect((nested.items[0] as Group).items).toEqual([a0, extra, a1]);
    expect(nested.items[1]).toBe(syllableB);
    const top = insertedIn(name, [], 2, [extra, extra]) as Group;
    expect(top.items).toEqual([syllableA, syllableB, extra, extra]);
  });

  it("keeps what is added where it is in the world, inside transformed groups", () => {
    const outer = createTransform({ origin: pt(50, 0), position: pt(500, 300), angle: 37, zLevel: 1, factor: 1.25, mirror: true });
    const inner = createTransform({ origin: pt(0, 0), position: pt(9, 9), angle: 90 });
    const root: Item = withTransform({ items: [withTransform(syllableA, inner), syllableB] }, outer);
    const given = createTransform({ origin: pt(0, 0), position: pt(40, 60), angle: 12 });
    const added = withTransform(line(0, 0), given);
    const changed = insertedIn(root, [0], 2, [added]) as Group;
    expect(changed.transform).toBe(outer);
    expect((changed.items[0] as Group).transform).toBe(inner);
    const placed = partOf(changed, [0, 2]).placed.transform;
    if (placed === undefined) throw new Error("a transform expected");
    expect(gap(placed.position, given.position)).toBeLessThan(1e-9);
    expect(placed.angle).toBeCloseTo(12, 9);
    expect(placed.mirror).toBe(false);
    expect(placed.zLevel + Math.log2(placed.factor)).toBeCloseTo(0, 9);
  });

  it("takes an object without a transform as being in the world", () => {
    const outer = createTransform({ origin: pt(0, 0), position: pt(100, 0) });
    const root: Item = withTransform({ items: [a0] }, outer);
    const changed = insertedIn(root, [], 1, [b0]) as Group;
    expect(changed.items[1]?.transform).toEqual(inverseTransform(outer));
    expect(placedSections(changed)[1]?.anchor).toEqual(placedAlone(b0.sections[0] as NonNullable<(typeof b0.sections)[0]>).anchor);
  });
});

describe("samePlace", () => {
  const section = a0.sections[0] as NonNullable<(typeof a0.sections)[0]>;

  it("is true for the same stroke at exactly the same place, whatever the objects", () => {
    expect(samePlace(placedAlone(section), placedAlone(section))).toBe(true);
    expect(samePlace(placedAlone(section), placeSection(section, createTransform({ origin: pt(3, 3) })))).toBe(true);
    const copied = { ...section, points: section.points.map((p) => ({ ...p })) };
    expect(samePlace(placedAlone(section), placedAlone(copied))).toBe(true);
  });

  it("is false for anything that differs", () => {
    const here = placedAlone(section);
    for (const options of [{ position: pt(1, 0) }, { position: pt(0, 1) }, { angle: 90 }, { mirror: true }, { zLevel: 1 }, { factor: 1.5 }]) {
      expect(samePlace(here, placeSection(section, createTransform({ origin: pt(0, 0), ...options })))).toBe(false);
    }
    const change = (p: Partial<(typeof section.points)[0]>) => ({ ...section, points: [section.points[0] as (typeof section.points)[0], { ...(section.points[1] as (typeof section.points)[0]), ...p }] });
    expect(samePlace(here, placedAlone(change({ x: 11 })))).toBe(false);
    expect(samePlace(here, placedAlone(change({ y: 1 })))).toBe(false);
    expect(samePlace(here, placedAlone(change({ width: 3 })))).toBe(false);
    const shorter = placedAlone({ ...section, points: section.points.slice(0, 1) });
    expect(samePlace(here, shorter)).toBe(false);
    expect(samePlace(shorter, here)).toBe(false);
  });
});

describe("pathAt", () => {
  it("finds the stroke under a point, the topmost one first", () => {
    expect(pathAt(name, camera, viewport, { x: 645, y: 360 })).toEqual([0, 0]);
    expect(pathAt(name, camera, viewport, { x: 745, y: 380 })).toEqual([1, 1]);
    expect(pathAt(a0, camera, viewport, { x: 645, y: 360 })).toEqual([]);
    const stacked: Group = { items: [line(0, 0), line(0, 0, 20)] };
    expect(pathAt(stacked, camera, viewport, { x: 645, y: 360 })).toEqual([1]);
    expect(pathAt(stacked, camera, viewport, { x: 655, y: 360 })).toEqual([1]);
  });

  it("gives null away from the ink, and counts the tolerance", () => {
    expect(pathAt(name, camera, viewport, { x: 645, y: 370 })).toBeNull();
    expect(pathAt(a0, camera, viewport, { x: 645, y: 365 })).toBeNull();
    expect(pathAt(a0, camera, viewport, { x: 645, y: 365 }, 4)).toEqual([]);
  });

  it("follows the transforms of the groups and of the object", () => {
    const turned: Group = { items: [withTransform(a0, createTransform({ origin: pt(0, 0), angle: 90 }))] }; // now going down
    expect(pathAt(turned, camera, viewport, { x: 640, y: 365 })).toEqual([0]);
    expect(pathAt(turned, camera, viewport, { x: 645, y: 360 }, 0)).toBeNull();
    const moved: Item = withTransform({ items: [a0] }, createTransform({ origin: pt(0, 0), position: pt(0, 100) }));
    expect(pathAt(moved, camera, viewport, { x: 645, y: 460 })).toEqual([0]);
    expect(pathAt(moved, camera, viewport, { x: 645, y: 360 })).toBeNull();
  });
});
