# Vendored QR verification libraries

These dependencies are local and are embedded into the standalone HTML. No CDN or network access is needed at runtime.

- `qrcodegen.ts` / `qrcodegen.js`: Nayuki QR-Code-generator, commit `3c6d0b3cefb4e049dc337e82237c9644399716a8`, MIT license retained in source. https://github.com/nayuki/QR-Code-generator
  - Compiled with TypeScript 5.9.3, target ES2020, then appended `if (typeof module === "object" && module.exports) module.exports = qrcodegen;` for the Node verification suite. This does not change the encoder.
  - Used as an independent encoder, with identical Byte mode, version, ECC, mask, and `boostEcl=false`.
- `jsQR.js`: jsQR 1.4.0, commit `8e6a036beafa7053dd44b1b76ac578d22b1b3311`. Apache-2.0 license in `jsQR-LICENSE.txt`. https://github.com/cozmo/jsQR
  - Unmodified `dist/jsQR.js`, used to decode the rendered RGBA image and compare raw payload bytes.
- Primary encoding still uses the repository's existing `assets/qrcode.min.js`.

The optimizer's GF(256) polynomial arithmetic and image-to-module sampling are implemented separately in `assets/image-qr-engine.js` and are regression-tested against both encoders.
