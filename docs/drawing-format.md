# Drawing format: `eurekanvas/drawing`, version 2

A drawing is a list of objects, together with the view it was saved with. An object is a stroke, or a group of objects handled as one. Each stroke is a complete `eurekanvas/stroke` document, specified in [stroke-format.md](./stroke-format.md); this document only adds the envelope and the groups around them.

The reference implementation is `drawingToJSON` / `drawingFromJSON` in [`packages/engine/src/drawing.ts`](../packages/engine/src/drawing.ts). zveceditor writes these documents in files ending with `.zvec.json`.

Version 2 has not been published yet and has no known reader outside this project, so it may still change before the first release.

## Example

```json
{
  "format": "eurekanvas/drawing",
  "version": 2,
  "view": {
    "center": { "x": "3/2^-4", "y": "-5/2^700" },
    "zLevel": 12,
    "factor": 1.5,
    "angle": 30
  },
  "items": [
    { "format": "eurekanvas/stroke", "version": 1, "sections": ["..."] },
    {
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
| `version` | integer | `2`. A reader must reject any version it does not know (see "Version 1" below). |
| `view.center` | object | The exact world point shown at the middle of the screen. `x` and `y` are dyadic strings, as in a stroke (`"<n>/2^<e>"`). |
| `view.zLevel` | integer | The integer part of the zoom, as in a stroke. |
| `view.factor` | number | The rest of the zoom: a positive, finite double. |
| `view.angle` | number | Optional, `0` when absent: how far the view is turned, in degrees. A finite double. |
| `items` | array | The objects, in drawing order: a later object is drawn over an earlier one. May be empty. |
| an object | object | Either a stroke, a valid `eurekanvas/stroke` document (it has a `format` field), or a group: an object with a `group` field and no `format` field. |
| `group` | array | The objects of the group, in drawing order: at least one. Groups can be nested. |

A reader ignores unknown extra fields, in the envelope, in groups and in strokes. Any change that is not backward compatible increases `version`.

## Meaning

- The view shows `scale = 2^zLevel * factor` screen pixels per world unit, with `view.center` at the middle of the screen. The size of the screen is not stored: a reader shows the same centre at the same scale on whatever screen it has.
- A writer writes `factor` in [1, 2). A reader accepts any positive, finite `factor` and brings it into [1, 2) by halving or doubling it while adding 1 to or subtracting 1 from `zLevel`. This keeps the scale unchanged and loses nothing, since a power of two is exact in a double.
- The view turns the drawing clockwise on the screen by `angle` degrees, around the middle of the screen: a world offset `(dx, dy)` from `view.center` appears at `(cos a · dx - sin a · dy, sin a · dx + cos a · dy) · scale` from the middle (the y axis points down, in the world as on the screen). A writer writes `angle` in [0, 360); a reader accepts any finite angle and brings it into [0, 360). Quarter turns (0, 90, 180, 270) use the exact values 0 and ±1 for the cosine and the sine. A reader of an earlier implementation ignores `angle` and shows the view straight, which loses no object: that is why the version stays 2.
- A group only says that its objects are handled as one (selected, moved, copied together). It does not change how they are drawn: the drawing order of all strokes is the order in which they appear when the groups are flattened.
- World coordinates, local units and stroke geometry are defined in [stroke-format.md](./stroke-format.md).

## Rules

1. A reader must reject the document if any type in the table is wrong, if a group is empty, or if any stroke is not a valid `eurekanvas/stroke` document under the rules of its own specification.
2. Strokes are independent: a stroke does not refer to another one.

## Version 1

Version 1 had no groups: instead of `items`, it had `strokes`, an array of stroke documents. A reader of version 2 should also read version 1, each stroke becoming an object of its own. zveceditor does.
