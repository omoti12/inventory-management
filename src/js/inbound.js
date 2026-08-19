/* 入庫：商品コード・製品名（自由入力可）と数量・受注番号・入庫した人などを入力して在庫に登録する。 */
window.App = window.App || {};
App.views = App.views || {};

App.inbound = (function () {
  'use strict';

  var CATEGORY = 'normal';
  var INPUT_NAMES = ['productCode', 'productName', 'quantity', 'orderNo', 'receivedBy', 'arrivalDate', 'remarks'];

  var form, codeField, nameField, codeList, nameList;
  var notice, noticeText;

  function values() {
    var data = new FormData(form);
    var result = { category: CATEGORY };
    INPUT_NAMES.forEach(function (name) { result[name] = data.get(name) || ''; });
    return result;
  }

  /** 商品コードの入力に一致する商品があれば、製品名を自動補完する。 */
  function syncProductName() {
    var code = codeField.value.trim();
    if (!code) return;
    var product = App.store.getProductByCode(code, CATEGORY);
    if (product) nameField.value = product.productName;
  }

  /** 商品マスタの登録・更新・削除に追従して、コード・製品名の候補一覧を作り直す。 */
  function refreshProducts() {
    var products = App.store.listProducts(CATEGORY);

    App.ui.clear(codeList);
    App.ui.clear(nameList);
    products.forEach(function (product) {
      var codeOption = App.ui.el('option', null, null);
      codeOption.value = product.productCode;
      codeOption.label = product.productName;
      codeList.appendChild(codeOption);

      var nameOption = App.ui.el('option', null, null);
      nameOption.value = product.productName;
      nameList.appendChild(nameOption);
    });
  }

  function showCopyNotice(row) {
    notice.hidden = false;
    noticeText.textContent = '「' + row.productCode + ' / 受注番号 ' + row.orderNo + '」をコピーしました。内容を確認して登録してください。';
  }

  function hideCopyNotice() {
    notice.hidden = true;
    noticeText.textContent = '';
  }

  /** 在庫一覧の「コピー」から呼ばれる。 */
  function startCopy(row) {
    form.elements.productCode.value = row.productCode;
    form.elements.productName.value = row.productName;
    form.elements.quantity.value = row.quantity;
    form.elements.orderNo.value = row.orderNo;
    form.elements.arrivalDate.value = row.arrivalDate || '';
    form.elements.remarks.value = row.remarks || '';

    App.ui.clearFieldErrors(form);
    showCopyNotice(row);
    setTimeout(function () {
      codeField.focus();
      codeField.select();
    }, 0);
  }

  function resetForm() {
    form.reset();
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
    App.ui.toast('入庫しました：' + result.item.productCode + ' / 数量 ' + result.item.quantity, 'success');
    App.inventory.render();
    App.products.render();
    refreshProducts();
    resetForm();
  }

  function init() {
    form = document.getElementById('inbound-form');
    codeField = document.getElementById('inbound-product-code');
    nameField = document.getElementById('inbound-product-name');
    codeList = document.getElementById('inbound-product-code-list');
    nameList = document.getElementById('inbound-product-name-list');
    notice = document.getElementById('inbound-copy-notice');
    noticeText = document.getElementById('inbound-copy-text');

    form.addEventListener('submit', onSubmit);
    form.addEventListener('input', function (event) {
      /* 入力し直したらその項目のエラー表示を消す。 */
      var name = event.target.name;
      if (!name) return;
      var message = form.querySelector('[data-error-for="' + name + '"]');
      if (message) message.textContent = '';
      event.target.classList.remove('is-invalid');
    });

    codeField.addEventListener('change', syncProductName);

    document.getElementById('inbound-reset').addEventListener('click', resetForm);
    document.getElementById('inbound-copy-clear').addEventListener('click', resetForm);

    refreshProducts();
  }

  App.views.inbound = {
    onShow: function () {
      refreshProducts();
      codeField.focus();
    }
  };

  return {
    init: init,
    startCopy: startCopy,
    refreshProducts: refreshProducts
  };
})();
