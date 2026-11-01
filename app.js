// Research notebook: notes as a time-ordered log, lines of work as lanes, agent chats per note.
"use strict";
const $ = s => document.querySelector(s);
const { esc, trunc, fmt, fmtT, LOWER_BETTER } = NBViz;  // viz.js loads first
const IST = 330 * 60000;
const ist = ts => new Date(Date.parse(ts) + IST);           // read with getUTC*: the project's local time, any viewer
const dayKey = ts => ist(ts).toISOString().slice(0, 10);
const hhmm = ts => ist(ts).toISOString().slice(11, 16);
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const dayLabel = k => { const d = new Date(k + "T00:00:00Z"); return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const AREAS = ["setup","infra","data","eval","agent","retrieval","reading","model","cost","latency","analysis","tooling","process"];
const KINDS = ["setup","build","run","result","finding","decision","deadend","fix","question","milestone"];
const KCOL = {setup:"var(--ink-3)",build:"var(--ink-3)",run:"var(--info)",result:"var(--info)",finding:"var(--fnd)",
  question:"var(--fnd)",decision:"var(--dec)",deadend:"var(--loss)",fix:"var(--win)",milestone:"var(--win)"};

const S = { notes: [], threads: {}, byId: {}, disc: [], q: "", kind: null, thread: null, area: null, led: {} };

// ---------- theme
const themeBtn = $("#theme");
const curTheme = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
const paintTheme = () => themeBtn.innerHTML = curTheme() === "dark"
  ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
  : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';
themeBtn.onclick = () => { const t = curTheme() === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = t;
  try { localStorage.setItem("nb-theme", t); } catch (e) {} paintTheme(); };
paintTheme();

// ---------- load
async function load() {
  let d;
  try { d = await (await fetch("api/notes")).json(); } catch (e) { d = window.NB_DATA || { threads: [], notes: [] }; }
  S.notes = d.notes.filter(n => n.id && n.ts && !isNaN(Date.parse(n.ts))).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  S.byId = Object.fromEntries(S.notes.map(n => [n.id, n]));
  S.threads = {};
  for (const t of d.threads) S.threads[t.id] = { ...t, notes: [] };
  for (const n of S.notes) {
    const t = S.threads[n.thread] ||= { id: n.thread, title: n.thread.replace(/^t-/, "").replace(/-/g, " "), area: "process", notes: [] };
    t.notes.push(n);
    for (const a of n.after || []) (S.led[a] ||= []).push(n.id);
  }
  const order = Object.values(S.threads).filter(t => t.notes.length)
    .sort((a, b) => Date.parse(a.notes[0].ts) - Date.parse(b.notes[0].ts));
  order.forEach((t, i) => {
    const first = Date.parse(t.notes[0].ts), last = Date.parse(t.notes.at(-1).ts);
    const s = Date.parse(t.start), e = Date.parse(t.end);
    t.t0 = isNaN(s) ? first : Math.min(s, first); t.t1 = isNaN(e) ? last : Math.max(e, last);
    t.color = `var(--c${i % 12})`; t.ord = i;
    if (!AREAS.includes(t.area)) t.area = "process";
  });
  for (const id in S.threads) if (!S.threads[id].notes.length) delete S.threads[id];
  readHash(); renderAll(); pollDisc();
}

// ---------- filtering
function visible() {
  const q = S.q.toLowerCase();
  return S.notes.filter(n => {
    if (S.kind && n.kind !== S.kind) return false;
    if (S.thread && n.thread !== S.thread) return false;
    if (S.area && S.threads[n.thread].area !== S.area) return false;
    if (!q) return true;
    const hay = [n.title, ...(n.facts || []), S.threads[n.thread].title, n.thread, ...(n.refs || []).map(r => r.value),
      ...(n.tags || []), ...(n.metrics || []).map(m => m.label), n.kind, n.status].join(" ").toLowerCase();
    return q.split(/\s+/).every(w => hay.includes(w));
  });
}
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  S.thread = h.get("t") && S.threads[h.get("t")] ? h.get("t") : null;
}
function setThread(id) { S.thread = id; S.area = null; history.replaceState(null, "", id ? "#t=" + encodeURIComponent(id) : location.pathname); renderAll(); window.scrollTo({ top: $(".layout").offsetTop - 60, behavior: "smooth" }); }

