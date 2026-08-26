# vendor

このディレクトリには、CDNを使わずオフラインで動かすために取り込んだ外部ライブラリを置く。

## zxing.min.js

- 由来: [`@zxing/library`](https://github.com/zxing-js/library) v0.23.0 の UMD ビルド
  （`https://unpkg.com/@zxing/library@0.23.0/umd/index.min.js` から取得）
- ライセンス: Apache License 2.0（[zxing.LICENSE.txt](zxing.LICENSE.txt) を参照）
- 用途: `BarcodeDetector` API に対応していないブラウザ（Windows/Mac の Chrome など）でも
  カメラ映像からバーコードを読み取れるようにするためのフォールバック。`src/js/scanner.js` から
  `window.ZXing` として参照する。
- 変更は加えていない（配布されたビルドをそのまま配置）。

## msal-browser.min.js

- 由来: [`@azure/msal-browser`](https://github.com/AzureAD/microsoft-authentication-library-for-js) v3.30.0 の UMD ビルド
  （`https://cdn.jsdelivr.net/npm/@azure/msal-browser@3/lib/msal-browser.min.js` から取得）
- ライセンス: MIT License（[msal-browser.LICENSE.txt](msal-browser.LICENSE.txt) を参照）
- 用途: Microsoft 365（Entra ID）でのサインインとアクセストークン取得。`src/js/auth.js` から
  `window.msal` として参照する。SharePointリストをMicrosoft Graph API経由で読み書きするために必要。
- 変更は加えていない（配布されたビルドをそのまま配置）。
