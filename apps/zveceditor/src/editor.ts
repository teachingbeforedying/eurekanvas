import {
  type Camera,
  type Drawing,
  type Group,
  type Item,
  ORIGIN,
  type OrientedRectangle,
  type PlacedSection,
  type Point,
  type RectangleMode,
  type Scene,
  type ScreenPoint,
  type SelectionBand,
  type Stroke,
  type Transform,
  type Viewport,
  StrokeRecorder,
  add,
  composeTransforms,
  createCamera,
  createTransform,
  isGroup,
  itemBounds,
  itemFrame,
  itemStrokes,
  itemsAt,
  itemsInRectangle,
  mirroredAcross,
  orientedRectangle,
  pan,
  placedAlone,
  placedSections,
  rectangleCenter,
  rotateAt,
  screenToWorld,
  selectDrawableSections,
  selectionFrame,
  shift,
  shortestAngle,
  turnedAround,
  withTransform,
  worldToScreen,
  zoomAt,
} from "@eurekanvas/engine";
import { Rope } from "./rope";

/** The same wheel step as the previous version of the engine: one notch (a `deltaY` of 100) is a factor of 1.2 or 0.8. */
export const WHEEL_STEP = 1 / 500;

/** Thickness of the stroke on the screen, in pixels, at the moment it is drawn. */
export const STROKE_WIDTH_PIXELS = 3;

/** The lengths, in pixels, that the keys step through for the rope of fixed length. */
export const ROPE_LENGTHS = [4, 8, 16, 32, 64, 128] as const;

export const DEFAULT_ROPE_LENGTH = 16;

/** The lags, in milliseconds, that the keys step through for the rope that follows the speed of the hand. */
export const LAG_TIMES = [25, 50, 100, 200, 400] as const;

export const DEFAULT_LAG = 50;

/** The longest rope that follows the speed of the hand, in pixels. */
export const SPEED_ROPE_MAX = 128;

export type PenKind = "raw" | "fixed" | "speed";

/**
 * The pen. `raw`: the stroke goes through every pointer position. `fixed`: a rope of `length` pixels (see
 * `Rope`). `speed`: a rope as long as the distance the pointer moved in the last `lag` milliseconds, between
 * `MIN_SPEED_ROPE` and `SPEED_ROPE_MAX` pixels. Each kind keeps its setting while another one is in use.
 */
export interface Pen {
  readonly kind: PenKind;
  readonly length: number;
  readonly lag: number;
}

export const DEFAULT_PEN: Pen = { kind: "speed", length: DEFAULT_ROPE_LENGTH, lag: DEFAULT_LAG };

/** The rope of one stroke drawn with `pen`. */
function ropeFor(pen: Pen): Rope {
  switch (pen.kind) {
    case "raw":
      return new Rope(0);
    case "fixed":
      return new Rope(pen.length);
    case "speed":
      return new Rope(SPEED_ROPE_MAX, pen.lag);
  }
}

/** How far from the ink of a stroke, in pixels, a click still takes it. */
export const CLICK_TOLERANCE_PIXELS = 4;

/** How far, in pixels, the pointer must move with the button down before a click becomes a rectangle. */
export const DRAG_THRESHOLD_PIXELS = 4;

/** With Shift, the view turned by the pointer stops at multiples of this angle, in degrees. */
export const TURN_STEP_DEGREES = 15;

/** Pointer positions this close to the middle of the screen, in pixels, do not turn the view: their angle is too unsteady. */
export const TURN_DEAD_ZONE_PIXELS = 8;

export type Button = "primary" | "middle" | "secondary";

/** The keys held when a button is pressed. */
export interface Modifiers {
  readonly shift?: boolean;
  readonly alt?: boolean;
}

/** What a selection took: how many objects are selected, and how many of them are not drawn on the screen. */
export interface SelectionReport {
  readonly count: number;
  readonly notVisible: number;
}

/**
 * The primary button is down without the drawing key. `start` is the world point that was under the pointer,
 * so that a rectangle stays on the drawing when the view moves or zooms meanwhile. Pressed on an object, it is
 * a click; elsewhere, it becomes a rectangle once the pointer has gone far enough (`dragging`).
 */
