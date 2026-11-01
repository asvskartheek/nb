"""Answer specs: the only shape an agent reply in the notebook may take (rules in ANSWERS.md).

    python notebook/answer_spec.py reply.json     # prints violations, exit 1 if any

`extract(text)` pulls the JSON object out of an agent's output; `check(spec)` lists every rule it breaks.
"""
from __future__ import annotations

import json, re, sys

VIZ = {"bars", "delta", "split", "line", "flow", "checks", "compare"}
BLOCKS = VIZ | {"kpi", "table", "evidence", "tabs", "svg"}
VERDICTS = {"yes", "no", "null", "unsure", "partly", "win", "loss"}
TOP = {"headline", "verdict", "blocks", "replies"}
FIELDS = {  # per block: allowed keys (type implied)
    "bars": {"items", "unit", "highlight"}, "delta": {"label", "before", "after", "unit", "bl", "al"},
    "split": {"items", "unit"}, "line": {"points", "unit"}, "flow": {"steps"}, "checks": {"items"},
    "compare": {"rows", "a", "b", "unit"}, "kpi": {"items"}, "table": {"cols", "rows"}, "evidence": {"refs"},
    "tabs": {"tabs"}, "svg": {"svg"},
}
WORDS = {"headline": 8, "label": 5, "cell": 6, "check": 9, "reply": 6, "step": 4, "tab": 3}
MAX_BLOCKS, MAX_SVG = 6, 20_000


def words(s) -> int:
    return len(str(s).split())


def extract(text: str) -> dict | None:
    """The first JSON object in an agent's output (fences and stray words around it are ignored)."""
    t = re.sub(r"```(?:json)?", "", text or "")
    start = t.find("{")
    while start >= 0:
        depth, inq, esc = 0, False, False
        for i in range(start, len(t)):
            c = t[i]
            if inq:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    inq = False
                continue
            if c == '"':
                inq = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    try:
                        v = json.loads(t[start:i + 1])
                        return v if isinstance(v, dict) else None
                    except ValueError:
                        break
        start = t.find("{", start + 1)
    return None


def _numbers(x) -> bool:
    if isinstance(x, bool):
        return False
    if isinstance(x, (int, float)):
        return True
    if isinstance(x, dict):
        return any(_numbers(v) for k, v in x.items() if k not in ("type",))
    if isinstance(x, list):
        return any(_numbers(v) for v in x)
    return False


def _block(b, where: str, out: list, depth: int = 0):
    if not isinstance(b, dict) or b.get("type") not in BLOCKS:
        out.append(f"{where}: unknown block type {b.get('type') if isinstance(b, dict) else b!r} (use {', '.join(sorted(BLOCKS))})")
        return
    t = b["type"]
    extra = set(b) - FIELDS[t] - {"type"}
    if extra:
        out.append(f"{where} ({t}): fields {sorted(extra)} are not allowed; no prose fields")

    def lab(s, kind, at):
        if words(s) > WORDS[kind]:
            out.append(f"{at}: {words(s)} words, max {WORDS[kind]} ({str(s)[:40]!r})")

    if t in ("bars", "split"):
        items = b.get("items") or []
        if not items:
            out.append(f"{where} ({t}): no items")
        for i, x in enumerate(items):
            lab(x.get("label", ""), "label", f"{where}.items[{i}].label")
            if not isinstance(x.get("value"), (int, float)):
                out.append(f"{where}.items[{i}]: value must be a number")
    elif t == "delta":
        lab(b.get("label", ""), "label", f"{where}.label")
        if not all(isinstance(b.get(k), (int, float)) for k in ("before", "after")):
            out.append(f"{where} (delta): before and after must be numbers")
    elif t == "line":
        if len(b.get("points") or []) < 2:
            out.append(f"{where} (line): needs 2+ points")
        for i, p in enumerate(b.get("points") or []):
            lab(p.get("x", ""), "label", f"{where}.points[{i}].x")
    elif t == "flow":
        for i, s in enumerate(b.get("steps") or []):
            lab(s, "step", f"{where}.steps[{i}]")
    elif t == "checks":
        for i, x in enumerate(b.get("items") or []):
            lab(x.get("label", ""), "check", f"{where}.items[{i}].label")
    elif t == "compare":
        for i, r in enumerate(b.get("rows") or []):
            lab(r.get("label", ""), "label", f"{where}.rows[{i}].label")
    elif t == "kpi":
        for i, k in enumerate(b.get("items") or []):
            lab(k.get("label", ""), "label", f"{where}.items[{i}].label")
    elif t == "table":
        if len(b.get("rows") or []) > 12:
            out.append(f"{where} (table): max 12 rows")
        for i, c in enumerate(b.get("cols") or []):
            lab(c, "label", f"{where}.cols[{i}]")
        for i, r in enumerate(b.get("rows") or []):
            for j, c in enumerate(r or []):
                lab(c, "cell", f"{where}.rows[{i}][{j}]")
    elif t == "evidence":
        if not b.get("refs"):
            out.append(f"{where} (evidence): no refs")
    elif t == "svg":
        s = str(b.get("svg") or "")
        if not s.lstrip().startswith("<svg") or len(s) > MAX_SVG or re.search(r"<script|\son\w+\s*=|javascript:", s, re.I):
            out.append(f"{where} (svg): must be one <svg> under {MAX_SVG} chars, no scripts or handlers")
        if len(re.sub(r"<[^>]+>", " ", s).split()) > 40:
            out.append(f"{where} (svg): more than 40 words of text inside")
    elif t == "tabs":
        if depth:
            out.append(f"{where} (tabs): tabs cannot nest")
        for i, tab in enumerate(b.get("tabs") or []):
            lab(tab.get("label", ""), "tab", f"{where}.tabs[{i}].label")
            for k, x in enumerate(tab.get("blocks") or []):
                _block(x, f"{where}.tabs[{i}].blocks[{k}]", out, depth + 1)


