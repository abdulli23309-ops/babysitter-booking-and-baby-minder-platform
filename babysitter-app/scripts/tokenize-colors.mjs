#!/usr/bin/env node
/**
 * tokenize-colors.mjs — Phase F-UI-11 / 1.5 token-migration codemod.
 *
 * Replaces hardcoded color literals in src/**\/*.module.css with the semantic
 * tokens declared in src/styles/tokens.css.
 *
 * Why it is safe to run over ~900 declarations:
 *  1. LIGHT-MODE PIXELS ARE UNCHANGED — every fixed token's light value equals
 *     the literal it replaces, and channel tokens keep the original RGB channels
 *     plus the declaration's own alpha:
 *       rgb(var(--primary-rgb) / 0.35) === rgba(232,98,42,0.35)
 *  2. ONLY declaration VALUES are rewritten. Selectors, comments, property
 *     names, units, spacing and layout logic are never touched (comments are
 *     masked out before the pass).
 *  3. IT REFUSES TO WRITE a file when any of its literals is unmapped (unless
 *     --force), so a file can never be left half-migrated.
 *  4. SELF-CHECK: every token it emits must exist in tokens.css.
 *
 * Usage: node scripts/tokenize-colors.mjs [--dry-run] [--only=<substr>] [--force]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS, VALUE_RULES } from './token-map.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const TOKENS_FILE = join(SRC, 'styles', 'tokens.css');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const FORCE = args.includes('--force');
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').slice('--only='.length);

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[^()]*\)|hsla?\(\s*[^()]*\)/g;
// `var(--token, <default>)` defaults are already token-backed: mask them so a
// fallback like var(--color-border, #F0F4F8) is never rewritten.
const VAR_FALLBACK_RE = /var\(\s*--[\w-]+\s*,\s*[^()]*(?:\([^()]*\)[^()]*)*\)/g;
const DECL_RE = /(-{0,2}[a-zA-Z-]+)(\s*:\s*)([^;{}]+)/g;

const byLiteral = new Map();
for (const group of GROUPS) {
  for (const literal of group.c) {
    const list = byLiteral.get(literal) || [];
    list.push(group);
    byLiteral.set(literal, list);
  }
}

const byValue = new Map();
for (const rule of VALUE_RULES) byValue.set(rule.v.replace(/\s+/g, '').toLowerCase(), rule.to);

/** CSS property -> semantic slot used by the mapping table. */
function classOf(prop) {
  const p = prop.toLowerCase();
  if (p === 'color' || p === 'caret-color' || p === 'fill' || p === 'stroke' || p === '-webkit-text-fill-color') {
    return 'fg';
  }
  if (p === 'box-shadow' || p === 'text-shadow' || p === '-webkit-box-shadow') return 'sh';
  if (p.startsWith('background')) return 'bg';
  if (p.startsWith('border') || p.startsWith('outline') || p.startsWith('column-rule')) return 'bd';
  if (p.startsWith('--')) return 'tint';
  return 'any';
}

/** Colour literal -> canonical lookup key (variable alpha collapses to $A). */
function normalizeLiteral(raw) {
  const value = raw.replace(/\s+/g, '').toLowerCase();
  const fn = value.match(/^rgba?\(([^)]*)\)$/);
  if (fn) {
    const parts = fn[1].split(',');
    if (parts.length === 4) return `rgba(${parts[0]},${parts[1]},${parts[2]},$A)`;
    if (parts.length === 3) return `rgb(${parts[0]},${parts[1]},${parts[2]})`;
  }
  return value;
}

/** Alpha channel of a literal, verbatim (output alpha === input alpha). */
function alphaOf(raw) {
  const match = raw.replace(/\s+/g, '').match(/,(0|1|0?\.[0-9]+)\)$/);
  return match ? match[1] : null;
}

/** Pick the replacement for a literal in a given slot. null = unmapped. */
function resolveReplacement(group, slot, raw) {
  const target =
    group[slot] ??
    (slot === 'tint' ? group.bg : undefined) ??
    group.any ??
    (group.alpha ? `rgb(var(--${group.alpha}-rgb) / $A)` : undefined);

  if (!target) return null;
  if (target.includes('$A')) {
    const alpha = alphaOf(raw);
    return alpha === null ? null : target.replace('$A', alpha);
  }
  return target;
}

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.module.css') ? [full] : [];
  });
}
// ---- Main pass ------------------------------------------------------------
const gaps = new Map();
const touched = [];
const tokensEmitted = new Set();
let totalReplacements = 0;
let totalMaskedFallbacks = 0;

