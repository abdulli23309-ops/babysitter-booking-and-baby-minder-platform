import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(__dirname, '..', 'src');

const allFiles = [];
function walk(d) {
  for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist'].includes(entry.name)) walk(p);
    } else if (['.jsx', '.js', '.css'].includes(path.extname(entry.name))) {
      allFiles.push(p);
    }
  }
}
walk(src);

const fileSet = new Set(allFiles);

function resolveImport(imp, fromFile) {
  const fromDir = path.dirname(fromFile);
  const candidates = [
    path.resolve(fromDir, imp),
    path.resolve(fromDir, imp + '.jsx'),
    path.resolve(fromDir, imp + '.js'),
    path.resolve(fromDir, imp + '.css'),
    path.resolve(fromDir, imp + '.json'),
  ];
  const asDir = path.resolve(fromDir, imp);
  if (fs.existsSync(asDir) && fs.statSync(asDir).isDirectory()) {
    candidates.push(path.join(asDir, 'index.jsx'));
    candidates.push(path.join(asDir, 'index.js'));
    candidates.push(path.join(asDir, 'index.css'));
  }
  for (const c of candidates) {
    if (fileSet.has(c)) return c;
  }
  return null;
}

// External packages — must match entire bare specifier (no partial matches)
const EXTERNALS = /^(react(-dom\/client|-router(-dom)?|\/jsx-(?:runtime|dev-runtime))?|@jitsi\/react-sdk|@react-oauth\/google|react-leaflet|leaflet|lodash|date-fns|dayjs|axios|clsx|classnames|framer-motion|node:)$/;

const broken = [];
const resolved = new Set();

for (const filePath of allFiles) {
  if (!['.jsx', '.js'].includes(path.extname(filePath))) continue;
  const content = fs.readFileSync(filePath, 'utf8');
  // Match only real import/export statements, not "from '...'" inside string literals
  const re = /(?:^|\n)\s*(?:import|export)\s+.*?\sfrom\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const imp = m[1];
    if (EXTERNALS.test(imp)) continue;
    if (imp.startsWith('@/')) continue;
    const r = resolveImport(imp, filePath);
    if (r) resolved.add(r);
    else broken.push({ file: filePath, imp });
  }
}

console.log('=== IMPORT RESOLVER AUDIT ===');
console.log(`Files scanned:       ${allFiles.length}`);
console.log(`Importables resolved: ${resolved.size}`);
console.log(`Broken / unresolved:  ${broken.length}\n`);

if (broken.length === 0) {
  console.log('PASS - every local import resolves to an existing file.\n');
} else {
  console.log('FAIL - the following imports could not be resolved:\n');
  const byFile = new Map();
  for (const { file, imp } of broken) {
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(imp);
  }
  for (const [file, imps] of byFile) {
    console.log(`  ${file}`);
    imps.forEach(i => console.log(`    -> ${i}`));
  }
  console.log(`\n  (total: ${broken.length} broken imports across ${byFile.size} files)`);
}
