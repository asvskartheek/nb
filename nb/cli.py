"""nb: research notebooks for any project.

    nb init [PATH] [--name N] [--title T] [--about A] [--timezone +HH:MM] [--no-agents]
    nb up [--port 8765] [--host 127.0.0.1] [--agents 4] [--fg]     serve every registered project
    nb down                                                         stop the background server
    nb projects [add PATH | rm NAME]
    nb note add [FILE]          note or {"threads", "notes"} JSON (stdin by default), checked, appended to notes/log.json
    nb paper new NAME [--title T]
    nb check                    notes, papers and stored answers of the current project
    nb answer-check [FILE]      one answer spec (stdin by default)
    nb guide [notes|answers|papers|backfill|agents]
    nb open                     the current project's notebook URL
"""
from __future__ import annotations

import argparse, json, os, re, signal, subprocess, sys, time
from pathlib import Path

from . import answer_spec, chat, project

PKG = Path(__file__).resolve().parent
GUIDES = PKG / "guides"
MARK_START, MARK_END = "<!-- nb:start -->", "<!-- nb:end -->"
SERVER = project.HOME / "server.json"


def die(msg: str, code: int = 1):
    print(msg, file=sys.stderr)
    sys.exit(code)


def here() -> project.Project:
    p = project.find()
    if not p:
        die("not inside a project with a .notebook/ (run `nb init`)")
    return p


def url(p: project.Project | None = None) -> str:
    try:
        s = json.loads(SERVER.read_text())
        base = f"http://{s['host']}:{s['port']}/"
    except (OSError, ValueError, KeyError):
        base = "http://127.0.0.1:8765/"
    return base + (f"p/{p.name}/" if p else "")


# ---------- init
def block_into(f: Path, block: str):
    """Put the notebook block in a file between markers, replacing an older block; create the file if missing."""
    text = f.read_text() if f.exists() else ""
    wrapped = f"{MARK_START}\n{block.strip()}\n{MARK_END}\n"
    if MARK_START in text and MARK_END in text:
        text = re.sub(re.escape(MARK_START) + r".*?" + re.escape(MARK_END) + r"\n?", wrapped, text, flags=re.S)
    else:
        text = (text.rstrip() + "\n\n" if text.strip() else "") + wrapped
    f.write_text(text)


def cmd_init(a):
    root = Path(a.path or ".").resolve()
    d = root / project.DOT
    for sub in ("notes", "papers"):
        (d / sub).mkdir(parents=True, exist_ok=True)
    cfg = d / "notebook.json"
    if not cfg.exists():
        c = {"title": a.title or f"{root.name} · Research Notebook", "about": a.about or f"the {root.name} project",
             "timezone": a.timezone or time.strftime("%z")[:3] + ":" + time.strftime("%z")[3:], "evidence": []}
        cfg.write_text(json.dumps(c, indent=2) + "\n")
    gi = d / ".gitignore"
    if not gi.exists():
        gi.write_text("discussion.jsonl\nshots/\nnotebook.local.json\ncache/\n")
    name = a.name or project.slug(root.name)
    project.register(name, root)
    if not a.no_agents:  # any agent: AGENTS.md carries the rules, CLAUDE.md points at them
        block_into(root / "AGENTS.md", (GUIDES / "agents.md").read_text())
        block_into(root / "CLAUDE.md", "Research notebook: follow the `Research notebook (nb)` section of AGENTS.md.")
    print(f"notebook in {d}\nregistered as {name!r}\n{url(project.Project(root, name))}  (start it with `nb up`)")


# ---------- server
def running() -> dict | None:
    try:
        s = json.loads(SERVER.read_text())
        os.kill(s["pid"], 0)
        return s
    except (OSError, ValueError, KeyError, ProcessLookupError):
        return None


def cmd_up(a):
    if a.fg:
        from . import server
        project.HOME.mkdir(parents=True, exist_ok=True)
        SERVER.write_text(json.dumps(dict(pid=os.getpid(), host=a.host, port=a.port)))
        return server.serve(a.host, a.port, a.agents)
    s = running()
    if s:
        return print(f"already running: http://{s['host']}:{s['port']}/")
    project.HOME.mkdir(parents=True, exist_ok=True)
    log = open(project.HOME / "server.log", "ab")
    subprocess.Popen([sys.executable, "-m", "nb", "up", "--fg", "--host", a.host, "--port", str(a.port),
                      "--agents", str(a.agents)], stdout=log, stderr=log, stdin=subprocess.DEVNULL, start_new_session=True)
    for _ in range(50):
        time.sleep(0.1)
        if running():
            break
    print(f"http://{a.host}:{a.port}/")
    for name in project.registry():
        print(f"  {name}: http://{a.host}:{a.port}/p/{name}/")


