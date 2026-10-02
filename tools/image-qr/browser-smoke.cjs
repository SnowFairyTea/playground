// Real offline Chromium: image input, native Canvas/Worker, downloads and layout.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const E = require('../../assets/image-qr-engine.js');
const jsQR = require('../../assets/vendor/image-qr/jsQR.js');
const root = path.resolve(__dirname, '../..'), output = process.env.IMAGE_QR_BROWSER_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'image-qr-browser-'));
fs.mkdirSync(output, { recursive: true });
const size = 49, bits = Uint8Array.from({ length: size * size }, (_, j) => Number(Math.hypot((j % size + .5) / size - .5, (Math.floor(j / size) + .5) / size - .5) < .3));
const fixture = E.renderRGBA(bits, size, 4, 4), imagePath = path.join(output, 'source.png');
for (let j = 0; j < fixture.data.length; j += 4) {
  if (fixture.data[j] === 0) { fixture.data[j] = 15; fixture.data[j + 1] = 55; fixture.data[j + 2] = 90; }
  else { fixture.data[j] = 225; fixture.data[j + 1] = 245; fixture.data[j + 2] = 255; }
}
fs.writeFileSync(imagePath, PNG.sync.write({ width: fixture.width, height: fixture.height, data: Buffer.from(fixture.data) }));
const readPNG = filename => { const p = PNG.sync.read(fs.readFileSync(filename)); return { png: p, decoded: jsQR(new Uint8ClampedArray(p.data), p.width, p.height, { inversionAttempts: 'dontInvert' }) }; };
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.IMAGE_QR_BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const rows = [];
    for (const [name, width] of [['desktop', 1280], ['mobile', 390], ['photo', 1280]]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, offline: true, acceptDownloads: true }), page = await context.newPage(), errors = [], network = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (/^https?:/.test(r.url())) network.push(r.url()); });
      await page.goto(pathToFileURL(path.join(root, 'apps/image-qr-optimizer/image-qr-optimizer.html')).href);
      await page.locator('#source-image').setInputFiles(name === 'photo' ? path.join(root, 'apps/image-qr-optimizer/verification/picture/astronaut-source.png') : imagePath);
      await page.waitForFunction(() => document.querySelector('#image-status').textContent.includes('ドラッグ'));
      await page.locator('#segment-0-text').fill(name === 'photo' ? 'https://example.com/qr-art?theme=green#demo' : 'https://example.com/#');
      if (name === 'photo') await page.locator('#segments .qr-segment').last().locator('[data-action="delete"]').click();
      await page.locator('#version').selectOption('8');
      await page.locator('#search-seconds').fill('3');
      await page.getByText('探索範囲と詳細設定', { exact: true }).click(); await page.locator('#candidate-count').fill('2');
      const before = await page.evaluate(() => { const s = ImageQrApp.snapshot(); return { segments: s.segments, hard: [...s.hard], weights: [...s.weights], soft: [...s.soft] }; });
      await page.locator('#generate').click();
      await page.waitForFunction(() => !document.querySelector('#generate').disabled, null, { timeout: 60000 });
      assert(await page.locator('#export-controls').isVisible(), await page.locator('#search-status').textContent());
      assert(await page.locator('#artistic-export-controls').isVisible(), await page.locator('#artistic-summary').textContent());
      assert.equal(await page.locator('#artistic-mode').inputValue(), 'auto');
      assert.match(await page.locator('#artistic-summary').textContent(), /カラー画像.*濃淡一致/);
      assert.match(await page.locator('#artistic-details').textContent(), /50%縮小.*ぼかし/);
      const after = await page.evaluate(() => { const s = ImageQrApp.snapshot(); return { segments: s.segments, hard: [...s.hard], weights: [...s.weights], soft: [...s.soft] }; });
      assert.deepEqual(after, before);
      const text = await page.locator('#result-text').inputValue();
      if (name === 'photo') assert.equal(text, 'https://example.com/qr-art?theme=green#demo'); else assert.match(text, /^https:\/\/example\.com\/#[-_A-Za-z0-9]{128}$/);
      const thumbnailText = await page.locator('#candidates span').allTextContents(); assert(thumbnailText.every(t => t.includes('加工版')));
      const scores = thumbnailText.map(t => Number(t.match(/スコア ([\d.]+)/)[1])); assert(scores.every((s, i) => !i || scores[i - 1] >= s));
      const files = {};
      for (const [label, id] of [['regular', 'save-png'], ['artistic', 'save-artistic-png'], ['vector', 'save-artistic-svg']]) {
        const pending = page.waitForEvent('download'); await page.locator('#' + id).click(); const download = await pending;
        files[label] = path.join(output, `${name}-${label}.${label === 'vector' ? 'svg' : 'png'}`); await download.saveAs(files[label]);
        assert.equal(await download.failure(), null);
      }
      const regular = readPNG(files.regular), artistic = readPNG(files.artistic);
      assert.equal(regular.decoded?.data, text); assert.equal(artistic.decoded?.data, text); assert.notDeepEqual(regular.png.data, artistic.png.data);
      // Decode the actual saved SVG after the browser rasterizes it.
      const svgURI = 'data:image/svg+xml;base64,' + fs.readFileSync(files.vector).toString('base64');
      const fromSVG = await page.evaluate(async src => {
        const image = new Image(); image.src = src; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; canvas.getContext('2d').drawImage(image, 0, 0);
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height); return { bytes: jsQR(pixels.data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' })?.binaryData, pixels: Array.from(pixels.data), width: canvas.width, height: canvas.height };
      }, svgURI);
      assert.deepEqual(fromSVG.bytes, Array.from(new TextEncoder().encode(text))); assert.equal(fromSVG.width, artistic.png.width);
      assert.deepEqual(Buffer.from(fromSVG.pixels), artistic.png.data);
      assert(artistic.png.data.some((v, j) => j % 4 === 0 && (v !== artistic.png.data[j + 1] || v !== artistic.png.data[j + 2])));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(overflow, false, name + ' has horizontal overflow');
      await page.locator(name === 'desktop' ? '.qr-workspace' : '.qr-result').screenshot({ path: path.join(output, name + '.png') });
      // Stop a real worker and prove the same image/segments can be generated again.
      if (name === 'desktop') {
        await page.locator('#generate').click(); await page.locator('#cancel').click();
        assert.match(await page.locator('#search-status').textContent(), /中断/);
        await page.locator('#search-seconds').fill('1'); await page.locator('#generate').click();
        await page.waitForFunction(() => !document.querySelector('#generate').disabled, null, { timeout: 60000 });
        assert(await page.locator('#export-controls').isVisible(), await page.locator('#search-status').textContent());
        await page.locator('#artistic-mode').selectOption('image-mono'); await page.locator('#artistic-budget').selectOption('0');
        await page.locator('#generate').click(); await page.waitForFunction(() => !document.querySelector('#generate').disabled, null, { timeout: 60000 });
        assert.match(await page.locator('#artistic-summary').textContent(), /白黒画像/);
        const counts = await page.locator('#artistic-details tbody tr').allTextContents(); assert(counts.every(t => /^\d+00\d+$/.test(t)));
        const canvasCheck = await page.evaluate(() => { const c = document.querySelector('#artistic-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; return { mono: [...d].every((v, j) => j % 4 === 3 || v === d[j - j % 4]), decoded: jsQR(d, c.width, c.height)?.data }; });
        assert(canvasCheck.mono); assert.equal(canvasCheck.decoded, await page.locator('#result-text').inputValue());
      }
      assert.deepEqual(errors, []); assert.deepEqual(network, []);
      rows.push({ name, width, nativeCanvas: true, worker: true, pictureMode: true, coloredPNG: true, pngDecoded: true, svgDecoded: true, pngSvgPixelIdentical: true, zeroBudgetMono: name === 'desktop', offline: true, horizontalOverflow: false });
      await context.close();
    }
    fs.writeFileSync(path.join(output, 'browser.json'), JSON.stringify({ chromium: browser.version(), rows }, null, 2) + '\n');
    console.log(JSON.stringify({ ok: true, output, chromium: browser.version(), rows }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
