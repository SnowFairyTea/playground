(() => {
  'use strict';
  const E = window.ImageQrEngine, $ = id => document.getElementById(id), root = $('image-qr-app');
  if (!root || !E) return;
  const state = {
    segments: [{ kind: 'fixed', text: '' }, { kind: 'variable', length: 128, start: 1, step: 0, refineRadius: 2, allowed: E.URLSAFE, forbidden: '', affineChoice: 'auto' }],
    source: null, sourceURL: null, size: 49, weights: new Float32Array(49 * 49).fill(1), hard: new Int8Array(49 * 49).fill(-1), soft: new Int8Array(49 * 49).fill(-1),
    bits: null, worker: null, workerURL: null, workerReject: null, busy: false, request: 0, revision: 0, candidates: [], selected: null, analyses: [], disabled: new Map()
  };
  const imageFields = ['fit-mode', 'threshold', 'contrast', 'brightness', 'image-zoom', 'outside-level', 'image-offset-x', 'image-offset-y', 'gray-method', 'crop-x', 'crop-y', 'crop-w', 'crop-h', 'target-safe-inset', 'invert-target', 'image-smoothing', 'avoid-corner-patterns'];
  const settingFields = ['encoding', 'version', 'ecc', 'mask', 'search-seconds', 'perception', 'rotation', 'full-charset', 'auto-length', 'compare-versions', 'version-min', 'version-max', 'length-trials', 'coarse-points', 'soft-passes', 'reserve-free', 'null-samples', 'candidate-count', 'optimizer-seed', 'make-artistic', 'artistic-budget'];
  const number = id => Number($(id).value);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const percent = value => value == null ? '対象なし' : (value * 100).toFixed(1) + '%';
  const score = value => (value * 100).toFixed(1) + ' / 100';
  function status(message, error = false) { $('search-status').textContent = message; $('search-status').classList.toggle('error', error); }
  function settings() {
    return E.normalizeSettings({
      encoding: $('encoding').value,
      artistic: $('make-artistic').checked, artisticBudget: number('artistic-budget'),
      version: $('version').value, ecc: $('ecc').value, masks: $('mask').value,
      versionMin: number('version-min'), versionMax: number('version-max'), compareVersions: $('compare-versions').checked,
      rotations: $('rotation').value === 'all' ? [0, 1, 2, 3] : [Number($('rotation').value)],
      seconds: number('search-seconds'), perception: number('perception'), fullCharset: $('full-charset').checked,
      autoLength: $('auto-length').checked, lengthTrials: number('length-trials'), coarsePoints: number('coarse-points'),
      passes: number('soft-passes'), reserve: number('reserve-free'), samples: number('null-samples'), candidates: number('candidate-count'), seed: number('optimizer-seed')
    });
  }
  function invalidate() {
    state.revision++;
    $('export-controls').hidden = true; $('validation-badge').hidden = true;
    $('artistic-section').hidden = true;
    $('candidates-section').hidden = true; state.selected = null; state.candidates = [];
    $('result-summary').textContent = '条件を変更しました。「生成する」で新しい候補を比較できます。';
  }
  function renderSegments() {
    const container = $('segments'); container.replaceChildren();
    state.segments.forEach((seg, i) => {
      const card = document.createElement('div'); card.className = 'qr-segment';
      card.innerHTML = `<div class="qr-segment-head"><strong>${i + 1}. ${seg.kind === 'fixed' ? '固定する部分' : '変更できる部分'}</strong><button type="button" class="secondary" data-action="up" aria-label="部分${i + 1}を上へ" ${i ? '' : 'disabled'}>↑</button><button type="button" class="secondary" data-action="down" aria-label="部分${i + 1}を下へ" ${i === state.segments.length - 1 ? 'disabled' : ''}>↓</button><button type="button" class="secondary" data-action="delete">削除</button></div>
        <label for="segment-${i}-kind">種類</label><select id="segment-${i}-kind" data-field="kind"><option value="fixed">固定</option><option value="variable">可変</option></select>`;
      if (seg.kind === 'fixed') card.insertAdjacentHTML('beforeend', `<label for="segment-${i}-text" class="qr-spaced">保持する文字列 / URL</label><textarea id="segment-${i}-text" rows="2" data-field="text" placeholder="例: https://example.com/#"></textarea>`);
      else {
        card.insertAdjacentHTML('beforeend', `<div class="qr-grid-3 qr-spaced">
          <div><label for="segment-${i}-length">長さ / 探索終了</label><input id="segment-${i}-length" data-field="length" type="number" min="1" max="7089"></div>
          <div><label for="segment-${i}-start">探索開始</label><input id="segment-${i}-start" data-field="start" type="number" min="1" max="7089"></div>
          <div><label for="segment-${i}-step">粗探索Step（0で自動）</label><input id="segment-${i}-step" data-field="step" type="number" min="0" max="7089"></div>
        </div><label for="segment-${i}-allowed" class="qr-spaced">使用可能文字</label><textarea id="segment-${i}-allowed" data-field="allowed" rows="2"></textarea>
        <div class="qr-toolbar qr-spaced"><button type="button" class="secondary" data-preset="url">URL-safe</button><button type="button" class="secondary" data-preset="extended">URL-safe + .~</button><button type="button" class="secondary" data-preset="digits">0–9</button><button type="button" class="secondary" data-preset="upper">A–Z</button><button type="button" class="secondary" data-preset="lower">a–z</button><button type="button" class="secondary" data-action="max">このサイズで使える長さにする</button></div>
        <details class="qr-details"><summary>この部分の詳細</summary><div class="qr-grid-3 qr-spaced"><div><label for="segment-${i}-forbidden">禁止文字</label><input id="segment-${i}-forbidden" data-field="forbidden" type="text"></div><div><label for="segment-${i}-refine">細探索の±幅</label><input id="segment-${i}-refine" data-field="refineRadius" type="number" min="0" max="100"></div><div><label for="segment-${i}-affine">初期求解の部分集合</label><select id="segment-${i}-affine" data-field="affineChoice"><option value="auto">自動（最大自由度）</option></select></div></div></details>`);
        const analysis = state.analyses.find(a => a.segment === i);
        if (analysis?.candidates) analysis.candidates.forEach((a, k) => { const option = document.createElement('option'); option.value = k; option.textContent = `${k + 1}: ${a.characters}`; card.querySelector('[data-field="affineChoice"]').appendChild(option); });
      }
      for (const input of card.querySelectorAll('[data-field]')) {
        const field = input.dataset.field; input.value = String(seg[field] ?? '');
        input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
          seg[field] = input.type === 'number' ? Number(input.value) : input.value;
          if (field === 'kind') { Object.assign(seg, seg.kind === 'fixed' ? { text: seg.text || '' } : { length: seg.length || 128, start: seg.start || 1, step: seg.step || 0, refineRadius: seg.refineRadius ?? 2, allowed: seg.allowed || E.URLSAFE, forbidden: seg.forbidden || '', affineChoice: 'auto' }); renderSegments(); }
          if (field === 'allowed' || field === 'forbidden') {
            seg.affineChoice = 'auto'; state.analyses = [];
            const select = card.querySelector('[data-field="affineChoice"]');
            select.replaceChildren(new Option('自動（最大自由度）', 'auto'));
          }
          invalidate(); refreshTarget();
        });
      }
      for (const button of card.querySelectorAll('[data-action]')) button.addEventListener('click', () => {
        const action = button.dataset.action;
        if (action === 'delete') state.segments.splice(i, 1);
        if (action === 'up') [state.segments[i - 1], state.segments[i]] = [seg, state.segments[i - 1]];
        if (action === 'down') [state.segments[i + 1], state.segments[i]] = [seg, state.segments[i + 1]];
        if (action === 'max') { try { setMaxLength(i); } catch (e) { status(e.message, true); return; } }
        state.analyses = []; renderSegments(); invalidate(); refreshTarget();
      });
      for (const button of card.querySelectorAll('[data-preset]')) button.addEventListener('click', () => {
        seg.allowed = { url: E.URLSAFE, extended: E.URLSAFE + '.~', digits: '0123456789', upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', lower: 'abcdefghijklmnopqrstuvwxyz' }[button.dataset.preset];
        seg.affineChoice = 'auto'; state.analyses = []; renderSegments(); invalidate(); refreshTarget();
      });
      container.appendChild(card);
    });
  }
  function setMaxLength(index) {
    const s = settings(), version = s.version === 'auto' ? (state.size - 17) / 4 : s.version;
    const length = E.maxVariableLength(state.segments, index, { ...s, version });
    state.segments[index].length = length; state.segments[index].start = Math.min(state.segments[index].start || 1, length);
    $('version').value = String(version);
  }
  function imageParameters() {
    for (const id of imageFields) if ($(id).type === 'number' && (!$(id).checkValidity() || !Number.isFinite(number(id)))) throw new Error('画像の変換値を確認してください。');
    return Object.fromEntries(imageFields.map(id => [id, $(id).type === 'checkbox' ? $(id).checked : $(id).type === 'number' ? number(id) : $(id).value]));
  }
  function sourceBits(size) {
    if (!state.source) return new Uint8Array(size * size);
    const p = imageParameters(), canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingEnabled = p['image-smoothing']; ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = `rgb(${p['outside-level']},${p['outside-level']},${p['outside-level']})`; ctx.fillRect(0, 0, size, size);
    const width = state.source.naturalWidth || state.source.width, height = state.source.naturalHeight || state.source.height;
    const sx = width * p['crop-x'] / 100, sy = height * p['crop-y'] / 100, sw = width * Math.min(p['crop-w'], 100 - p['crop-x']) / 100, sh = height * Math.min(p['crop-h'], 100 - p['crop-y']) / 100;
    if (sw <= 0 || sh <= 0) throw new Error('切り出し範囲が画像の外になっています。');
    const safe = p['avoid-corner-patterns'], fit = safe ? 'contain' : p['fit-mode'];
    const zoom = Math.min(p['image-zoom'] / 100, safe ? Math.max(1, size - p['target-safe-inset'] * 2) / size : Infinity);
    let dw = size * zoom, dh = size * zoom;
    if (fit !== 'stretch') { const ratio = fit === 'cover' ? Math.max(size / sw, size / sh) : Math.min(size / sw, size / sh); dw = sw * ratio * zoom; dh = sh * ratio * zoom; }
    const dx = (size - dw) / 2 + (safe ? 0 : p['image-offset-x'] * size / state.size), dy = (size - dh) / 2 + (safe ? 0 : p['image-offset-y'] * size / state.size);
    ctx.drawImage(state.source, sx, sy, sw, sh, dx, dy, dw, dh);
    const rgba = ctx.getImageData(0, 0, size, size).data, bits = new Uint8Array(size * size);
    for (let j = 0; j < bits.length; j++) {
      const r = rgba[j * 4], g = rgba[j * 4 + 1], b = rgba[j * 4 + 2];
      let v = p['gray-method'] === 'average' ? (r + g + b) / 3 : p['gray-method'] === 'max' ? Math.max(r, g, b) : .2126 * r + .7152 * g + .0722 * b;
      v = (v - 128) * p.contrast + 128 + p.brightness;
      bits[j] = Number(v < p.threshold) ^ Number(p['invert-target']);
    }
    return bits;
  }
  function targetAt(size) {
    const bits = sourceBits(size), soft = E.projectField(state.soft, state.size, size);
    for (let j = 0; j < bits.length; j++) if (soft[j] >= 0) bits[j] = soft[j];
    return { size, bits, weights: E.projectField(state.weights, state.size, size), hard: E.projectHard(state.hard, state.size, size) };
  }
  function refreshTarget() {
    try {
      const version = $('version').value === 'auto' ? undefined : Number($('version').value);
      const model = E.makeModel(state.segments, undefined, { encoding: $('encoding').value });
      const q = E.encode(model.baseline, version, $('ecc').value, 0, model);
      const next = q.modules.size;
      if (next !== state.size) {
        // The edit grid is a stable coordinate system. Candidate sizes are projected from it.
        if (!state.hard.some(v => v >= 0) && !state.soft.some(v => v >= 0) && state.weights.every(v => v === 1)) {
          state.size = next; state.hard = new Int8Array(next * next).fill(-1); state.soft = new Int8Array(next * next).fill(-1); state.weights = new Float32Array(next * next).fill(1);
        }
      }
      state.bits = targetAt(state.size).bits;
      $('target-size').textContent = `${state.size} × ${state.size} マス`;
      $('image-status').textContent = state.source ? 'ドラッグで領域を指定できます。赤枠は絶対黒、青枠は絶対白です。' : '画像を選ぶか、白い目標に黒白の領域を指定できます。';
      drawTarget();
    } catch (e) { $('image-status').textContent = e.message; }
  }
  function drawTarget() {
    const canvas = $('paint-canvas'), overlay = $('selection-canvas'), size = state.size, scale = Math.max(3, Math.min(12, Math.floor(640 / size)));
    canvas.width = canvas.height = overlay.width = overlay.height = size * scale; canvas.dataset.scale = scale;
    const ctx = canvas.getContext('2d');
    for (let j = 0; j < size * size; j++) {
      const x = (j % size) * scale, y = Math.floor(j / size) * scale;
      ctx.fillStyle = state.bits?.[j] ? '#000' : '#fff'; ctx.fillRect(x, y, scale, scale);
      if (state.weights[j] !== 1) { ctx.fillStyle = `rgba(34,197,94,${.12 + (1 - state.weights[j]) * .25})`; ctx.fillRect(x, y, scale, scale); }
      if (state.hard[j] >= 0) { ctx.strokeStyle = state.hard[j] ? '#ef4444' : '#3b82f6'; ctx.lineWidth = Math.max(1, scale * .18); ctx.strokeRect(x + .5, y + .5, scale - 1, scale - 1); }
    }
    const absolute = state.hard.reduce((n, v) => n + Number(v >= 0), 0), soft = state.soft.reduce((n, v) => n + Number(v >= 0), 0);
    $('paint-status').textContent = `絶対指定 ${absolute}マス · 黒白の目標編集 ${soft}マス · 重要度の平均 ${(state.weights.reduce((a, b) => a + b, 0) / state.weights.length).toFixed(2)}`;
  }
  function paint(indices) {
    if (state.busy) return;
    const mode = $('brush-mode').value, weight = number('brush-weight');
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) { status('重要度は0〜1で指定してください。', true); return; }
    for (const j of indices) {
      if (mode === 'black') state.hard[j] = 1;
      else if (mode === 'white') state.hard[j] = 0;
      else if (mode === 'clear') state.hard[j] = -1;
      else if (mode === 'erase-soft') state.soft[j] = -1;
      else if (mode === 'weight') state.weights[j] = weight;
      else { state.soft[j] = mode === 'soft-black' ? 1 : 0; state.weights[j] = weight; }
    }
    invalidate(); state.bits = targetAt(state.size).bits; drawTarget();
  }
  function cell(event) {
    const rect = $('paint-canvas').getBoundingClientRect();
    return { r: Math.max(0, Math.min(state.size - 1, Math.floor((event.clientY - rect.top) * state.size / rect.height))), c: Math.max(0, Math.min(state.size - 1, Math.floor((event.clientX - rect.left) * state.size / rect.width))) };
  }
  function region(a, b, shape) {
    const out = [], radius = shape === 'brush' ? Math.max(0, number('brush-radius')) : Math.hypot(b.r - a.r, b.c - a.c);
    for (let r = 0; r < state.size; r++) for (let c = 0; c < state.size; c++) {
      const inside = shape === 'rect' ? r >= Math.min(a.r, b.r) && r <= Math.max(a.r, b.r) && c >= Math.min(a.c, b.c) && c <= Math.max(a.c, b.c) : Math.hypot(r - a.r, c - a.c) <= radius + .01;
      if (inside) out.push(r * state.size + c);
    }
    return out;
  }
  let drag = null;
  $('paint-canvas').addEventListener('pointerdown', event => {
    if (state.busy) return;
    const start = cell(event), shape = $('region-shape').value; drag = { start, end: start, shape };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (shape === 'brush') paint(region(start, start, shape)); event.preventDefault();
  });
  $('paint-canvas').addEventListener('pointermove', event => {
    if (!drag) return; drag.end = cell(event);
    if (drag.shape === 'brush') paint(region(drag.end, drag.end, 'brush'));
    else {
      const canvas = $('selection-canvas'), ctx = canvas.getContext('2d'), scale = Number($('paint-canvas').dataset.scale); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#f59e0b66';
      for (const j of region(drag.start, drag.end, drag.shape)) ctx.fillRect(j % state.size * scale, Math.floor(j / state.size) * scale, scale, scale);
    }
    event.preventDefault();
  });
  $('paint-canvas').addEventListener('pointerup', event => { if (!drag) return; if (drag.shape !== 'brush') paint(region(drag.start, cell(event), drag.shape)); drag = null; $('selection-canvas').getContext('2d').clearRect(0, 0, $('selection-canvas').width, $('selection-canvas').height); });
  $('paint-canvas').addEventListener('pointercancel', () => { drag = null; drawTarget(); });
  function busy(value) {
    state.busy = value;
    if (value) { for (const el of root.querySelectorAll('input, select, textarea, button')) if (el.id !== 'cancel') { state.disabled.set(el, el.disabled); el.disabled = true; } }
    else { for (const [el, disabled] of state.disabled) el.disabled = disabled; state.disabled.clear(); }
    $('cancel').disabled = !value;
  }
  function stopWorker(error) {
    const reject = state.workerReject; state.workerReject = null;
    state.worker?.terminate(); state.worker = null;
    if (state.workerURL) URL.revokeObjectURL(state.workerURL); state.workerURL = null;
    if (error) reject?.(error);
  }
  function runWorker(type, input, progress = () => {}) {
    stopWorker(new DOMException('探索を中断しました。', 'AbortError'));
    const embedded = $('image-qr-worker-source');
    if (embedded) { state.workerURL = URL.createObjectURL(new Blob([JSON.parse(embedded.textContent)], { type: 'text/javascript' })); state.worker = new Worker(state.workerURL); }
    else state.worker = new Worker(root.dataset.workerUrl);
    const id = ++state.request;
    return new Promise((resolve, reject) => {
      state.workerReject = reject;
      state.worker.onmessage = event => {
        if (event.data.id !== id || state.request !== id) return;
        if (event.data.type === 'progress') progress(event.data.progress);
        else if (event.data.type === 'result') { stopWorker(); resolve(event.data.result); }
        else { stopWorker(); reject(new Error(event.data.message)); }
      };
      state.worker.onerror = () => { stopWorker(); reject(new Error('計算処理を開始できませんでした。単一HTML版を保存して開き直すこともできます。')); };
      state.worker.postMessage({ id, type, input });
    });
  }
  function drawResult(canvas, candidate, scale = 5, quiet = 4) {
    const raster = E.renderRGBA(candidate.matrix, candidate.size, scale, quiet); canvas.width = raster.width; canvas.height = raster.height;
    canvas.getContext('2d').putImageData(new ImageData(raster.data, raster.width, raster.height), 0, 0);
    return raster;
  }
  function selectCandidate(index) {
    const c = state.candidates[index]; if (!c) return; state.selected = c;
    drawResult($('result-canvas'), c); $('result-text').value = c.text;
    $('validation-badge').hidden = false; $('export-controls').hidden = false;
    $('result-summary').textContent = `画素一致 ${percent(c.metrics.raw)} · 黒領域の再現 ${percent(c.metrics.blackRecall)} · 背景への黒混入 ${percent(c.metrics.backgroundBlack)} · ${c.size}×${c.size}マス`;
    for (const [i, button] of [...$('candidates').children].entries()) button.setAttribute('aria-pressed', String(i === index));
    const v = c.validation;
    const rows = [['Version / 誤り訂正 / Mask / 向き', `${c.version} / ${c.ecc} / ${c.mask} / ${c.rotation * 90}°`], ['可変部分の長さ', c.lengths.join(' / ') || 'なし'], ['初期求解の自由変数 / 絶対指定のrank', `${c.variables} / ${c.hardRank}`], ['初期求解の構造固定 / 条件固定 / 可変マス', `${c.classification.structural} / ${c.classification.fixed} / ${c.classification.variable}`], ['画素一致（重要度あり）', percent(c.metrics.weighted)], ['全画素の一致', percent(c.metrics.raw)], ['探索スコア（見た目の再現率ではありません）', score(c.metrics.visual)], ['黒領域の再現 / 背景への黒混入', `${percent(c.metrics.blackRecall)} / ${percent(c.metrics.backgroundBlack)}`], ['符号化の組み合わせ', c.modes.join(' + ')], ['QR全体の黒率 / 目標の黒率', `${percent(c.metrics.blackRate)} / ${percent(c.metrics.targetBlackRate)}`], ['固定文字列・許可文字 / 絶対指定', '一致 / 全件達成'], ['独立エンコーダ / 画像のマス再読込', `差分 ${v.encoderDiff} / ${v.moduleReloadDiff} マス`], ['画像から独立復号', '元のバイト列と完全一致'], ['許可文字全体からの改善回数', c.charsetMoves]];
    $('candidate-details').innerHTML = `<table><tbody>${rows.map(([k, value]) => `<tr><th>${escape(k)}</th><td>${escape(value)}</td></tr>`).join('')}</tbody></table><p class="qr-note">RSブロックごとの実測。訂正余力は、誤り位置が未知の場合の理論上の語数です。</p><table><thead><tr><th>ブロック</th><th>誤り語</th><th>非零シンドローム</th><th>訂正余力</th></tr></thead><tbody>${v.blocks.map((b, i) => `<tr><td>${i + 1}</td><td>${b.errors}</td><td>${b.nonzeroSyndromes}</td><td>${b.remaining}</td></tr>`).join('')}</tbody></table>`;
    const a = c.artistic, available = !!a?.validation.ok;
    $('artistic-section').hidden = c.artistic === undefined;
    $('artistic-image').hidden = $('artistic-badge').hidden = $('artistic-export-controls').hidden = !available;
    if (available) {
      drawResult($('artistic-canvas'), a);
      const gain = (100 * (a.metrics.raw - c.metrics.raw)).toFixed(1);
      $('artistic-summary').textContent = `画素一致 ${percent(a.metrics.raw)}（正規版から +${gain}ポイント） · 黒領域の再現 ${percent(a.metrics.blackRecall)} · 背景への黒混入 ${percent(a.metrics.backgroundBlack)}`;
      const checks = a.validation;
      $('artistic-details').innerHTML = `<p class="qr-note">${a.changedModules}マス・${a.changedWords}語を変更。1マス2 / 4 / 8px、白い余白4マスで、すべて元の文字列に復号できました。四隅などの構造と絶対指定は保持しています。</p><table><thead><tr><th>ブロック</th><th>変更した語</th><th>加工の上限</th><th>残る訂正余力</th></tr></thead><tbody>${checks.blocks.map((b, i) => `<tr><td>${i + 1}</td><td>${b.errors}</td><td>${b.budget}</td><td>${b.remaining}</td></tr>`).join('')}</tbody></table>`;
    } else $('artistic-summary').textContent = c.artisticNote || '';
  }
  async function generate() {
    if (state.busy) return;
    let request;
    try {
      for (const input of root.querySelectorAll('input[type=number]')) if (!input.checkValidity() || input.value === '') { input.reportValidity(); throw new Error('入力値を確認してください。'); }
      if (!state.source && !state.soft.some(v => v >= 0) && !state.hard.some(v => v >= 0)) throw new Error('元画像を選ぶか、目標の黒白領域を指定してください。');
      const config = settings(), targets = {};
      const first = config.version === 'auto' ? config.versionMin : config.version, last = config.version === 'auto' ? config.versionMax : config.version;
      for (let version = first; version <= last; version++) { try { targets[version] = targetAt(version * 4 + 17); } catch (e) { targets[version] = { error: e.message }; } }
      const input = { segments: structuredClone(state.segments), settings: config, targets }, revision = state.revision;
      busy(true); status('画像に近いQRコードを探索しています。'); $('export-controls').hidden = true; $('validation-badge').hidden = true; $('artistic-section').hidden = true;
      const task = runWorker('search', input, p => { status(p.message); if (p.candidate) { drawResult($('result-canvas'), p.candidate); $('result-summary').textContent = `探索中 · スコア ${score(p.candidate.metrics.visual)}（最終検証前）`; } });
      request = state.request;
      const result = await task;
      if (revision !== state.revision) return;
      state.candidates = result.candidates; const container = $('candidates'); container.replaceChildren();
      result.candidates.forEach((c, i) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'qr-candidate'; button.setAttribute('aria-pressed', 'false'); const canvas = document.createElement('canvas'); drawResult(canvas, c, 3); const caption = document.createElement('span'); caption.textContent = `候補 ${i + 1} · スコア ${score(c.metrics.visual)} / V${c.version}`; button.append(canvas, caption); button.addEventListener('click', () => selectCandidate(i)); container.appendChild(button); });
      $('candidates-section').hidden = false; selectCandidate(0);
      const s = result.stats; $('search-stats').textContent = `${s.seconds.toFixed(1)}秒 · ${s.attempted}条件を比較 · 絶対指定の解が見つからなかった ${s.infeasible}条件 · 読み取り検証で除外 ${s.rejected}候補${s.timedOut ? ' · 時間の目安に達したため、その時点までの最良候補を表示' : ''}`;
      status(`検証に合格した${result.candidates.length}候補を生成しました。PNG・SVGとして保存できます。${s.failures.length ? '\n探索できなかった条件: ' + s.failures.join(' / ') : ''}`);
    } catch (e) { if (e.name !== 'AbortError') status(e.message || String(e), true); }
    finally { if (request === undefined || request === state.request) busy(false); }
  }
  function download(blob, filename) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
  async function save(kind, artistic = false) {
    const c = artistic ? state.selected?.artistic : state.selected; if (!c?.validation.ok) return;
    try {
      const scale = number('export-scale'), quiet = number('export-quiet');
      if (!$('export-scale').checkValidity() || !$('export-quiet').checkValidity()) throw new Error('保存サイズと余白を確認してください。');
      const canvas = document.createElement('canvas'), raster = drawResult(canvas, c, scale, quiet);
      const actual = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
      const modules = E.reloadModules({ ...raster, data: actual.data }, c.size), decoded = jsQR(actual.data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
      if (modules.some((v, j) => v !== c.matrix[j]) || !decoded || decoded.binaryData.length !== c.bytes.length || decoded.binaryData.some((b, i) => b !== c.bytes[i])) throw new Error('この保存サイズでの読み取り検証に失敗しました。1マスのピクセル数を大きくしてください。');
      const blob = kind === 'svg' ? new Blob([E.svg(c.matrix, c.size, scale, quiet)], { type: 'image/svg+xml' }) : await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('PNGを作成できませんでした。')), 'image/png'));
      download(blob, `image-qr${artistic ? '-artistic' : ''}-v${c.version}-m${c.mask}.${kind}`); status(`${artistic ? '加工版' : '正規版'}${kind.toUpperCase()}を保存しました。読み取り文字列も検証済みです。`);
    } catch (e) { status(e.message, true); }
  }
  $('source-image').addEventListener('change', () => {
    const file = $('source-image').files[0]; if (!file) return;
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { if (state.sourceURL) URL.revokeObjectURL(state.sourceURL); state.source = img; state.sourceURL = url; invalidate(); refreshTarget(); };
    img.onerror = () => { URL.revokeObjectURL(url); status('この画像を読み込めませんでした。PNG・JPEGなどを選んでください。', true); }; img.src = url;
  });
  $('add-fixed').addEventListener('click', () => { state.segments.push({ kind: 'fixed', text: '' }); renderSegments(); invalidate(); refreshTarget(); });
  $('add-variable').addEventListener('click', () => { state.segments.push({ kind: 'variable', length: 32, start: 1, step: 0, refineRadius: 2, allowed: E.URLSAFE, forbidden: '', affineChoice: 'auto' }); renderSegments(); invalidate(); refreshTarget(); });
  $('apply-all').addEventListener('click', () => paint(Array.from({ length: state.size ** 2 }, (_, i) => i)));
  $('clear-absolute').addEventListener('click', () => { state.hard.fill(-1); invalidate(); refreshTarget(); });
  $('clear-soft').addEventListener('click', () => { state.soft.fill(-1); invalidate(); refreshTarget(); });
  $('reset-weights').addEventListener('click', () => { state.weights.fill(1); invalidate(); refreshTarget(); });
  for (const button of root.querySelectorAll('.radius-preset')) button.addEventListener('click', () => { $('brush-radius').value = button.dataset.radius; $('region-shape').value = 'brush'; });
  for (const id of [...imageFields, ...settingFields]) $(id).addEventListener('change', () => { if (id === 'encoding') { state.analyses = []; state.segments.forEach(s => { s.affineChoice = 'auto'; }); renderSegments(); } invalidate(); refreshTarget(); });
  $('prepare-numeric').addEventListener('click', () => {
    try {
      const eligible = state.segments.map((s, i) => s.kind === 'variable' && Array.from({ length: 10 }, (_, n) => 48 + n).every(b => E.allowedBytes(s).includes(b)) ? i : -1).filter(i => i >= 0);
      if (!eligible.length) throw new Error('数字0〜9をすべて許可した可変部分が必要です。');
      const index = eligible[eligible.length - 1], s = settings(), version = s.version === 'auto' ? (state.size - 17) / 4 : s.version;
      const length = E.maxVariableLength(state.segments, index, { ...s, version, encoding: 'numeric' });
      $('encoding').value = 'numeric'; $('version').value = String(version);
      state.segments[index].length = length; state.segments[index].start = Math.min(state.segments[index].start || 1, length);
      state.analyses = []; state.segments.forEach(s => { s.affineChoice = 'auto'; }); renderSegments(); invalidate(); refreshTarget();
      status(`Version ${version}・誤り訂正${s.ecc}のまま、部分${index + 1}を数字${length}桁に設定しました。固定文字列と領域指定は保持しています。`);
    } catch (e) { status(e.message, true); }
  });
  $('generate').addEventListener('click', generate);
  $('cancel').addEventListener('click', () => { stopWorker(new DOMException('探索を中断しました。', 'AbortError')); state.request++; state.revision++; busy(false); $('export-controls').hidden = true; $('validation-badge').hidden = true; $('artistic-section').hidden = true; status('探索を中断しました。画像・文字列・領域指定は保持されています。'); });
  $('analyze-charsets').addEventListener('click', async () => {
    if (state.busy) return; busy(true);
    let request;
    try { const task = runWorker('analyze', { segments: structuredClone(state.segments), settings: settings() }); request = state.request; const analyses = await task; state.analyses = analyses; $('charset-status').textContent = analyses.map(a => a.encoding === 'numeric' ? `部分${a.segment + 1}: 数字用 / 初期自由度${a.totalBits}bit` : `部分${a.segment + 1}: Byte / 許可${a.allowed}文字 / 初期集合${a.selected}文字 / ${a.dimension}bit/文字`).join('\n') || '固定文字列のみです。'; }
    catch (e) { if (e.name !== 'AbortError') $('charset-status').textContent = e.message; }
    finally { if (request === undefined || request === state.request) { busy(false); renderSegments(); } }
  });
  $('save-png').addEventListener('click', () => save('png')); $('save-svg').addEventListener('click', () => save('svg'));
  $('save-artistic-png').addEventListener('click', () => save('png', true)); $('save-artistic-svg').addEventListener('click', () => save('svg', true));
  $('copy-text').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('result-text').value); status('文字列をコピーしました。'); } catch { $('result-text').focus(); $('result-text').select(); if (document.execCommand('copy')) status('文字列をコピーしました。'); else status('文字列を選択しました。コピー操作で保存できます。'); } });
  for (let v = 1; v <= 40; v++) { const option = document.createElement('option'); option.value = v; option.textContent = `${v}（${v * 4 + 17}×${v * 4 + 17}）`; $('version').appendChild(option); }
  for (let m = 0; m < 8; m++) { const option = document.createElement('option'); option.value = m; option.textContent = String(m); $('mask').appendChild(option); }
  if ($('image-qr-worker-source')) $('download-standalone').href = location.href;
  renderSegments(); refreshTarget();
  const ctx = $('result-canvas').getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 420, 420);
  // Explicit data boundary for regression tests and in-page integrations; no prototype hooks or canvas read-back state.
  window.ImageQrApp = { snapshot: () => ({ segments: structuredClone(state.segments), size: state.size, weights: state.weights.slice(), hard: state.hard.slice(), soft: state.soft.slice(), revision: state.revision }), targetAt, generate, refreshTarget };
})();
