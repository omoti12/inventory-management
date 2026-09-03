/* 入庫履歴：入庫した通常品の一覧（在庫中・出庫済みを問わず）と、数量などの編集。 */
window.App = window.App || {};
App.views = App.views || {};

App.inboundHistory = (function () {
  'use strict';

  var COLUMNS = 10;

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
      quantity: inputs.quantity.value,
      arrivalDate: inputs.arrivalDate.value,
      receivedBy: inputs.receivedBy.value,
      remarks: inputs.remarks.value
    };
    App.store.updateItem(row.id, data).then(function (result) {
      if (!result.ok) {
        var message = result.message || (result.errors && (result.errors.quantity || result.errors.receivedBy)) || '更新に失敗しました。';
        App.ui.toast(message, 'error');
        return;
      }

      editingId = null;
      render();
      App.inventory.render();
      App.ui.toast('入庫記録を更新しました。', 'success');
    });
  }

  /** 表示用のセルを作る（編集中の行だけ入力欄にする）。 */
  function renderRow(row) {
    var tr = App.ui.el('tr', editingId === row.id ? 'row-editing' : null);

    tr.appendChild(App.ui.el('td', null, row.productCode));
    tr.appendChild(App.ui.el('td', null, row.productName));
    tr.appendChild(App.ui.el('td', null, row.storageLocation || '—'));

    if (editingId === row.id) {
      var qtyCell = App.ui.el('td', 'col-num');
      var qtyInput = App.ui.el('input');
      qtyInput.type = 'number';
      qtyInput.min = '0';
      qtyInput.step = '1';
      qtyInput.value = row.quantity;
      qtyInput.style.width = '80px';
      qtyInput.setAttribute('aria-label', '数量');
      qtyCell.appendChild(qtyInput);
      tr.appendChild(qtyCell);

      var dateCell = App.ui.el('td');
      var dateInput = App.ui.el('input');
      dateInput.type = 'date';
      dateInput.value = row.arrivalDate || '';
      dateInput.setAttribute('aria-label', '入荷日');
      dateCell.appendChild(dateInput);
      tr.appendChild(dateCell);

      var byCell = App.ui.el('td');
      var byInput = App.ui.el('input');
      byInput.type = 'text';
      byInput.value = row.receivedBy || '';
      byInput.setAttribute('aria-label', '入庫した人');
      byCell.appendChild(byInput);
      tr.appendChild(byCell);

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
        saveEdit(row, { quantity: qtyInput, arrivalDate: dateInput, receivedBy: byInput, remarks: remarksInput });
      });
      var cancelButton = App.ui.el('button', 'btn btn--ghost btn--sm', 'キャンセル');
      cancelButton.type = 'button';
      cancelButton.addEventListener('click', cancelEdit);
      actionCell.appendChild(saveButton);
      actionCell.appendChild(cancelButton);
      tr.appendChild(actionCell);
    } else {
      tr.appendChild(App.ui.el('td', 'col-num', row.quantity + ' 個'));
      tr.appendChild(App.ui.el('td', null, row.arrivalDate || '—'));
      tr.appendChild(App.ui.el('td', null, row.receivedBy || '—'));
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
      tr.appendChild(actionCell2);
    }

    return tr;
  }

  function render() {
    var rows = App.store.listInboundHistory(currentFilter(), sortOrder);
    App.ui.clear(body);
    countLabel.textContent = rows.length + ' 件';

    if (rows.length === 0) {
      body.appendChild(App.ui.emptyRow(COLUMNS, '該当する入庫履歴がありません。'));
      return;
    }

    rows.forEach(function (row) {
      body.appendChild(renderRow(row));
    });
  }

  function init() {
    searchForm = document.getElementById('inbound-history-search');
    body = document.getElementById('inbound-history-body');
    countLabel = document.getElementById('inbound-history-count');
    sortButton = document.getElementById('inbound-history-sort-date');
    sortArrow = document.getElementById('inbound-history-sort-arrow');

    var onInput = App.ui.debounce(render, 200);
    searchForm.addEventListener('input', onInput);
    searchForm.addEventListener('change', render);
    searchForm.addEventListener('submit', function (event) { event.preventDefault(); render(); });
    sortButton.addEventListener('click', toggleSort);
  }

  App.views['inbound-history'] = { onShow: render };

  return { init: init, render: render };
})();
