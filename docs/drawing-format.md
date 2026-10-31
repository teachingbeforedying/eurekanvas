# Drawing format: `eurekanvas/drawing`, version 3

A drawing is a list of objects, together with the view it was saved with. An object is a stroke, or a group of objects handled as one, and any object may carry a transform that places it (turned, scaled, mirrored, moved). Each stroke is a complete `eurekanvas/stroke` document, specified in [stroke-format.md](./stroke-format.md), which keeps the coordinates it was drawn with; this document only adds the envelope, the groups and the transforms around them.

The reference implementation is `drawingToJSON` / `drawingFromJSON` in [`packages/engine/src/drawing.ts`](../packages/engine/src/drawing.ts). zveceditor writes these documents in files ending with `.zvec.json`.

Version 3 has not been published yet and has no known reader outside this project, so it may still change before the first release.

## Example

```json
{
  "format": "eurekanvas/drawing",
  "version": 3,
  "view": {
    "center": { "x": "3/2^-4", "y": "-5/2^700" },
    "zLevel": 12,
    "factor": 1.5,
    "angle": 30
  },
  "items": [
    { "format": "eurekanvas/stroke", "version": 1, "sections": ["..."] },
    {
      "transform": {
        "origin": { "x": "51/2^0", "y": "-3/2^1" },
        "position": { "x": "51/2^0", "y": "-3/2^1" },
        "zLevel": 0,
        "factor": 1,
        "angle": 90,
        "mirror": false
      },
      "group": [
        { "format": "eurekanvas/stroke", "version": 1, "sections": ["..."] },
        { "group": [{ "format": "eurekanvas/stroke", "version": 1, "sections": ["..."] }] }
      ]
    }
  ]
}
```

(The `"..."` stands for the sections of each stroke. Real documents contain them in full.)

## Fields

| Field | Type | Meaning |
| ----- | ---- | ------- |
| `format` | string | Always `"eurekanvas/drawing"`. |
| `version` | integer | `3`. A reader must reject any version it does not know (see "Earlier versions" below). |
| `view.center` | object | The exact world point shown at the middle of the screen. `x` and `y` are dyadic strings, as in a stroke (`"<n>/2^<e>"`). |
| `view.zLevel` | integer | The integer part of the zoom, as in a stroke. |
| `view.factor` | number | The rest of the zoom: a positive, finite double. |
| `view.angle` | number | Optional, `0` when absent: how far the view is turned, in degrees. A finite double. |
| `items` | array | The objects, in drawing order: a later object is drawn over an earlier one. May be empty. |
| an object | object | Either a stroke, a valid `eurekanvas/stroke` document (it has a `format` field), or a group: an object with a `group` field and no `format` field. |
| `group` | array | The objects of the group, in drawing order: at least one. Groups can be nested. |
| `transform` | object | Optional, on any object (stroke or group): where the object is placed. Without it, the object is where it was drawn. |
| `transform.origin` | object | The pivot: an exact point, in the coordinates the object was drawn with. `x` and `y` are dyadic strings. |
| `transform.position` | object | Where the pivot lands: an exact world point. `x` and `y` are dyadic strings. |
| `transform.zLevel` | integer | The integer part of the scale (see below). |
| `transform.factor` | number | The rest of the scale: a positive, finite double. |
| `transform.angle` | number | How far the object is turned, clockwise on the screen, in degrees. A finite double. |
| `transform.mirror` | boolean | Whether the object is mirrored, before it is turned. |

A reader ignores unknown extra fields, in the envelope, in groups and in strokes. Any change that is not backward compatible increases `version`.

## Meaning

- The view shows `scale = 2^zLevel * factor` screen pixels per world unit, with `view.center` at the middle of the screen. The size of the screen is not stored: a reader shows the same centre at the same scale on whatever screen it has.
- A writer writes `factor` in [1, 2). A reader accepts any positive, finite `factor` and brings it into [1, 2) by halving or doubling it while adding 1 to or subtracting 1 from `zLevel`. This keeps the scale unchanged and loses nothing, since a power of two is exact in a double.
- The view turns the drawing clockwise on the screen by `angle` degrees, around the middle of the screen: a world offset `(dx, dy)` from `view.center` appears at `(cos a · dx - sin a · dy, sin a · dx + cos a · dy) · scale` from the middle (the y axis points down, in the world as on the screen). A writer writes `angle` in [0, 360); a reader accepts any finite angle and brings it into [0, 360). Quarter turns (0, 90, 180, 270) use the exact values 0 and ±1 for the cosine and the sine. A reader of an earlier implementation ignores `angle` and shows the view straight, which loses no object: `angle` came in version 2 without changing it.
- A group says that its objects are handled as one (selected, moved, copied together). Without a transform, it does not change how they are drawn: the drawing order of all strokes is the order in which they appear when the groups are flattened.
- A transform places a point `p` of its object at `position + 2^zLevel · factor · R(angle) · M · (p − origin)`, where `R(a) = [cos a, −sin a; sin a, cos a]` turns clockwise on the screen (as for the view), and `M` is `(x, y) → (x, −y)` when `mirror` is true, the identity otherwise. Only the difference `p − origin` is turned and scaled: a writer puts the pivot near the object, so that the rounding of the cosine and the sine stays relative to the size of the object, at any depth. Quarter turns use the exact values 0 and ±1. A writer writes `factor` in [1, 2) and `angle` in [0, 360); a reader brings them there as for the view.
- The transform of a group applies to its objects after their own transforms: a stroke inside groups is placed by its own transform, then by the one of its group, and so on outwards.
- World coordinates, local units and stroke geometry are defined in [stroke-format.md](./stroke-format.md).

## Rules

1. A reader must reject the document if any type in the table is wrong (a transform included), if a group is empty, or if any stroke is not a valid `eurekanvas/stroke` document under the rules of its own specification.
2. Strokes are independent: a stroke does not refer to another one.

## Earlier versions

- Version 2 had no transforms: its objects are where they were drawn. A reader of version 3 reads it as it is. A reader of version 2 would ignore the transforms of version 3 and draw the objects in the wrong place: that is why the version changed.
- Version 1 had no groups: instead of `items`, it had `strokes`, an array of stroke documents. A reader of version 3 should also read version 1, each stroke becoming an object of its own. zveceditor does.
