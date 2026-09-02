(() => {
  'use strict';
  const status = document.getElementById('auto-length-status');
  const card = document.getElementById('auto-length-candidate-card');
  const root = document.getElementById('auto-length-candidates');
  if (!status || !card || !root) return;

  let completed = false;
  let scheduled = false;

  function hasResults() {
    return !!root.querySelector('.candidate, img, canvas, .status');
  }

  function forceVisibleSoon() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scheduled = false;
        if (completed && hasResults()) card.style.display = 'block';
      });
    });
  }

  function syncCompletion() {
    const text = status.textContent.trim();
    completed = /^(完了。|中断。)/.test(text);
    if (completed && hasResults()) {
      card.style.display = 'block';
      forceVisibleSoon();
    }
  }

  // 完了後に可変長入力を元の探索上限へ戻すと、本体側の input ハンドラが
  // invalidate() を呼んで候補カードを一度非表示にする。候補DOM自体は残るため、
  // 完了状態の間は非表示化を検知して再表示する。
  const statusObserver = new MutationObserver(syncCompletion);
  statusObserver.observe(status, { childList: true, characterData: true, subtree: true });

  const resultObserver = new MutationObserver(() => {
    if (completed && hasResults()) forceVisibleSoon();
  });
  resultObserver.observe(root, { childList: true, subtree: true });

  const cardObserver = new MutationObserver(() => {
    if (completed && hasResults() && card.style.display === 'none') forceVisibleSoon();
  });
  cardObserver.observe(card, { attributes: true, attributeFilter: ['style'] });

  syncCompletion();
})();
