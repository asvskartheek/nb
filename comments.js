// Margin comments on a paper, Google Docs style, answered by agents (the notebook's /api/discussion: one agent per
// thread, several at once). Include on any page under papers/:
//   <link rel="stylesheet" href="../comments.css"><script src="../comments.js" defer></script>
// Select text inside a <section id> and press the ＋ in the margin (or Ctrl/Cmd+Alt+M). Each comment sits beside its
// passage, which stays highlighted; resolved threads hide (the header's comment button shows them again).
(() => {
  "use strict";
  const PAPER = location.pathname.split("/").pop().replace(/\.html$/, "");
  const API = "../api/discussion", RAIL_W = 296, WIDE = 1000;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const secOf = note => String(note).split("#")[1] || "";
  const me = () => { try { return localStorage.getItem("nb-author") || ""; } catch (e) { return ""; } };
  const setMe = v => { try { localStorage.setItem("nb-author", v); } catch (e) {} };
  const when = t => { const d = new Date(t * 1000);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + " " + d.toLocaleDateString([], { month: "short", day: "numeric" }); };
  const initials = n => (n || "?").trim().split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const hue = n => [...(n || "")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 200);
  const labelOf = sec => { const s = sec && document.getElementById(sec), h = s && s.querySelector("h1,h2,h3");
    return h ? h.textContent.replace(/\s+/g, " ").trim().slice(0, 60) : "Whole paper"; };
  const HL = !!(window.CSS && CSS.highlights && typeof Highlight !== "undefined");

  let all = [], active = null, draft = null, showResolved = false, ranges = {};

  // ---------- furniture: rail, margin ＋, header toggle, mobile sheet
  const rail = el("div", "cm-rail"), add = el("button", "cm-add"), sheet = el("div", "cm-sheet");
  add.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M12 8v8M8 12h8"/></svg>';
  add.title = "Add comment (Ctrl+Alt+M)";
  document.body.append(rail, add, sheet);
  const tog = el("button", "cm-tog"); tog.title = "Comments: show resolved";
  const top = document.querySelector("header .iconbtn#theme, header [id=theme]");
  top ? top.before(tog) : (tog.classList.add("cm-tog-float"), document.body.append(tog));
  function el(tag, cls) { const e = document.createElement(tag); e.className = cls; return e; }

  // ---------- data
  async function load() {
    try { setAll(await (await fetch(API)).json()); } catch (e) {}
    setTimeout(load, all.some(t => t.thinking || t.waiting) ? 2500 : 8000);
  }
  function setAll(list) {
    const focus = document.activeElement, typing = (rail.contains(focus) || sheet.contains(focus)) && focus.matches("textarea,input");
    all = list.filter(t => String(t.note).startsWith(`paper:${PAPER}#`));
    if (!typing) render();
  }
  async function send(d) {
    d.author = me() || "Reviewer";
    const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) });
    if (!r.ok) { alert("Could not post. Is the notebook server running?"); return null; }
    const ev = await r.json();
    all = (await (await fetch(API)).json()).filter(t => String(t.note).startsWith(`paper:${PAPER}#`));
    return ev;
  }

  // ---------- anchors: the quoted passage inside its section, whitespace-insensitive
  function findRange(sec, quote) {
    const root = (sec && document.getElementById(sec)) || null;
    if (!root || !quote) return null;
    const map = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n =>
      n.parentElement.closest(".cm-rail,script,style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    let txt = "", sp = true;
    for (let n; (n = w.nextNode());) for (let i = 0; i < n.data.length; i++) {
      const c = n.data[i];
      if (/\s/.test(c)) { if (!sp) { txt += " "; map.push([n, i]); sp = true; } }
      else { txt += c; map.push([n, i]); sp = false; }
    }
    const q = quote.replace(/\s+/g, " ").trim();
    let at = txt.indexOf(q), len = q.length;
    if (at < 0 && q.length > 40) { at = txt.indexOf(q.slice(0, 40)); len = 40; }
    if (at < 0) return null;
    const a = map[at], b = map[at + len - 1], r = new Range();
    r.setStart(a[0], a[1]); r.setEnd(b[0], b[1] + 1);
    return r;
  }
  function anchorTop(t) {
    const r = ranges[t.id];
    if (r) { const b = r.getBoundingClientRect(); if (b.height) return b.top + scrollY; }
    const s = document.getElementById(secOf(t.note));
    return s ? s.getBoundingClientRect().top + scrollY : 120;
  }

  // ---------- render
  const visible = () => all.filter(t => showResolved || !t.resolved || t.id === active);
  const wide = () => document.documentElement.clientWidth >= WIDE;
  function render() {
    ranges = {};
    for (const t of all) ranges[t.id] = findRange(secOf(t.note), t.quote);
    if (draft) ranges._draft = draft.range;
    const vis = visible(), railOn = wide() && (vis.length || draft);
    document.documentElement.classList.toggle("cm-on", !!railOn);
    document.documentElement.style.setProperty("--cm-w", RAIL_W + 24 + "px");
    paintHighlights(vis);
    const n = all.filter(t => !t.resolved).length, live = all.some(t => t.thinking);
    tog.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>${n ? `<b>${n}</b>` : ""}${live ? "<i></i>" : ""}`;
    tog.classList.toggle("on", showResolved);
    tog.title = showResolved ? "Hide resolved comments" : `Comments (${all.length}, ${all.length - n} resolved): show resolved`;
    if (!railOn) { rail.innerHTML = ""; rail.style.display = "none"; paintSheet(); return; }
    sheet.classList.remove("on");
    rail.style.display = "block";
    rail.style.left = document.documentElement.clientWidth - RAIL_W - 14 + "px";
    rail.innerHTML = (draft ? newCard() : "") + vis.map(card).join("");
    layout();
  }
  function paintHighlights(vis) {
    if (!HL) return;
    const rs = vis.map(t => ranges[t.id]).filter(Boolean);
    CSS.highlights.set("cm-anc", new Highlight(...rs));
    const ar = active === "_draft" ? draft && draft.range : ranges[active];
    ar ? CSS.highlights.set("cm-act", new Highlight(ar)) : CSS.highlights.delete("cm-act");
  }
  // cards sit at their anchor; overlaps push down, and the active card holds its place while the ones above move up
  function layout() {
    const cards = [...rail.children].map(c => ({ c, id: c.dataset.id, h: c.offsetHeight,
      a: c.dataset.id === "_draft" ? draft.top : anchorTop(all.find(t => t.id === c.dataset.id)) }));
    cards.sort((x, y) => x.a - y.a);
    let k = cards.findIndex(x => x.id === active); if (k < 0) k = 0;
    const gap = 8;
    if (cards[k]) cards[k].y = cards[k].a;
    for (let i = k + 1; i < cards.length; i++) cards[i].y = Math.max(cards[i].a, cards[i - 1].y + cards[i - 1].h + gap);
    for (let i = k - 1; i >= 0; i--) cards[i].y = Math.min(cards[i].a, cards[i + 1].y - cards[i].h - gap);
    for (const x of cards) x.c.style.top = x.y + "px";
  }
  function avatar(name, agent) {
    return agent ? `<span class="cm-av ai">AI</span>` : `<span class="cm-av" style="background:hsl(${hue(name)} 55% 46%)">${esc(initials(name))}</span>`;
  }
  function msg(m) {
    return `<div class="cm-msg"><div class="cm-mh">${avatar(m.author, m.agent)}<div><b>${esc(m.agent ? "Agent" : m.author)}</b><span>${when(m.t)}</span></div></div>
      <div class="cm-body${m.error ? " err" : ""}">${esc(m.body)}</div></div>`;
  }
  function card(t) {
    const on = t.id === active, first = t.messages[0], rest = t.messages.slice(1);
    const status = t.thinking ? `<div class="cm-think"><span class="cm-av ai">AI</span><i></i><i></i><i></i></div>` : "";
    return `<div class="cm-card${on ? " act" : ""}${t.resolved ? " res" : ""}" data-id="${esc(t.id)}">
      <div class="cm-tools">${t.resolved ? `<button class="cm-ic" data-reopen="${esc(t.id)}" title="Re-open">↺</button>`
        : `<button class="cm-ic ok" data-resolve="${esc(t.id)}" title="Mark as resolved">✓</button>`}</div>
      ${msg(first)}
      ${on ? rest.map(msg).join("") : rest.length ? `<div class="cm-more">${rest.length} repl${rest.length > 1 ? "ies" : "y"}${rest.at(-1).agent ? " · Agent" : ""}</div>` : ""}
      ${status}
      ${on && !t.resolved ? `<div class="cm-reply"><textarea rows="1" placeholder="Reply" data-reply="${esc(t.id)}"></textarea>
        <div class="cm-btns"><button class="cm-b pri" data-send-reply="${esc(t.id)}">Reply</button><button class="cm-b" data-cancel>Cancel</button></div></div>` : ""}
    </div>`;
  }
  function newCard() {
    return `<div class="cm-card act new" data-id="_draft">
      <div class="cm-mh">${avatar(me() || "You")}<div><b>${esc(me() || "You")}</b></div></div>
      ${me() ? "" : `<input class="cm-name" placeholder="Your name" data-me>`}
      <textarea rows="2" placeholder="Comment" data-new></textarea>
      <div class="cm-btns"><button class="cm-b pri" data-send>Comment</button><button class="cm-b" data-cancel>Cancel</button></div></div>`;
  }
  // narrow screens: no margin, the active thread opens as a bottom sheet
  function paintSheet() {
    const t = all.find(x => x.id === active);
    if (!draft && !t) { sheet.classList.remove("on"); return; }
    sheet.innerHTML = `<div class="cm-grab"></div>${draft ? newCard() : card(t)}`;
    sheet.classList.add("on");
  }
  function focusNew() { setTimeout(() => { const ta = document.querySelector("[data-me]") || document.querySelector("[data-new]"); ta && ta.focus(); }, 30); }

  // ---------- selection → margin ＋
  let pending = null;
  document.addEventListener("selectionchange", () => {
    const s = getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) { if (!add.matches(":hover")) { add.classList.remove("on"); pending = null; } return; }
    const r = s.getRangeAt(0), node = r.commonAncestorContainer, e = node.nodeType === 1 ? node : node.parentElement;
    const sec = e && e.closest("section[id]"), q = String(s).replace(/\s+/g, " ").trim();
    if (!sec || e.closest(".cm-rail,.cm-sheet") || q.length < 2) { add.classList.remove("on"); pending = null; return; }
    const b = r.getBoundingClientRect();
    pending = { sec: sec.id, quote: q.slice(0, 600), range: r.cloneRange(), top: b.top + scrollY };
    const right = wide() ? Math.min(document.documentElement.clientWidth - 46, sec.getBoundingClientRect().right + 10) : Math.min(innerWidth - 46, b.right + 6);
    add.style.left = right + "px"; add.style.top = (wide() ? b.top : b.bottom + 6) + scrollY + "px";
    add.classList.add("on");
  });
  add.addEventListener("mousedown", e => e.preventDefault());
  add.addEventListener("click", startDraft);
  function startDraft() {
    if (!pending) return;
    draft = pending; pending = null; active = "_draft"; add.classList.remove("on");
    getSelection().removeAllRanges(); render(); focusNew();
  }
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === "m" || e.key === "µ")) { e.preventDefault(); startDraft(); }
    if (e.key === "Escape" && (draft || active)) { draft = null; active = null; render(); }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && e.target.matches(".cm-card textarea"))
      e.target.closest(".cm-card").querySelector(".cm-b.pri").click();
  });

  // ---------- clicks: cards, buttons, highlighted text
  document.addEventListener("click", async e => {
    const inUI = e.target.closest(".cm-rail,.cm-sheet");
    const b = e.target.closest("[data-send],[data-send-reply],[data-resolve],[data-reopen],[data-cancel]");
    if (b && inUI) {
      const D = b.dataset;
      if (D.send !== undefined) {
        const who = document.querySelector("[data-me]"); if (who && who.value.trim()) setMe(who.value.trim());
        const ta = document.querySelector("[data-new]"); if (!ta.value.trim()) return ta.focus();
        const d = draft;
        const ev = await send({ kind: "comment", note: `paper:${PAPER}#${d.sec}`, body: ta.value, quote: d.quote, label: labelOf(d.sec) });
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
    if (e.target.closest(".cm-add,.cm-tog")) { if (e.target.closest(".cm-tog")) { showResolved = !showResolved; render(); } return; }
    // a click on highlighted text opens its thread
    const pos = document.caretPositionFromPoint ? document.caretPositionFromPoint(e.clientX, e.clientY) : null;
    const cr = pos ? { node: pos.offsetNode, off: pos.offset } : document.caretRangeFromPoint ? (r => r && { node: r.startContainer, off: r.startOffset })(document.caretRangeFromPoint(e.clientX, e.clientY)) : null;
    const hit = cr && visible().find(t => { const r = ranges[t.id]; try { return r && r.isPointInRange(cr.node, cr.off); } catch (x) { return false; } });
    if (hit) { active = hit.id; draft = null; render(); }
    else if ((active || draft) && getSelection().isCollapsed) { active = null; draft = null; render(); }
  });
  let rt; const relayout = () => { clearTimeout(rt); rt = setTimeout(() => rail.children.length ? layout() : null, 120); };
  addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(render, 150); });
  new ResizeObserver(relayout).observe(document.body);
  render(); load();
})();
