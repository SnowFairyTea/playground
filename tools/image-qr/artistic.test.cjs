const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { PNG } = require('pngjs');
const jsQR = require('../../assets/vendor/image-qr/jsQR.js');
const E = require('../../assets/image-qr-engine.js');

function fixture(ecc = 'M', rotation = 0, numeric = false) {
  const segments = [{ kind: 'fixed', text: 'https://example.com/p?q=AbC-12#section' }];
  if (numeric) segments.push({ kind: 'fixed', text: '/日本/' }, { kind: 'variable', length: 12, allowed: E.URLSAFE });
  const model = E.makeModel(segments, undefined, { encoding: numeric ? 'numeric' : 'byte' }), version = numeric ? 8 : 5, size = version * 4 + 17, mask = 3;
  const symbol = E.encode(model.baseline, version, ecc, mask, model), matrix = E.rotate(Uint8Array.from(symbol.modules.data), size, rotation);
  const original = { version, ecc, mask, rotation, size, bytes: model.baseline.slice(), text: new TextDecoder().decode(model.baseline), matrix };
  const target = { size, bits: Uint8Array.from({ length: size * size }, (_, j) => Number(Math.hypot(j % size / size - .5, Math.floor(j / size) / size - .5) < .3)), weights: new Float32Array(size * size).fill(1), hard: new Int8Array(size * size).fill(-1) };
  return { segments, model, original, target, symbol };
}

test('artwork preserves the entire fixed URL and pristine QR across ECC levels and rotations', async () => {
  for (const [rotation, ecc] of ['L', 'M', 'Q', 'H'].entries()) {
    const { model, original, target } = fixture(ecc, rotation), before = structuredClone(original);
    target.hard[20] = original.matrix[20]; target.bits[20] = original.matrix[20] ^ 1;
    target.weights[55] = 0; target.bits[55] = original.matrix[55] ^ 1;
    const result = await E.makeArtistic(original, model, target), a = result.variant;
    assert(a, result.reason); assert(a.validation.ok); assert(a.changedModules > 0);
    assert.deepEqual(original, before); assert.deepEqual(a.bytes, original.bytes); assert.equal(a.text, original.text);
    assert(a.metrics.raw > new E.Loss(original.matrix, target.bits, target.weights, original.size).metrics().raw);
    assert.equal(a.matrix[20], original.matrix[20]); assert.equal(a.matrix[55], original.matrix[55]);
    assert(a.validation.blocks.every(b => b.errors <= b.budget && b.remaining >= 1));
    assert(a.validation.structuralOK); assert.equal(a.validation.scans.length, 3);
    assert(E.verify(original, model, target).ok); assert.equal(E.verify(a, model, target).ok, false);
    const r = E.renderRGBA(a.matrix, a.size, 5, 4), png = PNG.sync.read(PNG.sync.write({ width: r.width, height: r.height, data: Buffer.from(r.data) }));
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    assert.deepEqual(decoded?.binaryData, Array.from(original.bytes));
  }
});

test('artwork supports mixed Numeric and UTF-8 Byte segments without changing their decoded bytes', async () => {
  const { original, model, target } = fixture('M', 3, true), result = await E.makeArtistic(original, model, target, { budget: .9 });
  assert(result.variant, result.reason); assert(result.variant.validation.ok);
  assert.deepEqual(result.variant.bytes, original.bytes); assert.match(result.variant.text, /日本\/0{12}$/);
});

test('artwork validation rejects damage to structure, remainder modules, payload and per-block budgets', () => {
  const { original, model, target, symbol } = fixture(), layout = E.blockLayout(original.version, original.ecc), cells = E.placement(symbol);
  const change = indices => { const a = structuredClone(original); for (const j of indices) a.matrix[j] ^= 1; return a; };
  assert.equal(E.verifyArtistic(change([0]), original, model, target).structuralOK, false);
  assert(cells.length > layout.raw * 8);
  assert.equal(E.verifyArtistic(change([cells[layout.raw * 8]]), original, model, target).structuralOK, false);
  const limit = Math.floor(Math.floor(layout.blocks[0].ec / 2) * .7);
  const indices = layout.blocks[0].slots.slice(0, limit + 1).map(slot => cells[slot * 8]);
  const over = E.verifyArtistic(change(indices), original, model, target);
  assert.equal(over.structuralOK, true); assert.equal(over.withinBudget, false); assert.equal(over.ok, false);
  const altered = structuredClone(original); altered.bytes[0] ^= 1;
  assert.equal(E.verifyArtistic(altered, original, model, target).samePayload, false);
  const hard = structuredClone(target); hard.hard[cells[0]] = original.matrix[cells[0]];
  assert.equal(E.verifyArtistic(change([cells[0]]), original, model, hard).absolute, false);
  const ignored = structuredClone(target); ignored.weights[cells[0]] = 0;
  const ignoredReport = E.verifyArtistic(change([cells[0]]), original, model, ignored);
  assert.equal(ignoredReport.structuralOK, true); assert.equal(ignoredReport.withinBudget, true);
  assert.equal(ignoredReport.zeroWeightOK, false); assert.equal(ignoredReport.ok, false);
});

