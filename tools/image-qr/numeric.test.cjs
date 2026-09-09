const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../assets/image-qr-engine.js');
const jsQR = require('../../assets/vendor/image-qr/jsQR.js');
const { PNG } = require('pngjs');

const variable = (length, extra = {}) => ({ kind: 'variable', length, allowed: E.URLSAFE, ...extra });
const target = (matrix, size, absolute = false) => ({ size, bits: Uint8Array.from(matrix), weights: new Float32Array(size ** 2).fill(1), hard: absolute ? Int8Array.from(matrix) : new Int8Array(size ** 2).fill(-1) });

test('numeric mode uses decimal groups and preserves mixed fixed UTF-8 and restricted byte parts', () => {
  const segments = [{ kind: 'fixed', text: '日本#' }, variable(7), { kind: 'fixed', text: '/' }, variable(2, { allowed: 'ABC' }), variable(5), { kind: 'fixed', text: '終🙂' }];
  const model = E.makeModel(segments, undefined, { encoding: 'numeric' });
  assert.deepEqual(model.parts.map(p => p.mode), ['byte', 'numeric', 'byte', 'numeric', 'byte']);
  for (const version of [5, 10, 27]) for (const ecc of ['L', 'M', 'Q', 'H']) {
    const mapping = E.buildMapping(model, version, ecc), x = (1n << BigInt(model.variables.length)) - 1n, bytes = E.applyX(model, x);
    assert(E.payloadOK(bytes, model)); assert.match(new TextDecoder().decode(bytes), /^日本#\d{7}\/[ABC]{2}\d{5}終🙂$/);
    for (const mask of [0, 7]) {
      const matrix = Uint8Array.from(E.encode(bytes, version, ecc, mask, model).modules.data);
      const m = E.orient(mapping, Uint8Array.from(E.encode(model.baseline, version, ecc, mask, model).modules.data), 0);
      assert.deepEqual(E.predict(m, x), matrix);
      if (mask === 7) assert(E.verify({ version, ecc, mask, bytes, matrix }, model, target(matrix, mapping.size)).ok);
    }
  }
});

test('all initial numeric combinations fit their declared decimal widths, including leading zeros', () => {
  for (const length of [1, 2, 3]) {
    const model = E.makeModel([variable(length)], undefined, { encoding: 'numeric' });
    for (let x = 0; x < 2 ** model.variables.length; x++) {
      const bytes = E.applyX(model, BigInt(x));
      assert.equal(bytes.length, length); assert(E.payloadOK(bytes, model)); assert(/^\d+$/.test(new TextDecoder().decode(bytes)));
    }
    assert.equal(new TextDecoder().decode(E.applyX(model, 0n)), '0'.repeat(length));
  }
});

test('forbidden digits prevent numeric conversion and are never silently reintroduced', async () => {
  const segments = [variable(2, { forbidden: '9' })], model = E.makeModel(segments, undefined, { encoding: 'numeric' });
  assert.equal(model.numericUnits.length, 0); assert.deepEqual(model.parts.map(p => p.mode), ['byte']);
  const q = E.encode(model.baseline, 1, 'M', 0, model);
  const result = await E.search({ segments, target: target(q.modules.data, 21), settings: { encoding: 'numeric', version: 1, masks: 0, seconds: 2, candidates: 1 } });
  assert(!result.candidates[0].text.includes('9')); assert(result.candidates[0].validation.ok);
});

test('numeric hard constraints can recover 8, 99 and 999 outside the initial subspaces', async () => {
  for (const digits of ['8', '99', '999', '9989999']) {
    const segments = [{ kind: 'fixed', text: 'https://x.test/日本/#' }, variable(digits.length)], model = E.makeModel(segments, undefined, { encoding: 'numeric' });
    const bytes = new TextEncoder().encode('https://x.test/日本/#' + digits), q = E.encode(bytes, 4, 'M', 3, model);
    const result = await E.search({ segments, target: target(q.modules.data, 33, true), settings: { encoding: 'numeric', version: 4, masks: 3, seconds: 3, candidates: 1 } });
    assert.equal(result.candidates[0].text, 'https://x.test/日本/#' + digits); assert(result.candidates[0].validation.ok);
  }
});

test('numeric hard contradictions never relax the target', async () => {
  const t = target(new Uint8Array(21 ** 2), 21, true), before = t.hard.slice();
  await assert.rejects(E.search({ segments: [variable(5)], target: t, settings: { encoding: 'numeric', version: 1, masks: 'all', seconds: 2 } }), /絶対黒白指定/);
  assert.deepEqual(t.hard, before);
});

test('mixed hard repair reaches both Byte and Numeric values outside their initial subspaces', async () => {
  const segments = [{ kind: 'fixed', text: '日本#' }, variable(1, { allowed: '0123456789', forbidden: '9' }), { kind: 'fixed', text: '/' }, variable(3)];
  const model = E.makeModel(segments, undefined, { encoding: 'numeric' });
  const bytes = new TextEncoder().encode('日本#8/999'), q = E.encode(bytes, 3, 'M', 5, model);
  const result = await E.search({ segments, target: target(q.modules.data, 29, true), settings: { encoding: 'numeric', version: 3, masks: 5, seconds: 3, candidates: 1 } });
  assert.equal(result.candidates[0].text, '日本#8/999'); assert(result.candidates[0].validation.ok);
});

test('capacity calculation honors numeric header boundaries, fixed text and each ECC', () => {
  for (const version of [1, 8, 10, 27, 40]) for (const ecc of ['L', 'M', 'Q', 'H']) {
    const segments = [variable(1)], settings = { encoding: 'numeric', version, ecc }, length = E.maxVariableLength(segments, 0, settings);
    const model = E.makeModel([variable(length)], undefined, settings);
    assert.equal(E.encode(model.baseline, version, ecc, 0, model).version, version);
    if (length < 7089) { const tooLong = E.makeModel([variable(length + 1)], undefined, settings); assert.throws(() => E.encode(tooLong.baseline, version, ecc, 0, tooLong)); }
  }
  const segments = [{ kind: 'fixed', text: 'https://x.test/日本/#' }, variable(1)], settings = { encoding: 'numeric', version: 8, ecc: 'M' };
  const length = E.maxVariableLength(segments, 1, settings); assert(length < 365);
  assert.equal(E.maxVariableLength([variable(1)], 0, settings), 365);
  assert.equal(E.maxVariableLength([variable(1)], 0, { ...settings, encoding: 'byte' }), 152);
});

test('numeric candidates survive rotation and PNG roundtrip with exact independent decoding', async () => {
  const segments = [{ kind: 'fixed', text: 'https://x.test/#' }, variable(12)], model = E.makeModel(segments, undefined, { encoding: 'numeric' });
  const q = E.encode(model.baseline, 3, 'M', 0, model), t = target(E.rotate(Uint8Array.from(q.modules.data), 29, 1), 29);
  const result = await E.search({ segments, target: t, settings: { encoding: 'numeric', version: 3, masks: 'all', rotations: [1], seconds: 3, candidates: 2 } });
  for (const candidate of result.candidates) {
    assert(candidate.validation.ok); assert.equal(candidate.rotation, 1);
    const r = E.renderRGBA(candidate.matrix, 29, 3, 4), png = PNG.sync.read(PNG.sync.write({ width: r.width, height: r.height, data: Buffer.from(r.data) }));
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    assert.deepEqual(decoded.binaryData, Array.from(candidate.bytes));
  }
});

test('quality reporting separates missing foreground from noise in the background', () => {
  const report = new E.Loss(Uint8Array.from([1, 0, 1, 0]), Uint8Array.from([1, 1, 0, 0]), new Float32Array(4).fill(1), 2).metrics();
  assert.equal(report.raw, .5); assert.equal(report.blackRecall, .5); assert.equal(report.backgroundBlack, .5);
  assert.equal(new E.Loss(new Uint8Array(4), new Uint8Array(4), new Float32Array(4).fill(1), 2).metrics().blackRecall, null);
});
