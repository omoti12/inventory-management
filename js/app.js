/* 起動処理：データ読み込み → 各画面の初期化 → 在庫一覧を表示。 */
window.App = window.App || {};

App.init = function () {
  'use strict';

  App.store.load();
  App.seed.ensure();

  App.ui.init();
  App.inventory.init();
  App.products.init();
  App.inbound.init();
  App.shipping.init();
  App.history.init();

  document.getElementById('reset-demo-data').addEventListener('click', function () {
    App.ui.confirm({
      title: 'デモデータの初期化',
      message: '登録した商品・在庫・出荷履歴をすべて破棄し、デモの初期状態に戻します。よろしいですか？',
      okLabel: '初期状態に戻す',
      danger: true
    }).then(function (approved) {
      if (!approved) return;
      App.seed.reset();
      App.inventory.clearSelection();
      App.inventory.render();
      App.products.render();
      App.inbound.refreshProducts();
      App.history.render();
      App.ui.showView('inventory');
      App.ui.toast('デモデータを初期状態に戻しました。', 'success');
    });
  });

  App.ui.showView('inventory');
};

document.addEventListener('DOMContentLoaded', App.init);
