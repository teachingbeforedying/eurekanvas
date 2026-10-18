# renderer-fabric

Draws eurekanvas strokes with [fabric.js](https://fabricjs.com) 7.

`FabricRenderer` implements the engine's `Renderer` interface on a fabric `StaticCanvas`:

- each section of a stroke becomes one fabric `Path`, built from the section's outline
  (`strokeOutline` in the engine) in the section's own local units;
- the path is kept for as long as the section object lives, and only its transformation changes with the
  camera (`util.applyTransformToObject`);
- which sections are drawn is decided by the engine (`selectDrawableSections`): see the precision limit of the
  browser's canvas in [docs/noyau.md](../../docs/noyau.md).

No selection or controls yet.
