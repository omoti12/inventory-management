# 設計メモ

最終更新: 2026-08-26

このドキュメントは「どう作ったか」を記録する。何を作るかは [requirements.md](requirements.md)、
動かし方は [../README.md](../README.md) を参照。

## 方針

業務フローと画面を検証する試作として始まり、現在は実際の在庫管理業務で使われている本番システム。
複数人での同時利用に耐える必要が出てきたため、**データの保存先を Microsoft 365 の SharePoint
リストに切り替えた**。見た目・操作感・ビルド構成（サーバー・DB・ビルドツール無し、HTML / CSS /
素の JavaScript のみ）は試作段階から変えていない。

- ES Modules は `file://` で動かないため、classic script ＋ グローバル名前空間 `App` を使う。
- 外部 CDN・Web フォント・画像を使わず、`src/js/vendor/` に取り込んだライブラリ（バーコード読み取り・
  MSAL）以外は実行時に外部へアクセスしない。
- 見た目はモダン（白基調・アクセント1色・余白多め・薄い影）。
- バーコード読み取り（カメラ）を使う場合のみ、`https`、または `http://localhost` などの**セキュアなコンテキスト**が必要。
  スマートフォンから「パソコンのIPアドレスに `http://` でアクセス」する構成ではカメラを使えない（ブラウザがブロックする）。
  `scanner.js` の `describeError()` がこの場合に理由を案内する。スマートフォンでカメラを使いたい場合は
  `scripts/start.sh` の代わりに `scripts/start-https.sh` を使う（自己署名証明書でHTTPS配信する。詳細は後述）。
- 通常品とフィルター品は、商品マスタ・在庫ともに `category` / `stockType` で分離した別ラインとして扱う。
- **データはMicrosoft 365アカウントでのサインインが必須**。サインインしていない状態では
  在庫データに一切アクセスできない（`#signin-gate`）。

## SharePoint / Microsoft Graph バックエンド

商品マスタ(Products)・在庫(Items)・出庫履歴(Shipments)の3つは、すべて Microsoft Graph API
経由でSharePointリストに保存する。アプリ自身はサーバーを持たず、ブラウザから直接Graph APIを
呼ぶ（SPA + PKCE構成）。ローカルには一切データを保存しない（MSALのトークンキャッシュを除く）。

- **サインイン**: `src/js/auth.js`（`App.auth`）が MSAL Browser（`src/js/vendor/msal-browser.min.js`）
  でEntra ID（Azure AD）にサインインする。`loginRedirect` 方式。MSAL v3は `initialize()` の完了を
  待たずに他のAPIを呼ぶとエラーになるため、`ready()` で毎回ラップしている。
- **Graph呼び出し**: `src/js/graph-client.js`（`App.graph`）が全リスト共通のfetchラッパー
  （認証ヘッダー付与・ページング・ETag対応）を提供する。`App.store` はこれ経由でのみSharePointに触れる。
- **サイト参照**: `nittoairtech.sharepoint.com:/sites/p:` というパスベース参照を使い、事前のサイトID取得を省略している。
- **リストの参照方法（要注意）**: Productsリストは表示名 `Products` でそのまま名前解決できたが、
  ItemsとShipmentsリストは表示名では見つからず（原因不明、SharePoint側の内部名が表示名と一致していない
  可能性）、`graph-client.js` の `LIST_IDS` でリストのGUIDを直接指定している。
  新しいリストをGraph経由で追加する場合は、まず表示名で `listItems()` を試し、
  `No resource was found matching this query` になったら、SharePointの「リストの設定」ページ
  （`listedit.aspx?List={GUID}`）でGUIDを確認して `LIST_IDS` に追加する。
- **列の内部名とのズレ（要注意）**: SharePointの列の「内部名」は表示名と異なる場合がある
  （実例: Productsリストの「ProductCode」列は、実際の内部名が `ProductsCode` だった）。
  列を新設・変更したときは、その列を右クリック→リンクをコピーして得られる
  `FldEdit.aspx?List={GUID}&Field=内部名` のURLで実際の内部名を確認してから
  `store.js` の `xxxToFields` / `xxxFromGraphItem` を書くこと。
