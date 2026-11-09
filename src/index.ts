import { Hono } from "hono";
import { llmsMd } from "./llms";
import { CSP, esc, renderPage, titleOf } from "./render";

interface Env {
  DOCS: KVNamespace; IP_LIMITER: RateLimit; PAGE_LIMITER: RateLimit; PUBLISH_TOKEN: string; MAX_BYTES: string;
}
interface Doc { markdown: string; title: string; created: string; updated: string }
interface Meta { title: string; updated: string; size: number }

const app = new Hono<{ Bindings: Env }>();
const ALPHA = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ID = /^[0-9A-Za-z]{12}$/;
const NO_STORE = { "cache-control": "no-store" };

function newId() {
  let out = "";
  while (out.length < 12) for (const b of crypto.getRandomValues(new Uint8Array(24))) if (b < 248 && out.length < 12) out += ALPHA[b % 62];
  return out;
}

async function same(a: string, b: string) {
  const h = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const x = await h(a), y = await h(b);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

const errorPage = (status: number, title: string, text: string) => new Response(
  `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${status} ${esc(title)}</title><style>:root{color-scheme:light dark}body{margin:0;min-height:100svh;display:grid;place-items:center;font:16px/1.7 system-ui,sans-serif;background:Canvas;color:CanvasText}main{padding:24px;text-align:center}h1{margin:0;font-size:64px;font-weight:600}p{opacity:.7}</style></head><body><main><h1>${status}</h1><p>${esc(text)}</p></main></body></html>`,
  { status, headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP, ...NO_STORE } });

app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("x-content-type-options", "nosniff");
  c.res.headers.set("referrer-policy", "no-referrer");
  c.res.headers.set("cross-origin-resource-policy", "same-origin");
  c.res.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
});

