# md-publisher-api

Markdown を API で送ると、読みやすい Web ページの URL を返すサービスです。Claude Code などの AI から、まとめた文書をそのまま共有できます。

`https://md-publisher-api.wks.lapius7.com`

- 公開すると、URL を知っている人だけが読めるページになります。検索エンジンには載りません。
- 公開、更新、削除は、運営者のトークンが必要です。ページを読むだけなら、トークンは要りません。
- [discord-messageapi-bot](https://github.com/Lapius7/discord-messageapi-bot) で取得した Discord の投稿を、AI にまとめさせて公開する使い方を想定しています。

## AI への指示文

次の文を Claude Code などに渡すか、`CLAUDE.md` に書いておくと、AI が自分で公開まで進められます。

```
まとめた Markdown を公開したいときは、https://md-publisher-api.wks.lapius7.com/llms.md を先に読んで、その API で公開すること。
トークンは環境変数 MD_TOKEN から読み、出力やファイルには書かないこと。
公開前に、中身に秘密情報(キー、パスワード、個人情報)がないかを確かめ、見つけたら公開せずに知らせること。
公開したら、url をユーザーに知らせること。
```

Discord のまとめを公開する例です。

```
discord-messageapi-bot のキーで、このチャンネルの先週の投稿を取得して、要点を Markdown にまとめて。
できた文書は md-publisher-api で公開して、URL を教えて。
(それぞれの llms.md を先に読むこと)
```

## 使い方

トークンを環境変数 `MD_TOKEN` に入れます(値の入れ方は、シェルの設定やパスワードマネージャーに合わせてください)。

```
# 公開する
curl -s -X POST https://md-publisher-api.wks.lapius7.com/v1/docs \
  -H "Authorization: Bearer $MD_TOKEN" \
  -H "content-type: text/markdown" --data-binary @note.md
```

応答の `url` が公開ページ、`raw_url` が Markdown そのものです。`id` は更新と削除に使います。

### API

| メソッドとパス | 内容 |
|---|---|
| `POST /v1/docs` | 新規公開(1MB まで) |
| `PUT /v1/docs/{id}` | 同じ URL のまま内容を更新 |
| `GET /v1/docs/{id}` | 1件を JSON で取得 |
| `DELETE /v1/docs/{id}` | 削除 |
| `GET /v1/docs` | 一覧(100件ずつ。続きは `cursor`) |
| `GET /d/{id}` | 公開ページ(認証なし) |
| `GET /d/{id}.md` | Markdown そのもの(認証なし) |
| `GET /llms.md` | AI 向けの使い方 |

本文は `text/markdown` で直接送るか、JSON(`{"markdown": "...", "title": "...", "expires_in_days": 30}`)で送ります。`title` を省くと最初の見出しを使い、`expires_in_days`(1〜3650)を省くと無期限です。

## セキュリティ

- **認証:** 管理用の API は、256ビット相当のランダムなトークンで守ります。トークンの比較は定数時間で行い、失敗した理由は区別せず 401 を返します。リクエストには IP ごとの回数制限があります。
- **推測できない URL:** ページの ID は、暗号論的な乱数から作った 12 文字(約71ビット)です。一覧は、トークンがなければ取得できません。
- **HTML を通さない:** Markdown 内の HTML タグは変換せず、文字として表示します。`javascript:` などの危険なリンクは無効にします。
- **ページの防御:** CSP で、スクリプトの実行、外部への送信、iframe への埋め込みを禁止しています。`nosniff`、`no-referrer`、`noindex` も付けています。外部リンクには `rel="noopener noreferrer nofollow"` を付けます。
- **サイズの上限:** 1つの文書は 1MB までです。本文を読む前に、`content-length` で弾きます。
- **注意:** 画像は https の外部 URL だけ表示できます。読む人のブラウザがその URL に接続するため、画像の配信元に IP アドレスが伝わります。公開する文書に、信頼できない画像の URL を入れないでください。
- **秘密情報を載せない:** URL を知っている人は誰でも読めます。パスワードやキーを含む文書は公開しないでください。

## 構成

Cloudflare Workers と Workers KV で動きます。文書は KV に保存し、公開ページは Worker が Markdown から HTML を作って返します。

| ファイル | 内容 |
|---|---|
| `src/index.ts` | ルーティング、認証、回数制限 |
| `src/render.ts` | Markdown から HTML への変換と CSP |
| `src/llms.ts` | `/llms.md` の内容 |
| `test/` | 変換のテスト |

## 運営者向け

```
pnpm install
bun test test
pnpm exec wrangler kv namespace create DOCS     # 出力された id を wrangler.jsonc に書く
pnpm exec wrangler secret put PUBLISH_TOKEN     # 長いランダムな文字列を入れる
pnpm exec wrangler deploy
```

トークンを替えるときは、`wrangler secret put PUBLISH_TOKEN` をもう一度実行します。古いトークンはすぐに使えなくなります。

## ライセンス

全権利を留保します([LICENSE](LICENSE))。コードの利用、複製、改変、再配布はできません。サービスとしての利用は、運営者の許可を得た範囲でできます。
