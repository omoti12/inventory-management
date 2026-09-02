/* フィルター出庫履歴：フィルター商品の出庫実績の一覧と、出庫済み商品のキャンセル（在庫へ戻す）。 */
window.App = window.App || {};
App.views = App.views || {};

App.filterHistory = (function () {
  'use strict';

  var COLUMNS = 11;

  var searchForm, body, countLabel, sortButton, sortArrow, exportButton;
  var sortOrder = 'desc';
  /* まとめ表示の開閉状態。キーは groupShipmentRows() の group.key。再描画をまたいで維持する。 */
  var expandedGroups = {};

  function todayStamp() {
    var d = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function currentFilter() {
    var data = new FormData(searchForm);
    return {
      status: data.get('status') || 'all',
      keyword: data.get('keyword') || ''
    };
  }

  function statusBadge(status) {
    if (status === 'cancelled') return App.ui.el('span', 'badge badge--muted', 'キャンセル');
    if (status === 'mixed') return App.ui.el('span', 'badge badge--warning', '一部キャンセル');
    return App.ui.el('span', 'badge badge--success', '出庫済み');
  }

  /** グループ内の行がすべて出庫済み/すべてキャンセルか、キャンセルが混在しているかを判定する。 */
  function groupStatus(rows) {
    var hasShipped = rows.some(function (r) { return r.status !== 'cancelled'; });
    var hasCancelled = rows.some(function (r) { return r.status === 'cancelled'; });
    if (hasShipped && hasCancelled) return 'mixed';
    return hasCancelled ? 'cancelled' : 'shipped';
  }

  function onCancel(row) {
    App.ui.confirm({
      title: '出庫のキャンセル',
      message: '「' + row.productCode + ' / 製造番号 ' + row.serialNo + '」の出庫をキャンセルし、在庫に戻します。よろしいですか？',
      okLabel: 'キャンセルする',
      danger: true
    }).then(function (approved) {
      if (!approved) return;

      App.store.cancelShipment(row.id).then(function (result) {
        if (!result.ok) {
          App.ui.toast(result.message, 'error');
          return;
        }

        render();
        App.filterInventory.render();
        App.ui.toast('出庫をキャンセルし、在庫に戻しました。', 'success');
      });
    });
  }

  /** キャンセル済みの履歴を削除する（出庫済みのままの履歴は削除できない）。 */
  function onDelete(row) {
    App.ui.confirm({
      title: '出庫履歴の削除',
      message: '「' + row.productCode + ' / 製造番号 ' + row.serialNo + '」のキャンセル済み履歴を削除します。元に戻せません。よろしいですか？',
      okLabel: '削除する',
      danger: true
    }).then(function (approved) {
      if (!approved) return;

      App.store.deleteShipment(row.id).then(function (result) {
        if (!result.ok) {
          App.ui.toast(result.message, 'error');
          return;
        }

        render();
        App.ui.toast('出庫履歴を削除しました。', 'success');
      });
    });
  }

  function toggleSort() {
    sortOrder = sortOrder === 'desc' ? 'asc' : 'desc';
    sortArrow.textContent = sortOrder === 'desc' ? '▼' : '▲';
    render();
  }

  /** 今表示している絞り込み・並び順のまま、フィルター出庫履歴をCSVでダウンロードする。 */
  function onExportCsv() {
    var rows = App.store.listFilterShipments(currentFilter(), sortOrder);
    var csvRows = [
      ['商品コード', '製品名', '製造番号', '入荷日', '出庫した人', '受注先', 'エンドユーザー', '備考', '出庫日時', '状態']
    ];
    rows.forEach(function (row) {
      csvRows.push([
        row.productCode,
        row.productName,
        row.serialNo,
        row.arrivalDate || '',
        row.shippedBy,
        row.orderTo,
        row.endUser,
        row.remarks || '',
        App.ui.formatDateTime(row.shippedAt),
        row.status === 'cancelled' ? 'キャンセル' : '出庫済み'
      ]);
    });
    App.ui.downloadCsv('フィルター出庫履歴_' + todayStamp() + '.csv', csvRows);
  }

  /** 1商品ぶんの行の操作セル（キャンセル/削除）を作る。単独行・まとめ表示の内訳行の両方で使う。 */
  function actionCell(row) {
    var cell = App.ui.el('td', 'col-action');
    if (row.status === 'shipped') {
      var cancelButton = App.ui.el('button', 'btn btn--ghost btn--sm', 'キャンセル');
      cancelButton.type = 'button';
      cancelButton.addEventListener('click', function () { onCancel(row); });
      cell.appendChild(cancelButton);
    } else {
      var deleteButton = App.ui.el('button', 'btn btn--ghost btn--sm', '削除');
      deleteButton.type = 'button';
      deleteButton.addEventListener('click', function () { onDelete(row); });
      cell.appendChild(deleteButton);
    }
    return cell;
  }

  /** 出庫操作1件ぶん（商品が1つだけ）を、まとめ表示にせずそのまま1行で表示する。 */
  function renderSingleRow(row) {
    var tr = App.ui.el('tr');
    [
      row.productCode,
      row.productName,
      row.serialNo,
      row.arrivalDate || '—',
      row.shippedBy,
      row.destinationName1 || '—',
      row.destinationName2 || '—'
    ].forEach(function (value) {
      tr.appendChild(App.ui.el('td', null, value));
    });
    tr.appendChild(App.ui.el('td', 'col-remarks', row.remarks || ''));
    tr.appendChild(App.ui.el('td', null, App.ui.formatDateTime(row.shippedAt)));

    var statusCell = App.ui.el('td');
    statusCell.appendChild(statusBadge(row.status));
    tr.appendChild(statusCell);

    tr.appendChild(actionCell(row));
    return tr;
  }

  /** まとめ表示の見出し行（クリックで内訳の開閉）。 */
  function renderGroupSummary(group, expanded) {
    var tr = App.ui.el('tr', 'row--batch-summary row-clickable');

    var toggleCell = App.ui.el('td');
    var toggleButton = App.ui.el('button', 'batch-toggle', (expanded ? '▼ ' : '▶ ') + group.rows.length + '件の商品をまとめて出庫');
    toggleButton.type = 'button';
    toggleButton.addEventListener('click', function () { toggleGroup(group.key); });
    toggleCell.appendChild(toggleButton);
    tr.appendChild(toggleCell);

    ['—', '—', '—'].forEach(function (value) { tr.appendChild(App.ui.el('td', null, value)); });

    tr.appendChild(App.ui.el('td', null, group.shippedBy));
    tr.appendChild(App.ui.el('td', null, group.destinationName1 || '—'));
    tr.appendChild(App.ui.el('td', null, group.destinationName2 || '—'));
    tr.appendChild(App.ui.el('td', 'col-remarks', group.remarks || ''));
    tr.appendChild(App.ui.el('td', null, App.ui.formatDateTime(group.shippedAt)));

    var statusCell = App.ui.el('td');
    statusCell.appendChild(statusBadge(groupStatus(group.rows)));
    tr.appendChild(statusCell);

    tr.appendChild(App.ui.el('td', 'col-action'));

    tr.addEventListener('click', function (event) {
      if (event.target.closest('button')) return;
      toggleGroup(group.key);
    });

    return tr;
  }

  /** まとめ表示の内訳行（商品ごと）。 */
  function renderGroupChildRow(row) {
    var tr = App.ui.el('tr', 'row--batch-child');
    tr.appendChild(App.ui.el('td', null, row.productCode));
    tr.appendChild(App.ui.el('td', null, row.productName));
    tr.appendChild(App.ui.el('td', null, row.serialNo));
    tr.appendChild(App.ui.el('td', null, row.arrivalDate || '—'));
    tr.appendChild(App.ui.el('td', null, '—'));
    tr.appendChild(App.ui.el('td', null, '—'));
    tr.appendChild(App.ui.el('td', null, '—'));
    tr.appendChild(App.ui.el('td', 'col-remarks', ''));
    tr.appendChild(App.ui.el('td', null, '—'));

    var statusCell = App.ui.el('td');
    statusCell.appendChild(statusBadge(row.status));
    tr.appendChild(statusCell);

    tr.appendChild(actionCell(row));
    return tr;
  }

  function toggleGroup(key) {
    expandedGroups[key] = !expandedGroups[key];
    render();
  }

  function render() {
    var rows = App.store.listFilterShipments(currentFilter(), sortOrder);
    var groups = App.store.groupShipmentRows(rows);
    App.ui.clear(body);
    countLabel.textContent = rows.length + ' 件';

    if (groups.length === 0) {
      body.appendChild(App.ui.emptyRow(COLUMNS, '該当する出庫履歴がありません。'));
      return;
    }

    groups.forEach(function (group) {
      if (group.rows.length === 1) {
        body.appendChild(renderSingleRow(group.rows[0]));
        return;
      }

      var expanded = !!expandedGroups[group.key];
      body.appendChild(renderGroupSummary(group, expanded));
      if (expanded) {
        group.rows.forEach(function (row) {
          body.appendChild(renderGroupChildRow(row));
        });
      }
    });
  }

  function init() {
    searchForm = document.getElementById('filter-history-search');
    body = document.getElementById('filter-history-body');
    countLabel = document.getElementById('filter-history-count');
    sortButton = document.getElementById('filter-history-sort-date');
    sortArrow = document.getElementById('filter-history-sort-arrow');
    exportButton = document.getElementById('filter-history-export-csv');

    var onInput = App.ui.debounce(render, 200);
    searchForm.addEventListener('input', onInput);
    searchForm.addEventListener('change', render);
    searchForm.addEventListener('submit', function (event) { event.preventDefault(); render(); });
    sortButton.addEventListener('click', toggleSort);
    exportButton.addEventListener('click', onExportCsv);
  }

  App.views['filter-history'] = { onShow: render };

  return { init: init, render: render };
})();