def cmd_down(a):
    s = running()
    if not s:
        return print("not running")
    os.kill(s["pid"], signal.SIGTERM)
    SERVER.unlink(missing_ok=True)
    print("stopped")


def cmd_projects(a):
    if a.verb == "add":
        root = Path(a.arg or ".").resolve()
        if not (root / project.DOT).is_dir():
            die(f"{root} has no .notebook/ (run `nb init` there)")
        name = a.name or project.slug(root.name)
        project.register(name, root)
        return print(f"registered {name!r}")
    if a.verb == "rm":
        return print("removed" if project.unregister(a.arg or "") else f"no project {a.arg!r}")
    for name, root in sorted(project.registry().items()):
        ok = (Path(root) / project.DOT).is_dir()
        print(f"{name:24} {root}{'' if ok else '  (missing)'}")


# ---------- notes
def cmd_note(a):
    p = here()
    raw = Path(a.file).read_text() if a.file and a.file != "-" else sys.stdin.read()
    try:
        d = json.loads(raw)
    except ValueError as e:
        die(f"not JSON: {e}")
    payload = d if isinstance(d, dict) and ("notes" in d or "threads" in d) else {"notes": d if isinstance(d, list) else [d]}
    kinds = p.config()["kinds"]
    existing = {n["id"] for n in p.merged_notes()["notes"]}
    for n in payload.get("notes", []):
        n.setdefault("ts", p.now())
        if not n.get("id"):
            stamp = re.sub(r"[-:T]", "", n["ts"][:16])
            n["id"] = f"n-{stamp[:8]}-{stamp[8:12]}-{project.slug(n.get('title', 'note'))[:32]}"
        errors = [m for lv, m in project.check_note(n, kinds) if lv == "error"]
        if n["id"] in existing:
            errors.append(f"id {n['id']!r} already exists")
        if errors:
            die(f"note {n.get('id')}: " + "; ".join(errors))
        for lv, m in project.check_note(n, kinds):
            print(f"warn {n['id']}: {m}", file=sys.stderr)
    f = p.notes_dir / "log.json"
    cur = json.loads(f.read_text()) if f.exists() else {"threads": [], "notes": []}
    known = {t["id"] for t in cur.get("threads", [])}
    cur.setdefault("threads", []).extend(t for t in payload.get("threads", []) if t.get("id") not in known)
    cur.setdefault("notes", []).extend(payload.get("notes", []))
    p.notes_dir.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(cur, indent=1, ensure_ascii=False) + "\n")
    for n in payload.get("notes", []):
        print(n["id"])


# ---------- papers
def cmd_paper(a):
    p = here()
    if not re.fullmatch(r"[A-Za-z0-9][\w.-]*", a.name or ""):
        die("a paper name is letters, digits, dot, dash or underscore")
    f = p.papers_dir / f"{a.name}.html"
    if f.exists():
        die(f"{f} exists")
    p.papers_dir.mkdir(parents=True, exist_ok=True)
    f.write_text((PKG / "templates" / "paper.html").read_text().replace("{{title}}", a.title or a.name))
    print(f"{f}\n{url(p)}papers/{a.name}.html\nrules: nb guide papers")


def check_paper(f: Path) -> list[tuple[str, str]]:
    h, out = f.read_text(errors="replace"), []
    body = re.sub(r"<script\b.*?</script>|<style\b.*?</style>", "", h, flags=re.S | re.I)
    for need in ("../comments.js", "../viz.js", "../comments.css"):
        if need not in h:
            out.append(("error", f"does not include {need}: comments and shared charts need it"))
    if not re.search(r"<section\b[^>]*\bid=", body, re.I):
        out.append(("error", "no <section id=…>: comments anchor to sections"))
    if 'data-theme="dark"' not in h and "../style.css" not in h:
        out.append(("error", "no dark mode: link ../style.css or style :root[data-theme=\"dark\"]"))
    for m in re.finditer(r"<p\b[^>]*>(.*?)</p>", body, re.S | re.I):
        words = len(re.sub(r"<[^>]+>", " ", m.group(1)).split())
        if words > 25:
            out.append(("warn", f"a {words}-word paragraph: papers are visual (captions ≤ 12 words)"))
    return out


