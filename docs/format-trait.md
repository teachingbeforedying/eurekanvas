# Stroke format: `eurekanvas/stroke`, version 1

A stroke drawn while zooming can go hundreds of zoom levels deep. Positions that deep cannot be written as ordinary floating-point coordinates, so a stroke is stored as a sequence of **bouts**: each bout has an **exact anchor** and **small float offsets** from that anchor.

This document specifies the JSON form. The reference implementation is `strokeToJSON` / `strokeFromJSON` in [`packages/engine/src/stroke.ts`](../packages/engine/src/stroke.ts). To read the anchors, a reader needs **arbitrary-precision integers** (`BigInt` in JavaScript, `int` in Python, `BigInteger` in Java, and so on). The offsets are ordinary IEEE 754 doubles.

## Example

```json
{
  "format": "eurekanvas/stroke",
  "version": 1,
  "bouts": [
    {
      "anchor": { "x": "3/2^-4", "y": "-5/2^700" },
      "zLevel": 12,
      "points": [[0, 0], [1.5, -2.25], [2, -3]]
    },
    {
      "anchor": { "x": "...", "y": "..." },
      "zLevel": 13,
      "points": [[0, 0], [0.75, 1]]
    }
  ]
}
```

(The `"..."` stands for the exact anchor of the second bout, which must equal the last point of the first one: see rule 2. Real documents contain the full values.)

## Fields

| Field | Type | Meaning |
| ----- | ---- | ------- |
| `format` | string | Always `"eurekanvas/stroke"`. |
| `version` | integer | `1`. A reader must reject any other value. |
| `bouts` | array | The bouts, in drawing order. May be empty (an empty stroke). |
| `bouts[i].anchor` | object | The exact world position of the bout's first point. `x` and `y` are **strings** (see below). |
| `bouts[i].zLevel` | integer | The zoom level at which this bout was drawn. Defines the unit of its offsets. |
| `bouts[i].points` | array | At least one point, each `[x, y]` of two finite numbers. |

A reader ignores unknown extra fields. Any change that is not backward compatible increases `version`.

### Dyadic strings

An anchor coordinate is written `"<n>/2^<e>"`, where `n` and `e` are integers in decimal (possibly negative), and means the exact value **n / 2^e**. Examples: `"3/2^-4"` is 48, `"5/2^3"` is 0.625, `"0/2^0"` is 0.

The grammar is `^(-?[0-9]+)/2\^(-?[0-9]+)$`. A writer should produce the canonical form (`n` odd, or `0/2^0`); a reader must accept any form and not rely on it being canonical.

## Meaning

- **World coordinates** are exact dyadic rationals. The unit is arbitrary (one world unit is one pixel at `zLevel` 0 with a zoom factor of 1). The **y axis points down**.
- A **local unit** of a bout is `2^-zLevel` world units.
- The exact world position of point `i` of a bout is

  ```
  position = anchor + points[i] * 2^-zLevel
  ```

  This is the **definition** of the stroke's geometry. Each `points[i]` is a double, hence itself a dyadic rational, so the position is exact.

## Rules

1. `points[0]` of every bout is `[0, 0]`: it is the anchor itself.
2. **Junction**: for every bout `k > 0`, its `anchor` is exactly the last point of bout `k - 1` (computed with the formula above). Consecutive bouts therefore touch with no gap. The anchor is redundant with the previous bout; it is stored so that each bout can be read on its own, and a reader must check it.
3. A reader must reject the document if any rule above or any type in the table is violated.

## Drawing a view of a stroke

A viewer shows the stroke through a camera: a centre (an exact world point), a zoom level `zLevel_c` (integer) and a factor in [1, 2), giving `scale = 2^zLevel_c * factor` screen pixels per world unit. The screen position of a point is

```
screen = viewportMiddle + (position - centre) * scale
```

The subtraction `position - centre` must be done **exactly** (with big integers). Its result is a small number for anything near the screen, and can then be converted to a double. Doing the subtraction in floating point is what fails at depth.

For a bout whose level is not far from the camera's, the whole bout can be placed with one float transformation, `origin + point * s` with `s = 2^(zLevel_c - zLevel) * factor` and `origin` the screen position of its anchor. This loses precision as the camera gets deeper than the bout; see the measurements in [noyau.md](./noyau.md).

## Limits

- Size, measured on a stroke of 10 000 points that goes 1 375 levels deep (1 376 bouts): 1 082 KiB, of which the anchors take 638 KiB (59 %). With gzip it is 403 KiB. Since every anchor but the first can be recomputed from the previous bout (rule 2), a future version could omit them and roughly halve the size; version 1 keeps them so that each bout can be read on its own.
- Standard vector formats (SVG, PDF) cannot hold such a stroke in one coordinate system. They are for exporting one view, not for storing the stroke.
