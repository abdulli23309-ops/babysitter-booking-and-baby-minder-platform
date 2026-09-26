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

const diskNames = new Map();
function indexDir(d) {
  for (const name of fs.readdirSync(d)) {
    const full = path.join(d, name);
    diskNames.set(full.toLowerCase(), full);
    if (fs.statSync(full).isDirectory() && !['node_modules', 'dist'].includes(name)) {
      indexDir(full);
    }
  }
}
indexDir(src);

const EXTERNALS = /^(react(-dom\/client|-router(-dom)?|\/jsx-(?:runtime|dev-runtime))?|@jitsi\/react-sdk|@react-oauth\/google|@tensorflow\/tfjs|react-leaflet|leaflet|lodash|date-fns|dayjs|axios|clsx|classnames|framer-motion|node:)$/;

const caseMismatches = [];

for (const filePath of allFiles) {
  if (!['.jsx', '.js'].includes(path.extname(filePath))) continue;
  const content = fs.readFileSync(filePath, 'utf8');
  const re = /(?:^|\n)\s*(?:import|export)\s+.*?\sfrom\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const imp = m[1];
    if (EXTERNALS.test(imp)) continue;
    if (imp.startsWith('@/')) continue;

    const fromDir = path.dirname(filePath);
    const candidates = [
      path.resolve(fromDir, imp),
      path.resolve(fromDir, imp + '.jsx'),
      path.resolve(fromDir, imp + '.js'),
      path.resolve(fromDir, imp + '.css'),
      path.resolve(fromDir, imp + '.json'),
    ];
    for (const c of candidates) {
      const lower = c.toLowerCase();
      if (diskNames.has(lower)) {
        const actual = diskNames.get(lower);
        if (path.basename(actual) !== path.basename(c)) {
          caseMismatches.push({
            file: path.relative(src, filePath).replace(/\\/g, '/'),
            import: imp,
            expected: path.basename(actual),
            actual: path.basename(c),
          });
        }
      }
    }
  }
}

console.log('=== CASE SENSITIVITY AUDIT ===');
console.log('Total files checked:', allFiles.length);
console.log('Case mismatches found:', caseMismatches.length);
caseMismatches.forEach((cm) => console.log(' ', cm.file, 'imports', cm.import, '-> real is', cm.expected));
if (caseMismatches.length === 0) {
  console.log('PASS - all imports match exact disk casing.');
}