def check(spec, person: bool = False) -> list[str]:
    """Every rule the spec breaks. People's specs (person=True) need no evidence and no headline."""
    if not isinstance(spec, dict):
        return ["the reply is not a JSON object"]
    out = []
    extra = set(spec) - TOP
    if extra:
        out.append(f"top-level fields {sorted(extra)} are not allowed (only {sorted(TOP)}); no prose fields")
    h = spec.get("headline")
    if not person and not h:
        out.append("headline missing")
    if h and words(h) > WORDS["headline"]:
        out.append(f"headline is {words(h)} words, max {WORDS['headline']}")
    if spec.get("verdict") is not None and str(spec["verdict"]).lower() not in VERDICTS:
        out.append(f"verdict must be one of {sorted(VERDICTS)}")
    blocks = spec.get("blocks")
    if person and spec.get("verdict") and not blocks:  # a person's /yes, /no: the verdict is the reply
        blocks = []
    elif not isinstance(blocks, list) or not blocks:
        out.append("blocks missing: the answer is the blocks")
        blocks = []
    if len(blocks) > MAX_BLOCKS:
        out.append(f"{len(blocks)} blocks, max {MAX_BLOCKS}: put the rest in tabs")
    for i, b in enumerate(blocks):
        _block(b, f"blocks[{i}]", out)
    kinds = [b.get("type") for b in blocks if isinstance(b, dict)]
    if blocks and not any(k in VIZ | {"kpi", "table", "svg", "tabs"} for k in kinds):
        out.append("no visual block: add bars, delta, split, line, flow, checks, compare, kpi, table or svg")
    if not person and _numbers([b for b in blocks if isinstance(b, dict) and b.get("type") != "evidence"]) and "evidence" not in kinds:
        out.append("numbers without an evidence block: cite the files, task ids or commits they come from")
    for i, r in enumerate(spec.get("replies") or []):
        if words(r) > WORDS["reply"]:
            out.append(f"replies[{i}] is {words(r)} words, max {WORDS['reply']}")
    if len(spec.get("replies") or []) > 3:
        out.append("max 3 replies")
    return out


if __name__ == "__main__":
    raw = open(sys.argv[1]).read() if len(sys.argv) > 1 else sys.stdin.read()
    spec = extract(raw)
    problems = check(spec) if spec is not None else ["no JSON object found"]
    for p in problems:
        print(p)
    print(f"{len(problems)} violations")
    sys.exit(1 if problems else 0)
