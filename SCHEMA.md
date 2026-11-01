# Research notebook: note schema

One JSON file per era: `notebook/data/notes-<era>.json` =
`{"threads": [Thread...], "notes": [Note...]}`. The site merges all files; ids must be globally unique.

## Thread (a line of work; parallel threads render as parallel lanes)
```json
{"id": "t-benchmark-pipeline", "title": "Benchmark pipeline", "area": "infra",
 "start": "2026-10-16T03:50:00+05:30", "end": "2026-10-17T21:04:00+05:30",
 "parent": "t-other-thread-or-null", "outcome": "win|null|loss|abandoned|ongoing|shipped"}
```
`area` is one of: `setup`, `infra`, `eval`, `agent`, `retrieval`, `reading`, `cost`, `latency`, `data`, `model`, `analysis`, `tooling`, `process`.
Thread ids are reused across files when the same line of work continues; repeat the thread object (same id) in each file that uses it, the site merges them (earliest start, latest end).

## Note (atomic: one event, one fact, one timestamp)
```json
{
 "id": "n-20260925-1635-init",
 "ts": "2026-09-25T16:35:22+05:30",
 "thread": "t-project-setup",
 "kind": "setup|build|run|result|decision|finding|deadend|fix|question|milestone",
 "title": "Repo initialised",
 "facts": ["≤3 fragments", "each ≤ 10 words", "no sentences, no prose"],
 "metrics": [{"label": "accuracy", "value": 62.8, "unit": "%", "n": 309, "before": 60.1, "ci": [57.3, 68.0]}],
 "viz": { ... optional, see below ... },
 "refs": [{"type": "commit|branch|pr|file|run|task|paper|session|model", "value": "d5d487c"}],
 "after": ["n-...", "n-..."],
 "status": "done|win|loss|null|abandoned|ongoing",
 "source": "git|transcript|ledger|file|memory"
}
```

### Rules
- **No writing.** `title` ≤ 8 words, a noun phrase or terse verb phrase ("Baseline on 30 test items"). `facts` are fragments, max 3, max 10 words each. Numbers go in `metrics` or `viz`, never buried in text.
- **Real timestamps only**, from the source (commit date, ledger `t`, transcript `timestamp`, file mtime). Local time `+05:30`. Transcript timestamps are UTC (`Z`): convert to +05:30.
- **Atomic.** A task with a start and a result = at least two notes (`run` then `result`). A decision gets its own note.
- **Every measured number** gets `n` when known and the dataset/slice name in `label` or `facts`.
- **`after`**: ids of notes this one directly follows from (cause → effect). Cross-era links are fine.
- **Client data:** never quote question text, answers, or document contents. Filenames, tags (e.g. `PDIC-1128`), counts, metrics are fine.
- Prefer 1 visual per result note. A note with ≥2 numbers should carry a `viz`.

### viz types
```json
{"type": "bars",  "unit": "%", "items": [{"label": "split A", "value": 62.8}, {"label": "split B", "value": 78.1}]}
{"type": "delta", "unit": "%", "label": "accuracy", "before": 62.8, "after": 66.0, "bl": "v2", "al": "v3"}
{"type": "split", "unit": "q", "items": [{"label": "misread", "value": 70}, {"label": "never opened", "value": 23}]}
{"type": "line",  "unit": "%", "points": [{"x": "v1", "y": 55}, {"x": "v2", "y": 62.8}]}
{"type": "flow",  "steps": ["fetch", "prepare", "eval", "report"]}
{"type": "checks","items": [{"label": "parity on all files", "ok": true}, {"label": "p95 < 60s", "ok": false}]}
{"type": "compare","unit": "$/q", "rows": [{"label": "model A", "a": 0.0064, "b": 73.2}], "a": "cost", "b": "acc %"}
```

## Patches (review pass)
A notes file may also carry `"patches": [{"id": "n-...", "set": {"title": "...", "status": "win"}, "add_after": ["n-..."]}]`.
`set` overwrites fields of an existing note from another file; `add_after` appends cause links. Use this to fix or link
existing notes; never edit another era's file.
A patch may be `{"id": "n-...", "hide": true}` to drop a duplicate note from the page (it stays in its file).
`"thread_patches": [{"id": "t-...", "set": {"outcome": "null"}}]` overrides thread fields.
