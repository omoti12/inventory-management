# 設計メモ（モック）

最終更新: 2026-08-07

要件は [requirements.md](requirements.md) を参照。ここではモックの作りを記録する。

## 方針

業務フローと画面を検証するためのモック。サーバー・DB・ビルドツールを使わず、
HTML / CSS / 素の JavaScript のみで構成し、データはブラウザの `localStorage` に保存する。

- ES Modules は `file://` で動かないため、classic script ＋ グローバル名前空間 `App` を使う。
  `index.html` をそのままダブルクリックしても動作する。
- 外部 CDN・Web フォント・画像を使わず、オフラインで開ける。
- 見た目はモダン（白基調・アクセント1色・余白多め・薄い影）。
- 製造番号のバーコード読み取り（カメラ）を使う場合のみ、`http://localhost` などのセキュアなコンテキストが必要。

## ファイル構成

```
index.html          5画面ぶんの section とタブナビ
css/style.css       デザイントークン（CSS変数）＋レイアウト＋コンポーネント
js/store.js         データモデル（商品マスタ／個体／出荷）/ localStorage 永続化 / 検索・集計・バリデーション・旧データ移行
js/seed.js          デモ用初期データ（商品マスタ＋在庫＋出荷履歴）
js/ui.js            タブ切替・テーブル生成・トースト・確認ダイアログ・表示整形
js/inventory.js     在庫一覧（明細 / 型名まとめ）＋検索＋選択
js/products.js      商品管理（商品マスタの登録・編集・削除）
js/inbound.js       入庫（型名選択・コピー登録・連続登録）※旧 js/register.js
js/scanner.js       製造番号のバーコード読み取り（カメラ、BarcodeDetector API）
js/shipping.js      出荷（必須項目チェック）
js/history.js       出荷履歴・キャンセル
js/app.js           起動処理
```

読み込み順は `store → seed → ui → inventory → products → inbound → shipping → history → app`。
`js/scanner.js` は `js/inbound.js` より前に読み込む。`app.js` が `DOMContentLoaded` で初期化する。

## データモデル

localStorage キー：`inv.products` / `inv.items` / `inv.shipments` / `inv.seeded`

```js
// 商品マスタ（型名は一意。寸法・図番は型名に1対1で紐づく）
product = {
  id, modelName, dimensions, drawingNo, createdAt
}

// 個体（1レコード = 製造番号1個 = 在庫1個。型名・寸法・図番は持たず productId で商品マスタを参照する）
item = {
  id, productId, serialNo,
  arrivalMonth,          // "YYYY-MM"
  projectNo,
  status,                // 'in_stock' | 'shipped'
  registeredAt
}

// 出荷（履歴の実体）
shipment = {
  id, itemId,
  shippedBy, destination, addressee, projectNo,
  shippedAt,
  status,                // 'shipped' | 'cancelled'
  cancelledAt
}
```

画面に渡す行は `store.js` の `decorate()` が item に商品マスタの `modelName` / `dimensions` / `drawingNo` を合成して作る。
商品マスタを削除できるのは未使用のときだけなので通常は起きないが、参照先の商品が見つからない場合は `modelName` に `(削除済み商品)` と表示する。

### 状態遷移

```
入庫 → item.status = 'in_stock'（在庫一覧に表示）
出荷 → item.status = 'shipped'  ＋ shipment を作成（status='shipped'）
キャンセル → shipment.status = 'cancelled' ＋ item.status = 'in_stock' に戻す
```

出荷履歴は削除しない。キャンセルしても行は残り、状態表示だけが変わる。

商品マスタは在庫・履歴から参照されている間は削除できない（`productUsage()` で使用数を数え、0件のときだけ `deleteProduct()` が成功する）。

### 旧データの移行

`store.js` の `migrateLegacyItems()` が `load()` のたびに実行される。
`item.productId` を持たない旧形式（型名・寸法・図番を item が直接持っていた）のデータを見つけると、
型名ごとに商品マスタを1件起こし（同じ型名が既にあれば流用、なければ新規作成）、item 側の型名・寸法・図番を削除して `productId` を持たせる。
変更があった場合のみ保存する。利用者側の操作は不要。

## store.js の公開関数

画面側は必ずこのモジュール経由でデータを読み書きする。

| 関数 | 役割 |
| --- | --- |
| `load()` | localStorage から読み込み、旧データの移行（`migrateLegacyItems`）を行う |
| `listProducts()` | 商品マスタを型名順で返す |
| `getProduct(id)` | 商品マスタ1件を取得 |
| `productUsage(id)` | 指定した商品の使用状況（在庫数・出荷済み数・合計）を返す。削除可否の判定に使う |
| `addProduct(data)` | 型名・寸法・図番を検証（型名の重複チェックを含む）して商品マスタを登録。`{ok, product}` または `{ok:false, errors}` |
| `updateProduct(id, data)` | 商品マスタを更新する。在庫・履歴の表示にもそのまま反映される |
| `deleteProduct(id)` | 未使用の商品だけ削除する。使用中は `{ok:false, message}` |
| `listInStock(filter)` | 在庫中の明細を返す（型名/図番/製造番号/案件番号は部分一致、入荷月は完全一致） |
| `groupInStock(filter)` | 商品（型名＋寸法＋図番）単位でまとめ、`count`（在庫数）を付けて返す |
| `getItem(id)` / `getItems(ids)` | 個体の取得（商品マスタと合成した表示用オブジェクト） |
| `addItem(data)` | 型名の選択と必須3項目、製造番号の重複を検証して入庫登録。`{ok, item}` または `{ok:false, errors}` |
| `ship(itemIds, info)` | 必須3項目を検証して出荷。`{ok, count}` または `{ok:false, errors}` |
| `listShipments(filter)` | 履歴を商品情報と結合し、出荷日時の降順で返す |
| `cancelShipment(id)` | 出荷をキャンセルし、商品を在庫に戻す |
| `isSeeded()` / `replaceAll()` | デモデータの管理 |

