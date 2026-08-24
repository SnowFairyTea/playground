(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const matrix = $('matrix');
  const paint = $('paint-canvas');
  const hook = window.__imageQrUiHook;
  const paintDown = hook?.listeners?.['paint-canvas']?.pointerdown?.[0];
  const paintUp = hook?.listeners?.['paint-canvas']?.pointerup?.[0];
  if (!matrix || !paint || !paintDown || !paintUp) return;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function weightAt(r, c, scale) {
    const ctx = paint.getContext('2d', { willReadFrequently: true });
    const x = Math.min(paint.width - 1, c * scale + Math.floor(scale / 2));
    const y = Math.min(paint.height - 1, r * scale + Math.floor(scale / 2));
    const d = ctx.getImageData(x, y, 1, 1).data;
    const alpha = d[1] < 150 ? d[1] / 197 : (255 - d[0]) / 221;
    return Math.round(clamp((alpha - 0.08) / 0.34, 0, 1) * 20) / 20;
  }

  matrix.addEventListener('click', event => {
    const mScale = Number(matrix.dataset.scale);
    const pScale = Number(paint.dataset.scale);
    if (!mScale || !pScale || !paint.width) return;
    const rect = matrix.getBoundingClientRect();
    const px = (event.clientX - rect.left) * matrix.width / rect.width;
    const py = (event.clientY - rect.top) * matrix.height / rect.height;
    const c = Math.floor(px / mScale), r = Math.floor(py / mScale);
    const size = Math.round(paint.width / pScale);
    if (r < 0 || c < 0 || r >= size || c >= size) return;

    const mode = $('brush-mode'), brushWeight = $('brush-weight'), radius = $('brush-radius');
    if (!mode || !brushWeight || !radius) return;
    const saved = { mode: mode.value, weight: brushWeight.value, radius: radius.value };
    const pRect = paint.getBoundingClientRect();
    const clientX = pRect.left + (c + 0.5) * pScale * pRect.width / paint.width;
    const clientY = pRect.top + (r + 0.5) * pScale * pRect.height / paint.height;
    try {
      mode.value = 'weight';
      radius.value = '0';
      brushWeight.value = String(weightAt(r, c, pScale));
      paintDown({ currentTarget: { setPointerCapture() {} }, pointerId: 1, clientX, clientY });
      paintUp({});
    } finally {
      mode.value = saved.mode;
      brushWeight.value = saved.weight;
      radius.value = saved.radius;
    }
  });
})();
