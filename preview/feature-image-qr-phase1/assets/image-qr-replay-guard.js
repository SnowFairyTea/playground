(() => {
  'use strict';

  const hook = window.__imageQrUiHook;
  const list = hook?.listeners?.['paint-canvas']?.pointerdown;
  if (!list?.length || window.__imageQrReplayGuardInstalled) return;
  window.__imageQrReplayGuardInstalled = true;

  const original = list[0];
  list[0] = function guardedPaintReplay(event) {
    const status = document.getElementById('auto-length-status');
    const text = status?.textContent?.trim() || '';

    // 可変長の粗/細探索では image-qr-length-screen.js が paint/target を
    // 一度だけcanvas snapshotとして保持して軽量評価する。
    // auto-length側のセル単位ブラシ再生は不要で、各セルごとにcanvas全体を
    // 再描画してしまうため、軽量段階だけ無効化する。
    if (/^(粗探索|細探索)/.test(text)) return;
    return original.call(this, event);
  };
})();
