/* 起動処理：サインイン確認 → データ読み込み → 各画面の初期化 → 在庫一覧を表示。 */
window.App = window.App || {};

App.init = function () {
  'use strict';

  var signinGate = document.getElementById('signin-gate');
  var appShell = document.getElementById('app-shell');
  var signinButton = document.getElementById('signin-button');
  var signinError = document.getElementById('signin-error');
  var accountBox = document.getElementById('app-account');
  var accountName = document.getElementById('app-account-name');
  var signOutButton = document.getElementById('app-sign-out');
  var refreshButton = document.getElementById('app-refresh');

  function showSigninError(message) {
    signinError.textContent = message;
    signinError.hidden = false;
  }

  signinButton.addEventListener('click', function () {
    signinError.hidden = true;
    App.auth.signIn().catch(function (err) {
      showSigninError('サインインを開始できませんでした：' + err.message);
    });
  });

  signOutButton.addEventListener('click', function () {
    App.auth.signOut();
  });

  /**
   * 「更新」ボタン：他の人がSharePoint上で追加・変更した内容を取り込む。自動では一切動かず、
   * 押した時だけ全データを読み直して、今表示中の画面だけを再描画する（入力中のフォームには
   * 触れない）。
   */
  refreshButton.addEventListener('click', function () {
    refreshButton.disabled = true;
    App.store.load().then(function () {
      App.ui.refreshCurrentView();
      App.ui.toast('最新の状態に更新しました。', 'success');
    }).catch(function (err) {
      App.ui.toast('更新に失敗しました：' + err.message, 'error');
    }).then(function () {
      refreshButton.disabled = false;
    });
  });

  function startApp(account) {
    signinGate.hidden = true;
    appShell.hidden = false;
    accountBox.hidden = false;
    accountName.textContent = account.name || account.username || '';

    App.store.load().then(function () {
      App.ui.init();
      App.inventory.init();
      App.products.init();
      App.filterProducts.init();
      App.filterInventory.init();
      App.inbound.init();
      App.inboundHistory.init();
      App.filterInbound.init();
      App.filterInboundHistory.init();
      App.shipping.init();
      App.filterShipping.init();
      App.history.init();
      App.filterHistory.init();

      App.ui.showView('inventory');
    }).catch(function (err) {
      appShell.hidden = true;
      signinGate.hidden = false;
      showSigninError('データの読み込みに失敗しました：' + err.message);
    });
  }

  App.auth.init().then(function (account) {
    if (account) {
      startApp(account);
    }
    /* account が無ければ、サインインゲート（初期状態で表示中）のボタン待ちのまま。 */
  }).catch(function (err) {
    showSigninError('サインイン処理でエラーが発生しました：' + err.message);
  });
};

document.addEventListener('DOMContentLoaded', App.init);
