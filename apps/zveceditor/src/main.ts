import { type Drawing, type ScreenPoint, type Viewport, drawingFromJSON, drawingToJSON, log2Scale } from "@eurekanvas/engine";
import { FabricRenderer } from "@eurekanvas/renderer-fabric";
import { buttonChanges, describePen, drawingFileName, nextPen, parseStoredPen, stepPen } from "./controls";
import { Editor, type Pen } from "./editor";
import { keepUnreadable, loadAutosave, saveAutosave } from "./storage";

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

// What the box at the top left says about the last save or open.
let status = "";
function setStatus(text: string): void {
  status = text;
  invalidate();
}
function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function drawingText(): string {
  return JSON.stringify(drawingToJSON({ strokes: editor.strokes, view: editor.camera }));
}

// The automatic save, in the browser: the drawing and its view come back when the page opens again. Nothing is
// saved before the saved drawing has been read, or the empty page would overwrite it.
const AUTOSAVE_DELAY = 500; // milliseconds after the last change
let autosave: "loading" | "on" | "off" = "loading";
let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
let lastSaved: string | null = null;

/** The strokes or the view changed: save them once the changes stop for a moment. */
function changed(): void {
  if (autosave !== "on") return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(saveNow, AUTOSAVE_DELAY);
}

function saveNow(): void {
  clearTimeout(autosaveTimer);
  if (autosave !== "on") return;
  const text = drawingText();
  if (text === lastSaved) return;
  saveAutosave(text).then(
    () => void (lastSaved = text),
    (error: unknown) => {
      autosave = "off";
      setStatus(`automatic save stopped: ${reason(error)}`);
    },
  );
}

async function restoreAutosave(): Promise<void> {
  let text: string | null;
  try {
    text = await loadAutosave();
  } catch (error) {
    autosave = "off"; // no IndexedDB: the page works without the automatic save
    setStatus(`no automatic save in this browser: ${reason(error)}`);
    return;
  }
  if (text !== null) {
    try {
      editor.restore(drawingFromJSON(JSON.parse(text)));
      lastSaved = text;
    } catch (error) {
      try {
        const key = await keepUnreadable(text, new Date());
        setStatus(`the saved drawing could not be read (${reason(error)}): it is kept aside as "${key}"`);
      } catch {
        autosave = "off"; // never overwrite a drawing that could not be kept aside
        setStatus(`the saved drawing could not be read (${reason(error)}): automatic save stopped, so as not to overwrite it`);
        return;
      }
    }
  }
  autosave = "on";
  changed(); // strokes drawn while the saved drawing was loading
  invalidate();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveNow();
});

// Files: Ctrl+S downloads a copy of the drawing, Ctrl+O adds the strokes of a file to the drawing.
function saveFile(): void {
  const name = drawingFileName(new Date());
  const url = URL.createObjectURL(new Blob([drawingText()], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link); // older Firefox only follows a link that is in the page
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000); // once the download has surely started
  setStatus(`saved ${name} (${editor.strokes.length} strokes)`);
}

function openText(name: string, text: string): void {
  let drawing: Drawing;
  try {
    drawing = drawingFromJSON(JSON.parse(text));
  } catch (error) {
    setStatus(`could not open ${name}: ${reason(error)}`);
    return;
  }
  if (!editor.addDrawing(drawing)) {
    setStatus(`could not open ${name} while drawing: release the button, then open it again`);
    return;
  }
  setStatus(`opened ${name}: ${drawing.strokes.length} strokes added (Ctrl+Z removes them)`);
  changed();
}

const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = ".json,application/json";
fileInput.hidden = true;
document.body.append(fileInput);
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = ""; // so that the same file can be opened again
  if (!file) return;
  file.text().then(
    (text) => openText(file.name, text),
    (error: unknown) => setStatus(`could not read ${file.name}: ${reason(error)}`),
  );
});

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
    `save a file: Ctrl+S    open a file (adds to the drawing): Ctrl+O    clear: K (Ctrl+Z brings it back)`,
    `automatic save in this browser: ${autosave}`,
    ...(status === "" ? [] : [status]),
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
  if (editor.isMovingView) changed();
  invalidate();
});

function release(event: PointerEvent): void {
  if (canvas!.hasPointerCapture(event.pointerId)) canvas!.releasePointerCapture(event.pointerId);
  syncButtons(event.type === "pointercancel" ? 0 : event.buttons, position(event), event.timeStamp);
  changed();
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
    changed();
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
    changed();
    invalidate();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault(); // instead of saving the page
    saveFile();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
    event.preventDefault(); // instead of opening a file in the browser
    fileInput.click();
  } else if (plain && event.key.toLowerCase() === "k") {
    const count = editor.strokes.length;
    if (editor.clear() && count > 0) {
      setStatus(`cleared ${count} strokes (Ctrl+Z brings them back)`);
      changed();
    }
  } else if (plain && event.key === "0") {
    editor.resetView();
    changed();
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

// For tests in the browser: the editor can be driven from the console (`window.zveceditor.editor`), and a
// file opened without the file picker (`window.zveceditor.openText(name, text)`).
(window as unknown as { zveceditor: unknown }).zveceditor = { editor, renderer, invalidate, openText };

invalidate();
void restoreAutosave();
