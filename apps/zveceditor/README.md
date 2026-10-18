# zveceditor

A "2.5D" vector editor on the infinite canvas: no pixels, only curves,
and you can change the zoom level while drawing a freehand curve.

The stroke keeps the same thickness on the screen while you draw, so seen from further away it gets
thinner as you dive, smoothly.

## Try it

From the root of the repository:

```bash
npm install
npm run dev --workspace @eurekanvas/zveceditor
```

Then open http://localhost:5173.

## Controls

| Action | Gesture |
| ------ | ------- |
| Draw | left button |
| Zoom, around the pointer (also while drawing) | wheel |
| Move the view | right button, middle button, or Space + left button |
| Move the view **while drawing** | keep the left button down, press the right (or middle) button, move, release it, and go on drawing |
| Smooth pen / raw pen | S |
| Shorter / longer rope of the smooth pen | [ and ] |
| Undo the last stroke | Ctrl+Z |
| Back to the starting view | 0 |

The box at the top left shows the zoom (`2^…`, level and factor), the number of strokes, sections and points,
how many sections are actually drawn, and which pen is in use.

## The pen

- **Smooth pen** (the default): the brush is tied to the pointer by a rope of a few pixels (16 by default;
  4, 8, 16, 32, 64 or 128 with `[` and `]`). A tremor smaller than the rope does not show at all, and the stroke
  is tight. The stroke follows the pointer a rope's length behind it and catches up when you release.
  The rope is measured in screen pixels: to draw finer details, zoom in.
- **Raw pen**: the stroke goes through every position of the pointer, tremor included.

The choice is remembered by the browser.

## How it is made

- `src/editor.ts`: what the tool does (a pure class, no DOM, tested).
- `src/rope.ts`: the stabilizer of the smooth pen.
- `src/controls.ts`: reading the mouse buttons, and the keys of the pen settings.
- `src/main.ts`: forwards browser events to the editor and draws its scene.
- Strokes, camera and exact numbers: [`packages/engine`](../../packages/engine).
- Drawing: [`packages/renderer-fabric`](../../packages/renderer-fabric).
- Design notes and measurements: [docs/noyau.md](../../docs/noyau.md).
