/* データモデルと、Microsoft Graph経由でのSharePoint永続化。画面側はこのモジュール経由でのみデータを触る。 */
window.App = window.App || {};

App.store = (function () {
  'use strict';

  /* 商品マスタ(Products)・在庫(Items)・出庫履歴(Shipments)はすべて
     Microsoft Graph 経由で SharePoint リストに保存する（App.graph）。
     読み取りは起動時に一括読み込みしたメモリ上のキャッシュに対して同期的に行う。 */

  var products = [];
  var items = [];
  var shipments = [];

  /* 商品マスタの必須項目。商品コードは一意。 */
  var PRODUCT_FIELDS = [
    { key: 'productCode', label: '商品コード' },
    { key: 'productName', label: '製品名' }
  ];

  /* 出庫時の必須項目。 */
  var SHIPMENT_FIELDS = [
    { key: 'shippedBy', label: '出庫した人' },
    { key: 'orderTo', label: '受注先' },
    { key: 'endUser', label: 'エンドユーザー' }
  ];

  function text(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function norm(value) {
    return text(value).toLowerCase();
  }

  function includes(value, needle) {
    return norm(value).indexOf(norm(needle)) !== -1;
  }

  function toQuantity(value) {
    var n = parseInt(value, 10);
    return isNaN(n) || n < 1 ? 0 : n;
  }

  /* --- 読み込み ----------------------------------------------------------- */

  /** 起動時に一度呼ぶ。商品マスタ・在庫・出庫履歴をすべてSharePointから読み込むため非同期になる。 */
  function load() {
    return App.graph.listItems('Products').then(function (graphItems) {
      products = graphItems.map(productFromGraphItem);
      return App.graph.listItems('Items');
    }).then(function (graphItems) {
      items = graphItems.map(itemFromGraphItem);
      return App.graph.listItems('Shipments');
    }).then(function (graphItems) {
      shipments = graphItems.map(shipmentFromGraphItem);
    });
  }

  /** GraphのリストアイテムをこのアプリのProduct形状に変換する。 */
  function productFromGraphItem(graphItem) {
    var f = graphItem.fields || {};
    return {
      id: String(graphItem.id),
      productCode: f.ProductsCode || '',
      productName: f.ProductName || '',
      category: f.Category === 'filter' ? 'filter' : 'normal',
      createdAt: f.CreatedAt || ''
    };
  }

  /** GraphのリストアイテムをこのアプリのItem形状に変換する。 */
  function itemFromGraphItem(graphItem) {
    var f = graphItem.fields || {};
    var item = {
      id: String(graphItem.id),
      productId: f.ProductId || '',
      serialNo: f.SerialNo || '',
      arrivalDate: f.ArrivalDate || '',
      remarks: f.Remarks || '',
      stockType: f.StockType === 'filter' ? 'filter' : 'normal',
      status: f.Status === 'shipped' ? 'shipped' : 'in_stock',
      registeredAt: f.RegisteredAt || ''
    };
    if (item.stockType !== 'filter') {
      item.quantity = f.Quantity != null ? toQuantity(f.Quantity) : 0;
      item.orderNo = f.OrderNo || '';
      item.receivedBy = f.ReceivedBy || '';
    }
    return item;
  }

  /** このアプリのItem形状をGraphの Items リストのfields（内部名）に変換する。 */
  function itemToFields(item) {
    var fields = {
      ProductId: text(item.productId),
      SerialNo: text(item.serialNo),
      ArrivalDate: text(item.arrivalDate),
      Remarks: text(item.remarks),
      StockType: item.stockType === 'filter' ? 'filter' : 'normal',
      Status: item.status === 'shipped' ? 'shipped' : 'in_stock',
      RegisteredAt: item.registeredAt || new Date().toISOString()
    };
    if (item.stockType !== 'filter') {
      fields.Quantity = toQuantity(item.quantity);
      fields.OrderNo = text(item.orderNo);
      fields.ReceivedBy = text(item.receivedBy);
    }
    return fields;
  }

  /** GraphのリストアイテムをこのアプリのShipment形状に変換する。 */
  function shipmentFromGraphItem(graphItem) {
    var f = graphItem.fields || {};
    return {
      id: String(graphItem.id),
      itemId: f.ItemId || '',
      shippedBy: f.ShippedBy || '',
      orderTo: f.OrderTo || '',
      endUser: f.EndUser || '',
      remarks: f.Remarks || '',
      shippedAt: f.ShippedAt || '',
      status: f.Status === 'cancelled' ? 'cancelled' : 'shipped',
      cancelledAt: f.CancelledAt || null
    };
  }

  /** このアプリのShipment形状をGraphの Shipments リストのfields（内部名）に変換する。 */
  function shipmentToFields(shipment) {
    var fields = {
      ItemId: text(shipment.itemId),
      ShippedBy: text(shipment.shippedBy),
      OrderTo: text(shipment.orderTo),
      EndUser: text(shipment.endUser),
      Remarks: text(shipment.remarks),
      ShippedAt: shipment.shippedAt || new Date().toISOString(),
      Status: shipment.status === 'cancelled' ? 'cancelled' : 'shipped'
    };
    if (shipment.cancelledAt) fields.CancelledAt = shipment.cancelledAt;
    return fields;
  }

  /* --- 商品マスタ ------------------------------------------------------- */

  function productToFields(productCode, productName, category, createdAt) {
    return {
      ProductsCode: text(productCode),
      ProductName: text(productName),
      Category: category === 'filter' ? 'filter' : 'normal',
      CreatedAt: createdAt || new Date().toISOString()
    };
  }

  function findProduct(id) {
    for (var i = 0; i < products.length; i++) {
      if (products[i].id === id) return products[i];
    }
    return null;
  }

  function findProductByCode(productCode, category) {
    for (var i = 0; i < products.length; i++) {
      if (category && products[i].category !== category) continue;
      if (norm(products[i].productCode) === norm(productCode)) return products[i];
    }
    return null;
  }

  function compareProducts(a, b) {
    return a.productCode < b.productCode ? -1 : a.productCode > b.productCode ? 1 : 0;
  }

  /** 商品マスタを商品コード順で返す。category を指定するとその種別だけを返す。 */
  function listProducts(category) {
    return products
      .filter(function (p) { return !category || p.category === category; })
      .slice()
      .sort(compareProducts);
  }

  /** 商品コードから商品を探す（入庫画面の自動補完用）。見つからなければ null。 */
  function getProductByCode(productCode, category) {
    var product = findProductByCode(productCode, category);
    return product ? getProduct(product.id) : null;
  }

  function getProduct(id) {
    var product = findProduct(id);
    return product ? {
      id: product.id,
      productCode: product.productCode,
      productName: product.productName,
      category: product.category,
      createdAt: product.createdAt
    } : null;
  }

  /** その商品がどれだけ使われているか。削除の可否判定と一覧表示に使う。 */
  function productUsage(productId) {
    var usage = { total: 0, inStock: 0, shipped: 0 };
    items.forEach(function (item) {
      if (item.productId !== productId) return;
      /* フィルター品は数量の概念が無く1行＝1個。通常品は quantity を合計する。 */
      var qty = item.stockType === 'filter' ? 1 : toQuantity(item.quantity);
      usage.total += qty;
      if (item.status === 'in_stock') usage.inStock += qty;
      else usage.shipped += qty;
    });
    return usage;
  }

  function validateProduct(input, excludeId) {
    var errors = {};
    PRODUCT_FIELDS.forEach(function (field) {
      if (!text(input[field.key])) {
        errors[field.key] = field.label + 'を入力してください。';
      }
    });
    if (!errors.productCode) {
      var duplicated = products.some(function (product) {
        return product.id !== excludeId && norm(product.productCode) === norm(input.productCode);
      });
      if (duplicated) {
        errors.productCode = 'この商品コードは既に登録されています。';
        errors._duplicate = true;
      }
    }
    return errors;
  }

  /** 商品マスタを登録する。商品コードは重複できない。SharePointへの登録が終わるまで待つ Promise を返す。 */
  function addProduct(data) {
    var input = data || {};
    var errors = validateProduct(input, null);
    if (Object.keys(errors).length > 0) return Promise.resolve({ ok: false, errors: errors });

    var fields = productToFields(input.productCode, input.productName, input.category);
    return App.graph.createItem('Products', fields).then(function (created) {
      var product = productFromGraphItem(created);
      products.push(product);
      return { ok: true, product: product };
    }).catch(function (err) {
      return { ok: false, errors: { productCode: 'SharePointへの登録に失敗しました：' + err.message } };
    });
  }

  /** 商品コードから商品を探し、無ければ自動登録する（入庫画面の自由入力用）。Promise を返す。 */
  function findOrCreateProduct(productCode, productName, category) {
    var existing = findProductByCode(productCode, category);
    if (existing) return Promise.resolve(existing);

    var fields = productToFields(productCode, productName || productCode, category);
    return App.graph.createItem('Products', fields).then(function (created) {
      var product = productFromGraphItem(created);
      products.push(product);
      return product;
    });
  }

  /** 商品マスタを更新する。在庫・履歴の表示にもそのまま反映される。Promise を返す。 */
  function updateProduct(id, data) {
    var product = findProduct(id);
    if (!product) return Promise.resolve({ ok: false, errors: { productCode: '対象の商品が見つかりません。' } });

    var input = data || {};
    var errors = validateProduct(input, id);
    if (Object.keys(errors).length > 0) return Promise.resolve({ ok: false, errors: errors });

    var fields = { ProductsCode: text(input.productCode), ProductName: text(input.productName) };
    return App.graph.updateItem('Products', id, fields).then(function () {
      product.productCode = fields.ProductsCode;
      product.productName = fields.ProductName;
      return { ok: true, product: product };
    }).catch(function (err) {
      return { ok: false, errors: { productCode: 'SharePointの更新に失敗しました：' + err.message } };
    });
  }

  /**
   * 商品マスタを削除する。在庫・出庫履歴で使われていても削除できる（誤って登録・使用した
   * 商品を消せるようにするため）。使用中に削除すると、参照していた在庫・履歴の表示は
   * `decorate()` により「(削除済み商品)」に変わる。呼び出し側で使用状況を見せた上で
   * 確認を取ることを想定している。Promise を返す。
   */
  function deleteProduct(id) {
    var product = findProduct(id);
    if (!product) return Promise.resolve({ ok: false, message: '対象の商品が見つかりません。' });

    return App.graph.deleteItem('Products', id).then(function () {
      products = products.filter(function (p) { return p.id !== id; });
      return { ok: true };
    }).catch(function (err) {
      return { ok: false, message: 'SharePointからの削除に失敗しました：' + err.message };
    });
  }

  /* --- 在庫（商品マスタと結合して返す） -------------------------------- */

  /**
   * 保存用の item に商品マスタの商品コード・製品名を足した表示用オブジェクトを作る。
   * 通常品（数量・製造番号・受注番号・入庫した人・備考）とフィルター品（製造番号のみ）で
   * 持つ項目が異なるため、item が持つ項目をそのまま引き継いだ上で商品情報を合成する。
   */
  function decorate(item) {
    var product = findProduct(item.productId) || {};
    return {
      id: item.id,
      productId: item.productId,
      productCode: product.productCode || '(削除済み商品)',
      productName: product.productName || '',
      quantity: item.quantity,
      receivedBy: item.receivedBy,
      remarks: item.remarks,
      serialNo: item.serialNo,
      orderNo: item.orderNo,
      arrivalDate: item.arrivalDate,
      stockType: item.stockType,
      status: item.status,
      registeredAt: item.registeredAt
    };
  }

  function findItem(id) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) return items[i];
    }
    return null;
  }

  function matchesRow(row, filter) {
    var f = filter || {};
    if (text(f.productCode) && !includes(row.productCode, f.productCode)) return false;
    if (text(f.productName) && !includes(row.productName, f.productName)) return false;
    if (text(f.serialNo) && !includes(row.serialNo, f.serialNo)) return false;
    if (text(f.orderNo) && !includes(row.orderNo, f.orderNo)) return false;
    if (text(f.arrivalDate) && row.arrivalDate !== text(f.arrivalDate)) return false;
    return true;
  }

  function compareRows(a, b) {
    if (a.productCode !== b.productCode) return a.productCode < b.productCode ? -1 : 1;
    if (a.registeredAt !== b.registeredAt) return a.registeredAt < b.registeredAt ? -1 : 1;
    return 0;
  }

  function listByStockType(stockType, filter) {
    return items
      .filter(function (item) {
        return item.status === 'in_stock' && (item.stockType || 'normal') === stockType;
      })
      .map(decorate)
      .filter(function (row) { return matchesRow(row, filter); })
      .sort(compareRows);
  }

  /** 在庫中（未出庫）の通常商品を返す。 */
  function listInStock(filter) {
    return listByStockType('normal', filter);
  }

  /** 在庫中（未出庫）のフィルター商品を返す。 */
  function listFilterInStock(filter) {
    return listByStockType('filter', filter);
  }

  /** 在庫中の商品を商品マスタ単位でまとめ、数量合計と該当する在庫のIDを付けて返す。 */
  function groupInStock(filter) {
    var map = {};
    var order = [];
    listInStock(filter).forEach(function (row) {
      if (!map[row.productId]) {
        map[row.productId] = {
          productId: row.productId,
          productCode: row.productCode,
          productName: row.productName,
          count: 0,
          itemIds: []
        };
        order.push(row.productId);
      }
      map[row.productId].count += toQuantity(row.quantity) || 0;
      map[row.productId].itemIds.push(row.id);
    });
    return order.map(function (key) { return map[key]; });
  }

  function getItem(id) {
    var item = findItem(id);
    return item ? decorate(item) : null;
  }

  function getItems(ids) {
    return (ids || []).map(getItem).filter(Boolean);
  }

  /**
   * 指定した商品の在庫から、入荷日が古いバッチから順に指定数量ぶんを確保し、
   * 出庫対象にできる item の id 配列を返す。ちょうど数量が合わないバッチは分割し、
   * 端数は元のバッチに残したまま在庫として残す（通常品のみ。フィルター品は数量の
   * 概念が無く1行＝1個のため対象外）。要求数量が在庫合計を超える場合は、
   * 確保できるところまでの id を返す。バッチ分割はSharePointへの書き込みを伴うため
   * Promise を返す。
   */
  function allocateForShipment(productId, quantity) {
    var need = toQuantity(quantity);
    if (!productId || need <= 0) return Promise.resolve([]);

    var candidates = items
      .filter(function (item) {
        return item.productId === productId && item.status === 'in_stock' && item.stockType !== 'filter';
      })
      .sort(function (a, b) {
        var da = a.arrivalDate || '9999-99-99';
        var db = b.arrivalDate || '9999-99-99';
        return da < db ? -1 : da > db ? 1 : 0;
      });

    var plan = [];
    for (var i = 0; i < candidates.length && need > 0; i++) {
      var item = candidates[i];
      var qty = toQuantity(item.quantity);
      if (qty <= 0) continue;
      if (qty <= need) {
        plan.push({ type: 'take', item: item });
        need -= qty;
      } else {
        plan.push({ type: 'split', item: item, takeQty: need, remainQty: qty - need });
        need = 0;
      }
    }

    var resultIds = [];
    return plan.reduce(function (chain, step) {
      return chain.then(function () {
        if (step.type === 'take') {
          resultIds.push(step.item.id);
          return;
        }
        return App.graph.updateItem('Items', step.item.id, { Quantity: step.remainQty }).then(function () {
          step.item.quantity = step.remainQty;
          var splitFields = itemToFields({
            productId: step.item.productId,
            quantity: step.takeQty,
            serialNo: step.item.serialNo,
            orderNo: step.item.orderNo,
            arrivalDate: step.item.arrivalDate,
            receivedBy: step.item.receivedBy,
            remarks: step.item.remarks,
            stockType: step.item.stockType,
            status: 'in_stock',
            registeredAt: step.item.registeredAt
          });
          return App.graph.createItem('Items', splitFields).then(function (created) {
            var splitItem = itemFromGraphItem(created);
            items.push(splitItem);
            resultIds.push(splitItem.id);
          });
        });
      });
    }, Promise.resolve()).then(function () {
      return resultIds;
    });
  }

  /* --- 入庫登録 --------------------------------------------------------- */

  /**
   * 通常品を入庫登録する（商品コード・製品名は自由入力可。数量・入庫した人が必須）。
   * 製造番号・受注番号は入庫画面では扱わない（在庫一覧の表示・検索用の項目）。
   * 新しい商品コードの場合はSharePointへの商品登録を待つ必要があるため、Promise を返す。
   * 戻り値: { ok: true, item } / { ok: false, errors: { フィールド名: メッセージ } }
   */
  function addItem(data) {
    var input = data || {};
    var errors = {};

    /* 商品コードの自由入力に対応するため、productId が無ければコードから解決する。 */
    var productId = text(input.productId);
    if (!productId && text(input.productCode)) {
      var resolved = findProductByCode(input.productCode, 'normal');
      if (resolved) productId = resolved.id;
    }

    if (!text(input.productCode) && !productId) {
      errors.productCode = '商品コードを入力してください。';
    }
    if (!text(input.productName) && !productId) {
      errors.productName = '製品名を入力してください。';
    }
    if (toQuantity(input.quantity) === 0) {
      errors.quantity = '数量を1以上で入力してください。';
    }
    if (!text(input.receivedBy)) {
      errors.receivedBy = '入庫した人を入力してください。';
    }

    if (Object.keys(errors).length > 0) {
      return Promise.resolve({ ok: false, errors: errors });
    }

    var productIdPromise = productId
      ? Promise.resolve(productId)
      : findOrCreateProduct(input.productCode, input.productName, 'normal').then(function (product) {
          return product.id;
        });

    return productIdPromise.then(function (resolvedProductId) {
      var item = {
        productId: resolvedProductId,
        quantity: toQuantity(input.quantity),
        serialNo: text(input.serialNo),
        orderNo: text(input.orderNo),
        arrivalDate: text(input.arrivalDate),
        receivedBy: text(input.receivedBy),
        remarks: text(input.remarks),
        stockType: 'normal',
        status: 'in_stock',
        registeredAt: new Date().toISOString()
      };
      return App.graph.createItem('Items', itemToFields(item)).then(function (created) {
        var savedItem = itemFromGraphItem(created);
        items.push(savedItem);
        return { ok: true, item: decorate(savedItem) };
      });
    }).catch(function (err) {
      return { ok: false, errors: { productCode: 'SharePointへの登録に失敗しました：' + err.message } };
    });
  }

  /**
   * フィルター品を入庫登録する（フィルター商品管理から選んだ商品・製造番号・入荷日付が必須）。
   * SharePointへの登録を待つ必要があるため、Promise を返す。
   * 戻り値: { ok: true, item } / { ok: false, errors: { フィールド名: メッセージ } }
   */
  function addFilterItem(data) {
    var input = data || {};
    var errors = {};

    if (!text(input.productId)) {
      errors.productId = 'フィルター商品を選択してください。';
    } else if (!findProduct(input.productId)) {
      errors.productId = '選択した商品が見つかりません。';
    }
    if (!text(input.serialNo)) {
      errors.serialNo = '製造番号を入力してください。';
    }
    if (!text(input.arrivalDate)) {
      errors.arrivalDate = '入荷日付を入力してください。';
    }

    if (Object.keys(errors).length > 0) {
      return Promise.resolve({ ok: false, errors: errors });
    }

    var item = {
      productId: text(input.productId),
      serialNo: text(input.serialNo),
      arrivalDate: text(input.arrivalDate),
      remarks: text(input.remarks),
      stockType: 'filter',
      status: 'in_stock',
      registeredAt: new Date().toISOString()
    };
    return App.graph.createItem('Items', itemToFields(item)).then(function (created) {
      var savedItem = itemFromGraphItem(created);
      items.push(savedItem);
      return { ok: true, item: decorate(savedItem) };
    }).catch(function (err) {
      return { ok: false, errors: { productId: 'SharePointへの登録に失敗しました：' + err.message } };
    });
  }

  /* --- 出庫 ------------------------------------------------------------ */

  /**
   * 選択した商品（行単位）を出庫する。必須項目が1つでも欠けていれば実行しない。
   * 在庫(Items)の状態更新はETag付きで行い（App.graph.updateWithRetry）、他の担当者が
   * 先に同じ在庫を出庫していた場合はその分だけ対象から除外する（複数人が同時に同じ
   * 在庫を出庫しようとしても、二重に出庫記録が作られないようにするための排他制御）。
   * 戻り値: { ok: true, count, conflictCount? } / { ok: false, errors }
   * conflictCount がある場合、その個数は既に他の担当者が出庫済みだったため対象外。
   */
  function ship(itemIds, info) {
    var input = info || {};
    var errors = {};

    SHIPMENT_FIELDS.forEach(function (field) {
      if (!text(input[field.key])) {
        errors[field.key] = field.label + 'を入力してください。';
      }
    });

    var targets = (itemIds || [])
      .map(findItem)
      .filter(function (item) { return item && item.status === 'in_stock'; });

    if (targets.length === 0) {
      errors._items = '出庫する商品を選択してください。';
    }

    if (Object.keys(errors).length > 0) {
      return Promise.resolve({ ok: false, errors: errors });
    }

    var shippedAt = new Date().toISOString();
    var shippedQty = 0;
    var conflictQty = 0;
    var conflictCount = 0;

    return targets.reduce(function (chain, item) {
      return chain.then(function () {
        var qty = item.quantity !== undefined ? (toQuantity(item.quantity) || 0) : 1;
        return App.graph.updateWithRetry('Items', item.id, function (currentFields) {
          /* 再取得した最新状態が既に出庫済みなら、他の担当者が先に出庫したということ。
             上書きせず諦める（null を返すと updateWithRetry は書き込みをスキップする）。 */
          if (currentFields.Status === 'shipped') return null;
          return { Status: 'shipped' };
        }).then(function (result) {
          item.status = 'shipped';
          if (result.skipped) {
            conflictQty += qty;
            conflictCount += 1;
            return;
          }
          shippedQty += qty;
          var shipment = {
            itemId: item.id,
            shippedBy: text(input.shippedBy),
            orderTo: text(input.orderTo),
            endUser: text(input.endUser),
            remarks: text(input.remarks),
            shippedAt: shippedAt,
            status: 'shipped',
            cancelledAt: null
          };
          return App.graph.createItem('Shipments', shipmentToFields(shipment)).then(function (created) {
            shipments.push(shipmentFromGraphItem(created));
          });
        });
      });
    }, Promise.resolve()).then(function () {
      if (shippedQty === 0 && conflictCount > 0) {
        return {
          ok: false,
          errors: { _items: '選択した商品はすべて、別の担当者が既に出庫済みでした。画面を更新してください。' }
        };
      }
      var result = { ok: true, count: shippedQty };
      if (conflictCount > 0) {
        result.conflictCount = conflictCount;
        result.conflictQty = conflictQty;
      }
      return result;
    }).catch(function (err) {
      return { ok: false, errors: { _items: 'SharePointの更新に失敗しました：' + err.message } };
    });
  }

  /* --- 出庫履歴・キャンセル -------------------------------------------- */

  function matchesShipmentRow(row, filter) {
    var f = filter || {};
    if (f.status && f.status !== 'all' && row.status !== f.status) return false;
    var keyword = text(f.keyword);
    if (!keyword) return true;
    return [
      row.productCode, row.productName, row.serialNo, row.orderNo,
      row.shippedBy, row.orderTo, row.endUser, row.remarks
    ].some(function (value) { return includes(value, keyword); });
  }

  /**
   * 出庫履歴を商品情報と結合して返す。stockType を指定すると絞り込む。
   * sortOrder は 'asc'（出庫日時が古い順）/ 'desc'（新しい順、省略時のデフォルト）。
   */
  function listShipments(filter, stockType, sortOrder) {
    var direction = sortOrder === 'asc' ? -1 : 1;
    return shipments
      .map(function (shipment) {
        var item = findItem(shipment.itemId);
        var row = item ? decorate(item) : {};
        return {
          id: shipment.id,
          itemId: shipment.itemId,
          stockType: row.stockType || 'normal',
          productCode: row.productCode || '(削除済み)',
          productName: row.productName || '',
          quantity: row.quantity,
          serialNo: row.serialNo || '',
          orderNo: row.orderNo || '',
          arrivalDate: row.arrivalDate || '',
          itemRemarks: row.remarks || '',
          remarks: shipment.remarks || '',
          shippedBy: shipment.shippedBy,
          orderTo: shipment.orderTo,
          endUser: shipment.endUser,
          shippedAt: shipment.shippedAt,
          status: shipment.status,
          cancelledAt: shipment.cancelledAt
        };
      })
      .filter(function (row) { return !stockType || row.stockType === stockType; })
      .filter(function (row) { return matchesShipmentRow(row, filter); })
      .sort(function (a, b) {
        return a.shippedAt < b.shippedAt ? direction : a.shippedAt > b.shippedAt ? -direction : 0;
      });
  }

  /** フィルター商品の出庫履歴だけを返す。sortOrder は listShipments() と同じ。 */
  function listFilterShipments(filter, sortOrder) {
    return listShipments(filter, 'filter', sortOrder);
  }

  function getShipment(id) {
    for (var i = 0; i < shipments.length; i++) {
      if (shipments[i].id === id) return shipments[i];
    }
    return null;
  }

  /**
   * 出庫をキャンセルし、商品を在庫に戻す。履歴自体は残して状態だけ変える。
   * 在庫(Items)の状態更新はETag付きで行う（既に他の操作で状態が変わっていた場合は
   * 上書きせず、そのまま在庫側の最新状態を尊重する）。
   */
  function cancelShipment(shipmentId) {
    var shipment = getShipment(shipmentId);
    if (!shipment || shipment.status !== 'shipped') {
      return Promise.resolve({ ok: false, message: 'この出庫はキャンセルできません。' });
    }

    var item = findItem(shipment.itemId);
    var cancelledAt = new Date().toISOString();

    var restore = item
      ? App.graph.updateWithRetry('Items', item.id, function (currentFields) {
          if (currentFields.Status === 'in_stock') return null;
          return { Status: 'in_stock' };
        }).then(function () {
          item.status = 'in_stock';
        })
      : Promise.resolve();

    return restore.then(function () {
      return App.graph.updateItem('Shipments', shipment.id, { Status: 'cancelled', CancelledAt: cancelledAt });
    }).then(function () {
      shipment.status = 'cancelled';
      shipment.cancelledAt = cancelledAt;
      return { ok: true };
    }).catch(function (err) {
      return { ok: false, message: 'SharePointの更新に失敗しました：' + err.message };
    });
  }

  return {
    PRODUCT_FIELDS: PRODUCT_FIELDS,
    SHIPMENT_FIELDS: SHIPMENT_FIELDS,
    load: load,
    listProducts: listProducts,
    getProduct: getProduct,
    getProductByCode: getProductByCode,
    productUsage: productUsage,
    addProduct: addProduct,
    updateProduct: updateProduct,
    deleteProduct: deleteProduct,
    findOrCreateProduct: findOrCreateProduct,
    listInStock: listInStock,
    listFilterInStock: listFilterInStock,
    groupInStock: groupInStock,
    getItem: getItem,
    getItems: getItems,
    allocateForShipment: allocateForShipment,
    addItem: addItem,
    addFilterItem: addFilterItem,
    ship: ship,
    listShipments: listShipments,
    listFilterShipments: listFilterShipments,
    cancelShipment: cancelShipment
  };
})();
