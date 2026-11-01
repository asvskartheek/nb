"""Research notebook server: static site + merged notes + discussion threads.

    python notebook/server.py [--port 8765] [--host 127.0.0.1]

GET  /api/notes        all data/notes-*.json merged: {threads, notes}
GET  /api/discussion   discussion threads folded from discussion.jsonl, with agent state
POST /api/discussion   {kind: comment|reply|resolve|reopen, note?, parent?, author, body}
Discussion is an append-only log; nothing is ever rewritten or deleted.

Parallel agent chats: every person's comment or reply starts a headless agent run (`claude -p`, read-only tools,
cwd = the project) for that thread; threads run concurrently (up to --agents at once) and each answer is posted
back into its own thread as an agent reply. A thread whose last message is from a person is waiting on the agent.
"""
from __future__ import annotations

import argparse, base64, json, mimetypes, os, secrets, shutil, subprocess, threading, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
LOG = HERE / "discussion.jsonl"
SHOTS = HERE / "shots"  # region screenshots people draw a comment box around (C then T); kept local
KINDS = ("comment", "reply", "resolve", "reopen")
PROJECT = Path(os.environ.get("NOTEBOOK_PROJECT") or HERE.parent)  # where the agent reads code, ledger and logs
AGENT_BUDGET_S = 900
READ_ONLY = "Read,Grep,Glob,Bash(git log:*),Bash(git show:*),Bash(git branch:*),Bash(ls:*),Bash(cat:*),Bash(head:*),Bash(wc:*)"
LOCK = threading.Lock()  # one writer to discussion.jsonl at a time
RUNNING: dict[str, float] = {}  # thread id -> started
SLOTS = threading.BoundedSemaphore(4)


def merged_notes() -> dict:
    threads, notes, seen, patches, tpatches = {}, [], set(), [], []
    for f in sorted(DATA.glob("notes-*.json")):
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
            for k, v in t.items():  # later files fill gaps; spans widen
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
    for pt in patches:  # {"id", "set": {field: value}, "add_after": [ids]}: corrections without rewriting a file
        n = by.get(pt.get("id"))
        if not n:
            continue
        if pt.get("hide"):  # a duplicate of another note: dropped from the page, kept in its file
            n["_hidden"] = True
        n.update(pt.get("set") or {})
        n["after"] = list(dict.fromkeys((n.get("after") or []) + (pt.get("add_after") or [])))
    notes = [n for n in notes if not n.get("_hidden")]
    for pt in tpatches:  # {"id", "set": {...}}: overrides thread fields (merging only fills gaps)
        if pt.get("id") in threads:
            threads[pt["id"]].update(pt.get("set") or {})
    notes.sort(key=lambda n: n.get("ts", ""))
    return dict(threads=list(threads.values()), notes=notes)


def events() -> list[dict]:
    if not LOG.exists():
        return []
    out = []
    for line in LOG.read_text().splitlines():
        try:
            out.append(json.loads(line))
        except ValueError:
            pass
    return out


def discussion() -> list[dict]:
    th = {}
    for e in events():
        if e.get("kind") == "comment":
            th[e["id"]] = dict(id=e["id"], note=e.get("note"), t=e["t"], resolved=False, quote=e.get("quote"),
                               label=e.get("label"), path=e.get("path"), what=e.get("what"),
                               rect=e.get("rect"), shot=e.get("shot"),
                               messages=[dict(id=e["id"], t=e["t"], author=e["author"], body=e["body"], agent=False)])
        elif e.get("parent") in th:
            t = th[e["parent"]]
            if e["kind"] == "reply":
                t["messages"].append(dict(id=e["id"], t=e["t"], author=e["author"], body=e["body"],
                                          agent=bool(e.get("agent")), error=bool(e.get("error"))))
            elif e["kind"] in ("resolve", "reopen"):
                t["resolved"] = e["kind"] == "resolve"
    for t in th.values():
        t["waiting"] = not t["messages"][-1]["agent"] and not t["resolved"]
        t["thinking"] = t["id"] in RUNNING
    return list(th.values())


