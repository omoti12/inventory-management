/* フィルター商品管理：フィルター入庫・フィルター出庫で使う商品マスタの登録・編集・削除。 */
window.App = window.App || {};
App.views = App.views || {};

App.filterProducts = (function () {
  'use strict';

  var CATEGORY = 'filter';
  var COLUMNS = 6;
  var FIELD_NAMES = ['productCode', 'productName'];
  var form, body, countLabel, formTitle, submitButton, cancelEditButton;
  var importInput, importButton, selectAllCheckbox, bulkDeleteButton;
  var editingId = null;
  var selectedIds = {};

  function summarizeCodes(codes) {
    if (codes.length <= 10) return codes.join('、');
    return codes.slice(0, 10).join('、') + ' 他' + (codes.length - 10) + '件';
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
      App.filterInbound.refreshProducts();

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
    formTitle.textContent = product ? 'フィルター商品を編集' : 'フィルター商品を登録';
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
      title: 'フィルター商品の削除',
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
        App.filterInbound.refreshProducts();
        App.ui.toast('「' + product.productCode + '」を削除しました。', 'success');
      });
    });
  }

  /** ヘッダーの全選択チェックボックスと、一括削除ボタンの有効/無効・件数表示を今の選択状況に合わせる。 */
  function syncSelectionUi(products) {
    var total = products.length;
    var checked = products.filter(function (p) { return !!selectedIds[p.id]; }).length;

    selectAllCheckbox.checked = total > 0 && checked === total;
    selectAllCheckbox.indeterminate = checked > 0 && checked < total;
    bulkDeleteButton.disabled = checked === 0;
    bulkDeleteButton.textContent = checked > 0 ? '選択した' + checked + '件を削除' : '選択した件を削除';
  }

  function onBulkDelete() {
    var ids = Object.keys(selectedIds);
    if (ids.length === 0) return;

    var usedCount = 0, totalInStock = 0, totalShipped = 0;
    ids.forEach(function (id) {
      var usage = App.store.productUsage(id);
      if (usage.total > 0) usedCount++;
      totalInStock += usage.inStock;
      totalShipped += usage.shipped;
    });

    var message = '選択した' + ids.length + '件のフィルター商品を削除します。';
    if (usedCount > 0) {
      message += 'うち' + usedCount + '件は在庫・出庫履歴で使われています（在庫 合計' + totalInStock +
        ' 個・出庫済み 合計' + totalShipped + ' 個）。削除すると、それらの在庫一覧・出庫履歴の表示は' +
        '「(削除済み商品)」になります。';
    }
    message += 'それでも削除しますか？';

    App.ui.confirm({
      title: 'フィルター商品の削除',
      message: message,
      okLabel: '削除する',
      danger: true
    }).then(function (approved) {
      if (!approved) return;

      runBulk(ids, App.store.deleteProduct).then(function (summary) {
        selectedIds = {};
        if (editingId && ids.indexOf(editingId) !== -1) setEditMode(null);
        render();
        App.filterInbound.refreshProducts();
        if (summary.successCount > 0) App.ui.toast(summary.successCount + '件のフィルター商品をまとめて削除しました。', 'success');
        if (summary.firstError) App.ui.toast(summary.firstError, 'error');
      });
    });
  }

  function render() {
    var products = App.store.listProducts(CATEGORY);
    App.ui.clear(body);
    countLabel.textContent = products.length + ' 件';

    if (products.length === 0) {
      body.appendChild(App.ui.emptyRow(COLUMNS, 'フィルター商品がまだ登録されていません。上のフォームから登録してください。'));
      syncSelectionUi(products);
      return;
    }

    products.forEach(function (product) {
      var usage = App.store.productUsage(product.id);
      var tr = App.ui.el('tr', editingId === product.id ? 'row-editing' : null);

      var checkCell = App.ui.el('td', 'col-check');
      var checkbox = App.ui.el('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!selectedIds[product.id];
      checkbox.setAttribute('aria-label', product.productCode + ' ' + product.productName + 'を選択');
      checkbox.addEventListener('change', function () {
        if (checkbox.checked) selectedIds[product.id] = true;
        else delete selectedIds[product.id];
        syncSelectionUi(products);
      });
      checkCell.appendChild(checkbox);
      tr.appendChild(checkCell);

      tr.appendChild(App.ui.el('td', null, product.productCode));
      tr.appendChild(App.ui.el('td', null, product.productName));
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
        deleteButton.title = '在庫 ' + usage.inStock + ' 個・出庫済み ' + usage.shipped + ' 個で使われています';
      }
      deleteButton.addEventListener('click', function () { onDelete(product); });
      actionCell.appendChild(deleteButton);

      tr.appendChild(actionCell);
      body.appendChild(tr);
    });

    syncSelectionUi(products);
  }

  /**
   * 登録・更新ボタンを押してからトースト表示までの間にもう一度押せてしまうと、全く同じ
   * 内容が二重に登録されてしまう（Graphへの書き込みは非同期なので一瞬の隙ができる）。
   * それを防ぐため、書き込みが終わるまでボタンを無効化する。
   */
  function onSubmit(event) {
    event.preventDefault();

    var input = values();
    var wasEditing = editingId !== null;

    submitButton.disabled = true;
    var promise = wasEditing
      ? App.store.updateProduct(editingId, input)
      : App.store.addProduct(input);

    promise.then(function (result) {
      submitButton.disabled = false;

      if (!result.ok) {
        App.ui.showFieldErrors(form, result.errors);
        return;
      }

      setEditMode(null);
      render();
      App.filterInbound.refreshProducts();
      App.ui.toast(
        wasEditing
          ? '「' + result.product.productCode + '」を更新しました。'
          : '「' + result.product.productCode + '」を登録しました。',
        'success'
      );
    });
  }

  function init() {
    form = document.getElementById('filter-products-form');
    body = document.getElementById('filter-products-body');
    countLabel = document.getElementById('filter-products-count');
    formTitle = document.getElementById('filter-products-form-title');
    submitButton = document.getElementById('filter-products-submit');
    cancelEditButton = document.getElementById('filter-products-cancel-edit');
    importInput = document.getElementById('filter-products-import-file');
    importButton = document.getElementById('filter-products-import-btn');
    selectAllCheckbox = document.getElementById('filter-products-select-all');
    bulkDeleteButton = document.getElementById('filter-products-bulk-delete');

    importButton.addEventListener('click', onImport);

    selectAllCheckbox.addEventListener('change', function () {
      var products = App.store.listProducts(CATEGORY);
      products.forEach(function (product) {
        if (selectAllCheckbox.checked) selectedIds[product.id] = true;
        else delete selectedIds[product.id];
      });
      render();
    });
    bulkDeleteButton.addEventListener('click', onBulkDelete);

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

  App.views['filter-products'] = { onShow: render };

  return { init: init, render: render };
})();
