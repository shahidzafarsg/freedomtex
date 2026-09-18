// Generates the app icon (PNG + multi-size ICO) and the sample figure used by templates.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const logo = fs.readFileSync(path.join(root, 'src/assets/logo.svg'));
fs.mkdirSync(path.join(root, 'build'), { recursive: true });

const render = (size) => sharp(logo, { density: Math.max(72, Math.ceil((size / 256) * 96 * 1.5)) }).resize(size, size).png().toBuffer();

// 1024 px: electron-builder turns this into the macOS .icns; Windows uses the .ico below.
await fs.promises.writeFile(path.join(root, 'build/icon.png'), await render(1024));

// ICO with PNG-compressed entries (supported since Windows Vista).
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map(render));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
const dir = Buffer.alloc(16 * sizes.length);
let offset = 6 + dir.length;
sizes.forEach((s, i) => {
  const b = i * 16;
  dir.writeUInt8(s >= 256 ? 0 : s, b);
  dir.writeUInt8(s >= 256 ? 0 : s, b + 1);
  dir.writeUInt8(0, b + 2);
  dir.writeUInt8(0, b + 3);
  dir.writeUInt16LE(1, b + 4);
  dir.writeUInt16LE(32, b + 6);
  dir.writeUInt32LE(images[i].length, b + 8);
  dir.writeUInt32LE(offset, b + 12);
  offset += images[i].length;
});
await fs.promises.writeFile(path.join(root, 'build/icon.ico'), Buffer.concat([header, dir, ...images]));

// Sample chart for the example and thesis templates (no text, so no font dependency).
const bars = [0.45, 0.7, 0.58, 0.86, 0.66];
const W = 800;
const H = 480;
const pad = 60;
const bw = 90;
const gap = (W - pad * 2 - bw * bars.length) / (bars.length - 1);
let rects = '';
bars.forEach((v, i) => {
  const h = (H - pad * 2) * v;
  const x = pad + i * (bw + gap);
  rects += `<rect x="${x}" y="${H - pad - h}" width="${bw}" height="${h}" rx="8" fill="url(#g${i % 2})"/>`;
});
let grid = '';
for (let i = 1; i <= 4; i++) {
  const y = H - pad - ((H - pad * 2) / 4) * i;
  grid += `<line x1="${pad}" y1="${y}" x2="${W - pad}" y2="${y}" stroke="#e2e8f0" stroke-width="2"/>`;
}
const chart = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<linearGradient id="g0" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14b8a6"/><stop offset="1" stop-color="#0f766e"/></linearGradient>
<linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#818cf8"/><stop offset="1" stop-color="#4f46e5"/></linearGradient>
</defs>
<rect width="100%" height="100%" fill="#ffffff"/>
${grid}
<line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#334155" stroke-width="3"/>
<line x1="${pad}" y1="${pad - 10}" x2="${pad}" y2="${H - pad}" stroke="#334155" stroke-width="3"/>
${rects}
<polyline points="${bars.map((v, i) => `${pad + i * (bw + gap) + bw / 2},${H - pad - (H - pad * 2) * v - 24}`).join(' ')}" fill="none" stroke="#f59e0b" stroke-width="5" stroke-linejoin="round"/>
</svg>`;
const png = await sharp(Buffer.from(chart)).png().toBuffer();
for (const t of ['example/files/figures', 'thesis/files/figures']) {
  fs.mkdirSync(path.join(root, 'templates', t), { recursive: true });
  await fs.promises.writeFile(path.join(root, 'templates', t, 'sample-chart.png'), png);
}
console.log('Icons and sample figure generated.');
