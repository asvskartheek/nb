"""One server for every registered project (`nb up`).

    /                               the projects
    /p/<name>/                      the notebook
    /p/<name>/<asset>               the page's own files (nb/web)
    /p/<name>/papers/               the project's papers; /p/<name>/papers/<file> serves .notebook/papers/<file>
    /p/<name>/shots/<file>          screenshots of drawn comment boxes
    GET  /p/<name>/api/config       title, timezone, areas, headline series (what the page needs)
    GET  /p/<name>/api/notes        notes/*.json merged: {threads, notes}
    GET  /p/<name>/api/discussion   comment threads with agent state
    POST /p/<name>/api/discussion   {kind: comment|reply|resolve|reopen|redraw, ...}
"""
from __future__ import annotations

import html, json, mimetypes, re, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

from . import chat, project

WEB = Path(__file__).resolve().parent / "web"
STATIC = (".html", ".js", ".css", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".json", ".woff2")
PAGE_KEYS = ("title", "about", "timezone", "areas", "kinds", "headline", "headline_skip")


def inside(base: Path, rel: str) -> Path | None:
    f = (base / rel).resolve()
    return f if f.is_file() and base.resolve() in f.parents and f.suffix.lower() in STATIC else None


def page(title: str, body: str, back: str = "") -> bytes:
    return f"""<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=JetBrains+Mono&display=swap">
<script>try{{var t=localStorage.getItem("nb-theme");if(t)document.documentElement.dataset.theme=t}}catch(e){{}}</script>
<link rel="stylesheet" href="{back}style.css"><style>.list{{max-width:760px;margin:32px auto;padding:0 16px;display:grid;gap:10px}}
.list a{{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:14px 16px;background:var(--surface);border:1px solid var(--line);border-radius:10px;text-decoration:none;color:var(--ink)}}
.list a:hover{{border-color:var(--accent)}} .list span{{font:12px var(--mono);color:var(--ink-3);white-space:nowrap}} .list p{{color:var(--ink-3)}}</style>
{body}""".encode()


def home() -> bytes:
    rows = []
    for name, root in sorted(project.registry().items()):
        p = project.named(name)
        if not p:
            rows.append(f'<a><b>{html.escape(name)}</b><span>missing: {html.escape(root)}</span></a>')
            continue
        n = len(p.merged_notes()["notes"])  # as the page shows them: duplicates hidden by patches are not counted
        papers = len(list(p.papers_dir.glob("*.html")))
        rows.append(f'<a href="p/{html.escape(name)}/"><b>{html.escape(p.config()["title"])}</b>'
                    f'<span>{n} notes · {papers} papers · {html.escape(name)}</span></a>')
    body = (f'<header class="top"><div class="brand"><b>Research notebooks</b></div></header>'
            f'<div class="list">{"".join(rows) or "<p>No projects yet: run <code>nb init</code> in one.</p>"}</div>')
    return page("Research notebooks", body)


def papers_index(p: project.Project) -> bytes:
    rows = []
    for f in sorted(p.papers_dir.glob("*.html")):
        m = re.search(r"<title>(.*?)</title>", f.read_text(errors="replace"), re.S)
        rows.append(f'<a href="{f.name}"><b>{html.escape(m.group(1).strip() if m else f.stem)}</b><span>{f.stem}</span></a>')
    body = (f'<header class="top"><div class="brand"><b><a href="../" style="color:inherit;text-decoration:none">'
            f'{html.escape(p.config()["title"])}</a></b><span>Papers</span></div></header>'
            f'<div class="list">{"".join(rows) or "<p>No papers yet: <code>nb paper new &lt;name&gt;</code>.</p>"}</div>')
    return page("Papers", body, back="../")


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code: int, body: bytes, ctype: str, extra: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def js(self, obj, code=200):
        self.send(code, json.dumps(obj, default=str).encode(), "application/json")

    def file(self, f: Path | None):
        if not f:
            return self.send(404, b"not found", "text/plain")
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        self.send(200, f.read_bytes(), ctype + ("; charset=utf-8" if ctype.startswith("text/") else ""))

    def route(self):
        """(project, rest of the path) for /p/<name>/<rest>; a bare /p/<name> redirects to the slash form."""
        path = unquote(self.path.split("?")[0])
        m = re.fullmatch(r"/p/([^/]+)(/.*)?", path)
        if not m:
            return None, path
        p = project.named(m[1])
        if not p:
            return False, path
        if m[2] is None:
            self.send(302, b"", "text/plain", {"Location": f"/p/{m[1]}/"})
            return True, None
        return p, m[2].lstrip("/")

    def do_GET(self):
        p, rest = self.route()
        if p is True:
            return
        if p is None:  # outside any project
            if rest in ("/", "/index.html"):
                return self.send(200, home(), "text/html; charset=utf-8")
            return self.file(inside(WEB, rest.lstrip("/")))  # the home page's stylesheet
        if p is False:
            return self.send(404, b"no such project", "text/plain")
        if rest == "api/config":
            return self.js({k: v for k, v in p.config().items() if k in PAGE_KEYS} | {"name": p.name})
        if rest == "api/notes":
            return self.js(p.merged_notes())
        if rest == "api/discussion":
            return self.js(chat.threads(p))
        if rest.rstrip("/") == "papers":
            return self.send(200, papers_index(p), "text/html; charset=utf-8")
        if rest.startswith("papers/"):
            return self.file(inside(p.papers_dir, rest[7:]))
        if rest.startswith("shots/"):
            return self.file(inside(p.shots, rest[6:]))
        return self.file(inside(WEB, rest or "index.html"))

    def do_POST(self):
        p, rest = self.route()
        if not isinstance(p, project.Project) or rest != "api/discussion":
            return self.send(404, b"not found", "text/plain")
        n = int(self.headers.get("Content-Length") or 0)
        if not 0 < n <= 12_000_000:  # a comment may carry a region screenshot
            return self.js(dict(error="bad size"), 413)
        try:
            d = json.loads(self.rfile.read(n))
        except ValueError:
            return self.js(dict(error="bad json"), 400)
        ev = chat.post(p, d) if isinstance(d, dict) else None
        return self.js(ev) if ev else self.js(dict(error="bad request"), 400)


def serve(host: str = "127.0.0.1", port: int = 8765, agents: int = 4):
    chat.SLOTS = threading.BoundedSemaphore(agents)
    for name in project.registry():
        p = project.named(name)
        if p:
            chat.resume(p)
    srv = ThreadingHTTPServer((host, port), H)
    print(f"research notebooks on http://{host}:{port}/", flush=True)
    srv.serve_forever()
