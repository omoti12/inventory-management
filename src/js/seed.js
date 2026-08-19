/* モック用のデモデータ。初回起動時と「初期状態に戻す」操作のときだけ投入する。 */
window.App = window.App || {};

App.seed = (function () {
  'use strict';

  var PRODUCTS = [
    { id: 'seed-prod-1', productCode: 'ABC-100', productName: 'アングルブラケット ABC-100', category: 'normal' },
    { id: 'seed-prod-2', productCode: 'DEF-200', productName: 'フランジ DEF-200', category: 'normal' },
    { id: 'seed-prod-3', productCode: 'GH-3000', productName: 'ステー GH-3000', category: 'normal' },
    /* 在庫も履歴もないので削除できる商品（削除機能の確認用） */
    { id: 'seed-prod-4', productCode: 'XYZ-500', productName: 'カバー XYZ-500', category: 'normal' },

    { id: 'seed-fprod-1', productCode: 'F-100', productName: 'エアフィルター F-100', category: 'filter' },
    { id: 'seed-fprod-2', productCode: 'F-200', productName: 'オイルフィルター F-200', category: 'filter' }
  ];

  var STOCKS = [
    { productId: 'seed-prod-1', orderNo: 'PJ-2026-001', arrivalDate: '2026-06-10', receivedBy: '丸山', quantity: 10, remarks: '' },
    { productId: 'seed-prod-2', orderNo: 'PJ-2026-004', arrivalDate: '2026-07-02', receivedBy: '田中', quantity: 5, remarks: '' },
    { productId: 'seed-prod-3', orderNo: 'PJ-2026-002', arrivalDate: '2026-05-20', receivedBy: '丸山', quantity: 3, remarks: 'キャンセル後に在庫へ戻った分を含む' }
  ];

  var SHIPPED_STOCKS = [
    { productId: 'seed-prod-1', orderNo: 'PJ-2026-001', arrivalDate: '2026-06-10', receivedBy: '丸山', quantity: 2, remarks: '' }
  ];

  var FILTER_STOCKS = [
    { productId: 'seed-fprod-1', serialNo: 'FS-0001', arrivalDate: '2026-06-15', projectNo: 'PJ-F-2026-001' },
    { productId: 'seed-fprod-2', serialNo: 'FS-0002', arrivalDate: '', projectNo: 'PJ-F-2026-002' }
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
        orderNo: stock.orderNo,
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
        projectNo: stock.projectNo,
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

    /* 出庫済み1件（在庫からは外れる） */
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

    /* キャンセル済み1件（履歴には残り、商品は在庫に戻っている） */
    var cancelledStock = {
      productId: 'seed-prod-3', orderNo: 'PJ-2026-002', arrivalDate: '2026-05-20', receivedBy: '丸山', quantity: 1, remarks: ''
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

    return { products: products, items: items, shipments: shipments };
  }

  /** 未投入なら初期データを入れる。 */
  function ensure() {
    if (App.store.isSeeded()) return;
    reset();
  }

  /** デモデータを初期状態に戻す（既存データは破棄）。 */
  function reset() {
    var data = build();
    App.store.replaceAll(data.products, data.items, data.shipments);
  }

  return { ensure: ensure, reset: reset };
})();
