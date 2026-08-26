# AGENTS.md

## プロジェクト概要

HTML、CSS、素の JavaScript で作られた在庫管理システムです。ビルド工程や依存パッケージはありません。
データ（商品マスタ・在庫・出庫履歴）はMicrosoft Graph API経由でSharePointリストに保存し、
Microsoft 365アカウントでのサインインを必須としています。

## 構成と編集方針

- 実行コードは `src/` に置く。画面は `src/index.html`、スタイルは `src/css/`、スクリプトは `src/js/`。
- 要件・設計など、人が参照する文書は `docs/` に置く。
- 起動など繰り返し使う操作用のスクリプトは `scripts/` に置く。
- モジュールは classic script とグローバル名前空間 `App` を使用する。`src/index.html` の読み込み順を変更するときは依存関係を確認する。
- `App.store` の書き込み系関数（`addProduct`/`ship` など）はSharePointへの通信を伴うため Promise を返す。
  呼び出し側は `.then()` で結果を受け取ること（同期呼び出しに戻さない）。
- SharePointリストの列を新設・変更した場合は、列の「内部名」が表示名と一致するとは限らない
  （実例あり）。`store.js` の `xxxToFields`/`xxxFromGraphItem` を書く前に、実際の内部名を
  `FldEdit.aspx?List={GUID}&Field=...` のURLで確認すること。詳細は `docs/design.md` の
  「SharePoint / Microsoft Graph バックエンド」を参照。
- データモデルやSharePoint連携まわりを変更した場合は `docs/design.md` を更新する。

## 確認

JavaScript を変更した場合は、少なくとも次を実行する。

```sh
find src/js -name '*.js' -print0 | xargs -0 -n1 node --check
```
