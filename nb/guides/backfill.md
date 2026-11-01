# Backfilling a notebook from a project's history

How an agent (or several) turns an existing project into a complete notebook. Read `nb guide notes` first.

## Sources, in order of authority
1. Git: `git log --all --date=iso --format='%h %ad %D %s'`, `git show --stat`, branch READMEs (`git show branch:path`).
2. Run and result files the project keeps (summaries, CSV/JSON results, ledgers): their timestamps and numbers.
3. Agent session transcripts (for Claude Code: `~/.claude/projects/<project dir>/*.jsonl`; timestamps are UTC).
4. Memory or notes files the project keeps for agents.

## Method
1. **Index** the transcripts: start, end, size and first request per session, so work can be split by time.
2. **Split the history into eras** (3–5, by date) and give each era to its own writer. Each writes one file,
   `.notebook/notes/<era>.json`, read-only on everything else, with stable descriptive thread ids so later eras
   continue the same lines of work. Parallel sessions become parallel threads.
3. **Review**: give each era (and one pass over the whole notebook) to a reviewer that reads the notes against the
   sources and writes `.notebook/notes/r<k>.json` with new notes, `patches` (fixes, cross-era `after` links, `hide` for
   duplicates) and thread objects that fill missing outcomes or parents. Reviewers never edit another file.
4. **Curate**: one last `zz-curation.json` with `thread_patches` and `hide` patches for conflicts reviewers report.
5. `nb check`, then look at the page: lanes, the headline chart, every day.

## Rules for writers and reviewers
- Real timestamps only; convert to the project's offset.
- Every result with numbers has metrics (with n) and a viz; every decision is its own note.
- Gaps that are real (no commits, no sessions) are recorded as a `finding`, not invented over.
- No quoted documents, answers or personal data.
