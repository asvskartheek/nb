# Papers

A paper explains one result from zero, for someone who joined yesterday. It is a playground, not a document:
the story is told by visuals and interactions, never by paragraphs. Papers live in `.notebook/papers/<name>.html`,
are listed at `/p/<project>/papers/`, and every one is commentable (margin comments answered by agents).

Start from the template: `nb paper new <name> --title "…"`, then `nb check`.

## Non-negotiables
- **Self-contained and consistent.** One HTML file; data inline. Every term is defined on the page (a glossary panel or
  hover definitions); every number agrees across sections and with its source.
- **Visual only.** Text is limited to headings, axis labels, legends, captions of ≤ 12 words, control labels and
  tooltips. No paragraphs. Every number sits in a visual with its n and its slice or dataset named.
- **Interactive.** Steppers, toggles, sliders, filters, hover and click-to-expand: the reader explores, not reads.
- **Honest.** A result that did not pass its gate says so, visually, where the result is shown.
- **The shared look.** Link `../style.css` for the theme tokens (light and dark, toggled with the `nb-theme` key) and
  `../viz.js` for the same charts the notes use (`NBViz.viz(spec, color)`, `NBViz.spec(answer)`).
- **Commentable.** Include `../comments.css`, `../viz.js` and `../comments.js`, and put every part of the story in a
  `<section id="…">` with an `<h2>`: comments anchor to sections, selected text, picked elements and drawn boxes.
- **Readable everywhere.** Contrast checked in both themes; works down to 375 px wide with no horizontal scroll.
- **Private data stays private.** Use synthetic illustrations instead of real documents; ids, counts and metrics are fine.

## Shape that works
Hero with the headline result and its verdict → the problem → one example end to end (a stepper) → what each part
adds (toggles) → how results are judged (noise, gates) → the full explorer (every item, filterable) → cost and
latency → headroom and next steps → timeline → appendices (lineage, per-slice tables, reproduction, definitions).

Link the paper from a notebook note: `"refs": [{"type": "paper", "value": "<name>"}]`.