for (const file of walk(SRC)) {
  if (ONLY && !file.includes(ONLY)) continue;

  const original = readFileSync(file, 'utf8');
  const comments = [];
  let text = original.replace(/\/\*[\s\S]*?\*\//g, (comment) => {
    comments.push(comment);
    return `\u0001${comments.length - 1}\u0001`;
  });

  const fallbacks = [];
  text = text.replace(VAR_FALLBACK_RE, (fallback) => {
    fallbacks.push(fallback);
    return `@@LCVAR${fallbacks.length - 1}@@`;
  });
  totalMaskedFallbacks += fallbacks.length;

  let replacements = 0;
  let fileGaps = 0;

  text = text.replace(DECL_RE, (whole, prop, separator, value) => {
    const slot = classOf(prop);

    const wholeValue = byValue.get(value.replace(/\s+/g, '').toLowerCase());
    if (wholeValue) {
      replacements += 1;
      tokensEmitted.add(wholeValue.match(/--[a-z0-9-]+/i)[0]);
      return `${prop}${separator}${wholeValue}`;
    }

    const next = value.replace(COLOR_RE, (raw) => {
      const key = normalizeLiteral(raw);
      const alpha = alphaOf(raw);
      const alphaValue = alpha === null ? 1 : Number(alpha);
      const candidates = byLiteral.get(key) || [];
      const group = candidates.find((c) => !c.when && resolveReplacement(c, slot, raw))
        || candidates.find((c) => (!c.when || c.when(alphaValue)) && resolveReplacement(c, slot, raw))
        || null;
      const replacement = group ? resolveReplacement(group, slot, raw) : null;

      if (!replacement) {
        const gapKey = `${key}  [${slot}]  (e.g. ${basename(file)})`;
        gaps.set(gapKey, (gaps.get(gapKey) || 0) + 1);
        fileGaps += 1;
        return raw;
      }

      replacements += 1;
      for (const token of replacement.match(/--[a-z0-9-]+/gi) || []) tokensEmitted.add(token);
      return replacement;
    });

    return next === value ? whole : `${prop}${separator}${next}`;
  });

  text = text.replace(/\u0001(\d+)\u0001/g, (_, index) => comments[Number(index)]);

  text = text.replace(/@@LCVAR(\d+)@@/g, (_, index) => fallbacks[Number(index)]);

  if (replacements === 0) continue;

  totalReplacements += replacements;
  touched.push({ file, replacements, fileGaps });

  const safeToWrite = fileGaps === 0 || FORCE;
  if (!DRY && safeToWrite && text !== original) writeFileSync(file, text, 'utf8');
}

runJsxPass();

// ---- Report ---------------------------------------------------------------
console.log(`\n[tokenize-colors] mode=${DRY ? 'DRY-RUN' : FORCE ? 'APPLY (forced)' : 'APPLY'}${ONLY ? ` only~${ONLY}` : ''}`);
console.log(`files changed: ${touched.length}   color declarations replaced: ${totalReplacements}\n`);
for (const row of [...touched].sort((a, b) => b.replacements - a.replacements)) {
  console.log(`  ${String(row.replacements).padStart(3)}  ${basename(row.file)}${row.fileGaps ? `   (${row.fileGaps} UNMAPPED)` : ''}`);
}

