/* フィルター入庫：フィルター商品を選び、製造番号・入荷日付を入力して登録する。 */
window.App = window.App || {};
App.views = App.views || {};

App.filterInbound = (function () {
  'use strict';

  var CATEGORY = 'filter';
  var INPUT_NAMES = ['productId', 'serialNo', 'arrivalDate', 'remarks'];

  var form, select, emptyNotice, submitButton;

  function values() {
    var data = new FormData(form);
    var result = {};

    INPUT_NAMES.forEach(function (name) {
      result[name] = data.get(name) || '';
    });

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

  function onSubmit(event) {
    event.preventDefault();

    var data = values();
    data.stockType = 'filter';

    var result = App.store.addFilterItem(data);

    if (!result.ok) {
      App.ui.showFieldErrors(form, result.errors);
      return;
    }

    App.ui.clearFieldErrors(form);
    App.ui.toast(
      'フィルター在庫を登録しました：' +
      result.item.productCode + ' / 製造番号 ' + result.item.serialNo,
      'success'
    );

    App.filterShipping.render();
    form.reset();
  }

  function init() {
    form = document.getElementById('filter-inbound-form');
    select = document.getElementById('filter-inbound-product');
    emptyNotice = document.getElementById('filter-inbound-empty-notice');
    submitButton = document.getElementById('filter-inbound-submit');

    if (!form) return;

    form.addEventListener('submit', onSubmit);

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

  App.views.filterInbound = {
    onShow: function () {
      refreshProducts();
    }
  };

  return {
    init: init,
    refreshProducts: refreshProducts
  };
})();
