/* 画面共通の部品（タブ切替・テーブル生成・トースト・確認ダイアログ・整形）。 */
window.App = window.App || {};
App.views = App.views || {};

App.ui = (function () {
  'use strict';

  var VIEWS = [
  'inventory',
  'inbound',
  'inbound-history',
  'shipping',
  'history',
  'products',
  'destinations',
  'filter-inventory',
  'filter-inbound',
  'filter-inbound-history',
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

  /**
   * 「YYYY-MM-DD」の日付（<input type="date">の値）に、今の時刻を組み合わせてISO日時にする。
   * 出庫日を任意で指定できるようにするための変換で、時刻までは指定させないため今の時刻を使う。
   * dateStr が空なら null を返す（呼び出し側は「未指定＝今の日時のまま」として扱う）。
   */
  function combineDateWithNow(dateStr) {
    if (!dateStr) return null;
    var now = new Date();
    var d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    d.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    return d.toISOString();
  }

  /* --- CSV読み込み ------------------------------------------------------ */

  /**
   * CSVファイルの文字コードを判定してテキストに変換する。UTF-8（BOM有無どちらも）と、
   * Windows版ExcelでCSV保存したときの既定であるShift_JIS（CP932）の両方に対応する。
   * UTF-8として正しく解釈できない場合だけShift_JISとして読み直す簡易判定。
   */
  function decodeCsvBuffer(buffer) {
    var bytes = new Uint8Array(buffer);
    var hasBom = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
    var body = hasBom ? bytes.subarray(3) : bytes;
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(body);
    } catch (e) {
      return new TextDecoder('shift-jis').decode(body);
    }
  }

  /** 簡易CSVパーサー。ダブルクォート囲み・エスケープ（""）・改行(\r\n / \n)に対応する。 */
  function parseCsvText(text) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;

    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { inQuotes = false; }
        } else {
          field += c;
        }
        continue;
      }
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* 次の \n で改行確定するので無視 */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else { field += c; }
    }
    if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

    return rows.filter(function (r) { return r.some(function (cell) { return cell.trim() !== ''; }); });
  }

  /** CSVファイルを読み込んで行の配列（各行は列の配列）を返す。 */
  function parseCsvFile(file) {
    return file.arrayBuffer().then(decodeCsvBuffer).then(parseCsvText);
  }

  /* --- CSV出力 ------------------------------------------------------------ */

  /**
   * 備考など自由入力の値が「=」「+」「-」「@」で始まっていると、そのCSVをExcel等で開いた時に
   * 数式として実行されてしまう（CSVインジェクション）。危険性のある先頭文字にはシングルクォート
   * を1つ足して文字列として扱わせ、数式として解釈されないようにする。
   */
  function neutralizeFormulaPrefix(str) {
    if (/^[=+\-@\t\r]/.test(str)) {
      return "'" + str;
    }
    return str;
  }

  function escapeCsvField(value) {
    var str = value === null || value === undefined ? '' : String(value);
    str = neutralizeFormulaPrefix(str);
    if (/[",\r\n]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  /**
   * 行の配列（各行は列の配列。1行目はヘッダー）からCSVファイルをダウンロードさせる。
   * 先頭にBOMを付けて保存することで、Excelでそのままダブルクリックで開いたときに
   * 文字化けしないようにしている（BOM無しUTF-8はExcelが既定の文字コードと誤認しやすい）。
   */
  function downloadCsv(filename, rows) {
    var BOM = '﻿';
    var text = rows.map(function (row) {
      return row.map(escapeCsvField).join(',');
    }).join('\r\n');
    var blob = new Blob([BOM + text], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
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

  /* --- 出庫履歴の編集ダイアログ ------------------------------------------ */

  /**
   * 出庫履歴の1件（row。商品コード・製品名・SHIPMENT_FIELDSの各項目を持つ）を編集するダイアログを
   * 開く。出庫履歴・フィルター出庫履歴の両方から共通で使う（編集できる項目はどちらも同じ
   * SHIPMENT_FIELDS のため）。保存されたら入力値のオブジェクトを、キャンセルされたら null を
   * resolve するPromiseを返す。実際の保存（SharePointへの反映）は呼び出し側が
   * App.store.updateShipment() で行う。
   */
  function editShipment(row) {
    var dialog = document.getElementById('shipment-edit-dialog');
    var form = document.getElementById('shipment-edit-form');

    document.getElementById('shipment-edit-product').textContent = row.productCode + ' / ' + row.productName;
    form.elements.shippedBy.value = row.shippedBy || '';
    form.elements.shippedDate.value = (row.shippedAt || '').slice(0, 10);
    form.elements.destinationCode.value = row.destinationCode || '';
    form.elements.destinationSubCode.value = row.destinationSubCode || '';
    form.elements.destinationName1.value = row.destinationName1 || '';
    form.elements.destinationName2.value = row.destinationName2 || '';
    form.elements.orderNumber1.value = row.orderNumber1 || '';
    form.elements.orderNumber2.value = row.orderNumber2 || '';
    form.elements.orderNumber3.value = row.orderNumber3 || '';
    form.elements.remarks.value = row.remarks || '';
    clearFieldErrors(form);

    if (typeof dialog.showModal !== 'function') {
      return Promise.resolve(null);
    }

    return new Promise(function (resolve) {
      var cancelButton = document.getElementById('shipment-edit-cancel');

      function done(result) {
        form.removeEventListener('submit', onSubmit);
        cancelButton.removeEventListener('click', onCancelClick);
        dialog.removeEventListener('cancel', onDialogCancel);
        if (dialog.open) dialog.close();
        resolve(result);
      }

      function onSubmit(event) {
        event.preventDefault();
        var data = new FormData(form);
        var shippedDate = data.get('shippedDate') || '';
        var values = {
          shippedBy: data.get('shippedBy') || '',
          /* shippedDate はフォーム上の生の日付。実際に保存する shippedAt はこれを今の時刻と
             組み合わせた値にする（出庫フォームの出庫日入力と同じ扱い）。 */
          shippedDate: shippedDate,
          shippedAt: combineDateWithNow(shippedDate),
          destinationCode: data.get('destinationCode') || '',
          destinationSubCode: data.get('destinationSubCode') || '',
          destinationName1: data.get('destinationName1') || '',
          destinationName2: data.get('destinationName2') || '',
          orderNumber1: data.get('orderNumber1') || '',
          orderNumber2: data.get('orderNumber2') || '',
          orderNumber3: data.get('orderNumber3') || '',
          remarks: data.get('remarks') || ''
        };

        var missing = (App.store.SHIPMENT_FIELDS || []).filter(function (field) {
          return String(values[field.key]).trim() === '';
        });
        if (missing.length > 0) {
          var errors = {};
          missing.forEach(function (field) { errors[field.key] = field.label + 'を入力してください。'; });
          showFieldErrors(form, errors);
          return;
        }

        done(values);
      }

      function onCancelClick() { done(null); }
      function onDialogCancel(event) {
        if (event) event.preventDefault();
        done(null);
      }

      form.addEventListener('submit', onSubmit);
      cancelButton.addEventListener('click', onCancelClick);
      dialog.addEventListener('cancel', onDialogCancel);
      dialog.showModal();
    });
  }

  /* --- 画面切替 -------------------------------------------------------- */

  var LAST_VIEW_KEY = 'inventory-app:last-view';

  /** 再読み込み後に同じ画面へ戻れるよう、直前に開いていた画面名を覚えておく。 */
  function rememberView(name) {
    try {
      localStorage.setItem(LAST_VIEW_KEY, name);
    } catch (e) {
      /* プライベートブラウジングなどでlocalStorageが使えなくても致命的ではないため無視する。 */
    }
  }

  /** 記憶していた画面名を返す（無ければ null）。 */
  function getRememberedView() {
    try {
      return localStorage.getItem(LAST_VIEW_KEY);
    } catch (e) {
      return null;
    }
  }

  /**
   * 未知の画面名（VIEWSに無い）が渡された場合は何もせず false を返す。
   * 切り替え前の画面に`onHide`があれば、切り替え後に呼ぶ（入力途中のフォームを
   * 離れたタイミングでリセットする、など画面を離れる時だけ行いたい後片付け用）。
   * 同じ画面へのshowView呼び出し（例：コピー機能がstartCopy()の直後に呼ぶ場合）では
   * onHideは呼ばない。
   */
  function showView(name) {
    if (VIEWS.indexOf(name) === -1) return false;
    var previousView = currentView;
    currentView = name;
    rememberView(name);

    VIEWS.forEach(function (view) {
      document.getElementById('view-' + view).hidden = view !== name;
    });
    document.querySelectorAll('#main-tabs .tab').forEach(function (tab) {
      var active = tab.dataset.view === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-current', active ? 'page' : 'false');
    });

    if (previousView && previousView !== name) {
      var previous = App.views[previousView];
      if (previous && typeof previous.onHide === 'function') previous.onHide();
    }

    var view = App.views[name];
    if (view && typeof view.onShow === 'function') view.onShow();
    window.scrollTo(0, 0);
    return true;
  }

  function getCurrentView() {
    return currentView;
  }

  /**
   * 今表示中の画面だけを再描画する（「更新」ボタン用）。showView() と違い、画面の切替や
   * タブのハイライト、ページ先頭へのスクロールは行わない（今見ている場所のまま、表示中の
   * データだけを最新化するため）。
   */
  function refreshCurrentView() {
    var view = App.views[currentView];
    if (view && typeof view.onShow === 'function') view.onShow();
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
    combineDateWithNow: combineDateWithNow,
    parseCsvFile: parseCsvFile,
    downloadCsv: downloadCsv,
    clearFieldErrors: clearFieldErrors,
    showFieldErrors: showFieldErrors,
    toast: toast,
    confirm: confirmDialog,
    editShipment: editShipment,
    showView: showView,
    getCurrentView: getCurrentView,
    getRememberedView: getRememberedView,
    refreshCurrentView: refreshCurrentView,
    init: init
  };
})();
