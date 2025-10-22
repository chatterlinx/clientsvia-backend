const fs = require('fs');
const path = require('path');

function sizeOf(p){ try{ return fs.statSync(p).size; } catch { return 0; } }
function sumDir(d){ try{ return fs.readdirSync(d).map(f=>sizeOf(path.join(d,f))).reduce((a,b)=>a+b,0);} catch { return 0; } }

const baselinePath = path.join('scripts','bundle-baseline.json');
if (!fs.existsSync(baselinePath)) {
  console.error('Missing scripts/bundle-baseline.json. Run: npm run bundle:snapshot');
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath,'utf8'));
const current = { jsBytes: sumDir('public/js'), cssBytes: sumDir('public/css') };
const maxGrowPct = Number(process.env.BUNDLE_MAX_GROW_PCT || 5);
function pct(newV, oldV){ return oldV ? ((newV-oldV)/oldV)*100 : 0; }
const jsPct = pct(current.jsBytes, baseline.jsBytes);
const cssPct = pct(current.cssBytes, baseline.cssBytes);

console.log(JSON.stringify({ baseline, current, jsPct, cssPct, maxGrowPct }, null, 2));
if (jsPct > maxGrowPct || cssPct > maxGrowPct) {
  console.error('Bundle grew beyond threshold');
  process.exit(1);
}

