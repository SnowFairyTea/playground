// Compare complete, verified outputs with the previous committed engine.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const { PNG } = require('pngjs');
const E = require('../../assets/image-qr-engine.js');
const root = path.resolve(__dirname, '../..'), output = path.join(root, 'apps/image-qr-optimizer/verification/completion');
const baselineRef = '36be09c07c8ee9bc15be178f51f65fb452aa6d6b';
const oldSource = execFileSync('git', ['show', `${baselineRef}:assets/image-qr-engine.js`], { cwd: root, encoding: 'utf8' });
const context = { module: { exports: {} }, TextEncoder, TextDecoder, performance, setTimeout, require: createRequire(path.join(root, 'assets/image-qr-engine.js')) };
vm.runInNewContext(oldSource, context, { filename: 'previous-image-qr-engine.js' });
const old = context.module.exports;
const size = 49, settings = { version: 8, ecc: 'M', masks: 'all', rotations: [0], passes: 3, reserve: 8, samples: 64, seed: 1, seconds: 20, candidates: 1, perception: .35, fullCharset: true, encoding: 'byte', artistic: true, artisticBudget: .7 };
const cases = {
  ring: { draw: (x, y) => Math.hypot(x, y) > .19 && Math.hypot(x, y) < .35 },
  diagonal: { draw: (x, y) => Math.abs(x - y) < .11 && Math.max(Math.abs(x), Math.abs(y)) < .36 },
  heart: { draw: (x, y) => { x *= 3.8; y *= -3.8; return (x * x + y * y - 1) ** 3 - x * x * y ** 3 <= 0; } },
  'fixed-url': { draw: (x, y) => Math.hypot(x, y) > .19 && Math.hypot(x, y) < .35, fixed: true }
};
function png(matrix, filename) {
  const r = E.renderRGBA(matrix, size, 6, 4);
  fs.writeFileSync(path.join(output, filename), PNG.sync.write({ width: r.width, height: r.height, data: Buffer.from(r.data) }));
}
(async () => {
  fs.mkdirSync(output, { recursive: true }); const rows = [];
  for (const [name, fixture] of Object.entries(cases)) {
    const segments = fixture.fixed ? [{ kind: 'fixed', text: 'https://example.com/qr-art?theme=green#demo' }] : [{ kind: 'fixed', text: 'https://example.com/#' }, { kind: 'variable', length: 128, allowed: E.URLSAFE }];
    const target = { size, bits: Uint8Array.from({ length: size * size }, (_, j) => Number(fixture.draw((j % size + .5) / size - .5, (Math.floor(j / size) + .5) / size - .5))) };
    png(target.bits, `${name}-target.png`); const row = { name, segments };
    for (const [label, engine] of [['previous', old], ['current', E]]) {
      const result = await engine.search({ segments, target, settings }), regular = result.candidates[0], completed = regular.artistic || regular;
      assert(regular.validation.ok); assert(completed.validation.ok);
      assert(completed.bytes.every((b, i) => b === regular.bytes[i]));
      const model = engine.makeModel(segments); assert(engine.payloadOK(completed.bytes, model));
      if (fixture.fixed) assert.equal(completed.text, segments[0].text);
      row[label] = { text: completed.text, regular: regular.metrics, finished: completed.metrics, mask: regular.mask, changedModules: completed.changedModules || 0, changedWords: completed.changedWords || 0, seconds: result.stats.seconds, artisticTested: result.stats.artisticTested ?? 1, validation: completed.validation };
      png(completed.matrix, `${name}-${label}.png`);
      if (label === 'current') fs.writeFileSync(path.join(output, `${name}-current.svg`), E.svg(completed.matrix, size, 6));
      console.log(JSON.stringify({ name, label, raw: completed.metrics.raw, score: completed.metrics.visual, seconds: result.stats.seconds }));
    }
    row.percentagePointChange = 100 * (row.current.finished.raw - row.previous.finished.raw); rows.push(row);
  }
  fs.writeFileSync(path.join(output, 'benchmark.json'), JSON.stringify({ node: process.version, baselineRef, settings, method: 'Full pipelines, at the same 20-second regular search budget, 49x49 modules, ECC M, Byte encoding, allowed alphabet and variable length. Artwork uses at most 70% of the correction capacity of each RS block. Previous selects a regular candidate first; current ranks a wider queue by completed and verified artwork and adapts automatic Byte spaces to the image. Validation overhead is additional and measured. Variable payloads and selected masks may differ between methods. Fixtures are generated geometry, not a general image-quality or camera benchmark. Timed searches may vary with hardware.', rows }, null, 2) + '\n');
})().catch(e => { console.error(e); process.exitCode = 1; });
