import { type ScreenPoint, type Viewport, log2Scale } from "@eurekanvas/engine";
import { FabricRenderer } from "@eurekanvas/renderer-fabric";
import { buttonChanges, describePen, nextPen, parseStoredPen, stepPen } from "./controls";
import { Editor, type Pen } from "./editor";

const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
const hud = document.getElementById("hud");
if (!canvas || !hud) throw new Error("the page is missing #canvas or #hud");

function windowViewport(): Viewport {
  return { width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) };
}

const editor = new Editor(windowViewport());
const renderer = new FabricRenderer(canvas, editor.viewport);

// The pen: smooth by default, and the choice is remembered by the browser (the page works without it).
const PEN_STORAGE_KEY = "zveceditor.pen";
function storedPen(): Pen {
  try {
    return parseStoredPen(localStorage.getItem(PEN_STORAGE_KEY));
  } catch {
    return parseStoredPen(null);
  }
}
function choosePen(pen: Pen): void {
  editor.setPen(pen);
  try {
    localStorage.setItem(PEN_STORAGE_KEY, JSON.stringify(editor.pen));
  } catch {
    // not remembered, that is all
  }
}
editor.setPen(storedPen());

// Frames are drawn at most once per animation frame, and only when something changed.
let frameRequested = false;
function invalidate(): void {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(() => {
    frameRequested = false;
    renderer.render(editor.scene);
    updateHud();
  });
}

function updateHud(): void {
  const { camera } = editor;
  const stats = editor.stats;
  hud!.textContent = [
    `zoom 2^${log2Scale(camera).toFixed(2)}   (level ${camera.zLevel}, factor ${camera.factor.toFixed(3)})`,
    `strokes ${stats.strokes} · sections ${stats.sections} · points ${stats.points} · drawn sections ${renderer.drawnSections}`,
    describePen(editor.pen, editor.ropeNow),
    ``,
    `draw: left button    zoom: wheel (also while drawing)`,
    `move the view: right or middle button (also while drawing), or Space + left button`,
    `undo: Ctrl+Z    reset the view: 0`,
  ].join("\n");
}

function position(event: MouseEvent): ScreenPoint {
  const box = canvas!.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

// Which buttons were down at the last pointer event. A second mouse button pressed while another is down
// does not send a `pointerdown`, only a `pointermove` with another `buttons` mask: so the buttons are
// compared at every pointer event.
let buttonsDown = 0;
function syncButtons(buttons: number, p: ScreenPoint, time: number): void {
  for (const change of buttonChanges(buttonsDown, buttons)) {
    if (change.pressed) editor.pointerDown(p, change.button, time);
    else editor.pointerUp(change.button);
  }
  buttonsDown = buttons;
}

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  try {
    // keeps the events coming when the pointer leaves the window; it throws if the pointer is already gone
    canvas.setPointerCapture(event.pointerId);
  } catch {
    // drawing still works without the capture
  }
  syncButtons(event.buttons, position(event), event.timeStamp);
  invalidate();
});

canvas.addEventListener("pointermove", (event) => {
  // the browser merges the pointer positions of one frame: ask for all of them to draw a finer stroke
  const events = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
  for (const each of events.length > 0 ? events : [event]) {
    const p = position(each);
    syncButtons(each.buttons, p, each.timeStamp);
    editor.pointerMove(p, each.timeStamp);
  }
  invalidate();
});

function release(event: PointerEvent): void {
  if (canvas!.hasPointerCapture(event.pointerId)) canvas!.releasePointerCapture(event.pointerId);
  syncButtons(event.type === "pointercancel" ? 0 : event.buttons, position(event), event.timeStamp);
  invalidate();
}
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);

canvas.addEventListener("contextmenu", (event) => event.preventDefault());

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    // a notch is about 100 pixels; Firefox may report lines (about 3 per notch) or pages
    const unit = event.deltaMode === 1 ? 100 / 3 : event.deltaMode === 2 ? 800 : 1;
    editor.wheel(position(event), event.deltaY * unit);
    invalidate();
  },
  { passive: false },
);

window.addEventListener("keydown", (event) => {
  const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
  if (event.code === "Space") {
    editor.setSpaceHeld(true);
    event.preventDefault();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    editor.undo();
    event.preventDefault();
    invalidate();
  } else if (plain && event.key === "0") {
    editor.resetView();
    invalidate();
  } else if (plain && event.key.toLowerCase() === "s") {
    choosePen(nextPen(editor.pen));
    invalidate();
  } else if (event.key === "[" || event.key === "]") {
    // no `plain` here: some keyboards (French AZERTY) type them with AltGr, which the browser reports as Ctrl+Alt
    choosePen(stepPen(editor.pen, event.key === "[" ? -1 : 1));
    invalidate();
  }
});

window.addEventListener("keyup", (event) => {
  if (event.code === "Space") editor.setSpaceHeld(false);
});

window.addEventListener("resize", () => {
  editor.resize(windowViewport());
  renderer.resize(editor.viewport);
  invalidate();
});

// For tests in the browser: the editor can be driven from the console (`window.zveceditor.editor`).
(window as unknown as { zveceditor: unknown }).zveceditor = { editor, renderer, invalidate };

invalidate();