// ---------- header + KPIs
function renderTop() {
  const ns = S.notes, ts = Object.values(S.threads);
  const days = new Set(ns.map(n => dayKey(n.ts))).size;
  if (ns.length) $("#meta").textContent = `${dayLabel(dayKey(ns[0].ts))} → ${dayLabel(dayKey(ns.at(-1).ts))} ${ist(ns.at(-1).ts).getUTCFullYear()}`;
  const oc = k => ts.filter(t => t.outcome === k).length;
  const k = [["Notes", ns.length], ["Lines of work", ts.length], ["Active days", days],
    ["Results", ns.filter(n => n.kind === "result").length], ["Decisions", ns.filter(n => n.kind === "decision").length],
    ["Wins", oc("win") + oc("shipped")], ["Null", oc("null")], ["Dead ends", oc("loss") + oc("abandoned")]];
  $("#kpis").innerHTML = k.map(([l, v]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");
  $("#legend").innerHTML = [["run / result", "var(--info)"], ["finding", "var(--fnd)"], ["decision", "var(--dec)"],
    ["dead end", "var(--loss)"], ["milestone / fix", "var(--win)"], ["setup / build", "var(--ink-3)"]]
    .map(([l, c]) => `<span><i style="background:${c}"></i>${l}</span>`).join("");
}

// ---------- headline trajectory: the accuracy series that tell the story, each on one fixed slice
const SERIES = [
  ["Task A · full 300", m => /task a|\btask\b/i.test(m.label) && !/183|98|ctl|core|right|gain/i.test(m.label) && (!m.n || m.n >= 300 && m.n <= 310)],
  ["Task A · slice 180", m => /183/.test(m.label)],
  ["All tasks · 700", m => m.n === 723 || /overall|all six|all sheets/i.test(m.label) && (!m.n || m.n > 700)],
  ["Task B · 120", m => /^docs?\b/i.test(m.label) && (!m.n || m.n === 120)],
];
function renderTraj() {
  const series = {};
  for (const n of S.notes) for (const m of n.metrics || []) {
    if (typeof m.value !== "number" || m.unit !== "%" || m.value <= 0 || m.value > 100) continue;
    if (/GER|recall|hit|retriev|sem sim|parity|coverage|share|rate/i.test(m.label || "")) continue;  // not accuracy
    const s = SERIES.find(([, f]) => f(m)); if (!s) continue;
    (series[s[0]] ||= []).push({ t: Date.parse(n.ts), v: m.value, n, m });
  }
  const top = SERIES.map(([k]) => [k, series[k] || []]).filter(([, p]) => p.length >= 2);
  if (!top.length) { $("#trajp").hidden = true; return; }
  $("#trajp").hidden = false;
  const W = 1000, H = 190, L = 40, R = 12, T = 12, B = 22;
  const t0 = Date.parse(S.notes[0].ts), t1 = Date.parse(S.notes.at(-1).ts);
  const all = top.flatMap(([, p]) => p.map(x => x.v));
  const lo = Math.max(0, Math.floor((Math.min(...all) - 3) / 10) * 10), hi = Math.min(100, Math.ceil((Math.max(...all) + 3) / 10) * 10);
  const x = t => L + (t - t0) / Math.max(1, t1 - t0) * (W - L - R), y = v => T + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - T - B);
  let g = "";
  for (let v = lo; v <= hi; v += 10) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`;
  const cols = ["var(--c0)", "var(--c1)", "var(--c2)", "var(--c3)"];
  top.forEach(([k, p], i) => {
    p.sort((a, b) => a.t - b.t);
    g += `<polyline fill="none" stroke="${cols[i]}" stroke-width="1.6" stroke-opacity=".45" points="${p.map(q => `${x(q.t)},${y(q.v)}`).join(" ")}"/>`;
    g += p.map(q => `<circle cx="${x(q.t)}" cy="${y(q.v)}" r="3.5" fill="${cols[i]}" style="cursor:pointer" data-note="${esc(q.n.id)}" data-tip="${esc(`${k}: ${q.v}% (${q.m.label}${q.m.n ? ", n=" + q.m.n : ""}) · ${q.n.title}`)}"/>`).join("");
  });
  for (let d = new Date(dayKey(S.notes[0].ts) + "T00:00:00Z").getTime() - IST; d <= t1; d += 7 * 864e5)
    if (x(d) > L + 16) g += `<text x="${x(d)}" y="${H - 6}" text-anchor="middle">${dayLabel(dayKey(new Date(d).toISOString())).slice(4)}</text>`;
  $("#traj").innerHTML = `<svg viewBox="0 0 ${W} ${H}">${g}</svg>`;
  $("#trajleg").innerHTML = top.map(([k, p], i) => `<span><i style="background:${cols[i]}"></i>${esc(k)} (${p.length})</span>`).join("");
}

// ---------- lanes: every line of work on one time axis, grouped by area
function renderLanes() {
  const svg = $("#lanes"), box = $("#lanesbox");
  const W = Math.max(760, box.clientWidth || 1000), LW = 230, RH = 17, top = 22;
  const t0 = Math.min(...Object.values(S.threads).map(t => t.t0)), t1 = Math.max(...Object.values(S.threads).map(t => t.t1));
  const x = t => LW + (t - t0) / Math.max(1, t1 - t0) * (W - LW - 14);
  const groups = AREAS.map(a => [a, Object.values(S.threads).filter(t => t.area === a).sort((p, q) => p.t0 - q.t0)]).filter(g => g[1].length);
  let y = top, g = "";
  const d0 = new Date(dayKey(new Date(t0).toISOString()) + "T00:00:00Z").getTime() - IST;
  const span = (t1 - t0) / 864e5, every = span > 40 ? 4 : span > 20 ? 2 : 1;
  let ticks = "";
  for (let d = d0, i = 0; d <= t1 + 864e5; d += 864e5, i++) {
    if (d < t0 - 864e5) continue;
    ticks += `<line class="grid" x1="${x(d)}" x2="${x(d)}" y1="${top - 4}" y2="__H__"/>`;
    if (i % every === 0) ticks += `<text class="tick" x="${x(d) + 3}" y="12">${dayLabel(dayKey(new Date(d + 1).toISOString())).slice(4)}</text>`;
  }
  for (const [a, ts] of groups) {
    g += `<text class="area" x="8" y="${y + 12}">${a}</text>`; y += RH;
    for (const t of ts) {
      const sel = S.thread === t.id ? " sel" : "";
      g += `<g class="lrow${sel}" data-thread="${esc(t.id)}" style="cursor:pointer"><rect class="hit" x="0" y="${y}" width="${W}" height="${RH}" fill="transparent"/>
        <rect x="8" y="${y + 5}" width="7" height="7" rx="1.5" fill="${t.color}"/>
        <text x="21" y="${y + 12}">${esc(trunc(t.title, 34))}</text>
        <rect x="${x(t.t0)}" y="${y + 7}" width="${Math.max(3, x(t.t1) - x(t.t0))}" height="3" rx="1.5" fill="${t.color}" opacity=".35"/>
        ${t.notes.map(n => dotSvg(x(Date.parse(n.ts)), y + 8.5, n, t)).join("")}</g>`;
      y += RH;
    }
    y += 6;
  }
  svg.setAttribute("viewBox", `0 0 ${W} ${y}`); svg.setAttribute("height", y); svg.style.width = W + "px";
  svg.innerHTML = ticks.replaceAll("__H__", y) + g;
}
const dotSvg = (cx, cy, n, t) => n.kind === "milestone"
  ? `<rect x="${cx - 4}" y="${cy - 4}" width="8" height="8" transform="rotate(45 ${cx} ${cy})" fill="${KCOL[n.kind]}" data-note="${esc(n.id)}" data-tip="${esc(hhmm(n.ts) + " " + dayLabel(dayKey(n.ts)) + " · " + n.title)}"/>`
  : `<circle cx="${cx}" cy="${cy}" r="3.4" fill="${KCOL[n.kind] || "var(--ink-3)"}" data-note="${esc(n.id)}" data-tip="${esc(hhmm(n.ts) + " " + dayLabel(dayKey(n.ts)) + " · " + n.title)}"/>`;

// ---------- index sidebar
function renderIndex() {
  const ts = Object.values(S.threads);
  let h = `<h3>Kind</h3><div class="chips">${KINDS.filter(k => S.notes.some(n => n.kind === k)).map(k =>
    `<button class="chip${S.kind === k ? " on" : ""}" data-kind="${k}">${k}</button>`).join("")}</div>`;
  for (const a of AREAS) {
    const g = ts.filter(t => t.area === a).sort((p, q) => p.t0 - q.t0);
    if (!g.length) continue;
    h += `<h3><button class="tl${S.area === a ? " on" : ""}" data-area="${a}" style="padding:0;font:inherit;text-transform:inherit;letter-spacing:inherit;color:inherit">${a} · ${g.length}</button></h3>`;
    h += g.map(t => `<button class="tl${S.thread === t.id ? " on" : ""}" data-thread="${esc(t.id)}" title="${esc(t.title)}"><i style="background:${t.color}"></i><span>${esc(t.title)}</span>${t.outcome ? `<b class="st s-${esc(t.outcome)}" style="font-size:9px;padding:0 4px">${esc(t.outcome)}</b>` : ""}<em>${t.notes.length}</em></button>`).join("");
  }
  $("#index").innerHTML = h;
}

// ---------- the log
function renderLog() {
  const ns = visible();
  const f = [];
  if (S.thread) f.push(["line", S.threads[S.thread].title, "thread"]);
  if (S.area) f.push(["area", S.area, "area"]);
  if (S.kind) f.push(["kind", S.kind, "kind"]);
  if (S.q) f.push(["search", S.q, "q"]);
  $("#filters").innerHTML = f.map(([l, v, k]) => `<span class="f">${l}: <b>${esc(v)}</b><button data-clear="${k}" aria-label="Clear">✕</button></span>`).join("")
    + `<span class="count">${ns.length} of ${S.notes.length} notes</span>`
    + (S.thread ? ` <button class="textbtn" data-info="${esc(S.thread)}">Line of work ›</button>` : "");
  if (!ns.length) { $("#log").innerHTML = `<div class="empty">No notes match.</div>`; return; }
  const days = {};
  for (const n of ns) (days[dayKey(n.ts)] ||= []).push(n);
  const cnt = discCount();
  let h = "";
  for (const [k, list] of Object.entries(days)) {
    const dStart = Date.parse(k + "T00:00:00Z") - IST, dEnd = dStart + 864e5;
    const tids = [...new Set(list.map(n => n.thread))];
    // lanes: lines of work alive in this day, packed so parallel work sits side by side
    const act = tids.map(id => S.threads[id]).sort((a, b) => a.t0 - b.t0 || a.ord - b.ord);
    const lanes = [], laneOf = {};
    for (const t of act) {
      const first = Math.max(t.t0, dStart), seen = list.filter(n => n.thread === t.id);
      const a0 = Date.parse(seen[0].ts) > t.t0 ? Math.max(t.t0, dStart) : Date.parse(seen[0].ts), a1 = Math.min(t.t1, dEnd);
      let i = lanes.findIndex(e => e < a0 - 1);
      if (i < 0) { i = lanes.length; lanes.push(0); }
      lanes[i] = a1; laneOf[t.id] = { i, a0: first, a1 };
    }
    const gw = Math.max(1, lanes.length) * 16 + 14;
    h += `<section class="day" style="--gw:${gw}px"><div class="dayhead"><b>${dayLabel(k)}</b><span>${list.length} notes · ${tids.length} line${tids.length > 1 ? "s" : ""} of work${lanes.length > 1 ? ` · ${lanes.length} in parallel` : ""}</span><div class="bar"></div></div>`;
    for (const n of list) {
      const tt = Date.parse(n.ts), t = S.threads[n.thread];
      let gut = "";
      for (const id of tids) {
        const L = laneOf[id], th = S.threads[id];
        if (tt < L.a0 || tt > L.a1) continue;
        const firstHere = Date.parse(th.notes[0].ts) === tt, lastHere = Date.parse(th.notes.at(-1).ts) === tt && th.t1 <= tt;
        const top = firstHere && th.t0 >= tt ? 22 : 0, bot = lastHere ? "calc(100% - 22px)" : "0";
        gut += `<div class="ln" style="left:${8 + L.i * 16}px;top:${top}px;bottom:${bot};background:${th.color}"></div>`;
      }
      gut += `<div class="dot${n.kind === "milestone" ? " ms" : ""}" style="left:${8 + laneOf[n.thread].i * 16}px;background:${t.color}"></div>`;
      h += `<div class="row"><div class="time">${hhmm(n.ts)}</div><div class="gut">${gut}</div><div class="cardwrap">${card(n, cnt[n.id])}</div></div>`;
    }
    h += `</section>`;
  }
  $("#log").innerHTML = h;
  cmRefresh();
}

function card(n, dc) {
  const t = S.threads[n.thread];
  const facts = (n.facts || []).slice(0, 3);
  const after = (n.after || []).filter(id => S.byId[id]), led = (S.led[n.id] || []).filter(id => S.byId[id]);
  const link = id => `<a data-goto="${esc(id)}" title="${esc(S.byId[id].title)}">${esc(trunc(S.byId[id].title, 42))}</a>`;
  return `<article class="card" id="${esc(n.id)}">
    <div class="card-h"><span class="kind k-${esc(n.kind)}">${esc(n.kind || "note")}</span>
      ${n.status && !["done"].includes(n.status) ? `<span class="st s-${esc(n.status)}">${esc(n.status)}</span>` : ""}
      <button class="thr" data-thread="${esc(t.id)}"><i style="background:${t.color}"></i>${esc(t.title)}</button>
      <span class="grow"></span>
      <button class="disc${dc ? " has" : ""}" data-chat="${esc(n.id)}" title="Comment (or press C and pick any element)">${chatIcon}${dc ? dc : ""}</button></div>
    <h3 class="title">${esc(n.title)}</h3>
    ${facts.length ? `<ul class="facts">${facts.map(f => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
    ${metrics(n.metrics)}
    ${n.viz ? `<div class="viz">${viz(n.viz, t.color)}</div>` : ""}
    ${(n.refs || []).length ? `<div class="refs">${n.refs.slice(0, 8).map(r => r.type === "paper"
      ? `<a class="ref" href="papers/${esc(r.value)}.html" style="text-decoration:none;color:var(--accent);border-color:var(--accent)"><b style="color:inherit">paper</b> ${esc(r.value)} ›</a>`
      : `<span class="ref" title="${esc(r.type + ": " + r.value)}"><b>${esc(r.type)}</b> ${esc(r.value)}</span>`).join("")}</div>` : ""}
    ${after.length || led.length ? `<div class="after">${after.length ? `from ${after.map(link).join(" · ")}` : ""}${after.length && led.length ? " &nbsp;→&nbsp; " : ""}${led.length ? `led to ${led.slice(0, 4).map(link).join(" · ")}${led.length > 4 ? ` +${led.length - 4}` : ""}` : ""}</div>` : ""}
  </article>`;
}
const chatIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';

function metrics(ms) {
  if (!ms || !ms.length) return "";
  return `<div class="metrics">${ms.slice(0, 6).map(m => {
    let d = "";
    if (typeof m.before === "number" && typeof m.value === "number") {
      const dv = m.value - m.before, good = LOWER_BETTER.test((m.label || "") + " " + (m.unit || "")) ? dv < 0 : dv > 0;
      d = `<div class="d ${dv === 0 ? "eq" : good ? "up" : "dn"}">${dv > 0 ? "+" : ""}${fmtT(+dv.toFixed(4), m.unit === "%" ? "pp" : m.unit)} vs ${fmtT(m.before, m.unit)}</div>`;
    }
    const sub = [m.n != null ? `n=${m.n}` : "", m.ci ? `CI ${m.ci.join("–")}` : ""].filter(Boolean).join(" · ");
    return `<div class="m"><div class="v">${fmt(m.value, m.unit)}</div><div class="l">${esc(m.label)}${sub ? ` · ${esc(sub)}` : ""}</div>${d}</div>`;
  }).join("")}</div>`;
}

// ---------- visuals: the shared kit (viz.js)
const viz = NBViz.viz;

// ---------- line-of-work detail
function openLine(id) {
  const t = S.threads[id]; if (!t) return;
  const d = x => `${dayLabel(dayKey(new Date(x).toISOString()))} ${hhmm(new Date(x).toISOString())}`;
  const kids = Object.values(S.threads).filter(x => x.parent === id);
  openDrawer(t.title, `<dl class="th-meta"><dt>Area</dt><dd>${esc(t.area)}</dd><dt>Span</dt><dd class="mono" style="font-size:12px">${d(t.t0)} → ${d(t.t1)}</dd>
    <dt>Notes</dt><dd>${t.notes.length}</dd>${t.outcome ? `<dt>Outcome</dt><dd><span class="st s-${esc(t.outcome)}">${esc(t.outcome)}</span></dd>` : ""}
    ${t.parent && S.threads[t.parent] ? `<dt>Branched from</dt><dd><a data-line="${esc(t.parent)}" style="cursor:pointer">${esc(S.threads[t.parent].title)}</a></dd>` : ""}
    ${kids.length ? `<dt>Branches</dt><dd>${kids.map(k => `<a data-line="${esc(k.id)}" style="cursor:pointer">${esc(k.title)}</a>`).join(" · ")}</dd>` : ""}</dl>
    <ul class="mini">${t.notes.map(n => `<li data-goto="${esc(n.id)}" style="--k:${KCOL[n.kind]}"><span>${dayLabel(dayKey(n.ts))} ${hhmm(n.ts)} · ${esc(n.kind)}</span>${esc(n.title)}</li>`).join("")}</ul>`);
}

// ---------- agent chats (one agent per thread, many in parallel)
const me = () => { try { return localStorage.getItem("nb-author") || ""; } catch (e) { return ""; } };
const setMe = v => { try { localStorage.setItem("nb-author", v); } catch (e) {} };
let drawerView = null;
function discCount() { const c = {}; for (const t of S.disc) c[t.note] = (c[t.note] || 0) + 1; return c; }
async function pollDisc() {
  try { S.disc = await (await fetch("api/discussion")).json(); } catch (e) { S.disc = []; }
  const live = S.disc.filter(t => t.thinking || t.waiting).length;
  $("#chatct").hidden = !S.disc.length; $("#chatct").textContent = live ? `${live} live` : S.disc.length;
  document.querySelectorAll("[data-chat]").forEach(b => { const n = discCount()[b.dataset.chat]; b.classList.toggle("has", !!n); b.innerHTML = chatIcon + (n || ""); });
  if (drawerView && !document.activeElement?.matches("#drawer textarea, #drawer input")) drawerView();
  setTimeout(pollDisc, S.disc.some(t => t.thinking || t.waiting) || drawerView ? 2500 : 8000);
}
async function send(d) {
  d.author = me() || "Reviewer";
  const r = await fetch("api/discussion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) });
  if (!r.ok) { alert("Could not post (is the notebook server running?)"); return; }
  S.disc = await (await fetch("api/discussion")).json(); drawerView && drawerView();
}
const when = t => { const d = new Date(t * 1000).toISOString(); return `${dayLabel(dayKey(d))} ${hhmm(d)}`; };
function threadHtml(t, showNote) {
  const n = S.byId[t.note];
  const state = t.resolved ? "resolved" : t.thinking ? "agent answering…" : t.waiting ? "queued for agent" : "answered";
  const paper = String(t.note).startsWith("paper:") && t.note.slice(6).split("#");
  const head = paper ? `<a href="papers/${esc(paper[0])}.html#${esc(paper[1] || "")}" style="color:var(--accent)">Paper ${esc(paper[0])} § ${esc(t.label || paper[1] || "whole")}</a>`
    : `<a data-goto="${esc(t.note)}" data-cm="${esc(t.id)}">${esc(n ? n.title : "Whole notebook")}</a>`;
  return `<div class="dthread${t.resolved ? " resolved" : ""}"><div class="dt-h">${showNote ? head : `<span style="flex:1">${when(t.t)}</span>`}
    ${t.quote ? `</div><div class="msg" style="border-top:0;padding-bottom:0"><p style="border-left:3px solid var(--accent);padding-left:8px;color:var(--ink-2);font-size:13px">${esc(t.quote)}</p></div><div class="dt-h" style="background:none;padding-top:4px">` : ""}
    <span class="st ${t.thinking ? "s-ongoing" : t.resolved ? "" : t.waiting ? "s-null" : "s-win"}">${state}</span>
    <button class="disc" data-resolve="${esc(t.id)}" data-r="${t.resolved ? "reopen" : "resolve"}">${t.resolved ? "Reopen" : "Resolve"}</button></div>
    ${t.messages.map(m => `<div class="msg"><div class="who" style="${m.agent ? "color:var(--accent)" : ""}">${esc(m.agent ? "Agent" : m.author)}<span>${when(m.t)}</span></div>${m.spec ? `<div style="margin-top:4px">${NBViz.spec(m.spec, { compact: true })}</div>` : `<p${m.error ? ' style="color:var(--loss)"' : ""}>${esc(m.body)}</p>`}</div>`).join("")}
    ${t.thinking ? `<div class="msg"><div class="who" style="color:var(--accent)">Agent</div><p style="color:var(--ink-3)">reading the evidence…</p></div>` : ""}
    <div class="compose"><textarea placeholder="Reply…" data-reply="${esc(t.id)}"></textarea><div class="acts"><button class="btn pri" data-send-reply="${esc(t.id)}">Reply</button></div></div></div>`;
}
const composer = (note, ph) => `<div class="newc"><input class="who-in" placeholder="Your name" value="${esc(me())}" data-me>
  <textarea placeholder="${esc(ph)}" data-new="${esc(note)}"></textarea><div class="acts"><button class="btn pri" data-send-new="${esc(note)}">Ask the agent</button></div></div>`;
function openChats() {
  drawerView = () => {
    const ts = [...S.disc].sort((a, b) => (b.thinking - a.thinking) || (b.waiting - a.waiting) || (b.messages.at(-1).t - a.messages.at(-1).t));
    const live = ts.filter(t => t.thinking).length;
    paintDrawer("Agent chats", `<div class="dr-sub">${ts.length} chats · ${live} agent${live === 1 ? "" : "s"} answering now</div>
      ${composer("_notebook", "Ask about the whole notebook…")}${ts.map(t => threadHtml(t, true)).join("") || ""}`);
  };
  drawerView(); showDrawer();
}
function openDrawer(title, html) { drawerView = null; paintDrawer(title, html); showDrawer(); }
function paintDrawer(title, html) { const y = $("#drb").scrollTop; $("#drt").textContent = title; $("#drb").innerHTML = html; $("#drb").scrollTop = y; }
function showDrawer() { $("#drawer").classList.add("open"); $("#drawer").setAttribute("aria-hidden", "false"); }
function closeDrawer() { drawerView = null; $("#drawer").classList.remove("open"); $("#drawer").setAttribute("aria-hidden", "true"); }

// ---------- navigation
function goto(id) {
  if (!S.byId[id]) return;
  if (!visible().includes(S.byId[id])) { S.thread = null; S.kind = null; S.area = null; S.q = ""; $("#q").value = ""; renderAll(); }
  const el = document.getElementById(id); if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1600);
}
function renderAll() { renderTop(); renderTraj(); renderLanes(); renderIndex(); renderLog(); }
const cmRefresh = () => window.CM && CM.refresh && CM.refresh();

document.addEventListener("click", e => {
  if (e.target.closest(".cm-rail,.cm-sheet,.cm-modal")) return;  // margin comments handle their own buttons (comments.js)
  const g = e.target.closest("[data-goto],[data-note],[data-thread],[data-kind],[data-area],[data-clear],[data-chat],[data-info],[data-line],[data-send-new],[data-send-reply],[data-resolve]");
  if (!g) return;
  const D = g.dataset;
  if (D.goto) { goto(D.goto); if (D.cm) { closeDrawer(); setTimeout(() => window.CM && CM.open(D.cm), 450); } else if (innerWidth < 900) closeDrawer(); }
  else if (D.note) goto(D.note);
  else if (D.thread) setThread(S.thread === D.thread ? null : D.thread);
  else if (D.kind) { S.kind = S.kind === D.kind ? null : D.kind; renderAll(); }
  else if (D.area) { S.area = S.area === D.area ? null : D.area; S.thread = null; renderAll(); }
  else if (D.clear) { if (D.clear === "q") { S.q = ""; $("#q").value = ""; } else S[D.clear] = null; if (D.clear === "thread") history.replaceState(null, "", location.pathname); renderAll(); }
  else if (D.chat) window.CM && CM.commentOn(D.chat);
  else if (D.info) openLine(D.info);
  else if (D.line) openLine(D.line);
  else if (D.sendNew) { const ta = document.querySelector(`[data-new="${CSS.escape(D.sendNew)}"]`), w = document.querySelector("[data-me]");
    if (w) setMe(w.value.trim()); if (ta.value.trim()) send({ kind: "comment", note: D.sendNew, body: ta.value }); }
  else if (D.sendReply) { const ta = document.querySelector(`[data-reply="${CSS.escape(D.sendReply)}"]`);
    if (ta.value.trim()) send({ kind: "reply", parent: D.sendReply, body: ta.value }); }
  else if (D.resolve) send({ kind: D.r, parent: D.resolve });
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeDrawer();
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && e.target.matches("#drawer textarea"))
    e.target.closest(".newc,.compose").querySelector(".btn.pri").click();
  if (e.key === "/" && !e.target.matches("input,textarea")) { e.preventDefault(); $("#q").focus(); }
});
$("#drx").onclick = closeDrawer;
$("#chats").onclick = openChats;
$("#fold").onclick = () => { const c = $("#lanesbox").classList.toggle("collapsed"); $("#fold").textContent = c ? "+" : "–"; };
let qt; $("#q").oninput = e => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value.trim(); renderLog(); }, 120); };
addEventListener("hashchange", () => { readHash(); renderAll(); });
let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(renderLanes, 150); });
const tip = $("#tip");
document.addEventListener("mouseover", e => { const t = e.target.closest("[data-tip]"); if (!t) return tip.classList.remove("on");
  tip.textContent = t.dataset.tip; tip.classList.add("on"); });
document.addEventListener("mousemove", e => { if (tip.classList.contains("on")) { tip.style.left = Math.min(e.clientX + 12, innerWidth - 330) + "px"; tip.style.top = e.clientY + 14 + "px"; } });
load();
