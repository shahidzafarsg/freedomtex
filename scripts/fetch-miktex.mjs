// Downloads the official MiKTeX basic installer that FreedomTex bundles, and verifies its SHA-256.
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';

const FILE = 'basic-miktex-25.12-x64.exe';
const URL_ = `https://miktex.org/download/ctan/systems/win32/miktex/setup/windows-x64/${FILE}`;
const SHA256 = '14b42dd9f4b4a7813a8bfd69c8f99316c2888cc4ee26f631f397e163d85d6c62';

const dir = path.resolve(import.meta.dirname, '..', 'resources', 'miktex');
const dest = path.join(dir, FILE);
fs.mkdirSync(dir, { recursive: true });

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

function download(url, file, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 10) return reject(new Error('Too many redirects'));
    https
      .get(url, { headers: { 'User-Agent': 'FreedomTex-build' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          console.log(`-> ${next}`);
          return resolve(download(next, file, hops + 1));
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const total = Number(res.headers['content-length'] || 0);
        let got = 0;
        let last = 0;
        const out = fs.createWriteStream(file);
        res.on('data', (c) => {
          got += c.length;
          if (Date.now() - last > 2000) {
            last = Date.now();
            console.log(`  ${(got / 1048576).toFixed(1)} MB${total ? ` of ${(total / 1048576).toFixed(1)} MB` : ''}`);
          }
        });
        res.pipe(out);
        out.on('finish', () => out.close(resolve));
        out.on('error', reject);
      })
      .on('error', reject);
  });
}

if (fs.existsSync(dest) && (await sha256(dest)) === SHA256) {
  console.log(`${FILE} already present and verified.`);
} else {
  console.log(`Downloading ${FILE} from miktex.org ...`);
  const tmp = `${dest}.part`;
  await download(URL_, tmp);
  const hash = await sha256(tmp);
  if (hash !== SHA256) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`Checksum mismatch: expected ${SHA256}, got ${hash}`);
  }
  fs.renameSync(tmp, dest);
  console.log(`Saved and verified: ${dest}`);
}
