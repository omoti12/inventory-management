/* 月次締め：会計ソフト等への取り込みが終わった月を締めて、以降その月の入庫・出庫記録を
   編集・削除・キャンセルできなくする。「何月分の記録か」の判定は登録日時（Itemsの
   registeredAt / Shipmentsの shippedAt）を使うため、締めるのは常に過去の月になる
   （新規登録の登録日時は必ず今なので、締め対象になることはない）。実際の判定・保存は
   store.js（isMonthLocked/lockMonth/unlockMonth）が行い、このモジュールは締め済みの月の
   一覧表示と、締める/解除する操作のUIだけを担当する。 */
window.App = window.App || {};
App.views = App.views || {};

App.monthLocks = (function () {
  'use strict';

  var COLUMNS = 4;

  var input, errorText, submitButton, countLabel, body;

  /** 締め・解除の結果を、既に表示されているかもしれない4つの履歴画面にも反映する。 */
  function refreshHistoryViews() {
    App.inboundHistory.render();
    App.filterInboundHistory.render();
    App.history.render();
    App.filterHistory.render();
  }

  function onSubmit() {
    var yearMonth = input.value;
    errorText.textContent = '';

    if (!yearMonth) {
      errorText.textContent = '月を選択してください。';
      return;
    }

    var account = App.auth.getAccount();
    var lockedBy = (account && (account.name || account.username)) || '';

    App.ui.confirm({
      title: '月次締め',
      message: yearMonth + ' 分の入庫・出庫記録（通常品・フィルター品とも）を締めます。' +
        '以降、この月の記録は編集・削除・キャンセルができなくなります。よろしいですか？',
      okLabel: '締める',
      danger: true
    }).then(function (approved) {
      if (!approved) return;

      submitButton.disabled = true;
      App.store.lockMonth(yearMonth, lockedBy).then(function (result) {
        submitButton.disabled = false;
        if (!result.ok) {
          errorText.textContent = result.message;
          return;
        }

        input.value = '';
        render();
        refreshHistoryViews();
        App.ui.toast(yearMonth + ' を締めました。', 'success');
      });
    });
  }

  function onUnlock(lock) {
    App.ui.confirm({
      title: '締めの解除',
      message: lock.yearMonth + ' の締めを解除します。解除すると、この月の記録が再び編集・削除できるようになります。よろしいですか？',
      okLabel: '解除する',
      danger: true
    }).then(function (approved) {
      if (!approved) return;

      App.store.unlockMonth(lock.id).then(function (result) {
        if (!result.ok) {
          App.ui.toast(result.message, 'error');
          return;
        }

        render();
        refreshHistoryViews();
        App.ui.toast(lock.yearMonth + ' の締めを解除しました。', 'success');
      });
    });
  }

  function render() {
    var locks = App.store.listMonthLocks();
    App.ui.clear(body);
    countLabel.textContent = locks.length + ' 件';

    if (locks.length === 0) {
      body.appendChild(App.ui.emptyRow(COLUMNS, '締め済みの月はまだありません。'));
      return;
    }

    locks.forEach(function (lock) {
      var tr = App.ui.el('tr');
      tr.appendChild(App.ui.el('td', null, lock.yearMonth));
      tr.appendChild(App.ui.el('td', null, App.ui.formatDateTime(lock.lockedAt)));
      tr.appendChild(App.ui.el('td', null, lock.lockedBy || '—'));

      var actionCell = App.ui.el('td', 'col-action');
      var unlockButton = App.ui.el('button', 'btn btn--ghost btn--sm', '解除する');
      unlockButton.type = 'button';
      unlockButton.addEventListener('click', function () { onUnlock(lock); });
      actionCell.appendChild(unlockButton);
      tr.appendChild(actionCell);

      body.appendChild(tr);
    });
  }

  function init() {
    input = document.getElementById('month-locks-input');
    errorText = document.getElementById('month-locks-error');
    submitButton = document.getElementById('month-locks-submit');
    countLabel = document.getElementById('month-locks-count');
    body = document.getElementById('month-locks-body');

    submitButton.addEventListener('click', onSubmit);
  }

  App.views['month-locks'] = { onShow: render };

  return { init: init, render: render };
})();
