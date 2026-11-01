"""Projects: a research project is any folder with a `.notebook/` in it; the registry lists the ones `nb up` serves.

    <project>/.notebook/
      notebook.json        title, about, timezone, areas, headline series, evidence folders, agent command
      notebook.local.json  machine-specific overrides (untracked), e.g. evidence_root
      notes/*.json         {"threads": [...], "notes": [...], "patches": [...], "thread_patches": [...]}
      papers/*.html        papers, served with the notebook's theme, charts and comments
      discussion.jsonl     comment threads, append-only (untracked)
      shots/               screenshots of drawn comment boxes (untracked)

Registry: ~/.nb/projects.json = {name: root}; NB_HOME overrides ~/.nb.
"""
from __future__ import annotations

import json, os, re
from datetime import datetime, timedelta, timezone
from pathlib import Path

HOME = Path(os.environ.get("NB_HOME") or Path.home() / ".nb")
DOT = ".notebook"
AREAS = ["setup", "infra", "data", "eval", "agent", "retrieval", "reading", "model", "cost", "latency", "analysis",
         "tooling", "process"]
KINDS = ["setup", "build", "run", "result", "finding", "decision", "deadend", "fix", "question", "milestone"]
VIZ = ["bars", "delta", "split", "line", "flow", "checks", "compare"]
READ_ONLY = ("Read,Grep,Glob,Bash(git log:*),Bash(git show:*),Bash(git branch:*),Bash(ls:*),Bash(cat:*),"
             "Bash(head:*),Bash(wc:*)")
DEFAULTS = {
    "title": None,          # default: "<folder> · Research Notebook"
    "about": None,          # one line the agents read: what this project is
    "timezone": "+00:00",   # the project's local time, used for days and times on the page
    "areas": AREAS,         # groups for lines of work
    "kinds": KINDS,
    "headline": [],         # series on the headline chart: {"name", "label": regex, "exclude": regex, "n": [lo, hi]}
    "headline_skip": "",    # metric labels never on the headline chart (regex), e.g. retrieval scores
    "evidence": [],         # folders (under evidence_root) the agent should look in first
    "evidence_root": None,  # where the agent runs; default: the project root
    "agent": {"cmd": ["claude", "-p", "--output-format", "text", "--allowedTools", READ_ONLY],
              "parallel": 4, "budget_s": 900},
}


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "project"


# ---------- registry
def registry() -> dict[str, str]:
    try:
        return json.loads((HOME / "projects.json").read_text())
    except (OSError, ValueError):
        return {}


def register(name: str, root: Path) -> None:
    HOME.mkdir(parents=True, exist_ok=True)
    reg = registry() | {name: str(Path(root).resolve())}
    (HOME / "projects.json").write_text(json.dumps(reg, indent=2) + "\n")


def unregister(name: str) -> bool:
    reg = registry()
    if name not in reg:
        return False
    del reg[name]
    (HOME / "projects.json").write_text(json.dumps(reg, indent=2) + "\n")
    return True


def find(start: Path | None = None) -> "Project | None":
    """The project a folder belongs to: the nearest parent with a .notebook/."""
    p = Path(start or Path.cwd()).resolve()
    for d in [p, *p.parents]:
        if (d / DOT).is_dir():
            return Project(d)
    return None


def named(name: str) -> "Project | None":
    root = registry().get(name)
    return Project(Path(root), name) if root and (Path(root) / DOT).is_dir() else None


