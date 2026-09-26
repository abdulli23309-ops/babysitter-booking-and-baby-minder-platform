// Console statement audit
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

let consoleCount = 0;
const entries = [];

files.forEach(f => {
  const c = fs.readFileSync(f, 'utf8');
  c.split('\n').forEach((l, i) => {
    const t = l.trim();
    if (/console\.(log|warn|error|debug|info)/.test(t) && !t.startsWith('//')) {
      consoleCount++;
      const rel = path.relative('src', f).replace(/\\/g, '/');
      entries.push(rel + ':' + (i + 1) + ' -> ' + t.slice(0, 90));
    }
  });
});

console.log('=== CONSOLE STATEMENT AUDIT ===');
console.log('Total console statements:', consoleCount);
console.log('');
entries.forEach(e => console.log('  ' + e));
