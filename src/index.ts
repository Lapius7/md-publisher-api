import { Hono } from "hono";
import { llmsMd } from "./llms";
import { CSP, esc, renderPage, renderStatic, titleOf } from "./render";
import { hmacHex, ipKey, newEditToken, safeEq, sha256Hex } from "./ip";
import terms from "../docs/TERMS.md";
import privacy from "../docs/PRIVACY.md";

interface Env {
  DOCS: KVNamespace; IP_LIMITER: RateLimit; PAGE_LIMITER: RateLimit; PUBLISH_TOKEN: string; MAX_BYTES: string;
  MAX_DAYS?: string; DEFAULT_DAYS?: string; DAY_DOCS?: string; DAY_BYTES?: string; ALL_DOCS?: string;
}
interface Doc { markdown: string; title: string; created: string; updated: string; edit?: string }
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
  if (!(await c.env.PAGE_LIMITER.limit({ key: ipOf(c) })).success) return errorPage(429, "アクセスが多すぎます", "少し待ってからもう一度お試しください。");
  const raw = file.endsWith(".md") || c.req.query("raw") === "1";
  const id = file.replace(/\.md$/, "");
  if (!ID.test(id)) return errorPage(404, "ページが見つかりません", "お探しのページは存在しません。");
  const doc = await c.env.DOCS.get<Doc>(`d:${id}`, "json");
  if (!doc) return errorPage(404, "ページが見つかりません", "お探しのページは存在しないか、公開期間が終わりました。");
  const h = { "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer", "cache-control": "no-cache" };
  if (raw) return new Response(doc.markdown, { headers: { ...h, "content-type": "text/plain; charset=utf-8", "content-security-policy": CSP } });
  return new Response(renderPage(doc.title, doc.markdown, doc.updated), { headers: { ...h, "content-type": "text/html; charset=utf-8", "content-security-policy": CSP } });
});

// --- 規約など ---
app.get("/terms", (c) => page(c, "利用規約", terms));
app.get("/privacy", (c) => page(c, "プライバシーポリシー", privacy));
function page(c: any, title: string, md: string) {
  return new Response(renderStatic(title, md), { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP, "cache-control": "public, max-age=300" } });
}

// --- API(認証なし。IP ごとの制限つき) ---
const ipOf = (c: any) => ipKey(c.req.header("cf-connecting-ip") ?? "unknown");

app.use("/v1/*", async (c, next) => {
  if (!(await c.env.IP_LIMITER.limit({ key: ipOf(c) })).success)
    return c.json({ error: "rate_limited", message: "短時間に多すぎます。1分ほど待ってから、もう一度送ってください。" }, 429, { "retry-after": "60" });
  await next();
});

const fail = (c: any, status: number, error: string, message: string, extra: object = {}) => c.json({ error, message, ...extra }, status, NO_STORE);

/** 1日あたりの回数と容量(IP ごと)、全体の回数を数える。KV のため厳密ではなく、目安の上限。 */
async function charge(c: any, bytes: number): Promise<Response | null> {
  const day = new Date().toISOString().slice(0, 10);
  const who = (await hmacHex(c.env.PUBLISH_TOKEN, ipOf(c))).slice(0, 32);
  const kIp = `q:${day}:${who}`, kAll = `q:${day}:all`;
  const [u, g] = await Promise.all([c.env.DOCS.get(kIp, "json"), c.env.DOCS.get(kAll, "json")]) as [{ n: number; b: number } | null, { n: number } | null];
  const dayN = Number(c.env.DAY_DOCS) || 50, dayB = Number(c.env.DAY_BYTES) || 2_000_000, allN = Number(c.env.ALL_DOCS) || 5000;
  if ((g?.n ?? 0) >= allN) return fail(c, 503, "busy", "今日は受け付けられる数に達しました。明日になってから、もう一度お試しください。");
  if ((u?.n ?? 0) >= dayN || (u?.b ?? 0) + bytes > dayB)
    return fail(c, 429, "daily_limit", `1日あたりの上限(${dayN}件、${dayB}バイト)に達しました。明日になってから、もう一度お試しください。`, { retry_after: "tomorrow" });
  await Promise.all([
    c.env.DOCS.put(kIp, JSON.stringify({ n: (u?.n ?? 0) + 1, b: (u?.b ?? 0) + bytes }), { expirationTtl: 172800 }),
    c.env.DOCS.put(kAll, JSON.stringify({ n: (g?.n ?? 0) + 1 }), { expirationTtl: 172800 }),
  ]);
  return null;
}

