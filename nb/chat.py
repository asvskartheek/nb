"""Comment threads and the agents that answer them, per project.

The log (`.notebook/discussion.jsonl`) is append-only: comment, reply, resolve, reopen, redraw. Every person's comment or
reply starts the project's agent command for that thread (default `claude -p` with read-only tools, run in the
project's evidence root); threads run concurrently, up to the configured number at once.

Answers are visual (guides/answers.md): the agent returns an answer spec, answer_spec.check() validates it, a failing
one is sent back once with its violations, and a second failure is posted as "could not visualise" with the raw text
kept. A redraw asks the agent to redraw one of its old text answers as a spec.
"""
from __future__ import annotations

import base64, json, os, secrets, shutil, subprocess, threading, time

from . import answer_spec
from .project import Project

KINDS = ("comment", "reply", "resolve", "reopen", "redraw")
ATTACH = ("quote", "what", "path", "state")  # what a person pointed at or drew, on a comment or a reply
LOCKS: dict[str, threading.Lock] = {}        # one writer per log
RUNNING: dict[tuple[str, str], float] = {}   # (log, thread id) -> started
PENDING: set[tuple[str, str]] = set()
REDRAW: dict[tuple[str, str], list[str]] = {}
GUARD = threading.Lock()
SLOTS = threading.BoundedSemaphore(4)


def lock(p: Project) -> threading.Lock:
    with GUARD:
        return LOCKS.setdefault(str(p.log), threading.Lock())


def events(p: Project) -> list[dict]:
    if not p.log.exists():
        return []
    out = []
    for line in p.log.read_text().splitlines():
        try:
            out.append(json.loads(line))
        except ValueError:
            pass
    return out


def threads(p: Project) -> list[dict]:
    th = {}
    for e in events(p):
        if e.get("kind") == "comment":
            th[e["id"]] = dict(id=e["id"], note=e.get("note"), t=e["t"], resolved=False, quote=e.get("quote"),
                               label=e.get("label"), path=e.get("path"), what=e.get("what"),
                               rect=e.get("rect"), shot=e.get("shot"), state=e.get("state"),
                               messages=[dict(id=e["id"], t=e["t"], author=e["author"], body=e["body"], agent=False,
                                              spec=e.get("spec"))])
        elif e.get("parent") in th:
            t = th[e["parent"]]
            if e["kind"] == "reply":
                t["messages"].append(dict(id=e["id"], t=e["t"], author=e["author"], body=e["body"],
                                          agent=bool(e.get("agent")), error=bool(e.get("error")), spec=e.get("spec"),
                                          raw=e.get("raw"), violations=e.get("violations"), redraws=e.get("redraws"),
                                          chip=bool(e.get("chip")), shot=e.get("shot"),
                                          **{k: e.get(k) for k in ATTACH if e.get(k)}))
            elif e["kind"] in ("resolve", "reopen"):
                t["resolved"] = e["kind"] == "resolve"
    for t in th.values():
        t["waiting"] = not t["messages"][-1]["agent"] and not t["resolved"]
        t["thinking"] = (str(p.log), t["id"]) in RUNNING
    return list(th.values())


