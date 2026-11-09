# md-publisher-api

Markdown を API で送ると、読みやすい Web ページの URL を返すサービスです。Claude などの AI がまとめた文書を、人に渡すために作りました。登録も認証も要りません。

- サービス: https://md-publisher-api.wks.lapius7.com
- AI 向けの説明: https://md-publisher-api.wks.lapius7.com/llms.md
- 利用規約と通報: https://md-publisher-api.wks.lapius7.com/terms

## AI への指示文

次の文を、そのまま AI に渡してください。

```
まとめた Markdown を人に渡したいときは、先に https://md-publisher-api.wks.lapius7.com/llms.md を読み、その API で公開してください。登録やトークンは要りません。

公開する前に、本文にキー、パスワード、個人情報が含まれていないかを確かめてください。見つけたら公開せず、何が含まれていたかを私に知らせてください。

公開したら、応答の url を私に知らせてください。応答の edit_token は更新と削除に使う値なので、私が頼んだときだけ見せ、ログやファイルには書かないでください。

文書が大きくて 413 が返ったら、章ごとに分けて、それぞれ公開してください。
```

Discord のメッセージを取得するボットと組み合わせるときは、取得側の `llms.md` も読ませてください。

```
環境変数 DCM_KEY のキーで、そのキーに紐づく Discord チャンネルの、先週(月曜から日曜)の投稿を取得し、要点を Markdown にまとめてください。
取得の説明書: https://discord-messageapi-bot.wks.lapius7.com/llms.md

まとめたら、次の説明書に従って公開し、url を私に知らせてください。
公開の説明書: https://md-publisher-api.wks.lapius7.com/llms.md
```

## 使い方

```bash
curl -s -X POST https://md-publisher-api.wks.lapius7.com/v1/docs \
  -H "content-type: text/markdown" --data-binary @note.md
```

応答に `url`(ページ)、`raw_url`(Markdown のまま)、`expires_at`(自動で消える日時)、`edit_token` が入ります。`edit_token` は更新と削除に使い、この応答でしか表示されません。

JSON でも送れます: `{"markdown": "...", "title": "任意", "expires_in_days": 30}`

## API

| メソッドとパス | 認証 | 内容 |
|---|---|---|
| POST /v1/docs | 不要 | 公開する |
| PUT /v1/docs/{id} | edit_token | 同じ URL のまま更新する |
| GET /v1/docs/{id} | edit_token | 1件を JSON で取得する |
| DELETE /v1/docs/{id} | edit_token | 削除する |
| GET /d/{id} | 不要 | ページを読む(`.md` を付けるか `?raw=1` で Markdown のまま) |

edit_token は `Authorization: Bearer <edit_token>` で送ります。

## 制限

| 項目 | 上限 |
|---|---|
| 1つの文書 | 200KB(超えると 413。分けて公開する) |
| 1つの IP からの回数 | 1分に10回、1日に50件、1日 2MB |
| 保存期間 | 初期値30日、`expires_in_days` で1〜90日 |
| 全体の1日の受付 | 5,000件 |

IPv6 は /64 単位で数えます。値は `wrangler.jsonc` の `vars` で変えられます。

## 悪用への備えと安全性

- 公開した内容は、運営者が事前に確認しません。問題のある文書は通報を受けて削除します。
- 文書内の HTML は実行されず、文字として表示されます。`javascript:` などのリンクは無効にし、外部リンクには `rel="noopener noreferrer nofollow"` を付けます。
- 画像は読む人の IP が投稿者に伝わるため、表示せずリンクにします。
- ページの CSP は `default-src 'none'` で、スクリプトと外部読み込みを許しません。`nosniff`、`no-referrer`、`noindex` も付けています。
- 文書の ID は推測できない12文字(約71ビット)です。edit_token は256ビットで、サーバーにはハッシュだけを保存します。
- IP アドレスは保存しません。1日の回数を数えるときだけ、運営者のみが知る鍵でハッシュにした値を最大2日保存します。
- 一覧と削除の強制は運営者のトークンだけができます。

## 構成

```
src/index.ts   ルーティング、制限、認可
src/render.ts  Markdown の変換とページ
src/ip.ts      IP の丸め、ハッシュ、トークン
src/llms.ts    /llms.md
docs/          利用規約とプライバシーポリシー(/terms と /privacy で配信)
test/          変換の安全性テスト
```

## 運営者向け

```bash
pnpm install
pnpm wrangler secret put PUBLISH_TOKEN   # 運営者のトークン(一覧と強制削除に使う)
pnpm wrangler deploy
```

## ライセンス

All rights reserved. 配信中のサービスを、運営者が認めた範囲で使えます。コードの複製や再配布はできません。
