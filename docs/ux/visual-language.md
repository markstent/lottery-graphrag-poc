# Visual Language

This page documents the light design system as built in `frontend/src/index.css` (the `@theme` block) and `frontend/src/design/`.
`tokens.ts` holds typed copies of every `@theme` value, and `tokens.test.ts` fails if the two drift apart or if a contrast rule is broken.

Tone: calm, restrained, technically credible and data-first.
Primary graph is 2D and evidence-led.
No neon, glow, glass blur, gratuitous 3D or decorative gradients.

## Surfaces and neutrals

| Token | Value | Use |
|---|---|---|
| `--color-surface` | `#ffffff` | Cards, panels, charts |
| `--color-background` | `#f6f7f9` | Page |
| `--color-surface-raised` | `#eef0f3` | Inset or nested areas |
| `--color-border` | `#7f8692` | Borders that matter (3:1 or stronger on all three surfaces) |
| `--color-hairline` | `#e3e6eb` | Decorative dividers only, never the sole edge of a control |

The grey scale is `--color-grey-50` to `--color-grey-900` (50, 100, 200 and so on up to 900).
Text uses `--color-text-primary` (`#12151b`), `--color-text-secondary` (`#454c58`) and `--color-text-muted` (`#596170`), each at 4.5:1 or better on every surface.
`--color-focus` (`#12151b`) draws the focus ring.
Elevation is by shadow only for drawers and menus (`--shadow-overlay`).
Cards use background contrast instead of borders where it suffices.
Spacing follows an 8 pixel grid.
Icons come from one set, `lucide-react`.

## Typography

Inter Variable, loaded through `@fontsource-variable/inter` in `main.tsx`.
The scale is 12, 14, 16, 20, 28 and 40 pixels, exposed as `--text-xs`, `--text-sm`, `--text-base`, `--text-lg`, `--text-xl` and `--text-2xl`.
Scores and any column of figures use the `.tabular` utility (`font-variant-numeric: tabular-nums`).

## Pipelines

Each pipeline has one fixed colour, used everywhere, in three tones.

| Pipeline | Hue (marks, fills) | Tint (backgrounds) | Strong (text, thin lines) |
|---|---|---|---|
| A · Text search | `#2a78d6` | `#e5effa` | `#1c5cab` |
| B · Graph | `#a86e00` | `#f5eee0` | `#7a5000` |
| C · Graph + Ontology | `#c4358f` | `#f8e7f2` | `#a02574` |

The hues carry no meaning in the status palette: no red or green is used for a pipeline.
B's gold sits near the warning yellow, so status is always shown with an icon and a label, never by hue alone.
Every hue reaches 3:1 as a mark on white, on the page, on the inset surface and on its own tint, and the tests enforce it.
The strong tone is for text and thin lines.
The v1 names `--color-baseline`, `--color-graph` and `--color-ontology` remain until the Phase 6 rebuild and map to the strong tones of A, B and C.

## Palette validation

The pipeline hues were chosen with the project's data visualisation method.
They are checked with `validate_palette.js` against the white chart surface, with `--pairs all`.
B's contrast was re-run on the page (`#f6f7f9`) and the inset surface (`#eef0f3`) too, and passes there as well.
The output below is for white because any two pipelines can sit side by side.
Teal and violet candidates failed the colour-blind and chroma checks against blue, which is why B is gold and C is magenta.

```text
Palette (light, surface #ffffff, categorical): 3 slots
  [PASS] Lightness band         all 3 inside L 0.43–0.77
  [PASS] Chroma floor           all 3 >= 0.1
  [PASS] CVD separation         worst all-pairs #c4358f↔#2a78d6 ΔE 13.0 (protan) · tritan 8.9
  [PASS] Normal-vision floor    worst all-pairs #c4358f↔#a86e00 ΔE 22.8 (normal)
  [PASS] Contrast vs surface    all 3 >= 3:1

  → ALL CHECKS PASS  (CVD in the 6–8 floor band is legal ONLY with secondary encoding: direct labels, gaps, or texture)
  scope: categorical palettes only. For a lone status/text color check WCAG text contrast; for a sequential ramp, lightness monotonicity.
```

The market colours are a separate categorical set.
They are always shown with their code (UK, GR, AT, CZ), so hue is never the only cue.
They validate in the order UK, GR, AT, CZ (adjacent pairs, as in stacked bars and legends).
They do not validate all-pairs: brown (UK) and olive (CZ) are too close for four marks that may touch in any order.
The distances below were measured once with the validator's normal-vision metric when the colours were chosen, and no test enforces them: each market colour is at least 15 apart from A, B and C, and at least 13 from the status colours.

## Status

