/* Microsoft Graph API 経由で、SharePointの3つのリスト（Products / Items / Shipments）を
   読み書きするための共通ヘルパー。認証は App.auth に委譲する。
   ETagを使った楽観的排他制御（updateWithRetry）もここに集約し、各リストの操作から
   個別に排他処理を実装しなくて済むようにする。 */
window.App = window.App || {};

App.graph = (function () {
  'use strict';

  var BASE = 'https://graph.microsoft.com/v1.0';
  /* サイトのパスベース参照。ホスト名とサイトパスをコロンで挟む書き方で、
     サイトIDを事前に調べなくてもそのままリスト操作のURLに使える。 */
  var SITE_REF = 'nittoairtech.sharepoint.com:/sites/p:';

  function listBaseUrl(listName) {
    return BASE + '/sites/' + SITE_REF + '/lists/' + encodeURIComponent(listName);
  }

  function authHeaders() {
    return App.auth.getToken().then(function (token) {
      return { 'Authorization': 'Bearer ' + token };
    });
  }

  /** fetch のラッパー。認証ヘッダー付与・ETag付与・エラーの正規化をまとめて行う。 */
  function request(method, url, body, etag) {
    return authHeaders().then(function (headers) {
      headers['Content-Type'] = 'application/json';
      if (etag) headers['If-Match'] = etag;
      return fetch(url, {
        method: method,
        headers: headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    }).then(function (res) {
      if (res.status === 204) return null;
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { /* 本文が無い/JSONでない */ }
        if (!res.ok) {
          var message = (data && data.error && data.error.message) || ('Graph API エラー（' + res.status + '）');
          var err = new Error(message);
          err.status = res.status;
          err.code = data && data.error && data.error.code;
          throw err;
        }
        return data;
      });
    });
  }

  /** 1リストの全アイテムを fields 込みで取得する（ページングに対応）。 */
  function listItems(listName) {
    var collected = [];
    function fetchPage(url) {
      return request('GET', url).then(function (data) {
        collected = collected.concat((data && data.value) || []);
        if (data && data['@odata.nextLink']) return fetchPage(data['@odata.nextLink']);
        return collected;
      });
    }
    return fetchPage(listBaseUrl(listName) + '/items?$expand=fields&$top=200');
  }

  function getItem(listName, itemId) {
    return request('GET', listBaseUrl(listName) + '/items/' + itemId + '?$expand=fields');
  }

  /** fields はSharePointの列の内部名をキーにしたオブジェクト。作成結果（id・fields込み）を返す。 */
  function createItem(listName, fields) {
    return request('POST', listBaseUrl(listName) + '/items', { fields: fields });
  }

  /** fields サブリソースへのPATCH。etagを渡すと If-Match で楽観的排他制御になる。 */
  function updateItem(listName, itemId, fields, etag) {
    return request('PATCH', listBaseUrl(listName) + '/items/' + itemId + '/fields', fields, etag);
  }

  function deleteItem(listName, itemId) {
    return request('DELETE', listBaseUrl(listName) + '/items/' + itemId);
  }

  /**
   * ETag競合（他の人が先に書き込んでいた場合）を考慮した更新。
   * mutateFn(currentFields) は最新のfieldsを受け取り、書き込みたい差分（またはnullで中止）を返す。
   * 412（Precondition Failed）を検知したら最新状態を取り直して maxRetries 回まで再試行する。
   */
  function updateWithRetry(listName, itemId, mutateFn, maxRetries) {
    maxRetries = maxRetries == null ? 3 : maxRetries;
    function attempt(remaining) {
      return getItem(listName, itemId).then(function (current) {
        var currentFields = (current && current.fields) || {};
        var etag = currentFields['@odata.etag'];
        var nextFields = mutateFn(currentFields);
        if (!nextFields) return { skipped: true, fields: currentFields };
        return updateItem(listName, itemId, nextFields, etag).then(function () {
          return { skipped: false, fields: nextFields };
        }).catch(function (err) {
          if (err.status === 412 && remaining > 0) return attempt(remaining - 1);
          throw err;
        });
      });
    }
    return attempt(maxRetries);
  }

  return {
    listItems: listItems,
    getItem: getItem,
    createItem: createItem,
    updateItem: updateItem,
    deleteItem: deleteItem,
    updateWithRetry: updateWithRetry
  };
})();
