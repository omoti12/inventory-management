/* モック用のデモデータ。初回起動時と「初期状態に戻す」操作のときだけ投入する。
   すべての画面に何かしらデータが表示されるよう、通常品・フィルター品それぞれで
   在庫・出庫済み・キャンセル済みの状態を用意している。 */
window.App = window.App || {};

App.seed = (function () {
  'use strict';

  var PRODUCTS = [
    { id: 'seed-prod-1', productCode: 'ABC-100', productName: 'アングルブラケット ABC-100', category: 'normal' },
    { id: 'seed-prod-2', productCode: 'DEF-200', productName: 'フランジ DEF-200', category: 'normal' },
    { id: 'seed-prod-3', productCode: 'GH-3000', productName: 'ステー GH-3000', category: 'normal' },
    { id: 'seed-prod-4', productCode: 'JKL-450', productName: 'プレート JKL-450', category: 'normal' },
    /* 在庫も履歴もないので削除できる商品（削除機能の確認用） */
    { id: 'seed-prod-5', productCode: 'XYZ-500', productName: 'カバー XYZ-500', category: 'normal' },

    { id: 'seed-fprod-1', productCode: 'F-100', productName: 'エアフィルター F-100', category: 'filter' },
    { id: 'seed-fprod-2', productCode: 'F-200', productName: 'オイルフィルター F-200', category: 'filter' },
    { id: 'seed-fprod-3', productCode: 'F-300', productName: '燃料フィルター F-300', category: 'filter' }
  ];

  var STOCKS = [
    { productId: 'seed-prod-1', arrivalDate: '2026-06-10', receivedBy: '丸山', quantity: 10, remarks: '' },
    { productId: 'seed-prod-2', arrivalDate: '2026-07-02', receivedBy: '田中', quantity: 5, remarks: '' },
    { productId: 'seed-prod-3', arrivalDate: '2026-05-20', receivedBy: '丸山', quantity: 3, remarks: 'キャンセル後に在庫へ戻った分を含む' },
    { productId: 'seed-prod-4', arrivalDate: '', receivedBy: '田中', quantity: 20, remarks: '入荷日未確定' }
  ];

  var SHIPPED_STOCKS = [
    { productId: 'seed-prod-1', arrivalDate: '2026-06-10', receivedBy: '丸山', quantity: 2, remarks: '' }
  ];

  var FILTER_STOCKS = [
    { productId: 'seed-fprod-1', serialNo: 'FS-0001', arrivalDate: '2026-06-15' },
    { productId: 'seed-fprod-2', serialNo: 'FS-0002', arrivalDate: '' },
    { productId: 'seed-fprod-3', serialNo: 'FS-0003', arrivalDate: '2026-07-01' }
  ];

  var FILTER_SHIPPED_STOCKS = [
    { productId: 'seed-fprod-1', serialNo: 'FS-0004', arrivalDate: '2026-06-16' }
  ];

  var FILTER_CANCELLED_STOCKS = [
    { productId: 'seed-fprod-3', serialNo: 'FS-0005', arrivalDate: '2026-07-02' }
  ];

  function daysAgo(days) {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  function build() {
    var products = PRODUCTS.map(function (product, index) {
      return {
        id: product.id,
        productCode: product.productCode,
        productName: product.productName,
        category: product.category,
        createdAt: daysAgo(60 - index)
      };
    });

    var items = [];
    var index = 0;

    function pushNormalItem(stock, status) {
      index += 1;
      var item = {
        id: 'seed-item-' + index,
        productId: stock.productId,
        quantity: stock.quantity,
        arrivalDate: stock.arrivalDate,
        receivedBy: stock.receivedBy,
        remarks: stock.remarks,
        stockType: 'normal',
        status: status,
        registeredAt: daysAgo(30 - (index % 20))
      };
      items.push(item);
      return item;
    }

    function pushFilterItem(stock, status) {
      index += 1;
      var item = {
        id: 'seed-item-' + index,
        productId: stock.productId,
        serialNo: stock.serialNo,
        arrivalDate: stock.arrivalDate,
        stockType: 'filter',
        status: status,
        registeredAt: daysAgo(30 - (index % 20))
      };
      items.push(item);
      return item;
    }

    STOCKS.forEach(function (stock) { pushNormalItem(stock, 'in_stock'); });
    FILTER_STOCKS.forEach(function (stock) { pushFilterItem(stock, 'in_stock'); });

    var shipments = [];

    /* 出庫済み1件（通常品、在庫からは外れる） */
    var shippedItem = pushNormalItem(SHIPPED_STOCKS[0], 'shipped');
    shipments.push({
      id: 'seed-ship-1',
      itemId: shippedItem.id,
      shippedBy: '丸山',
      orderTo: '株式会社山田製作所 東京営業所',
      endUser: '営業部　佐藤様',
      shippedAt: daysAgo(3),
      status: 'shipped',
      cancelledAt: null
    });

    /* キャンセル済み1件（通常品、履歴には残り、商品は在庫に戻っている） */
    var cancelledStock = {
      productId: 'seed-prod-3', arrivalDate: '2026-05-20', receivedBy: '丸山', quantity: 1, remarks: ''
    };
    var cancelledItem = pushNormalItem(cancelledStock, 'in_stock');
    shipments.push({
      id: 'seed-ship-2',
      itemId: cancelledItem.id,
      shippedBy: '田中',
      orderTo: '株式会社鈴木工業 大阪工場',
      endUser: '資材課　高橋様',
      shippedAt: daysAgo(6),
      status: 'cancelled',
      cancelledAt: daysAgo(5)
    });

    /* 出庫済み1件（フィルター品、在庫からは外れる） */
    var filterShippedItem = pushFilterItem(FILTER_SHIPPED_STOCKS[0], 'shipped');
    shipments.push({
      id: 'seed-ship-3',
      itemId: filterShippedItem.id,
      shippedBy: 'テスト太郎',
      orderTo: '株式会社フィルター商事',
      endUser: '製造部　鈴木様',
      shippedAt: daysAgo(2),
      status: 'shipped',
      cancelledAt: null
    });

    /* キャンセル済み1件（フィルター品、履歴には残り、商品は在庫に戻っている） */
    var filterCancelledItem = pushFilterItem(FILTER_CANCELLED_STOCKS[0], 'in_stock');
    shipments.push({
      id: 'seed-ship-4',
      itemId: filterCancelledItem.id,
      shippedBy: '丸山',
      orderTo: '株式会社中村精機',
      endUser: '品質管理課　伊藤様',
      shippedAt: daysAgo(4),
      status: 'cancelled',
      cancelledAt: daysAgo(3)
    });

    return { products: products, items: items, shipments: shipments };
  }

  /**
   * フィルター品のデモデータを追加する（既存の通常品データはそのまま）。
   * 過去のバージョンで一度デモデータを投入済みのブラウザは、後からフィルター品の
   * デモデータを追加してもそのままでは反映されない（初回だけ投入する仕組みのため）ので、
   * フィルター商品が1件も無い場合に限りここで補充する。
   */
  function ensureFilterDemo() {
    if (App.store.listProducts('filter').length > 0) return;

    var f1 = App.store.addProduct({ productCode: 'F-100', productName: 'エアフィルター F-100', category: 'filter' }).product;
    var f2 = App.store.addProduct({ productCode: 'F-200', productName: 'オイルフィルター F-200', category: 'filter' }).product;
    var f3 = App.store.addProduct({ productCode: 'F-300', productName: '燃料フィルター F-300', category: 'filter' }).product;

    /* フィルター入庫は入荷日付が必須のため、通常品のデモと違い空にはできない。 */
    App.store.addFilterItem({ productId: f1.id, serialNo: 'FS-0001', arrivalDate: '2026-06-15' });
    App.store.addFilterItem({ productId: f2.id, serialNo: 'FS-0002', arrivalDate: '2026-06-20' });
    App.store.addFilterItem({ productId: f3.id, serialNo: 'FS-0003', arrivalDate: '2026-07-01' });

    /* 出庫済み1件 */
    var shippedItem = App.store.addFilterItem({ productId: f1.id, serialNo: 'FS-0004', arrivalDate: '2026-06-16' }).item;
    App.store.ship([shippedItem.id], { shippedBy: 'テスト太郎', orderTo: '株式会社フィルター商事', endUser: '製造部　鈴木様' });

    /* キャンセル済み1件（履歴に残し、在庫に戻す） */
    var cancelledItem = App.store.addFilterItem({ productId: f3.id, serialNo: 'FS-0005', arrivalDate: '2026-07-02' }).item;
    App.store.ship([cancelledItem.id], { shippedBy: '丸山', orderTo: '株式会社中村精機', endUser: '品質管理課　伊藤様' });
    var justShipped = App.store.listFilterShipments().filter(function (s) { return s.itemId === cancelledItem.id; })[0];
    if (justShipped) App.store.cancelShipment(justShipped.id);
  }

  /** 未投入なら初期データを入れる。投入済みのブラウザでも、フィルター品のデモが無ければ補充する。 */
  function ensure() {
    if (!App.store.isSeeded()) {
      reset();
      return;
    }
    ensureFilterDemo();
  }

  /** デモデータを初期状態に戻す（既存データは破棄）。 */
  function reset() {
    var data = build();
    App.store.replaceAll(data.products, data.items, data.shipments);
  }

  return { ensure: ensure, reset: reset };
})();
