# CLAUDE.md

このリポジトリの作業ルールは [AGENTS.md](AGENTS.md) を参照してください。

アプリは `src/index.html` を入口とする静的な在庫管理モックです。`scripts/start.sh`
で起動できます。スマートフォンでバーコードのカメラ読み取りを試す場合は、HTTPS配信の
`scripts/start-https.sh` を使ってください（`http://` のIPアドレスアクセスではカメラが使えません）。
要件は `docs/requirements.md`、設計は `docs/design.md` に記録しています。
