(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const status = $('auto-length-status');
  const aggregateRoot = $('auto-length-candidates');
  const controls = $('auto-variable-lengths')?.closest('.segment');
  if (!status || !aggregateRoot || !controls || window.__imageQrSearchSafetyInstalled) return;
  window.__imageQrSearchSafetyInstalled = true;

  const box = document.createElement('div');
  box.className = 'grid-3';
  box.style.marginTop = '10px';
  box.innerHTML = `
    <div>
      <label for="auto-heavy-top-cap">自動フル求解の上限件数</label>
      <input id="auto-heavy-top-cap" type="number" min="1" step="1" value="1">
      <div class="tiny">軽量探索後に自動で重い M0/Di + GF(2) を掛ける件数。既定1。</div>
    </div>
    <div>
      <label>品質を落とさない負荷制限</label>
      <div class="tiny">自動探索では候補件数・selftest・Mask比較だけを減らします。画像一致に使うGF(2)独立式のrank / reserve-freeは変更しません。</div>
    </div>
    <div>
      <label>自動フル求解の状態</label>
      <div id="auto-heavy-safety-note" class="tiny">軽量探索完了時に自動調整します。手動設定は実行後に戻します。</div>
    </div>`;
  controls.appendChild(box);

  const capInput = $('auto-heavy-top-cap');
  const note = $('auto-heavy-safety-note');
  let saved = null;
  let active = false;

  function tableValue(card, key) {
    for (const tr of card.querySelectorAll('tr')) {
      if (tr.querySelector('th')?.textContent.trim() === key) return tr.querySelector('td')?.textContent.trim() || '';
    }
    return '';
  }

  function isLightAggregate() {
    const card = aggregateRoot.querySelector('.candidate');
    if (!card) return false;
    return !tableValue(card, '軽量順位時スコア');
  }

  function saveControls() {
    if (saved) return;
    saved = {
      fullTop: $('auto-length-full-top')?.value,
      selftest: $('selftest-count')?.value,
      passes: $('soft-passes')?.value,
      samples: $('null-samples')?.value,
      allMasks: $('all-masks')?.checked
    };
  }

  function applySafety() {
    if (active || !isLightAggregate()) return;
    saveControls();
    active = true;

    const topCap = Math.max(1, Math.floor(Number(capInput.value) || 1));
    const fullTop = $('auto-length-full-top');
    if (fullTop) fullTop.value = String(Math.min(Math.max(1, Number(fullTop.value) || 1), topCap));
    if ($('selftest-count')) $('selftest-count').value = '0';
    if ($('soft-passes')) $('soft-passes').value = '1';
    if ($('null-samples')) $('null-samples').value = String(Math.min(Math.max(1, Number($('null-samples').value) || 1), 16));
    if ($('all-masks')) $('all-masks').checked = false;

    note.textContent = `自動フル求解: 上位${fullTop?.value || 1}件 / selftest 0 / Mask比較OFF。GF(2) rank と reserve-free は元設定のまま。`;
  }

  function restoreControls() {
    if (!active || !saved) return;
    if ($('auto-length-full-top') && saved.fullTop != null) $('auto-length-full-top').value = saved.fullTop;
    if ($('selftest-count') && saved.selftest != null) $('selftest-count').value = saved.selftest;
    if ($('soft-passes') && saved.passes != null) $('soft-passes').value = saved.passes;
    if ($('null-samples') && saved.samples != null) $('null-samples').value = saved.samples;
    if ($('all-masks') && saved.allMasks != null) $('all-masks').checked = saved.allMasks;
    saved = null;
    active = false;
    note.textContent += ' 自動調整は終了し、元の手動設定へ戻しました。';
  }

  const observer = new MutationObserver(() => {
    const text = status.textContent.trim();
    if (text.startsWith('完了。') && isLightAggregate()) {
      applySafety();
      return;
    }
    if (active && (text.startsWith('完了。') || text.startsWith('中断。') || text.startsWith('可変長探索で例外') || text.startsWith('フル求解段階で例外'))) {
      setTimeout(restoreControls, 0);
    }
  });
  observer.observe(status, { childList: true, characterData: true, subtree: true });

  const problemStatus = $('problem-status');
  if (problemStatus) {
    new MutationObserver(() => {
      const main = status.textContent.trim();
      if (!/^軽量上位をフル求解/.test(main)) return;
      const detail = problemStatus.textContent.trim();
      if (!detail) return;
      status.dataset.baseText ||= main.split('\n')[0];
      status.textContent = `${status.dataset.baseText}\n${detail}`;
    }).observe(problemStatus, { childList: true, characterData: true, subtree: true });
  }
})();