interface Press {
  readonly start: Point;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly onObject: boolean;
  dragging: boolean;
}

/** The zoom factor for a wheel movement: `deltaY > 0` zooms out, `deltaY < 0` zooms in. */
export function wheelZoomFactor(deltaY: number): number {
  const amount = Math.min(0.99, Math.max(-0.99, -deltaY * WHEEL_STEP));
  return 1 + amount;
}

/**
 * The transform of an object; for one without, the identity around the center of its box, so that it turns
 * around a point near itself: the precision of a turn is relative to the distance from its pivot.
 */
function transformOf(item: Item): Transform {
  if (item.transform !== undefined) return item.transform;
  const bounds = itemBounds(item);
  const center = bounds === null ? ORIGIN : { x: shift(add(bounds.minX, bounds.maxX), -1), y: shift(add(bounds.minY, bounds.maxY), -1) };
  return createTransform({ origin: center });
}

/** The object turned by `degrees`, clockwise on the screen, around the exact world point `center`. */
function turnedItem(item: Item, center: Point, degrees: number): Item {
  return withTransform(item, turnedAround(transformOf(item), center, degrees));
}

/** The objects of a group, where the group put them: each one takes the group's transform before its own. */
function openGroup(group: Group): readonly Item[] {
  const outer = group.transform;
  if (outer === undefined) return group.items;
  return group.items.map((member) => withTransform(member, member.transform === undefined ? outer : composeTransforms(outer, member.transform)));
}

/** As in AutoCAD: a rectangle dragged from left to right takes what is inside it, from right to left what it touches. */
function rectangleMode(from: ScreenPoint, to: ScreenPoint): RectangleMode {
  return from.x <= to.x ? "inside" : "touching";
}

export interface EditorStats {
  readonly strokes: number;
  readonly sections: number;
  readonly points: number;
}

/**
 * What the zveceditor tool does, without any DOM: it is given pointer and wheel events and keeps the
 * camera and the objects of the drawing. The page forwards browser events to it and draws its `scene`.
 *
 * - primary button, pressed while the drawing key (`²`) is held: draw. Every stroke drawn while the key stays
 *   held, button released or not in between, makes one object (a group when there are several). With Space
 *   held, the primary button moves the view;
 * - primary button with neither key: select. A click takes the topmost object under the pointer (a whole
 *   top-level object, even when a stroke of a group is clicked) or deselects on empty space; with Shift it adds
 *   or removes that object; with Alt it takes the object below the selected one there, and so on down, then
 *   from the top again. Dragged from empty space, it draws a rectangle: from left to right it takes the
 *   objects entirely inside it, from right to left those it touches, at every depth;
 * - middle or secondary button: move the view. It can be pressed while the primary button is down: the
 *   stroke is paused, the view follows the pointer, and drawing goes on from the same place of the
 *   stroke when the button is released;
 * - wheel: zoom around the pointer, also while drawing. The point of the world under the pointer does not
 *   move, so zooming alone adds nothing to the stroke: the next pointer move continues it, with the
 *   thickness that makes it `STROKE_WIDTH_PIXELS` thick on the screen at that moment;
 * - with the turning key (`R`) held, the pointer turns the view around the middle of the screen, like a knob:
 *   by the angle it sweeps around the middle, in steps of `TURN_STEP_DEGREES` with Shift. Also while
 *   drawing: the stroke is paused, as when the view is moved.
 *
 * The pen can be smoothed with a rope (see `Rope` and `Pen`): the stroke follows the pointer at a distance of
 * at most the rope length, which removes the tremor of a hand. Without a rope the stroke goes through every
 * pointer position. Times are in milliseconds, as in `PointerEvent.timeStamp`.
 */
