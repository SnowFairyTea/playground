// Artwork comparison at identical encoded bytes, QR size and ECC.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PNG } = require('pngjs');
const E = require('../../assets/image-qr-engine.js');
const output = path.resolve(__dirname, '../../apps/image-qr-optimizer/verification/artistic');
const size = 49, target = { size, bits: Uint8Array.from({ length: size * size }, (_, j) => { const r = Math.hypot((j % size + .5) / size - .5, (Math.floor(j / size) + .5) / size - .5); return Number(r > .19 && r < .35); }) };
const settings = { version: 8, ecc: 'M', masks: 'all', rotations: [0], passes: 3, reserve: 8, samples: 64, seed: 1, seconds: 20, candidates: 1, perception: .35, fullCharset: true, encoding: 'byte', artistic: true, artisticBudget: .7 };
const cases = {
  fixed: [{ kind: 'fixed', text: 'https://example.com/qr-art?theme=green#demo' }],
  variable: [{ kind: 'fixed', text: 'https://example.com/#' }, { kind: 'variable', length: 128, allowed: E.URLSAFE }]
};
function png(matrix, filename) {
  const r = E.renderRGBA(matrix, size, 8, 4);
  fs.writeFileSync(path.join(output, filename), PNG.sync.write({ width: r.width, height: r.height, data: Buffer.from(r.data) }));
}
(async () => {
  fs.mkdirSync(output, { recursive: true }); png(target.bits, 'target.png'); const rows = [];
  for (const [name, segments] of Object.entries(cases)) {
    const result = await E.search({ segments, target, settings }), c = result.candidates[0], a = c.artistic;
    assert(c.validation.ok); assert(a?.validation.ok, c.artisticNote); assert.deepEqual(a.bytes, c.bytes);
    const row = { name, segments, text: c.text, mask: c.mask, regular: c.metrics, artistic: a.metrics, percentagePointChange: 100 * (a.metrics.raw - c.metrics.raw), changedModules: a.changedModules, changedWords: a.changedWords, validation: a.validation, backoffSteps: a.backoffSteps };
    rows.push(row); console.log(JSON.stringify({ name, regular: c.metrics.raw, artistic: a.metrics.raw, changedModules: a.changedModules, changedWords: a.changedWords, decoded: a.validation.decodeOK }));
    png(c.matrix, `${name}-regular.png`); png(a.matrix, `${name}-artistic.png`);
    fs.writeFileSync(path.join(output, `${name}-artistic.svg`), E.svg(a.matrix, size));
  }
  fs.writeFileSync(path.join(output, 'benchmark.json'), JSON.stringify({ node: process.version, settings, method: 'Only the post-encoding matrix changes between each pair. The full decoded bytes, Version, ECC, mask, rotation and quiet zone are identical. Generated geometric target, uniform weights, no hard constraints. The artwork uses at most 70% of each RS block correction capacity and must decode at 2, 4 and 8 pixels per module.', rows }, null, 2) + '\n');
})().catch(e => { console.error(e); process.exitCode = 1; });
