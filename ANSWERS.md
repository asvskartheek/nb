# Answers are visual

Every agent reply in the notebook (note comments, paper comments, Chats) is an **answer spec**: one JSON object the
page draws as a card. There is no prose field. `answer_spec.py` enforces this; the server rejects a reply that fails it,
asks the agent once more with the exact violations, and shows "could not visualise" if it fails again.

```json
{"headline": "Gains are noise, not a layer",
 "verdict": "null",
 "blocks": [
   {"type": "split", "unit": "q", "items": [{"label": "flaky before", "value": 9}, {"label": "stable", "value": 4}]},
   {"type": "delta", "label": "test/full", "before": 151, "after": 154, "unit": "q", "bl": "baseline", "al": "candidate"},
   {"type": "evidence", "refs": ["run 2026-03-02-a", ".research/models.json"]}],
 "replies": ["Show the 13 ids", "Compare with v1"]}
```

| field | rule |
|---|---|
| `headline` | required, at most 8 words: the answer itself |
| `verdict` | optional: yes, no, partly, null, unsure, win, loss |
| `blocks` | 1–6 blocks; at least one visual |
| `replies` | optional, at most 3 follow-ups of at most 6 words; the person clicks one |

Blocks: `bars`, `delta`, `split`, `line`, `flow`, `checks`, `compare` (the same shapes as notes, see SCHEMA.md),
`kpi` (`items: [{label, value, unit, n, before}]`), `table` (`cols`, `rows`, max 12 rows, cells at most 6 words),
`evidence` (`refs`: files, task ids, commits, note ids `n-…`, paper sections `§s3`), `tabs`
(`tabs: [{label, blocks}]`, no nesting) and `svg` (one `<svg>`, under 20 000 characters, no scripts, at most 40 words).

Labels are at most 5 words, check labels 9, flow steps 4. Any block with numbers needs an `evidence` block.

People reply visually too: a quick-reply chip, a pointed element or a drawn box (C, C then T), or a slash command in
the reply box: `/yes`, `/no`, `/unsure`, `/bars a=3, b=5`, `/delta label 151→154`. Short text is allowed.

```bash
python notebook/answer_spec.py reply.json   # violations, exit 1 if any
```