export class Editor {
  private _camera: Camera = createCamera();
  private _viewport: Viewport;
  private finished: readonly Item[] = [];
  /** The objects before each action (a stroke, an added drawing, a clear...), for `undo`. */
  private readonly history: (readonly Item[])[] = [];
  /** The strokes and the placed sections of `finished`, flattened for the scene, remembered for the `finished` they come from. */
  private flat: { readonly from: readonly Item[]; readonly strokes: readonly Stroke[]; readonly sections: readonly PlacedSection[] } = {
    from: [],
    strokes: [],
    sections: [],
  };
  private recorder: StrokeRecorder | null = null;
  private drawKeyHeld = false;
  /**
   * While the drawing key is held (and until the stroke it was held for ends): how many strokes were drawn,
   * each one its own action, still in the drawing. They become one object when the hold ends.
   */
  private hold: { count: number } | null = null;
  private rope = new Rope(0);
  private _pen: Pen = { ...DEFAULT_PEN, kind: "raw" };
  /** How many of the secondary and middle buttons are down. */
  private panButtons = 0;
  /** The primary button is down with Space held: it moves the view instead of drawing. */
  private spacePanning = false;
  private spaceHeld = false;
  /** Where the pointer was at the last event. */
  private last: ScreenPoint = { x: 0, y: 0 };
  private press: Press | null = null;
  /**
   * While the turning key is held: the angle of the view when it was pressed (or after the last quarter turn),
   * and the angle the pointer has swept since, before any rounding to steps.
   */
  private turning: { start: number; swept: number; at: number } | null = null;
  /** Top-level objects of the drawing. A new set at every change. */
  private _selection: ReadonlySet<Item> = new Set();
  /** The placed sections and the frame of the selection, remembered for the selection they come from. */
  private selectionShape: {
    readonly from: ReadonlySet<Item>;
    readonly sections: ReadonlySet<PlacedSection>;
    readonly frame: OrientedRectangle | null;
  } = { from: new Set(), sections: new Set(), frame: null };
  /**
   * The selection being turned by the pointer, with the turning key and the primary button: around the exact
   * center of its frame, from the objects as they were when the button was pressed. `swept` is the angle the
   * pointer has swept around the center, `done` the angle the objects are turned by now.
   */
  private turningSelection: {
    readonly center: Point;
    readonly before: readonly Item[];
    readonly selected: readonly Item[];
    swept: number;
    done: number;
  } | null = null;

  constructor(viewport: Viewport) {
    this._viewport = viewport;
  }

  get camera(): Camera {
    return this._camera;
  }

  get viewport(): Viewport {
    return this._viewport;
  }

  /** The objects of the drawing, in drawing order: what is saved. */
  get items(): readonly Item[] {
    return this.finished;
  }

  /** The selected objects: top-level objects of the drawing. */
  get selection(): ReadonlySet<Item> {
    return this._selection;
  }

  /**
   * What to draw: the sections of the objects where they put them, then the stroke being drawn; the selection, its
   * frame, and the rectangle being dragged.
   */
  get scene(): Scene {
    if (this.flat.from !== this.finished) {
      this.flat = { from: this.finished, strokes: this.finished.flatMap(itemStrokes), sections: this.finished.flatMap(placedSections) };
    }
    const shape = this.shapeOfSelection();
    const current = this.recorder?.stroke;
    return {
      camera: this._camera,
      viewport: this._viewport,
      sections: current === undefined ? this.flat.sections : [...this.flat.sections, ...current.sections.map(placedAlone)],
      strokes: current === undefined ? this.flat.strokes : [...this.flat.strokes, current],
      selectedSections: shape.sections,
      selectionFrame: shape.frame,
      band: this.band,
    };
  }

  private shapeOfSelection(): { readonly sections: ReadonlySet<PlacedSection>; readonly frame: OrientedRectangle | null } {
    if (this.selectionShape.from !== this._selection) {
      const items = [...this._selection];
      this.selectionShape = { from: this._selection, sections: new Set(items.flatMap(placedSections)), frame: selectionFrame(items) };
    }
    return this.selectionShape;
  }

  /** The rectangle being dragged to select, on the screen, or `null`. */
  get band(): SelectionBand | null {
    if (!this.press?.dragging) return null;
    const from = worldToScreen(this._camera, this._viewport, this.press.start);
    return { from, to: this.last, mode: rectangleMode(from, this.last) };
  }

  get stats(): EditorStats {
    const strokes = this.scene.strokes;
    let sections = 0;
    let points = 0;
    for (const stroke of strokes) {
      sections += stroke.sections.length;
      for (const section of stroke.sections) points += section.points.length;
    }
    return { strokes: strokes.length, sections, points };
  }

