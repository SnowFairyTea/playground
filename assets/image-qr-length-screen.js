(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const segmentsRoot = $('segments'), analyze = $('analyze-charsets'), build = $('build-problem'), optimize = $('optimize-image');
  const targetCanvas = $('target-canvas'), paintCanvas = $('paint-canvas'), phase2Root = $('phase2-candidates');
  const aggregateCard = $('auto-length-candidate-card'), aggregateRoot = $('auto-length-candidates'), status = $('auto-length-status');
  const controls = $('auto-variable-lengths')?.closest('.segment');
  if (!segmentsRoot || !analyze || !build || !optimize || !phase2Root || !aggregateCard || !aggregateRoot || !status || !controls || typeof QRCode === 'undefined') return;

  const original = { analyze: analyze.onclick, build: build.onclick, optimize: optimize.onclick };
  if (![original.analyze, original.build, original.optimize].every(fn => typeof fn === 'function')) return;

  const encoder = new TextEncoder();
  let screeningSnapshot = null, finalizing = false;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const tick = () => new Promise(r => setTimeout(r, 0));
  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const extra = document.createElement('div');
  extra.className = 'grid-3';
  extra.style.marginTop = '10px';
  extra.innerHTML = `
    <div>
      <label for="auto-length-light-samples">軽量代表QR / 長さ</label>
      <input id="auto-length-light-samples" type="number" min="1" step="1" value="3">
      <div class="tiny">粗・細探索ではDiを作らず、この件数だけ代表ペイロードをQR化して近似評価します。</div>
    </div>
    <div>
      <label for="auto-length-full-top">最後にフル求解する上位長さ</label>
      <input id="auto-length-full-top" type="number" min="1" step="1" value="5">
      <div class="tiny">重い M0 / Di + GF(2) は探索全体の上位この件数だけ。暫定既定5。</div>
    </div>
    <div>
      <label>粗探索の処理</label>
      <div class="pill">軽量スクリーニング</div>
      <div class="tiny">最終候補として表示するものは、必ずフル求解を通します。</div>
    </div>`;
  const stepHeading = [...controls.querySelectorAll('h3')].find(h => h.textContent.includes('Step設定'));
  if (stepHeading) stepHeading.insertAdjacentElement('afterend', extra); else controls.appendChild(extra);

  const sampleInput = $('auto-length-light-samples'), fullTopInput = $('auto-length-full-top');

  function isScreeningCall() {
    const t = status.textContent.trim();
    return /^(粗探索|細探索)/.test(t) && !finalizing;
  }

  function cards() {
    return [...segmentsRoot.querySelectorAll(':scope > .segment')].filter(card => {
      const type = card.querySelector('select')?.value;
      return type === 'fixed' || type === 'variable';
    });
  }
  function variableCards() { return cards().filter(c => c.querySelector('select')?.value === 'variable'); }
  function lengthsNow() { return variableCards().map(c => Math.max(1, Math.floor(Number(c.querySelector('input[type="number"]')?.value) || 1))); }

  function charsFor(card, index) {
    const allowed = Array.from(card.querySelector('textarea')?.value || '');
    const forbidden = new Set(Array.from(card.querySelector('input[type="text"]')?.value || ''));
    const out = [], seen = new Set();
    for (const ch of allowed) {
      if (seen.has(ch) || forbidden.has(ch)) continue;
      seen.add(ch);
      if (encoder.encode(ch).length === 1) out.push(ch);
    }
    if (!out.length) throw new Error(`可変部 ${index + 1}: 使用可能な1-byte ASCII文字がありません。`);
    return out;
  }

  function descriptors() {
    const out = []; let vi = 0;
    for (const card of cards()) {
      const type = card.querySelector('select')?.value;
      if (type === 'fixed') out.push({ kind: 'fixed', text: card.querySelector('textarea')?.value || '' });
      else {
        const chars = charsFor(card, vi);
        out.push({ kind: 'variable', index: vi++, chars, bitUpper: Math.floor(Math.log2(chars.length)) });
      }
    }
    return out;
  }

  function canvasSnapshot(canvas, targetMode) {
    if (!canvas?.width) return null;
    const scale = Number(canvas.dataset.scale); if (!scale) return null;
    const size = Math.round(canvas.width / scale), ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    if (targetMode) {
      const bits = new Uint8Array(size * size);
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
        const x = Math.min(canvas.width - 1, c * scale + Math.floor(scale / 2));
        const y = Math.min(canvas.height - 1, r * scale + Math.floor(scale / 2));
        const i = (y * canvas.width + x) * 4;
        bits[r * size + c] = (img[i] + img[i + 1] + img[i + 2]) / 3 < 128 ? 1 : 0;
      }
      return { size, bits };
    }
    const weights = new Float32Array(size * size);
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      const x = Math.min(canvas.width - 1, c * scale + Math.floor(scale / 2));
      const y = Math.min(canvas.height - 1, r * scale + Math.floor(scale / 2));
      const i = (y * canvas.width + x) * 4, red = img[i], green = img[i + 1];
      const alpha = green < 150 ? green / 197 : (255 - red) / 221;
      weights[r * size + c] = Math.round(clamp((alpha - 0.08) / 0.34, 0, 1) * 20) / 20;
    }
    return { size, weights };
  }

  function ensureSnapshot() {
    if (!screeningSnapshot) screeningSnapshot = {
      target: canvasSnapshot(targetCanvas, true),
      paint: canvasSnapshot(paintCanvas, false),
      desc: descriptors()
    };
    return screeningSnapshot;
  }
  const ri = (source, target, p) => clamp(Math.floor((p + 0.5) * source / target), 0, source - 1);

  function payload(desc, lengths, sample) {
    let text = '', seed = (0x811c9dc5 ^ (sample + 1)) >>> 0;
    for (const v of lengths) { seed ^= v; seed = Math.imul(seed, 0x01000193) >>> 0; }
    for (const d of desc) {
      if (d.kind === 'fixed') { text += d.text; continue; }
      const n = lengths[d.index];
      for (let p = 0; p < n; p++) {
        const x = (seed + Math.imul(p + 1, 2654435761) + Math.imul(d.index + 3, 2246822519)) >>> 0;
        text += d.chars[x % d.chars.length];
      }
    }
    return text;
  }

  function qrOptions() {
    const opts = { errorCorrectionLevel: $('ecc')?.value || 'M' };
    if ($('version')?.value !== 'auto') opts.version = Number($('version').value);
    if ($('mask')?.value !== 'auto') opts.maskPattern = Number($('mask').value);
    return opts;
  }

  function match(symbol, snap) {
    if (!snap.target) return 0.5;
    const size = symbol.modules.size, data = symbol.modules.data, reserved = symbol.modules.reservedBit;
    let hit = 0, total = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      const j = r * size + c; if (reserved?.[j]) continue;
      const tr = ri(snap.target.size, size, r), tc = ri(snap.target.size, size, c);
      const target = snap.target.bits[tr * snap.target.size + tc];
      let w = 1;
      if (snap.paint) {
        const wr = ri(snap.paint.size, size, r), wc = ri(snap.paint.size, size, c);
        w = snap.paint.weights[wr * snap.paint.size + wc];
      }
      if (w <= 0) continue;
      total += w; if ((data[j] ? 1 : 0) === target) hit += w;
    }
    return total ? hit / total : 0.5;
  }

  function lightScore() {
    const snap = ensureSnapshot(), lengths = lengthsNow(), samples = Math.max(1, Math.floor(Number(sampleInput.value) || 3));
    let best = -Infinity, first = null;
    for (let s = 0; s < samples; s++) {
      const symbol = QRCode.create([{ data: payload(snap.desc, lengths, s), mode: 'byte' }], qrOptions());
      first ||= symbol; best = Math.max(best, match(symbol, snap));
    }
    let usable = 0;
    const reserved = first.modules.reservedBit;
    if (reserved) for (let i = 0; i < reserved.length; i++) if (!reserved[i]) usable++;
    else usable = first.modules.data.length;
    let freeUpper = 0;
    for (const d of snap.desc) if (d.kind === 'variable') freeUpper += lengths[d.index] * d.bitUpper;
    const density = clamp(freeUpper / Math.max(1, usable), 0, 1);
    const score = clamp(best + 0.5 * density, 0, 1);
    return { score, match: best, density, lengths, version: first.version };
  }

  function okStatus(id, text) { const el = $(id); if (el) { el.className = 'status ok'; el.textContent = text; } }
  analyze.onclick = async function() {
    if (!isScreeningCall()) return original.analyze.call(analyze);
    try { ensureSnapshot(); okStatus('charset-status', '軽量探索: 文字集合の厳密アフィン解析はフル求解候補まで延期します。'); build.disabled = false; }
    catch (e) { const el = $('charset-status'); if (el) { el.className = 'status error'; el.textContent = e.message || String(e); } }
  };
  build.onclick = async function() {
    if (!isScreeningCall()) return original.build.call(build);
    okStatus('problem-status', '軽量探索: M0 / Di は構築していません。代表QRだけで長さ候補を順位付けします。');
  };
  optimize.onclick = async function() {
    if (!isScreeningCall()) return original.optimize.call(optimize);
    try {
      const s = lightScore();
      phase2Root.innerHTML = `<div class="candidate"><strong>軽量候補</strong><table class="summary-table" style="margin-top:8px">
        <tr><th>目標一致率</th><td>${(s.match * 100).toFixed(2)}%</td></tr>
        <tr><th>重要度付き一致スコア</th><td>${(s.score * 100).toFixed(2)}%</td></tr>
        <tr><th>軽量自由度密度</th><td>${(s.density * 100).toFixed(1)}%</td></tr>
        <tr><th>軽量評価Version</th><td>${s.version}</td></tr>
        <tr><th>方式</th><td>代表QR + 自由bit上限のヒューリスティック。Di/GF(2)未実行。</td></tr>
      </table></div>`;
      okStatus('optimize-status', `軽量スクリーニング完了: ${(s.score * 100).toFixed(2)}%。Diは未構築です。`);
    } catch (e) {
      const el = $('optimize-status'); if (el) { el.className = 'status error'; el.textContent = e.message || String(e); }
      phase2Root.innerHTML = '';
    }
  };

  function tableValue(card, key) {
    for (const tr of card.querySelectorAll('tr')) if (tr.querySelector('th')?.textContent.trim() === key) return tr.querySelector('td')?.textContent.trim() || '';
    return '';
  }
  function selectedLengths() {
    const limit = Math.max(1, Math.floor(Number(fullTopInput.value) || 5)), out = [], seen = new Set();
    for (const card of aggregateRoot.querySelectorAll('.candidate')) {
      const raw = tableValue(card, '可変部分の長さ'); if (!raw) continue;
      const lengths = raw.split('/').map(x => Math.max(1, Math.floor(Number(x.trim()) || 1)));
      const key = lengths.join(','); if (seen.has(key)) continue;
      seen.add(key); out.push({ lengths, light: parseFloat(tableValue(card, '重要度付き一致スコア')) || 0 });
      if (out.length >= limit) break;
    }
    return out;
  }
  function lengthInputs() { return variableCards().map(c => c.querySelector('input[type="number"]')); }
  function setLengths(inputs, lengths) { inputs.forEach((input, i) => { input.value = String(lengths[i]); input.dispatchEvent(new Event('input', { bubbles: true })); }); }

  function cloneActual(lengths, light) {
    const items = [];
    for (const card of phase2Root.querySelectorAll('.candidate')) {
      const weighted = parseFloat(tableValue(card, '重要度付き一致スコア')) || 0;
      const raw = parseFloat(tableValue(card, '目標一致率')) || 0;
      const clone = card.cloneNode(true), canvas = card.querySelector('canvas'), clonedCanvas = clone.querySelector('canvas');
      if (canvas && clonedCanvas) {
        const img = document.createElement('img'); img.src = canvas.toDataURL('image/png'); img.alt = 'QR候補';
        img.style.cssText = 'width:210px;height:210px;image-rendering:pixelated;border:1px solid var(--border)'; clonedCanvas.replaceWith(img);
      }
      const table = clone.querySelector('.summary-table');
      if (table) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<th>可変部分の長さ</th><td>${escapeHtml(lengths.join(' / '))}</td>`; table.insertBefore(tr, table.firstChild);
        const tr2 = document.createElement('tr');
        tr2.innerHTML = `<th>軽量順位時スコア</th><td>${light.toFixed(2)}%</td>`; table.insertBefore(tr2, table.firstChild);
      }
      items.push({ weighted, raw, node: clone });
    }
    return items;
  }

  async function finalizeHeavy() {
    if (finalizing || status.textContent.trim().startsWith('中断。')) return;
    const picks = selectedLengths(); if (!picks.length) return;
    finalizing = true;
    const inputs = lengthInputs(), originalLengths = inputs.map(i => Math.max(1, Math.floor(Number(i.value) || 1))), actual = [];
    try {
      for (let i = 0; i < picks.length; i++) {
        const p = picks[i];
        status.className = 'status';
        status.textContent = `軽量上位をフル求解 ${i + 1}/${picks.length}: ${p.lengths.join(' / ')}\nM0 / Di を実エンコーダから構築してGF(2)最適化しています。`;
        setLengths(inputs, p.lengths);
        await original.analyze.call(analyze); if ($('charset-status')?.classList.contains('error')) continue;
        await original.build.call(build); if ($('problem-status')?.classList.contains('error')) continue;
        await original.optimize.call(optimize); if ($('optimize-status')?.classList.contains('error')) continue;
        actual.push(...cloneActual(p.lengths, p.light)); await tick();
      }
      actual.sort((a, b) => b.weighted - a.weighted || b.raw - a.raw);
      const display = Math.max(1, Math.floor(Number($('phase2-candidate-count')?.value) || 12));
      aggregateRoot.innerHTML = '';
      actual.slice(0, display).forEach((x, i) => { const strong = x.node.querySelector('strong'); if (strong) strong.textContent = `総合候補 ${i + 1}`; aggregateRoot.appendChild(x.node); });
      aggregateCard.style.display = 'block';
      status.className = actual.length ? 'status ok' : 'status error';
      status.textContent = actual.length
        ? `完了。広い長さ範囲は軽量評価のみ、上位 ${picks.length} 長さだけフル求解しました。フル候補 ${actual.length} 件から上位 ${Math.min(display, actual.length)} 件を表示しています。`
        : `完了。軽量上位 ${picks.length} 長さをフル求解しましたが、有効候補を生成できませんでした。`;
    } finally {
      setLengths(inputs, originalLengths); screeningSnapshot = null; finalizing = false;
    }
  }

  const observer = new MutationObserver(() => {
    const text = status.textContent.trim();
    if (/^完了。/.test(text) && !finalizing && aggregateRoot.querySelector('.candidate')) queueMicrotask(() => finalizeHeavy().catch(e => {
      finalizing = false; status.className = 'status error'; status.textContent = `フル求解段階で例外: ${e?.message || String(e)}`;
    }));
    if (/^(中断。|可変長探索で例外)/.test(text)) screeningSnapshot = null;
  });
  observer.observe(status, { childList: true, characterData: true, subtree: true });
})();
