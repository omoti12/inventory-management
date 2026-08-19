/* 出庫：在庫一覧で選んだ商品に出庫情報を入力する。必須3項目が揃うまで出庫できない。 */
window.App = window.App || {};
App.views = App.views || {};

App.shipping = (function () {
  'use strict';

  var TARGET_COLUMNS = 7;

  var targetIds = [];
  var form, itemsBody, countLabel, submitButton, hint;

  function targets() {
    return App.store.getItems(targetIds).filter(function (item) { return item.status === 'in_stock'; });
  }

  function values() {
    var data = new FormData(form);
    return {
      shippedBy: data.get('shippedBy') || '',
      orderTo: data.get('orderTo') || '',
      endUser: data.get('endUser') || ''
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

  function removeTarget(id) {
    targetIds = targetIds.filter(function (value) { return value !== id; });
    render();
  }

  function renderTargets() {
    var items = targets();
    App.ui.clear(itemsBody);
    countLabel.textContent = items.length + ' 個';

    if (items.length === 0) {
      itemsBody.appendChild(App.ui.emptyRow(TARGET_COLUMNS, '出庫する商品が選択されていません。在庫一覧から選択してください。'));
      return;
    }

    items.forEach(function (item) {
      var tr = App.ui.el('tr');
      [
        item.productCode,
        item.productName,
        item.quantity + ' 個',
        item.orderNo,
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

  function render() {
    renderTargets();
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

    App.ui.confirm({
      title: '出庫の確認',
      message: items.length + ' 個の商品を「' + input.orderTo + '／' + input.endUser + '」宛に出庫します。よろしいですか？',
      okLabel: '出庫する'
    }).then(function (approved) {
      if (!approved) return;

      var result = App.store.ship(targetIds, input);
      if (!result.ok) {
        App.ui.showFieldErrors(form, result.errors);
        return;
      }

      targetIds = [];
      form.reset();
      App.ui.clearFieldErrors(form);
      App.inventory.clearSelection();
      App.inventory.render();
      App.history.render();
      App.ui.toast(result.count + ' 個を出庫しました。出庫履歴に登録されています。', 'success');
      App.ui.showView('inventory');
    });
  }

  function init() {
    form = document.getElementById('shipping-form');
    itemsBody = document.getElementById('shipping-items-body');
    countLabel = document.getElementById('shipping-count');
    submitButton = document.getElementById('shipping-submit');
    hint = document.getElementById('shipping-hint');

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
