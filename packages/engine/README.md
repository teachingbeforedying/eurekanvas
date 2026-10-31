# engine

The infinite canvas engine shared by every app in this repository.

Space is not constrained in width, height, or depth.
Its job: camera and zoom (including zooming while drawing), coordinates that stay precise
at any zoom depth, objects, z-index, save and load.

## What exists

- `src/dyadic.ts`: exact numbers `n / 2^e` (BigInt numerator), used for every position of the world.
- `src/camera.ts`: an immutable camera with an exact center, an integer zoom level and an angle; screen ↔ world
  conversion, pan, and zoom and rotation that keep the point under the cursor exactly where it is.
- `src/stroke.ts`: strokes drawn while zooming, split into "sections" (an exact anchor plus small float
  offsets), a recorder, projection to the screen, and a JSON form
  (specified in [docs/stroke-format.md](../../docs/stroke-format.md)).

- `src/outline.ts`: the outline of a stroke whose thickness changes from point to point (the union of tapered
  capsules), as plain path commands.
- `src/drawing.ts`: the objects of a drawing (strokes and nested groups, each with an optional transform) and
  its JSON form (specified in [docs/drawing-format.md](../../docs/drawing-format.md)).
- `src/transform.ts`: where an object is placed: a similarity (turn, scale, mirror) around an exact pivot near
  the object, then an exact position.
- `src/placement.ts`: the sections of an object where its transforms put them, and their projection to the
  screen.
- `src/render.ts`: the `Renderer` interface a drawing library implements, the `Scene` it draws (selection
  included), and `selectDrawableSections`, which chooses what is worth drawing for a camera.
- `src/hit.ts`: the objects under a point of the screen (what is drawn there), and the objects in a rectangle
  that may follow a turned view, compared exactly at any depth.

Design notes and measurements: [docs/noyau.md](../../docs/noyau.md).

Not yet: render zones. Drawing with fabric.js is in [`packages/renderer-fabric`](../renderer-fabric).
