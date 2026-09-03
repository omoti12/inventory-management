/* フィルター出庫：フィルター在庫一覧で選んだ商品に出庫情報を入力する（通常の出庫を参考に作成）。 */
window.App = window.App || {};
App.views = App.views || {};

App.filterShipping = (function () {
  'use strict';

  var TARGET_COLUMNS = 6;

  var targetIds = [];
  var form, itemsBody, countLabel, submitButton, hint;
  var destinationCodeField, destinationSubCodeField, destinationCodeList;
  var destinationName1Field, destinationName1List;

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
    var shippedDate = data.get('shippedDate') || '';
    return {
      shippedBy: data.get('shippedBy') || '',
      /* shippedDate はフォームの生の値（必須項目チェック用）。shippedAt はそれを実際の
         出庫日時（ISO日時）に変換した値で、こちらをSharePointへの保存に使う。 */
      shippedDate: shippedDate,
      shippedAt: App.ui.combineDateWithNow(shippedDate),
      remarks: data.get('remarks') || '',
      /* 会計/販売システムへのCSV取込用の項目。 */
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

  /** 出荷先マスタの登録・更新・削除に追従して、出荷先コード・出荷先名1の候補一覧を作り直す。 */
  function refreshDestinations() {
    var destinations = App.store.listDestinations();
    App.ui.clear(destinationCodeList);
    App.ui.clear(destinationName1List);
    var seenNames = {};
    destinations.forEach(function (destination) {
      var codeOption = App.ui.el('option', null, null);
      codeOption.value = destination.destinationCode;
      codeOption.label = destination.destinationName1;
      destinationCodeList.appendChild(codeOption);

      /* 出荷先名1は同じ名前の出荷先（小番違い）が複数あり得るので、候補には重複させない。 */
      var nameKey = destination.destinationName1.trim().toLowerCase();
      if (!nameKey || seenNames[nameKey]) return;
      seenNames[nameKey] = true;
      var nameOption = App.ui.el('option', null, null);
      nameOption.value = destination.destinationName1;
      destinationName1List.appendChild(nameOption);
    });
  }

  /**
   * 値をJSから直接書き換えた入力欄に input イベントを発火させる。フォームの input リスナー
   * （エラー表示のクリア・出庫ボタンの活性状態の更新）は input イベント前提のため、これを
   * 発火させないと「値は入っているのに未入力エラーが残ったまま」になってしまう。
   */
  function fireInput(field) {
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function fillDestinationName(destination) {
    form.elements.destinationName1.value = destination.destinationName1;
    form.elements.destinationName2.value = destination.destinationName2;
    fireInput(form.elements.destinationName1);
    fireInput(form.elements.destinationName2);
  }

  /**
   * 出荷先コードだけを入力/変更した時点で呼ぶ。そのコードに登録済みの出荷先があれば、
   * 出荷先小番・出荷先名1/2をまとめて自動入力する（コードに複数の小番がある場合は、
   * 一番小さい小番のものを仮に採用する。違っていれば小番を直せば下のsyncDestinationFromSubCode
   * が正しい方に合わせ直す）。一致しなければ何もしない（自由入力のまま）。
   */
  function syncDestinationFromCode() {
    var code = destinationCodeField.value.trim();
    if (!code) return;
    var matches = App.store.findDestinationsByCode(code);
    if (matches.length === 0) return;
    var destination = matches[0];
    destinationSubCodeField.value = destination.destinationSubCode;
    fireInput(destinationSubCodeField);
    fillDestinationName(destination);
  }

  /**
   * 出荷先小番を入力/変更した時点で呼ぶ。出荷先コード・小番の完全一致で出荷先名1/2を
   * 上書きする（既に入力済みでも、登録済みの出荷先を選び直した場合は上書きする）。
   * 一致しなければ何もしない（自由入力のまま）。
   */
  function syncDestinationFromSubCode() {
    var code = destinationCodeField.value.trim();
    if (!code) return;
    var destination = App.store.findDestination(code, destinationSubCodeField.value.trim());
    if (!destination) return;
    fillDestinationName(destination);
  }

  function fillDestinationCode(destination) {
    destinationCodeField.value = destination.destinationCode;
    destinationSubCodeField.value = destination.destinationSubCode;
    form.elements.destinationName2.value = destination.destinationName2;
    fireInput(destinationCodeField);
    fireInput(destinationSubCodeField);
    fireInput(form.elements.destinationName2);
  }

  /**
   * 出荷先名1を先に入力/変更した時点で呼ぶ（コード・小番より先に名前で選ぶ場合の入り口）。
   * その名前に一致する出荷先があれば、出荷先コード・小番・出荷先名2をまとめて自動入力する
   * （同じ名前で複数の出荷先がある場合は、コード・小番の昇順で一番先頭のものを仮に採用する。
   * 違っていれば出荷先コード・小番を直せば上のsyncDestinationFromCode/SubCodeが正しい方に
   * 合わせ直す）。一致しなければ何もしない（自由入力のまま）。
   */
  function syncDestinationFromName() {
    var name = form.elements.destinationName1.value.trim();
    if (!name) return;
    var matches = App.store.findDestinationsByName(name);
    if (matches.length === 0) return;
    fillDestinationCode(matches[0]);
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
    var destination = [input.destinationName1, input.destinationName2].filter(Boolean).join('／');

    App.ui.confirm({
      title: 'フィルター出庫の確認',
      message: items.length + ' 個の商品を' + (destination ? '「' + destination + '」宛に' : '') + '出庫します。よろしいですか？',
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
    destinationCodeField = document.getElementById('filter-shipping-destination-code');
    destinationSubCodeField = document.getElementById('filter-shipping-destination-sub-code');
    destinationCodeList = document.getElementById('filter-shipping-destination-code-list');
    destinationName1Field = document.getElementById('filter-shipping-destination-name1');
    destinationName1List = document.getElementById('filter-shipping-destination-name1-list');

    destinationCodeField.addEventListener('change', syncDestinationFromCode);
    destinationSubCodeField.addEventListener('change', syncDestinationFromSubCode);
    destinationName1Field.addEventListener('change', syncDestinationFromName);
    refreshDestinations();

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

  App.views['filter-shipping'] = {
    onShow: function () {
      refreshDestinations();
      render();
    }
  };

  return { init: init, start: start, render: render, refreshDestinations: refreshDestinations };
})();