  /** A stroke is open: the primary button is down, even if the view is being moved meanwhile. */
  get isDrawing(): boolean {
    return this.recorder !== null;
  }

  /** The view follows the pointer. */
  get isMovingView(): boolean {
    return this.panButtons > 0 || this.spacePanning;
  }

  get pen(): Pen {
    return this._pen;
  }

  /** Changes the pen for the next strokes. Ignored while a stroke is being drawn. */
  setPen(pen: Pen): void {
    new Rope(pen.length, pen.lag); // refuses an invalid length or lag, whatever the kind
    if (this.isDrawing) return;
    this._pen = pen;
  }

  /** The length of the rope now, in pixels, while a stroke is drawn; `null` otherwise. */
  get ropeNow(): number | null {
    return this.recorder ? this.rope.currentLength : null;
  }

  pointerDown(p: ScreenPoint, button: Button, time = performance.now(), modifiers: Modifiers = {}): void {
    if (button === "primary") {
      if (this.isDrawing || this.isMovingView || this.press) return; // a second press, or a press while the view moves
      this.last = p;
      if (this.spaceHeld) {
        this.spacePanning = true;
        return;
      }
      if (!this.drawKeyHeld) {
        if (this.turning) {
          // the turning key is held: the button turns the selection, and does not select
          this.startTurningSelection();
          return;
        }
        // the drawing key must be held before the press to draw: without it, the button selects
        this.press = {
          start: screenToWorld(this._camera, this._viewport, p),
          shift: modifiers.shift === true,
          alt: modifiers.alt === true,
          onObject: this.objectsAt(p).length > 0,
          dragging: false,
        };
        return;
      }
      this.recorder = new StrokeRecorder();
      this.rope = ropeFor(this._pen);
      this.recorder.addScreenPoint(this._camera, this._viewport, this.rope.start(p, time), STROKE_WIDTH_PIXELS);
    } else {
      this.panButtons += 1;
      this.last = p;
    }
  }

  pointerMove(p: ScreenPoint, time = performance.now(), modifiers: Modifiers = {}): void {
    const dx = p.x - this.last.x;
    const dy = p.y - this.last.y;
    if (this.turningSelection) {
      this.turnSelectionByPointer(p, modifiers.shift === true);
    } else if (this.turning) {
      this.turnByPointer(p, modifiers.shift === true);
    } else if (this.isMovingView) {
      this._camera = pan(this._camera, dx, dy);
      // the content follows the pointer, and so does the end of the stroke that is paused
      if (this.recorder) this.rope.shifted(dx, dy);
    } else if (this.recorder) {
      const brush = this.rope.move(p, time);
      if (brush) this.recorder.addScreenPoint(this._camera, this._viewport, brush, STROKE_WIDTH_PIXELS);
    } else if (this.press && !this.press.onObject && !this.press.dragging) {
      const start = worldToScreen(this._camera, this._viewport, this.press.start);
      if (Math.hypot(p.x - start.x, p.y - start.y) > DRAG_THRESHOLD_PIXELS) this.press.dragging = true;
    }
    this.last = p;
  }

  /**
   * A button was released. Releasing the primary button ends the stroke where the brush is: nothing is added,
   * so the stroke is what was visible while drawing, even if the rope kept the brush behind the pointer. Or it
   * ends a click or a rectangle: a rectangle returns what is selected afterwards.
   */
  pointerUp(button: Button = "primary"): SelectionReport | null {
    if (button !== "primary") {
      this.panButtons = Math.max(0, this.panButtons - 1);
      return null;
    }
    if (this.spacePanning) {
      this.spacePanning = false;
      return null;
    }
    if (this.recorder) {
      this.commit([...this.finished, this.recorder.stroke]);
      this.recorder = null;
      if (this.hold) this.hold.count += 1;
      if (!this.drawKeyHeld) this.endHold(); // the key was released during the stroke
      return null;
    }
    const turning = this.turningSelection;
    if (turning) {
      this.turningSelection = null;
      if (turning.done !== 0) this.history.push(turning.before); // the whole gesture is one action
      return null;
    }
    const press = this.press;
    this.press = null;
    if (press === null) return null;
    if (press.dragging) return this.selectInRectangle(press);
    this.click(press);
    return null;
  }

