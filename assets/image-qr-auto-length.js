(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const segmentsRoot = $('segments');
  const optimizeButton = $('optimize-image');
  const analyzeButton = $('analyze-charsets');
  const buildButton = $('build-problem');
  const paintCanvas = $('paint-canvas');
  const phase2Card = $('phase2-candidate-card');
  const phase2Candidates = $('phase2-candidates');
  const optimizerCard = $('optimize-card');
  const hook = window.__imageQrUiHook;

  if (!segmentsRoot || !optimizeButton || !analyzeButton || !buildButton || !paintCanvas || !optimizerCard) {
    hook?.restore?.();
    return;
  }

  const paintDown = hook?.listeners?.['paint-canvas']?.pointerdown?.[0] || null;
  const paintUp = hook?.listeners?.['paint-canvas']?.pointerup?.[0] || null;
  hook?.restore?.();

  let running = false;
  let cancelRequested = false;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  const controls = document.createElement('div');
  controls.className = 'segment';
  controls.style.marginTop = '12px';
  controls.innerHTML = `
    <div class="grid-3">
      <div>
        <label style="display:flex;align-items:center;gap:8px;margin-top:6px">
          <input id="auto-variable-lengths" type="checkbox" style="width:auto" checked>
          可変長を 1〜最大まで自動比較
        </label>
        <div class="tiny">各長さは別々の固定QR問題として M0 / Di を再構築します。</div>
      </div>
      <div>
        <label>長さ組合せ数</label>
        <div id="auto-length-combination-count" class="pill">—</div>
        <div class="tiny">複数可変セグメントでは全直積を試します。隠れた上限は設けません。</div>
      </div>
      <div>
        <label>探索操作</label>
        <button id="cancel-auto-length" class="secondary" type="button" disabled>現在の長さ探索を中断</button>
      </div>
    </div>
    <div class="tiny" style="margin-top:8px">QR VersionがAutoで長さにより行列サイズが変わる場合、重要度・絶対制約は最大長問題の正規化座標を基準に最近傍で移送します。</div>
    <div id="auto-length-status" class="status">最大長を設定し、通常どおり「画像目標へ最適化」を押してください。</div>
  `;
  optimizerCard.insertBefore(controls, optimizeButton.parentElement);

  const autoToggle = $('auto-variable-lengths');
  const comboCount = $('auto-length-combination-count');
  const cancelButton = $('cancel-auto-length');
  const status = $('auto-length-status');

  const aggregateCard = document.createElement('div');
  aggregateCard.className = 'card';
  aggregateCard.id = 'auto-length-candidate-card';
  aggregateCard.style.display = 'none';
  aggregateCard.innerHTML = `
    <h2>可変長をまたいだ候補比較</h2>
    <p class="muted">各可変長を独立したQR問題として求解した後、重要度付き一致スコアでまとめて比較しています。</p>
    <div id="auto-length-candidates"></div>
  `;
  (phase2Card || optimizerCard).insertAdjacentElement('afterend', aggregateCard);
  const aggregateRoot = $('auto-length-candidates');

  function variableSegmentInputs() {
    const out = [];
    for (const seg of segmentsRoot.querySelectorAll('.segment')) {
      const typeSelect = seg.querySelector('select');
      if (!typeSelect || typeSelect.value !== 'variable') continue;
      const number = seg.querySelector('input[type="number"]');
      if (!number) continue;
      const label = number.parentElement?.querySelector('label');
      if (label && !label.dataset.autoLengthRelabeled) {
        label.textContent = '可変部分の最大長（ASCII文字数 = バイト数）';
        label.dataset.autoLengthRelabeled = '1';
        const note = document.createElement('div');
        note.className = 'tiny';
        note.textContent = 'Auto比較ON時は 1, 2, …, この最大長を個別に検証します。';
        number.insertAdjacentElement('afterend', note);
      }
      out.push(number);
    }
    return out;
  }

  function maxLengths() {
    return variableSegmentInputs().map(input => Math.max(1, Math.floor(Number(input.value) || 1)));
  }

  function combinationCount(maxes) {
    if (!autoToggle.checked) return maxes.length ? 1n : 0n;
    return maxes.reduce((n, m) => n * BigInt(m), 1n);
  }

  function updateCombinationCount() {
    const maxes = maxLengths();
    const n = combinationCount(maxes);
    comboCount.textContent = maxes.length ? n.toString() : '0';
    comboCount.classList.toggle('warn-pill', n > 64n);
    if (!running) aggregateCard.style.display = 'none';
  }

  const segmentObserver = new MutationObserver(updateCombinationCount);
  segmentObserver.observe(segmentsRoot, { childList: true, subtree: true });
  segmentsRoot.addEventListener('input', updateCombinationCount, true);
  segmentsRoot.addEventListener('change', updateCombinationCount, true);
  autoToggle.addEventListener('change', updateCombinationCount);
  updateCombinationCount();

  cancelButton.addEventListener('click', () => {
    if (!running) return;
    cancelRequested = true;
    status.textContent = '現在処理中の固定問題が終わった時点で中断します。';
  });

  function canvasSize(canvas) {
    const scale = Number(canvas.dataset.scale);
    if (!Number.isFinite(scale) || scale <= 0 || !canvas.width) return null;
    const size = Math.round(canvas.width / scale);
    return { size, scale };
  }

  function capturePaintState() {
    const info = canvasSize(paintCanvas);
    if (!info) return null;
    const { size, scale } = info;
    const ctx = paintCanvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, paintCanvas.width, paintCanvas.height).data;
    const weights = new Float32Array(size * size);
    const absolute = new Int8Array(size * size);
    absolute.fill(-1);

    const pixel = (x, y) => {
      const i = (y * paintCanvas.width + x) * 4;
      return [img[i], img[i + 1], img[i + 2], img[i + 3]];
    };

    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      const j = r * size + c;
      const cx = Math.min(paintCanvas.width - 1, c * scale + Math.floor(scale / 2));
      const cy = Math.min(paintCanvas.height - 1, r * scale + Math.floor(scale / 2));
      const [red, green] = pixel(cx, cy);
      let alpha;
      if (green < 150) alpha = green / 197;
      else alpha = (255 - red) / 221;
      const w = clamp((alpha - 0.08) / 0.34, 0, 1);
      weights[j] = Math.round(w * 20) / 20;

      let found = -1;
      for (let yy = r * scale; yy < Math.min((r + 1) * scale, r * scale + 4) && found < 0; yy++) {
        for (let xx = c * scale; xx < (c + 1) * scale; xx++) {
          const [rr, gg, bb] = pixel(xx, yy);
          if (rr > 220 && gg < 100 && bb < 120) { found = 1; break; }
          if (rr < 100 && gg > 90 && gg < 170 && bb > 180) { found = 0; break; }
        }
      }
      absolute[j] = found;
    }
    return { size, weights, absolute };
  }

  function resampleIndex(sourceSize, targetSize, targetCoord) {
    return clamp(Math.floor((targetCoord + 0.5) * sourceSize / targetSize), 0, sourceSize - 1);
  }

  function replayPointerDown(clientX, clientY) {
    if (!paintDown || !paintUp) return false;
    const fakeTarget = { setPointerCapture() {} };
    paintDown({ currentTarget: fakeTarget, pointerId: 1, clientX, clientY });
    paintUp({});
    return true;
  }

  function replayPaintState(snapshot) {
    if (!snapshot || !paintDown || !paintUp) return;
    const info = canvasSize(paintCanvas);
    if (!info) return;
    const { size, scale } = info;
    const rect = paintCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const mode = $('brush-mode');
    const brushWeight = $('brush-weight');
    const radius = $('brush-radius');
    const defaultWeight = clamp(Number($('default-weight')?.value) || 1, 0, 1);
    if (!mode || !brushWeight || !radius) return;
    const saved = { mode: mode.value, weight: brushWeight.value, radius: radius.value };
    radius.value = '0';

    function pointFor(r, c) {
      const px = (c + 0.5) * scale;
      const py = (r + 0.5) * scale;
      return {
        x: rect.left + px * rect.width / paintCanvas.width,
        y: rect.top + py * rect.height / paintCanvas.height
      };
    }

    try {
      mode.value = 'weight';
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
        const sr = resampleIndex(snapshot.size, size, r);
        const sc = resampleIndex(snapshot.size, size, c);
        const w = snapshot.weights[sr * snapshot.size + sc];
        if (Math.abs(w - defaultWeight) < 0.025) continue;
        brushWeight.value = String(w);
        const p = pointFor(r, c);
        replayPointerDown(p.x, p.y);
      }

      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
        const sr = resampleIndex(snapshot.size, size, r);
        const sc = resampleIndex(snapshot.size, size, c);
        const v = snapshot.absolute[sr * snapshot.size + sc];
        if (v < 0) continue;
        mode.value = v ? 'black' : 'white';
        const p = pointFor(r, c);
        replayPointerDown(p.x, p.y);
      }
    } finally {
      mode.value = saved.mode;
      brushWeight.value = saved.weight;
      radius.value = saved.radius;
    }
  }

  function tableValue(card, key) {
    for (const tr of card.querySelectorAll('tr')) {
      const th = tr.querySelector('th');
      const td = tr.querySelector('td');
      if (th?.textContent.trim() === key) return td?.textContent.trim() || '';
    }
    return '';
  }

  function captureCandidates(lengths) {
    const items = [];
    for (const card of phase2Candidates?.querySelectorAll('.candidate') || []) {
      const weighted = parseFloat(tableValue(card, '重要度付き一致スコア')) || 0;
      const raw = parseFloat(tableValue(card, '目標一致率')) || 0;
      const canvas = card.querySelector('canvas');
      const image = canvas ? canvas.toDataURL('image/png') : null;
      const clone = card.cloneNode(true);
      const clonedCanvas = clone.querySelector('canvas');
      if (clonedCanvas && image) {
        const img = document.createElement('img');
        img.src = image;
        img.alt = 'QR候補';
        img.style.width = '210px';
        img.style.height = '210px';
        img.style.imageRendering = 'pixelated';
        img.style.border = '1px solid var(--border)';
        clonedCanvas.replaceWith(img);
      }
      const table = clone.querySelector('.summary-table');
      if (table) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<th>可変部分の長さ</th><td>${escapeHtml(lengths.join(' / '))}</td>`;
        table.insertBefore(tr, table.firstChild);
      }
      items.push({ weighted, raw, lengths: lengths.slice(), node: clone });
    }
    return items;
  }

  function renderAggregate(items, attempted, failed, cancelled) {
    const limit = Math.max(1, Math.floor(Number($('phase2-candidate-count')?.value) || 12));
    items.sort((a, b) => b.weighted - a.weighted || b.raw - a.raw ||
      b.lengths.reduce((x, y) => x + y, 0) - a.lengths.reduce((x, y) => x + y, 0));
    const selected = items.slice(0, limit);
    aggregateRoot.innerHTML = '';
    selected.forEach((item, i) => {
      const node = item.node;
      const strong = node.querySelector('strong');
      if (strong) strong.textContent = `総合候補 ${i + 1}`;
      aggregateRoot.appendChild(node);
    });
    if (!selected.length) aggregateRoot.innerHTML = '<div class="status error">有効な候補を生成できませんでした。</div>';
    aggregateCard.style.display = 'block';
    if (phase2Card) phase2Card.style.display = 'none';
    status.className = 'status ' + (selected.length ? 'ok' : 'error');
    status.textContent = `${cancelled ? '中断。' : '完了。'} 長さ組合せ ${attempted} 件を処理、失敗 ${failed} 件。` +
      ` 全候補 ${items.length} 件から重要度付き一致スコア上位 ${selected.length} 件を表示しています。`;
  }

  function* combinations(maxes, index = 0, prefix = []) {
    if (index >= maxes.length) { yield prefix.slice(); return; }
    if (!autoToggle.checked) {
      prefix.push(maxes[index]);
      yield* combinations(maxes, index + 1, prefix);
      prefix.pop();
      return;
    }
    for (let v = 1; v <= maxes[index]; v++) {
      prefix.push(v);
      yield* combinations(maxes, index + 1, prefix);
      prefix.pop();
    }
  }

  function setLengths(inputs, lengths) {
    for (let i = 0; i < inputs.length; i++) {
      inputs[i].value = String(lengths[i]);
      inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function hasError(id) { return $(id)?.classList.contains('error'); }

  async function runLengthSearch() {
    if (running) return;
    const inputs = variableSegmentInputs();
    if (!inputs.length || !autoToggle.checked) {
      return optimizeButton.onclick?.call(optimizeButton);
    }
    if (typeof analyzeButton.onclick !== 'function' || typeof buildButton.onclick !== 'function' || typeof optimizeButton.onclick !== 'function') {
      status.className = 'status error';
      status.textContent = '内部ハンドラを取得できないため、自動長探索を開始できません。';
      return;
    }

    const maxes = maxLengths();
    const total = combinationCount(maxes);
    const paintSnapshot = capturePaintState();
    const aggregate = [];
    let attempted = 0;
    let failed = 0;
    cancelRequested = false;
    running = true;
    cancelButton.disabled = false;
    autoToggle.disabled = true;
    optimizeButton.disabled = true;
    aggregateCard.style.display = 'none';

    try {
      for (const lengths of combinations(maxes)) {
        if (cancelRequested) break;
        attempted++;
        status.className = 'status';
        status.textContent = `長さ組合せ ${attempted}/${total.toString()} を処理中: ${lengths.join(' / ')}\n` +
          '文字集合解析 → M0/Di再構築 → 画像最適化を独立に実行しています。';

        setLengths(inputs, lengths);

        await analyzeButton.onclick.call(analyzeButton);
        if (hasError('charset-status')) {
          failed++;
          continue;
        }

        await buildButton.onclick.call(buildButton);
        if (hasError('problem-status')) {
          failed++;
          continue;
        }

        replayPaintState(paintSnapshot);
        await optimizeButton.onclick.call(optimizeButton);
        if (hasError('optimize-status')) {
          failed++;
          continue;
        }

        aggregate.push(...captureCandidates(lengths));
        await new Promise(requestAnimationFrame);
      }
    } finally {
      if (cancelRequested) setLengths(inputs, maxes);
      running = false;
      cancelButton.disabled = true;
      autoToggle.disabled = false;
      optimizeButton.disabled = false;
      renderAggregate(aggregate, attempted, failed, cancelRequested);
      updateCombinationCount();
    }
  }

  optimizeButton.addEventListener('click', event => {
    if (!autoToggle.checked || running) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    runLengthSearch().catch(err => {
      running = false;
      cancelButton.disabled = true;
      autoToggle.disabled = false;
      optimizeButton.disabled = false;
      status.className = 'status error';
      status.textContent = `可変長探索で例外: ${err?.message || String(err)}`;
    });
  }, true);
})();