# ---------- one project
class Project:
    def __init__(self, root: Path, name: str | None = None):
        self.root = Path(root).resolve()
        self.dir = self.root / DOT
        self.name = name or next((k for k, v in registry().items() if Path(v) == self.root), slug(self.root.name))

    def __repr__(self):
        return f"Project({self.name!r}, {self.root})"

    @property
    def notes_dir(self) -> Path: return self.dir / "notes"
    @property
    def papers_dir(self) -> Path: return self.dir / "papers"
    @property
    def log(self) -> Path: return self.dir / "discussion.jsonl"
    @property
    def shots(self) -> Path: return self.dir / "shots"

    def config(self) -> dict:
        c = json.loads(json.dumps(DEFAULTS))
        for f in ("notebook.json", "notebook.local.json"):
            try:
                d = json.loads((self.dir / f).read_text())
            except (OSError, ValueError):
                continue
            for k, v in d.items():
                c[k] = c[k] | v if isinstance(c.get(k), dict) and isinstance(v, dict) else v
        c["title"] = c["title"] or f"{self.root.name} · Research Notebook"
        c["about"] = c["about"] or f"the {self.root.name} project"
        return c

    @property
    def evidence_root(self) -> Path:
        r = self.config().get("evidence_root")
        return Path(r).expanduser() if r else self.root

    def tz(self) -> timezone:
        m = re.fullmatch(r"([+-])(\d\d):?(\d\d)", self.config()["timezone"] or "+00:00")
        if not m:
            return timezone.utc
        sign = 1 if m[1] == "+" else -1
        return timezone(sign * timedelta(hours=int(m[2]), minutes=int(m[3])))

    def now(self) -> str:
        return datetime.now(self.tz()).isoformat(timespec="seconds")

    # ---------- notes: every notes/*.json merged; later files fill gaps, patches correct without rewriting a file
    def merged_notes(self) -> dict:
        threads, notes, seen, patches, tpatches = {}, [], set(), [], []
        for f in sorted(self.notes_dir.glob("*.json")):
            try:
                d = json.loads(f.read_text())
            except (OSError, ValueError) as e:
                print(f"skip {f.name}: {e}")
                continue
            for t in d.get("threads", []):
                cur = threads.get(t["id"])
                if not cur:
                    threads[t["id"]] = dict(t)
                    continue
                for k, v in t.items():  # spans widen; other fields fill gaps
                    if k == "start" and v and (not cur.get("start") or v < cur["start"]):
                        cur["start"] = v
                    elif k == "end" and v and (not cur.get("end") or v > cur["end"]):
                        cur["end"] = v
                    elif v and not cur.get(k):
                        cur[k] = v
            patches += d.get("patches", [])
            tpatches += d.get("thread_patches", [])
            for n in d.get("notes", []):
                if n.get("id") in seen:
                    continue
                seen.add(n.get("id"))
                n["_file"] = f.stem
                notes.append(n)
        by = {n["id"]: n for n in notes}
        for pt in patches:  # {"id", "set": {...}, "add_after": [ids], "hide": true}
            n = by.get(pt.get("id"))
            if not n:
                continue
            if pt.get("hide"):  # a duplicate of another note: dropped from the page, kept in its file
                n["_hidden"] = True
            n.update(pt.get("set") or {})
            n["after"] = list(dict.fromkeys((n.get("after") or []) + (pt.get("add_after") or [])))
        notes = [n for n in notes if not n.get("_hidden")]
        for pt in tpatches:  # {"id", "set": {...}}: overrides thread fields
            if pt.get("id") in threads:
                threads[pt["id"]].update(pt.get("set") or {})
        notes.sort(key=lambda n: n.get("ts", ""))
        return dict(threads=list(threads.values()), notes=notes)

    def check_notes(self) -> list[tuple[str, str, str]]:
        """(level, where, message) for every note and thread that breaks the notes guide."""
        c, out = self.config(), []
        nb = self.merged_notes()
        tids = {t["id"] for t in nb["threads"]}
        ids = {n["id"] for n in nb["notes"]}
        for t in nb["threads"]:
            if t.get("area") and t["area"] not in c["areas"]:
                out.append(("warn", t["id"], f"area {t['area']!r} is not one of the project's areas"))
        for n in nb["notes"]:
            out += [(lv, n.get("id", "?"), m) for lv, m in check_note(n, c["kinds"])]
            if n.get("thread") and n["thread"] not in tids:
                out.append(("warn", n["id"], f"thread {n['thread']!r} has no thread object (shown with a default title)"))
            for a in n.get("after") or []:
                if a not in ids:
                    out.append(("warn", n["id"], f"after: {a!r} is not a note"))
        return out


def check_note(n: dict, kinds=KINDS) -> list[tuple[str, str]]:
    out = []
    for k in ("id", "ts", "thread", "kind", "title"):
        if not n.get(k):
            out.append(("error", f"{k} missing"))
    try:
        if n.get("ts") and datetime.fromisoformat(n["ts"].replace("Z", "+00:00")).tzinfo is None:
            out.append(("error", "ts has no timezone offset"))
    except ValueError:
        out.append(("error", f"ts {n.get('ts')!r} is not ISO 8601"))
    if n.get("kind") and n["kind"] not in kinds:
        out.append(("error", f"kind {n['kind']!r} is not one of {', '.join(kinds)}"))
    if len(str(n.get("title", "")).split()) > 8:
        out.append(("warn", "title is over 8 words"))
    facts = n.get("facts") or []
    if len(facts) > 3:
        out.append(("warn", f"{len(facts)} facts, max 3"))
    for f in facts:
        if len(str(f).split()) > 10:
            out.append(("warn", f"fact over 10 words: {str(f)[:40]!r}"))
    v = n.get("viz")
    if v and v.get("type") not in VIZ:
        out.append(("error", f"viz type {v.get('type')!r} is not one of {', '.join(VIZ)}"))
    if len(n.get("metrics") or []) >= 2 and not v:
        out.append(("warn", "2+ metrics and no viz"))
    return out