  /** The objects at `p` on the screen, topmost first. */
  private objectsAt(p: ScreenPoint): Item[] {
    const indices = itemsAt(this.finished, this._camera, this._viewport, p, CLICK_TOLERANCE_PIXELS);
    return indices.map((index) => this.finished[index] as Item);
  }

  /** Whether the primary button pressed at `p` would take an object: there is one, and the drawing key is not held. */
  pointsAtObject(p: ScreenPoint): boolean {
    return !this.drawKeyHeld && !this.isDrawing && this.objectsAt(p).length > 0;
  }

  private click(press: Press): void {
    const hits = this.objectsAt(worldToScreen(this._camera, this._viewport, press.start));
    let target: Item | undefined = hits[0];
    if (press.alt && hits.length > 1) {
      // below the deepest selected object here (the topmost one if none is), and from the top again after the bottom
      let current = 0;
      hits.forEach((item, index) => {
        if (this._selection.has(item)) current = index;
      });
      target = hits[(current + 1) % hits.length];
    }
    if (target === undefined) {
      if (!press.shift) this.select([]);
    } else if (!press.shift) {
      this.select([target]);
    } else if (this._selection.has(target)) {
      this.select([...this._selection].filter((item) => item !== target));
    } else {
      this.select([...this._selection, target]);
    }
  }

  private selectInRectangle(press: Press): SelectionReport {
    const from = worldToScreen(this._camera, this._viewport, press.start);
    const end = screenToWorld(this._camera, this._viewport, this.last);
    // its sides follow the screen, so they follow the view when it is turned
    const rectangle = orientedRectangle(press.start, end, this._camera.center, this._camera.angle);
    const taken = itemsInRectangle(this.finished, rectangle, rectangleMode(from, this.last));
    const items = taken.map((index) => this.finished[index] as Item);
    this.select(press.shift ? [...this._selection, ...items] : items);
    return this.report();
  }

  /**
   * Selects every object, at every depth. Selecting does not end a hold of the drawing key: its strokes, taken
   * one by one, leave the selection when they become their object.
   */
  selectAll(): SelectionReport {
    this.select(this.finished);
    return this.report();
  }

  /**
   * Selects what touches the screen, as a rectangle dragged from right to left over all of it would: objects
   * too small to be seen are taken too.
   */
  selectOnScreen(): SelectionReport {
    const corner = { x: this._viewport.width, y: this._viewport.height };
    const screen = orientedRectangle(
      screenToWorld(this._camera, this._viewport, { x: 0, y: 0 }),
      screenToWorld(this._camera, this._viewport, corner),
      this._camera.center,
      this._camera.angle,
    );
    this.select(itemsInRectangle(this.finished, screen, "touching").map((index) => this.finished[index] as Item));
    return this.report();
  }

  /**
   * Escape: puts the selection back as it was if the pointer is turning it; drops the rectangle being dragged, if
   * any; otherwise deselects everything.
   */
  cancel(): void {
    const turning = this.turningSelection;
    if (turning) {
      this.turningSelection = null;
      this.setItems(turning.before);
      this.select(turning.selected);
      return;
    }
    if (this.press?.dragging) {
      this.press = null;
      return;
    }
    this.select([]);
  }

  /**
   * Removes the selected objects, as one action. Returns how many; 0, doing nothing, with nothing selected or
   * while drawing.
   */
  deleteSelection(): number {
    if (this.isDrawing) return 0;
    this.interruptHold();
    const selected = this._selection;
    if (selected.size === 0) return 0;
    this.commit(this.finished.filter((item) => !selected.has(item)));
    return selected.size;
  }

