/* バーコードスキャナー：カメラ映像から製造番号などのバーコードを読み取るモーダル。
   BarcodeDetector / getUserMedia が使えない環境では、理由を表示して手入力に誘導する。 */
window.App = window.App || {};

App.scanner = (function () {
  'use strict';

  var FORMATS = ['code_128', 'code_39', 'ean_13', 'ean_8', 'itf', 'codabar', 'upc_a', 'upc_e', 'qr_code'];
  var DETECT_INTERVAL = 200;

  var dialog, viewport, video, hint, errorBox, manualButton, closeButton;
  var stream = null;
  var detector = null;
  var timerId = null;
  var resolvePromise = null;
  var initialized = false;

  function ensureInit() {
    if (initialized) return;

    dialog = document.getElementById('scanner-dialog');
    viewport = document.getElementById('scanner-viewport');
    video = document.getElementById('scanner-video');
    hint = document.getElementById('scanner-hint');
    errorBox = document.getElementById('scanner-error');
    manualButton = document.getElementById('scanner-manual');
    closeButton = document.getElementById('scanner-close');

    closeButton.addEventListener('click', function () { finish(null); });
    manualButton.addEventListener('click', function () { finish(null); });

    /* Escキーや背景クリックで閉じられた場合も、確実にカメラを止めてから閉じる。 */
    dialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      finish(null);
    });

    /* finish() を経由しない閉じ方が万一あっても、カメラの止め忘れが起きないようにする保険。 */
    dialog.addEventListener('close', function () { stopCamera(); });

    initialized = true;
  }

  function stopCamera() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
    if (stream) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      stream = null;
    }
    video.srcObject = null;
    detector = null;
  }

  function finish(value) {
    stopCamera();
    if (dialog.open) dialog.close();
    var resolve = resolvePromise;
    resolvePromise = null;
    if (resolve) resolve(value);
  }

  function resetView() {
    viewport.hidden = false;
    hint.hidden = false;
    errorBox.hidden = true;
    errorBox.textContent = '';
    manualButton.hidden = true;
  }

  /** 理由をモーダル内に表示し、カメラ映像の代わりに「手入力する」導線を出す。 */
  function showError(message) {
    viewport.hidden = true;
    hint.hidden = true;
    errorBox.hidden = false;
    errorBox.textContent = message;
    manualButton.hidden = false;
  }

  function describeError(err) {
    if (err && err.name === 'NotAllowedError') {
      return 'カメラの利用が許可されませんでした。ブラウザまたはOSの設定でカメラへのアクセスを許可してから、もう一度お試しください。';
    }
    if (err && err.name === 'NotFoundError') {
      return 'カメラが見つかりませんでした。カメラが接続された端末でお試しください。';
    }
    if (location.protocol === 'file:') {
      return 'この画面は file:// で開かれているためカメラを利用できません。http://localhost などのサーバー経由で開いてください。';
    }
    return 'カメラを利用できませんでした。手入力してください。';
  }

  function detectLoop() {
    if (!detector || video.readyState < 2) return;
    detector.detect(video).then(function (codes) {
      if (codes && codes.length > 0 && codes[0].rawValue) {
        finish(codes[0].rawValue);
      }
    }).catch(function () {
      /* 1フレームの検出失敗は無視して次のフレームを待つ。 */
    });
  }

  /**
   * カメラ起動モーダルを開く。読み取れた値（キャンセル時は null）で解決する Promise を返す。
   * options.onDetect が渡されていれば、値が読み取れたときにそれも呼び出す。
   */
  function open(options) {
    var opts = options || {};
    ensureInit();
    resetView();

    var promise = new Promise(function (resolve) { resolvePromise = resolve; });
    promise.then(function (value) {
      if (value && typeof opts.onDetect === 'function') opts.onDetect(value);
    });

    if (typeof dialog.showModal !== 'function') {
      /* dialog要素の showModal に対応していない環境では、モーダル自体を出せないため即終了する。 */
      showFallbackAlert();
      resolvePromise = null;
      return Promise.resolve(null);
    }

    dialog.showModal();

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      showError(describeError(null));
      return promise;
    }
    if (!window.BarcodeDetector) {
      showError('このブラウザはバーコード読み取り（BarcodeDetector API）に対応していません。手入力してください。');
      return promise;
    }

    var formatsPromise = typeof BarcodeDetector.getSupportedFormats === 'function'
      ? BarcodeDetector.getSupportedFormats()
      : Promise.resolve(FORMATS);

    formatsPromise.then(function (supported) {
      var formats = FORMATS.filter(function (f) { return supported.indexOf(f) !== -1; });
      if (formats.length === 0) formats = supported.length ? supported : FORMATS;
      detector = new BarcodeDetector({ formats: formats });

      return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    }).then(function (mediaStream) {
      if (!dialog.open) {
        /* カメラ起動待ちの間にユーザーが閉じていた場合は、そのまま停止する。 */
        mediaStream.getTracks().forEach(function (track) { track.stop(); });
        return;
      }
      stream = mediaStream;
      video.srcObject = stream;
      return video.play().then(function () {
        timerId = setInterval(detectLoop, DETECT_INTERVAL);
      });
    }).catch(function (err) {
      showError(describeError(err));
    });

    return promise;
  }

  function showFallbackAlert() {
    window.alert('この画面ではバーコード読み取り機能を利用できません。手入力してください。');
  }

  return {
    open: open
  };
})();
