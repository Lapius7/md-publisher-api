export const llmsMd = (base: string) => `# md-publisher-api

Markdown を送ると、読みやすい Web ページの URL を返す API です。登録も認証も要りません。ページは URL を知っている人だけが読めます(検索には載りません)。
Base URL: ${base}

## 先に確認すること
- 公開した内容は、URL を知る人なら誰でも読めます。キー、パスワード、個人情報が入っていないかを確かめ、入っていたら公開せずにユーザーへ知らせてください。
- 利用規約: ${base}/terms

## 公開する
\`\`\`
curl -s -X POST "${base}/v1/docs" -H "content-type: text/markdown" --data-binary @note.md
\`\`\`
JSON でも送れます: \`{"markdown": "...", "title": "任意", "expires_in_days": 30}\`(content-type: application/json)。

応答の例:
\`\`\`
{"id":"…","url":"${base}/d/…","raw_url":"${base}/d/….md","update_key":"mdu_…","delete_key":"mdd_…"}
\`\`\`
ユーザーには \`url\` を知らせてください。\`update_key\`(更新用)と \`delete_key\`(削除用)は、この応答でしか表示されません。2つともユーザーに伝えて、後で直したり消したりするときのために保管するよう案内してください。ログやファイルには書かないでください。

## 長い文書は分ける
1つの文書は 200,000 バイト(日本語でおよそ6万文字)までです。超えると 413 (\`too_large\`) が返ります。

章や話題ごとに分けて、複数の文書として公開してください。分けた文書には、前後の文書の URL を書くと読みやすくなります。目次になる文書を最後に1つ公開し、各文書の URL を並べる方法もあります。

## 制限
- 1つの IP から、1分に10回まで。1日に50件、合計 2,000,000 バイトまで。
- 公開した文書は、削除するまで残ります。自動で消したいときは、\`expires_in_days\`(1〜3650)を指定します。
- 上限に達すると 429 が返ります。\`message\` に従って、時間をおいてからやり直してください。

## 更新と削除
更新と取得には \`Authorization: Bearer <update_key>\`、削除には \`Authorization: Bearer <delete_key>\` を付けます。

| メソッドとパス | 内容 |
|---|---|
| PUT /v1/docs/{id} | (update_key)同じ URL のまま内容を更新(\`expires_in_days\` を付けると、更新した日から数え直します) |
| GET /v1/docs/{id} | 1件を JSON で取得(update_key) |
| DELETE /v1/docs/{id} | 削除(delete_key) |

クエリの \`title\`(省略時は最初の見出し)と \`expires_in_days\` も使えます。

## 送るときの注意
- curl で送るのが確実です。Python の標準ライブラリ(urllib)など一部のクライアントは、既定の User-Agent が原因で 403(error code: 1010)になります。その場合は \`User-Agent: curl/8\` のようなヘッダーを付けるか、curl か requests を使ってください。

## 表示について
- HTML タグは表示されず、文字として出ます。画像は表示されず、リンクになります。
- 問題のある文書の通報は、${base}/terms の連絡先へお願いします。
`;