  /**
   * Makes one group of the selected objects, in their drawing order, at the place of the topmost of them, and
   * selects it. Groups can be nested. One action. Returns how many objects were grouped; 0, doing nothing, with
   * fewer than two selected or while drawing.
   */
  groupSelection(): number {
    if (this.isDrawing) return 0;
    this.interruptHold();
    const selected = this._selection;
    if (selected.size < 2) return 0;
    const group: Item = { items: this.finished.filter((item) => selected.has(item)) };
    let top = 0;
    this.finished.forEach((item, index) => {
      if (selected.has(item)) top = index;
    });
    this.commit(this.finished.flatMap((item, index) => (index === top ? [group] : selected.has(item) ? [] : [item])));
    this.select([group]);
    return selected.size;
  }

  /**
   * Undoes one level of the selected groups: their objects take their place, and are selected along with the
   * other selected objects. One action. Returns how many groups; 0, doing nothing, without a selected group or
   * while drawing.
   */
  ungroupSelection(): number {
    if (this.isDrawing) return 0;
    this.interruptHold();
    const selected = this._selection;
    const opened = new Map<Item, readonly Item[]>();
    for (const item of selected) if (isGroup(item)) opened.set(item, openGroup(item));
    if (opened.size === 0) return 0;
    this.commit(this.finished.flatMap((item) => opened.get(item) ?? [item]));
    this.select([...selected].flatMap((item) => opened.get(item) ?? [item]));
    return opened.size;
  }

  /**
   * Turns the selection by `degrees`, clockwise on the screen, as one block around the center of its frame. One
   * action. Returns how many objects turned; 0, doing nothing, with nothing selected or while drawing.
   */
  turnSelection(degrees: number): number {
    const center = this.selectionCenter();
    if (center === null) return 0;
    return this.changeSelected((item) => turnedItem(item, center, degrees));
  }

  /**
   * Mirrors the selection around the center of its frame: from left to right or from top to bottom, as seen on the
   * screen. One action. Returns how many objects; 0, doing nothing, with nothing selected or while drawing.
   */
  mirrorSelection(direction: "leftRight" | "topBottom"): number {
    const center = this.selectionCenter();
    if (center === null) return 0;
    // the line, vertical or horizontal on the screen, in the world's axes
    const line = (direction === "leftRight" ? 90 : 0) - this._camera.angle;
    return this.changeSelected((item) => withTransform(item, mirroredAcross(transformOf(item), center, line)));
  }

  /**
   * Turns each selected object around the center of its own frame until it looks straight on the screen (in a
   * straight view: puts it back straight). Its mirror stays. One action. Returns how many objects turned; 0, doing
   * nothing, when none had to, or while drawing.
   */
  alignSelection(): number {
    if (this.selectionCenter() === null) return 0;
    const turns = new Map<Item, number>();
    for (const item of this._selection) {
      const degrees = shortestAngle(-this._camera.angle - (item.transform?.angle ?? 0));
      if (degrees !== 0) turns.set(item, degrees);
    }
    if (turns.size === 0) return 0;
    this.changeSelected((item) => {
      const degrees = turns.get(item);
      const frame = itemFrame(item);
      return degrees === undefined || frame === null ? item : turnedItem(item, rectangleCenter(frame), degrees);
    });
    return turns.size;
  }

  /** The exact center of the frame of the selection, after ending a hold of the drawing key; `null` when nothing can be changed. */
  private selectionCenter(): Point | null {
    if (this.isDrawing || this.turningSelection) return null;
    this.interruptHold();
    const frame = this.shapeOfSelection().frame;
    return frame === null ? null : rectangleCenter(frame);
  }

  /** Replaces each selected object by `change(object)`, as one action, and selects the results. */
  private changeSelected(change: (item: Item) => Item): number {
    const changed = new Map([...this._selection].map((item) => [item, change(item)]));
    this.commit(this.finished.map((item) => changed.get(item) ?? item));
    this.select(changed.values());
    return changed.size;
  }

  /** The primary button was pressed with the turning key: the pointer will turn the selection around the center of its frame. */
  private startTurningSelection(): void {
    if (this._selection.size === 0) return;
    const frame = this.shapeOfSelection().frame;
    if (frame === null) return;
    this.turningSelection = { center: rectangleCenter(frame), before: this.finished, selected: [...this._selection], swept: 0, done: 0 };
  }

