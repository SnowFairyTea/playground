(() => {
  'use strict';

  const NativeMutationObserver = window.MutationObserver;
  if (!NativeMutationObserver || window.__imageQrMutationGuardInstalled) return;

  window.__imageQrMutationGuardInstalled = true;

  window.MutationObserver = class MutationObserverGuard {
    constructor(callback) {
      this.callback = callback;
      this.target = null;
      this.options = null;
      this.guarded = false;
      this.native = new NativeMutationObserver((records) => {
        if (!this.guarded) {
          this.callback(records, this);
          return;
        }

        // #segments の subtree observer は、コールバック自身が補助UIの
        // textContent/childList を更新する。再入を許すと無限microtask loopになるため、
        // callback中に発生した自前のDOM更新は監視対象から外す。
        this.native.disconnect();
        try {
          this.callback(records, this);
        } finally {
          if (this.target && this.options) this.native.observe(this.target, this.options);
        }
      });
    }

    observe(target, options) {
      this.target = target;
      this.options = options;
      this.guarded = target?.id === 'segments' && !!options?.childList && !!options?.subtree;
      this.native.observe(target, options);
    }

    disconnect() {
      this.target = null;
      this.options = null;
      this.native.disconnect();
    }

    takeRecords() {
      return this.native.takeRecords();
    }
  };
})();
