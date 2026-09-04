/* フィルター入庫履歴：入庫したフィルター品の一覧（在庫中・出庫済みを問わず）と、製造番号などの編集。 */
window.App = window.App || {};
App.views = App.views || {};

App.filterInboundHistory = (function () {
  'use strict';

  var COLUMNS = 8;

  var searchForm, body, countLabel, sortButton, sortArrow;
  var sortOrder = 'desc';
  var editingId = null;

  function currentFilter() {
    var data = new FormData(searchForm);
    return {
      status: data.get('status') || 'all',
      keyword: data.get('keyword') || ''
    };
  }

  function statusBadge(status) {
    var isShipped = status === 'shipped';
    return App.ui.el(
      'span',
      'badge ' + (isShipped ? 'badge--muted' : 'badge--success'),
      isShipped ? '出庫済み' : '在庫中'
    );
  }

  function toggleSort() {
    sortOrder = sortOrder === 'desc' ? 'asc' : 'desc';
    sortArrow.textContent = sortOrder === 'desc' ? '▼' : '▲';
    render();
  }

  function startEdit(id) {
    editingId = id;
    render();
  }

  function cancelEdit() {
    editingId = null;
    render();
  }

  function saveEdit(row, inputs) {
    var data = {
      serialNo: inputs.serialNo.value,
      arrivalDate: inputs.arrivalDate.value,
      remarks: inputs.remarks.value
    };
    App.store.updateItem(row.id, data).then(function (result) {
      if (!result.ok) {
        var message = result.message || (result.errors && result.errors.serialNo) || '更新に失敗しました。';
        App.ui.toast(message, 'error');
        return;
      }

      editingId = null;
      render();
      App.filterInventory.render();
      App.ui.toast('入庫記録を更新しました。', 'success');
    });
  }

  /**
   * 在庫中の入庫記録を削除する（出庫履歴の削除と同じ考え方で、出庫済みのものは削除できない。
   * store.js の deleteItem() 側でも同じ制限をかけている）。
   */
  function onDelete(row) {
    App.ui.confirm({
      title: '入庫履歴の削除',
      message: '「' + row.productCode + ' / 製造番号 ' + row.serialNo + '」の入庫記録を削除します。元に戻せません。よろしいですか？',
      okLabel: '削除する',
      danger: true
    }).then(function (approved) {
      if (!approved) return;

      App.store.deleteItem(row.id).then(function (result) {
        if (!result.ok) {
          App.ui.toast(result.message, 'error');
          return;
        }

        render();
        App.filterInventory.render();
        App.ui.toast('入庫履歴を削除しました。', 'success');
      });
    });
  }

  function renderRow(row) {
    var tr = App.ui.el('tr', editingId === row.id ? 'row-editing' : null);

    tr.appendChild(App.ui.el('td', null, row.productCode));
    tr.appendChild(App.ui.el('td', null, row.productName));

    if (editingId === row.id) {
      var serialCell = App.ui.el('td');
      var serialInput = App.ui.el('input');
      serialInput.type = 'text';
      serialInput.value = row.serialNo || '';
      serialInput.setAttribute('aria-label', '製造番号');
      serialCell.appendChild(serialInput);
      tr.appendChild(serialCell);

      var dateCell = App.ui.el('td');
      var dateInput = App.ui.el('input');
      dateInput.type = 'date';
      dateInput.value = row.arrivalDate || '';
      dateInput.setAttribute('aria-label', '入荷日');
      dateCell.appendChild(dateInput);
      tr.appendChild(dateCell);

      var remarksCell = App.ui.el('td', 'col-remarks');
      var remarksInput = App.ui.el('textarea');
      remarksInput.rows = 1;
      remarksInput.value = row.remarks || '';
      remarksInput.setAttribute('aria-label', '備考');
      remarksCell.appendChild(remarksInput);
      tr.appendChild(remarksCell);

      tr.appendChild(App.ui.el('td', null, App.ui.formatDateTime(row.registeredAt)));

      var statusCell = App.ui.el('td');
      statusCell.appendChild(statusBadge(row.status));
      tr.appendChild(statusCell);

      var actionCell = App.ui.el('td', 'col-action');
      var saveButton = App.ui.el('button', 'btn btn--primary btn--sm', '保存');
      saveButton.type = 'button';
      saveButton.addEventListener('click', function () {
        saveEdit(row, { serialNo: serialInput, arrivalDate: dateInput, remarks: remarksInput });
      });
      var cancelButton = App.ui.el('button', 'btn btn--ghost btn--sm', 'キャンセル');
      cancelButton.type = 'button';
      cancelButton.addEventListener('click', cancelEdit);
      actionCell.appendChild(saveButton);
      actionCell.appendChild(cancelButton);
      tr.appendChild(actionCell);
    } else {
      tr.appendChild(App.ui.el('td', null, row.serialNo || '—'));
      tr.appendChild(App.ui.el('td', null, row.arrivalDate || '—'));
      tr.appendChild(App.ui.el('td', 'col-remarks', row.remarks || ''));
      tr.appendChild(App.ui.el('td', null, App.ui.formatDateTime(row.registeredAt)));

      var statusCell2 = App.ui.el('td');
      statusCell2.appendChild(statusBadge(row.status));
      tr.appendChild(statusCell2);

      var actionCell2 = App.ui.el('td', 'col-action');
      var editButton = App.ui.el('button', 'btn btn--ghost btn--sm', '編集');
      editButton.type = 'button';
      editButton.addEventListener('click', function () { startEdit(row.id); });
      actionCell2.appendChild(editButton);

      if (row.status === 'in_stock') {
        var deleteButton = App.ui.el('button', 'btn btn--ghost btn--sm', '削除');
        deleteButton.type = 'button';
        deleteButton.addEventListener('click', function () { onDelete(row); });
        actionCell2.appendChild(deleteButton);
      }
      tr.appendChild(actionCell2);
    }

    return tr;
  }

  /**
   * 一覧を丸ごと作り直すと、編集中の行のボタンなどフォーカスが当たっていた要素がDOMから
   * 消えるため、ブラウザによってはページの先頭までスクロールが飛んでしまう。編集ボタンを
   * 押しただけなのに一番上に戻るのを防ぐため、再描画の前後でスクロール位置を保持する。
   */
  function render() {
    var scrollY = window.scrollY;

    var rows = App.store.listFilterInboundHistory(currentFilter(), sortOrder);
    App.ui.clear(body);
    countLabel.textContent = rows.length + ' 件';

    if (rows.length === 0) {
      body.appendChild(App.ui.emptyRow(COLUMNS, '該当する入庫履歴がありません。'));
    } else {
      rows.forEach(function (row) {
        body.appendChild(renderRow(row));
      });
    }

    window.scrollTo(0, scrollY);
  }

  function init() {
    searchForm = document.getElementById('filter-inbound-history-search');
    body = document.getElementById('filter-inbound-history-body');
    countLabel = document.getElementById('filter-inbound-history-count');
    sortButton = document.getElementById('filter-inbound-history-sort-date');
    sortArrow = document.getElementById('filter-inbound-history-sort-arrow');

    var onInput = App.ui.debounce(render, 200);
    searchForm.addEventListener('input', onInput);
    searchForm.addEventListener('change', render);
    searchForm.addEventListener('submit', function (event) { event.preventDefault(); render(); });
    sortButton.addEventListener('click', toggleSort);
  }

  App.views['filter-inbound-history'] = { onShow: render };

  return { init: init, render: render };
})();