  /** As `turnByPointer`, around the center of the selection's frame; with `steps`, by steps of the angle turned. */
  private turnSelectionByPointer(p: ScreenPoint, steps: boolean): void {
    const turning = this.turningSelection;
    if (turning === null) return;
    const center = worldToScreen(this._camera, this._viewport, turning.center);
    const from = { x: this.last.x - center.x, y: this.last.y - center.y };
    const to = { x: p.x - center.x, y: p.y - center.y };
    if (Math.hypot(from.x, from.y) < TURN_DEAD_ZONE_PIXELS || Math.hypot(to.x, to.y) < TURN_DEAD_ZONE_PIXELS) return;
    turning.swept += shortestAngle(((Math.atan2(to.y, to.x) - Math.atan2(from.y, from.x)) * 180) / Math.PI);
    const done = steps ? Math.round(turning.swept / TURN_STEP_DEGREES) * TURN_STEP_DEGREES : turning.swept;
    if (done === turning.done) return;
    turning.done = done;
    // from the objects as they were, so that nothing adds up
    const turned = new Map(turning.selected.map((item) => [item, turnedItem(item, turning.center, done)]));
    this.setItems(turning.before.map((item) => turned.get(item) ?? item));
    this.select(turned.values());
  }

  private select(items: Iterable<Item>): void {
    this._selection = new Set(items);
  }

  private report(): SelectionReport {
    let notVisible = 0;
    for (const item of this._selection) {
      if (selectDrawableSections(placedSections(item), this._camera, this._viewport).length === 0) notVisible += 1;
    }
    return { count: this._selection.size, notVisible };
  }

  /**
   * The drawing key (`²`) was pressed or released. Releasing it ends the hold: the strokes drawn during it become
   * one object, unless a stroke is still being drawn, in which case the hold ends with that stroke.
   */
  setDrawKeyHeld(held: boolean): void {
    this.drawKeyHeld = held;
    if (held) this.hold ??= { count: 0 };
    else if (!this.isDrawing) this.endHold();
  }

  /** Makes one object of the strokes of the hold, with one action to undo instead of one per stroke. */
  private endHold(): void {
    const count = this.hold?.count ?? 0;
    this.hold = null;
    if (count < 2) return; // nothing to group: no stroke, or a single one that stays a stroke
    const before = this.history[this.history.length - count] as readonly Item[];
    const group: Item = { items: this.finished.slice(-count) };
    this.history.length -= count;
    this.history.push(before);
    this.setItems([...this.finished.slice(0, -count), group]);
  }

  /** Another action comes in the middle of a hold: the strokes drawn so far make their object, and a new hold begins. */
  private interruptHold(): void {
    if (this.hold === null) return;
    this.endHold();
    if (this.drawKeyHeld) this.hold = { count: 0 };
  }

  /** Zooms around `p`, whatever the mode. */
  wheel(p: ScreenPoint, deltaY: number): void {
    const ratio = wheelZoomFactor(deltaY);
    this._camera = zoomAt(this._camera, this._viewport, p, ratio);
    if (this.recorder) this.rope.zoomed(p, ratio); // the end of the stroke stays on the drawing
  }

  /** The turning key (`R`) was pressed or released: while it is held, the pointer turns the view. */
  setTurnKeyHeld(held: boolean): void {
    const angle = this._camera.angle;
    this.turning = held ? { start: angle, swept: 0, at: angle } : null;
  }

  /** The turning key is held: the pointer turns the view. */
  get isTurningView(): boolean {
    return this.turning !== null;
  }

  /** Turns the view by `degrees`, clockwise, around the middle of the screen. A quarter turn is exact. */
  turnView(degrees: number): void {
    const middle = { x: this._viewport.width / 2, y: this._viewport.height / 2 };
    if (degrees === 0) return;
    this._camera = rotateAt(this._camera, this._viewport, middle, degrees);
    if (this.recorder) this.rope.rotated(middle, degrees); // the end of the stroke stays on the drawing
  }

  /** Turns the view back to 0°, the shortest way. */
  straightenView(): void {
    this.turnView(-shortestAngle(this._camera.angle));
  }

