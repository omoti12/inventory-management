/* 入庫：商品コード・製品名（自由入力可）と数量・入庫した人などを入力して在庫に登録する。 */
window.App = window.App || {};
App.views = App.views || {};

App.inbound = (function () {
  'use strict';

  var CATEGORY = 'normal';
  var INPUT_NAMES = ['productCode', 'productName', 'quantity', 'receivedBy', 'arrivalDate', 'remarks'];

  var form, codeField, nameField, codeList, nameList, submitButton;
  var notice, noticeText;

  function values() {
    var data = new FormData(form);
    var result = { category: CATEGORY };
    INPUT_NAMES.forEach(function (name) { result[name] = data.get(name) || ''; });
    return result;
  }

  /**
   * 商品コードの入力に一致する商品があれば、製品名をその登録済みの名前で自動補完する。
   * 一致する商品が無い（新しい商品コード）場合は、商品コードと製品名を同じ運用にしているため、
   * 商品コードをそのまま製品名にコピーする。
   */
  function syncProductName() {
    var code = codeField.value.trim();
    if (!code) return;
    var product = App.store.getProductByCode(code, CATEGORY);
    nameField.value = product ? product.productName : codeField.value;
  }

  /**
   * 製品名の入力に一致する登録済み商品があれば、商品コードをその商品の正しいコードに更新する
   * （商品コードに既に値が入っていても、名前欄で別の登録済み商品を選び直した場合は上書きする）。
   * 一致する商品が無い（新しい製品名）場合は、商品コードが空の時だけ製品名をそのままコピーする
   * （既に入力済みの商品コードを、無関係な新規名で誤って上書きしないため）。
   */
  function syncProductCode() {
    var name = nameField.value.trim();
    if (!name) return;

    var products = App.store.listProducts(CATEGORY);
    var match = products.filter(function (product) {
      return product.productName.trim().toLowerCase() === name.toLowerCase();
    })[0];

    if (match) {
      codeField.value = match.productCode;
    } else if (!codeField.value.trim()) {
      codeField.value = name;
    }
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
    noticeText.textContent = '「' + row.productCode + '」をコピーしました。内容を確認して登録してください。';
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

  /** Enterキーで送信してしまわず、次の項目に移動する。備考欄（複数行）は改行を優先する。 */
  function onKeydown(event) {
    if (event.key !== 'Enter' || event.target.tagName === 'TEXTAREA') return;
    event.preventDefault();
    var index = INPUT_NAMES.indexOf(event.target.name);
    if (index === -1 || index === INPUT_NAMES.length - 1) return;
    var nextField = form.elements[INPUT_NAMES[index + 1]];
    if (nextField) nextField.focus();
  }

  /**
   * 登録ボタンを押してからトースト表示までの間にもう一度押せてしまうと、全く同じ内容の
   * 入庫記録が二重に登録されてしまう（Graphへの書き込みは非同期なので一瞬の隙ができる）。
   * それを防ぐため、書き込みが終わるまでボタンを無効化する。
   */
  function onSubmit(event) {
    event.preventDefault();

    submitButton.disabled = true;
    App.store.addItem(values()).then(function (result) {
      submitButton.disabled = false;

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
    });
  }

  function init() {
    form = document.getElementById('inbound-form');
    codeField = document.getElementById('inbound-product-code');
    nameField = document.getElementById('inbound-product-name');
    codeList = document.getElementById('inbound-product-code-list');
    nameList = document.getElementById('inbound-product-name-list');
    notice = document.getElementById('inbound-copy-notice');
    noticeText = document.getElementById('inbound-copy-text');
    submitButton = document.getElementById('inbound-submit');

    form.addEventListener('submit', onSubmit);
    form.addEventListener('keydown', onKeydown);
    form.addEventListener('input', function (event) {
      /* 入力し直したらその項目のエラー表示を消す。 */
      var name = event.target.name;
      if (!name) return;
      var message = form.querySelector('[data-error-for="' + name + '"]');
      if (message) message.textContent = '';
      event.target.classList.remove('is-invalid');
    });

    codeField.addEventListener('change', syncProductName);
    nameField.addEventListener('change', syncProductCode);

    document.getElementById('inbound-reset').addEventListener('click', resetForm);
    document.getElementById('inbound-copy-clear').addEventListener('click', resetForm);

    refreshProducts();
  }

  App.views.inbound = {
    onShow: function () {
      refreshProducts();
      codeField.focus();
    },
    /* 入力途中で他の画面に移動した時は、その入力を残さず消す（戻ってきた時に古い入力が
       残って混乱しないように）。 */
    onHide: resetForm
  };

  return {
    init: init,
    startCopy: startCopy,
    refreshProducts: refreshProducts
  };
})();