def post(d: dict) -> dict | None:
    kind = d.get("kind")
    body = str(d.get("body") or "").strip()[:4000]
    author = str(d.get("author") or "").strip()[:40] or "Reviewer"
    if kind not in KINDS or author.lower() in ("agent", "claude"):
        return None
    ev = dict(id=secrets.token_hex(4), t=time.time(), kind=kind, author=author)
    if kind == "comment":
        if not body or not d.get("note"):
            return None
        # note: a note id, "_notebook" (the whole notebook) or "paper:<name>#<section id>"; quote: the text selected
        ev.update(note=str(d["note"])[:120], body=body)
        ev.update({k: str(d[k]).strip()[:600] for k in ("quote", "label", "path", "what", "rect") if d.get(k)})  # what: the picked element
        shot = str(d.get("shot") or "")
        if shot.startswith(("data:image/jpeg;base64,", "data:image/png;base64,")):
            ext = "png" if shot.startswith("data:image/png") else "jpg"
            try:
                raw = base64.b64decode(shot.split(",", 1)[1], validate=True)
            except ValueError:
                raw = b""
            if 0 < len(raw) <= 8_000_000:
                SHOTS.mkdir(exist_ok=True)
                (SHOTS / f"{ev['id']}.{ext}").write_bytes(raw)
                ev["shot"] = f"shots/{ev['id']}.{ext}"
    else:
        ids = {e["id"] for e in events() if e.get("kind") == "comment"}
        if d.get("parent") not in ids or (kind == "reply" and not body):
            return None
        ev.update(parent=d["parent"], body=body)
    append(ev)
    if kind in ("comment", "reply"):
        summon(ev["id"] if kind == "comment" else ev["parent"])
    return ev


