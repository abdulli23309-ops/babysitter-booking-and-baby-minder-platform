import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(__dirname, '..', 'src');

// Collect .jsx and .js files
const jsxFiles = [];
function walk(d) {
  for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist'].includes(entry.name)) walk(p);
    } else if (entry.name.endsWith('.jsx') || entry.name.endsWith('.js')) {
      jsxFiles.push(p);
    }
  }
}
walk(src);

const issues = [];

for (const filePath of jsxFiles) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const imgTags = line.match(/<img\s+([^>]*?)>/gi);
    if (imgTags) {
      for (const tag of imgTags) {
        const attrs = (tag.match(/<img\s+([^>]*)>/i) || [])[1] || '';
        // Skip JS expression src (i.e. src={...})
        if (/src\s*=\s*\{/.test(attrs)) continue;
        const srcMatch = attrs.match(/src\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/i);
        const srcVal = srcMatch ? (srcMatch[1] || srcMatch[2] || srcMatch[3]) : null;
        if (srcVal === null) continue;

        const isSafe = /^https?:\/\//i.test(srcVal)
                    || /^data:/i.test(srcVal)
                    || /^\/api\//.test(srcVal)
                    || /^(https?:)?\/\//i.test(srcVal)
                    || srcVal.startsWith('./')
                    || srcVal.startsWith('../');

        if (!isSafe && srcVal.length > 0) {
          issues.push({
            file: filePath, line: lineNum,
            kind: 'UNSAFE_SRC',
            src: srcVal.trim().slice(0, 50),
            snippet: line.trim().slice(0, 80)
          });
        }
        if (!/onError\s*=/.test(attrs)) {
          issues.push({
            file: filePath, line: lineNum,
            kind: 'NO_ONERROR',
            src: srcVal.trim().slice(0, 50),
            snippet: line.trim().slice(0, 80)
          });
        }
      }
    }
  }
}

console.log('=== IMAGE-SRC AUDIT ===');
console.log(`JSX files scanned: ${jsxFiles.length}`);
console.log(`Issues found:       ${issues.length}\n`);

if (issues.length === 0) {
  console.log('PASS - all images look safe.\n');
} else {
  console.log('ISSUES:\n');
  for (const it of issues) {
    console.log(`  [${it.kind}] ${it.file}:${it.line}`);
    if (it.src) console.log(`    src="${it.src}"`);
    console.log(`    ${it.snippet}\n`);
  }
}
