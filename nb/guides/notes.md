# Notes

A note is one event: one fact, one timestamp, drawn rather than written. Notes live in `.notebook/notes/*.json`, each
file `{"threads": [...], "notes": [...], "patches": [...], "thread_patches": [...]}`; the page merges every file, so
add a file or append with `nb note add`. Ids are unique across files.

## Thread: a line of work (parallel lines render as parallel lanes)
```json
{"id": "t-eval-harness", "title": "Evaluation harness", "area": "eval",
 "start": "2026-03-02T10:00:00+01:00", "end": "2026-03-04T18:30:00+01:00",
 "parent": "t-baseline-or-null", "outcome": "win|null|loss|abandoned|ongoing|shipped"}
```
`area` is one of the project's areas (default setup, infra, data, eval, agent, retrieval, reading, model, cost,
latency, analysis, tooling, process; set `areas` in `.notebook/notebook.json`). A line of work that continues later
keeps its id; repeat the thread object in the file that continues it and the page merges them (earliest start,
latest end).

## Note
```json
{"id": "n-20260302-1405-baseline",
 "ts": "2026-03-02T14:05:00+01:00",
 "thread": "t-eval-harness",
 "kind": "setup|build|run|result|finding|decision|deadend|fix|question|milestone",
 "title": "Baseline on the full test set",
 "facts": ["≤3 fragments", "each ≤ 10 words", "no sentences"],
 "metrics": [{"label": "accuracy", "value": 71.4, "unit": "%", "n": 500, "before": 68.0, "ci": [67.4, 75.1]}],
 "viz": {"type": "bars", "unit": "%", "items": [{"label": "split A", "value": 71.4}, {"label": "split B", "value": 64.0}]},
 "refs": [{"type": "commit|branch|pr|file|run|task|paper|session|model", "value": "a1b2c3d"}],
 "after": ["n-…"],
 "status": "done|win|loss|null|abandoned|ongoing",
 "source": "git|transcript|ledger|file|memory"}
```

## Rules
- **No writing.** `title` ≤ 8 words. `facts` are fragments, max 3, max 10 words each. Numbers go in `metrics` or `viz`.
- **Real timestamps** from the source (commit, log line, run file, transcript), with the project's UTC offset.
- **Atomic.** A task with a start and a result is at least two notes (`run`, then `result`). A decision is its own note.
- **Every number names its n** and its slice or dataset, in `label` or `facts`.
- **`after`** links cause to effect (ids of the notes this one follows from), across files too.
- A note with 2+ numbers carries a `viz`. A paper is referenced with `{"type": "paper", "value": "<file stem>"}`.
- Private data stays out: no quoted documents, answers or personal data. File names, ids, counts and metrics are fine.

## viz
```json
{"type": "bars",   "unit": "%", "items": [{"label": "A", "value": 71.4}, {"label": "B", "value": 64.0}], "highlight": "A"}
{"type": "delta",  "unit": "%", "label": "accuracy", "before": 68.0, "after": 71.4, "bl": "v1", "al": "v2"}
{"type": "split",  "unit": "q", "items": [{"label": "misread", "value": 70}, {"label": "never opened", "value": 23}]}
{"type": "line",   "unit": "%", "points": [{"x": "v1", "y": 55}, {"x": "v2", "y": 62.8}]}
{"type": "flow",   "steps": ["fetch", "prepare", "eval", "report"]}
{"type": "checks", "items": [{"label": "parity on all files", "ok": true}, {"label": "p95 under 60 s", "ok": false}]}
{"type": "compare","a": "$/q", "b": "acc %", "rows": [{"label": "model A", "a": 0.006, "b": 73.2}]}
```

## Patches
Correct or link notes without rewriting another file: `"patches": [{"id": "n-…", "set": {...}, "add_after": ["n-…"]}]`,
`{"id": "n-…", "hide": true}` drops a duplicate from the page (it stays in its file), and
`"thread_patches": [{"id": "t-…", "set": {"outcome": "null"}}]` overrides thread fields.

`nb check` validates all of this.
