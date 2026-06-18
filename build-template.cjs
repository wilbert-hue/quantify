const fs = require('fs');

function parseCSV(content) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === '"') { inQ = !inQ; continue; }
    if ((c === '\n' || c === '\r') && !inQ) {
      if (c === '\r' && content[i + 1] === '\n') i++;
      if (cur !== '' || row.length) { row.push(cur); rows.push(row); row = []; cur = ''; }
      continue;
    }
    if (c === ',' && !inQ) { row.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const vRows = parseCSV(fs.readFileSync('Value 1.csv', 'utf8'));
const volRows = parseCSV(fs.readFileSync('Volume2.csv', 'utf8'));

const valueRows = vRows.slice(1).map(r => ({
  region: r[0],
  segment: r[1],
  subSegment: r[2],
  subSegment1: r[3],
  subSegment2: r[4],
  key: r.slice(0, 5).join('|')
}));

const template = {
  header: vRows[0],
  years: vRows[0].slice(5),
  valueRows,
  volumeRowKeys: volRows.slice(1).map(r => r.slice(0, 5).join('|'))
};

const regionsInOrder = [...new Set(valueRows.map(r => r.region))];
const geoRows = valueRows.filter(
  r => r.segment === 'By Region' || r.segment === 'By Country'
);

fs.mkdirSync('src/data', { recursive: true });
fs.writeFileSync('src/data/template.json', JSON.stringify(template, null, 2));
fs.writeFileSync(
  'src/data/geoTemplate.json',
  JSON.stringify({ regionsInOrder, geoRows }, null, 2)
);

console.log('Template written:', template.valueRows.length, 'value rows');
console.log('Geo template:', geoRows.length, 'geography rows across', regionsInOrder.length, 'regions');
