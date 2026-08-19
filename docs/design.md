# 設計メモ（モック）

最終更新: 2026-08-19

このドキュメントは「どう作ったか」を記録する。何を作るかは [requirements.md](requirements.md)、
動かし方は [../README.md](../README.md) を参照。

## 方針

業務フローと画面を検証するためのモック。サーバー・DB・ビルドツールを使わず、
HTML / CSS / 素の JavaScript のみで構成し、データはブラウザの `localStorage` に保存する。

- ES Modules は `file://` で動かないため、classic script ＋ グローバル名前空間 `App` を使う。
  `src/index.html` をそのままダブルクリックしても動作する。
- 外部 CDN・Web フォント・画像を使わず、オフラインで開ける（バーコード読み取りライブラリのみ `src/js/vendor/` に取り込み済みで、実行時に外部へアクセスしない）。
- 見た目はモダン（白基調・アクセント1色・余白多め・薄い影）。
- 製造番号のバーコード読み取り（カメラ）を使う場合のみ、`http://localhost` などのセキュアなコンテキストが必要。
- 通常品とフィルター品は、商品マスタ・在庫ともに `category` / `stockType` で分離した別ラインとして扱う。

## ファイル構成

```
src/index.html            9画面ぶんの section とタブナビ
src/css/style.css         デザイントークン（CSS変数）＋レイアウト＋コンポーネント
src/js/store.js           データモデル（商品マスタ／在庫／出庫）/ localStorage 永続化 / 検索・集計・バリデーション・旧データ移行
src/js/seed.js            デモ用初期データ（通常品・フィルター品の商品マスタ＋在庫＋出庫履歴）
src/js/ui.js              タブ切替・テーブル生成・トースト・確認ダイアログ・表示整形
src/js/inventory.js       在庫一覧（通常品、明細 / 商品まとめ）＋検索＋選択
src/js/products.js        商品管理（通常品の商品マスタの登録・編集・削除）
src/js/inbound.js         入庫（通常品、商品コード/製品名の自由入力＋数量・受注番号・入庫した人など）
src/js/scanner.js         バーコード読み取り（カメラ。BarcodeDetector API、無ければ vendor/zxing.min.js にフォールバック）
src/js/vendor/            CDNを使わず取り込んだ外部ライブラリ（zxing.min.js など。詳細は vendor/README.md）
src/js/shipping.js        出庫（通常品、必須項目チェック）
src/js/history.js         出庫履歴（通常品）・キャンセル
src/js/filter-products.js フィルター商品管理（フィルター品の商品マスタの登録・編集・削除）
src/js/filter-inbound.js  フィルター入庫（フィルター品、製造番号・入荷日付・案件番号）
src/js/filter-shipping.js フィルター出庫（在庫の選択＋出庫フォームを1画面に統合）
src/js/filter-history.js  フィルター出庫履歴・キャンセル
src/js/app.js             起動処理
```

読み込み順は
`store → seed → ui → inventory → products → filter-products → scanner → inbound → filter-inbound → shipping → filter-shipping → history → filter-history → app`。
`src/js/scanner.js` は `inbound.js` より前に読み込む。`src/js/app.js` が `DOMContentLoaded` で初期化する。

## データモデル

localStorage キー：`inv.products` / `inv.items` / `inv.shipments` / `inv.seeded`

```js
// 商品マスタ（商品コードは種別内で一意）
product = {
  id, productCode, productName,
  category,              // 'normal' | 'filter'
  createdAt
}

// 在庫（通常品）：受注番号・数量のバッチ単位
item = {
  id, productId,
  quantity,               // 入庫数量（1以上）
  orderNo,                // 受注番号
  arrivalDate,            // "YYYY-MM-DD"、任意
  receivedBy,              // 入庫した人
  remarks,                // 備考、任意
  stockType: 'normal',
  status,                 // 'in_stock' | 'shipped'
  registeredAt
}

// 在庫（フィルター品）：個体単位（フィルター入庫は現状の運用を維持）
item = {
  id, productId,
  serialNo,               // 製造番号
  arrivalDate,             // "YYYY-MM-DD"、必須
  projectNo,               // 案件番号
  stockType: 'filter',
  status,                  // 'in_stock' | 'shipped'
  registeredAt
}

// 出庫（履歴の実体。通常品・フィルター品で共通の形）
shipment = {
  id, itemId,
  shippedBy, orderTo, endUser,
  shippedAt,
  status,                  // 'shipped' | 'cancelled'
  cancelledAt
}
```

同じ `items` 配列に通常品・フィルター品を混在させ、`stockType` で扱う項目が異なる
（数量・受注番号・入庫した人・備考 vs 製造番号・案件番号）。`store.js` の `decorate()` は
item が持つ項目をそのまま商品情報に合成して返すため、画面側は自分が使う項目だけを参照すればよい。

