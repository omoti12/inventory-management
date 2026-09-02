/* 出庫履歴：出庫実績の一覧と、出庫済み商品のキャンセル（在庫へ戻す）。 */
window.App = window.App || {};
App.views = App.views || {};

App.history = (function () {
  'use strict';

  var COLUMNS = 12;

  var searchForm, body, countLabel, sortButton, sortArrow, exportButton, exportExternalButton;
  var sortOrder = 'desc';

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
    var isCancelled = status === 'cancelled';
    return App.ui.el(
      'span',
      'badge ' + (isCancelled ? 'badge--muted' : 'badge--success'),
      isCancelled ? 'キャンセル' : '出庫済み'
    );
  }

  function onCancel(row) {
    App.ui.confirm({
      title: '出庫のキャンセル',
      message: '「' + row.productCode + ' / ' + row.productName + '」の出庫をキャンセルし、在庫に戻します。よろしいですか？',
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
        App.inventory.render();
        App.ui.toast('出庫をキャンセルし、在庫に戻しました。', 'success');
      });
    });
  }

  function toggleSort() {
    sortOrder = sortOrder === 'desc' ? 'asc' : 'desc';
    sortArrow.textContent = sortOrder === 'desc' ? '▼' : '▲';
    render();
  }

  /** 今表示している絞り込み・並び順のまま、出庫履歴をCSVでダウンロードする。 */
  function onExportCsv() {
    var rows = App.store.listShipments(currentFilter(), 'normal', sortOrder);
    var csvRows = [
      ['商品コード', '製品名', '保管場所', '数量', '入荷日', '出庫した人', '受注先', 'エンドユーザー', '備考', '出庫日時', '状態']
    ];
    rows.forEach(function (row) {
      csvRows.push([
        row.productCode,
        row.productName,
        row.storageLocation || '',
        row.quantity,
        row.arrivalDate || '',
        row.shippedBy,
        row.orderTo,
        row.endUser,
        row.remarks || '',
        App.ui.formatDateTime(row.shippedAt),
        row.status === 'cancelled' ? 'キャンセル' : '出庫済み'
      ]);
    });
    App.ui.downloadCsv('出庫履歴_' + todayStamp() + '.csv', csvRows);
  }

  /**
   * 社内の会計/販売システムの出荷CSV取込機能にそのまま読み込ませる形式でダウンロードする。
   * 列の順序（出荷日・伝票入力担当者コード・出荷先コード・出荷先小番・出荷先名1・出荷先名2・
   * 受注番号1〜3・商品コード）は先方の取込画面の仕様に合わせている。伝票入力担当者コードは、
   * 先方には担当者コードから氏名を引く仕組みがあるが、こちらにはコード体系が無いため、
   * 「出庫した人」の名前をそのまま入れている。今表示している絞り込み・並び順のまま出力する。
   */
  function onExportExternalCsv() {
    var rows = App.store.listShipments(currentFilter(), 'normal', sortOrder);
    var csvRows = [
      ['出荷日', '伝票入力担当者コード', '出荷先コード', '出荷先小番', '出荷先名1', '出荷先名2', '受注番号1', '受注番号2', '受注番号3', '商品コード']
    ];
    rows.forEach(function (row) {
      csvRows.push([
        formatExternalDate(row.shippedAt),
        row.shippedBy || '',
        row.destinationCode || '',
        row.destinationSubCode || '',
        row.destinationName1 || '',
        row.destinationName2 || '',
        row.orderNumber1 || '',
        row.orderNumber2 || '',
        row.orderNumber3 || '',
        row.productCode
      ]);
    });
    App.ui.downloadCsv('出荷CSV_' + todayStamp() + '.csv', csvRows);
  }

  function render() {
    var rows = App.store.listShipments(currentFilter(), 'normal', sortOrder);
    App.ui.clear(body);
    countLabel.textContent = rows.length + ' 件';

    if (rows.length === 0) {
      body.appendChild(App.ui.emptyRow(COLUMNS, '該当する出庫履歴がありません。'));
      return;
    }

    rows.forEach(function (row) {
      var tr = App.ui.el('tr');
      [
        row.productCode,
        row.productName,
        row.storageLocation || '—',
        row.quantity + ' 個',
        row.arrivalDate || '—',
        row.shippedBy,
        row.orderTo,
        row.endUser
      ].forEach(function (value) {
        tr.appendChild(App.ui.el('td', null, value));
      });
      tr.appendChild(App.ui.el('td', 'col-remarks', row.remarks || ''));
      tr.appendChild(App.ui.el('td', null, App.ui.formatDateTime(row.shippedAt)));

      var statusCell = App.ui.el('td');
      statusCell.appendChild(statusBadge(row.status));
      tr.appendChild(statusCell);

      var actionCell = App.ui.el('td', 'col-action');
      if (row.status === 'shipped') {
        var cancelButton = App.ui.el('button', 'btn btn--ghost btn--sm', 'キャンセル');
        cancelButton.type = 'button';
        cancelButton.addEventListener('click', function () { onCancel(row); });
        actionCell.appendChild(cancelButton);
      } else {
        actionCell.appendChild(App.ui.el('span', 'muted', '—'));
      }
      tr.appendChild(actionCell);

      body.appendChild(tr);
    });
  }

  function init() {
    searchForm = document.getElementById('history-search');
    body = document.getElementById('history-body');
    countLabel = document.getElementById('history-count');
    sortButton = document.getElementById('history-sort-date');
    sortArrow = document.getElementById('history-sort-arrow');
    exportButton = document.getElementById('history-export-csv');
    exportExternalButton = document.getElementById('history-export-external-csv');

    var onInput = App.ui.debounce(render, 200);
    searchForm.addEventListener('input', onInput);
    searchForm.addEventListener('change', render);
    searchForm.addEventListener('submit', function (event) { event.preventDefault(); render(); });
    sortButton.addEventListener('click', toggleSort);
    exportButton.addEventListener('click', onExportCsv);
    exportExternalButton.addEventListener('click', onExportExternalCsv);
  }

  App.views.history = { onShow: render };

  return { init: init, render: render };
})();