if (gaps.size) {
  console.log('\n-- UNMAPPED color literals (left untouched) --');
  for (const [key, count] of [...gaps.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  x${String(count).padStart(2)}  ${key}`);
  }
}

// ---- Self-check: every emitted token must exist in tokens.css -------------
const tokenSource = readFileSync(TOKENS_FILE, 'utf8');
console.log(`already-token-backed var() fallbacks left as-is: ${totalMaskedFallbacks}`);
const missing = [...tokensEmitted].filter((token) => !tokenSource.includes(`${token}:`));
console.log(`\ndistinct tokens emitted: ${tokensEmitted.size}`);
console.log(missing.length ? `MISSING TOKENS: ${missing.join(', ')}` : 'token self-check: OK (every emitted token is defined in tokens.css)');
console.log(gaps.size === 0 ? 'coverage: 100% of color literals mapped\n' : `coverage: ${gaps.size} distinct literal/slot pairs unmapped\n`);
// ===========================================================================
// Phase F-UI-11 / 1.6 — JSX inline-style pass
// ---------------------------------------------------------------------------
// Rewrites color literals in inline style objects and SVG paint attributes.
// Only a quoted value that directly follows a colour-ish key is inspected, so
// JSX text, comments, imports, href/id/url props and every other string kind
// are never touched.
//
// Artwork exception: illustration / avatar / map-control palettes are content,
// not UI chrome — they stay theme-independent, same rationale as
// --color-media-canvas.
// ===========================================================================
function runJsxPass() {
  const SKIP_FILES = ['ThemeContext.jsx']; // mandate: theme bootstrap literals stay literal

  const EXCLUDE = {
    'BabyMonitoringScreen.jsx': ['#e8e0d8', '#f0ece6', '#ddd5c8', '#f5f1ec', '#c8a87a', '#e8d9c4', '#c8956a', '#c4a472', '#d4b482', '#a08050', '#d4c4a8', '#e8d4b8', '#c8b890', '#8b6914', '#3a7a3a', '#4a8a4a', '#2a6a2a', '#d4b896', '#e8ddd0', '#c4a880', '#c8ac86', '#b89870', '#00000015'],
    'ChildCryAlertScreen.jsx': ['#dde8ea', '#e8eeef', '#b8d8e4', '#a0cce0', '#4a9e6a', '#3a8e5a', '#5aae7a', '#b89876', '#e0cbb0', '#c4a886', '#d4b896'],
    'MainScreen.jsx': ['#c9a87c', '#e91e63', '#4f6ef7', '#d63ab5', '#fce4f5'],
    'GoogleMapRadiusPicker.jsx': ['#f7f7f7', '#eee', '#ddd', '#555'],
    'GoogleLocationPicker.jsx': ['#555', '#ddd'],
    'LocationPointPicker.jsx': ['#555', '#ddd'],
    'MapRadiusPicker.jsx': ['#555', '#ddd'],
    'ActiveJobDetails.jsx': ['rgba(180,180,200,$A)'],
  };

  const KEY_OK = /^(color|fill|stroke|background|backgroundcolor|backgroundimage|border|bordercolor|bordertop|borderbottom|borderleft|borderright|bordertopcolor|borderbottomcolor|borderleftcolor|borderrightcolor|outline|outlinecolor|boxshadow|textshadow|filter|stopcolor|floodcolor|caretcolor|webkittextfillcolor|iconbg|iconcolor|bg|tint|accent)$/i;
  const KEY_SKIP = /^(href|to|id|path|d|src|url|from|key|classname|name|type|placeholder|title|value|alt|role|children|label)$/i;
  const SOLE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\))$/i;
  const QUOTED_RE = /(\b[A-Za-z_$][\w$]*)(\s*[:=]\s*)(['"`])([^'"`\n]*)\3/g;

  const walkJsx = (dir) =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return walkJsx(full);
      return full.endsWith('.jsx') ? [full] : [];
    });

  const jsxSlot = (key) => {
    const kebab = key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    if (kebab === 'stop-color' || kebab === 'flood-color' || kebab === 'lighting-color') return 'fg';
    return classOf(kebab);
  };

  let files = 0;
  let total = 0;
  let artwork = 0;
  const rows = [];

  for (const file of walkJsx(SRC)) {
    const name = basename(file);
    if (SKIP_FILES.includes(name)) continue;
    if (ONLY && !file.includes(ONLY) && !name.includes(ONLY)) continue;

    const original = readFileSync(file, 'utf8');
    const comments = [];
    let text = original.replace(/\/\*[\s\S]*?\*\//g, (comment) => {
      comments.push(comment);
      return `\u0001${comments.length - 1}\u0001`;
    });

    const excluded = new Set(EXCLUDE[name] || []);
    let replacements = 0;
    let fileGaps = 0;

    text = text.replace(QUOTED_RE, (whole, key, separator, quote, value) => {
      if (KEY_SKIP.test(key)) return whole;
      if (!KEY_OK.test(key) && !SOLE_COLOR.test(value)) return whole;

      const wholeValue = byValue.get(value.replace(/\s+/g, '').toLowerCase());
      if (wholeValue) {
        replacements += 1;
        tokensEmitted.add(wholeValue.match(/--[a-z0-9-]+/i)[0]);
        return `${key}${separator}${quote}${wholeValue}${quote}`;
      }

      COLOR_RE.lastIndex = 0;
      if (!COLOR_RE.test(value)) return whole;

      const slot = jsxSlot(key);
      let touched = false;

      const next = value.replace(COLOR_RE, (raw) => {
        const literal = normalizeLiteral(raw);
        if (excluded.has(literal)) {
          artwork += 1;
          return raw;
        }

        const alpha = alphaOf(raw);
        const alphaValue = alpha === null ? 1 : Number(alpha);
        const candidates = byLiteral.get(literal) || [];
        const group = candidates.find((c) => !c.when && resolveReplacement(c, slot, raw))
          || candidates.find((c) => (!c.when || c.when(alphaValue)) && resolveReplacement(c, slot, raw))
          || null;
        const replacement = group ? resolveReplacement(group, slot, raw) : null;

        if (!replacement) {
          const gapKey = `${literal}  [${slot}]  (JSX e.g. ${name})`;
          gaps.set(gapKey, (gaps.get(gapKey) || 0) + 1);
          fileGaps += 1;
          return raw;
        }

        replacements += 1;
        touched = true;
        for (const token of replacement.match(/--[a-z0-9-]+/gi) || []) tokensEmitted.add(token);
        return replacement;
      });

      return touched ? `${key}${separator}${quote}${next}${quote}` : whole;
    });

    text = text.replace(/\u0001(\d+)\u0001/g, (_, index) => comments[Number(index)]);

    if (replacements === 0) continue;
    files += 1;
    total += replacements;
    rows.push({ name, replacements, fileGaps });
    if (!DRY && (fileGaps === 0 || FORCE) && text !== original) writeFileSync(file, text, 'utf8');
  }

  console.log(`[JSX pass] files changed: ${files}   inline literals replaced: ${total}   artwork literals preserved: ${artwork}`);
  for (const row of [...rows].sort((a, b) => b.replacements - a.replacements)) {
    console.log(`  ${String(row.replacements).padStart(3)}  ${row.name}${row.fileGaps ? `   (${row.fileGaps} UNMAPPED)` : ''}`);
  }
  console.log('');
}
