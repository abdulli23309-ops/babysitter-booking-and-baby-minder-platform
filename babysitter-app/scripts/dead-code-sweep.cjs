// Dead code sweep — Phase F-UI-14 forensic audit
const fs = require('fs');
const path = require('path');

function walk(d, a) {
  const ents = fs.readdirSync(d, { withFileTypes: true });
  for (const e of ents) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (!['node_modules', 'dist'].includes(e.name)) walk(p, a);
    } else if (e.name.endsWith('.jsx') || e.name.endsWith('.js')) {
      a.push(p);
    }
  }
}

const files = [];
walk('src', files);

let todo = 0;
let consoleCount = 0;
let debugCount = 0;
let hardcodedHex = 0;

files.forEach(f => {
  const c = fs.readFileSync(f, 'utf8');
  const lines = c.split('\n');
  lines.forEach((l, i) => {
    const t = l.trim();
    if (t.startsWith('// TODO') || t.startsWith('// FIXME') || t.startsWith('// HACK')) todo++;
    if (/console\.(log|warn|error)/.test(t) && !t.startsWith('//')) consoleCount++;
    if (/debugger/.test(t)) debugCount++;
    if (/#[0-9a-fA-F]{3,8}/.test(l) && l.includes('backgroundColor') && !l.includes('var(--')) hardcodedHex++;
  });
});

console.log('=== DEAD CODE SWEEP ===');
console.log('Files scanned:', files.length);
console.log('TODO/FIXME/HACK comments:', todo);
console.log('Console statements (non-commented):', consoleCount);
console.log('Debugger statements:', debugCount);
console.log('Hardcoded hex in inline bg styles:', hardcodedHex);
