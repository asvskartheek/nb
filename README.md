# Research notebook

A time-ordered lab notebook of the whole project, from the first commit on. Notes are atomic (one event, one
timestamp), carry their numbers as tiles and visuals, and belong to a line of work; parallel lines render side by side.

```bash
NOTEBOOK_PROJECT="/path/to/project" python notebook/server.py --port 8765
```

- `data/notes-*.json`: the notes, one file per era (schema in `SCHEMA.md`). Add a file or append notes; the page merges them.
- `discussion.jsonl`: agent chats, append-only. Every person's message on a note (or on the whole notebook, via **Chats**)
  starts its own headless `claude -p` run with read-only tools in `NOTEBOOK_PROJECT`; up to `--agents` (default 4)
  answer at once and each posts back into its own chat.
- Papers live in `papers/*.html` (listed at `/papers/`). A paper becomes commentable by including
  `<link rel="stylesheet" href="../comments.css"><script src="../comments.js" defer></script>`: every `<section id>`
  gets a comment marker, selecting text offers **Comment** with the quote, and each thread gets its own agent like note chats.
- No build step: `index.html`, `style.css`, `app.js`.
