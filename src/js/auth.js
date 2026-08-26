/* Microsoft 365（Entra ID）でのサインインとアクセストークン取得。
   vendor/msal-browser.min.js（window.msal）を使う。SharePointリストをMicrosoft Graph API
   経由で読み書きするために、他のどのモジュールよりも先にサインインを済ませておく必要がある。 */
window.App = window.App || {};

App.auth = (function () {
  'use strict';

  var CLIENT_ID = 'fa8aef46-d043-4cc9-b53b-eda6fbba44ee';
  var TENANT_ID = 'af7492bd-a0bf-4293-949e-31c368901fe8';
  var REDIRECT_URI = 'https://omoti12.github.io/inventory-management/src/index.html';
  /* Sites.ReadWrite.All: SharePointリストの読み書き。User.Read: サインイン中の名前表示用。 */
  var SCOPES = ['Sites.ReadWrite.All', 'User.Read'];

  var client = null;
  var account = null;
  var readyPromise = null;

  function ensureClient() {
    if (client) return client;
    client = new msal.PublicClientApplication({
      auth: {
        clientId: CLIENT_ID,
        authority: 'https://login.microsoftonline.com/' + TENANT_ID,
        redirectUri: REDIRECT_URI
      },
      cache: {
        /* タブを閉じても再サインインなしで使えるよう、sessionStorageではなくlocalStorageに保持する。 */
        cacheLocation: 'localStorage'
      }
    });
    return client;
  }

  /** MSAL Browser v3 は initialize() の完了を待ってから他のAPIを呼ぶ必要があるため、
   *  どの公開関数もまずこれを経由させる。 */
  function ready() {
    if (!readyPromise) {
      var c = ensureClient();
      readyPromise = c.initialize().then(function () { return c; });
    }
    return readyPromise;
  }

  /**
   * ページ読み込み時に一度だけ呼ぶ。サインイン画面からのリダイレクト戻りを処理し、
   * 既にサインイン済みのアカウントがあればそれを使う。サインイン中のアカウント
   * （無ければ null）で解決する Promise を返す。
   */
  function init() {
    return ready().then(function (c) {
      return c.handleRedirectPromise().then(function (response) {
        if (response && response.account) {
          account = response.account;
        } else {
          var accounts = c.getAllAccounts();
          if (accounts.length > 0) account = accounts[0];
        }
        return account;
      });
    });
  }

  /** サインイン画面へ遷移する（ページがMicrosoftのログイン画面に移動し、戻ってくる）。 */
  function signIn() {
    return ready().then(function (c) {
      return c.loginRedirect({ scopes: SCOPES });
    });
  }

  function signOut() {
    return ready().then(function (c) {
      return c.logoutRedirect({ account: account });
    });
  }

  function getAccount() {
    return account;
  }

  /**
   * アクセストークンを取得する。キャッシュ・自動更新をまず試し、
   * それで無理な場合だけ再サインイン画面に遷移する。
   */
  function getToken() {
    if (!account) return Promise.reject(new Error('サインインしていません。'));
    return ready().then(function (c) {
      return c.acquireTokenSilent({ scopes: SCOPES, account: account }).then(function (result) {
        return result.accessToken;
      }).catch(function () {
        return c.acquireTokenRedirect({ scopes: SCOPES });
      });
    });
  }

  return {
    init: init,
    signIn: signIn,
    signOut: signOut,
    getAccount: getAccount,
    getToken: getToken
  };
})();
