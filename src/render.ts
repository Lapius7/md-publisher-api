import MarkdownIt from "markdown-it";

// raw HTML は無効。javascript: などの危険なリンクは markdown-it が既定で拒否する。
const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

// 外部リンクは Referer と opener を渡さず、検索エンジンにも評価を渡さない
const defaultLink = md.renderer.rules.link_open ?? ((t, i, o, _e, self) => self.renderToken(t, i, o));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet("rel", "noopener noreferrer nofollow");
  return defaultLink(tokens, idx, options, env, self);
};

export const renderMarkdown = (src: string) => md.render(src);

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function titleOf(markdown: string): string {
  const m = markdown.match(/^#{1,3}\s+(.+?)\s*#*\s*$/m);
  return (m?.[1] ?? "無題").replace(/[`*_\[\]]/g, "").slice(0, 120);
}

export const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function renderPage(title: string, markdown: string, updated: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title>
<style>:root{color-scheme:light dark}body{margin:0;font:16px/1.85 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;background:Canvas;color:CanvasText}main{max-width:780px;margin:0 auto;padding:32px 20px 80px;overflow-wrap:anywhere}h1{font-size:30px;line-height:1.35}h2{font-size:23px;margin-top:2em}h3{font-size:19px}img{max-width:100%;height:auto;border-radius:6px}code{background:color-mix(in srgb,CanvasText 10%,transparent);padding:.1em .35em;border-radius:4px;font-size:.9em}pre{overflow:auto;padding:14px;border-radius:8px;background:color-mix(in srgb,CanvasText 8%,transparent)}pre code{background:none;padding:0}blockquote{margin:1em 0;padding:0 1em;border-left:3px solid color-mix(in srgb,CanvasText 30%,transparent);opacity:.85}table{border-collapse:collapse;display:block;overflow:auto}th,td{border:1px solid color-mix(in srgb,CanvasText 25%,transparent);padding:6px 10px}a{color:inherit}footer{margin-top:3em;font-size:13px;opacity:.6}</style></head>
<body><main>${renderMarkdown(markdown)}<footer>更新: ${esc(updated.slice(0, 10))} · <a href="?raw=1">Markdown</a></footer></main></body></html>`;
}
