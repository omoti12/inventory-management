/* データモデルと localStorage への永続化。画面側はこのモジュール経由でのみデータを触る。 */
window.App = window.App || {};

App.store = (function () {
  'use strict';

  /* 商品マスタ(Products)は Microsoft Graph 経由で SharePoint リストに保存する（App.graph）。
     在庫(Items)・出庫履歴(Shipments)は今のフェーズではまだ localStorage のまま。 */
  var KEY_ITEMS = 'inv.items';
  var KEY_SHIPMENTS = 'inv.shipments';

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

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch (e) {
      return fallback;
    }
  }

  /** 在庫・出庫履歴だけをlocalStorageに保存する（商品マスタはGraph経由でSharePointに保存済み）。 */
  function saveLocal() {
    localStorage.setItem(KEY_ITEMS, JSON.stringify(items));
    localStorage.setItem(KEY_SHIPMENTS, JSON.stringify(shipments));
  }

  function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

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

  /* --- 読み込みと移行 --------------------------------------------------- */

  /**
   * 起動時に一度呼ぶ。商品マスタ(Products)はSharePointから読み込むため非同期になる。
   * 在庫(Items)・出庫履歴(Shipments)は引き続きlocalStorageから同期的に読み込む。
   */
  function load() {
    items = readJson(KEY_ITEMS, []);
    shipments = readJson(KEY_SHIPMENTS, []);

    return App.graph.listItems('Products').then(function (graphItems) {
      products = graphItems.map(productFromGraphItem);

      /* 商品マスタが揃ってから、それに依存するItemsの移行処理を行う。 */
      migrateLegacyItems();
      migrateLegacyShipments();

      items.forEach(function (item) {
        if (!item.stockType) item.stockType = 'normal';
      });

      saveLocal();
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

  /**
   * 旧・個体ベース（製造番号1本＝在庫1個、入荷月）のデータを数量ベースに移行する。
   * 受注番号・案件番号は廃止したフィールドなので、残っていれば無条件に取り除く。
   * 注意: productId が無い（商品マスタと紐付いていない）ごく古いローカルデータについては、
   * ここでSharePointに商品を新規作成する非同期処理まではまだ対応していない
   * （発生頻度が極めて低いための割り切り。該当データがあれば手動で商品コードを設定し直す）。
   */
  function migrateLegacyItems() {
    var changed = false;
    items.forEach(function (item) {
      if (!item.productId) {
        return;
      }
      if (item.stockType !== 'filter' && item.quantity === undefined) {
        item.quantity = toQuantity(item.quantity) || 1;
        item.receivedBy = text(item.receivedBy);
        item.remarks = text(item.remarks);
        item.arrivalDate = text(item.arrivalDate) || (text(item.arrivalMonth) ? text(item.arrivalMonth) + '-01' : '');
        delete item.arrivalMonth;
        changed = true;
      }
      if (item.stockType === 'filter' && item.orderNo !== undefined) {
        /* 受注番号はフィルター品では扱わない項目。 */
        delete item.orderNo;
        changed = true;
      }
      if (item.projectNo !== undefined) {
        delete item.projectNo;
        changed = true;
      }
    });
    return changed;
  }

  /** 旧・出荷先/宛先ベースのデータを受注先/エンドユーザーに移行する。 */
  function migrateLegacyShipments() {
    var changed = false;
    shipments.forEach(function (shipment) {
      if (shipment.orderTo === undefined) {
        shipment.orderTo = text(shipment.destination);
        shipment.endUser = text(shipment.addressee);
        delete shipment.destination;
        delete shipment.addressee;
        delete shipment.projectNo;
        changed = true;
      }
    });
    return changed;
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

  /** 在庫にも履歴にも使われていない商品だけ削除できる。Promise を返す。 */
  function deleteProduct(id) {
    var product = findProduct(id);
    if (!product) return Promise.resolve({ ok: false, message: '対象の商品が見つかりません。' });

    var usage = productUsage(id);
    if (usage.total > 0) {
      return Promise.resolve({
        ok: false,
        message: 'この商品は在庫 ' + usage.inStock + ' 個・出庫済み ' + usage.shipped + ' 個で使われているため削除できません。'
      });
    }

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
   * 確保できるところまでの id を返す。
   */
  function allocateForShipment(productId, quantity) {
    var need = toQuantity(quantity);
    if (!productId || need <= 0) return [];

    var candidates = items
      .filter(function (item) {
        return item.productId === productId && item.status === 'in_stock' && item.stockType !== 'filter';
      })
      .sort(function (a, b) {
        var da = a.arrivalDate || '9999-99-99';
        var db = b.arrivalDate || '9999-99-99';
        return da < db ? -1 : da > db ? 1 : 0;
      });

    var resultIds = [];
    for (var i = 0; i < candidates.length && need > 0; i++) {
      var item = candidates[i];
      var qty = toQuantity(item.quantity);
      if (qty <= need) {
        resultIds.push(item.id);
        need -= qty;
      } else {
        var splitItem = {
          id: uid('item'),
          productId: item.productId,
          quantity: need,
          serialNo: item.serialNo,
          orderNo: item.orderNo,
          arrivalDate: item.arrivalDate,
          receivedBy: item.receivedBy,
          remarks: item.remarks,
          stockType: item.stockType,
          status: 'in_stock',
          registeredAt: item.registeredAt
        };
        item.quantity = qty - need;
        items.push(splitItem);
        resultIds.push(splitItem.id);
        need = 0;
      }
    }

    saveLocal();
    return resultIds;
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
        id: uid('item'),
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
      items.push(item);
      saveLocal();
      return { ok: true, item: decorate(item) };
    });
  }

  /**
   * フィルター品を入庫登録する（フィルター商品管理から選んだ商品・製造番号・入荷日付が必須）。
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
      return { ok: false, errors: errors };
    }

    var item = {
      id: uid('item'),
      productId: text(input.productId),
      serialNo: text(input.serialNo),
      arrivalDate: text(input.arrivalDate),
      remarks: text(input.remarks),
      stockType: 'filter',
      status: 'in_stock',
      registeredAt: new Date().toISOString()
    };
    items.push(item);
    saveLocal();
    return { ok: true, item: decorate(item) };
  }

  /* --- 出庫 ------------------------------------------------------------ */

  /**
   * 選択した商品（行単位）を出庫する。必須項目が1つでも欠けていれば実行しない。
   * 戻り値: { ok: true, count } / { ok: false, errors }
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
      return { ok: false, errors: errors };
    }

    var shippedAt = new Date().toISOString();
    targets.forEach(function (item) {
      item.status = 'shipped';
      shipments.push({
        id: uid('ship'),
        itemId: item.id,
        shippedBy: text(input.shippedBy),
        orderTo: text(input.orderTo),
        endUser: text(input.endUser),
        remarks: text(input.remarks),
        shippedAt: shippedAt,
        status: 'shipped',
        cancelledAt: null
      });
    });
    saveLocal();
    return { ok: true, count: targets.length };
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

  /** 出庫履歴を商品情報と結合して、出庫日時の新しい順に返す。stockType を指定すると絞り込む。 */
  function listShipments(filter, stockType) {
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
      .sort(function (a, b) { return a.shippedAt < b.shippedAt ? 1 : a.shippedAt > b.shippedAt ? -1 : 0; });
  }

  /** フィルター商品の出庫履歴だけを返す。 */
  function listFilterShipments(filter) {
    return listShipments(filter, 'filter');
  }

  function getShipment(id) {
    for (var i = 0; i < shipments.length; i++) {
      if (shipments[i].id === id) return shipments[i];
    }
    return null;
  }

  /** 出庫をキャンセルし、商品を在庫に戻す。履歴自体は残して状態だけ変える。 */
  function cancelShipment(shipmentId) {
    var shipment = getShipment(shipmentId);
    if (!shipment || shipment.status !== 'shipped') {
      return { ok: false, message: 'この出庫はキャンセルできません。' };
    }
    shipment.status = 'cancelled';
    shipment.cancelledAt = new Date().toISOString();

    var item = findItem(shipment.itemId);
    if (item) item.status = 'in_stock';

    saveLocal();
    return { ok: true };
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
