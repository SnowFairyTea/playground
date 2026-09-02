(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const paint = $('paint-canvas');
  const target = $('target-canvas');
  const card = $('weight-card');
  const hook = window.__imageQrUiHook;
  const paintDown = hook?.listeners?.['paint-canvas']?.pointerdown?.[0];
  const paintUp = hook?.listeners?.['paint-canvas']?.pointerup?.[0];
  if (!paint || !target || !card || !hook || !paintDown || !paintUp) return;

  const style = document.createElement('style');
  style.textContent = `
    .qr-region-panel { margin-top: 14px; padding: 14px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
    .qr-region-panel h3 { margin-top: 0; }
    .qr-region-controls { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
    .qr-region-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; align-items:center; }
    .qr-region-status { margin-top:10px; font-size:.82rem; color:var(--muted); white-space:pre-wrap; }
    .qr-region-overlay { position:absolute; z-index:4; touch-action:none; cursor:crosshair; }
    .qr-region-panel button.active { background:var(--accent); color:white; border-color:var(--accent); }
    @media (max-width:820px){ .qr-region-controls { grid-template-columns:1fr 1fr; } }
    @media (max-width:520px){ .qr-region-controls { grid-template-columns:1fr; } }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.className = 'qr-region-panel';
  panel.innerHTML = `
    <h3>大面積の領域編集</h3>
    <p class="tiny">矩形・円形をドラッグして一括指定します。「絶対黒/白」はGF(2)等式制約、「できるだけ黒/白」は目標画像を書き換えるソフト目標です。QR生成後のモジュール行列は変更しません。</p>
    <div class="qr-region-controls">
      <div><label for="region-op">処理</label><select id="region-op">
        <option value="hard-black">絶対黒</option>
        <option value="hard-white">絶対白</option>
        <option value="clear-hard">絶対制約を消す</option>
        <option value="soft-black" selected>できるだけ黒</option>
        <option value="soft-white">できるだけ白</option>
        <option value="weight">重要度だけ変更</option>
      </select></div>
      <div><label for="region-shape">形</label><select id="region-shape"><option value="rect" selected>矩形</option><option value="circle">円形</option></select></div>
      <div><label for="region-weight">重要度 (0.0–1.0)</label><input id="region-weight" type="number" min="0" max="1" step="0.05" value="1"></div>
      <div><label>既存の円ブラシ</label><div class="qr-region-actions" style="margin-top:0"><button type="button" class="secondary region-radius" data-r="3">半径3</button><button type="button" class="secondary region-radius" data-r="6">6</button><button type="button" class="secondary region-radius" data-r="12">12</button></div></div>
    </div>
    <div class="qr-region-actions">
      <button type="button" class="secondary" id="region-select-toggle">領域選択: OFF</button>
      <button type="button" class="secondary" id="region-apply-all">全体に適用</button>
      <button type="button" class="secondary" id="region-restore-source" disabled>ソフト編集前の元画像へ戻す</button>
    </div>
    <div id="region-status" class="qr-region-status">領域選択をONにすると、下の重要度キャンバス上をドラッグできます。</div>
  `;

  const paintWrap = paint.parentElement;
  card.insertBefore(panel, paintWrap);
  paintWrap.style.position = 'relative';

  const overlay = document.createElement('canvas');
  overlay.className = 'qr-region-overlay';
  overlay.style.pointerEvents = 'none';
  paintWrap.appendChild(overlay);

  const status = $('region-status');
  const selectToggle = $('region-select-toggle');
  const restoreButton = $('region-restore-source');
  let selectionEnabled = false;
  let dragStart = null;
  let dragEnd = null;
  let sourceBackup = null;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function setStatus(text, error = false) {
    status.textContent = text;
    status.style.color = error ? '#991b1b' : 'var(--muted)';
  }

  function syncOverlay() {
    if (!paint.width || !paint.height) return;
    const pRect = paint.getBoundingClientRect();
    const wRect = paintWrap.getBoundingClientRect();
    overlay.width = paint.width;
    overlay.height = paint.height;
    overlay.style.width = `${pRect.width}px`;
    overlay.style.height = `${pRect.height}px`;
    overlay.style.left = `${pRect.left - wRect.left + paintWrap.scrollLeft}px`;
    overlay.style.top = `${pRect.top - wRect.top + paintWrap.scrollTop}px`;
    drawSelection();
  }

  function moduleSize() {
    const scale = Number(paint.dataset.scale);
    if (!scale || !paint.width) return 0;
    return Math.round(paint.width / scale);
  }

  function pointToCell(event) {
    const scale = Number(paint.dataset.scale);
    const size = moduleSize();
    if (!scale || !size) return null;
    const rect = overlay.getBoundingClientRect();
    const x = (event.clientX - rect.left) * overlay.width / rect.width;
    const y = (event.clientY - rect.top) * overlay.height / rect.height;
    return {
      c: clamp(Math.floor(x / scale), 0, size - 1),
      r: clamp(Math.floor(y / scale), 0, size - 1)
    };
  }

  function drawSelection() {
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!dragStart || !dragEnd) return;
    const scale = Number(paint.dataset.scale);
    if (!scale) return;
    ctx.save();
    ctx.strokeStyle = '#f59e0b';
    ctx.fillStyle = 'rgba(245,158,11,.16)';
    ctx.lineWidth = Math.max(2, Math.floor(scale * .18));
    if ($('region-shape').value === 'rect') {
      const x0 = Math.min(dragStart.c, dragEnd.c) * scale;
      const y0 = Math.min(dragStart.r, dragEnd.r) * scale;
      const x1 = (Math.max(dragStart.c, dragEnd.c) + 1) * scale;
      const y1 = (Math.max(dragStart.r, dragEnd.r) + 1) * scale;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2);
    } else {
      const cx = (dragStart.c + .5) * scale;
      const cy = (dragStart.r + .5) * scale;
      const radius = Math.hypot(dragEnd.c - dragStart.c, dragEnd.r - dragStart.r) * scale;
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  function indicesForSelection(start, end, shape) {
    const size = moduleSize();
    const out = [];
    if (!size) return out;
    if (shape === 'rect') {
      const r0 = Math.min(start.r, end.r), r1 = Math.max(start.r, end.r);
      const c0 = Math.min(start.c, end.c), c1 = Math.max(start.c, end.c);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(r * size + c);
    } else {
      const radius = Math.hypot(end.c - start.c, end.r - start.r);
      const r0 = Math.max(0, Math.floor(start.r - radius)), r1 = Math.min(size - 1, Math.ceil(start.r + radius));
      const c0 = Math.max(0, Math.floor(start.c - radius)), c1 = Math.min(size - 1, Math.ceil(start.c + radius));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        if (Math.hypot(c - start.c, r - start.r) <= radius + .25) out.push(r * size + c);
      }
    }
    return out;
  }

  function callCorePaint(index, mode, weight = 1) {
    const size = moduleSize(), scale = Number(paint.dataset.scale);
    if (!size || !scale) return;
    const r = Math.floor(index / size), c = index % size;
    const rect = paint.getBoundingClientRect();
    const clientX = rect.left + (c + .5) * scale * rect.width / paint.width;
    const clientY = rect.top + (r + .5) * scale * rect.height / paint.height;
    const modeEl = $('brush-mode'), weightEl = $('brush-weight'), radiusEl = $('brush-radius');
    const saved = { mode: modeEl.value, weight: weightEl.value, radius: radiusEl.value };
    try {
      modeEl.value = mode;
      weightEl.value = String(weight);
      radiusEl.value = '0';
      paintDown({ currentTarget: { setPointerCapture() {} }, pointerId: 991, clientX, clientY });
      paintUp({});
    } finally {
      modeEl.value = saved.mode;
      weightEl.value = saved.weight;
      radiusEl.value = saved.radius;
    }
  }

  function applyHard(indices, op) {
    if (!indices.length) return;
    if (!hook.state.constraints && op !== 'clear-hard') {
      callCorePaint(indices[0], op === 'hard-black' ? 'black' : 'white');
    }
    const map = hook.state.constraints;
    if (!map) {
      if (op === 'clear-hard') {
        setStatus('消去対象の絶対制約はまだありません。');
        return;
      }
      setStatus('絶対制約Mapを取得できませんでした。通常ブラシを一度使用してから再試行してください。', true);
      return;
    }
    if (op === 'hard-black') for (const j of indices) map.set(j, 1);
    else if (op === 'hard-white') for (const j of indices) map.set(j, 0);
    else for (const j of indices) map.delete(j);
    callCorePaint(indices[0], op === 'hard-black' ? 'black' : op === 'hard-white' ? 'white' : 'clear');
    setStatus(`${indices.length} modules を ${op === 'hard-black' ? '絶対黒' : op === 'hard-white' ? '絶対白' : '絶対制約なし'} に一括設定しました。解けない場合はGF(2)求解側で「解なし」と判定されます。`);
  }

  function applyWeight(indices, weight) {
    if (!indices.length) return;
    const w = clamp(weight, 0, 1);
    const arr = hook.state.weights;
    if (arr && arr.length === moduleSize() * moduleSize()) {
      for (const j of indices) arr[j] = w;
      callCorePaint(indices[0], 'weight', w);
      setStatus(`${indices.length} modules の重要度を ${w.toFixed(2)} に設定しました。`);
      return;
    }
    // 念のためのフォールバック。通常は hook が初期化時の Float32Array を保持する。
    for (const j of indices.slice(0, 2000)) callCorePaint(j, 'weight', w);
    setStatus(`${Math.min(indices.length, 2000)} modules の重要度を通常ブラシ経由で設定しました。大量領域では再構築後にもう一度試してください。`, indices.length > 2000);
  }

  const imageParamIds = ['fit-mode','threshold','brightness','contrast','invert-target','crop-x','crop-y','crop-w','crop-h','image-zoom','image-offset-x','image-offset-y','image-smoothing','outside-level','gray-method'];
  function snapshotSource() {
    if (sourceBackup) return;
    const input = $('source-image');
    sourceBackup = {
      file: input?.files?.[0] || null,
      params: Object.fromEntries(imageParamIds.map(id => {
        const el = $(id); return [id, el?.type === 'checkbox' ? !!el.checked : el?.value];
      }))
    };
    restoreButton.disabled = !sourceBackup.file;
  }

  function setNeutralImageParams() {
    const values = {
      'fit-mode':'stretch', threshold:'128', brightness:'0', contrast:'1', 'invert-target':false,
      'crop-x':'0','crop-y':'0','crop-w':'100','crop-h':'100','image-zoom':'100','image-offset-x':'0','image-offset-y':'0',
      'image-smoothing':false,'outside-level':'255','gray-method':'average'
    };
    for (const [id, value] of Object.entries(values)) {
      const el = $(id); if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!value; else el.value = String(value);
    }
  }

  function sampleTargetBits(size) {
    const scale = Number(target.dataset.scale);
    if (!scale || !target.width || Math.round(target.width / scale) !== size) throw new Error('目標画像がまだ生成されていません。');
    const ctx = target.getContext('2d', { willReadFrequently: true });
    const bits = new Uint8Array(size * size);
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      const x = Math.min(target.width - 1, Math.floor((c + .5) * scale));
      const y = Math.min(target.height - 1, Math.floor((r + .5) * scale));
      const d = ctx.getImageData(x, y, 1, 1).data;
      bits[r * size + c] = (d[0] + d[1] + d[2]) / 3 < 128 ? 1 : 0;
    }
    return bits;
  }

  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('目標画像のPNG化に失敗しました。')), 'image/png'));
  }

  async function replaceSourceWithBits(bits, size) {
    if (typeof DataTransfer === 'undefined') throw new Error('このブラウザではソフト領域の画像入力への反映を利用できません。絶対黒/白は利用できます。');
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size); ctx.fillStyle = '#000';
    for (let r = 0; r < size; r++) for (let col = 0; col < size; col++) if (bits[r * size + col]) ctx.fillRect(col, r, 1, 1);
    const blob = await canvasBlob(c);
    const file = new File([blob], 'qr-target-region-edited.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(file);
    setNeutralImageParams();
    const input = $('source-image'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function applySoft(indices, black, weight) {
    if (!indices.length) return;
    const size = moduleSize();
    snapshotSource();
    const bits = sampleTargetBits(size);
    for (const j of indices) bits[j] = black ? 1 : 0;
    applyWeight(indices, weight);
    await replaceSourceWithBits(bits, size);
    setStatus(`${indices.length} modules を「できるだけ${black ? '黒' : '白'}」の目標へ変更しました（重要度 ${clamp(weight,0,1).toFixed(2)}）。これは目標画像の変更であり、QRモジュールの後加工ではありません。`);
  }

  async function applyIndices(indices) {
    const op = $('region-op').value;
    const weight = clamp(parseFloat($('region-weight').value || '1'), 0, 1);
    try {
      if (op === 'hard-black' || op === 'hard-white' || op === 'clear-hard') applyHard(indices, op);
      else if (op === 'weight') applyWeight(indices, weight);
      else await applySoft(indices, op === 'soft-black', weight);
    } catch (e) {
      setStatus(e.message || String(e), true);
    }
    syncOverlay();
  }

  overlay.addEventListener('pointerdown', e => {
    if (!selectionEnabled) return;
    dragStart = pointToCell(e); dragEnd = dragStart;
    overlay.setPointerCapture(e.pointerId); drawSelection(); e.preventDefault();
  });
  overlay.addEventListener('pointermove', e => {
    if (!selectionEnabled || !dragStart) return;
    dragEnd = pointToCell(e); drawSelection(); e.preventDefault();
  });
  overlay.addEventListener('pointerup', async e => {
    if (!selectionEnabled || !dragStart) return;
    dragEnd = pointToCell(e) || dragEnd;
    const indices = indicesForSelection(dragStart, dragEnd, $('region-shape').value);
    dragStart = dragEnd = null; drawSelection();
    await applyIndices(indices); e.preventDefault();
  });
  overlay.addEventListener('pointercancel', () => { dragStart = dragEnd = null; drawSelection(); });

  selectToggle.addEventListener('click', () => {
    selectionEnabled = !selectionEnabled;
    selectToggle.textContent = `領域選択: ${selectionEnabled ? 'ON' : 'OFF'}`;
    selectToggle.classList.toggle('active', selectionEnabled);
    overlay.style.pointerEvents = selectionEnabled ? 'auto' : 'none';
    syncOverlay();
    setStatus(selectionEnabled ? '重要度キャンバス上をドラッグして領域を選択してください。' : '通常のブラシ操作に戻りました。');
  });

  $('region-apply-all').addEventListener('click', () => {
    const size = moduleSize();
    if (!size) { setStatus('先にQR写像を構築してください。', true); return; }
    applyIndices(Array.from({ length: size * size }, (_, i) => i));
  });

  restoreButton.addEventListener('click', () => {
    if (!sourceBackup?.file || typeof DataTransfer === 'undefined') return;
    for (const [id, value] of Object.entries(sourceBackup.params)) {
      const el = $(id); if (!el) continue;
      if (el.type === 'checkbox') el.checked = !!value; else el.value = String(value);
    }
    const dt = new DataTransfer(); dt.items.add(sourceBackup.file);
    const input = $('source-image'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    sourceBackup = null; restoreButton.disabled = true;
    setStatus('ソフト領域編集前の元画像と画像パラメータへ戻しました。');
  });

  document.querySelectorAll('.region-radius').forEach(btn => btn.addEventListener('click', () => {
    $('brush-radius').value = btn.dataset.r;
    setStatus(`通常の円ブラシ半径を ${btn.dataset.r} modules に設定しました。ブラシモードは既存UIから選択できます。`);
  }));

  $('region-op').addEventListener('change', () => {
    const soft = $('region-op').value.startsWith('soft') || $('region-op').value === 'weight';
    $('region-weight').disabled = !soft;
  });

  const resizeObserver = new ResizeObserver(syncOverlay); resizeObserver.observe(paint); resizeObserver.observe(paintWrap);
  const mutationObserver = new MutationObserver(syncOverlay); mutationObserver.observe(card, { attributes:true, subtree:true, attributeFilter:['style','width','height'] });
  window.addEventListener('resize', syncOverlay);
  syncOverlay();
})();
