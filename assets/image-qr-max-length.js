(() => {
  'use strict';

  const segmentsRoot = document.getElementById('segments');
  const versionSelect = document.getElementById('version');
  const eccSelect = document.getElementById('ecc');
  const maskSelect = document.getElementById('mask');
  if (!segmentsRoot || !versionSelect || !eccSelect || !maskSelect || typeof QRCode === 'undefined') return;

  // QR Code Model 2 / Byte mode / Version 40-L の規格上の最大データ容量。
  // 実際の現在条件での最大長は下の QRCode.create() による可否判定で求める。
  const SPEC_MAX_BYTE_PAYLOAD = 2953;
  const encoder = new TextEncoder();

  function segmentCards() {
    return [...segmentsRoot.querySelectorAll(':scope > .segment')].filter(card => {
      const type = card.querySelector('select');
      return type && (type.value === 'fixed' || type.value === 'variable');
    });
  }

  function variableInfo(card, index) {
    const lengthInput = card.querySelector('input[type="number"]');
    const allowedText = card.querySelector('textarea')?.value || '';
    const forbiddenText = card.querySelector('input[type="text"]')?.value || '';
    const forbidden = new Set(Array.from(forbiddenText));
    let sample = null;
    for (const ch of Array.from(allowedText)) {
      if (forbidden.has(ch)) continue;
      if (encoder.encode(ch).length === 1) { sample = ch; break; }
    }
    if (!lengthInput) throw new Error(`可変セグメント ${index + 1}: 長さ入力が見つかりません。`);
    if (sample == null) throw new Error(`可変セグメント ${index + 1}: 禁止文字適用後に使用可能な1-byte ASCII文字がありません。`);
    return { lengthInput, sample };
  }

  function buildPayload(targetInput, targetLength) {
    let payload = '';
    const cards = segmentCards();
    cards.forEach((card, index) => {
      const type = card.querySelector('select')?.value;
      if (type === 'fixed') {
        payload += card.querySelector('textarea')?.value || '';
        return;
      }
      const info = variableInfo(card, index);
      const length = info.lengthInput === targetInput
        ? targetLength
        : Math.max(1, Math.floor(Number(info.lengthInput.value) || 1));
      payload += info.sample.repeat(length);
    });
    return payload;
  }

  function qrOptions() {
    const opts = { errorCorrectionLevel: eccSelect.value };
    if (versionSelect.value !== 'auto') opts.version = Number(versionSelect.value);
    if (maskSelect.value !== 'auto') opts.maskPattern = Number(maskSelect.value);
    return opts;
  }

  function fits(targetInput, length) {
    try {
      const payload = buildPayload(targetInput, length);
      QRCode.create([{ data: payload, mode: 'byte' }], qrOptions());
      return true;
    } catch (_) {
      return false;
    }
  }

  function findMaximum(targetInput) {
    if (!fits(targetInput, 1)) return 0;
    let lo = 1;
    let hi = SPEC_MAX_BYTE_PAYLOAD;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (fits(targetInput, mid)) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  function describeBasis() {
    const v = versionSelect.value === 'auto' ? 'Version Auto（最大Version 40まで）' : `Version ${versionSelect.value}`;
    return `${v} / ECC ${eccSelect.value} / Byte Mode`;
  }

  function decorate() {
    const cards = segmentCards();
    cards.forEach((card, index) => {
      const type = card.querySelector('select');
      if (!type || type.value !== 'variable') return;
      const lengthInput = card.querySelector('input[type="number"]');
      if (!lengthInput || lengthInput.dataset.maxLengthButtonAttached) return;
      lengthInput.dataset.maxLengthButtonAttached = '1';

      const row = document.createElement('div');
      row.className = 'toolbar';
      row.style.marginTop = '7px';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary';
      button.textContent = 'この要素を最大長にする';

      const result = document.createElement('span');
      result.className = 'tiny';
      result.textContent = '他のセグメントの現在長とQR条件を固定して計算します。';

      button.addEventListener('click', () => {
        button.disabled = true;
        result.textContent = '実QRエンコーダで最大長を計算中…';
        try {
          const maximum = findMaximum(lengthInput);
          if (maximum < 1) {
            result.textContent = `現在条件（${describeBasis()}）では、この可変部を1文字以上確保できません。`;
            return;
          }
          lengthInput.value = String(maximum);
          lengthInput.dispatchEvent(new Event('input', { bubbles: true }));
          lengthInput.dispatchEvent(new Event('change', { bubbles: true }));
          result.textContent = `最大 ${maximum} 文字。${describeBasis()}、他の可変部は現在の長さで固定して実測しました。`;
        } catch (e) {
          result.textContent = e?.message || String(e);
        } finally {
          button.disabled = false;
        }
      });

      row.append(button, result);
      const note = lengthInput.parentElement?.querySelector('.tiny');
      if (note) note.insertAdjacentElement('afterend', row);
      else lengthInput.insertAdjacentElement('afterend', row);
    });
  }

  const observer = new MutationObserver(decorate);
  observer.observe(segmentsRoot, { childList: true, subtree: true });
  segmentsRoot.addEventListener('change', decorate, true);
  decorate();
})();