def append(ev: dict):
    with LOCK:
        fd = os.open(LOG, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
        try:
            os.write(fd, (json.dumps(ev) + "\n").encode())
        finally:
            os.close(fd)


# ---------- parallel agent chats
def prompt(th: dict) -> str:
    nb = merged_notes()
    note = next((n for n in nb["notes"] if n.get("id") == th["note"]), None)
    thread = next((t for t in nb["threads"] if note and t["id"] == note.get("thread")), None)
    chat = "\n\n".join(f"{'agent' if m['agent'] else m['author']}: {m['body']}" for m in th["messages"])
    if str(th["note"]).startswith("paper:"):
        name, _, sec = th["note"][6:].partition("#")
        return paper_prompt(name, sec, th, chat)
    pointed = shot_line(th) + (f"\nThey pointed at: {th['what']}" if th.get("what") else "") + \
              (f"\nThe text there:\n> {th['quote']}" if th.get("quote") else "")
    about = (f"The note:\n{json.dumps(note, indent=1)}\n\nIts line of work:\n{json.dumps(thread, indent=1)}\n\n"
             f"Its thread's notes (titles):\n" + "\n".join(f"- {n['ts']} [{n.get('kind')}] {n.get('title')}"
                for n in nb["notes"] if note and n.get("thread") == note.get("thread"))) if note else \
            f"This chat is about the whole notebook ({len(nb['notes'])} notes, {len(nb['threads'])} lines of work)."
    return f"""You answer a chat thread on the research notebook of the project in this folder.
The notebook's notes live in {DATA}/notes-*.json. The project's code, git history, bench/runs, experiments/,
logs/ and .research/ are the evidence. Read what you need (read-only), then answer.

{about}
{pointed}

The chat so far:
{chat}

Answer the last message. Be short and concrete: lead with the answer, give numbers with n and their source
(file, commit, run), say plainly when the evidence does not settle it. No preamble. Plain text, at most ~180 words."""


def shot_line(th: dict) -> str:
    """A drawn region: the agent opens the screenshot of exactly what the person boxed before anything else."""
    if not th.get("shot"):
        return ""
    return (f"\nThey drew a box on the page and commented on what is inside it. A screenshot of that region is at "
            f"{HERE / th['shot']}: open it with the Read tool first and answer about what it shows.")


def paper_prompt(name: str, sec: str, th: dict, chat: str) -> str:
    f = HERE / "papers" / f"{Path(name).name}.html"
    where = f"section id=\"{sec}\"" + (f" ({th['label']})" if th.get("label") else "") if sec else "the whole paper"
    quote = shot_line(th) + (f"\nThe element they picked: {th['what']}" if th.get("what") else "") + \
            (f"\nThe text there:\n> {th['quote']}\n" if th.get("quote") else "")
    return f"""You answer a comment thread on a research paper of the project in this folder.
The paper is {f} (one self-contained HTML file; numbers live in inline JS/JSON). The comment is on {where}.{quote}
The project's code, git history, .research/ (ledger: models.json, decisions.jsonl, tasks/), experiments/,
bench/runs and logs/ are the evidence, and the notebook notes are in {DATA}/notes-*.json. Read what you need
(read-only; grep the paper for the section rather than reading it whole), then answer.

The thread so far:
{chat}

Answer the last message. Be short and concrete: lead with the answer, give numbers with n and their source
(file, task id, commit), say plainly when the evidence does not settle it or when the paper is wrong.
No preamble. Plain text, at most ~180 words."""


def summon(tid: str):
    with LOCK:
        if tid in RUNNING:  # that thread's agent is already on it; it rereads the thread when it finishes
            PENDING.add(tid)
            return
        RUNNING[tid] = time.time()
    threading.Thread(target=answer, args=(tid,), daemon=True).start()


PENDING: set[str] = set()


def answer(tid: str):
    with SLOTS:
        while True:
            th = next((t for t in discussion() if t["id"] == tid), None)
            body, err = run_agent(prompt(th)) if th and th["waiting"] else (None, False)
            if body:
                append(dict(id=secrets.token_hex(4), t=time.time(), kind="reply", parent=tid, author="agent",
                            agent=True, error=err, body=body))
            with LOCK:
                if tid in PENDING:
                    PENDING.discard(tid)
                    continue
                RUNNING.pop(tid, None)
                return


def run_agent(text: str) -> tuple[str, bool]:
    exe = shutil.which("claude")
    if not exe:
        return "The agent could not start: no `claude` on PATH.", True
    try:
        r = subprocess.run([exe, "-p", "--output-format", "text", "--allowedTools", READ_ONLY], input=text,
                           capture_output=True, text=True, cwd=PROJECT, timeout=AGENT_BUDGET_S)
    except subprocess.TimeoutExpired:
        return f"The agent ran out of time ({AGENT_BUDGET_S // 60} min) before answering.", True
    out = (r.stdout or "").strip()
    if r.returncode or not out:
        return f"The agent failed (exit {r.returncode}): {(r.stderr or out)[-300:]}", True
    return out, False


def papers_index() -> bytes:
    """papers/: every papers/*.html, by its <title>."""
    import html, re
    rows = []
    for f in sorted((HERE / "papers").glob("*.html")):
        m = re.search(r"<title>(.*?)</title>", f.read_text(errors="replace"), re.S)
        rows.append(f'<a href="{f.name}"><b>{html.escape(m.group(1).strip() if m else f.stem)}</b><span>{f.stem}</span></a>')
    return f"""<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Papers</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=JetBrains+Mono&display=swap">
<script>try{{var t=localStorage.getItem("nb-theme");if(t)document.documentElement.dataset.theme=t}}catch(e){{}}</script>
<link rel="stylesheet" href="../style.css"><style>.list{{max-width:760px;margin:32px auto;padding:0 16px;display:grid;gap:10px}}
.list a{{display:flex;justify-content:space-between;gap:12px;padding:14px 16px;background:var(--surface);border:1px solid var(--line);border-radius:10px;text-decoration:none;color:var(--ink)}}
.list a:hover{{border-color:var(--accent)}} .list span{{font:12px var(--mono);color:var(--ink-3)}}</style>
<header class="top"><div class="brand"><b><a href="../" style="color:inherit;text-decoration:none">Research Notebook</a></b><span>Papers</span></div></header>
<div class="list">{"".join(rows) or "<p>No papers yet.</p>"}</div>""".encode()


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code: int, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def js(self, obj, code=200):
        self.send(code, json.dumps(obj, default=str).encode(), "application/json")

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/notes":
            return self.js(merged_notes())
        if path == "/api/discussion":
            return self.js(discussion())
        if path.rstrip("/") == "/papers":
            return self.send(200, papers_index(), "text/html; charset=utf-8")
        f = (HERE / (path.lstrip("/") or "index.html")).resolve()
        if f.is_file() and HERE in f.parents and f.suffix in (".html", ".js", ".css", ".svg", ".png", ".jpg", ".ico"):
            return self.send(200, f.read_bytes(), mimetypes.guess_type(f.name)[0] or "application/octet-stream")
        self.send(404, b"not found", "text/plain")

    def do_POST(self):
        if self.path.split("?")[0] != "/api/discussion":
            return self.send(404, b"not found", "text/plain")
        n = int(self.headers.get("Content-Length") or 0)
        if not 0 < n <= 12_000_000:  # a comment may carry a region screenshot
            return self.js(dict(error="bad size"), 413)
        try:
            d = json.loads(self.rfile.read(n))
        except ValueError:
            return self.js(dict(error="bad json"), 400)
        ev = post(d) if isinstance(d, dict) else None
        return self.js(ev) if ev else self.js(dict(error="bad request"), 400)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--agents", type=int, default=4, help="agent chats answered at once")
    a = ap.parse_args()
    SLOTS = threading.BoundedSemaphore(a.agents)
    for t in discussion():  # threads left waiting when the server last stopped
        if t["waiting"]:
            summon(t["id"])
    srv = ThreadingHTTPServer((a.host, a.port), H)
    print(f"research notebook on http://{a.host}:{a.port}", flush=True)
    srv.serve_forever()
