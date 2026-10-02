const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { PNG } = require('pngjs');
const jsQR = require('../../assets/vendor/image-qr/jsQR.js');
const E = require('../../assets/image-qr-engine.js');

function fixture(ecc = 'M', rotation = 0, color = false) {
  const segments = [{ kind: 'fixed', text: 'https://example.com/日本?q=AbC-12#section' }], model = E.makeModel(segments), version = 6, size = version * 4 + 17, mask = 3;
  const q = E.encode(model.baseline, version, ecc, mask, model);
  const original = { version, size, ecc, mask, rotation, bytes: model.baseline.slice(), text: new TextDecoder().decode(model.baseline), matrix: E.rotate(Uint8Array.from(q.modules.data), size, rotation) };
  const target = { size, bits: Uint8Array.from({ length: size * size }, (_, j) => Number(Math.hypot((j % size + .5) / size - .5, (Math.floor(j / size) + .5) / size - .5) < .29)), hard: new Int8Array(size * size).fill(-1), weights: new Float32Array(size * size).fill(1) };
  if (color) {
    const width = size * 3, rgba = new Uint8ClampedArray(width * width * 4);
    for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
      const j = (y * width + x) * 4, black = Math.hypot((x + .5) / width - .5, (y + .5) / width - .5) < .29;
      rgba[j] = black ? 15 : 220; rgba[j + 1] = black ? 60 + Math.floor(y / width * 25) : 245; rgba[j + 2] = black ? 100 : 250; rgba[j + 3] = 255;
    }
    target.image = { size: width, rgba };
  }
  return { original, model, target };
}

test('image drawing preserves the exact fixed UTF-8 URL across ECC levels and rotations', async () => {
  for (const [rotation, ecc] of ['L', 'M', 'Q', 'H'].entries()) {
    const { original, model, target } = fixture(ecc, rotation, true), before = structuredClone(original);
    const result = await E.makeArtwork(original, model, target, { mode: 'image-color', budget: .9 }), a = result.variant;
    assert(a?.rendering, result.reason); assert(a.validation.ok); assert.deepEqual(original, before); assert.deepEqual(a.bytes, original.bytes);
    assert.equal(a.text, original.text); assert(a.validation.scans.length === 5 && a.validation.scans.every(s => s.ok));
    assert(a.validation.blocks.every(b => b.errors <= b.budget && b.remaining >= 1));
    assert(a.renderMetrics.raw > E.renderedMetrics(original, target).raw + .15);
    const raster = E.renderCandidate(a, 8), png = PNG.sync.read(PNG.sync.write({ width: raster.width, height: raster.height, data: Buffer.from(raster.data) }));
    assert.deepEqual(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.binaryData, Array.from(original.bytes));
    assert.deepEqual(E.reloadModules(raster, a.size), a.matrix);
  }
});

test('the entire hard, ignored, structural and remainder modules stay unchanged in the drawing', async () => {
  const { original, model, target } = fixture('Q', 2), symbol = E.encode(original.bytes, original.version, original.ecc, original.mask, model);
  const cells = E.placement(symbol), layout = E.blockLayout(original.version, original.ecc), editable = new Uint8Array(original.size ** 2);
  for (const j of cells.slice(0, layout.raw * 8)) editable[j] = 1;
  const rotated = E.rotate(editable, original.size, original.rotation), ordinary = [...rotated.keys()].filter(j => rotated[j]);
  target.hard[ordinary[5]] = original.matrix[ordinary[5]]; target.weights[ordinary[30]] = 0;
  const a = (await E.makeArtwork(original, model, target, { mode: 'auto' })).variant;
  assert(a?.rendering); const raster = E.renderCandidate(a, 8), reference = E.renderRGBA(original.matrix, original.size, 8);
  for (let j = 0; j < rotated.length; j++) if (!rotated[j] || target.hard[j] >= 0 || !target.weights[j]) {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const p = (((Math.floor(j / original.size) + 4) * 8 + y) * raster.width + (j % original.size + 4) * 8 + x) * 4;
      assert.deepEqual(raster.data.slice(p, p + 4), reference.data.slice(p, p + 4));
    }
  }
});

test('a zero RS budget can still yield a verified picture without changing a single center module', async () => {
  const { original, model, target } = fixture(), a = (await E.makeArtwork(original, model, target, { mode: 'image-mono', budget: 0 })).variant;
  assert(a?.rendering); assert(a.validation.ok); assert.equal(a.changedWords, 0); assert.equal(a.changedModules, 0); assert.deepEqual(a.matrix, original.matrix);
  assert(a.validation.blocks.every(b => b.errors === 0 && b.budget === 0));
  const r = E.renderCandidate(a); for (let j = 0; j < r.data.length; j += 4) assert(r.data[j] === r.data[j + 1] && r.data[j] === r.data[j + 2]);
});

