/* フィルター在庫一覧：検索・商品まとめ/明細の切替・選択してフィルター出庫へ渡す。 */
window.App = window.App || {};
App.views = App.views || {};

App.filterInventory = (function () {
  'use strict';

  var DETAIL_COLUMNS = 6;
  var GROUP_COLUMNS = 5;

  var mode = 'group';
  var selectedIds = [];

  var searchForm, detailBody, groupBody, detailWrap, groupWrap;
  var countLabel, selectAll, groupSelectAll, actionBar, selectedText;

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

  function syncGroupSelectAll(groups) {
    var total = 0;
    var checked = 0;
    groups.forEach(function (group) {
      total += group.itemIds.length;
      checked += group.itemIds.filter(function (id) { return isSelected(id); }).length;
    });
    groupSelectAll.checked = total > 0 && checked === total;
    groupSelectAll.indeterminate = checked > 0 && checked < total;
  }

  function renderDetail(items) {
    App.ui.clear(detailBody);

    if (items.length === 0) {
      detailBody.appendChild(App.ui.emptyRow(DETAIL_COLUMNS, '該当するフィルター在庫がありません。'));
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
        syncSelectAll(items);
      });
      checkCell.appendChild(checkbox);
      tr.appendChild(checkCell);

      [
        item.productCode,
        item.productName,
        item.serialNo,
        item.arrivalDate || '—'
      ].forEach(function (value) {
        tr.appendChild(App.ui.el('td', null, value));
      });
      tr.appendChild(App.ui.el('td', 'col-remarks', item.remarks || ''));

      detailBody.appendChild(tr);
    });

    syncSelectAll(items);
  }

  function renderGroup(groups) {
    App.ui.clear(groupBody);

    if (groups.length === 0) {
      groupBody.appendChild(App.ui.emptyRow(GROUP_COLUMNS, '該当するフィルター在庫がありません。'));
      groupSelectAll.checked = false;
      groupSelectAll.disabled = true;
      return;
    }

    groupSelectAll.disabled = false;
    groups.forEach(function (group) {
      var tr = App.ui.el('tr');

      var checkCell = App.ui.el('td', 'col-check');
      var checkbox = App.ui.el('input');
      checkbox.type = 'checkbox';
      var checkedCount = group.itemIds.filter(function (id) { return isSelected(id); }).length;
      checkbox.checked = group.itemIds.length > 0 && checkedCount === group.itemIds.length;
      checkbox.indeterminate = checkedCount > 0 && checkedCount < group.itemIds.length;
      checkbox.setAttribute('aria-label', group.productCode + ' を選択');
      checkbox.addEventListener('change', function () {
        group.itemIds.forEach(function (id) { toggleSelection(id, checkbox.checked); });
        renderGroup(groups);
      });
      checkCell.appendChild(checkbox);
      tr.appendChild(checkCell);

      tr.appendChild(App.ui.el('td', null, group.productCode));
      tr.appendChild(App.ui.el('td', null, group.productName));
      tr.appendChild(App.ui.el('td', 'col-num', group.count + ' 個'));

      var actionCell = App.ui.el('td', 'col-action');
      var detailButton = App.ui.el('button', 'btn btn--ghost btn--sm', '明細を見る');
      detailButton.type = 'button';
      detailButton.addEventListener('click', function () {
        searchForm.elements.productCode.value = group.productCode;
        setMode('detail');
        render();
      });
      actionCell.appendChild(detailButton);
      tr.appendChild(actionCell);

      groupBody.appendChild(tr);
    });

    syncGroupSelectAll(groups);
  }

  function render() {
    pruneSelection();

    var filter = currentFilter();
    var items = App.store.listFilterInStock(filter);
    var groups = App.store.groupFilterInStock(filter);

    countLabel.textContent = mode === 'group'
      ? '該当 ' + items.length + ' 個 / ' + groups.length + ' 商品'
      : '該当 ' + items.length + ' 個';

    renderDetail(items);
    renderGroup(groups);
    renderActionBar();
  }

  function setMode(next) {
    mode = next;
    detailWrap.hidden = next !== 'detail';
    groupWrap.hidden = next !== 'group';
    document.querySelectorAll('#filter-inventory-modes .tab').forEach(function (tab) {
      tab.classList.toggle('is-active', tab.dataset.mode === next);
    });
  }

  function init() {
    searchForm = document.getElementById('filter-inventory-search');
    detailBody = document.getElementById('filter-inventory-body');
    groupBody = document.getElementById('filter-inventory-group-body');
    detailWrap = document.getElementById('filter-inventory-detail-wrap');
    groupWrap = document.getElementById('filter-inventory-group-wrap');
    countLabel = document.getElementById('filter-inventory-count');
    selectAll = document.getElementById('filter-inventory-select-all');
    groupSelectAll = document.getElementById('filter-inventory-group-select-all');
    actionBar = document.getElementById('filter-inventory-action-bar');
    selectedText = document.getElementById('filter-inventory-selected-text');

    var onSearchInput = App.ui.debounce(render, 200);
    searchForm.addEventListener('input', onSearchInput);
    searchForm.addEventListener('submit', function (event) { event.preventDefault(); render(); });
    searchForm.addEventListener('reset', function () { setTimeout(render, 0); });

    document.querySelectorAll('#filter-inventory-modes .tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        setMode(tab.dataset.mode);
        render();
      });
    });

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

    groupSelectAll.addEventListener('change', function () {
      var groups = App.store.groupFilterInStock(currentFilter());
      groups.forEach(function (group) {
        group.itemIds.forEach(function (id) { toggleSelection(id, groupSelectAll.checked); });
      });
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

    setMode('group');
  }

  /** 出庫やキャンセル後に呼ばれ、選択を解除して再描画する。 */
  function clearSelection() {
    selectedIds = [];
  }

  App.views['filter-inventory'] = { onShow: render };

  return { init: init, render: render, clearSelection: clearSelection };
})();
