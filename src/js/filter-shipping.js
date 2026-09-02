/* フィルター出庫：フィルター在庫一覧で選んだ商品に出庫情報を入力する（通常の出庫を参考に作成）。 */
window.App = window.App || {};
App.views = App.views || {};

App.filterShipping = (function () {
  'use strict';

  var TARGET_COLUMNS = 6;

  var targetIds = [];
  var form, itemsBody, countLabel, submitButton, hint;

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
      remarks: data.get('remarks') || ''
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
      hint.textContent = 'フィルター在庫一覧から出庫する商品を選択してください。';
    } else if (missing.length > 0) {
      hint.textContent = '未入力：' + missing.map(function (f) { return f.label; }).join('、');
    } else {
      hint.textContent = '';
    }
  }

  function removeTarget(id) {
    targetIds = targetIds.filter(function (value) { return value !== id; });
    render();
  }

  function renderTargets() {
    var items = targets();
    App.ui.clear(itemsBody);
    countLabel.textContent = items.length + ' 個';

    if (items.length === 0) {
      itemsBody.appendChild(App.ui.emptyRow(TARGET_COLUMNS, '出庫する商品が選択されていません。フィルター在庫一覧から選択してください。'));
      return;
    }

    items.forEach(function (item) {
      var tr = App.ui.el('tr');
      [
        item.productCode,
        item.productName,
        item.serialNo,
        item.arrivalDate || '—'
      ].forEach(function (value) {
        tr.appendChild(App.ui.el('td', null, value));
      });
      tr.appendChild(App.ui.el('td', 'col-remarks', item.remarks || ''));

      var actionCell = App.ui.el('td', 'col-action');
      var removeButton = App.ui.el('button', 'btn btn--ghost btn--sm', '外す');
      removeButton.type = 'button';
      removeButton.addEventListener('click', function () { removeTarget(item.id); });
      actionCell.appendChild(removeButton);
      tr.appendChild(actionCell);

      itemsBody.appendChild(tr);
    });
  }

  function render() {
    renderTargets();
    updateSubmitState();
  }

  /** フィルター在庫一覧から呼ばれる。 */
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

    App.ui.confirm({
      title: 'フィルター出庫の確認',
      message: items.length + ' 個の商品を「' + input.orderTo + '／' + input.endUser + '」宛に出庫します。よろしいですか？',
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
        App.filterInventory.clearSelection();
        App.filterInventory.render();
        App.filterHistory.render();
        if (result.conflictCount) {
          App.ui.toast(
            result.count + ' 個を出庫しました。' + result.conflictQty + ' 個は別の担当者が既に出庫済みのため対象外です。',
            'success'
          );
        } else {
          App.ui.toast(result.count + ' 個を出庫しました。フィルター出庫履歴に登録されています。', 'success');
        }
        App.ui.showView('filter-inventory');
      });
    });
  }

  function init() {
    form = document.getElementById('filter-shipping-form');
    itemsBody = document.getElementById('filter-shipping-items-body');
    countLabel = document.getElementById('filter-shipping-count');
    submitButton = document.getElementById('filter-shipping-submit');
    hint = document.getElementById('filter-shipping-hint');

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

  return { init: init, start: start, render: render };
})();
