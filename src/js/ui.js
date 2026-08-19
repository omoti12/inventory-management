/* 画面共通の部品（タブ切替・テーブル生成・トースト・確認ダイアログ・整形）。 */
window.App = window.App || {};
App.views = App.views || {};

App.ui = (function () {
  'use strict';

  var VIEWS = [
  'inventory',
  'inbound',
  'shipping',
  'history',
  'products',
  'filter-inbound',
  'filter-shipping',
  'filter-history',
  'filter-products'
  ];
  var currentView = null;

  /* --- DOM ヘルパー ---------------------------------------------------- */

  function el(tag, className, textContent) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent !== undefined && textContent !== null) node.textContent = String(textContent);
    return node;
  }

  /** 文字列セルの配列から <tr> を作る。値は textContent で入れるのでエスケープ不要。 */
  function row(values, className) {
    var tr = el('tr', className);
    values.forEach(function (value) {
      tr.appendChild(el('td', null, value === undefined || value === null ? '' : value));
    });
    return tr;
  }

  /** データが0件のときの案内行。 */
  function emptyRow(colspan, message) {
    var tr = el('tr', 'row-empty');
    var td = el('td', null, message);
    td.colSpan = colspan;
    tr.appendChild(td);
    return tr;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  }

  /* --- 表示整形 -------------------------------------------------------- */

  function formatMonth(value) {
    var match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
    if (!match) return value || '';
    return match[1] + '年' + Number(match[2]) + '月';
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function formatDateTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* --- フォームのエラー表示 -------------------------------------------- */

  function clearFieldErrors(form) {
    form.querySelectorAll('.form-error').forEach(function (node) { node.textContent = ''; });
    form.querySelectorAll('.is-invalid').forEach(function (node) { node.classList.remove('is-invalid'); });
  }

  /** { フィールド名: メッセージ } を各項目の下に表示し、最初の項目へフォーカスする。 */
  function showFieldErrors(form, errors) {
    clearFieldErrors(form);
    var firstInput = null;
    Object.keys(errors || {}).forEach(function (key) {
      var message = form.querySelector('[data-error-for="' + key + '"]');
      if (message) message.textContent = errors[key];
      var input = form.querySelector('[name="' + key + '"]');
      if (input) {
        input.classList.add('is-invalid');
        if (!firstInput) firstInput = input;
      }
    });
    if (firstInput) firstInput.focus();
  }

  /* --- トースト -------------------------------------------------------- */

  function toast(message, type) {
    var stack = document.getElementById('toast-stack');
    var node = el('div', 'toast' + (type ? ' toast--' + type : ''), message);
    stack.appendChild(node);
    setTimeout(function () {
      node.classList.add('is-leaving');
      setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 200);
    }, 3200);
  }

  /* --- 確認ダイアログ -------------------------------------------------- */

  function confirmDialog(options) {
    var opts = options || {};
    var dialog = document.getElementById('confirm-dialog');
    var okButton = document.getElementById('confirm-ok');

    document.getElementById('confirm-title').textContent = opts.title || '確認';
    document.getElementById('confirm-body').textContent = opts.message || '';
    okButton.textContent = opts.okLabel || 'OK';
    okButton.className = 'btn ' + (opts.danger ? 'btn--danger' : 'btn--primary');

    if (typeof dialog.showModal !== 'function') {
      return Promise.resolve(window.confirm(opts.message || '実行しますか？'));
    }

    return new Promise(function (resolve) {
      function done(result) {
        okButton.removeEventListener('click', onOk);
        cancelButton.removeEventListener('click', onCancel);
        dialog.removeEventListener('cancel', onCancel);
        if (dialog.open) dialog.close();
        resolve(result);
      }
      function onOk() { done(true); }
      function onCancel(event) {
        if (event) event.preventDefault();
        done(false);
      }
      var cancelButton = document.getElementById('confirm-cancel');
      okButton.addEventListener('click', onOk);
      cancelButton.addEventListener('click', onCancel);
      dialog.addEventListener('cancel', onCancel);
      dialog.showModal();
    });
  }

  /* --- 画面切替 -------------------------------------------------------- */

  function showView(name) {
    if (VIEWS.indexOf(name) === -1) return;
    currentView = name;

    VIEWS.forEach(function (view) {
      document.getElementById('view-' + view).hidden = view !== name;
    });
    document.querySelectorAll('#main-tabs .tab').forEach(function (tab) {
      var active = tab.dataset.view === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-current', active ? 'page' : 'false');
    });

    var view = App.views[name];
    if (view && typeof view.onShow === 'function') view.onShow();
    window.scrollTo(0, 0);
  }

  function getCurrentView() {
    return currentView;
  }

  function init() {
    document.querySelectorAll('#main-tabs .tab').forEach(function (tab) {
      tab.addEventListener('click', function () { showView(tab.dataset.view); });
    });
  }

  return {
    el: el,
    row: row,
    emptyRow: emptyRow,
    clear: clear,
    debounce: debounce,
    formatMonth: formatMonth,
    formatDateTime: formatDateTime,
    clearFieldErrors: clearFieldErrors,
    showFieldErrors: showFieldErrors,
    toast: toast,
    confirm: confirmDialog,
    showView: showView,
    getCurrentView: getCurrentView,
    init: init
  };
})();
