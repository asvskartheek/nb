# nb: research notebooks for any project

A lab notebook a staff scientist would keep, for every project you work on, written by you and your agents:

- **The notebook.** Atomic, timestamped notes (one event each) drawn as tiles and charts, grouped into lines of work
  that render as parallel lanes, with a headline chart and cause → effect links. No prose.
- **Papers.** One result explained from zero through visuals and interactions only, served next to the notebook.
- **Margin comments, answered by agents.** Comment Google Docs style on any note or paper: select text, press **C** to
  pick any element, or **C then T** to draw a box (its screenshot goes to the agent). Each thread gets its own agent,
  several at once, and every answer is a visual card (headline, verdict, charts, evidence) that expands to full size.
  You reply with quick-reply chips, `/yes` `/no` `/bars a=3, b=5` `/delta label 1→2`, short text, or by pointing.

Everything lives in the project's own `.notebook/` folder; one local server serves all your projects.

## Install
```bash
uv tool install git+https://github.com/asvskartheek/nb
```

## Use
```bash
cd my-project
nb init --title "My project · Research Notebook" --about "the my-project agent"   # .notebook/, AGENTS.md, CLAUDE.md
nb up                                                # http://127.0.0.1:8765/  (every registered project)
echo '{"thread": "t-baseline", "kind": "result", "title": "Baseline on the test set",
       "metrics": [{"label": "accuracy", "value": 71.4, "unit": "%", "n": 500}]}' | nb note add
nb paper new baseline --title "How the baseline works"
nb check
```

| command | does |
|---|---|
| `nb init [PATH]` | creates `.notebook/` (config, notes, papers), registers the project, writes the notebook rules into `AGENTS.md` and a pointer into `CLAUDE.md` |
| `nb up` / `nb down` | one background server for every registered project, at `/p/<name>/` |
| `nb note add [FILE]` | appends checked notes (JSON on stdin) to `.notebook/notes/log.json`; id and timestamp filled in when missing |
| `nb paper new NAME` | a starter paper that already follows the rules |
| `nb check` | validates notes, papers and stored agent answers |
| `nb answer-check [FILE]` | validates one answer spec |
| `nb guide [notes\|answers\|papers\|backfill\|agents]` | the rules, for people and agents |
| `nb projects [add PATH \| rm NAME]` | the registry (`~/.nb/projects.json`) |

## A project's `.notebook/`
```
notebook.json        title, about, timezone, areas, headline series, evidence folders, agent command
notebook.local.json  this machine's overrides, e.g. evidence_root (untracked)
notes/*.json         notes and lines of work (merged; later files patch earlier ones)
papers/*.html        papers
discussion.jsonl     comment threads (untracked)
shots/               screenshots of drawn comment boxes (untracked)
```

`notebook.json`, all optional:
```json
{"title": "My project · Research Notebook",
 "about": "the my-project agent",
 "timezone": "+05:30",
 "areas": ["setup", "data", "eval", "model", "analysis"],
 "headline": [{"name": "Accuracy · test 500", "label": "^accuracy", "n": [500, 500]}],
 "headline_skip": "recall|coverage",
 "evidence": ["runs/", "experiments/", "logs/"],
 "agent": {"cmd": ["claude", "-p", "--output-format", "text", "--allowedTools", "Read,Grep,Glob"], "parallel": 4, "budget_s": 900}}
```
The agent command gets the prompt on stdin and answers on stdout, so any CLI agent works (for example
`["codex", "exec", "-"]`). It runs in `evidence_root` (default: the project root).

## Any agent
`nb init` puts a short **Research notebook (nb)** section in `AGENTS.md` (and a pointer in `CLAUDE.md`): log work as
atomic notes with `nb note add`, explain results with visual papers, answer comments with visual specs, run
`nb check`. The full rules are in `nb guide`. To turn an existing project's history into a notebook, see
`nb guide backfill`.

## Layout
```
nb/cli.py         the nb command        nb/server.py   one server, every project
nb/project.py     projects, config, notes merge and checks
nb/chat.py        comment threads and the agents that answer them
nb/answer_spec.py the rule every agent answer passes
nb/web/           the notebook page, viz.js (charts), comments.js/css (margin comments), style.css (theme)
nb/guides/        notes, answers, papers, backfill, agents      nb/templates/paper.html
```
No build step and no dependencies beyond Python 3.10.

## License
MIT
