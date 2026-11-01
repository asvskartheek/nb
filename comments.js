// Margin comments, Google Docs style, answered by agents (the notebook's /api/discussion: one agent per thread,
// several at once). One script for papers (papers/*.html) and for the notebook's notes (index.html).
//   papers:   <link rel="stylesheet" href="../comments.css"><script src="../comments.js" defer></script>
//   notebook: the same with "comments.css" / "comments.js"; the page calls CM.refresh() after it re-renders.
// Anchor a comment on selected text (the margin ＋, or Ctrl/Cmd+Alt+M) or on any element: press C, point, click.
// Anchors live inside a root: a paper's <section id> or a note's <article class="card" id>; outside one, the page.
(() => {
  "use strict";
  const IS_PAPER = /\/papers\//.test(location.pathname);
  const PAPER = location.pathname.split("/").pop().replace(/\.html$/, "");
  const API = IS_PAPER ? "../api/discussion" : "api/discussion", RAIL_W = 296, WIDE = 1000;
  const MODE = IS_PAPER ? {
    roots: "section[id]",
    keyOf: root => `paper:${PAPER}#${root ? root.id : ""}`,
    mine: t => String(t.note).startsWith(`paper:${PAPER}#`),
    rootOf: t => { const s = String(t.note).split("#")[1]; return s ? document.getElementById(s) : document.body; },
    labelOf: root => { const h = root && root.querySelector && root.querySelector("h1,h2,h3"); return h ? clean(h.textContent, 60) : "Whole paper"; },
  } : {
    roots: "article.card[id]",
    keyOf: root => root ? root.id : "_notebook",
    mine: t => !String(t.note).startsWith("paper:"),
    rootOf: t => t.note === "_notebook" ? document.body : document.getElementById(t.note),
    labelOf: root => { const h = root && root.querySelector && root.querySelector(".title"); return h ? clean(h.textContent, 60) : "Notebook"; },
  };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function clean(s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  const me = () => { try { return localStorage.getItem("nb-author") || ""; } catch (e) { return ""; } };
  const setMe = v => { try { localStorage.setItem("nb-author", v); } catch (e) {} };
  const when = t => { const d = new Date(t * 1000);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + " " + d.toLocaleDateString([], { month: "short", day: "numeric" }); };
  const initials = n => (n || "?").trim().split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const hue = n => [...(n || "")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 200);
  const HL = !!(window.CSS && CSS.highlights && typeof Highlight !== "undefined");
  const UI = ".cm-rail,.cm-sheet,.cm-add,.cm-tog,.cm-pick,.cm-ptag,.cm-phint,.cm-boxes";

  let all = [], active = null, draft = null, showResolved = false, anc = {};

  // ---------- furniture
  const el = (tag, cls) => { const e = document.createElement(tag); e.className = cls; return e; };
  const rail = el("div", "cm-rail"), add = el("button", "cm-add"), sheet = el("div", "cm-sheet"), boxes = el("div", "cm-boxes");
  const pbox = el("div", "cm-pick"), ptag = el("div", "cm-ptag"), phint = el("div", "cm-phint");
  add.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M12 8v8M8 12h8"/></svg>';
  add.title = "Add comment (Ctrl+Alt+M)";
  phint.innerHTML = "<b>Pick an element to comment on</b><span><kbd>Click</kbd> pick</span><span><kbd>↑</kbd> parent</span><span><kbd>↓</kbd> child</span><span><kbd>Esc</kbd> cancel</span>";
  document.body.append(boxes, rail, add, sheet, pbox, ptag, phint);
  const tog = el("button", "cm-tog");
  const themeBtn = document.querySelector("header #theme");
  themeBtn ? themeBtn.before(tog) : (tog.classList.add("cm-tog-float"), document.body.append(tog));

  // ---------- data
  async function load() {
    try { setAll(await (await fetch(API)).json()); } catch (e) {}
    setTimeout(load, all.some(t => t.thinking || t.waiting) ? 2500 : 8000);
  }
  function setAll(list) {
    const f = document.activeElement, typing = (rail.contains(f) || sheet.contains(f)) && f.matches("textarea,input");
    all = list.filter(MODE.mine);
    if (!typing) render();
  }
  async function send(d) {
    d.author = me() || "Reviewer";
    const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) });
    if (!r.ok) { alert("Could not post. Is the notebook server running?"); return null; }
    const ev = await r.json();
    all = (await (await fetch(API)).json()).filter(MODE.mine);
    return ev;
  }

  // ---------- anchors: element (path of child indices under its root), passage (quote, whitespace-insensitive), or root
  function pathOf(root, e) {
    const p = [];
    for (let x = e; x && x !== root; x = x.parentElement) p.unshift([...x.parentElement.children].indexOf(x));
    return p.join("/");
  }
  function byPath(root, path) {
    let x = root;
    for (const i of String(path).split("/").filter(s => s !== "")) { x = x && x.children[+i]; if (!x) return null; }
    return x;
  }
  function findRange(root, quote) {
    if (!root || !quote) return null;
    const map = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n =>
      n.parentElement.closest(UI + ",script,style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    let txt = "", sp = true;
    for (let n; (n = w.nextNode());) for (let i = 0; i < n.data.length; i++) {
      const c = n.data[i];
      if (/\s/.test(c)) { if (!sp) { txt += " "; map.push([n, i]); sp = true; } } else { txt += c; map.push([n, i]); sp = false; }
    }
    const q = quote.replace(/\s+/g, " ").trim();
    let at = txt.indexOf(q), len = q.length;
    if (at < 0 && q.length > 40) { at = txt.indexOf(q.slice(0, 40)); len = 40; }
    if (at < 0) return null;
    const a = map[at], b = map[at + len - 1], r = new Range();
    r.setStart(a[0], a[1]); r.setEnd(b[0], b[1] + 1);
    return r;
  }
  function resolve(t) {
    const root = MODE.rootOf(t);
    if (!root) return null;  // a note filtered out of the log: its thread waits off-page
    if (t.path != null && t.path !== "") { const e = byPath(root, t.path); if (e) return { el: e, root }; }
    if (t.quote && t.path == null) { const r = findRange(root, t.quote); if (r) return { range: r, root }; }
    return { el: root === document.body ? null : root, root, whole: true };
  }
  const rectOf = a => { const b = a.range ? a.range.getBoundingClientRect() : a.el ? a.el.getBoundingClientRect() : null; return b && (b.width || b.height) ? b : null; };
  const topOf = a => { const b = a && rectOf(a); return b ? b.top + scrollY : 120; };

  // ---------- render
  const visible = () => all.filter(t => (showResolved || !t.resolved || t.id === active) && anc[t.id]);
  const wide = () => document.documentElement.clientWidth >= WIDE;
  function render() {
    anc = {};
    for (const t of all) { const a = resolve(t); if (a) anc[t.id] = a; }
    if (draft) anc._draft = draft.anchor;
    const vis = visible(), railOn = wide() && (vis.length || draft);
    document.documentElement.classList.toggle("cm-on", !!railOn);
    document.documentElement.style.setProperty("--cm-w", RAIL_W + 24 + "px");
    const n = all.filter(t => !t.resolved).length, live = all.some(t => t.thinking);
    tog.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>${n ? `<b>${n}</b>` : ""}${live ? "<i></i>" : ""}`;
    tog.classList.toggle("on", showResolved);
    tog.title = `${showResolved ? "Hide" : "Show"} resolved comments (${all.length - n} resolved) · press C to comment on any element`;
    if (!railOn) { rail.innerHTML = ""; rail.style.display = "none"; paintSheet(); paintMarks(vis); return; }
    sheet.classList.remove("on");
    rail.style.display = "block";
    rail.style.left = document.documentElement.clientWidth - RAIL_W - 14 + "px";
    rail.innerHTML = (draft ? newCard() : "") + vis.map(card).join("");
    layout(); paintMarks(vis);
    if (window.CM && CM.onchange) CM.onchange(all);
  }
  // passages: CSS highlights; elements: tinted boxes over them (they never take the pointer)
  function paintMarks(vis) {
    const list = vis.map(t => [t.id, anc[t.id]]).concat(draft ? [["_draft", draft.anchor]] : []);
    if (HL) {
      CSS.highlights.set("cm-anc", new Highlight(...list.filter(([, a]) => a.range).map(([, a]) => a.range)));
      const ar = anc[active]; ar && ar.range ? CSS.highlights.set("cm-act", new Highlight(ar.range)) : CSS.highlights.delete("cm-act");
    }
    boxes.innerHTML = list.filter(([, a]) => a.el && !a.whole).map(([id, a]) => {
      const b = rectOf(a); if (!b) return "";
      return `<div class="cm-box${id === active ? " act" : ""}" style="left:${b.left + scrollX - 2}px;top:${b.top + scrollY - 2}px;width:${b.width + 4}px;height:${b.height + 4}px"></div>`;
    }).join("");
  }
  function layout() {
    const cards = [...rail.children].map(c => ({ c, id: c.dataset.id, h: c.offsetHeight, a: topOf(anc[c.dataset.id]) }));
    cards.sort((x, y) => x.a - y.a);
    let k = cards.findIndex(x => x.id === active); if (k < 0) k = 0;
    if (cards[k]) cards[k].y = cards[k].a;
    for (let i = k + 1; i < cards.length; i++) cards[i].y = Math.max(cards[i].a, cards[i - 1].y + cards[i - 1].h + 8);
    for (let i = k - 1; i >= 0; i--) cards[i].y = Math.min(cards[i].a, cards[i + 1].y - cards[i].h - 8);
    for (const x of cards) x.c.style.top = x.y + "px";
  }
  const avatar = (name, agent) => agent ? `<span class="cm-av ai">AI</span>`
    : `<span class="cm-av" style="background:hsl(${hue(name)} 55% 46%)">${esc(initials(name))}</span>`;
  const msg = m => `<div class="cm-msg"><div class="cm-mh">${avatar(m.author, m.agent)}<div><b>${esc(m.agent ? "Agent" : m.author)}</b><span>${when(m.t)}</span></div></div>
      <div class="cm-body${m.error ? " err" : ""}">${esc(m.body)}</div></div>`;
  const target = t => t.what ? `<div class="cm-what" title="${esc(t.what)}">${esc(clean(t.what, 48))}</div>` : "";
  function card(t) {
    const on = t.id === active, first = t.messages[0], rest = t.messages.slice(1);
    return `<div class="cm-card${on ? " act" : ""}${t.resolved ? " res" : ""}" data-id="${esc(t.id)}">
      <div class="cm-tools">${t.resolved ? `<button class="cm-ic" data-reopen="${esc(t.id)}" title="Re-open">↺</button>`
        : `<button class="cm-ic ok" data-resolve="${esc(t.id)}" title="Mark as resolved">✓</button>`}</div>
      ${target(t)}${msg(first)}
      ${on ? rest.map(msg).join("") : rest.length ? `<div class="cm-more">${rest.length} repl${rest.length > 1 ? "ies" : "y"}${rest.at(-1).agent ? " · Agent" : ""}</div>` : ""}
      ${t.thinking ? `<div class="cm-think"><span class="cm-av ai">AI</span><i></i><i></i><i></i></div>` : ""}
      ${on && !t.resolved ? `<div class="cm-reply"><textarea rows="1" placeholder="Reply" data-reply="${esc(t.id)}"></textarea>
        <div class="cm-btns"><button class="cm-b pri" data-send-reply="${esc(t.id)}">Reply</button><button class="cm-b" data-cancel>Cancel</button></div></div>` : ""}
    </div>`;
  }
  function newCard() {
    return `<div class="cm-card act new" data-id="_draft">
      ${draft.what ? `<div class="cm-what">${esc(clean(draft.what, 48))}</div>` : ""}
      <div class="cm-mh">${avatar(me() || "You")}<div><b>${esc(me() || "You")}</b></div></div>
      ${me() ? "" : `<input class="cm-name" placeholder="Your name" data-me>`}
      <textarea rows="2" placeholder="Comment" data-new></textarea>
      <div class="cm-btns"><button class="cm-b pri" data-send>Comment</button><button class="cm-b" data-cancel>Cancel</button></div></div>`;
  }
  function paintSheet() {
    const t = all.find(x => x.id === active);
    if (!draft && !t) { sheet.classList.remove("on"); return; }
    sheet.innerHTML = `<div class="cm-grab"></div>${draft ? newCard() : card(t)}`;
    sheet.classList.add("on");
  }
  const focusNew = () => setTimeout(() => { const f = document.querySelector("[data-me]") || document.querySelector("[data-new]"); f && f.focus(); }, 30);
  function startDraft(d) { draft = d; active = "_draft"; add.classList.remove("on"); pending = null; render(); focusNew(); }

  // ---------- selected text → margin ＋
  let pending = null;
  document.addEventListener("selectionchange", () => {
    if (picking) return;
    const s = getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) { if (!add.matches(":hover")) { add.classList.remove("on"); pending = null; } return; }
    const r = s.getRangeAt(0), n = r.commonAncestorContainer, e = n.nodeType === 1 ? n : n.parentElement, q = clean(String(s), 600);
    if (!e || e.closest(UI) || e.closest("input,textarea") || q.length < 2) { add.classList.remove("on"); pending = null; return; }
    const root = e.closest(MODE.roots), b = r.getBoundingClientRect(), box = (root || document.querySelector("main") || document.body).getBoundingClientRect();
    pending = { key: MODE.keyOf(root), label: MODE.labelOf(root), quote: q, anchor: { range: r.cloneRange(), root } };
    const x = wide() ? Math.min(document.documentElement.clientWidth - 46, box.right + 10) : Math.min(innerWidth - 46, b.right + 6);
    add.style.left = x + scrollX + "px"; add.style.top = (wide() ? b.top : b.bottom + 6) + scrollY + "px";
    add.classList.add("on");
  });
  add.addEventListener("mousedown", e => e.preventDefault());
  add.addEventListener("click", () => { if (pending) { const d = pending; getSelection().removeAllRanges(); startDraft(d); } });

  // ---------- C: pick any element
  let picking = false, hov = null, stepped = false;  // stepped: ↑/↓ moved the pick away from the pointer
  const describe = e => {
    const tag = e.tagName.toLowerCase(), cls = typeof e.className === "string" ? e.className.trim().split(/\s+/).filter(c => c && !c.startsWith("cm-")).slice(0, 2) : [];
    const tip = e.getAttribute("data-tip") || e.getAttribute("aria-label") || e.getAttribute("title") || "";
    const txt = clean(tip || e.textContent, 70);
    const root = e.closest(MODE.roots);
    return `<${tag}${e.id ? "#" + e.id : ""}${cls.length ? "." + cls.join(".") : ""}>${txt ? ` “${txt}”` : ""}` + (root ? ` in ${MODE.labelOf(root)}` : "");
  };
  function startPick() {
    picking = true; hov = null; stepped = false; document.documentElement.classList.add("cm-picking"); phint.classList.add("on");
    add.classList.remove("on"); getSelection().removeAllRanges();
  }
  function stopPick() { picking = false; hov = null; document.documentElement.classList.remove("cm-picking"); phint.classList.remove("on"); pbox.style.display = ptag.style.display = "none"; }
  function drawPick() {
    if (!hov) { pbox.style.display = ptag.style.display = "none"; return; }
    const b = hov.getBoundingClientRect();
    Object.assign(pbox.style, { display: "block", left: b.left - 2 + "px", top: b.top - 2 + "px", width: b.width + 4 + "px", height: b.height + 4 + "px" });
    ptag.textContent = `${describe(hov)}  ·  ${Math.round(b.width)}×${Math.round(b.height)}`;
    Object.assign(ptag.style, { display: "block", left: Math.max(4, Math.min(innerWidth - 360, b.left)) + "px", top: (b.top > 30 ? b.top - 26 : b.bottom + 6) + "px" });
  }
  function pick(e) {
    if (!e) return;
    const root = e.closest(MODE.roots) || null, base = root || document.body;
    const tip = e.getAttribute("data-tip") || e.getAttribute("aria-label") || e.getAttribute("title");
    const quote = clean(tip || e.textContent, 300);
    stopPick();
    startDraft({ key: MODE.keyOf(root), label: MODE.labelOf(root), path: e === base ? "" : pathOf(base, e), what: describe(e), quote,
      anchor: { el: e, root: base, whole: e === base && base === document.body } });
  }
  addEventListener("mousemove", e => { if (!picking) return; const t = document.elementFromPoint(e.clientX, e.clientY);
    if (!t || t.closest(UI) || t === hov) return;
    if (stepped && hov && (hov.contains(t) || t.contains(hov))) return;  // still inside the stepped-to element: keep it
    stepped = false; hov = t; drawPick(); }, true);
  for (const ev of ["mousedown", "mouseup", "pointerdown", "pointerup"]) addEventListener(ev, e => { if (picking && !e.target.closest(".cm-phint")) { e.preventDefault(); e.stopPropagation(); } }, true);
  addEventListener("click", e => {
    if (!picking) return; e.preventDefault(); e.stopPropagation();
    if (e.target.closest(".cm-phint")) return;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    pick(stepped && hov ? hov : under && !under.closest(UI) ? under : hov);
  }, true);
  addEventListener("scroll", () => picking && drawPick(), true);

  document.addEventListener("keydown", e => {
    const typing = e.target.matches && e.target.matches("input,textarea,select,[contenteditable],[contenteditable] *");
    if (picking) {
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Escape") stopPick();
      else if (e.key === "ArrowUp" && hov && hov.parentElement && hov.parentElement !== document.documentElement) { hov = hov.parentElement; stepped = true; drawPick(); }
      else if (e.key === "ArrowDown" && hov && hov.firstElementChild) { hov = hov.firstElementChild; stepped = true; drawPick(); }
      else if (e.key === "Enter") pick(hov);
      return;
    }
    if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "c" || e.key === "C")) { e.preventDefault(); e.stopPropagation(); startPick(); return; }
    if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === "m" || e.key === "µ")) { e.preventDefault(); if (pending) { const d = pending; getSelection().removeAllRanges(); startDraft(d); } }
    if (e.key === "Escape" && (draft || active)) { draft = null; active = null; render(); }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && e.target.matches(".cm-card textarea")) e.target.closest(".cm-card").querySelector(".cm-b.pri").click();
  }, true);

  // ---------- clicks: cards, buttons, anchored text and elements
  document.addEventListener("click", async e => {
    if (picking) return;
    const inUI = e.target.closest(".cm-rail,.cm-sheet");
    const b = e.target.closest("[data-send],[data-send-reply],[data-resolve],[data-reopen],[data-cancel]");
    if (b && inUI) {
      const D = b.dataset;
      if (D.send !== undefined) {
        const who = document.querySelector("[data-me]"); if (who && who.value.trim()) setMe(who.value.trim());
        const ta = document.querySelector("[data-new]"); if (!ta.value.trim()) return ta.focus();
        const d = draft;
        const ev = await send({ kind: "comment", note: d.key, body: ta.value, quote: d.quote, label: d.label, path: d.path, what: d.what });
        if (ev) { draft = null; active = ev.id; render(); }
      } else if (D.sendReply) {
        const ta = document.querySelector(`[data-reply="${CSS.escape(D.sendReply)}"]`); if (!ta.value.trim()) return ta.focus();
        if (await send({ kind: "reply", parent: D.sendReply, body: ta.value })) render();
      } else if (D.resolve) { await send({ kind: "resolve", parent: D.resolve }); active = null; render(); }
      else if (D.reopen) { await send({ kind: "reopen", parent: D.reopen }); render(); }
      else if (D.cancel !== undefined) { draft = null; active = null; render(); }
      return;
    }
    const c = e.target.closest(".cm-card");
    if (c && inUI) { if (c.dataset.id !== active && c.dataset.id !== "_draft") { active = c.dataset.id; render(); } return; }
    if (e.target.closest(".cm-tog")) { showResolved = !showResolved; render(); return; }
    if (e.target.closest(UI)) return;
    const pos = document.caretPositionFromPoint ? document.caretPositionFromPoint(e.clientX, e.clientY) : null;
    const cr = pos ? { node: pos.offsetNode, off: pos.offset } : document.caretRangeFromPoint ? (r => r && { node: r.startContainer, off: r.startOffset })(document.caretRangeFromPoint(e.clientX, e.clientY)) : null;
    const hit = visible().find(t => { const a = anc[t.id];
      if (a.range) { try { return cr && a.range.isPointInRange(cr.node, cr.off); } catch (x) { return false; } }
      return a.el && !a.whole && a.el.contains(e.target); });
    if (hit) { active = hit.id; draft = null; render(); }
    else if ((active || draft) && getSelection().isCollapsed) { active = null; draft = null; render(); }
  });
  let rt;
  addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(render, 150); });
  new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { if (rail.children.length) { layout(); paintMarks(visible()); } }, 120); }).observe(document.body);

  // ---------- API for the host page
  window.CM = Object.assign(window.CM || {}, {
    refresh: render,
    threads: () => all,
    commentOn(rootId) {  // a comment on a whole root (a note): opens its newest thread, or a new one
      const t = all.filter(x => x.note === rootId && !x.resolved).at(-1);
      if (t) { active = t.id; draft = null; render(); return; }
      const root = document.getElementById(rootId);
      if (root) startDraft({ key: MODE.keyOf(root), label: MODE.labelOf(root), path: "", what: "", anchor: { el: root, root, whole: true } });
    },
    open(tid) { active = tid; draft = null; render(); const a = anc[tid]; if (a) scrollTo({ top: topOf(a) - 140, behavior: "smooth" }); },
    pick: startPick,
  });
  render(); load();
})();
