/* Payload search produces pristine QR codes. Optional artwork is verified separately. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./qrcode.min.js'), require('./vendor/image-qr/qrcodegen.js'), require('./vendor/image-qr/jsQR.js'));
  else root.ImageQrEngine = factory(root.QRCode, root.qrcodegen, root.jsQR);
})(globalThis, function (QRCode, qrcodegen, jsQR) {
  'use strict';
  const utf8 = new TextEncoder(), text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const URLSAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const DIGITS = Array.from({ length: 10 }, (_, i) => 48 + i);
  const affineCache = new Map();
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const now = () => performance.now();
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  function integer(value, min, max, label) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label}: ${min}〜${max}の整数を指定してください。`);
    return n;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function shuffle(a, random) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function parity(x) { let p = 0; while (x) { p ^= 1; x &= x - 1n; } return p; }
  function bitIndices(x) { const s = x.toString(2), out = []; for (let i = 0; i < s.length; i++) if (s[s.length - 1 - i] === '1') out.push(i); return out; }
  function allowedBytes(seg) {
    const forbidden = new Set(Array.from(seg.forbidden || '')), bytes = [];
    for (const ch of new Set(Array.from(seg.allowed == null ? URLSAFE : seg.allowed))) {
      if (forbidden.has(ch)) continue;
      if (ch.codePointAt(0) > 127) throw new Error('可変部分はASCII文字を指定してください。固定部分には日本語も使用できます。');
      bytes.push(ch.charCodeAt(0));
    }
    if (!bytes.length) throw new Error('禁止文字を除いた使用可能文字が空です。');
    return bytes.sort((a, b) => a - b);
  }
  function* bases(n, k) {
    function* pivots(start, left, acc) {
      if (!left) { yield acc; return; }
      for (let p = start; p <= n - left; p++) yield* pivots(p + 1, left - 1, acc.concat(p));
    }
    for (const ps of pivots(0, k, [])) {
      const set = new Set(ps), free = [];
      for (let r = 0; r < k; r++) for (let c = ps[r] + 1; c < n; c++) if (!set.has(c)) free.push([r, c]);
      for (let bits = 0; bits < 2 ** free.length; bits++) {
        const rows = ps.map(p => 1 << p);
        for (let i = 0; i < free.length; i++) if ((bits >>> i) & 1) rows[free[i][0]] |= 1 << free[i][1];
        yield rows;
      }
    }
  }
  function analyzeCharset(bytes, limit = 8) {
    const key = bytes.join(',') + ':' + limit;
    if (affineCache.has(key)) return affineCache.get(key);
    const allowed = new Uint8Array(128); bytes.forEach(b => { allowed[b] = 1; });
    for (let dim = Math.floor(Math.log2(bytes.length)); dim >= 0; dim--) {
      const candidates = [];
      for (const basis of bases(7, dim)) {
        const span = [0];
        for (const v of basis) { const len = span.length; for (let i = 0; i < len; i++) span.push(span[i] ^ v); }
        const visited = new Uint8Array(128);
        for (let base = 0; base < 128; base++) {
          if (visited[base]) continue;
          const elements = span.map(v => base ^ v);
          elements.forEach(v => { visited[v] = 1; });
          if (elements.every(v => allowed[v])) {
            elements.sort((a, b) => a - b);
            candidates.push({ dim, base: elements[0], basis: basis.slice(), elements });
            if (candidates.length >= limit) break;
          }
        }
        if (candidates.length >= limit) break;
      }
      if (candidates.length) {
        const result = { maxDim: dim, allowed: bytes.slice(), candidates };
        affineCache.set(key, result); return result;
      }
    }
    throw new Error('文字集合を解析できませんでした。');
  }
  function makeModel(segments, lengths, options = {}) {
    const bytes = [], positions = [], variables = [], analyses = [], parts = [], numericUnits = []; let vi = 0;
    function addPart(mode, offset, length) {
      if (!length) return;
      const previous = parts[parts.length - 1];
      if (mode === 'byte' && previous?.mode === 'byte') previous.length += length;
      else parts.push({ mode, offset, length });
    }
    for (let si = 0; si < segments.length; si++) {
      const seg = segments[si];
      if (seg.kind === 'fixed') {
        const fixed = String(seg.text || ''), encoded = utf8.encode(fixed);
        if (text.decode(encoded) !== fixed) throw new Error('固定文字列に不正なUnicode文字があります。');
        addPart('byte', bytes.length, encoded.length);
        bytes.push(...encoded);
      } else if (seg.kind === 'variable') {
        const allowed = allowedBytes(seg), numeric = options.encoding === 'numeric' && DIGITS.every(b => allowed.includes(b));
        const length = integer(lengths?.[vi] ?? seg.length ?? 8, 1, numeric ? 7089 : 2953, '可変部分の長さ'), start = bytes.length;
        if (numeric) {
          addPart('numeric', start, length);
          const before = variables.length;
          for (let offset = 0; offset < length; offset += 3) {
            const digits = Math.min(3, length - offset), width = [0, 4, 7, 10][digits], unit = numericUnits.length;
            numericUnits.push({ offset: start + offset, length: digits, width, max: 10 ** digits - 1, base: 0, part: parts.length - 1 });
            // A guaranteed-valid initial subspace: 000–511, 00–63 or 0–7.
            for (let bit = 0; bit < width - 1; bit++) variables.push({ unit, vector: 1 << bit });
          }
          for (let p = 0; p < length; p++) { bytes.push(48); positions.push({ offset: start + p, allowed: DIGITS, segment: si, charIndex: p, numeric: true }); }
          analyses.push({ segment: si, encoding: 'numeric', allowed: allowed.length, selected: 10, dimension: (variables.length - before) / length, totalBits: variables.length - before, selectedCharacters: '0123456789', candidates: [] });
          vi++; continue;
        }
        const analysis = analyzeCharset(allowed);
        const choice = seg.affineChoice === 'auto' || seg.affineChoice == null ? 0 : integer(seg.affineChoice, 0, analysis.candidates.length - 1, 'アフィン候補');
        const affine = analysis.candidates[choice];
        addPart('byte', start, length);
        analyses.push({ segment: si, allowed: allowed.length, dimension: affine.dim, selected: affine.elements.length, selectedCharacters: String.fromCharCode(...affine.elements), candidates: analysis.candidates.map(a => ({ characters: String.fromCharCode(...a.elements), dimension: a.dim })) });
        for (let p = 0; p < length; p++) {
          const offset = bytes.length; bytes.push(affine.base);
          positions.push({ offset, allowed, segment: si, charIndex: p });
          affine.basis.forEach(vector => variables.push({ offset, vector }));
        }
        vi++;
      } else throw new Error('セグメントの種類が不正です。');
    }
    if (bytes.length > (numericUnits.length ? 7089 : 2953)) throw new Error('QRコードの最大容量を超えています。');
    return { baseline: Uint8Array.from(bytes), positions, variables, analyses, parts, numericUnits };
  }
  function encode(bytes, version, ecc, mask, model) {
    const opts = { errorCorrectionLevel: ecc || 'M' };
    if (version != null) opts.version = version;
    if (mask != null) opts.maskPattern = mask;
    const parts = model?.parts?.length ? model.parts : [{ mode: 'byte', offset: 0, length: bytes.length }];
    return QRCode.create(parts.map(p => ({ data: text.decode(bytes.slice(p.offset, p.offset + p.length)), mode: p.mode })), opts);
  }
  function numericValues(model, x) {
    const values = model.numericUnits.map(u => u.base);
    for (const i of bitIndices(x)) { const v = model.variables[i]; if (v.unit != null) values[v.unit] ^= v.vector; }
    return values;
  }
  function applyX(model, x) {
    const bytes = model.baseline.slice();
    for (const i of bitIndices(x)) { const v = model.variables[i]; if (v.unit == null) bytes[v.offset] ^= v.vector; }
    if (model.numericUnits?.length) numericValues(model, x).forEach((value, i) => {
      const unit = model.numericUnits[i];
      if (value > unit.max) throw new Error('数字用の符号化範囲を超えた候補です。');
      bytes.set(utf8.encode(String(value).padStart(unit.length, '0')), unit.offset);
    });
    return bytes;
  }
  function payloadBits(model, version) {
    return model.parts.reduce((sum, p) => sum + 4 + (p.mode === 'numeric' ? (version < 10 ? 10 : version < 27 ? 12 : 14) + Math.floor(p.length / 3) * 10 + [0, 4, 7][p.length % 3] : (version < 10 ? 8 : 16) + p.length * 8), 0);
  }
  function maxVariableLength(segments, index, settings) {
    if (segments[index]?.kind !== 'variable') throw new Error('可変部分を指定してください。');
    const version = settings.version === 'auto' ? settings.versionMax : settings.version;
    const capacity = qrcodegen.QrCode.getNumDataCodewords(version, eccInfo(settings.ecc)) * 8;
    const numeric = settings.encoding === 'numeric' && DIGITS.every(b => allowedBytes(segments[index]).includes(b));
    let low = 0, high = numeric ? 7089 : 2953;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2), parts = segments.map((s, i) => i === index ? { ...s, length: mid } : s); let fits = false;
      try { fits = payloadBits(makeModel(parts, undefined, settings), version) <= capacity; } catch { /* Over capacity. */ }
      if (fits) low = mid; else high = mid - 1;
    }
    if (!low) throw new Error('他の固定・可変部分だけで、このVersionの容量に達しています。');
    return low;
  }
  function payloadOK(bytes, model) {
    if (bytes.length !== model.baseline.length) return false;
    const positions = new Map(model.positions.map(p => [p.offset, p]));
    return bytes.every((b, i) => positions.has(i) ? positions.get(i).allowed.includes(b) : b === model.baseline[i]);
  }
  function eccInfo(ecc) { return { L: qrcodegen.QrCode.Ecc.LOW, M: qrcodegen.QrCode.Ecc.MEDIUM, Q: qrcodegen.QrCode.Ecc.QUARTILE, H: qrcodegen.QrCode.Ecc.HIGH }[ecc]; }
  function blockLayout(version, ecc) {
    const q = qrcodegen.QrCode, ord = eccInfo(ecc).ordinal;
    const count = q.NUM_ERROR_CORRECTION_BLOCKS[ord][version], ec = q.ECC_CODEWORDS_PER_BLOCK[ord][version];
    const raw = Math.floor(q.getNumRawDataModules(version) / 8), short = Math.floor(raw / count), nshort = count - raw % count;
    const blocks = Array.from({ length: count }, (_, b) => ({ data: short - ec + (b >= nshort ? 1 : 0), ec, slots: [] }));
    const order = [], dataLocations = []; let slot = 0;
    for (let i = 0; i <= short - ec; i++) for (let b = 0; b < count; b++) if (i < blocks[b].data) { blocks[b].slots[i] = slot++; order.push([b, i]); }
    for (let i = 0; i < ec; i++) for (let b = 0; b < count; b++) { const pos = blocks[b].data + i; blocks[b].slots[pos] = slot++; order.push([b, pos]); }
    blocks.forEach((block, b) => { for (let p = 0; p < block.data; p++) dataLocations.push([b, p]); });
    return { blocks, order, dataLocations, raw };
  }
  function placement(symbol) {
    const n = symbol.modules.size, reserved = symbol.modules.reservedBit, cells = [];
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < n; v++) for (let k = 0; k < 2; k++) {
        const y = ((right + 1) & 2) === 0 ? n - 1 - v : v, j = y * n + right - k;
        if (!reserved[j]) cells.push(j);
      }
    }
    return cells;
  }
  // Independent GF(256) polynomial arithmetic, primitive polynomial x^8+x^4+x^3+x^2+1.
  function gfMul(a, b) { let v = 0; while (b) { if (b & 1) v ^= a; b >>>= 1; a <<= 1; if (a & 256) a ^= 0x11d; } return v; }
  const generators = new Map();
  function generator(degree) {
    if (generators.has(degree)) return generators.get(degree);
    let poly = [1], root = 1;
    for (let i = 0; i < degree; i++) {
      const next = Array(poly.length + 1).fill(0);
      poly.forEach((c, k) => { next[k] ^= c; next[k + 1] ^= gfMul(c, root); }); poly = next; root = gfMul(root, 2);
    }
    generators.set(degree, poly); return poly;
  }
  function rsRemainder(data, degree) {
    const work = Uint8Array.from([...data, ...Array(degree).fill(0)]), gen = generator(degree);
    for (let i = 0; i < data.length; i++) { const a = work[i]; if (a) for (let k = 1; k <= degree; k++) work[i + k] ^= gfMul(a, gen[k]); }
    return work.slice(data.length);
  }
  function xorColumns(columns, indices, size) {
    const flags = new Uint8Array(size), touched = [];
    for (const i of indices) for (const j of columns[i]) { if (!flags[j]) touched.push(j); flags[j] ^= 1; }
    return Uint32Array.from([...new Set(touched)].filter(j => flags[j]));
  }
  function buildMapping(model, version, ecc, report = () => {}) {
    const symbol = encode(model.baseline, version, ecc, 0, model), size = symbol.modules.size, total = size * size;
    const cells = placement(symbol), layout = blockLayout(version, ecc), impulseCache = new Map(), fullColumns = new Map();
    // Construct the RS-linear difference directly, rather than re-encoding a whole QR per variable.
    function column(index) {
      const dataIndex = index >>> 3, value = 128 >>> (index & 7);
      const [b, pos] = layout.dataLocations[dataIndex], block = layout.blocks[b], key = block.data + ':' + pos + ':' + block.ec;
      if (!impulseCache.has(key)) { const impulse = new Uint8Array(block.data); impulse[pos] = 1; impulseCache.set(key, rsRemainder(impulse, block.ec)); }
      const changes = [cells[block.slots[pos] * 8 + (index & 7)]], ec = impulseCache.get(key);
      for (let k = 0; k < ec.length; k++) {
        const v = gfMul(ec[k], value), slot = block.slots[block.data + k];
        for (let t = 0; t < 8; t++) if (v & (128 >>> t)) changes.push(cells[slot * 8 + t]);
      }
      return Uint32Array.from(changes);
    }
    let cursor = 0;
    for (const [partIndex, part] of model.parts.entries()) {
      cursor += 4 + (part.mode === 'numeric' ? (version < 10 ? 10 : version < 27 ? 12 : 14) : (version < 10 ? 8 : 16));
      if (part.mode === 'numeric') {
        model.numericUnits.forEach((u, i) => {
          if (u.part !== partIndex) return;
          for (let bit = 0; bit < u.width; bit++) fullColumns.set('n' + i + ':' + bit, column(cursor + Math.floor((u.offset - part.offset) / 3) * 10 + u.width - 1 - bit));
        });
        cursor += Math.floor(part.length / 3) * 10 + [0, 4, 7][part.length % 3];
      } else {
        for (const p of model.positions) if (!p.numeric && p.offset >= part.offset && p.offset < part.offset + part.length) {
          for (let bit = 0; bit < 7; bit++) fullColumns.set(p.offset + ':' + bit, column(cursor + (p.offset - part.offset) * 8 + 7 - bit));
        }
        cursor += part.length * 8;
      }
    }
    const columns = [], rows = Array(total).fill(0n);
    model.variables.forEach((v, i) => {
      const prefix = v.unit == null ? v.offset : 'n' + v.unit;
      const selected = []; for (let bit = 0; bit < 10; bit++) if (v.vector & (1 << bit)) selected.push(fullColumns.get(prefix + ':' + bit));
      const col = xorColumns(selected, selected.map((_, k) => k), total); columns.push(col);
      const x = 1n << BigInt(i); for (const j of col) rows[j] |= x;
      if ((i & 255) === 0) report({ stage: 'mapping', message: `画像に使える自由度を構築中 ${i + 1}/${model.variables.length}` });
    });
    const result = { size, rows, columns, fullColumns, reserved: Uint8Array.from(symbol.modules.reservedBit), m0: Uint8Array.from(symbol.modules.data), layout, cells };
    // Random and boundary checks against the original real encoder are mandatory.
    const random = rng(72431 + version), samples = [0n];
    if (model.variables.length) samples.push(1n, 1n << BigInt(model.variables.length - 1));
    for (let t = 0; t < 2; t++) { let x = 0n; for (let i = 0; i < model.variables.length; i++) if (random() < .5) x |= 1n << BigInt(i); samples.push(x); }
    for (const x of samples) {
      const actual = encode(applyX(model, x), version, ecc, 0, model).modules.data, predicted = predict(result, x);
      if (predicted.some((v, j) => v !== actual[j])) throw new Error('QR差分の自己検証に失敗しました。候補を出力しません。');
    }
    return result;
  }
  function rotateIndex(j, size, turns) {
    let r = Math.floor(j / size), c = j % size;
    for (let i = 0; i < turns; i++) [r, c] = [c, size - 1 - r];
    return r * size + c;
  }
  function rotate(data, size, turns) {
    turns = ((turns % 4) + 4) % 4; const out = new data.constructor(data.length);
    for (let i = 0; i < data.length; i++) out[rotateIndex(i, size, turns)] = data[i];
    return out;
  }
  function orient(mapping, m0, turns) {
    if (!turns) return { ...mapping, m0 };
    const rows = Array(mapping.rows.length); mapping.rows.forEach((v, i) => { rows[rotateIndex(i, mapping.size, turns)] = v; });
    const column = col => Uint32Array.from(col, j => rotateIndex(j, mapping.size, turns));
    return { ...mapping, m0: rotate(m0, mapping.size, turns), rows, reserved: rotate(mapping.reserved, mapping.size, turns), columns: mapping.columns.map(column), fullColumns: new Map([...mapping.fullColumns].map(([k, v]) => [k, column(v)])) };
  }
  function predict(mapping, x) { const out = mapping.m0.slice(); for (const i of bitIndices(x)) for (const j of mapping.columns[i]) out[j] ^= 1; return out; }
  class LinearSystem {
    constructor() { this.rows = new Map(); }
    add(a, b) {
      while (a) {
        const low = a & -a, row = this.rows.get(low);
        if (row) { a ^= row.a; b ^= row.b; } else { this.rows.set(low, { a, b }); return 'added'; }
      }
      return b ? 'conflict' : 'implied';
    }
    solve(n, includeNullspace = true) {
      const entries = [...this.rows.entries()].sort((a, b) => a[0] > b[0] ? -1 : 1);
      function complete(start, homogeneous) { let x = start; for (const [bit, row] of entries) if (parity(row.a & x) !== (homogeneous ? 0 : row.b)) x ^= bit; return x; }
      const nullBasis = [];
      if (includeNullspace) for (let i = 0; i < n; i++) { const bit = 1n << BigInt(i); if (!this.rows.has(bit)) nullBasis.push(complete(bit, true)); }
      return { particular: complete(0n, false), nullBasis, rank: this.rows.size };
    }
  }
  function hardSystem(mapping, hard) {
    const system = new LinearSystem();
    for (let j = 0; j < hard.length; j++) if (hard[j] >= 0 && system.add(mapping.rows[j], hard[j] ^ mapping.m0[j]) === 'conflict') return { ok: false, index: j };
    return { ok: true, system };
  }
  function mappingWithVariables(mapping, variables, m0) {
    const columns = [], rows = Array(mapping.rows.length).fill(0n);
    variables.forEach((v, i) => {
      const prefix = v.unit == null ? v.offset : 'n' + v.unit;
      const cols = []; for (let bit = 0; bit < 10; bit++) if (v.vector & (1 << bit)) cols.push(mapping.fullColumns.get(prefix + ':' + bit));
      const col = xorColumns(cols, cols.map((_, k) => k), rows.length); columns.push(col);
      const flag = 1n << BigInt(i); col.forEach(j => { rows[j] |= flag; });
    });
    return { ...mapping, rows, columns, m0 };
  }
  function numericSubspace(mapping, model, target) {
    if (!model.numericUnits.length) return { mapping, model };
    const variables = model.variables.filter(v => v.unit == null);
    model.numericUnits.forEach((u, unit) => {
      // Fix one suitable data bit to 0. Every remaining combination is a valid
      // decimal group. Pick its location to agree with this mask's target.
      let excluded = u.width - 1, best = Infinity;
      for (let bit = 0; bit < u.width; bit++) {
        if ((2 ** u.width - 1) - 2 ** bit > u.max) continue;
        const j = mapping.fullColumns.get('n' + unit + ':' + bit)[0];
        const cost = target.hard[j] >= 0 ? (target.hard[j] ^ mapping.m0[j]) * 1e6 : (target.bits[j] ^ mapping.m0[j]) * target.weights[j];
        if (cost < best) { best = cost; excluded = bit; }
      }
      for (let bit = 0; bit < u.width; bit++) if (bit !== excluded) variables.push({ unit, vector: 1 << bit });
    });
    return { model: { ...model, variables }, mapping: mappingWithVariables(mapping, variables, mapping.m0) };
  }
  const numericCubes = new Map();
  function numericCube(width, maximum, base) {
    const key = width + ':' + maximum + ':' + base;
    if (numericCubes.has(key)) return numericCubes.get(key);
    let best = 0, dimensions = -1;
    for (let mask = 0; mask < 2 ** width; mask++) if ((base | mask) <= maximum) {
      const count = bitIndices(BigInt(mask)).length;
      if (count > dimensions) { dimensions = count; best = mask; }
    }
    numericCubes.set(key, best); return best;
  }
  function repairNumericHard(mapping, model, hard, deadline) {
    const bytePositions = model.positions.filter(p => !p.numeric), byteStarts = new Map(), variables = [], starts = [];
    for (const p of bytePositions) { byteStarts.set(p.offset, variables.length); for (let bit = 0; bit < 7; bit++) variables.push({ offset: p.offset, vector: 1 << bit }); }
    model.numericUnits.forEach((u, unit) => { starts.push(variables.length); for (let bit = 0; bit < u.width; bit++) variables.push({ unit, vector: 1 << bit }); });
    const wideModel = { ...model, variables }, wide = mappingWithVariables(mapping, variables, mapping.m0), h = hardSystem(wide, hard);
    if (!h.ok) return null;
    let system = h.system, found = null; const stack = [];
    while (system && now() < deadline) {
      const x = system.solve(variables.length, false).particular, values = numericValues(wideModel, x);
      const invalid = values.findIndex((v, i) => v > model.numericUnits[i].max);
      if (invalid >= 0) {
        // A valid value must turn off at least one of this invalid value's 1s.
        stack.push({ system, unit: invalid, choices: bitIndices(BigInt(values[invalid])).reverse(), next: 0 });
      } else {
        const bytes = applyX(wideModel, x), p = bytePositions.find(p => !p.allowed.includes(bytes[p.offset]));
        if (!p) { found = { x, values, bytes }; break; }
        // Mixed payloads must also search the full allowed Byte domain.
        const choices = p.allowed.slice().sort((a, b) => bitIndices(BigInt(a ^ bytes[p.offset])).length - bitIndices(BigInt(b ^ bytes[p.offset])).length);
        stack.push({ system, position: p, choices, next: 0 });
      }
      system = null;
      while (stack.length && now() < deadline) {
        const frame = stack[stack.length - 1];
        if (frame.next === frame.choices.length) { stack.pop(); continue; }
        const choice = frame.choices[frame.next++], branch = new LinearSystem(); branch.rows = new Map(frame.system.rows); let ok = true;
        if (frame.position) {
          const offset = frame.position.offset;
          for (let bit = 0; bit < 7; bit++) if (branch.add(1n << BigInt(byteStarts.get(offset) + bit), ((choice ^ model.baseline[offset]) >>> bit) & 1) === 'conflict') { ok = false; break; }
        } else {
          ok = branch.add(1n << BigInt(starts[frame.unit] + choice), (model.numericUnits[frame.unit].base >>> choice) & 1) !== 'conflict';
        }
        if (ok) { system = branch; break; }
      }
    }
    if (!found) return null;
    const localVariables = [], numericUnits = model.numericUnits.map((u, i) => ({ ...u, base: found.values[i] }));
    for (const p of bytePositions) for (const vector of anchoredBasis(p.allowed, found.bytes[p.offset])) localVariables.push({ offset: p.offset, vector });
    numericUnits.forEach((u, unit) => { const cube = numericCube(u.width, u.max, u.base); for (let bit = 0; bit < u.width; bit++) if (cube & (1 << bit)) localVariables.push({ unit, vector: 1 << bit }); });
    return { model: { ...model, baseline: found.bytes, variables: localVariables, numericUnits }, mapping: mappingWithVariables(mapping, localVariables, predict(wide, found.x)) };
  }
  const anchoredCache = new Map();
  function anchoredBasis(allowed, anchor) {
    const key = allowed.join(',') + '/' + anchor; if (anchoredCache.has(key)) return anchoredCache.get(key);
    const domain = new Set(allowed);
    for (let dim = Math.floor(Math.log2(allowed.length)); dim >= 0; dim--) for (const basis of bases(7, dim)) {
      const span = [0]; for (const v of basis) { const n = span.length; for (let i = 0; i < n; i++) span.push(span[i] ^ v); }
      if (span.every(v => domain.has(anchor ^ v))) { anchoredCache.set(key, basis); return basis; }
    }
    return [];
  }
  function repairHardCharset(mapping, model, hard, deadline) {
    // The affine subset is a search tool, not a proof that the full allowed domain is infeasible.
    const variables = model.positions.flatMap(p => Array.from({ length: 7 }, (_, bit) => ({ offset: p.offset, vector: 1 << bit })));
    const wideModel = { ...model, variables }, wide = mappingWithVariables(mapping, variables, mapping.m0), h = hardSystem(wide, hard);
    if (!h.ok) return null;
    // Keep one pending branch per depth, rather than cloning all allowed
    // characters at once (which can multiply memory by the alphabet size).
    const stack = []; let found = null, system = h.system;
    while (system && now() < deadline) {
      const x = system.solve(variables.length, false).particular, bytes = applyX(wideModel, x);
      const pi = model.positions.findIndex(p => !p.allowed.includes(bytes[p.offset]));
      if (pi < 0) { found = { x, bytes }; break; }
      const p = model.positions[pi];
      const values = p.allowed.slice().sort((a, b) => bitIndices(BigInt(a ^ bytes[p.offset])).length - bitIndices(BigInt(b ^ bytes[p.offset])).length);
      stack.push({ system, pi, values, next: 0 }); system = null;
      while (stack.length && now() < deadline) {
        const pending = stack[stack.length - 1];
        if (pending.next === pending.values.length) { stack.pop(); continue; }
        const value = pending.values[pending.next++], offset = model.positions[pending.pi].offset;
        const branch = new LinearSystem(); branch.rows = new Map(pending.system.rows); let ok = true;
        for (let bit = 0; bit < 7; bit++) if (branch.add(1n << BigInt(pending.pi * 7 + bit), ((value ^ model.baseline[offset]) >>> bit) & 1) === 'conflict') { ok = false; break; }
        if (ok) { system = branch; break; }
      }
    }
    if (!found) return null;
    const localVariables = [];
    for (const p of model.positions) for (const vector of anchoredBasis(p.allowed, found.bytes[p.offset])) localVariables.push({ offset: p.offset, vector });
    const localModel = { ...model, baseline: found.bytes, variables: localVariables };
    return { model: localModel, mapping: mappingWithVariables(mapping, localVariables, predict(wide, found.x)) };
  }
  function greedy(mapping, target, weights, hard, count, reserve, seed, pass) {
    const h = hardSystem(mapping, hard); if (!h.ok) return null;
    const random = rng(seed), priorities = Array.from(weights, (w, i) => ({ i, p: w * (pass ? .8 + .4 * random() : 1), tie: random() }));
    priorities.sort((a, b) => b.p - a.p || a.tie - b.tie);
    const maxRank = Math.max(h.system.rows.size, count - reserve);
    for (const { i } of priorities) {
      if (h.system.rows.size >= maxRank) break;
      if (weights[i] > 0 && hard[i] < 0) h.system.add(mapping.rows[i], target[i] ^ mapping.m0[i]);
    }
    return h.system.solve(count);
  }
  class Loss {
    constructor(matrix, target, weights, size, perception = .35) {
      this.matrix = matrix.slice(); this.target = target; this.weights = weights; this.size = size; this.perception = perception;
      this.sum = weights.reduce((a, b) => a + b, 0) || 1;
      this.pixel = 0; this.scales = [2, 4, 8].map(scale => ({ scale, width: Math.ceil(size / scale), diff: new Float64Array(Math.ceil(size / scale) ** 2) }));
      for (let j = 0; j < matrix.length; j++) {
        const w = weights[j]; if (matrix[j] !== target[j]) this.pixel += w;
        for (const s of this.scales) s.diff[this.block(j, s)] += w * (matrix[j] - target[j]);
      }
      this.coarse = this.scales.reduce((a, s) => a + s.diff.reduce((b, d) => b + Math.abs(d), 0), 0);
    }
    block(j, s) { return Math.floor(Math.floor(j / this.size) / s.scale) * s.width + Math.floor((j % this.size) / s.scale); }
    value() { return ((1 - this.perception) * this.pixel + this.perception * this.coarse / this.scales.length) / this.sum; }
    delta(indices, commit = false) {
      let pixel = 0, coarse = 0;
      const changes = this.scales.map(() => new Map());
      for (const j of indices) {
        const w = this.weights[j]; pixel += (this.matrix[j] === this.target[j] ? 1 : -1) * w;
        this.scales.forEach((s, k) => { const b = this.block(j, s); changes[k].set(b, (changes[k].get(b) || 0) + (this.matrix[j] ? -w : w)); });
      }
      this.scales.forEach((s, k) => { for (const [b, d] of changes[k]) { coarse += Math.abs(s.diff[b] + d) - Math.abs(s.diff[b]); if (commit) s.diff[b] += d; } });
      if (commit) { for (const j of indices) this.matrix[j] ^= 1; this.pixel += pixel; this.coarse += coarse; }
      return ((1 - this.perception) * pixel + this.perception * coarse / this.scales.length) / this.sum;
    }
    metrics(reserved) {
      let match = 0, fixedMismatch = 0, black = 0, targetBlack = 0, trueBlack = 0, backgroundBlack = 0;
      for (let j = 0; j < this.matrix.length; j++) {
        if (this.matrix[j] === this.target[j]) match++; else if (reserved?.[j]) fixedMismatch++;
        black += this.matrix[j]; targetBlack += this.target[j];
        if (this.target[j]) trueBlack += this.matrix[j]; else backgroundBlack += this.matrix[j];
      }
      return { visual: clamp(1 - this.value(), 0, 1), weighted: clamp(1 - this.pixel / this.sum, 0, 1), raw: match / this.matrix.length, fixedMismatch, blackRate: black / this.matrix.length, targetBlackRate: targetBlack / this.matrix.length, blackRecall: targetBlack ? trueBlack / targetBlack : null, backgroundBlack: targetBlack < this.matrix.length ? backgroundBlack / (this.matrix.length - targetBlack) : null };
    }
  }
  function projectField(field, src, dst) {
    const out = new field.constructor(dst * dst);
    for (let r = 0; r < dst; r++) for (let c = 0; c < dst; c++) out[r * dst + c] = field[Math.min(src - 1, Math.floor((r + .5) * src / dst)) * src + Math.min(src - 1, Math.floor((c + .5) * src / dst))];
    return out;
  }
  function projectHard(hard, src, dst) {
    const out = new Int8Array(dst * dst); out.fill(-1);
    for (let j = 0; j < hard.length; j++) if (hard[j] >= 0) {
      const r = Math.floor(j / src), c = j % src;
      for (let y = Math.floor(r * dst / src); y < Math.ceil((r + 1) * dst / src); y++) for (let x = Math.floor(c * dst / src); x < Math.ceil((c + 1) * dst / src); x++) {
        const k = y * dst + x;
        if (out[k] >= 0 && out[k] !== hard[j]) throw new Error('このVersionでは絶対黒と絶対白の指定が同じマスに重なります。');
        out[k] = hard[j];
      }
    }
    return out;
  }
  function getTarget(options, version) {
    const n = version * 4 + 17, src = options.targets?.[version] || options.target;
    if (!src || src.error) throw new Error(src?.error || '目標画像がありません。');
    const size = src.size || Math.sqrt(src.bits.length), bits = Uint8Array.from(src.bits);
    if (!Number.isInteger(size) || bits.length !== size * size || bits.some(v => v > 1)) throw new Error('目標画像の寸法が不正です。');
    const weights = src.weights ? Float32Array.from(src.weights) : new Float32Array(bits.length).fill(1);
    const hard = src.hard ? Int8Array.from(src.hard) : new Int8Array(bits.length).fill(-1);
    if (weights.length !== bits.length || hard.length !== bits.length || weights.some(v => !Number.isFinite(v) || v < 0 || v > 1) || hard.some(v => v < -1 || v > 1)) throw new Error('重要度または絶対指定が不正です。');
    if (!weights.some(v => v > 0)) throw new Error('重要度がすべて0です。少なくとも一つの領域に重要度を設定してください。');
    return size === n ? { size, bits, weights, hard } : { size: n, bits: projectField(bits, size, n), weights: projectField(weights, size, n), hard: projectHard(hard, size, n) };
  }
  function improve(mapping, model, startX, hardSolution, tgt, settings, deadline, seed) {
    const random = rng(seed), n = mapping.size, loss = new Loss(predict(mapping, startX), tgt.bits, tgt.weights, n, settings.perception);
    let x = startX; const effects = new Map();
    const effect = k => { if (!effects.has(k)) effects.set(k, xorColumns(mapping.columns, bitIndices(hardSolution.nullBasis[k]), n * n)); return effects.get(k); };
    const order = shuffle(hardSolution.nullBasis.map((_, i) => i), random);
    for (let round = 0; round < 2 && now() < deadline; round++) {
      let changed = false;
      for (const k of order) {
        if (now() >= deadline) break;
        const e = effect(k);
        if (loss.delta(e) < -1e-10) { loss.delta(e, true); x ^= hardSolution.nullBasis[k]; changed = true; }
      }
      if (!changed) break;
      shuffle(order, random);
    }
    // Paired moves can undo decisions which single-coordinate descent cannot undo.
    for (let k = 0; k < Math.min(order.length * 2, 512) && order.length > 1 && now() < deadline; k++) {
      const a = Math.floor(random() * order.length), b = Math.floor(random() * order.length); if (a === b) continue;
      const e = xorColumns([effect(a), effect(b)], [0, 1], n * n);
      if (loss.delta(e) < -1e-10) { loss.delta(e, true); x ^= hardSolution.nullBasis[a] ^ hardSolution.nullBasis[b]; }
    }
    const bytes = applyX(model, x); let charsetMoves = 0;
    if (settings.fullCharset) {
      const positions = shuffle(model.positions.filter(p => !p.numeric), random);
      for (let round = 0; round < 2 && now() < deadline; round++) {
        let changed = false;
        for (const p of positions) {
          if (now() >= deadline) break;
          let best = 0, chosen = bytes[p.offset], chosenEffect = null;
          const cols = Array.from({ length: 7 }, (_, bit) => mapping.fullColumns.get(p.offset + ':' + bit));
          for (const value of p.allowed) {
            const d = value ^ bytes[p.offset]; if (!d) continue;
            const e = xorColumns(cols, Array.from({ length: 7 }, (_, b) => b).filter(b => d & (1 << b)), n * n);
            if (e.some(j => tgt.hard[j] >= 0)) continue;
            const delta = loss.delta(e); if (delta < best - 1e-10) { best = delta; chosen = value; chosenEffect = e; }
          }
          if (chosenEffect) { loss.delta(chosenEffect, true); bytes[p.offset] = chosen; charsetMoves++; changed = true; }
        }
        if (!changed) break;
      }
      for (const unit of shuffle((model.numericUnits || []).map((_, i) => i), random)) {
        if (now() >= deadline) break;
        const u = model.numericUnits[unit], current = Number(text.decode(bytes.slice(u.offset, u.offset + u.length)));
        const cols = Array.from({ length: u.width }, (_, bit) => mapping.fullColumns.get('n' + unit + ':' + bit));
        let best = 0, chosen = current, chosenEffect = null;
        for (const value of shuffle(Array.from({ length: u.max + 1 }, (_, i) => i), random)) {
          if (now() >= deadline) break;
          const difference = value ^ current; if (!difference) continue;
          const effect = xorColumns(cols, bitIndices(BigInt(difference)), n * n);
          if (effect.some(j => tgt.hard[j] >= 0)) continue;
          const delta = loss.delta(effect);
          if (delta < best - 1e-10) { best = delta; chosen = value; chosenEffect = effect; }
        }
        if (chosenEffect) { loss.delta(chosenEffect, true); bytes.set(utf8.encode(String(chosen).padStart(u.length, '0')), u.offset); charsetMoves++; }
      }
    }
    return { bytes, matrix: loss.matrix, metrics: loss.metrics(mapping.reserved), charsetMoves };
  }
  function renderRGBA(matrix, size, scale = 5, quiet = 4) {
    integer(scale, 1, 32, '1マスのピクセル数'); integer(quiet, 4, 32, '余白');
    const width = (size + quiet * 2) * scale, data = new Uint8ClampedArray(width * width * 4); data.fill(255);
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (matrix[r * size + c]) {
      for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) { const i = (((r + quiet) * scale + y) * width + (c + quiet) * scale + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; }
    }
    return { data, width, height: width, scale, quiet };
  }
  function reloadModules(raster, size) {
    const out = new Uint8Array(size * size);
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      const y = Math.floor((r + raster.quiet + .5) * raster.scale), x = Math.floor((c + raster.quiet + .5) * raster.scale), i = (y * raster.width + x) * 4;
      out[r * size + c] = raster.data[i] < 128 ? 1 : 0;
    }
    return out;
  }
  function maskBit(mask, r, c) {
    return [() => (r + c) % 2 === 0, () => r % 2 === 0, () => c % 3 === 0, () => (r + c) % 3 === 0, () => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0, () => (r * c) % 2 + (r * c) % 3 === 0, () => ((r * c) % 2 + (r * c) % 3) % 2 === 0, () => ((r + c) % 2 + (r * c) % 3) % 2 === 0][mask]();
  }
  function rsReport(matrix, reference, symbol, ecc, mask) {
    const layout = blockLayout(symbol.version, ecc), cells = placement(symbol), size = symbol.modules.size;
    function codewords(data) {
      const out = new Uint8Array(layout.raw);
      for (let i = 0; i < out.length * 8; i++) { const j = cells[i]; out[i >>> 3] |= (data[j] ^ Number(maskBit(mask, Math.floor(j / size), j % size))) << (7 - (i & 7)); }
      return out;
    }
    const actual = codewords(matrix), expected = codewords(reference);
    return layout.blocks.map(block => {
      const words = Uint8Array.from(block.slots, slot => actual[slot]); let errors = 0, syndromes = 0, root = 1;
      for (const slot of block.slots) if (actual[slot] !== expected[slot]) errors++;
      for (let k = 0; k < block.ec; k++) { let v = 0; for (const w of words) v = gfMul(v, root) ^ w; if (v) syndromes++; root = gfMul(root, 2); }
      return { dataWords: block.data, eccWords: block.ec, errors, nonzeroSyndromes: syndromes, remaining: Math.floor(block.ec / 2) - errors };
    });
  }
  function verify(candidate, model, target) {
    const { version, ecc, mask, rotation = 0, bytes, matrix } = candidate, size = version * 4 + 17;
    const payload = payloadOK(bytes, model), symbol = encode(bytes, version, ecc, mask, model);
    const parts = model.parts?.length ? model.parts : [{ mode: 'byte', offset: 0, length: bytes.length }];
    const independent = qrcodegen.QrCode.encodeSegments(parts.map(p => p.mode === 'numeric' ? qrcodegen.QrSegment.makeNumeric(text.decode(bytes.slice(p.offset, p.offset + p.length))) : qrcodegen.QrSegment.makeBytes(Array.from(bytes.slice(p.offset, p.offset + p.length)))), eccInfo(ecc), version, version, mask, false);
    const reference = Uint8Array.from({ length: size * size }, (_, j) => Number(independent.getModule(j % size, Math.floor(j / size))));
    const raster = renderRGBA(matrix, size), reload = reloadModules(raster, size), canonical = rotate(reload, size, (4 - rotation) % 4);
    const moduleReloadDiff = reload.reduce((s, v, j) => s + Number(v !== matrix[j]), 0);
    const encoderDiff = canonical.reduce((s, v, j) => s + Number(v !== reference[j]), 0);
    const actualDiff = canonical.reduce((s, v, j) => s + Number(v !== symbol.modules.data[j]), 0);
    const absolute = target.hard.every((v, j) => v < 0 || v === reload[j]);
    const decoded = jsQR(raster.data, raster.width, raster.height, { inversionAttempts: 'dontInvert' });
    const decodeOK = !!decoded && decoded.binaryData.length === bytes.length && decoded.binaryData.every((b, i) => b === bytes[i]);
    const blocks = rsReport(canonical, reference, symbol, ecc, mask), rsOK = blocks.every(b => b.errors === 0 && b.nonzeroSyndromes === 0);
    return { ok: payload && absolute && !encoderDiff && !actualDiff && !moduleReloadDiff && decodeOK && rsOK, payload, absolute, encoderDiff, actualDiff, moduleReloadDiff, decodeOK, rsOK, blocks };
  }
  function artworkBudget(value = .7) {
    const fraction = Number(value);
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > .9) throw new Error('加工に使う訂正余力は0〜90%で指定してください。');
    return fraction;
  }
  function wordBudget(ec, fraction) { return Math.min(Math.floor(ec / 2) - 1, Math.floor(Math.floor(ec / 2) * fraction)); }
  function verifyArtistic(variant, original, model, target, budget = .7) {
    const fraction = artworkBudget(budget), { version, ecc, mask, rotation = 0, bytes } = original, size = version * 4 + 17;
    const samePayload = variant.bytes.length === bytes.length && variant.bytes.every((b, i) => b === bytes[i]) && payloadOK(bytes, model);
    const sameShape = variant.version === version && variant.ecc === ecc && variant.mask === mask && (variant.rotation || 0) === rotation && variant.size === size && variant.matrix.length === size * size && variant.matrix.every(v => v === 0 || v === 1);
    if (!sameShape) return { ok: false, samePayload, sameShape };
    const symbol = encode(bytes, version, ecc, mask, model), reference = Uint8Array.from(symbol.modules.data), canonical = rotate(variant.matrix, size, (4 - rotation) % 4);
    const cells = placement(symbol), layout = blockLayout(version, ecc), editable = new Uint8Array(size * size);
    for (let bit = 0; bit < layout.raw * 8; bit++) editable[cells[bit]] = 1;
    // Finder, alignment, timing, format, version and remainder modules stay exact.
    const structuralOK = canonical.every((v, j) => editable[j] || v === reference[j]);
    const absolute = target.hard.every((v, j) => v < 0 || v === variant.matrix[j]);
    const blocks = rsReport(canonical, reference, symbol, ecc, mask).map(b => ({ ...b, budget: wordBudget(b.eccWords, fraction) }));
    const withinBudget = blocks.every(b => b.errors <= b.budget && b.remaining >= 1);
    const changedModules = canonical.reduce((sum, v, j) => sum + Number(v !== reference[j]), 0), scans = [];
    let moduleReloadDiff = 0;
    if (samePayload && structuralOK && absolute && withinBudget) for (const scale of [2, 4, 8]) {
      const raster = renderRGBA(variant.matrix, size, scale, 4), decoded = jsQR(raster.data, raster.width, raster.height, { inversionAttempts: 'dontInvert' });
      moduleReloadDiff += reloadModules(raster, size).reduce((sum, v, j) => sum + Number(v !== variant.matrix[j]), 0);
      scans.push({ scale, quiet: 4, ok: !!decoded && decoded.binaryData.length === bytes.length && decoded.binaryData.every((b, i) => b === bytes[i]) });
    }
    const decodeOK = scans.length === 3 && scans.every(s => s.ok);
    return { ok: samePayload && sameShape && structuralOK && absolute && withinBudget && decodeOK && !moduleReloadDiff, samePayload, sameShape, structuralOK, absolute, withinBudget, decodeOK, moduleReloadDiff, changedModules, scans, blocks };
  }
  async function makeArtistic(original, model, target, options = {}) {
    const fraction = artworkBudget(options.budget), perception = options.perception ?? .35;
    if (!verify(original, model, target).ok) throw new Error('加工元の正規QRが検証に合格しませんでした。');
    const { version, ecc, mask, rotation = 0, bytes } = original, size = version * 4 + 17;
    const symbol = encode(bytes, version, ecc, mask, model), cells = placement(symbol), layout = blockLayout(version, ecc);
    const loss = new Loss(original.matrix, target.bits, target.weights, size, perception), groups = [];
    for (let slot = 0; slot < layout.raw; slot++) {
      const indices = [];
      for (let bit = 0; bit < 8; bit++) {
        const j = rotateIndex(cells[slot * 8 + bit], size, rotation);
        if (target.hard[j] < 0 && target.weights[j] > 0 && original.matrix[j] !== target.bits[j]) indices.push(j);
      }
      if (indices.length) groups.push({ block: layout.order[slot][0], indices, used: false });
    }
    const used = layout.blocks.map(() => 0), limits = layout.blocks.map(b => wordBudget(b.ec, fraction)), moves = [], deadline = now() + 2000;
    // A whole codeword costs one correction regardless of how many of its bits
    // change. Re-rank its target-matching edits after each move for coarse loss.
    while (now() < deadline) {
      let best = null, delta = -1e-10;
      for (const group of groups) {
        if (group.used || used[group.block] >= limits[group.block]) continue;
        const value = loss.delta(group.indices);
        if (value < delta) { best = group; delta = value; }
      }
      if (!best) break;
      loss.delta(best.indices, true); best.used = true; used[best.block]++; moves.push(best);
      if (moves.length % 16 === 0) await tick();
    }
    let attempts = 0;
    while (moves.length) {
      const variant = { version, ecc, mask, rotation, size, bytes: bytes.slice(), text: text.decode(bytes), kind: 'artistic', matrix: loss.matrix.slice(), metrics: loss.metrics(rotate(symbol.modules.reservedBit, size, rotation)), budget: fraction };
      const validation = verifyArtistic(variant, original, model, target, fraction); attempts++;
      if (validation.ok) return { variant: { ...variant, validation, changedModules: validation.changedModules, changedWords: validation.blocks.reduce((sum, b) => sum + b.errors, 0), backoffSteps: attempts - 1 }, reason: '' };
      // Detection may fail despite correctable codewords. Back off and decode
      // the actual modified image again; never output a failed variant.
      const keep = Math.floor(moves.length * .7);
      while (moves.length > keep) loss.delta(moves.pop().indices, true);
      await tick();
    }
    return { variant: null, reason: attempts ? '加工量を減らしても読み取り検証を通る改善版が見つかりませんでした。正規版を保存できます。' : '指定と訂正余力の範囲内では、さらに絵へ近づけられるマスがありませんでした。正規版を保存できます。' };
  }
  function svg(matrix, size, scale = 8, quiet = 4) {
    integer(scale, 1, 32, '1マスのピクセル数'); integer(quiet, 4, 32, '余白');
    const total = size + quiet * 2, paths = [];
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (matrix[r * size + c]) paths.push(`M${c + quiet},${r + quiet}h1v1h-1z`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${total * scale}" height="${total * scale}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${paths.join('')}" fill="#000"/></svg>`;
  }
  function lengthPlan(segments, settings) {
    const vars = segments.filter(s => s.kind === 'variable');
    if (!settings.autoLength || !vars.length) return [vars.map(s => s.length)];
    const axes = vars.map(s => {
      const end = integer(s.length, 1, 7089, '探索終了'), start = integer(s.start ?? 1, 1, end, '探索開始');
      const step = integer(s.step || Math.max(1, Math.ceil((end - start) / Math.max(1, settings.coarsePoints - 1))), 1, 7089, '探索Step');
      const a = []; for (let i = start; i <= end; i += step) a.push(i); if (a[a.length - 1] !== end) a.push(end); return a;
    });
    const total = axes.reduce((n, a) => n * BigInt(a.length), 1n), cap = BigInt(settings.lengthTrials), out = [], seen = new Set();
    function add(index) { const row = []; for (let i = axes.length - 1; i >= 0; i--) { const len = BigInt(axes[i].length); row[i] = axes[i][Number(index % len)]; index /= len; } const key = row.join(':'); if (!seen.has(key)) { seen.add(key); out.push(row); } }
    add(total - 1n);
    if (total <= cap) for (let i = 0n; i < total; i++) add(i);
    else if (cap > 1n) for (let i = 0n; i < cap; i++) add(i * (total - 1n) / (cap - 1n));
    return out;
  }
  function normalizeSettings(input = {}) {
    const s = { encoding: 'byte', ecc: 'M', masks: 'all', version: 'auto', versionMin: 1, versionMax: 40, compareVersions: false, rotations: [0], passes: 3, reserve: 8, samples: 64, candidates: 6, seconds: 20, seed: 1, perception: .35, fullCharset: true, autoLength: false, lengthTrials: 12, coarsePoints: 6, refineRadius: 2, artistic: false, artisticBudget: .7, ...input };
    if (!['byte', 'numeric'].includes(s.encoding)) throw new Error('符号化方式が不正です。');
    if (!eccInfo(s.ecc)) throw new Error('誤り訂正レベルが不正です。');
    s.versionMin = integer(s.versionMin, 1, 40, '最小Version'); s.versionMax = integer(s.versionMax, s.versionMin, 40, '最大Version');
    if (s.version !== 'auto') s.version = integer(s.version, 1, 40, 'Version');
    if (s.masks !== 'all' && s.masks !== 'auto') s.masks = integer(s.masks, 0, 7, 'Mask');
    for (const [k, min, max] of [['passes', 1, 64], ['reserve', 0, 2048], ['samples', 1, 4096], ['candidates', 1, 24], ['seconds', 1, 600], ['lengthTrials', 1, 256], ['coarsePoints', 2, 64], ['refineRadius', 0, 100]]) s[k] = integer(s[k], min, max, k);
    if (!Array.isArray(s.rotations) || !s.rotations.length) throw new Error('回転角度を指定してください。');
    s.rotations = [...new Set(s.rotations.map(x => integer(x, 0, 3, '回転')))];
    s.perception = Number(s.perception); if (!Number.isFinite(s.perception) || s.perception < 0 || s.perception > 1) throw new Error('濃淡の評価割合が不正です。');
    s.artisticBudget = artworkBudget(s.artisticBudget);
    s.seed = Number(s.seed) | 0; return s;
  }
  async function search(options, report = () => {}) {
    const settings = normalizeSettings(options.settings), started = now(), deadline = started + settings.seconds * 1000;
    const queue = lengthPlan(options.segments, settings), lengthSeen = new Set(queue.map(x => x.join(':'))), pool = new Map(), failures = [], lengthScores = [];
    let attempted = 0, solved = 0, infeasible = 0, baselineBest = -Infinity, greedyBest = -Infinity, refinementsAdded = false;
    function add(candidate, model, target) {
      const key = `${candidate.version}/${candidate.mask}/${candidate.rotation}/${Array.from(candidate.bytes).join(',')}`;
      const existing = pool.get(key); if (!existing || candidate.metrics.visual > existing.candidate.metrics.visual) pool.set(key, { candidate, model, target });
      if (pool.size > settings.candidates * 8 + 24) { const sorted = [...pool.entries()].sort((a, b) => b[1].candidate.metrics.visual - a[1].candidate.metrics.visual); pool.clear(); sorted.slice(0, settings.candidates * 6 + 16).forEach(([k, v]) => pool.set(k, v)); }
    }
    for (let qi = 0; qi < queue.length; qi++) {
      if (attempted && now() >= deadline) break;
      const lengths = queue[qi]; let model, minimum;
      try { model = makeModel(options.segments, lengths, settings); minimum = encode(model.baseline, null, settings.ecc, 0, model).version; }
      catch (e) { failures.push(e.message); continue; }
      const versions = settings.version !== 'auto' ? [settings.version] : settings.compareVersions ? Array.from({ length: Math.max(0, settings.versionMax - Math.max(minimum, settings.versionMin) + 1) }, (_, i) => Math.max(minimum, settings.versionMin) + i) : [Math.max(minimum, settings.versionMin)];
      let lengthBest = -Infinity;
      for (const [versionIndex, version] of versions.entries()) {
        if (version < minimum || (settings.version === 'auto' && version > settings.versionMax) || (attempted && now() >= deadline)) continue;
        let target, mapping;
        try { target = getTarget(options, version); mapping = buildMapping(model, version, settings.ecc, report); }
        catch (e) { failures.push(e.message); continue; }
        const masks = settings.masks === 'all' ? [0, 1, 2, 3, 4, 5, 6, 7] : [settings.masks === 'auto' ? encode(model.baseline, version, settings.ecc, null, model).maskPattern : settings.masks];
        let orientationIndex = 0;
        for (const rotation of settings.rotations) for (const mask of masks) {
          if (attempted && now() >= deadline) break;
          attempted++;
          const orientations = masks.length * settings.rotations.length;
          const remaining = Math.max(1, (queue.length - qi - 1) * versions.length * orientations + (versions.length - versionIndex - 1) * orientations + orientations - orientationIndex++);
          const problemDeadline = Math.min(deadline, now() + Math.max(5, (deadline - now()) / remaining));
          report({ stage: 'search', message: `長さ ${lengths.join(' / ') || '固定'} · Version ${version} · Mask ${mask} · ${rotation * 90}° を比較中`, attempted, elapsed: (now() - started) / 1000 });
          let activeModel = model, m = orient(mapping, Uint8Array.from(encode(model.baseline, version, settings.ecc, mask, model).modules.data), rotation);
          const adapted = numericSubspace(m, model, target); activeModel = adapted.model; m = adapted.mapping;
          let h = hardSystem(m, target.hard);
          if (!h.ok && settings.fullCharset) {
            const repair = model.numericUnits.length ? repairNumericHard(m, activeModel, target.hard, problemDeadline) : repairHardCharset(m, model, target.hard, problemDeadline);
            if (repair) { activeModel = repair.model; m = repair.mapping; h = hardSystem(m, target.hard); }
          }
          if (!h.ok) { infeasible++; continue; }
          solved++; const hard = h.system.solve(activeModel.variables.length), original = new Loss(m.m0, target.bits, target.weights, m.size, settings.perception);
          baselineBest = Math.max(baselineBest, original.metrics().visual);
          const classification = { structural: 0, fixed: 0, variable: 0 };
          for (let j = 0; j < m.rows.length; j++) classification[m.reserved[j] ? 'structural' : m.rows[j] === 0n ? 'fixed' : 'variable']++;
          const meta = { version, ecc: settings.ecc, mask, rotation, size: m.size, lengths: lengths.slice(), encoding: model.numericUnits.length ? 'numeric' : 'byte', modes: model.parts.map(p => p.mode), variables: activeModel.variables.length, hardRank: hard.rank, analyses: model.analyses, classification };
          let best = null;
          for (let pass = 0; pass < settings.passes; pass++) {
            if (pass && now() >= problemDeadline) break;
            const seed = (settings.seed + mask * 1009 + rotation * 131 + pass * 9176) | 0;
            const g = greedy(m, target.bits, target.weights, target.hard, activeModel.variables.length, settings.reserve, seed, pass); if (!g) continue;
            const random = rng(seed), count = g.nullBasis.length <= 8 ? 2 ** g.nullBasis.length : settings.samples;
            let winner = { x: g.particular, score: Infinity };
            for (let k = 0; k < count; k++) {
              if (k && now() >= problemDeadline) break;
              let x = g.particular;
              g.nullBasis.forEach((b, i) => { if (g.nullBasis.length <= 8 ? (k >>> i) & 1 : k > 0 && random() < .5) x ^= b; });
              const loss = new Loss(predict(m, x), target.bits, target.weights, m.size, settings.perception), value = loss.value();
              if (value < winner.score) winner = { x, score: value };
            }
            greedyBest = Math.max(greedyBest, 1 - winner.score);
            const improved = improve(m, activeModel, winner.x, hard, target, settings, problemDeadline, seed);
            if (!best || improved.metrics.visual > best.metrics.visual) best = { ...meta, ...improved };
            const plain = { ...meta, bytes: applyX(activeModel, winner.x), matrix: predict(m, winner.x), metrics: new Loss(predict(m, winner.x), target.bits, target.weights, m.size, settings.perception).metrics(m.reserved), charsetMoves: 0 };
            add(plain, activeModel, target); add({ ...meta, ...improved }, activeModel, target);
          }
          if (target.hard.every((v, j) => v < 0 || v === m.m0[j])) add({ ...meta, bytes: activeModel.baseline.slice(), matrix: m.m0.slice(), metrics: original.metrics(m.reserved), charsetMoves: 0 }, activeModel, target);
          if (best) { lengthBest = Math.max(lengthBest, best.metrics.visual); report({ stage: 'candidate', message: `現在の最良候補 ${(best.metrics.visual * 100).toFixed(1)}%`, candidate: best }); }
          await tick();
        }
      }
      lengthScores.push({ lengths, score: lengthBest });
      if (qi === queue.length - 1 && settings.autoLength && settings.refineRadius && !refinementsAdded && now() < deadline) {
        refinementsAdded = true; const vars = options.segments.filter(s => s.kind === 'variable');
        for (const center of lengthScores.sort((a, b) => b.score - a.score).slice(0, 3)) for (let axis = 0; axis < vars.length; axis++) for (let d = 1; d <= (vars[axis].refineRadius ?? settings.refineRadius); d++) for (const sign of [-1, 1]) {
          const row = center.lengths.slice(); row[axis] += d * sign;
          if (row[axis] < (vars[axis].start || 1) || row[axis] > vars[axis].length) continue;
          const key = row.join(':'); if (!lengthSeen.has(key)) { lengthSeen.add(key); queue.push(row); }
        }
      }
    }
    const searchSeconds = (now() - started) / 1000, timedOut = now() >= deadline;
    const entries = [...pool.values()].sort((a, b) => b.candidate.metrics.visual - a.candidate.metrics.visual || b.candidate.metrics.weighted - a.candidate.metrics.weighted), candidates = []; let rejected = 0;
    report({ stage: 'verify', message: '候補を別のエンコーダ・読み取り器で検証しています。' });
    for (const { candidate, model, target } of entries) {
      const validation = verify(candidate, model, target);
      if (!validation.ok) { rejected++; continue; }
      candidate.validation = validation; candidate.text = text.decode(candidate.bytes);
      if (settings.artistic) {
        report({ stage: 'artistic', message: `候補${candidates.length + 1}の加工版を作成し、元の文字列に読み取れるか検証しています。` }); await tick();
        try { const art = await makeArtistic(candidate, model, target, { budget: settings.artisticBudget, perception: settings.perception }); candidate.artistic = art.variant; candidate.artisticNote = art.reason; }
        catch (e) { candidate.artistic = null; candidate.artisticNote = `加工版を作成できませんでした: ${e.message} 正規版は保存できます。`; }
      }
      candidates.push(candidate);
      if (candidates.length >= settings.candidates) break;
      await tick();
    }
    if (!candidates.length) throw new Error(infeasible && !solved ? '今回の探索では絶対黒白指定を満たす解が見つかりませんでした。時間・マスク・Version・可変長の範囲を広げるか、指定を見直してください。指定は保持されています。' : failures[0] || '指定を満たし、独立した読み取り検証にも合格する候補が見つかりませんでした。探索時間や範囲を広げてください。');
    return { candidates, stats: { seconds: (now() - started) / 1000, searchSeconds, budgetSeconds: settings.seconds, timedOut, attempted, solved, infeasible, rejected, lengthsPlanned: queue.length, baselineBest: Number.isFinite(baselineBest) ? baselineBest : null, greedyBest: Number.isFinite(greedyBest) ? greedyBest : null, failures: [...new Set(failures)].slice(0, 8) }, settings };
  }
  return { URLSAFE, analyzeCharset, allowedBytes, makeModel, encode, applyX, payloadOK, payloadBits, maxVariableLength, blockLayout, placement, gfMul, rsRemainder, buildMapping, predict, rotate, orient, LinearSystem, hardSystem, greedy, Loss, projectField, projectHard, renderRGBA, reloadModules, maskBit, rsReport, verify, verifyArtistic, makeArtistic, svg, lengthPlan, normalizeSettings, search };
});
