# engine

The infinite canvas engine shared by every app in this repository.

Space is not constrained in width, height, or depth.
Its job: camera and zoom (including zooming while drawing), coordinates that stay precise
at any zoom depth, objects, z-index, save and load.

## What exists

- `src/dyadic.ts`: exact numbers `n / 2^e` (BigInt numerator), used for every position of the world.
- `src/camera.ts`: an immutable camera with an exact center and an integer zoom level; screen ↔ world
  conversion, pan, and zoom that keeps the point under the cursor exactly where it is.

Design notes and measurements: [docs/noyau.md](../../docs/noyau.md).

Not yet: strokes, rendering (fabric.js), zones, objects.