バリデーションは `store.js` に集約している（画面側では二重に持たない）。
`PRODUCT_FIELDS` / `ITEM_FIELDS` / `SHIPMENT_FIELDS` に必須項目とラベルを定義し、エラーメッセージにも使う。

## 画面

| 画面 | 主な操作 |
| --- | --- |
| 在庫一覧 | 検索、明細/型名まとめの切替、行の選択、コピー、選択した商品を出荷へ |
| 入庫 | 型名の選択（寸法・図番は自動表示・読み取り専用）、製造番号・入荷月・案件番号の入力、コピー登録、連続登録モード |
| 出荷 | 対象商品の確認・除外、出荷情報の入力、出荷 |
| 出荷履歴 | 状態・キーワードでの絞り込み、キャンセル |
| 商品管理 | 商品マスタの登録・編集・削除、使用状況（在庫数・出荷済み数）の確認 |

### 出荷ボタンの制御

`shipping.js` の `updateSubmitState()` が入力のたびに走り、

- 必須3項目（出荷した人・出荷先・案件番号）のいずれかが空、または対象商品が0個 → ボタンを `disabled`
- 未入力があるときは「未入力：出荷した人、出荷先」のように項目名を表示
- 入力欄から離れた時点で、その項目が空ならエラーを表示

### 入庫画面：型名プルダウンと自動表示

`inbound.js` の `refreshProducts()` が商品マスタの登録・更新・削除に追従してプルダウンを作り直す。
商品が0件のときは警告表示・プルダウン・登録ボタンを無効化する。
型名を選ぶと `syncProductFields()` が寸法・図番の読み取り専用欄に値を反映する（編集不可）。

### コピー登録の連番

`inbound.js` の `nextSerial()` が末尾の数字を1つ進める。桁数は維持する。

| 元 | 次 |
| --- | --- |
| `0001` | `0002` |
| `S-003` | `S-004` |
| `0099` | `0100` |
| 末尾が数字でない | 空文字（手入力してもらう） |

### 商品管理：削除ボタンの制御

`products.js` の `render()` が `App.store.productUsage(id)` を見て、使用数（`total`）が1以上なら削除ボタンを `disabled` にし、
`title` 属性に「在庫 N 個・出荷済み M 個で使われているため削除できません」を設定する。
商品マスタの登録・更新・削除のたびに `App.inbound.refreshProducts()` を呼び、入庫画面のプルダウンを同期させる。

## デモデータ

`js/seed.js`。初回起動時と「デモデータを初期状態に戻す」操作のときだけ投入する。

| 型名 | 寸法 | 図番 | 入荷月 | 案件番号 | 個体数 |
| --- | --- | --- | --- | --- | --- |
| ABC-100 | 100×200 | A-001 | 2026-06 | PJ-2026-001 | 12個登録（うち2個出荷済み、在庫10個） |
| DEF-200 | 150×300 | B-014 | 2026-07 | PJ-2026-004 | 5個（在庫5個） |
| GH-3000 | 80×80 | C-220 | 2026-05 | PJ-2026-002 | 3個（在庫3個。うち1個は出荷後キャンセルで在庫に戻っている） |
| XYZ-500 | 60×120 | D-330 | - | - | 0個（在庫・履歴とも未使用。商品削除機能の確認用） |

出荷履歴には「出荷済み2件」「キャンセル1件」が入っている。

## 本実装に進む場合の申し送り

- **製造番号のバーコード読み取り**：`BarcodeDetector` API と `getUserMedia` で実装済み。macOS の Chrome では実バーコードの読み取りを確認済みだが、**スマートフォン実機での読み取り精度・対応形式は本実装時に改めて検証する**（`BarcodeDetector` は Windows / Linux の Chrome では利用できないため、その環境では手入力にフォールバックする）。
- **型名・寸法・図番のQR・写真読み取り**：QRに何がどの形式で入っているかを実物で確認してから設計する。本モックでは引き続きスコープ外。カメラを使うため、スマートフォンのブラウザから開ける Web アプリ構成が前提になる。
- **データの共有**：localStorage は端末ごとに独立している。複数人で使うにはサーバー＋DBが必要。
- **同時実行**：本実装では、同じ商品を2人が同時に出荷しないよう排他制御を検討する。
- **担当者名**：現状は自由入力。表記ゆれが問題になるなら候補リストからの選択を検討する。
