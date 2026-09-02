(() => {
  'use strict';

  // image-qr-optimizer のインライン実装が登録する描画ブラシの
  // listener を、可変長の独立問題を切り替えた後に状態復元するため保持する。
  // QRの生成・求解ロジック自体には介入しない。
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  const originalMapSet = Map.prototype.set;
  const originalFloatFill = Float32Array.prototype.fill;
  const listeners = Object.create(null);
  const state = {
    constraints: null,
    weights: null
  };

  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (this && this.id && (this.id === 'paint-canvas' || this.id === 'matrix')) {
      listeners[this.id] ||= Object.create(null);
      listeners[this.id][type] ||= [];
      listeners[this.id][type].push(listener);
    }
    return originalAddEventListener.call(this, type, listener, options);
  };

  // 絶対制約Mapは「整数module index -> 0/1」という形でのみ使われる。
  // 大面積編集では同じMapへまとめて書き込み、描画更新を1回に抑えるため参照を保持する。
  Map.prototype.set = function(key, value) {
    if (Number.isInteger(key) && (value === 0 || value === 1)) {
      state.constraints = this;
    }
    return originalMapSet.call(this, key, value);
  };

  // 重要度配列は Float32Array を fill(0..1) して初期化される。
  // QR本体のモジュール行列には Float32Array を使わないため、領域編集用に参照を保持する。
  Float32Array.prototype.fill = function(value, ...args) {
    if (Number.isFinite(value) && value >= 0 && value <= 1) {
      const n = Math.sqrt(this.length);
      if (Number.isInteger(n)) state.weights = this;
    }
    return originalFloatFill.call(this, value, ...args);
  };

  window.__imageQrUiHook = {
    listeners,
    state,
    restore() {
      if (EventTarget.prototype.addEventListener !== originalAddEventListener) {
        EventTarget.prototype.addEventListener = originalAddEventListener;
      }
    }
  };
})();