画面に渡す行は `store.js` の `decorate()` が item に商品マスタの `productCode` / `productName` を合成して作る。
商品マスタを削除できるのは未使用のときだけなので通常は起きないが、参照先の商品が見つからない場合は
`productCode` に `(削除済み商品)` と表示する。

### 状態遷移

```
入庫 → item.status = 'in_stock'（在庫一覧に表示）
出庫 → item.status = 'shipped'  ＋ shipment を作成（status='shipped'）。行（ロット）単位で丸ごと出庫する（部分出庫は無し）
キャンセル → shipment.status = 'cancelled' ＋ item.status = 'in_stock' に戻す
```

出庫履歴は削除しない。キャンセルしても行は残り、状態表示だけが変わる。

### 商品マスタの削除制約

商品マスタは在庫・履歴から参照されている間は削除できない。
`productUsage()` が `items` を走査して使用数（在庫数・出庫済み数・合計）を数え、
合計が0件のときだけ `deleteProduct()` が成功する。
この制約により、`decorate()` の参照先が消えて履歴が壊れることを防いでいる。

### 旧データの移行

`store.js` の `load()` が以下を毎回実行する（変更があった場合のみ保存）。利用者側の操作は不要。

- `migrateLegacyProducts()`：型名・寸法・図番ベースの商品マスタを `productCode` / `productName` に変換する
  （`productCode = 旧型名`、`category = 'normal'`）。
- `migrateLegacyItems()`：商品マスタを持たない最古形式の item を商品マスタ参照に変換したうえで、
  製造番号・入荷月・案件番号ベースの item を 数量・受注番号・入庫した人・入荷日ベースに変換する
  （`orderNo = 旧案件番号`、`quantity = 1`、`arrivalDate = 旧入荷月 + '-01'`、`serialNo` は破棄）。
- `migrateLegacyShipments()`：出荷先・宛先ベースの出荷を `orderTo` / `endUser` に変換する。

## store.js の公開関数

画面側は必ずこのモジュール経由でデータを読み書きする。

| 関数 | 役割 |
| --- | --- |
| `load()` | localStorage から読み込み、旧データの移行を行う |
| `listProducts(category)` | 商品マスタを商品コード順で返す。`category`（'normal'/'filter'）で絞り込み可 |
| `getProduct(id)` / `getProductByCode(code, category)` | 商品マスタ1件を取得 |
| `productUsage(id)` | 指定した商品の使用状況（在庫数・出庫済み数・合計）を返す。削除可否の判定に使う |
| `addProduct(data)` | 商品コード・製品名を検証（重複チェックを含む）して商品マスタを登録 |
| `updateProduct(id, data)` | 商品マスタを更新する |
| `deleteProduct(id)` | 未使用の商品だけ削除する |
| `findOrCreateProduct(code, name, category)` | 商品コードから商品を探し、無ければ自動登録する（入庫の自由入力用） |
| `listInStock(filter)` / `listFilterInStock(filter)` | 在庫中の通常品／フィルター品を返す |
| `groupInStock(filter)` | 通常品を商品単位でまとめ、`count`（在庫数量の合計）を付けて返す |
| `getItem(id)` / `getItems(ids)` | 在庫の取得（商品マスタと合成した表示用オブジェクト） |
| `addItem(data)` | 通常品を入庫登録する（商品コード自由入力・数量・受注番号・入庫した人を検証） |
| `addFilterItem(data)` | フィルター品を入庫登録する（商品選択・製造番号・入荷日付・案件番号を検証） |
| `ship(itemIds, info)` | 選択した行を出庫する（出庫した人・受注先・エンドユーザーを検証） |
| `listShipments(filter, stockType)` / `listFilterShipments(filter)` | 履歴を商品情報と結合し、出庫日時の降順で返す |
| `cancelShipment(id)` | 出庫をキャンセルし、商品を在庫に戻す |
| `isSeeded()` / `replaceAll()` | デモデータの管理 |

バリデーションは `store.js` に集約している（画面側では二重に持たない）。
`PRODUCT_FIELDS` / `SHIPMENT_FIELDS` に必須項目とラベルを定義し、エラーメッセージにも使う
（通常品の入庫・フィルター品の入庫はそれぞれ項目が異なるため、`addItem` / `addFilterItem` 内で個別に検証する）。

## 画面

