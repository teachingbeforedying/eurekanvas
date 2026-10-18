# engine

The infinite canvas engine shared by every app in this repository.

Space is not constrained in width, height, or depth.
Its job: camera and zoom (including zooming while drawing), coordinates that stay precise
at any zoom depth, objects, z-index, save and load.

## What exists

- `src/dyadic.ts`: exact numbers `n / 2^e` (BigInt numerator), used for every position of the world.
- `src/camera.ts`: an immutable camera with an exact center and an integer zoom level; screen ↔ world
  conversion, pan, and zoom that keeps the point under the cursor exactly where it is.
- `src/stroke.ts`: strokes drawn while zooming, split into "sections" (an exact anchor plus small float
  offsets), a recorder, projection to the screen, and a JSON form
  (specified in [docs/stroke-format.md](../../docs/stroke-format.md)).

- `src/outline.ts`: the outline of a stroke whose thickness changes from point to point (the union of tapered
  capsules), as plain path commands.
- `src/render.ts`: the `Renderer` interface a drawing library implements, and `selectDrawableSections`, which
  chooses what is worth drawing for a camera.

Design notes and measurements: [docs/noyau.md](../../docs/noyau.md).

Not yet: render zones, objects. Drawing with fabric.js is in [`packages/renderer-fabric`](../renderer-fabric).