test('no-op or invalid artwork requests never replace a valid pristine output', async () => {
  const { original, model, target } = fixture();
  const zero = await E.makeArtistic(original, model, target, { budget: 0 }); assert.equal(zero.variant, null);
  const absolute = { ...target, hard: Int8Array.from(original.matrix) };
  const constrained = await E.makeArtistic(original, model, absolute); assert.equal(constrained.variant, null);
  const invalid = structuredClone(original); invalid.matrix[50] ^= 1;
  await assert.rejects(E.makeArtistic(invalid, model, target), /加工元/);
  await assert.rejects(E.makeArtistic(original, model, target, { budget: 1 }), /90%/);
});

test('generation attaches an optional verified artwork result while keeping regular validation intact', async () => {
  const { segments, target } = fixture();
  const result = await E.search({ segments, target, settings: { version: 5, masks: 3, artistic: true, candidates: 1, seconds: 1 } });
  const c = result.candidates[0]; assert(c.validation.ok); assert(c.artistic?.validation.ok, c.artisticNote);
  assert.equal(c.artistic.text, c.text); assert.equal(c.validation.encoderDiff, 0); assert(c.artistic.changedWords > 0);
});

test('finished-image ranking checks every fixed-payload mask before keeping one candidate', async () => {
  const { segments, target, original, model } = fixture(), scores = [];
  for (let mask = 0; mask < 8; mask++) {
    const regular = { ...original, mask, matrix: Uint8Array.from(E.encode(original.bytes, original.version, 'M', mask, model).modules.data) };
    const art = await E.makeArtistic(regular, model, target);
    scores.push(art.variant?.metrics.visual ?? new E.Loss(regular.matrix, target.bits, target.weights, regular.size).metrics().visual);
  }
  const result = await E.search({ segments, target, settings: { version: 5, masks: 'all', artistic: true, candidates: 1, seconds: 2 } });
  assert.equal(result.stats.artisticTested, 8); assert.equal(result.candidates.length, 1);
  const selected = result.candidates[0], completed = selected.artistic || selected;
  assert(completed.validation.ok); assert(Math.abs(completed.metrics.visual - Math.max(...scores)) < 1e-10);
});

test('word exchanges and detection backoff only return a true improvement at high tone priority', async () => {
  const { original, model, target } = fixture('Q', 2), initial = new E.Loss(original.matrix, target.bits, target.weights, original.size, .8).value();
  const result = await E.makeArtistic(original, model, target, { perception: .8, budget: .9 });
  assert(result.variant, result.reason); assert(result.variant.validation.ok);
  assert(new E.Loss(result.variant.matrix, target.bits, target.weights, original.size, .8).value() < initial);
  assert(result.variant.validation.blocks.every(b => b.errors <= b.budget && b.remaining >= 1));
});

test('decoder rejection backs off and never returns an unverified modified image', async () => {
  const { original, model, target } = fixture(), filename = require.resolve('../../assets/image-qr-engine.js'), localRequire = createRequire(filename);
  let rejected = 0;
  const rejectingDecoder = (data, width, height, options) => {
    const modules = E.reloadModules({ data, width, scale: width / (original.size + 8), quiet: 4 }, original.size);
    if (modules.some((v, i) => v !== original.matrix[i])) { rejected++; return null; }
    return jsQR(data, width, height, options);
  };
  const context = { module: { exports: {} }, TextEncoder, TextDecoder, performance, setTimeout, require: name => name.endsWith('/jsQR.js') ? rejectingDecoder : localRequire(name) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context);
  const result = await context.module.exports.makeArtistic(original, model, target);
  assert(rejected > 3); assert.equal(result.variant, null); assert.match(result.reason, /読み取り検証/);
  assert(E.verify(original, model, target).ok);
});
