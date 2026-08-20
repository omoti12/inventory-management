/* フィルター出庫：フィルター在庫から出庫する商品を選び、出庫情報を入力する（元の出庫を参考に作成）。 */
window.App = window.App || {};
App.views = App.views || {};

App.filterShipping = (function () {
  'use strict';

  var STOCK_COLUMNS = 6;
  var TARGET_COLUMNS = 6;

  var selectedIds = [];
  var stockBody, stockCountLabel, selectAll;
  var form, itemsBody, countLabel, submitButton, hint;

  function stockItems() {
    return App.store.listFilterInStock();
  }

  function targets() {
    return App.store.getItems(selectedIds).filter(function (item) { return item.status === 'in_stock'; });
  }

  function isSelected(id) {
    return selectedIds.indexOf(id) !== -1;
  }

  function toggleSelection(id, checked) {
    if (checked && !isSelected(id)) {
      selectedIds.push(id);
    } else if (!checked) {
      selectedIds = selectedIds.filter(function (value) { return value !== id; });
    }
  }

  function values() {
    var data = new FormData(form);
    return {
      shippedBy: data.get('shippedBy') || '',
      orderTo: data.get('orderTo') || '',
      endUser: data.get('endUser') || '',
      remarks: data.get('remarks') || ''
    };
  }

  function missingFields() {
    var input = values();
    return App.store.SHIPMENT_FIELDS.filter(function (field) {
      return String(input[field.key]).trim() === '';
    });
  }

  function updateSubmitState() {
    var missing = missingFields();
    var count = targets().length;

    submitButton.disabled = missing.length > 0 || count === 0;

    if (count === 0) {
      hint.textContent = '上のフィルター在庫から出庫する商品を選択してください。';
    } else if (missing.length > 0) {
      hint.textContent = '未入力：' + missing.map(function (f) { return f.label; }).join('、');
    } else {
      hint.textContent = '';
    }
  }

  function renderStock() {
    var items = stockItems();
    App.ui.clear(stockBody);
    stockCountLabel.textContent = '該当 ' + items.length + ' 個';

    if (items.length === 0) {
      stockBody.appendChild(App.ui.emptyRow(STOCK_COLUMNS, 'フィルター在庫がありません。'));
      selectAll.checked = false;
      selectAll.disabled = true;
      return;
    }

    selectAll.disabled = false;
    items.forEach(function (item) {
      var tr = App.ui.el('tr');

      var checkCell = App.ui.el('td', 'col-check');
      var checkbox = App.ui.el('input');
      checkbox.type = 'checkbox';
      checkbox.checked = isSelected(item.id);
      checkbox.setAttribute('aria-label', item.productCode + ' ' + item.serialNo + ' を選択');
      checkbox.addEventListener('change', function () {
        toggleSelection(item.id, checkbox.checked);
        render();
      });
      checkCell.appendChild(checkbox);
      tr.appendChild(checkCell);

      [
        item.productCode,
        item.productName,
        item.serialNo,
        item.arrivalDate || '—',
        item.remarks || ''
      ].forEach(function (value) {
        tr.appendChild(App.ui.el('td', null, value));
      });

      stockBody.appendChild(tr);
    });

    var visible = items.length;
    var checked = items.filter(function (item) { return isSelected(item.id); }).length;
    selectAll.checked = visible > 0 && checked === visible;
    selectAll.indeterminate = checked > 0 && checked < visible;
  }

  function removeTarget(id) {
    toggleSelection(id, false);
    render();
  }

  function renderTargets() {
    var items = targets();
    App.ui.clear(itemsBody);
    countLabel.textContent = items.length + ' 個';

    if (items.length === 0) {
      itemsBody.appendChild(App.ui.emptyRow(TARGET_COLUMNS, '出庫する商品が選択されていません。上のフィルター在庫から選択してください。'));
      return;
    }

    items.forEach(function (item) {
      var tr = App.ui.el('tr');
      [
        item.productCode,
        item.productName,
        item.serialNo,
        item.arrivalDate || '—',
        item.remarks || ''
      ].forEach(function (value) {
        tr.appendChild(App.ui.el('td', null, value));
      });

      var actionCell = App.ui.el('td', 'col-action');
      var removeButton = App.ui.el('button', 'btn btn--ghost btn--sm', '外す');
      removeButton.type = 'button';
      removeButton.addEventListener('click', function () { removeTarget(item.id); });
      actionCell.appendChild(removeButton);
      tr.appendChild(actionCell);

      itemsBody.appendChild(tr);
    });
  }

  /* 出庫やキャンセルで在庫状態が変わった商品を選択から外す。 */
  function pruneSelection() {
    selectedIds = selectedIds.filter(function (id) {
      var item = App.store.getItem(id);
      return item && item.status === 'in_stock';
    });
  }

  function render() {
    pruneSelection();
    renderStock();
    renderTargets();
    updateSubmitState();
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

    App.ui.confirm({
      title: 'フィルター出庫の確認',
      message: items.length + ' 個の商品を「' + input.orderTo + '／' + input.endUser + '」宛に出庫します。よろしいですか？',
      okLabel: '出庫する'
    }).then(function (approved) {
      if (!approved) return;

      var result = App.store.ship(selectedIds, input);
      if (!result.ok) {
        App.ui.showFieldErrors(form, result.errors);
        return;
      }

      selectedIds = [];
      form.reset();
      App.ui.clearFieldErrors(form);
      render();
      App.filterHistory.render();
      App.ui.toast(result.count + ' 個を出庫しました。フィルター出庫履歴に登録されています。', 'success');
    });
  }

  function init() {
    stockBody = document.getElementById('filter-shipping-stock-body');
    stockCountLabel = document.getElementById('filter-shipping-stock-count');
    selectAll = document.getElementById('filter-shipping-select-all');
    form = document.getElementById('filter-shipping-form');
    itemsBody = document.getElementById('filter-shipping-items-body');
    countLabel = document.getElementById('filter-shipping-count');
    submitButton = document.getElementById('filter-shipping-submit');
    hint = document.getElementById('filter-shipping-hint');

    selectAll.addEventListener('change', function () {
      stockItems().forEach(function (item) { toggleSelection(item.id, selectAll.checked); });
      render();
    });

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

  App.views['filter-shipping'] = { onShow: render };

  return { init: init, render: render };
})();
