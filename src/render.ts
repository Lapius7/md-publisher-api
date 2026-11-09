import MarkdownIt from "markdown-it";
import { extras } from "./extras";

// raw HTML は無効。javascript: などの危険なリンクは markdown-it が既定で拒否する。
const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

md.use(extras);

// 外部リンクは Referer と opener を渡さず、検索エンジンにも評価を渡さない
const defaultLink = md.renderer.rules.link_open ?? ((t, i, o, _e, self) => self.renderToken(t, i, o));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet("rel", "noopener noreferrer nofollow");
  return defaultLink(tokens, idx, options, env, self);
};

// 画像は読む人の IP を投稿者に知らせてしまうので表示せず、リンクにする
md.renderer.rules.image = (tokens, idx) => {
  const t = tokens[idx];
  return `<a href="${esc(t.attrGet("src") ?? "")}" rel="noopener noreferrer nofollow">[画像: ${esc(t.content || "リンク")}]</a>`;
};

export const renderMarkdown = (src: string) => md.render(src);

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function titleOf(markdown: string): string {
  const m = markdown.match(/^#{1,3}\s+(.+?)\s*#*\s*$/m);
  return (m?.[1] ?? "無題").replace(/[`*_\[\]]/g, "").slice(0, 120);
}

export const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const STYLE = `:root{color-scheme:light dark}body{margin:0;font:16px/1.85 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;background:Canvas;color:CanvasText}main{max-width:780px;margin:0 auto;padding:24px 20px 80px;overflow-wrap:anywhere}h1{font-size:30px;line-height:1.35}h2{font-size:23px;margin-top:2em}h3{font-size:19px}code{background:color-mix(in srgb,CanvasText 10%,transparent);padding:.1em .35em;border-radius:4px;font-size:.9em}pre{overflow:auto;padding:14px;border-radius:8px;background:color-mix(in srgb,CanvasText 8%,transparent)}pre code{background:none;padding:0}blockquote{margin:1em 0;padding:0 1em;border-left:3px solid color-mix(in srgb,CanvasText 30%,transparent);opacity:.85}table{border-collapse:collapse;display:block;overflow:auto}th,td{border:1px solid color-mix(in srgb,CanvasText 25%,transparent);padding:6px 10px}a{color:inherit}.note{font-size:13px;padding:8px 12px;border-radius:8px;background:color-mix(in srgb,CanvasText 8%,transparent);margin-bottom:24px}details{margin:1em 0;border:1px solid color-mix(in srgb,CanvasText 25%,transparent);border-radius:8px;padding:0 14px}summary{cursor:pointer;font-weight:600;padding:10px 0}details[open]>summary{border-bottom:1px solid color-mix(in srgb,CanvasText 15%,transparent);margin-bottom:8px}ul.tasks{list-style:none;padding-left:.4em}li.task input{margin-right:.5em;transform:scale(1.15)}.chart{margin:1.2em 0}.chart svg{width:100%;height:auto;max-width:640px}footer{margin-top:3em;font-size:13px;opacity:.65}`;

const shell = (title: string, body: string) => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;

/** 利用者が投稿した文書のページ */
export function renderPage(title: string, markdown: string, updated: string): string {
  return shell(title, `<div class="note">利用者が投稿した文書です。運営者は内容を確認していません。リンク先やファイルには注意してください。</div>${renderMarkdown(markdown)}<footer>更新: ${esc(updated.slice(0, 10))} · <a href="?raw=1">Markdown</a> · <a href="/terms">利用規約と通報</a></footer>`);
}

/** 運営者が書いた固定ページ(利用規約など) */
export const renderStatic = (title: string, markdown: string) => shell(title, renderMarkdown(markdown));
