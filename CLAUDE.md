# CLAUDE.md

このリポジトリの作業ルールは [AGENTS.md](AGENTS.md) を参照してください。

アプリは `src/index.html` を入口とする静的な在庫管理システムです。`scripts/start.sh`
で起動できます。スマートフォンでバーコードのカメラ読み取りを試す場合は、HTTPS配信の
`scripts/start-https.sh` を使ってください（`http://` のIPアドレスアクセスではカメラが使えません）。

データ（商品マスタ・在庫・出庫履歴）はMicrosoft 365のSharePointリストにMicrosoft Graph API経由で
保存しており、利用にはMicrosoft 365アカウントでのサインインが必須です。ローカルでの動作確認では
サインインまでは確認できますが、実際のデータの読み書きは本番のGitHub Pagesサイト
（`https://omoti12.github.io/inventory-management/src/index.html`）で確認する必要があります。
SharePointの列名とコード側のマッピング、GraphのリストID指定など実装上の注意点は
`docs/design.md` の「SharePoint / Microsoft Graph バックエンド」に記録しています。

要件は `docs/requirements.md`、設計は `docs/design.md` に記録しています。
