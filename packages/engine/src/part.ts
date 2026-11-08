/**
 * A part of an object: an object inside a group, named by the indices that lead to it from the top-level object.
 *
 * A part keeps its coordinates relative to the groups around it. To change it, it is first brought into the world's
 * coordinates (`placed`), changed there like any top-level object, and put back through the inverse of the groups'
 * transforms: the groups themselves do not change, and neither does anything else in them.
 */

import type { Camera, ScreenPoint, Viewport } from "./camera";
import { type Group, type Item, isGroup, withTransform } from "./drawing";
import { itemsAt } from "./hit";
import { placedSections } from "./placement";
import type { SelectionOptions } from "./render";
import { type Transform, composeTransforms, inverseTransform } from "./transform";

export interface Part {
  /** The top-level object it belongs to. */
  readonly root: Item;
  /** The indices that lead from `root` to the part: at least one. */
  readonly path: readonly number[];
  /** The part where its groups put it: its transform is in the world's coordinates. */
  readonly placed: Item;
  /** The transforms of the groups around it, composed; `undefined` when none has one. */
  readonly outer: Transform | undefined;
  /** The groups around it, placed in the same way, from `root` down to its parent. */
  readonly parents: readonly Item[];
  /** Its sections are `placedSections(root).slice(start, end)`. */
  readonly start: number;
  readonly end: number;
}

function within(outer: Transform | undefined, own: Transform | undefined): Transform | undefined {
  return outer === undefined ? own : own === undefined ? outer : composeTransforms(outer, own);
}

function placedIn(item: Item, outer: Transform | undefined): Item {
  return withTransform(item, within(outer, item.transform));
}

/** The part of `root` at the end of `path`. */
export function partOf(root: Item, path: readonly number[]): Part {
  if (path.length === 0) throw new RangeError("a part is inside a group: its path cannot be empty");
  let outer: Transform | undefined;
  let item = root;
  let start = 0;
  const parents: Item[] = [];
  for (const index of path) {
    if (!isGroup(item)) throw new RangeError("the path of a part goes through groups only");
    const child = item.items[index];
    if (child === undefined) throw new RangeError(`no object at index ${index} of this group`);
    parents.push(placedIn(item, outer));
    outer = within(outer, item.transform);
    for (const before of item.items.slice(0, index)) start += placedSections(before).length;
    item = child;
  }
  return { root, path, placed: placedIn(item, outer), outer, parents, start, end: start + placedSections(item).length };
}

function rebuilt(item: Item, path: readonly number[], replacement: Item | null): Item | null {
  const [index, ...rest] = path;
  if (index === undefined) return replacement;
  const group = item as Group;
  const child = rebuilt(group.items[index] as Item, rest, replacement);
  const items = group.items.flatMap((each, i) => (i !== index ? [each] : child === null ? [] : [child]));
  return items.length === 0 ? null : { ...group, items };
}

/**
 * The top-level object with the part replaced by `placed`, an object given in the world's coordinates. With `null`,
 * the part is removed, along with the groups left empty; `null` is returned if nothing is left of the object.
 */
export function replacedPart(part: Part, placed: Item | null): Item | null {
  return rebuilt(part.root, part.path, placed === null ? null : inGroups(placed, part.outer));
}

/** An object given in the world's coordinates, in the coordinates of groups whose transforms compose into `outer`. */
function inGroups(placed: Item, outer: Transform | undefined): Item {
  if (outer === undefined) return placed;
  const back = inverseTransform(outer);
  return withTransform(placed, placed.transform === undefined ? back : composeTransforms(back, placed.transform));
}

/**
 * The top-level object with objects added to the group at the end of `path` (the object itself when it is empty),
 * from index `at` on. The objects are given in the world's coordinates, and stay where they are in the world.
 */
export function insertedIn(root: Item, path: readonly number[], at: number, placed: readonly Item[]): Item {
  let outer = root.transform;
  let target = root;
  for (const index of path) {
    target = (target as Group).items[index] as Item;
    outer = within(outer, target.transform);
  }
  const added = placed.map((item) => inGroups(item, outer));
  const insert = (item: Item, rest: readonly number[]): Item => {
    const group = item as Group;
    const [index, ...tail] = rest;
    return index === undefined
      ? { ...group, items: [...group.items.slice(0, at), ...added, ...group.items.slice(at)] }
      : { ...group, items: group.items.map((child, i) => (i === index ? insert(child, tail) : child)) };
  };
  return insert(root, path);
}

/**
 * The path to the topmost stroke of `item` drawn at `p` on the screen, or at most `tolerance` pixels from its ink:
 * empty for a stroke, `null` when nothing of it is there.
 */
export function pathAt(
  item: Item,
  camera: Camera,
  viewport: Viewport,
  p: ScreenPoint,
  tolerance = 0,
  options: SelectionOptions = {},
): number[] | null {
  if (!isGroup(item)) return itemsAt([item], camera, viewport, p, tolerance, options).length > 0 ? [] : null;
  for (let index = item.items.length - 1; index >= 0; index--) {
    const path = pathAt(placedIn(item.items[index] as Item, item.transform), camera, viewport, p, tolerance, options);
    if (path !== null) return [index, ...path];
  }
  return null;
}
