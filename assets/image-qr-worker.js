/* Runs in a dedicated worker; the standalone builder replaces these local imports. */
importScripts('qrcode.min.js', 'vendor/image-qr/qrcodegen.js', 'vendor/image-qr/jsQR.js', 'image-qr-engine.js');
self.onmessage = async event => {
  const { id, type, input } = event.data;
  try {
    let result;
    if (type === 'analyze') result = ImageQrEngine.makeModel(input.segments).analyses;
    else if (type === 'search') result = await ImageQrEngine.search(input, progress => self.postMessage({ id, type: 'progress', progress }));
    else throw new Error('不明な処理です。');
    self.postMessage({ id, type: 'result', result });
  } catch (error) {
    self.postMessage({ id, type: 'error', message: error.message || String(error) });
  }
};
