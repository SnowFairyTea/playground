// Hold every decoded byte and the pristine matrix fixed while comparing drawings.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { PNG } = require('pngjs');
const E = require('../../assets/image-qr-engine.js');
const jsQR = require('../../assets/vendor/image-qr/jsQR.js');
const root = path.resolve(__dirname, '../..'), output = process.argv[2] || path.join(root, 'apps/image-qr-optimizer/verification/picture'), baselineRef = 'af92ce2c76e791776a67a253f40d95b2d94b8e8a';
const context = { module: { exports: {} }, TextEncoder, TextDecoder, performance, setTimeout, require: createRequire(path.join(root, 'assets/image-qr-engine.js')) };
vm.runInNewContext(execFileSync('git', ['show', baselineRef + ':assets/image-qr-engine.js'], { cwd: root, encoding: 'utf8' }), context);
const previous = context.module.exports, size = 49;
const settings = { version: 8, ecc: 'M', masks: 'all', rotations: [0], passes: 3, reserve: 8, samples: 64, seed: 1, seconds: 20, candidates: 1, perception: .35, fullCharset: true, encoding: 'byte', artistic: true, artisticBudget: .7 };
const cases = {
  ring: { draw: (x, y) => Math.hypot(x, y) > .19 && Math.hypot(x, y) < .35 },
  diagonal: { draw: (x, y) => Math.abs(x - y) < .11 && Math.max(Math.abs(x), Math.abs(y)) < .36 },
  heart: { draw: (x, y) => { x *= 3.8; y *= -3.8; return (x * x + y * y - 1) ** 3 - x * x * y ** 3 <= 0; } },
  'fixed-url': { draw: (x, y) => Math.hypot(x, y) > .19 && Math.hypot(x, y) < .35, fixed: true },
  astronaut: { photo: true, fixed: true }
};
function save(candidate, filename) {
  const r = E.renderCandidate(candidate, 8);
  fs.writeFileSync(path.join(output, filename), PNG.sync.write({ width: r.width, height: r.height, data: Buffer.from(r.data) }));
  const decoded = jsQR(r.data, r.width, r.height); if (candidate.bytes) assert.deepEqual(decoded?.binaryData, Array.from(candidate.bytes));
}
function summarize(candidate, target) {
  return { text: candidate.text, mask: candidate.mask, metrics: candidate.metrics, renderMetrics: E.renderedMetrics(candidate, target), mode: candidate.rendering?.mode || 'modules', core: candidate.rendering?.core || 1, changedWords: candidate.changedWords || 0, changedModules: candidate.changedModules || 0, validation: candidate.validation };
}
(async () => {
  fs.mkdirSync(output, { recursive: true }); const rows = [];
  for (const [name, c] of Object.entries(cases)) {
    const segments = c.fixed ? [{ kind: 'fixed', text: 'https://example.com/qr-art?theme=green#demo' }] : [{ kind: 'fixed', text: 'https://example.com/#' }, { kind: 'variable', length: 128, allowed: E.URLSAFE }];
    const target = { size, bits: c.photo ? null : Uint8Array.from({ length: size * size }, (_, j) => Number(c.draw((j % size + .5) / size - .5, (Math.floor(j / size) + .5) / size - .5))), weights: new Float32Array(size * size).fill(1), hard: new Int8Array(size * size).fill(-1) };
    if (c.photo) {
      const image = PNG.sync.read(fs.readFileSync(path.join(output, 'astronaut-source.png'))), qrTarget = PNG.sync.read(fs.readFileSync(path.join(output, 'astronaut-qr-target.png')));
      target.bits = Uint8Array.from({ length: size * size }, (_, j) => Number(.2126 * qrTarget.data[j * 4] + .7152 * qrTarget.data[j * 4 + 1] + .0722 * qrTarget.data[j * 4 + 2] < 128));
      target.image = { size: image.width, rgba: new Uint8ClampedArray(image.data) };
    } else save({ matrix: target.bits, size }, name + '-target.png');
    const started = performance.now(), result = await previous.search({ segments, target, settings }), regular = result.candidates[0], before = regular.artistic || regular, model = E.makeModel(segments);
    const baseSeconds = (performance.now() - started) / 1000, initial = structuredClone(regular.matrix), began = performance.now();
    const improved = await E.makeArtwork(regular, model, target, { mode: 'auto', budget: .7, perception: .35 }), after = improved.variant || regular;
    assert(regular.validation.ok); assert(before.validation.ok); assert(after.validation.ok); assert(E.payloadOK(after.bytes, model)); assert.deepEqual(Array.from(regular.matrix), Array.from(initial));
    assert.deepEqual(Array.from(after.bytes), Array.from(before.bytes)); assert.equal(after.text, before.text); if (c.fixed) assert.equal(after.text, segments[0].text);
    const row = { name, segments, baselineSeconds: baseSeconds, newDrawingSeconds: (performance.now() - began) / 1000, previous: summarize(before, target), current: summarize(after, target), regular: summarize(regular, target), note: improved.reason };
    row.budgets = [];
    for (const budget of [0, .5, .7, .9]) {
      const a = budget === .7 ? after : (await E.makeArtwork(regular, model, target, { mode: 'auto', budget })).variant || regular;
      assert(a.validation.ok); assert.deepEqual(Array.from(a.bytes), Array.from(regular.bytes));
      row.budgets.push({ budget, mode: a.rendering?.mode || 'modules', core: a.rendering?.core || 1, changedWords: a.changedWords || 0, renderMetrics: E.renderedMetrics(a, target), blocks: a.validation.blocks });
    }
    row.percentagePointChange = 100 * (row.current.renderMetrics.raw - row.previous.renderMetrics.raw); rows.push(row);
    save(regular, `${name}-regular.png`); save(before, `${name}-previous.png`); save(after, `${name}-current.png`);
    fs.writeFileSync(path.join(output, `${name}-current.svg`), E.candidateSvg(after));
    console.log(JSON.stringify({ name, previous: row.previous.renderMetrics.raw, current: row.current.renderMetrics.raw, difference: row.percentagePointChange, mode: row.current.mode, core: row.current.core, seconds: row.newDrawingSeconds }));
  }
  fs.writeFileSync(path.join(output, 'benchmark.json'), JSON.stringify({ node: process.version, baselineRef, settings, method: 'Same pristine QR candidate, exact payload bytes, QR version, ECC, mask and rotation for each before/after pair. Baseline full pipeline chooses its best square-module artwork. New drawing receives that same pristine candidate, tries square artwork plus the pristine centers, and chooses a verified picture. Both drawings measured by normalized luminance MAE at 8 pixels/module, excluding the quiet zone but including protected structure. Binary geometry uses a repeated module target; the photograph uses the supplied 147x147 RGB image. These are five fixtures, not an arbitrary-image quality or real-camera guarantee.', rows }, null, 2) + '\n');
})().catch(e => { console.error(e); process.exitCode = 1; });
