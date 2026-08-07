/* 入庫：商品マスタから型名を選び、製造番号・入荷月・案件番号を入力して在庫に登録する。 */
window.App = window.App || {};
App.views = App.views || {};

App.inbound = (function () {
  'use strict';

  var INPUT_NAMES = ['productId', 'serialNo', 'arrivalMonth', 'projectNo'];

  var form, select, dimensionsField, drawingField;
  var notice, noticeText, emptyNotice, continuous, submitButton;

  /**
   * 末尾の数字を1つ進める。桁数は維持する（0001 → 0002、S-003 → S-004）。
   * 末尾が数字でない場合は空文字を返し、手入力してもらう。
   */
  function nextSerial(serial) {
    var match = /^(.*?)(\d+)$/.exec(String(serial || ''));
    if (!match) return '';
    var prefix = match[1];
    var digits = match[2];
    var next = String(Number(digits) + 1);
    while (next.length < digits.length) next = '0' + next;
    return prefix + next;
  }

  function values() {
    var data = new FormData(form);
    var result = {};
    INPUT_NAMES.forEach(function (name) { result[name] = data.get(name) || ''; });
    return result;
  }

  /** 選択中の型名に紐づく寸法・図番を読み取り専用欄に反映する。 */
  function syncProductFields() {
    var product = select.value ? App.store.getProduct(select.value) : null;
    dimensionsField.value = product ? product.dimensions : '';
    drawingField.value = product ? product.drawingNo : '';
  }

  /** 商品マスタの登録・更新・削除に追従して、プルダウンの選択肢を作り直す。 */
  function refreshProducts() {
    var products = App.store.listProducts();
    var previous = select.value;

    App.ui.clear(select);
    var placeholder = App.ui.el('option', null, '選択してください');
    placeholder.value = '';
    select.appendChild(placeholder);

    products.forEach(function (product) {
      var option = App.ui.el('option', null, product.modelName);
      option.value = product.id;
      select.appendChild(option);
    });

    /* 選択中の商品が削除されていなければ選択を保つ。 */
    var stillExists = products.some(function (product) { return product.id === previous; });
    select.value = stillExists ? previous : '';

    var empty = products.length === 0;
    emptyNotice.hidden = !empty;
    select.disabled = empty;
    submitButton.disabled = empty;

    syncProductFields();
  }

  function showCopyNotice(row) {
    notice.hidden = false;
    noticeText.textContent = '「' + row.modelName + ' / 製造番号 ' + row.serialNo + '」をコピーしました。製造番号を確認して登録してください。';
  }

  function hideCopyNotice() {
    notice.hidden = true;
    noticeText.textContent = '';
  }

  function focusSerial() {
    var input = form.elements.serialNo;
    input.focus();
    input.select();
  }

  /** 在庫一覧の「コピー」から呼ばれる。製造番号は次の連番を候補として入れる。 */
  function startCopy(row) {
    refreshProducts();
    select.value = row.productId;
    syncProductFields();
    form.elements.serialNo.value = nextSerial(row.serialNo);
    form.elements.arrivalMonth.value = row.arrivalMonth;
    form.elements.projectNo.value = row.projectNo;

    App.ui.clearFieldErrors(form);
    showCopyNotice(row);
    setTimeout(focusSerial, 0);
  }

  function resetForm() {
    form.reset();
    refreshProducts();
    App.ui.clearFieldErrors(form);
    hideCopyNotice();
  }

  function onSubmit(event) {
    event.preventDefault();

    var result = App.store.addItem(values());

    if (!result.ok) {
      App.ui.showFieldErrors(form, result.errors);
      return;
    }

    App.ui.clearFieldErrors(form);
    App.ui.toast('入庫しました：' + result.item.modelName + ' / ' + result.item.serialNo, 'success');
    App.inventory.render();
    App.products.render();

    if (continuous.checked) {
      /* 同じ商品の連番を続けて登録できるように、製造番号だけ進めて残す。 */
      form.elements.serialNo.value = nextSerial(result.item.serialNo);
      hideCopyNotice();
      focusSerial();
    } else {
      resetForm();
    }
  }

  function init() {
    form = document.getElementById('inbound-form');
    select = document.getElementById('inbound-product');
    dimensionsField = document.getElementById('inbound-dimensions');
    drawingField = document.getElementById('inbound-drawing');
    notice = document.getElementById('inbound-copy-notice');
    noticeText = document.getElementById('inbound-copy-text');
    emptyNotice = document.getElementById('inbound-empty-notice');
    continuous = document.getElementById('inbound-continuous');
    submitButton = document.getElementById('inbound-submit');

    form.addEventListener('submit', onSubmit);
    form.addEventListener('input', function (event) {
      /* 入力し直したらその項目のエラー表示を消す。 */
      var name = event.target.name;
      if (!name) return;
      var message = form.querySelector('[data-error-for="' + name + '"]');
      if (message) message.textContent = '';
      event.target.classList.remove('is-invalid');
    });

    select.addEventListener('change', syncProductFields);

    document.getElementById('inbound-reset').addEventListener('click', resetForm);
    document.getElementById('inbound-copy-clear').addEventListener('click', resetForm);
    document.getElementById('inbound-to-products').addEventListener('click', function () {
      App.ui.showView('products');
    });
    document.getElementById('inbound-scan-btn').addEventListener('click', function () {
      App.scanner.open().then(function (value) {
        if (!value) return;
        var input = form.elements.serialNo;
        input.value = value;
        /* 手入力と同じ扱いにして、製造番号欄のエラー表示を消す。 */
        input.dispatchEvent(new Event('input', { bubbles: true }));
        App.ui.toast('製造番号を読み取りました：' + value, 'success');
        focusSerial();
      });
    });

    refreshProducts();
  }

  App.views.inbound = {
    onShow: function () {
      refreshProducts();
      if (!select.disabled) select.focus();
    }
  };

  return {
    init: init,
    startCopy: startCopy,
    refreshProducts: refreshProducts,
    nextSerial: nextSerial
  };
})();
