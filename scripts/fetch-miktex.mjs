// Downloads the official MiKTeX basic installer that FreedomTex bundles, and verifies its SHA-256.
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';

const FILE = 'basic-miktex-25.12-x64.exe';
const SHA256 = '14b42dd9f4b4a7813a8bfd69c8f99316c2888cc4ee26f631f397e163d85d6c62';
// miktex.org first, then CTAN mirrors. The checksum guarantees the file is the official one.
const CTAN_PATH = `systems/win32/miktex/setup/windows-x64/${FILE}`;
const SOURCES = [
  `https://miktex.org/download/ctan/${CTAN_PATH}`,
  `https://mirror.ctan.org/${CTAN_PATH}`,
  `https://mirrors.mit.edu/CTAN/${CTAN_PATH}`,
  `https://ftp.math.utah.edu/pub/ctan/${CTAN_PATH}`,
  `https://mirrors.cloud.tencent.com/CTAN/${CTAN_PATH}`,
];

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
    const req = https
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
        res.on('error', reject);
      })
      .on('error', reject);
    // Give up on a stalled connection so the next mirror can be tried.
    req.setTimeout(30000, () => req.destroy(new Error('connection stalled for 30 s')));
  });
}

if (fs.existsSync(dest) && (await sha256(dest)) === SHA256) {
  console.log(`${FILE} already present and verified.`);
} else {
  const tmp = `${dest}.part`;
  let ok = false;
  for (const url of SOURCES) {
    for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
      console.log(`Downloading ${FILE} from ${new URL(url).host} (attempt ${attempt}) ...`);
      try {
        await download(url, tmp);
        const hash = await sha256(tmp);
        if (hash !== SHA256) throw new Error(`checksum mismatch (got ${hash})`);
        fs.renameSync(tmp, dest);
        ok = true;
      } catch (e) {
        console.log(`  failed: ${e.message}`);
        fs.rmSync(tmp, { force: true });
      }
    }
    if (ok) break;
  }
  if (!ok) {
    console.error(`Could not download ${FILE} from any source.`);
    process.exit(1);
  }
  console.log(`Saved and verified: ${dest}`);
}
