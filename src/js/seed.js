/* モック用のデモデータ。初回起動時と「初期状態に戻す」操作のときだけ投入する。 */
window.App = window.App || {};

App.seed = (function () {
  'use strict';

  var PRODUCTS = [
    { id: 'seed-prod-1', modelName: 'ABC-100', dimensions: '100×200', drawingNo: 'A-001' },
    { id: 'seed-prod-2', modelName: 'DEF-200', dimensions: '150×300', drawingNo: 'B-014' },
    { id: 'seed-prod-3', modelName: 'GH-3000', dimensions: '80×80', drawingNo: 'C-220' },
    /* 在庫も履歴もないので削除できる商品（削除機能の確認用） */
    { id: 'seed-prod-4', modelName: 'XYZ-500', dimensions: '60×120', drawingNo: 'D-330' }
  ];

  var STOCKS = [
    {
      productId: 'seed-prod-1', arrivalMonth: '2026-06', projectNo: 'PJ-2026-001',
      serials: ['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010', '0011', '0012']
    },
    {
      productId: 'seed-prod-2', arrivalMonth: '2026-07', projectNo: 'PJ-2026-004',
      serials: ['0101', '0102', '0103', '0104', '0105']
    },
    {
      productId: 'seed-prod-3', arrivalMonth: '2026-05', projectNo: 'PJ-2026-002',
      serials: ['S-001', 'S-002', 'S-003']
    }
  ];

  function daysAgo(days) {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  function build() {
    var products = PRODUCTS.map(function (product, index) {
      return {
        id: product.id,
        modelName: product.modelName,
        dimensions: product.dimensions,
        drawingNo: product.drawingNo,
        createdAt: daysAgo(60 - index)
      };
    });

    var items = [];
    var index = 0;

    STOCKS.forEach(function (stock) {
      stock.serials.forEach(function (serial) {
        index += 1;
        items.push({
          id: 'seed-item-' + index,
          productId: stock.productId,
          serialNo: serial,
          arrivalMonth: stock.arrivalMonth,
          projectNo: stock.projectNo,
          status: 'in_stock',
          registeredAt: daysAgo(30 - (index % 20))
        });
      });
    });

    function find(productId, serialNo) {
      for (var i = 0; i < items.length; i++) {
        if (items[i].productId === productId && items[i].serialNo === serialNo) return items[i];
      }
      return null;
    }

    var shipments = [];

    /* 出荷済み2件（在庫からは外れる） */
    ['0011', '0012'].forEach(function (serial, i) {
      var item = find('seed-prod-1', serial);
      item.status = 'shipped';
      shipments.push({
        id: 'seed-ship-' + (i + 1),
        itemId: item.id,
        shippedBy: '丸山',
        destination: '株式会社山田製作所 東京営業所',
        addressee: '営業部　佐藤様',
        projectNo: 'PJ-2026-001',
        shippedAt: daysAgo(3),
        status: 'shipped',
        cancelledAt: null
      });
    });

    /* キャンセル済み1件（履歴には残り、商品は在庫に戻っている） */
    var cancelledItem = find('seed-prod-3', 'S-003');
    shipments.push({
      id: 'seed-ship-3',
      itemId: cancelledItem.id,
      shippedBy: '田中',
      destination: '株式会社鈴木工業 大阪工場',
      addressee: '資材課　高橋様',
      projectNo: 'PJ-2026-002',
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
