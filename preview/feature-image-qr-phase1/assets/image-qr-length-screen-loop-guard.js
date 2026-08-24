(() => {
  'use strict';

  const status = document.getElementById('auto-length-status');
  const aggregateRoot = document.getElementById('auto-length-candidates');
  if (!status || !aggregateRoot) return;

  function isHeavyResult() {
    for (const th of aggregateRoot.querySelectorAll('th')) {
      if (th.textContent.trim() === '軽量順位時スコア') return true;
    }
    return false;
  }

  // image-qr-length-screen.js は「完了。」を検知して軽量候補から
  // フル求解を開始する。フル求解自身も最後に「完了。」を書き込むため、
  // そのままだと再度 finalizeHeavy() がキューされ続ける。
  //
  // このガードはフル求解済み候補が表示されている「完了。」だけを検知し、
  // 先にキューされた再実行が selectedLengths() を読む瞬間だけ候補DOMを退避する。
  // 初回の軽量探索完了は対象外なので、軽量 -> フル求解は通常どおり1回実行される。
  const observer = new MutationObserver(() => {
    if (!status.textContent.trim().startsWith('完了。')) return;
    if (!isHeavyResult()) return;

    const nodes = [...aggregateRoot.childNodes];
    if (!nodes.length) return;

    aggregateRoot.replaceChildren();
    queueMicrotask(() => {
      if (!aggregateRoot.childNodes.length) aggregateRoot.replaceChildren(...nodes);
    });
  });

  observer.observe(status, { childList: true, characterData: true, subtree: true });
})();
