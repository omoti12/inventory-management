/* 商品管理：入庫時に選ぶ商品マスタ（通常品）の登録・編集・削除。 */
window.App = window.App || {};
App.views = App.views || {};

App.products = (function () {
  'use strict';

  var CATEGORY = 'normal';
  var COLUMNS = 6;
  var FIELD_NAMES = ['productCode', 'productName', 'storageLocation'];
  var form, body, countLabel, formTitle, submitButton, cancelEditButton;
  var importInput, importButton;
  var editingId = null;

  function summarizeCodes(codes) {
    if (codes.length <= 10) return codes.join('、');
    return codes.slice(0, 10).join('、') + ' 他' + (codes.length - 10) + '件';
  }

  /** CSVの行を1件ずつ順番に登録する（重複チェックが最新の登録状況を見られるよう直列に実行）。 */
  function importRows(rows) {
    var summary = { added: 0, skipped: [], failed: [] };

    return rows.reduce(function (chain, cells) {
      var code = (cells[0] || '').trim();
      var name = (cells[1] || '').trim();
      if (!code && !name) return chain;

      return chain.then(function () {
        return App.store.addProduct({ productCode: code, productName: name, category: CATEGORY }).then(function (result) {
          if (result.ok) {
            summary.added++;
          } else if (result.errors && result.errors._duplicate) {
            summary.skipped.push(code || '(コード未入力)');
          } else {
            var message = (result.errors && (result.errors.productCode || result.errors.productName)) || '登録に失敗しました';
            summary.failed.push((code || '(コード未入力)') + '：' + message);
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
      App.inbound.refreshProducts();

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
    var result = { category: CATEGORY };
    FIELD_NAMES.forEach(function (name) { result[name] = data.get(name) || ''; });
    return result;
  }

  function setValues(product) {
    FIELD_NAMES.forEach(function (name) {
      form.elements[name].value = product ? product[name] : '';
    });
  }

  function setEditMode(product) {
    editingId = product ? product.id : null;
    formTitle.textContent = product ? '商品を編集' : '商品を登録';
    submitButton.textContent = product ? '更新する' : '登録する';
    cancelEditButton.hidden = !product;
    setValues(product);
    App.ui.clearFieldErrors(form);
  }

  function startEdit(product) {
    setEditMode(product);
    form.elements.productCode.focus();
  }

  function onDelete(product) {
    var usage = App.store.productUsage(product.id);
    var message = usage.total > 0
      ? '「' + product.productCode + ' ' + product.productName + '」は在庫 ' + usage.inStock +
        ' 個・出庫済み ' + usage.shipped + ' 個で使われています。削除すると、それらの在庫一覧・' +
        '出庫履歴の表示は「(削除済み商品)」になります。それでも削除しますか？'
      : '「' + product.productCode + ' ' + product.productName + '」を削除します。よろしいですか？';

    App.ui.confirm({
      title: '商品の削除',
      message: message,
      okLabel: '削除する',
      danger: true
    }).then(function (approved) {
      if (!approved) return;

      App.store.deleteProduct(product.id).then(function (result) {
        if (!result.ok) {
          App.ui.toast(result.message, 'error');
          render();
          return;
        }

        if (editingId === product.id) setEditMode(null);
        render();
        App.inbound.refreshProducts();
        App.ui.toast('「' + product.productCode + '」を削除しました。', 'success');
      });
    });
  }

  function render() {
    var products = App.store.listProducts(CATEGORY);
    App.ui.clear(body);
    countLabel.textContent = products.length + ' 件';

    if (products.length === 0) {
      body.appendChild(App.ui.emptyRow(COLUMNS, '商品がまだ登録されていません。上のフォームから登録してください。'));
      return;
    }

    products.forEach(function (product) {
      var usage = App.store.productUsage(product.id);
      var tr = App.ui.el('tr', editingId === product.id ? 'row-editing' : null);

      tr.appendChild(App.ui.el('td', null, product.productCode));
      tr.appendChild(App.ui.el('td', null, product.productName));
      tr.appendChild(App.ui.el('td', null, product.storageLocation || '—'));
      tr.appendChild(App.ui.el('td', 'col-num', usage.inStock + ' 個'));
      tr.appendChild(App.ui.el('td', 'col-num', usage.shipped + ' 個'));

      var actionCell = App.ui.el('td', 'col-action');

      var editButton = App.ui.el('button', 'btn btn--ghost btn--sm', '編集');
      editButton.type = 'button';
      editButton.addEventListener('click', function () { startEdit(product); });
      actionCell.appendChild(editButton);

      var deleteButton = App.ui.el('button', 'btn btn--ghost btn--sm', '削除');
      deleteButton.type = 'button';
      if (usage.total > 0) {
        /* 使用中でも削除は可能。誤って使ってしまった場合のために、理由だけその場で伝える。 */
        deleteButton.title = '在庫 ' + usage.inStock + ' 個・出庫済み ' + usage.shipped + ' 個で使われています';
      }
      deleteButton.addEventListener('click', function () { onDelete(product); });
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
      ? App.store.updateProduct(editingId, input)
      : App.store.addProduct(input);

    promise.then(function (result) {
      if (!result.ok) {
        App.ui.showFieldErrors(form, result.errors);
        return;
      }

      setEditMode(null);
      render();
      App.inbound.refreshProducts();
      App.ui.toast(
        wasEditing
          ? '「' + result.product.productCode + '」を更新しました。'
          : '「' + result.product.productCode + '」を登録しました。',
        'success'
      );
    });
  }

  function init() {
    form = document.getElementById('products-form');
    body = document.getElementById('products-body');
    countLabel = document.getElementById('products-count');
    formTitle = document.getElementById('products-form-title');
    submitButton = document.getElementById('products-submit');
    cancelEditButton = document.getElementById('products-cancel-edit');
    importInput = document.getElementById('products-import-file');
    importButton = document.getElementById('products-import-btn');

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

  App.views.products = { onShow: render };

  return { init: init, render: render };
})();
