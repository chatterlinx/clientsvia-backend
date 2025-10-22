const fs = require('fs');
const path = require('path');

function sizeOf(p) {
  try { return fs.statSync(p).size; } catch { return 0; }
}

function sumDir(dir) {
  try {
    return fs.readdirSync(dir)
      .map(f => sizeOf(path.join(dir, f)))
      .reduce((a, b) => a + b, 0);
  } catch {
    return 0;
  }
}

const report = {
  ts: new Date().toISOString(),
  jsBytes: sumDir('public/js'),
  cssBytes: sumDir('public/css')
};

const outDir = path.join('scripts');
if (!fs.existsSync(outDir)) {fs.mkdirSync(outDir, { recursive: true });}
const outPath = path.join(outDir, 'bundle-baseline.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log('Baseline saved:', report);

