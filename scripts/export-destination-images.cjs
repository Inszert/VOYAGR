const sharp = require(process.argv[2]);
const fs = require('fs'), path = require('path');
const dir = process.argv[3], out = process.argv[4];
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const manifest = {};
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort()) {
    const code = path.basename(f, '.png');
    const src = sharp(path.join(dir, f));
    const meta = await src.metadata();
    for (const w of [480, 768, 1024]) {
      const r = sharp(path.join(dir, f)).resize({ width: Math.min(w, meta.width) });
      await r.clone().avif({ quality: 55 }).toFile(path.join(out, `${code}-${w}.avif`));
      await r.clone().webp({ quality: 74 }).toFile(path.join(out, `${code}-${w}.webp`));
    }
    const blur = await sharp(path.join(dir, f)).resize(24).webp({ quality: 40 }).toBuffer();
    manifest[code] = { width: meta.width, height: meta.height, blur: 'data:image/webp;base64,' + blur.toString('base64') };
  }
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(Object.keys(manifest).length, JSON.stringify(Object.values(manifest)[0]).slice(0, 60));
})();
