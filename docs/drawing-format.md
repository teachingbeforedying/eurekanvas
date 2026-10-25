# Drawing format: `eurekanvas/drawing`, version 1

A drawing is a list of strokes, together with the view it was saved with. Each stroke is a complete `eurekanvas/stroke` document, specified in [stroke-format.md](./stroke-format.md); this document only adds the envelope around them.

The reference implementation is `drawingToJSON` / `drawingFromJSON` in [`packages/engine/src/drawing.ts`](../packages/engine/src/drawing.ts). zveceditor writes these documents in files ending with `.zvec.json`.

Version 1 has not been published yet and has no known reader, so it may still change before the first release.

## Example

```json
{
  "format": "eurekanvas/drawing",
  "version": 1,
  "view": {
    "center": { "x": "3/2^-4", "y": "-5/2^700" },
    "zLevel": 12,
    "factor": 1.5
  },
  "strokes": [
    { "format": "eurekanvas/stroke", "version": 1, "sections": ["..."] },
    { "format": "eurekanvas/stroke", "version": 1, "sections": ["..."] }
  ]
}
```

(The `"..."` stands for the sections of each stroke. Real documents contain them in full.)

## Fields

| Field | Type | Meaning |
| ----- | ---- | ------- |
| `format` | string | Always `"eurekanvas/drawing"`. |
| `version` | integer | `1`. A reader must reject any other value. |
| `view.center` | object | The exact world point shown at the middle of the screen. `x` and `y` are dyadic strings, as in a stroke (`"<n>/2^<e>"`). |
| `view.zLevel` | integer | The integer part of the zoom, as in a stroke. |
| `view.factor` | number | The rest of the zoom: a positive, finite double. |
| `strokes` | array | The strokes, each a valid `eurekanvas/stroke` document, in drawing order: a later stroke is drawn over an earlier one. May be empty. |

A reader ignores unknown extra fields, in the envelope as in the strokes. Any change that is not backward compatible increases `version`.

## Meaning

- The view shows `scale = 2^zLevel * factor` screen pixels per world unit, with `view.center` at the middle of the screen. The size of the screen is not stored: a reader shows the same centre at the same scale on whatever screen it has.
- A writer writes `factor` in [1, 2). A reader accepts any positive, finite `factor` and brings it into [1, 2) by halving or doubling it while adding 1 to or subtracting 1 from `zLevel`. This keeps the scale unchanged and loses nothing, since a power of two is exact in a double.
- World coordinates, local units and stroke geometry are defined in [stroke-format.md](./stroke-format.md).

## Rules

1. A reader must reject the document if any type in the table is wrong, or if any stroke is not a valid `eurekanvas/stroke` document under the rules of its own specification.
2. Strokes are independent: a stroke does not refer to another one, and the order only says which is drawn over which.
