# AGENTS.md

## プロジェクト概要

HTML、CSS、素の JavaScript で作られた在庫管理モックです。ビルド工程や依存パッケージはありません。

## 構成と編集方針

- 実行コードは `src/` に置く。画面は `src/index.html`、スタイルは `src/css/`、スクリプトは `src/js/`。
- 要件・設計など、人が参照する文書は `docs/` に置く。
- モジュールは classic script とグローバル名前空間 `App` を使用する。`src/index.html` の読み込み順を変更するときは依存関係を確認する。
- `localStorage` のデータ形式を変更する場合は、既存データの移行と `docs/design.md` を更新する。

## 確認

JavaScript を変更した場合は、少なくとも次を実行する。

```sh
find src/js -name '*.js' -print0 | xargs -0 -n1 node --check
```