- **複数人同時アクセスへの排他制御**: `App.graph.updateWithRetry(listName, itemId, mutateFn)` が
  ETag（`If-Match`）付きPATCHを使い、他の人が先に書き込んでいた場合（412）は最新状態を取り直して
  `mutateFn` に再判定させる。`store.js` の `ship()` / `cancelShipment()` はこれを使って在庫(Items)の
  状態を更新しており、`mutateFn` が既に目的の状態になっていることを検知したら `null` を返して
  書き込みをスキップする（＝他の担当者が先に出庫済みなら、上書きせず対象から除外する）。

## ファイル構成

```
src/index.html            9画面ぶんの section とタブナビ
src/css/style.css         デザイントークン（CSS変数）＋レイアウト＋コンポーネント
src/js/auth.js            Microsoft 365サインイン（MSAL Browser）とトークン取得
src/js/graph-client.js    Microsoft Graph API共通ヘルパー（ページング・ETag対応）
src/js/store.js           データモデル（商品マスタ／在庫／出庫）/ Graph経由でのSharePoint永続化 / 検索・集計・バリデーション
src/js/ui.js              タブ切替・テーブル生成・トースト・確認ダイアログ・表示整形・CSV読み込み
src/js/inventory.js       在庫一覧（通常品、明細 / 商品まとめ）＋検索＋選択
src/js/products.js        商品管理（通常品の商品マスタの登録・編集・削除）
src/js/inbound.js         入庫（通常品、商品コード/製品名の自由入力＋数量・入庫した人など）
src/js/scanner.js         バーコード読み取り（カメラ。BarcodeDetector API、無ければ vendor/zxing.min.js にフォールバック）
src/js/vendor/            CDNを使わず取り込んだ外部ライブラリ（zxing.min.js、msal-browser.min.js。詳細は vendor/README.md）
src/js/shipping.js        出庫（通常品、必須項目チェック）
src/js/history.js         出庫履歴（通常品）・キャンセル
src/js/filter-products.js フィルター商品管理（フィルター品の商品マスタの登録・編集・削除）
src/js/filter-inbound.js  フィルター入庫（フィルター品、製造番号・入荷日付）
src/js/filter-shipping.js フィルター出庫（在庫の選択＋出庫フォームを1画面に統合）
src/js/filter-history.js  フィルター出庫履歴・キャンセル
src/js/app.js             起動処理（サインイン確認 → データ読み込み → 各画面初期化）
```

読み込み順は
`msal-browser → auth → graph-client → store → ui → inventory → products → filter-products → scanner → inbound → filter-inbound → shipping → filter-shipping → history → filter-history → app`。
`src/js/scanner.js` は `inbound.js` より前に読み込む。`src/js/app.js` が `DOMContentLoaded` で初期化し、
サインイン済みアカウントがあれば `App.store.load()`（Graphからの読み込み、非同期）を待ってから各画面を初期化する。

## データモデル

商品マスタ・在庫・出庫履歴は、それぞれSharePointの Products / Items / Shipments リストの1行に対応する。
`id` はSharePointのリストアイテムID（整数の文字列）。`store.js` はGraphから読み込んだリストアイテムを
以下のアプリ内形状に変換して、起動時にメモリ上へキャッシュする（読み取り関数は同期のまま、
書き込み関数はGraphへの通信を待つためPromiseを返す）。

```js
// 商品マスタ（商品コードは種別内で一意）
product = {
  id, productCode, productName,
  category,              // 'normal' | 'filter'
  storageLocation,       // 通常品のみ。'第一工場' | '本社在庫' | ''（任意項目、フィルター品には無い）
  createdAt
}

// 在庫（通常品）：数量のバッチ単位（受注番号のような伝票番号は持たない）
item = {
  id, productId,
  quantity,               // 入庫数量（1以上）
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
  stockType: 'filter',
  status,                  // 'in_stock' | 'shipped'
  registeredAt
}

// 出庫（履歴の実体。通常品・フィルター品で共通の形）
shipment = {
  id, itemId,
  shippedBy, orderTo, endUser,
  /* 会計/販売システムへのCSV取込用の項目（通常品のみ、すべて任意入力）。
     出荷先コード・小番、出荷先名1/2、受注番号1〜3。 */
  destinationCode, destinationSubCode, destinationName1, destinationName2,
  orderNumber1, orderNumber2, orderNumber3,
  shippedAt,
  status,                  // 'shipped' | 'cancelled'
  cancelledAt
}
```

同じ `items` 配列に通常品・フィルター品を混在させ、`stockType` で扱う項目が異なる
（数量・入庫した人・備考 vs 製造番号）。`store.js` の `decorate()` は
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

### 商品マスタの削除