  /**
   * The pointer moved to `p` with the turning key held: the view turns by the angle it swept around the middle of
   * the screen, or to the nearest step with `steps`. The angle swept is added up, so that slow moves still reach
   * the next step.
   */
  private turnByPointer(p: ScreenPoint, steps: boolean): void {
    const turning = this.turning;
    if (turning === null) return;
    if (turning.at !== this._camera.angle) {
      // the view was turned some other way since (a quarter turn, a reset...): start again from there
      turning.start = this._camera.angle;
      turning.swept = 0;
    }
    const middle = { x: this._viewport.width / 2, y: this._viewport.height / 2 };
    const from = { x: this.last.x - middle.x, y: this.last.y - middle.y };
    const to = { x: p.x - middle.x, y: p.y - middle.y };
    if (Math.hypot(from.x, from.y) >= TURN_DEAD_ZONE_PIXELS && Math.hypot(to.x, to.y) >= TURN_DEAD_ZONE_PIXELS) {
      turning.swept += shortestAngle(((Math.atan2(to.y, to.x) - Math.atan2(from.y, from.x)) * 180) / Math.PI);
      const wanted = turning.start + turning.swept;
      const target = steps ? Math.round(wanted / TURN_STEP_DEGREES) * TURN_STEP_DEGREES : wanted;
      this.turnView(shortestAngle(target - this._camera.angle));
    }
    turning.at = this._camera.angle;
  }

  /** While Space is held, the primary button moves the view instead of drawing. */
  setSpaceHeld(held: boolean): void {
    this.spaceHeld = held;
  }

  resize(viewport: Viewport): void {
    // the centre of the view stays at the middle of the screen, so the drawing shifts by half the change
    const dx = (viewport.width - this._viewport.width) / 2;
    const dy = (viewport.height - this._viewport.height) / 2;
    this._viewport = viewport;
    if (this.recorder) this.rope.shifted(dx, dy);
  }

  /**
   * Puts back a saved drawing when the page opens, with nothing to undo. Objects drawn before it came back are
   * kept, after its own: nothing is lost if it comes late. Its view is shown, unless a stroke is being drawn.
   */
  restore(drawing: Drawing): void {
    this.interruptHold();
    this.setItems([...drawing.items, ...this.finished]);
    this.history.length = 0;
    if (!this.isDrawing) this._camera = drawing.view;
  }

  /**
   * Adds the objects of a drawing where they were drawn, and shows its view. `undo` removes them all at once
   * (and leaves the view). Returns `false`, doing nothing, while a stroke is being drawn.
   */
  addDrawing(drawing: Drawing): boolean {
    if (this.isDrawing) return false;
    this.interruptHold();
    if (drawing.items.length > 0) this.commit([...this.finished, ...drawing.items]);
    this._camera = drawing.view;
    return true;
  }

  /** Removes every object; `undo` brings them all back. Returns `false`, doing nothing, while a stroke is being drawn. */
  clear(): boolean {
    if (this.isDrawing) return false;
    this.interruptHold();
    if (this.finished.length > 0) this.commit([]);
    return true;
  }

  /**
   * Undoes the last action: a stroke, an added drawing, a clear, a deletion, a grouping or an ungrouping. While
   * the drawing key is held, that is the last stroke; afterwards, the whole object drawn during the hold. The
   * view stays where it is, and the selection keeps only the objects still there. Does nothing while drawing.
   */
  undo(): void {
    if (this.isDrawing) return;
    const previous = this.history.pop();
    if (previous === undefined) return;
    this.setItems(previous);
    if (this.hold && this.hold.count > 0) this.hold.count -= 1;
  }

  private commit(items: readonly Item[]): void {
    this.history.push(this.finished);
    this.setItems(items);
  }

  /** Replaces the objects of the drawing; the selection keeps only the objects still there. */
  private setItems(items: readonly Item[]): void {
    this.finished = items;
    if (this._selection.size === 0) return;
    const present = new Set(items);
    const kept = [...this._selection].filter((item) => present.has(item));
    if (kept.length < this._selection.size) this.select(kept);
  }

  /** Goes back to the starting view: the world origin at the middle of the screen, at the starting zoom. */
  resetView(): void {
    this._camera = createCamera();
  }
}
