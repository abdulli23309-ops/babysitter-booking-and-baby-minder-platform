#!/usr/bin/env node
// Phase 8L: guard against dead `styles.X` references. A missing class
// silently renders as `className={undefined}` and produces an unstyled
// browser-default element with no warning from the build or lint.
//
// Scans every .jsx under src/ that imports a .module.css, extracts every
// `styles.X` reference and every `.X` selector from the paired module,
// and exits non-zero if any reference has no matching class.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// NOTE: this project sets "type": "module" in package.json, so the script
// runs as ESM. Written with `import` rather than `require` for that reason.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.resolve(__dirname, '..', 'src');
const failures = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith('.jsx')) check(full);
  }
}

function check(jsxPath) {
  const jsx = fs.readFileSync(jsxPath, 'utf8');
  const m = jsx.match(/import\s+styles\s+from\s+['"]([^'"]+\.module\.css)['"]/);
  if (!m) return;
  const cssPath = path.resolve(path.dirname(jsxPath), m[1]);
  if (!fs.existsSync(cssPath)) return;

  const css = fs.readFileSync(cssPath, 'utf8');
  const used = new Set();
  for (const hit of jsx.matchAll(/styles\.([A-Za-z_][A-Za-z0-9_]*)/g)) used.add(hit[1]);

  const defined = new Set();
  for (const hit of css.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) defined.add(hit[1]);

  const missing = [...used].filter((name) => !defined.has(name));
  if (missing.length) failures.push({ jsxPath, missing });
}

walk(ROOT);

if (failures.length) {
  console.error('\n  DEAD CSS MODULE REFERENCES\n');
  for (const f of failures) {
    console.error(`  ${path.relative(process.cwd(), f.jsxPath)}`);
    for (const name of f.missing) console.error(`    styles.${name}`);
  }
  console.error(`\n  ${failures.length} file(s) with missing classes.\n`);
  process.exit(1);
}
console.log('OK — every styles.* reference resolves to a real class.');