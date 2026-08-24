/* フィルター出庫履歴：フィルター商品の出庫実績の一覧と、出庫済み商品のキャンセル（在庫へ戻す）。 */
window.App = window.App || {};
App.views = App.views || {};

App.filterHistory = (function () {
  'use strict';

  var COLUMNS = 11;

  var searchForm, body, countLabel;

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
      message: '「' + row.productCode + ' / 製造番号 ' + row.serialNo + '」の出庫をキャンセルし、在庫に戻します。よろしいですか？',
      okLabel: 'キャンセルする',
      danger: true
    }).then(function (approved) {
      if (!approved) return;

      var result = App.store.cancelShipment(row.id);
      if (!result.ok) {
        App.ui.toast(result.message, 'error');
        return;
      }

      render();
      App.filterInventory.render();
      App.ui.toast('出庫をキャンセルし、在庫に戻しました。', 'success');
    });
  }

  function render() {
    var rows = App.store.listFilterShipments(currentFilter());
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
        row.serialNo,
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
    searchForm = document.getElementById('filter-history-search');
    body = document.getElementById('filter-history-body');
    countLabel = document.getElementById('filter-history-count');

    var onInput = App.ui.debounce(render, 200);
    searchForm.addEventListener('input', onInput);
    searchForm.addEventListener('change', render);
    searchForm.addEventListener('submit', function (event) { event.preventDefault(); render(); });
  }

  App.views['filter-history'] = { onShow: render };

  return { init: init, render: render };
})();
