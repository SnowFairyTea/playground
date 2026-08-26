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
      <div class="tiny">軽量探索後に自動で重い M0/Di + GF(2) を掛ける件数。暫定既定1。</div>
    </div>
    <div>
      <label for="auto-heavy-soft-rank">自動フル求解のソフト独立式上限</label>
      <input id="auto-heavy-soft-rank" type="number" min="0" step="1" value="256">
      <div class="tiny">自由変数が多い場合、重要度ヒューリスティックで追加する独立式を概ねこの件数までに抑えます。</div>
    </div>
    <div>
      <label>自動フル求解の負荷制限</label>
      <div id="auto-heavy-safety-note" class="tiny">軽量探索完了時に自動調整します。手動求解の設定は実行後に戻します。</div>
    </div>`;
  controls.appendChild(box);

  const capInput = $('auto-heavy-top-cap');
  const rankInput = $('auto-heavy-soft-rank');
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

  function firstLengths() {
    const card = aggregateRoot.querySelector('.candidate');
    const raw = card ? tableValue(card, '可変部分の長さ') : '';
    return raw ? raw.split('/').map(x => Math.max(1, Math.floor(Number(x.trim()) || 1))) : [];
  }

  function variableCards() {
    const root = $('segments');
    if (!root) return [];
    return [...root.querySelectorAll(':scope > .segment')].filter(card => card.querySelector('select')?.value === 'variable');
  }

  function estimateVariables(lengths) {
    let total = 0;
    const encoder = new TextEncoder();
    variableCards().forEach((card, i) => {
      const forbidden = new Set(Array.from(card.querySelector('input[type="text"]')?.value || ''));
      const seen = new Set();
      let count = 0;
      for (const ch of Array.from(card.querySelector('textarea')?.value || '')) {
        if (seen.has(ch) || forbidden.has(ch)) continue;
        seen.add(ch);
        if (encoder.encode(ch).length === 1) count++;
      }
      const bitUpper = count > 0 ? Math.floor(Math.log2(count)) : 0;
      total += (lengths[i] || 0) * bitUpper;
    });
    return total;
  }

  function saveControls() {
    if (saved) return;
    saved = {
      fullTop: $('auto-length-full-top')?.value,
      selftest: $('selftest-count')?.value,
      reserve: $('reserve-free')?.value,
      passes: $('soft-passes')?.value,
      samples: $('null-samples')?.value,
      allMasks: $('all-masks')?.checked
    };
  }

  function applySafety() {
    if (active || !isLightAggregate()) return;
    const lengths = firstLengths();
    if (!lengths.length) return;
    saveControls();
    active = true;

    const estimated = estimateVariables(lengths);
    const topCap = Math.max(1, Math.floor(Number(capInput.value) || 1));
    const softBudget = Math.max(0, Math.floor(Number(rankInput.value) || 256));

    const fullTop = $('auto-length-full-top');
    if (fullTop) fullTop.value = String(Math.min(Math.max(1, Number(fullTop.value) || 1), topCap));
    if ($('selftest-count')) $('selftest-count').value = '0';
    if ($('soft-passes')) $('soft-passes').value = '1';
    if ($('null-samples')) $('null-samples').value = String(Math.min(Math.max(1, Number($('null-samples').value) || 1), 16));
    if ($('all-masks')) $('all-masks').checked = false;

    const reserve = Math.max(0, estimated - softBudget);
    if ($('reserve-free')) $('reserve-free').value = String(reserve);

    note.textContent = `自動フル求解: 上位${fullTop?.value || 1}件 / 推定自由変数≈${estimated} / ソフト独立式≈最大${softBudget} / selftest 0 / Mask比較OFF。`;
  }

  function restoreControls() {
    if (!active || !saved) return;
    if ($('auto-length-full-top') && saved.fullTop != null) $('auto-length-full-top').value = saved.fullTop;
    if ($('selftest-count') && saved.selftest != null) $('selftest-count').value = saved.selftest;
    if ($('reserve-free') && saved.reserve != null) $('reserve-free').value = saved.reserve;
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
      // フル求解側のobserverが同じmutationで設定値を読むため、復元は次taskへ送る。
      setTimeout(restoreControls, 0);
    }
  });
  observer.observe(status, { childList: true, characterData: true, subtree: true });

  // M0/Di構築中はauto-length-status自体が動かないので、内部進捗を転記する。
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
