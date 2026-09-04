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
  var destinations = [];
  var monthLocks = [];

  /* 商品マスタの必須項目。商品コードは一意。 */
  var PRODUCT_FIELDS = [
    { key: 'productCode', label: '商品コード' },
    { key: 'productName', label: '製品名' }
  ];

  /* 出庫時の必須項目（通常品・フィルター品共通）。備考と出荷先名2は任意で、それ以外はすべて必須。
     出荷先名2が任意なのは、出荷先マスタ側でも出荷先名2を必須にしていない（出荷先名2が無い
     出荷先が実際にあるため）のに合わせたもの。
     shippedDate はフォーム上の生の日付文字列（<input type="date"> の値）を指す。実際に
     SharePointへ送る出庫日時 shippedAt は、これを App.ui.combineDateWithNow() で変換した値
     （values() がその両方を返す）。 */
  var SHIPMENT_FIELDS = [
    { key: 'shippedBy', label: '出庫した人' },
    { key: 'shippedDate', label: '出庫日' },
    { key: 'destinationCode', label: '出荷先コード' },
    { key: 'destinationSubCode', label: '出荷先小番' },
    { key: 'destinationName1', label: '出荷先名1' },
    { key: 'orderNumber1', label: '受注番号1' },
    { key: 'orderNumber2', label: '受注番号2' },
    { key: 'orderNumber3', label: '受注番号3' }
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

  /**
   * 数量欄の入力が有効か（空でなく、0以上の整数か）を判定する。在庫が無い状態でも
   * 入庫記録自体は登録できるよう、0は有効な数量として扱う（空欄・負の数・数値以外は無効）。
   */
  function isValidQuantityInput(value) {
    var raw = text(value);
    if (raw === '') return false;
    var n = parseInt(raw, 10);
    return !isNaN(n) && n >= 0;
  }

  /* --- 読み込み ----------------------------------------------------------- */

  /**
   * 起動時に一度呼ぶ。商品マスタ・在庫・出庫履歴・出荷先マスタをすべてSharePointから
   * 読み込むため非同期になる。
   * 出荷先マスタ(Destinations)は後から追加したリストで、SharePoint側にまだ作成されていない
   * 環境（作成前の一時的な状態）でもアプリ全体の起動を妨げないよう、読み込みに失敗した場合は
   * 空の一覧として扱う（出荷先の自動入力の候補が出ないだけで、他の機能には影響しない）。
   */
  function load() {
    return App.graph.listItems('Products').then(function (graphItems) {
      products = graphItems.map(productFromGraphItem);
      return App.graph.listItems('Items');
    }).then(function (graphItems) {
      items = graphItems.map(itemFromGraphItem);
      return App.graph.listItems('Shipments');
    }).then(function (graphItems) {
      shipments = graphItems.map(shipmentFromGraphItem);
      return App.graph.listItems('Destinations').catch(function () { return []; });
    }).then(function (graphItems) {
      destinations = graphItems.map(destinationFromGraphItem);
      /* MonthLocksリストは月次締め機能用に後から追加したもので、まだ作成していない環境
         でも起動できるよう、Destinations同様に読み込み失敗を握りつぶして空扱いにする。 */
      return App.graph.listItems('MonthLocks').catch(function () { return []; });
    }).then(function (graphItems) {
      monthLocks = graphItems.map(monthLockFromGraphItem);
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
      storageLocation: f.StorageLocation || '',
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
      /* 会計/販売システムへのCSV取込用の項目（すべて任意入力）。 */
      destinationCode: f.DestinationCode || '',
      destinationSubCode: f.DestinationSubCode || '',
      destinationName1: f.DestinationName1 || '',
      destinationName2: f.DestinationName2 || '',
      orderNumber1: f.OrderNumber1 || '',
      orderNumber2: f.OrderNumber2 || '',
      orderNumber3: f.OrderNumber3 || '',
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
      DestinationCode: text(shipment.destinationCode),
      DestinationSubCode: text(shipment.destinationSubCode),
      DestinationName1: text(shipment.destinationName1),
      DestinationName2: text(shipment.destinationName2),
      OrderNumber1: text(shipment.orderNumber1),
      OrderNumber2: text(shipment.orderNumber2),
      OrderNumber3: text(shipment.orderNumber3),
      ShippedAt: shipment.shippedAt || new Date().toISOString(),
      Status: shipment.status === 'cancelled' ? 'cancelled' : 'shipped'
    };
    if (shipment.cancelledAt) fields.CancelledAt = shipment.cancelledAt;
    return fields;
  }

  /* --- 商品マスタ ------------------------------------------------------- */

  function productToFields(productCode, productName, category, storageLocation, createdAt) {
    var fields = {
      ProductsCode: text(productCode),
      ProductName: text(productName),
      Category: category === 'filter' ? 'filter' : 'normal',
      CreatedAt: createdAt || new Date().toISOString()
    };
    /* 保管場所はフィルター品には無い項目（フィルター商品管理には設けていない）。 */
    if (category !== 'filter') {
      fields.StorageLocation = text(storageLocation);
    }
    return fields;
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

    var fields = productToFields(input.productCode, input.productName, input.category, input.storageLocation);
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
    if (product.category !== 'filter') {
      fields.StorageLocation = text(input.storageLocation);
    }
    return App.graph.updateItem('Products', id, fields).then(function () {
      product.productCode = fields.ProductsCode;
      product.productName = fields.ProductName;
      if (fields.StorageLocation !== undefined) product.storageLocation = fields.StorageLocation;
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
    var product = findProduct(item.productId);
    return {
      id: item.id,
      productId: item.productId,
      productCode: (product && product.productCode) || '(削除済み商品)',
      productName: (product && product.productName) || '',
      storageLocation: (product && product.storageLocation) || '',
      /* 参照している商品マスタが削除済みかどうか。削除済みの商品に紐づく入庫記録は
         状態を問わず削除できるようにするため（updateItemの検証等でも使う）。 */
      productDeleted: !product,
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

  /**
   * 在庫中のフィルター商品を商品マスタ単位でまとめ、件数（製造番号の数）と該当する
   * 在庫のIDを付けて返す。フィルター品は数量の概念が無く1行＝1個のため、通常品の
   * groupInStock() と違い quantity を合算せず単純に件数を数える。
   */
  function groupFilterInStock(filter) {
    var map = {};
    var order = [];
    listFilterInStock(filter).forEach(function (row) {
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
      map[row.productId].count += 1;
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

  function matchesInboundRow(row, filter) {
    var f = filter || {};
    if (f.status && f.status !== 'all' && row.status !== f.status) return false;
    var keyword = text(f.keyword);
    if (!keyword) return true;
    return [row.productCode, row.productName, row.receivedBy, row.remarks]
      .some(function (value) { return includes(value, keyword); });
  }

  /**
   * 入庫履歴：通常品の在庫を、在庫中・出庫済みを問わずすべて返す（在庫一覧は在庫中のものだけ）。
   * sortOrder は 'asc'（登録日時が古い順）/ 'desc'（新しい順、省略時のデフォルト）。
   */
  function listInboundHistory(filter, sortOrder) {
    var direction = sortOrder === 'asc' ? -1 : 1;
    return items
      .filter(function (item) { return (item.stockType || 'normal') === 'normal'; })
      .map(decorate)
      .filter(function (row) { return matchesInboundRow(row, filter); })
      .sort(function (a, b) {
        return a.registeredAt < b.registeredAt ? direction : a.registeredAt > b.registeredAt ? -direction : 0;
      });
  }

  function matchesFilterInboundRow(row, filter) {
    var f = filter || {};
    if (f.status && f.status !== 'all' && row.status !== f.status) return false;
    var keyword = text(f.keyword);
    if (!keyword) return true;
    return [row.productCode, row.productName, row.serialNo, row.remarks]
      .some(function (value) { return includes(value, keyword); });
  }

  /** フィルター入庫履歴：フィルター品の在庫を、在庫中・出庫済みを問わずすべて返す。 */
  function listFilterInboundHistory(filter, sortOrder) {
    var direction = sortOrder === 'asc' ? -1 : 1;
    return items
      .filter(function (item) { return item.stockType === 'filter'; })
      .map(decorate)
      .filter(function (row) { return matchesFilterInboundRow(row, filter); })
      .sort(function (a, b) {
        return a.registeredAt < b.registeredAt ? direction : a.registeredAt > b.registeredAt ? -direction : 0;
      });
  }

  /**
   * 入庫記録（在庫の1行）を編集する。入庫履歴・フィルター入庫履歴画面からの利用を想定し、
   * 通常品なら数量・入荷日・入庫した人・備考、フィルター品なら製造番号・入荷日・備考を
   * 更新できる（商品そのものの変更は対象外）。Promise を返す。
   */
  function updateItem(id, data) {
    var item = findItem(id);
    if (!item) return Promise.resolve({ ok: false, message: '対象の入庫記録が見つかりません。' });
    if (isMonthLocked(item.registeredAt)) {
      return Promise.resolve({ ok: false, message: 'この記録は月次締め済みのため編集できません。' });
    }

    var input = data || {};
    var errors = {};
    var fields;
    var isFilter = item.stockType === 'filter';

    if (isFilter) {
      if (!text(input.serialNo)) {
        errors.serialNo = '製造番号を入力してください。';
      }
      if (Object.keys(errors).length > 0) return Promise.resolve({ ok: false, errors: errors });
      fields = {
        SerialNo: text(input.serialNo),
        ArrivalDate: text(input.arrivalDate),
        Remarks: text(input.remarks)
      };
    } else {
      if (!isValidQuantityInput(input.quantity)) {
        errors.quantity = '数量を0以上の整数で入力してください。';
      }
      if (!text(input.receivedBy)) {
        errors.receivedBy = '入庫した人を入力してください。';
      }
      if (Object.keys(errors).length > 0) return Promise.resolve({ ok: false, errors: errors });
      fields = {
        Quantity: toQuantity(input.quantity),
        ArrivalDate: text(input.arrivalDate),
        ReceivedBy: text(input.receivedBy),
        Remarks: text(input.remarks)
      };
    }

    return App.graph.updateItem('Items', id, fields).then(function () {
      if (isFilter) {
        item.serialNo = fields.SerialNo;
      } else {
        item.quantity = fields.Quantity;
        item.receivedBy = fields.ReceivedBy;
      }
      item.arrivalDate = fields.ArrivalDate;
      item.remarks = fields.Remarks;
      return { ok: true, item: decorate(item) };
    }).catch(function (err) {
      return { ok: false, message: 'SharePointの更新に失敗しました：' + err.message };
    });
  }

  /**
   * 入庫記録（在庫の1行）を削除する。誤って登録してしまった記録を片付けるためのもので、
   * deleteShipment() と同じ考え方で、既に出庫済みの記録は原則削除できない（出庫済みの入庫記録を
   * 削除すると、対応する出庫履歴のキャンセル時に在庫を復元する先が無くなってしまうため）。
   * ただし、参照している商品マスタが既に削除されている場合（一覧で「(削除済み商品)」と表示
   * される行）は、状態を問わず削除できる。商品自体が無くなっている以上、そのItemを残しても
   * 復元できる在庫として意味を持たない（decorate()すら商品情報を持てない）ため、
   * 単なる履歴のゴミとして片付けられるようにしている。
   */
  function deleteItem(id) {
    var item = findItem(id);
    if (!item) return Promise.resolve({ ok: false, message: '対象の入庫記録が見つかりません。' });
    if (isMonthLocked(item.registeredAt)) {
      return Promise.resolve({ ok: false, message: 'この記録は月次締め済みのため削除できません。' });
    }

    var productExists = !!findProduct(item.productId);
    if (productExists && item.status !== 'in_stock') {
      return Promise.resolve({ ok: false, message: '在庫中の入庫記録だけ削除できます。' });
    }

    return App.graph.deleteItem('Items', id).then(function () {
      items = items.filter(function (i) { return i.id !== id; });
      return { ok: true };
    }).catch(function (err) {
      return { ok: false, message: 'SharePointからの削除に失敗しました：' + err.message };
    });
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
   * 数量は0以上の整数であれば登録できる（在庫がまだ無い状態でも入庫記録自体は先に
   * 登録しておきたい場合のため。0個の在庫は出庫対象にはならない）。
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
    if (!isValidQuantityInput(input.quantity)) {
      errors.quantity = '数量を0以上の整数で入力してください。';
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
   * 数量欄の入力を「登録する件数」として解釈する（空欄・不正値・1未満は1件として扱う）。
   * フィルター品の登録は1件＝1つの製造番号の物として扱うが、同じ製造番号のものが
   * まとめて何個も入荷することがあるため、その数だけ同じ内容の入庫記録を作れるようにする。
   */
  function toRegistrationCount(value) {
    var raw = text(value);
    if (raw === '') return 1;
    var n = parseInt(raw, 10);
    return isNaN(n) || n < 1 ? 1 : n;
  }

  /**
   * 製造番号の末尾の数字部分を offset だけ増やした値を返す（連番登録用）。
   * 例: nextSerialNo('62---100007', 1) === '62---100008'。
   * 元の桁数は0埋めで維持し、繰り上がりで桁が増える場合（999→1000等）はそのまま桁を増やす。
   * 末尾に数字が無い場合はoffsetを無視してそのまま返す（呼び出し前にバリデーション済みの前提）。
   */
  function nextSerialNo(base, offset) {
    var match = /^(.*?)(\d+)$/.exec(base);
    if (!match) return base;
    var prefix = match[1];
    var digits = match[2];
    var nextDigits = String(parseInt(digits, 10) + offset);
    while (nextDigits.length < digits.length) nextDigits = '0' + nextDigits;
    return prefix + nextDigits;
  }

  /**
   * フィルター品を入庫登録する（フィルター商品管理から選んだ商品・製造番号・入荷日付が必須）。
   * 数量（任意入力。省略時は1）を指定すると、その数だけ入庫記録をまとめて登録する。
   * 通常は同じ製造番号・入荷日・備考をそのまま複製する（同じ製造番号のものが複数個まとめて
   * 入荷した場合のため）が、`sequential`が真の場合は製造番号の末尾の数字を1件ごとに1ずつ
   * 増やして登録する（例: 62---100007 を数量15で登録すると 62---100007〜62---100021 の
   * 15件になる。末尾が数字の連番管理をしている製造番号向け）。いずれも1件ごとに独立した
   * 在庫の行として登録するので、後から個別に出庫・キャンセル・削除できる。
   * SharePointへの登録を待つ必要があるため、Promise を返す。
   * 戻り値: { ok: true, item（最後の1件）, items（登録した全件）, count }
   *       / { ok: false, errors: { フィールド名: メッセージ } }
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
    } else if (input.sequential && !/\d+$/.test(text(input.serialNo))) {
      errors.sequential = '連番登録には、末尾が数字の製造番号を入力してください。';
    }

    if (Object.keys(errors).length > 0) {
      return Promise.resolve({ ok: false, errors: errors });
    }

    var count = toRegistrationCount(input.quantity);
    var productId = text(input.productId);
    var serialNo = text(input.serialNo);
    var sequential = !!input.sequential;
    var arrivalDate = text(input.arrivalDate);
    var remarks = text(input.remarks);
    var savedItems = [];

    var chain = Promise.resolve();
    for (var i = 0; i < count; i++) {
      chain = chain.then(function () {
        var index = savedItems.length;
        var item = {
          productId: productId,
          serialNo: sequential ? nextSerialNo(serialNo, index) : serialNo,
          arrivalDate: arrivalDate,
          remarks: remarks,
          stockType: 'filter',
          status: 'in_stock',
          registeredAt: new Date().toISOString()
        };
        return App.graph.createItem('Items', itemToFields(item)).then(function (created) {
          var savedItem = itemFromGraphItem(created);
          items.push(savedItem);
          savedItems.push(savedItem);
        });
      });
    }

    return chain.then(function () {
      return {
        ok: true,
        item: decorate(savedItems[savedItems.length - 1]),
        items: savedItems.map(decorate),
        count: savedItems.length
      };
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
   * info.shippedAt を指定すると出庫日時をその値にする（任意入力。省略時は今の日時）。
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

    /* 出庫日は任意入力。指定が無ければ、今の日時をそのまま使う。 */
    var shippedAt = text(input.shippedAt) || new Date().toISOString();
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
            destinationCode: text(input.destinationCode),
            destinationSubCode: text(input.destinationSubCode),
            destinationName1: text(input.destinationName1),
            destinationName2: text(input.destinationName2),
            orderNumber1: text(input.orderNumber1),
            orderNumber2: text(input.orderNumber2),
            orderNumber3: text(input.orderNumber3),
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
      row.shippedBy, row.orderTo, row.endUser, row.remarks,
      row.destinationName1, row.destinationName2
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
          storageLocation: row.storageLocation || '',
          quantity: row.quantity,
          serialNo: row.serialNo || '',
          orderNo: row.orderNo || '',
          arrivalDate: row.arrivalDate || '',
          itemRemarks: row.remarks || '',
          remarks: shipment.remarks || '',
          shippedBy: shipment.shippedBy,
          orderTo: shipment.orderTo,
          endUser: shipment.endUser,
          destinationCode: shipment.destinationCode || '',
          destinationSubCode: shipment.destinationSubCode || '',
          destinationName1: shipment.destinationName1 || '',
          destinationName2: shipment.destinationName2 || '',
          orderNumber1: shipment.orderNumber1 || '',
          orderNumber2: shipment.orderNumber2 || '',
          orderNumber3: shipment.orderNumber3 || '',
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

  /**
   * listShipments()/listFilterShipments() が返す行を、同じ出庫操作（出庫画面での1回の送信）
   * でまとめて出庫された商品ごとにグループ化する。ship() は1回の呼び出し内で作る出庫記録
   * すべてに同じ shippedAt（と同じ shippedBy）を使うため、この2つが一致する行は同じ出庫操作
   * によるものとみなせる。履歴画面で「複数商品をまとめて出庫した」場合に1つの操作として
   * まとめて表示する（プルダウンで個々の商品を確認できるようにする）ために使う。
   * 戻り値: [{ key, shippedAt, shippedBy, destinationName1, destinationName2, remarks, rows }]
   * rows は呼び出し側が渡した並び順のまま保つ。
   */
  function groupShipmentRows(rows) {
    var map = {};
    var order = [];
    (rows || []).forEach(function (row) {
      var key = text(row.shippedAt) + '|' + text(row.shippedBy);
      if (!map[key]) {
        map[key] = {
          key: key,
          shippedAt: row.shippedAt,
          shippedBy: row.shippedBy,
          destinationName1: row.destinationName1,
          destinationName2: row.destinationName2,
          remarks: row.remarks,
          rows: []
        };
        order.push(key);
      }
      map[key].rows.push(row);
    });
    return order.map(function (key) { return map[key]; });
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
    if (isMonthLocked(shipment.shippedAt)) {
      return Promise.resolve({ ok: false, message: 'この記録は月次締め済みのためキャンセルできません。' });
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

  /**
   * 出庫履歴の内容を編集する（出庫した後に、出庫した人・出庫日・出荷先・受注番号・備考の
   * 入力間違いに気づいた場合に、キャンセルしてやり直さなくても直接直せるようにするためのもの）。
   * 何を出庫したか（商品・数量）自体は在庫の実数と結び付いているため対象外で、
   * SHIPMENT_FIELDS が指す項目（備考を除きすべて必須）だけを更新できる。状態
   * （出庫済み/キャンセル）は問わず編集できる。Promise を返す。
   */
  function updateShipment(id, data) {
    var shipment = getShipment(id);
    if (!shipment) return Promise.resolve({ ok: false, message: '対象の出庫履歴が見つかりません。' });
    if (isMonthLocked(shipment.shippedAt)) {
      return Promise.resolve({ ok: false, message: 'この記録は月次締め済みのため編集できません。' });
    }

    var input = data || {};
    var errors = {};
    SHIPMENT_FIELDS.forEach(function (field) {
      if (!text(input[field.key])) {
        errors[field.key] = field.label + 'を入力してください。';
      }
    });
    if (Object.keys(errors).length > 0) return Promise.resolve({ ok: false, errors: errors });

    var fields = {
      ShippedBy: text(input.shippedBy),
      ShippedAt: text(input.shippedAt) || shipment.shippedAt,
      DestinationCode: text(input.destinationCode),
      DestinationSubCode: text(input.destinationSubCode),
      DestinationName1: text(input.destinationName1),
      DestinationName2: text(input.destinationName2),
      OrderNumber1: text(input.orderNumber1),
      OrderNumber2: text(input.orderNumber2),
      OrderNumber3: text(input.orderNumber3),
      Remarks: text(input.remarks)
    };

    return App.graph.updateItem('Shipments', id, fields).then(function () {
      shipment.shippedBy = fields.ShippedBy;
      shipment.shippedAt = fields.ShippedAt;
      shipment.destinationCode = fields.DestinationCode;
      shipment.destinationSubCode = fields.DestinationSubCode;
      shipment.destinationName1 = fields.DestinationName1;
      shipment.destinationName2 = fields.DestinationName2;
      shipment.orderNumber1 = fields.OrderNumber1;
      shipment.orderNumber2 = fields.OrderNumber2;
      shipment.orderNumber3 = fields.OrderNumber3;
      shipment.remarks = fields.Remarks;
      return { ok: true, shipment: shipment };
    }).catch(function (err) {
      return { ok: false, message: 'SharePointの更新に失敗しました：' + err.message };
    });
  }

  /**
   * 出庫履歴を削除する。誤って出庫を確定させてしまった記録が残り続けるのを防ぐためのもので、
   * 在庫の増減とは無関係な「履歴の片付け」。そのため、キャンセル済み（在庫には既に戻っている）
   * の記録だけを対象にする。出庫済みのまま削除すると在庫の実数と合わなくなるため許可しない。
   */
  function deleteShipment(shipmentId) {
    var shipment = getShipment(shipmentId);
    if (!shipment || shipment.status !== 'cancelled') {
      return Promise.resolve({ ok: false, message: 'キャンセル済みの出庫履歴だけ削除できます。' });
    }
    if (isMonthLocked(shipment.shippedAt)) {
      return Promise.resolve({ ok: false, message: 'この記録は月次締め済みのため削除できません。' });
    }

    return App.graph.deleteItem('Shipments', shipmentId).then(function () {
      shipments = shipments.filter(function (s) { return s.id !== shipmentId; });
      return { ok: true };
    }).catch(function (err) {
      return { ok: false, message: 'SharePointからの削除に失敗しました：' + err.message };
    });
  }

  /* --- 出荷先マスタ ------------------------------------------------------ */

  /**
   * 出荷先マスタ：出庫・フィルター出庫の出荷先コード・小番・出荷先名1/2の入力補完
   * （自動連携）のために、あらかじめ登録しておく出荷先の一覧。出荷先コード・小番の
   * 組み合わせが一意になる（同じコードでも小番違いは別の出荷先として登録できる）。
   */

  /** GraphのリストアイテムをこのアプリのDestination形状に変換する。 */
  function destinationFromGraphItem(graphItem) {
    var f = graphItem.fields || {};
    return {
      id: String(graphItem.id),
      destinationCode: f.DestinationCode || '',
      destinationSubCode: f.DestinationSubCode || '',
      destinationName1: f.DestinationName1 || '',
      destinationName2: f.DestinationName2 || '',
      createdAt: f.CreatedAt || ''
    };
  }

  /** このアプリのDestination形状をGraphの Destinations リストのfields（内部名）に変換する。 */
  function destinationToFields(input, createdAt) {
    return {
      DestinationCode: text(input.destinationCode),
      DestinationSubCode: text(input.destinationSubCode),
      DestinationName1: text(input.destinationName1),
      DestinationName2: text(input.destinationName2),
      CreatedAt: createdAt || new Date().toISOString()
    };
  }

  function findDestinationById(id) {
    for (var i = 0; i < destinations.length; i++) {
      if (destinations[i].id === id) return destinations[i];
    }
    return null;
  }

  /** 出荷先コード・小番の完全一致で出荷先を探す（出庫フォームの自動連携用）。見つからなければ null。 */
  function findDestination(destinationCode, destinationSubCode) {
    var code = norm(destinationCode);
    var subCode = norm(destinationSubCode);
    for (var i = 0; i < destinations.length; i++) {
      if (norm(destinations[i].destinationCode) === code && norm(destinations[i].destinationSubCode) === subCode) {
        return destinations[i];
      }
    }
    return null;
  }

  /**
   * 出荷先コードだけが一致する出荷先を、小番の昇順ですべて返す（出庫フォームで出荷先コードを
   * 入力した時点、まだ小番を入力していない段階での自動入力用）。見つからなければ空配列。
   */
  function findDestinationsByCode(destinationCode) {
    var code = norm(destinationCode);
    return destinations
      .filter(function (d) { return norm(d.destinationCode) === code; })
      .slice()
      .sort(compareDestinations);
  }

  /**
   * 出荷先名1だけが一致する出荷先を、コード・小番の昇順ですべて返す（出庫フォームで
   * 出荷先コードより先に出荷先名を入力した時点の自動入力用）。見つからなければ空配列。
   */
  function findDestinationsByName(destinationName1) {
    var name = norm(destinationName1);
    if (!name) return [];
    return destinations
      .filter(function (d) { return norm(d.destinationName1) === name; })
      .slice()
      .sort(compareDestinations);
  }

  function compareDestinations(a, b) {
    if (a.destinationCode !== b.destinationCode) return a.destinationCode < b.destinationCode ? -1 : 1;
    return a.destinationSubCode < b.destinationSubCode ? -1 : a.destinationSubCode > b.destinationSubCode ? 1 : 0;
  }

  /** 出荷先マスタを出荷先コード・小番順で返す。 */
  function listDestinations() {
    return destinations.slice().sort(compareDestinations);
  }

  function validateDestination(input, excludeId) {
    var errors = {};
    if (!text(input.destinationCode)) {
      errors.destinationCode = '出荷先コードを入力してください。';
    }
    if (!errors.destinationCode) {
      var duplicated = destinations.some(function (d) {
        return d.id !== excludeId &&
          norm(d.destinationCode) === norm(input.destinationCode) &&
          norm(d.destinationSubCode) === norm(input.destinationSubCode);
      });
      if (duplicated) {
        errors.destinationCode = 'この出荷先コード・小番の組み合わせは既に登録されています。';
        errors._duplicate = true;
      }
    }
    return errors;
  }

  /** 出荷先マスタを登録する。出荷先コード・小番の組み合わせは重複できない。Promiseを返す。 */
  function addDestination(data) {
    var input = data || {};
    var errors = validateDestination(input, null);
    if (Object.keys(errors).length > 0) return Promise.resolve({ ok: false, errors: errors });

    var fields = destinationToFields(input);
    return App.graph.createItem('Destinations', fields).then(function (created) {
      var destination = destinationFromGraphItem(created);
      destinations.push(destination);
      return { ok: true, destination: destination };
    }).catch(function (err) {
      return { ok: false, errors: { destinationCode: 'SharePointへの登録に失敗しました：' + err.message } };
    });
  }

  /** 出荷先マスタを更新する。Promiseを返す。 */
  function updateDestination(id, data) {
    var destination = findDestinationById(id);
    if (!destination) return Promise.resolve({ ok: false, errors: { destinationCode: '対象の出荷先が見つかりません。' } });

    var input = data || {};
    var errors = validateDestination(input, id);
    if (Object.keys(errors).length > 0) return Promise.resolve({ ok: false, errors: errors });

    var fields = destinationToFields(input);
    return App.graph.updateItem('Destinations', id, fields).then(function () {
      destination.destinationCode = fields.DestinationCode;
      destination.destinationSubCode = fields.DestinationSubCode;
      destination.destinationName1 = fields.DestinationName1;
      destination.destinationName2 = fields.DestinationName2;
      return { ok: true, destination: destination };
    }).catch(function (err) {
      return { ok: false, errors: { destinationCode: 'SharePointの更新に失敗しました：' + err.message } };
    });
  }

  /** 出荷先マスタを削除する。過去の出庫履歴には影響しない（履歴側は入力値をそのまま保持しているため）。 */
  function deleteDestination(id) {
    var destination = findDestinationById(id);
    if (!destination) return Promise.resolve({ ok: false, message: '対象の出荷先が見つかりません。' });

    return App.graph.deleteItem('Destinations', id).then(function () {
      destinations = destinations.filter(function (d) { return d.id !== id; });
      return { ok: true };
    }).catch(function (err) {
      return { ok: false, message: 'SharePointからの削除に失敗しました：' + err.message };
    });
  }

  /* --- 月次締め ------------------------------------------------------------
     一度確定して会計ソフト等に取り込んだ月の記録を、後から誤って編集・削除して
     数字が合わなくなることを防ぐための機能。「何月分の記録か」は、入荷日・出庫日のような
     任意入力の業務日付ではなく、必ず値が入っている登録日時（Itemsの registeredAt /
     Shipmentsの shippedAt。どちらも登録・出庫した瞬間のタイムスタンプ）で判定する。
     締めるのは常に過去の月なので、新規登録（登録日時=今）が締め済み扱いになることはない。
     通常品・フィルター品どちらの入庫・出庫にも同じ判定を使う。 -------------------------- */

  function monthLockFromGraphItem(graphItem) {
    var f = graphItem.fields || {};
    return {
      id: String(graphItem.id),
      yearMonth: f.YearMonth || '',
      lockedAt: f.LockedAt || '',
      lockedBy: f.LockedBy || ''
    };
  }

  function monthLockToFields(yearMonth, lockedBy) {
    return {
      YearMonth: text(yearMonth),
      LockedAt: new Date().toISOString(),
      LockedBy: text(lockedBy)
    };
  }

  /** 締め済みの月を新しい順で返す。 */
  function listMonthLocks() {
    return monthLocks.slice().sort(function (a, b) {
      return a.yearMonth < b.yearMonth ? 1 : a.yearMonth > b.yearMonth ? -1 : 0;
    });
  }

  /**
   * 渡した日時（ISO文字列。時刻部分があっても先頭7文字＝年月だけを見る）が
   * 締め済みの月に含まれるかどうかを返す。空文字列や不正な値はfalse（＝締めなし扱い）。
   */
  function isMonthLocked(dateIso) {
    var yearMonth = text(dateIso).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) return false;
    return monthLocks.some(function (m) { return m.yearMonth === yearMonth; });
  }

  /** 指定した月（"YYYY-MM"）を締める。既に締め済みなら失敗を返す。Promiseを返す。 */
  function lockMonth(yearMonth, lockedBy) {
    var ym = text(yearMonth);
    if (!/^\d{4}-\d{2}$/.test(ym)) {
      return Promise.resolve({ ok: false, message: '月を選択してください。' });
    }
    if (monthLocks.some(function (m) { return m.yearMonth === ym; })) {
      return Promise.resolve({ ok: false, message: 'この月はすでに締め済みです。' });
    }

    return App.graph.createItem('MonthLocks', monthLockToFields(ym, lockedBy)).then(function (created) {
      var lock = monthLockFromGraphItem(created);
      monthLocks.push(lock);
      return { ok: true, lock: lock };
    }).catch(function (err) {
      return { ok: false, message: 'SharePointへの登録に失敗しました：' + err.message };
    });
  }

  /** 締めを解除する（間違えて締めてしまった場合の取り消し用）。Promiseを返す。 */
  function unlockMonth(id) {
    var lock = monthLocks.filter(function (m) { return m.id === id; })[0];
    if (!lock) return Promise.resolve({ ok: false, message: '対象の締め処理が見つかりません。' });

    return App.graph.deleteItem('MonthLocks', id).then(function () {
      monthLocks = monthLocks.filter(function (m) { return m.id !== id; });
      return { ok: true };
    }).catch(function (err) {
      return { ok: false, message: 'SharePointからの削除に失敗しました：' + err.message };
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
    groupFilterInStock: groupFilterInStock,
    getItem: getItem,
    getItems: getItems,
    listInboundHistory: listInboundHistory,
    listFilterInboundHistory: listFilterInboundHistory,
    updateItem: updateItem,
    deleteItem: deleteItem,
    allocateForShipment: allocateForShipment,
    addItem: addItem,
    addFilterItem: addFilterItem,
    ship: ship,
    listShipments: listShipments,
    listFilterShipments: listFilterShipments,
    groupShipmentRows: groupShipmentRows,
    cancelShipment: cancelShipment,
    updateShipment: updateShipment,
    deleteShipment: deleteShipment,
    listDestinations: listDestinations,
    findDestination: findDestination,
    findDestinationsByCode: findDestinationsByCode,
    findDestinationsByName: findDestinationsByName,
    addDestination: addDestination,
    updateDestination: updateDestination,
    deleteDestination: deleteDestination,
    listMonthLocks: listMonthLocks,
    isMonthLocked: isMonthLocked,
    lockMonth: lockMonth,
    unlockMonth: unlockMonth
  };
})();
