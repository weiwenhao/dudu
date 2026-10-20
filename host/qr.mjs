import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const QRCode = require('qrcode-terminal/vendor/QRCode');
const QRErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');

export function renderPairingSvg(pairUrl) {
  const qr = new QRCode(-1, QRErrorCorrectLevel.M);
  qr.addData(pairUrl);
  qr.make();
  const size = qr.getModuleCount();
  const cells = [];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (qr.isDark(row, col)) cells.push(`M${col} ${row}h1v1h-1z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 ${size + 8} ${size + 8}" role="img" aria-label="手机配对二维码" shape-rendering="crispEdges">
<rect x="-4" y="-4" width="${size + 8}" height="${size + 8}" fill="white"/><path d="${cells.join('')}" fill="black"/></svg>`;
}
