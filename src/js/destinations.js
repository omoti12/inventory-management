/* 出荷先マスタ：出庫・フィルター出庫の出荷先コード・小番・出荷先名1/2を自動入力するための
   あらかじめの登録・編集・削除と、CSVからの一括登録。 */
window.App = window.App || {};
App.views = App.views || {};

App.destinations = (function () {
  'use strict';

  var COLUMNS = 5;
  var FIELD_NAMES = ['destinationCode', 'destinationSubCode', 'destinationName1', 'destinationName2'];
  var form, body, countLabel, formTitle, submitButton, cancelEditButton;
  var importInput, importButton;
  var editingId = null;

  function summarizeCodes(codes) {
    if (codes.length <= 10) return codes.join('、');
    return codes.slice(0, 10).join('、') + ' 他' + (codes.length - 10) + '件';
  }

  /**
   * CSVの行を1件ずつ順番に登録する（重複チェックが最新の登録状況を見られるよう直列に実行）。
   * 列の順序は「出荷先コード・出荷先小番・出荷先名1・出荷先名2」。
   */
  function importRows(rows) {
    var summary = { added: 0, skipped: [], failed: [] };

    return rows.reduce(function (chain, cells) {
      var code = (cells[0] || '').trim();
      var subCode = (cells[1] || '').trim();
      var name1 = (cells[2] || '').trim();
      var name2 = (cells[3] || '').trim();
      if (!code && !subCode && !name1 && !name2) return chain;

      var label = code + (subCode ? '-' + subCode : '');
      return chain.then(function () {
        return App.store.addDestination({
          destinationCode: code,
          destinationSubCode: subCode,
          destinationName1: name1,
          destinationName2: name2
        }).then(function (result) {
          if (result.ok) {
            summary.added++;
          } else if (result.errors && result.errors._duplicate) {
            summary.skipped.push(label || '(コード未入力)');
          } else {
            var message = (result.errors && result.errors.destinationCode) || '登録に失敗しました';
            summary.failed.push((label || '(コード未入力)') + '：' + message);
          }
        });
      });
    }, Promise.resolve()).then(function () { return summary; });
  }

  function onImport() {
    var file = importInput.files[0];
    if (!file) {
      App.ui.toast('CSVファイルを選択してください。', 'error');
      return;
    }

    importButton.disabled = true;
    App.ui.parseCsvFile(file).then(function (rows) {
      return importRows(rows.slice(1));
    }).then(function (summary) {
      render();
      refreshShippingForms();

      var message = summary.added + '件を登録しました。';
      if (summary.skipped.length > 0) {
        message += ' ' + summary.skipped.length + '件は既に登録済みのためスキップしました（' + summarizeCodes(summary.skipped) + '）。';
      }
      if (summary.failed.length > 0) {
        message += ' ' + summary.failed.length + '件は失敗しました（' + summarizeCodes(summary.failed) + '）。';
      }
      App.ui.toast(message, summary.failed.length > 0 ? 'error' : 'success');
      importInput.value = '';
    }).catch(function (err) {
      App.ui.toast('CSVの読み込みに失敗しました：' + err.message, 'error');
    }).then(function () {
      importButton.disabled = false;
    });
  }

  function values() {
    var data = new FormData(form);
    var result = {};
    FIELD_NAMES.forEach(function (name) { result[name] = data.get(name) || ''; });
    return result;
  }

  function setValues(destination) {
    FIELD_NAMES.forEach(function (name) {
      form.elements[name].value = destination ? destination[name] : '';
    });
  }

  function setEditMode(destination) {
    editingId = destination ? destination.id : null;
    formTitle.textContent = destination ? '出荷先を編集' : '出荷先を登録';
    submitButton.textContent = destination ? '更新する' : '登録する';
    cancelEditButton.hidden = !destination;
    setValues(destination);
    App.ui.clearFieldErrors(form);
  }

  function startEdit(destination) {
    setEditMode(destination);
    form.elements.destinationCode.focus();
  }

  /** 出庫・フィルター出庫フォームの出荷先コードの候補一覧を作り直させる。 */
  function refreshShippingForms() {
    if (App.shipping && typeof App.shipping.refreshDestinations === 'function') App.shipping.refreshDestinations();
    if (App.filterShipping && typeof App.filterShipping.refreshDestinations === 'function') App.filterShipping.refreshDestinations();
  }

  function onDelete(destination) {
    var label = destination.destinationCode + (destination.destinationSubCode ? '-' + destination.destinationSubCode : '');
    App.ui.confirm({
      title: '出荷先の削除',
      message: '「' + label + ' ' + destination.destinationName1 + '」を削除します。過去の出庫履歴には影響しません。よろしいですか？',
      okLabel: '削除する',
      danger: true
    }).then(function (approved) {
      if (!approved) return;

      App.store.deleteDestination(destination.id).then(function (result) {
        if (!result.ok) {
          App.ui.toast(result.message, 'error');
          return;
        }

        if (editingId === destination.id) setEditMode(null);
        render();
        refreshShippingForms();
        App.ui.toast('「' + label + '」を削除しました。', 'success');
      });
    });
  }

  function render() {
    var destinations = App.store.listDestinations();
    App.ui.clear(body);
    countLabel.textContent = destinations.length + ' 件';

    if (destinations.length === 0) {
      body.appendChild(App.ui.emptyRow(COLUMNS, '出荷先がまだ登録されていません。上のフォームまたはCSVから登録してください。'));
      return;
    }

    destinations.forEach(function (destination) {
      var tr = App.ui.el('tr', editingId === destination.id ? 'row-editing' : null);

      tr.appendChild(App.ui.el('td', null, destination.destinationCode));
      tr.appendChild(App.ui.el('td', null, destination.destinationSubCode || '—'));
      tr.appendChild(App.ui.el('td', null, destination.destinationName1 || '—'));
      tr.appendChild(App.ui.el('td', null, destination.destinationName2 || '—'));

      var actionCell = App.ui.el('td', 'col-action');

      var editButton = App.ui.el('button', 'btn btn--ghost btn--sm', '編集');
      editButton.type = 'button';
      editButton.addEventListener('click', function () { startEdit(destination); });
      actionCell.appendChild(editButton);

      var deleteButton = App.ui.el('button', 'btn btn--ghost btn--sm', '削除');
      deleteButton.type = 'button';
      deleteButton.addEventListener('click', function () { onDelete(destination); });
      actionCell.appendChild(deleteButton);

      tr.appendChild(actionCell);
      body.appendChild(tr);
    });
  }

  function onSubmit(event) {
    event.preventDefault();

    var input = values();
    var wasEditing = editingId !== null;
    var promise = wasEditing
      ? App.store.updateDestination(editingId, input)
      : App.store.addDestination(input);

    promise.then(function (result) {
      if (!result.ok) {
        App.ui.showFieldErrors(form, result.errors);
        return;
      }

      var label = result.destination.destinationCode + (result.destination.destinationSubCode ? '-' + result.destination.destinationSubCode : '');
      setEditMode(null);
      render();
      refreshShippingForms();
      App.ui.toast(
        wasEditing ? '「' + label + '」を更新しました。' : '「' + label + '」を登録しました。',
        'success'
      );
    });
  }

  function init() {
    form = document.getElementById('destinations-form');
    body = document.getElementById('destinations-body');
    countLabel = document.getElementById('destinations-count');
    formTitle = document.getElementById('destinations-form-title');
    submitButton = document.getElementById('destinations-submit');
    cancelEditButton = document.getElementById('destinations-cancel-edit');
    importInput = document.getElementById('destinations-import-file');
    importButton = document.getElementById('destinations-import-btn');

    importButton.addEventListener('click', onImport);

    form.addEventListener('submit', onSubmit);
    form.addEventListener('input', function (event) {
      var name = event.target.name;
      if (!name) return;
      var message = form.querySelector('[data-error-for="' + name + '"]');
      if (message) message.textContent = '';
      event.target.classList.remove('is-invalid');
    });

    cancelEditButton.addEventListener('click', function () {
      setEditMode(null);
    });

    setEditMode(null);
  }

  App.views.destinations = { onShow: render };

  return { init: init, render: render };
})();
