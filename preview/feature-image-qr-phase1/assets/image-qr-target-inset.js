(() => {
  'use strict';

  const zoom = document.getElementById('image-zoom');
  const fit = document.getElementById('fit-mode');
  const offsetX = document.getElementById('image-offset-x');
  const offsetY = document.getElementById('image-offset-y');
  const matrix = document.getElementById('matrix');
  const imageCard = document.getElementById('image-card');
  if (!zoom || !fit || !offsetX || !offsetY || !matrix || !imageCard) return;

  const zoomWrap = zoom.parentElement;
  const settingsGrid = zoomWrap && zoomWrap.parentElement;
  if (!settingsGrid) return;

  const insetWrap = document.createElement('div');
  insetWrap.innerHTML = `
    <label for="target-safe-inset">四隅からの内側余白 (modules)</label>
    <input id="target-safe-inset" type="number" min="0" step="1" value="9">
  `;

  const avoidWrap = document.createElement('div');
  avoidWrap.innerHTML = `
    <label style="display:flex;align-items:center;gap:8px;margin-top:26px">
      <input id="avoid-corner-patterns" type="checkbox" style="width:auto" checked>
      四隅のQR構造を避ける
    </label>
  `;

  const help = document.createElement('div');
  help.className = 'tiny';
  help.style.gridColumn = '1 / -1';

  zoomWrap.insertAdjacentElement('afterend', insetWrap);
  insetWrap.insertAdjacentElement('afterend', avoidWrap);
  settingsGrid.appendChild(help);

  const inset = document.getElementById('target-safe-inset');
  const avoid = document.getElementById('avoid-corner-patterns');
  let applying = false;

  function qrSize() {
    const scale = Number(matrix.dataset.scale);
    if (!Number.isFinite(scale) || scale <= 0 || !matrix.width) return null;
    return Math.round(matrix.width / scale);
  }

  function safeZoomLimit() {
    const size = qrSize();
    if (!size) return null;
    const margin = Math.max(0, Number(inset.value) || 0);
    const inner = Math.max(1, size - margin * 2);
    return Math.max(1, Math.min(100, inner / size * 100));
  }

  function syncOffsetState() {
    const locked = avoid.checked;
    offsetX.disabled = locked;
    offsetY.disabled = locked;
    if (locked) {
      offsetX.value = '0';
      offsetY.value = '0';
    }
  }

  function updateHelp(limit = safeZoomLimit()) {
    const size = qrSize();
    if (!avoid.checked) {
      help.textContent = '四隅回避はOFFです。Zoom / Fit / X・Y位置をそのまま使用します。';
      return;
    }
    if (!size || limit == null) {
      help.textContent = 'QR写像の構築後、QRサイズに合わせて目標画像を中央へ縮小します。既定9 modulesは実装上の開始値で、UIから変更できます。';
      return;
    }
    const margin = Math.max(0, Number(inset.value) || 0);
    const inner = Math.max(1, size - margin * 2);
    help.textContent = `QR ${size}×${size}: 目標画像を中央 ${inner}×${inner} modules 以内に収めます（最大Zoom ${limit.toFixed(1)}%）。四隅回避ON中は中央固定です。`;
  }

  function applySafeInset(resetToLimit = false) {
    syncOffsetState();
    if (applying || !avoid.checked) {
      updateHelp();
      return;
    }
    const limit = safeZoomLimit();
    if (limit == null) {
      updateHelp();
      return;
    }

    applying = true;
    try {
      // Cover は縦横比によって一辺が安全領域を越えるため、回避ON時は Contain に固定する。
      if (fit.value !== 'contain') {
        fit.value = 'contain';
        fit.dispatchEvent(new Event('change', { bubbles: true }));
      }

      if (offsetX.value !== '0' || offsetY.value !== '0') {
        offsetX.value = '0';
        offsetY.value = '0';
        offsetX.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const current = Math.max(1, Number(zoom.value) || 100);
      const next = resetToLimit ? limit : Math.min(current, limit);
      if (Math.abs(current - next) > 0.05) {
        zoom.value = next.toFixed(1);
        zoom.dispatchEvent(new Event('change', { bubbles: true }));
      }
      updateHelp(limit);
    } finally {
      applying = false;
    }
  }

  inset.addEventListener('change', () => applySafeInset(true));
  avoid.addEventListener('change', () => {
    syncOffsetState();
    if (avoid.checked) applySafeInset(true);
    else updateHelp();
  });
  zoom.addEventListener('change', () => applySafeInset(false));
  fit.addEventListener('change', () => applySafeInset(false));
  offsetX.addEventListener('change', () => applySafeInset(false));
  offsetY.addEventListener('change', () => applySafeInset(false));

  // QR写像の再構築で matrix のサイズが変わった場合も、そのVersionに合わせて再計算する。
  const observer = new MutationObserver(() => applySafeInset(true));
  observer.observe(matrix, {
    attributes: true,
    attributeFilter: ['width', 'height', 'data-scale']
  });

  // 初期状態から安全側にする。QRサイズ確定後にObserverがZoomを決める。
  fit.value = 'contain';
  syncOffsetState();
  updateHelp();
})();
