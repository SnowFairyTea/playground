(() => {
  'use strict';
  const status = document.getElementById('auto-length-status');
  const card = document.getElementById('auto-length-candidate-card');
  const root = document.getElementById('auto-length-candidates');
  if (!status || !card || !root) return;

  const observer = new MutationObserver(() => {
    const done = /^(完了。|中断。)/.test(status.textContent.trim());
    if (done && root.childNodes.length) card.style.display = 'block';
  });
  observer.observe(status, { childList: true, characterData: true, subtree: true });
})();
