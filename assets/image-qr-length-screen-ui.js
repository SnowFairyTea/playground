(() => {
  'use strict';
  const status = document.getElementById('auto-length-status');
  const optimizer = document.getElementById('optimize-card');
  if (!status || !optimizer) return;
  const sync = () => {
    const t = status.textContent.trim();
    if (/^(粗探索|細探索|軽量上位をフル求解)/.test(t)) optimizer.style.display = 'block';
  };
  new MutationObserver(sync).observe(status, { childList: true, characterData: true, subtree: true });
  sync();
})();
