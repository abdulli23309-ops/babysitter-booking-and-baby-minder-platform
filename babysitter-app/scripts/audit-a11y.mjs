import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(__dirname, '..', 'src');

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

    // ---- Icon buttons without aria-label ----
    if (/<button[^>]*onClick\s*=/.test(line)
        && !/aria-label/.test(line)
        && !/aria-labelledby/.test(line)) {
      if (/<svg/.test(line) || /<Icon\b/.test(line) || /<path\s+d=/.test(line)) {
        issues.push({
          file: filePath, line: lineNum,
          type: 'icon-button-no-aria-label',
          snippet: line.trim().slice(0, 70)
        });
      }
    }

    // ---- Links without visible text and no aria-label ----
    // Match <a ... href="..." ...> inner content </a> on the same line
    const linkRegex = /<a\b[^>]*>.*?<\/a>/gi;
    let lm;
    while ((lm = linkRegex.exec(line)) !== null) {
      const fullTag = lm[0];
      const attrs = fullTag.substring(0, fullTag.indexOf('>') + 1);
      const inner = fullTag.substring(fullTag.indexOf('>') + 1, fullTag.lastIndexOf('</a>'));

      if (!/href/.test(attrs)) continue;
      if (/aria-label/.test(attrs) || /aria-labelledby/.test(attrs) || /title\s*=/.test(attrs)) continue;

      // Check for visible text content (ascii, arabic, emojis, icons)
      const hasText = inner.replace(/\s+/g, '').length > 0;
      if (!hasText) {
        issues.push({
          file: filePath, line: lineNum,
          type: 'link-empty-visible-text',
          snippet: line.trim().slice(0, 70)
        });
      }
    }
  }
}

console.log('=== ARIA & ACCESSIBILITY AUDIT ===');
console.log(`JSX files scanned: ${jsxFiles.length}`);
console.log(`Issues found:       ${issues.length}\n`);

if (issues.length === 0) {
  console.log('PASS - no accessibility issues detected.\n');
} else {
  console.log('ISSUES:\n');
  for (const item of issues) {
    console.log(`  [${item.type}] ${item.file}:${item.line}`);
    console.log(`    ${item.snippet}\n`);
  }
}
