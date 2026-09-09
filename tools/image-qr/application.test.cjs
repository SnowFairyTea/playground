const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const E = require('../../assets/image-qr-engine.js');
const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'apps/image-qr-optimizer/image-qr-optimizer.html'), 'utf8');

// These are data-flow regression tests, not a browser or visual-quality test.
function application() {
  const errors = [], requests = [];
  const virtualConsole = new VirtualConsole(); virtualConsole.on('jsdomError', e => errors.push(e));
  const dom = new JSDOM(html, {
    url: 'file:///offline/image-qr-optimizer.html', runScripts: 'dangerously', virtualConsole,
    beforeParse(w) {
      w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder; w.structuredClone = structuredClone;
      w.ImageData = class { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } };
      w.URL.createObjectURL = () => 'blob:unit-test'; w.URL.revokeObjectURL = () => {};
      w.Worker = class {
        constructor() { this.terminated = false; }
        terminate() { this.terminated = true; }
        postMessage(message) {
          requests.push(structuredClone(message));
          setImmediate(async () => {
            if (this.terminated) return;
            try {
              const result = message.type === 'analyze' ? E.makeModel(message.input.segments).analyses : await E.search(message.input);
              if (!this.terminated) this.onmessage?.({ data: { id: message.id, type: 'result', result } });
            } catch (e) { if (!this.terminated) this.onmessage?.({ data: { id: message.id, type: 'error', message: e.message } }); }
          });
        }
      };
      w.HTMLCanvasElement.prototype.setPointerCapture = () => {};
      w.HTMLCanvasElement.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, width: 490, height: 490, right: 490, bottom: 490 }; };
      w.HTMLCanvasElement.prototype.getContext = function () {
        if (this._context) return this._context;
        const canvas = this;
        return this._context = {
          fillStyle: '#fff', strokeStyle: '#000', lineWidth: 1,
          fillRect() {}, strokeRect() {}, clearRect() {}, drawImage() {},
          getImageData(x, y, width, height) { return { data: canvas._data || new Uint8ClampedArray(width * height * 4).fill(255), width, height }; },
          putImageData(image) { canvas._data = image.data.slice(); }
        };
      };
    }
  });
  const w = dom.window, d = w.document;
  function set(id, value) { const el = d.getElementById(id); if (el.type === 'checkbox') el.checked = value; else el.value = String(value); el.dispatchEvent(new w.Event(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', { bubbles: true })); }
  return { dom, w, d, errors, requests, set };
}
test('standalone contains every runtime dependency and no live network imports', () => {
  assert(!/<script[^>]+src=|<link[^>]+href=|\{%|\{\{/.test(html));
  const parsed = new JSDOM(html), code = JSON.parse(parsed.window.document.getElementById('image-qr-worker-source').textContent);
  assert(!/^importScripts\(/m.test(code)); assert.doesNotThrow(() => new vm.Script(code));
  parsed.window.close();
});
test('the embedded worker really runs independently with no imported files', async () => {
  const parsed = new JSDOM(html), code = JSON.parse(parsed.window.document.getElementById('image-qr-worker-source').textContent); parsed.window.close();
  const messages = [], context = vm.createContext({ TextEncoder, TextDecoder, performance, setTimeout, clearTimeout, postMessage: m => messages.push(m) }); context.self = context;
  new vm.Script(code).runInContext(context);
  const seg = [{ kind: 'fixed', text: 'https://example.com/#' }, { kind: 'variable', length: 1, allowed: '0123456789' }];
  const model = E.makeModel(seg), bytes = model.baseline.slice(); bytes[bytes.length - 1] = 56;
  const symbol = E.encode(bytes, 3, 'M', 0);
  await context.onmessage({ data: { id: 5, type: 'search', input: { segments: seg, target: { size: 29, bits: Uint8Array.from(symbol.modules.data) }, settings: { version: 3, masks: 0, seconds: 2, candidates: 1 } } } });
  const result = messages.find(m => m.type === 'result'); assert(result, JSON.stringify(messages)); assert.equal(result.result.candidates[0].text, 'https://example.com/#8'); assert(result.result.candidates[0].validation.ok);
});
test('UI initializes offline and retains exact painted weights and hard constraints through length/Version search', async () => {
  const app = application(), { w, d, set } = app;
  assert(w.ImageQrApp); assert.deepEqual(app.errors, []);
  set('segment-0-text', 'https://example.com/#'); set('segment-1-length', 6); set('segment-1-start', 1); set('segment-1-step', 2);
  set('brush-mode', 'soft-black'); d.getElementById('apply-all').click();
  set('brush-mode', 'weight'); set('brush-weight', .15); d.getElementById('apply-all').click();
  set('brush-mode', 'black'); set('region-shape', 'brush'); set('brush-radius', 0);
  d.getElementById('paint-canvas').dispatchEvent(new w.MouseEvent('pointerdown', { clientX: 1, clientY: 1, bubbles: true }));
  d.getElementById('paint-canvas').dispatchEvent(new w.MouseEvent('pointerup', { clientX: 1, clientY: 1, bubbles: true }));
  set('auto-length', true); set('compare-versions', true); set('version-min', 3); set('version-max', 4); set('length-trials', 3); set('soft-passes', 1); set('reserve-free', 3); set('null-samples', 8); set('search-seconds', 3);
  const before = w.ImageQrApp.snapshot(); await w.ImageQrApp.generate(); const after = w.ImageQrApp.snapshot();
  assert.equal(d.getElementById('search-status').classList.contains('error'), false, d.getElementById('search-status').textContent);
  for (const key of ['weights', 'hard', 'soft']) assert.deepEqual(Array.from(after[key]), Array.from(before[key]));
  assert.equal(after.hard[0], 1); assert.equal(after.weights[10], Math.fround(.15));
  assert.equal(d.getElementById('segment-1-length').value, '6'); assert.equal(d.getElementById('mask').value, 'all'); assert.equal(d.getElementById('soft-passes').value, '1');
  assert.equal(d.getElementById('validation-badge').hidden, false); assert.equal(d.getElementById('export-controls').hidden, false);
  assert.match(d.getElementById('result-text').value, /^https:\/\/example\.com\/#/);
  assert.equal(app.requests.at(-1).input.targets[3].hard[0], 1);
  assert.deepEqual(app.errors, []); app.dom.window.close();
});
test('zero-valued settings and edits are not replaced by defaults; restore leaves source parameters intact', () => {
  const app = application(), { w, d, set } = app;
  set('brush-mode', 'soft-white'); set('brush-weight', 0); d.getElementById('apply-all').click();
  const before = w.ImageQrApp.snapshot(); assert(before.weights.every(v => v === 0)); assert(before.soft.every(v => v === 0));
  set('threshold', 0); set('contrast', 0); d.getElementById('clear-soft').click();
  assert(w.ImageQrApp.snapshot().soft.every(v => v === -1)); assert.equal(d.getElementById('threshold').value, '0'); assert.equal(d.getElementById('contrast').value, '0');
  assert.deepEqual(app.errors, []); app.dom.window.close();
});
test('cancel settles the pending generation and a subsequent generation works with the same input', async () => {
  const app = application(), { w, d, set } = app;
  set('segment-1-length', 2); set('brush-mode', 'soft-black'); d.getElementById('apply-all').click();
  const before = w.ImageQrApp.snapshot(), pending = w.ImageQrApp.generate();
  d.getElementById('cancel').click();
  await pending;
  assert.match(d.getElementById('search-status').textContent, /中断/);
  assert.equal(d.getElementById('generate').disabled, false);
  for (const key of ['weights', 'hard', 'soft']) assert.deepEqual(Array.from(w.ImageQrApp.snapshot()[key]), Array.from(before[key]));
  set('version', 2); set('version-min', 3); set('version-max', 4); set('mask', 0); set('search-seconds', 2);
  await w.ImageQrApp.generate();
  assert.equal(d.getElementById('validation-badge').hidden, false, d.getElementById('search-status').textContent);
  assert.deepEqual(Object.keys(app.requests.at(-1).input.targets), ['2']);
  assert.deepEqual(app.errors, []); app.dom.window.close();
});