def post(p: Project, d: dict) -> dict | None:
    kind = d.get("kind")
    body = str(d.get("body") or "").strip()[:4000]
    author = str(d.get("author") or "").strip()[:40] or "Reviewer"
    if kind not in KINDS or author.lower() in ("agent", "claude"):
        return None
    ev = dict(id=secrets.token_hex(4), t=time.time(), kind=kind, author=author)
    if kind == "comment":
        if not body or not d.get("note"):
            return None
        # note: a note id, "_notebook" (the whole notebook) or "paper:<name>#<section id>"
        ev.update(note=str(d["note"])[:120], body=body)
        ev.update({k: str(d[k]).strip()[:600] for k in ("label", "rect") if d.get(k)})
    elif kind == "redraw":  # redraw one of the agent's old text answers as a visual
        evs = events(p)
        if d.get("parent") not in {e["id"] for e in evs if e.get("kind") == "comment"} or \
                d.get("target") not in {e["id"] for e in evs if e.get("kind") == "reply" and e.get("agent")}:
            return None
        ev.update(parent=d["parent"], target=d["target"])
        append(p, ev)
        with lock(p):
            REDRAW.setdefault((str(p.log), ev["parent"]), []).append(ev["target"])
        summon(p, ev["parent"])
        return ev
    else:
        ids = {e["id"] for e in events(p) if e.get("kind") == "comment"}
        spec_in = d.get("spec") if isinstance(d.get("spec"), dict) else None
        if d.get("parent") not in ids or (kind == "reply" and not body and not spec_in and not d.get("shot")):
            return None
        ev.update(parent=d["parent"], body=body)
        if d.get("chip"):
            ev["chip"] = True
    if kind in ("comment", "reply"):
        ev.update({k: str(d[k]).strip()[:600] for k in ATTACH if d.get(k)})
        if isinstance(d.get("spec"), dict) and not answer_spec.check(d["spec"], person=True):
            ev["spec"] = d["spec"]  # a person's visual reply (/bars, /delta, /yes …)
        save_shot(p, ev, d.get("shot"))
    append(p, ev)
    if kind in ("comment", "reply"):
        summon(p, ev["id"] if kind == "comment" else ev["parent"])
    return ev


def save_shot(p: Project, ev: dict, shot) -> None:
    """A drawn region's screenshot (data URL) -> shots/<event id>.<ext>."""
    shot = str(shot or "")
    if not shot.startswith(("data:image/jpeg;base64,", "data:image/png;base64,")):
        return
    ext = "png" if shot.startswith("data:image/png") else "jpg"
    try:
        raw = base64.b64decode(shot.split(",", 1)[1], validate=True)
    except ValueError:
        return
    if 0 < len(raw) <= 8_000_000:
        p.shots.mkdir(parents=True, exist_ok=True)
        (p.shots / f"{ev['id']}.{ext}").write_bytes(raw)
        ev["shot"] = f"shots/{ev['id']}.{ext}"


