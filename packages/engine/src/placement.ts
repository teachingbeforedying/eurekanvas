/**
 * The sections of the objects of a drawing, where their objects put them.
 *
 * A stroke keeps the coordinates it was drawn with; its object (and the groups around it) may carry a
 * `Transform`. A placed section says where the section ends up: its local point `l` is at
 *
 *     anchor + 2^-zLevel · factor · R(angle) · M · l
 *
 * with `anchor` the exact image of the section's anchor, and `M` the mirror `(x, y) → (x, −y)`. Without a
 * transform, the placed section is the section itself (`zLevel`, factor 1, angle 0, no mirror).
 */

import { type Camera, type Point, type ScreenPoint, type Turn, type Viewport, turnOf, turned, worldToScreen } from "./camera";
import { type Item, isGroup } from "./drawing";
import { equals } from "./dyadic";
import type { Section } from "./stroke";
import { type Transform, applyTransform, composeTransforms } from "./transform";

export interface PlacedSection {
  readonly section: Section;
  /** Where the section's anchor lands, exactly. */
  readonly anchor: Point;
  /** Integer. A local unit is `2^-zLevel · factor` world units. */
  readonly zLevel: number;
  /** In [1, 2). */
  readonly factor: number;
  /** Degrees, in [0, 360): how far the local axes are turned from the world's, clockwise on the screen. */
  readonly angle: number;
  readonly mirror: boolean;
}

// A section is immutable, so its place without a transform can be remembered for as long as it lives.
const alone = new WeakMap<Section, PlacedSection>();

/** A section where it was drawn, without any transform. Always the same object for the same section. */
export function placedAlone(section: Section): PlacedSection {
  const known = alone.get(section);
  if (known !== undefined) return known;
  const placed = { section, anchor: section.anchor, zLevel: section.zLevel, factor: 1, angle: 0, mirror: false };
  alone.set(section, placed);
  return placed;
}

/** A section placed by a transform. */
export function placeSection(section: Section, t: Transform): PlacedSection {
  return {
    section,
    anchor: applyTransform(t, section.anchor),
    zLevel: section.zLevel - t.zLevel,
    factor: t.factor,
    angle: t.angle,
    mirror: t.mirror,
  };
}

/** The box of a section's points, in its local units, and its smallest and largest thickness. */
export interface SectionExtent {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minWidth: number;
  readonly maxWidth: number;
}

// Sections are immutable, so their extent can be remembered for as long as the section object lives.
const extents = new WeakMap<Section, SectionExtent>();

export function sectionExtent(section: Section): SectionExtent {
  const known = extents.get(section);
  if (known !== undefined) return known;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minWidth = Infinity;
  let maxWidth = 0;
  for (const p of section.points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    if (p.width < minWidth) minWidth = p.width;
    if (p.width > maxWidth) maxWidth = p.width;
  }
  const extent = { minX, maxX, minY, maxY, minWidth, maxWidth };
  extents.set(section, extent);
  return extent;
}

/** How many pixels of the screen a local unit of a section is: `Infinity` very deep, 0 very far out. */
export function sectionScale(placed: PlacedSection, camera: Camera): number {
  return 2 ** (camera.zLevel - placed.zLevel) * camera.factor * placed.factor;
}

/**
 * The thickness, in local units of a section, from which its ink is a background: as thick as the shorter side of the
 * screen, so that both of its edges cannot be seen at once.
 */
export function backgroundWidth(placed: PlacedSection, camera: Camera, viewport: Viewport): number {
  return Math.min(viewport.width, viewport.height) / sectionScale(placed, camera);
}

/** Whether two placed sections are the same stroke at exactly the same place: one would hide the other. */
export function samePlace(a: PlacedSection, b: PlacedSection): boolean {
  const [ours, theirs] = [a.section.points, b.section.points];
  return (
    a.zLevel === b.zLevel &&
    a.factor === b.factor &&
    a.angle === b.angle &&
    a.mirror === b.mirror &&
    equals(a.anchor.x, b.anchor.x) &&
    equals(a.anchor.y, b.anchor.y) &&
    ours.length === theirs.length &&
    ours.every((p, i) => p.x === theirs[i]?.x && p.y === theirs[i]?.y && p.width === theirs[i]?.width)
  );
}

// Objects are immutable, so their placed sections can be remembered for as long as they live.
const ofItems = new WeakMap<Item, readonly PlacedSection[]>();

/** The sections of an object in drawing order, placed by its transform and those of the groups inside it. */
export function placedSections(item: Item): readonly PlacedSection[] {
  const known = ofItems.get(item);
  if (known !== undefined) return known;
  const sections: PlacedSection[] = [];
  collect(item, null, sections);
  ofItems.set(item, sections);
  return sections;
}

function collect(item: Item, outer: Transform | null, into: PlacedSection[]): void {
  const own = item.transform;
  const t = own === undefined ? outer : outer === null ? own : composeTransforms(outer, own);
  if (isGroup(item)) {
    for (const member of item.items) collect(member, t, into);
  } else {
    for (const section of item.sections) into.push(t === null ? placedAlone(section) : placeSection(section, t));
  }
}

/**
 * Where the local points of a placed section appear on the screen: `origin + scale · R · M · local`, with the
 * turn `R` and the mirror `M` of the camera and of the section together.
 */
export interface SectionProjection {
  readonly origin: ScreenPoint;
  readonly scale: number;
  readonly turn: Turn;
  readonly mirror: boolean;
}

/**
 * The transformation that places a section on the screen, relative to the camera, as plain floats.
 * Returns `null` when it cannot be expressed that way (the origin is infinitely far, or the section is
 * more than about 1 000 levels away from the camera, so its scale is 0 or infinite).
 *
 * This is a float computation: when the camera is much deeper than the section, the origin is very far
 * from the screen and the result loses precision (see docs/noyau.md). The exact route for any point
 * is `worldToScreen` of its exact world position.
 */
export function projectSection(placed: PlacedSection, camera: Camera, viewport: Viewport): SectionProjection | null {
  const origin = worldToScreen(camera, viewport, placed.anchor);
  const scale = 2 ** (camera.zLevel - placed.zLevel) * camera.factor * placed.factor;
  if (!(Number.isFinite(origin.x) && Number.isFinite(origin.y) && Number.isFinite(scale) && scale > 0)) return null;
  // M · R(a) = R(−a) · M: a mirrored view turns the section the other way, as in `composeTransforms`
  const angle = camera.angle + (camera.mirror ? -placed.angle : placed.angle);
  return { origin, scale, turn: turnOf(angle), mirror: camera.mirror !== placed.mirror };
}

export function localToScreen(projection: SectionProjection, local: { readonly x: number; readonly y: number }): ScreenPoint {
  const y = projection.mirror ? -local.y : local.y;
  const offset = turned(projection.turn, local.x * projection.scale, y * projection.scale);
  return { x: projection.origin.x + offset.x, y: projection.origin.y + offset.y };
}