async function readBody(c: any): Promise<{ markdown: string; title?: string; days: number; bytes: number } | Response> {
  const max = Number(c.env.MAX_BYTES) || 200_000;
  const tooLarge = () => fail(c, 413, "too_large", `1つの文書は${max}バイトまでです。章ごとなどに分けて、複数の文書として公開してください。各文書の先頭か末尾に、前後の文書の URL を書くと読みやすくなります。`, { max_bytes: max });
  if (Number(c.req.header("content-length") ?? 0) > max + 2000) return tooLarge();
  const text = await c.req.text();
  if (new TextEncoder().encode(text).length > max + 2000) return tooLarge();
  let markdown: string, title: string | undefined, days: number | undefined;
  if ((c.req.header("content-type") ?? "").includes("application/json")) {
    let j: any; try { j = JSON.parse(text); } catch { return fail(c, 400, "bad_json", "JSON として読めません。"); }
    if (typeof j?.markdown !== "string") return fail(c, 400, "markdown_required", "markdown に文字列を指定してください。");
    markdown = j.markdown; title = typeof j.title === "string" ? j.title : undefined;
    days = j.expires_in_days == null ? undefined : Number(j.expires_in_days);
  } else {
    markdown = text; title = c.req.query("title") || undefined;
    days = c.req.query("expires_in_days") ? Number(c.req.query("expires_in_days")) : undefined;
  }
  if (!markdown.trim()) return fail(c, 400, "markdown_required", "本文が空です。");
  const bytes = new TextEncoder().encode(markdown).length;
  if (bytes > max) return tooLarge();
  const maxDays = Number(c.env.MAX_DAYS) || 90, def = Number(c.env.DEFAULT_DAYS) || 30;
  if (days !== undefined && !(Number.isInteger(days) && days >= 1 && days <= maxDays)) return fail(c, 400, "bad_expires_in_days", `expires_in_days は1から${maxDays}の整数で指定してください。`);
  return { markdown, title: title?.slice(0, 120), days: days ?? def, bytes };
}

const urls = (c: any, id: string) => { const o = new URL(c.req.url).origin; return { url: `${o}/d/${id}`, raw_url: `${o}/d/${id}.md` }; };

async function save(c: any, id: string, prev?: Doc) {
  const b = await readBody(c);
  if (b instanceof Response) return b;
  const over = await charge(c, b.bytes);
  if (over) return over;
  const now = new Date().toISOString();
  const token = prev ? null : newEditToken();
  const doc: Doc = { markdown: b.markdown, title: b.title || titleOf(b.markdown), created: prev?.created ?? now, updated: now, edit: prev?.edit ?? await sha256Hex(token!) };
  await c.env.DOCS.put(`d:${id}`, JSON.stringify(doc), { metadata: { title: doc.title, updated: now, size: b.bytes } satisfies Meta, expirationTtl: b.days * 86400 });
  const expires = new Date(Date.now() + b.days * 86400_000).toISOString();
  return c.json({ id, title: doc.title, ...urls(c, id), updated: now, expires_at: expires, ...(token ? { edit_token: token, note: "edit_token は今しか表示されません。更新や削除をしないなら保存は不要です。" } : {}) }, prev ? 200 : 201, NO_STORE);
}

/** 編集トークン(その文書のもの)か、運営者のトークンで認可する */
async function canEdit(c: any, doc: Doc): Promise<boolean> {
  const m = (c.req.header("authorization") ?? "").match(/^Bearer (\S{20,200})$/);
  if (!m) return false;
  if (await same(m[1], c.env.PUBLISH_TOKEN)) return true;
  return doc.edit ? safeEq(await sha256Hex(m[1]), doc.edit) : false;
}

app.post("/v1/docs", (c) => save(c, newId()));

async function owned(c: any): Promise<{ id: string; doc: Doc } | Response> {
  const id = c.req.param("id");
  const doc = ID.test(id) ? await (c.env.DOCS as KVNamespace).get<Doc>(`d:${id}`, "json") : null;
  if (!doc) return fail(c, 404, "not_found", "その文書は見つかりません。");
  if (!(await canEdit(c, doc))) return fail(c, 401, "unauthorized", "編集トークンが違います。Authorization: Bearer <edit_token> で送ってください。");
  return { id, doc };
}

app.put("/v1/docs/:id", async (c) => { const o = await owned(c); return o instanceof Response ? o : save(c, o.id, o.doc); });

app.get("/v1/docs/:id", async (c) => {
  const o = await owned(c);
  if (o instanceof Response) return o;
  const { edit: _e, ...pub } = o.doc;
  return c.json({ id: o.id, ...pub, ...urls(c, o.id) }, 200, NO_STORE);
});

app.delete("/v1/docs/:id", async (c) => {
  const o = await owned(c);
  if (o instanceof Response) return o;
  await c.env.DOCS.delete(`d:${o.id}`);
  return c.json({ ok: true }, 200, NO_STORE);
});

// 一覧は運営者だけ(通報への対応用)
app.get("/v1/docs", async (c) => {
  const m = (c.req.header("authorization") ?? "").match(/^Bearer (\S{20,200})$/);
  if (!m || !(await same(m[1], c.env.PUBLISH_TOKEN))) return fail(c, 401, "unauthorized", "この操作は運営者だけができます。");
  const l = await (c.env.DOCS as KVNamespace).list<Meta>({ prefix: "d:", limit: 100, cursor: c.req.query("cursor") || undefined });
  return c.json({
    docs: l.keys.map((k) => ({ id: k.name.slice(2), title: k.metadata?.title, updated: k.metadata?.updated, size: k.metadata?.size, ...urls(c, k.name.slice(2)) })),
    next: l.list_complete ? null : l.cursor,
  }, 200, NO_STORE);
});

app.notFound((c) => new URL(c.req.url).pathname.startsWith("/v1/") ? c.json({ error: "not_found" }, 404) : errorPage(404, "ページが見つかりません", "お探しのページは存在しません。"));
app.onError((e, c) => { console.error(e); return errorPage(500, "エラーが発生しました", "時間をおいてもう一度お試しください。"); });

export default app;
