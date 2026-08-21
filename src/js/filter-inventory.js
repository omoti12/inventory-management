/* フィルター在庫一覧：検索・選択してフィルター出庫へ渡す。 */
window.App = window.App || {};
App.views = App.views || {};

App.filterInventory = (function () {
  'use strict';

  var COLUMNS = 6;

  var selectedIds = [];

  var searchForm, body, countLabel, selectAll, actionBar, selectedText;

  function currentFilter() {
    var data = new FormData(searchForm);
    return {
      productCode: data.get('productCode') || '',
      productName: data.get('productName') || '',
      serialNo: data.get('serialNo') || '',
      arrivalDate: data.get('arrivalDate') || ''
    };
  }

  /* 出庫やキャンセルで在庫状態が変わった商品を選択から外す。 */
  function pruneSelection() {
    selectedIds = selectedIds.filter(function (id) {
      var item = App.store.getItem(id);
      return item && item.status === 'in_stock';
    });
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
    renderActionBar();
  }

  function renderActionBar() {
    var count = selectedIds.length;
    actionBar.hidden = count === 0;
    selectedText.textContent = count + ' 個を選択中';
  }

  function syncSelectAll(items) {
    var visible = items.length;
    var checked = items.filter(function (item) { return isSelected(item.id); }).length;
    selectAll.checked = visible > 0 && checked === visible;
    selectAll.indeterminate = checked > 0 && checked < visible;
  }

  function render() {
    pruneSelection();

    var filter = currentFilter();
    var items = App.store.listFilterInStock(filter);

    countLabel.textContent = '該当 ' + items.length + ' 個';

    App.ui.clear(body);

    if (items.length === 0) {
      body.appendChild(App.ui.emptyRow(COLUMNS, '該当するフィルター在庫がありません。'));
      selectAll.checked = false;
      selectAll.disabled = true;
      renderActionBar();
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
        syncSelectAll(items);
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

      body.appendChild(tr);
    });

    syncSelectAll(items);
    renderActionBar();
  }

  function init() {
    searchForm = document.getElementById('filter-inventory-search');
    body = document.getElementById('filter-inventory-body');
    countLabel = document.getElementById('filter-inventory-count');
    selectAll = document.getElementById('filter-inventory-select-all');
    actionBar = document.getElementById('filter-inventory-action-bar');
    selectedText = document.getElementById('filter-inventory-selected-text');

    var onSearchInput = App.ui.debounce(render, 200);
    searchForm.addEventListener('input', onSearchInput);
    searchForm.addEventListener('submit', function (event) { event.preventDefault(); render(); });
    searchForm.addEventListener('reset', function () { setTimeout(render, 0); });

    var scanButton = document.getElementById('filter-inventory-scan-btn');
    if (scanButton) {
      scanButton.addEventListener('click', function () {
        App.scanner.open().then(function (value) {
          if (!value) return;
          searchForm.elements.serialNo.value = value;
          App.ui.toast('製造番号を読み取りました：' + value, 'success');
          render();
        });
      });
    }

    selectAll.addEventListener('change', function () {
      var items = App.store.listFilterInStock(currentFilter());
      items.forEach(function (item) { toggleSelection(item.id, selectAll.checked); });
      render();
    });

    document.getElementById('filter-inventory-clear-selection').addEventListener('click', function () {
      selectedIds = [];
      render();
    });

    document.getElementById('filter-inventory-to-shipping').addEventListener('click', function () {
      if (selectedIds.length === 0) return;
      App.filterShipping.start(selectedIds.slice());
      App.ui.showView('filter-shipping');
    });
  }

  /** 出庫やキャンセル後に呼ばれ、選択を解除して再描画する。 */
  function clearSelection() {
    selectedIds = [];
  }

  App.views['filter-inventory'] = { onShow: render };

  return { init: init, render: render, clearSelection: clearSelection };
})();
