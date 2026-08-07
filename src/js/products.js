/* 商品管理：入庫時にプルダウンで選ぶ商品マスタの登録・編集・削除。 */
window.App = window.App || {};
App.views = App.views || {};

App.products = (function () {
  'use strict';

  var COLUMNS = 6;
  var FIELD_NAMES = ['modelName', 'dimensions', 'drawingNo'];

  var form, body, countLabel, formTitle, submitButton, cancelEditButton;
  var editingId = null;

  function values() {
    var data = new FormData(form);
    var result = {};
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
    form.elements.modelName.focus();
  }

  function onDelete(product) {
    App.ui.confirm({
      title: '商品の削除',
      message: '「' + product.modelName + '」を削除します。よろしいですか？',
      okLabel: '削除する',
      danger: true
    }).then(function (approved) {
      if (!approved) return;

      var result = App.store.deleteProduct(product.id);
      if (!result.ok) {
        App.ui.toast(result.message, 'error');
        render();
        return;
      }

      if (editingId === product.id) setEditMode(null);
      render();
      App.inbound.refreshProducts();
      App.ui.toast('「' + product.modelName + '」を削除しました。', 'success');
    });
  }

  function render() {
    var products = App.store.listProducts();
    App.ui.clear(body);
    countLabel.textContent = products.length + ' 件';

    if (products.length === 0) {
      body.appendChild(App.ui.emptyRow(COLUMNS, '商品がまだ登録されていません。上のフォームから登録してください。'));
      return;
    }

    products.forEach(function (product) {
      var usage = App.store.productUsage(product.id);
      var tr = App.ui.el('tr', editingId === product.id ? 'row-editing' : null);

      tr.appendChild(App.ui.el('td', null, product.modelName));
      tr.appendChild(App.ui.el('td', null, product.dimensions));
      tr.appendChild(App.ui.el('td', null, product.drawingNo));
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
        /* 在庫や履歴から参照されている商品は消せない。理由をその場で伝える。 */
        deleteButton.disabled = true;
        deleteButton.title = '在庫 ' + usage.inStock + ' 個・出荷済み ' + usage.shipped + ' 個で使われているため削除できません';
      } else {
        deleteButton.addEventListener('click', function () { onDelete(product); });
      }
      actionCell.appendChild(deleteButton);

      tr.appendChild(actionCell);
      body.appendChild(tr);
    });
  }

  function onSubmit(event) {
    event.preventDefault();

    var input = values();
    var result = editingId
      ? App.store.updateProduct(editingId, input)
      : App.store.addProduct(input);

    if (!result.ok) {
      App.ui.showFieldErrors(form, result.errors);
      return;
    }

    var wasEditing = editingId !== null;
    setEditMode(null);
    render();
    App.inbound.refreshProducts();
    App.ui.toast(
      wasEditing
        ? '「' + result.product.modelName + '」を更新しました。'
        : '「' + result.product.modelName + '」を登録しました。',
      'success'
    );
  }

  function init() {
    form = document.getElementById('products-form');
    body = document.getElementById('products-body');
    countLabel = document.getElementById('products-count');
    formTitle = document.getElementById('products-form-title');
    submitButton = document.getElementById('products-submit');
    cancelEditButton = document.getElementById('products-cancel-edit');

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