`deleteProduct()` は、在庫・履歴から参照されている商品でも削除できる
（誤って登録・使用してしまった商品を消せるようにするため、意図的に制約を設けていない）。
使用中の商品を削除すると、その商品を参照していた在庫・出庫履歴の行は `decorate()` により
`productCode` が `(削除済み商品)` として表示される（データが壊れるわけではなく、表示上の扱い）。
呼び出し側（`products.js` / `filter-products.js`）は `productUsage()` で使用状況を確認し、
使用中の場合は削除前にその旨を警告する確認ダイアログを出す。

### CSVからの一括登録

`ui.js` の `parseCsvFile(file)` が共通実装。UTF-8（BOM有無どちらも）と、Windows版Excelの
既定であるShift_JIS（CP932）の両方に対応するため、まずUTF-8として厳密デコードを試み
（`TextDecoder('utf-8', {fatal: true})`）、不正なバイト列で失敗したらShift_JISとして
読み直す簡易判定を使っている。CSVの引用符（`"..."`・`""`エスケープ）にも対応した簡易パーサーを
自前で実装しており、外部ライブラリは追加していない。

`products.js` / `filter-products.js` の `importRows()` が、パースした行を1行ずつ順番に
`addProduct()` へ渡して登録する（並行実行すると重複チェックが最新の登録状況を見られないため、
あえて直列にしている）。重複エラーかどうかは、`store.js` の `validateProduct()` が付与する
`errors._duplicate`（表示用フィールドではない、判定専用のフラグ）で判定する。

### 出庫履歴のCSV出力

`ui.js` の `downloadCsv(filename, rows)` が共通実装。`rows`（1行目はヘッダー）からCSV文字列を組み立て、
先頭にUTF-8のBOMを付けたBlobを`<a download>`経由でダウンロードさせる（BOM無しだとExcelでダブル
クリックで開いたときに文字化けするため）。`history.js` / `filter-history.js` の `onExportCsv()` が、
その時点の絞り込み条件・並び順のまま `listShipments()` / `listFilterShipments()` を呼び直して
CSV化する（画面に描画済みのDOMを読み取るのではなく、データ取得からやり直す方式）。

出庫履歴（通常品側）には、社内の会計/販売システムの出荷CSV取込機能にそのまま読み込ませる形式の
「外部システム用CSV」ボタンも別にある（`history.js`の`onExportExternalCsv()`）。列の順序
（出荷日・出荷先コード・出荷先小番・出荷先名1・出荷先名2・受注番号1〜3・商品コード・
フリー在庫分数量）は先方の取込画面の項目順に合わせている。日付は「YYYY/M/D」形式（0埋めしない）
で、`formatDateTime()`とは別の`formatExternalDate()`を使う（先方システムの実例CSVがこの形式
だったため）。フリー在庫分数量には出庫した数量（`quantity`）をそのまま入れている。

### SharePoint列の内部名マッピング

`store.js` の `xxxToFields` / `xxxFromGraphItem` が、アプリ内の項目名とSharePointの列の内部名を変換する。

| リスト | アプリ内の項目 | 列の内部名 |
| --- | --- | --- |
| Products | productCode | **ProductsCode**（表示名は「ProductCode」だが内部名はズレている） |
| Products | productName / category / storageLocation / createdAt | ProductName / Category / StorageLocation / CreatedAt（すべて表示名と一致） |
| Items | productId / quantity / serialNo / orderNo / arrivalDate / receivedBy / remarks / stockType / status / registeredAt | ProductId / Quantity / SerialNo / OrderNo / ArrivalDate / ReceivedBy / Remarks / StockType / Status / RegisteredAt（すべて表示名と一致） |
| Shipments | itemId / shippedBy / orderTo / endUser / remarks / shippedAt / status / cancelledAt | ItemId / ShippedBy / OrderTo / EndUser / Remarks / ShippedAt / Status / CancelledAt（すべて表示名と一致） |
| Shipments | destinationCode / destinationSubCode / destinationName1 / destinationName2 / orderNumber1〜3 | DestinationCode / DestinationSubCode / DestinationName1 / DestinationName2 / OrderNumber1〜3（すべて表示名と一致） |

## store.js の公開関数

画面側は必ずこのモジュール経由でデータを読み書きする。書き込み系はSharePointへの通信を伴うため
すべて **Promise を返す**（`.then()` で結果を受け取る）。読み取り系は起動時に読み込んだメモリ上の
キャッシュを参照するため同期のまま。

