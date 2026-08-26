/* バーコードスキャナー：カメラ映像から製造番号などのバーコードを読み取るモーダル。
   ブラウザ標準の BarcodeDetector API があればそれを使い、無ければ vendor/zxing.min.js
  （window.ZXing）にフォールバックする。Windows/Mac の Chrome など BarcodeDetector 未対応の
   環境でも、これでカメラ読み取りができる。getUserMedia 自体が使えない環境では、理由を表示して
   手入力に誘導する。複数カメラがある端末（PCの内蔵/外付けWebカメラなど）では、
   「カメラを切り替える」ボタンで別のカメラに切り替えられる。 */
window.App = window.App || {};

App.scanner = (function () {
  'use strict';

  /* 実際に読み取る値（例：62---00664240010027）にハイフンが含まれており、数字専用の
     EAN/UPC/ITF/Codabar系ではないため対象外にした。Code128・Code39・QRのみに絞ることで、
     ZXingフォールバック時の探索範囲を減らして速くする。 */
  var FORMATS = ['code_128', 'code_39', 'qr_code'];
  /** ZXing（zxing-js）側のフォーマット名。POSSIBLE_FORMATS で絞り込み、探索を速くするために使う。 */
  var ZXING_FORMAT_KEYS = {
    code_128: 'CODE_128', code_39: 'CODE_39', qr_code: 'QR_CODE'
  };
  var DETECT_INTERVAL = 150;
  var ZXING_SCAN_INTERVAL = 150;
  var NATIVE_FAIL_LIMIT = 5;
  var NATIVE_TIMEOUT_MS = 4000;
  var CONFIRM_COUNT = 2;
  /* 長いバーコードは1本1本のバーが細くなるため、720pだと潰れて読み取れないことがある。
     解像度を上げて、細かいバーでも解像できるようにする（対応していないカメラでは
     ideal なので自動的に出せる範囲に収まる）。 */
  var VIDEO_CONSTRAINTS = { width: { ideal: 1920 }, height: { ideal: 1080 } };

  /* 画面に出しているガイド枠（.scanner__guide、CSSで top/left/right/bottom を%指定）と
     同じ範囲。検出対象をこの枠内だけに絞ることで、背景など枠外の映像に解像度を割かれず、
     長いバーコードでもバー1本あたりの解像度を確保しやすくする。 */
  var GUIDE_RECT_FRAC = { left: 0.08, right: 0.92, top: 0.28, bottom: 0.72 };
  /* .scanner__viewport の aspect-ratio と同じ値。object-fit: cover によるクロップ量の計算に使う。 */
  var VIEWPORT_ASPECT = 4 / 3;

  var dialog, viewport, video, hint, statusBox, errorBox, manualButton, closeButton, switchButton;
  var stream = null;
  var detector = null;
  var zxingReader = null;
  var timerId = null;
  var nativeTimeoutId = null;
  var nativeFailCount = 0;
  var resolvePromise = null;
  var initialized = false;
  var useNative = false;
  var videoDevices = [];
  var currentDeviceIndex = -1;
  var lastCandidate = null;
  var candidateCount = 0;
  var cropCanvas = null;
  var cropCtx = null;

  function ensureInit() {
    if (initialized) return;

    dialog = document.getElementById('scanner-dialog');
    viewport = document.getElementById('scanner-viewport');
    video = document.getElementById('scanner-video');
    hint = document.getElementById('scanner-hint');
    statusBox = document.getElementById('scanner-status');
    errorBox = document.getElementById('scanner-error');
    manualButton = document.getElementById('scanner-manual');
    closeButton = document.getElementById('scanner-close');
    switchButton = document.getElementById('scanner-switch-camera');

    closeButton.addEventListener('click', function () { finish(null); });
    manualButton.addEventListener('click', function () { finish(null); });
    switchButton.addEventListener('click', switchCamera);

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
      clearTimeout(timerId);
      timerId = null;
    }
    if (nativeTimeoutId !== null) {
      clearTimeout(nativeTimeoutId);
      nativeTimeoutId = null;
    }
    nativeFailCount = 0;
    lastCandidate = null;
    candidateCount = 0;
    if (zxingReader) {
      try { zxingReader.reset(); } catch (e) { /* 既に停止済みなら無視 */ }
      zxingReader = null;
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
    videoDevices = [];
    currentDeviceIndex = -1;
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
    switchButton.hidden = true;
    updateStatus('');
  }

  /** 今どの方式・どのカメラで検出しようとしているかを、実機での切り分け用に画面へ出す。 */
  function updateStatus(text) {
    statusBox.textContent = text;
    statusBox.hidden = !text;
  }

  function currentCameraLabel() {
    if (currentDeviceIndex < 0 || !videoDevices[currentDeviceIndex]) return '';
    var label = videoDevices[currentDeviceIndex].label;
    return label || 'カメラ' + (currentDeviceIndex + 1);
  }

  function renderStatus() {
    var mode = useNative ? 'ネイティブ(BarcodeDetector)' : 'ZXing(フォールバック)';
    var text = '検出方式: ' + mode;
    var camera = currentCameraLabel();
    if (camera) text += ' / カメラ: ' + camera;
    if (useNative && nativeFailCount > 0) {
      text += ' / 連続失敗 ' + nativeFailCount + '/' + NATIVE_FAIL_LIMIT;
    }
    if (candidateCount > 0) {
      text += ' / 確認中 ' + candidateCount + '/' + CONFIRM_COUNT;
    }
    updateStatus(text);
  }

  /**
   * 1フレームだけの誤読（別のバーコードとして誤認識してしまう等）で確定しないよう、
   * 同じ値が連続で読めたときだけ finish() する。バーコードを枠に収めたまま少し待てば、
   * 正しい値であればすぐ連続一致するはず。
   */
  function handleCandidate(value) {
    if (!value) return;
    if (value === lastCandidate) {
      candidateCount += 1;
    } else {
      lastCandidate = value;
      candidateCount = 1;
    }
    renderStatus();
    if (candidateCount >= CONFIRM_COUNT) {
      finish(value);
    }
  }

  /** 理由をモーダル内に表示し、カメラ映像の代わりに「手入力する」導線を出す。 */
  function showError(message) {
    viewport.hidden = true;
    hint.hidden = true;
    errorBox.hidden = false;
    errorBox.textContent = message;
    manualButton.hidden = false;
  }

  /** https、または localhost からの表示かどうか。カメラ利用にはこの「セキュアなコンテキスト」が必須。 */
  function isSecureContext() {
    if (typeof window.isSecureContext === 'boolean') return window.isSecureContext;
    return location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
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
    if (!isSecureContext()) {
      /* スマートフォンから http://（パソコンのIPアドレス） のような形で開いた場合はここに該当する。
         ブラウザは https か localhost（自分自身）以外ではカメラを一切使わせないため、コード側で回避できない。 */
      return 'この接続がセキュア（https、または localhost）ではないため、カメラを使えません。' +
        'スマートフォンからパソコンのIPアドレスに http:// でアクセスしている場合はこれが原因です。' +
        'https で配信するか、手入力で登録してください。';
    }
    return 'カメラを利用できませんでした。手入力してください。';
  }

  /**
   * 端末によっては BarcodeDetector 自体は存在するのに、内部実装（Android の場合は
   * Google Play 開発者サービス側のモデル）が正しく動かず detect() が失敗し続けたり、
   * 一度も検出できないまま固まって見えることがある。そうした端末でも読み取れるよう、
   * 一定回数の連続失敗、または一定時間検出できなければ ZXing（純JS実装）に切り替える。
   */
  function switchToZXing(reason) {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (nativeTimeoutId !== null) {
      clearTimeout(nativeTimeoutId);
      nativeTimeoutId = null;
    }
    detector = null;

    if (!stream || zxingReader) return;

    if (window.ZXing && typeof window.ZXing.MultiFormatReader === 'function') {
      useNative = false;
      lastCandidate = null;
      candidateCount = 0;
      startZXingDecode();
      renderStatus();
    } else {
      showError(reason || 'この端末のカメラ読み取りがうまく機能しませんでした。手入力してください。');
    }
  }

  function getCropCanvas() {
    if (!cropCanvas) {
      cropCanvas = document.createElement('canvas');
      cropCtx = cropCanvas.getContext('2d', { willReadFrequently: true });
    }
    return cropCanvas;
  }

  /**
   * ガイド枠（GUIDE_RECT_FRAC）の表示上の範囲を、video要素のピクセル座標に変換する。
   * video は object-fit: cover で表示しているため、videoの実解像度とビューポートの
   * アスペクト比（VIEWPORT_ASPECT）が異なる分だけ、表示されていない領域が生じる
   * （はみ出た分が上下または左右でクロップされる）。その分を考慮しないと、
   * 画面で見えている枠とズレた範囲を切り出してしまう。
   */
  function computeGuideRect(videoEl) {
    var sourceW = videoEl.videoWidth;
    var sourceH = videoEl.videoHeight;
    if (!sourceW || !sourceH) return null;

    var sourceAspect = sourceW / sourceH;
    var visibleWFrac, visibleHFrac;
    if (sourceAspect > VIEWPORT_ASPECT) {
      visibleHFrac = 1;
      visibleWFrac = VIEWPORT_ASPECT / sourceAspect;
    } else {
      visibleWFrac = 1;
      visibleHFrac = sourceAspect / VIEWPORT_ASPECT;
    }
    var offsetXFrac = (1 - visibleWFrac) / 2;
    var offsetYFrac = (1 - visibleHFrac) / 2;

    var srcLeftFrac = offsetXFrac + GUIDE_RECT_FRAC.left * visibleWFrac;
    var srcRightFrac = offsetXFrac + GUIDE_RECT_FRAC.right * visibleWFrac;
    var srcTopFrac = offsetYFrac + GUIDE_RECT_FRAC.top * visibleHFrac;
    var srcBottomFrac = offsetYFrac + GUIDE_RECT_FRAC.bottom * visibleHFrac;

    var x = Math.round(srcLeftFrac * sourceW);
    var y = Math.round(srcTopFrac * sourceH);
    var width = Math.round((srcRightFrac - srcLeftFrac) * sourceW);
    var height = Math.round((srcBottomFrac - srcTopFrac) * sourceH);
    if (width <= 0 || height <= 0) return null;
    return { x: x, y: y, width: width, height: height };
  }

  /** ガイド枠内だけを切り出したcanvasを返す（video側の準備がまだなら null）。 */
  function captureGuideCanvas() {
    var rect = computeGuideRect(video);
    if (!rect) return null;
    var canvas = getCropCanvas();
    canvas.width = rect.width;
    canvas.height = rect.height;
    cropCtx.drawImage(video, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    return canvas;
  }

  /**
   * detect() の完了を待たずに次の setInterval が積み重なると、処理が重い端末では
   * 検出が渋滞してかえって遅くなる（体感の「読み込みが遅い」の主な原因）。
   * そのため setInterval ではなく、1回終わってから次を予約する自走式にする。
   */
  function detectLoop() {
    timerId = null;
    if (!detector || video.readyState < 2) {
      if (detector) timerId = setTimeout(detectLoop, DETECT_INTERVAL);
      return;
    }
    var source = captureGuideCanvas() || video;
    detector.detect(source).then(function (codes) {
      if (nativeFailCount !== 0) {
        nativeFailCount = 0;
        renderStatus();
      }
      if (codes && codes.length > 0 && codes[0].rawValue) {
        handleCandidate(codes[0].rawValue);
      }
      if (detector) timerId = setTimeout(detectLoop, DETECT_INTERVAL);
    }).catch(function () {
      /* 1フレームだけの検出失敗は無視するが、連続で失敗し続ける場合は端末側の問題とみなす。 */
      nativeFailCount += 1;
      renderStatus();
      if (nativeFailCount >= NATIVE_FAIL_LIMIT) {
        switchToZXing();
        return;
      }
      if (detector) timerId = setTimeout(detectLoop, DETECT_INTERVAL);
    });
  }

  function buildZXingHints() {
    if (!window.ZXing || !window.ZXing.DecodeHintType || !window.ZXing.BarcodeFormat) return undefined;
    var formats = [];
    FORMATS.forEach(function (f) {
      var key = ZXING_FORMAT_KEYS[f];
      var value = key && window.ZXing.BarcodeFormat[key];
      if (value !== undefined) formats.push(value);
    });
    if (formats.length === 0) return undefined;
    var hints = new Map();
    hints.set(window.ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
    return hints;
  }

  /**
   * BarcodeDetector が使えない環境向けのフォールバック（vendor/zxing.min.js）。
   * 高レベルの decodeFromStream() は映像全体をそのまま解析対象にしてしまい、ガイド枠内だけに
   * 絞り込めないため、あえて低レベルの MultiFormatReader を使い、detectLoop() と同じく
   * captureGuideCanvas() で切り出した canvas を渡す自走式ループにしている。
   */
  function zxingDetectLoop() {
    timerId = null;
    if (!zxingReader || video.readyState < 2) {
      if (zxingReader) timerId = setTimeout(zxingDetectLoop, ZXING_SCAN_INTERVAL);
      return;
    }
    var canvas = captureGuideCanvas();
    if (canvas) {
      try {
        var luminanceSource = new window.ZXing.HTMLCanvasElementLuminanceSource(canvas);
        var binarizer = new window.ZXing.HybridBinarizer(luminanceSource);
        var bitmap = new window.ZXing.BinaryBitmap(binarizer);
        var result = zxingReader.decode(bitmap);
        handleCandidate(result.getText());
      } catch (e) {
        /* NotFoundException 等、1フレームで見つからないのは通常の動作なので無視する。 */
      }
    }
    if (zxingReader) timerId = setTimeout(zxingDetectLoop, ZXING_SCAN_INTERVAL);
  }

  /** 対応フォーマットを絞ることで、探索を速くする。 */
  function startZXingDecode() {
    zxingReader = new window.ZXing.MultiFormatReader();
    zxingReader.setHints(buildZXingHints() || new Map());
    timerId = setTimeout(zxingDetectLoop, 0);
  }

  function beginDetection() {
    lastCandidate = null;
    candidateCount = 0;
    if (useNative) {
      nativeFailCount = 0;
      timerId = setTimeout(detectLoop, 0);
      /* エラーにはならず単に見つからない端末向けに、時間切れでもZXingへ切り替える。 */
      nativeTimeoutId = setTimeout(function () { switchToZXing(); }, NATIVE_TIMEOUT_MS);
    } else {
      startZXingDecode();
    }
  }

  /** 複数カメラがある場合に「カメラを切り替える」ボタンを出す。1台だけなら出さない。 */
  function refreshDeviceList() {
    if (!navigator.mediaDevices.enumerateDevices) return Promise.resolve();
    return navigator.mediaDevices.enumerateDevices().then(function (devices) {
      videoDevices = devices.filter(function (d) { return d.kind === 'videoinput'; });

      var activeTrack = stream && stream.getVideoTracks()[0];
      var activeId = activeTrack && activeTrack.getSettings && activeTrack.getSettings().deviceId;
      currentDeviceIndex = videoDevices.findIndex(function (d) { return d.deviceId === activeId; });

      switchButton.hidden = videoDevices.length < 2;
    });
  }

  /** 今の映像・検出だけ止めて、新しいカメラに繋ぎ直す（ダイアログは開いたまま）。 */
  function switchCamera() {
    if (videoDevices.length < 2) return;
    var nextIndex = (currentDeviceIndex + 1) % videoDevices.length;
    var nextDeviceId = videoDevices[nextIndex].deviceId;

    stopCamera();
    hint.hidden = false;
    errorBox.hidden = true;

    var constraints = Object.assign({}, VIDEO_CONSTRAINTS, { deviceId: { exact: nextDeviceId } });
    navigator.mediaDevices.getUserMedia({ video: constraints })
      .then(function (mediaStream) { return attachAndDetect(mediaStream); })
      .catch(function (err) { showError(describeError(err)); });
  }

  function attachAndDetect(mediaStream) {
    if (!dialog.open) {
      mediaStream.getTracks().forEach(function (track) { track.stop(); });
      return Promise.resolve();
    }
    stream = mediaStream;
    video.srcObject = stream;
    return video.play().then(function () {
      beginDetection();
      return refreshDeviceList();
    }).then(function () {
      renderStatus();
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

    useNative = !!window.BarcodeDetector;
    var useZXing = !useNative && window.ZXing && typeof window.ZXing.MultiFormatReader === 'function';

    if (!useNative && !useZXing) {
      showError('このブラウザはバーコード読み取りに対応していません。手入力してください。');
      return promise;
    }

    var setupPromise = useNative
      ? (typeof BarcodeDetector.getSupportedFormats === 'function'
          ? BarcodeDetector.getSupportedFormats()
          : Promise.resolve(FORMATS)
        ).then(function (supported) {
          var formats = FORMATS.filter(function (f) { return supported.indexOf(f) !== -1; });
          if (formats.length === 0) formats = supported.length ? supported : FORMATS;
          detector = new BarcodeDetector({ formats: formats });
        })
      : Promise.resolve();

    setupPromise.then(function () {
      var constraints = Object.assign({}, VIDEO_CONSTRAINTS, { facingMode: 'environment' });
      return navigator.mediaDevices.getUserMedia({ video: constraints });
    }).then(function (mediaStream) {
      return attachAndDetect(mediaStream);
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
