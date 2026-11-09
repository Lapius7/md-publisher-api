import type MarkdownIt from "markdown-it";
import type StateBlock from "markdown-it/lib/rules_block/state_block.mjs";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ---------- 開閉式: :::details 題名 ... ::: ---------- */
function detailsRule(state: StateBlock, start: number, end: number, silent: boolean): boolean {
  const open = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
  const m = open.match(/^:::\s*(details|open)(?:\s+(.*))?$/);
  if (!m || state.sCount[start] - state.blkIndent >= 4) return false;
  let line = start + 1, depth = 1, found = false;
  for (; line < end; line++) {
    const t = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
    if (/^:::\s*(details|open)(\s|$)/.test(t)) depth++;
    else if (/^:::\s*$/.test(t) && --depth === 0) { found = true; break; }
  }
  if (!found) return false;
  if (silent) return true;
  const oldParent = state.parentType, oldMax = state.lineMax;
  const o = state.push("details_open", "details", 1);
  o.map = [start, line]; o.meta = { open: m[1] === "open" };
  const s = state.push("summary_open", "summary", 1);
  s.map = [start, start + 1];
  const i = state.push("inline", "", 0);
  i.content = (m[2] ?? "詳細").trim() || "詳細"; i.children = [];
  state.push("summary_close", "summary", -1);
  state.parentType = "details" as never;
  state.lineMax = line;
  state.md.block.tokenize(state, start + 1, line);
  state.parentType = oldParent;
  state.lineMax = oldMax;
  state.push("details_close", "details", -1);
  state.line = line + 1;
  return true;
}

/* ---------- チェックボックス: - [ ] / - [x] ---------- */
function taskPlugin(md: MarkdownIt) {
  md.core.ruler.after("inline", "task_list", (state) => {
    const t = state.tokens;
    for (let i = 2; i < t.length; i++) {
      const inl = t[i];
      if (inl.type !== "inline" || t[i - 1].type !== "paragraph_open" || t[i - 2].type !== "list_item_open") continue;
      const first = inl.children?.[0];
      const m = first?.type === "text" && first.content.match(/^\[([ xX])\]\s+/);
      if (!first || !m) continue;
      first.content = first.content.slice(m[0].length);
      const cb = new state.Token("html_inline", "", 0);
      cb.content = `<input type="checkbox"${m[1] === " " ? "" : " checked"}> `;
      inl.children!.unshift(cb);
      t[i - 2].attrJoin("class", "task");
      // 親の ul にも印を付ける
      for (let j = i - 3; j >= 0; j--) if (t[j].type === "bullet_list_open") { if (!t[j].attrGet("class")) t[j].attrSet("class", "tasks"); break; }
    }
  });
}

/* ---------- グラフ: ```chart { JSON } ``` を SVG にする(スクリプト不要) ---------- */
const COLORS = ["#4f8cff", "#ff6b6b", "#34c38f", "#f5a623", "#a566ff", "#2ec4d6", "#e86cb8", "#8b8f98"];
type Spec = { type?: string; title?: string; labels?: unknown; series?: unknown; data?: unknown };

function parseSpec(src: string) {
  const j = JSON.parse(src) as Spec;
  const labels = (Array.isArray(j.labels) ? j.labels : []).slice(0, 60).map((x) => String(x).slice(0, 40));
  let raw: { name?: unknown; data?: unknown }[] = Array.isArray(j.series) ? (j.series as never) : [];
  if (!raw.length && Array.isArray(j.data)) raw = [{ name: "", data: j.data }];
  const series = raw.slice(0, 8).map((s) => ({
    name: String(s.name ?? "").slice(0, 40),
    data: (Array.isArray(s.data) ? s.data : []).slice(0, 60).map((v) => (typeof v === "number" && Number.isFinite(v) ? v : 0)),
  }));
  const n = Math.max(labels.length, ...series.map((s) => s.data.length), 0);
  if (!n || !series.length) throw new Error("empty");
  while (labels.length < n) labels.push(String(labels.length + 1));
  return { type: String(j.type ?? "bar"), title: j.title ? String(j.title).slice(0, 80) : "", labels, series, n };
}

const fmt = (v: number) => (Math.abs(v) >= 1e4 || (v !== 0 && Math.abs(v) < 0.01) ? v.toExponential(1) : String(Math.round(v * 100) / 100));

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