| 関数 | 役割 | 同期/Promise |
| --- | --- | --- |
| `load()` | Products/Items/ShipmentsをすべてSharePointから読み込む | Promise |
| `listProducts(category)` | 商品マスタを商品コード順で返す。`category`（'normal'/'filter'）で絞り込み可 | 同期 |
| `getProduct(id)` / `getProductByCode(code, category)` | 商品マスタ1件を取得 | 同期 |
| `productUsage(id)` | 指定した商品の使用状況（在庫数・出庫済み数・合計）を返す。削除前の警告表示に使う | 同期 |
| `addProduct(data)` | 商品コード・製品名を検証（重複チェックを含む）して商品マスタを登録 | Promise |
| `updateProduct(id, data)` | 商品マスタを更新する | Promise |
| `deleteProduct(id)` | 商品マスタを削除する（使用中でも削除できる） | Promise |
| `findOrCreateProduct(code, name, category)` | 商品コードから商品を探し、無ければ自動登録する（入庫の自由入力用） | Promise |
| `listInStock(filter)` / `listFilterInStock(filter)` | 在庫中の通常品／フィルター品を返す | 同期 |
| `groupInStock(filter)` | 通常品を商品単位でまとめ、`count`（在庫数量の合計）を付けて返す | 同期 |
| `getItem(id)` / `getItems(ids)` | 在庫の取得（商品マスタと合成した表示用オブジェクト） | 同期 |
| `allocateForShipment(productId, quantity)` | 古いバッチ順に数量を確保する。バッチ分割が必要なら在庫を分けてSharePointに書き込む | Promise |
| `addItem(data)` | 通常品を入庫登録する（商品コード自由入力・数量・入庫した人を検証） | Promise |
| `addFilterItem(data)` | フィルター品を入庫登録する（商品選択・製造番号・入荷日付を検証） | Promise |
| `ship(itemIds, info)` | 選択した行を出庫する（出庫した人・受注先・エンドユーザーを検証）。ETag付きで在庫状態を更新し、他の担当者が先に出庫していた分は対象から除外する | Promise |
| `listShipments(filter, stockType, sortOrder)` / `listFilterShipments(filter, sortOrder)` | 履歴を商品情報と結合して返す。`sortOrder` は `'asc'`/`'desc'`（省略時は`'desc'`＝出庫日時が新しい順） | 同期 |
| `cancelShipment(id)` | 出庫をキャンセルし、商品を在庫に戻す | Promise |

バリデーションは `store.js` に集約している（画面側では二重に持たない）。
`PRODUCT_FIELDS` / `SHIPMENT_FIELDS` に必須項目とラベルを定義し、エラーメッセージにも使う
（通常品の入庫・フィルター品の入庫はそれぞれ項目が異なるため、`addItem` / `addFilterItem` 内で個別に検証する）。

## 画面

| 画面 | 主な操作 |
| --- | --- |
| 在庫一覧 | 検索、商品まとめ/明細の切替、行の選択、コピー（明細のみ）、選択した商品を出庫へ（起動時は商品まとめを表示） |
| 入庫 | 商品コード・製品名の選択/自由入力、数量・入庫した人・入荷日・備考の入力、コピー登録 |
| 出庫 | 対象商品の確認・除外、出庫情報の入力、出庫 |
| 出庫履歴 | 状態・キーワードでの絞り込み、キャンセル |
| 商品管理 | 商品マスタ（商品コード・製品名）の登録・編集・削除、使用状況の確認 |
| フィルター入庫 | フィルター商品の選択、製造番号・入荷日付の入力、バーコード読み取り |
| フィルター出庫 | フィルター在庫の選択と出庫フォームを1画面に統合 |
| フィルター出庫履歴 | フィルター品の出庫実績の一覧・キャンセル |
| フィルター商品管理 | フィルター品の商品マスタの登録・編集・削除 |

### 出庫ボタンの制御

`shipping.js`（フィルター出庫は `filter-shipping.js`）の `updateSubmitState()` が入力のたびに走り、

- 必須3項目（出庫した人・受注先・エンドユーザー）のいずれかが空、または対象商品が0個 → ボタンを `disabled`
- 未入力があるときは「未入力：出庫した人、受注先」のように項目名を表示
- 入力欄から離れた時点で、その項目が空ならエラーを表示

### 出庫画面：会計/販売システム連携用の項目

