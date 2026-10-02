// Compare encoding choices at the same QR size, ECC and search budget.
// Fixtures are generated geometry; no uploaded user images are included.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PNG } = require('pngjs');
const E = require('../../assets/image-qr-engine.js');
const output = path.resolve(__dirname, '../../apps/image-qr-optimizer/verification/numeric');
const settings = { version: 8, ecc: 'M', masks: 'all', rotations: [0], passes: 3, reserve: 8, samples: 64, seed: 1, seconds: 20, candidates: 1, perception: .35, fullCharset: true };
const input = [{ kind: 'fixed', text: 'https://example.com/#' }, { kind: 'variable', length: 1, allowed: E.URLSAFE }];
const shapes = {
  ring: (x, y) => Math.hypot(x, y) > .19 && Math.hypot(x, y) < .35,
  diagonal: (x, y) => Math.abs(x - y) < .11 && Math.max(Math.abs(x), Math.abs(y)) < .36,
  heart: (x, y) => { x *= 3.8; y *= -3.8; return (x * x + y * y - 1) ** 3 - x * x * y ** 3 <= 0; }
};
function png(matrix, size, name) {
  const r = E.renderRGBA(matrix, size, 8, 4);
  fs.writeFileSync(path.join(output, name), PNG.sync.write({ width: r.width, height: r.height, data: Buffer.from(r.data) }));
}
(async () => {
  fs.mkdirSync(output, { recursive: true }); const rows = [];
  for (const [shape, draw] of Object.entries(shapes)) {
    const size = settings.version * 4 + 17;
    const bits = Uint8Array.from({ length: size ** 2 }, (_, j) => Number(draw((j % size + .5) / size - .5, (Math.floor(j / size) + .5) / size - .5)));
    const target = { size, bits }, row = { shape };
    png(bits, size, `${shape}-target.png`);
    for (const encoding of ['byte', 'numeric']) {
      const config = { ...settings, encoding }, length = E.maxVariableLength(input, 1, config);
      const segments = [input[0], { ...input[1], length }];
      const result = await E.search({ segments, target, settings: config }), candidate = result.candidates[0];
      assert(candidate.validation.ok); assert(candidate.text.startsWith(input[0].text));
      const m = candidate.metrics;
      row[encoding] = { length, raw: m.raw, weighted: m.weighted, blackRecall: m.blackRecall, backgroundBlack: m.backgroundBlack, score: m.visual, seconds: result.stats.seconds, mask: candidate.mask, conditions: result.stats.attempted, decoded: candidate.validation.decodeOK, encoderDiff: candidate.validation.encoderDiff };
      png(candidate.matrix, size, `${shape}-${encoding}.png`);
      fs.writeFileSync(path.join(output, `${shape}-${encoding}.svg`), E.svg(candidate.matrix, size));
      console.log(JSON.stringify({ shape, encoding, ...row[encoding] }));
    }
    row.percentagePointChange = 100 * (row.numeric.raw - row.byte.raw); rows.push(row);
  }
  const report = { node: process.version, settings, input, method: 'Both modes use the same 49×49 QR, ECC M, fixed URL prefix, allowed alphabet, masks, seed and 20-second search budget. Each fills the remaining QR capacity, so the variable character counts differ. Only numeric mode restricts the eligible variable part to digits and encodes it as Numeric. The current optimizer is used on both sides. These are achieved results; timing and candidates may vary with hardware. All targets use uniform weights and no hard constraints.', rows };
  fs.writeFileSync(path.join(output, 'benchmark.json'), JSON.stringify(report, null, 2) + '\n');
})().catch(e => { console.error(e); process.exitCode = 1; });