def append(p: Project, ev: dict):
    p.dir.mkdir(parents=True, exist_ok=True)
    with lock(p):
        fd = os.open(p.log, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
        try:
            os.write(fd, (json.dumps(ev) + "\n").encode())
        finally:
            os.close(fd)


# ---------- the agents
CONTRACT = """Reply with ONE JSON object and nothing else: an answer spec the page draws as a card. No prose.
{"headline": "<the answer, max 8 words>", "verdict": "yes|no|partly|null|unsure|win|loss (optional)",
 "blocks": [<1-6 blocks, at least one visual>], "replies": ["<up to 3 follow-ups the person can click, max 6 words>"]}
Blocks:
 {"type":"kpi","items":[{"label":"..","value":84.2,"unit":"%","n":183,"before":82.5}]}
 {"type":"bars","unit":"%","items":[{"label":"..","value":62.8}]}       {"type":"split","unit":"q","items":[{"label":"..","value":9}]}
 {"type":"delta","label":"..","before":151,"after":154,"unit":"q","bl":"baseline","al":"candidate"}
 {"type":"line","unit":"%","points":[{"x":"v1","y":55}]}                {"type":"flow","steps":["fetch","read","answer"]}
 {"type":"checks","items":[{"label":"gate passed","ok":true}]}          {"type":"compare","a":"$/q","b":"acc %","rows":[{"label":"..","a":0.04,"b":82.5}]}
 {"type":"table","cols":[".."],"rows":[[".."]]}                         {"type":"evidence","refs":["path/file.py:12","run or task id","commit","n-<note id>","§s6"]}
 {"type":"tabs","tabs":[{"label":"v1","blocks":[...]},{"label":"v2","blocks":[...]}]}
 {"type":"svg","svg":"<svg viewBox=...>...</svg>"}  (only when no block fits; no scripts, max 40 words inside)
Rules: labels max 5 words, table cells max 6, check labels max 9. Any numbers need an evidence block naming where they
come from (file, run or task id, commit, note id). Say "unsure" in the verdict when the evidence does not settle it."""
RETRY = """

Your previous reply broke the answer rules:
{problems}
Your previous reply was:
{prev}
Return only the corrected JSON object."""


def say(p: Project, m: dict) -> str:
    """One message as the agent reads it: text, a visual spec, what the person pointed at, a screenshot."""
    who = "agent" if m["agent"] else m["author"]
    parts = [m["body"]] if m.get("body") and not (m["agent"] and m.get("spec")) else []
    if m.get("spec"):
        parts.append("[visual] " + json.dumps(m["spec"])[:1500])
    if m.get("what"):
        parts.append(f"[pointed at {m['what']}]")
    if m.get("quote") and not m["agent"]:
        parts.append(f"[text there: {m['quote'][:300]}]")
    if m.get("shot"):
        parts.append(f"[drew a box; screenshot at {p.dir / m['shot']}: open it with Read]")
    return f"{who}: " + " ".join(parts)


def where_to_look(p: Project) -> str:
    c = p.config()
    ev = ", ".join(c["evidence"]) if c["evidence"] else "the code, git history and any run or log folders"
    return (f"You run in {p.evidence_root}. The evidence is {ev} there. The notebook's notes are in "
            f"{p.notes_dir}/*.json. Read what you need (read-only), then answer.")


def shot_line(p: Project, th: dict) -> str:
    """The view the person was in (toggles around the anchor) and, for a drawn box, its screenshot."""
    view = ""
    if th.get("state"):
        view = ("\nThe view they were looking at had these options selected: "
                + ", ".join(x.split(":", 1)[-1] for x in th["state"].split("|")) + ".")
    if not th.get("shot"):
        return view
    return view + (f"\nThey drew a box on the page and commented on what is inside it. A screenshot of that region is at "
                   f"{p.dir / th['shot']}: open it with the Read tool first and answer about what it shows.")


def prompt(p: Project, th: dict, redraw: dict | None = None) -> str:
    about = p.config()["about"]
    chat = "\n\n".join(say(p, m) for m in th["messages"])
    task = (f"Redraw your earlier answer below as an answer spec: same content and sources, no new claims.\n"
            f"> {redraw['body']}") if redraw else "Answer the last message."
    if str(th["note"]).startswith("paper:"):
        name, _, sec = th["note"][6:].partition("#")
        f = p.papers_dir / f"{os.path.basename(name)}.html"
        where = f"section id=\"{sec}\"" + (f" ({th['label']})" if th.get("label") else "") if sec else "the whole paper"
        pointed = shot_line(p, th) + (f"\nThe element they picked: {th['what']}" if th.get("what") else "") + \
            (f"\nThe text there:\n> {th['quote']}\n" if th.get("quote") else "")
        return f"""You answer a comment thread on a research paper of {about}.
The paper is {f} (one self-contained HTML file; numbers may live in inline JS/JSON). The comment is on {where}.{pointed}
{where_to_look(p)} Grep the paper for the section rather than reading it whole.

The thread so far:
{chat}

{task} Lead with the answer, give numbers with n and their source, be plain when the evidence does not settle it or
when the paper is wrong; evidence refs like "§s6" point at paper sections.

{CONTRACT}"""
    nb = p.merged_notes()
    note = next((n for n in nb["notes"] if n.get("id") == th["note"]), None)
    line = next((t for t in nb["threads"] if note and t["id"] == note.get("thread")), None)
    pointed = shot_line(p, th) + (f"\nThey pointed at: {th['what']}" if th.get("what") else "") + \
        (f"\nThe text there:\n> {th['quote']}" if th.get("quote") else "")
    ctx = (f"The note:\n{json.dumps(note, indent=1)}\n\nIts line of work:\n{json.dumps(line, indent=1)}\n\n"
           f"Its line's notes (titles):\n" + "\n".join(f"- {n['ts']} [{n.get('kind')}] {n.get('title')}"
                                                     for n in nb["notes"] if n.get("thread") == note.get("thread"))) \
        if note else f"This chat is about the whole notebook ({len(nb['notes'])} notes, {len(nb['threads'])} lines of work)."
    return f"""You answer a chat thread on the research notebook of {about}.
{where_to_look(p)}

{ctx}
{pointed}

The chat so far:
{chat}

{task} Lead with the answer, give numbers with n and their source, be plain when the evidence does not settle it.

{CONTRACT}"""


def summon(p: Project, tid: str):
    key = (str(p.log), tid)
    with lock(p):
        if key in RUNNING:  # that thread's agent is already on it; it rereads the thread when it finishes
            PENDING.add(key)
            return
        RUNNING[key] = time.time()
    threading.Thread(target=answer, args=(p, tid), daemon=True).start()


def answer(p: Project, tid: str):
    key = (str(p.log), tid)
    with SLOTS:
        while True:
            th = next((t for t in threads(p) if t["id"] == tid), None)
            with lock(p):
                targets = REDRAW.pop(key, [])
            for target in targets:
                m = th and next((x for x in th["messages"] if x["id"] == target), None)
                if m:
                    post_spec(p, tid, prompt(p, th, redraw=m), redraws=target)
            if th and th["waiting"]:
                post_spec(p, tid, prompt(p, th))
            with lock(p):
                if REDRAW.get(key):
                    continue
                if key in PENDING:
                    PENDING.discard(key)
                    continue
                RUNNING.pop(key, None)
                return


def post_spec(p: Project, tid: str, text: str, **extra):
    """Ask, check the spec, ask once more with its violations; post a valid card or a flagged failure."""
    out, err = run_agent(p, text)
    spec, problems = (None, [out]) if err else (answer_spec.extract(out), None)
    if not err:
        problems = answer_spec.check(spec) if spec is not None else ["no JSON object found"]
        if problems:
            out2, err2 = run_agent(p, text + RETRY.format(problems="\n".join(f"- {x}" for x in problems), prev=out[:4000]))
            if not err2:
                spec2 = answer_spec.extract(out2)
                out, spec = out2, spec2
                problems = answer_spec.check(spec2) if spec2 is not None else ["no JSON object found"]
    ev = dict(id=secrets.token_hex(4), t=time.time(), kind="reply", parent=tid, author="agent", agent=True, **extra)
    if not problems:
        ev.update(spec=spec, body=spec.get("headline", ""))
    else:
        ev.update(error=True, body="Could not visualise: " + problems[0][:200], violations=problems[:6], raw=out[:3000],
                  **({"spec": spec} if isinstance(spec, dict) else {}))
    append(p, ev)


def run_agent(p: Project, text: str) -> tuple[str, bool]:
    """The project's agent command, prompt on stdin, answer on stdout."""
    a = p.config()["agent"]
    cmd, budget = list(a.get("cmd") or []), int(a.get("budget_s") or 900)
    exe = cmd and shutil.which(cmd[0])
    if not exe:
        return f"The agent could not start: {cmd[0] if cmd else 'no agent command'} is not on PATH.", True
    try:
        r = subprocess.run([exe, *cmd[1:]], input=text, capture_output=True, text=True, cwd=p.evidence_root,
                           timeout=budget)
    except subprocess.TimeoutExpired:
        return f"The agent ran out of time ({budget // 60} min) before answering.", True
    out = (r.stdout or "").strip()
    if r.returncode or not out:
        return f"The agent failed (exit {r.returncode}): {(r.stderr or out)[-300:]}", True
    return out, False


def resume(p: Project):
    """Threads left waiting when the server last stopped."""
    for t in threads(p):
        if t["waiting"]:
            summon(p, t["id"])
