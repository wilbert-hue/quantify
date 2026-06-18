const fs = require('fs');

function parseCSVLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { result.push(cur); cur = ''; continue; }
    cur += c;
  }
  result.push(cur);
  return result;
}

function loadKeys(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.slice(1).map(l => parseCSVLine(l).slice(0, 5).join('|'));
}

const vKeys = loadKeys('Value 1.csv');
const volKeys = loadKeys('Volume2.csv');
console.log('Value rows:', vKeys.length);
console.log('Volume rows:', volKeys.length);

const regions = [];
vKeys.forEach(k => {
  const r = k.split('|')[0];
  if (!regions.includes(r)) regions.push(r);
});
console.log('Regions in Value:', regions);

const segs = [...new Set(vKeys.filter(k => k.startsWith('Global|')).map(k => k.split('|')[1]))];
console.log('Global segments Value:', segs);
const segsV = [...new Set(volKeys.filter(k => k.startsWith('Global|')).map(k => k.split('|')[1]))];
console.log('Global segments Volume:', segsV);

let diff = 0;
for (let i = 0; i < Math.min(vKeys.length, volKeys.length); i++) {
  if (vKeys[i] !== volKeys[i]) {
    diff++;
    if (diff <= 15) console.log('Diff at', i + 2, 'V:', vKeys[i], 'Vol:', volKeys[i]);
  }
}
console.log('Total positional diffs:', diff);

// Save template keys
fs.writeFileSync('template-value-keys.json', JSON.stringify(vKeys, null, 0));
fs.writeFileSync('template-volume-keys.json', JSON.stringify(volKeys, null, 0));
