/* フィルター出庫履歴：フィルター商品の出庫実績の一覧と、出庫済み商品のキャンセル（在庫へ戻す）。 */
window.App = window.App || {};
App.views = App.views || {};

App.filterHistory = (function () {
  'use strict';

  var COLUMNS = 12;

  var searchForm, body, countLabel, sortButton, sortArrow, exportExternalButton;
  var selectAllCheckbox, monthInput, selectMonthButton;
  var sortOrder = 'desc';
  /* まとめ表示の開閉状態。キーは groupShipmentRows() の group.key。再描画をまたいで維持する。 */
  var expandedGroups = {};
  /**
   * CSV出力対象として選んだ出庫操作（groupShipmentRows() の group.key）。まとめ表示の1行が
   * そのまま1つの出庫操作に対応するため、選択の単位も「まとめ行（出庫操作）ごと」にしている
   * （内訳の商品単位では選べない）。再描画をまたいで維持する。
   */
  var selectedGroups = {};

  function todayStamp() {
    var d = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /** 外部システム用CSVの日付欄に合わせた「YYYY/M/D」形式（0埋めしない）。 */
  function formatExternalDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
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

  /** 複数件に対して同じStore操作を順番に実行し、成功件数と最初のエラーメッセージをまとめる。 */
  function runBulk(rows, action) {
    var successCount = 0;
    var firstError = null;
    return rows.reduce(function (chain, row) {
      return chain.then(function () {
        return action(row.id).then(function (result) {
          if (result.ok) {
            successCount += 1;
          } else if (!firstError) {
            firstError = result.message;
          }
        });
      });
    }, Promise.resolve()).then(function () {
      return { successCount: successCount, firstError: firstError };
    });
  }

  /** まとめ表示のうち、出庫済みの行をまとめてキャンセルする。 */
  function onBulkCancel(targets) {
    App.ui.confirm({
      title: '出庫のキャンセル',
      message: targets.length + '件の商品をまとめてキャンセルし、在庫に戻します。よろしいですか？',
      okLabel: 'キャンセルする',
      danger: true
    }).then(function (approved) {
      if (!approved) return;

      runBulk(targets, App.store.cancelShipment).then(function (summary) {
        render();
        App.filterInventory.render();
        if (summary.successCount > 0) {
          App.ui.toast(summary.successCount + '件をまとめてキャンセルし、在庫に戻しました。', 'success');
        }
        if (summary.firstError) App.ui.toast(summary.firstError, 'error');
      });
    });
  }

  /** まとめ表示のうち、キャンセル済みの行をまとめて削除する。 */
  function onBulkDelete(targets) {
    App.ui.confirm({
      title: '出庫履歴の削除',
      message: targets.length + '件のキャンセル済み履歴をまとめて削除します。元に戻せません。よろしいですか？',
      okLabel: '削除する',
      danger: true
    }).then(function (approved) {
      if (!approved) return;

      runBulk(targets, App.store.deleteShipment).then(function (summary) {
        render();
        if (summary.successCount > 0) {
          App.ui.toast(summary.successCount + '件の出庫履歴をまとめて削除しました。', 'success');
        }
        if (summary.firstError) App.ui.toast(summary.firstError, 'error');
      });
    });
  }

  function toggleSort() {
    sortOrder = sortOrder === 'desc' ? 'asc' : 'desc';
    sortArrow.textContent = sortOrder === 'desc' ? '▼' : '▲';
    render();
  }

  /**
   * チェックボックスで選んだ出庫操作だけに絞り込む。何も選んでいなければ何も絞らず
   * そのまま返す（今まで通り、絞り込み条件に合う全件を出力する）。
   */
  function selectedRowsOnly(rows) {
    if (Object.keys(selectedGroups).length === 0) return rows;
    var selected = [];
    App.store.groupShipmentRows(rows).forEach(function (group) {
      if (selectedGroups[group.key]) selected = selected.concat(group.rows);
    });
    return selected;
  }

  /**
   * 社内の会計/販売システムの出荷CSV取込機能にそのまま読み込ませる形式でダウンロードする
   * （出庫履歴のonExportExternalCsv()と同じ列構成）。フィルター品には数量の概念が無く
   * 1行＝1個のため、フリー在庫分数量には常に1を入れる。今表示している絞り込み・並び順の
   * まま出力する。チェックボックスで一部の出庫操作だけ選んでいれば、その分だけを出力する。
   */
  function onExportExternalCsv() {
    var rows = selectedRowsOnly(App.store.listFilterShipments(currentFilter(), sortOrder));
    var csvRows = [
      ['出荷日', '出荷先コード', '出荷先小番', '出荷先名1', '出荷先名2', '受注番号1', '受注番号2', '受注番号3', '商品コード', 'フリー在庫分数量']
    ];
    rows.forEach(function (row) {
      csvRows.push([
        formatExternalDate(row.shippedAt),
        row.destinationCode || '',
        row.destinationSubCode || '',
        row.destinationName1 || '',
        row.destinationName2 || '',
        row.orderNumber1 || '',
        row.orderNumber2 || '',
        row.orderNumber3 || '',
        row.productCode,
        1
      ]);
    });
    App.ui.downloadCsv('フィルター出荷CSV_' + todayStamp() + '.csv', csvRows);
  }

  /**
   * 出庫履歴の内容（出庫した人・出庫日・出荷先・受注番号・備考）を編集する。
   * 何を出庫したか（商品・製造番号）自体は編集対象外。
   */
  function onEdit(row) {
    App.ui.editShipment(row).then(function (values) {
      if (!values) return;

      App.store.updateShipment(row.id, values).then(function (result) {
        if (!result.ok) {
          var message = result.message || (result.errors && Object.keys(result.errors).map(function (k) { return result.errors[k]; })[0]) || '更新に失敗しました。';
          App.ui.toast(message, 'error');
          return;
        }

        render();
        App.ui.toast('出庫履歴を更新しました。', 'success');
      });
    });
  }

  /** 1商品ぶんの行の操作セル（編集/キャンセル/削除）を作る。単独行・まとめ表示の内訳行の両方で使う。 */
  function actionCell(row) {
    var cell = App.ui.el('td', 'col-action');

    if (App.store.isMonthLocked(row.shippedAt)) {
      var lockedNotice = App.ui.el('span', 'muted', '🔒 締め済み');
      lockedNotice.title = 'この記録は月次締め済みのため編集・キャンセル・削除できません。';
      cell.appendChild(lockedNotice);
      return cell;
    }

    var editButton = App.ui.el('button', 'btn btn--ghost btn--sm', '編集');
    editButton.type = 'button';
    editButton.addEventListener('click', function () { onEdit(row); });
    cell.appendChild(editButton);

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

  /** 選択チェックボックスのセルを作る（1出庫操作＝1個。まとめ行・単独行のどちらでも使う）。 */
  function selectCell(key) {
    var cell = App.ui.el('td', 'col-check');
    var checkbox = App.ui.el('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isGroupSelected(key);
    checkbox.setAttribute('aria-label', 'CSV出力の対象として選択');
    checkbox.addEventListener('change', function () {
      toggleGroupSelection(key, checkbox.checked);
      render();
    });
    cell.appendChild(checkbox);
    return cell;
  }

  /** 出庫操作1件ぶん（商品が1つだけ）を、まとめ表示にせずそのまま1行で表示する。 */
  function renderSingleRow(row, key) {
    var tr = App.ui.el('tr');
    tr.appendChild(selectCell(key));
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

    tr.appendChild(selectCell(group.key));

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

    var actionsCell = App.ui.el('td', 'col-action');
    var shippedRows = group.rows.filter(function (r) { return r.status === 'shipped' && !App.store.isMonthLocked(r.shippedAt); });
    var cancelledRows = group.rows.filter(function (r) { return r.status === 'cancelled' && !App.store.isMonthLocked(r.shippedAt); });
    if (shippedRows.length > 0) {
      var bulkCancelButton = App.ui.el('button', 'btn btn--ghost btn--sm', 'まとめてキャンセル');
      bulkCancelButton.type = 'button';
      bulkCancelButton.addEventListener('click', function () { onBulkCancel(shippedRows); });
      actionsCell.appendChild(bulkCancelButton);
    }
    if (cancelledRows.length > 0) {
      var bulkDeleteButton = App.ui.el('button', 'btn btn--ghost btn--sm', 'まとめて削除');
      bulkDeleteButton.type = 'button';
      bulkDeleteButton.addEventListener('click', function () { onBulkDelete(cancelledRows); });
      actionsCell.appendChild(bulkDeleteButton);
    }
    /* 同じ出庫操作内の行はすべて同じ出庫日時（＝同じ月）を共有するため、先頭行だけ見れば足りる。 */
    if (App.store.isMonthLocked(group.rows[0].shippedAt)) {
      var groupLockedNotice = App.ui.el('span', 'muted', '🔒 締め済み');
      groupLockedNotice.title = 'この記録は月次締め済みのため編集・キャンセル・削除できません。';
      actionsCell.appendChild(groupLockedNotice);
    }
    tr.appendChild(actionsCell);

    tr.addEventListener('click', function (event) {
      if (event.target.closest('button, input')) return;
      toggleGroup(group.key);
    });

    return tr;
  }

  /** まとめ表示の内訳行（商品ごと）。 */
  function renderGroupChildRow(row) {
    var tr = App.ui.el('tr', 'row--batch-child');
    tr.appendChild(App.ui.el('td', 'col-check')); /* 内訳は出庫操作単位の選択に含まれるため、ここでは選ばせない。 */
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

  function isGroupSelected(key) {
    return !!selectedGroups[key];
  }

  function toggleGroupSelection(key, checked) {
    if (checked) selectedGroups[key] = true;
    else delete selectedGroups[key];
  }

  /** ヘッダーの全選択チェックボックスの状態（チェック済み/一部のみ）を、今表示中の行に合わせて更新する。 */
  function syncSelectAllCheckbox(groups) {
    var total = groups.length;
    var checked = groups.filter(function (g) { return isGroupSelected(g.key); }).length;
    selectAllCheckbox.checked = total > 0 && checked === total;
    selectAllCheckbox.indeterminate = checked > 0 && checked < total;
  }

  /**
   * 指定した年月（YYYY-MM）の出庫操作だけを選択状態にする（今の選択は入れ替える）。
   * 今の絞り込み条件（状態・キーワード）に関係なく、全期間のデータから月で絞って選ぶ。
   */
  function selectMonth(yyyyMm) {
    if (!yyyyMm) return;
    var allRows = App.store.listFilterShipments({}, sortOrder);
    var allGroups = App.store.groupShipmentRows(allRows);
    selectedGroups = {};
    allGroups.forEach(function (group) {
      if (String(group.shippedAt || '').slice(0, 7) === yyyyMm) {
        selectedGroups[group.key] = true;
      }
    });
    render();
  }

  function render() {
    var rows = App.store.listFilterShipments(currentFilter(), sortOrder);
    var groups = App.store.groupShipmentRows(rows);
    App.ui.clear(body);
    var selectedCount = Object.keys(selectedGroups).length;
    countLabel.textContent = rows.length + ' 件' + (selectedCount > 0 ? '（' + selectedCount + '件の出庫操作を選択中）' : '');
    syncSelectAllCheckbox(groups);

    if (groups.length === 0) {
      body.appendChild(App.ui.emptyRow(COLUMNS, '該当する出庫履歴がありません。'));
      return;
    }

    groups.forEach(function (group) {
      if (group.rows.length === 1) {
        body.appendChild(renderSingleRow(group.rows[0], group.key));
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
    exportExternalButton = document.getElementById('filter-history-export-external-csv');
    selectAllCheckbox = document.getElementById('filter-history-select-all');
    monthInput = document.getElementById('filter-history-select-month');
    selectMonthButton = document.getElementById('filter-history-select-month-btn');

    var onInput = App.ui.debounce(render, 200);
    searchForm.addEventListener('input', onInput);
    searchForm.addEventListener('change', render);
    searchForm.addEventListener('submit', function (event) { event.preventDefault(); render(); });
    sortButton.addEventListener('click', toggleSort);
    exportExternalButton.addEventListener('click', onExportExternalCsv);

    selectAllCheckbox.addEventListener('change', function () {
      var groups = App.store.groupShipmentRows(App.store.listFilterShipments(currentFilter(), sortOrder));
      groups.forEach(function (group) { toggleGroupSelection(group.key, selectAllCheckbox.checked); });
      render();
    });
    selectMonthButton.addEventListener('click', function () { selectMonth(monthInput.value); });
  }

  App.views['filter-history'] = { onShow: render };

  return { init: init, render: render };
})();
