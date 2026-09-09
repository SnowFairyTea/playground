import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const libraries = ['assets/qrcode.min.js', 'assets/vendor/image-qr/qrcodegen.js', 'assets/vendor/image-qr/jsQR.js', 'assets/image-qr-engine.js'];
const worker = libraries.map(read).join('\n;\n') + '\n;\n' + read('assets/image-qr-worker.js').replace(/^importScripts\([^\n]+\);\s*$/m, '');
const workerJSON = JSON.stringify(worker).replace(/</g, '\\u003c');
const inline = source => source.replace(/<\/script/gi, '<\\/script');
let body = read('apps/image-qr-optimizer/index.html').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
body = body.replace(/\{\{\s*'([^']+)'\s*\|\s*relative_url\s*\}\}/g, '$1');
body = body.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, src) => `<style>\n${read(src.slice(1))}\n</style>`);
body = body.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => (src.endsWith('image-qr-ui.js') ? `<script id="image-qr-worker-source" type="application/json">${workerJSON}</script>\n` : '') + `<script>\n${inline(read(src.slice(1)))}\n</script>`);
body = body.replace('href="/apps/image-qr-optimizer/image-qr-optimizer.html"', 'href="#"');
const tokens = read('assets/design-tokens.css');
const licenses = JSON.stringify({ jsQR: { source: 'https://github.com/cozmo/jsQR', license: read('assets/vendor/image-qr/jsQR-LICENSE.txt') } }).replace(/</g, '\\u003c');
if (/@import|url\(/.test(tokens)) throw new Error('The standalone design tokens must not fetch resources.');
const html = `<!DOCTYPE html>\n<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="画像と固定・可変文字列から、検証済みのQRコードをブラウザだけで生成します。"><title>画像からQRコードをつくる</title><style>${tokens}\nbody{margin:0;background:var(--bg,#f5f7fa)}</style></head><body>\n${body}\n<script id="third-party-licenses" type="application/json">${licenses}</script>\n</body></html>\n`;
if (/<script[^>]+src=|<link[^>]+href=|\{%|\{\{/.test(html)) throw new Error('The standalone HTML still has an external dependency or template expression.');
const destination = path.join(root, 'apps/image-qr-optimizer/image-qr-optimizer.html');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== html) throw new Error('Standalone HTML is stale. Run node tools/build-image-qr.mjs.');
  console.log('Standalone HTML is reproducible and current.');
} else { fs.writeFileSync(destination, html); console.log(`Built ${path.relative(root, destination)} (${Buffer.byteLength(html)} bytes).`); }
