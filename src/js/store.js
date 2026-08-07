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

  /* 商品マスタの必須項目。型名と寸法・図番は1対1で、型名から一意に決まる。 */
  var PRODUCT_FIELDS = [
    { key: 'modelName', label: '型名' },
    { key: 'dimensions', label: '寸法' },
    { key: 'drawingNo', label: '図番' }
  ];

  /* 入庫登録の必須項目。型名・寸法・図番は商品マスタから引くので含めない。 */
  var ITEM_FIELDS = [
    { key: 'productId', label: '型名' },
    { key: 'serialNo', label: '製造番号' },
    { key: 'arrivalMonth', label: '入荷月' },
    { key: 'projectNo', label: '案件番号' }
  ];

  /* 出荷時の必須項目。宛先は任意入力なので含めない。 */
  var SHIPMENT_FIELDS = [
    { key: 'shippedBy', label: '出荷した人' },
    { key: 'destination', label: '出荷先' },
    { key: 'projectNo', label: '案件番号' }
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

  /* --- 読み込みと移行 --------------------------------------------------- */

  function load() {
    products = readJson(KEY_PRODUCTS, []);
    items = readJson(KEY_ITEMS, []);
    shipments = readJson(KEY_SHIPMENTS, []);
    migrateLegacyItems();
  }

  /**
   * 商品マスタを導入する前のデータ（型名・寸法・図番を商品側に直接持っていた）を
   * マスタ参照に移行する。型名ごとに1件のマスタを起こす。
   */
  function migrateLegacyItems() {
    var changed = false;
    items.forEach(function (item) {
      if (item.productId) return;
      var product = findProductByModelName(item.modelName);
      if (!product) {
        product = buildProduct(item.modelName, item.dimensions, item.drawingNo);
        products.push(product);
      }
      item.productId = product.id;
      delete item.modelName;
      delete item.dimensions;
      delete item.drawingNo;
      changed = true;
    });
    if (changed) save();
  }

  /* --- 商品マスタ ------------------------------------------------------- */

  function buildProduct(modelName, dimensions, drawingNo) {
    return {
      id: uid('prod'),
      modelName: text(modelName),
      dimensions: text(dimensions),
      drawingNo: text(drawingNo),
      createdAt: new Date().toISOString()
    };
  }

  function findProduct(id) {
    for (var i = 0; i < products.length; i++) {
      if (products[i].id === id) return products[i];
    }
    return null;
  }

  function findProductByModelName(modelName) {
    for (var i = 0; i < products.length; i++) {
      if (norm(products[i].modelName) === norm(modelName)) return products[i];
    }
    return null;
  }

  function compareProducts(a, b) {
    return a.modelName < b.modelName ? -1 : a.modelName > b.modelName ? 1 : 0;
  }

  /** 商品マスタを型名順で返す。 */
  function listProducts() {
    return products.slice().sort(compareProducts);
  }

  function getProduct(id) {
    var product = findProduct(id);
    return product ? {
      id: product.id,
      modelName: product.modelName,
      dimensions: product.dimensions,
      drawingNo: product.drawingNo,
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
    if (!errors.modelName) {
      var duplicated = products.some(function (product) {
        return product.id !== excludeId && norm(product.modelName) === norm(input.modelName);
      });
      if (duplicated) {
        errors.modelName = 'この型名は既に登録されています。';
      }
    }
    return errors;
  }

  /** 商品マスタを登録する。型名は重複できない。 */
  function addProduct(data) {
    var input = data || {};
    var errors = validateProduct(input, null);
    if (Object.keys(errors).length > 0) return { ok: false, errors: errors };

    var product = buildProduct(input.modelName, input.dimensions, input.drawingNo);
    products.push(product);
    save();
    return { ok: true, product: product };
  }

  /** 商品マスタを更新する。在庫・履歴の表示にもそのまま反映される。 */
  function updateProduct(id, data) {
    var product = findProduct(id);
    if (!product) return { ok: false, errors: { modelName: '対象の商品が見つかりません。' } };

    var input = data || {};
    var errors = validateProduct(input, id);
    if (Object.keys(errors).length > 0) return { ok: false, errors: errors };

    product.modelName = text(input.modelName);
    product.dimensions = text(input.dimensions);
    product.drawingNo = text(input.drawingNo);
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
        message: 'この商品は在庫 ' + usage.inStock + ' 個・出荷済み ' + usage.shipped + ' 個で使われているため削除できません。'
      };
    }

    products = products.filter(function (p) { return p.id !== id; });
    save();
    return { ok: true };
  }

  /* --- 在庫（商品マスタと結合して返す） -------------------------------- */

  /** 保存用の item に商品マスタの型名・寸法・図番を足した表示用オブジェクトを作る。 */
  function decorate(item) {
    var product = findProduct(item.productId) || {};
    return {
      id: item.id,
      productId: item.productId,
      modelName: product.modelName || '(削除済み商品)',
      dimensions: product.dimensions || '',
      drawingNo: product.drawingNo || '',
      serialNo: item.serialNo,
      arrivalMonth: item.arrivalMonth,
      projectNo: item.projectNo,
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
    if (text(f.modelName) && !includes(row.modelName, f.modelName)) return false;
    if (text(f.drawingNo) && !includes(row.drawingNo, f.drawingNo)) return false;
    if (text(f.serialNo) && !includes(row.serialNo, f.serialNo)) return false;
    if (text(f.projectNo) && !includes(row.projectNo, f.projectNo)) return false;
    if (text(f.arrivalMonth) && row.arrivalMonth !== text(f.arrivalMonth)) return false;
    return true;
  }

  function compareRows(a, b) {
    if (a.modelName !== b.modelName) return a.modelName < b.modelName ? -1 : 1;
    if (a.serialNo !== b.serialNo) return a.serialNo < b.serialNo ? -1 : 1;
    return 0;
  }

  /** 在庫中（未出荷）の商品を製造番号ごとに1件返す。 */
  function listInStock(filter) {
    return items
      .filter(function (item) { return item.status === 'in_stock'; })
      .map(decorate)
      .filter(function (row) { return matchesRow(row, filter); })
      .sort(compareRows);
  }

  /** 在庫中の商品を商品マスタ単位でまとめ、在庫数を付けて返す。 */
  function groupInStock(filter) {
    var map = {};
    var order = [];
    listInStock(filter).forEach(function (row) {
      if (!map[row.productId]) {
        map[row.productId] = {
          productId: row.productId,
          modelName: row.modelName,
          dimensions: row.dimensions,
          drawingNo: row.drawingNo,
          count: 0
        };
        order.push(row.productId);
      }
      map[row.productId].count += 1;
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
   * 入庫した商品を登録する。
   * 戻り値: { ok: true, item } / { ok: false, errors: { フィールド名: メッセージ } }
   */
  function addItem(data) {
    var input = data || {};
    var errors = {};

    ITEM_FIELDS.forEach(function (field) {
      if (!text(input[field.key])) {
        errors[field.key] = field.key === 'productId'
          ? '型名を選択してください。'
          : field.label + 'を入力してください。';
      }
    });

    if (!errors.productId && !findProduct(input.productId)) {
      errors.productId = '選択した商品が見つかりません。';
    }

    if (!errors.serialNo) {
      var duplicated = items.some(function (item) {
        return item.status === 'in_stock' && norm(item.serialNo) === norm(input.serialNo);
      });
      if (duplicated) {
        errors.serialNo = 'この製造番号は既に在庫として登録されています。';
      }
    }

    if (Object.keys(errors).length > 0) {
      return { ok: false, errors: errors };
    }

    var item = {
      id: uid('item'),
      productId: text(input.productId),
      serialNo: text(input.serialNo),
      arrivalMonth: text(input.arrivalMonth),
      projectNo: text(input.projectNo),
      status: 'in_stock',
      registeredAt: new Date().toISOString()
    };
    items.push(item);
    save();
    return { ok: true, item: decorate(item) };
  }

  /* --- 出荷 ------------------------------------------------------------ */

  /**
   * 選択した商品を出荷する。必須項目が1つでも欠けていれば実行しない。
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
      errors._items = '出荷する商品を選択してください。';
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
        destination: text(input.destination),
        addressee: text(input.addressee),
        projectNo: text(input.projectNo),
        shippedAt: shippedAt,
        status: 'shipped',
        cancelledAt: null
      });
    });
    save();
    return { ok: true, count: targets.length };
  }

  /* --- 出荷履歴・キャンセル -------------------------------------------- */

  function matchesShipmentRow(row, filter) {
    var f = filter || {};
    if (f.status && f.status !== 'all' && row.status !== f.status) return false;
    var keyword = text(f.keyword);
    if (!keyword) return true;
    return [
      row.modelName, row.dimensions, row.drawingNo, row.serialNo,
      row.arrivalMonth, row.projectNo, row.shippedBy, row.destination, row.addressee
    ].some(function (value) { return includes(value, keyword); });
  }

  /** 出荷履歴を商品情報と結合して、出荷日時の新しい順に返す。 */
  function listShipments(filter) {
    return shipments
      .map(function (shipment) {
        var item = findItem(shipment.itemId);
        var row = item ? decorate(item) : {};
        return {
          id: shipment.id,
          itemId: shipment.itemId,
          modelName: row.modelName || '(削除済み)',
          dimensions: row.dimensions || '',
          drawingNo: row.drawingNo || '',
          serialNo: row.serialNo || '',
          arrivalMonth: row.arrivalMonth || '',
          projectNo: shipment.projectNo,
          shippedBy: shipment.shippedBy,
          destination: shipment.destination,
          addressee: shipment.addressee,
          shippedAt: shipment.shippedAt,
          status: shipment.status,
          cancelledAt: shipment.cancelledAt
        };
      })
      .filter(function (row) { return matchesShipmentRow(row, filter); })
      .sort(function (a, b) { return a.shippedAt < b.shippedAt ? 1 : a.shippedAt > b.shippedAt ? -1 : 0; });
  }

  function getShipment(id) {
    for (var i = 0; i < shipments.length; i++) {
      if (shipments[i].id === id) return shipments[i];
    }
    return null;
  }

  /** 出荷をキャンセルし、商品を在庫に戻す。履歴自体は残して状態だけ変える。 */
  function cancelShipment(shipmentId) {
    var shipment = getShipment(shipmentId);
    if (!shipment || shipment.status !== 'shipped') {
      return { ok: false, message: 'この出荷はキャンセルできません。' };
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
    ITEM_FIELDS: ITEM_FIELDS,
    SHIPMENT_FIELDS: SHIPMENT_FIELDS,
    load: load,
    listProducts: listProducts,
    getProduct: getProduct,
    productUsage: productUsage,
    addProduct: addProduct,
    updateProduct: updateProduct,
    deleteProduct: deleteProduct,
    listInStock: listInStock,
    groupInStock: groupInStock,
    getItem: getItem,
    getItems: getItems,
    addItem: addItem,
    ship: ship,
    listShipments: listShipments,
    cancelShipment: cancelShipment,
    isSeeded: isSeeded,
    replaceAll: replaceAll
  };
})();
