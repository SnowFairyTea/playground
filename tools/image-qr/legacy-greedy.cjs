// Benchmark-only reconstruction of the previous optimizer at commit
// 79b4ce97f8a726b5a4b173cee8f93cb45b41ba85, index.html:
// greedySoftSystem, shuffleEqualWeights, randomSolutionWithRng and scoreX.
// Uses the same QR mapping and exact GF(2) solver as the new engine so the
// comparison isolates candidate selection. The old automatic safety reduction
// is deliberately excluded: all 8 masks, 3 passes and 64 samples are retained.
const E = require('../../assets/image-qr-engine.js');
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function oldGreedy(mapping, model, target, reserve, seed) {
  const h = E.hardSystem(mapping, target.hard); if (!h.ok) return null;
  const system = h.system, maximum = Math.max(system.rows.size, model.variables.length - reserve), random = rng(seed);
  const indices = Array.from(target.weights, (_, i) => i).filter(i => target.weights[i] > 0 && target.hard[i] < 0);
  indices.sort((a, b) => target.weights[b] - target.weights[a] || a - b);
  let start = 0;
  while (start < indices.length) {
    let end = start + 1;
    while (end < indices.length && target.weights[indices[end]] === target.weights[indices[start]]) end++;
    for (let i = end - 1; i > start; i--) { const j = start + Math.floor(random() * (i - start + 1)); [indices[i], indices[j]] = [indices[j], indices[i]]; }
    start = end;
  }
  for (const j of indices) { if (system.rows.size >= maximum) break; system.add(mapping.rows[j], target.bits[j] ^ mapping.m0[j]); }
  return system.solve(model.variables.length);
}
module.exports = function legacy(segments, target, settings) {
  const started = performance.now(), model = E.makeModel(segments), base = E.buildMapping(model, settings.version, settings.ecc), pool = [];
  for (let mask = 0; mask < 8; mask++) {
    const mapping = E.orient(base, Uint8Array.from(E.encode(model.baseline, settings.version, settings.ecc, mask).modules.data), 0);
    for (let pass = 0; pass < settings.passes; pass++) {
      const g = oldGreedy(mapping, model, target, settings.reserve, (settings.seed + mask * 1009 + pass * 9176) | 0); if (!g) continue;
      const random = rng((settings.seed ^ mask * 2654435761 ^ pass * 2246822519) | 0);
      for (let k = 0; k < settings.samples; k++) {
        let x = g.particular; if (k) for (const b of g.nullBasis) if (random() < .5) x ^= b;
        const matrix = E.predict(mapping, x), metrics = new E.Loss(matrix, target.bits, target.weights, target.size, 0).metrics();
        pool.push({ version: settings.version, ecc: settings.ecc, mask, rotation: 0, size: target.size, matrix, bytes: E.applyX(model, x), metrics });
      }
    }
  }
  pool.sort((a, b) => b.metrics.weighted - a.metrics.weighted);
  const candidate = pool[0]; candidate.validation = E.verify(candidate, model, target);
  return { candidate, seconds: (performance.now() - started) / 1000 };
};
