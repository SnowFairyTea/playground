// Reproducible algorithm comparison, not a browser screenshot or camera test.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PNG } = require('pngjs');
const E = require('../../assets/image-qr-engine.js');
const legacy = require('./legacy-greedy.cjs');
const output = path.resolve(__dirname, '../../apps/image-qr-optimizer/verification');
const settings = { version: 8, ecc: 'M', masks: 'all', rotations: [0], passes: 3, reserve: 8, samples: 64, seed: 7, seconds: 20, candidates: 1, perception: 0, fullCharset: true };
const segments = [{ kind: 'fixed', text: 'https://example.com/#' }, { kind: 'variable', length: 128, allowed: E.URLSAFE }];
const shapes = {
  ring: (x, y) => Math.hypot(x, y) > .19 && Math.hypot(x, y) < .35,
  diagonal: (x, y) => Math.abs(x - y) < .11 && Math.max(Math.abs(x), Math.abs(y)) < .36,
  heart: (x, y) => { x *= 3.8; y *= -3.8; return (x * x + y * y - 1) ** 3 - x * x * y ** 3 <= 0; }
};
function png(matrix, size, filename) {
  const r = E.renderRGBA(matrix, size, 8, 4);
  fs.writeFileSync(path.join(output, filename), PNG.sync.write({ width: r.width, height: r.height, data: Buffer.from(r.data) }));
}
(async () => {
  fs.mkdirSync(output, { recursive: true }); const rows = [];
  for (const [name, shape] of Object.entries(shapes)) {
    const size = settings.version * 4 + 17, bits = Uint8Array.from({ length: size * size }, (_, j) => Number(shape((j % size + .5) / size - .5, (Math.floor(j / size) + .5) / size - .5)));
    const target = { size, bits, weights: new Float32Array(bits.length).fill(1), hard: new Int8Array(bits.length).fill(-1) };
    const old = legacy(segments, target, settings);
    const result = await E.search({ segments, target, settings }), current = result.candidates[0];
    assert(current.validation.ok); assert(old.candidate.validation.ok);
    const row = { shape: name, legacy: { weighted: old.candidate.metrics.weighted, seconds: old.seconds, decoded: old.candidate.validation.decodeOK }, completed: { weighted: current.metrics.weighted, seconds: result.stats.seconds, decoded: current.validation.decodeOK, encoderDiff: current.validation.encoderDiff, charsetMoves: current.charsetMoves, conditions: result.stats.attempted }, percentagePointChange: 100 * (current.metrics.weighted - old.candidate.metrics.weighted) };
    rows.push(row); console.log(JSON.stringify(row));
    png(bits, size, `${name}-target.png`); png(old.candidate.matrix, size, `${name}-legacy.png`); png(current.matrix, size, `${name}-completed.png`);
    fs.writeFileSync(path.join(output, `${name}-completed.svg`), E.svg(current.matrix, size));
  }
  const report = { baselineCommit: '79b4ce97f8a726b5a4b173cee8f93cb45b41ba85', node: process.version, settings, segments, method: 'The previous greedy candidate-selection algorithm is reconstructed using shared mapping/linear algebra. Its automatic safety reduction is disabled. Both runs use all masks, three passes and the same seed; the new run adds exact residual enumeration and local refinement within 20 seconds. This compares achieved quality, not equal runtime or equal evaluation count. Uniform weights, no hard constraints; objective is pixel agreement (perception=0).', rows };
  fs.writeFileSync(path.join(output, 'benchmark.json'), JSON.stringify(report, null, 2) + '\n');
})().catch(e => { console.error(e); process.exitCode = 1; });
