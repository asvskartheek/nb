// The notebook's visual kit: the charts notes carry (bars, delta, split, line, flow, checks, compare) and the answer
// spec agents reply with (headline, verdict, blocks, quick replies; see ANSWERS.md). Used by app.js, comments.js and papers.
"use strict";
window.NBViz = (() => {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const trunc = (s, n) => (s = String(s ?? "")).length > n ? s.slice(0, n - 1) + "…" : s;
  const LOWER_BETTER = /latency|cost|\$|time|p50|p90|p95|wrong|error|crash|punt|stall|token|sec\b/i;
  const fmt = (v, u) => v == null || v === "" ? "–" : (typeof v === "number" ? (Math.abs(v) >= 1000 ? v.toLocaleString("en") :
    Math.abs(v) < 0.1 && v !== 0 ? +v.toPrecision(2) : +v.toFixed(Math.abs(v) < 10 ? 2 : 1)) : esc(v)) + (u ? `<small>${esc(u)}</small>` : "");
  const fmtT = (v, u) => fmt(v, "").replace(/<[^>]+>/g, "") + (u ? (u === "%" ? "%" : " " + u) : "");
  const PAL = i => `var(--c${i % 12})`;

  const VIZ = {
    bars(v, color) {
      const it = (v.items || []).filter(x => typeof x.value === "number"); if (!it.length) return "";
      const max = Math.max(...it.map(x => x.value), v.unit === "%" ? 100 : 0) || 1, W = 600, LW = 150, RH = 22;
      const hl = v.highlight;
      return `<svg viewBox="0 0 ${W} ${it.length * RH}">${it.map((x, i) => {
        const w = Math.max(2, x.value / max * (W - LW - 70));
        return `<text x="${LW - 8}" y="${i * RH + 15}" text-anchor="end">${esc(trunc(x.label, 24))}</text>
        ${v.unit === "%" ? `<rect x="${LW}" y="${i * RH + 5}" width="${W - LW - 70}" height="12" rx="2" fill="var(--surface-2)"/>` : ""}
        <rect x="${LW}" y="${i * RH + 5}" width="${w}" height="12" rx="2" fill="${hl && hl !== x.label ? "var(--line-2)" : color}"/>
        <text class="v" x="${LW + w + 6}" y="${i * RH + 15}">${fmtT(x.value, v.unit)}</text>`; }).join("")}</svg>`;
    },
    delta(v, color) {
      const a = v.before, b = v.after; if (typeof a !== "number" || typeof b !== "number") return "";
      const lowBetter = LOWER_BETTER.test((v.label || "") + " " + (v.unit || "")), dv = b - a;
      const good = dv === 0 ? "var(--ink-3)" : (lowBetter ? dv < 0 : dv > 0) ? "var(--win)" : "var(--loss)";
      const lo = Math.min(a, b), hi = Math.max(a, b), pad = (hi - lo) * 0.6 || Math.abs(hi) * 0.1 || 1;
      let mn = lo - pad, mx = hi + pad;
      if (v.unit === "%") { mn = Math.max(0, mn); mx = Math.min(100, mx); }
      const W = 600, X = t => 150 + (t - mn) / (mx - mn) * (W - 230);
      return `<svg viewBox="0 0 ${W} 52">
        <text x="0" y="22" class="mut">${esc(trunc(v.label, 22))}</text>
        <line x1="150" x2="${W - 80}" y1="26" y2="26" stroke="var(--line-2)"/>
        <line x1="${X(a)}" x2="${X(b)}" y1="26" y2="26" stroke="${good}" stroke-width="3"/>
        <circle cx="${X(a)}" cy="26" r="5" fill="var(--surface)" stroke="var(--ink-3)" stroke-width="2"/>
        <circle cx="${X(b)}" cy="26" r="6" fill="${good}"/>
        <text x="${X(a)}" y="12" text-anchor="middle" class="mut">${esc(v.bl || "before")} ${fmtT(a, v.unit)}</text>
        <text x="${X(b)}" y="48" text-anchor="middle" class="v">${esc(v.al || "after")} ${fmtT(b, v.unit)}</text>
        <text x="${W}" y="31" text-anchor="end" class="v" style="fill:${good}">${dv > 0 ? "+" : ""}${fmtT(+dv.toFixed(4), v.unit === "%" ? "pp" : v.unit)}</text></svg>`;
    },
    split(v) {
      const it = (v.items || []).filter(x => typeof x.value === "number" && x.value > 0); if (!it.length) return "";
      const tot = it.reduce((s, x) => s + x.value, 0), W = 600; let x0 = 0;
      const bars = it.map((x, i) => { const w = x.value / tot * W, r = `<rect x="${x0}" y="0" width="${Math.max(1, w - 1.5)}" height="16" fill="${PAL(i)}"/>`; x0 += w; return r; }).join("");
      const rows = Math.ceil(it.length / 3), id = "r" + Math.random().toString(36).slice(2, 7);
      const leg = it.map((x, i) => `<g transform="translate(${(i % 3) * 200},${30 + Math.floor(i / 3) * 18})"><rect width="9" height="9" y="-8" rx="2" fill="${PAL(i)}"/><text x="14">${esc(trunc(x.label, 20))} <tspan class="v">${fmtT(x.value, v.unit === "%" ? "%" : "")}</tspan></text></g>`).join("");
      return `<svg viewBox="0 0 ${W} ${24 + rows * 18}"><clipPath id="${id}"><rect width="${W}" height="16" rx="3"/></clipPath><g clip-path="url(#${id})">${bars}</g>${leg}</svg>`;
    },
    line(v, color) {
      const p = (v.points || []).filter(q => typeof q.y === "number"); if (p.length < 2) return "";
      const W = 600, H = 130, L = 40, B = 24, T = 14, ys = p.map(q => q.y);
      let lo = Math.min(...ys), hi = Math.max(...ys); const pad = (hi - lo) * 0.25 || 1; lo -= pad; hi += pad;
      const X = i => L + i / (p.length - 1) * (W - L - 20), Y = y => T + (1 - (y - lo) / (hi - lo)) * (H - T - B);
      const step = Math.ceil(p.length / 8);
      return `<svg viewBox="0 0 ${W} ${H}"><line x1="${L}" x2="${W - 20}" y1="${H - B}" y2="${H - B}" stroke="var(--line-2)"/>
        <polyline fill="none" stroke="${color}" stroke-width="2" points="${p.map((q, i) => `${X(i)},${Y(q.y)}`).join(" ")}"/>
        ${p.map((q, i) => `<circle cx="${X(i)}" cy="${Y(q.y)}" r="3.5" fill="${color}"/><text class="v" x="${X(i)}" y="${Y(q.y) - 7}" text-anchor="middle">${fmtT(q.y, "")}</text>
        ${i % step === 0 || i === p.length - 1 ? `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" class="mut">${esc(trunc(q.x, 14))}</text>` : ""}`).join("")}
        <text x="0" y="${T + 4}" class="mut">${esc(v.unit || "")}</text></svg>`;
    },
    flow(v, color) {
      const s = v.steps || []; if (!s.length) return "";
      const W = 600, n = s.length, w = W / n;
      return `<svg viewBox="0 0 ${W} 34">${s.map((x, i) => `<g transform="translate(${i * w},0)">
        <path d="M0 2 H${w - 12} L${w - 2} 17 L${w - 12} 32 H0 ${i ? `L10 17 Z` : "Z"}" fill="color-mix(in srgb, ${color} ${14 + i * 4}%, var(--surface))" stroke="${color}" stroke-opacity=".5"/>
        <text x="${w / 2 + (i ? 3 : -3)}" y="21" text-anchor="middle">${esc(trunc(x, Math.max(6, Math.floor(w / 7.2))))}</text></g>`).join("")}</svg>`;
    },
    checks(v) {
      const it = v.items || []; if (!it.length) return "";
      return `<svg viewBox="0 0 600 ${it.length * 20}">${it.map((x, i) => `<g transform="translate(0,${i * 20})">
        <circle cx="8" cy="9" r="7" fill="${x.ok ? "var(--win-bg)" : "var(--loss-bg)"}"/>
        <path d="${x.ok ? "M4.5 9 L7 11.5 L11.5 6.5" : "M5 6 L11 12 M11 6 L5 12"}" stroke="${x.ok ? "var(--win)" : "var(--loss)"}" stroke-width="1.8" fill="none"/>
        <text x="22" y="13">${esc(trunc(x.label, 80))}</text></g>`).join("")}</svg>`;
    },
    compare(v, color) {
      const r = v.rows || []; if (!r.length) return "";
      const ma = Math.max(...r.map(x => +x.a || 0)) || 1, mb = Math.max(...r.map(x => +x.b || 0)) || 1, W = 600, RH = 22;
      return `<svg viewBox="0 0 ${W} ${r.length * RH + 18}"><text x="160" y="11" class="mut">${esc(v.a || "a")}</text><text x="390" y="11" class="mut">${esc(v.b || "b")}</text>
        ${r.map((x, i) => { const y = 18 + i * RH, wa = (+x.a || 0) / ma * 150, wb = (+x.b || 0) / mb * 150;
        return `<text x="150" y="${y + 12}" text-anchor="end">${esc(trunc(x.label, 22))}</text>
          <rect x="160" y="${y + 3}" width="${Math.max(2, wa)}" height="11" rx="2" fill="var(--c5)"/><text class="v" x="${166 + wa}" y="${y + 12}">${fmtT(x.a, "")}</text>
          <rect x="390" y="${y + 3}" width="${Math.max(2, wb)}" height="11" rx="2" fill="${color}"/><text class="v" x="${396 + wb}" y="${y + 12}">${fmtT(x.b, "")}</text>`; }).join("")}</svg>`;
    },
  };
  const viz = (v, color) => { try { return (VIZ[v.type] || (() => ""))(v, color); } catch (e) { return ""; } };

  // ---------- answer specs (ANSWERS.md): what agents (and people) reply with instead of prose
  const COMPACT_FIRST = ["kpi", "delta", "split", "bars", "checks", "line", "compare", "table", "flow", "svg", "tabs"];
  const VERDICT = { yes: "win", win: "win", no: "loss", loss: "loss", null: "null", unsure: "null", partly: "null" };
  function cleanSvg(src) {  // the escape hatch: an agent's own SVG, without scripts, handlers, foreign content or links out
    if (typeof src !== "string" || src.length > 20000) return "";
    const doc = new DOMParser().parseFromString(src, "image/svg+xml"), root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) return "";
    root.querySelectorAll("script,foreignObject,iframe,image,use,a,animate,set").forEach(n => n.remove());
    for (const n of [root, ...root.querySelectorAll("*")]) for (const a of [...n.attributes])
      if (/^on/i.test(a.name) || /href$/i.test(a.name) || /javascript:|url\(\s*['"]?https?:/i.test(a.value)) n.removeAttribute(a.name);
    return new XMLSerializer().serializeToString(root);
  }
  function hbars(b, color) {  // bars as HTML rows: readable at margin-card width
    const it = (b.items || []).filter(x => typeof x.value === "number").slice(0, 6); if (!it.length) return "";
    const max = Math.max(...it.map(x => Math.abs(x.value)), b.unit === "%" ? 100 : 0) || 1;
    return `<div class="sp-hb">${it.map(x => `<div class="r"><span class="l" title="${esc(x.label)}">${esc(x.label)}</span>
      <span class="t"><i style="width:${Math.max(2, Math.abs(x.value) / max * 100)}%;background:${x.value < 0 ? "var(--loss)" : color}"></i></span>
      <span class="v">${fmtT(x.value, b.unit)}</span></div>`).join("")}</div>`;
  }
  function hdelta(b) {
    if (typeof b.before !== "number" || typeof b.after !== "number") return "";
    const dv = b.after - b.before, low = LOWER_BETTER.test((b.label || "") + " " + (b.unit || ""));
    const cls = dv === 0 ? "" : (low ? dv < 0 : dv > 0) ? "up" : "dn";
    return `<div class="sp-hd"><span class="l">${esc(b.label || "")}</span><span class="a">${esc(b.bl || "")} ${fmtT(b.before, b.unit)}</span>
      <span class="arr ${cls}">→</span><span class="b">${esc(b.al || "")} ${fmtT(b.after, b.unit)}</span>
      <span class="d ${cls}">${dv > 0 ? "+" : ""}${fmtT(+dv.toFixed(3), b.unit === "%" ? "pp" : b.unit)}</span></div>`;
  }
  function hsplit(b) {
    const it = (b.items || []).filter(x => typeof x.value === "number" && x.value > 0).slice(0, 6); if (!it.length) return "";
    const tot = it.reduce((s, x) => s + x.value, 0);
    return `<div class="sp-hs"><div class="bar">${it.map((x, i) => `<i style="flex:${x.value};background:${PAL(i)}" title="${esc(x.label)} ${x.value}"></i>`).join("")}</div>
      <div class="lg">${it.map((x, i) => `<span><i style="background:${PAL(i)}"></i>${esc(x.label)} <b>${fmtT(x.value, b.unit === "%" ? "%" : "")}</b></span>`).join("")}</div></div>`;
  }
  function block(b, color, depth, compact) {
    if (!b || typeof b !== "object") return "";
    if (compact && b.type === "bars") return hbars(b, color);
    if (compact && b.type === "delta") return hdelta(b);
    if (compact && b.type === "split") return hsplit(b);
    if (VIZ[b.type]) return `<div class="sp-viz">${viz(b, color)}</div>`;
    if (b.type === "kpi") return `<div class="sp-kpis">${(b.items || []).slice(0, 4).map(k => `<div class="sp-kpi"><div class="v">${fmt(k.value, k.unit)}</div>
      <div class="l">${esc(k.label)}${k.n != null ? ` · n=${esc(k.n)}` : ""}</div>${typeof k.before === "number" && typeof k.value === "number"
        ? `<div class="d ${k.value - k.before === 0 ? "" : (LOWER_BETTER.test(k.label + " " + (k.unit || "")) ? k.value < k.before : k.value > k.before) ? "up" : "dn"}">${k.value - k.before > 0 ? "+" : ""}${fmtT(+(k.value - k.before).toFixed(3), k.unit === "%" ? "pp" : k.unit)}</div>` : ""}</div>`).join("")}</div>`;
    if (b.type === "table") return `<div class="sp-tw"><table class="sp-t"><thead><tr>${(b.cols || []).map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${(b.rows || []).slice(0, 12).map(r => `<tr>${(r || []).map(c => `<td>${typeof c === "number" ? fmt(c) : esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    if (b.type === "evidence" && compact && (b.refs || []).length > 3)
      return `<div class="sp-ev">${b.refs.slice(0, 3).map(r => `<button class="sp-ref" data-ref="${esc(r)}" title="${esc(r)}">${esc(trunc(r, 30))}</button>`).join("")}<span class="sp-n">+${b.refs.length - 3}</span></div>`;
    if (b.type === "evidence") return `<div class="sp-ev">${(b.refs || []).slice(0, 8).map(r => `<button class="sp-ref" data-ref="${esc(r)}" title="${esc(r)}">${esc(trunc(r, 34))}</button>`).join("")}</div>`;
    if (b.type === "svg") { const s = cleanSvg(b.svg); return s ? `<div class="sp-viz sp-svg">${s}</div>` : ""; }
    if (b.type === "tabs" && depth < 1) {
      const tabs = (b.tabs || []).slice(0, 4);
      return `<div class="sp-tabs"><div class="sp-tabbar">${tabs.map((t, i) => `<button class="${i ? "" : "on"}" data-tab="${i}">${esc(t.label)}</button>`).join("")}</div>
        ${tabs.map((t, i) => `<div class="sp-pane"${i ? " hidden" : ""}>${(t.blocks || []).map(x => block(x, color, depth + 1)).join("")}</div>`).join("")}</div>`;
    }
    return "";
  }
  // compact: the margin card shows the headline, verdict and the first visual; expand shows everything
  function spec(s, opt = {}) {
    if (!s || typeof s !== "object") return "";
    const color = opt.color || "var(--accent)", blocks = Array.isArray(s.blocks) ? s.blocks.filter(b => b && typeof b === "object") : [];
    const visual = blocks.filter(b => b.type !== "evidence"), ev = blocks.filter(b => b.type === "evidence");
    const rank = t => { const i = COMPACT_FIRST.indexOf(t); return i < 0 ? 99 : i; };
    const lead = [...visual].sort((a, b) => rank(a.type) - rank(b.type))[0];  // the block that reads best small
    const shown = opt.compact ? (lead ? [lead] : []).concat(ev) : blocks;
    const v = s.verdict && VERDICT[String(s.verdict).toLowerCase()];
    return `<div class="sp${opt.compact ? " compact" : ""}">
      ${s.headline || v ? `<div class="sp-h">${v ? `<span class="sp-verdict ${v}">${esc(s.verdict)}</span>` : ""}<b>${esc(s.headline || "")}</b></div>` : ""}
      ${shown.map(b => block(b, color, 0, opt.compact)).join("")}
      ${opt.compact && visual.length > 1 ? `<div class="sp-more">+${visual.length - 1} more · expand</div>` : ""}
    </div>`;
  }
  document.addEventListener("click", e => {  // tabs work wherever a spec is drawn
    const t = e.target.closest(".sp-tabbar button"); if (!t) return;
    const box = t.closest(".sp-tabs"), i = +t.dataset.tab;
    box.querySelectorAll(".sp-tabbar button").forEach((b, j) => b.classList.toggle("on", j === i));
    box.querySelectorAll(".sp-pane").forEach((p, j) => p.hidden = j !== i);
  });
  return { esc, trunc, fmt, fmtT, LOWER_BETTER, PAL, VIZ, viz, spec, cleanSvg };
})();
