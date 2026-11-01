// Comment threads on a paper, answered by agents (the notebook's /api/discussion; one agent per thread, several at once).
// Include on any page under papers/: <link rel="stylesheet" href="../comments.css"><script src="../comments.js" defer></script>
// Anchors: every <section id> gets a marker; selecting text inside a section offers "Comment" with that quote.
(() => {
  "use strict";
  const PAPER = location.pathname.split("/").pop().replace(/\.html$/, "");
  const API = "../api/discussion";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const key = sec => `paper:${PAPER}#${sec || ""}`;
  const secOf = note => String(note).split("#")[1] || "";
  const me = () => { try { return localStorage.getItem("nb-author") || ""; } catch (e) { return ""; } };
  const setMe = v => { try { localStorage.setItem("nb-author", v); } catch (e) {} };
  const when = t => new Date(t * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const sections = [...document.querySelectorAll("section[id]")];
  const labelOf = sec => { const s = document.getElementById(sec); const h = s && s.querySelector("h1,h2,h3");
    return h ? h.textContent.replace(/\s+/g, " ").trim().slice(0, 60) : sec || "Whole paper"; };
  let all = [], view = "all", draft = null, open = false;

  // ---------- page furniture
  for (const s of sections) {
    s.classList.add("cm-sec");
    const b = document.createElement("button");
    b.className = "cm-mark"; b.dataset.sec = s.id; b.title = "Comment on this section";
    s.prepend(b);
  }
  const fab = document.createElement("button"); fab.className = "cm-fab"; document.body.append(fab);
  const sel = document.createElement("button"); sel.className = "cm-sel"; sel.textContent = "Comment"; document.body.append(sel);
  const dr = document.createElement("aside"); dr.className = "cm-dr"; dr.setAttribute("aria-label", "Comments");
  dr.innerHTML = `<div class="cm-h"><b>Comments</b><button class="cm-x" aria-label="Close">✕</button></div><div class="cm-tabs"></div><div class="cm-b"></div>`;
  document.body.append(dr);
  const icon = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';

  // ---------- data
  async function load() {
    try { all = (await (await fetch(API)).json()).filter(t => String(t.note).startsWith(`paper:${PAPER}#`)); } catch (e) { all = []; }
    paintMarks();
    if (open && !dr.contains(document.activeElement)) paint();
    setTimeout(load, all.some(t => t.thinking || t.waiting) || open ? 2500 : 10000);
  }
  async function send(d) {
    d.author = me() || "Reviewer";
    const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) });
    if (!r.ok) { alert("Could not post. Is the notebook server running?"); return false; }
    all = (await (await fetch(API)).json()).filter(t => String(t.note).startsWith(`paper:${PAPER}#`));
    paintMarks(); paint(); return true;
  }
  function paintMarks() {
    const c = {}; for (const t of all) c[secOf(t.note)] = (c[secOf(t.note)] || 0) + 1;
    document.querySelectorAll(".cm-mark").forEach(b => { const n = c[b.dataset.sec] || 0; b.classList.toggle("has", !!n); b.innerHTML = icon + (n ? ` ${n}` : ""); });
    const live = all.filter(t => t.thinking).length;
    fab.innerHTML = `${icon} Comments ${all.length ? `<span class="ct">${all.length}</span>` : ""}${live ? '<i class="live" title="agent answering"></i>' : ""}`;
  }

  // ---------- drawer
  function paint() {
    const secs = [...new Set(all.map(t => secOf(t.note)))];
    const tabs = [["all", "All"], ...(draft ? [[draft.sec, labelOf(draft.sec)]] : []), ...secs.filter(s => !draft || s !== draft.sec).map(s => [s, labelOf(s)])];
    if (!tabs.some(([k]) => k === view)) view = "all";
    dr.querySelector(".cm-tabs").innerHTML = tabs.map(([k, l]) => `<button class="cm-tab${view === k ? " on" : ""}" data-view="${esc(k)}">${esc(l.length > 26 ? l.slice(0, 25) + "…" : l)}</button>`).join("");
    const list = all.filter(t => view === "all" || secOf(t.note) === view)
      .sort((a, b) => (b.thinking - a.thinking) || (b.messages.at(-1).t - a.messages.at(-1).t));
    const sec = draft ? draft.sec : view === "all" ? "" : view;
    dr.querySelector(".cm-b").innerHTML = `<div class="cm-new">
      <div class="cm-ctx">On <button class="cm-chip" data-goto="${esc(sec)}">§ ${esc(labelOf(sec))}</button>${draft ? `<button class="cm-link" data-clear>clear</button>` : ""}</div>
      ${draft && draft.quote ? `<div class="cm-q">${esc(draft.quote)}</div>` : ""}
      <input class="cm-in" placeholder="Your name" value="${esc(me())}" data-me>
      <textarea class="cm-ta" placeholder="Ask or comment; an agent answers from the project's evidence…" data-new></textarea>
      <div class="cm-acts"><button class="cm-btn pri" data-send>Comment</button></div></div>
      ${list.map(thread).join("") || `<div class="cm-empty">No comments here yet.</div>`}`;
  }
  function thread(t) {
    const st = t.resolved ? ["resolved", ""] : t.thinking ? ["agent answering…", "think"] : t.waiting ? ["queued", "wait"] : ["answered", "done"];
    const s = secOf(t.note);
    return `<div class="cm-th${t.resolved ? " res" : ""}"><div class="cm-thh"><button class="cm-chip" data-goto="${esc(s)}" data-quote="${esc(t.quote || "")}">§ ${esc(labelOf(s))}</button>
      <span class="sp"></span><span class="cm-st ${st[1]}">${st[0]}</span><button class="cm-link" data-res="${esc(t.id)}" data-k="${t.resolved ? "reopen" : "resolve"}">${t.resolved ? "Reopen" : "Resolve"}</button></div>
      ${t.quote ? `<div class="cm-thq"><div class="cm-q">${esc(t.quote)}</div></div>` : ""}
      ${t.messages.map(m => `<div class="cm-m"><div class="cm-who${m.agent ? " ag" : ""}">${esc(m.agent ? "Agent" : m.author)}<span>${when(m.t)}</span></div><p${m.error ? ' class="err"' : ""}>${esc(m.body)}</p></div>`).join("")}
      ${t.thinking ? `<div class="cm-m"><div class="cm-who ag">Agent</div><p style="color:var(--ink-3)">reading the evidence…</p></div>` : ""}
      <div class="cm-rep"><textarea class="cm-ta" style="min-height:44px" placeholder="Reply…" data-reply="${esc(t.id)}"></textarea>
      <div class="cm-acts"><button class="cm-btn pri" data-send-reply="${esc(t.id)}">Reply</button></div></div></div>`;
  }
  const show = () => { open = true; dr.classList.add("open"); paint(); };
  const hide = () => { open = false; draft = null; dr.classList.remove("open"); };

  // ---------- go to a section, highlight the quoted passage
  function goto(sec, quote) {
    const s = sec ? document.getElementById(sec) : document.body; if (!s) return;
    s.scrollIntoView({ behavior: "smooth", block: "start" });
    s.classList.add("cm-flash"); setTimeout(() => s.classList.remove("cm-flash"), 1500);
    if (!quote || !window.CSS || !CSS.highlights || typeof Highlight === "undefined") return;
    const needle = quote.replace(/\s+/g, " ").trim().slice(0, 80), w = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      const i = n.data.indexOf(needle.slice(0, Math.min(needle.length, n.data.length)));
      if (needle.length > 2 && i >= 0 && n.data.length >= 3) {
        const r = new Range(); r.setStart(n, i); r.setEnd(n, Math.min(n.data.length, i + needle.length));
        CSS.highlights.set("cm-quote", new Highlight(r)); setTimeout(() => CSS.highlights.delete("cm-quote"), 4000); return;
      }
    }
  }

  // ---------- events
  document.addEventListener("mouseup", e => {
    if (dr.contains(e.target) || e.target === sel) return;
    setTimeout(() => {
      const s = getSelection(), txt = s && String(s).replace(/\s+/g, " ").trim();
      const sec = s && s.rangeCount && s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement)?.closest("section[id]");
      if (!txt || txt.length < 3 || !sec) return sel.classList.remove("on");
      const r = s.getRangeAt(0).getBoundingClientRect();
      sel.style.left = Math.max(8, Math.min(innerWidth - 110, r.left + r.width / 2 - 45)) + scrollX + "px";
      sel.style.top = r.bottom + scrollY + 8 + "px";
      sel.dataset.sec = sec.id; sel.dataset.quote = txt.slice(0, 600); sel.classList.add("on");
    }, 0);
  });
  sel.addEventListener("mousedown", e => e.preventDefault());
  sel.addEventListener("click", () => { draft = { sec: sel.dataset.sec, quote: sel.dataset.quote }; view = draft.sec; sel.classList.remove("on");
    getSelection().removeAllRanges(); show(); dr.querySelector("[data-new]").focus(); });
  fab.addEventListener("click", () => open ? hide() : (view = "all", show()));
  dr.querySelector(".cm-x").addEventListener("click", hide);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && open) hide();
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && dr.contains(e.target) && e.target.matches("textarea"))
      e.target.closest(".cm-new,.cm-rep").querySelector(".cm-btn.pri").click();
  });
  document.addEventListener("click", async e => {
    const m = e.target.closest(".cm-mark"); if (m) { draft = { sec: m.dataset.sec }; view = m.dataset.sec; show(); return; }
    const g = e.target.closest("[data-goto],[data-view],[data-clear],[data-send],[data-send-reply],[data-res]");
    if (!g || !dr.contains(g)) return;
    const D = g.dataset;
    if (D.view !== undefined) { view = D.view; draft = view === "all" ? null : { sec: view }; paint(); }
    else if (D.goto !== undefined) { goto(D.goto, D.quote); if (innerWidth < 700) hide(); }
    else if (D.clear !== undefined) { draft = null; view = "all"; paint(); }
    else if (D.send !== undefined) {
      const ta = dr.querySelector("[data-new]"), who = dr.querySelector("[data-me]");
      if (who) setMe(who.value.trim());
      if (!ta.value.trim()) return;
      const sec = draft ? draft.sec : view === "all" ? "" : view;
      if (await send({ kind: "comment", note: key(sec), body: ta.value, quote: draft && draft.quote, label: labelOf(sec) })) { draft = null; view = sec || "all"; paint(); }
    }
    else if (D.sendReply) { const ta = dr.querySelector(`[data-reply="${CSS.escape(D.sendReply)}"]`); if (ta.value.trim()) send({ kind: "reply", parent: D.sendReply, body: ta.value }); }
    else if (D.res) send({ kind: D.k, parent: D.res });
  });
  paintMarks(); load();
})();