app.get("/", (c) => c.redirect("/llms.md", 302));
app.get("/llms.md", (c) => c.text(llmsMd(new URL(c.req.url).origin), 200, { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300" }));

// --- 公開ページ(URL を知っている人だけが読める) ---
app.get("/d/:file", async (c) => {
  const file = c.req.param("file");
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  if (!(await c.env.PAGE_LIMITER.limit({ key: ip })).success) return errorPage(429, "アクセスが多すぎます", "少し待ってからもう一度お試しください。");
  const raw = file.endsWith(".md") || c.req.query("raw") === "1";
  const id = file.replace(/\.md$/, "");
  if (!ID.test(id)) return errorPage(404, "ページが見つかりません", "お探しのページは存在しません。");
  const doc = await c.env.DOCS.get<Doc>(`d:${id}`, "json");
  if (!doc) return errorPage(404, "ページが見つかりません", "お探しのページは存在しないか、公開期間が終わりました。");
  const h = { "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer", "cache-control": "no-cache" };
  if (raw) return new Response(doc.markdown, { headers: { ...h, "content-type": "text/plain; charset=utf-8", "content-security-policy": CSP } });
  return new Response(renderPage(doc.title, doc.markdown, doc.updated), { headers: { ...h, "content-type": "text/html; charset=utf-8", "content-security-policy": CSP } });
});

// --- 管理 API(トークン必須) ---
app.use("/v1/*", async (c, next) => {
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  if (!(await c.env.IP_LIMITER.limit({ key: ip })).success) return c.json({ error: "rate_limited" }, 429, { "retry-after": "30" });
  const m = (c.req.header("authorization") ?? "").match(/^Bearer (\S{20,200})$/);
  if (!m || !(await same(m[1], c.env.PUBLISH_TOKEN))) return c.json({ error: "unauthorized" }, 401, NO_STORE);
  await next();
});

async function readBody(c: any): Promise<{ markdown: string; title?: string; days?: number } | Response> {
  const max = Number(c.env.MAX_BYTES) || 1_000_000;
  if (Number(c.req.header("content-length") ?? 0) > max) return c.json({ error: "too_large", max_bytes: max }, 413);
  const text = await c.req.text();
  if (new TextEncoder().encode(text).length > max) return c.json({ error: "too_large", max_bytes: max }, 413);
  let markdown: string, title: string | undefined, days: number | undefined;
  if ((c.req.header("content-type") ?? "").includes("application/json")) {
    let j: any; try { j = JSON.parse(text); } catch { return c.json({ error: "bad_json" }, 400); }
    if (typeof j?.markdown !== "string") return c.json({ error: "markdown_required" }, 400);
    markdown = j.markdown; title = typeof j.title === "string" ? j.title : undefined;
    days = j.expires_in_days == null ? undefined : Number(j.expires_in_days);
  } else {
    markdown = text; title = c.req.query("title") || undefined;
    days = c.req.query("expires_in_days") ? Number(c.req.query("expires_in_days")) : undefined;
  }
  if (!markdown.trim()) return c.json({ error: "markdown_required" }, 400);
  if (days !== undefined && !(Number.isInteger(days) && days >= 1 && days <= 3650)) return c.json({ error: "bad_expires_in_days" }, 400);
  return { markdown, title: title?.slice(0, 120), days };
}

const urls = (c: any, id: string) => { const o = new URL(c.req.url).origin; return { url: `${o}/d/${id}`, raw_url: `${o}/d/${id}.md` }; };

async function save(c: any, id: string, created?: string) {
  const b = await readBody(c);
  if (b instanceof Response) return b;
  const now = new Date().toISOString();
  const doc: Doc = { markdown: b.markdown, title: b.title || titleOf(b.markdown), created: created ?? now, updated: now };
  const meta: Meta = { title: doc.title, updated: now, size: b.markdown.length };
  await c.env.DOCS.put(`d:${id}`, JSON.stringify(doc), { metadata: meta, ...(b.days ? { expirationTtl: b.days * 86400 } : {}) });
  return c.json({ id, title: doc.title, ...urls(c, id), updated: now, expires_in_days: b.days ?? null }, created ? 200 : 201, NO_STORE);
}

app.post("/v1/docs", (c) => save(c, newId()));

app.put("/v1/docs/:id", async (c) => {
  const id = c.req.param("id");
  if (!ID.test(id)) return c.json({ error: "not_found" }, 404);
  const cur = await c.env.DOCS.get<Doc>(`d:${id}`, "json");
  if (!cur) return c.json({ error: "not_found" }, 404);
  return save(c, id, cur.created);
});

app.get("/v1/docs/:id", async (c) => {
  const id = c.req.param("id");
  const doc = ID.test(id) ? await c.env.DOCS.get<Doc>(`d:${id}`, "json") : null;
  return doc ? c.json({ id, ...doc, ...urls(c, id) }, 200, NO_STORE) : c.json({ error: "not_found" }, 404);
});

app.delete("/v1/docs/:id", async (c) => {
  const id = c.req.param("id");
  if (!ID.test(id)) return c.json({ error: "not_found" }, 404);
  await c.env.DOCS.delete(`d:${id}`);
  return c.json({ ok: true }, 200, NO_STORE);
});

app.get("/v1/docs", async (c) => {
  const l = await c.env.DOCS.list<Meta>({ prefix: "d:", limit: 100, cursor: c.req.query("cursor") || undefined });
  return c.json({
    docs: l.keys.map((k) => ({ id: k.name.slice(2), title: k.metadata?.title, updated: k.metadata?.updated, size: k.metadata?.size, ...urls(c, k.name.slice(2)) })),
    next: l.list_complete ? null : l.cursor,
  }, 200, NO_STORE);
});

app.notFound((c) => new URL(c.req.url).pathname.startsWith("/v1/") ? c.json({ error: "not_found" }, 404) : errorPage(404, "ページが見つかりません", "お探しのページは存在しません。"));
app.onError((e, c) => { console.error(e); return errorPage(500, "エラーが発生しました", "時間をおいてもう一度お試しください。"); });

export default app;
