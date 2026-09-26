// Phase 1.7 audit — locate legacy in-screen hamburger menus and /menu routes.
import fs from 'node:fs';
import path from 'node:path';

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|css)$/.test(f)) out.push(p);
  }
  return out;
}

const hits = [];
for (const f of walk('src')) {
  const c = fs.readFileSync(f, 'utf8');
  const lines = c.split('\n');
  lines.forEach((line, i) => {
    if (/☰/.test(line)) hits.push(`${f}:${i + 1} ☰ ${line.trim().slice(0, 90)}`);
    if (/MenuScreen/i.test(line)) hits.push(`${f}:${i + 1} MenuScreen ${line.trim().slice(0, 90)}`);
    if (/['"`]\/menu['"`]/.test(line)) hits.push(`${f}:${i + 1} /menu-route ${line.trim().slice(0, 90)}`);
  });
}
console.log(hits.length ? hits.join('\n') : 'NO legacy menu hits');
console.log('MenuScreen.jsx exists:', fs.existsSync('src/features/parent/MenuScreen.jsx'));
