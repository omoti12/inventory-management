/* 入庫履歴：入庫した通常品の一覧（在庫中・出庫済みを問わず）と、数量などの編集。 */
window.App = window.App || {};
App.views = App.views || {};

App.inboundHistory = (function () {
  'use strict';

  var COLUMNS = 11;

  /* 入庫した人は決まった社員のみのため、出庫した人（index.htmlの各<select>）と同じ固定の
     選択肢にする。増減したらここも合わせて直す。 */
  var STAFF_NAMES = [
    '平澤 基至', '小池 悟', '池田 和弘', '瀧澤 太樹', '後藤 大樹',
    '西脇 利将', '内田 由季子', '笠原 義彦', '田中 春樹', '舩山 亜由美'
  ];

  var searchForm, body, countLabel, sortButton, sortArrow, selectAllCheckbox, bulkDeleteButton;
  var sortOrder = 'desc';
  var editingId = null;
  var selectedIds = {};

  /** 編集行の「入庫した人」欄用に、固定メンバーの選択肢を持つ<select>を作る。 */
  function buildReceivedByField(value) {
    var select = App.ui.el('select');
    var placeholder = App.ui.el('option', null, '選択してください');
    placeholder.value = '';
    select.appendChild(placeholder);
    STAFF_NAMES.forEach(function (name) {
      var option = App.ui.el('option', null, name);
      option.value = name;
      select.appendChild(option);
    });
    select.value = value || '';
    select.setAttribute('aria-label', '入庫した人');
    return select;
  }

  /** 個別の削除ボタンと同じ条件（在庫中、または参照商品が削除済み）の行だけ選択・削除できる。 */
  function isDeletable(row) {
    return row.status === 'in_stock' || row.productDeleted;
  }

  /** 複数件に対して同じStore操作を順番に実行し、成功件数と最初のエラーメッセージをまとめる。 */
  function runBulk(ids, action) {
    var successCount = 0;
    var firstError = null;
    return ids.reduce(function (chain, id) {
      return chain.then(function () {
        return action(id).then(function (result) {
          if (result.ok) successCount += 1;
          else if (!firstError) firstError = result.message;
        });
      });
    }, Promise.resolve()).then(function () {
      return { successCount: successCount, firstError: firstError };
    });
  }

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

  /**
   * 在庫中の入庫記録を削除する（出庫履歴の削除と同じ考え方で、出庫済みのものは削除できない。
   * store.js の deleteItem() 側でも同じ制限をかけている）。
   */
  function onDelete(row) {
    App.ui.confirm({
      title: '入庫履歴の削除',
      message: '「' + row.productCode + ' / ' + row.productName + '」の入庫記録を削除します。元に戻せません。よろしいですか？',
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
        App.inventory.render();
        App.ui.toast('入庫履歴を削除しました。', 'success');
      });
    });
  }

  /** 選択して一括削除するための行チェックボックス（個別削除できる行だけ選択できる）。 */
  function checkCell(row) {
    var cell = App.ui.el('td', 'col-check');
    if (editingId === row.id || !isDeletable(row)) return cell;

    var checkbox = App.ui.el('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!selectedIds[row.id];
    checkbox.setAttribute('aria-label', row.productCode + ' / ' + row.productName + 'を選択');
    checkbox.addEventListener('change', function () {
      if (checkbox.checked) selectedIds[row.id] = true;
      else delete selectedIds[row.id];
      syncSelectionUi();
    });
    cell.appendChild(checkbox);
    return cell;
  }

  /** ヘッダーの全選択チェックボックスと、一括削除ボタンの有効/無効・件数表示を今の選択状況に合わせる。 */
  function syncSelectionUi() {
    var deletableRows = App.store.listInboundHistory(currentFilter(), sortOrder).filter(isDeletable);
    var total = deletableRows.length;
    var checked = deletableRows.filter(function (row) { return !!selectedIds[row.id]; }).length;

    selectAllCheckbox.checked = total > 0 && checked === total;
    selectAllCheckbox.indeterminate = checked > 0 && checked < total;
    bulkDeleteButton.disabled = checked === 0;
    bulkDeleteButton.textContent = checked > 0 ? '選択した' + checked + '件を削除' : '選択した件を削除';
  }

  function onBulkDelete() {
    var ids = Object.keys(selectedIds);
    if (ids.length === 0) return;

    App.ui.confirm({
      title: '入庫履歴の削除',
      message: ids.length + '件の入庫記録をまとめて削除します。元に戻せません。よろしいですか？',
      okLabel: '削除する',
      danger: true
    }).then(function (approved) {
      if (!approved) return;

      runBulk(ids, App.store.deleteItem).then(function (summary) {
        selectedIds = {};
        render();
        App.inventory.render();
        if (summary.successCount > 0) App.ui.toast(summary.successCount + '件の入庫履歴をまとめて削除しました。', 'success');
        if (summary.firstError) App.ui.toast(summary.firstError, 'error');
      });
    });
  }

  /** 表示用のセルを作る（編集中の行だけ入力欄にする）。 */
  function renderRow(row) {
    var tr = App.ui.el('tr', editingId === row.id ? 'row-editing' : null);

    tr.appendChild(checkCell(row));
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
      var byInput = buildReceivedByField(row.receivedBy);
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

      if (row.status === 'in_stock' || row.productDeleted) {
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

    var rows = App.store.listInboundHistory(currentFilter(), sortOrder);
    App.ui.clear(body);
    countLabel.textContent = rows.length + ' 件';

    if (rows.length === 0) {
      body.appendChild(App.ui.emptyRow(COLUMNS, '該当する入庫履歴がありません。'));
    } else {
      rows.forEach(function (row) {
        body.appendChild(renderRow(row));
      });
    }

    syncSelectionUi();
    window.scrollTo(0, scrollY);
  }

  function init() {
    searchForm = document.getElementById('inbound-history-search');
    body = document.getElementById('inbound-history-body');
    countLabel = document.getElementById('inbound-history-count');
    sortButton = document.getElementById('inbound-history-sort-date');
    sortArrow = document.getElementById('inbound-history-sort-arrow');
    selectAllCheckbox = document.getElementById('inbound-history-select-all');
    bulkDeleteButton = document.getElementById('inbound-history-bulk-delete');

    var onInput = App.ui.debounce(render, 200);
    searchForm.addEventListener('input', onInput);
    searchForm.addEventListener('change', render);
    searchForm.addEventListener('submit', function (event) { event.preventDefault(); render(); });
    sortButton.addEventListener('click', toggleSort);

    selectAllCheckbox.addEventListener('change', function () {
      var deletableRows = App.store.listInboundHistory(currentFilter(), sortOrder).filter(isDeletable);
      deletableRows.forEach(function (row) {
        if (selectAllCheckbox.checked) selectedIds[row.id] = true;
        else delete selectedIds[row.id];
      });
      render();
    });
    bulkDeleteButton.addEventListener('click', onBulkDelete);
  }

  App.views['inbound-history'] = { onShow: render };

  return { init: init, render: render };
})();
