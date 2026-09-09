/* フィルター入庫：フィルター商品を選び、製造番号・入荷日付を入力して登録する。 */
window.App = window.App || {};
App.views = App.views || {};

App.filterInbound = (function () {
  'use strict';

  var CATEGORY = 'filter';
  var INPUT_NAMES = ['productId', 'serialNo', 'quantity', 'receivedBy', 'arrivalDate', 'remarks'];

  var form, select, emptyNotice, submitButton, serialField, duplicateHint;

  function values() {
    var data = new FormData(form);
    var result = {};

    INPUT_NAMES.forEach(function (name) {
      result[name] = data.get(name) || '';
    });
    /* チェックボックスは未チェック時 FormData に含まれないため、get()の有無で真偽値にする。 */
    result.sequential = data.get('sequential') === 'on';

    return result;
  }

  /** フィルター商品管理の登録・更新・削除に追従して、プルダウンの選択肢を作り直す。 */
  function refreshProducts() {
    var products = App.store.listProducts(CATEGORY);
    var previous = select.value;

    App.ui.clear(select);
    var placeholder = App.ui.el('option', null, '選択してください');
    placeholder.value = '';
    select.appendChild(placeholder);

    products.forEach(function (product) {
      var option = App.ui.el('option', null, product.productCode + '　' + product.productName);
      option.value = product.id;
      select.appendChild(option);
    });

    var stillExists = products.some(function (product) { return product.id === previous; });
    select.value = stillExists ? previous : '';

    var empty = products.length === 0;
    if (emptyNotice) emptyNotice.hidden = !empty;
    select.disabled = empty;
    if (submitButton) submitButton.disabled = empty;
  }

  function resetForm() {
    form.reset();
    App.ui.clearFieldErrors(form);
    hideDuplicateHint();
  }

  function hideDuplicateHint() {
    duplicateHint.hidden = true;
    duplicateHint.textContent = '';
  }

  /**
   * 製造番号欄に入力するたび（スキャンでの入力も含む）に、その場で重複が無いか確認し、
   * あれば欄の下に注意書きを出す。登録をブロックするものではなく、送信前に気づかせるための
   * もの（実際の重複確認は送信時のonSubmit()側で行う）。
   */
  function updateDuplicateHint() {
    var value = serialField.value.trim();
    if (!value) {
      hideDuplicateHint();
      return;
    }

    var duplicates = App.store.findFilterItemsBySerialNo(value);
    if (duplicates.length === 0) {
      hideDuplicateHint();
      return;
    }

    var existing = duplicates[0];
    duplicateHint.textContent = '⚠ この製造番号はすでに登録されています（' +
      existing.productCode + ' ' + existing.productName + '・' +
      (existing.status === 'shipped' ? '出庫済み' : '在庫中') + '）。';
    duplicateHint.hidden = false;
  }

  /**
   * 登録ボタンを押してからトースト表示までの間にもう一度押せてしまうと、全く同じ内容の
   * 入庫記録が二重に登録されてしまう（Graphへの書き込みは非同期なので一瞬の隙ができる）。
   * それを防ぐため、書き込みが終わるまでボタンを無効化する。
   */
  function submitRegistration(data) {
    submitButton.disabled = true;
    App.store.addFilterItem(data).then(function (result) {
      submitButton.disabled = false;

      if (!result.ok) {
        App.ui.showFieldErrors(form, result.errors);
        return;
      }

      App.ui.clearFieldErrors(form);
      var message = 'フィルター在庫を登録しました：' + result.item.productCode + ' / ';
      if (result.count > 1 && data.sequential) {
        var firstSerial = result.items[0].serialNo;
        var lastSerial = result.items[result.items.length - 1].serialNo;
        message += '製造番号 ' + firstSerial + ' 〜 ' + lastSerial + '（' + result.count + '個）';
      } else {
        message += '製造番号 ' + result.item.serialNo;
        if (result.count > 1) message += '（' + result.count + '個）';
      }
      App.ui.toast(message, 'success');

      App.filterShipping.render();
      resetForm();
    });
  }

  /**
   * 末尾が連番の製造番号（例：62---100007）は、前回どこまで登録したか忘れて同じ番号から
   * また登録してしまう間違いが起きやすい。登録前に同じ製造番号がすでに無いか確認し、
   * あれば警告してから確認を取る（同じ番号を意図的にまとめて登録する運用＝数量欄との
   * 併用は引き続きできるよう、ここではブロックせず確認だけする）。
   */
  function onSubmit(event) {
    event.preventDefault();

    var data = values();
    data.stockType = 'filter';

    var duplicates = App.store.findFilterItemsBySerialNo(data.serialNo);
    if (duplicates.length === 0) {
      submitRegistration(data);
      return;
    }

    var existing = duplicates[0];
    var message = '製造番号「' + data.serialNo + '」は既に登録されています（' +
      existing.productCode + ' ' + existing.productName + '・' +
      (existing.status === 'shipped' ? '出庫済み' : '在庫中') + '）。' +
      (duplicates.length > 1 ? 'ほかにも' + (duplicates.length - 1) + '件、同じ製造番号があります。' : '') +
      'それでも登録しますか？';

    App.ui.confirm({
      title: '製造番号の重複',
      message: message,
      okLabel: '登録する',
      danger: true
    }).then(function (approved) {
      if (!approved) return;
      submitRegistration(data);
    });
  }

  function init() {
    form = document.getElementById('filter-inbound-form');
    select = document.getElementById('filter-inbound-product');
    emptyNotice = document.getElementById('filter-inbound-empty-notice');
    submitButton = document.getElementById('filter-inbound-submit');
    serialField = document.getElementById('filter-inbound-serial');
    duplicateHint = document.getElementById('filter-inbound-serial-duplicate-hint');

    if (!form) return;

    form.addEventListener('submit', onSubmit);
    serialField.addEventListener('input', updateDuplicateHint);

    var toProductsButton = document.getElementById('filter-inbound-to-products');
    if (toProductsButton) {
      toProductsButton.addEventListener('click', function () {
        App.ui.showView('filter-products');
      });
    }

    var scanButton = document.getElementById('filter-inbound-scan-btn');
    if (scanButton) {
      scanButton.addEventListener('click', function () {
        App.scanner.open().then(function (value) {
          if (!value) return;
          var input = form.elements.serialNo;
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          App.ui.toast('製造番号を読み取りました：' + value, 'success');
          input.focus();
        });
      });
    }

    refreshProducts();
  }

  App.views['filter-inbound'] = {
    onShow: function () {
      refreshProducts();
    },
    /* 入力途中で他の画面に移動した時は、その入力を残さず消す（戻ってきた時に古い入力が
       残って混乱しないように）。 */
    onHide: resetForm
  };

  return {
    init: init,
    refreshProducts: refreshProducts
  };
})();