| 画面 | 主な操作 |
| --- | --- |
| 在庫一覧 | 検索、明細/商品まとめの切替、行の選択、コピー、選択した商品を出庫へ（起動時に最初に表示） |
| 入庫 | 商品コード・製品名の選択/自由入力、数量・受注番号・入庫した人・入荷日・備考の入力、コピー登録 |
| 出庫 | 対象商品の確認・除外、出庫情報の入力、出庫 |
| 出庫履歴 | 状態・キーワードでの絞り込み、キャンセル |
| 商品管理 | 商品マスタ（商品コード・製品名）の登録・編集・削除、使用状況の確認 |
| フィルター入庫 | フィルター商品の選択、製造番号・入荷日付・案件番号の入力、バーコード読み取り |
| フィルター出庫 | フィルター在庫の選択と出庫フォームを1画面に統合 |
| フィルター出庫履歴 | フィルター品の出庫実績の一覧・キャンセル |
| フィルター商品管理 | フィルター品の商品マスタの登録・編集・削除 |

### 出庫ボタンの制御

`shipping.js`（フィルター出庫は `filter-shipping.js`）の `updateSubmitState()` が入力のたびに走り、

- 必須3項目（出庫した人・受注先・エンドユーザー）のいずれかが空、または対象商品が0個 → ボタンを `disabled`
- 未入力があるときは「未入力：出庫した人、受注先」のように項目名を表示
- 入力欄から離れた時点で、その項目が空ならエラーを表示

### 入庫画面：商品コード・製品名の自由入力

`inbound.js` の `refreshProducts()` が商品マスタの登録・更新・削除に追従して `<datalist>` の候補を作り直す。
商品コード欄の `change` イベントで `syncProductName()` が一致する商品の製品名を自動補完する（上書き修正可）。
一致する商品コードが無い状態で送信すると、`store.js` の `addItem()` が `findOrCreateProduct()` で新しい商品を自動登録する。

### フィルター入庫：商品プルダウン

`filter-inbound.js` の `refreshProducts()` が `App.store.listProducts('filter')` を選択肢にする
（フィルター商品管理の登録・更新・削除に追従）。製造番号欄にはバーコード読み取りボタンがあり、
`inbound.js` と同じ `App.scanner.open()` を使う。

### フィルター出庫：1画面での在庫選択

在庫一覧に相当する専用タブが無いため、`filter-shipping.js` はフィルター在庫の一覧（チェックボックス選択）と
出庫フォームを1画面にまとめている。選択状態は画面内のモジュール変数で保持し、出庫完了後にクリアする。

### コピー登録

`inbound.js` の `startCopy()` が、在庫一覧の「コピー」から商品コード・製品名・数量・受注番号・入荷日・備考を
入庫フォームへそのまま引き継ぐ。

## デモデータ

`src/js/seed.js`。初回起動時と「デモデータを初期状態に戻す」操作のときだけ投入する。

| 種別 | 商品コード | 製品名 | 在庫 |
| --- | --- | --- | --- |
| 通常品 | ABC-100 | アングルブラケット ABC-100 | 受注番号 PJ-2026-001、数量10（別途2個出庫済み） |
| 通常品 | DEF-200 | フランジ DEF-200 | 受注番号 PJ-2026-004、数量5 |
| 通常品 | GH-3000 | ステー GH-3000 | 受注番号 PJ-2026-002、数量3（うち1個は出庫後キャンセルで在庫に戻っている） |
| 通常品 | XYZ-500 | カバー XYZ-500 | 在庫・履歴とも未使用（商品削除機能の確認用） |
| フィルター品 | F-100 | エアフィルター F-100 | 製造番号 FS-0001（出庫済み） |
| フィルター品 | F-200 | オイルフィルター F-200 | 製造番号 FS-0002（在庫中、入荷日未確定） |

出庫履歴には通常品「出庫済み1件」「キャンセル1件」、フィルター品「出庫済み1件」が入っている。

## 本実装に進む場合の申し送り

- **製造番号のバーコード読み取り**：`BarcodeDetector` API と `getUserMedia` で実装済み（フィルター入庫）。`BarcodeDetector` が使えない環境（Windows/Mac の Chrome など）では `src/js/vendor/zxing.min.js`（[zxing-js](https://github.com/zxing-js/library)、Apache-2.0）にフォールバックする。**スマートフォン実機・各種ブラウザでの読み取り精度は本実装時に改めて検証する**。
- **商品コード・製品名のQR・写真読み取り**：QRに何がどの形式で入っているかを実物で確認してから設計する。本モックでは引き続きスコープ外。カメラを使うため、スマートフォンのブラウザから開ける Web アプリ構成が前提になる。
- **データの共有**：localStorage は端末ごとに独立している。複数人で使うにはサーバー＋DBが必要。
- **同時実行**：本実装では、同じ在庫を2人が同時に出庫しないよう排他制御を検討する。
- **部分出庫**：本モックでは行（ロット）単位の出庫のみ対応。数量の一部だけを出庫するニーズがあれば、
  在庫数量の消費管理（出庫のたびに残数を計算する等）を本実装時に設計する。
- **担当者名**：現状は自由入力。表記ゆれが問題になるなら候補リストからの選択を検討する。
