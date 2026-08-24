(() => {
  'use strict';

  // image-qr-optimizer のインライン実装が登録する描画ブラシの
  // listener を、可変長の独立問題を切り替えた後に状態復元するため保持する。
  // QRの生成・求解ロジック自体には介入しない。
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  const listeners = Object.create(null);

  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (this && this.id && (this.id === 'paint-canvas' || this.id === 'matrix')) {
      listeners[this.id] ||= Object.create(null);
      listeners[this.id][type] ||= [];
      listeners[this.id][type].push(listener);
    }
    return originalAddEventListener.call(this, type, listener, options);
  };

  window.__imageQrUiHook = {
    listeners,
    restore() {
      if (EventTarget.prototype.addEventListener !== originalAddEventListener) {
        EventTarget.prototype.addEventListener = originalAddEventListener;
      }
    }
  };
})();
