/* データモデルと localStorage への永続化。画面側はこのモジュール経由でのみデータを触る。 */
window.App = window.App || {};

App.store = (function () {
  'use strict';

  var KEY_PRODUCTS = 'inv.products';
  var KEY_ITEMS = 'inv.items';
  var KEY_SHIPMENTS = 'inv.shipments';
  var KEY_SEEDED = 'inv.seeded';

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

  function save() {
    localStorage.setItem(KEY_PRODUCTS, JSON.stringify(products));
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

  function load() {
    products = readJson(KEY_PRODUCTS, []);
    items = readJson(KEY_ITEMS, []);
    shipments = readJson(KEY_SHIPMENTS, []);

    migrateLegacyProducts();
    migrateLegacyItems();
    migrateLegacyShipments();

    items.forEach(function (item) {
      if (!item.stockType) item.stockType = 'normal';
    });

    save();
  }

  /**
   * 旧・型名ベースの商品マスタ（modelName / dimensions / drawingNo）を
   * 商品コード・製品名ベースに移行する。
   */
  function migrateLegacyProducts() {
    var changed = false;
    products.forEach(function (product) {
      if (product.productCode === undefined) {
        product.productCode = text(product.modelName) || product.id;
        product.productName = text(product.modelName) || '(旧データ)';
        product.category = product.category || 'normal';
        delete product.modelName;
        delete product.dimensions;
        delete product.drawingNo;
        changed = true;
      }
      if (!product.category) {
        product.category = 'normal';
        changed = true;
      }
    });
    return changed;
  }

  /**
   * 旧・個体ベース（製造番号1本＝在庫1個、入荷月・案件番号）のデータを
   * 受注番号・数量ベースに移行する。商品マスタが無い旧データ（modelName直持ち）にも対応する。
   */
  function migrateLegacyItems() {
    var changed = false;
    items.forEach(function (item) {
      if (!item.productId) {
        var product = findProductByCode(item.modelName);
        if (!product) {
          product = buildProduct(item.modelName || '(不明)', item.modelName || '(不明)', 'normal');
          products.push(product);
        }
        item.productId = product.id;
        delete item.modelName;
        delete item.dimensions;
        delete item.drawingNo;
        changed = true;
      }
      if (item.orderNo === undefined) {
        item.orderNo = text(item.projectNo);
        item.quantity = toQuantity(item.quantity) || 1;
        item.receivedBy = text(item.receivedBy);
        item.remarks = text(item.remarks);
        item.arrivalDate = text(item.arrivalDate) || (text(item.arrivalMonth) ? text(item.arrivalMonth) + '-01' : '');
        delete item.projectNo;
        delete item.arrivalMonth;
        delete item.serialNo;
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

  function buildProduct(productCode, productName, category) {
    return {
      id: uid('prod'),
      productCode: text(productCode),
      productName: text(productName),
      category: category === 'filter' ? 'filter' : 'normal',
      createdAt: new Date().toISOString()
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
      usage.total += 1;
      if (item.status === 'in_stock') usage.inStock += 1;
      else usage.shipped += 1;
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

  /** 商品マスタを登録する。商品コードは重複できない。 */
  function addProduct(data) {
    var input = data || {};
    var errors = validateProduct(input, null);
    if (Object.keys(errors).length > 0) return { ok: false, errors: errors };

    var product = buildProduct(input.productCode, input.productName, input.category);
    products.push(product);
    save();
    return { ok: true, product: product };
  }

  /** 商品コードから商品を探し、無ければ自動登録する（入庫画面の自由入力用）。 */
  function findOrCreateProduct(productCode, productName, category) {
    var existing = findProductByCode(productCode, category);
    if (existing) return existing;
    var product = buildProduct(productCode, productName || productCode, category);
    products.push(product);
    save();
    return product;
  }

  /** 商品マスタを更新する。在庫・履歴の表示にもそのまま反映される。 */
  function updateProduct(id, data) {
    var product = findProduct(id);
    if (!product) return { ok: false, errors: { productCode: '対象の商品が見つかりません。' } };

    var input = data || {};
    var errors = validateProduct(input, id);
    if (Object.keys(errors).length > 0) return { ok: false, errors: errors };

    product.productCode = text(input.productCode);
    product.productName = text(input.productName);
    save();
    return { ok: true, product: product };
  }

  /** 在庫にも履歴にも使われていない商品だけ削除できる。 */
  function deleteProduct(id) {
    var product = findProduct(id);
    if (!product) return { ok: false, message: '対象の商品が見つかりません。' };

    var usage = productUsage(id);
    if (usage.total > 0) {
      return {
        ok: false,
        message: 'この商品は在庫 ' + usage.inStock + ' 個・出庫済み ' + usage.shipped + ' 個で使われているため削除できません。'
      };
    }

    products = products.filter(function (p) { return p.id !== id; });
    save();
    return { ok: true };
  }

  /* --- 在庫（商品マスタと結合して返す） -------------------------------- */

  /**
   * 保存用の item に商品マスタの商品コード・製品名を足した表示用オブジェクトを作る。
   * 通常品（数量・受注番号・入庫した人・備考）とフィルター品（製造番号・案件番号）で
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
      orderNo: item.orderNo,
      receivedBy: item.receivedBy,
      remarks: item.remarks,
      serialNo: item.serialNo,
      projectNo: item.projectNo,
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
    if (text(f.orderNo) && !includes(row.orderNo, f.orderNo)) return false;
    if (text(f.arrivalDate) && row.arrivalDate !== text(f.arrivalDate)) return false;
    return true;
  }

  function compareRows(a, b) {
    if (a.productCode !== b.productCode) return a.productCode < b.productCode ? -1 : 1;
    if (a.orderNo !== b.orderNo) return a.orderNo < b.orderNo ? -1 : 1;
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

  /** 在庫中の商品を商品マスタ単位でまとめ、数量合計を付けて返す。 */
  function groupInStock(filter) {
    var map = {};
    var order = [];
    listInStock(filter).forEach(function (row) {
      if (!map[row.productId]) {
        map[row.productId] = {
          productId: row.productId,
          productCode: row.productCode,
          productName: row.productName,
          count: 0
        };
        order.push(row.productId);
      }
      map[row.productId].count += toQuantity(row.quantity) || 0;
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

  /* --- 入庫登録 --------------------------------------------------------- */

  /**
   * 通常品を入庫登録する（商品コード・製品名は自由入力可。数量・受注番号・入庫した人が必須）。
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
    if (!text(input.orderNo)) {
      errors.orderNo = '受注番号を入力してください。';
    }
    if (!text(input.receivedBy)) {
      errors.receivedBy = '入庫した人を入力してください。';
    }

    if (Object.keys(errors).length > 0) {
      return { ok: false, errors: errors };
    }

    if (!productId) {
      var product = findOrCreateProduct(input.productCode, input.productName, 'normal');
      productId = product.id;
    }

    var item = {
      id: uid('item'),
      productId: productId,
      quantity: toQuantity(input.quantity),
      orderNo: text(input.orderNo),
      arrivalDate: text(input.arrivalDate),
      receivedBy: text(input.receivedBy),
      remarks: text(input.remarks),
      stockType: 'normal',
      status: 'in_stock',
      registeredAt: new Date().toISOString()
    };
    items.push(item);
    save();
    return { ok: true, item: decorate(item) };
  }

  /**
   * フィルター品を入庫登録する（フィルター商品管理から選んだ商品・製造番号・入荷日付・案件番号が必須）。
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
    if (!text(input.projectNo)) {
      errors.projectNo = '案件番号を入力してください。';
    }

    if (Object.keys(errors).length > 0) {
      return { ok: false, errors: errors };
    }

    var item = {
      id: uid('item'),
      productId: text(input.productId),
      serialNo: text(input.serialNo),
      arrivalDate: text(input.arrivalDate),
      projectNo: text(input.projectNo),
      stockType: 'filter',
      status: 'in_stock',
      registeredAt: new Date().toISOString()
    };
    items.push(item);
    save();
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
        shippedAt: shippedAt,
        status: 'shipped',
        cancelledAt: null
      });
    });
    save();
    return { ok: true, count: targets.length };
  }

  /* --- 出庫履歴・キャンセル -------------------------------------------- */

  function matchesShipmentRow(row, filter) {
    var f = filter || {};
    if (f.status && f.status !== 'all' && row.status !== f.status) return false;
    var keyword = text(f.keyword);
    if (!keyword) return true;
    return [
      row.productCode, row.productName, row.orderNo, row.serialNo, row.projectNo,
      row.shippedBy, row.orderTo, row.endUser
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
          orderNo: row.orderNo || '',
          serialNo: row.serialNo || '',
          projectNo: row.projectNo || '',
          arrivalDate: row.arrivalDate || '',
          remarks: row.remarks || '',
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

    save();
    return { ok: true };
  }

  /* --- デモデータ管理 -------------------------------------------------- */

  function isSeeded() {
    return localStorage.getItem(KEY_SEEDED) === '1';
  }

  function replaceAll(nextProducts, nextItems, nextShipments) {
    products = nextProducts;
    items = nextItems;
    shipments = nextShipments;
    localStorage.setItem(KEY_SEEDED, '1');
    save();
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
    addItem: addItem,
    addFilterItem: addFilterItem,
    ship: ship,
    listShipments: listShipments,
    listFilterShipments: listFilterShipments,
    cancelShipment: cancelShipment,
    isSeeded: isSeeded,
    replaceAll: replaceAll
  };
})();
