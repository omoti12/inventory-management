/* 出庫：在庫一覧で選んだ商品に出庫情報を入力する。必須3項目が揃うまで出庫できない。 */
window.App = window.App || {};
App.views = App.views || {};

App.shipping = (function () {
  'use strict';

  var TARGET_COLUMNS = 4;
  var SEARCH_COLUMNS = 6;

  var targetIds = [];
  var form, itemsBody, countLabel, submitButton, hint;
  var searchForm, searchBody;

  /** 入荷日が古いものから先に出庫する（入荷日不明のものは後ろに回す）。 */
  function byArrivalDateAsc(a, b) {
    var da = a.arrivalDate || '9999-99-99';
    var db = b.arrivalDate || '9999-99-99';
    return da < db ? -1 : da > db ? 1 : 0;
  }

  function targets() {
    return App.store.getItems(targetIds)
      .filter(function (item) { return item.status === 'in_stock'; })
      .sort(byArrivalDateAsc);
  }

  function values() {
    var data = new FormData(form);
    return {
      shippedBy: data.get('shippedBy') || '',
      /* 出庫日は任意入力。指定が無ければ null にし、store.js側で今の日時を使う。 */
      shippedAt: App.ui.combineDateWithNow(data.get('shippedDate')),
      orderTo: data.get('orderTo') || '',
      endUser: data.get('endUser') || '',
      remarks: data.get('remarks') || '',
      /* 会計/販売システムへのCSV取込用の項目（すべて任意入力）。 */
      destinationCode: data.get('destinationCode') || '',
      destinationSubCode: data.get('destinationSubCode') || '',
      destinationName1: data.get('destinationName1') || '',
      destinationName2: data.get('destinationName2') || '',
      orderNumber1: data.get('orderNumber1') || '',
      orderNumber2: data.get('orderNumber2') || '',
      orderNumber3: data.get('orderNumber3') || ''
    };
  }

  function missingFields() {
    var input = values();
    return App.store.SHIPMENT_FIELDS.filter(function (field) {
      return String(input[field.key]).trim() === '';
    });
  }

  /** 必須項目の充足状況を見て、出庫ボタンの活性と案内文を更新する。 */
  function updateSubmitState() {
    var missing = missingFields();
    var count = targets().length;

    submitButton.disabled = missing.length > 0 || count === 0;

    if (count === 0) {
      hint.textContent = '在庫一覧から出庫する商品を選択してください。';
    } else if (missing.length > 0) {
      hint.textContent = '未入力：' + missing.map(function (f) { return f.label; }).join('、');
    } else {
      hint.textContent = '';
    }
  }

  /** 出庫対象を商品コード単位でまとめ、数量を合算する（バッチ違いは区別しない）。 */
  function targetGroups() {
    var map = {};
    var order = [];
    targets().forEach(function (item) {
      if (!map[item.productId]) {
        map[item.productId] = {
          productId: item.productId,
          productCode: item.productCode,
          productName: item.productName,
          count: 0,
          itemIds: []
        };
        order.push(item.productId);
      }
      map[item.productId].count += parseInt(item.quantity, 10) || 0;
      map[item.productId].itemIds.push(item.id);
    });
    return order.map(function (key) { return map[key]; });
  }

  function removeTargetGroup(itemIds) {
    targetIds = targetIds.filter(function (id) { return itemIds.indexOf(id) === -1; });
    render();
  }

  /** 指定商品コードの在庫から、古いバッチ順に数量ぶんを確保して出庫対象に加える（必要ならバッチを分割する）。 */
  function addGroupToTargets(productId, quantity) {
    App.store.allocateForShipment(productId, quantity).then(function (ids) {
      ids.forEach(function (id) { if (targetIds.indexOf(id) === -1) targetIds.push(id); });
      render();
    });
  }

  function renderTargets() {
    var groups = targetGroups();
    App.ui.clear(itemsBody);
    var totalCount = groups.reduce(function (sum, group) { return sum + group.count; }, 0);
    countLabel.textContent = totalCount + ' 個';

    if (groups.length === 0) {
      itemsBody.appendChild(App.ui.emptyRow(TARGET_COLUMNS, '出庫する商品が選択されていません。上の検索から追加するか、在庫一覧から選択してください。'));
      return;
    }

    groups.forEach(function (group) {
      var tr = App.ui.el('tr');
      tr.appendChild(App.ui.el('td', null, group.productCode));
      tr.appendChild(App.ui.el('td', null, group.productName));
      tr.appendChild(App.ui.el('td', 'col-num', group.count + ' 個'));

      var actionCell = App.ui.el('td', 'col-action');
      var removeButton = App.ui.el('button', 'btn btn--ghost btn--sm', '外す');
      removeButton.type = 'button';
      removeButton.addEventListener('click', function () { removeTargetGroup(group.itemIds); });
      actionCell.appendChild(removeButton);
      tr.appendChild(actionCell);

      itemsBody.appendChild(tr);
    });
  }

  function searchFilter() {
    var data = new FormData(searchForm);
    return {
      productCode: data.get('productCode') || '',
      productName: data.get('productName') || ''
    };
  }

  /** まだ出庫リストに入れていない在庫を、商品コード単位でまとめて集計する。 */
  function searchGroups() {
    var available = App.store.listInStock(searchFilter())
      .filter(function (item) { return targetIds.indexOf(item.id) === -1; });

    var map = {};
    var order = [];
    available.forEach(function (item) {
      if (!map[item.productId]) {
        map[item.productId] = {
          productId: item.productId,
          productCode: item.productCode,
          productName: item.productName,
          storageLocation: item.storageLocation || '',
          count: 0
        };
        order.push(item.productId);
      }
      map[item.productId].count += parseInt(item.quantity, 10) || 0;
    });
    return order.map(function (key) { return map[key]; }).filter(function (g) { return g.count > 0; });
  }

  /** 商品まとめの一覧として検索結果を表示し、出荷したい数を指定して追加できるようにする。 */
  function renderSearch() {
    var groups = searchGroups();

    App.ui.clear(searchBody);

    if (groups.length === 0) {
      searchBody.appendChild(App.ui.emptyRow(SEARCH_COLUMNS, '該当する在庫がありません。'));
      return;
    }

    groups.forEach(function (group) {
      var tr = App.ui.el('tr');
      tr.appendChild(App.ui.el('td', null, group.productCode));
      tr.appendChild(App.ui.el('td', null, group.productName));
      tr.appendChild(App.ui.el('td', null, group.storageLocation || '—'));
      tr.appendChild(App.ui.el('td', 'col-num', group.count + ' 個'));

      var qtyCell = App.ui.el('td', 'col-num');
      var qtyInput = App.ui.el('input');
      qtyInput.type = 'number';
      qtyInput.min = '0';
      qtyInput.max = String(group.count);
      qtyInput.step = '1';
      qtyInput.value = '0';
      qtyInput.style.width = '80px';
      qtyInput.setAttribute('aria-label', group.productCode + ' の出荷したい数');
      qtyCell.appendChild(qtyInput);
      tr.appendChild(qtyCell);

      var actionCell = App.ui.el('td', 'col-action');
      var addButton = App.ui.el('button', 'btn btn--ghost btn--sm', '追加');
      addButton.type = 'button';
      addButton.addEventListener('click', function () {
        var qty = parseInt(qtyInput.value, 10);
        if (!qty || qty < 1) return;
        if (qty > group.count) qty = group.count;
        addGroupToTargets(group.productId, qty);
      });
      actionCell.appendChild(addButton);
      tr.appendChild(actionCell);

      searchBody.appendChild(tr);
    });
  }

  function render() {
    renderTargets();
    renderSearch();
    updateSubmitState();
  }

  /** 在庫一覧から呼ばれる。 */
  function start(ids) {
    targetIds = ids.slice();
    form.reset();
    App.ui.clearFieldErrors(form);
    render();
  }

  function onSubmit(event) {
    event.preventDefault();

    var input = values();
    var missing = missingFields();
    if (missing.length > 0) {
      var errors = {};
      missing.forEach(function (field) { errors[field.key] = field.label + 'を入力してください。'; });
      App.ui.showFieldErrors(form, errors);
      return;
    }

    var items = targets();
    var totalQty = items.reduce(function (sum, item) { return sum + (parseInt(item.quantity, 10) || 0); }, 0);

    App.ui.confirm({
      title: '出庫の確認',
      message: totalQty + ' 個の商品を「' + input.orderTo + '／' + input.endUser + '」宛に出庫します。よろしいですか？',
      okLabel: '出庫する'
    }).then(function (approved) {
      if (!approved) return;

      App.store.ship(targetIds, input).then(function (result) {
        if (!result.ok) {
          if (result.errors._items) App.ui.toast(result.errors._items, 'error');
          App.ui.showFieldErrors(form, result.errors);
          return;
        }

        targetIds = [];
        form.reset();
        App.ui.clearFieldErrors(form);
        App.inventory.clearSelection();
        App.inventory.render();
        App.history.render();
        if (result.conflictCount) {
          App.ui.toast(
            result.count + ' 個を出庫しました。' + result.conflictQty + ' 個は別の担当者が既に出庫済みのため対象外です。',
            'success'
          );
        } else {
          App.ui.toast(totalQty + ' 個を出庫しました。出庫履歴に登録されています。', 'success');
        }
        App.ui.showView('inventory');
      });
    });
  }

  function init() {
    form = document.getElementById('shipping-form');
    itemsBody = document.getElementById('shipping-items-body');
    countLabel = document.getElementById('shipping-count');
    submitButton = document.getElementById('shipping-submit');
    hint = document.getElementById('shipping-hint');
    searchForm = document.getElementById('shipping-search');
    searchBody = document.getElementById('shipping-search-body');

    var onSearchInput = App.ui.debounce(renderSearch, 200);
    searchForm.addEventListener('input', onSearchInput);
    searchForm.addEventListener('submit', function (event) { event.preventDefault(); renderSearch(); });
    searchForm.addEventListener('reset', function () { setTimeout(renderSearch, 0); });

    form.addEventListener('submit', onSubmit);
    form.addEventListener('input', function (event) {
      var name = event.target.name;
      if (name) {
        var message = form.querySelector('[data-error-for="' + name + '"]');
        if (message) message.textContent = '';
        event.target.classList.remove('is-invalid');
      }
      updateSubmitState();
    });

    /* 入力欄から離れたときに、未入力ならその場でエラーを出す。 */
    form.addEventListener('focusout', function (event) {
      var input = event.target;
      if (!input.name) return;
      var field = App.store.SHIPMENT_FIELDS.filter(function (f) { return f.key === input.name; })[0];
      if (!field) return;
      var message = form.querySelector('[data-error-for="' + input.name + '"]');
      if (input.value.trim() === '') {
        if (message) message.textContent = field.label + 'を入力してください。';
        input.classList.add('is-invalid');
      }
    });
  }

  App.views.shipping = { onShow: render };

  return { init: init, start: start, render: render };
})();