社内で使っている会計/販売システム（別製品）のCSV取込機能に出庫実績を取り込めるようにするため、
出庫画面に出荷先コード・小番、出荷先名1/2、受注番号1〜3を追加した（通常品の出庫のみ。フィルター
出庫には無い）。すべて任意入力の自由記述で、候補一覧からの入力補完や、出荷先コード⇔名前の
自動連携はまだ無い（出荷先の一覧をどう管理するかが未確定のため、いったん自由入力のみで導入した）。
将来的に出荷先マスタが用意できたら、入力補完・自動連携を追加する想定。受注番号1〜3・出荷先コード・
小番は、`shipping.js`で「-」区切りの複数枠（`.split-field`）として入力する見た目にしている。

出庫日（`shippedAt`）も任意入力にした（通常品・フィルター品どちらも）。`<input type="date">`で
日付だけ選ばせ、`App.ui.combineDateWithNow()`でその日付＋今の時刻を組み合わせてISO日時にする
（時刻までは入力させない）。未指定なら`store.js`の`ship()`が今の日時をそのまま使う。

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

`inbound.js` の `startCopy()` が、在庫一覧の「コピー」から商品コード・製品名・数量・入荷日・備考を
入庫フォームへそのまま引き継ぐ。

## 今後の申し送り

- **バーコード読み取り**：`BarcodeDetector` API と `getUserMedia` で実装済み（フィルター在庫一覧・フィルター入庫の製造番号）。1Dバーコード各種とQRコードの両方を対象とする。`BarcodeDetector` が使えない環境（Windows/Mac の Chrome など）では `src/js/vendor/zxing.min.js`（[zxing-js](https://github.com/zxing-js/library)、Apache-2.0）にフォールバックする。誤読対策として同じ値が連続で読めたときだけ確定し、ネイティブ検出が機能しない端末では自動でZXingに切り替える。
  長いバーコードは1本あたりのバーが細く、映像全体を解析対象にすると解像度が背景にも割かれて読み取りにくかったため、
  `scanner.js` の `captureGuideCanvas()` が画面のガイド枠（`.scanner__guide`）と同じ範囲だけを毎フレームcanvasに
  切り出し、ネイティブ・ZXingどちらの検出にもその枠内だけを渡すようにしている（`computeGuideRect()` が
  `object-fit: cover` によるクロップ量を考慮して、表示上の枠とズレないよう変換する）。ZXing側もこのため、
  映像全体を扱う高レベルAPI（`decodeFromStream`）ではなく、canvas単位で1フレームずつ渡せる低レベルAPI
  （`MultiFormatReader` + `HTMLCanvasElementLuminanceSource`）に切り替えている。
  読み取り画面の状態表示（試行回数・検出方式など）は`renderStatus()`が毎回の検出試行ごとに更新するため、
  実機で「本当に動いているか」を切り分けたいときはそこを見る。
- **スマートフォンからのカメラ利用**：`getUserMedia` は `https`、または `http://localhost`（端末自身）でしか動かない。
  パソコンで起動したサーバーにスマートフォンから `http://（パソコンのIPアドレス）` でアクセスする構成では、
  ブラウザの仕様としてカメラを一切使わせないため、コード側での回避はできない。
  `scripts/start-https.sh`（内部で `scripts/https_server.py` を呼ぶ）が自己署名証明書を自動生成し、
  `https://（パソコンのIPアドレス）:8443` でスマートフォンからも同じWi-Fi内でアクセスできるようにしている。
  自己署名証明書のため初回アクセス時にブラウザの警告が出るが、進めば以降は使える。
  なお、本番運用では GitHub Pages（`https://omoti12.github.io/inventory-management/src/index.html`）で
  常時HTTPS配信しているため、社内Wi-Fi内に限らずどこからでもカメラを含めて利用できる。
- **商品コード・製品名のQR・写真読み取り**：QRに何がどの形式で入っているかを実物で確認してから設計する。現状はスコープ外。
- **データの共有・同時実行**：SharePoint / Microsoft Graph バックエンドへの移行により対応済み。
  詳細は上記の「SharePoint / Microsoft Graph バックエンド」を参照。
- **部分出庫**：対応済み。`shipping.js` の在庫検索から出荷したい数量を指定すると、
  `store.js` の `allocateForShipment()` が古いバッチから必要数だけ確保し、端数が出る場合は
  バッチを分割してSharePointに書き込む。
- **担当者名**：現状は自由入力。表記ゆれが問題になるなら候補リストからの選択を検討する。