export function chartSvg(src: string): string {
  const c = parseSpec(src);
  const W = 640, H = 340, L = 54, R = 16, T = c.title ? 38 : 16, B = 56;
  const legend = c.series.length > 1 || c.type === "pie" ? true : false;
  let body = "";
  if (c.type === "pie") {
    const data = c.series[0].data.map((v) => Math.max(0, v));
    const sum = data.reduce((a, b) => a + b, 0) || 1;
    const cx = 170, cy = 190, r = 110;
    let a0 = -Math.PI / 2;
    data.forEach((v, i) => {
      const a1 = a0 + (v / sum) * Math.PI * 2;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      body += v / sum >= 0.9999
        ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${COLORS[i % 8]}"/>`
        : v > 0 ? `<path d="M${cx} ${cy}L${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}Z" fill="${COLORS[i % 8]}" stroke="Canvas" stroke-width="2"/>` : "";
      body += `<rect x="360" y="${70 + i * 22}" width="12" height="12" rx="3" fill="${COLORS[i % 8]}"/><text x="380" y="${81 + i * 22}" font-size="13" fill="currentColor">${esc(c.labels[i])}: ${fmt(v)} (${Math.round((v / sum) * 100)}%)</text>`;
      a0 = a1;
    });
  } else {
    const line = c.type === "line";
    const all = c.series.flatMap((s) => s.data);
    const max = niceMax(Math.max(...all, 0)), min = Math.min(...all, 0) < 0 ? -niceMax(-Math.min(...all)) : 0;
    const pw = W - L - R, ph = H - T - B - (legend ? 22 : 0);
    const y = (v: number) => T + ph - ((v - min) / (max - min)) * ph;
    for (let k = 0; k <= 4; k++) {
      const v = min + ((max - min) * k) / 4, yy = y(v);
      body += `<line x1="${L}" x2="${W - R}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="currentColor" opacity=".15"/><text x="${L - 6}" y="${(yy + 4).toFixed(1)}" font-size="11" text-anchor="end" fill="currentColor" opacity=".7">${fmt(v)}</text>`;
    }
    const step = pw / c.n, skip = Math.ceil(c.n / 12);
    c.labels.forEach((lb, i) => {
      if (i % skip) return;
      const x = L + step * (i + 0.5);
      body += `<text x="${x.toFixed(1)}" y="${T + ph + 16}" font-size="11" text-anchor="middle" fill="currentColor" opacity=".8">${esc(lb.slice(0, 10))}</text>`;
    });
    if (line) {
      c.series.forEach((s, si) => {
        const pts = s.data.map((v, i) => `${(L + step * (i + 0.5)).toFixed(1)},${y(v).toFixed(1)}`);
        body += `<polyline points="${pts.join(" ")}" fill="none" stroke="${COLORS[si % 8]}" stroke-width="2.5" stroke-linejoin="round"/>`;
        s.data.forEach((v, i) => (body += `<circle cx="${(L + step * (i + 0.5)).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5" fill="${COLORS[si % 8]}"><title>${esc(c.labels[i])}: ${fmt(v)}</title></circle>`));
      });
    } else {
      const bw = Math.max(2, (step * 0.7) / c.series.length);
      c.series.forEach((s, si) =>
        s.data.forEach((v, i) => {
          const x = L + step * i + step * 0.15 + bw * si, y0 = y(0), y1 = y(v);
          body += `<rect x="${x.toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.abs(y0 - y1).toFixed(1)}" rx="2" fill="${COLORS[si % 8]}"><title>${esc(c.labels[i])}: ${fmt(v)}</title></rect>`;
        }));
    }
    body += `<line x1="${L}" x2="${W - R}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="currentColor" opacity=".4"/>`;
    if (legend) {
      let lx = L;
      c.series.forEach((s, i) => {
        body += `<rect x="${lx}" y="${H - 16}" width="12" height="12" rx="3" fill="${COLORS[i % 8]}"/><text x="${lx + 17}" y="${H - 6}" font-size="12" fill="currentColor">${esc(s.name || `系列${i + 1}`)}</text>`;
        lx += 30 + Math.min(s.name.length, 20) * 12;
      });
    }
  }
  const title = c.title ? `<text x="${W / 2}" y="24" font-size="15" font-weight="600" text-anchor="middle" fill="currentColor">${esc(c.title)}</text>` : "";
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.title || "グラフ")}" xmlns="http://www.w3.org/2000/svg">${title}${body}</svg></figure>`;
}

export function extras(md: MarkdownIt) {
  md.block.ruler.before("fence", "details", detailsRule, { alt: ["paragraph", "reference", "blockquote", "list"] });
  md.renderer.rules.details_open = (tokens, idx) => (tokens[idx].meta?.open ? "<details open>\n" : "<details>\n");
  md.renderer.rules.details_close = () => "</details>\n";
  md.renderer.rules.summary_open = () => "<summary>";
  md.renderer.rules.summary_close = () => "</summary>\n";
  md.use(taskPlugin);
  const fence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, o, e, self) => {
    const t = tokens[idx];
    if (t.info.trim() === "chart") {
      try { return chartSvg(t.content) + "\n"; } catch { /* 不正な指定は通常のコードとして表示 */ }
    }
    return fence(tokens, idx, o, e, self);
  };
}
