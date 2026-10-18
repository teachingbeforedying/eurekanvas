# Stroke format: `eurekanvas/stroke`, version 1

A stroke drawn while zooming can go hundreds of zoom levels deep. Positions that deep cannot be written as ordinary floating-point coordinates, so a stroke is stored as a sequence of **sections**: each section has an **exact anchor** and **small float offsets** from that anchor, together with the **thickness** of the stroke at each point.

This document specifies the JSON form. The reference implementation is `strokeToJSON` / `strokeFromJSON` in [`packages/engine/src/stroke.ts`](../packages/engine/src/stroke.ts). To read the anchors, a reader needs **arbitrary-precision integers** (`BigInt` in JavaScript, `int` in Python, `BigInteger` in Java, and so on). The offsets and widths are ordinary IEEE 754 doubles.

Version 1 has not been published yet and has no known reader, so it may still change before the first release.

## Example

```json
{
  "format": "eurekanvas/stroke",
  "version": 1,
  "sections": [
    {
      "anchor": { "x": "3/2^-4", "y": "-5/2^700" },
      "zLevel": 12,
      "points": [[0, 0, 1.5], [1.5, -2.25, 1.4], [2, -3, 1.3]]
    },
    {
      "anchor": { "x": "...", "y": "..." },
      "zLevel": 13,
      "points": [[0, 0, 2.6], [0.75, 1, 1.2]]
    }
  ]
}
```

(The `"..."` stands for the exact anchor of the second section, which must equal the last point of the first one: see rule 2. Real documents contain the full values.)

## Fields

| Field | Type | Meaning |
| ----- | ---- | ------- |
| `format` | string | Always `"eurekanvas/stroke"`. |
| `version` | integer | `1`. A reader must reject any other value. |
| `sections` | array | The sections, in drawing order. May be empty (an empty stroke). |
| `sections[i].anchor` | object | The exact world position of the section's first point. `x` and `y` are **strings** (see below). |
| `sections[i].zLevel` | integer | The zoom level at which this section was drawn. Defines the unit of its offsets and widths. |
| `sections[i].points` | array | At least one point, each `[x, y, width]` of three finite numbers, `width` > 0. |

A reader ignores unknown extra fields. Any change that is not backward compatible increases `version`.

### Dyadic strings

An anchor coordinate is written `"<n>/2^<e>"`, where `n` and `e` are integers in decimal (possibly negative), and means the exact value **n / 2^e**. Examples: `"3/2^-4"` is 48, `"5/2^3"` is 0.625, `"0/2^0"` is 0.

The grammar is `^(-?[0-9]+)/2\^(-?[0-9]+)$`. A writer should produce the canonical form (`n` odd, or `0/2^0`); a reader must accept any form and not rely on it being canonical.

## Meaning

- **World coordinates** are exact dyadic rationals. The unit is arbitrary (one world unit is one pixel at `zLevel` 0 with a zoom factor of 1). The **y axis points down**.
- A **local unit** of a section is `2^-zLevel` world units.
- The exact world position of point `i` of a section is

  ```
  position = anchor + points[i].xy * 2^-zLevel
  ```

  This is the **definition** of the stroke's geometry. Each coordinate is a double, hence itself a dyadic rational, so the position is exact.
- `points[i].width` is the thickness of the stroke at that point, in local units: the world thickness is `width * 2^-zLevel`. A writer picks it so that the stroke is a constant number of pixels thick on the screen at the moment it is drawn (`width = pixels / factor`, with `factor` the camera's zoom factor in [1, 2)). Seen from elsewhere, the stroke therefore gets thinner as it goes deeper, smoothly.
- Between two consecutive points the thickness varies linearly: the stroke is the union, over the segments, of the **convex hull of two discs** (one at each point, with diameter `width`). The ends and the joints are round.

## Rules

1. The first point of every section is `[0, 0, width]`: it is the anchor itself.
2. **Junction**: for every section `k > 0`, its `anchor` is exactly the last point of section `k - 1` (computed with the formula above), and the width of its first point is the width of that last point expressed at the new level: `width * 2^(zLevel_k - zLevel_(k-1))`. Consecutive sections therefore touch with no gap and no step in thickness. The anchor and the width are redundant with the previous section; they are stored so that each section can be read on its own, and a reader must check them.
3. A reader must reject the document if any rule above or any type in the table is violated.

## Drawing a view of a stroke

A viewer shows the stroke through a camera: a centre (an exact world point), a zoom level `zLevel_c` (integer) and a factor in [1, 2), giving `scale = 2^zLevel_c * factor` screen pixels per world unit. The screen position of a point is

```
screen = viewportMiddle + (position - centre) * scale
```

The subtraction `position - centre` must be done **exactly** (with big integers). Its result is a small number for anything near the screen, and can then be converted to a double. Doing the subtraction in floating point is what fails at depth.

For a section whose level is not far from the camera's, the whole section can be placed with one float transformation, `origin + point * s` with `s = 2^(zLevel_c - zLevel) * factor` and `origin` the screen position of its anchor; the widths scale the same way. This loses precision as the camera gets deeper than the section; see the measurements in [noyau.md](./noyau.md).

## Limits

- Size, measured on a stroke of 10 000 points that goes 1 375 levels deep (1 376 sections): 1 289 KiB, of which the anchors take 638 KiB (49 %). With gzip it is 501 KiB. Since every anchor but the first can be recomputed from the previous section (rule 2), a future version could omit them and save about half; version 1 keeps them so that each section can be read on its own.
- Standard vector formats (SVG, PDF) cannot hold such a stroke in one coordinate system. They are for exporting one view, not for storing the stroke.
