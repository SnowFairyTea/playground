const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../assets/image-qr-engine.js');
const jsQR = require('../../assets/vendor/image-qr/jsQR.js');
const { PNG } = require('pngjs');

const segments = [
  { kind: 'fixed', text: 'https://example.com/日本語#' },
  { kind: 'variable', length: 4, allowed: E.URLSAFE, forbidden: 'I' },
  { kind: 'fixed', text: '-固定-' },
  { kind: 'variable', length: 3, allowed: '0123456789' }
];
function target(bits, size, hard) { return { bits: Uint8Array.from(bits), size, weights: new Float32Array(size * size).fill(1), hard: hard || new Int8Array(size * size).fill(-1) }; }
function simple(length = 4, allowed = E.URLSAFE) { return [{ kind: 'fixed', text: 'https://example.com/#' }, { kind: 'variable', length, allowed }]; }
test('maximum affine spaces are exact; later refinement can use the full allowed set', () => {
  for (const [s, dimension, count] of [[E.URLSAFE, 5, 32], ['0123456789', 3, 8], ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 4, 16], ['a', 0, 1]]) {
    const a = E.analyzeCharset(E.allowedBytes({ allowed: s })); assert.equal(a.maxDim, dimension); assert.equal(a.candidates[0].elements.length, count);
    for (const c of a.candidates) assert(c.elements.every(b => s.includes(String.fromCharCode(b))));
  }
  assert.throws(() => E.allowedBytes({ allowed: 'あ' }), /ASCII/);
  assert.throws(() => E.allowedBytes({ allowed: 'abc', forbidden: 'abc' }), /空/);
});
test('RS-linear mapping agrees with the real encoder across masks, ECC levels, UTF-8 boundaries and rotations', () => {
  const model = E.makeModel(segments);
  for (const ecc of ['L', 'M', 'Q', 'H']) for (const version of [6, 9, 10, 15]) {
    const map = E.buildMapping(model, version, ecc);
    for (const mask of [0, 3, 7]) {
      const bytes = E.applyX(model, 0x23815n), actual = E.encode(bytes, version, ecc, mask).modules.data;
      for (const rotation of [0, 1, 2, 3]) {
        const m = E.orient(map, Uint8Array.from(E.encode(model.baseline, version, ecc, mask).modules.data), rotation);
        assert.deepEqual(E.predict(m, 0x23815n), E.rotate(Uint8Array.from(actual), map.size, rotation));
      }
    }
  }
});
test('large QR versions and every RS block layout reconstruct a valid systematic code', () => {
  const model = E.makeModel(simple(1));
  for (const ecc of ['L', 'M', 'Q', 'H']) for (let version = 1; version <= 40; version++) {
    const layout = E.blockLayout(version, ecc); assert.equal(layout.order.length, layout.raw);
    assert.equal(new Set(layout.blocks.flatMap(b => b.slots)).size, layout.raw);
    if (version < 3) continue;
    const symbol = E.encode(model.baseline, version, ecc, 7), matrix = Uint8Array.from(symbol.modules.data);
    const report = E.rsReport(matrix, matrix, symbol, ecc, 7);
    assert(report.every(b => b.nonzeroSyndromes === 0 && b.errors === 0 && b.remaining === Math.floor(b.eccWords / 2)));
  }
});
test('linear solution spans exactly all feasible assignments in a small exhaustive problem', () => {
  const system = new E.LinearSystem(); assert.equal(system.add(0b011n, 1), 'added'); assert.equal(system.add(0b110n, 0), 'added');
  assert.equal(system.add(0b101n, 0), 'conflict');
  const sol = system.solve(3); const xs = [sol.particular, sol.particular ^ sol.nullBasis[0]].map(Number).sort();
  const exact = []; for (let x = 0; x < 8; x++) if (((x & 1) ^ (x >> 1 & 1)) === 1 && ((x >> 1 & 1) ^ (x >> 2 & 1)) === 0) exact.push(x);
  assert.deepEqual(xs, exact);
});
test('incremental visual loss agrees with complete recomputation, including zero weights', () => {
  const n = 13, mat = Uint8Array.from({ length: n * n }, (_, j) => j % 3 === 0 ? 1 : 0), bits = Uint8Array.from(mat, (b, i) => b ^ Number(i % 7 === 0));
  const w = Float32Array.from(mat, (_, j) => j % 5 / 4), loss = new E.Loss(mat, bits, w, n, .35), changes = [1, 3, 7, 8, 51, 83, 100];
  const before = loss.value(), delta = loss.delta(changes); loss.delta(changes, true);
  assert(Math.abs(loss.value() - before - delta) < 1e-12);
  assert(Math.abs(loss.value() - new E.Loss(loss.matrix, bits, w, n, .35).value()) < 1e-12);
});
test('reprojection preserves every absolute cell and rejects black/white collisions', () => {
  const hard = new Int8Array(4 * 4).fill(-1); hard[5] = 1;
  const out = E.projectHard(hard, 4, 8); assert.equal(out.filter(v => v === 1).length, 4);
  hard[4] = 0; assert.throws(() => E.projectHard(hard, 4, 2), /重なり/);
  assert.equal(hard[5], 1); assert.equal(hard[4], 0);
});
test('full-character refinement recovers a target that the old 0–7 subspace excludes', async () => {
  const seg = simple(1, '0123456789'), model = E.makeModel(seg), bytes = model.baseline.slice(); bytes[bytes.length - 1] = 56;
  const symbol = E.encode(bytes, 3, 'M', 0), result = await E.search({ segments: seg, target: target(symbol.modules.data, 29), settings: { version: 3, masks: 0, seconds: 3, candidates: 1, perception: 0 } });
  assert.equal(result.candidates[0].text, 'https://example.com/#8'); assert.equal(result.candidates[0].metrics.weighted, 1); assert(result.candidates[0].validation.ok);
});
test('an infeasible first mask does not abort remaining masks; hard constraints remain exact', async () => {
  const seg = simple(3), model = E.makeModel(seg), zero = E.encode(model.baseline, 3, 'M', 0), one = E.encode(model.baseline, 3, 'M', 1);
  const index = zero.modules.data.findIndex((b, i) => zero.modules.reservedBit[i] && b !== one.modules.data[i]); assert(index >= 0);
  const hard = new Int8Array(29 * 29).fill(-1); hard[index] = one.modules.data[index];
  const t = target(one.modules.data, 29, hard), before = structuredClone(t);
  const result = await E.search({ segments: seg, target: t, settings: { version: 3, masks: 'all', seconds: 4, candidates: 2, passes: 1 } });
  assert(result.stats.infeasible > 0); assert(result.stats.attempted > 1);
  result.candidates.forEach(c => { assert(c.validation.absolute); assert.equal(c.matrix[index], hard[index]); });
  assert.deepEqual(t, before);
});
test('absolute targets outside the initial affine subset can be recovered from the full character domain', async () => {
  const seg = simple(1, '0123456789'), model = E.makeModel(seg), bytes = model.baseline.slice(); bytes[bytes.length - 1] = 56;
  const symbol = E.encode(bytes, 3, 'M', 0), t = target(symbol.modules.data, 29, Int8Array.from(symbol.modules.data));
  const result = await E.search({ segments: seg, target: t, settings: { version: 3, masks: 0, seconds: 3, candidates: 1 } });
  assert.equal(result.candidates[0].text, 'https://example.com/#8'); assert(result.candidates[0].validation.absolute);
});
test('length and Version search retain weights and absolute constraints rather than reading UI pixels', async () => {
  const seg = simple(5, '0123456789'); seg[1].start = 1; seg[1].step = 2;
  const model = E.makeModel(seg), q = E.encode(model.baseline, 3, 'M', 0), t = target(q.modules.data, 29); t.hard[0] = 1; t.weights[180] = 0; t.weights[181] = .25;
  const before = structuredClone(t), result = await E.search({ segments: seg, target: t, settings: { version: 'auto', compareVersions: true, versionMin: 3, versionMax: 4, masks: 'all', autoLength: true, lengthTrials: 3, refineRadius: 1, seconds: 5, candidates: 3, passes: 1 } });
  assert.deepEqual(t, before); assert(result.stats.attempted > 1);
  result.candidates.forEach(c => { assert(c.validation.ok); assert(c.matrix[0] === 1); assert(/^https:\/\/example\.com\/#\d{1,5}$/.test(c.text)); });
});
test('all-hard contradiction fails without silently relaxing requirements', async () => {
  const hard = new Int8Array(29 * 29).fill(0), t = target(new Uint8Array(29 * 29), 29, hard);
  await assert.rejects(E.search({ segments: simple(2), target: t, settings: { version: 3, masks: 'all', seconds: 2 } }), /絶対黒白指定/);
  assert(t.hard.every(v => v === 0));
});
test('export raster, PNG roundtrip, independent encoder, decoder and RS detect corruption', () => {
  const model = E.makeModel(segments), version = 6, ecc = 'M', mask = 2, bytes = E.applyX(model, 0x242n), symbol = E.encode(bytes, version, ecc, mask), size = symbol.modules.size;
  for (const rotation of [0, 1, 2, 3]) {
    const candidate = { version, ecc, mask, rotation, bytes, matrix: E.rotate(Uint8Array.from(symbol.modules.data), size, rotation) }, t = target(candidate.matrix, size);
    assert(E.verify(candidate, model, t).ok);
    for (const scale of [2, 5, 8]) {
      const raster = E.renderRGBA(candidate.matrix, size, scale, 4), encoded = PNG.sync.write({ width: raster.width, height: raster.height, data: Buffer.from(raster.data) }), reloaded = PNG.sync.read(encoded);
      assert.deepEqual(E.reloadModules({ ...raster, data: reloaded.data }, size), candidate.matrix);
      const decoded = jsQR(new Uint8ClampedArray(reloaded.data), reloaded.width, reloaded.height, { inversionAttempts: 'dontInvert' }); assert(decoded); assert.deepEqual(decoded.binaryData, Array.from(bytes));
    }
    const svg = E.svg(candidate.matrix, size); assert(svg.includes('shape-rendering="crispEdges"')); assert.equal((svg.match(/h1v1h-1z/g) || []).length, candidate.matrix.reduce((a, b) => a + b, 0));
  }
  const bad = Uint8Array.from(symbol.modules.data), index = E.placement(symbol)[0]; bad[index] ^= 1;
  const report = E.verify({ version, ecc, mask, rotation: 0, bytes, matrix: bad }, model, target(bad, size)); assert.equal(report.ok, false); assert(report.encoderDiff > 0); assert(report.blocks.some(b => b.errors > 0 && b.nonzeroSyndromes > 0));
});
test('invalid settings and immutable fixed bytes are rejected', () => {
  assert.throws(() => E.normalizeSettings({ perception: NaN })); assert.throws(() => E.normalizeSettings({ versionMin: 10, versionMax: 4 }));
  const model = E.makeModel(segments), bytes = model.baseline.slice(); bytes[0] ^= 1; assert.equal(E.payloadOK(bytes, model), false);
});
test('explicit Version takes precedence over the range used for automatic comparison', async () => {
  const seg = simple(2), q = E.encode(E.makeModel(seg).baseline, 3, 'M', 0);
  const result = await E.search({ segments: seg, target: target(q.modules.data, 29), settings: { version: 3, versionMin: 1, versionMax: 2, masks: 0, seconds: 2, candidates: 1 } });
  assert.equal(result.candidates[0].version, 3); assert(result.candidates[0].validation.ok);
});

test('image-adapted Byte spaces recover permitted characters outside the global maximum subset', async () => {
  const segments = [{ kind: 'fixed', text: 'https://example.com/#' }, { kind: 'variable', length: 4, allowed: E.URLSAFE }];
  const model = E.makeModel(segments), before = structuredClone(model), bytes = model.baseline.slice();
  bytes.set(new TextEncoder().encode('0xzA'), bytes.length - 4);
  const mapping = E.buildMapping(model, 3, 'M');
  for (const [rotation, mask] of [[0, 0], [1, 3], [2, 7], [3, 2]]) {
    const original = E.encode(model.baseline, 3, 'M', mask, model), expected = E.rotate(Uint8Array.from(E.encode(bytes, 3, 'M', mask, model).modules.data), 29, rotation);
    const m = E.orient(mapping, Uint8Array.from(original.modules.data), rotation), t = target(expected, 29), adapted = E.byteSubspace(m, model, t);
    assert.equal(adapted.adapted, 4); assert.deepEqual(adapted.model.baseline, bytes);
    assert.deepEqual(E.predict(adapted.mapping, 0n), expected);
    const random = (1n << BigInt(adapted.model.variables.length)) - 1n, changed = E.applyX(adapted.model, random);
    assert(E.payloadOK(changed, model));
    assert.deepEqual(E.predict(adapted.mapping, random), E.rotate(Uint8Array.from(E.encode(changed, 3, 'M', mask, adapted.model).modules.data), 29, rotation));
  }
  assert.deepEqual(model, before);
  const exact = E.encode(bytes, 3, 'M', 0, model);
  const result = await E.search({ segments, target: target(exact.modules.data, 29), settings: { version: 3, masks: 0, fullCharset: false, samples: 1, passes: 1, seconds: 2, candidates: 1 } });
  assert.equal(result.candidates[0].text, 'https://example.com/#0xzA');
  assert.equal(result.candidates[0].metrics.raw, 1); assert(result.candidates[0].validation.ok);
});

test('manual initial spaces and forbidden characters remain authoritative during Byte adaptation', () => {
  const segments = [{ kind: 'fixed', text: 'fixed/' }, { kind: 'variable', length: 1, allowed: E.URLSAFE, forbidden: '0', affineChoice: '0' }];
  const model = E.makeModel(segments), mapping = E.buildMapping(model, 2, 'M'), t = target(new Uint8Array(25 * 25), 25);
  const explicit = E.byteSubspace(mapping, model, t);
  assert.equal(explicit.adapted, 0); assert.equal(explicit.mapping, mapping); assert.equal(explicit.model, model);
  segments[1].affineChoice = 'auto';
  const automatic = E.makeModel(segments), adapted = E.byteSubspace(E.buildMapping(automatic, 2, 'M'), automatic, t);
  for (let x = 0n; x < 1n << BigInt(adapted.model.variables.length); x++) assert(E.payloadOK(E.applyX(adapted.model, x), automatic));
  assert(!adapted.model.positions[0].allowed.includes(48));
});