def cmd_check(a):
    p = here()
    rows = [(lv, f"note {w}", m) for lv, w, m in p.check_notes()]
    for f in sorted(p.papers_dir.glob("*.html")):
        rows += [(lv, f"paper {f.name}", m) for lv, m in check_paper(f)]
    bad = 0
    for t in chat.threads(p):
        for m in t["messages"]:
            if m["agent"] and m.get("spec") and not m.get("error") and answer_spec.check(m["spec"]):
                bad += 1
    if bad:
        rows.append(("warn", "answers", f"{bad} stored agent answers no longer pass the answer rules"))
    for lv, w, m in rows:
        print(f"{lv:5} {w}: {m}")
    errs = sum(lv == "error" for lv, _, _ in rows)
    n = len(p.merged_notes()["notes"])
    print(f"{n} notes, {len(list(p.papers_dir.glob('*.html')))} papers: {errs} errors, {len(rows) - errs} warnings")
    sys.exit(1 if errs else 0)


def cmd_answer_check(a):
    raw = Path(a.file).read_text() if a.file and a.file != "-" else sys.stdin.read()
    spec = answer_spec.extract(raw)
    problems = answer_spec.check(spec) if spec is not None else ["no JSON object found"]
    for x in problems:
        print(x)
    print(f"{len(problems)} violations")
    sys.exit(1 if problems else 0)


def cmd_guide(a):
    names = sorted(f.stem for f in GUIDES.glob("*.md"))
    if not a.topic:
        return print("guides: " + ", ".join(names) + "\n  nb guide <name>")
    f = GUIDES / f"{a.topic}.md"
    if not f.exists():
        die(f"no guide {a.topic!r}; guides: {', '.join(names)}")
    print(f.read_text())


def cmd_open(a):
    print(url(here()))


def main(argv=None):
    ap = argparse.ArgumentParser(prog="nb", description="Research notebooks for any project.")
    sp = ap.add_subparsers(dest="cmd", required=True)
    s = sp.add_parser("init", help="create .notebook/ here (or at PATH) and register it")
    s.add_argument("path", nargs="?"); s.add_argument("--name"); s.add_argument("--title"); s.add_argument("--about")
    s.add_argument("--timezone", help="+HH:MM; default: this machine's"); s.add_argument("--no-agents", action="store_true",
                   help="do not write the notebook rules into AGENTS.md / CLAUDE.md")
    s.set_defaults(fn=cmd_init)
    s = sp.add_parser("up", help="serve every registered project (background)")
    s.add_argument("--port", type=int, default=8765); s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--agents", type=int, default=4, help="comment threads answered at once")
    s.add_argument("--fg", action="store_true", help="run in the foreground")
    s.set_defaults(fn=cmd_up)
    sp.add_parser("down", help="stop the background server").set_defaults(fn=cmd_down)
    s = sp.add_parser("projects", help="list, add or remove registered projects")
    s.add_argument("verb", nargs="?", choices=["ls", "add", "rm"], default="ls"); s.add_argument("arg", nargs="?")
    s.add_argument("--name"); s.set_defaults(fn=cmd_projects)
    s = sp.add_parser("note", help="add notes")
    s.add_argument("verb", choices=["add"]); s.add_argument("file", nargs="?"); s.set_defaults(fn=cmd_note)
    s = sp.add_parser("paper", help="start a paper from the template")
    s.add_argument("verb", choices=["new"]); s.add_argument("name"); s.add_argument("--title"); s.set_defaults(fn=cmd_paper)
    sp.add_parser("check", help="validate notes, papers and stored answers").set_defaults(fn=cmd_check)
    s = sp.add_parser("answer-check", help="validate one answer spec")
    s.add_argument("file", nargs="?"); s.set_defaults(fn=cmd_answer_check)
    s = sp.add_parser("guide", help="print a guide (notes, answers, papers, backfill, agents)")
    s.add_argument("topic", nargs="?"); s.set_defaults(fn=cmd_guide)
    sp.add_parser("open", help="print the current project's notebook URL").set_defaults(fn=cmd_open)
    a = ap.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