Status colours are reserved and never used for pipelines or markets.
Market and status colours are marks and fills only, never text; a test scans `src` for text use.
Text on a status fill is `--color-text-primary` on good, warning and serious, and white (`--color-surface`) on critical.
The fills are `--color-status-good` `#0ca30c`, `--color-status-warning` `#fab219`, `--color-status-serious` `#ec835a` and `--color-status-critical` `#d03b3b`, always paired with an icon and a label.
Where status is text, use `--color-success` `#006300`, `--color-warning` `#8a5a00` and `--color-error` `#b42323`, which meet 4.5:1.

## Evidence states

Seven states, each with its own shape and its own icon, so colour is never the only cue.
Fill and stroke are tokens (`--color-state-<name>-fill` and `-stroke`).

| State | Label | Shape | Icon | Fill | Stroke |
|---|---|---|---|---|---|
| seed | Starting point | circle | LocateFixed | `#ffffff` | `#12151b` |
| traversed | Followed | square | ArrowRight | `#e3e6eb` | `#454c58` |
| candidate | Considered | diamond | Search | `#ffffff` | `#7f8692` |
| selected | Used as evidence | hexagon | Check | `#12151b` | `#12151b` |
| discarded | Set aside | dashed circle | CircleMinus | `#f6f7f9` | `#7f8692` |
| concept | Ontology concept | pill | Shapes | `#f8e7f2` | `#a02574` |
| source_record | Source record | document | FileText | `#ffffff` | `#454c58` |

Set aside is grey and dashed, because it is not an error.
A concept is the ontology layer, so it wears C's tones with its own shape.

## Contrast

WCAG ratios, computed from the token values.
`tokens.test.ts` enforces these checks:

- Text tokens at 4.5:1 on the three surfaces, on the three pipeline tints and on the concept, followed and set-aside fills.
- Ink on the good, warning and serious fills, and white on the critical fill, at 4.5:1.
- The border token at 3:1 on the three surfaces.
- Pipeline hues at 3:1 on the three surfaces and on their own tint.
- Evidence-state strokes at 3:1 on their fill and on the three surfaces (for selected, whose fill equals its stroke, the fill is checked against the surfaces).
- The focus ring at 3:1 on the three surfaces and on every tint.
- Market and status colours are never used as text in `src`.

The market colour palette check and the status and market distances are not covered by tests.

| Token | background #f6f7f9 | surface #ffffff | surface-raised #eef0f3 |
|---|---|---|---|
| focus #12151b | 17.05 | 18.28 | 16.01 |
| text-primary #12151b | 17.05 | 18.28 | 16.01 |
| text-secondary #454c58 | 8.07 | 8.65 | 7.58 |
| text-muted #596170 | 5.82 | 6.23 | 5.46 |
| success #006300 | 7.04 | 7.54 | 6.61 |
| warning #8a5a00 | 5.53 | 5.93 | 5.19 |
| error #b42323 | 6.11 | 6.55 | 5.74 |
| pipeline-a-strong #1c5cab | 6.18 | 6.63 | 5.81 |
| pipeline-b-strong #7a5000 | 6.59 | 7.06 | 6.18 |
| pipeline-c-strong #a02574 | 6.51 | 6.97 | 6.11 |
| border #7f8692 (3:1 needed) | 3.42 | 3.67 | 3.21 |
| pipeline-a #2a78d6 (3:1) | 4.12 | 4.42 | 3.87 |
| pipeline-b #a86e00 (3:1) | 4.00 | 4.29 | 3.76 |
| pipeline-c #c4358f (3:1) | 4.61 | 4.94 | 4.32 |

Other pairs:

| Pair | Ratio |
|---|---|
| pipeline-a-strong on tint #e5effa | 5.70 |
| pipeline-b-strong on tint #f5eee0 | 6.11 |
| pipeline-c-strong on tint #f8e7f2 | 5.88 |
| background on pipeline-a-strong | 6.18 |
| background on pipeline-b-strong | 6.59 |
| background on pipeline-c-strong | 6.51 |
| pipeline-a on tint | 3.80 |
| pipeline-b on tint | 3.72 |
| pipeline-c on tint | 4.16 |
| text-primary on status-good | 5.45 |
| text-primary on status-warning | 9.96 |
| text-primary on status-serious | 6.93 |
| white on status-critical | 4.80 |
| text-muted on discarded fill | 5.82 |
| text-muted on concept fill | 5.26 |

## Motion and accessibility

Animation explains system state only, and collapses to near-instant under `prefers-reduced-motion` or the `.reduced-motion` class.
The classes `.presentation`, `.node-reveal`, `.panel-reveal` and `.label-halo` are unchanged.
Focus states are always visible, status never relies on colour alone, and graph information needs a text alternative.