test('drawing verification rejects forged masks, cores, source images and modes', async () => {
  const { original, model, target } = fixture(), a = (await E.makeArtwork(original, model, target, { mode: 'auto' })).variant;
  assert(a?.rendering);
  for (const edit of [r => { r.core = .1; }, r => { r.editable[0] = 1; }, r => { r.image.rgba[0] ^= 1; }, r => { r.mode = 'anything'; }, r => { delete r.image.rgba; }]) {
    const corrupt = structuredClone(a); edit(corrupt.rendering);
    const report = E.verifyArtistic(corrupt, original, model, target); assert.equal(report.renderingOK, false); assert.equal(report.ok, false);
  }
  assert.throws(() => E.normalizeSettings({ artisticMode: 'anything' }), /モード/);
});

test('PNG and exported SVG describe exactly the same colored drawing', async () => {
  const { original, model, target } = fixture('M', 1, true), a = (await E.makeArtwork(original, model, target, { mode: 'image-color' })).variant, scale = 8, quiet = 5;
  assert(a?.rendering); const r = E.renderCandidate(a, scale, quiet), svg = E.candidateSvg(a, scale, quiet), parsed = new Uint8ClampedArray(r.data.length).fill(255);
  assert(!/href=|<script|<image/.test(svg));
  for (const path of svg.matchAll(/<path fill="#([0-9a-f]{6})" d="([^"]+)"\/>/g)) {
    const color = [0, 2, 4].map(k => parseInt(path[1].slice(k, k + 2), 16));
    for (const run of path[2].matchAll(/M(\d+),(\d+)h(\d+)v1h-\d+z/g)) for (let x = +run[1]; x < +run[1] + +run[3]; x++) { const j = (+run[2] * r.width + x) * 4; parsed.set(color, j); }
  }
  assert.deepEqual(parsed, r.data); assert.deepEqual(jsQR(parsed, r.width, r.height)?.binaryData, Array.from(original.bytes));
});

test('finished picture ranking retains the best measured, actually decoded mask', async () => {
  const { original, model, target } = fixture(), scores = [];
  for (let mask = 0; mask < 8; mask++) {
    const c = { ...original, mask, matrix: Uint8Array.from(E.encode(original.bytes, original.version, original.ecc, mask, model).modules.data) };
    const a = (await E.makeArtwork(c, model, target, { mode: 'auto' })).variant;
    scores.push((a?.renderMetrics || E.renderedMetrics(c, target)).visual);
  }
  const result = await E.search({ segments: [{ kind: 'fixed', text: original.text }], target, settings: { version: original.version, artistic: true, artisticMode: 'auto', candidates: 1, seconds: 2 } });
  assert.equal(result.stats.artisticTested, 8); const c = result.candidates[0], metric = c.artistic?.renderMetrics || c.renderMetrics;
  assert(Math.abs(metric.visual - Math.max(...scores)) < 1e-10);
});

test('drawing rejection leaves a verified square-module fallback and never labels a failed picture as usable', async () => {
  const { original, model, target } = fixture(), filename = require.resolve('../../assets/image-qr-engine.js'), localRequire = createRequire(filename);
  let rejected = 0;
  const decoder = (data, width, height, options) => {
    const scale = width / (original.size + 8), raster = { data, width, scale, quiet: 4 }, centers = E.reloadModules(raster, original.size);
    if (Number.isInteger(scale)) for (let row = 0; row < original.size; row++) for (let col = 0; col < original.size; col++) {
      const center = centers[row * original.size + col];
      for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) if (data[(((row + 4) * scale + y) * width + (col + 4) * scale + x) * 4] !== (center ? 0 : 255)) { rejected++; return null; }
    }
    return jsQR(data, width, height, options);
  };
  const context = { module: { exports: {} }, TextEncoder, TextDecoder, performance, setTimeout, require: n => n.endsWith('/jsQR.js') ? decoder : localRequire(n) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context);
  const result = await context.module.exports.makeArtwork(original, model, target, { mode: 'auto' });
  assert(rejected >= 10); assert(result.variant?.validation.ok); assert.equal(result.variant.rendering, undefined); assert.match(result.reason, /マス単位/);
});

test('a rejected narrow core becomes wider and is decoded again before adoption', async () => {
  const { original, model, target } = fixture(), filename = require.resolve('../../assets/image-qr-engine.js'), localRequire = createRequire(filename);
  let rejected = 0;
  const decoder = (data, width, height, options) => {
    const scale = width / (original.size + 8);
    if (scale === 8 && data.every((v, j) => j % 4 === 3 || v === 0 || v === 255)) {
      const centers = E.reloadModules({ data, width, scale, quiet: 4 }, original.size);
      for (let row = 0; row < original.size; row++) for (let col = 0; col < original.size; col++) for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) {
        if (data[(((row + 4) * 8 + y) * width + (col + 4) * 8 + x) * 4] !== (centers[row * original.size + col] ? 0 : 255)) { rejected++; return null; }
      }
    }
    return jsQR(data, width, height, options);
  };
  const context = { module: { exports: {} }, TextEncoder, TextDecoder, performance, setTimeout, require: n => n.endsWith('/jsQR.js') ? decoder : localRequire(n) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context);
  const result = await context.module.exports.makeArtwork(original, model, target, { mode: 'image-mono' });
  assert(rejected >= 1); assert(result.variant?.rendering); assert(result.variant.rendering.core >= .5); assert(result.variant.validation.ok);
  assert(result.variant.validation.scans.every(s => s.ok));
});
