## Research notebook (nb)

This project keeps a research notebook in `.notebook/` (served by `nb up`). Keep it current as you work:

- **Log work as atomic notes.** After each meaningful step (a run started, a result, a decision, a dead end, a fix),
  add a note: `nb note add` with the note JSON on stdin (`nb guide notes` for the schema). One event per note, a real
  timestamp, title ≤ 8 words, at most 3 fragment facts, numbers in `metrics` with their n, a `viz` when there are 2+
  numbers, `after` links to the notes it follows from. Reuse the line of work's thread id; add a thread object for a
  new line of work.
- **Explain results visually.** A paper (`nb paper new <name>`, rules in `nb guide papers`) tells one result from
  zero through visuals and interactions only: no paragraphs, every number with its n, every term defined on the page.
- **Answer comments with visuals.** Replies to notebook or paper comments are answer specs, never prose
  (`nb guide answers`); check one with `nb answer-check reply.json`.
- **Check before you finish.** `nb check` validates notes, papers and stored answers.
- **Keep private data out** of notes and papers: no quoted documents, answers or personal data.
