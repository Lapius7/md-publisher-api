export const llmsMd = (base: string) => `# md-publisher-api

Markdown を投稿すると、読みやすい Web ページの URL を返す API です。URL を知っている人だけが読めます(検索には載りません)。
Base URL: ${base}

## 認証
管理用の呼び出しには \`Authorization: Bearer $MD_TOKEN\` を付けます。トークンは環境変数 MD_TOKEN に置き、出力やファイルに書かないでください。

## 公開する
\`\`\`
curl -s -X POST "${base}/v1/docs" -H "Authorization: Bearer $MD_TOKEN" \\
  -H "content-type: text/markdown" --data-binary @note.md
\`\`\`
JSON でも送れます: \`{"markdown": "...", "title": "任意", "expires_in_days": 30}\`(content-type: application/json)。
応答の \`url\` が公開ページ、\`raw_url\` が Markdown そのものです。\`id\` は更新と削除に使います。

## 操作
| メソッドとパス | 内容 |
|---|---|
| POST /v1/docs | 新規公開。1 MB まで |
| PUT /v1/docs/{id} | 同じ URL のまま内容を更新 |
| GET /v1/docs/{id} | 1 件を JSON で取得 |
| DELETE /v1/docs/{id} | 削除 |
| GET /v1/docs | 一覧(100 件ずつ。続きは \`cursor\`) |

クエリ \`title\`(省略時は最初の見出し)と \`expires_in_days\`(1〜3650、省略で無期限)も使えます。

## 注意
- 画像は https の URL だけ表示されます。HTML タグは表示されず、文字として出ます。
- 公開した内容は、URL を知る人なら誰でも読めます。秘密の情報は載せないでください。
`;
