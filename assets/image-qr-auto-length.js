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
          可変長を範囲探索
        </label>
        <div class="tiny">各可変部の「開始〜終了」を粗いStepで調べ、必要なら上位周辺だけ細かく再探索します。</div>
      </div>
      <div>
        <label>推定試行数</label>
        <div id="auto-length-combination-count" class="pill">—</div>
        <div id="auto-length-count-detail" class="tiny">—</div>
      </div>
      <div>
        <label>探索操作</label>
        <button id="cancel-auto-length" class="secondary" type="button" disabled>現在の長さ探索を中断</button>
      </div>
    </div>

    <h3>Step設定</h3>
    <div class="grid-3">
      <div>
        <label for="auto-length-target-points">粗探索のAuto目標点数 / 軸</label>
        <input id="auto-length-target-points" type="number" min="2" step="1" value="20">
        <div class="tiny">各可変部の粗Stepが0（Auto）のとき、範囲を概ねこの点数で割るようStepを決めます。暫定既定20。</div>
      </div>
      <div>
        <label for="auto-length-refine-top">細探索する上位組合せ数</label>
        <input id="auto-length-refine-top" type="number" min="1" step="1" value="3">
        <div class="tiny">粗探索スコア上位の長さ組合せだけを再探索します。暫定既定3。</div>
      </div>
      <div>
        <label for="auto-length-final-step">細探索Step</label>
        <input id="auto-length-final-step" type="number" min="1" step="1" value="1">
        <div class="tiny">上位周辺で使う最終Step。1なら最後だけ1刻みです。</div>
      </div>
      <div>
        <label style="display:flex;align-items:center;gap:8px;margin-top:26px">
          <input id="auto-length-refine" type="checkbox" style="width:auto" checked>
          粗探索後に上位周辺を細探索
        </label>
      </div>
    </div>

    <div class="tiny" style="margin-top:8px">
      「粗探索Step=0」はAutoです。数値を入れればそのStepを厳密に使用します。
      QR VersionがAutoで長さにより行列サイズが変わる場合、重要度・絶対制約は基準問題の正規化座標を最近傍で移送します。
      これらのStep既定値はQR規格値ではなく計算時間とのトレードオフです。
    </div>
    <div id="auto-length-status" class="status">各可変部の探索範囲とStepを設定し、「画像目標へ最適化」を押してください。</div>
  `;
  optimizerCard.insertBefore(controls, optimizeButton.parentElement);

  const autoToggle = $('auto-variable-lengths');
  const comboCount = $('auto-length-combination-count');
  const countDetail = $('auto-length-count-detail');
  const cancelButton = $('cancel-auto-length');
  const status = $('auto-length-status');
  const targetPointsInput = $('auto-length-target-points');
  const refineToggle = $('auto-length-refine');
  const refineTopInput = $('auto-length-refine-top');
  const finalStepInput = $('auto-length-final-step');

  const aggregateCard = document.createElement('div');
  aggregateCard.className = 'card';
  aggregateCard.id = 'auto-length-candidate-card';
  aggregateCard.style.display = 'none';
  aggregateCard.innerHTML = `
    <h2>可変長をまたいだ候補比較</h2>
    <p class="muted">粗探索と細探索で評価した各固定QR問題の候補を、重要度付き一致スコアでまとめて比較します。</p>
    <div id="auto-length-candidates"></div>
  `;
  (phase2Card || optimizerCard).insertAdjacentElement('afterend', aggregateCard);
  const aggregateRoot = $('auto-length-candidates');

  function ensureSegmentSearchUi(seg, number) {
    if (seg.querySelector('.length-search-axis')) return;

    const label = number.parentElement?.querySelector('label');
    if (label) label.textContent = '可変部分の探索終了 / 最大長（ASCII文字数 = バイト数）';

    const axis = document.createElement('div');
    axis.className = 'length-search-axis';
    axis.style.marginTop = '10px';
    axis.innerHTML = `
      <div class="grid-3">
        <div>
          <label>探索開始</label>
          <input class="length-search-start" type="number" min="1" step="1" value="1">
        </div>
        <div>
          <label>粗探索Step（0 = Auto）</label>
          <input class="length-search-step" type="number" min="0" step="1" value="0">
        </div>
        <div>
          <label>細探索の ±幅</label>
          <input class="length-search-radius" type="number" min="0" step="1" value="20">
        </div>
      </div>
      <div class="tiny length-search-summary" style="margin-top:5px">—</div>
    `;
    number.parentElement?.appendChild(axis);
  }

  function variableSegmentEntries() {
    const out = [];
    let index = 0;
    for (const seg of segmentsRoot.querySelectorAll('.segment')) {
      const typeSelect = seg.querySelector('select');
      if (!typeSelect || typeSelect.value !== 'variable') continue;
      const number = seg.querySelector('input[type="number"]');
      if (!number) continue;
      ensureSegmentSearchUi(seg, number);
      out.push({
        index: index++,
        seg,
        endInput: number,
        startInput: seg.querySelector('.length-search-start'),
        stepInput: seg.querySelector('.length-search-step'),
        radiusInput: seg.querySelector('.length-search-radius'),
        summary: seg.querySelector('.length-search-summary')
      });
    }
    return out;
  }

  function readSearchConfig() {
    const targetPoints = Math.max(2, Math.floor(Number(targetPointsInput.value) || 20));
    const finalStep = Math.max(1, Math.floor(Number(finalStepInput.value) || 1));
    const axes = variableSegmentEntries().map(entry => {
      const end = Math.max(1, Math.floor(Number(entry.endInput.value) || 1));
      const startRaw = Math.max(1, Math.floor(Number(entry.startInput?.value) || 1));
      if (startRaw > end) throw new Error(`可変部 ${entry.index + 1}: 探索開始 ${startRaw} が終了 ${end} を超えています。`);
      const manualStep = Math.max(0, Math.floor(Number(entry.stepInput?.value) || 0));
      const autoStep = Math.max(1, Math.ceil(Math.max(1, end - startRaw) / Math.max(1, targetPoints - 1)));
      const coarseStep = manualStep > 0 ? manualStep : autoStep;
      const radius = Math.max(0, Math.floor(Number(entry.radiusInput?.value) || 0));
      return { entry, start: startRaw, end, coarseStep, manualStep, radius };
    });
    return {
      axes,
      targetPoints,
      refine: refineToggle.checked,
      refineTop: Math.max(1, Math.floor(Number(refineTopInput.value) || 3)),
      finalStep
    };
  }

  function axisValues(start, end, step, force = []) {
    const values = [];
    for (let v = start; v <= end; v += step) values.push(v);
    if (!values.includes(end)) values.push(end);
    for (const v of force) {
      if (v >= start && v <= end && !values.includes(v)) values.push(v);
    }
    values.sort((a, b) => a - b);
    return values;
  }

  function coarseAxes(config) {
    return config.axes.map(a => axisValues(a.start, a.end, a.coarseStep));
  }

  function refinementAxes(config, center) {
    return config.axes.map((a, i) => {
      const lo = Math.max(a.start, center[i] - a.radius);
      const hi = Math.min(a.end, center[i] + a.radius);
      return axisValues(lo, hi, config.finalStep, [center[i]]);
    });
  }

  function productCount(axes) {
    return axes.reduce((n, arr) => n * BigInt(arr.length), 1n);
  }

  function* product(axes, index = 0, prefix = []) {
    if (index >= axes.length) {
      yield prefix.slice();
      return;
    }
    for (const v of axes[index]) {
      prefix.push(v);
      yield* product(axes, index + 1, prefix);
      prefix.pop();
    }
  }

  function updateCombinationCount() {
    try {
      const config = readSearchConfig();
      if (!config.axes.length) {
        comboCount.textContent = '0';
        countDetail.textContent = '可変セグメントなし';
        return;
      }
      if (!autoToggle.checked) {
        comboCount.textContent = '1';
        countDetail.textContent = '範囲探索OFF';
        return;
      }
      const coarse = coarseAxes(config);
      const coarseN = productCount(coarse);
      let refineMax = 0n;
      if (config.refine) {
        const perTop = config.axes.map(a => {
          const span = Math.min(a.end - a.start, a.radius * 2);
          return Math.floor(span / config.finalStep) + 2;
        });
        refineMax = BigInt(config.refineTop) * perTop.reduce((n, x) => n * BigInt(Math.max(1, x)), 1n);
      }
      comboCount.textContent = config.refine ? `${coarseN.toString()} + ≤${refineMax.toString()}` : coarseN.toString();
      countDetail.textContent = config.refine
        ? `粗探索 ${coarseN.toString()} 件 + 上位${config.refineTop}組合せ周辺（重複は除外）`
        : `粗探索 ${coarseN.toString()} 件のみ`;
      comboCount.classList.toggle('warn-pill', coarseN + refineMax > 128n);

      for (const a of config.axes) {
        if (!a.entry.summary) continue;
        const mode = a.manualStep > 0 ? '手動' : 'Auto';
        a.entry.summary.textContent =
          `範囲 ${a.start}〜${a.end} / 粗Step ${a.coarseStep} (${mode}) / 細探索 ±${a.radius} / 最終Step ${config.finalStep}`;
      }
      if (!running) aggregateCard.style.display = 'none';
    } catch (e) {
      comboCount.textContent = '範囲エラー';
      comboCount.classList.add('warn-pill');
      countDetail.textContent = e?.message || String(e);
    }
  }

  const segmentObserver = new MutationObserver(updateCombinationCount);
  segmentObserver.observe(segmentsRoot, { childList: true, subtree: true });
  segmentsRoot.addEventListener('input', updateCombinationCount, true);
  segmentsRoot.addEventListener('change', updateCombinationCount, true);
  controls.addEventListener('input', updateCombinationCount, true);
  controls.addEventListener('change', updateCombinationCount, true);
  updateCombinationCount();

  cancelButton.addEventListener('click', () => {
    if (!running) return;
    cancelRequested = true;
    status.textContent = '現在処理中の固定問題が終わった時点で中断します。';
  });

  function canvasSize(canvas) {
    const scale = Number(canvas.dataset.scale);
    if (!Number.isFinite(scale) || scale <= 0 || !canvas.width) return null;
    return { size: Math.round(canvas.width / scale), scale };
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
      weights[j] = Math.round(clamp((alpha - 0.08) / 0.34, 0, 1) * 20) / 20;

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

  function captureCandidates(lengths, stage) {
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
        const tr1 = document.createElement('tr');
        tr1.innerHTML = `<th>可変部分の長さ</th><td>${escapeHtml(lengths.join(' / '))}</td>`;
        table.insertBefore(tr1, table.firstChild);
        const tr2 = document.createElement('tr');
        tr2.innerHTML = `<th>長さ探索段階</th><td>${escapeHtml(stage)}</td>`;
        table.insertBefore(tr2, table.firstChild);
      }
      items.push({ weighted, raw, lengths: lengths.slice(), stage, node: clone });
    }
    return items;
  }

  function renderAggregate(items, attempted, failed, cancelled, coarseAttempted, refineAttempted) {
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
    status.textContent =
      `${cancelled ? '中断。' : '完了。'} 粗探索 ${coarseAttempted} 件 / 細探索 ${refineAttempted} 件 / 合計 ${attempted} 件、失敗 ${failed} 件。` +
      ` 全候補 ${items.length} 件から重要度付き一致スコア上位 ${selected.length} 件を表示しています。`;
  }

  function setLengths(entries, lengths) {
    for (let i = 0; i < entries.length; i++) {
      entries[i].endInput.value = String(lengths[i]);
      entries[i].endInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function hasError(id) { return $(id)?.classList.contains('error'); }

  async function evaluateLengths(entries, lengths, paintSnapshot, stage) {
    setLengths(entries, lengths);

    await analyzeButton.onclick.call(analyzeButton);
    if (hasError('charset-status')) return { ok: false, items: [], score: -Infinity };

    await buildButton.onclick.call(buildButton);
    if (hasError('problem-status')) return { ok: false, items: [], score: -Infinity };

    replayPaintState(paintSnapshot);
    await optimizeButton.onclick.call(optimizeButton);
    if (hasError('optimize-status')) return { ok: false, items: [], score: -Infinity };

    const items = captureCandidates(lengths, stage);
    const score = items.reduce((m, item) => Math.max(m, item.weighted), -Infinity);
    return { ok: true, items, score };
  }

  async function runLengthSearch() {
    if (running) return;
    const entries = variableSegmentEntries();
    if (!entries.length || !autoToggle.checked) return optimizeButton.onclick?.call(optimizeButton);
    if (typeof analyzeButton.onclick !== 'function' || typeof buildButton.onclick !== 'function' || typeof optimizeButton.onclick !== 'function') {
      status.className = 'status error';
      status.textContent = '内部ハンドラを取得できないため、可変長探索を開始できません。';
      return;
    }

    let config;
    try {
      config = readSearchConfig();
    } catch (e) {
      status.className = 'status error';
      status.textContent = e?.message || String(e);
      return;
    }

    const originalEnds = config.axes.map(a => a.end);
    const coarse = coarseAxes(config);
    const coarseTotal = productCount(coarse);
    const paintSnapshot = capturePaintState();
    const aggregate = [];
    const comboScores = [];
    const attemptedKeys = new Set();
    let attempted = 0;
    let failed = 0;
    let coarseAttempted = 0;
    let refineAttempted = 0;
    cancelRequested = false;
    running = true;
    cancelButton.disabled = false;
    autoToggle.disabled = true;
    optimizeButton.disabled = true;
    aggregateCard.style.display = 'none';

    try {
      for (const lengths of product(coarse)) {
        if (cancelRequested) break;
        const key = lengths.join(',');
        attemptedKeys.add(key);
        attempted++;
        coarseAttempted++;
        status.className = 'status';
        status.textContent =
          `粗探索 ${coarseAttempted}/${coarseTotal.toString()} : ${lengths.join(' / ')}\n` +
          '文字集合解析 → M0/Di再構築 → 画像最適化を独立に実行しています。';

        const result = await evaluateLengths(entries, lengths, paintSnapshot, '粗探索');
        if (!result.ok) {
          failed++;
        } else {
          aggregate.push(...result.items);
          comboScores.push({ lengths: lengths.slice(), score: result.score });
        }
        await new Promise(requestAnimationFrame);
      }

      if (!cancelRequested && config.refine && comboScores.length) {
        comboScores.sort((a, b) => b.score - a.score);
        const centers = comboScores.slice(0, config.refineTop);
        const refineQueue = [];
        const queued = new Set();

        for (const center of centers) {
          for (const lengths of product(refinementAxes(config, center.lengths))) {
            const key = lengths.join(',');
            if (attemptedKeys.has(key) || queued.has(key)) continue;
            queued.add(key);
            refineQueue.push(lengths);
          }
        }

        for (let i = 0; i < refineQueue.length; i++) {
          if (cancelRequested) break;
          const lengths = refineQueue[i];
          const key = lengths.join(',');
          attemptedKeys.add(key);
          attempted++;
          refineAttempted++;
          status.className = 'status';
          status.textContent =
            `細探索 ${refineAttempted}/${refineQueue.length} : ${lengths.join(' / ')}\n` +
            `粗探索上位 ${centers.length} 組合せの周辺を Step ${config.finalStep} で再探索しています。`;

          const result = await evaluateLengths(entries, lengths, paintSnapshot, '細探索');
          if (!result.ok) failed++;
          else aggregate.push(...result.items);
          await new Promise(requestAnimationFrame);
        }
      }
    } finally {
      setLengths(entries, originalEnds);
      running = false;
      cancelButton.disabled = true;
      autoToggle.disabled = false;
      optimizeButton.disabled = false;
      renderAggregate(aggregate, attempted, failed, cancelRequested, coarseAttempted, refineAttempted);
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